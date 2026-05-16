/**
 * `.daemon-stop` marker files — graceful-vs-crash detection on next boot.
 *
 * Plan 03 contract notes (binding for callers + future maintainers):
 *
 * - **Path:** `pathFor("markers") + "/" + handleId + ".daemon-stop"`.
 *   `pathFor("markers")` is shared with HWM files (`<handleId>.hwm.json`).
 *   `listAllMarkers` filters strictly on the `.daemon-stop` suffix so HWM
 *   files are ignored.
 * - **Write order convention (agent-manager):** write the marker BEFORE
 *   calling `runtime.shutdown`. Absent marker on next boot → previous
 *   shutdown crashed (not graceful).
 * - **Reasons:**
 *   - `graceful` — daemon stopped intentionally; do NOT re-spawn on next boot.
 *   - `crash`   — daemon detected the agent crashed (heartbeat-triggered force-kill
 *                 fallback path); attempt session.jsonl replay on next boot.
 *   - `recycle` — voluntary restart from heartbeat (RSS-exceeded or stalled).
 *                 Re-spawn cleanly, no replay.
 * - **JSON shape:** `{ reason, at: epoch-ms, pid: process.pid }`. Corrupted
 *   files return null with a stderr warning — boot recovery treats this
 *   as absent (crash).
 * - **Idempotent clear:** `clearStopMarker` swallows ENOENT.
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";

import { assertSafeIdentifier, getErrnoCode, pathFor } from "./state-paths.js";

export type StopMarkerReason = "graceful" | "crash" | "recycle";

export interface StopMarker {
	readonly reason: StopMarkerReason;
	readonly at: number;
	readonly pid: number;
}

const MARKER_SUFFIX = ".daemon-stop";

function markerPathOf(handleId: string): string {
	return path.join(pathFor("markers"), `${handleId}${MARKER_SUFFIX}`);
}

function isStopMarkerReason(value: unknown): value is StopMarkerReason {
	return value === "graceful" || value === "crash" || value === "recycle";
}

export async function writeStopMarker(
	handleId: string,
	reason: StopMarkerReason,
): Promise<void> {
	assertSafeIdentifier(handleId, "handleId");
	const marker: StopMarker = {
		reason,
		at: Date.now(),
		pid: process.pid,
	};
	const handle = await fsp.open(markerPathOf(handleId), "w");
	try {
		await handle.writeFile(JSON.stringify(marker));
		await handle.datasync();
	} finally {
		await handle.close();
	}
}

export async function readStopMarker(
	handleId: string,
): Promise<StopMarker | null> {
	assertSafeIdentifier(handleId, "handleId");
	let raw: string;
	try {
		raw = await fsp.readFile(markerPathOf(handleId), "utf8");
	} catch (err) {
		if (getErrnoCode(err) === "ENOENT") return null;
		throw err;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		console.error(
			`[markers] corrupted .daemon-stop for ${handleId} — treating as absent`,
		);
		return null;
	}
	if (
		typeof parsed === "object" &&
		parsed !== null &&
		isStopMarkerReason((parsed as { reason?: unknown }).reason) &&
		typeof (parsed as { at?: unknown }).at === "number" &&
		typeof (parsed as { pid?: unknown }).pid === "number"
	) {
		const o = parsed as { reason: StopMarkerReason; at: number; pid: number };
		return { reason: o.reason, at: o.at, pid: o.pid };
	}
	console.error(
		`[markers] malformed .daemon-stop for ${handleId} — treating as absent`,
	);
	return null;
}

export async function clearStopMarker(handleId: string): Promise<void> {
	assertSafeIdentifier(handleId, "handleId");
	try {
		await fsp.unlink(markerPathOf(handleId));
	} catch (err) {
		if (getErrnoCode(err) === "ENOENT") return;
		throw err;
	}
}

export async function listAllMarkers(): Promise<
	Array<{ handleId: string; marker: StopMarker }>
> {
	const dir = pathFor("markers");
	let entries: string[];
	try {
		entries = await fsp.readdir(dir);
	} catch (err) {
		if (getErrnoCode(err) === "ENOENT") return [];
		throw err;
	}

	const out: Array<{ handleId: string; marker: StopMarker }> = [];
	for (const entry of entries) {
		if (!entry.endsWith(MARKER_SUFFIX)) continue;
		const handleId = entry.slice(0, entry.length - MARKER_SUFFIX.length);
		if (handleId.length === 0) continue;
		const marker = await readStopMarker(handleId);
		if (marker !== null) {
			out.push({ handleId, marker });
		}
	}
	return out;
}
