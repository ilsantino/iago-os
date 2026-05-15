/**
 * Session log: append-only NDJSON event log per agent handle, plus the
 * two-phase replay primitive (pause intake → replay up to HWM →
 * resume) that Plan 03 (`agent-manager.bootRecovery`) drives at
 * daemon boot.
 *
 * Plan 02 contract notes:
 *
 * - **Append durability:** every `appendEvent` writes the line, calls
 *   `fdatasync` (data only — faster than `fsync`'s metadata+data),
 *   then resolves. The returned `byteOffset` is durable; callers MAY
 *   immediately persist it as the new HWM.
 * - **`byteOffset` semantics:** the value returned by `appendEvent` is
 *   the file size AFTER the write — i.e., the exclusive end offset of
 *   the line just written. `readEventsUpToHWM` replays every complete
 *   line whose cumulative end offset is `<= hwm.byteOffset`.
 * - **`.seq` recovery:** if `<handleId>.seq` is missing (e.g., crash
 *   between log-write and seq-write), the sequence is recovered by
 *   counting non-empty lines in `<handleId>.jsonl` — NOT reset to 0.
 * - **Buffer drain contract on pause:** when `ReplayController`
 *   pauses intake, concurrent `appendEvent` calls do NOT reject —
 *   they queue. Each caller's promise resolves only after the event
 *   is durably written, which happens during `resumeIntake`'s in-
 *   order drain. Callers can `await appendEvent` regardless of pause
 *   state.
 * - **HWM atomicity:** `setHWM` writes to `<handleId>.hwm.tmp` then
 *   `atomicRename`s to `<handleId>.hwm.json`. A crash between tmp
 *   write and rename leaves the marker absent; `getHWM` returns
 *   `null` and replay starts from the beginning of the log
 *   (idempotent if events are).
 * - **Malformed lines:** `readEventsUpToHWM` skips lines whose JSON
 *   parse fails, logging a warning to `console.error`. Sequence
 *   numbering still increments per line position — sequence is the
 *   line ordinal, not the yield ordinal.
 * - **Disk-full / truncated trailing fragment:** if the final segment
 *   of the file lacks a trailing newline, replay treats it as
 *   truncated and stops. The complete prefix is replayed.
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";

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

function getPauseState(handleId: string): PauseState {
	let state = pauseStates.get(handleId);
	if (state === undefined) {
		state = { paused: false, queue: [] };
		pauseStates.set(handleId, state);
	}
	return state;
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

	// .seq absent or unreadable — recover by counting lines in the log.
	let lineCount = 0;
	try {
		const raw = await fsp.readFile(logPathOf(handleId), "utf8");
		for (const line of raw.split("\n")) {
			if (line.length > 0) lineCount++;
		}
	} catch (err) {
		if (getErrnoCode(err) !== "ENOENT") throw err;
	}
	sequenceCache.set(handleId, lineCount);
	return lineCount;
}

async function persistSequence(handleId: string, seq: number): Promise<void> {
	// No fdatasync: .seq is a performance cache, not authoritative. Crash
	// recovery counts lines in .jsonl (which IS fsynced). See readSequence().
	await fsp.writeFile(seqPathOf(handleId), String(seq));
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
		const line = `${JSON.stringify(event)}\n`;
		const handle = await fsp.open(logPathOf(handleId), "a");
		try {
			await handle.writeFile(line);
			await handle.datasync();
		} finally {
			await handle.close();
		}
		const stat = await fsp.stat(logPathOf(handleId));
		sequenceCache.set(handleId, nextSeq);
		await persistSequence(handleId, nextSeq);
		return { byteOffset: stat.size, sequence: nextSeq };
	});
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
	return performAppend(handleId, event);
}

export async function* readEventsUpToHWM(
	handleId: string,
	hwm: { byteOffset: number; sequence: number },
): AsyncIterable<{ event: unknown; sequence: number }> {
	assertSafeIdentifier(handleId, "handleId");
	const filePath = logPathOf(handleId);
	// TODO Phase 3: stream instead of readFile for large logs; unbounded
	// sessions produce O(n) memory spikes at replay time.
	let raw: string;
	try {
		raw = await fsp.readFile(filePath, "utf8");
	} catch (err) {
		if (getErrnoCode(err) === "ENOENT") return;
		throw err;
	}

	let cumulativeBytes = 0;
	let seq = 0;
	let position = 0;

	while (position < raw.length) {
		const newlineIdx = raw.indexOf("\n", position);
		if (newlineIdx === -1) {
			// Trailing fragment without newline — treat as truncated, stop.
			break;
		}
		const line = raw.slice(position, newlineIdx);
		const lineBytes = Buffer.byteLength(line, "utf8") + 1;
		cumulativeBytes += lineBytes;
		position = newlineIdx + 1;

		if (line.length === 0) continue;

		seq++;
		if (cumulativeBytes > hwm.byteOffset) break;
		if (seq > hwm.sequence) break;

		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			console.error(
				`[session-log] skipping malformed line ${seq} in ${filePath}`,
			);
			continue;
		}
		yield { event, sequence: seq };
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
 * Per-handle pause / replay coordination.
 *
 * Class allowed here as a Plan 02 explicit carve-out (the codebase is
 * functional-by-default) — the close coupling between `pauseIntake`,
 * `replay`, and `resumeIntake` plus the per-handle state are cleanest
 * as a class. The pause flag and queue live in module scope (shared
 * with `appendEvent`); the class is a thin coordinator.
 *
 * Lifecycle:
 *   1. `pauseIntake()` — flips the pause flag. Subsequent
 *      `appendEvent` calls queue.
 *   2. `replay(cb)` — iterates events up to the persisted HWM, calling
 *      `cb` for each. Caller can rebuild in-memory state from the log.
 *   3. `resumeIntake()` — clears the flag and drains the queue in
 *      arrival order. Each queued caller's `appendEvent` promise
 *      resolves with its actual byte-offset + sequence after the
 *      durable write.
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
		// Pass 1: drain initial backlog while still paused so concurrent
		// appendEvent callers queue up rather than interleave with drain items.
		const drained = state.queue.splice(0);
		for (const item of drained) {
			try {
				const result = await performAppend(this.handleId, item.event);
				item.resolve(result);
			} catch (err) {
				item.reject(err);
			}
		}
		// Unpause before pass 2: new callers go direct from here onward.
		state.paused = false;
		// Pass 2: flush items that arrived during pass 1 (finite — new arrivals
		// after paused=false bypass the queue and call performAppend directly).
		const late = state.queue.splice(0);
		for (const item of late) {
			try {
				const result = await performAppend(this.handleId, item.event);
				item.resolve(result);
			} catch (err) {
				item.reject(err);
			}
		}
	}
}

/**
 * Test-only reset of module-scope caches (pause flags, sequence
 * cache, file locks). Underscore prefix marks test infrastructure —
 * do not call from production code paths.
 *
 * TODO Plan 03: move to session-log.internal.ts or a conditional
 * export before bootRecovery integrates, to prevent accidental
 * production calls from wiping in-memory state on a live daemon.
 */
export function _resetSessionLogStateForTests(): void {
	pauseStates.clear();
	sequenceCache.clear();
	fileLocks.clear();
}
