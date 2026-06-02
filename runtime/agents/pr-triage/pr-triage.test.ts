/**
 * pr-triage integration test (R1 — feature-pr84-r1-daemon-creds).
 *
 * Drives the Phase 2 cron → daemon-fetch-gate → PTY-spawn → dispatch →
 * result-envelope flow with external dependencies mocked. After R1 the agent
 * holds NO secret and makes NO network call: the daemon fetches the PRs (holding
 * GH_TOKEN), sanitizes them to a scalar payload, gates the spawn on zero PRs
 * (replacing the retired bash wake-check), injects the payload, and SENDS the
 * agent's text summary to Telegram itself. The agent is a pure data-in →
 * text-out transform that writes a `pr-triage-send__*.json` envelope.
 *
 * The system under test is the daemon's integration of CronScheduler (07a) with
 * the R1 `prepareCronPrompt` gate, AgentManager polling loop + claimTask (07b),
 * pr-triage artifacts (04a), pr-triage wiring (04b), and the dispatch handler
 * (04d). The real `claude-pty` adapter is exercised end-to-end with `node-pty`
 * mocked at the module boundary.
 *
 * Anchored at `Date.UTC(1970, 0, 1, 14, 0, 0)` so the `0 14 * * *` cron in
 * crons.json matches `_tickForTests()` deterministically.
 *
 * R1 contract verified here:
 *   - the spawned agent env carries NO secret (no token reaches the agent);
 *   - the daemon's `prepareCronPrompt` gates zero-PR days (`no-open-prs`) and
 *     fetch errors (`pr-fetch-failed`), and injects the sanitized payload into
 *     the rendered prompt;
 *   - the agent's `pr-triage-send__*.json` envelope routes to `task-send-needed`
 *     (the daemon owns the Telegram send), and the provenance guard rejects a
 *     foreign-filename send body.
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
import {
	CronScheduler,
	type PrepareCronPrompt,
} from "../../daemon/cron-scheduler.js";
import {
	type AgentConfigShape,
	PR_DATA_PLACEHOLDER,
	type TaskDispatchEvent,
	type TaskSendEvent,
	loadAgentConfig,
	loadCronEntries,
	makeTaskDispatchHandler,
	registerCronAgentWithRestart,
} from "../../daemon/main.js";
import type { DaemonEvent } from "../../daemon/telemetry.js";

// ───── node-pty mock (copied from claude-pty.test.ts) ─────

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

// ───── telemetry mock (pass-through; tests inspect emitMock.mock.calls) ─────

const { emitMock } = vi.hoisted(() => ({
	emitMock: vi.fn(),
}));
vi.mock("../../daemon/telemetry.js", async () => {
	const actual = await vi.importActual<
		typeof import("../../daemon/telemetry.js")
	>("../../daemon/telemetry.js");
	// Install the implementation ONCE, at module load, so emitMock is NEVER a
	// bare mock — beforeEach uses mockClear() (call history only, impl
	// preserved). The implementation records the call and resolves `true` (the
	// normal "durably recorded" case the alert/send durability gate depends on).
	emitMock.mockImplementation(() => Promise.resolve(true));
	return {
		...actual,
		emit: emitMock,
	};
});

// ───── shared fixtures ─────

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// Fake clock anchor: cron `0 14 * * *` matches at minute=0, hour=14.
const CRON_MATCH_TIME = new Date(Date.UTC(1970, 0, 1, 14, 0, 0));

let tempDir: string;
let agentsDir: string;

/**
 * Materialize a per-test `agents/pr-triage/` fixture mirroring the 04a outputs,
 * R1-updated: NO `wakeCheck` field (gating moved daemon-side) and a secret-free
 * `env`.
 */
function writePrTriageFixture(scheduleOverride?: string | null): void {
	const agentDir = path.join(agentsDir, "pr-triage");
	fs.mkdirSync(agentDir, { recursive: true });
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
 * Build a CronScheduler + AgentManager wired against the on-disk fixture.
 * `prepareCronPrompt` defaults to a double that injects a one-PR scalar payload
 * (non-zero PRs → spawn); pass a custom `prepareCronPrompt` to exercise the
 * gate (zero PRs / fetch error).
 */
async function buildSystem(opts?: {
	prepareCronPrompt?: PrepareCronPrompt;
}): Promise<{
	scheduler: CronScheduler;
	mgr: AgentManager;
	register: (
		agentId: string,
		opts?: { backoffMs?: readonly number[] },
	) => Promise<void>;
}> {
	const mgr = new AgentManager();
	const prepareCronPrompt: PrepareCronPrompt =
		opts?.prepareCronPrompt ??
		(async (cron) => {
			// Default double: render the real template with one injected PR.
			const template = fs.readFileSync(cron.promptTemplatePath, "utf8");
			const payload = {
				generatedAt: "2026-05-31T00:00:00.000Z",
				totalCount: 1,
				prs: [
					{
						number: 42,
						title: "Fix the thing",
						url: "u",
						author: "ilsantino",
						reviewDecision: "REVIEW_REQUIRED",
						createdAt: "2026-05-20T00:00:00.000Z",
						updatedAt: "2026-05-29T00:00:00.000Z",
						ageDays: 2,
						checksState: "SUCCESS",
						anyCheckTimedOut: false,
						mentionsClaude: false,
						hasClaudeLabel: false,
					},
				],
			};
			const prompt = template
				.split(PR_DATA_PLACEHOLDER)
				.join(JSON.stringify(payload, null, 2));
			return { skip: false, prompt };
		});
	const scheduler = new CronScheduler({
		agentManager: mgr,
		stateRoot: tempDir,
		nowFn: () => CRON_MATCH_TIME,
		prepareCronPrompt,
	});
	const cronEntries = await loadCronEntries(agentsDir);
	for (const o of cronEntries) {
		const promptAbs = path.isAbsolute(o.promptTemplatePath)
			? o.promptTemplatePath
			: path.join(REPO_ROOT, o.promptTemplatePath);
		scheduler.registerCron({ ...o, promptTemplatePath: promptAbs });
	}
	const register = async (
		agentId: string,
		registerOpts?: { backoffMs?: readonly number[] },
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
			...(registerOpts?.backoffMs !== undefined
				? { backoffMs: registerOpts.backoffMs }
				: {}),
		});
	};
	return { scheduler, mgr, register };
}

/**
 * Wire the production `makeTaskDispatchHandler` so the polling loop's
 * `task-dispatch-needed` event drives runtime.send + claimTask. `flush()`
 * awaits any in-flight dispatch promises.
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
	// R1: these secrets are set on the DAEMON's process.env (the daemon holds
	// them for its OWN fetch/send). The tests prove they are NEVER copied into
	// the spawned agent's env.
	process.env.IAGO_TELEGRAM_BOT_TOKEN = "test-bot-token";
	process.env.IAGO_TELEGRAM_ALLOWED_USER_IDS = "123456,789012";
	process.env.GH_TOKEN = "test-gh-token";

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
	emitMock.mockClear();
	emitMock.mockImplementation(() => Promise.resolve(true));
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
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

describe("pr-triage integration (R1 daemon-owned creds)", () => {
	it("Case 1 — zero open PRs → cron-skipped(no-open-prs), no spawn, no task file", async () => {
		writePrTriageFixture();
		const { scheduler, register } = await buildSystem({
			prepareCronPrompt: async () => ({ skip: true, reason: "no-open-prs" }),
		});
		await register("pr-triage");
		const startupSpawns = mockSpawn.mock.calls.length;

		await scheduler._tickForTests();

		const skipped = emittedEventsOfKind("cron-skipped");
		expect(skipped).toHaveLength(1);
		expect(skipped[0]).toMatchObject({
			kind: "cron-skipped",
			agentId: "pr-triage",
			reason: "no-open-prs",
		});
		// No additional PTY spawn beyond the startup one.
		expect(mockSpawn.mock.calls.length).toBe(startupSpawns);
		// No task file written.
		expect(fs.readdirSync(path.join(tempDir, "tasks/pending"))).toEqual([]);
		await scheduler.stop();
	});

	it("Case 2 — happy path: the spawned agent env holds NO secret; the injected payload (not a token) reaches the PTY", async () => {
		writePrTriageFixture();
		const { scheduler, mgr, register } = await buildSystem();
		await register("pr-triage");
		const startupSpawn = ptyState.last;
		expect(startupSpawn).not.toBeNull();

		// R1 CORE: the spawned agent env carries the non-secret runtime
		// descriptors + the declared state root — but NEVER a secret.
		const startupCall = mockSpawn.mock.calls[0] as [
			string,
			string[],
			{ env: Record<string, string> },
		];
		expect(startupCall[2].env.IAGO_DAEMON_STATE_ROOT).toBe(tempDir);
		// The three secrets present on the daemon's process.env are NOT injected.
		expect(startupCall[2].env.IAGO_TELEGRAM_BOT_TOKEN).toBeUndefined();
		expect(startupCall[2].env.IAGO_TELEGRAM_ALLOWED_USER_IDS).toBeUndefined();
		expect(startupCall[2].env.GH_TOKEN).toBeUndefined();
		// Non-secret runtime vars still forwarded so node-pty can locate `claude`.
		expect(startupCall[2].env.PATH).toBe(process.env.PATH);

		const dispatch = wireDispatchHandler(mgr);
		mgr.startPollingLoop();

		await scheduler._tickForTests();

		// cron-fired emitted; task file landed with the INJECTED prompt (payload
		// substituted), NOT the verbatim template-with-placeholder.
		const fired = emittedEventsOfKind("cron-fired");
		expect(fired).toHaveLength(1);
		const pendingFiles = fs.readdirSync(path.join(tempDir, "tasks/pending"));
		expect(pendingFiles).toHaveLength(1);
		const taskFile = pendingFiles[0];
		if (taskFile === undefined) throw new Error("unreachable");
		expect(taskFile.startsWith("pr-triage__")).toBe(true);
		const taskBody = JSON.parse(
			fs.readFileSync(path.join(tempDir, "tasks/pending", taskFile), "utf8"),
		) as { prompt: string; agentId: string };
		expect(taskBody.agentId).toBe("pr-triage");
		// Payload injected; placeholder consumed.
		expect(taskBody.prompt).toContain('"totalCount": 1');
		expect(taskBody.prompt).not.toContain(PR_DATA_PLACEHOLDER);
		// No secret / gh / curl reference in the rendered prompt.
		expect(taskBody.prompt).not.toContain("test-gh-token");
		expect(taskBody.prompt).not.toContain("test-bot-token");
		expect(taskBody.prompt).not.toContain("GH_TOKEN");

		// Drive the polling loop → dispatch → claimTask.
		await mgr._pollingTickForTests();
		await dispatch.flush();
		await mgr.stopPollingLoop();

		// The daemon piped the injected prompt to the PTY's stdin.
		const writes = (startupSpawn?.writes ?? []).map((w) =>
			w.replace(/\r\n/g, "\n"),
		);
		expect(writes.some((w) => w.includes('"totalCount": 1'))).toBe(true);

		// File migrated pending → resolved; cron slot decremented.
		await fsp.access(path.join(tempDir, "tasks/resolved", taskFile));
		const resolved = emittedEventsOfKind("task-resolved");
		expect(resolved).toHaveLength(1);
		expect(scheduler._runningCountForTests().get("pr-triage") ?? 0).toBe(0);
		await scheduler.stop();
	});

	it("Case 3 — daemon fetch error → cron-skipped(pr-fetch-failed), no spawn, no task file", async () => {
		writePrTriageFixture();
		const { scheduler, register } = await buildSystem({
			prepareCronPrompt: async () => ({
				skip: true,
				reason: "pr-fetch-failed",
			}),
		});
		await register("pr-triage");

		await scheduler._tickForTests();

		const skipped = emittedEventsOfKind("cron-skipped");
		expect(skipped).toHaveLength(1);
		expect(skipped[0]).toMatchObject({
			kind: "cron-skipped",
			agentId: "pr-triage",
			reason: "pr-fetch-failed",
		});
		expect(fs.readdirSync(path.join(tempDir, "tasks/pending"))).toEqual([]);
		await scheduler.stop();
	});

	it("Case 4 — PTY crash mid-run → SIGTERM + crash marker + registerCronAgentWithRestart re-spawns (NO secret on restart env)", async () => {
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage", { backoffMs: [10] });
		const pty = ptyState.last;
		expect(pty).not.toBeNull();
		if (pty === null) throw new Error("unreachable");
		const initialSpawns = mockSpawn.mock.calls.length;
		expect(initialSpawns).toBe(1);

		// Phase A — crash + kill + marker.
		const noise = "completely-unrelated-noise-XYZ ".repeat(20);
		pty.emitData(noise);
		expect(pty.killCalls).toContain("SIGTERM");

		// Phase B — flush writeStopMarker (real-I/O poll).
		const markersDir = path.join(tempDir, "markers");
		let crashMarker: string | undefined;
		let markerBody: { reason: string } | undefined;
		for (let i = 0; i < 200; i++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
			const found = fs
				.readdirSync(markersDir)
				.find((m) => m.endsWith(".daemon-stop"));
			if (found === undefined) continue;
			const raw = fs.readFileSync(path.join(markersDir, found), "utf8");
			if (raw.trim() === "") continue;
			try {
				markerBody = JSON.parse(raw) as { reason: string };
				crashMarker = found;
				break;
			} catch {
				// partial write — retry
			}
		}
		expect(crashMarker).toBeDefined();
		if (crashMarker === undefined || markerBody === undefined) {
			throw new Error("unreachable");
		}
		expect(markerBody.reason).toBe("crash");

		// Phase C — restart wiring fires after the injected backoff.
		await new Promise((resolve) => setTimeout(resolve, 100));
		const restartedEvents = emittedEventsOfKind("cron-agent-restarted");
		expect(restartedEvents).toHaveLength(1);
		expect(restartedEvents[0]).toMatchObject({
			kind: "cron-agent-restarted",
			agentId: "pr-triage",
			attempt: 1,
		});
		expect(mockSpawn.mock.calls.length).toBe(initialSpawns + 1);

		// R1: the RESTART re-registration must ALSO inject NO secret — a
		// restarted pr-triage agent stays credential-free.
		const restartCall = mockSpawn.mock.calls[
			mockSpawn.mock.calls.length - 1
		] as [string, string[], { env: Record<string, string> }];
		expect(restartCall[2].env.IAGO_TELEGRAM_BOT_TOKEN).toBeUndefined();
		expect(restartCall[2].env.IAGO_TELEGRAM_ALLOWED_USER_IDS).toBeUndefined();
		expect(restartCall[2].env.GH_TOKEN).toBeUndefined();
		// Runtime vars still forwarded on restart.
		expect(restartCall[2].env.IAGO_DAEMON_STATE_ROOT).toBe(tempDir);

		// pr84 R2: exactly ONE live pr-triage handle after the crash-restart.
		const liveHandles = mgr
			.listHandles()
			.filter((h) => h.agentId === "pr-triage");
		expect(liveHandles).toHaveLength(1);
	}, 15_000);

	it("Case 4b (Task 8) — heartbeat recycle re-arms the cron exit listener; a later crash restarts exactly once (single restart authority)", async () => {
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage", { backoffMs: [10] });
		const initialSpawns = mockSpawn.mock.calls.length;
		expect(initialSpawns).toBe(1);

		const handle = mgr.listHandles().find((h) => h.agentId === "pr-triage");
		if (handle === undefined) throw new Error("no pr-triage handle");

		// ── Phase A — simulate a HEARTBEAT recycle via restartAgent (the path the
		// heartbeat's forceRestart callback drives). This tears down PTY gen-1 and
		// re-spawns gen-2 under the SAME handle id, and emits `agent-restarted`.
		await mgr.restartAgent(handle.id, "stalled");
		// Let the `agent-restarted` re-arm + any spurious gen-1 exit-listener
		// microtask settle.
		await new Promise((resolve) => setTimeout(resolve, 60));

		// gen-2 spawned; exactly ONE live handle (no double-restart from the
		// recycle tripping the gen-1 cron exit listener — `isRestarting` guarded).
		const afterRecycleSpawns = mockSpawn.mock.calls.length;
		expect(afterRecycleSpawns).toBe(initialSpawns + 1);
		expect(
			mgr.listHandles().filter((h) => h.agentId === "pr-triage"),
		).toHaveLength(1);
		// The recycle is a heartbeat action — it must NOT have emitted a cron-side
		// restart event (that channel is for the cron loop's own restarts).
		expect(emittedEventsOfKind("cron-agent-restarted")).toHaveLength(0);

		// ── Phase B — crash the gen-2 PTY. The KEY assertion: the cron exit
		// listener was RE-ARMED onto gen-2 by `agent-restarted` (without Task 8 it
		// would still be bound to the dead gen-1 PTY, so this crash would go
		// un-restarted — silent death of the daily job).
		const gen2Pty = ptyState.last;
		if (gen2Pty === null) throw new Error("no gen-2 pty");
		const noise = "completely-unrelated-noise-XYZ ".repeat(20);
		gen2Pty.emitData(noise);
		expect(gen2Pty.killCalls).toContain("SIGTERM");

		// Wait for the cron-side restart (injected 10ms backoff) to fire.
		await new Promise((resolve) => setTimeout(resolve, 120));

		// EXACTLY ONE cron-side restart from the gen-2 crash — not zero (listener
		// was armed) and not two (no double-restart).
		const cronRestarts = emittedEventsOfKind("cron-agent-restarted");
		expect(cronRestarts).toHaveLength(1);
		expect(cronRestarts[0]).toMatchObject({
			kind: "cron-agent-restarted",
			agentId: "pr-triage",
			attempt: 1,
		});
		// gen-3 spawned (recycle gen-2 + crash-restart gen-3).
		expect(mockSpawn.mock.calls.length).toBe(initialSpawns + 2);
		// Still exactly one live handle after the whole sequence.
		expect(
			mgr.listHandles().filter((h) => h.agentId === "pr-triage"),
		).toHaveLength(1);
	}, 15_000);

	it("Case 5 — agent send envelope (sendText) routes to 'task-send-needed', NOT dispatch (daemon owns the send)", async () => {
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage");
		wireDispatchHandler(mgr);

		const filename = "pr-triage-send__1700000000-7.json";
		fs.writeFileSync(
			path.join(tempDir, "tasks/pending", filename),
			JSON.stringify({
				agentId: "pr-triage",
				sendText: "PR Triage 2026-05-31\n\n1 open PRs across ilsantino",
			}),
			"utf8",
		);

		const sendEvents: TaskSendEvent[] = [];
		const dispatchEvents: TaskDispatchEvent[] = [];
		mgr.on("task-send-needed", (e: TaskSendEvent) => sendEvents.push(e));
		mgr.on("task-dispatch-needed", (e: TaskDispatchEvent) =>
			dispatchEvents.push(e),
		);

		await mgr._pollingTickForTests();

		// Routed to the daemon send handler — NOT the dispatch path.
		expect(sendEvents).toHaveLength(1);
		expect(sendEvents[0]).toMatchObject({
			filename,
			agentId: "pr-triage",
			sendText: "PR Triage 2026-05-31\n\n1 open PRs across ilsantino",
		});
		expect(dispatchEvents).toHaveLength(0);
		// processPendingTask does NOT claim the envelope — the daemon send
		// handler (covered by main.test.ts) owns the claim.
		await fsp.access(path.join(tempDir, "tasks/pending", filename));
		expect(emittedEventsOfKind("pr-triage-dispatch-failed")).toHaveLength(0);
	});

	it("Case 6 — agent noSend envelope routes to 'task-send-needed' with noSend:true (D4)", async () => {
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage");

		const filename = "pr-triage-send__1700000001-8.json";
		fs.writeFileSync(
			path.join(tempDir, "tasks/pending", filename),
			JSON.stringify({ agentId: "pr-triage", noSend: true }),
			"utf8",
		);

		const sendEvents: TaskSendEvent[] = [];
		mgr.on("task-send-needed", (e: TaskSendEvent) => sendEvents.push(e));

		await mgr._pollingTickForTests();

		expect(sendEvents).toHaveLength(1);
		expect(sendEvents[0].noSend).toBe(true);
		expect(sendEvents[0].sendText).toBeUndefined();
	});

	it("Case 7 — schedule never matches in tick window → no spawns, no fire", async () => {
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
			prepareCronPrompt: async () => ({ skip: false, prompt: "x" }),
		});
		const cronEntries = await loadCronEntries(agentsDir);
		for (const o of cronEntries) {
			scheduler2.registerCron({
				...o,
				promptTemplatePath: path.isAbsolute(o.promptTemplatePath)
					? o.promptTemplatePath
					: path.join(REPO_ROOT, o.promptTemplatePath),
			});
		}

		await scheduler2._tickForTests();

		expect(emittedEventsOfKind("cron-fired")).toHaveLength(0);
		expect(mockSpawn.mock.calls.length).toBe(startupSpawns);
		await scheduler2.stop();
	});

	it("Case 8 — schedule: null → loadCronEntries drops the entry + emits cron-skipped-null", async () => {
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

	it("Case 9 — decrement chain across cron fire → overlap gate → resolve (per-filename outstanding set)", async () => {
		writePrTriageFixture("* 14 * * *");

		const mgr = new AgentManager();
		let clockMs = Date.UTC(1970, 0, 1, 14, 0, 0);
		const scheduler = new CronScheduler({
			agentManager: mgr,
			stateRoot: tempDir,
			nowFn: () => new Date(clockMs),
			prepareCronPrompt: async () => ({
				skip: false,
				prompt: "injected prompt body",
			}),
		});
		const cronEntries = await loadCronEntries(agentsDir);
		for (const o of cronEntries) {
			scheduler.registerCron({
				...o,
				promptTemplatePath: path.isAbsolute(o.promptTemplatePath)
					? o.promptTemplatePath
					: path.join(REPO_ROOT, o.promptTemplatePath),
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

		// Tick 1 — fires cleanly. runningCount 0 → 1.
		await scheduler._tickForTests();
		expect(scheduler._runningCountForTests().get("pr-triage")).toBe(1);
		const firedAfterTick1 = emittedEventsOfKind("cron-fired");
		expect(firedAfterTick1).toHaveLength(1);
		const tick1Filename = path.basename(
			(firedAfterTick1[0] as { taskFile: string }).taskFile,
		);
		expect(
			scheduler
				._outstandingFilenamesForTests()
				.get("pr-triage")
				?.has(tick1Filename),
		).toBe(true);

		// Tick 2 — overlap prevented (runningCount == maxConcurrent).
		clockMs += 60_000;
		await scheduler._tickForTests();
		expect(scheduler._runningCountForTests().get("pr-triage")).toBe(1);
		expect(emittedEventsOfKind("cron-overlap-prevented")).toHaveLength(1);
		expect(fs.readdirSync(path.join(tempDir, "tasks/pending"))).toHaveLength(1);

		// Drain → claimTask → task-resolved → decrement to 0.
		await mgr._pollingTickForTests();
		await dispatch.flush();
		expect(scheduler._runningCountForTests().get("pr-triage") ?? 0).toBe(0);
		const resolvedForCron = emittedEventsOfKind("task-resolved").filter(
			(e) => (e as { filename: string }).filename === tick1Filename,
		);
		expect(resolvedForCron).toHaveLength(1);
		expect(scheduler._outstandingFilenamesForTests().has("pr-triage")).toBe(
			false,
		);

		// Tick 3 — slot free again, fires with a DIFFERENT filename.
		clockMs += 60_000;
		await scheduler._tickForTests();
		expect(scheduler._runningCountForTests().get("pr-triage")).toBe(1);
		const firedAfterTick3 = emittedEventsOfKind("cron-fired");
		expect(firedAfterTick3).toHaveLength(2);
		const tick3Filename = path.basename(
			(firedAfterTick3[1] as { taskFile: string }).taskFile,
		);
		expect(tick3Filename).not.toBe(tick1Filename);

		await scheduler.stop();
	});

	it("Case 10 — NO secret is injected into ANY agent env (trusted or untrusted)", async () => {
		// A rogue agent self-labeling org:internal gets baseEnv unchanged…
		const rogueDir = path.join(agentsDir, "rogue-agent");
		fs.mkdirSync(rogueDir, { recursive: true });
		fs.writeFileSync(
			path.join(rogueDir, "agent-config.json"),
			JSON.stringify({
				runtimeId: "claude-pty",
				org: "internal",
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
		expect(rogueCall[2].env.IAGO_DAEMON_STATE_ROOT).toBe(tempDir);
		expect(rogueCall[2].env.IAGO_TELEGRAM_BOT_TOKEN).toBeUndefined();
		expect(rogueCall[2].env.GH_TOKEN).toBeUndefined();

		// …and the trusted pr-triage agent ALSO gets NO secret (R1 core change —
		// the gate now only overlays non-secret runtime vars).
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
		expect(trustedCall[2].env.IAGO_TELEGRAM_BOT_TOKEN).toBeUndefined();
		expect(trustedCall[2].env.GH_TOKEN).toBeUndefined();
		// Non-secret runtime var IS forwarded for the trusted agent.
		expect(trustedCall[2].env.IAGO_DAEMON_STATE_ROOT).toBe(tempDir);
	});

	it("Case 11 — provenance: a FOREIGN-filename send body is NOT routed to 'task-send-needed'", async () => {
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage");
		const dispatch = wireDispatchHandler(mgr);

		// A foreign producer writes `rogue-agent__*.json` whose BODY claims
		// pr-triage + a sendText. The provenance guard (agentId === "pr-triage"
		// AND filename startsWith "pr-triage-send__") must block the send branch.
		const foreignFilename = "rogue-agent__1700000007.json";
		fs.writeFileSync(
			path.join(tempDir, "tasks/pending", foreignFilename),
			JSON.stringify({
				agentId: "pr-triage",
				sendText: "smuggled summary under a foreign filename",
			}),
			"utf8",
		);

		const sendEvents: TaskSendEvent[] = [];
		mgr.on("task-send-needed", (e: TaskSendEvent) => sendEvents.push(e));

		await mgr._pollingTickForTests();
		await dispatch.flush();

		// Not routed as a send — the filename did not match the provenance prefix.
		expect(sendEvents).toHaveLength(0);
		expect(
			fs.existsSync(path.join(tempDir, "tasks/resolved", foreignFilename)),
		).toBe(false);
		// It fell through to the dispatch path; with no prompt it is rejected as
		// malformed-task (the body's agentId pr-triage is registered).
		expect(
			emittedEventsOfKind("pr-triage-dispatch-failed").some(
				(e) =>
					(e as { filename: string }).filename === foreignFilename &&
					(e as { reason: string }).reason === "malformed-task",
			),
		).toBe(true);
	});

	it("Case 12 — provenance: a pr-triage-send__ file with a non-empty prompt does NOT route to send (falls through to dispatch)", async () => {
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage");
		const dispatch = wireDispatchHandler(mgr);

		const filename = "pr-triage-send__1700000010-9.json";
		fs.writeFileSync(
			path.join(tempDir, "tasks/pending", filename),
			JSON.stringify({
				agentId: "pr-triage",
				sendText: "summary",
				prompt: "but also a prompt",
			}),
			"utf8",
		);

		const sendEvents: TaskSendEvent[] = [];
		const dispatchEvents: TaskDispatchEvent[] = [];
		mgr.on("task-send-needed", (e: TaskSendEvent) => sendEvents.push(e));
		mgr.on("task-dispatch-needed", (e: TaskDispatchEvent) =>
			dispatchEvents.push(e),
		);

		await mgr._pollingTickForTests();
		await dispatch.flush();

		// A combined prompt+sendText is NOT a clean send envelope.
		expect(sendEvents).toHaveLength(0);
		expect(dispatchEvents).toHaveLength(1);
	});

	it.skipIf(process.platform === "win32")(
		"Case 13 — persisted agent config is written mode 0600 (POSIX at-rest)",
		async () => {
			// The persisted config no longer carries secrets, but it still must be
			// 0600 so the at-rest contract holds for any future field.
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

	it("Case 14 — consumer tolerance: transient unparseable .json is NOT poisoned, retried, then resolves", async () => {
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage");
		const dispatch = wireDispatchHandler(mgr);

		const filename = "pr-triage__1700000005.json";
		const pendingPath = path.join(tempDir, "tasks/pending", filename);
		fs.writeFileSync(
			pendingPath,
			'{"agentId":"pr-triage","prompt":"do the t',
			"utf8",
		);

		await mgr._pollingTickForTests();
		await dispatch.flush();

		await fsp.access(pendingPath);
		expect(fs.existsSync(path.join(tempDir, "tasks/poisoned", filename))).toBe(
			false,
		);

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

	it("Case 15 — consumer tolerance: persistently malformed .json IS poisoned past JSON_PARSE_RETRY_BUDGET", async () => {
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage");

		const filename = "pr-triage__1700000006.json";
		const pendingPath = path.join(tempDir, "tasks/pending", filename);
		fs.writeFileSync(pendingPath, "{ irredeemably corrupt json", "utf8");

		for (let i = 0; i < JSON_PARSE_RETRY_BUDGET; i++) {
			await mgr._pollingTickForTests();
			await fsp.access(pendingPath);
			expect(
				fs.existsSync(path.join(tempDir, "tasks/poisoned", filename)),
			).toBe(false);
		}

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

	it("Case 16 — the agent neither receives nor references a secret token (C2 sentinel discipline)", async () => {
		writePrTriageFixture();
		const { scheduler, register } = await buildSystem();
		await register("pr-triage");

		await scheduler._tickForTests();

		// Every spawn call's env is secret-free.
		for (const call of mockSpawn.mock.calls) {
			const env = (
				call as [string, string[], { env: Record<string, string> }]
			)[2].env;
			expect(env.IAGO_TELEGRAM_BOT_TOKEN).toBeUndefined();
			expect(env.GH_TOKEN).toBeUndefined();
			expect(env.IAGO_TELEGRAM_ALLOWED_USER_IDS).toBeUndefined();
		}
		// The on-disk task body (the agent's entire input) contains no token.
		const pendingFiles = fs.readdirSync(path.join(tempDir, "tasks/pending"));
		for (const f of pendingFiles) {
			const body = fs.readFileSync(
				path.join(tempDir, "tasks/pending", f),
				"utf8",
			);
			expect(body).not.toContain("test-gh-token");
			expect(body).not.toContain("test-bot-token");
		}
		await scheduler.stop();
	});

	// F1 (dual-adversarial pass#3) — direct coverage of the ndjsonAlert
	// record-and-resolve branch in AgentManager.processPendingTask. Before this
	// test the branch had only the INERT mirror in makeTaskDispatchHandler
	// (main.test.ts DH-8); the load-bearing PRODUCTION branch — which fires
	// BEFORE isAgentRegistered and is the one that actually resolves alert
	// envelopes — was exercised by no test. These cases drive a real
	// `pr-triage__*.json` alert envelope through `_pollingTickForTests()`.
	it("Case 17 (F1) — ndjsonAlert envelope: emits pr-triage-telegram-send-failed + claims when telemetry records", async () => {
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage");
		const dispatch = wireDispatchHandler(mgr);

		// A real pr-triage alert envelope (prompt-less, daemon-owned kind, correct
		// filename prefix). The producer is the legacy alert path; the branch is
		// retired but kept as defensive handling and MUST still record-and-resolve.
		const filename = "pr-triage__1700000020.json";
		fs.writeFileSync(
			path.join(tempDir, "tasks/pending", filename),
			JSON.stringify({
				agentId: "pr-triage",
				ndjsonAlert: "pr-triage-telegram-send-failed",
				details: "429 rate",
			}),
			"utf8",
		);

		const sendEvents: TaskSendEvent[] = [];
		const dispatchEvents: TaskDispatchEvent[] = [];
		mgr.on("task-send-needed", (e: TaskSendEvent) => sendEvents.push(e));
		mgr.on("task-dispatch-needed", (e: TaskDispatchEvent) =>
			dispatchEvents.push(e),
		);

		await mgr._pollingTickForTests();
		await dispatch.flush();

		// (a) telemetry emitted with the alert kind + token-free details, mirrored.
		const failed = emittedEventsOfKind("pr-triage-telegram-send-failed").filter(
			(e) => (e as { filename: string }).filename === filename,
		);
		expect(failed).toHaveLength(1);
		expect(failed[0]).toMatchObject({
			kind: "pr-triage-telegram-send-failed",
			agentId: "pr-triage",
			filename,
			alertKind: "pr-triage-telegram-send-failed",
			details: "429 rate",
		});
		// (b) record-and-resolve: with telemetry durable (emitMock → true), the
		// file is claimed (moved pending → resolved).
		await fsp.access(path.join(tempDir, "tasks/resolved", filename));
		await expect(
			fsp.access(path.join(tempDir, "tasks/pending", filename)),
		).rejects.toThrow();
		// It NEVER reached the dispatch / send path (a prompt-less alert must not
		// be mis-classified as malformed-task).
		expect(sendEvents).toHaveLength(0);
		expect(dispatchEvents).toHaveLength(0);
		expect(emittedEventsOfKind("pr-triage-dispatch-failed")).toHaveLength(0);
	});

	it("Case 18 (F1) — durability gate: an alert envelope is NOT claimed when the telemetry emit does NOT record", async () => {
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage");

		const filename = "pr-triage__1700000021.json";
		const pendingPath = path.join(tempDir, "tasks/pending", filename);
		fs.writeFileSync(
			pendingPath,
			JSON.stringify({
				agentId: "pr-triage",
				ndjsonAlert: "pr-triage-telegram-send-failed",
				details: "500 server",
			}),
			"utf8",
		);

		// Degraded telemetry dir: the next emit reports a NON-durable write.
		emitMock.mockResolvedValueOnce(false);

		await mgr._pollingTickForTests();

		// Telemetry was attempted...
		expect(
			emittedEventsOfKind("pr-triage-telegram-send-failed").filter(
				(e) => (e as { filename: string }).filename === filename,
			),
		).toHaveLength(1);
		// ...but the claim did NOT happen — the alert must re-trip next tick rather
		// than be silently resolved without surfacing the signal.
		await fsp.access(pendingPath);
		expect(fs.existsSync(path.join(tempDir, "tasks/resolved", filename))).toBe(
			false,
		);
	});

	it("Case 19 (F1) — provenance: a foreign-FILENAME alert body FALLS THROUGH (NOT record-and-resolved)", async () => {
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage");
		const dispatch = wireDispatchHandler(mgr);

		// A foreign producer writes `rogue-agent__*.json` whose BODY claims
		// pr-triage + an alert kind. The filename-provenance guard must block the
		// record-and-resolve branch so a foreign file cannot destroy the real
		// producer's signal.
		const foreignFilename = "rogue-agent__1700000022.json";
		const foreignPath = path.join(tempDir, "tasks/pending", foreignFilename);
		fs.writeFileSync(
			foreignPath,
			JSON.stringify({
				agentId: "pr-triage",
				ndjsonAlert: "pr-triage-telegram-send-failed",
				details: "smuggled",
			}),
			"utf8",
		);

		await mgr._pollingTickForTests();
		await dispatch.flush();

		// Did NOT record-and-resolve: no telegram-send-failed telemetry for the
		// foreign file, and it was not moved to resolved/. (It falls through to the
		// dispatch path and, being prompt-less, is rejected as malformed-task.)
		expect(
			emittedEventsOfKind("pr-triage-telegram-send-failed").filter(
				(e) => (e as { filename: string }).filename === foreignFilename,
			),
		).toHaveLength(0);
		expect(
			fs.existsSync(path.join(tempDir, "tasks/resolved", foreignFilename)),
		).toBe(false);
		expect(
			emittedEventsOfKind("pr-triage-dispatch-failed").some(
				(e) =>
					(e as { filename: string }).filename === foreignFilename &&
					(e as { reason: string }).reason === "malformed-task",
			),
		).toBe(true);
	});

	it("Case 20 (F1) — provenance: a foreign alert KIND on a pr-triage__ file FALLS THROUGH (NOT record-and-resolved)", async () => {
		writePrTriageFixture();
		const { mgr, register } = await buildSystem();
		await register("pr-triage");
		const dispatch = wireDispatchHandler(mgr);

		// Correct filename prefix + agentId, but an alert kind NOT in the
		// daemon-owned PR_TRIAGE_ALERT_KINDS set. The kind-membership guard must
		// block the record-and-resolve branch.
		const filename = "pr-triage__1700000023.json";
		const pendingPath = path.join(tempDir, "tasks/pending", filename);
		fs.writeFileSync(
			pendingPath,
			JSON.stringify({
				agentId: "pr-triage",
				ndjsonAlert: "some-unknown-kind",
				details: "x",
			}),
			"utf8",
		);

		await mgr._pollingTickForTests();
		await dispatch.flush();

		// No record-and-resolve for an out-of-set kind.
		expect(
			emittedEventsOfKind("pr-triage-telegram-send-failed").filter(
				(e) => (e as { filename: string }).filename === filename,
			),
		).toHaveLength(0);
		expect(fs.existsSync(path.join(tempDir, "tasks/resolved", filename))).toBe(
			false,
		);
		// Falls through; prompt-less → malformed-task.
		expect(
			emittedEventsOfKind("pr-triage-dispatch-failed").some(
				(e) =>
					(e as { filename: string }).filename === filename &&
					(e as { reason: string }).reason === "malformed-task",
			),
		).toBe(true);
	});
});
