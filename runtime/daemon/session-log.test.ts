import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	ReplayController,
	_resetSessionLogStateForTests,
	appendEvent,
	cancelPendingAppends,
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
	it("skips malformed lines without advancing seq (C2: per-success allocation)", async () => {
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

		// Sequence is now the "successfully-parsed line ordinal", matching
		// performAppend's per-success monotonic allocation. The malformed
		// middle line does NOT consume a seq number, so C is seq 2 — not 3.
		expect(collected).toEqual([
			{ event: { name: "A" }, sequence: 1 },
			{ event: { name: "C" }, sequence: 2 },
		]);
		expect(errSpy).toHaveBeenCalledTimes(1);
	});

	it("replay seq matches append seq when malformed lines are interleaved (C2 regression)", async () => {
		const handleId = "h-c2-regression";
		const filePath = path.join(pathFor("session-logs"), `${handleId}.jsonl`);
		// Simulate the failure mode from review C2: appends produce seq 1..3
		// but a malformed line was hand-edited / crash-truncated into the
		// middle. Replay must yield the same seq values that appendEvent
		// allocated, NOT line-position ordinals.
		const a = await appendEvent(handleId, { name: "A" }); // seq 1
		const b = await appendEvent(handleId, { name: "B" }); // seq 2
		// Inject a malformed line directly into the file between B and C.
		await fsp.appendFile(filePath, "{garbage line\n");
		const c = await appendEvent(handleId, { name: "C" }); // seq 3
		void a;
		void b;
		await setHWM(handleId, {
			byteOffset: c.byteOffset,
			sequence: c.sequence,
		});

		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const collected = await collectReplay(handleId, {
			byteOffset: c.byteOffset,
			sequence: c.sequence,
		});

		// All three valid events present, sequences match what appendEvent
		// returned (1, 2, 3) — NOT shifted by the malformed middle line.
		expect(collected).toEqual([
			{ event: { name: "A" }, sequence: 1 },
			{ event: { name: "B" }, sequence: 2 },
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

	it("resumeIntake keeps queued drain items before live concurrent appends", async () => {
		const handleId = "h-concurrent-resume";
		await appendEvent(handleId, { name: "A" });

		const controller = new ReplayController(handleId);
		await controller.pauseIntake();

		// Queue 3 events while paused.
		const queued = ["B", "C", "D"].map((name) => appendEvent(handleId, { name }));

		// Start resume and concurrently queue Z while the backlog drain is running.
		// Z arrives while paused=true so it lands in the late-queue, gets flushed
		// in pass 2 — after B/C/D and before any subsequent direct appends.
		const resumePromise = controller.resumeIntake();
		const livePromise = appendEvent(handleId, { name: "Z" });

		const [drainedResults, liveResult] = await Promise.all([
			Promise.all(queued),
			livePromise,
			resumePromise,
		]);

		const sequences = drainedResults.map((r) => r.sequence);
		// B, C, D were in the initial backlog — must be consecutive from 2.
		expect(sequences).toEqual([2, 3, 4]);
		// Z was a late-queue item — comes after all backlog items.
		expect(liveResult.sequence).toBeGreaterThan(Math.max(...sequences));
	});

	it("pauseIntake awaits in-flight appends before resolving (C3)", async () => {
		const handleId = "h-inflight";
		// Kick off 10 concurrent appendEvent calls WITHOUT awaiting them. Many
		// will already be inside performAppend (past the paused-check) when
		// pauseIntake fires.
		const inflight = Array.from({ length: 10 }, (_, i) =>
			appendEvent(handleId, { i }),
		);

		const controller = new ReplayController(handleId);
		// pauseIntake must NOT return until every in-flight append has finished
		// writing to the file. After pauseIntake resolves the file MUST contain
		// all 10 lines — no later write can sneak in.
		await controller.pauseIntake();

		const raw = await fsp.readFile(
			path.join(pathFor("session-logs"), `${handleId}.jsonl`),
			"utf8",
		);
		const lines = raw.split("\n").filter((l) => l.length > 0);
		expect(lines).toHaveLength(10);

		// And the file state must be stable: no further writes after pauseIntake.
		// Wait a tick to give any leaked microtask a chance to mis-write.
		await new Promise((resolve) => setTimeout(resolve, 20));
		const raw2 = await fsp.readFile(
			path.join(pathFor("session-logs"), `${handleId}.jsonl`),
			"utf8",
		);
		expect(raw2).toBe(raw);

		// Cleanup: original inflight promises must all resolve cleanly.
		const results = await Promise.all(inflight);
		expect(results.map((r) => r.sequence).sort((a, b) => a - b)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
		]);
	});
});

describe("session-log / sequence durability (C5 + I3)", () => {
	it(".seq is fsynced before performAppend returns (I3)", async () => {
		const handleId = "h-seq-fsync";
		const result = await appendEvent(handleId, { kind: "boot" });
		// After appendEvent returns, the .seq file is durable on disk and its
		// value matches the just-returned sequence.
		const seqRaw = await fsp.readFile(
			path.join(pathFor("session-logs"), `${handleId}.seq`),
			"utf8",
		);
		expect(Number.parseInt(seqRaw.trim(), 10)).toBe(result.sequence);
	});

	it("seq reservation precedes log write — recovery sees no duplicate (C5)", async () => {
		const handleId = "h-c5-gap";
		// Simulate the C5 crash window: persistSequence committed nextSeq, log
		// line never landed (process killed between the two writes). We model
		// this by hand-writing a future .seq value without a matching log line.
		const seqPath = path.join(pathFor("session-logs"), `${handleId}.seq`);
		const logPath = path.join(pathFor("session-logs"), `${handleId}.jsonl`);
		// Write 2 valid log lines + .seq=2 (simulating two successful appends).
		await fsp.writeFile(
			logPath,
			`${JSON.stringify({ n: 1 })}\n${JSON.stringify({ n: 2 })}\n`,
		);
		await fsp.writeFile(seqPath, "2");

		// Now simulate a crash AFTER persistSequence(3) committed but BEFORE
		// log write — only the .seq file advanced.
		await fsp.writeFile(seqPath, "3");

		// On restart (fresh cache), loadSequence sees .seq=3 and allocates 4
		// for the next append. The skipped seq=3 is a recoverable gap, NOT
		// the unrecoverable duplicate that the OLD (cache-before-disk)
		// ordering produced.
		_resetSessionLogStateForTests();
		const next = await appendEvent(handleId, { n: 3 });
		expect(next.sequence).toBe(4);

		// Verify the persisted .seq matches.
		const seqAfter = await fsp.readFile(seqPath, "utf8");
		expect(Number.parseInt(seqAfter.trim(), 10)).toBe(4);
	});

	it(".seq recovery counts successfully-parsed lines (matches C2 semantics)", async () => {
		const handleId = "h-seq-recovery";
		const logPath = path.join(pathFor("session-logs"), `${handleId}.jsonl`);
		// 3 valid lines + 1 malformed. Recovery must count 3, not 4.
		await fsp.writeFile(
			logPath,
			`${JSON.stringify({ n: 1 })}\n{garbage\n${JSON.stringify({ n: 2 })}\n${JSON.stringify({ n: 3 })}\n`,
		);
		// No .seq file → triggers the recovery path.
		_resetSessionLogStateForTests();
		const next = await appendEvent(handleId, { n: 4 });
		// Recovery counted 3 parsed lines, so next.sequence === 4.
		expect(next.sequence).toBe(4);
	});
});

describe("session-log / cancelPendingAppends (C6)", () => {
	it("rejects all queued promises with the supplied reason", async () => {
		const handleId = "h-shutdown";
		await appendEvent(handleId, { name: "A" });

		const controller = new ReplayController(handleId);
		await controller.pauseIntake();

		const queued = ["B", "C", "D"].map((name) => appendEvent(handleId, { name }));

		const start = Date.now();
		cancelPendingAppends(handleId, "daemon-shutdown");
		const results = await Promise.allSettled(queued);
		const elapsed = Date.now() - start;
		// Cancellation is synchronous; promises must reject in <100ms.
		expect(elapsed).toBeLessThan(100);

		for (const r of results) {
			expect(r.status).toBe("rejected");
			if (r.status === "rejected") {
				expect(String(r.reason)).toContain("daemon-shutdown");
			}
		}
	});

	it("is a no-op when no queue exists for the handle", () => {
		// Must not throw even if the handle has never been touched.
		expect(() =>
			cancelPendingAppends("h-never-touched", "cleanup"),
		).not.toThrow();
	});
});
