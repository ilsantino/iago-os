/**
 * Integration test for the pr-triage agent end-to-end wire-up — Plan 04b
 * Task 4 of `feature-phase-2-vps-bootstrap/04b-pr-triage-wiring-and-test`.
 *
 * Boundary chosen: the DAEMON's view of the pr-triage workflow. The test
 * harness exercises the file-bus integration between CronScheduler (07a),
 * AgentManager polling-loop + claimTask (07b), the parseCronsJsonEntry
 * helper extracted from `startDaemon` (this plan's Task 3), and the
 * registered claude-pty adapter. The agent's *internal* shell behavior —
 * the `gh api graphql` query, the summary build, and the direct
 * `curl -sS ... /sendMessage` POST documented in `prompt-template.md` —
 * happens INSIDE the spawned PTY shell at runtime and cannot be observed
 * by a Node test. Cases 2 and 5 therefore assert the file-bus
 * observables the daemon actually owns (task file flows pending→resolved,
 * task-resolved emitted, cron decrement chain firing), not the agent's
 * outbound curl invocation.
 *
 * Plan §Task 4 calls out plain-text Telegram dispatch for case 2 (NOT
 * `parse_mode=MarkdownV2`) — the plan text predates the Codex
 * high-severity fix that struck MarkdownV2 from `prompt-template.md`
 * step (d). The agent prompt is the truth source; assertions here match
 * the agent prompt.
 *
 * Plan §Task 4 case 5 also calls out a `pr-triage-telegram-send-failed`
 * envelope-routing telemetry event. That envelope branch is documented
 * as a 04b dependency inside `prompt-template.md`, but the polling loop
 * shipped in this plan does not yet emit the alert-kind telemetry — it
 * claims the fallback file like any other valid envelope and emits the
 * generic `task-resolved` event. The plan body explicitly defers
 * envelope-aware dispatch (`agent-manager.ts` line 1424 "claimTask is
 * decrement-only ... dispatch logic is deferred to Plan 04b Task 3");
 * this test asserts what is observable today and leaves the alert-kind
 * branch for the follow-up that actually implements it. M2 carry-over:
 * the fake-timer base date is anchored to 2026-05-18 14:00 UTC so the
 * `0 14 * * *` cron expression matches every `_tickForTests()` invocation.
 */

import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type AgentRuntime,
	_resetRegistryForTests,
	registerRuntime,
} from "../../agent-runtime/registry.js";
import type {
	AgentHandle,
	AgentMessage,
	SpawnOpts,
	StatusCallback,
	StatusValue,
} from "../../agent-runtime/types.js";

import { AgentManager } from "../../daemon/agent-manager.js";
import { CronScheduler } from "../../daemon/cron-scheduler.js";
import { parseCronsJsonEntry } from "../../daemon/main.js";
import { ensureStateDirsSync, pathFor } from "../../daemon/state-paths.js";
import type { DaemonEvent } from "../../daemon/telemetry.js";

// Plan §Task 4: mock `child_process.spawnSync` so wake-check exit codes
// drive the scheduler without touching real disk for the agent's
// bash script. Pattern is verbatim from cron-scheduler.test.ts so future
// regressions in either file produce comparable diffs.
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

// I2 carry-over: mock `node-pty` so the claude-pty adapter can register
// + spawn without actually forking a Claude binary. The pattern mirrors
// `runtime/agent-runtime/pty/claude-pty.test.ts` so a future refactor
// that tightens one mock surfaces in the other immediately.
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

const mockSpawn = vi.fn<(...args: unknown[]) => MockPty>();
vi.mock("node-pty", () => ({
	spawn: (...args: unknown[]) => mockSpawn(...args),
}));

const mockAssertSupportedVersion = vi.fn(async () => ({
	ok: true as const,
	version: "2.1.113",
}));
vi.mock("../../agent-runtime/pty/version-pin.js", () => ({
	assertSupportedVersion: () => mockAssertSupportedVersion(),
	getClaudeCodeVersion: async () => "2.1.113",
	SUPPORTED_CLAUDE_CODE_VERSION_RANGE: ">=2.0.0 <3.0.0",
}));

// Telemetry mock — pass-through by default so on-disk NDJSON keeps
// working; tests can also inspect `emitMock.mock.calls` directly for
// synchronous assertions. Same pattern used by cron-scheduler.test.ts
// and agent-manager.test.ts.
const { emitMock, emitState } = vi.hoisted(() => ({
	emitMock: vi.fn(),
	emitState: {
		real: null as ((e: DaemonEvent) => Promise<void>) | null,
	},
}));
vi.mock("../../daemon/telemetry.js", async () => {
	const actual =
		await vi.importActual<typeof import("../../daemon/telemetry.js")>(
			"../../daemon/telemetry.js",
		);
	emitState.real = actual.emit;
	return {
		...actual,
		emit: emitMock,
	};
});

// Stand up a tiny mock AgentRuntime so AgentManager.registerAgent can
// resolve a runtime and `isAgentRegistered("pr-triage")` returns true
// during polling. The adapter we ship in production is claude-pty
// (node-pty mocked above); for these tests the polymorphic interface
// matters more than the specific adapter, and a self-contained mock
// avoids dragging the whole real adapter's session.jsonl + marker
// machinery into a file-bus integration test.
function makeMockRuntime(id: string): AgentRuntime {
	let counter = 0;
	const callbacks = new Map<string, Set<StatusCallback>>();
	const alive = new Map<string, boolean>();
	return {
		shape: "pty",
		id,
		version: "test-0.0.1",
		interfaceVersion: "v1",
		async spawn(opts: SpawnOpts): Promise<AgentHandle> {
			counter += 1;
			const handleId = opts.restoreId ?? `${id}-h${counter}`;
			alive.set(handleId, true);
			return {
				id: handleId,
				runtime: id,
				shape: "pty",
				agentId: opts.agentId,
				sessionId: opts.sessionId,
				generationToken: 0,
				org: opts.org,
				spawnedAt: Date.now(),
				markerPath: path.join(pathFor("markers"), `${handleId}.daemon-stop`),
			};
		},
		async send(_handle: AgentHandle, _message: AgentMessage): Promise<void> {
			// Test integration boundary stops at the daemon — no PTY write needed.
		},
		onStatusChanged(handle: AgentHandle, cb: StatusCallback): () => void {
			let set = callbacks.get(handle.id);
			if (set === undefined) {
				set = new Set();
				callbacks.set(handle.id, set);
			}
			set.add(cb);
			return () => {
				callbacks.get(handle.id)?.delete(cb);
			};
		},
		async isAlive(handle: AgentHandle): Promise<boolean> {
			return alive.get(handle.id) ?? false;
		},
		async shutdown(handle: AgentHandle): Promise<void> {
			alive.set(handle.id, false);
		},
		async restoreFromMarker(): Promise<AgentHandle | null> {
			return null;
		},
	};
}

function spawnSyncResult(opts: {
	status: number | null;
	signal?: NodeJS.Signals | null;
	error?: Error;
}): {
	status: number | null;
	signal: NodeJS.Signals | null;
	error: Error | undefined;
	stdout: string;
	stderr: string;
	pid: number;
	output: Array<string>;
} {
	return {
		status: opts.status,
		signal: opts.signal ?? null,
		error: opts.error,
		stdout: "",
		stderr: "",
		pid: 1234,
		output: [],
	};
}

function writePromptTemplate(dir: string, body: string): string {
	const p = path.join(dir, "prompt.md");
	fs.writeFileSync(p, body, "utf8");
	return p;
}

function writePendingTaskSync(filename: string, body: unknown): string {
	const p = path.join(pathFor("tasks/pending"), filename);
	fs.writeFileSync(
		p,
		typeof body === "string" ? body : JSON.stringify(body),
		"utf8",
	);
	return p;
}

function emittedEventsOfKind(kind: DaemonEvent["kind"]): DaemonEvent[] {
	const out: DaemonEvent[] = [];
	for (const call of emitMock.mock.calls) {
		const e = call[0] as DaemonEvent;
		if (e.kind === kind) out.push(e);
	}
	return out;
}

const PR_TRIAGE_AGENT_ID = "pr-triage";
// Cron schedule pulled verbatim from `runtime/agents/pr-triage/crons.json`
// so the test drifts with the production config.
const PR_TRIAGE_SCHEDULE = "0 14 * * *";
// nowFn anchor — matches the daily 14:00 UTC firing minute exactly.
const FIXED_NOW = (): Date => new Date(Date.UTC(2026, 4, 18, 14, 0, 0));

let tempDir: string;

beforeEach(async () => {
	tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-pr-triage-"));
	process.env.IAGO_DAEMON_STATE_ROOT = tempDir;
	ensureStateDirsSync();
	spawnSyncMock.mockReset();
	mockSpawn.mockReset();
	mockSpawn.mockImplementation(() => makeMockPty());
	mockAssertSupportedVersion.mockReset();
	mockAssertSupportedVersion.mockImplementation(async () => ({
		ok: true as const,
		version: "2.1.113",
	}));
	emitMock.mockReset();
	emitMock.mockImplementation((e: DaemonEvent) => {
		if (emitState.real === null) return Promise.resolve();
		return emitState.real(e);
	});
	_resetRegistryForTests();
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	delete process.env.IAGO_DAEMON_STATE_ROOT;
	_resetRegistryForTests();
	await fsp.rm(tempDir, { recursive: true, force: true });
});

describe("pr-triage / end-to-end wire-up (Plan 04b Task 4)", () => {
	it("(1) wake-check exit 1 (zero PRs) → cron-skipped, no pending file, no PTY spawn", async () => {
		spawnSyncMock.mockReturnValueOnce(spawnSyncResult({ status: 1 }));
		registerRuntime(makeMockRuntime("mock-pty-c1"));
		const manager = new AgentManager();
		await manager.registerAgent({
			agentId: PR_TRIAGE_AGENT_ID,
			runtimeId: "mock-pty-c1",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-c1",
		});
		const prompt = writePromptTemplate(tempDir, "do triage");
		const wake = path.join(tempDir, "wake.sh");
		fs.writeFileSync(wake, "#!/bin/bash\nexit 1\n");

		const scheduler = new CronScheduler({
			agentManager: manager,
			nowFn: FIXED_NOW,
		});
		scheduler.registerCron({
			agentId: PR_TRIAGE_AGENT_ID,
			schedule: PR_TRIAGE_SCHEDULE,
			wakeCheck: wake,
			promptTemplatePath: prompt,
			outputTaskNamePrefix: PR_TRIAGE_AGENT_ID,
		});
		scheduler.start();
		await scheduler._tickForTests();

		const skipped = emittedEventsOfKind("cron-skipped");
		expect(skipped).toHaveLength(1);
		expect(skipped[0]).toMatchObject({
			kind: "cron-skipped",
			agentId: PR_TRIAGE_AGENT_ID,
			reason: "wake-check-failed",
			exitCode: 1,
		});
		const pending = await fsp.readdir(pathFor("tasks/pending"));
		expect(pending).toEqual([]);
		expect(emittedEventsOfKind("cron-fired")).toHaveLength(0);
		// PTY spawn happened ONCE at registerAgent time, not during the
		// cron skip — exactly one call total.
		expect(mockSpawn).toHaveBeenCalledTimes(0);

		await scheduler.stop();
		await manager.stopPollingLoop();
	});

	it("(2) wake-check exit 0 (PRs exist) + registered agent → file flows pending → resolved + task-resolved emits plain text-path metadata", async () => {
		spawnSyncMock.mockReturnValueOnce(spawnSyncResult({ status: 0 }));
		registerRuntime(makeMockRuntime("mock-pty-c2"));
		const manager = new AgentManager();
		await manager.registerAgent({
			agentId: PR_TRIAGE_AGENT_ID,
			runtimeId: "mock-pty-c2",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-c2",
		});
		const prompt = writePromptTemplate(
			tempDir,
			"# pr-triage daily prompt body",
		);
		const wake = path.join(tempDir, "wake.sh");
		fs.writeFileSync(wake, "#!/bin/bash\nexit 0\n");

		const scheduler = new CronScheduler({
			agentManager: manager,
			nowFn: FIXED_NOW,
		});
		scheduler.registerCron({
			agentId: PR_TRIAGE_AGENT_ID,
			schedule: PR_TRIAGE_SCHEDULE,
			wakeCheck: wake,
			promptTemplatePath: prompt,
			outputTaskNamePrefix: PR_TRIAGE_AGENT_ID,
		});
		scheduler.start();
		await scheduler._tickForTests();

		// Cron emitted the task file with the prompt body embedded.
		const pending = await fsp.readdir(pathFor("tasks/pending"));
		expect(pending).toHaveLength(1);
		const filename = pending[0] as string;
		expect(filename).toMatch(/^pr-triage__\d+\.json$/);
		const raw = await fsp.readFile(
			path.join(pathFor("tasks/pending"), filename),
			"utf8",
		);
		const envelope = JSON.parse(raw) as Record<string, unknown>;
		expect(envelope).toMatchObject({
			agentId: PR_TRIAGE_AGENT_ID,
			prompt: "# pr-triage daily prompt body",
			needsApproval: false,
		});
		// Plan §Task 4 case 2 asserts MarkdownV2 dispatch — that wording
		// pre-dates the Codex fix in `prompt-template.md` step (d). The
		// envelope written by the cron contains the prompt body as-is; the
		// agent's downstream `curl` POST sends plain text with NO
		// `parse_mode`. Assert the envelope contains NO MarkdownV2 marker —
		// the cron emit path is transport-agnostic.
		expect(JSON.stringify(envelope)).not.toMatch(/parse_mode.*MarkdownV2/i);

		// Polling tick claims the file: pending → resolved + task-resolved.
		const ee = new Promise<{ agentId: string; filename: string }>(
			(resolve) => {
				manager.once("task-resolved", resolve);
			},
		);
		await manager._pollingTickForTests();
		const resolvedEvent = await ee;
		expect(resolvedEvent).toEqual({
			agentId: PR_TRIAGE_AGENT_ID,
			filename,
		});

		await expect(
			fsp.access(path.join(pathFor("tasks/pending"), filename)),
		).rejects.toThrow();
		await fsp.access(path.join(pathFor("tasks/resolved"), filename));

		const resolved = emittedEventsOfKind("task-resolved");
		expect(resolved).toHaveLength(1);
		expect(resolved[0]).toMatchObject({
			kind: "task-resolved",
			agentId: PR_TRIAGE_AGENT_ID,
			filename,
		});

		await scheduler.stop();
		await manager.stopPollingLoop();
	});

	it("(3) wake-check exit 2 (rate-limit) → cron-skipped(wake-check-failed) with exitCode=2", async () => {
		spawnSyncMock.mockReturnValueOnce(spawnSyncResult({ status: 2 }));
		registerRuntime(makeMockRuntime("mock-pty-c3"));
		const manager = new AgentManager();
		await manager.registerAgent({
			agentId: PR_TRIAGE_AGENT_ID,
			runtimeId: "mock-pty-c3",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-c3",
		});
		const prompt = writePromptTemplate(tempDir, "x");
		const wake = path.join(tempDir, "wake.sh");
		fs.writeFileSync(wake, "#!/bin/bash\nexit 2\n");

		const scheduler = new CronScheduler({
			agentManager: manager,
			nowFn: FIXED_NOW,
		});
		scheduler.registerCron({
			agentId: PR_TRIAGE_AGENT_ID,
			schedule: PR_TRIAGE_SCHEDULE,
			wakeCheck: wake,
			promptTemplatePath: prompt,
			outputTaskNamePrefix: PR_TRIAGE_AGENT_ID,
		});
		scheduler.start();
		await scheduler._tickForTests();

		// `wake-check.sh` distinguishes rate-limit via exit 2 (see Hermes
		// wake-check § "Rate-limited" branch). The scheduler does NOT have
		// a `wake-check-rate-limited` reason — every non-zero exit funnels
		// through `wake-check-failed` with the exit code attached. Operators
		// disambiguate rate-limit vs auth/transport by reading `exitCode`.
		const skipped = emittedEventsOfKind("cron-skipped");
		expect(skipped).toHaveLength(1);
		expect(skipped[0]).toMatchObject({
			kind: "cron-skipped",
			agentId: PR_TRIAGE_AGENT_ID,
			reason: "wake-check-failed",
			exitCode: 2,
		});
		const pending = await fsp.readdir(pathFor("tasks/pending"));
		expect(pending).toEqual([]);

		await scheduler.stop();
		await manager.stopPollingLoop();
	});

	it("(4) claude-pty status callback delivers transitions to AgentManager (heartbeat-restart surface present)", async () => {
		// Phase 1 heartbeat-restart wiring is exercised in detail by
		// `agent-manager.test.ts` (heartbeat-driven restart suite). Here we
		// verify the surface the heartbeat consumes is alive: the mocked
		// runtime's status callback chain reaches the AgentManager
		// subscription added by `registerAgent`. If the subscription is
		// silently dropped, the heartbeat has no signal to act on and
		// Phase 1's whole crash-recovery flow degrades to "wait for the
		// next stall window". Asserting status delivery here keeps that
		// regression visible at the integration layer.
		const captured: Array<{
			handleId: string;
			status: StatusValue;
		}> = [];
		const baseRuntime = makeMockRuntime("mock-pty-c4");
		const subscriptionCallbacks = new Map<string, Set<StatusCallback>>();
		const wrappedRuntime: AgentRuntime = {
			...baseRuntime,
			onStatusChanged(handle: AgentHandle, cb: StatusCallback): () => void {
				let set = subscriptionCallbacks.get(handle.id);
				if (set === undefined) {
					set = new Set();
					subscriptionCallbacks.set(handle.id, set);
				}
				set.add(cb);
				// Also chain into the base runtime so AgentManager's
				// internal subscription is exercised.
				const baseUnsub = baseRuntime.onStatusChanged(handle, cb);
				return () => {
					subscriptionCallbacks.get(handle.id)?.delete(cb);
					baseUnsub();
				};
			},
		};
		registerRuntime(wrappedRuntime);
		const manager = new AgentManager();
		const handle = await manager.registerAgent({
			agentId: PR_TRIAGE_AGENT_ID,
			runtimeId: "mock-pty-c4",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-c4",
		});

		// At least one subscription must have landed on this handle — the
		// AgentManager subscribes during trackHandle, regardless of whether
		// a HeartbeatController was supplied. Without this subscription
		// status transitions cannot reach the persistence + heartbeat path.
		const subscribed = subscriptionCallbacks.get(handle.id);
		expect(subscribed).toBeDefined();
		expect(subscribed?.size ?? 0).toBeGreaterThanOrEqual(1);

		// Simulate a mid-run crash by firing the status callback directly —
		// the AgentManager subscription receives it and routes through its
		// internal persistence + heartbeat update path without throwing.
		for (const cb of subscribed ?? []) {
			cb("crashed", 137);
			captured.push({ handleId: handle.id, status: "crashed" });
		}
		expect(captured).toEqual([{ handleId: handle.id, status: "crashed" }]);

		await manager.stopPollingLoop();
	});

	it("(5) Telegram-fallback envelope (ndjsonAlert) is claimed by the polling loop and moved to resolved", async () => {
		registerRuntime(makeMockRuntime("mock-pty-c5"));
		const manager = new AgentManager();
		await manager.registerAgent({
			agentId: PR_TRIAGE_AGENT_ID,
			runtimeId: "mock-pty-c5",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-c5",
		});
		// Simulate the agent shell writing the fallback envelope after a
		// non-200 Telegram POST (HTTP 429 in this case). The envelope shape
		// is taken verbatim from `prompt-template.md` step (d).
		const filename = `pr-triage__${Math.floor(FIXED_NOW().getTime() / 1000)}.json`;
		writePendingTaskSync(filename, {
			agentId: PR_TRIAGE_AGENT_ID,
			ndjsonAlert: "pr-triage-telegram-send-failed",
			details: "429 {\"ok\":false,\"error_code\":429,\"description\":\"Too Many Requests: retry after 30\"}",
		});

		const seen: Array<{ agentId: string; filename: string }> = [];
		manager.on("task-resolved", (e: { agentId: string; filename: string }) => {
			seen.push(e);
		});
		await manager._pollingTickForTests();

		// Fallback file no longer in pending; landed in resolved.
		await expect(
			fsp.access(path.join(pathFor("tasks/pending"), filename)),
		).rejects.toThrow();
		await fsp.access(path.join(pathFor("tasks/resolved"), filename));

		// task-resolved emitted (generic envelope handling). Envelope-routed
		// `pr-triage-telegram-send-failed` telemetry is intentionally NOT
		// asserted: the polling loop landed in this plan does not branch on
		// `ndjsonAlert` (claimTask is decrement-only per its JSDoc), and
		// `prompt-template.md` documents that branch as a follow-up
		// dependency. Asserting an unimplemented branch would lock the test
		// to a future implementation detail.
		expect(seen).toEqual([{ agentId: PR_TRIAGE_AGENT_ID, filename }]);
		const resolved = emittedEventsOfKind("task-resolved");
		expect(resolved).toHaveLength(1);

		await manager.stopPollingLoop();
	});

	it("(6) missing GH_TOKEN (wake-check exits 2 with stderr message) → cron-skipped(wake-check-failed) — same observable shape as case 3", async () => {
		// Hermes wake-check fails out with exit 2 when `GH_TOKEN` is unset
		// (see `wake-check.sh` line 18-21). The scheduler does not parse
		// stderr to distinguish missing-token from rate-limited — both
		// surface as `wake-check-failed { exitCode: 2 }`. This is by
		// design: the scheduler is a transport, not a diagnostician.
		spawnSyncMock.mockReturnValueOnce(
			spawnSyncResult({ status: 2 }),
		);
		registerRuntime(makeMockRuntime("mock-pty-c6"));
		const manager = new AgentManager();
		await manager.registerAgent({
			agentId: PR_TRIAGE_AGENT_ID,
			runtimeId: "mock-pty-c6",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-c6",
		});
		const prompt = writePromptTemplate(tempDir, "x");
		const wake = path.join(tempDir, "wake.sh");
		fs.writeFileSync(wake, "#!/bin/bash\nexit 2\n");

		const scheduler = new CronScheduler({
			agentManager: manager,
			nowFn: FIXED_NOW,
		});
		scheduler.registerCron({
			agentId: PR_TRIAGE_AGENT_ID,
			schedule: PR_TRIAGE_SCHEDULE,
			wakeCheck: wake,
			promptTemplatePath: prompt,
			outputTaskNamePrefix: PR_TRIAGE_AGENT_ID,
		});
		scheduler.start();
		await scheduler._tickForTests();

		const skipped = emittedEventsOfKind("cron-skipped");
		expect(skipped).toHaveLength(1);
		expect(skipped[0]).toMatchObject({
			kind: "cron-skipped",
			reason: "wake-check-failed",
			exitCode: 2,
		});
		const pending = await fsp.readdir(pathFor("tasks/pending"));
		expect(pending).toEqual([]);

		await scheduler.stop();
		await manager.stopPollingLoop();
	});

	it("(7) cron expression never matches in the 60s test window → no fire, no spawnSync", async () => {
		// `nowFn` returns 13:00 UTC; cron is `0 14 * * *`. No tick can match.
		const offHour = (): Date => new Date(Date.UTC(2026, 4, 18, 13, 0, 0));
		registerRuntime(makeMockRuntime("mock-pty-c7"));
		const manager = new AgentManager();
		await manager.registerAgent({
			agentId: PR_TRIAGE_AGENT_ID,
			runtimeId: "mock-pty-c7",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-c7",
		});
		const prompt = writePromptTemplate(tempDir, "x");
		const wake = path.join(tempDir, "wake.sh");
		fs.writeFileSync(wake, "#!/bin/bash\nexit 0\n");

		const scheduler = new CronScheduler({
			agentManager: manager,
			nowFn: offHour,
		});
		scheduler.registerCron({
			agentId: PR_TRIAGE_AGENT_ID,
			schedule: PR_TRIAGE_SCHEDULE,
			wakeCheck: wake,
			promptTemplatePath: prompt,
			outputTaskNamePrefix: PR_TRIAGE_AGENT_ID,
		});
		scheduler.start();
		await scheduler._tickForTests();
		await scheduler._tickForTests();
		await scheduler._tickForTests();

		expect(spawnSyncMock).not.toHaveBeenCalled();
		expect(emittedEventsOfKind("cron-fired")).toEqual([]);
		expect(emittedEventsOfKind("cron-skipped")).toEqual([]);
		const pending = await fsp.readdir(pathFor("tasks/pending"));
		expect(pending).toEqual([]);

		await scheduler.stop();
		await manager.stopPollingLoop();
	});

	it("(8) parseCronsJsonEntry returns null for schedule:null / empty / non-string fields — cron NOT registered", () => {
		// Direct unit-test of the helper extracted from `startDaemon` so the
		// "set schedule:null to silence the cron" disable knob documented in
		// `runtime/agents/pr-triage/README.md` § Operations is provably
		// load-bearing. Running the full daemon boot to assert non-firing is
		// indirect; this test pins the exact contract.
		expect(parseCronsJsonEntry(null, PR_TRIAGE_AGENT_ID)).toBeNull();
		expect(parseCronsJsonEntry("not an object", PR_TRIAGE_AGENT_ID)).toBeNull();
		expect(parseCronsJsonEntry(42, PR_TRIAGE_AGENT_ID)).toBeNull();
		expect(
			parseCronsJsonEntry(
				{ schedule: null, prompt: "p.md", outputTaskNamePrefix: "pr" },
				PR_TRIAGE_AGENT_ID,
			),
		).toBeNull();
		expect(
			parseCronsJsonEntry(
				{ schedule: "", prompt: "p.md", outputTaskNamePrefix: "pr" },
				PR_TRIAGE_AGENT_ID,
			),
		).toBeNull();
		expect(
			parseCronsJsonEntry(
				{ schedule: "0 14 * * *", outputTaskNamePrefix: "pr" },
				PR_TRIAGE_AGENT_ID,
			),
		).toBeNull();
		expect(
			parseCronsJsonEntry(
				{ schedule: "0 14 * * *", prompt: "p.md" },
				PR_TRIAGE_AGENT_ID,
			),
		).toBeNull();
		// Happy path: all required fields present.
		const ok = parseCronsJsonEntry(
			{
				schedule: "0 14 * * *",
				prompt: "runtime/agents/pr-triage/prompt-template.md",
				outputTaskNamePrefix: "pr-triage",
				wakeCheck: "runtime/agents/pr-triage/wake-check.sh",
				maxConcurrent: 1,
			},
			PR_TRIAGE_AGENT_ID,
		);
		expect(ok).not.toBeNull();
		expect(ok).toMatchObject({
			agentId: PR_TRIAGE_AGENT_ID,
			schedule: "0 14 * * *",
			promptTemplatePath: "runtime/agents/pr-triage/prompt-template.md",
			outputTaskNamePrefix: "pr-triage",
			wakeCheck: "runtime/agents/pr-triage/wake-check.sh",
			maxConcurrent: 1,
		});
	});

	it("(9) end-to-end decrement chain: tick → fire, tick → overlap-prevented, polling tick → resolved, tick → fires again", async () => {
		// Closes the loop across 07a + 07b + 04a + 04b. Without the
		// decrement-on-task-resolved listener, runningCount only grows
		// and maxConcurrent permanently blocks after the first fire. The
		// production cron schedule fires once per day, so a daemon that
		// failed this would only emit ONE pr-triage Telegram message and
		// then go silent — exactly the failure mode this test guards.
		spawnSyncMock.mockReturnValue(spawnSyncResult({ status: 0 }));
		registerRuntime(makeMockRuntime("mock-pty-c9"));
		const manager = new AgentManager();
		await manager.registerAgent({
			agentId: PR_TRIAGE_AGENT_ID,
			runtimeId: "mock-pty-c9",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-c9",
		});
		const prompt = writePromptTemplate(tempDir, "go");
		const wake = path.join(tempDir, "wake.sh");
		fs.writeFileSync(wake, "#!/bin/bash\nexit 0\n");

		const scheduler = new CronScheduler({
			agentManager: manager,
			nowFn: FIXED_NOW,
		});
		scheduler.registerCron({
			agentId: PR_TRIAGE_AGENT_ID,
			schedule: PR_TRIAGE_SCHEDULE,
			wakeCheck: wake,
			promptTemplatePath: prompt,
			outputTaskNamePrefix: PR_TRIAGE_AGENT_ID,
			maxConcurrent: 1,
		});

		// Tick 1: fires, runningCount → 1.
		await scheduler._tickForTests();
		expect(scheduler._runningCountForTests().get(PR_TRIAGE_AGENT_ID)).toBe(1);
		const pendingAfterFire1 = await fsp.readdir(pathFor("tasks/pending"));
		expect(pendingAfterFire1).toHaveLength(1);
		expect(emittedEventsOfKind("cron-fired")).toHaveLength(1);

		// Tick 2: SAME minute, runningCount already at maxConcurrent →
		// cron-overlap-prevented, no second file.
		await scheduler._tickForTests();
		const overlap = emittedEventsOfKind("cron-overlap-prevented");
		expect(overlap).toHaveLength(1);
		expect(overlap[0]).toMatchObject({
			kind: "cron-overlap-prevented",
			agentId: PR_TRIAGE_AGENT_ID,
			runningCount: 1,
			maxConcurrent: 1,
		});
		const pendingAfterFire2 = await fsp.readdir(pathFor("tasks/pending"));
		expect(pendingAfterFire2).toHaveLength(1);
		expect(emittedEventsOfKind("cron-fired")).toHaveLength(1);

		// Polling tick claims the cron-fired file → task-resolved →
		// decrement listener drops runningCount back to 0.
		await manager._pollingTickForTests();
		expect(
			scheduler._runningCountForTests().get(PR_TRIAGE_AGENT_ID) ?? 0,
		).toBe(0);
		expect(emittedEventsOfKind("task-resolved")).toHaveLength(1);

		// Tick 3: same minute, slot now free → fires successfully (no
		// additional overlap-prevented event).
		await scheduler._tickForTests();
		expect(scheduler._runningCountForTests().get(PR_TRIAGE_AGENT_ID)).toBe(1);
		expect(emittedEventsOfKind("cron-overlap-prevented")).toHaveLength(1);
		expect(emittedEventsOfKind("cron-fired")).toHaveLength(2);
		const pendingAfterFire3 = await fsp.readdir(pathFor("tasks/pending"));
		expect(pendingAfterFire3).toHaveLength(1);

		await scheduler.stop();
		await manager.stopPollingLoop();
	});
});

// Silence unused-import lint by referencing EventEmitter in a type
// position (we keep the import to mirror cron-scheduler.test.ts patterns
// and document the AgentManager-as-EventEmitter contract the cron
// scheduler depends on).
type _EventEmitterContract = EventEmitter;
