import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	clearStopMarker,
	listAllMarkers,
	readStopMarker,
	writeStopMarker,
} from "./markers.js";
import { ensureStateDirsSync, pathFor } from "./state-paths.js";

let tempDir: string;

beforeEach(async () => {
	tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-markers-"));
	process.env.IAGO_DAEMON_STATE_ROOT = tempDir;
	ensureStateDirsSync();
});

afterEach(async () => {
	delete process.env.IAGO_DAEMON_STATE_ROOT;
	vi.restoreAllMocks();
	await fsp.rm(tempDir, { recursive: true, force: true });
});

describe("markers", () => {
	it("writes a marker and reads it back round-trip", async () => {
		await writeStopMarker("h-1", "graceful");
		const marker = await readStopMarker("h-1");
		expect(marker).not.toBeNull();
		expect(marker?.reason).toBe("graceful");
		expect(typeof marker?.at).toBe("number");
		expect(marker?.pid).toBe(process.pid);
	});

	it("readStopMarker returns null for missing handle", async () => {
		const marker = await readStopMarker("does-not-exist");
		expect(marker).toBeNull();
	});

	it("clearStopMarker deletes an existing marker", async () => {
		await writeStopMarker("h-clear", "crash");
		expect(await readStopMarker("h-clear")).not.toBeNull();
		await clearStopMarker("h-clear");
		expect(await readStopMarker("h-clear")).toBeNull();
	});

	it("clearStopMarker is idempotent on missing marker", async () => {
		await expect(clearStopMarker("missing-id")).resolves.toBeUndefined();
	});

	it("listAllMarkers returns every written marker (ignoring HWM siblings)", async () => {
		await writeStopMarker("alpha", "graceful");
		await writeStopMarker("beta", "crash");
		await writeStopMarker("gamma", "recycle");
		// Drop an unrelated HWM-shaped file in the markers directory —
		// listAllMarkers must ignore it.
		await fsp.writeFile(
			path.join(pathFor("markers"), "delta.hwm.json"),
			JSON.stringify({ byteOffset: 0, sequence: 0 }),
		);

		const all = await listAllMarkers();
		const ids = all.map((m) => m.handleId).sort();
		expect(ids).toEqual(["alpha", "beta", "gamma"]);

		const byId = new Map(all.map((m) => [m.handleId, m.marker.reason]));
		expect(byId.get("alpha")).toBe("graceful");
		expect(byId.get("beta")).toBe("crash");
		expect(byId.get("gamma")).toBe("recycle");
	});

	it("corrupted marker JSON returns null with a stderr warning", async () => {
		const corruptPath = path.join(pathFor("markers"), "broken.daemon-stop");
		await fsp.writeFile(corruptPath, "{ not valid json");
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await readStopMarker("broken");

		expect(result).toBeNull();
		expect(errSpy).toHaveBeenCalled();
	});
});
