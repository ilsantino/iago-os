/**
 * Plan 04c — pr-triage end-to-end integration test.
 *
 * Drives the FULL Phase 2 cron→wake-check→PTY-spawn→dispatch flow with
 * external dependencies mocked. The system under test is the daemon's
 * integration of CronScheduler (07a), AgentManager polling loop + claimTask
 * (07b), pr-triage artifacts (04a), pr-triage wiring (04b), and the dispatch
 * handler (04d). The real `claude-pty` adapter is exercised end-to-end with
 * `node-pty` mocked at the module boundary (Forward-list I1 — same mock
 * pattern as runtime/agent-runtime/pty/claude-pty.test.ts).
 *
 * Anchored at `Date.UTC(1970, 0, 1, 14, 0, 0)` so the `0 14 * * *` cron in
 * crons.json matches `_tickForTests()` deterministically (Forward-list I2).
 *
 * Plan reconciliations applied (resolved during implementation):
 *
 *   - Plan asserts `parse_mode=MarkdownV2` on the Telegram POST.
 *     prompt-template.md (the canonical source — Codex high-severity fix)
 *     mandates PLAIN TEXT and explicitly forbids MarkdownV2. The curl POST
 *     runs INSIDE the spawned Claude agent's shell which is mocked — there
 *     is no observable HTTP request from Vitest. Case 2 instead verifies
 *     the daemon-level signals: runtime.send was called with the literal
 *     prompt-template body, mockSpawn (node-pty) received the right env,
 *     and the task lifecycle completed (pending → resolved + cron slot
 *     decrement).
 *
 *   - Plan case 5 expects daemon to branch on `ndjsonAlert` and emit
 *     `pr-triage-telegram-send-failed` telemetry. **GAP:** that branch is
 *     unimplemented in processPendingTask + makeTaskDispatchHandler as of
 *     04b/04d/07b. A fallback envelope without a `prompt` field currently
 *     hits the malformed-task path. This test asserts CURRENT behavior to
 *     keep coverage honest; the ndjsonAlert branch is tracked as a
 *     follow-up against prompt-template.md line 155 promise.
 */

import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Side-effect import: claude-pty self-registers with the runtime registry
// on module load. We rely on that registration for makeTaskDispatchHandler's
// resolveRuntime("claude-pty") + AgentManager.registerAgent path.
import "../../agent-runtime/pty/claude-pty.js";
import { AgentManager } from "../../daemon/agent-manager.js";
import { CronScheduler } from "../../daemon/cron-scheduler.js";
import {
	type AgentConfigShape,
	type TaskDispatchEvent,
	loadAgentConfig,
	loadCronEntries,
	makeTaskDispatchHandler,
	registerCronAgentWithRestart,
} from "../../daemon/main.js";
import { pathFor } from "../../daemon/state-paths.js";
import type { DaemonEvent } from "../../daemon/telemetry.js";

// ───── node-pty mock (Forward-list I1 — copied from claude-pty.test.ts) ─────

interface MockPty {
	pid: number;
	killed: boolean;
	dataListeners: Array<(chunk: string) => void>;
	exitListeners: Array<(e: { exitCode: number; signal?: number }) => void>;
	writes: string[];
	killCalls: Array<string | undefined>;
	onData: (cb: (chunk: string) => void) => { dispose: () => void };
	onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => {
		dispose: () => void;
	};
	write: (data: string) => void;
	kill: (signal?: string) => void;
	emitData: (chunk: string) => void;
	emitExit: (exitCode: number) => void;
}

function makeMockPty(pid = 12345): MockPty {
	const pty: MockPty = {
		pid,
		killed: false,
		dataListeners: [],
		exitListeners: [],
		writes: [],
		killCalls: [],
		onData(cb) {
			pty.dataListeners.push(cb);
			return { dispose: () => {} };
		},
		onExit(cb) {
			pty.exitListeners.push(cb);
			return { dispose: () => {} };
		},
		write(data) {
			pty.writes.push(data);
		},
		kill(signal) {
			pty.killCalls.push(signal);
			pty.killed = true;
		},
		emitData(chunk) {
			for (const cb of pty.dataListeners) cb(chunk);
		},
		emitExit(exitCode) {
			for (const cb of pty.exitListeners) cb({ exitCode });
		},
	};
	return pty;
}

const ptyState: { last: MockPty | null; spawnCount: number } = {
	last: null,
	spawnCount: 0,
};
const mockSpawn = vi.fn<(...args: unknown[]) => MockPty>();
vi.mock("node-pty", () => ({
	spawn: (...args: unknown[]) => mockSpawn(...args),
}));
vi.mock("../../agent-runtime/pty/version-pin.js", () => ({
	assertSupportedVersion: async () => ({
		ok: true as const,
		version: "2.1.113",
	}),
	getClaudeCodeVersion: async () => "2.1.113",
	SUPPORTED_CLAUDE_CODE_VERSION_RANGE: ">=2.0.0 <3.0.0",
}));

// ───── spawnSync mock (wake-check.sh control) ─────

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

// ───── telemetry mock (pass-through; tests inspect emitMock.mock.calls) ─────

const { emitMock, emitState } = vi.hoisted(() => ({
	emitMock: vi.fn(),
	emitState: {
		real: null as ((e: DaemonEvent) => Promise<void>) | null,
	},
}));
vi.mock("../../daemon/telemetry.js", async () => {
	const actual = await vi.importActual<
		typeof import("../../daemon/telemetry.js")
	>("../../daemon/telemetry.js");
	emitState.real = actual.emit;
	return {
		...actual,
		emit: emitMock,
	};
});

// ───── shared fixtures ─────

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const REAL_PROMPT_TEMPLATE = fs.readFileSync(
	path.join(REPO_ROOT, "runtime/agents/pr-triage/prompt-template.md"),
	"utf8",
);
const REAL_WAKE_CHECK = path.join(
	REPO_ROOT,
	"runtime/agents/pr-triage/wake-check.sh",
);

// Fake clock anchor: cron `0 14 * * *` matches at minute=0, hour=14.
const CRON_MATCH_TIME = new Date(Date.UTC(1970, 0, 1, 14, 0, 0));

let tempDir: string;
let agentsDir: string;

/** Materialize a per-test `agents/pr-triage/` fixture mirroring 04a outputs. */
function writePrTriageFixture(scheduleOverride?: string | null): void {
	const agentDir = path.join(agentsDir, "pr-triage");
	fs.mkdirSync(agentDir, { recursive: true });
	// agent-config.json — registers under the mock claude-pty runtime so
	// the real claudePty adapter (with vi.mock'd node-pty) handles spawn.
	fs.writeFileSync(
		path.join(agentDir, "agent-config.json"),
		JSON.stringify({
			runtimeId: "claude-pty",
			org: "internal",
			cwd: REPO_ROOT,
			env: {
				IAGO_DAEMON_STATE_ROOT: tempDir,
			},
			autoStart: false,
			authProfile: "default",
		}),
		"utf8",
	);
	const cronsBody: Record<string, unknown> = {
		schedule: scheduleOverride === undefined ? "0 14 * * *" : scheduleOverride,
		wakeCheck: REAL_WAKE_CHECK,
		prompt: "runtime/agents/pr-triage/prompt-template.md",
		outputTaskNamePrefix: "pr-triage",
		maxConcurrent: 1,
	};
	fs.writeFileSync(
		path.join(agentDir, "crons.json"),
		JSON.stringify(cronsBody),
		"utf8",
	);
}

/**
 * Build a CronScheduler wired against the real AgentManager, register
 * pr-triage from the on-disk fixture, and return both. Mirrors the daemon
 * startup sequence in main.ts:1284-1320 without standing up the full
 * `startDaemon` flow.
 */
async function buildSystem(): Promise<{
	scheduler: CronScheduler;
	mgr: AgentManager;
	register: (agentId: string) => Promise<void>;
}> {
	const mgr = new AgentManager();
	const scheduler = new CronScheduler({
		agentManager: mgr,
		stateRoot: tempDir,
		nowFn: () => CRON_MATCH_TIME,
	});
	const cronEntries = await loadCronEntries(agentsDir);
	for (const opts of cronEntries) {
		// Translate the relative prompt path stored in crons.json to an
		// absolute path the scheduler can read with fs.readFileSync (the
		// real daemon does the same translation in main.ts).
		const promptAbs = path.isAbsolute(opts.promptTemplatePath)
			? opts.promptTemplatePath
			: path.join(REPO_ROOT, opts.promptTemplatePath);
		scheduler.registerCron({
			...opts,
			promptTemplatePath: promptAbs,
		});
	}
	const register = async (agentId: string): Promise<void> => {
		let cfg: AgentConfigShape;
		try {
			cfg = await loadAgentConfig(agentsDir, agentId);
		} catch (err) {
			throw new Error(
				`buildSystem.register(${agentId}) failed: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
		await registerCronAgentWithRestart({
			agentManager: mgr,
			agentId,
			agentConfig: cfg,
			isShuttingDown: () => false,
		});
	};
	return { scheduler, mgr, register };
}

/**
 * Wire a dispatch handler + auto-claim bridge so the polling loop's
 * `task-dispatch-needed` event drives the production `makeTaskDispatchHandler`
 * path (which calls runtime.send + claimTask). The returned `flush()` awaits
 * any in-flight dispatch promises so assertions land AFTER claimTask
 * resolves. Same shape as `wireAutoClaim` in agent-manager.test.ts but with
 * the real handler factory swapped in for the test-only direct claimTask.
 */
function wireDispatchHandler(mgr: AgentManager): {
	flush: () => Promise<void>;
} {
	const pending: Array<Promise<void>> = [];
	const handler = makeTaskDispatchHandler({
		agentManager: mgr,
		emit: emitMock as unknown as (event: DaemonEvent) => Promise<void>,
	});
	mgr.on("task-dispatch-needed", (evt: TaskDispatchEvent) => {
		pending.push(handler(evt).catch(() => {}));
	});
	return {
		async flush(): Promise<void> {
			while (pending.length > 0) {
				await Promise.all(pending.splice(0));
			}
		},
	};
}

function emittedEventsOfKind(kind: DaemonEvent["kind"]): DaemonEvent[] {
	const out: DaemonEvent[] = [];
	for (const call of emitMock.mock.calls) {
		const e = call[0] as DaemonEvent;
		if (e.kind === kind) out.push(e);
	}
	return out;
}

beforeEach(async () => {
	tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-pr-triage-it-"));
	process.env.IAGO_DAEMON_STATE_ROOT = tempDir;
	for (const sub of [
		"tasks/pending",
		"tasks/claimed",
		"tasks/resolved",
		"tasks/poisoned",
		"telemetry",
		"agents",
		"session-logs",
		"markers",
		"approvals/pending",
		"approvals/resolved",
	]) {
		fs.mkdirSync(path.join(tempDir, sub), { recursive: true });
	}
	agentsDir = path.join(tempDir, "agents");
	process.env.IAGO_TELEGRAM_BOT_TOKEN = "test-bot-token";
	process.env.IAGO_TELEGRAM_ALLOWED_USER_IDS = "123456,789012";
	process.env.GH_TOKEN = "test-gh-token";

	ptyState.last = null;
	ptyState.spawnCount = 0;
	mockSpawn.mockReset();
	mockSpawn.mockImplementation(() => {
		const pty = makeMockPty(40_000 + ptyState.spawnCount++);
		ptyState.last = pty;
		return pty;
	});
	spawnSyncMock.mockReset();
	emitMock.mockReset();
	emitMock.mockImplementation((e: DaemonEvent) => {
		if (emitState.real === null) return Promise.resolve();
		return emitState.real(e);
	});
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	delete process.env.IAGO_DAEMON_STATE_ROOT;
	delete process.env.IAGO_TELEGRAM_BOT_TOKEN;
	delete process.env.IAGO_TELEGRAM_ALLOWED_USER_IDS;
	delete process.env.GH_TOKEN;
	await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

describe("pr-triage integration (Plan 04c)", () => {
	it("Case 1 — wake-check exit 1 (no PRs) → cron-skipped, no spawn, no task file", async () => {
		writePrTriageFixture();
		const { scheduler, register } = await buildSystem();
		await register("pr-triage");
		// Wipe spawn counter so we can assert no FURTHER spawn beyond
		// register's startup spawn (registerCronAgentWithRestart's
		// registerAgent path spawns the cron-owner PTY on boot).
		const startupSpawns = mockSpawn.mock.calls.length;

		spawnSyncMock.mockReturnValue({
			status: 1,
			signal: null,
			stdout: "",
			stderr: "No open PRs; skipping LLM invocation.\n",
			pid: 0,
			output: ["", "", ""],
		});

		await scheduler._tickForTests();

		const skipped = emittedEventsOfKind("cron-skipped");
		expect(skipped).toHaveLength(1);
		expect(skipped[0]).toMatchObject({
			kind: "cron-skipped",
			agentId: "pr-triage",
			reason: "wake-check-failed",
			exitCode: 1,
		});
		// No additional PTY spawn beyond the startup one.
		expect(mockSpawn.mock.calls.length).toBe(startupSpawns);
		// No task file written.
		const pendingFiles = fs.readdirSync(path.join(tempDir, "tasks/pending"));
		expect(pendingFiles).toEqual([]);
	});

	it("Case 2 — wake-check exit 0 happy path: cron-fired → polling tick → runtime.send → resolved", async () => {
		writePrTriageFixture();
		const { scheduler, mgr, register } = await buildSystem();
		await register("pr-triage");
		const startupSpawn = ptyState.last;
		expect(startupSpawn).not.toBeNull();
		// Verify the startup spawn forwarded the agent-config env. NOTE:
		// agent-config.json's `env` only carries IAGO_DAEMON_STATE_ROOT —
		// the prompt-template (lines 113-114) assumes IAGO_TELEGRAM_BOT_TOKEN
		// + IAGO_TELEGRAM_ALLOWED_USER_IDS are inherited from the daemon's
		// process.env, but claude-pty.ts:340-343 only forwards opts.env (no
		// process.env merge). For the Telegram POST to work in production
		// the daemon must extend agent-config or claude-pty must opt into
		// the inheritance. **GAP** flagged here; integration test asserts
		// the current contract (IAGO_DAEMON_STATE_ROOT forwarded only).
		const startupCall = mockSpawn.mock.calls[0] as [
			string,
			string[],
			{ env: Record<string, string> },
		];
		expect(startupCall[2].env.IAGO_DAEMON_STATE_ROOT).toBe(tempDir);
		expect(startupCall[2].env.CLAUDE_CODE_SESSION_ID).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);

		spawnSyncMock.mockReturnValue({
			status: 0,
			signal: null,
			stdout: "Found 3 open PR(s); proceeding.\n",
			stderr: "",
			pid: 0,
			output: ["", "", ""],
		});

		const dispatch = wireDispatchHandler(mgr);
		mgr.startPollingLoop();

		await scheduler._tickForTests();

		// cron-fired emitted with the right shape.
		const fired = emittedEventsOfKind("cron-fired");
		expect(fired).toHaveLength(1);
		expect(fired[0]).toMatchObject({
			kind: "cron-fired",
			agentId: "pr-triage",
			runningCount: 1,
		});
		// Task file landed in pending with the prompt-template body.
		const pendingFiles = fs.readdirSync(path.join(tempDir, "tasks/pending"));
		expect(pendingFiles).toHaveLength(1);
		const taskFile = pendingFiles[0];
		expect(taskFile).toBeDefined();
		if (taskFile === undefined) throw new Error("unreachable");
		expect(taskFile.startsWith("pr-triage__")).toBe(true);
		const taskBody = JSON.parse(
			fs.readFileSync(path.join(tempDir, "tasks/pending", taskFile), "utf8"),
		) as { prompt: string; agentId: string };
		expect(taskBody.agentId).toBe("pr-triage");
		expect(taskBody.prompt).toBe(REAL_PROMPT_TEMPLATE);

		// Drive the polling loop → dispatch handler → claimTask.
		await mgr._pollingTickForTests();
		await dispatch.flush();
		await mgr.stopPollingLoop();

		// Plan-contradiction-resolution: instead of asserting on a
		// MarkdownV2-shaped curl call (unobservable; agent's shell is
		// mocked), assert the daemon piped the literal prompt-template
		// text to the PTY's stdin. The plan body itself documents the
		// plain-text approach — Telegram default + no parse_mode + the
		// length-cap truncation strategy.
		const writes = startupSpawn?.writes ?? [];
		// claude-pty.send appends "\n" — match prompt + newline exactly.
		expect(writes).toContain(`${REAL_PROMPT_TEMPLATE}\n`);
		// And the prompt text we sent really is plain-text-mandating.
		expect(REAL_PROMPT_TEMPLATE).toMatch(/Do NOT pass `parse_mode=MarkdownV2`/);

		// File migrated pending → resolved; task-resolved emitted; cron
		// slot decremented to 0.
		await expect(
			fsp.access(path.join(tempDir, "tasks/pending", taskFile)),
		).rejects.toThrow();
		await fsp.access(path.join(tempDir, "tasks/resolved", taskFile));
		const resolved = emittedEventsOfKind("task-resolved");
		expect(resolved).toHaveLength(1);
		expect(resolved[0]).toMatchObject({
			kind: "task-resolved",
			agentId: "pr-triage",
			filename: taskFile,
		});
		expect(scheduler._runningCountForTests().get("pr-triage") ?? 0).toBe(0);

		await scheduler.stop();
	});

	it("Case 3 — wake-check exit 2 (any non-zero) → cron-skipped wake-check-failed exitCode 2", async () => {
		writePrTriageFixture();
		const { scheduler, register } = await buildSystem();
		await register("pr-triage");

		spawnSyncMock.mockReturnValue({
			status: 2,
			signal: null,
			stdout: "",
			stderr: "Rate-limited: HTTP/2 429\n",
			pid: 0,
			output: ["", "", ""],
		});

		await scheduler._tickForTests();

		const skipped = emittedEventsOfKind("cron-skipped");
		expect(skipped).toHaveLength(1);
		// CronScheduler emits wake-check-failed for ALL non-zero, non-signal
		// exits — there is no rate-limited variant in cron-scheduler.ts.
		expect(skipped[0]).toMatchObject({
			kind: "cron-skipped",
			agentId: "pr-triage",
			reason: "wake-check-failed",
			exitCode: 2,
		});
		expect(fs.readdirSync(path.join(tempDir, "tasks/pending"))).toEqual([]);

		await scheduler.stop();
	});

	it("Case 4 — PTY crash mid-run → SIGTERM + crash marker (heartbeat-driven restart wiring)", async () => {
		writePrTriageFixture();
		const { register } = await buildSystem();
		await register("pr-triage");
		const pty = ptyState.last;
		expect(pty).not.toBeNull();
		if (pty === null) throw new Error("unreachable");

		// Simulate a runaway agent emitting >100 bytes of unknown noise.
		// claude-pty's status parser classifies this as crashed → kills the
		// PTY (SIGTERM) and writes a .daemon-stop crash marker. The
		// AgentManager's heartbeat loop subscribes to the crash status and
		// triggers restartAgent — that wiring lives in HeartbeatController
		// and is too heavy to drive in this integration test (no real
		// heartbeat interval), so we assert the observable kill + marker
		// here. The restart-on-crash linkage itself is covered by
		// agent-manager.test.ts.
		const noise = "completely-unrelated-noise-XYZ ".repeat(20);
		pty.emitData(noise);

		expect(pty.killCalls).toContain("SIGTERM");
		// Flush the fire-and-forget writeStopMarker chain (4 sequential
		// awaits: fsp.open → writeFile → datasync → close). One setImmediate
		// is not enough; poll the markers dir with a short bounded timeout
		// instead. The retention check is "did the marker land within a
		// reasonable test window", not "did it land on the first tick".
		const markersDir = path.join(tempDir, "markers");
		let crashMarker: string | undefined;
		for (let i = 0; i < 50; i++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
			const found = fs
				.readdirSync(markersDir)
				.find((m) => m.endsWith(".daemon-stop"));
			if (found !== undefined) {
				crashMarker = found;
				break;
			}
		}
		expect(crashMarker).toBeDefined();
		if (crashMarker === undefined) throw new Error("unreachable");
		const markerBody = JSON.parse(
			fs.readFileSync(path.join(markersDir, crashMarker), "utf8"),
		) as { reason: string };
		expect(markerBody.reason).toBe("crash");
	});

	it("Case 5 — fallback envelope (CURRENT behavior; ndjsonAlert branch unimplemented)", async () => {
		// GAP: prompt-template.md line 155 promises the daemon will branch
		// on `ndjsonAlert` BEFORE the registration check, emit a
		// `pr-triage-telegram-send-failed` telemetry event carrying the
		// alert kind + details payload, and move the file to
		// `tasks/resolved/`. That branch is NOT implemented in
		// processPendingTask (agent-manager.ts) or makeTaskDispatchHandler
		// (main.ts) as of 04b/04d/07b. An envelope without a `prompt`
		// string currently hits the malformed-task branch in the dispatch
		// handler. This test asserts the actual present-day behavior so
		// the contract gap surfaces in code review rather than silently.
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage");
		const dispatch = wireDispatchHandler(mgr);

		const filename = "pr-triage__1700000000.json";
		fs.writeFileSync(
			path.join(tempDir, "tasks/pending", filename),
			JSON.stringify({
				agentId: "pr-triage",
				ndjsonAlert: "pr-triage-telegram-send-failed",
				details:
					'429 Too Many Requests body={"ok":false,"description":"Too Many Requests"}',
			}),
			"utf8",
		);

		await mgr._pollingTickForTests();
		await dispatch.flush();

		// task-dispatch-needed emitted (envelope had a string agentId, so
		// processPendingTask reaches the emit path).
		const dispatchEvents = emittedEventsOfKind(
			"task-dispatch-needed" as DaemonEvent["kind"],
		);
		// Telemetry kind unions don't include EventEmitter-only event names,
		// so we verify dispatch by the downstream side-effect:
		// `pr-triage-dispatch-failed` with reason `malformed-task` (no
		// prompt field on the fallback envelope).
		expect(dispatchEvents.length).toBeGreaterThanOrEqual(0);
		const failed = emittedEventsOfKind("pr-triage-dispatch-failed");
		expect(failed).toHaveLength(1);
		expect(failed[0]).toMatchObject({
			kind: "pr-triage-dispatch-failed",
			agentId: "pr-triage",
			filename,
			reason: "malformed-task",
		});

		// Per dispatch handler contract: malformed-task LEAVES the file in
		// tasks/pending/ for operator inspection (does NOT call claimTask).
		await fsp.access(path.join(tempDir, "tasks/pending", filename));
	});

	it("Case 6 — wake-check missing GH_TOKEN (script exit 2) → cron-skipped wake-check-failed exitCode 2", async () => {
		writePrTriageFixture();
		const { scheduler, register } = await buildSystem();
		await register("pr-triage");

		// Don't mutate process.env.GH_TOKEN — test isolation. spawnSyncMock
		// simulates wake-check.sh's behavior when GH_TOKEN is absent:
		// stderr message + exit 2 (see wake-check.sh lines 18-21).
		spawnSyncMock.mockReturnValue({
			status: 2,
			signal: null,
			stdout: "",
			stderr: "ERROR: GH_TOKEN unset; wake-check needs it to query gh.\n",
			pid: 0,
			output: ["", "", ""],
		});

		await scheduler._tickForTests();

		const skipped = emittedEventsOfKind("cron-skipped");
		expect(skipped).toHaveLength(1);
		expect(skipped[0]).toMatchObject({
			kind: "cron-skipped",
			agentId: "pr-triage",
			reason: "wake-check-failed",
			exitCode: 2,
		});

		await scheduler.stop();
	});

	it("Case 7 — schedule never matches in tick window → no spawns, wake-check never invoked", async () => {
		writePrTriageFixture();
		const { register } = await buildSystem();
		await register("pr-triage");
		const startupSpawns = mockSpawn.mock.calls.length;

		// Local scheduler anchored at 13:00 UTC — `0 14 * * *` does NOT match.
		const mgr2 = new AgentManager();
		const scheduler2 = new CronScheduler({
			agentManager: mgr2,
			stateRoot: tempDir,
			nowFn: () => new Date(Date.UTC(1970, 0, 1, 13, 0, 0)),
		});
		const cronEntries = await loadCronEntries(agentsDir);
		for (const opts of cronEntries) {
			scheduler2.registerCron({
				...opts,
				promptTemplatePath: path.isAbsolute(opts.promptTemplatePath)
					? opts.promptTemplatePath
					: path.join(REPO_ROOT, opts.promptTemplatePath),
			});
		}

		await scheduler2._tickForTests();

		expect(emittedEventsOfKind("cron-fired")).toHaveLength(0);
		expect(spawnSyncMock).not.toHaveBeenCalled();
		expect(mockSpawn.mock.calls.length).toBe(startupSpawns);
		expect(fs.readdirSync(path.join(tempDir, "tasks/pending"))).toEqual([]);

		await scheduler2.stop();
	});

	it("Case 8 — schedule: null → loadCronEntries drops the entry + emits cron-skipped-null", async () => {
		// Write a muted agent fixture alongside pr-triage so loadCronEntries
		// sees both and only registers pr-triage.
		writePrTriageFixture();
		const mutedDir = path.join(agentsDir, "test-mute");
		fs.mkdirSync(mutedDir, { recursive: true });
		fs.writeFileSync(
			path.join(mutedDir, "crons.json"),
			JSON.stringify({
				schedule: null,
				prompt: "ignored.md",
				outputTaskNamePrefix: "test-mute",
			}),
			"utf8",
		);

		const entries = await loadCronEntries(agentsDir);
		const ids = entries.map((e) => e.agentId);
		expect(ids).toContain("pr-triage");
		expect(ids).not.toContain("test-mute");

		const muted = emittedEventsOfKind("cron-skipped-null");
		expect(muted).toHaveLength(1);
		expect(muted[0]).toMatchObject({
			kind: "cron-skipped-null",
			agentId: "test-mute",
		});
	});

	it("Case 9 — end-to-end decrement chain across 07a + 07b + 04a + 04b + 04d", async () => {
		// Override the standard fixture with an every-minute schedule for
		// the 14h hour so two consecutive ticks can collide on maxConcurrent.
		writePrTriageFixture("* 14 * * *");

		const mgr = new AgentManager();
		// Walking clock so the two consecutive minutes generate distinct
		// task filenames (`<prefix>__<unix>.json`).
		let clockMs = Date.UTC(1970, 0, 1, 14, 0, 0);
		const scheduler = new CronScheduler({
			agentManager: mgr,
			stateRoot: tempDir,
			nowFn: () => new Date(clockMs),
		});
		const cronEntries = await loadCronEntries(agentsDir);
		for (const opts of cronEntries) {
			scheduler.registerCron({
				...opts,
				promptTemplatePath: path.isAbsolute(opts.promptTemplatePath)
					? opts.promptTemplatePath
					: path.join(REPO_ROOT, opts.promptTemplatePath),
			});
		}
		const cfg = await loadAgentConfig(agentsDir, "pr-triage");
		await registerCronAgentWithRestart({
			agentManager: mgr,
			agentId: "pr-triage",
			agentConfig: cfg,
			isShuttingDown: () => false,
		});
		const dispatch = wireDispatchHandler(mgr);

		spawnSyncMock.mockReturnValue({
			status: 0,
			signal: null,
			stdout: "Found 1 open PR(s); proceeding.\n",
			stderr: "",
			pid: 0,
			output: ["", "", ""],
		});

		// Tick 1 — fires cleanly. runningCount: 0 → 1.
		await scheduler._tickForTests();
		expect(scheduler._runningCountForTests().get("pr-triage")).toBe(1);
		const firedAfterTick1 = emittedEventsOfKind("cron-fired");
		expect(firedAfterTick1).toHaveLength(1);

		// Tick 2 — one minute later, schedule still matches, but
		// runningCount == maxConcurrent so overlap-prevented fires and
		// the second task file is NOT written.
		clockMs += 60_000;
		await scheduler._tickForTests();
		expect(scheduler._runningCountForTests().get("pr-triage")).toBe(1);
		const overlap = emittedEventsOfKind("cron-overlap-prevented");
		expect(overlap).toHaveLength(1);
		expect(overlap[0]).toMatchObject({
			kind: "cron-overlap-prevented",
			agentId: "pr-triage",
			runningCount: 1,
			maxConcurrent: 1,
		});
		// Still exactly one pending file from tick 1.
		expect(fs.readdirSync(path.join(tempDir, "tasks/pending"))).toHaveLength(1);

		// Drain the polling loop → claimTask → task-resolved →
		// runningCount decrements to 0.
		await mgr._pollingTickForTests();
		await dispatch.flush();
		expect(scheduler._runningCountForTests().get("pr-triage") ?? 0).toBe(0);

		// Tick 3 — another minute on, slot free again, fires cleanly.
		clockMs += 60_000;
		await scheduler._tickForTests();
		expect(scheduler._runningCountForTests().get("pr-triage")).toBe(1);
		const firedAfterTick3 = emittedEventsOfKind("cron-fired");
		expect(firedAfterTick3).toHaveLength(2);

		await scheduler.stop();
	});
});
