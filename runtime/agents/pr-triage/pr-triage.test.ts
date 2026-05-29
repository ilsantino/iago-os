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

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { claudePty } from "../../agent-runtime/pty/claude-pty.js";
import {
	_resetRegistryForTests,
	registerRuntime,
} from "../../agent-runtime/registry.js";
import { AgentManager } from "../../daemon/agent-manager.js";
import { CronScheduler } from "../../daemon/cron-scheduler.js";
import {
	type AgentConfigShape,
	CRON_AGENT_RESTART_BACKOFF_MS,
	type TaskDispatchEvent,
	loadAgentConfig,
	loadCronEntries,
	makeTaskDispatchHandler,
	registerCronAgentWithRestart,
} from "../../daemon/main.js";
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
// Normalize CRLF → LF so case-2's literal-prompt assertion is stable across
// Windows checkouts (where git may materialize the file with CRLF endings
// depending on .gitattributes / autocrlf). claude-pty.send appends "\n"
// (LF), so the on-PTY-stdin text is always LF-suffixed; without
// normalization the test would compare CRLF<file>\n vs LF<file>\n and miss.
const REAL_PROMPT_TEMPLATE = fs
	.readFileSync(
		path.join(REPO_ROOT, "runtime/agents/pr-triage/prompt-template.md"),
		"utf8",
	)
	.replace(/\r\n/g, "\n");
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

	// Force a fresh claude-pty registration per test. The adapter
	// self-registers on module load, but other test files in the same
	// Vitest worker (e.g. runtime/agent-runtime/pty/claude-pty.test.ts)
	// call _resetRegistryForTests() which empties the registry. Without
	// this guard, makeTaskDispatchHandler → resolveRuntime("claude-pty")
	// would throw "unknown runtime" when this test runs second in a worker.
	// Use the named-export claudePty + registerRuntime (NOT vi.resetModules
	// + dynamic import, which would create a parallel module instance and
	// leave the cached agent-manager looking up the wrong registry).
	_resetRegistryForTests();
	registerRuntime(claudePty);

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
		// Negative assertions encode the GAP — when the daemon ships an env
		// allowlist that forwards Telegram/GH creds into spawned agents,
		// these assertions FLIP and force a follow-up PR to swap them for
		// positive assertions. Dual-adversarial fix.
		expect(startupCall[2].env.IAGO_TELEGRAM_BOT_TOKEN).toBeUndefined();
		expect(startupCall[2].env.IAGO_TELEGRAM_ALLOWED_USER_IDS).toBeUndefined();
		expect(startupCall[2].env.GH_TOKEN).toBeUndefined();
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
		// Normalize CRLF→LF on both sides: cron-scheduler.ts reads the
		// raw prompt file (preserves CRLF on Windows checkouts);
		// REAL_PROMPT_TEMPLATE is normalized at top of file.
		expect(taskBody.prompt.replace(/\r\n/g, "\n")).toBe(REAL_PROMPT_TEMPLATE);

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
		// claude-pty.send appends "\n" — match the normalized prompt body.
		// Normalize the actual PTY writes too so a CRLF-checkout doesn't
		// silently miss this assertion on Windows.
		const normalizedWrites = writes.map((w) => w.replace(/\r\n/g, "\n"));
		expect(normalizedWrites).toContain(`${REAL_PROMPT_TEMPLATE}\n`);
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

	it("Case 4 — PTY crash mid-run → SIGTERM + crash marker + registerCronAgentWithRestart re-spawns", async () => {
		writePrTriageFixture();
		const { register } = await buildSystem();
		await register("pr-triage");
		const pty = ptyState.last;
		expect(pty).not.toBeNull();
		if (pty === null) throw new Error("unreachable");
		const initialSpawns = mockSpawn.mock.calls.length;
		expect(initialSpawns).toBe(1);

		// Phase A — crash + kill + marker. claude-pty classifies >100 bytes
		// of unknown output as `crashed` → kills the PTY (SIGTERM) and
		// writes a .daemon-stop crash marker (fire-and-forget; see polling
		// loop below for the bounded flush).
		const noise = "completely-unrelated-noise-XYZ ".repeat(20);
		pty.emitData(noise);
		expect(pty.killCalls).toContain("SIGTERM");

		// Phase B — flush writeStopMarker. Bumped to 2s ceiling (200 × 10ms)
		// after Codex flagged 500ms could false-pass on cold Windows
		// runners where fdatasync stalls on antivirus.
		const markersDir = path.join(tempDir, "markers");
		let crashMarker: string | undefined;
		for (let i = 0; i < 200; i++) {
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

		// Phase C — restart wiring (registerCronAgentWithRestart's
		// armExitListener subscribes to onStatusChanged "crashed"|"exited"
		// and schedules a fresh registerAgent after
		// CRON_AGENT_RESTART_BACKOFF_MS[0] = 5_000ms). Wait the backoff +
		// a small grace for the scheduled registerAgent to settle, then
		// assert a second spawn landed AND a `cron-agent-restarted`
		// telemetry event was emitted.
		await new Promise((resolve) =>
			setTimeout(resolve, CRON_AGENT_RESTART_BACKOFF_MS[0] + 1_500),
		);
		const restartedEvents = emittedEventsOfKind("cron-agent-restarted");
		expect(restartedEvents).toHaveLength(1);
		expect(restartedEvents[0]).toMatchObject({
			kind: "cron-agent-restarted",
			agentId: "pr-triage",
			attempt: 1,
		});
		expect(mockSpawn.mock.calls.length).toBe(initialSpawns + 1);
	}, 15_000);

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

		// Capture the EventEmitter event (task-dispatch-needed is NOT in
		// the telemetry kind union, so we can't observe it via emitMock).
		const dispatchEvents: TaskDispatchEvent[] = [];
		mgr.on("task-dispatch-needed", (evt: TaskDispatchEvent) => {
			dispatchEvents.push(evt);
		});

		await mgr._pollingTickForTests();
		await dispatch.flush();

		expect(dispatchEvents).toHaveLength(1);
		expect(dispatchEvents[0]).toMatchObject({
			filename,
			agentId: "pr-triage",
		});

		// CURRENT behavior: dispatch handler hits malformed-task because
		// no `prompt` field on the envelope.
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

	// Dual-adversarial fix: the GAP for ndjsonAlert handling is encoded as
	// an `it.todo` so the failing-behavior contract is visible in test
	// output AND a future commit that implements the daemon branch has a
	// home to fill in. Until the daemon ships:
	//   1. processPendingTask reads `ndjsonAlert` ahead of the
	//      registration check;
	//   2. emits `pr-triage-telegram-send-failed { alertKind, details }`
	//      telemetry;
	//   3. moves the file to `tasks/resolved/` via claimTask.
	// Case 5 above asserts the current (incorrect) malformed-task path so
	// regressions in THAT codepath surface, but the desired behavior lives
	// here as a TODO so the next implementer cannot miss it.
	it.todo(
		"Case 5b — fallback envelope with ndjsonAlert emits pr-triage-telegram-send-failed + moves file to resolved (BLOCKED on daemon impl)",
	);

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
		// Codex-fix: dropped the `readdir == []` assertion. tempDir is fresh
		// per beforeEach (mkdtemp) and only register() ran before this
		// tick, so the directory cannot be non-empty regardless of
		// scheduler2's behavior — the assertion was load-bearing on
		// scheduler2 doing nothing yet probed scheduler-independent state.
		// Real scheduler2-specific assertion: zero cron-fired emissions.

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

		// NOTE on scope (Codex: "case 9 proves send-time decrement, not
		// real task completion"): the dispatch handler calls claimTask
		// immediately after runtime.send (the persistent-PTY claim-on-send
		// model documented in main.ts:546-573). The mocked PTY's `send` is
		// a synchronous stdin write, so claimTask runs synchronously after
		// the polling tick. This test proves the runningCount slot
		// PROTOCOL correctly increments on fire, blocks at maxConcurrent,
		// AND releases on the terminal `task-resolved` event for the
		// specific filename emitted by fire(). It does NOT prove that
		// maxConcurrent gates a still-running real Claude agent — that's
		// a Phase-3 concern (cron cadence shorter than agent runtime),
		// out of scope here. The decrement-chain assertion below is
		// structural (capture filename → assert in outstanding set →
		// assert removed after flush) to catch regressions in the
		// per-filename filter, NOT just the aggregate counter.

		// Tick 1 — fires cleanly. runningCount: 0 → 1. Capture the
		// emitted filename so subsequent assertions probe the SAME slot
		// rather than relying on aggregate counter changes.
		await scheduler._tickForTests();
		expect(scheduler._runningCountForTests().get("pr-triage")).toBe(1);
		const firedAfterTick1 = emittedEventsOfKind("cron-fired");
		expect(firedAfterTick1).toHaveLength(1);
		const tick1TaskFilePath = (firedAfterTick1[0] as { taskFile: string })
			.taskFile;
		const tick1Filename = path.basename(tick1TaskFilePath);
		// Outstanding-set structural check: the per-filename filter is
		// what prevents non-cron task completions from reopening cron
		// slots (cron-scheduler.ts:46-53). A regression that broke the
		// filter would still decrement runningCount but on a different
		// path; this assertion forces the filter to be probed.
		expect(
			scheduler._outstandingFilenamesForTests().get("pr-triage"),
		).toBeDefined();
		expect(
			scheduler
				._outstandingFilenamesForTests()
				.get("pr-triage")
				?.has(tick1Filename),
		).toBe(true);

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
		// Outstanding set unchanged — overlap-prevented does not add to it.
		expect(
			scheduler._outstandingFilenamesForTests().get("pr-triage")?.size,
		).toBe(1);

		// Drain the polling loop → claimTask → task-resolved →
		// runningCount decrements to 0. The per-filename outstanding
		// entry MUST also be removed (cron-scheduler.ts:399-415 — the
		// terminal listener probes outstanding.has(event.filename)
		// before decrementing). Asserting BOTH the counter and the
		// outstanding-set transition catches a regression where the
		// counter decrements via a different code path.
		await mgr._pollingTickForTests();
		await dispatch.flush();
		expect(scheduler._runningCountForTests().get("pr-triage") ?? 0).toBe(0);
		const resolvedEvents = emittedEventsOfKind("task-resolved");
		const resolvedForCron = resolvedEvents.filter(
			(e) => (e as { filename: string }).filename === tick1Filename,
		);
		expect(resolvedForCron).toHaveLength(1);
		// Outstanding entry for this agent cleared after the last
		// outstanding filename resolved (cron-scheduler.ts:410-412).
		expect(scheduler._outstandingFilenamesForTests().has("pr-triage")).toBe(
			false,
		);

		// Tick 3 — another minute on, slot free again, fires cleanly with
		// a DIFFERENT filename (positional assertion guards against a
		// double-emit on tick 1 silently satisfying length=2).
		clockMs += 60_000;
		await scheduler._tickForTests();
		expect(scheduler._runningCountForTests().get("pr-triage")).toBe(1);
		const firedAfterTick3 = emittedEventsOfKind("cron-fired");
		expect(firedAfterTick3).toHaveLength(2);
		const tick3Filename = path.basename(
			(firedAfterTick3[1] as { taskFile: string }).taskFile,
		);
		expect(tick3Filename).not.toBe(tick1Filename);
		expect(
			scheduler
				._outstandingFilenamesForTests()
				.get("pr-triage")
				?.has(tick3Filename),
		).toBe(true);

		await scheduler.stop();
	});
});
