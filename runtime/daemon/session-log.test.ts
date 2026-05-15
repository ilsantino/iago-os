import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	ReplayController,
	_resetSessionLogStateForTests,
	appendEvent,
	getHWM,
	readEventsUpToHWM,
	setHWM,
} from "./session-log.js";
import { ensureStateDirsSync, pathFor } from "./state-paths.js";

let tempDir: string;

beforeEach(async () => {
	tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-session-log-"));
	process.env.IAGO_DAEMON_STATE_ROOT = tempDir;
	ensureStateDirsSync();
	_resetSessionLogStateForTests();
});

afterEach(async () => {
	delete process.env.IAGO_DAEMON_STATE_ROOT;
	vi.restoreAllMocks();
	_resetSessionLogStateForTests();
	await fsp.rm(tempDir, { recursive: true, force: true });
});

async function collectReplay(
	handleId: string,
	hwm: { byteOffset: number; sequence: number },
): Promise<Array<{ event: unknown; sequence: number }>> {
	const out: Array<{ event: unknown; sequence: number }> = [];
	for await (const item of readEventsUpToHWM(handleId, hwm)) {
		out.push(item);
	}
	return out;
}

describe("session-log / appendEvent", () => {
	it("writes one NDJSON line; sequence starts at 1; byteOffset matches file size", async () => {
		const handleId = "h-1";
		const result = await appendEvent(handleId, { kind: "boot" });
		expect(result.sequence).toBe(1);
		const stat = await fsp.stat(
			path.join(pathFor("session-logs"), `${handleId}.jsonl`),
		);
		expect(result.byteOffset).toBe(stat.size);
		const raw = await fsp.readFile(
			path.join(pathFor("session-logs"), `${handleId}.jsonl`),
			"utf8",
		);
		expect(raw).toBe(`${JSON.stringify({ kind: "boot" })}\n`);
	});

	it("100 sequential appends produce 100 lines, sequence 1..100, byte offsets monotonically increasing", async () => {
		const handleId = "h-many";
		let lastByteOffset = 0;
		for (let i = 1; i <= 100; i++) {
			const result = await appendEvent(handleId, { i });
			expect(result.sequence).toBe(i);
			expect(result.byteOffset).toBeGreaterThan(lastByteOffset);
			lastByteOffset = result.byteOffset;
		}
		const raw = await fsp.readFile(
			path.join(pathFor("session-logs"), `${handleId}.jsonl`),
			"utf8",
		);
		const lines = raw.split("\n").filter((l) => l.length > 0);
		expect(lines).toHaveLength(100);
	});
});

describe("session-log / readEventsUpToHWM", () => {
	it("skips malformed lines and warns to console.error", async () => {
		const handleId = "h-malformed";
		const filePath = path.join(pathFor("session-logs"), `${handleId}.jsonl`);
		const validA = JSON.stringify({ name: "A" });
		const malformed = "{not json";
		const validC = JSON.stringify({ name: "C" });
		await fsp.writeFile(filePath, `${validA}\n${malformed}\n${validC}\n`);

		const stat = await fsp.stat(filePath);
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const collected = await collectReplay(handleId, {
			byteOffset: stat.size,
			sequence: 3,
		});

		expect(collected).toEqual([
			{ event: { name: "A" }, sequence: 1 },
			{ event: { name: "C" }, sequence: 3 },
		]);
		expect(errSpy).toHaveBeenCalledTimes(1);
	});

	it("invokes the callback once per event in sequence order", async () => {
		const handleId = "h-order";
		const r1 = await appendEvent(handleId, { name: "A" });
		const r2 = await appendEvent(handleId, { name: "B" });
		const r3 = await appendEvent(handleId, { name: "C" });
		await setHWM(handleId, {
			byteOffset: r3.byteOffset,
			sequence: r3.sequence,
		});
		void r1;
		void r2;

		const seen: Array<{ event: unknown; seq: number }> = [];
		const controller = new ReplayController(handleId);
		await controller.replay(async (event, seq) => {
			seen.push({ event, seq });
		});

		expect(seen).toEqual([
			{ event: { name: "A" }, seq: 1 },
			{ event: { name: "B" }, seq: 2 },
			{ event: { name: "C" }, seq: 3 },
		]);
	});
});

describe("session-log / HWM", () => {
	it("setHWM then getHWM round-trips", async () => {
		const handleId = "h-hwm";
		await setHWM(handleId, { byteOffset: 1234, sequence: 42 });
		expect(await getHWM(handleId)).toEqual({
			byteOffset: 1234,
			sequence: 42,
		});
	});

	it("getHWM returns null when no marker exists", async () => {
		expect(await getHWM("h-absent")).toBeNull();
	});

	it("setHWM rename failure leaves no final marker and cleans up tmp", async () => {
		const handleId = "h-atomic";
		const finalPath = path.join(pathFor("markers"), `${handleId}.hwm.json`);
		const tmpPath = path.join(pathFor("markers"), `.${handleId}.hwm.tmp`);
		// Pre-create destination as a directory; rename(file → dir) fails on
		// every platform (EISDIR / EPERM). On Windows, atomicRename's
		// unlink-then-rename fallback also fails (cannot unlink a directory),
		// so setHWM rejects regardless of platform.
		await fsp.mkdir(finalPath);

		await expect(
			setHWM(handleId, { byteOffset: 99, sequence: 9 }),
		).rejects.toThrow();

		// The destination still holds the directory, not a published marker.
		const stat = await fsp.stat(finalPath);
		expect(stat.isFile()).toBe(false);
		// And the tmp file must be cleaned up — no pollution after failure.
		await expect(fsp.stat(tmpPath)).rejects.toThrow();
	});
});

describe("session-log / handleId path-traversal guard", () => {
	it("appendEvent rejects unsafe handleId", async () => {
		await expect(appendEvent("../escape", { kind: "x" })).rejects.toThrow(
			TypeError,
		);
		await expect(appendEvent("a/b", { kind: "x" })).rejects.toThrow(TypeError);
	});

	it("getHWM / setHWM reject unsafe handleId", async () => {
		await expect(getHWM("..\\windows")).rejects.toThrow(TypeError);
		await expect(
			setHWM("foo\0bar", { byteOffset: 0, sequence: 0 }),
		).rejects.toThrow(TypeError);
	});

	it("ReplayController constructor rejects unsafe handleId", () => {
		expect(() => new ReplayController("../escape")).toThrow(TypeError);
	});
});

describe("session-log / two-phase replay", () => {
	it("pause → queue appends → replay pre-pause events → resume → drain queue in order", async () => {
		const handleId = "h-replay";
		const r1 = await appendEvent(handleId, { name: "A" });
		const r2 = await appendEvent(handleId, { name: "B" });
		const r3 = await appendEvent(handleId, { name: "C" });
		await setHWM(handleId, {
			byteOffset: r3.byteOffset,
			sequence: r3.sequence,
		});
		void r1;
		void r2;

		const controller = new ReplayController(handleId);
		await controller.pauseIntake();

		const queued = ["D", "E", "F", "G", "H"].map((name) =>
			appendEvent(handleId, { name }),
		);

		const replayed: Array<{ event: unknown; seq: number }> = [];
		await controller.replay(async (event, seq) => {
			replayed.push({ event, seq });
		});
		expect(replayed).toEqual([
			{ event: { name: "A" }, seq: 1 },
			{ event: { name: "B" }, seq: 2 },
			{ event: { name: "C" }, seq: 3 },
		]);

		await controller.resumeIntake();
		const drainedResults = await Promise.all(queued);
		expect(drainedResults.map((r) => r.sequence)).toEqual([4, 5, 6, 7, 8]);

		const fileRaw = await fsp.readFile(
			path.join(pathFor("session-logs"), `${handleId}.jsonl`),
			"utf8",
		);
		const fileLines = fileRaw.split("\n").filter((l) => l.length > 0);
		expect(fileLines).toHaveLength(8);
		const lastFive = fileLines.slice(3).map((l) => JSON.parse(l));
		expect(lastFive).toEqual([
			{ name: "D" },
			{ name: "E" },
			{ name: "F" },
			{ name: "G" },
			{ name: "H" },
		]);
	});
});
