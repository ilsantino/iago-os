/**
 * Daemon entry point — wires Plans 01–06 into a single runnable process.
 *
 * Startup sequence (Plan 07 stress-test EC2 binding + Plan 01b cred bootstrap):
 *   0. `loadSystemdCredentials()` — read systemd `LoadCredentialEncrypted=`
 *      files from `$CREDENTIALS_DIRECTORY` into `process.env` BEFORE
 *      anything else. Local-dev no-op when `CREDENTIALS_DIRECTORY` is
 *      unset. Emits `cred-bootstrap-loaded` telemetry with the credstore
 *      FILE NAMES (never the values) of every credential that actually
 *      wrote to env on this boot.
 *   1. `ensureStateDirsSync()` — create state-root subtrees.
 *   2. `loadConfig()` if no `config` was injected.
 *   3. Side-effect import of `claude-pty` so the adapter registers itself.
 *   4. Construct `HeartbeatController` with config.heartbeat overrides.
 *   5. Construct `AgentManager({ heartbeat })`. The constructor wires
 *      `onForceRestart → restartAgent` automatically (Plan 03).
 *   6. `agentManager.bootRecovery()` — scans `.daemon-stop` markers,
 *      reclaims stale claims (Plan 02 stress-test E1), replays
 *      session.jsonl up to HWM for crash entries (Plan 03).
 *   6b. `recoverStrandedApprovals()` — reconciles any approval
 *      inflight/pending dual-presence or inflight-only crashes from a
 *      prior daemon run (Codex PR48 HIGH). MUST run before the bot
 *      starts polling so stranded approvals do not absorb the user's
 *      next decision as `already-resolved`.
 *   7. Construct + start `IpcServer`. `IpcServer.start()` preemptively
 *      unlinks any stale socket file on POSIX (Plan 05 EC1).
 *   8. If `config.telegram` is non-null, construct + start `TelegramBot`.
 *   9. Install SIGINT/SIGTERM handlers calling `shutdown()` — BEFORE the
 *      auto-start loop so the EC1 guard can observe the flag.
 *   9b. Install SIGHUP credential-reload handler via
 *      `registerSighupHandler` (Plan 06). Re-invokes
 *      `loadSystemdCredentials` and emits `cred-reload-fired` telemetry.
 *      Reads the `shuttingDown` flag through a closure so a SIGHUP
 *      arriving after SIGTERM/SIGINT is ignored (C1 shutdown-race fix).
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

import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import {
	type AgentRuntime,
	listRuntimes,
	resolveRuntime,
} from "../agent-runtime/registry.js";
import type {
	AgentHandle,
	AgentMessage,
	AgentShape,
} from "../agent-runtime/types.js";
// Side-effect import — registers `claude-pty` in the polymorphic registry at
// module load time. Adapter registration failures are fail-isolated inside
// the adapter module itself; the daemon detects missing registration via
// `listRuntimes()` at startup (Codex H1 + Opus C2 fix).
import "../agent-runtime/pty/claude-pty.js";
import {
	type ApprovalRequest,
	listPendingApprovals,
	recoverStrandedApprovals,
} from "../telegram/approval-bus.js";
import { TelegramBot } from "../telegram/bot.js";

import { AgentManager, type RegisterAgentConfig } from "./agent-manager.js";
import { type AgentConfig, type DaemonConfig, loadConfig } from "./config.js";
import {
	envVarToFileName,
	getCredentialEnvVars,
	loadSystemdCredentials,
} from "./cred-bootstrap.js";
import { HeartbeatController } from "./heartbeat.js";
import { IpcServer } from "./ipc-server.js";
import { ensureStateDirsSync, pathFor } from "./state-paths.js";
import { type DaemonEvent, emit } from "./telemetry.js";

/**
 * Per-stage shutdown timeout (ms). Opus I4: the daemon shutdown path
 * previously awaited each stage serially with no outer timeout — a hung
 * adapter shutdown would block forever and the rollback runbook's
 * `kill -KILL` step was the only escape. Bounding each stage at 10s
 * matches the 30s budget documented in `runtime/migration/phase-1-rollback.md`
 * (heartbeat + bot + ipc + handle loop ≈ 4 stages × 10s, fits under 30s).
 */
export const SHUTDOWN_STAGE_TIMEOUT_MS = 10_000;

export async function withTimeout<T>(
	label: string,
	op: () => Promise<T>,
	timeoutMs = SHUTDOWN_STAGE_TIMEOUT_MS,
): Promise<T | "timeout"> {
	let timer: NodeJS.Timeout | null = null;
	const timeout = new Promise<"timeout">((resolve) => {
		timer = setTimeout(() => resolve("timeout"), timeoutMs);
	});
	try {
		const result = await Promise.race([op(), timeout]);
		if (result === "timeout") {
			console.error(
				`[daemon] shutdown stage "${label}" exceeded ${timeoutMs}ms — proceeding`,
			);
		}
		return result;
	} finally {
		if (timer !== null) clearTimeout(timer);
	}
}

/**
 * Build a `knownConfigs` map by reading persisted `<handleId>.json`
 * records under `pathFor("agents")`. Phase 1 plan 03 writes these on
 * every `registerAgent` (see `agent-manager.persistAgentConfig`).
 * Without this, `bootRecovery` cannot fire the crash-without-marker
 * recovery branch (Codex H1 / Opus I2) — the daemon would silently
 * strand every formerly-registered agent across a hard crash.
 */
export async function loadPersistedConfigs(): Promise<
	Map<string, RegisterAgentConfig>
> {
	const out = new Map<string, RegisterAgentConfig>();
	const dir = pathFor("agents");
	let entries: string[];
	try {
		entries = await fsp.readdir(dir);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return out;
		console.error(
			`[daemon] loadPersistedConfigs readdir(${dir}) failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		return out;
	}
	for (const entry of entries) {
		if (!entry.endsWith(".json")) continue;
		const handleId = entry.slice(0, -5);
		const file = path.join(dir, entry);
		let raw: string;
		try {
			raw = await fsp.readFile(file, "utf8");
		} catch (err) {
			console.error(
				`[daemon] loadPersistedConfigs read(${file}) failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (err) {
			console.error(
				`[daemon] loadPersistedConfigs parse(${file}) failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			continue;
		}
		if (typeof parsed !== "object" || parsed === null) continue;
		const obj = parsed as Record<string, unknown>;
		const agentId = typeof obj.agentId === "string" ? obj.agentId : null;
		const runtimeId = typeof obj.runtimeId === "string" ? obj.runtimeId : null;
		const cwd = typeof obj.cwd === "string" ? obj.cwd : null;
		const sessionId = typeof obj.sessionId === "string" ? obj.sessionId : null;
		const org = typeof obj.org === "string" ? obj.org : undefined;
		const envRaw = obj.env;
		const env: Record<string, string> = {};
		if (typeof envRaw === "object" && envRaw !== null) {
			for (const [k, v] of Object.entries(envRaw)) {
				if (typeof v === "string") env[k] = v;
			}
		}
		if (
			agentId === null ||
			runtimeId === null ||
			cwd === null ||
			sessionId === null
		) {
			console.error(
				`[daemon] loadPersistedConfigs skipping ${entry}: missing required field`,
			);
			continue;
		}
		out.set(handleId, {
			agentId,
			runtimeId,
			org,
			cwd,
			env,
			sessionId,
		});
	}
	return out;
}

/**
 * Plan 01b Task 4 (C1 carry-over): compute the `runUnder` field for the
 * `daemon-start` telemetry event.
 *
 * `NODE_ENV=test` is a HARD OVERRIDE that always returns `"test"`,
 * regardless of `CREDENTIALS_DIRECTORY` or `INVOCATION_ID`. This prevents
 * unit tests that legitimately set `CREDENTIALS_DIRECTORY` to a tmp dir
 * (e.g., `cred-bootstrap.test.ts`) from falsely tripping the systemd
 * detector and emitting `runUnder: "systemd"` from a non-systemd
 * harness.
 *
 * Outside test mode, presence of either `CREDENTIALS_DIRECTORY` (set by
 * `LoadCredentialEncrypted=` directives) or `INVOCATION_ID` (set by
 * systemd for every unit invocation) indicates a systemd unit run.
 *
 * Exported so main.test.ts can directly assert the override contract;
 * inlining inside `startDaemon`'s IIFE made the rule un-unit-testable.
 */
export type RunUnder = "systemd" | "local" | "test";

export function computeRunUnder(
	env: NodeJS.ProcessEnv = process.env,
): RunUnder {
	if (env.NODE_ENV === "test") return "test";
	const credDir = env.CREDENTIALS_DIRECTORY;
	const invocationId = env.INVOCATION_ID;
	const isSystemd =
		(credDir !== undefined && credDir.length > 0) ||
		(invocationId !== undefined && invocationId.length > 0);
	return isSystemd ? "systemd" : "local";
}

/**
 * Plan 06 — SIGHUP credential-reload handler.
 *
 * SIGHUP triggers re-load of systemd-creds files into `process.env`.
 * Send via `systemctl kill -s SIGHUP iago-os-v2-daemon.service`. The
 * handler re-invokes `loadSystemdCredentials()` (which already enforces
 * the "external env-var override beats credstore" precedence so
 * re-invocation is safe) and emits a `cred-reload-fired` NDJSON
 * telemetry event listing env-var NAMES that changed, were re-read but
 * unchanged, or failed. Names only — NEVER values, matching Plan 01
 * Task 4 C2 posture.
 *
 * Does NOT auto-restart in-flight agents. SIGHUP updates the DAEMON's
 * `process.env` ONLY; spawned children inherited env at spawn time and
 * continue with old credentials until restarted per-agent. Operators
 * decide per agent — the daemon does not interpret SIGHUP as an agent-
 * recycle signal because credential rotations on the same logical
 * account (Telegram, GH PAT) usually do not warrant interrupting
 * long-running PTY sessions.
 *
 * Failure posture: any throw from inside the handler (including a
 * `loadSystemdCredentials` failure) is caught and surfaced as
 * `cred-reload-failed` telemetry. The daemon is NEVER killed by a
 * failed reload — leaving the daemon running with the old credentials
 * is safer than crashing it on an informational signal.
 *
 * Concurrency: if a SIGHUP arrives while a prior reload is still in
 * flight, a `cred-reload-coalesced` telemetry event is emitted AND a
 * `reloadPending` flag is set. When the in-flight reload finishes, the
 * handler checks `reloadPending` and runs ONE trailing reload (only one,
 * regardless of how many SIGHUPs piled up during the window). Codex F3
 * fix — the previous drop-on-conflict semantics would lose a rotation
 * if the credstore changed during the await window of the prior reload.
 * Coalesce gives the same Phase 2 simplicity (no queue) while preserving
 * the "latest rotation is visible" invariant.
 *
 * Shutdown race (C1): SIGHUP arriving after the SIGTERM/SIGINT path
 * has set `shuttingDown` is ignored — a partially-torn-down telemetry
 * pipeline would otherwise silently swallow the reload event.
 *
 * Windows note (I3): SIGHUP is Linux-only at the OS level. Phase 2
 * production VPS is Debian 13, so production is fine. Tests exercise
 * the handler by invoking the `listener` returned from
 * `registerSighupHandler` directly, bypassing the OS signal layer.
 */
/**
 * No-throw contract (Opus F10): every function member of this interface is
 * expected to never throw synchronously when invoked. The handler reads
 * `isShuttingDown()` and `envVars()` BEFORE the `inFlight` guard is set, so a
 * synchronous throw there would surface as an unhandled promise rejection
 * inside the fire-and-forget listener and could crash the daemon. The
 * `loadCredentials` call IS wrapped in try/catch (it has historical reasons
 * to throw — credstore filesystem races); a thrown `loadCredentials` surfaces
 * as `cred-reload-failed` telemetry. The other members must remain no-throw.
 */
export interface SighupHandlerDeps {
	/** Re-reads credstore into `process.env`. May throw — surfaced as `cred-reload-failed`. */
	readonly loadCredentials: () => {
		read: readonly string[];
		failed: readonly string[];
	} | void;
	/** Telemetry emit. No-throw via internal try/catch (telemetry.ts swallows write errors). */
	readonly emit: (event: DaemonEvent) => Promise<void>;
	/**
	 * Returns the current set of credential env-var names. Called fresh on
	 * every SIGHUP so Phase 3+ additions to `CREDENTIALS` (e.g., the commented
	 * Anthropic entries in cred-bootstrap.ts) become reload-able without a
	 * daemon restart (Opus F6 fix). Must be no-throw.
	 */
	readonly envVars: () => readonly string[];
	/** Daemon shutdown flag check. Must be no-throw. */
	readonly isShuttingDown: () => boolean;
}

/**
 * Returned by `registerSighupHandler`. `removeListener` is the production
 * cleanup hook, added to `shutdownHandlers`. `listener` is exposed so unit
 * tests can invoke the handler synchronously without `process.emit("SIGHUP")`
 * (avoids cross-test leakage on Linux CI, removes the need for an `as` cast
 * over `process.listeners("SIGHUP")` reflection). `drainInFlight` is awaited
 * by `shutdown()` so an in-flight reload completes (or times out) BEFORE the
 * daemon-stop telemetry emit (Opus + Codex F2 fix — closes the reverse race
 * where SIGHUP starts → SIGTERM arrives → daemon exits with telemetry
 * `appendFile` still pending).
 */
export interface SighupHandlerRegistration {
	readonly removeListener: () => void;
	readonly listener: () => void;
	readonly drainInFlight: () => Promise<void>;
}

export function registerSighupHandler(
	deps: SighupHandlerDeps,
): SighupHandlerRegistration {
	let inFlight = false;
	let reloadPending = false;
	// F2: tracks the currently-executing reload promise so `shutdown()` can
	// await its completion (bounded by `withTimeout`) before emitting
	// `daemon-stop` and exiting the process. `null` when no reload is running.
	let activeReload: Promise<void> | null = null;

	// Extracted reload body — called once on initial entry plus once per
	// coalesced trailing iteration. Telemetry/`process.env` semantics match
	// the prior implementation exactly; the surrounding loop is what's new.
	const performReload = async (): Promise<void> => {
		// F12 CONTRACT: credential env vars (entries in CREDENTIALS) MUST only
		// be mutated by `loadSystemdCredentials`. Co-mutators from other
		// modules would invalidate the before/after diff below and produce
		// false-positive `credentialsReloaded` entries.
		const envVars = deps.envVars();
		const before = new Map<string, string | undefined>();
		for (const k of envVars) before.set(k, process.env[k]);

		let readResult: readonly string[] = [];
		let failed: readonly string[] = [];
		try {
			const result = deps.loadCredentials();
			if (result !== undefined) {
				readResult = result.read;
				failed = result.failed;
			}
		} catch (err) {
			// F1 (telemetry value-leak prohibition): emit a typed error code,
			// never the free-form `err.message`. A future thrower in the
			// credstore-read path could otherwise surface bytes adjacent to
			// the credential value via a parse-error position. SECURITY: do
			// not include value bytes in telemetry.
			const errInfo: { errorCode: string } =
				err instanceof Error
					? {
							errorCode:
								(err as NodeJS.ErrnoException).code ?? err.constructor.name,
						}
					: { errorCode: "unknown" };
			try {
				await deps.emit({ kind: "cred-reload-failed", ...errInfo });
			} catch (emitErr) {
				console.error(
					`[daemon] telemetry emit(cred-reload-failed) failed: ${emitErr instanceof Error ? emitErr.message : String(emitErr)}`,
				);
			}
			return;
		}

		// F7/F8: scope `credentialsReloaded` / `unchanged` to env-vars that
		// the loader ACTUALLY READ this invocation. Names that were not read
		// (no-op loader, missing credstore dir, external env override that
		// caused the read+skip path) MUST NOT appear in either partition.
		const credentialsReloaded: string[] = [];
		const unchanged: string[] = [];
		const failedSet = new Set(failed);
		for (const k of readResult) {
			if (failedSet.has(k)) continue;
			const beforeVal = before.get(k);
			const afterVal = process.env[k];
			if (beforeVal !== afterVal) {
				credentialsReloaded.push(k);
			} else if (afterVal !== undefined && afterVal.length > 0) {
				unchanged.push(k);
			}
		}

		try {
			await deps.emit({
				kind: "cred-reload-fired",
				credentialsReloaded,
				unchanged,
				// F14: dedupe failed at emit site — defense in depth against any
				// future loader that double-pushes a name into its failed array.
				errors: [...new Set(failed)],
			});
		} catch (err) {
			console.error(
				`[daemon] telemetry emit(cred-reload-fired) failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}

		if (credentialsReloaded.length > 0) {
			console.error(
				`[daemon] SIGHUP reload: ${credentialsReloaded.length} credential(s) updated. Restart in-flight agents to pick up new values.`,
			);
		}
	};

	const handler = async (): Promise<void> => {
		if (deps.isShuttingDown()) {
			console.error("[daemon] SIGHUP ignored: daemon is shutting down");
			return;
		}
		if (inFlight) {
			// F3: coalesce trailing reload instead of dropping it. Mark a
			// reload as pending and emit the coalesce telemetry — the
			// in-flight handler's trailing-iteration loop picks this up.
			reloadPending = true;
			try {
				await deps.emit({ kind: "cred-reload-coalesced" });
			} catch (err) {
				console.error(
					`[daemon] telemetry emit(cred-reload-coalesced) failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
			return;
		}

		inFlight = true;
		const reloadPromise = (async (): Promise<void> => {
			try {
				// F3: loop while a trailing reload was requested mid-await.
				// Reset `reloadPending` BEFORE the reload so a SIGHUP arriving
				// during this specific iteration's await chain queues exactly
				// one further iteration (no busy-loop, no lost rotation).
				do {
					reloadPending = false;
					await performReload();
				} while (reloadPending);
			} catch (err) {
				const errInfo: { errorCode: string } =
					err instanceof Error
						? {
								errorCode:
									(err as NodeJS.ErrnoException).code ?? err.constructor.name,
							}
						: { errorCode: "unknown" };
				try {
					await deps.emit({ kind: "cred-reload-failed", ...errInfo });
				} catch (emitErr) {
					console.error(
						`[daemon] telemetry emit(cred-reload-failed) failed: ${emitErr instanceof Error ? emitErr.message : String(emitErr)}`,
					);
				}
			} finally {
				inFlight = false;
				activeReload = null;
			}
		})();
		activeReload = reloadPromise;
		await reloadPromise;
	};

	const listener = (): void => {
		void handler();
	};
	process.on("SIGHUP", listener);
	return {
		removeListener: () => process.removeListener("SIGHUP", listener),
		listener,
		// F2: shutdown awaits this. Returns the in-flight reload promise (so
		// shutdown blocks on its `cred-reload-fired` telemetry emit) or a
		// resolved promise when no reload is running.
		drainInFlight: () => activeReload ?? Promise.resolve(),
	};
}

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
	// Plan 01b Task 4: bridge systemd `LoadCredentialEncrypted=` files into
	// `process.env` BEFORE any config load or state-dir setup. This MUST be
	// the first statement so `loadConfig()` reads
	// `IAGO_TELEGRAM_BOT_TOKEN` populated by the credstore on systemd-on-VPS
	// runs. Local-dev path is a no-op (no `CREDENTIALS_DIRECTORY`).
	//
	// Telemetry contract (spec § 10 criterion #5, C2 carry-over): the
	// emitted event carries the credstore FILE NAMES that wrote to env on
	// this call — NEVER the values. Detection works by snapshotting
	// keys-of-interest before and after the call and diffing.
	const targetEnvVars = getCredentialEnvVars();
	const envBefore = new Map<string, string | undefined>();
	for (const k of targetEnvVars) envBefore.set(k, process.env[k]);

	loadSystemdCredentials();

	const credentialsLoaded: string[] = [];
	for (const envVar of targetEnvVars) {
		const before = envBefore.get(envVar);
		const after = process.env[envVar];
		const beforeUnset = before === undefined || before.length === 0;
		const afterSet = after !== undefined && after.length > 0;
		if (beforeUnset && afterSet) {
			const fileName = envVarToFileName(envVar);
			if (fileName !== null) credentialsLoaded.push(fileName);
		}
	}
	// Note: this `emit` precedes `ensureStateDirsSync()`. Safe because
	// `emit()` lazily `fsp.mkdir(..., { recursive: true })`'s its own
	// jsonl directory — it does not depend on the state-dir setup that
	// follows. Order is intentional so the cred-bootstrap-loaded event
	// appears as the first telemetry record of every boot.
	await emit({ kind: "cred-bootstrap-loaded", credentialsLoaded });

	ensureStateDirsSync();

	const config = overrideConfig ?? (await loadConfig());

	// Codex H1 + Opus C2: claude-pty is registered via the top-level
	// side-effect `import "../agent-runtime/pty/claude-pty.js"` (see
	// imports above — guarantees registration at module load, not at
	// startDaemon() call time). Validate registration so the operator
	// sees an explicit error if the adapter failed to register rather
	// than discovering it via a "No AgentRuntime registered for id"
	// surprise on first registerAgent().
	const loadedRuntimes = listRuntimes().map((r) => r.id);
	if (!loadedRuntimes.includes("claude-pty")) {
		console.error(
			"[daemon] WARNING: claude-pty adapter is not registered — registration likely failed at module load",
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

	// Codex H1 + Opus I2: build knownConfigs from persisted agent records
	// before bootRecovery. Without this map, the daemon-crash-without-marker
	// recovery branch (agent-manager.ts:708 — the highest-value recovery
	// case) cannot fire and formerly-registered agents are silently
	// stranded across a hard crash.
	const knownConfigs = await loadPersistedConfigs();
	const bootResult = await agentManager.bootRecovery({ knownConfigs });
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

	// Codex PR48 HIGH: reconcile any stranded approval state (dual-presence
	// hardlink pairs or inflight-only crashes from a previous daemon run)
	// BEFORE the Telegram bot starts polling. Without this, a stranded
	// inflight file from a prior crash would silently absorb the user's
	// next decision as `already-resolved` and time out the waiting agent.
	try {
		const recovery = await recoverStrandedApprovals();
		if (
			recovery.republished.length > 0 ||
			recovery.cleaned.length > 0 ||
			recovery.resolvedSurvived.length > 0 ||
			recovery.failed.length > 0
		) {
			console.error(
				`[daemon] recoverStrandedApprovals: republished=${recovery.republished.length} cleaned=${recovery.cleaned.length} resolvedSurvived=${recovery.resolvedSurvived.length} failed=${recovery.failed.length}`,
			);
		}
	} catch (err) {
		// Boot recovery is best-effort; surface the error but do not block
		// daemon startup. A failed recovery leaves stranded files in place
		// for the next boot to retry or for an operator to clean up.
		console.error(
			`[daemon] recoverStrandedApprovals failed: ${err instanceof Error ? err.message : String(err)}`,
		);
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
				shutdownAgent: (id, signal) => agentManager.shutdownAgent(id, signal),
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

	// Stress note I1 (plan feature-phase-1-deferred-hardening/03): allow
	// tests to pass a small timeout so the shutdown-hang integration test
	// completes in <200ms instead of blocking on the 10s production
	// default. Production callers omit the override entirely.
	//
	// Codex PR #51 high-finding (dual-review): validate the override before
	// using it. An unvalidated 0 / negative / NaN / non-finite value makes
	// every `withTimeout` stage fire immediately, so daemon-stop telemetry
	// reports clean shutdown while heartbeat / IPC / bot / per-agent stop
	// promises are still pending — subprocesses may outlive the daemon and
	// observability becomes a lie. Reject obviously-broken values up front;
	// fall back to the production default. The minimum (1ms) is permissive
	// enough to keep the integration test affordance working while blocking
	// the dangerous values.
	const rawStageTimeout = config.shutdownStageTimeoutMs;
	const stageTimeoutMs =
		typeof rawStageTimeout === "number" &&
		Number.isFinite(rawStageTimeout) &&
		Number.isInteger(rawStageTimeout) &&
		rawStageTimeout >= 1
			? rawStageTimeout
			: SHUTDOWN_STAGE_TIMEOUT_MS;
	if (rawStageTimeout !== undefined && stageTimeoutMs !== rawStageTimeout) {
		console.error(
			`[daemon] ignoring invalid shutdownStageTimeoutMs=${String(rawStageTimeout)}; using ${SHUTDOWN_STAGE_TIMEOUT_MS}ms default`,
		);
	}

	const shutdown = async (): Promise<void> => {
		if (shuttingDown) return;
		shuttingDown = true;
		// F2 (Opus + Codex convergent): drain any in-flight SIGHUP reload
		// BEFORE tearing down the daemon. Without this, a SIGHUP that began
		// just before SIGTERM/SIGINT would lose its `cred-reload-fired`
		// telemetry emit because the process exits while the `appendFile`
		// is still pending. Bounded by `stageTimeoutMs` so a hung telemetry
		// I/O cannot block shutdown indefinitely. The drain MUST run AFTER
		// `shuttingDown = true` so a SIGHUP arriving during the drain is
		// ignored (does not re-arm `activeReload`); the timing window where
		// we observe `inFlight` but a brand-new SIGHUP races in is closed
		// because new SIGHUPs short-circuit on `isShuttingDown()` above.
		await withTimeout(
			"sighup.drain",
			() => sighupRegistration.drainInFlight(),
			stageTimeoutMs,
		);
		// Opus I4: bound each stage with `withTimeout`. A hung adapter
		// (heartbeat sweep, bot polling, IPC drain, or per-handle
		// shutdown) would otherwise block the entire daemon and the
		// rollback runbook's `kill -KILL` step was the only escape.
		await withTimeout(
			"heartbeat.stop",
			async () => {
				try {
					await heartbeat.stop();
				} catch (err) {
					console.error(
						`[daemon] heartbeat.stop failed: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			},
			stageTimeoutMs,
		);
		if (bot !== null) {
			const botRef = bot;
			await withTimeout(
				"bot.stop",
				async () => {
					try {
						await botRef.stop();
					} catch (err) {
						console.error(
							`[daemon] bot.stop failed: ${err instanceof Error ? err.message : String(err)}`,
						);
					}
				},
				stageTimeoutMs,
			);
		}
		await withTimeout(
			"ipcServer.stop",
			async () => {
				try {
					await ipcServer.stop();
				} catch (err) {
					console.error(
						`[daemon] ipcServer.stop failed: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			},
			stageTimeoutMs,
		);
		const handles = agentManager.listHandles();
		for (const handle of handles) {
			await withTimeout(
				`shutdownAgent(${handle.id})`,
				async () => {
					try {
						await agentManager.shutdownAgent(handle.id, "SIGTERM");
						// Telemetry — shutdown is the canonical "graceful exit" hook;
						// without this, the 7-canonical-event PHASE-1-EVIDENCE.md
						// matrix (Opus I5) lacks `agent-exited` on the happy path.
						await emit({
							kind: "agent-exited",
							handleId: handle.id,
							reason: "graceful",
						});
					} catch (err) {
						console.error(
							`[daemon] shutdownAgent(${handle.id}) failed: ${err instanceof Error ? err.message : String(err)}`,
						);
					}
				},
				stageTimeoutMs,
			);
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
	shutdownHandlers.add(() => process.removeListener("SIGTERM", sigtermHandler));

	// Plan 06: SIGHUP credential-reload. Registered AFTER the shutdown
	// signal handlers and AFTER the initial `loadSystemdCredentials()` call
	// so the helper's last-written tracking is primed before any reload.
	// Operator invokes via `systemctl kill -s SIGHUP iago-os-v2-daemon.service`.
	//
	// F15 DO NOT MOVE this registration any later in startDaemon — the window
	// between `loadSystemdCredentials()` (above) and this call has Node's
	// default SIGHUP behavior (terminate). Lengthening that window introduces
	// a daemon-kill race during Phase 2 credential rotations. Adding deferred
	// init steps below this line is fine; adding them ABOVE this line widens
	// the kill window.
	//
	// F6: `envVars` is a getter (re-evaluated on every SIGHUP) so Phase 3+
	// additions to `CREDENTIALS` in cred-bootstrap.ts become reloadable
	// without a daemon restart. Previously captured the array at startup,
	// freezing the credential surface for the daemon's lifetime.
	const sighupRegistration = registerSighupHandler({
		loadCredentials: loadSystemdCredentials,
		emit,
		envVars: () => getCredentialEnvVars(),
		isShuttingDown: () => shuttingDown,
	});
	shutdownHandlers.add(sighupRegistration.removeListener);

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

	// Plan 01b Task 4 (C1 carry-over): determine `runUnder` for the
	// `daemon-start` event via the exported `computeRunUnder` helper so
	// the override semantics (NODE_ENV=test wins over CREDENTIALS_DIRECTORY)
	// are directly unit-testable from main.test.ts.
	const runUnder = computeRunUnder();

	await emit({
		kind: "daemon-start",
		pid: process.pid,
		nodeVersion: process.versions.node,
		runUnder,
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

export async function buildFleetHealth(
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

export async function getShapeForAgent(
	manager: AgentManager,
	agentId: string,
): Promise<AgentShape | null> {
	for (const h of manager.listHandles()) {
		if (h.agentId === agentId) return h.shape;
	}
	return null;
}

export async function injectIntoAgent(
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

export function findHandleForAgent(
	manager: AgentManager,
	agentId: string,
): AgentHandle | null {
	for (const h of manager.listHandles()) {
		if (h.agentId === agentId) return h;
	}
	return null;
}

export function resolveSessionId(cfg: AgentConfig): string {
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

/**
 * Direct-execution guard (Codex C1).
 *
 * `runtime/package.json` `"start"` script runs `node dist/daemon/main.js`.
 * Without this guard the module loads, exports `main()`, and exits without
 * starting the daemon — the operator command silently does nothing.
 *
 * Compares `import.meta.url` (file:// URL of the currently-evaluating ESM
 * module) against `process.argv[1]` (the script path Node was launched with,
 * converted to file:// for cross-platform comparison). On match: invoke
 * `main()`. On import-as-library (the test path): the URL of the importer
 * differs from `argv[1]`, so this branch does not fire.
 */
export function isDirectlyExecuted(): boolean {
	const argv1 = process.argv[1];
	if (argv1 === undefined) return false;
	try {
		const argvUrl = pathToFileURL(argv1).href;
		return import.meta.url === argvUrl;
	} catch {
		return false;
	}
}

if (isDirectlyExecuted()) {
	// Avoids a top-level await constraint while still ensuring crash exit.
	main().catch((err) => {
		const message = err instanceof Error ? err.message : String(err);
		process.stderr.write(`fatal: ${message}\n`);
		process.exit(1);
	});
}
