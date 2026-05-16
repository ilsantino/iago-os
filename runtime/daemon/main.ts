/**
 * Daemon entry point — wires Plans 01–06 into a single runnable process.
 *
 * Startup sequence (Plan 07 stress-test EC2 binding):
 *   1. `ensureStateDirsSync()` — create state-root subtrees.
 *   2. `loadConfig()` if no `config` was injected.
 *   3. Side-effect import of `claude-pty` so the adapter registers itself.
 *   4. Construct `HeartbeatController` with config.heartbeat overrides.
 *   5. Construct `AgentManager({ heartbeat })`. The constructor wires
 *      `onForceRestart → restartAgent` automatically (Plan 03).
 *   6. `agentManager.bootRecovery()` — scans `.daemon-stop` markers,
 *      reclaims stale claims (Plan 02 stress-test E1), replays
 *      session.jsonl up to HWM for crash entries (Plan 03).
 *   7. Construct + start `IpcServer`. `IpcServer.start()` preemptively
 *      unlinks any stale socket file on POSIX (Plan 05 EC1).
 *   8. If `config.telegram` is non-null, construct + start `TelegramBot`.
 *   9. Install SIGINT/SIGTERM handlers calling `shutdown()` — BEFORE the
 *      auto-start loop so the EC1 guard can observe the flag.
 *   10. Auto-start every `agents[]` with `autoStart: true`.
 *   11. Emit `daemon-start` telemetry.
 *
 * Shutdown sequence (idempotent — safe to call from both SIGINT and
 * SIGTERM handlers concurrently):
 *   1. Set the shutdown flag (EC1 — newly-spawning agents observe it
 *      and abort their own track step).
 *   2. Stop the heartbeat (waits for in-flight sweep).
 *   3. Stop the bot (stops polling).
 *   4. Stop the IPC server (drains in-flight requests).
 *   5. `shutdownAgent` every live handle — writes graceful markers.
 *   6. Emit `daemon-stop` telemetry.
 *
 * EC1 — SIGINT during spawn: the auto-start loop re-checks the
 * shutdown flag immediately after each `registerAgent` returns. If the
 * flag fired between spawn and the post-spawn telemetry emit, the
 * fresh handle is immediately shut down so no PTY subprocess survives
 * as an orphan.
 *
 * MC1 — config errors: `main()` catches everything from `startDaemon`
 * and writes `error: <message>` to stderr (no stack), then sets
 * `process.exitCode = 1`. Tests that drive `startDaemon` directly
 * bypass `main()` so they can assert on the thrown error.
 */

import {
	type AgentRuntime,
	resolveRuntime,
} from "../agent-runtime/registry.js";
import type {
	AgentHandle,
	AgentMessage,
	AgentShape,
} from "../agent-runtime/types.js";
import { TelegramBot } from "../telegram/bot.js";
import {
	type ApprovalRequest,
	listPendingApprovals,
} from "../telegram/approval-bus.js";

import { AgentManager } from "./agent-manager.js";
import {
	type AgentConfig,
	type DaemonConfig,
	loadConfig,
} from "./config.js";
import { HeartbeatController } from "./heartbeat.js";
import { IpcServer } from "./ipc-server.js";
import { ensureStateDirsSync } from "./state-paths.js";
import { emit } from "./telemetry.js";

export interface DaemonHandle {
	readonly shutdown: () => Promise<void>;
	/** Resolves when shutdown() completes. Await this to block until teardown is done. */
	readonly shutdownPromise: Promise<void>;
	readonly agentManager: AgentManager;
	readonly heartbeat: HeartbeatController;
	readonly ipcServer: IpcServer;
	readonly bot: TelegramBot | null;
	readonly config: DaemonConfig;
}

export async function startDaemon(
	overrideConfig?: DaemonConfig,
): Promise<DaemonHandle> {
	ensureStateDirsSync();

	const config = overrideConfig ?? (await loadConfig());

	// Side-effect import — registers `claude-pty` in the polymorphic
	// registry. Adapter failures are fail-isolated per registry.ts JSDoc.
	try {
		await import("../agent-runtime/pty/claude-pty.js");
	} catch (err) {
		console.error(
			`[daemon] claude-pty registration failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	const heartbeat = new HeartbeatController({
		intervalMs: config.heartbeat.intervalMs,
		rssLimitBytes: config.heartbeat.rssLimitBytes,
		stallThresholdMs: config.heartbeat.stallThresholdMs,
		onForceRestart: async () => {
			// `AgentManager.constructor` rebinds this callback to its own
			// `restartAgent` (Plan 03 I1). The placeholder keeps the
			// `HeartbeatController` contract satisfied for the brief window
			// before the manager is constructed below.
		},
	});

	const agentManager = new AgentManager({ heartbeat });

	const bootResult = await agentManager.bootRecovery();
	for (const handleId of bootResult.cleanShutdowns) {
		await emit({
			kind: "agent-exited",
			handleId,
			reason: "graceful",
		});
	}
	for (const handleId of bootResult.crashes) {
		await emit({
			kind: "agent-exited",
			handleId,
			reason: "crash",
		});
	}

	const ipcServer = new IpcServer({
		socketPath: config.ipc.socketPath,
		cacheTtlMs: config.ipc.cacheTtlMs,
		getFleetHealth: async () => buildFleetHealth(agentManager),
		listAgents: async () => agentManager.listHandles(),
		getHandle: (id: string) => agentManager.getHandle(id) ?? null,
	});
	await ipcServer.start();

	let bot: TelegramBot | null = null;
	if (config.telegram !== null) {
		bot = new TelegramBot({
			token: config.telegram.token,
			allowedUserIds: config.telegram.allowedUserIds,
			agentManager: {
				getHandle: (id) => agentManager.getHandle(id),
				listHandles: () => agentManager.listHandles(),
				shutdownAgent: (id, signal) =>
					agentManager.shutdownAgent(id, signal),
				restartAgent: (id, reason) =>
					agentManager.restartAgent(
						id,
						reason as "stalled" | "rss-exceeded" | "crash",
					),
				getShape: async (agentId: string): Promise<AgentShape | null> =>
					getShapeForAgent(agentManager, agentId),
			},
			injectIntoAgent: async (agentId, text) => {
				await injectIntoAgent(agentManager, agentId, text);
			},
		});
		await bot.start();
	}

	let shuttingDown = false;
	const shutdownHandlers = new Set<() => void>();
	let resolveShutdownPromise!: () => void;
	const shutdownPromise = new Promise<void>((resolve) => {
		resolveShutdownPromise = resolve;
	});

	const shutdown = async (): Promise<void> => {
		if (shuttingDown) return;
		shuttingDown = true;
		try {
			await heartbeat.stop();
		} catch (err) {
			console.error(
				`[daemon] heartbeat.stop failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		if (bot !== null) {
			try {
				await bot.stop();
			} catch (err) {
				console.error(
					`[daemon] bot.stop failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
		try {
			await ipcServer.stop();
		} catch (err) {
			console.error(
				`[daemon] ipcServer.stop failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		const handles = agentManager.listHandles();
		for (const handle of handles) {
			try {
				await agentManager.shutdownAgent(handle.id, "SIGTERM");
			} catch (err) {
				console.error(
					`[daemon] shutdownAgent(${handle.id}) failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
		try {
			await emit({
				kind: "daemon-stop",
				pid: process.pid,
				reason: "graceful",
			});
		} catch (err) {
			console.error(
				`[daemon] telemetry emit(daemon-stop) failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		for (const remove of shutdownHandlers) {
			remove();
		}
		resolveShutdownPromise();
	};

	// Wire signal handlers BEFORE the auto-start loop so the EC1 SIGINT guard
	// (shuttingDown check after each registerAgent) can actually fire. Without
	// handlers installed here, SIGINT during the loop terminates the process
	// immediately, leaving spawned PTY subprocesses as orphans.
	const sigintHandler = (): void => {
		void shutdown();
	};
	const sigtermHandler = (): void => {
		void shutdown();
	};
	process.on("SIGINT", sigintHandler);
	process.on("SIGTERM", sigtermHandler);
	shutdownHandlers.add(() => process.removeListener("SIGINT", sigintHandler));
	shutdownHandlers.add(() =>
		process.removeListener("SIGTERM", sigtermHandler),
	);

	for (const cfg of config.agents) {
		if (!cfg.autoStart) continue;
		try {
			const handle = await agentManager.registerAgent({
				agentId: cfg.agentId,
				runtimeId: cfg.runtimeId,
				org: cfg.org,
				cwd: cfg.cwd,
				env: cfg.env,
				sessionId: resolveSessionId(cfg),
			});
			if (shuttingDown) {
				try {
					await agentManager.shutdownAgent(handle.id, "SIGTERM");
				} catch (err) {
					console.error(
						`[daemon] post-spawn shutdown(${handle.id}) failed: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
				break;
			}
			await emit({
				kind: "agent-registered",
				agentId: cfg.agentId,
				runtimeId: cfg.runtimeId,
				org: cfg.org,
			});
			await emit({
				kind: "agent-spawned",
				handleId: handle.id,
				agentId: handle.agentId,
				sessionId: handle.sessionId,
				runtimeId: cfg.runtimeId,
				generationToken: handle.generationToken,
			});
		} catch (err) {
			console.error(
				`[daemon] registerAgent(${cfg.agentId}) failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	heartbeat.start();

	await emit({
		kind: "daemon-start",
		pid: process.pid,
		nodeVersion: process.versions.node,
	});

	return {
		shutdown,
		shutdownPromise,
		agentManager,
		heartbeat,
		ipcServer,
		bot,
		config,
	};
}

/**
 * Process entry point. Catches startup failures (e.g., malformed
 * `daemon-config.json`) and surfaces them as `error: <message>` on
 * stderr with `process.exitCode = 1` — no raw stack trace.
 *
 * Tests that need to assert on a thrown startup error import
 * `startDaemon` directly so they can `await expect(...).rejects.toThrow`.
 */
export async function main(): Promise<void> {
	let daemon: DaemonHandle;
	try {
		daemon = await startDaemon();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		process.stderr.write(`error: ${message}\n`);
		process.exitCode = 1;
		return;
	}
	// startDaemon() already installed permanent SIGINT/SIGTERM handlers that
	// call shutdown(). Await the shutdownPromise here instead of registering
	// a second set of handlers — eliminates the double-handler ambiguity.
	await daemon.shutdownPromise;
}

async function buildFleetHealth(
	manager: AgentManager,
): Promise<Array<Record<string, unknown>>> {
	const handles = manager.listHandles();
	return handles.map((h) => ({
		handleId: h.id,
		agentId: h.agentId,
		shape: h.shape,
		generationToken: h.generationToken,
		spawnedAt: h.spawnedAt,
	}));
}

async function getShapeForAgent(
	manager: AgentManager,
	agentId: string,
): Promise<AgentShape | null> {
	for (const h of manager.listHandles()) {
		if (h.agentId === agentId) return h.shape;
	}
	return null;
}

async function injectIntoAgent(
	manager: AgentManager,
	agentId: string,
	text: string,
): Promise<void> {
	const handle = findHandleForAgent(manager, agentId);
	if (handle === null) {
		throw new Error(`no live handle for agent: ${agentId}`);
	}
	const runtime: AgentRuntime = resolveRuntime(handle.runtime);
	const message: AgentMessage = { kind: "inject", payload: { text } };
	await runtime.send(handle, message);
}

function findHandleForAgent(
	manager: AgentManager,
	agentId: string,
): AgentHandle | null {
	for (const h of manager.listHandles()) {
		if (h.agentId === agentId) return h;
	}
	return null;
}

function resolveSessionId(cfg: AgentConfig): string {
	const envSession = cfg.env.CLAUDE_CODE_SESSION_ID;
	if (typeof envSession === "string" && envSession.length > 0) {
		return envSession;
	}
	return `${cfg.agentId}-session`;
}

// Re-exports kept narrow — only what downstream test imports already need.
export type { DaemonConfig } from "./config.js";
export type { ApprovalRequest };
export { listPendingApprovals };
