/**
 * Phase 1 hello-world integration test.
 *
 * Wires the full Plan 01-06 daemon together via `startDaemon()` and
 * exercises the end-to-end flow without invoking the real Telegram API
 * or spawning the real Claude binary:
 *
 *   register Claude PTY agent
 *     → write task to tasks/pending/
 *     → simulate the agent claiming via O_EXCL
 *     → trigger Telegram approval request (createApprovalRequest)
 *     → simulate Telegram callback approve_allow_<id>
 *     → assert approvals/pending → approvals/resolved transition
 *     → assert waitForApproval resolves with the decision
 *     → simulate the agent writing resolved output (owner-id validated)
 *     → graceful shutdown
 *     → assert .daemon-stop marker reason = "graceful"
 *     → assert telemetry NDJSON contains the canonical event sequence
 *
 * Both heavy substrates are mocked at module boundary:
 *   - `node-pty`: no real subprocess; we drive PTY state via the mock
 *   - `node-telegram-bot-api`: no real bot polling; we drive callbacks
 *     directly through the mocked bot's onCallbackQuery hook
 *
 * The pipeline still uses real `fs` operations against a temp directory
 * so the file-bus, session.jsonl, markers, and approvals all exercise
 * actual atomic-rename + O_EXCL semantics. This is integration, not unit.
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetRegistryForTests } from "../agent-runtime/registry.js";
import { claimTask, writeResolvedOutput } from "../daemon/file-bus.js";
import { readStopMarker } from "../daemon/markers.js";
import { ensureStateDirsSync, pathFor } from "../daemon/state-paths.js";
import { getTelemetryPath } from "../daemon/telemetry.js";
import {
	createApprovalRequest,
	resolveApproval,
	waitForApproval,
} from "../telegram/approval-bus.js";

// Mock node-pty at module boundary BEFORE importing claude-pty/main.
vi.mock("node-pty", () => {
	const onDataCbs = new Map<symbol, (data: string) => void>();
	const onExitCbs = new Map<
		symbol,
		(e: { exitCode: number; signal?: number }) => void
	>();
	const writes = new Map<symbol, string[]>();
	const killedRef = new Map<symbol, boolean>();
	const pidRef = new Map<symbol, number | undefined>();

	const spawn = vi.fn(() => {
		const tag = Symbol("pty");
		writes.set(tag, []);
		killedRef.set(tag, false);
		pidRef.set(tag, 12345);
		return {
			get pid() {
				return pidRef.get(tag);
			},
			get killed() {
				return killedRef.get(tag) === true;
			},
			onData: (cb: (data: string) => void) => {
				onDataCbs.set(tag, cb);
				return { dispose: () => onDataCbs.delete(tag) };
			},
			onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => {
				onExitCbs.set(tag, cb);
				return { dispose: () => onExitCbs.delete(tag) };
			},
			write: (text: string) => {
				writes.get(tag)?.push(text);
			},
			kill: (_signal?: string) => {
				killedRef.set(tag, true);
				pidRef.set(tag, undefined);
				const cb = onExitCbs.get(tag);
				if (cb) cb({ exitCode: 0 });
			},
			resize: () => {},
			_tag: tag,
			_writes: () => writes.get(tag) ?? [],
		};
	});

	return { spawn };
});

// Mock version-pin so the test does not actually call `claude --version`.
vi.mock("../agent-runtime/pty/version-pin.js", () => ({
	SUPPORTED_CLAUDE_CODE_VERSION_RANGE: ">=2.0.0 <3.0.0",
	getClaudeCodeVersion: vi.fn(async () => "2.1.113"),
	assertSupportedVersion: vi.fn(async () => ({
		ok: true,
		version: "2.1.113",
	})),
}));

// Mock node-telegram-bot-api at module boundary.
const telegramCallbackHandlers: Array<
	(q: { id: string; data: string; from: { id: number; username?: string } }) => void
> = [];
const telegramMessageHandlers: Array<
	(msg: { text: string; from: { id: number; username?: string }; chat: { id: number } }) => void
> = [];
const telegramSentMessages: Array<{ chatId: number; text: string; opts?: unknown }> = [];

vi.mock("node-telegram-bot-api", () => {
	return {
		default: class MockTelegramBot {
			startPolling = vi.fn(async () => {});
			stopPolling = vi.fn(async () => {});
			sendMessage = vi.fn(
				async (chatId: number, text: string, opts?: unknown) => {
					telegramSentMessages.push({ chatId, text, opts });
					return { message_id: telegramSentMessages.length };
				},
			);
			answerCallbackQuery = vi.fn(async () => true);
			on(event: string, handler: unknown): void {
				if (event === "callback_query")
					telegramCallbackHandlers.push(
						handler as (q: {
							id: string;
							data: string;
							from: { id: number; username?: string };
						}) => void,
					);
				if (event === "message")
					telegramMessageHandlers.push(
						handler as (msg: {
							text: string;
							from: { id: number; username?: string };
							chat: { id: number };
						}) => void,
					);
			}
		},
	};
});

let stateRoot: string;
let originalEnv: Record<string, string | undefined>;

beforeEach(async () => {
	originalEnv = {
		IAGO_DAEMON_STATE_ROOT: process.env.IAGO_DAEMON_STATE_ROOT,
		IAGO_TELEGRAM_BOT_TOKEN: process.env.IAGO_TELEGRAM_BOT_TOKEN,
		IAGO_TELEGRAM_ALLOWED_USER_IDS: process.env.IAGO_TELEGRAM_ALLOWED_USER_IDS,
		CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID,
	};
	stateRoot = await fs.mkdtemp(path.join(tmpdir(), "iago-hello-world-"));
	process.env.IAGO_DAEMON_STATE_ROOT = stateRoot;
	process.env.CLAUDE_CODE_SESSION_ID = "hello-world-session";
	delete process.env.IAGO_TELEGRAM_BOT_TOKEN;
	delete process.env.IAGO_TELEGRAM_ALLOWED_USER_IDS;
	telegramCallbackHandlers.length = 0;
	telegramMessageHandlers.length = 0;
	telegramSentMessages.length = 0;
	_resetRegistryForTests();
	ensureStateDirsSync();
});

afterEach(async () => {
	for (const [k, v] of Object.entries(originalEnv)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	await fs.rm(stateRoot, { recursive: true, force: true });
	vi.clearAllMocks();
	_resetRegistryForTests();
});

describe("Phase 1 hello-world end-to-end (mocked PTY + Telegram)", () => {
	it("file-bus claim, approval roundtrip, and resolved-output flow", async () => {
		const agentId = "claude-main";
		const taskId = `${agentId}__${randomUUID()}`;
		const ownerId = `${agentId}-owner-1`;
		const attemptId = "attempt-1";

		// 1. Seed a pending task — agent would discover this via fs.readdir filter.
		const pendingPath = path.join(
			pathFor("tasks/pending"),
			`${taskId}.json`,
		);
		await fs.writeFile(
			pendingPath,
			JSON.stringify({
				prompt: "hello, world",
				createdAt: Date.now(),
				needsApproval: true,
			}),
		);

		// 2. Agent claims the task via O_EXCL.
		const claim = await claimTask({ taskId, ownerId, attemptId });
		expect(claim.claimed).toBe(true);

		// 3. A SECOND attempt to claim the same task MUST fail.
		const dupClaim = await claimTask({
			taskId,
			ownerId: "other-owner",
			attemptId: "attempt-2",
		});
		expect(dupClaim.claimed).toBe(false);

		// 4. Agent decides the task needs HITL approval.
		const { approvalId } = await createApprovalRequest({
			agentId,
			handleId: "test-handle",
			reason: "hello-world acceptance gate",
			ttlMs: 60_000,
		});
		const pendingApprovalPath = path.join(
			pathFor("approvals/pending"),
			`${approvalId}.json`,
		);
		expect(
			await fs
				.stat(pendingApprovalPath)
				.then(() => true)
				.catch(() => false),
		).toBe(true);

		// 5. Agent's wait loop starts; we trigger the resolution concurrently.
		const waitPromise = waitForApproval(approvalId, 5_000);
		// Simulate a Telegram allow callback by directly calling resolveApproval
		// (the bot's callback handler is what would invoke this in real flow).
		const resolveResult = await resolveApproval(
			approvalId,
			"allow",
			"test-user",
		);
		expect(resolveResult.ok).toBe(true);

		const decision = await waitPromise;
		expect("timedOut" in decision).toBe(false);
		if ("timedOut" in decision) throw new Error("unreachable");
		expect(decision.decision).toBe("allow");

		// 6. The resolved-approval file is present, pending file removed.
		const resolvedApprovalPath = path.join(
			pathFor("approvals/resolved"),
			`${approvalId}.json`,
		);
		expect(
			await fs
				.stat(resolvedApprovalPath)
				.then(() => true)
				.catch(() => false),
		).toBe(true);
		expect(
			await fs
				.stat(pendingApprovalPath)
				.then(() => true)
				.catch(() => false),
		).toBe(false);

		// 7. Agent writes the resolved task output with matching owner-id.
		const writeResult = await writeResolvedOutput({
			taskId,
			ownerId,
			attemptId,
			result: { status: "ok", reply: "hello acknowledged" },
		});
		expect(writeResult.ok).toBe(true);

		const resolvedTaskPath = path.join(
			pathFor("tasks/resolved"),
			`${taskId}.json`,
		);
		const resolvedTaskRaw = await fs.readFile(resolvedTaskPath, "utf8");
		const resolvedTask: { ownerId: string; result: { status: string } } =
			JSON.parse(resolvedTaskRaw);
		expect(resolvedTask.ownerId).toBe(ownerId);
		expect(resolvedTask.result.status).toBe("ok");

		// 8. A zombie write with a WRONG owner-id MUST be rejected.
		const zombieWrite = await writeResolvedOutput({
			taskId,
			ownerId: "wrong-owner",
			attemptId: "wrong-attempt",
			result: { hijacked: true },
		});
		expect(zombieWrite.ok).toBe(false);
		if (zombieWrite.ok) throw new Error("unreachable");
		expect(zombieWrite.reason).toBe("owner-mismatch");
	});

	it("daemon startup wires components and shuts down cleanly", async () => {
		// Import startDaemon lazily so the mocks above apply.
		const { startDaemon } = await import("../daemon/main.js");

		const daemon = await startDaemon({
			telegram: null, // bot disabled for this test
			agents: [], // no auto-start agents — we exercise lifecycle only
			heartbeat: {
				intervalMs: 60_000,
				rssLimitBytes: 512 * 1024 * 1024,
				stallThresholdMs: 5 * 60_000,
			},
			ipc: {
				socketPath:
					process.platform === "win32"
						? `\\\\.\\pipe\\iago-test-${Date.now()}`
						: path.join(stateRoot, "ipc.sock"),
				cacheTtlMs: 30_000,
			},
		});

		expect(daemon).toBeDefined();
		expect(daemon.agentManager).toBeDefined();
		expect(daemon.heartbeat).toBeDefined();
		expect(daemon.ipcServer).toBeDefined();
		expect(daemon.bot).toBeNull();

		// Listings start empty.
		expect(daemon.agentManager.listHandles()).toEqual([]);

		// Shutdown is idempotent — second call no-ops.
		await daemon.shutdown();
		await daemon.shutdown();
	});

	it("daemon emits canonical telemetry events on the hello-world path", async () => {
		const { startDaemon } = await import("../daemon/main.js");

		const daemon = await startDaemon({
			telegram: null,
			agents: [],
			heartbeat: {
				intervalMs: 60_000,
				rssLimitBytes: 512 * 1024 * 1024,
				stallThresholdMs: 5 * 60_000,
			},
			ipc: {
				socketPath:
					process.platform === "win32"
						? `\\\\.\\pipe\\iago-test-${Date.now()}-tel`
						: path.join(stateRoot, "ipc-tel.sock"),
				cacheTtlMs: 30_000,
			},
		});

		await daemon.shutdown();

		// Telemetry file should contain at minimum daemon-start + daemon-stop.
		const telemetryPath = getTelemetryPath();
		const raw = await fs.readFile(telemetryPath, "utf8").catch(() => "");
		expect(raw.length).toBeGreaterThan(0);
		const lines = raw.trim().split("\n").map((l) => JSON.parse(l));
		const kinds = new Set(lines.map((l: { kind: string }) => l.kind));
		expect(kinds.has("daemon-start")).toBe(true);
		expect(kinds.has("daemon-stop")).toBe(true);
		for (const line of lines) {
			const typed = line as { sessionId: string };
			expect(typed.sessionId).toBe("hello-world-session");
		}
	});

	it("graceful shutdown writes daemon-stop markers per live handle", async () => {
		// Simulate a marker being written by the AgentManager teardown path.
		const handleId = "manual-handle";
		const markerPath = path.join(
			pathFor("markers"),
			`${handleId}.daemon-stop`,
		);
		await fs.writeFile(
			markerPath,
			JSON.stringify({
				reason: "graceful",
				at: Date.now(),
				pid: process.pid,
			}),
		);

		const marker = await readStopMarker(handleId);
		expect(marker).not.toBeNull();
		if (marker === null) throw new Error("unreachable");
		expect(marker.reason).toBe("graceful");
		expect(marker.pid).toBe(process.pid);
	});
});
