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
 *   - `resolveApproval`: write to `resolved/.<id>.tmp` then
 *     `atomicRename(tmp, resolved/<id>.json)` then unlink the pending file.
 *   - All renames go through `atomicRename` from `state-paths.ts` to handle
 *     the Windows EEXIST case.
 *
 * Race semantics (M2): when two `resolveApproval` calls race for the same
 * approvalId, the first to complete the unlink wins; the second observes
 * the missing pending file and returns `{ ok: false, reason:
 * "already-resolved" }`. Only the unlink winner reaches the resolved-write
 * path, so overwriting cannot happen. The `atomicRename` call for the
 * resolved file uses the Windows-safe unlink+rename pattern to handle the
 * case where a previous crashed run left a stale resolved file — that is a
 * stale-file cleanup, not a concurrent-writer risk.
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
			readonly reason: "not-found" | "already-resolved";
	  };

export type WaitForApprovalResult =
	| ApprovalDecision
	| { readonly timedOut: true };

const DEFAULT_POLL_INTERVAL_MS = 250;

function pendingDir(): string {
	return pathFor("approvals/pending");
}

function resolvedDir(): string {
	return pathFor("approvals/resolved");
}

function pendingFinalPath(approvalId: string): string {
	return path.join(pendingDir(), `${approvalId}.json`);
}

function pendingTmpPath(approvalId: string): string {
	const nonce = crypto.randomBytes(6).toString("hex");
	return path.join(pendingDir(), `.${approvalId}.${nonce}.tmp`);
}

function resolvedFinalPath(approvalId: string): string {
	return path.join(resolvedDir(), `${approvalId}.json`);
}

function resolvedTmpPath(approvalId: string): string {
	const nonce = crypto.randomBytes(6).toString("hex");
	return path.join(resolvedDir(), `.${approvalId}.${nonce}.tmp`);
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
 * The atomic claim point is `fs.unlink(pendingPath)`. Exactly one caller
 * observes the unlink succeed; that caller then writes the resolved
 * envelope contention-free. Concurrent callers observing `ENOENT` on
 * unlink classify the outcome via the presence of a resolved file:
 * present → `already-resolved`, absent → `not-found`.
 *
 * Returns `{ ok: false, reason: "not-found" }` when neither a pending
 * nor a resolved record exists for `approvalId`. Returns
 * `{ ok: false, reason: "already-resolved" }` when a resolved record
 * already exists (either from a prior call or from a concurrent winner).
 *
 * The pending file's contents are NOT inspected. The decision envelope
 * is composed entirely from the caller's arguments — `approvalId`,
 * `decision`, `resolvedBy` — so the unlink + write sequence is
 * sufficient.
 */
export async function resolveApproval(
	approvalId: string,
	decision: "allow" | "deny",
	resolvedBy: string,
): Promise<ResolveApprovalResult> {
	const pendingPath = pendingFinalPath(approvalId);
	const resolvedPath = resolvedFinalPath(approvalId);

	try {
		await fsp.unlink(pendingPath);
	} catch (err) {
		const code = getErrnoCode(err);
		// EPERM/EBUSY surface on Windows when a concurrent caller is mid-
		// unlink of the same path; treat them as race-loser signals
		// alongside ENOENT.
		if (code === "ENOENT" || code === "EPERM" || code === "EBUSY") {
			const existed = await pathExists(resolvedPath);
			if (existed) {
				return { ok: false, reason: "already-resolved" };
			}
			// Race window: the winner has unlinked pending but not yet
			// written resolved. Brief poll for the resolved file before
			// classifying as not-found.
			for (let i = 0; i < 5; i++) {
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
		throw err;
	}

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
 */
export async function waitForApproval(
	approvalId: string,
	timeoutMs: number,
	pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): Promise<WaitForApprovalResult> {
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
	for (const entry of entries) {
		if (entry.startsWith(".")) continue;
		if (!entry.endsWith(".json")) continue;
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
