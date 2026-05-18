/**
 * Approval-bus: file-based approval handshake.
 *
 * Plan 06 Task 1. The active approval path is the file-bus:
 *   1. Agent code calls `createApprovalRequest()` → writes JSON to
 *      `approvals/pending/<approvalId>.json`.
 *   2. Telegram bot polls `listPendingApprovals()` (Plan 07 wiring) and sends
 *      an inline-keyboard message to the allowed user(s).
 *   3. User taps Allow/Deny; the bot's callback handler calls
 *      `resolveApproval(approvalId, decision, resolvedBy)` which atomically
 *      moves the request from `approvals/pending/` to `approvals/resolved/`.
 *   4. Agent's `waitForApproval(approvalId, timeoutMs)` polling loop
 *      observes the resolved file and returns the decision.
 *
 * The `approval` kind on `AgentRuntime.send()` is a RESERVED future channel
 * for in-process push delivery (Phase 3+). Phase 1 does NOT push approvals
 * via `runtime.send` — the file-bus is the single source of truth.
 *
 * Atomic-rename hygiene (Plan feature-phase-1-deferred-hardening/02 audit
 * — see `runtime/daemon/state-paths.md` for the per-caller classification):
 *   - `createApprovalRequest`: write to `pending/.<id>.tmp` then
 *     `atomicRenameStaleDest(tmp, pending/<id>.json)` so partial writes
 *     are never observable to listeners. Classification: stale-dest (the
 *     UUID-v4 path is operationally unique; any pre-existing dst is an
 *     orphan from a crashed prior process).
 *   - `resolveApproval`: three-phase no-strand sequence (PR45 adversarial
 *     fix for the Codex HIGH "pending unlink before resolved write strands
 *     approvals on crash" finding):
 *       (a) strict `atomicRename(pending/<id>.json, inflight/<id>.json)` —
 *           the claim point. Classification: collision-hazard. The strict
 *           variant fails-on-EEXIST so a concurrent winner's inflight file
 *           is never destroyed; EEXIST/ENOENT/EPERM/EBUSY on this rename
 *           all mean "we lost the race" and the error branch classifies
 *           the outcome. On POSIX strict `atomicRename` is implemented as
 *           `link(2) + unlink(2)` — fail-on-EEXIST without a TOCTOU race
 *           (raw `fsp.rename` on POSIX would silently overwrite).
 *       (b) durably write resolved/<id>.json via tmp +
 *           `atomicRenameStaleDest`. Classification: stale-dest (the per-
 *           approvalId in-process mutex plus the CLAIM serialization gate
 *           guarantee only the winner reaches this point).
 *       (c) unlink inflight/<id>.json only after the resolved file
 *           commit succeeds. Crash between (b) and (c) leaves a
 *           harmless inflight file recoverable on next boot.
 *
 * Recovery (two layers, defense-in-depth against the documented
 * dual-presence window in `state-paths.ts` § `atomicRename` JSDoc):
 *
 *   - **Boot recovery** — `recoverStrandedApprovals()` MUST be called at
 *     daemon startup BEFORE the Telegram bot begins polling. It scans
 *     `approvals/inflight/` and reconciles every entry:
 *       (a) resolved exists for the same id → unlink the orphan inflight
 *           (and any orphan pending hardlink); resolved wins.
 *       (b) pending also exists (dual-presence — crash inside
 *           `atomicRename` between `link(2)` and `unlink(2)`) → unlink
 *           the inflight hardlink; the pending file is preserved so the
 *           bot can re-broadcast on its next poll tick.
 *       (c) only inflight exists (crash after CLAIM committed but before
 *           PUBLISH) → rename inflight back to pending so the bot can
 *           re-broadcast and a fresh `resolveApproval` call can resume
 *           normal CLAIM → PUBLISH → CLEANUP flow.
 *     Without this, post-crash approvals are silently lost — every
 *     subsequent `resolveApproval` call hits the stranded inflight,
 *     polls vainly for a resolved file that no live owner will ever
 *     write, and returns `already-resolved` to the user.
 *
 *   - **Runtime recovery in `resolveApproval`** — if a new caller arrives
 *     before boot recovery ran (or after a runtime exception left state
 *     stranded), the CLAIM path's race-loser branch detects long-stuck
 *     inflight (no resolved after the 5s poll budget) and rolls forward
 *     by taking ownership of the inflight envelope and publishing the
 *     CURRENT call's decision. The original (crashed) caller's decision
 *     is unrecoverable; the user supplying the new decision at the bot
 *     keyboard is the authoritative source.
 *
 * `listInflightApprovals()` exposes the inflight set for diagnostics
 * and for boot recovery's internal scan.
 *
 * SECURITY (PR45 critical fix): every public entry point validates the
 * `approvalId` argument via `assertValidApprovalId`. Telegram users supply
 * approval IDs from `/approve` text commands and from inline callback_data;
 * an unvalidated ID containing `..` or path separators would let an
 * allowlisted user escape the `approvals/` directory and delete or
 * overwrite arbitrary daemon state. IDs are generated with
 * `crypto.randomUUID()` so we lock the format to the strict UUID v4 regex.
 *
 * Race semantics (M2): when two `resolveApproval` calls race for the same
 * approvalId, the first to complete the rename of pending → inflight wins;
 * the second observes the missing pending file and returns `{ ok: false,
 * reason: "already-resolved" }`. Only the rename winner reaches the
 * resolved-write path, so overwriting cannot happen.
 */

import * as crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

import {
	atomicRename,
	atomicRenameStaleDest,
	getErrnoCode,
	pathFor,
} from "../daemon/state-paths.js";
import { emit as emitTelemetry } from "../daemon/telemetry.js";

export interface ApprovalRequest {
	readonly approvalId: string;
	readonly agentId: string;
	readonly handleId: string;
	readonly reason: string;
	readonly createdAt: number;
	readonly expiresAt?: number;
}

export interface ApprovalDecision {
	readonly approvalId: string;
	readonly decision: "allow" | "deny";
	readonly resolvedBy: string;
	readonly resolvedAt: number;
}

export interface CreateApprovalInput {
	readonly agentId: string;
	readonly handleId: string;
	readonly reason: string;
	readonly expiresAt?: number;
	readonly ttlMs?: number;
}

export interface CreateApprovalResult {
	readonly approvalId: string;
	readonly pendingPath: string;
}

export type ResolveApprovalResult =
	| { readonly ok: true; readonly resolvedPath: string }
	| {
			readonly ok: false;
			readonly reason: "not-found" | "already-resolved" | "invalid-id";
	  };

export type WaitForApprovalResult =
	| ApprovalDecision
	| { readonly timedOut: true };

const DEFAULT_POLL_INTERVAL_MS = 250;

/**
 * Strict UUID v4 regex (per RFC 4122 §4.4). `crypto.randomUUID()` always
 * emits this format; rejecting anything else closes the path-traversal
 * surface from Telegram user input.
 */
const APPROVAL_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isValidApprovalId(value: unknown): value is string {
	return typeof value === "string" && APPROVAL_ID_PATTERN.test(value);
}

/**
 * Throw `TypeError("invalid approval ID")` for anything not matching the
 * UUID v4 form. Public entry points call this BEFORE building any
 * filesystem path from the caller-supplied id.
 */
export function assertValidApprovalId(value: unknown): asserts value is string {
	if (!isValidApprovalId(value)) {
		throw new TypeError("invalid approval ID");
	}
}

function pendingDir(): string {
	return pathFor("approvals/pending");
}

function resolvedDir(): string {
	return pathFor("approvals/resolved");
}

function inflightDir(): string {
	return path.join(pathFor("approvals/pending"), "..", "inflight");
}

function pendingFinalPath(approvalId: string): string {
	return path.join(pendingDir(), `${approvalId}.json`);
}

function nonce(): string {
	return crypto.randomBytes(6).toString("hex");
}

function pendingTmpPath(approvalId: string): string {
	return path.join(pendingDir(), `.${approvalId}.${nonce()}.tmp`);
}

function resolvedFinalPath(approvalId: string): string {
	return path.join(resolvedDir(), `${approvalId}.json`);
}

function resolvedTmpPath(approvalId: string): string {
	return path.join(resolvedDir(), `.${approvalId}.${nonce()}.tmp`);
}

function inflightFinalPath(approvalId: string): string {
	return path.join(inflightDir(), `${approvalId}.json`);
}

function isApprovalRequest(value: unknown): value is ApprovalRequest {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	if (typeof v.approvalId !== "string") return false;
	if (typeof v.agentId !== "string") return false;
	if (typeof v.handleId !== "string") return false;
	if (typeof v.reason !== "string") return false;
	if (typeof v.createdAt !== "number") return false;
	if (v.expiresAt !== undefined && typeof v.expiresAt !== "number") {
		return false;
	}
	return true;
}

function isApprovalDecision(value: unknown): value is ApprovalDecision {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	if (typeof v.approvalId !== "string") return false;
	if (v.decision !== "allow" && v.decision !== "deny") return false;
	if (typeof v.resolvedBy !== "string") return false;
	if (typeof v.resolvedAt !== "number") return false;
	return true;
}

/**
 * Create a pending approval request. Returns the generated `approvalId`
 * (UUID v4) and the absolute path of the pending file.
 *
 * `ttlMs` is a convenience over `expiresAt` — when `ttlMs` is provided and
 * `expiresAt` is omitted, `expiresAt = Date.now() + ttlMs`. When both are
 * present, `expiresAt` wins.
 */
export async function createApprovalRequest(
	input: CreateApprovalInput,
): Promise<CreateApprovalResult> {
	const approvalId = crypto.randomUUID();
	// crypto.randomUUID() is contract-guaranteed to emit UUID v4 form; this
	// assert is defense-in-depth in case the Node version contract changes.
	assertValidApprovalId(approvalId);
	const createdAt = Date.now();
	const expiresAt =
		input.expiresAt !== undefined
			? input.expiresAt
			: input.ttlMs !== undefined
				? createdAt + input.ttlMs
				: undefined;

	const request: ApprovalRequest = {
		approvalId,
		agentId: input.agentId,
		handleId: input.handleId,
		reason: input.reason,
		createdAt,
		...(expiresAt !== undefined ? { expiresAt } : {}),
	};

	await fsp.mkdir(pendingDir(), { recursive: true });

	const tmp = pendingTmpPath(approvalId);
	const final = pendingFinalPath(approvalId);
	const handle = await fsp.open(tmp, "w");
	try {
		await handle.writeFile(JSON.stringify(request));
		await handle.datasync();
	} finally {
		await handle.close();
	}
	try {
		await atomicRenameStaleDest(tmp, final);
	} catch (err) {
		await fsp.unlink(tmp).catch(() => undefined);
		throw err;
	}

	return { approvalId, pendingPath: final };
}

/**
 * Resolve an approval.
 *
 * Three-phase no-strand sequence (PR45 Codex HIGH finding fix):
 *
 *   1. CLAIM: rename `pending/<id>.json` → `inflight/<id>.json` via the
 *      strict `atomicRename` (`link(2)` + `unlink(2)`). The strict variant
 *      fails-on-EEXIST so a concurrent winner's inflight is never destroyed.
 *      The original request envelope survives a daemon crash immediately
 *      after CLAIM (the inflight envelope is the canonical record).
 *   2. PUBLISH: write `resolved/<id>.json` via tmp + `atomicRenameStaleDest`.
 *      A crash between CLAIM and PUBLISH leaves the request safely in
 *      `approvals/inflight/` for boot recovery.
 *   3. CLEANUP: unlink the inflight file. A crash between PUBLISH and
 *      CLEANUP leaves an orphaned inflight that boot recovery cleans up
 *      (resolved wins).
 *
 * Stranded-state recovery (PR48 Codex HIGH fix). The `atomicRename`
 * primitive's `link(2)` → `unlink(2)` sequence has a documented
 * dual-presence window: a crash between the two syscalls leaves a
 * hardlink pair (pending + inflight refer to the same inode) with no
 * resolved file. A fresh `resolveApproval` call arriving in that state
 * MUST NOT silently absorb the user's new decision as `already-resolved`.
 * This implementation:
 *
 *   - Detects inflight present at entry (after mutex acquisition) and
 *     rolls forward by taking ownership of the inflight envelope,
 *     unlinking the orphan pending hardlink, and publishing the CURRENT
 *     caller's decision. The crashed caller's decision is unrecoverable
 *     (it was never persisted); the Telegram user supplying the new
 *     decision at the keyboard is the authoritative source.
 *   - In the race-loser CLAIM branch, after the 5s slow-disk poll for a
 *     concurrent winner's resolved file exhausts, treats the persistent
 *     inflight as stranded and applies the same roll-forward recovery
 *     instead of returning `already-resolved`.
 *   - At daemon boot, `recoverStrandedApprovals()` proactively reconciles
 *     the same states (see the file header docstring) — this in-call
 *     recovery is the second-line defense if a stranded entry slips past
 *     boot recovery (or is created at runtime by an exception inside
 *     `atomicRename`'s rollback path).
 *
 * Concurrent callers observing `ENOENT` on the claim rename classify the
 * outcome via the presence of a resolved file: present → `already-resolved`,
 * absent → `not-found`. The slow-disk poll handles the race window between
 * a winner's CLAIM and that winner's PUBLISH.
 *
 * Returns `{ ok: false, reason: "not-found" }` when neither a pending,
 * inflight, nor resolved record exists for `approvalId`. Returns
 * `{ ok: false, reason: "already-resolved" }` when a resolved record
 * already exists. Returns `{ ok: false, reason: "invalid-id" }` when
 * `approvalId` does not match the UUID v4 format.
 *
 * SECURITY: the `approvalId` argument is validated at entry. Telegram users
 * can supply IDs via `/approve` and via callback_data; an unvalidated ID
 * with `..` or path separators would let an allowlisted user escape the
 * `approvals/` directory and unlink arbitrary daemon state.
 */
// Process-level mutex per approvalId. Serializes concurrent resolveApproval
// calls for the same id within ONE daemon process so the rename/publish
// sequence is not interleaved. Cross-process race (multi-daemon, which we do
// not support) still relies on the file-system rename semantics.
const inProcessResolveLocks = new Map<string, Promise<unknown>>();

export async function resolveApproval(
	approvalId: string,
	decision: "allow" | "deny",
	resolvedBy: string,
): Promise<ResolveApprovalResult> {
	if (!isValidApprovalId(approvalId)) {
		return { ok: false, reason: "invalid-id" };
	}
	const prior = inProcessResolveLocks.get(approvalId) ?? Promise.resolve();
	let release!: () => void;
	const myLock = new Promise<void>((resolve) => {
		release = resolve;
	});
	inProcessResolveLocks.set(
		approvalId,
		prior.then(() => myLock).catch(() => undefined),
	);
	try {
		await prior;
	} catch {
		// Prior holder rejected — claim the lock anyway.
	}
	try {
		return await resolveApprovalLocked(approvalId, decision, resolvedBy);
	} finally {
		release();
		// Clean up the map entry if no successor took the slot in the meantime
		// (best-effort — Map.get may race with a new arrival but the new
		// arrival will simply not find this entry and create its own).
		if (
			inProcessResolveLocks.get(approvalId) ===
			prior.then(() => myLock).catch(() => undefined)
		) {
			inProcessResolveLocks.delete(approvalId);
		}
	}
}

async function resolveApprovalLocked(
	approvalId: string,
	decision: "allow" | "deny",
	resolvedBy: string,
): Promise<ResolveApprovalResult> {
	const pendingPath = pendingFinalPath(approvalId);
	const inflightPath = inflightFinalPath(approvalId);
	const resolvedPath = resolvedFinalPath(approvalId);

	await fsp.mkdir(inflightDir(), { recursive: true });

	// Short-circuit if the resolved file already exists — a prior caller
	// (or boot recovery's own resolved-wins cleanup) committed the decision.
	if (await pathExists(resolvedPath)) {
		return { ok: false, reason: "already-resolved" };
	}

	// Stranded-state runtime recovery: if inflight is already present at
	// entry, a prior CLAIM did not commit (the only legitimate path that
	// leaves inflight in place between mutex acquisitions is a crashed
	// daemon process or a rare in-process `atomicRename` rollback failure;
	// the in-process mutex prevents healthy concurrent CLAIMs from
	// observing inflight here). Take ownership: unlink the orphan pending
	// hardlink (if dual-presence) and skip straight to PUBLISH. The
	// stranded caller's decision is unrecoverable — the current caller's
	// decision authoritatively replaces it. See the Codex HIGH finding on
	// PR45 + `runtime/daemon/state-paths.md` for the full reasoning.
	let weOwnInflight = await pathExists(inflightPath);
	if (weOwnInflight) {
		await fsp.unlink(pendingPath).catch(() => undefined);
	} else {
		const pendingExistedAtStart = await pathExists(pendingPath);
		if (!pendingExistedAtStart) {
			return { ok: false, reason: "not-found" };
		}
		try {
			// CLAIM phase uses strict `atomicRename` (NOT the destructive
			// `atomicRenameStaleDest`) — the destination IS another caller's
			// claim file when we lose the race, and the strict variant
			// fails-on-EEXIST instead of unlinking and overwriting. The
			// strict variant is implemented as `link+unlink` on BOTH POSIX
			// and Windows (NTFS `CreateHardLinkW` fails atomically with
			// EEXIST when dst exists, same as POSIX `link(2)`), so the
			// CLAIM never silently overwrites a concurrent winner's
			// inflight file on either platform.
			await atomicRename(pendingPath, inflightPath);
			weOwnInflight = true;
		} catch (err) {
			const code = getErrnoCode(err);
			if (
				code !== "ENOENT" &&
				code !== "EEXIST" &&
				code !== "EPERM" &&
				code !== "EBUSY"
			) {
				throw err;
			}
			// ENOENT — pending was already claimed.
			// EEXIST — another caller's inflight is already in place.
			// EPERM/EBUSY — Windows surfaces these for mid-rename races.
			if (await pathExists(resolvedPath)) {
				return { ok: false, reason: "already-resolved" };
			}
			if (await pathExists(inflightPath)) {
				// Poll for the resolved file under a generous bound (5s)
				// to absorb slow-disk publishes from a healthy concurrent
				// winner. If the poll exhausts without a resolved file
				// appearing, treat as stranded and take ownership — this
				// is the Codex HIGH dual-presence-strand fix.
				for (let i = 0; i < 250; i++) {
					await sleep(20);
					if (await pathExists(resolvedPath)) {
						return { ok: false, reason: "already-resolved" };
					}
					if (!(await pathExists(inflightPath))) {
						// Inflight cleared mid-poll without a resolved
						// file — the winner crashed post-CLEANUP-start.
						// Re-probe resolved to absorb a publish that
						// landed between our two checks.
						if (await pathExists(resolvedPath)) {
							return { ok: false, reason: "already-resolved" };
						}
						return { ok: false, reason: "not-found" };
					}
				}
				// Long-stuck inflight: assume the prior owner crashed
				// and take ownership. Unlink the orphan pending
				// hardlink (dual-presence case) and fall through to
				// PUBLISH with the current caller's decision.
				if (!(await pathExists(inflightPath))) {
					// Lost the race in the last few ms — re-check resolved.
					if (await pathExists(resolvedPath)) {
						return { ok: false, reason: "already-resolved" };
					}
					return { ok: false, reason: "not-found" };
				}
				weOwnInflight = true;
				await fsp.unlink(pendingPath).catch(() => undefined);
			} else {
				// No inflight visible — winner already published + cleaned
				// up. resolved should be present; if not, it was never created.
				if (await pathExists(resolvedPath)) {
					return { ok: false, reason: "already-resolved" };
				}
				// I2 (Opus PR #50 dual-review): when `link(2)` returns EPERM
				// AND no winning state is observable (no resolved, no
				// inflight), the most likely cause is a Linux
				// `fs.protected_hardlinks=1` misconfiguration rather than a
				// lost race. A genuine lost race always leaves an inflight
				// or resolved file visible to the loser. Emit telemetry so
				// the misconfiguration surfaces instead of silently
				// reporting `not-found` for every approval forever. Hash the
				// approvalId so the telemetry stream does not leak the raw
				// id (consistent with PR #45 I8 PII-hash pattern).
				if (code === "EPERM") {
					void emitTelemetry({
						kind: "approval-claim-link-eperm",
						approvalIdHash: crypto
							.createHash("sha256")
							.update(approvalId)
							.digest("hex")
							.slice(0, 16),
					});
				}
				return { ok: false, reason: "not-found" };
			}
		}
	}

	if (!weOwnInflight) {
		// Defensive — should be unreachable. Keeps the type narrowing
		// honest if a future edit breaks one of the branches above.
		return { ok: false, reason: "not-found" };
	}

	const envelope: ApprovalDecision = {
		approvalId,
		decision,
		resolvedBy,
		resolvedAt: Date.now(),
	};

	await fsp.mkdir(resolvedDir(), { recursive: true });
	const tmp = resolvedTmpPath(approvalId);
	const handle = await fsp.open(tmp, "w");
	try {
		await handle.writeFile(JSON.stringify(envelope));
		await handle.datasync();
	} finally {
		await handle.close();
	}
	try {
		await atomicRenameStaleDest(tmp, resolvedPath);
	} catch (err) {
		await fsp.unlink(tmp).catch(() => undefined);
		// Resolved publish failed AFTER successful claim — leave inflight
		// for boot recovery. Surface the error rather than silently
		// losing the decision.
		throw err;
	}

	// Cleanup phase — unlink inflight only after resolved is durably
	// committed. Failure here is non-fatal; boot recovery prefers
	// resolved over inflight.
	await fsp.unlink(inflightPath).catch(() => undefined);

	return { ok: true, resolvedPath };
}

async function pathExists(p: string): Promise<boolean> {
	try {
		await fsp.access(p);
		return true;
	} catch (err) {
		if (getErrnoCode(err) === "ENOENT") return false;
		throw err;
	}
}

async function readResolvedDecision(
	approvalId: string,
): Promise<ApprovalDecision | null> {
	const resolvedPath = resolvedFinalPath(approvalId);
	let raw: string;
	try {
		raw = await fsp.readFile(resolvedPath, "utf8");
	} catch (err) {
		if (getErrnoCode(err) === "ENOENT") return null;
		throw err;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	return isApprovalDecision(parsed) ? parsed : null;
}

/**
 * Block until the approval is resolved or `timeoutMs` elapses.
 *
 * Polls `resolved/<id>.json` every `pollIntervalMs` (default 250ms — make
 * shorter in tests via `pollIntervalMs`). Returns `{ timedOut: true }`
 * when the deadline elapses; the caller decides whether to call
 * `resolveApproval(id, "deny", "system-timeout")` or leave the pending
 * file for ghost detection by `listPendingApprovals`.
 *
 * No `fs.watch` — keeps the implementation cross-platform simple.
 *
 * SECURITY: `approvalId` is validated; an invalid id returns
 * `{ timedOut: true }` after `timeoutMs` (callers treat invalid as
 * never-resolved).
 */
export async function waitForApproval(
	approvalId: string,
	timeoutMs: number,
	pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): Promise<WaitForApprovalResult> {
	if (!isValidApprovalId(approvalId)) {
		// Don't throw — callers may receive ids from cross-process file-bus
		// and we want timeout semantics, not crash. But log so the
		// operator sees the misuse.
		console.error(
			`[approval-bus] waitForApproval rejected invalid approvalId; returning timedOut`,
		);
		await sleep(Math.min(timeoutMs, 50));
		return { timedOut: true };
	}
	const deadline = Date.now() + timeoutMs;
	const interval = Math.max(1, pollIntervalMs);
	while (true) {
		const decision = await readResolvedDecision(approvalId);
		if (decision !== null) return decision;
		const remaining = deadline - Date.now();
		if (remaining <= 0) return { timedOut: true };
		await sleep(Math.min(interval, remaining));
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * Enumerate all pending (unresolved) approval requests on disk. Used by
 * `/status` for an at-a-glance view and by Plan 07's bot poller to
 * discover new approvals to broadcast.
 *
 * Files starting with `.` (in-flight tmp writes) are skipped.
 * Malformed JSON, mistyped envelopes, and files that fail the UUID
 * approval-id regex are logged to stderr (visible to the operator) and
 * skipped — silent loss of approvals creates an invisible stuck class.
 */
export async function listPendingApprovals(): Promise<ApprovalRequest[]> {
	const dir = pendingDir();
	let entries: string[];
	try {
		entries = await fsp.readdir(dir);
	} catch (err) {
		if (getErrnoCode(err) === "ENOENT") return [];
		throw err;
	}
	const out: ApprovalRequest[] = [];
	let skipped = 0;
	for (const entry of entries) {
		if (entry.startsWith(".")) continue;
		if (!entry.endsWith(".json")) continue;
		// Defense-in-depth: validate the filename matches the UUID form
		// before reading. Anything else is either a leftover from a buggy
		// caller or a foreign file we should not touch.
		const idFromName = entry.slice(0, -".json".length);
		if (!isValidApprovalId(idFromName)) {
			console.error(
				`[approval-bus] listPendingApprovals skipping non-UUID file: ${entry}`,
			);
			skipped++;
			continue;
		}
		const fullPath = path.join(dir, entry);
		let raw: string;
		try {
			raw = await fsp.readFile(fullPath, "utf8");
		} catch (err) {
			console.error(
				`[approval-bus] listPendingApprovals read failed for ${entry}: ${err instanceof Error ? err.message : String(err)}`,
			);
			skipped++;
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (err) {
			console.error(
				`[approval-bus] listPendingApprovals JSON parse failed for ${entry}: ${err instanceof Error ? err.message : String(err)}`,
			);
			skipped++;
			continue;
		}
		if (isApprovalRequest(parsed)) {
			out.push(parsed);
		} else {
			console.error(
				`[approval-bus] listPendingApprovals schema-invalid envelope skipped: ${entry}`,
			);
			skipped++;
		}
	}
	if (skipped > 0) {
		console.error(
			`[approval-bus] listPendingApprovals skipped ${skipped} malformed file(s)`,
		);
	}
	return out;
}

export interface RecoverStrandedApprovalsResult {
	/** approvalIds whose inflight envelope was preserved as pending
	 * (re-broadcastable). */
	readonly republished: readonly string[];
	/** approvalIds whose inflight envelope was an orphan hardlink and
	 * was cleaned up (pending preserved). */
	readonly cleaned: readonly string[];
	/** approvalIds whose resolved file already existed; inflight + any
	 * orphan pending hardlink were cleaned up. */
	readonly resolvedSurvived: readonly string[];
	/** approvalIds that could not be recovered (filesystem error).
	 * Surfaced to the operator via stderr; daemon continues. */
	readonly failed: readonly string[];
}

/**
 * Boot-time reconciliation for the dual-presence + inflight-only
 * stranded states documented in `runtime/daemon/state-paths.ts`'s
 * `atomicRename` JSDoc + the file header above.
 *
 * MUST be called once at daemon startup BEFORE the Telegram bot begins
 * polling — Codex HIGH PR45+: a stranded inflight observed by a fresh
 * `resolveApproval` call would otherwise cause the user's decision to
 * be silently rejected as `already-resolved`, the waiting agent to time
 * out, and the approval to be permanently lost.
 *
 * Reconciliation matrix (per inflight entry):
 *   - resolved exists → unlink inflight + any pending hardlink;
 *     resolved is the durable winner.
 *   - pending also exists (dual-presence: crash between `link(2)`
 *     and `unlink(2)` inside `atomicRename`) → unlink the inflight
 *     hardlink; pending stays so the bot re-broadcasts.
 *   - only inflight exists (crash after CLAIM committed, before
 *     PUBLISH wrote `resolved/<id>.json`) → rename inflight back to
 *     pending so the bot re-broadcasts and the next `resolveApproval`
 *     call proceeds through the normal CLAIM → PUBLISH flow.
 *
 * Idempotent — safe to call multiple times. Returns a structured
 * report for telemetry / logging.
 */
export async function recoverStrandedApprovals(): Promise<RecoverStrandedApprovalsResult> {
	const dir = inflightDir();
	let entries: string[];
	try {
		entries = await fsp.readdir(dir);
	} catch (err) {
		if (getErrnoCode(err) === "ENOENT") {
			return { republished: [], cleaned: [], resolvedSurvived: [], failed: [] };
		}
		throw err;
	}
	const republished: string[] = [];
	const cleaned: string[] = [];
	const resolvedSurvived: string[] = [];
	const failed: string[] = [];
	for (const entry of entries) {
		if (entry.startsWith(".")) continue;
		if (!entry.endsWith(".json")) continue;
		const id = entry.slice(0, -".json".length);
		if (!isValidApprovalId(id)) {
			console.error(
				`[approval-bus] recoverStrandedApprovals skipping non-UUID inflight file: ${entry}`,
			);
			continue;
		}
		const pendingP = pendingFinalPath(id);
		const inflightP = inflightFinalPath(id);
		const resolvedP = resolvedFinalPath(id);
		try {
			if (await pathExists(resolvedP)) {
				// resolved wins — purge inflight + any orphan pending hardlink.
				await fsp.unlink(inflightP).catch(() => undefined);
				await fsp.unlink(pendingP).catch(() => undefined);
				resolvedSurvived.push(id);
				continue;
			}
			if (await pathExists(pendingP)) {
				// dual-presence — unlink the inflight hardlink; pending
				// is the canonical state for re-broadcast.
				await fsp.unlink(inflightP).catch(() => undefined);
				cleaned.push(id);
				continue;
			}
			// inflight-only — rename it back to pending so the bot
			// re-broadcasts and the next resolveApproval call goes
			// through the normal CLAIM path.
			await fsp.mkdir(pendingDir(), { recursive: true });
			await atomicRenameStaleDest(inflightP, pendingP);
			republished.push(id);
		} catch (err) {
			console.error(
				`[approval-bus] recoverStrandedApprovals failed for ${id}: ${err instanceof Error ? err.message : String(err)}`,
			);
			failed.push(id);
		}
	}
	return { republished, cleaned, resolvedSurvived, failed };
}

/**
 * Enumerate approvals that crashed mid-resolution. Used by daemon boot
 * recovery to reconcile pre-crash inflight claims (PR45 Codex HIGH fix).
 */
export async function listInflightApprovals(): Promise<ApprovalRequest[]> {
	const dir = inflightDir();
	let entries: string[];
	try {
		entries = await fsp.readdir(dir);
	} catch (err) {
		if (getErrnoCode(err) === "ENOENT") return [];
		throw err;
	}
	const out: ApprovalRequest[] = [];
	for (const entry of entries) {
		if (entry.startsWith(".")) continue;
		if (!entry.endsWith(".json")) continue;
		const idFromName = entry.slice(0, -".json".length);
		if (!isValidApprovalId(idFromName)) continue;
		let raw: string;
		try {
			raw = await fsp.readFile(path.join(dir, entry), "utf8");
		} catch {
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			continue;
		}
		if (isApprovalRequest(parsed)) {
			out.push(parsed);
		}
	}
	return out;
}
