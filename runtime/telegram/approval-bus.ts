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
 * Atomic-rename hygiene (Plan 02 stress-test 2nd-pass):
 *   - `createApprovalRequest`: write to `pending/.<id>.tmp` then
 *     `atomicRename(tmp, pending/<id>.json)` so partial writes are never
 *     observable to listeners.
 *   - `resolveApproval`: three-phase no-strand sequence (PR45 adversarial
 *     fix for the Codex HIGH "pending unlink before resolved write strands
 *     approvals on crash" finding):
 *       (a) raw fsp.rename pending/<id>.json → inflight/<id>.json (the
 *           claim point — no information loss on crash because the
 *           inflight file preserves the original request envelope).
 *           Raw rename (NOT atomicRename) is required here: atomicRename
 *           recovers from EEXIST by unlinking the destination, which would
 *           destroy a concurrent winner's claim file. EEXIST/ENOENT/EPERM
 *           on this rename all mean "we lost the race".
 *       (b) durably write resolved/<id>.json via tmp + atomicRename.
 *       (c) unlink inflight/<id>.json only after the resolved file
 *           commit succeeds. Crash between (b) and (c) leaves a
 *           harmless inflight file recoverable on next boot.
 *   - All renames go through `atomicRename` from `state-paths.ts` to handle
 *     the Windows EEXIST case.
 *
 * Recovery: `listInflightApprovals()` surfaces approvals that crashed
 * between claim and resolved-write commit. The daemon's boot path (Plan 07+)
 * is expected to either (a) re-publish them as pending or (b) classify them
 * as system-timeout and roll forward.
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

import { atomicRename, getErrnoCode, pathFor } from "../daemon/state-paths.js";

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
		await atomicRename(tmp, final);
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
 *   1. CLAIM: rename `pending/<id>.json` → `inflight/<id>.json` atomically.
 *      This is the new atomic claim point. The original request envelope
 *      survives even if the daemon crashes immediately after the claim.
 *   2. PUBLISH: write `resolved/<id>.json` via tmp + atomicRename. Crash
 *      between claim and publish leaves the request safely in
 *      `approvals/inflight/` for boot-time recovery.
 *   3. CLEANUP: unlink the inflight file. Crash between publish and
 *      cleanup leaves an orphaned inflight file that boot recovery
 *      can safely reconcile with the resolved file (resolved wins).
 *
 * Concurrent callers observing `ENOENT` on the claim rename classify the
 * outcome via the presence of a resolved file: present → `already-resolved`,
 * absent → `not-found`. The 5x20ms re-poll handles the race window between
 * winner's claim and winner's publish.
 *
 * Returns `{ ok: false, reason: "not-found" }` when neither a pending,
 * inflight, nor resolved record exists for `approvalId`. Returns
 * `{ ok: false, reason: "already-resolved" }` when a resolved record
 * already exists (either from a prior call or from a concurrent winner).
 * Returns `{ ok: false, reason: "invalid-id" }` when `approvalId` does not
 * match the UUID v4 format.
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

	// Upfront existence probe — if no record exists for this id in any of
	// pending / inflight / resolved, return not-found immediately without
	// entering the slow-disk race-loser poll. This keeps the strict
	// "never-created" semantic fast while preserving the slow-disk poll
	// for the genuine race-loser case (saw pending pre-rename).
	const pendingExistedAtStart = await pathExists(pendingPath);
	if (!pendingExistedAtStart) {
		if (await pathExists(resolvedPath)) {
			return { ok: false, reason: "already-resolved" };
		}
		if (!(await pathExists(inflightPath))) {
			return { ok: false, reason: "not-found" };
		}
		// inflight present: a prior call crashed mid-resolution; fall
		// through to the rename attempt so we hit the ENOENT branch
		// below which polls the inflight→resolved transition.
	}

	try {
		// CLAIM phase uses raw fsp.rename — NOT atomicRename — because
		// atomicRename's EEXIST recovery unlinks the destination and
		// retries. For the claim, the destination IS another caller's
		// claim file (the race winner) — we must never destroy it. Any
		// failure here (ENOENT / EEXIST / EPERM / EBUSY) means we lost
		// the race; the branch below classifies the outcome.
		await fsp.rename(pendingPath, inflightPath);
	} catch (err) {
		const code = getErrnoCode(err);
		// ENOENT — pending was already claimed (race winner moved it).
		// EEXIST — another caller's inflight is already in place.
		// EPERM/EBUSY — Windows surfaces these when a concurrent rename
		// of the same path is mid-flight.
		if (
			code === "ENOENT" ||
			code === "EEXIST" ||
			code === "EPERM" ||
			code === "EBUSY"
		) {
			// Inflight may exist from a crashed prior call — treat as
			// already-claimed by another caller; poll for the resolved
			// file under generous bound to absorb slow-disk publishes.
			if (await pathExists(inflightPath)) {
				for (let i = 0; i < 250; i++) {
					await sleep(20);
					if (await pathExists(resolvedPath)) {
						return { ok: false, reason: "already-resolved" };
					}
					if (!(await pathExists(inflightPath))) {
						// Inflight cleared without resolved? winner crashed
						// post-publish; resolved should be present.
						if (await pathExists(resolvedPath)) {
							return { ok: false, reason: "already-resolved" };
						}
						return { ok: false, reason: "not-found" };
					}
				}
				// Long-stuck inflight: surface to caller — boot recovery
				// must reconcile.
				return { ok: false, reason: "already-resolved" };
			}
			if (await pathExists(resolvedPath)) {
				return { ok: false, reason: "already-resolved" };
			}
			// If we never observed a pending file at entry AND none of
			// inflight/resolved exist now, this id was never created.
			// Skip the slow-disk poll — there is no winner to wait for.
			if (!pendingExistedAtStart) {
				return { ok: false, reason: "not-found" };
			}
			// Race window: we observed pending at entry but it was gone
			// by the rename — a concurrent winner has claimed it. Poll
			// for the resolved file under a generous bound (5s) before
			// classifying as not-found, since slow disk / antivirus /
			// NFS can push publish past 100ms.
			for (let i = 0; i < 250; i++) {
				await sleep(20);
				if (await pathExists(resolvedPath)) {
					return { ok: false, reason: "already-resolved" };
				}
			}
			return { ok: false, reason: "not-found" };
		}
		throw err;
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
		await atomicRename(tmp, resolvedPath);
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
