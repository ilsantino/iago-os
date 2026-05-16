/**
 * Session log: append-only NDJSON event log per agent handle, plus the
 * two-phase replay primitive (pause intake → replay up to HWM →
 * resume) that Plan 03 (`agent-manager.bootRecovery`) drives at
 * daemon boot.
 *
 * Plan 02 contract notes:
 *
 * - **Append durability:** every `appendEvent` reserves the sequence
 *   number FIRST (writing `<handleId>.seq` via open+writeFile+datasync),
 *   then writes the log line and calls `fdatasync`. If the process
 *   crashes between the seq reservation and the log write, recovery
 *   sees a seq one ahead of the log — a sequence GAP on next append
 *   (safe — gaps are detectable; duplicates would be unrecoverable
 *   corruption).
 * - **`byteOffset` semantics:** the value returned by `appendEvent` is
 *   the file size AFTER the write — i.e., the exclusive end offset of
 *   the line just written. `readEventsUpToHWM` replays every complete
 *   line whose cumulative end offset is `<= hwm.byteOffset`.
 * - **`.seq` recovery:** if `<handleId>.seq` is missing (e.g., crash
 *   before the very first seq write), the sequence is recovered by
 *   counting successfully-parsed lines in `<handleId>.jsonl` — NOT
 *   line-position. Malformed lines do not advance the counter; this
 *   matches the semantics of `readEventsUpToHWM` after the C2 fix.
 * - **Buffer drain contract on pause:** when `ReplayController`
 *   pauses intake, concurrent `appendEvent` calls do NOT reject —
 *   they queue. Each caller's promise resolves only after the event
 *   is durably written, which happens during `resumeIntake`'s in-
 *   order drain. Callers can `await appendEvent` regardless of pause
 *   state.
 * - **`pauseIntake` drains in-flight appends.** After `pauseIntake`
 *   resolves, NO new lines will land in the log file (callers' promises
 *   queue until `resumeIntake` drains them). Pre-pause in-flight
 *   `performAppend` calls already past the queue check are awaited
 *   via a file-lock barrier before pauseIntake returns.
 * - **`resumeIntake` drains atomically.** The pause flag stays `true`
 *   until the drain queue is empty, then flips. New arrivals that race
 *   the flag-flip either queue (and get drained in a follow-up loop)
 *   or proceed direct — order is preserved for any pre-flag-flip
 *   arrivals.
 * - **HWM atomicity:** `setHWM` writes to `<handleId>.hwm.tmp` then
 *   `atomicRename`s to `<handleId>.hwm.json`. A crash between tmp
 *   write and rename leaves the marker absent; `getHWM` returns
 *   `null` and replay starts from the beginning of the log
 *   (idempotent if events are).
 * - **Malformed lines:** `readEventsUpToHWM` skips lines whose JSON
 *   parse fails, logging a warning to `console.error`. Sequence is
 *   incremented ONLY on successful parse — this matches `appendEvent`
 *   allocation semantics (per-success monotonic). Hand-edited /
 *   crash-truncated middle lines do not silently shift the replay
 *   sequence numbering.
 * - **Disk-full / truncated trailing fragment:** if the final segment
 *   of the file lacks a trailing newline, replay treats it as
 *   truncated and stops. The complete prefix is replayed.
 * - **Streaming reader (I1 fix):** `readEventsUpToHWM` uses
 *   `readline` over a `createReadStream` so a multi-GB log file does
 *   not OOM at replay time. Rotation policy remains a Phase 1+
 *   follow-up.
 * - **Module state is per-process.** `pauseStates`, `sequenceCache`,
 *   `fileLocks` are module-scope Maps. Multi-process callers MUST
 *   coordinate externally (file-bus locks or a higher-level
 *   coordinator) — Plan 07 IPC server must own a single session-log
 *   writer per handle.
 * - **Shutdown.** Call `cancelPendingAppends(handleId, reason)` during
 *   graceful shutdown to reject any queued `appendEvent` promises.
 *   Without this, callers hang forever waiting on a drain that will
 *   never happen.
 */

import { createReadStream } from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";

import {
	assertSafeIdentifier,
	atomicRename,
	getErrnoCode,
	pathFor,
} from "./state-paths.js";

interface PauseState {
	paused: boolean;
	queue: Array<QueuedAppend>;
}

interface QueuedAppend {
	readonly event: unknown;
	readonly resolve: (r: { byteOffset: number; sequence: number }) => void;
	readonly reject: (e: unknown) => void;
}

const pauseStates = new Map<string, PauseState>();
const sequenceCache = new Map<string, number>();
const fileLocks = new Map<string, Promise<unknown>>();
// Tracks in-flight performAppend completions per handle. pauseIntake awaits
// every promise here before resolving, so the post-pauseIntake file state is
// stable — no late writes appear after the controller surface "paused".
const inflightAppends = new Map<string, Set<Promise<unknown>>>();

function getPauseState(handleId: string): PauseState {
	let state = pauseStates.get(handleId);
	if (state === undefined) {
		state = { paused: false, queue: [] };
		pauseStates.set(handleId, state);
	}
	return state;
}

function getInflightSet(handleId: string): Set<Promise<unknown>> {
	let set = inflightAppends.get(handleId);
	if (set === undefined) {
		set = new Set();
		inflightAppends.set(handleId, set);
	}
	return set;
}

function logPathOf(handleId: string): string {
	return path.join(pathFor("session-logs"), `${handleId}.jsonl`);
}

function seqPathOf(handleId: string): string {
	return path.join(pathFor("session-logs"), `${handleId}.seq`);
}

function hwmPathOf(handleId: string): string {
	return path.join(pathFor("markers"), `${handleId}.hwm.json`);
}

function hwmTmpPathOf(handleId: string): string {
	return path.join(pathFor("markers"), `.${handleId}.hwm.tmp`);
}

async function countParsedLinesInLog(handleId: string): Promise<number> {
	const filePath = logPathOf(handleId);
	let parsedCount = 0;
	let stream: ReturnType<typeof createReadStream> | undefined;
	try {
		stream = createReadStream(filePath, { encoding: "utf8" });
	} catch (err) {
		if (getErrnoCode(err) === "ENOENT") return 0;
		throw err;
	}
	const rl = readline.createInterface({
		input: stream,
		crlfDelay: Number.POSITIVE_INFINITY,
	});
	try {
		for await (const line of rl) {
			if (line.length === 0) continue;
			try {
				JSON.parse(line);
				parsedCount++;
			} catch {
				// Skip malformed lines — matches readEventsUpToHWM seq semantics.
			}
		}
	} catch (err) {
		if (getErrnoCode(err) !== "ENOENT") throw err;
	} finally {
		rl.close();
	}
	return parsedCount;
}

async function loadSequence(handleId: string): Promise<number> {
	const cached = sequenceCache.get(handleId);
	if (cached !== undefined) return cached;

	try {
		const raw = await fsp.readFile(seqPathOf(handleId), "utf8");
		const parsed = Number.parseInt(raw.trim(), 10);
		if (Number.isFinite(parsed) && parsed >= 0) {
			sequenceCache.set(handleId, parsed);
			return parsed;
		}
	} catch (err) {
		if (getErrnoCode(err) !== "ENOENT") throw err;
	}

	// .seq absent or unreadable — recover by counting SUCCESSFULLY-PARSED lines
	// in the log. This matches readEventsUpToHWM's per-success increment
	// semantics so post-recovery sequences never collide with replay-yielded
	// sequences (the C2 invariant).
	const parsedCount = await countParsedLinesInLog(handleId);
	sequenceCache.set(handleId, parsedCount);
	return parsedCount;
}

async function persistSequence(handleId: string, seq: number): Promise<void> {
	// .seq must be durable BEFORE the log write so a crash between the two
	// produces a SEQUENCE GAP (safe — detectable on next read) rather than a
	// DUPLICATE (corruption — two events share a seq). datasync + close
	// guarantees the value is on disk before performAppend returns.
	const handle = await fsp.open(seqPathOf(handleId), "w");
	try {
		await handle.writeFile(String(seq));
		await handle.datasync();
	} finally {
		await handle.close();
	}
}

async function withFileLock<T>(
	handleId: string,
	fn: () => Promise<T>,
): Promise<T> {
	const prev = fileLocks.get(handleId) ?? Promise.resolve();
	let releaseLock!: () => void;
	const myLock = new Promise<void>((resolve) => {
		releaseLock = resolve;
	});
	fileLocks.set(
		handleId,
		prev.then(() => myLock).catch(() => undefined),
	);
	try {
		await prev;
	} catch {
		// Previous holder rejected — claim the lock anyway.
	}
	try {
		return await fn();
	} finally {
		releaseLock();
	}
}

async function performAppend(
	handleId: string,
	event: unknown,
): Promise<{ byteOffset: number; sequence: number }> {
	return withFileLock(handleId, async () => {
		const currentSeq = await loadSequence(handleId);
		const nextSeq = currentSeq + 1;
		// C5 fix: reserve the sequence durably BEFORE the log write. If we
		// crashed between log write and persistSequence (old ordering), recovery
		// would re-issue nextSeq → duplicate keys in the log. With this
		// ordering, a crash between persistSequence and log-write produces a
		// missing seq on disk but no duplicate — gap is recoverable, duplicate
		// is not.
		await persistSequence(handleId, nextSeq);
		sequenceCache.set(handleId, nextSeq);
		const line = `${JSON.stringify(event)}\n`;
		const handle = await fsp.open(logPathOf(handleId), "a");
		try {
			await handle.writeFile(line);
			await handle.datasync();
		} finally {
			await handle.close();
		}
		const stat = await fsp.stat(logPathOf(handleId));
		return { byteOffset: stat.size, sequence: nextSeq };
	});
}

// Wraps performAppend with in-flight tracking so pauseIntake can await
// completion of any append that already passed the paused-check.
function trackedPerformAppend(
	handleId: string,
	event: unknown,
): Promise<{ byteOffset: number; sequence: number }> {
	const inflight = getInflightSet(handleId);
	const p = performAppend(handleId, event);
	inflight.add(p);
	// Use .finally to remove the tracking entry whether the append resolved or
	// rejected. The promise the caller awaits is `p` itself (not the .finally
	// chain), so caller-visible behavior is unchanged.
	void p.finally(() => {
		inflight.delete(p);
	});
	return p;
}

export async function appendEvent(
	handleId: string,
	event: unknown,
): Promise<{ byteOffset: number; sequence: number }> {
	assertSafeIdentifier(handleId, "handleId");
	const state = getPauseState(handleId);
	if (state.paused) {
		return new Promise((resolve, reject) => {
			state.queue.push({ event, resolve, reject });
		});
	}
	return trackedPerformAppend(handleId, event);
}

export async function* readEventsUpToHWM(
	handleId: string,
	hwm: { byteOffset: number; sequence: number },
): AsyncIterable<{ event: unknown; sequence: number }> {
	assertSafeIdentifier(handleId, "handleId");
	const filePath = logPathOf(handleId);
	// I1 fix: stream via createReadStream + readline. Bounded memory regardless
	// of log size. Each line's byte length is computed from utf8 encoding plus
	// the trailing newline; we stop the moment cumulativeBytes exceeds the HWM
	// byteOffset OR the post-increment seq exceeds the HWM sequence.
	let stream: ReturnType<typeof createReadStream>;
	try {
		stream = createReadStream(filePath, { encoding: "utf8" });
	} catch (err) {
		if (getErrnoCode(err) === "ENOENT") return;
		throw err;
	}
	const rl = readline.createInterface({
		input: stream,
		crlfDelay: Number.POSITIVE_INFINITY,
	});

	let cumulativeBytes = 0;
	let seq = 0;
	try {
		for await (const line of rl) {
			const lineBytes = Buffer.byteLength(line, "utf8") + 1;
			cumulativeBytes += lineBytes;
			if (line.length === 0) continue;
			if (cumulativeBytes > hwm.byteOffset) break;

			let event: unknown;
			try {
				event = JSON.parse(line);
			} catch {
				// C2 fix: malformed lines do NOT advance the seq counter. This
				// matches performAppend's per-success allocation semantics; a
				// hand-edited malformed line cannot silently shift later
				// sequences off the HWM truncation point.
				console.error(
					`[session-log] skipping malformed line at byte ${cumulativeBytes} in ${filePath}`,
				);
				continue;
			}
			seq++;
			if (seq > hwm.sequence) break;
			yield { event, sequence: seq };
		}
	} catch (err) {
		if (getErrnoCode(err) !== "ENOENT") throw err;
	} finally {
		rl.close();
		stream.destroy();
	}
}

export async function getHWM(
	handleId: string,
): Promise<{ byteOffset: number; sequence: number } | null> {
	assertSafeIdentifier(handleId, "handleId");
	let raw: string;
	try {
		raw = await fsp.readFile(hwmPathOf(handleId), "utf8");
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
		typeof (parsed as { byteOffset?: unknown }).byteOffset === "number" &&
		typeof (parsed as { sequence?: unknown }).sequence === "number"
	) {
		const o = parsed as { byteOffset: number; sequence: number };
		return { byteOffset: o.byteOffset, sequence: o.sequence };
	}
	return null;
}

export async function setHWM(
	handleId: string,
	hwm: { byteOffset: number; sequence: number },
): Promise<void> {
	assertSafeIdentifier(handleId, "handleId");
	const tmp = hwmTmpPathOf(handleId);
	const final = hwmPathOf(handleId);
	const handle = await fsp.open(tmp, "w");
	try {
		await handle.writeFile(JSON.stringify(hwm));
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
}

/**
 * Cancel every queued append for `handleId` by rejecting their promises
 * with `Error(reason)`. Used during graceful daemon shutdown so callers
 * `await`ing `appendEvent` while paused unblock instead of hanging.
 *
 * Does NOT affect in-flight `performAppend` calls — those are already
 * past the queue and will finish (and durably persist) on their own.
 */
export function cancelPendingAppends(handleId: string, reason: string): void {
	const state = pauseStates.get(handleId);
	if (state === undefined) return;
	const queued = state.queue.splice(0);
	for (const item of queued) {
		item.reject(new Error(`session-log: pending append cancelled (${reason})`));
	}
}

/**
 * Per-handle pause / replay coordination.
 *
 * Class allowed here as a Plan 02 explicit carve-out (the codebase is
 * functional-by-default) — the close coupling between `pauseIntake`,
 * `replay`, and `resumeIntake` plus the per-handle state are cleanest
 * as a class. The pause flag and queue live in module scope (shared
 * with `appendEvent`); the class is a thin coordinator.
 *
 * Lifecycle:
 *   1. `pauseIntake()` — flips the pause flag THEN awaits every
 *      in-flight `performAppend` so the file is quiescent when this
 *      method resolves. Subsequent `appendEvent` calls queue.
 *   2. `replay(cb)` — iterates events up to the persisted HWM, calling
 *      `cb` for each. Caller can rebuild in-memory state from the log.
 *   3. `resumeIntake()` — drains the queue in arrival order under the
 *      pause flag, then flips the flag. A second drain pass catches
 *      anything that queued during the first drain. Each queued
 *      caller's `appendEvent` promise resolves with its actual
 *      byte-offset + sequence after the durable write.
 */
export class ReplayController {
	readonly handleId: string;

	constructor(handleId: string) {
		assertSafeIdentifier(handleId, "handleId");
		this.handleId = handleId;
	}

	async pauseIntake(): Promise<void> {
		const state = getPauseState(this.handleId);
		state.paused = true;
		// C3 fix: drain in-flight performAppend promises before resolving so
		// callers can rely on "no more writes hit the log after pauseIntake
		// returns." Snapshot the set; new entries cannot appear while paused
		// (appendEvent queues instead of calling trackedPerformAppend).
		const inflight = inflightAppends.get(this.handleId);
		if (inflight === undefined || inflight.size === 0) return;
		const snapshot = Array.from(inflight);
		// Settle-not-reject: we don't care WHY each append finished, only that
		// it finished. allSettled also avoids the bad pattern of letting one
		// rejection short-circuit the drain.
		await Promise.allSettled(snapshot);
	}

	async replay(
		cb: (event: unknown, seq: number) => Promise<void>,
	): Promise<void> {
		const hwm = await getHWM(this.handleId);
		if (hwm === null) return;
		for await (const { event, sequence } of readEventsUpToHWM(
			this.handleId,
			hwm,
		)) {
			await cb(event, sequence);
		}
	}

	async resumeIntake(): Promise<void> {
		const state = getPauseState(this.handleId);
		// C4 fix: keep the pause flag TRUE during the drain so any caller that
		// races us still queues (in arrival order) rather than interleaving
		// with drain items. Drain in a loop because new arrivals while paused
		// queue MORE items.
		while (state.queue.length > 0) {
			const drained = state.queue.splice(0);
			for (const item of drained) {
				try {
					const result = await performAppend(this.handleId, item.event);
					item.resolve(result);
				} catch (err) {
					item.reject(err);
				}
			}
		}
		// Queue drained AND empty AND no concurrent paused appendEvent can have
		// scheduled before this microtask (single-threaded JS event loop).
		// Safe to unblock.
		state.paused = false;
	}
}

/**
 * Test-only reset of module-scope caches (pause flags, sequence
 * cache, file locks, in-flight tracker). Underscore prefix marks test
 * infrastructure — do not call from production code paths.
 *
 * Production callers reaching for this likely want
 * `cancelPendingAppends(handleId, reason)` instead.
 */
export function _resetSessionLogStateForTests(): void {
	pauseStates.clear();
	sequenceCache.clear();
	fileLocks.clear();
	inflightAppends.clear();
}
