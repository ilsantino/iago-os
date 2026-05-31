import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	CronScheduler,
	matchesCron,
	validateScheduleSyntax,
} from "./cron-scheduler.js";
import type { DaemonEvent } from "./telemetry.js";

// `spawnSync` is mocked at the module level — the scheduler reaches into
// `node:child_process` for wake-check execution. Tests that need a
// specific result inject it via `spawnSyncMock.mockReturnValue(...)`.
const spawnSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async () => {
	const actual =
		await vi.importActual<typeof import("node:child_process")>(
			"node:child_process",
		);
	return {
		...actual,
		spawnSync: spawnSyncMock,
	};
});

// Mock the telemetry module so test (10) can park `await emit(...)` on a
// controllable barrier (proving `stop()` awaits the in-flight tick). By
// default the mock passes through to the real `emit` so other tests that
// observe telemetry files via `readTelemetry()` still work.
const { emitMock, emitState } = vi.hoisted(() => ({
	emitMock: vi.fn(),
	emitState: {
		real: null as ((e: DaemonEvent) => Promise<void>) | null,
	},
}));
vi.mock("./telemetry.js", async () => {
	const actual =
		await vi.importActual<typeof import("./telemetry.js")>("./telemetry.js");
	emitState.real = actual.emit;
	return {
		...actual,
		emit: emitMock,
	};
});

let tempDir: string;

async function readTelemetry(): Promise<Array<Record<string, unknown>>> {
	const dir = path.join(tempDir, "telemetry");
	let files: string[];
	try {
		files = await fsp.readdir(dir);
	} catch {
		return [];
	}
	const events: Array<Record<string, unknown>> = [];
	for (const f of files) {
		if (!f.endsWith(".ndjson")) continue;
		const raw = await fsp.readFile(path.join(dir, f), "utf8");
		for (const line of raw.split("\n")) {
			if (line.length === 0) continue;
			events.push(JSON.parse(line) as Record<string, unknown>);
		}
	}
	return events;
}

function writePromptTemplate(name: string, body: string): string {
	const p = path.join(tempDir, name);
	fs.writeFileSync(p, body, "utf8");
	return p;
}

beforeEach(async () => {
	tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-cron-"));
	process.env.IAGO_DAEMON_STATE_ROOT = tempDir;
	for (const sub of [
		"tasks/pending",
		"tasks/claimed",
		"tasks/resolved",
		"telemetry",
		"agents",
		"session-logs",
		"markers",
		"approvals/pending",
		"approvals/resolved",
	]) {
		fs.mkdirSync(path.join(tempDir, sub), { recursive: true });
	}
	spawnSyncMock.mockReset();
	emitMock.mockReset();
	// Default: pass through to the real telemetry write.
	emitMock.mockImplementation((e: DaemonEvent) => {
		if (emitState.real === null) return Promise.resolve();
		return emitState.real(e);
	});
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	delete process.env.IAGO_DAEMON_STATE_ROOT;
	await fsp.rm(tempDir, { recursive: true, force: true });
});

describe("matchesCron — parser", () => {
	it("(1) '* * * * *' matches every minute", () => {
		const now = new Date(Date.UTC(2026, 4, 18, 13, 27, 0));
		expect(matchesCron("* * * * *", now)).toBe(true);
		const other = new Date(Date.UTC(2026, 6, 4, 0, 0, 0));
		expect(matchesCron("* * * * *", other)).toBe(true);
	});

	it("(2) '0 14 * * *' matches at 14:00 UTC, not 14:01 or 13:00", () => {
		expect(
			matchesCron("0 14 * * *", new Date(Date.UTC(2026, 4, 18, 14, 0, 0))),
		).toBe(true);
		expect(
			matchesCron("0 14 * * *", new Date(Date.UTC(2026, 4, 18, 14, 1, 0))),
		).toBe(false);
		expect(
			matchesCron("0 14 * * *", new Date(Date.UTC(2026, 4, 18, 13, 0, 0))),
		).toBe(false);
	});

	it("(3) '*/15 * * * *' matches at :00 :15 :30 :45 and not :07", () => {
		for (const m of [0, 15, 30, 45]) {
			expect(
				matchesCron("*/15 * * * *", new Date(Date.UTC(2026, 4, 18, 9, m, 0))),
			).toBe(true);
		}
		expect(
			matchesCron("*/15 * * * *", new Date(Date.UTC(2026, 4, 18, 9, 7, 0))),
		).toBe(false);
	});

	it("(4) '0 0 * * 1-5' matches Mon-Fri midnight, NOT Sat/Sun", () => {
		// 2026-05-18 is a Monday — getUTCDay() === 1.
		expect(
			matchesCron("0 0 * * 1-5", new Date(Date.UTC(2026, 4, 18, 0, 0, 0))),
		).toBe(true);
		// 2026-05-22 Friday (day=5)
		expect(
			matchesCron("0 0 * * 1-5", new Date(Date.UTC(2026, 4, 22, 0, 0, 0))),
		).toBe(true);
		// 2026-05-23 Saturday (day=6)
		expect(
			matchesCron("0 0 * * 1-5", new Date(Date.UTC(2026, 4, 23, 0, 0, 0))),
		).toBe(false);
		// 2026-05-24 Sunday (day=0)
		expect(
			matchesCron("0 0 * * 1-5", new Date(Date.UTC(2026, 4, 24, 0, 0, 0))),
		).toBe(false);
	});

	it("(5) '1,3,5 * * * *' matches at minutes 1, 3, 5 only", () => {
		for (const m of [1, 3, 5]) {
			expect(
				matchesCron("1,3,5 * * * *", new Date(Date.UTC(2026, 4, 18, 9, m, 0))),
			).toBe(true);
		}
		for (const m of [0, 2, 4, 6, 30]) {
			expect(
				matchesCron("1,3,5 * * * *", new Date(Date.UTC(2026, 4, 18, 9, m, 0))),
			).toBe(false);
		}
	});

	it("(6) '0 0 1-7 * 1' POSIX day-OR-weekday: matches when EITHER 1-7 OR Mon", () => {
		// 2026-05-04 Monday day-of-month=4 — both OR branches match.
		expect(
			matchesCron("0 0 1-7 * 1", new Date(Date.UTC(2026, 4, 4, 0, 0, 0))),
		).toBe(true);
		// 2026-05-11 Monday day-of-month=11 — weekday matches, DOM does not — OR still true.
		expect(
			matchesCron("0 0 1-7 * 1", new Date(Date.UTC(2026, 4, 11, 0, 0, 0))),
		).toBe(true);
		// 2026-05-03 Sunday day-of-month=3 — DOM matches, weekday does not — OR still true.
		expect(
			matchesCron("0 0 1-7 * 1", new Date(Date.UTC(2026, 4, 3, 0, 0, 0))),
		).toBe(true);
		// 2026-05-08 Friday day-of-month=8 — NEITHER matches — false.
		expect(
			matchesCron("0 0 1-7 * 1", new Date(Date.UTC(2026, 4, 8, 0, 0, 0))),
		).toBe(false);
	});

	it("(7) '0 9-17/2 * * *' matches 9, 11, 13, 15, 17 UTC", () => {
		for (const h of [9, 11, 13, 15, 17]) {
			expect(
				matchesCron("0 9-17/2 * * *", new Date(Date.UTC(2026, 4, 18, h, 0, 0))),
			).toBe(true);
		}
		for (const h of [10, 12, 14, 16, 8, 18]) {
			expect(
				matchesCron("0 9-17/2 * * *", new Date(Date.UTC(2026, 4, 18, h, 0, 0))),
			).toBe(false);
		}
	});

	it("(8) malformed expression throws RangeError naming the offending field", () => {
		expect(() => matchesCron("bogus expression", new Date())).toThrow(
			RangeError,
		);
		expect(() =>
			matchesCron("0 99 * * *", new Date(Date.UTC(2026, 4, 18, 0, 0, 0))),
		).toThrow(/hour/);
		expect(() => matchesCron("* * * *", new Date())).toThrow(/5 fields/);
	});

	it("(8b) parser error-paths surface as RangeError with informative messages", () => {
		// Fixed Date with minute=0 so parser advances PAST minute field and
		// reaches the hour-field error sites in tests that target hour parsing.
		const t = new Date(Date.UTC(2026, 4, 18, 9, 0, 0));
		// Empty step ("*/")
		expect(() => matchesCron("*/ * * * *", t)).toThrow(/step/);
		// Step of zero
		expect(() => matchesCron("*/0 * * * *", t)).toThrow(/step/);
		// Non-integer step
		expect(() => matchesCron("*/abc * * * *", t)).toThrow(/step/);
		// Non-integer literal
		expect(() => matchesCron("xyz * * * *", t)).toThrow(/non-numeric/);
		// Range with non-numeric bound (hour field — needs minute=0 to reach)
		expect(() => matchesCron("0 a-b * * *", t)).toThrow(/non-numeric range/);
		// Inverted range (hour field — needs minute=0 to reach)
		expect(() => matchesCron("0 5-2 * * *", t)).toThrow(/out of bounds/);
		// Empty comma element
		expect(() => matchesCron("0,,5 * * * *", t)).toThrow(/comma-list/);
		// Value above max for field
		expect(() => matchesCron("60 * * * *", t)).toThrow(/minute/);
		// Bare "/N" with no range prefix (e.g. "/5" instead of "*/5")
		expect(() => matchesCron("/5 * * * *", t)).toThrow(/missing range/);
	});

	it("(8c) day-only and weekday-only branches", () => {
		// DOW wildcard, DOM restricted — should match by DOM alone.
		expect(
			matchesCron("0 0 15 * *", new Date(Date.UTC(2026, 4, 15, 0, 0, 0))),
		).toBe(true);
		expect(
			matchesCron("0 0 15 * *", new Date(Date.UTC(2026, 4, 14, 0, 0, 0))),
		).toBe(false);
		// DOM wildcard, DOW restricted — should match by DOW alone.
		// 2026-05-20 Wednesday (day=3)
		expect(
			matchesCron("0 0 * * 3", new Date(Date.UTC(2026, 4, 20, 0, 0, 0))),
		).toBe(true);
		expect(
			matchesCron("0 0 * * 3", new Date(Date.UTC(2026, 4, 21, 0, 0, 0))),
		).toBe(false);
	});
});

describe("CronScheduler — lifecycle", () => {
	it("(9) start() called twice does not duplicate the interval", () => {
		vi.useFakeTimers();
		const spy = vi.spyOn(globalThis, "setInterval");
		const sch = new CronScheduler({ agentManager: new EventEmitter() });
		sch.start();
		sch.start();
		expect(spy).toHaveBeenCalledTimes(1);
		// `stop` here is sync-fast because no tick has fired.
		void sch.stop();
	});

	it("(10) stop() clears the interval AND awaits in-flight tick", async () => {
		const clearSpy = vi.spyOn(globalThis, "clearInterval");
		// Park the tick at `await emit(cron-fired)` by replacing the emit
		// mock for the next call with a controllable barrier. This proves
		// `stop()` genuinely awaits the in-flight tick — not just clears
		// the interval and races past it.
		let releaseEmit: () => void = () => {};
		const emitBarrier = new Promise<void>((resolve) => {
			releaseEmit = resolve;
		});
		emitMock.mockImplementationOnce(async (_e: DaemonEvent) => {
			await emitBarrier;
		});

		const am = new EventEmitter();
		const sch = new CronScheduler({
			agentManager: am,
			nowFn: () => new Date(Date.UTC(2026, 4, 18, 14, 0, 0)),
		});
		const prompt = writePromptTemplate("p.txt", "do the thing");
		sch.registerCron({
			agentId: "pr-triage",
			schedule: "* * * * *",
			promptTemplatePath: prompt,
			outputTaskNamePrefix: "pr-triage",
		});
		sch.start();
		// Kick a tick — it will park inside `fire()` at the cron-fired emit.
		const tickP = sch._tickForTests();
		// Yield enough microtasks for fire() to reach the parked emit call.
		for (let i = 0; i < 10; i++) await Promise.resolve();

		// Now call stop() — must NOT resolve while the tick is parked.
		let stopResolved = false;
		const stopP = sch.stop().then(() => {
			stopResolved = true;
		});
		for (let i = 0; i < 10; i++) await Promise.resolve();
		expect(stopResolved).toBe(false);
		expect(clearSpy).toHaveBeenCalled();

		// Release the emit barrier — tick completes, then stop resolves.
		releaseEmit();
		await tickP;
		await stopP;
		expect(stopResolved).toBe(true);
	});

	it("(11) wake-check exit 0 fires; exit 1 emits cron-skipped(wake-check-failed)", async () => {
		vi.useFakeTimers();
		const am = new EventEmitter();
		const prompt = writePromptTemplate("p.txt", "do thing");
		const wake = path.join(tempDir, "wake.sh");
		fs.writeFileSync(wake, "#!/bin/bash\nexit 0\n");

		// First: wake-check passes.
		spawnSyncMock.mockReturnValueOnce({
			status: 0,
			signal: null,
			error: undefined,
			stdout: "",
			stderr: "",
			pid: 1234,
			output: [],
		});
		const sch = new CronScheduler({
			agentManager: am,
			nowFn: () => new Date(Date.UTC(2026, 4, 18, 14, 0, 0)),
		});
		sch.registerCron({
			agentId: "pr-triage",
			schedule: "0 14 * * *",
			wakeCheck: wake,
			promptTemplatePath: prompt,
			outputTaskNamePrefix: "pr-triage",
		});
		sch.start();
		await sch._tickForTests();

		const pendingFiles = await fsp.readdir(path.join(tempDir, "tasks/pending"));
		expect(pendingFiles).toHaveLength(1);
		expect(pendingFiles[0]).toMatch(/^pr-triage__\d+\.json$/);
		const events = await readTelemetry();
		expect(events.some((e) => e.kind === "cron-fired")).toBe(true);

		// Reset and exercise the exit-1 branch.
		await fsp.rm(path.join(tempDir, "tasks/pending"), {
			recursive: true,
			force: true,
		});
		fs.mkdirSync(path.join(tempDir, "tasks/pending"), { recursive: true });
		await fsp.rm(path.join(tempDir, "telemetry"), {
			recursive: true,
			force: true,
		});
		fs.mkdirSync(path.join(tempDir, "telemetry"), { recursive: true });
		spawnSyncMock.mockReset();
		spawnSyncMock.mockReturnValueOnce({
			status: 1,
			signal: null,
			error: undefined,
			stdout: "",
			stderr: "",
			pid: 1235,
			output: [],
		});
		// Need a fresh scheduler because runningCount accumulated from the
		// first fire — start fresh so the second tick is overlap-clean.
		const sch2 = new CronScheduler({
			agentManager: new EventEmitter(),
			nowFn: () => new Date(Date.UTC(2026, 4, 18, 14, 0, 0)),
		});
		sch2.registerCron({
			agentId: "pr-triage",
			schedule: "0 14 * * *",
			wakeCheck: wake,
			promptTemplatePath: prompt,
			outputTaskNamePrefix: "pr-triage",
		});
		sch2.start();
		await sch2._tickForTests();
		const pendingAfter = await fsp.readdir(path.join(tempDir, "tasks/pending"));
		expect(pendingAfter).toHaveLength(0);
		const evtsAfter = await readTelemetry();
		const skipped = evtsAfter.find((e) => e.kind === "cron-skipped");
		expect(skipped).toBeDefined();
		expect(skipped?.reason).toBe("wake-check-failed");
		expect(skipped?.exitCode).toBe(1);

		await sch.stop();
		await sch2.stop();
	});

	it("(11b) wake-check timeout (signal SIGKILL) emits cron-skipped(wake-check-timeout)", async () => {
		vi.useFakeTimers();
		const wake = path.join(tempDir, "wake.sh");
		fs.writeFileSync(wake, "#!/bin/bash\nsleep 35\n");
		spawnSyncMock.mockReturnValueOnce({
			status: null,
			signal: "SIGKILL",
			error: undefined,
			stdout: "",
			stderr: "",
			pid: 9999,
			output: [],
		});
		const sch = new CronScheduler({
			agentManager: new EventEmitter(),
			nowFn: () => new Date(Date.UTC(2026, 4, 18, 14, 0, 0)),
		});
		const prompt = writePromptTemplate("p.txt", "do thing");
		sch.registerCron({
			agentId: "pr-triage",
			schedule: "0 14 * * *",
			wakeCheck: wake,
			promptTemplatePath: prompt,
			outputTaskNamePrefix: "pr-triage",
		});
		sch.start();
		await sch._tickForTests();
		const evts = await readTelemetry();
		const skipped = evts.find((e) => e.kind === "cron-skipped");
		expect(skipped).toBeDefined();
		expect(skipped?.reason).toBe("wake-check-timeout");
		expect(skipped?.exitCode).toBeNull();
		// No task file produced.
		const pending = await fsp.readdir(path.join(tempDir, "tasks/pending"));
		expect(pending).toHaveLength(0);
		await sch.stop();
	});

	it("(12) tick WITHOUT wakeCheck writes the task file and emits cron-fired", async () => {
		vi.useFakeTimers();
		const prompt = writePromptTemplate("p.txt", "do thing");
		const sch = new CronScheduler({
			agentManager: new EventEmitter(),
			nowFn: () => new Date(Date.UTC(2026, 4, 18, 14, 0, 0)),
		});
		sch.registerCron({
			agentId: "pr-triage",
			schedule: "0 14 * * *",
			promptTemplatePath: prompt,
			outputTaskNamePrefix: "pr-triage",
		});
		sch.start();
		await sch._tickForTests();
		expect(spawnSyncMock).not.toHaveBeenCalled();
		const pending = await fsp.readdir(path.join(tempDir, "tasks/pending"));
		expect(pending).toHaveLength(1);
		const body = await fsp.readFile(
			path.join(tempDir, "tasks/pending", pending[0] as string),
			"utf8",
		);
		const parsed = JSON.parse(body) as Record<string, unknown>;
		expect(parsed.agentId).toBe("pr-triage");
		expect(parsed.prompt).toBe("do thing");
		expect(parsed.needsApproval).toBe(false);
		const evts = await readTelemetry();
		const fired = evts.find((e) => e.kind === "cron-fired");
		expect(fired).toBeDefined();
		expect(fired?.runningCount).toBe(1);
		await sch.stop();
	});
});

describe("CronScheduler — failure modes", () => {
	it("missing prompt template emits cron-fired-prompt-missing", async () => {
		const sch = new CronScheduler({
			agentManager: new EventEmitter(),
			nowFn: () => new Date(Date.UTC(2026, 4, 18, 14, 0, 0)),
		});
		sch.registerCron({
			agentId: "pr-triage",
			schedule: "0 14 * * *",
			promptTemplatePath: path.join(tempDir, "does-not-exist.txt"),
			outputTaskNamePrefix: "pr-triage",
		});
		sch.start();
		await sch._tickForTests();
		const evts = await readTelemetry();
		const missing = evts.find((e) => e.kind === "cron-fired-prompt-missing");
		expect(missing).toBeDefined();
		expect(missing?.errno).toBe("ENOENT");
		await sch.stop();
	});

	it("bash found but script absent (exit 127) emits cron-skipped(wake-check-failed, exitCode 127)", async () => {
		// `bash` is on PATH but the script file does not exist — bash exits 127.
		// Differs from the ENOENT case: result.error is undefined, result.status is 127.
		spawnSyncMock.mockReturnValueOnce({
			status: 127,
			signal: null,
			error: undefined,
			stdout: "",
			stderr: "bash: /no/such/script.sh: No such file or directory",
			pid: 1234,
			output: [],
		});
		const sch = new CronScheduler({
			agentManager: new EventEmitter(),
			nowFn: () => new Date(Date.UTC(2026, 4, 18, 14, 0, 0)),
		});
		const wake = path.join(tempDir, "absent-wake.sh"); // not created on disk
		sch.registerCron({
			agentId: "pr-triage",
			schedule: "0 14 * * *",
			wakeCheck: wake,
			promptTemplatePath: writePromptTemplate("p.txt", "x"),
			outputTaskNamePrefix: "pr-triage",
		});
		sch.start();
		await sch._tickForTests();
		const evts = await readTelemetry();
		const skipped = evts.find((e) => e.kind === "cron-skipped");
		expect(skipped).toBeDefined();
		expect(skipped?.reason).toBe("wake-check-failed");
		expect(skipped?.exitCode).toBe(127);
		const pending = await fsp.readdir(path.join(tempDir, "tasks/pending"));
		expect(pending).toHaveLength(0);
		await sch.stop();
	});

	it("cron-fired-write-failed does NOT increment runningCount", async () => {
		// Force the atomic-write path to fail cross-platform. `chmod 0o444`
		// on a directory is silently a no-op on Windows (NTFS ACL semantics
		// differ from POSIX), so instead we point `stateRoot` at a regular
		// file. `fire()` calls `fs.mkdirSync(<file>/tasks/pending, { recursive: true })`
		// which throws ENOTDIR on both Linux and Windows, exercising the
		// same catch block as a real disk-full or EACCES.
		const blocker = path.join(tempDir, "stateroot-is-a-file");
		fs.writeFileSync(blocker, "not a directory", "utf8");
		const sch = new CronScheduler({
			agentManager: new EventEmitter(),
			stateRoot: blocker,
			nowFn: () => new Date(Date.UTC(2026, 4, 18, 14, 0, 0)),
		});
		sch.registerCron({
			agentId: "pr-triage",
			schedule: "0 14 * * *",
			promptTemplatePath: writePromptTemplate("p.txt", "go"),
			outputTaskNamePrefix: "pr-triage",
		});
		sch.start();
		await sch._tickForTests();
		// The write failed — runningCount must stay at 0.
		expect(sch._runningCountForTests().get("pr-triage") ?? 0).toBe(0);
		// Telemetry still lives under the env-var-resolved tempDir (not the
		// blocker path) because the telemetry module reads
		// IAGO_DAEMON_STATE_ROOT directly — that's set in beforeEach.
		const evts = await readTelemetry();
		const writeFailed = evts.find((e) => e.kind === "cron-fired-write-failed");
		expect(writeFailed).toBeDefined();
		await sch.stop();
	});

	it("wake-check spawn error (no bash) emits cron-skipped(wake-check-failed)", async () => {
		spawnSyncMock.mockReturnValueOnce({
			status: null,
			signal: null,
			error: Object.assign(new Error("bash not found"), { code: "ENOENT" }),
			stdout: "",
			stderr: "",
			pid: 0,
			output: [],
		});
		const sch = new CronScheduler({
			agentManager: new EventEmitter(),
			nowFn: () => new Date(Date.UTC(2026, 4, 18, 14, 0, 0)),
		});
		const wake = path.join(tempDir, "wake.sh");
		fs.writeFileSync(wake, "#!/bin/bash\nexit 0\n");
		sch.registerCron({
			agentId: "pr-triage",
			schedule: "0 14 * * *",
			wakeCheck: wake,
			promptTemplatePath: writePromptTemplate("p.txt", "x"),
			outputTaskNamePrefix: "pr-triage",
		});
		sch.start();
		await sch._tickForTests();
		const evts = await readTelemetry();
		const skipped = evts.find((e) => e.kind === "cron-skipped");
		expect(skipped).toBeDefined();
		expect(skipped?.reason).toBe("wake-check-failed");
		await sch.stop();
	});

	it("default nowFn (undefined opts.nowFn) registers without throwing", () => {
		const sch = new CronScheduler({ agentManager: new EventEmitter() });
		sch.registerCron({
			agentId: "default-now",
			schedule: "* * * * *",
			promptTemplatePath: writePromptTemplate("p.txt", "x"),
			outputTaskNamePrefix: "default-now",
		});
		// _tickForTests with default nowFn must not throw.
		expect(() => sch._tickForTests()).not.toThrow();
		void sch.stop();
	});

	it("start() after stop() throws — instance is single-use", async () => {
		const sch = new CronScheduler({ agentManager: new EventEmitter() });
		sch.start();
		await sch.stop();
		expect(() => sch.start()).toThrow(/after stop/);
	});

	it("invalid agentId at registerCron is rejected", () => {
		const sch = new CronScheduler({ agentManager: new EventEmitter() });
		expect(() =>
			sch.registerCron({
				agentId: "bad/agent",
				schedule: "* * * * *",
				promptTemplatePath: writePromptTemplate("p.txt", "x"),
				outputTaskNamePrefix: "bad",
			}),
		).toThrow();
		void sch.stop();
	});

	it("invalid schedule at registerCron is rejected eagerly", () => {
		const sch = new CronScheduler({ agentManager: new EventEmitter() });
		expect(() =>
			sch.registerCron({
				agentId: "pr-triage",
				schedule: "not a cron expression",
				promptTemplatePath: writePromptTemplate("p.txt", "x"),
				outputTaskNamePrefix: "pr-triage",
			}),
		).toThrow(RangeError);
		void sch.stop();
	});

	it("duplicate outputTaskNamePrefix at registerCron is rejected", () => {
		const sch = new CronScheduler({ agentManager: new EventEmitter() });
		const prompt = writePromptTemplate("p.txt", "x");
		sch.registerCron({
			agentId: "pr-triage",
			schedule: "* * * * *",
			promptTemplatePath: prompt,
			outputTaskNamePrefix: "pr-triage",
		});
		expect(() =>
			sch.registerCron({
				agentId: "pr-triage-2",
				schedule: "* * * * *",
				promptTemplatePath: prompt,
				outputTaskNamePrefix: "pr-triage",
			}),
		).toThrow(/already registered/);
		void sch.stop();
	});

	it("malformed task-resolved event is ignored (defensive listener)", () => {
		const am = new EventEmitter();
		const sch = new CronScheduler({ agentManager: am });
		// Should not throw.
		am.emit("task-resolved", "not-an-object");
		am.emit("task-resolved", null);
		am.emit("task-resolved", { agentId: 42 });
		expect(sch._runningCountForTests().size).toBe(0);
		void sch.stop();
	});

	it("overlapping tick (runTickGuarded re-entry) skips the second call", async () => {
		const sch = new CronScheduler({
			agentManager: new EventEmitter(),
			nowFn: () => new Date(Date.UTC(2026, 4, 18, 14, 0, 0)),
		});
		sch.registerCron({
			agentId: "pr-triage",
			schedule: "0 14 * * *",
			promptTemplatePath: writePromptTemplate("p.txt", "x"),
			outputTaskNamePrefix: "pr-triage",
			maxConcurrent: 5,
		});
		sch.start();
		// Fire two ticks concurrently — the second must short-circuit while
		// the first is still in flight.
		const a = sch._tickForTests();
		const b = sch._tickForTests();
		await Promise.all([a, b]);
		// First tick incremented runningCount to 1; second was skipped, NOT
		// because of overlap-prevented (that's per-agent), but because the
		// re-entry guard returned early.
		expect(sch._runningCountForTests().get("pr-triage")).toBe(1);
		await sch.stop();
	});
});

describe("CronScheduler — overlap + decrement", () => {
	it("(13) overlap-prevented when runningCount equals maxConcurrent", async () => {
		vi.useFakeTimers();
		const prompt = writePromptTemplate("p.txt", "go");
		const sch = new CronScheduler({
			agentManager: new EventEmitter(),
			nowFn: () => new Date(Date.UTC(2026, 4, 18, 14, 0, 0)),
		});
		sch.registerCron({
			agentId: "pr-triage",
			schedule: "0 14 * * *",
			promptTemplatePath: prompt,
			outputTaskNamePrefix: "pr-triage",
			maxConcurrent: 1,
		});
		sch.start();
		// First fire — runningCount becomes 1.
		await sch._tickForTests();
		spawnSyncMock.mockReset();
		// Second matching tick — overlap should prevent the spawn.
		await sch._tickForTests();
		// Only one task file should exist (the first fire's).
		const pending = await fsp.readdir(path.join(tempDir, "tasks/pending"));
		expect(pending).toHaveLength(1);
		const evts = await readTelemetry();
		const overlap = evts.find((e) => e.kind === "cron-overlap-prevented");
		expect(overlap).toBeDefined();
		expect(overlap?.runningCount).toBe(1);
		expect(overlap?.maxConcurrent).toBe(1);
		expect(overlap?.agentId).toBe("pr-triage");
		await sch.stop();
	});

	it("(14) task-resolved decrement re-opens the slot for the next tick", async () => {
		vi.useFakeTimers();
		const am = new EventEmitter();
		const prompt = writePromptTemplate("p.txt", "go");
		// Both ticks must match `0 14 * * *` AND produce distinct unix
		// suffixes so the second task file does not overwrite the first.
		// registerCron also calls nowFn for eager validation, so we use
		// a mutable holder updated between ticks rather than a call counter.
		let nowHolder = new Date(Date.UTC(2026, 4, 18, 14, 0, 0));
		const sch = new CronScheduler({
			agentManager: am,
			nowFn: () => nowHolder,
		});
		sch.registerCron({
			agentId: "pr-triage",
			schedule: "0 14 * * *",
			promptTemplatePath: prompt,
			outputTaskNamePrefix: "pr-triage",
			maxConcurrent: 1,
		});
		sch.start();
		await sch._tickForTests();
		expect(sch._runningCountForTests().get("pr-triage")).toBe(1);
		// AgentManager (07b) emits when the task moves pending → resolved.
		// The listener filters by filename, so we must echo back the actual
		// emitted basename (computed from the unix suffix at fire time).
		const pendingForResolve = await fsp.readdir(
			path.join(tempDir, "tasks/pending"),
		);
		const emittedFilename = pendingForResolve[0] as string;
		am.emit("task-resolved", {
			agentId: "pr-triage",
			filename: emittedFilename,
		});
		expect(sch._runningCountForTests().get("pr-triage")).toBe(0);
		// Advance to next matching tick (same minute, +30s) so the
		// unix suffix differs and the second write does not overwrite.
		nowHolder = new Date(Date.UTC(2026, 4, 18, 14, 0, 30));
		await sch._tickForTests();
		const pending = await fsp.readdir(path.join(tempDir, "tasks/pending"));
		expect(pending.length).toBe(2);
		const evts = await readTelemetry();
		// No overlap event for the second tick.
		const overlaps = evts.filter((e) => e.kind === "cron-overlap-prevented");
		expect(overlaps).toHaveLength(0);
		await sch.stop();
	});
});

describe("validateScheduleSyntax — unconditional field parsing", () => {
	// Regression for Codex High #2: registerCron used to call
	// matchesCron(expr, now), which short-circuits at the first
	// non-matching field. A schedule like "28 99 * * *" would register
	// cleanly at any minute except :28 (minute parser matched, hour
	// parser never ran) and only throw at the first matching tick. The
	// scheduler then logged-and-skipped the throw, so the cron silently
	// never fired. `validateScheduleSyntax` parses every field
	// regardless of the current time.
	it("throws on malformed hour field even when minute does not match current time", () => {
		// Current minute is 0 — matchesCron("28 99 * * *", now) would
		// short-circuit on the minute parse (28 !== 0) and never reach
		// the malformed hour. validateScheduleSyntax must still throw.
		expect(() => validateScheduleSyntax("28 99 * * *")).toThrow(/hour/);
	});

	it("throws on each of the 5 field positions individually", () => {
		// Minute out of range
		expect(() => validateScheduleSyntax("99 * * * *")).toThrow(/minute/);
		// Hour out of range
		expect(() => validateScheduleSyntax("0 99 * * *")).toThrow(/hour/);
		// Day-of-month out of range
		expect(() => validateScheduleSyntax("0 0 99 * *")).toThrow(/day-of-month/);
		// Month out of range
		expect(() => validateScheduleSyntax("0 0 1 99 *")).toThrow(/month/);
		// Day-of-week out of range
		expect(() => validateScheduleSyntax("0 0 1 1 9")).toThrow(/day-of-week/);
	});

	it("throws on wrong field count", () => {
		expect(() => validateScheduleSyntax("* * * *")).toThrow(/5 fields/);
		expect(() => validateScheduleSyntax("* * * * * *")).toThrow(/5 fields/);
	});

	it("registerCron rejects malformed hour field at registration even when current minute does not match", () => {
		const sch = new CronScheduler({
			agentManager: new EventEmitter(),
			// nowFn returns minute=0 so matchesCron-based validation would
			// have short-circuited before reaching the bad hour field. This
			// proves registerCron uses the unconditional validator.
			nowFn: () => new Date(Date.UTC(2026, 4, 18, 9, 0, 0)),
		});
		expect(() =>
			sch.registerCron({
				agentId: "pr-triage",
				schedule: "28 99 * * *",
				promptTemplatePath: writePromptTemplate("p.txt", "x"),
				outputTaskNamePrefix: "pr-triage",
			}),
		).toThrow(RangeError);
		void sch.stop();
	});
});

describe("CronScheduler — terminal listener filename filter", () => {
	// Regression for Codex Medium #1: previously the listener decremented
	// runningCount on any task-resolved event for the matching agentId.
	// An AgentManager that processes both cron-emitted and manually
	// injected tasks for the same agent would have non-cron resolutions
	// reopen the cron slot, defeating maxConcurrent.

	it("non-cron filename does NOT decrement runningCount", async () => {
		vi.useFakeTimers();
		const am = new EventEmitter();
		const sch = new CronScheduler({
			agentManager: am,
			nowFn: () => new Date(Date.UTC(2026, 4, 18, 14, 0, 0)),
		});
		sch.registerCron({
			agentId: "pr-triage",
			schedule: "0 14 * * *",
			promptTemplatePath: writePromptTemplate("p.txt", "x"),
			outputTaskNamePrefix: "pr-triage",
			maxConcurrent: 1,
		});
		sch.start();
		await sch._tickForTests();
		expect(sch._runningCountForTests().get("pr-triage")).toBe(1);
		// Manual / non-cron task for the same agent resolves. Listener
		// must ignore it because the filename was never recorded in
		// outstandingFilenames.
		am.emit("task-resolved", {
			agentId: "pr-triage",
			filename: "manual-task__9999999999.json",
		});
		expect(sch._runningCountForTests().get("pr-triage")).toBe(1);
		// Outstanding cron filename set is unchanged.
		const outstanding = sch._outstandingFilenamesForTests().get("pr-triage");
		expect(outstanding?.size).toBe(1);
		await sch.stop();
	});

	it("matching cron filename decrements runningCount AND clears the outstanding set", async () => {
		vi.useFakeTimers();
		const am = new EventEmitter();
		const sch = new CronScheduler({
			agentManager: am,
			nowFn: () => new Date(Date.UTC(2026, 4, 18, 14, 0, 0)),
		});
		sch.registerCron({
			agentId: "pr-triage",
			schedule: "0 14 * * *",
			promptTemplatePath: writePromptTemplate("p.txt", "x"),
			outputTaskNamePrefix: "pr-triage",
			maxConcurrent: 1,
		});
		sch.start();
		await sch._tickForTests();
		const pending = await fsp.readdir(path.join(tempDir, "tasks/pending"));
		expect(pending).toHaveLength(1);
		const emitted = pending[0] as string;
		// Sanity: scheduler recorded the emitted filename for filtering.
		const outstandingBefore = sch
			._outstandingFilenamesForTests()
			.get("pr-triage");
		expect(outstandingBefore?.has(emitted)).toBe(true);

		am.emit("task-resolved", {
			agentId: "pr-triage",
			filename: emitted,
		});
		expect(sch._runningCountForTests().get("pr-triage")).toBe(0);
		// Empty outstanding set is cleaned up (Map entry deleted).
		expect(sch._outstandingFilenamesForTests().has("pr-triage")).toBe(false);
		await sch.stop();
	});

	it("task-poisoned and task-unrouted also release the slot for cron-emitted filenames", async () => {
		// Poison/unrouted are terminal outcomes too — without subscribing
		// to them, a poisoned cron task would leak its concurrency slot
		// forever and maxConcurrent would permanently wedge.
		vi.useFakeTimers();
		const am = new EventEmitter();
		const sch = new CronScheduler({
			agentManager: am,
			nowFn: () => new Date(Date.UTC(2026, 4, 18, 14, 0, 0)),
		});
		sch.registerCron({
			agentId: "pr-triage",
			schedule: "0 14 * * *",
			promptTemplatePath: writePromptTemplate("p.txt", "x"),
			outputTaskNamePrefix: "pr-triage",
			maxConcurrent: 1,
		});
		sch.start();
		await sch._tickForTests();
		const pending = await fsp.readdir(path.join(tempDir, "tasks/pending"));
		const emitted = pending[0] as string;
		am.emit("task-poisoned", {
			agentId: "pr-triage",
			filename: emitted,
		});
		expect(sch._runningCountForTests().get("pr-triage")).toBe(0);
		await sch.stop();
	});
});

// R1 (feature-pr84-r1-daemon-creds): prepareCronPrompt — daemon-side
// fetch + payload injection + zero-PR gate (replaces the bash wake-check).
describe("CronScheduler — prepareCronPrompt (R1)", () => {
	it("(R1-1) zero-PR skip → cron-skipped(no-open-prs), NO task file, NO wake-check spawn", async () => {
		vi.useFakeTimers();
		const prompt = writePromptTemplate("p.txt", "template body");
		const sch = new CronScheduler({
			agentManager: new EventEmitter(),
			nowFn: () => new Date(Date.UTC(2026, 4, 18, 14, 0, 0)),
			prepareCronPrompt: async () => ({ skip: true, reason: "no-open-prs" }),
		});
		sch.registerCron({
			agentId: "pr-triage",
			schedule: "0 14 * * *",
			promptTemplatePath: prompt,
			outputTaskNamePrefix: "pr-triage",
		});
		sch.start();
		await sch._tickForTests();

		// No bash wake-check is spawned — gating is daemon-side.
		expect(spawnSyncMock).not.toHaveBeenCalled();
		// No task file written.
		const pending = await fsp.readdir(path.join(tempDir, "tasks/pending"));
		expect(pending).toHaveLength(0);
		const evts = await readTelemetry();
		const skipped = evts.find((e) => e.kind === "cron-skipped");
		expect(skipped).toBeDefined();
		expect(skipped?.reason).toBe("no-open-prs");
		// runningCount NOT incremented on a skip.
		expect(sch._runningCountForTests().get("pr-triage")).toBeUndefined();
		await sch.stop();
	});

	it("(R1-2) non-zero PRs → task file whose prompt has the injected payload and NO credentials", async () => {
		vi.useFakeTimers();
		const prompt = writePromptTemplate("p.txt", "ignored verbatim template");
		const injectedPrompt =
			'PR DATA: {"totalCount":2,"prs":[{"number":7}]}\nclassify';
		const sch = new CronScheduler({
			agentManager: new EventEmitter(),
			nowFn: () => new Date(Date.UTC(2026, 4, 18, 14, 0, 0)),
			prepareCronPrompt: async () => ({ skip: false, prompt: injectedPrompt }),
		});
		sch.registerCron({
			agentId: "pr-triage",
			schedule: "0 14 * * *",
			promptTemplatePath: prompt,
			outputTaskNamePrefix: "pr-triage",
		});
		sch.start();
		await sch._tickForTests();

		const pending = await fsp.readdir(path.join(tempDir, "tasks/pending"));
		expect(pending).toHaveLength(1);
		const body = await fsp.readFile(
			path.join(tempDir, "tasks/pending", pending[0] as string),
			"utf8",
		);
		const parsed = JSON.parse(body) as Record<string, unknown>;
		expect(parsed.agentId).toBe("pr-triage");
		expect(parsed.needsApproval).toBe(false);
		// The injected payload (not the verbatim template) is the prompt.
		expect(parsed.prompt).toBe(injectedPrompt);
		expect(String(parsed.prompt)).toContain('"totalCount":2');
		// No credential / gh / curl reference in the task body.
		const serialized = JSON.stringify(parsed);
		expect(serialized).not.toContain("gh ");
		expect(serialized).not.toContain("curl");
		expect(serialized).not.toContain("GH_TOKEN");
		expect(serialized).not.toContain("IAGO_TELEGRAM_BOT_TOKEN");
		// cron-fired emitted.
		const evts = await readTelemetry();
		expect(evts.some((e) => e.kind === "cron-fired")).toBe(true);
		await sch.stop();
	});

	it("(R1-3) a throwing prepareCronPrompt → cron-skipped(pr-fetch-failed), no task file", async () => {
		vi.useFakeTimers();
		const prompt = writePromptTemplate("p.txt", "template");
		const sch = new CronScheduler({
			agentManager: new EventEmitter(),
			nowFn: () => new Date(Date.UTC(2026, 4, 18, 14, 0, 0)),
			prepareCronPrompt: async () => {
				throw new Error("boom");
			},
		});
		sch.registerCron({
			agentId: "pr-triage",
			schedule: "0 14 * * *",
			promptTemplatePath: prompt,
			outputTaskNamePrefix: "pr-triage",
		});
		sch.start();
		await sch._tickForTests();

		const pending = await fsp.readdir(path.join(tempDir, "tasks/pending"));
		expect(pending).toHaveLength(0);
		const evts = await readTelemetry();
		const skipped = evts.find((e) => e.kind === "cron-skipped");
		expect(skipped?.reason).toBe("pr-fetch-failed");
		await sch.stop();
	});
});
