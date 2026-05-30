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
import {
	AgentManager,
	JSON_PARSE_RETRY_BUDGET,
} from "../../daemon/agent-manager.js";
import { CronScheduler } from "../../daemon/cron-scheduler.js";
import {
	type AgentConfigShape,
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

const { emitMock } = vi.hoisted(() => ({
	emitMock: vi.fn(),
}));
vi.mock("../../daemon/telemetry.js", async () => {
	const actual = await vi.importActual<
		typeof import("../../daemon/telemetry.js")
	>("../../daemon/telemetry.js");
	// Opus I5: install the implementation ONCE, at module load, so emitMock is
	// NEVER a bare mock — beforeEach uses mockClear() (call history only, impl
	// preserved), so no test observes an unconfigured emit (a mockReset()+re-set
	// pair previously left a window where emit dropped events).
	//
	// The implementation records the call and resolves `true`. The integration
	// suite inspects emitMock.mock.calls for emitted EVENTS; it does NOT read
	// real telemetry files (telemetry.test.ts owns persistence). The daemon's
	// emit() now returns whether the durable write landed, and `true` is the
	// normal case. Returning a fixed value (rather than delegating to the real
	// writer) decouples this suite from the real telemetry writer's
	// filesystem/env state — a cross-suite IAGO_DAEMON_STATE_ROOT race could
	// otherwise make a real write fail and, via the ndjsonAlert durability gate
	// (Codex Medium), wrongly flip the alert-resolution outcome. Case 12
	// overrides this to `false` to exercise the write-failure branch.
	emitMock.mockImplementation(() => Promise.resolve(true));
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
	register: (
		agentId: string,
		opts?: { backoffMs?: readonly number[] },
	) => Promise<void>;
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
	const register = async (
		agentId: string,
		opts?: { backoffMs?: readonly number[] },
	): Promise<void> => {
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
			...(opts?.backoffMs !== undefined ? { backoffMs: opts.backoffMs } : {}),
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
	// Re-install emitMock's implementation EVERY test. afterEach's
	// `vi.restoreAllMocks()` strips it (mockRestore on a vi.fn() clears the
	// impl), so the one-time vi.mock-factory install would leave emit returning
	// `undefined` from the 2nd test onward. The daemon's ndjsonAlert durability
	// gate checks emit's boolean return, so emit MUST resolve `true` here (the
	// normal "durably recorded" case). Setting it in beforeEach is
	// synchronous — there is no window where emit lacks an impl (Opus I5).
	// Case 12 overrides this to `false` to exercise the write-failure branch.
	emitMock.mockClear();
	emitMock.mockImplementation(() => Promise.resolve(true));
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	// Computed-key `delete` (not `delete process.env.X`) truly unsets each var
	// for test isolation while staying Biome-clean: `noDelete` flags only static
	// member deletes, and the autofix it would apply to those (`= undefined`)
	// coerces the value to the literal string "undefined". Matches the
	// loop-delete idiom in daemon/config.test.ts and daemon/sighup.test.ts.
	for (const key of [
		"IAGO_DAEMON_STATE_ROOT",
		"IAGO_TELEGRAM_BOT_TOKEN",
		"IAGO_TELEGRAM_ALLOWED_USER_IDS",
		"GH_TOKEN",
	]) {
		delete process.env[key];
	}
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
		// Verify the startup spawn forwarded the agent-config env PLUS the
		// org-gated daemon secrets. agent-config.json's `env` carries only
		// IAGO_DAEMON_STATE_ROOT, but the prompt-template (lines 113-114)
		// needs IAGO_TELEGRAM_BOT_TOKEN + IAGO_TELEGRAM_ALLOWED_USER_IDS +
		// GH_TOKEN to post its report and query GitHub. Because the fixture
		// agent-config sets `org: "internal"`, registerCronAgentWithRestart's
		// composeAgentEnv merges those three from process.env (the
		// CRON_AGENT_ENV_ALLOWLIST) into the spawn env. claude-pty.ts is
		// untouched — its CRITICAL #1 no-process.env-merge invariant holds;
		// the daemon is the trusted layer that composes its own creds.
		const startupCall = mockSpawn.mock.calls[0] as [
			string,
			string[],
			{ env: Record<string, string> },
		];
		expect(startupCall[2].env.IAGO_DAEMON_STATE_ROOT).toBe(tempDir);
		// Org-gated allowlist (Codex H2 close) forwards the daemon's
		// Telegram/GH creds into the internal cron agent's spawn env. Values
		// match the beforeEach fixture set on process.env.
		expect(startupCall[2].env.IAGO_TELEGRAM_BOT_TOKEN).toBe("test-bot-token");
		expect(startupCall[2].env.IAGO_TELEGRAM_ALLOWED_USER_IDS).toBe(
			"123456,789012",
		);
		expect(startupCall[2].env.GH_TOKEN).toBe("test-gh-token");
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
		// brief D3 — inject a tiny restart backoff so the real-timer restart
		// fires in ~10ms instead of the production 5s. Real timers stay
		// throughout (Phase B's marker poll is real fs I/O that fake timers
		// can't flush); only the backoff value is shortened.
		await register("pr-triage", { backoffMs: [10] });
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

		// Phase B — flush writeStopMarker. Real-I/O poll, not a fixed sleep:
		// up to 200 iterations, each sleeping 10ms before re-checking, so the
		// ceiling is 200 × 10ms = 2000ms = 2s — and it breaks the instant the
		// .daemon-stop marker appears. Bumped from the original 500ms (50 ×
		// 10ms) after Codex flagged that 500ms could false-pass on cold
		// Windows runners where fdatasync stalls on antivirus.
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
		// and schedules a fresh registerAgent after the injected backoff —
		// 10ms here, not the production 5_000ms). Wait the backoff + a small
		// grace for the scheduled registerAgent to settle, then assert a
		// second spawn landed AND a `cron-agent-restarted` telemetry event
		// was emitted. Asserts the restart MECHANISM, not the literal delay.
		await new Promise((resolve) => setTimeout(resolve, 100));
		const restartedEvents = emittedEventsOfKind("cron-agent-restarted");
		expect(restartedEvents).toHaveLength(1);
		expect(restartedEvents[0]).toMatchObject({
			kind: "cron-agent-restarted",
			agentId: "pr-triage",
			attempt: 1,
		});
		expect(mockSpawn.mock.calls.length).toBe(initialSpawns + 1);

		// composeAgentEnv restart-env regression (pr84): the RESTART
		// re-registration must re-compose the org-gated daemon secrets, NOT
		// drop them — a restarted pr-triage agent that lost
		// IAGO_TELEGRAM_BOT_TOKEN / IAGO_TELEGRAM_ALLOWED_USER_IDS / GH_TOKEN
		// cannot post its report or query GitHub. registerCronAgentWithRestart's
		// scheduleRestart calls registerAgent with composeAgentEnv() (same path
		// as the initial spawn), so the LAST spawn (the restart) carries the
		// same three creds asserted on the initial spawn in Case 2.
		const restartCall = mockSpawn.mock.calls[
			mockSpawn.mock.calls.length - 1
		] as [string, string[], { env: Record<string, string> }];
		expect(restartCall[2].env.IAGO_TELEGRAM_BOT_TOKEN).toBe("test-bot-token");
		expect(restartCall[2].env.IAGO_TELEGRAM_ALLOWED_USER_IDS).toBe(
			"123456,789012",
		);
		expect(restartCall[2].env.GH_TOKEN).toBe("test-gh-token");
	}, 15_000);

	it("Case 5 — ndjsonAlert envelope → pr-triage-telegram-send-failed + resolved (Codex H1 close)", async () => {
		// prompt-template.md lines 145-148,180: when the agent's Telegram
		// POST fails it writes an `ndjsonAlert` fallback envelope (no
		// `prompt`). The daemon branches on it in processPendingTask
		// (agent-manager.ts) BEFORE the registration check — emits
		// `pr-triage-telegram-send-failed { alertKind, details }`, moves the
		// file pending→resolved via claimTask, and NEVER advances to the
		// dispatch path (so the prompt-less envelope cannot be mis-classified
		// as malformed-task). This is the FLIPPED contract: the prior
		// revision asserted the broken malformed-task path "to stay honest"
		// while production was wrong — Codex H1 correctly flagged that
		// green-locks the broken path. The assertions below now assert the
		// CORRECT behavior, so they fail against pre-change prod and pass
		// after (they ARE the regression test for the daemon branch).
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage");
		const dispatch = wireDispatchHandler(mgr);

		const filename = "pr-triage__1700000000.json";
		const details =
			'429 Too Many Requests body={"ok":false,"description":"Too Many Requests"}';
		fs.writeFileSync(
			path.join(tempDir, "tasks/pending", filename),
			JSON.stringify({
				agentId: "pr-triage",
				ndjsonAlert: "pr-triage-telegram-send-failed",
				details,
			}),
			"utf8",
		);

		// Capture the EventEmitter event. With the short-circuit in
		// processPendingTask the alert is handled BEFORE the
		// `task-dispatch-needed` emit, so this listener MUST stay empty —
		// flipped from the old toHaveLength(1) as positive proof the
		// short-circuit fires.
		const dispatchEvents: TaskDispatchEvent[] = [];
		mgr.on("task-dispatch-needed", (evt: TaskDispatchEvent) => {
			dispatchEvents.push(evt);
		});

		await mgr._pollingTickForTests();
		await dispatch.flush();

		// (a) Exactly one pr-triage-telegram-send-failed; alertKind +
		// details mirror the envelope verbatim.
		const alerts = emittedEventsOfKind("pr-triage-telegram-send-failed");
		expect(alerts).toHaveLength(1);
		expect(alerts[0]).toMatchObject({
			kind: "pr-triage-telegram-send-failed",
			agentId: "pr-triage",
			filename,
			alertKind: "pr-triage-telegram-send-failed",
			details,
		});
		// (b) File moved pending → resolved.
		await fsp.access(path.join(tempDir, "tasks/resolved", filename));
		await expect(
			fsp.access(path.join(tempDir, "tasks/pending", filename)),
		).rejects.toThrow();
		// (c) NO dispatch-failed — the prompt-less alert envelope must never
		// be mis-classified as malformed-task.
		expect(emittedEventsOfKind("pr-triage-dispatch-failed")).toHaveLength(0);
		// (d) Short-circuit proof: the alert never reached the dispatch path.
		expect(dispatchEvents).toHaveLength(0);

		// Idempotency / no double-resolve (Opus I3): a second polling tick
		// must NOT re-emit or re-resolve. The file already moved to
		// resolved/, so the next readdir of pending/ finds nothing for this
		// filename — still exactly one alert total.
		await mgr._pollingTickForTests();
		await dispatch.flush();
		expect(emittedEventsOfKind("pr-triage-telegram-send-failed")).toHaveLength(
			1,
		);
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
		// model documented in main.ts). The mocked PTY's `send` resolves
		// immediately, so once `await dispatch.flush()` drains the in-flight
		// dispatch promise, claimTask has run and `task-resolved` has been
		// emitted — the assertions below therefore land AFTER the resolve,
		// not on a synchronous side-effect. This test proves the runningCount
		// slot PROTOCOL correctly increments on fire, blocks at
		// maxConcurrent, AND releases on the terminal `task-resolved` event
		// for the specific filename emitted by the cron fire. It does NOT
		// prove that maxConcurrent gates a still-running real Claude agent —
		// that's a Phase-3 concern (cron cadence shorter than agent runtime),
		// out of scope here. The decrement-chain assertions below are
		// structural — capture the cron filename, assert it is present in the
		// agent's per-filename outstanding set, then assert it is removed
		// after flush — to catch regressions in the per-filename
		// outstanding-set filter (cron-scheduler.ts) that stops a non-cron
		// task completion from reopening a cron slot, NOT merely the
		// aggregate runningCount counter.

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

	it("Case 10 — secret gate: a non-trusted cron agent self-labeling org:internal does NOT inherit daemon secrets (Codex H2)", async () => {
		// composeAgentEnv gates the daemon's CRON_AGENT_ENV_ALLOWLIST secrets on
		// membership in the daemon-owned CRON_AGENT_SECRET_TRUSTED_AGENTS set,
		// keyed on the daemon-controlled agentId — NOT on the self-declared
		// `agentConfig.org`. A less-trusted agent that writes org:"internal" in
		// its own agent-config must still receive ONLY its declared env, never
		// the Telegram/GH creds. Fails pre-fix (the old `org === "internal"`
		// gate forwarded them on the spoofed field); passes post-fix.
		const rogueDir = path.join(agentsDir, "rogue-agent");
		fs.mkdirSync(rogueDir, { recursive: true });
		fs.writeFileSync(
			path.join(rogueDir, "agent-config.json"),
			JSON.stringify({
				runtimeId: "claude-pty",
				org: "internal", // self-declared — must NOT be honored for secrets
				cwd: REPO_ROOT,
				env: { IAGO_DAEMON_STATE_ROOT: tempDir },
				autoStart: false,
				authProfile: "default",
			}),
			"utf8",
		);
		const rogueCfg = await loadAgentConfig(agentsDir, "rogue-agent");
		const rogueMgr = new AgentManager();
		await registerCronAgentWithRestart({
			agentManager: rogueMgr,
			agentId: "rogue-agent",
			agentConfig: rogueCfg,
			isShuttingDown: () => false,
		});
		const rogueCall = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1] as [
			string,
			string[],
			{ env: Record<string, string> },
		];
		expect(rogueCall).toBeDefined();
		// Declared env preserved…
		expect(rogueCall[2].env.IAGO_DAEMON_STATE_ROOT).toBe(tempDir);
		// …but NONE of the daemon secrets leak to the untrusted agent.
		expect(rogueCall[2].env.IAGO_TELEGRAM_BOT_TOKEN).toBeUndefined();
		expect(rogueCall[2].env.IAGO_TELEGRAM_ALLOWED_USER_IDS).toBeUndefined();
		expect(rogueCall[2].env.GH_TOKEN).toBeUndefined();

		// Positive control: the trusted pr-triage agentId DOES receive them, so
		// the gate's effect is the trust list, not a blanket denial.
		writePrTriageFixture();
		const trustedCfg = await loadAgentConfig(agentsDir, "pr-triage");
		const trustedMgr = new AgentManager();
		await registerCronAgentWithRestart({
			agentManager: trustedMgr,
			agentId: "pr-triage",
			agentConfig: trustedCfg,
			isShuttingDown: () => false,
		});
		const trustedCall = mockSpawn.mock.calls[
			mockSpawn.mock.calls.length - 1
		] as [string, string[], { env: Record<string, string> }];
		expect(trustedCall[2].env.IAGO_TELEGRAM_BOT_TOKEN).toBe("test-bot-token");
		expect(trustedCall[2].env.GH_TOKEN).toBe("test-gh-token");
	});

	it("Case 11 — ndjsonAlert scoping: alert branch fires ONLY for pr-triage + a known kind (Codex H1)", async () => {
		// The record-and-resolve alert branch is scoped to (a) agentId
		// "pr-triage", (b) a known PR_TRIAGE_ALERT_KINDS value, (c) prompt-less.
		// tasks/pending is the SHARED task bus, so without scoping a task for
		// another agent — or an unknown alert kind — carrying `ndjsonAlert`
		// would skip dispatch, get silently resolved, and could release a cron
		// slot it does not own. Both negatives below must NOT emit a
		// telegram-send-failed alert.
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage");
		const dispatch = wireDispatchHandler(mgr);

		// (1) Foreign (unregistered) agent with a valid-looking alert envelope
		// → alert branch skipped (agentId !== "pr-triage") → task-unrouted,
		// file left in pending/ (NOT resolved-as-alert).
		const foreign = "rogue-agent__1700000001.json";
		fs.writeFileSync(
			path.join(tempDir, "tasks/pending", foreign),
			JSON.stringify({
				agentId: "rogue-agent",
				ndjsonAlert: "pr-triage-telegram-send-failed",
				details: "spoofed alert from a foreign agent",
			}),
			"utf8",
		);
		// (2) pr-triage with an UNKNOWN alert kind + no prompt → alert branch
		// skipped (kind not in the set) → falls through to dispatch → no prompt
		// → malformed-task, NOT a telegram-send-failed alert.
		const unknownKind = "pr-triage__1700000002.json";
		fs.writeFileSync(
			path.join(tempDir, "tasks/pending", unknownKind),
			JSON.stringify({
				agentId: "pr-triage",
				ndjsonAlert: "totally-unknown-alert-kind",
			}),
			"utf8",
		);

		await mgr._pollingTickForTests();
		await dispatch.flush();

		// Neither envelope produced an alert resolution.
		expect(emittedEventsOfKind("pr-triage-telegram-send-failed")).toHaveLength(
			0,
		);
		// Foreign agent → task-unrouted, file untouched in pending/, never
		// moved to resolved/.
		expect(
			emittedEventsOfKind("task-unrouted").some(
				(e) => (e as { filename: string }).filename === foreign,
			),
		).toBe(true);
		await fsp.access(path.join(tempDir, "tasks/pending", foreign));
		expect(fs.existsSync(path.join(tempDir, "tasks/resolved", foreign))).toBe(
			false,
		);
		// Unknown-kind pr-triage envelope fell through to the dispatch path and
		// was rejected as malformed-task (no prompt) — never resolved-as-alert.
		expect(
			emittedEventsOfKind("pr-triage-dispatch-failed").some(
				(e) =>
					(e as { filename: string }).filename === unknownKind &&
					(e as { reason: string }).reason === "malformed-task",
			),
		).toBe(true);
	});

	it("Case 12 — ndjsonAlert is NOT resolved when its telemetry record fails to persist (Codex Medium)", async () => {
		// emit() returns false on a degraded telemetry dir (it swallows the
		// append error internally). The alert branch must NOT claim/resolve the
		// fallback file in that case — resolving would silently lose the
		// double-failure signal AND stop the task from retrying. Simulate the
		// failed durable write by making the telemetry mock return false for
		// this tick, then assert the file stays in pending/.
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage");

		const filename = "pr-triage__1700000003.json";
		fs.writeFileSync(
			path.join(tempDir, "tasks/pending", filename),
			JSON.stringify({
				agentId: "pr-triage",
				ndjsonAlert: "pr-triage-telegram-send-failed",
				details: "telemetry-degraded path",
			}),
			"utf8",
		);

		// Telemetry write fails (returns false) for this tick.
		emitMock.mockImplementation(() => Promise.resolve(false));

		await mgr._pollingTickForTests();

		// The alert branch fired (attempted to record the event)…
		expect(emittedEventsOfKind("pr-triage-telegram-send-failed")).toHaveLength(
			1,
		);
		// …but the file was NOT resolved — left in pending/ for the next tick
		// to retry, because the durable write failed.
		await fsp.access(path.join(tempDir, "tasks/pending", filename));
		expect(fs.existsSync(path.join(tempDir, "tasks/resolved", filename))).toBe(
			false,
		);
	});

	it.skipIf(process.platform === "win32")(
		"Case 13 — persisted agent config is written mode 0600 (Codex H at-rest)",
		async () => {
			// The cron-agent env allowlist injects daemon secrets (Telegram bot
			// token, GH PAT) into the persisted config; persistAgentConfig must
			// write it 0600 so other local users on the POSIX VPS cannot read the
			// credentials. POSIX-only — NTFS ignores POSIX mode bits.
			writePrTriageFixture();
			const { register } = await buildSystem();
			await register("pr-triage");
			const agentsDirPath = path.join(tempDir, "agents");
			const persisted = fs
				.readdirSync(agentsDirPath)
				.filter(
					(f) =>
						f.endsWith(".json") &&
						fs.statSync(path.join(agentsDirPath, f)).isFile(),
				);
			expect(persisted.length).toBeGreaterThanOrEqual(1);
			for (const f of persisted) {
				const mode = fs.statSync(path.join(agentsDirPath, f)).mode & 0o777;
				expect(mode).toBe(0o600);
			}
		},
	);

	it("Case 14 — pr-triage-double-failure envelope → telemetry alertKind=double-failure + resolved (pr84 Codex H)", async () => {
		// prompt-template.md's double-failure path (the failure-path Telegram
		// POST ALSO returns non-200) writes a SECOND fallback envelope with
		// `ndjsonAlert: "pr-triage-double-failure"`. There is NO distinct
		// `agent-alert` telemetry kind — processPendingTask emits the single
		// `pr-triage-telegram-send-failed` event whose `alertKind` field carries
		// the verbatim `ndjsonAlert` value, so an operator filters double-
		// failures on `alertKind === "pr-triage-double-failure"`. This mirrors
		// Case 5's structure for the double-failure kind. Fails pre-fix (the old
		// prompt-template promised an `agent-alert` kind that the daemon never
		// emitted); passes after — it IS the regression test for the
		// double-failure → telemetry contract.
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage");
		const dispatch = wireDispatchHandler(mgr);

		const filename = "pr-triage__1700000004.json";
		const details = "gh: HTTP 502 Bad Gateway; telegram-status 500";
		fs.writeFileSync(
			path.join(tempDir, "tasks/pending", filename),
			JSON.stringify({
				agentId: "pr-triage",
				ndjsonAlert: "pr-triage-double-failure",
				details,
			}),
			"utf8",
		);

		// Short-circuit proof: the alert is handled BEFORE the dispatch emit, so
		// this listener MUST stay empty.
		const dispatchEvents: TaskDispatchEvent[] = [];
		mgr.on("task-dispatch-needed", (evt: TaskDispatchEvent) => {
			dispatchEvents.push(evt);
		});

		await mgr._pollingTickForTests();
		await dispatch.flush();

		// (a) Exactly one pr-triage-telegram-send-failed; alertKind carries the
		// verbatim double-failure value (NOT an `agent-alert` kind).
		const alerts = emittedEventsOfKind("pr-triage-telegram-send-failed");
		expect(alerts).toHaveLength(1);
		expect(alerts[0]).toMatchObject({
			kind: "pr-triage-telegram-send-failed",
			agentId: "pr-triage",
			filename,
			alertKind: "pr-triage-double-failure",
			details,
		});
		// (b) File moved pending → resolved.
		await fsp.access(path.join(tempDir, "tasks/resolved", filename));
		await expect(
			fsp.access(path.join(tempDir, "tasks/pending", filename)),
		).rejects.toThrow();
		// (c) Never mis-classified as malformed-task; never reached dispatch.
		expect(emittedEventsOfKind("pr-triage-dispatch-failed")).toHaveLength(0);
		expect(dispatchEvents).toHaveLength(0);
	});

	it("Case 15 — consumer tolerance: transient unparseable .json is NOT poisoned, retried, then resolves (pr84 Codex consumer-tolerance)", async () => {
		// A producer that writes its task file directly (bypassing the atomic
		// `.tmp`-then-`mv` discipline) can be caught mid-write by a 5s polling
		// tick, yielding a TRANSIENT JSON.parse failure on a file that becomes
		// valid microseconds later. Poisoning on the FIRST failure permanently
		// loses that task. The consumer grants JSON_PARSE_RETRY_BUDGET ticks of
		// grace: the file stays in pending/ and is re-read next tick. Fails
		// pre-fix (first parse failure poisoned the file immediately); passes
		// after.
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage");
		const dispatch = wireDispatchHandler(mgr);

		const filename = "pr-triage__1700000005.json";
		const pendingPath = path.join(tempDir, "tasks/pending", filename);
		// Tick 1: truncated JSON (mid-write) → must NOT poison, stays in pending.
		fs.writeFileSync(
			pendingPath,
			'{"agentId":"pr-triage","prompt":"do the t',
			"utf8",
		);

		await mgr._pollingTickForTests();
		await dispatch.flush();

		// Not poisoned: file untouched in pending/, no task-poisoned for it.
		await fsp.access(pendingPath);
		expect(fs.existsSync(path.join(tempDir, "tasks/poisoned", filename))).toBe(
			false,
		);
		expect(
			emittedEventsOfKind("task-poisoned").some(
				(e) => (e as { filename: string }).filename === filename,
			),
		).toBe(false);

		// The "mv" lands: the file becomes valid JSON before the next tick.
		fs.writeFileSync(
			pendingPath,
			JSON.stringify({
				prompt: "do the triage",
				agentId: "pr-triage",
				needsApproval: false,
			}),
			"utf8",
		);

		// Tick 2: parses cleanly → dispatch → claimTask → resolved.
		await mgr._pollingTickForTests();
		await dispatch.flush();
		await mgr.stopPollingLoop();

		await fsp.access(path.join(tempDir, "tasks/resolved", filename));
		await expect(fsp.access(pendingPath)).rejects.toThrow();
		const resolved = emittedEventsOfKind("task-resolved").filter(
			(e) => (e as { filename: string }).filename === filename,
		);
		expect(resolved).toHaveLength(1);
	});

	it("Case 16 — consumer tolerance: persistently malformed .json IS poisoned past JSON_PARSE_RETRY_BUDGET (pr84 Codex consumer-tolerance)", async () => {
		// The grace window is BOUNDED — a genuinely-corrupt task that stays
		// unparseable for (JSON_PARSE_RETRY_BUDGET + 1) ticks is still poisoned,
		// so a truly broken task cannot loop forever. Proves the fix is
		// defense-in-depth and does NOT weaken poison handling.
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage");

		const filename = "pr-triage__1700000006.json";
		const pendingPath = path.join(tempDir, "tasks/pending", filename);
		fs.writeFileSync(pendingPath, "{ irredeemably corrupt json", "utf8");

		// JSON_PARSE_RETRY_BUDGET ticks of grace: the file survives each, never
		// poisoned, never resolved.
		for (let i = 0; i < JSON_PARSE_RETRY_BUDGET; i++) {
			await mgr._pollingTickForTests();
			await fsp.access(pendingPath);
			expect(
				fs.existsSync(path.join(tempDir, "tasks/poisoned", filename)),
			).toBe(false);
		}

		// One more tick exceeds the budget → poisoned.
		await mgr._pollingTickForTests();
		await fsp.access(path.join(tempDir, "tasks/poisoned", filename));
		await expect(fsp.access(pendingPath)).rejects.toThrow();
		const poisoned = emittedEventsOfKind("task-poisoned").filter(
			(e) => (e as { filename: string }).filename === filename,
		);
		expect(poisoned).toHaveLength(1);
		expect(poisoned[0]).toMatchObject({
			kind: "task-poisoned",
			filename,
			reason: "json-parse-error",
		});
	});
});
