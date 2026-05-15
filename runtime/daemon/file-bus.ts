/**
 * File-bus: O_EXCL claim files + atomic resolved-output writes with
 * owner-ID validation.
 *
 * Plan 02 contract notes (binding for callers and future maintainers):
 *
 * - **TaskId uniqueness:** TaskIds MUST be globally unique within the
 *   file-bus. Callers SHOULD use `crypto.randomUUID()` or equivalent
 *   128-bit random IDs. Structured human-readable taskIds are permitted
 *   only if the caller guarantees global uniqueness; collisions surface
 *   as `already-claimed` rejections and may strand the second caller's
 *   task.
 * - **TaskId opacity:** taskId is opaque to the file-bus and MAY contain
 *   `__` (the Telegram → agent tagging convention writes filenames as
 *   `<agentId>__<uuid>.json`; the file-bus treats the whole string as
 *   the taskId). The file-bus NEVER splits on `__`.
 * - **Scale migration trigger:** Phase 1 + Phase 2 layout is
 *   `tasks/{pending,claimed,resolved}/<agentId>__<taskId>.json` (flat).
 *   Migrate to per-agent subdirectory layout
 *   `tasks/pending/<agentId>/<taskId>.json` when any single agent's
 *   pending queue exceeds 200 files OR per-agent poll latency exceeds
 *   100ms. Migration is an explicit Phase 6+ task, NOT automatic.
 * - **`fs.promises.open(..., "wx")` is O_EXCL-safe:** maps to
 *   `O_CREAT|O_EXCL` on POSIX and `CREATE_NEW` on Windows; both atomic
 *   at the syscall level. Future maintainers MUST NOT substitute a
 *   non-exclusive primitive (e.g., writeFile + flag check) — the race
 *   window between the check and the write is the exact bug O_EXCL
 *   prevents.
 * - **Owner-ID + attempt-ID embedded in resolved file:** readers MUST
 *   validate owner-ID matches the original claim before consuming a
 *   resolved output, to reject zombie writes from a force-killed-and-
 *   restarted agent.
 * - **Claim durability:** the claim file is written via
 *   `fs.promises.open("wx") → write → fdatasync → close` so the claim
 *   survives crash-after-write (M1). Orphan recovery is the
 *   agent-manager's `bootRecovery` (Plan 03) invoking
 *   `reclaimIfStale(taskId, maxAgeMs)`.
 * - **Atomic resolved publish via tmp→rename:** every resolved-output
 *   write goes through `atomicRename` from state-paths.ts, which
 *   handles the Windows EEXIST case (E2).
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";

import {
	assertSafeIdentifier,
	atomicRename,
	getErrnoCode,
	pathFor,
} from "./state-paths.js";

interface ClaimFileContents {
	readonly ownerId: string;
	readonly attemptId: string;
	readonly claimedAt: number;
}

interface ResolvedFileContents {
	readonly taskId: string;
	readonly ownerId: string;
	readonly attemptId: string;
	readonly result: unknown;
	readonly completedAt: number;
}

export interface ClaimSucceeded {
	readonly claimed: true;
	readonly claimPath: string;
	readonly ownerId: string;
	readonly attemptId: string;
}

export interface ClaimFailed {
	readonly claimed: false;
	readonly reason: "already-claimed";
	readonly existingOwnerId?: string;
}

export type ClaimResult = ClaimSucceeded | ClaimFailed;

export interface WriteResolvedOk {
	readonly ok: true;
	readonly finalPath: string;
}

export interface WriteResolvedOwnerMismatch {
	readonly ok: false;
	readonly reason: "owner-mismatch";
	readonly expectedOwnerId: string;
}

export interface WriteResolvedNoClaim {
	readonly ok: false;
	readonly reason: "no-claim";
}

export type WriteResolvedResult =
	| WriteResolvedOk
	| WriteResolvedOwnerMismatch
	| WriteResolvedNoClaim;

function claimPathOf(taskId: string): string {
	return path.join(pathFor("tasks/claimed"), `${taskId}.claim.json`);
}

function pendingPathOf(taskId: string): string {
	return path.join(pathFor("tasks/pending"), `${taskId}.json`);
}

function claimedTaskPathOf(taskId: string): string {
	return path.join(pathFor("tasks/claimed"), `${taskId}.json`);
}

function resolvedPathOf(taskId: string): string {
	return path.join(pathFor("tasks/resolved"), `${taskId}.json`);
}

function resolvedTmpPathOf(taskId: string): string {
	return path.join(pathFor("tasks/resolved"), `.${taskId}.tmp`);
}

async function writeClaimDurably(
	claimPath: string,
	contents: ClaimFileContents,
): Promise<void> {
	const handle = await fsp.open(claimPath, "wx");
	try {
		await handle.writeFile(JSON.stringify(contents));
		await handle.datasync();
	} finally {
		await handle.close();
	}
}

async function readClaimFile(
	claimPath: string,
): Promise<ClaimFileContents | null> {
	let raw: string;
	try {
		raw = await fsp.readFile(claimPath, "utf8");
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
	if (
		typeof parsed === "object" &&
		parsed !== null &&
		typeof (parsed as { ownerId?: unknown }).ownerId === "string" &&
		typeof (parsed as { attemptId?: unknown }).attemptId === "string" &&
		typeof (parsed as { claimedAt?: unknown }).claimedAt === "number"
	) {
		const o = parsed as {
			ownerId: string;
			attemptId: string;
			claimedAt: number;
		};
		return {
			ownerId: o.ownerId,
			attemptId: o.attemptId,
			claimedAt: o.claimedAt,
		};
	}
	return null;
}

/**
 * Claim a task by exclusively creating `<taskId>.claim.json` (O_EXCL),
 * then renaming the task envelope from `tasks/pending/` to
 * `tasks/claimed/`. The two-step sequence guarantees that a successful
 * `claimed: true` result implies BOTH (a) the caller owns the claim
 * lock and (b) the task envelope has moved out of pending. If the
 * second step fails (task already moved by another claimant), the
 * claim file is removed and the call returns `already-claimed`.
 */
export async function claimTask(opts: {
	readonly taskId: string;
	readonly ownerId: string;
	readonly attemptId: string;
}): Promise<ClaimResult> {
	const { taskId, ownerId, attemptId } = opts;
	assertSafeIdentifier(taskId, "taskId");
	assertSafeIdentifier(ownerId, "ownerId");
	assertSafeIdentifier(attemptId, "attemptId");
	const claimPath = claimPathOf(taskId);
	const claimContents: ClaimFileContents = {
		ownerId,
		attemptId,
		claimedAt: Date.now(),
	};

	try {
		await writeClaimDurably(claimPath, claimContents);
	} catch (err) {
		if (getErrnoCode(err) === "EEXIST") {
			const existing = await readClaimFile(claimPath);
			if (existing !== null) {
				return {
					claimed: false,
					reason: "already-claimed",
					existingOwnerId: existing.ownerId,
				};
			}
			return { claimed: false, reason: "already-claimed" };
		}
		throw err;
	}

	try {
		await fsp.rename(pendingPathOf(taskId), claimedTaskPathOf(taskId));
	} catch (err) {
		const code = getErrnoCode(err);
		if (code === "ENOENT" || code === "EEXIST") {
			// ENOENT: pending envelope already moved (race).
			// EEXIST: crash-recovery — claimed envelope already present (Windows).
			try {
				await fsp.unlink(claimPath);
			} catch {
				// Best-effort claim teardown; surface the original race outcome.
			}
			return { claimed: false, reason: "already-claimed" };
		}
		throw err;
	}

	return { claimed: true, claimPath, ownerId, attemptId };
}

export async function readClaim(taskId: string): Promise<{
	ownerId: string;
	attemptId: string;
	claimedAt: number;
} | null> {
	assertSafeIdentifier(taskId, "taskId");
	return readClaimFile(claimPathOf(taskId));
}

/**
 * Atomically publish a resolved output for `taskId`.
 *
 * Owner-ID + attempt-ID are embedded in the resolved file; readers
 * MUST validate owner-ID matches the original claim before consuming.
 * This rejects zombie writes from a force-killed-and-restarted agent.
 *
 * Steps: read claim → validate owner-ID → write tmp + datasync →
 * atomicRename(tmp, final). The tmp+rename pattern guarantees either
 * a fully-published output or no output at all (modulo the Windows
 * unlink+rename race documented on `atomicRename`).
 */
export async function writeResolvedOutput(opts: {
	readonly taskId: string;
	readonly ownerId: string;
	readonly attemptId: string;
	readonly result: unknown;
}): Promise<WriteResolvedResult> {
	const { taskId, ownerId, attemptId, result } = opts;
	assertSafeIdentifier(taskId, "taskId");
	const claim = await readClaimFile(claimPathOf(taskId));
	if (claim === null) {
		return { ok: false, reason: "no-claim" };
	}
	if (claim.ownerId !== ownerId) {
		return {
			ok: false,
			reason: "owner-mismatch",
			expectedOwnerId: claim.ownerId,
		};
	}

	const tmpPath = resolvedTmpPathOf(taskId);
	const finalPath = resolvedPathOf(taskId);
	const envelope: ResolvedFileContents = {
		taskId,
		ownerId,
		attemptId,
		result,
		completedAt: Date.now(),
	};

	const handle = await fsp.open(tmpPath, "w");
	try {
		await handle.writeFile(JSON.stringify(envelope));
		await handle.datasync();
	} finally {
		await handle.close();
	}
	try {
		await atomicRename(tmpPath, finalPath);
	} catch (err) {
		await fsp.unlink(tmpPath).catch(() => undefined);
		throw err;
	}

	return { ok: true, finalPath };
}

export async function readResolvedOutput(taskId: string): Promise<{
	ownerId: string;
	attemptId: string;
	result: unknown;
	completedAt: number;
} | null> {
	assertSafeIdentifier(taskId, "taskId");
	let raw: string;
	try {
		raw = await fsp.readFile(resolvedPathOf(taskId), "utf8");
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
	if (
		typeof parsed === "object" &&
		parsed !== null &&
		typeof (parsed as { ownerId?: unknown }).ownerId === "string" &&
		typeof (parsed as { attemptId?: unknown }).attemptId === "string" &&
		typeof (parsed as { completedAt?: unknown }).completedAt === "number"
	) {
		const o = parsed as {
			ownerId: string;
			attemptId: string;
			result: unknown;
			completedAt: number;
		};
		return {
			ownerId: o.ownerId,
			attemptId: o.attemptId,
			result: o.result,
			completedAt: o.completedAt,
		};
	}
	return null;
}

/**
 * Remove a stale `<taskId>.claim.json` file. Returns true if the claim
 * was older than `maxAgeMs` and was unlinked; false if no claim exists
 * or it is still within the freshness window.
 *
 * **Partial recovery primitive.** This helper unlinks ONLY the
 * `.claim.json` lock — the task envelope (`<taskId>.json`) remains in
 * `tasks/claimed/`. A subsequent `claimTask` against the same taskId
 * will write a fresh claim successfully, but the
 * `pending → claimed` rename in `claimTask` will hit `ENOENT` and
 * return `already-claimed`. Full orphan recovery (renaming the
 * envelope `claimed → pending` so it can be re-claimed) is the
 * agent-manager's `bootRecovery` responsibility in Plan 03. Use this
 * function as the lock-release half of that two-step recovery, not as
 * a standalone "retry me" primitive.
 *
 * Recommended `maxAgeMs` for Phase 1: 6 hours
 * (`6 * 60 * 60 * 1000`) — adjust based on max expected pipeline
 * runtime. See Plan 02 stress-test E1.
 */
export async function reclaimIfStale(
	taskId: string,
	maxAgeMs: number,
): Promise<boolean> {
	assertSafeIdentifier(taskId, "taskId");
	const claimPath = claimPathOf(taskId);
	const claim = await readClaimFile(claimPath);
	if (claim === null) return false;
	const age = Date.now() - claim.claimedAt;
	if (age < maxAgeMs) return false;
	try {
		await fsp.unlink(claimPath);
		return true;
	} catch (err) {
		if (getErrnoCode(err) === "ENOENT") return false;
		throw err;
	}
}
