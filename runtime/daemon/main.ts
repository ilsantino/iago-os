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
 *   6c. Construct `CronScheduler({ agentManager })` (Plan 04b). MUST
 *      run after AgentManager so its EventEmitter is live for the
 *      scheduler's terminal-event subscriptions. Call
 *      `loadCronEntries(agentsDir)` and `scheduler.registerCron(opts)`
 *      for each parsed entry. Entries with `schedule: null` are skipped
 *      and logged to telemetry as `cron-skipped-null`.
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
 *   11. `scheduler.start()` + `agentManager.startPollingLoop({ intervalMs: 5000 })`
 *      — guarded by `!shuttingDown` (EC1 carry-over: a SIGINT arriving
 *      during the auto-start loop above must not leave background
 *      timers running).
 *   12. Emit `daemon-start` telemetry.
 *
 * Shutdown sequence (idempotent — safe to call from both SIGINT and
 * SIGTERM handlers concurrently):
 *   1. Set the shutdown flag (EC1 — newly-spawning agents observe it
 *      and abort their own track step).
 *   2. Drain in-flight SIGHUP (`sighup.drain`).
 *   3. `scheduler.stop()` — quiesces new cron-fires so no fresh task
 *      files land in `tasks/pending/` during teardown.
 *   4. `agentManager.stopPollingLoop()` — drains the in-flight claim
 *      tick so no fresh handle work spawns.
 *   5. Stop the heartbeat (waits for in-flight sweep).
 *   6. Stop the bot (stops polling).
 *   7. Stop the IPC server (drains in-flight requests).
 *   8. `shutdownAgent` every live handle — writes graceful markers.
 *   9. Emit `daemon-stop` telemetry.
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

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
import {
	type ApprovalRequest,
	listPendingApprovals,
	recoverStrandedApprovals,
} from "../telegram/approval-bus.js";
import { type AgentManagerInterface, TelegramBot } from "../telegram/bot.js";

import {
	AgentManager,
	type RegisterAgentConfig,
	type TaskDispatchPayload,
} from "./agent-manager.js";
import { type AgentConfig, type DaemonConfig, loadConfig } from "./config.js";
import {
	envVarToFileName,
	getCredentialEnvVars,
	loadSystemdCredentials,
} from "./cred-bootstrap.js";
import { composeRuntimeEnv } from "./cron-agent-env.js";
import {
	CronScheduler,
	type PrepareCronPrompt,
	type RegisterCronOpts,
	type RegisteredCron,
} from "./cron-scheduler.js";
import { HeartbeatController } from "./heartbeat.js";
import { IpcServer } from "./ipc-server.js";
import {
	FetchPrsError,
	fetchOpenPrs,
	sanitizePrPayload,
} from "./pr-triage-fetch.js";
import {
	atomicRenameStaleDest,
	ensureStateDirsSync,
	getStateRoot,
	pathFor,
} from "./state-paths.js";
import { type DaemonEvent, PR_TRIAGE_ALERT_KINDS, emit } from "./telemetry.js";

/**
 * Per-stage shutdown timeout (ms). Opus I4: the daemon shutdown path
 * previously awaited each stage serially with no outer timeout — a hung
 * adapter shutdown would block forever and the rollback runbook's
 * `kill -KILL` step was the only escape. Bounding each stage at 10s
 * matches the 30s budget documented in `runtime/migration/phase-1-rollback.md`
 * (heartbeat + bot + ipc + handle loop ≈ 4 stages × 10s, fits under 30s).
 */
export const SHUTDOWN_STAGE_TIMEOUT_MS = 10_000;

/**
 * Adapter modules that the daemon loads via `loadAdapterFailIsolated()`. Each
 * entry is a runtime specifier importable from `runtime/daemon/main.ts`.
 * Adding a new built-in adapter only requires appending its specifier here.
 *
 * Codex H1 + Opus C2: switching from a top-level `import "..."` (which would
 * crash the daemon if the module threw at registerRuntime) to dynamic
 * imports inside a try/catch makes the registration boundary explicitly
 * fail-isolated — per `runtime/agent-runtime/README.md` § "Fail-isolated
 * policy". A broken adapter still throws at the registry layer, the daemon
 * catches it here, emits `runtime-registration-failed` telemetry, and boots
 * with the remaining adapters.
 */
const BUILT_IN_ADAPTER_MODULES: readonly string[] = [
	"../agent-runtime/pty/claude-pty.js",
];

/**
 * Dynamically import an adapter module so that a top-level throw (from
 * `registerRuntime` failures, broken imports, or module-evaluation errors) is
 * caught at the boundary and converted into a stderr log + a
 * `runtime-registration-failed` telemetry event. The daemon continues
 * booting with whichever adapters did register.
 *
 * The stack trace is truncated to the first 3 lines — enough for triage
 * without bloating the telemetry NDJSON line or leaking PII from a deep
 * stack.
 */
export async function loadAdapterFailIsolated(
	adapterModule: string,
): Promise<{ loaded: boolean; error?: Error }> {
	try {
		await import(adapterModule);
		return { loaded: true };
	} catch (err) {
		const error = err instanceof Error ? err : new Error(String(err));
		const stackTrace = (error.stack ?? error.message)
			.split("\n")
			.slice(0, 3)
			.join("\n");
		console.error(
			`[daemon] adapter ${adapterModule} failed to register: ${error.message}`,
		);
		await emit({
			kind: "runtime-registration-failed",
			adapterModule,
			message: error.message,
			stackTrace,
		});
		return { loaded: false, error };
	}
}

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
 * Plan 04b Task 3 — discover `runtime/agents/<agentId>/crons.json` files
 * and translate each into a `RegisterCronOpts` for the `CronScheduler`.
 *
 * Discovery rules:
 *   - Read every subdirectory under `runtime/agents/`. Skip non-directories
 *     and dot-entries.
 *   - For each subdirectory, attempt to read `crons.json`. ENOENT is a
 *     silent skip (not every agent has a cron).
 *   - Parse JSON; require: `schedule` (string OR null), `prompt` (string,
 *     mapped to `promptTemplatePath`), `outputTaskNamePrefix` (string).
 *     Optional: `wakeCheck` (string), `maxConcurrent` (number).
 *   - `schedule: null` is a documented "silence" sentinel — the entry is
 *     parsed but NOT registered. Logged to telemetry as `cron-skipped-null`
 *     so the operator can see the agent is intentionally muted.
 *   - `wakeCheck` is resolved relative to the repo root (parent of the
 *     `runtime/` tree). Plan 04a's crons.json ships
 *     `"runtime/agents/pr-triage/wake-check.sh"` — relative to repo root —
 *     because the daemon's working directory at production runtime is
 *     `/opt/iago-os` (the repo root on the VPS).
 *
 * The `agentId` is derived from the directory name (e.g., `pr-triage/`).
 * The cron file's content does not need its own `agentId` field — the
 * directory IS the identity.
 *
 * Errors per agent (parse, missing field, bad type) are logged to stderr
 * and skip that entry without throwing; other agents continue to load.
 *
 * Exported for unit testability — main.test.ts asserts the discovery
 * contract directly (file shape, null-schedule sentinel, error paths).
 */
export async function loadCronEntries(
	agentsDir: string,
): Promise<RegisterCronOpts[]> {
	const out: RegisterCronOpts[] = [];
	let entries: import("node:fs").Dirent[];
	try {
		entries = await fsp.readdir(agentsDir, { withFileTypes: true });
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			// I2 fix (dual-review 2026-05-25): ENOENT on the agents-dir ROOT
			// is a high-visibility config failure — production deployment
			// is broken, not "no agents yet." Log structured WARN so it
			// surfaces in journalctl and PostHog/Sentry telemetry layer E.
			// Per-agent crons.json ENOENT below remains a silent skip
			// (correct for "agent dir exists but no cron").
			console.error(
				`[daemon] loadCronEntries: agents directory not found at ${agentsDir} — no crons will fire. Check resolveAgentsDir resolution + agents-asset deployment.`,
			);
			return out;
		}
		console.error(
			`[daemon] loadCronEntries readdir(${agentsDir}) failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		return out;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (entry.name.startsWith(".")) continue;
		const agentId = entry.name;
		const cronPath = path.join(agentsDir, agentId, "crons.json");
		let raw: string;
		try {
			raw = await fsp.readFile(cronPath, "utf8");
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "ENOENT") continue;
			console.error(
				`[daemon] loadCronEntries read(${cronPath}) failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (err) {
			console.error(
				`[daemon] loadCronEntries parse(${cronPath}) failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			continue;
		}
		if (typeof parsed !== "object" || parsed === null) {
			console.error(
				`[daemon] loadCronEntries skipping ${cronPath}: not an object`,
			);
			continue;
		}
		const obj = parsed as Record<string, unknown>;
		const scheduleRaw = obj.schedule;
		if (scheduleRaw === null) {
			console.error(
				`[daemon] loadCronEntries skipping ${agentId}: schedule is null (intentionally muted)`,
			);
			await emit({ kind: "cron-skipped-null", agentId });
			continue;
		}
		if (typeof scheduleRaw !== "string" || scheduleRaw.length === 0) {
			console.error(
				`[daemon] loadCronEntries skipping ${cronPath}: missing or invalid schedule`,
			);
			continue;
		}
		const promptRaw = obj.prompt;
		if (typeof promptRaw !== "string" || promptRaw.length === 0) {
			console.error(
				`[daemon] loadCronEntries skipping ${cronPath}: missing or invalid prompt`,
			);
			continue;
		}
		const prefixRaw = obj.outputTaskNamePrefix;
		if (typeof prefixRaw !== "string" || prefixRaw.length === 0) {
			console.error(
				`[daemon] loadCronEntries skipping ${cronPath}: missing or invalid outputTaskNamePrefix`,
			);
			continue;
		}
		const wakeCheckRaw = obj.wakeCheck;
		const wakeCheck =
			typeof wakeCheckRaw === "string" && wakeCheckRaw.length > 0
				? wakeCheckRaw
				: undefined;
		const maxConcurrentRaw = obj.maxConcurrent;
		const maxConcurrent =
			typeof maxConcurrentRaw === "number" && maxConcurrentRaw > 0
				? maxConcurrentRaw
				: undefined;
		const opts: RegisterCronOpts = {
			agentId,
			schedule: scheduleRaw,
			promptTemplatePath: promptRaw,
			outputTaskNamePrefix: prefixRaw,
			...(wakeCheck !== undefined ? { wakeCheck } : {}),
			...(maxConcurrent !== undefined ? { maxConcurrent } : {}),
		};
		out.push(opts);
	}
	return out;
}

/**
 * Plan 04d Task 2 — per-agent dispatch configuration loaded from
 * `<agentsDir>/<agentId>/agent-config.json`.
 *
 * Fields:
 *   - `runtimeId`: registry key for the runtime adapter that dispatches
 *     this agent's tasks (e.g., `"claude-pty"`).
 *   - `cwd`: working directory the adapter spawns the agent in (the repo
 *     root on the VPS — `/opt/iago-os`).
 *   - `env`: env-var map merged into the spawned process's environment.
 *     Values are plain strings (no secret-bytes referenced here — secrets
 *     ride in via `loadSystemdCredentials` ahead of spawn).
 *   - `authProfile`: profile name selecting an auth credential bundle
 *     for the adapter (`"default"` in Phase 2; reserved for multi-profile
 *     work in Phase 3+). REQUIRED IN THE CONFIG FILE BUT INTENTIONALLY
 *     UNUSED at runtime in Phase 2 — `startDaemon` does NOT forward
 *     `authProfile` to `registerAgent`. Validation here exists so a
 *     malformed config fails loud at startup rather than surfacing as a
 *     silent miss when Phase 3 wires actual profile routing. Review #3
 *     (Plan 04d, minor): future readers should NOT assume this field
 *     gates auth selection in Phase 2.
 *   - `org`: optional organization slug; passed through to `registerAgent`
 *     so multi-org isolation (Plan 03 PR4) works for cron-driven agents
 *     the same way it works for human-spawned ones.
 */
export interface AgentConfigShape {
	readonly runtimeId: string;
	readonly cwd: string;
	readonly env: Record<string, string>;
	readonly authProfile: string;
	readonly org?: string;
}

/**
 * Plan 04d Task 2 — read and validate `<agentsDir>/<agentId>/agent-config.json`.
 *
 * Required fields: `runtimeId: string`, `cwd: string`, `env: object`,
 * `authProfile: string`. Optional: `org: string`.
 *
 * Failure modes (all throw with a message naming the file + field):
 *   - ENOENT → throw (every cron-fired agent MUST have a config; a missing
 *     file is a deployment bug, not "no config yet").
 *   - JSON parse error → throw.
 *   - Wrong type / missing required field → throw.
 *
 * Caller (`startDaemon`) catches and logs PER-AGENT so one bad config
 * does not prevent the rest of the fleet from registering.
 *
 * Exported for unit testability (main.test.ts).
 */
export async function loadAgentConfig(
	agentsDir: string,
	agentId: string,
): Promise<AgentConfigShape> {
	const file = path.join(agentsDir, agentId, "agent-config.json");
	let raw: string;
	try {
		raw = await fsp.readFile(file, "utf8");
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(
			`loadAgentConfig(${agentId}): cannot read ${file} (code=${code ?? "unknown"}): ${message}`,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(
			`loadAgentConfig(${agentId}): invalid JSON in ${file}: ${message}`,
		);
	}
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error(
			`loadAgentConfig(${agentId}): ${file} did not parse to an object`,
		);
	}
	const obj = parsed as Record<string, unknown>;
	if (typeof obj.runtimeId !== "string" || obj.runtimeId.length === 0) {
		throw new Error(
			`loadAgentConfig(${agentId}): ${file} missing or invalid required field 'runtimeId' (string)`,
		);
	}
	if (typeof obj.cwd !== "string" || obj.cwd.length === 0) {
		throw new Error(
			`loadAgentConfig(${agentId}): ${file} missing or invalid required field 'cwd' (string)`,
		);
	}
	if (
		typeof obj.env !== "object" ||
		obj.env === null ||
		Array.isArray(obj.env)
	) {
		throw new Error(
			`loadAgentConfig(${agentId}): ${file} missing or invalid required field 'env' (object of string→string)`,
		);
	}
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(obj.env as Record<string, unknown>)) {
		if (typeof v !== "string") {
			throw new Error(
				`loadAgentConfig(${agentId}): ${file} 'env.${k}' is not a string`,
			);
		}
		env[k] = v;
	}
	if (typeof obj.authProfile !== "string" || obj.authProfile.length === 0) {
		throw new Error(
			`loadAgentConfig(${agentId}): ${file} missing or invalid required field 'authProfile' (string)`,
		);
	}
	const org =
		typeof obj.org === "string" && obj.org.length > 0 ? obj.org : undefined;
	return {
		runtimeId: obj.runtimeId,
		cwd: obj.cwd,
		env,
		authProfile: obj.authProfile,
		...(org !== undefined ? { org } : {}),
	};
}

/**
 * Plan 04d Task 3 — payload of the `'task-dispatch-needed'` event the
 * polling loop emits between `isAgentRegistered` and `claimTask`.
 * Exported so the dispatch handler factory below is independently
 * unit-testable (main.test.ts simulates the polling loop by invoking
 * the handler directly with a synthetic payload).
 *
 * `taskContent` carries the parsed task-file body via the typed
 * `TaskDispatchPayload` shape from agent-manager.ts — `agentId` is
 * guaranteed `string` (validated by `processPendingTask` ahead of emit);
 * other task-file fields ride along under the index signature.
 */
export interface TaskDispatchEvent {
	readonly filename: string;
	readonly agentId: string;
	readonly taskContent: TaskDispatchPayload;
}

/**
 * R1 (feature-pr84-r1-daemon-creds, D2) — payload of the `'task-send-needed'`
 * event `AgentManager.processPendingTask` emits when a pr-triage RESULT
 * envelope (`pr-triage-send__*.json`) lands. The daemon owns the Telegram send,
 * so the agent never holds the bot token. Exactly one of `sendText` / `noSend`
 * is present (the producer-branch discriminator).
 */
export interface TaskSendEvent {
	readonly filename: string;
	readonly agentId: string;
	readonly sendText?: string;
	readonly noSend?: boolean;
	/**
	 * Critical (Codex, round 1) — the per-dispatch correlation id the daemon
	 * stamped into the PROMPT (`{{RUN_ID}}` / the runId-echo instruction) and the
	 * agent echoed back in its result envelope. Carried THROUGH from the envelope
	 * (NOT re-read from the live on-disk marker) so the send handler can pass the
	 * ENVELOPE's runId to `clearResultTimer`: a late/stale envelope from a PRIOR
	 * run carries the OLD runId, fails the wrong-run guard, and cannot clear the
	 * CURRENT run's timer/marker or release its slot. Absent on a legacy envelope
	 * (or one whose agent failed to echo it) — the handler then clears
	 * unconditionally by agentId (degraded, but the dead-letter timer is the
	 * cross-restart backstop).
	 */
	readonly runId?: string;
}

/**
 * R1 (feature-pr84-r1-daemon-creds, D4) — dead-letter deadline. A dispatched
 * pr-triage PROMPT that does not produce a result envelope within this window
 * emits `pr-triage-result-timeout`. `.unref()`'d so it never keeps the process
 * alive; does NOT survive a daemon restart (next cron fire recovers; full
 * durability = deferred #5).
 */
export const RESULT_TIMEOUT_MS = 120_000;

/**
 * F3 (R1 dual-adversarial Important) — bounded retry backoff (ms) for the
 * daemon's Telegram send in `makeTaskSendHandler`. The envelope is CLAIMED
 * (pending→resolved) before the send (at-most-once: prevents the duplicate-send
 * storm), so a SINGLE transient `{ ok: false }` (429 / network blip) would
 * otherwise permanently drop the day's summary with no retry. These delays add a
 * BOUNDED in-handler retry — at most `1 + length` total send attempts — before
 * the `pr-triage-telegram-send-failed` telemetry fires, so a transient blip is
 * retried rather than lost. Strictly bounded (no unbounded loop, no storm); the
 * delays are `await`ed inside the already-fire-and-forget send handler so the
 * poll loop is not blocked (`processPendingTask` returned before the handler
 * ran). Exported so the regression test can advance fake timers deterministically.
 *
 *   attempt 1 fails → wait 250ms  → attempt 2
 *   attempt 2 fails → wait 1000ms → attempt 3
 *   attempt 3 fails → emit pr-triage-telegram-send-failed (give up; at-most-once)
 */
export const TELEGRAM_SEND_RETRY_BACKOFF_MS: readonly number[] = [250, 1000];

/**
 * Task 6 (Critical) — the durable, run-correlated dead-letter marker. Written
 * to `result-pending/<agentId>.json` at dispatch and removed when the result
 * envelope is processed (or the in-memory timer fires). Carries the per-dispatch
 * `runId` so a late/wrong-run envelope cannot clear the CURRENT run's marker,
 * and a `deadlineMs` (absolute epoch) so a boot scan can decide re-arm vs
 * immediate dead-letter.
 */
export interface ResultPendingMarker {
	readonly agentId: string;
	readonly runId: string;
	readonly filename: string | null;
	readonly deadlineMs: number;
}

/**
 * Task 6 — durable result-pending marker path for an agentId.
 */
function resultPendingPath(agentId: string): string {
	return path.join(pathFor("result-pending"), `${agentId}.json`);
}

/**
 * Task 6 (Critical — result-envelope run-correlation + dead-letter durability,
 * escalated 2026-06-02) — build the shared result-timer closures the dispatch
 * handler and the send handler both use.
 *
 * The PRIOR design keyed an in-memory `.unref()`'d timer by BARE `agentId` and
 * relied on `maxConcurrent: 1` to make a single-key map "sufficient". Two holes:
 *   (a) NOT durable across restart — a dispatch in flight when the daemon
 *       restarts lost its timer, so `pr-triage-result-timeout` never fired and
 *       the daily summary was silently dropped (no durable pending work to
 *       recover); and
 *   (b) fragile to re-fire / a future `maxConcurrent > 1` — a late envelope from
 *       a PRIOR run could clear the CURRENT run's key (wrong-run attribution).
 *
 * This design closes both:
 *   - CORRELATION: every dispatch is stamped with a `runId`. The marker and the
 *     in-memory timer both carry it. `clearResultTimer(agentId, runId)` clears
 *     ONLY when the runId matches the active run — a stale/wrong-run envelope is
 *     ignored (returns `false`) and never clears a live timer or marker.
 *   - DURABILITY: `startResultTimer` writes a `result-pending/<agentId>.json`
 *     marker (atomically) carrying `{runId, deadlineMs, filename}`. The marker
 *     survives a restart; `recoverResultTimers()` (called from boot) scans the
 *     dir and either RE-ARMS a still-future deadline or IMMEDIATELY dead-letters
 *     an expired/orphaned one (`pr-triage-result-timeout`) — the dropped-summary
 *     hole is gone.
 *   - IDEMPOTENCY: a re-armed dispatch carries the SAME runId as its marker, so
 *     the recovery path cannot double-emit a timeout for a run already cleared.
 *
 * The in-memory timer is still `.unref()`'d (never keeps the process alive); the
 * durable marker is the cross-restart backstop. `startResultTimer` is async (it
 * writes the marker) — callers that cannot await fire-and-forget it.
 */
export function makeResultTimers(deps: {
	emit: (event: DaemonEvent) => Promise<unknown>;
	timeoutMs?: number;
	/**
	 * Task 6 gate-finding #2 (hold-slot-until-result) — invoked when a run
	 * COMPLETES: the envelope is processed (`clearResultTimer`) OR the durable
	 * dead-letter timeout fires (live, re-armed, or boot-recovered). `filename`
	 * is the ORIGINAL cron task filename (from the marker), so the daemon can
	 * release exactly the right CronScheduler concurrency slot. Optional — when
	 * omitted, the result timers behave as before (no slot coupling).
	 */
	onResultComplete?: (agentId: string, filename: string | null) => void;
	/**
	 * Round-2 Minor (Codex) — invoked when `recoverResultTimers` RE-ARMS a
	 * still-future dead-letter marker after a restart. The recovered run is still
	 * in flight (no result envelope yet), so its CronScheduler concurrency slot
	 * must be RE-HELD — otherwise the scheduler boots with `runningCount=0` and a
	 * matching cron tick could dispatch a SECOND prompt that overwrites the single
	 * `result-pending/<agentId>.json` marker, reintroducing duplicate/stale-run
	 * behavior under non-daily cadences. The symmetric `onResultComplete` releases
	 * the slot when the recovered run finally completes (envelope or dead-letter).
	 * `filename` is the original cron task filename from the marker; `null` →
	 * nothing to re-hold (manual / filename-less run). Optional — when omitted the
	 * recovery path behaves as before (no slot re-hold).
	 */
	onResultRecovered?: (agentId: string, filename: string | null) => void;
}): {
	startResultTimer: (
		agentId: string,
		runId: string,
		filename?: string | null,
		timeoutMs?: number,
	) => Promise<void>;
	// Dual-adversarial #92 Critical (C1) — load-bearing pre-claim durable marker
	// write (no in-memory timer). Returns false on a write fault so the dispatch
	// handler can abort BEFORE resolving the cron task.
	persistResultMarker: (
		agentId: string,
		runId: string,
		filename?: string | null,
		timeoutMs?: number,
	) => Promise<boolean>;
	// Unlink the durable marker — lets the dispatch handler clean up a marker it
	// pre-wrote for a task whose claim then faulted (#92 C1).
	removeResultMarker: (agentId: string) => Promise<void>;
	clearResultTimer: (agentId: string, runId?: string) => Promise<boolean>;
	recoverResultTimers: () => Promise<void>;
	/**
	 * Round-2 Important (Codex) — is `runId` the ACTIVE run for `agentId`?
	 *
	 * The send handler consults this BEFORE the irreversible Telegram send so a
	 * late/stale envelope (carrying an OLD runId from a prior dispatch) is
	 * quarantined instead of delivered. Authority order matches
	 * `clearResultTimer`:
	 *   - if an in-memory timer exists → its runId is authoritative;
	 *   - else fall back to the durable on-disk marker's runId (survives a
	 *     restart that dropped the in-memory timer);
	 *   - if NEITHER exists → there is no active run to validate against. Return
	 *     `true` so a legacy/undefined-runId envelope, or one whose marker was
	 *     already cleared by a concurrent path, is NOT spuriously quarantined
	 *     (degrades to the prior at-most-once send behavior). A `runId` of
	 *     `undefined` (legacy producer / missing echo) also returns `true` — the
	 *     guard only blocks a DEFINITE mismatch.
	 */
	isActiveRun: (agentId: string, runId?: string) => Promise<boolean>;
} {
	const { emit } = deps;
	const onResultComplete = deps.onResultComplete;
	const onResultRecovered = deps.onResultRecovered;
	const defaultTimeout = deps.timeoutMs ?? RESULT_TIMEOUT_MS;
	// agentId → { runId, filename, timer }. The runId guards against a
	// stale/wrong-run envelope clearing the live run's timer; the filename is the
	// original cron task filename, echoed to `onResultComplete` on completion so
	// the daemon releases the correct held cron slot (Task 6 #2).
	const timers = new Map<
		string,
		{ runId: string; filename: string | null; timer: NodeJS.Timeout }
	>();

	const removeMarker = async (agentId: string): Promise<void> => {
		await fsp.unlink(resultPendingPath(agentId)).catch(() => undefined);
	};

	const fireTimeout = (
		agentId: string,
		runId: string,
		filename: string | null,
		delayMs: number,
	): void => {
		const t = setTimeout(
			() => {
				const active = timers.get(agentId);
				// Only fire if THIS run is still the active one (a re-fire/overwrite
				// would have replaced it with a new runId).
				if (active === undefined || active.runId !== runId) return;
				// Dual-adversarial Important (escalated 2026-06-02) — DURABILITY GATE.
				// Record the timeout BEFORE unlinking the durable marker / releasing the
				// slot. `emit` returns false (it never throws) when the telemetry append
				// fails (ENOSPC/EACCES); the prior order (delete marker → fire-and-forget
				// emit) meant a failed append lost the dropped-summary signal — the very
				// event this timeout exists to surface — with nothing for boot recovery
				// (`recoverResultTimers`) to re-scan. On a failed record: RETAIN the
				// marker + timer entry so the next boot re-surfaces it; do NOT remove or
				// release. Fire-and-forget async so the poll loop is not blocked.
				void (async () => {
					const recorded = await emit({
						kind: "pr-triage-result-timeout",
						agentId,
						reason: "no-envelope-before-deadline",
					});
					if (!recorded) return;
					// Re-check this run is still current (a fresh dispatch may have armed a
					// new timer for this agent while we awaited the telemetry write).
					const stillActive = timers.get(agentId);
					if (stillActive === undefined || stillActive.runId !== runId) return;
					timers.delete(agentId);
					// Marker removal is fire-and-forget AFTER the durable timeout record
					// (the same ordering as before the gate — the release does not wait on
					// the unlink, and a re-dispatch atomically overwrites the marker).
					void removeMarker(agentId);
					// Task 6 #2 — the run is OVER (dead-lettered). Release the held cron
					// slot so the NEXT cron tick can dispatch.
					onResultComplete?.(agentId, filename);
				})();
			},
			Math.max(0, delayMs),
		);
		if (typeof t.unref === "function") t.unref();
		timers.set(agentId, { runId, filename, timer: t });
	};

	// Round-2 Important (Codex) + dual-adversarial Critical (escalated 2026-06-02)
	// — pre-send wrong-run guard. An envelope is "active" only when its runId
	// MATCHES the agent's live run (in-memory timer first, then the durable on-disk
	// marker). The PRIOR design short-circuited `runId === undefined` to `true`,
	// which let a runId-LESS envelope (a NORMAL agent failure mode — the echo line
	// is explicitly optional per prompt-template.md, so the agent may omit it)
	// bypass the guard entirely: a late/stale summary from a PRIOR run would be
	// pushed to Telegram while a live run is still pending. The fix: when there IS
	// an active run (live timer OR durable marker) for the agent, REQUIRE a
	// matching runId — a missing (`undefined`/empty-string, normalized upstream to
	// `undefined`) or mismatched runId returns `false` (quarantine). ONLY when
	// there is NO active run at all do we return `true` (the legacy/no-correlation
	// path — nothing to misattribute against).
	const isActiveRun = async (
		agentId: string,
		runId?: string,
	): Promise<boolean> => {
		const existing = timers.get(agentId);
		if (existing !== undefined) {
			// A live run is in flight: only the matching runId is its envelope. A
			// missing runId (undefined) cannot be confirmed as this run → quarantine.
			return runId !== undefined && existing.runId === runId;
		}
		// No live timer (e.g. after a restart) — the durable marker is authority.
		try {
			const raw = await fsp.readFile(resultPendingPath(agentId), "utf-8");
			const m = JSON.parse(raw) as ResultPendingMarker;
			if (typeof m.runId === "string") {
				// A durable marker means a run is still pending: same rule — require a
				// matching runId; a missing/mismatched one is quarantined.
				return runId !== undefined && m.runId === runId;
			}
		} catch {
			// No marker / unreadable — nothing to validate against.
		}
		// Neither a live timer nor a marker runId to compare: NO active run, so a
		// legacy/undefined-runId envelope is NOT spuriously quarantined.
		return true;
	};

	const clearResultTimer = async (
		agentId: string,
		runId?: string,
	): Promise<boolean> => {
		const existing = timers.get(agentId);
		// Wrong-run guard: if a runId is supplied and it does NOT match the active
		// run, this is a stale/late envelope from a prior dispatch — ignore it.
		// (A MISSING runId is handled by the send handler's pre-send quarantine,
		// which skips the clear entirely when there is an active run — see
		// `makeTaskSendHandler`. An explicit `clearResultTimer(agentId)` with no
		// runId remains an intentional unconditional clear for the internal
		// overwrite/recovery paths.)
		if (
			existing !== undefined &&
			runId !== undefined &&
			existing.runId !== runId
		) {
			return false;
		}
		// Capture the filename BEFORE deleting so the slot release targets the
		// correct cron task. Fall back to the on-disk marker's filename when no
		// in-memory timer exists (e.g. cleared after a re-arm or via the
		// unconditional overwrite path).
		let completedFilename: string | null = existing?.filename ?? null;
		if (existing === undefined) {
			try {
				const raw = await fsp.readFile(resultPendingPath(agentId), "utf-8");
				const m = JSON.parse(raw) as ResultPendingMarker;
				// Critical (Codex, round 1) — wrong-run guard for the NO-in-memory-timer
				// path too. After a daemon restart the in-memory timer is gone but the
				// durable marker survives (re-armed or pending recovery). A stale
				// envelope from a PRIOR run (different runId) must NOT clear the current
				// marker or release the slot here either — the marker's runId is the
				// authority when there is no live timer.
				if (
					runId !== undefined &&
					typeof m.runId === "string" &&
					m.runId !== runId
				) {
					return false;
				}
				if (typeof m.filename === "string") completedFilename = m.filename;
			} catch {
				// no marker — leave completedFilename null
			}
		}
		if (existing !== undefined) {
			clearTimeout(existing.timer);
			timers.delete(agentId);
		}
		await removeMarker(agentId);
		// Task 6 #2 — the envelope was processed (run complete). Release the held
		// cron slot. Skipped only on the wrong-run guard above (early return).
		onResultComplete?.(agentId, completedFilename);
		return true;
	};

	// Atomic durable-marker write (temp-then-rename). Returns `true` when the
	// marker is durably on disk, `false` on a write fault (ENOSPC/EACCES on a
	// degraded state root). Shared by `startResultTimer` (which arms the in-memory
	// timer on top) and `persistResultMarker` (the load-bearing pre-claim write —
	// dual-adversarial #92 Critical C1). Does NOT touch the in-memory `timers` map.
	//
	// Minor (Opus, round 1) — do NOT `removeMarker()` before writing the new one.
	// `atomicRenameStaleDest` ATOMICALLY replaces the prior marker (rename(2) is
	// atomic on POSIX / NTFS MOVEFILE_REPLACE_EXISTING), so a pre-write unlink is
	// redundant AND opens a window in which NO marker is on disk — a crash there
	// would lose cross-restart recoverability for an in-flight run. Keeping the
	// prior marker until the atomic rename closes that window: there is always
	// EITHER the prior marker or the new one on disk.
	const writeMarker = async (
		agentId: string,
		runId: string,
		filename: string | null,
		timeoutMs?: number,
	): Promise<boolean> => {
		const deadlineMs = Date.now() + (timeoutMs ?? defaultTimeout);
		const marker: ResultPendingMarker = {
			agentId,
			runId,
			filename,
			deadlineMs,
		};
		const dst = resultPendingPath(agentId);
		const tmp = `${dst}.tmp`;
		try {
			await fsp.writeFile(tmp, JSON.stringify(marker), { mode: 0o600 });
			await atomicRenameStaleDest(tmp, dst);
			return true;
		} catch (err) {
			await fsp.unlink(tmp).catch(() => undefined);
			console.error(
				`[daemon] result-pending marker write for ${agentId} failed: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
			return false;
		}
	};

	// Dual-adversarial #92 Critical (C1) — the LOAD-BEARING durable marker write
	// the dispatch handler calls BEFORE it resolves (claims) the cron task. When
	// the marker cannot be persisted the handler ABORTS the dispatch (leaving the
	// task in `tasks/pending/` for the next tick) instead of resolving it with no
	// recoverable marker — the prior order (claim → marker, fall through to an
	// in-memory-only timer on fault) left NO pending task AND NO marker after a
	// restart in that window, silently dropping the daily summary. Unlike
	// `startResultTimer` this does NOT arm an in-memory timer; the handler arms
	// that (via `startResultTimer`) only AFTER a successful claim.
	const persistResultMarker = async (
		agentId: string,
		runId: string,
		filename: string | null = null,
		timeoutMs?: number,
	): Promise<boolean> => writeMarker(agentId, runId, filename, timeoutMs);

	const startResultTimer = async (
		agentId: string,
		runId: string,
		filename: string | null = null,
		timeoutMs?: number,
	): Promise<void> => {
		// Re-fire overwrites: clear-then-set (single in-flight per agent). This is
		// an OVERWRITE, not a run completion, so it MUST NOT fire onResultComplete
		// (that would release the cron slot for a run that is being superseded, not
		// finished). Tear down the prior in-memory timer directly.
		const prior = timers.get(agentId);
		if (prior !== undefined) {
			clearTimeout(prior.timer);
			timers.delete(agentId);
		}
		// Durable marker FIRST (atomic temp-then-rename) so a crash between write
		// and timer-arm still leaves a recoverable marker. A write fault degrades to
		// an in-memory-only timer (the live run is still dead-lettered in-process);
		// cross-restart durability is guaranteed UPSTREAM by the dispatch handler's
		// pre-claim `persistResultMarker` (#92 C1), which aborts the dispatch before
		// the task is resolved when the marker cannot be written.
		await writeMarker(agentId, runId, filename, timeoutMs);
		fireTimeout(agentId, runId, filename, timeoutMs ?? defaultTimeout);
	};

	/**
	 * Task 6 — boot-time recovery. Scan `result-pending/` for markers orphaned by
	 * a restart. A future deadline RE-ARMS a fresh in-memory timer (same runId,
	 * so idempotent); an expired/at-deadline marker is IMMEDIATELY dead-lettered
	 * (`pr-triage-result-timeout`) and removed — closing the silent-drop hole.
	 */
	const recoverResultTimers = async (): Promise<void> => {
		let entries: string[];
		try {
			entries = await fsp.readdir(pathFor("result-pending"));
		} catch {
			return; // dir absent — nothing to recover
		}
		const now = Date.now();
		for (const entry of entries) {
			if (!entry.endsWith(".json")) continue;
			const full = path.join(pathFor("result-pending"), entry);
			let marker: ResultPendingMarker;
			try {
				marker = JSON.parse(await fsp.readFile(full, "utf-8"));
			} catch {
				// Malformed marker — remove so it does not strand forever.
				await fsp.unlink(full).catch(() => undefined);
				continue;
			}
			if (
				typeof marker.agentId !== "string" ||
				typeof marker.runId !== "string" ||
				typeof marker.deadlineMs !== "number"
			) {
				await fsp.unlink(full).catch(() => undefined);
				continue;
			}
			const markerFilename =
				typeof marker.filename === "string" ? marker.filename : null;
			const remaining = marker.deadlineMs - now;
			if (remaining > 0) {
				// Re-arm a fresh timer for the REMAINING window, preserving the runId
				// + filename. `fireTimeout` wires the dead-letter emit AND the
				// onResultComplete slot release, so the recovered run behaves exactly
				// like a live one (and is idempotent — same runId).
				fireTimeout(marker.agentId, marker.runId, markerFilename, remaining);
				// Round-2 Minor (Codex) — the recovered run is still IN FLIGHT (no
				// envelope yet), so RE-HOLD its CronScheduler concurrency slot.
				// Without this the scheduler boots at runningCount=0 and a matching
				// cron tick could dispatch a SECOND prompt that overwrites the single
				// result-pending marker (duplicate/stale-run under non-daily cadences).
				// The symmetric onResultComplete (wired into fireTimeout above and into
				// clearResultTimer) releases it when the recovered run completes.
				onResultRecovered?.(marker.agentId, markerFilename);
			} else {
				// Already past deadline at boot — dead-letter immediately so the
				// orphaned dispatch is not silently lost.
				//
				// Dual-adversarial pass #2 Important (2026-06-04) — DURABILITY GATE,
				// the mirror of the live `fireTimeout` path. Record the timeout BEFORE
				// unlinking the durable marker / releasing the slot. `emit` returns
				// false (it never throws) when the telemetry append fails
				// (ENOSPC/EACCES); the prior order (unlink → ignore emit's boolean)
				// PERMANENTLY lost the orphaned-dispatch signal — the very event this
				// branch exists to surface — leaving nothing for the NEXT boot's
				// `recoverResultTimers` to re-scan. On a failed record: RETAIN the
				// marker (skip the unlink + slot release) so the next recovery
				// re-surfaces it (regression: `RT-12`).
				const recorded = await emit({
					kind: "pr-triage-result-timeout",
					agentId: marker.agentId,
					reason: "orphaned-dispatch-recovered",
				});
				if (!recorded) continue;
				await fsp.unlink(full).catch(() => undefined);
				// Task 6 #2 — release the held cron slot for the orphaned run.
				onResultComplete?.(marker.agentId, markerFilename);
			}
		}
	};

	return {
		startResultTimer,
		persistResultMarker,
		removeResultMarker: removeMarker,
		clearResultTimer,
		recoverResultTimers,
		isActiveRun,
	};
}

/**
 * R1 (feature-pr84-r1-daemon-creds, D2/D4) — build the handler the daemon
 * subscribes to `AgentManager`'s `'task-send-needed'` event. The DAEMON owns the
 * Telegram send so the pr-triage agent never holds the bot token nor makes a
 * network call.
 *
 * Behavior per event (mirrors the alert branch's durability rule):
 *   - `noSend`, or an EMPTY `sendText` (Minor: an empty string is "nothing to
 *     send", never deliver a blank Telegram message) → emit `pr-triage-no-send`
 *     (D4: distinguishes "nothing to send" from "agent died").
 *   - else → BOUNDED-RETRY-THEN-AT-MOST-ONCE. CLAIM (resolve) the envelope
 *     BEFORE sending (at-most-once — prevents the duplicate-send storm), then
 *     call `telegramBot.sendAgentNotification(sendText)` with a BOUNDED retry
 *     (`TELEGRAM_SEND_RETRY_BACKOFF_MS`): a transient `{ ok: false }` (429 /
 *     network blip) is retried up to `1 + backoff.length` total attempts before
 *     the existing `pr-triage-telegram-send-failed` telemetry fires. The retry
 *     is strictly bounded (no unbounded loop, no storm); the inter-attempt
 *     delays are `await`ed inside this already-fire-and-forget handler so the
 *     poll loop never blocks. After the budget is spent the day's summary is
 *     lost (at-most-once). The ONLY durable trace is the
 *     `pr-triage-telegram-send-failed` telemetry line; the next daily cron fire
 *     is an INDEPENDENT fresh fetch of CURRENT PRs, NOT a re-send of the dropped
 *     summary (there is no mechanism that re-surfaces a specific dropped run).
 *   - claim (resolve) the envelope file BEFORE the send (at-most-once); on a
 *     degraded telemetry dir the noSend branch leaves it in `pending/` to re-trip.
 *   - always `clearResultTimer(agentId)` in a `finally` (the agent produced a
 *     result, so the dead-letter timer is no longer relevant).
 *
 * `telegramBot` may be null in local-dev (`config.telegram` absent);
 * `sendAgentNotification` already guards that and returns `{ ok: false }`.
 *
 * `backoffMs` is an injectable test seam (defaults to
 * `TELEGRAM_SEND_RETRY_BACKOFF_MS`) so the regression test can drive the bounded
 * retry under fake timers without the production 250ms/1000ms waits.
 */
export function makeTaskSendHandler(deps: {
	agentManager: AgentManager;
	emit: (event: DaemonEvent) => Promise<unknown>;
	telegramBot: TelegramBot | null;
	// Task 6 + Critical (Codex, round 1) — accepts the run-correlated async clear.
	// The handler passes the ENVELOPE's runId (`evt.runId`, echoed by the agent),
	// NOT the live marker's runId, so a stale/wrong-run envelope (carrying an OLD
	// runId) fails the wrong-run guard and cannot clear the current run's
	// dead-letter timer/marker or release its held slot.
	//
	// noConfusingVoidType: this callback is intentionally
	// "awaitable-or-fire-and-forget" — the production `clearResultTimer` returns
	// `Promise<boolean>`, but several unit-test mocks pass a synchronous
	// `() => void`; the handler `await`s either form. The `biome-ignore` sits on the
	// return-type line itself (round-2 Minor fix) so biome associates the
	// suppression with the offending union node — placing it above the multi-line
	// JSDoc reported `suppressions/unused`.
	clearResultTimer: (
		agentId: string,
		runId?: string,
		// biome-ignore lint/suspicious/noConfusingVoidType: awaitable-or-fire-and-forget (see note above)
	) => Promise<boolean> | void;
	// Round-2 Important (Codex) — pre-send wrong-run guard. Consulted BEFORE the
	// irreversible Telegram send: a late/stale envelope (carrying an OLD runId
	// from a prior dispatch) is QUARANTINED — claimed out of `pending/` and
	// recorded as telemetry — instead of delivered to the user. Without this the
	// stale summary was sent first and the runId mismatch was only caught
	// afterward in `clearResultTimer` (too late — the send already happened).
	// Optional: when omitted (legacy callers / tests that do not exercise the
	// guard) the handler behaves as before (no pre-send validation).
	isActiveRun?: (agentId: string, runId?: string) => Promise<boolean>;
	backoffMs?: readonly number[];
}): (evt: TaskSendEvent) => Promise<void> {
	const { agentManager, emit, telegramBot, clearResultTimer, isActiveRun } =
		deps;
	const backoffMs = deps.backoffMs ?? TELEGRAM_SEND_RETRY_BACKOFF_MS;
	return async (evt: TaskSendEvent): Promise<void> => {
		// Dual-adversarial Critical (escalated 2026-06-02) — set when the pre-send
		// guard quarantines this envelope (stale OR missing-runId against an active
		// run). A quarantined envelope must NOT reach the `finally`'s
		// `clearResultTimer`: a missing-runId clear matches the live timer by agentId
		// and would strip the CURRENT run's dead-letter/overlap protection. Skipping
		// the clear leaves the live run intact for its own envelope (or dead-letter).
		let quarantined = false;
		try {
			// Dual-adversarial pass #2 Critical (2026-06-04) — the PRE-SEND wrong-run
			// guard runs FIRST, before the noSend/empty-summary branch, so EVERY path
			// (send, noSend, empty-summary) is validated against the ACTIVE run
			// consistently. Previously the noSend/empty branch returned BEFORE this
			// guard: a runId-LESS noSend envelope (a NORMAL failure mode — the echo is
			// optional per prompt-template.md) arriving while a NEWER run is active left
			// `quarantined === false`, so the `finally` called
			// `clearResultTimer(agentId, undefined)` and stripped the CURRENT run's
			// dead-letter timer/marker/held cron slot (silent summary drop + duplicate
			// dispatch). Hoisting the guard above the noSend branch closes that twin of
			// the SEND-path bug `TS-12b` covers (regression: `TS-12c`/`TS-12d`).
			//
			// Round-2 Important (Codex) + dual-adversarial Critical (escalated
			// 2026-06-02) — validate the envelope against the ACTIVE run BEFORE the
			// irreversible Telegram send. A late/stale envelope from a PRIOR dispatch
			// must NOT be pushed to the user; the post-send `clearResultTimer` guard
			// only stops it from clearing the CURRENT run's timer — it cannot un-send a
			// message already delivered. `isActiveRun` is called even when the envelope
			// carries NO runId: a runId-less envelope cannot be confirmed as the live
			// run, so when a run IS active it is quarantined too (the prior
			// `evt.runId !== undefined` gate let it bypass the guard and push a stale
			// summary). `isActiveRun` returns `true` (no quarantine) only when there is
			// NO active run to misattribute against — so a matching-runId completion
			// (send OR noSend) and the legacy no-correlation path both proceed and clear
			// normally. On quarantine: claim the envelope out of `pending/` (stop the
			// re-trip), record `pr-triage-stale-run-dropped`, skip everything below, AND
			// set `quarantined` so the `finally` does NOT run `clearResultTimer` (a
			// runId-less clear would match the live timer by agentId and strip the
			// current run's timer/marker/held slot).
			if (isActiveRun !== undefined) {
				const active = await isActiveRun(evt.agentId, evt.runId);
				if (!active) {
					quarantined = true;
					await emit({
						kind: "pr-triage-stale-run-dropped",
						agentId: evt.agentId,
						filename: evt.filename,
						...(evt.runId !== undefined ? { runId: evt.runId } : {}),
					});
					// Quarantine: remove from pending/ so it does not re-trip. A failed
					// claim (disk fault) leaves it in pending/ for a later tick — still
					// no send happened, so no duplicate/stale delivery.
					await agentManager.claimTask(evt.filename, evt.agentId);
					return;
				}
			}
			// Minor (empty-summary guard): treat an explicit `noSend` OR an
			// empty/whitespace-only `sendText` as "nothing to send" — never deliver
			// a blank Telegram message. An agent that computes an empty summary but
			// forgets the `noSend` discriminator must not produce a blank push. This
			// runs AFTER the wrong-run guard above: a noSend/empty envelope that
			// belongs to the live run (matching runId) or arrives with no active run
			// records `pr-triage-no-send` and clears normally; a stale/runId-less one
			// was already quarantined (so its summary is not mis-recorded as a
			// legitimate "nothing to send" for the live run).
			const isEmptySendText =
				evt.noSend !== true &&
				(evt.sendText === undefined || evt.sendText.trim().length === 0);
			if (evt.noSend === true || isEmptySendText) {
				// D4: empty summary — record-and-resolve, no send.
				const recorded = await emit({
					kind: "pr-triage-no-send",
					agentId: evt.agentId,
					filename: evt.filename,
				});
				if (recorded) {
					await agentManager.claimTask(evt.filename, evt.agentId);
				}
				return;
			}
			// BOUNDED-RETRY-THEN-AT-MOST-ONCE (pass#2 Critical fix + F3 retry). The
			// Telegram send is an IRREVERSIBLE side effect, so CLAIM the envelope
			// (move pending→resolved) BEFORE sending. `claimTask` returns false if
			// the rename failed (disk fault): then we do NOT send — the envelope
			// stays in pending/ for a later retry, with NO duplicate because no send
			// happened. Once the envelope is durably out of pending/, a post-send
			// fault can never re-trip a SECOND send (the prior bug: send-then-claim
			// re-sent the same summary every 5s when the claim rename failed, because
			// claimTask swallowed the error and returned). To avoid losing the day's
			// summary on a SINGLE transient blip (F3), the send below runs a BOUNDED
			// in-handler retry (`TELEGRAM_SEND_RETRY_BACKOFF_MS`) before giving up.
			// After the bounded retry is exhausted the run's summary is lost
			// (recorded as telemetry, surfaced next daily run) — acceptable for a
			// notification, and it still eliminates the unbounded re-trip / telemetry
			// storm on a persistently-undeliverable envelope.
			const claimed = await agentManager.claimTask(evt.filename, evt.agentId);
			if (!claimed) {
				// Rename failed — leave in pending/ for a later retry. No send
				// happened (no duplicate); claimTask already emitted claim-task-failed.
				return;
			}
			if (telegramBot === null) {
				// Local-dev / telegram-not-configured: the envelope is already
				// resolved, so record the non-delivery ONCE with no re-trip storm.
				await emit({
					kind: "pr-triage-telegram-send-failed",
					agentId: evt.agentId,
					filename: evt.filename,
					alertKind: "pr-triage-telegram-send-failed",
					details: "telegram-not-configured",
				});
				return;
			}
			const sendText = evt.sendText ?? "";
			// F3: BOUNDED retry around the send. The envelope is already claimed
			// (at-most-once), so a transient `{ ok: false }` (429 / network blip)
			// would otherwise lose the day's summary with no retry. Try once, then
			// retry up to `backoffMs.length` more times with short awaited delays.
			// Strictly bounded (max `1 + backoffMs.length` attempts) so it can never
			// storm; only after the budget is spent does the send-failed telemetry
			// fire (give up — at-most-once). The delays are awaited inside this
			// fire-and-forget handler, so the poll loop is not blocked.
			let r = await telegramBot.sendAgentNotification(sendText);
			for (let attempt = 0; !r.ok && attempt < backoffMs.length; attempt++) {
				await new Promise<void>((resolve) => {
					const t = setTimeout(resolve, backoffMs[attempt]);
					if (typeof t.unref === "function") t.unref();
				});
				r = await telegramBot.sendAgentNotification(sendText);
			}
			if (!r.ok) {
				// Bounded retry exhausted. Envelope already resolved (at-most-once).
				// Record the failed delivery; do NOT re-trip (which would duplicate
				// or storm). REUSE the Plan-04d kind; `details` is a token-free
				// status/error label.
				await emit({
					kind: "pr-triage-telegram-send-failed",
					agentId: evt.agentId,
					filename: evt.filename,
					alertKind: "pr-triage-telegram-send-failed",
					details: `${r.status ?? ""} ${r.error ?? ""}`.trim(),
				});
			}
		} catch (err) {
			// Never let the send path crash the polling/dispatch loop. Surface
			// the failure as telemetry; leave the file in pending/ for retry.
			await emit({
				kind: "pr-triage-telegram-send-failed",
				agentId: evt.agentId,
				filename: evt.filename,
				alertKind: "pr-triage-telegram-send-failed",
				details: `send-handler-exception ${err instanceof Error ? err.message : String(err)}`,
			});
		} finally {
			// R1 dual-adversarial round-1 Critical fix: ALWAYS release the
			// per-filename send in-flight guard, regardless of send outcome.
			// Without this, the next polling tick would suppress every
			// subsequent `task-send-needed` emit for this filename — a failed
			// send (left in `pending/` to re-trip) would never fire again.
			agentManager.releaseSendSlot(evt.filename);
			// Task 6 + Critical (Codex, round 1) — clear the dead-letter timer for
			// the run THIS ENVELOPE belongs to. Use the runId the AGENT ECHOED into
			// the envelope (`evt.runId`), NOT the runId re-read from the live on-disk
			// marker. Reading the marker was the bug: the marker always holds the
			// CURRENT run's runId, so `existing.runId !== runId` could never be true
			// and the wrong-run guard was dead. With the envelope's runId, a
			// late/stale envelope from a PRIOR run carries the OLD runId, fails the
			// guard inside `clearResultTimer` (returns false), and leaves the CURRENT
			// run's timer + marker + held slot intact.
			//
			// Dual-adversarial Critical (escalated 2026-06-02) — SKIP the clear entirely
			// when this envelope was QUARANTINED by the pre-send guard. A quarantined
			// envelope is missing/stale against an ACTIVE run; calling
			// `clearResultTimer(agentId, undefined)` would match the live timer by
			// agentId (the runId guard is skipped on `undefined`) and strip the CURRENT
			// run's timer/marker/held slot — the exact dead-letter protection this branch
			// adds. The non-quarantine paths (matching runId → the run completed; or no
			// active run at all → nothing to wrongly clear) still clear as before.
			if (!quarantined) {
				await clearResultTimer(evt.agentId, evt.runId);
			}
		}
	};
}

/**
 * Plan 04d Task 3 — build the dispatch handler the daemon subscribes to
 * `AgentManager`'s `'task-dispatch-needed'` event. Extracted into a
 * factory so main.test.ts can exercise the handler directly without
 * standing up `startDaemon`.
 *
 * Behavior per event:
 *   1. Resolve the live `AgentHandle` for `agentId`. Missing → emit
 *      `pr-triage-dispatch-failed { reason: "unregistered" }` and leave
 *      the file in `tasks/pending/` (NO `claimTask` call) so the next
 *      polling tick retries after registration completes.
 *   2. Resolve the runtime adapter and send a `PromptMessage` with the
 *      `taskContent.prompt` string. Adapter failure → emit
 *      `pr-triage-dispatch-failed { reason: "send-failed" }` and leave
 *      the file in pending.
 *   3. On send success → `agentManager.claimTask(filename, agentId)`.
 *      The cron slot decrements via the existing `'task-resolved'` chain.
 *
 * I1 stress fix: the outermost try/catch swallows any unexpected throw
 * (including `resolveRuntime` lookup failures, malformed payloads, etc.)
 * and surfaces them as `pr-triage-dispatch-failed { reason:
 * "listener-exception" }` so a buggy adapter cannot crash the polling
 * tick. `claimTask` is NOT called on this branch.
 *
 * The handler returns a `Promise<void>`. The subscription site wraps the
 * call in `void` (EventEmitter listeners are synchronous; we explicitly
 * disclaim the returned promise rather than letting it surface as an
 * UnhandledPromiseRejection).
 *
 * ARCHITECTURE NOTE (Plan 04d review #1, claim-on-send semantics):
 *
 * Plan 04d Task 3 step 3 says "await clean exit (with timeout — bound at
 * `stageTimeoutMs`) → `agentManager.claimTask(...)`". The actual
 * implementation calls `claimTask` immediately after `runtime.send`
 * resolves. The plan's wording presumed a per-task spawn-then-exit
 * lifecycle, but the Shape 1 PTY runtime — the only runtime pr-triage
 * uses in Phase 2 — is registered ONCE at daemon startup
 * (`startDaemon` pre-register loop) and stays alive across many task
 * dispatches. There is no "exit" between tasks: `runtime.send` returns
 * when the prompt has entered the PTY's stdin buffer, not when the
 * agent finishes processing.
 *
 * Consequence: the cron `runningCount` decrements at send-time rather
 * than completion-time. A rapidly-firing cron (sub-minute cadence)
 * could fire a second task while the first is still processing. For
 * pr-triage's daily cadence this is a non-issue. When a future runtime
 * adapter ships a per-task completion signal (e.g.,
 * `runtime.awaitIdle(handle)` returning when stdout quiesces, or a
 * structured "task-done" message back from the agent), this handler
 * should `await` that signal between `runtime.send` and
 * `agentManager.claimTask`. At that point the matching
 * `pr-triage-dispatch-failed` reasons `spawn-failed`, `exit-nonzero`,
 * and `exit-timeout` get reinstated in `telemetry.ts`.
 *
 * The persistent-PTY claim-on-send model is the load-bearing choice for
 * Phase 2 — do not reintroduce per-task spawn semantics without
 * coordinating with the runtime adapter contract.
 */

/**
 * Critical (Codex, round 1) — append a per-dispatch run-correlation instruction
 * to the dispatched PROMPT. The agent MUST copy this exact `runId` into its
 * result envelope's `runId` field. The daemon then compares the ENVELOPE's runId
 * (carried through `task-send-needed`) against the live marker's runId, so a
 * late/stale envelope from a PRIOR run (carrying an OLD runId) cannot clear the
 * CURRENT run's dead-letter timer/marker or release its slot. Without this echo
 * the send handler had to re-read the runId from the live on-disk marker — which
 * by construction ALWAYS matched the active timer, defeating the wrong-run guard.
 *
 * Plain text (no markup) and clearly framed as a daemon instruction, not PR data.
 */
export function appendRunIdInstruction(prompt: string, runId: string): string {
	return `${prompt}\n\n---\nDAEMON RUN CORRELATION (not PR data): when you write your result envelope, include the field "runId":"${runId}" exactly as given, alongside the existing agentId/sendText (or agentId/noSend) fields. This lets the daemon correlate your result with this specific run.`;
}

export function makeTaskDispatchHandler(deps: {
	agentManager: AgentManager;
	// Promise<unknown>: the handler awaits emit and ignores the result, so it
	// accepts both the real telemetry `emit` (now Promise<boolean> — reports
	// durable-write success) and the Promise<void> mocks used in tests.
	emit: (event: DaemonEvent) => Promise<unknown>;
	// R1 (feature-pr84-r1-daemon-creds, D4) + Task 6 — arm the durable,
	// run-correlated dead-letter timer after a successful pr-triage PROMPT
	// dispatch. The handler stamps a fresh `runId` per dispatch and threads it
	// into the marker so a wrong-run envelope cannot clear the live run. The
	// matching `task-send-needed` handler clears it when the agent's result
	// envelope arrives. Optional so the existing handler unit tests (which only
	// assert dispatch behavior) need no timer plumbing.
	startResultTimer?: (
		agentId: string,
		runId: string,
		filename?: string | null,
		timeoutMs?: number,
	) => Promise<void> | void;
	// Dual-adversarial #92 Critical (C1) — persist the durable result marker
	// BEFORE the claim resolves the cron task. Returns false on a write fault so
	// the handler aborts the dispatch (task stays in tasks/pending/) instead of
	// resolving it with no recoverable marker (a restart in that window silently
	// drops the daily summary). Optional so existing dispatch unit tests that do
	// not exercise durability need no marker plumbing.
	persistResultMarker?: (
		agentId: string,
		runId: string,
		filename?: string | null,
		timeoutMs?: number,
	) => Promise<boolean>;
	// Remove the durable marker the handler pre-wrote — used to clean up after a
	// claim fault so a crash before retry does not re-arm an orphan marker (#92 C1).
	removeResultMarker?: (agentId: string) => Promise<void>;
}): (evt: TaskDispatchEvent) => Promise<void> {
	const {
		agentManager,
		emit,
		startResultTimer,
		persistResultMarker,
		removeResultMarker,
	} = deps;
	return async (evt: TaskDispatchEvent): Promise<void> => {
		try {
			const handle = findHandleForAgent(agentManager, evt.agentId);
			if (handle === null) {
				await emit({
					kind: "pr-triage-dispatch-failed",
					agentId: evt.agentId,
					filename: evt.filename,
					reason: "unregistered",
					message: "no live handle at dispatch time",
				});
				return;
			}
			// pr84-gap-closure (Codex H1) — defense in depth. The normal
			// polling path short-circuits an `ndjsonAlert` envelope in
			// `AgentManager.processPendingTask` BEFORE the
			// `task-dispatch-needed` emit, so this branch is not reached in
			// production. It guards any path that drives the handler directly
			// (tests, future re-routing): a record-and-resolve alert must
			// emit the telegram-send-failed telemetry kind + claim the file,
			// NEVER fall through to `malformed-task` on its absent `prompt`.
			// The `finally` block still releases the dispatch slot on this
			// early return.
			//
			// Codex H1 follow-up (un-scoped-bypass close): mirror the polling
			// path's scoping. Fire ONLY when (a) `agentId === "pr-triage"`
			// (daemon-owned producer, not self-declared), (b) the alert kind
			// is in the daemon-owned `PR_TRIAGE_ALERT_KINDS` set, and (c) there
			// is NO non-empty `prompt` field. Any other shape falls through to
			// the prompt-validation / dispatch path below so an alert field on
			// a real prompt task (or for another agent / unknown kind) cannot
			// short-circuit dispatch.
			const ndjsonAlert = (evt.taskContent as { ndjsonAlert?: unknown })
				.ndjsonAlert;
			const alertPromptRaw = (evt.taskContent as { prompt?: unknown }).prompt;
			const alertHasPrompt =
				typeof alertPromptRaw === "string" && alertPromptRaw.length > 0;
			// I-3 (dual-adversarial pass #2): mirror the polling-path
			// filename-provenance check — require the FILENAME to match the
			// pr-triage producer convention (`pr-triage__<ts>-<pid>.json`).
			// `tasks/pending/` is the generic shared bus; a foreign producer's
			// file with a pr-triage-shaped body must NOT be record-and-resolved
			// as an alert (it would destroy the real producer's signal). Any
			// non-matching filename falls through to prompt-validation/dispatch.
			if (
				evt.agentId === "pr-triage" &&
				evt.filename.startsWith("pr-triage__") &&
				typeof ndjsonAlert === "string" &&
				PR_TRIAGE_ALERT_KINDS.has(ndjsonAlert) &&
				!alertHasPrompt
			) {
				const detailsRaw = (evt.taskContent as { details?: unknown }).details;
				const details = typeof detailsRaw === "string" ? detailsRaw : "";
				// pr84 minor (durability symmetry with agent-manager.ts
				// processPendingTask): `emit` returns whether the record durably
				// landed. Claim (resolve) the alert file ONLY when it did —
				// otherwise leave it in `pending/` so the alert re-trips next tick
				// instead of being silently resolved without ever surfacing the
				// signal on a degraded telemetry dir (ENOSPC/EACCES).
				const recorded = await emit({
					kind: "pr-triage-telegram-send-failed",
					agentId: evt.agentId,
					filename: evt.filename,
					alertKind: ndjsonAlert,
					details,
				});
				if (recorded) {
					await agentManager.claimTask(evt.filename, evt.agentId);
				}
				return;
			}
			// Dual-adversarial I-E fix (extends async-bot M-3): validate
			// `prompt` is a non-empty string BEFORE `runtime.send`. Empty
			// or missing prompts no longer silently advance to `resolved/`
			// — the file is LEFT in `tasks/pending/` for human inspection
			// and the cron slot stays elevated until the operator drains
			// it. Async-bot M-3 only logged the malformed shape; this fix
			// stops the dispatch+claim path entirely.
			const promptRaw = evt.taskContent.prompt;
			if (typeof promptRaw !== "string" || promptRaw.length === 0) {
				await emit({
					kind: "pr-triage-dispatch-failed",
					agentId: evt.agentId,
					filename: evt.filename,
					reason: "malformed-task",
					message: `prompt field is ${
						typeof promptRaw === "undefined"
							? "absent"
							: typeof promptRaw !== "string"
								? `type ${typeof promptRaw}`
								: "empty string"
					}; task left in tasks/pending/ for operator inspection`,
				});
				return;
			}
			// Critical (Codex, round 1) — stamp the per-dispatch correlation runId
			// BEFORE building the prompt message so it can be ECHOED to the agent and
			// REUSED when arming the dead-letter timer. The SAME runId must reach the
			// agent (so it copies it into its envelope) AND the marker (so the send
			// handler's wrong-run guard has a value to compare the envelope's runId
			// against). Scoped to pr-triage — the only agent on the daemon-owned send
			// contract; every other agent gets the verbatim prompt and no timer.
			const isSendContract =
				startResultTimer !== undefined && evt.agentId === "pr-triage";
			const runId = isSendContract ? randomUUID() : null;
			const promptText =
				runId !== null ? appendRunIdInstruction(promptRaw, runId) : promptRaw;
			const runtime: AgentRuntime = resolveRuntime(handle.runtime);
			const message: AgentMessage = {
				kind: "prompt",
				payload: { text: promptText },
			};
			try {
				await runtime.send(handle, message);
			} catch (err) {
				await emit({
					kind: "pr-triage-dispatch-failed",
					agentId: evt.agentId,
					filename: evt.filename,
					reason: "send-failed",
					message: err instanceof Error ? err.message : String(err),
				});
				return;
			}
			try {
				// Dual-adversarial Critical (round 1) — HONOR claimTask's return on
				// the dispatch path (was discarded). `claimTask` now returns `false`
				// on a pending→resolved rename fault (EACCES/ENOSPC/EBUSY) and the
				// send/alert legs already honor it; the dispatch leg must too. On a
				// failed claim the SAME file is still in `tasks/pending/`, so the next
				// polling tick would re-dispatch the SAME prompt under a NEW runId.
				// Arming the result timer here would OVERWRITE the marker with the new
				// runId (startResultTimer's clear-then-set), making the redispatch
				// authoritative — and when the FIRST run finally writes its envelope
				// (carrying the ORIGINAL runId) the send handler's wrong-run guard
				// quarantines the legitimate daily summary as stale. So on `false`:
				// do NOT arm/overwrite the timer, surface dispatch-failed telemetry,
				// and leave the file in pending/ for the next tick to retry (the marker
				// from any PRIOR live run is left untouched). claimTask already emits
				// `claim-task-failed`; this dispatch-level event keeps the dispatch
				// taxonomy complete (one dispatch event per task).
				//
				// Dual-adversarial #92 Critical (C1) — durability is LOAD-BEARING.
				// Persist the durable result marker BEFORE the claim resolves the cron
				// task. The claim that runs next moves the file out of tasks/pending/;
				// the prior order (claim → marker, then fall through to an in-memory-ONLY
				// timer on a marker-write fault) left NO pending task AND NO recoverable
				// marker after a restart in that window, silently dropping the daily
				// summary. On a marker-write fault here: ABORT the dispatch — leave the
				// file in tasks/pending/ for the next tick, release the held cron slot
				// (the slot has been held since cron-fire; no claim happened so nothing
				// emits `task-resolved`/`cron-result-complete` otherwise), and return.
				// No in-memory timer was armed, so there is nothing to tear down.
				if (persistResultMarker !== undefined && runId !== null) {
					const persisted = await persistResultMarker(
						evt.agentId,
						runId,
						evt.filename,
						RESULT_TIMEOUT_MS,
					);
					if (!persisted) {
						await emit({
							kind: "pr-triage-dispatch-failed",
							agentId: evt.agentId,
							filename: evt.filename,
							reason: "marker-write-failed",
							message:
								"durable result marker write faulted; dispatch aborted, task left in tasks/pending/ for retry",
						});
						if (isSendContract) {
							agentManager.emit("cron-result-complete", {
								agentId: evt.agentId,
								filename: evt.filename,
							});
						}
						return;
					}
				}
				const claimed = await agentManager.claimTask(evt.filename, evt.agentId);
				if (!claimed) {
					await emit({
						kind: "pr-triage-dispatch-failed",
						agentId: evt.agentId,
						filename: evt.filename,
						reason: "claim-failed",
						message:
							"claimTask reported a pending→resolved rename fault; task left in tasks/pending/ for retry, result timer NOT armed",
					});
					// Dual-adversarial #92 C1 — the durable marker we pre-wrote (above) is
					// for a task that did NOT resolve. Remove it (best-effort) so a crash
					// before the next tick's retry does not leave a recoverable marker for
					// an unclaimed task (recoverResultTimers would re-arm it + re-hold the
					// slot, stalling the retry). The next tick re-dispatches under a fresh
					// runId. The unlink may itself fault on the same degraded disk — that
					// is acceptable: the orphan marker is then superseded by the retry's
					// atomic marker overwrite.
					if (removeResultMarker !== undefined) {
						await removeResultMarker(evt.agentId);
					}
					// Dual-adversarial pass #2 (Critical follow-up) — the claim faulted, so
					// claimTask emitted NO `task-resolved` and we arm NO result timer. For a
					// send-contract (deferred-release) agent the CronScheduler slot would
					// otherwise stay HELD forever (it is released only via
					// `cron-result-complete`, which the result timer fires); with
					// `maxConcurrent: 1` the next cron tick is then overlap-prevented and the
					// file we just left in tasks/pending/ is NEVER retried (permanent stall —
					// the leak the round-1 fix's own "leave for next tick to retry" comment
					// assumed away). Release the held slot HERE so the next tick can retry,
					// WITHOUT arming/overwriting any live run's durable marker. Gated on
					// `isSendContract` so non-deferred agents (whose slot already released at
					// `task-resolved`) are not double-released.
					if (isSendContract) {
						agentManager.emit("cron-result-complete", {
							agentId: evt.agentId,
							filename: evt.filename,
						});
					}
					return;
				}
				// R1 (feature-pr84-r1-daemon-creds, D4) + Task 6 — the PROMPT was
				// dispatched (claimed) successfully. Arm the durable, run-correlated
				// dead-letter timer so an agent that crashes WITHOUT writing a result
				// envelope surfaces as `pr-triage-result-timeout` rather than a
				// silently lost notification — AND survives a daemon restart via the
				// `result-pending/<agentId>.json` marker. The runId stamped into the
				// marker is the SAME one echoed into the prompt above, so a
				// stale/wrong-run envelope (carrying a DIFFERENT runId) cannot clear
				// the live run. The `task-send-needed` handler clears it (by the
				// ENVELOPE's runId) when the agent's `pr-triage-send__*.json` envelope
				// arrives. Awaited so the marker is durable before this handler returns
				// (the in-flight guard is still held by the polling loop).
				if (startResultTimer !== undefined && runId !== null) {
					await startResultTimer(
						evt.agentId,
						runId,
						evt.filename,
						RESULT_TIMEOUT_MS,
					);
				}
			} catch (err) {
				// claimTask itself surfaces `claim-task-failed` telemetry on
				// fs.rename errors and resolves — a throw here is unexpected
				// (e.g., assertSafeIdentifier on the filename). Promote it to
				// listener-exception so the operator sees ONE dispatch event
				// per task rather than mixed signal across taxonomies.
				await emit({
					kind: "pr-triage-dispatch-failed",
					agentId: evt.agentId,
					filename: evt.filename,
					reason: "listener-exception",
					message: err instanceof Error ? err.message : String(err),
				});
				// Dual-adversarial pass #2 (Minor) — claimTask THREW, so neither
				// `task-resolved` nor the result timer fired; for a send-contract
				// (deferred-release) agent the CronScheduler slot would leak until daemon
				// restart (overlap-preventing every future pr-triage cron fire). Release it
				// here — same reasoning as the claim-fault path above.
				if (isSendContract) {
					agentManager.emit("cron-result-complete", {
						agentId: evt.agentId,
						filename: evt.filename,
					});
				}
			}
		} catch (err) {
			await emit({
				kind: "pr-triage-dispatch-failed",
				agentId: evt.agentId,
				filename: evt.filename,
				reason: "listener-exception",
				message: err instanceof Error ? err.message : String(err),
			});
		} finally {
			// Dual-adversarial C-1 fix: ALWAYS release the per-filename
			// in-flight guard, regardless of dispatch outcome. Without
			// this, the next polling tick would suppress every subsequent
			// dispatch for this filename and operators would see the
			// cron-fired task wedged in `pending/` until daemon restart.
			agentManager.releaseDispatchSlot(evt.filename);
		}
	};
}

/**
 * R1 (feature-pr84-r1-daemon-creds) — the placeholder in
 * `prompt-template.md` the daemon substitutes the sanitized scalar PR payload
 * JSON into. The agent reads ONLY this injected data (no gh/curl/token).
 */
export const PR_DATA_PLACEHOLDER = "{{PR_DATA_JSON}}";

/**
 * R1 (feature-pr84-r1-daemon-creds) — the default `prepareCronPrompt` for the
 * pr-triage cron. Holds `GH_TOKEN` in the daemon's own process; fetches all
 * open PRs, sanitizes them to a scalar payload (no raw bodies), and:
 *   - on fetch error → `{ skip: true, reason: "pr-fetch-failed" }` (do NOT
 *     spawn with stale/no data),
 *   - `totalCount === 0` → `{ skip: true, reason: "no-open-prs" }` (REPLACES the
 *     bash wake-check gate — zero PRs means no spawn, no notification),
 *   - else → read the template once and substitute the payload JSON into the
 *     `{{PR_DATA_JSON}}` placeholder, returning `{ skip: false, prompt }`.
 *
 * The fetch is bounded by `fetchTimeoutMs` (default 15s, like the old
 * `WAKE_CHECK_TIMEOUT_MS`) so a hung GitHub call cannot wedge the 60s tick.
 *
 * Gated to `agentId === "pr-triage"` — any other cron with no GH_TOKEN need
 * gets the verbatim template (the hook returns the template unchanged with no
 * fetch). A missing `GH_TOKEN` skips the fetch with `pr-fetch-failed` so the
 * daemon never spawns the agent with stale data.
 *
 * Exported for unit testability — main.test.ts drives it with an injected
 * fetch + readFile + token.
 */
export function makePrTriageCronPrompt(deps: {
	// Static token (tests). Prefer `getToken` in production so a SIGHUP credential
	// rotation (which updates process.env.GH_TOKEN) is picked up at fire-time.
	token?: string | undefined;
	getToken?: () => string | undefined;
	fetchImpl?: typeof fetch;
	fetchTimeoutMs?: number;
	readTemplate?: (templatePath: string) => string;
	nowFn?: () => number;
}): PrepareCronPrompt {
	const readTemplate =
		deps.readTemplate ?? ((p: string) => fs.readFileSync(p, "utf8"));
	const nowFn = deps.nowFn ?? (() => Date.now());
	return async (cron: RegisteredCron) => {
		// Only the pr-triage cron uses the daemon-fetch path. Any other cron
		// (none today) falls back to the verbatim template — no fetch, no token.
		if (cron.agentId !== "pr-triage") {
			try {
				return { skip: false, prompt: readTemplate(cron.promptTemplatePath) };
			} catch {
				return { skip: true, reason: "prepare-skip" };
			}
		}
		// pass#2 fix: read the PAT at FIRE time (live process.env via getToken), not
		// a value captured once at startDaemon — so a SIGHUP rotation takes effect
		// without a full daemon restart. Falls back to the static `token` for tests.
		const token = deps.getToken ? deps.getToken() : deps.token;
		if (typeof token !== "string" || token.length === 0) {
			// No credential → cannot fetch → do NOT spawn with stale data.
			return { skip: true, reason: "pr-fetch-failed" };
		}
		let payload: ReturnType<typeof sanitizePrPayload>;
		try {
			const { nodes, issueCount } = await fetchOpenPrs(token, {
				...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
				...(deps.fetchTimeoutMs !== undefined
					? { timeoutMs: deps.fetchTimeoutMs }
					: {}),
			});
			// FIX C: pass the TRUE open-PR count (search.issueCount) so the summary's
			// reported total is honest past the 50-node inspected page, not capped.
			payload = sanitizePrPayload(nodes, nowFn(), issueCount);
		} catch (err) {
			// Minor (fetch-error observability): FetchPrsError is token-free but
			// carries the HTTP status (401 vs 403 vs 429 vs null for a network /
			// timeout error). Surface it via `exitCode` so the `cron-skipped`
			// telemetry distinguishes a revoked PAT from a rate-limit without
			// server-side logs. We still never echo the error message (it could
			// carry context); only the numeric status flows out.
			const status =
				err instanceof FetchPrsError && typeof err.status === "number"
					? err.status
					: null;
			return { skip: true, reason: "pr-fetch-failed", exitCode: status };
		}
		if (payload.totalCount === 0) {
			// Zero open PRs → no spawn (replaces the wake-check exit-1 gate).
			return { skip: true, reason: "no-open-prs" };
		}
		let template: string;
		try {
			template = readTemplate(cron.promptTemplatePath);
		} catch {
			return { skip: true, reason: "prepare-skip" };
		}
		const prompt = template
			.split(PR_DATA_PLACEHOLDER)
			.join(JSON.stringify(payload, null, 2));
		return { skip: false, prompt };
	};
}

/**
 * Plan 04d Task 3 — build the safe-identifier-compliant sessionId for
 * a daemon-startup-time pre-registered agent. Format:
 *   `daemon-startup-<32 hex chars from UUID4>-<agentId>`
 *
 * The prefix marks startup-time registrations distinctly from runtime
 * spawn sessionIds (which are typically `<agentId>-session`). The full
 * 32-hex (~2^128) suffix makes birthday-paradox collisions astronomically
 * negligible at Phase-3 scale (dozens of agents per daemon × many daemon
 * restarts). Earlier drafts truncated to 8 hex (~10^9) which would have
 * been acceptable for pr-triage alone — review #4 flagged the truncation
 * as cliff-edge once additional agents are wired.
 *
 * Per `assertSafeIdentifier`: no `/`, `\\`, `..`, NUL; max length
 * enforced by the validator. UUID hex + hyphens satisfy all constraints.
 */
export function makeDaemonStartupSessionId(agentId: string): string {
	const suffix = randomUUID().replace(/-/g, "");
	return `daemon-startup-${suffix}-${agentId}`;
}

/**
 * Dual-adversarial I-C fix — backoff schedule (ms) for cron-agent
 * re-registration after a boot-spawned PTY exits. Exported so the
 * regression test can advance fake timers deterministically.
 *
 *   attempt 1 → 5s
 *   attempt 2 → 30s
 *   attempt 3 → 60s
 *
 * After attempt 3 fails, `cron-agent-restart-failed` telemetry fires
 * and the agent stays unrouted until the daemon is restarted.
 */
export const CRON_AGENT_RESTART_BACKOFF_MS: readonly number[] = [
	5_000, 30_000, 60_000,
];

// R1 (feature-pr84-r1-daemon-creds, D1) — the daemon-owned set of NON-SECRET
// process-level vars a trusted cron agent's PTY needs to actually run a shell.
// The canonical definition (and the doc explaining WHY each key is safe) lives
// in `./cron-agent-env.ts` so `cron-scheduler.ts` can share the SAME allowlist
// and `composeRuntimeEnv` helper without a circular import (main.ts →
// cron-scheduler.ts). Re-exported here for back-compat with existing importers.
export { CRON_AGENT_RUNTIME_ALLOWLIST } from "./cron-agent-env.js";

/**
 * R1 (feature-pr84-r1-daemon-creds) — the daemon-owned set of agentIds for
 * which the daemon overlays the NON-SECRET `CRON_AGENT_RUNTIME_ALLOWLIST`
 * runtime descriptors. (Renamed from `CRON_AGENT_SECRET_TRUSTED_AGENTS`: there
 * are no secrets in the overlay anymore, only runtime vars.)
 *
 * `agentId` is daemon-controlled (the registration key passed to
 * `registerCronAgentWithRestart`, NOT a self-declared config field). The gate
 * is now non-security-critical (runtime descriptors leak no credential) but is
 * kept so the multi-tenant isolation contract stays crisp: an untrusted /
 * client agent still gets `baseEnv` UNCHANGED (no PATH injection), exactly as
 * the claude-pty isolation invariant Test 7 encodes.
 */
export const CRON_AGENT_RUNTIME_TRUSTED_AGENTS: ReadonlySet<string> = new Set([
	"pr-triage",
]);

/**
 * R1 (feature-pr84-r1-daemon-creds) — pure env-composition helper. Returns
 * `baseEnv` UNCHANGED unless `agentId` is in the daemon-owned
 * `CRON_AGENT_RUNTIME_TRUSTED_AGENTS` set, in which case it returns a shallow
 * copy of `baseEnv` overlaid with ONLY the `CRON_AGENT_RUNTIME_ALLOWLIST`
 * NON-SECRET base-runtime vars (`PATH`/`HOME`/`SHELL`/`LANG` + the
 * `IAGO_DAEMON_STATE_ROOT` rendezvous dir) — taking only the keys actually
 * present (non-empty string) in `daemonEnv`. Absent/empty values are skipped so
 * we never materialize empty-string env entries.
 *
 * CRITICAL SECURITY PROPERTY (D1): NO secret is EVER copied into the composed
 * agent env. The former secret allowlist is gone; `IAGO_TELEGRAM_BOT_TOKEN`,
 * `GH_TOKEN`, and `IAGO_TELEGRAM_ALLOWED_USER_IDS` present in `daemonEnv` are
 * NOT overlaid because they are not in `CRON_AGENT_RUNTIME_ALLOWLIST`. The
 * daemon still holds those secrets in its OWN process.env for its own
 * fetch/send — it just no longer hands them to any agent.
 *
 * The runtime-var overlay is required because node-pty REPLACES the parent env
 * (claude-pty.ts), so without them the spawned shell cannot locate the `claude`
 * binary. An untrusted agent gets `baseEnv` UNCHANGED: the multi-tenant
 * isolation invariant is preserved for it (no PATH injection).
 */
export function composeCronAgentEnv(
	agentId: string,
	baseEnv: Record<string, string>,
	daemonEnv: NodeJS.ProcessEnv,
): Record<string, string> {
	if (!CRON_AGENT_RUNTIME_TRUSTED_AGENTS.has(agentId)) return baseEnv;
	const merged: Record<string, string> = { ...baseEnv };
	// ONLY the non-secret runtime descriptors are overlaid — NO secrets. A
	// declared `baseEnv` value already present for a key is overwritten by the
	// daemon's process.env value (the daemon's runtime descriptors are
	// authoritative). The scrubbed overlay is produced by the SAME
	// `composeRuntimeEnv` helper the back-compat wake-check uses — single source
	// of truth for the allowlist.
	const runtime = composeRuntimeEnv(daemonEnv);
	for (const [key, value] of Object.entries(runtime)) {
		if (typeof value === "string") merged[key] = value;
	}
	return merged;
}

/**
 * Dual-adversarial I-C fix — register a cron-driven agent and arm a
 * restart loop that re-spawns the agent if its persistent PTY exits.
 *
 * Reason: `startDaemon`'s cron pre-register loop spawns a real PTY at
 * boot. The `task-dispatch-needed` handler relies on the handle staying
 * alive across many cron fires (the persistent-PTY claim-on-send
 * model). If the PTY exits before the next cron-fire (credential
 * expiry, crash, heartbeat-driven recycle), `isAgentRegistered` would
 * return false and dispatch would silently emit
 * `pr-triage-dispatch-failed { reason: "unregistered" }` on every
 * subsequent fire until manual restart.
 *
 * The loop subscribes to the runtime's `onStatusChanged` callback on
 * the spawned handle. On `exited` or `crashed`, it schedules a
 * re-registration with exponential backoff
 * (`CRON_AGENT_RESTART_BACKOFF_MS`). Each successful re-registration
 * emits `cron-agent-restarted`; budget exhaustion emits
 * `cron-agent-restart-failed`.
 *
 * SINGLE RESTART AUTHORITY (Task 8, feature-daemon-recovery-hardening) —
 * two restart subsystems act on the same agentId: THIS cron-restart loop's
 * exit listener AND the heartbeat-driven recycle (`AgentManager.restartAgent`
 * / `doRestart`). Left uncoupled they would race / double-restart, and a
 * heartbeat recycle would re-spawn a generation with NO cron-side exit
 * listener (so a later exit goes un-restarted — silent death of the daily
 * job). This loop resolves both:
 *   1. RE-ARM ON EVERY RESTART. The loop subscribes to the AgentManager's
 *      `agent-restarted` event and re-arms its exit listener on the FRESH
 *      handle whenever ANY path restarts this agentId — heartbeat recycle,
 *      IPC, or this loop itself. The cron-side listener therefore always
 *      tracks the live generation.
 *   2. NO DOUBLE-RESTART. The exit listener consults
 *      `agentManager.isRestarting(handleId)` before scheduling: a heartbeat
 *      recycle tearing the PTY down trips the same `exited` status this
 *      listener watches, but the recycle is already in flight, so the listener
 *      yields (the recycle's `agent-restarted` re-arms). The loop only OWNS a
 *      restart when it is the sole actor (a genuine unsolicited crash).
 *
 * The helper short-circuits when `isShuttingDown()` returns true (the
 * daemon teardown drains the polling loop and removes listeners; a
 * new spawn during this window would survive past
 * `agentManager.shutdownAgent()` and become an orphan PTY).
 *
 * Exported for unit testability (main.test.ts).
 */
export async function registerCronAgentWithRestart(deps: {
	agentManager: AgentManager;
	agentId: string;
	agentConfig: AgentConfigShape;
	isShuttingDown: () => boolean;
	/**
	 * pr84-gap-closure (brief D3) — injectable restart backoff schedule.
	 * Defaults to `CRON_AGENT_RESTART_BACKOFF_MS`. A test seam (mirrors
	 * `CronScheduler` `nowFn` / `startPollingLoop` `intervalMs`) so the
	 * restart-loop integration test can drive a real-timer restart in
	 * ~10ms instead of the production 5s, without faking timers (which
	 * would break Phase B's real-I/O marker poll).
	 */
	backoffMs?: readonly number[];
}): Promise<() => void> {
	const { agentManager, agentId, agentConfig, isShuttingDown } = deps;
	const backoffMs = deps.backoffMs ?? CRON_AGENT_RESTART_BACKOFF_MS;

	// R1 (feature-pr84-r1-daemon-creds) — compose the per-agent env the daemon
	// hands to `registerAgent`. For an agent in the daemon-owned
	// `CRON_AGENT_RUNTIME_TRUSTED_AGENTS` set, overlay ONLY the NON-SECRET
	// `CRON_AGENT_RUNTIME_ALLOWLIST` runtime descriptors (PATH/HOME/SHELL/LANG)
	// present in `process.env` (skip absent/empty). NO secret is ever injected —
	// the agent holds no token (the daemon does its own GitHub fetch + Telegram
	// send). Any agent NOT in the set gets ONLY its declared `agentConfig.env`
	// (multi-tenant isolation preserved). Used for BOTH the initial registration
	// and the restart re-registration.
	const composeAgentEnv = (): Record<string, string> =>
		composeCronAgentEnv(agentId, agentConfig.env, process.env);

	// Task 8 — the single live exit-listener unsubscribe for THIS agent. Re-armed
	// (prior torn down first) on every restart, so exactly ONE listener is armed
	// against the live generation at any time.
	let currentUnsubscribe: (() => void) | null = null;

	// Task 8 (Important, dual-adversarial pass #2) — close the cross-subsystem
	// deferred double-restart race. A cron-owned restart waits out `backoffMs`
	// (~5s) BEFORE it fires `restartAgent`. If another actor (heartbeat recycle,
	// IPC) restarts this agent DURING that wait, the agent is already a fresh,
	// healthy generation — firing the cron-deferred restart anyway would recycle
	// it spuriously. `isRestarting(handle.id)` (checked at listener-fire time)
	// cannot catch this: the recycle can start AND complete inside the backoff
	// window, after the cron listener already committed to scheduling. So track the
	// pending backoff timer + a monotonic generation; `onAgentRestarted` (the
	// re-arm authority, fired by ANY restart) cancels the pending timer and bumps
	// the generation, and the awaiting `scheduleRestart` aborts when its captured
	// generation is stale. Cancelling resolves the wait (never `clearTimeout`
	// alone — that would strand the awaiting promise forever).
	let pendingRestart: {
		timer: ReturnType<typeof setTimeout>;
		resolve: () => void;
	} | null = null;
	let restartGeneration = 0;
	const cancelPendingRestart = (): void => {
		restartGeneration++;
		if (pendingRestart !== null) {
			clearTimeout(pendingRestart.timer);
			pendingRestart.resolve();
			pendingRestart = null;
		}
	};

	const armExitListener = (handle: AgentHandle): void => {
		// Task 8 — tear down any prior listener before arming the new one so two
		// generations never both watch for exit (a stale listener on a dead PTY is
		// harmless but a duplicate live one would double-count an exit).
		if (currentUnsubscribe !== null) {
			try {
				currentUnsubscribe();
			} catch {
				// best-effort
			}
			currentUnsubscribe = null;
		}
		const runtime: AgentRuntime = resolveRuntime(handle.runtime);
		let scheduled = false;
		const unsubscribe = runtime.onStatusChanged(handle, (status) => {
			if (status !== "exited" && status !== "crashed") return;
			if (scheduled) return;
			// Task 8 (no double-restart) — if a restart is ALREADY in flight for
			// this handle (a heartbeat recycle tearing the PTY down trips the same
			// `exited`/`crashed` status this listener watches), yield: the recycle
			// owns the restart and its `agent-restarted` event will re-arm this
			// listener on the fresh generation. The cron loop only owns a restart
			// when it is the sole actor (a genuine unsolicited crash).
			if (agentManager.isRestarting(handle.id)) return;
			scheduled = true;
			// Defer the actual unsubscribe + retry to a microtask so the
			// status-callback site is not entangled with PTY teardown.
			void (async () => {
				try {
					unsubscribe();
				} catch {
					// best-effort
				}
				if (currentUnsubscribe === unsubscribe) currentUnsubscribe = null;
				await scheduleRestart(1);
			})();
		});
		currentUnsubscribe = unsubscribe;
	};

	// Task 8 (re-arm on every restart) — subscribe ONCE to the AgentManager's
	// `agent-restarted` event. Whenever ANY path restarts this agentId (heartbeat
	// recycle, IPC, or this cron loop's own `restartAgent` call), re-arm the
	// exit listener on the FRESH handle so the cron-side restart authority always
	// tracks the live generation. Filtered by agentId (the manager hosts many).
	const onAgentRestarted = (evt: {
		agentId?: unknown;
		handleId?: unknown;
	}): void => {
		if (evt.agentId !== agentId || typeof evt.handleId !== "string") return;
		if (isShuttingDown()) return;
		const fresh = agentManager.getHandle(evt.handleId);
		if (fresh === undefined) return;
		// Task 8 (Important) — a fresh generation now exists (this restart, by ANY
		// actor: heartbeat recycle, IPC, or this cron loop's own restartAgent).
		// Cancel any cron-deferred restart still waiting out its backoff so it does
		// not recycle the healthy fresh generation. Harmless when WE are the actor
		// (no pending timer remains by the time our own restartAgent emits this).
		cancelPendingRestart();
		armExitListener(fresh);
	};
	agentManager.on("agent-restarted", onAgentRestarted);

	const scheduleRestart = async (attempt: number): Promise<void> => {
		if (isShuttingDown()) return;
		if (attempt > backoffMs.length) {
			await emit({
				kind: "cron-agent-restart-failed",
				agentId,
			});
			return;
		}
		// Task 8 (Important) — snapshot the generation BEFORE the backoff wait. If a
		// concurrent restart lands during the wait, `cancelPendingRestart` bumps the
		// generation (and resolves this wait) so we abort below instead of recycling
		// the now-fresh generation.
		const gen = restartGeneration;
		const delay = backoffMs[attempt - 1];
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				pendingRestart = null;
				resolve();
			}, delay);
			if (typeof timer.unref === "function") timer.unref();
			pendingRestart = { timer, resolve };
		});
		if (isShuttingDown()) return;
		// Task 8 (Important) — a concurrent restart (heartbeat recycle / IPC) landed
		// while we waited out the backoff; the agent is already a fresh generation.
		// Abort to avoid a spurious double-restart of a healthy generation.
		if (restartGeneration !== gen) return;
		try {
			// pr84 R2: on a PTY crash the AgentManager cascades child shutdown
			// but does NOT teardown the crashed handle itself — it lingers in
			// `handles`. A plain `registerAgent` would ADD a second handle for
			// the same agentId (same-org re-register is allowed), and
			// `findHandleForAgent` (insertion order) would keep resolving the
			// DEAD one — every post-restart dispatch silently no-ops while
			// telemetry falsely signals recovery. So when the dead handle is
			// still tracked, reuse `restartAgent`: it tears the dead handle
			// down and re-spawns under the SAME stable id (SpawnOpts.restoreId),
			// guaranteeing exactly ONE live handle per agentId. The env is
			// RE-COMPOSED here (envOverride) so the respawn picks up the current
			// NON-SECRET runtime descriptors (PATH/HOME/SHELL/LANG + the state-root
			// rendezvous dir) from the daemon's live `process.env` — under R1 the
			// agent holds NO secret, so this is a runtime-descriptor refresh, not a
			// secret refresh. Because the handle id is stable, no new
			// `<handleId>.json` accumulates (the twin orphan-config finding).
			const deadHandle = findHandleForAgent(agentManager, agentId);
			let handle: AgentHandle;
			if (deadHandle !== null) {
				// `restartAgent` emits `agent-restarted`, which re-arms the exit
				// listener via `onAgentRestarted` (the single re-arm authority) — so
				// this branch does NOT call `armExitListener` itself (that would
				// double-arm). Task 8.
				handle = await agentManager.restartAgent(deadHandle.id, "crash", {
					envOverride: composeAgentEnv(),
				});
			} else {
				// No tracked handle at all (e.g. it was already torn down). Fall
				// back to a fresh registration so the agent still recovers.
				// `registerAgent` does NOT emit `agent-restarted`, so arm the exit
				// listener explicitly below.
				handle = await agentManager.registerAgent({
					agentId,
					runtimeId: agentConfig.runtimeId,
					...(agentConfig.org !== undefined ? { org: agentConfig.org } : {}),
					cwd: agentConfig.cwd,
					env: composeAgentEnv(),
					sessionId: makeDaemonStartupSessionId(agentId),
				});
				armExitListener(handle);
			}
			await emit({
				kind: "cron-agent-restarted",
				agentId,
				attempt,
			});
		} catch (err) {
			console.error(
				`[daemon] cron-agent restart attempt ${attempt} for ${agentId} failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			await scheduleRestart(attempt + 1);
		}
	};

	try {
		const handle = await agentManager.registerAgent({
			agentId,
			runtimeId: agentConfig.runtimeId,
			...(agentConfig.org !== undefined ? { org: agentConfig.org } : {}),
			cwd: agentConfig.cwd,
			env: composeAgentEnv(),
			sessionId: makeDaemonStartupSessionId(agentId),
		});
		armExitListener(handle);
	} catch (err) {
		console.error(
			`[daemon] startup registerAgent(${agentId}) failed: ${err instanceof Error ? err.message : String(err)} — agent will be unrouted`,
		);
	}
	return () => {
		agentManager.off("agent-restarted", onAgentRestarted);
	};
}

/**
 * Plan 04b Task 3 — resolve the on-disk `runtime/agents/` directory
 * relative to this module's location.
 *
 * C1 fix (dual-review 2026-05-25): the original implementation used
 * `path.resolve(thisDir, "..", "agents")` which works in source-test
 * layouts (runtime/daemon/main.ts → runtime/agents/) but FAILS in
 * production (runtime/dist/daemon/main.js → runtime/dist/agents/ which
 * doesn't exist because `tsconfig.json` only compiles `daemon/`,
 * `agent-runtime/`, and `telegram/` — `agents/` is not in `include`
 * and is not copied to dist/).
 *
 * Strategy: walk UP from this module's directory looking for the first
 * ancestor containing an `agents/` subdirectory. Handles both layouts:
 *   - source: `runtime/daemon/` → walk to `runtime/` → find `runtime/agents/`
 *   - compiled: `runtime/dist/daemon/` → walk to `runtime/dist/` (no agents)
 *     → walk to `runtime/` → find `runtime/agents/`
 * Bounded at 4 levels to prevent runaway walks on unexpected layouts.
 * Falls back to the legacy 1-up path with a structured WARN if no
 * `agents/` directory is discovered — `loadCronEntries`'s ENOENT-on-root
 * branch (I2 fix) then surfaces the misconfiguration loudly.
 *
 * Exported so main.test.ts can override via the `IAGO_AGENTS_DIR` env var
 * (see startDaemon below) and assert the resolved path matches both the
 * compiled-out and source-test locations.
 */
export function resolveAgentsDir(): string {
	const override = process.env.IAGO_AGENTS_DIR;
	if (override !== undefined && override.length > 0) return override;
	const thisDir = path.dirname(fileURLToPath(import.meta.url));
	let candidate = path.resolve(thisDir, "..");
	for (let i = 0; i < 4; i++) {
		const agentsPath = path.join(candidate, "agents");
		try {
			const stat = fs.statSync(agentsPath);
			if (stat.isDirectory()) return agentsPath;
		} catch {
			// continue walking up
		}
		const parent = path.dirname(candidate);
		if (parent === candidate) break;
		candidate = parent;
	}
	console.error(
		`[daemon] resolveAgentsDir: no agents/ directory found within 4 levels of ${thisDir} — falling back to legacy 1-up path. Production deployment may be missing agents/.`,
	);
	return path.resolve(thisDir, "..", "agents");
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
 * handler checks `reloadPending` and runs ONE trailing reload per burst
 * within a single in-flight period (N SIGHUPs arriving during one reload
 * → exactly one trailing reload; a SIGHUP during the trailing reload itself
 * starts another burst, also resulting in one further iteration). Codex F3
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
	readonly loadCredentials: () =>
		| {
				read: readonly string[];
				failed: readonly string[];
		  }
		| undefined;
	/** Telemetry emit. No-throw via internal try/catch (telemetry.ts swallows write errors). */
	// Promise<unknown>: callers await emit and ignore the result, so this
	// accepts the real telemetry `emit` (Promise<boolean>) and Promise<void> mocks.
	readonly emit: (event: DaemonEvent) => Promise<unknown>;
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
							errorCode: (err as NodeJS.ErrnoException).code ?? err.constructor.name,
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
								errorCode: (err as NodeJS.ErrnoException).code ?? err.constructor.name,
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

	// pass#2 fix (state-root rendezvous): resolve the daemon's state root and
	// materialize it into process.env so EVERY consumer — including the cron-agent
	// env overlay (composeCronAgentEnv, which forwards IAGO_DAEMON_STATE_ROOT into
	// the agent's PTY) — sees the SAME absolute path. Without this, when the env
	// var is unset the daemon falls back to <cwd>/runtime/state or
	// ~/.iago-os/daemon-state while the agent keeps its hardcoded agent-config
	// default, so the agent's pr-triage-send__ envelope lands in a directory the
	// daemon never polls (notification silently lost until the dead-letter timer).
	process.env.IAGO_DAEMON_STATE_ROOT = getStateRoot();

	const config = overrideConfig ?? (await loadConfig());

	// Codex H1 + Opus C2 + Plan 04 fail-isolation: dynamically import every
	// built-in adapter module wrapped in `loadAdapterFailIsolated` so a single
	// broken adapter does NOT crash the daemon — the daemon logs the failure
	// to stderr, emits `runtime-registration-failed` telemetry, and continues
	// booting with the adapters that did register.
	for (const specifier of BUILT_IN_ADAPTER_MODULES) {
		await loadAdapterFailIsolated(specifier);
	}
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

	// Dual-adversarial I-C fix: hoist the `shuttingDown` flag declaration
	// above the cron pre-register loop so `registerCronAgentWithRestart`
	// (called from that loop) can observe shutdown and skip re-spawn
	// attempts when the daemon is tearing down. Assignment still happens
	// inside `shutdown`; readers below pick up the value through the
	// closure as before.
	let shuttingDown = false;

	// Plan 04b Task 3 — construct CronScheduler AFTER AgentManager (07b's
	// EventEmitter + claimTask are alive for the scheduler's constructor
	// terminal-event subscriptions) and BEFORE the auto-start loop (so the
	// decrement chain is ready when the first cron-fired task lands).
	// Defensive runtime guard: surface "07b not landed" at boot if
	// AgentManager's class shape lost startPollingLoop between compile and run.
	if (typeof agentManager.startPollingLoop !== "function") {
		throw new Error(
			"AgentManager.startPollingLoop not found — 07b not landed or class shape changed post-compile",
		);
	}
	// R1 (feature-pr84-r1-daemon-creds) — the daemon owns the GitHub fetch +
	// Telegram send. `prepareCronPrompt` runs the fetch + sanitize + payload
	// injection for pr-triage and gates the spawn on zero PRs (replacing the
	// retired bash wake-check). The daemon holds `GH_TOKEN` in its OWN
	// process.env (cred-bootstrap); the agent never sees it.
	const scheduler = new CronScheduler({
		agentManager,
		prepareCronPrompt: makePrTriageCronPrompt({
			getToken: () => process.env.GH_TOKEN,
		}),
		// Task 6 gate-finding #2 (hold-slot-until-result) — pr-triage is the only
		// send-contract agent: its `claimTask` emits `task-resolved` at prompt
		// HANDOFF (the prompt enters the persistent PTY), not at run completion.
		// Hold its concurrency slot until the result envelope is processed OR a
		// durable dead-letter timeout fires (both surface as `cron-result-complete`
		// from `makeResultTimers.onResultComplete`). Without this, a slow run lets
		// the next cron tick dispatch a second prompt that overwrites the single
		// dead-letter timer and emits a stale/duplicate envelope.
		deferReleaseAgents: new Set(["pr-triage"]),
	});
	const agentsDir = resolveAgentsDir();
	const cronEntries = await loadCronEntries(agentsDir);
	for (const opts of cronEntries) {
		try {
			scheduler.registerCron(opts);
		} catch (err) {
			console.error(
				`[daemon] registerCron(${opts.agentId}) failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	// Plan 04d Task 3 — pre-register every cron-driven agent so the
	// polling loop's `isAgentRegistered(agentId)` check returns true and
	// fired tasks route through dispatch rather than emitting
	// `task-unrouted`. Each agent's `agent-config.json` is loaded via
	// `loadAgentConfig`; failure to load is logged and skipped (degraded
	// state — the dispatch handler emits `pr-triage-dispatch-failed
	// { reason: "unregistered" }` when a cron-fire arrives for an agent
	// whose pre-registration failed, which is the same telemetry shape
	// operators already watch).
	//
	// SPAWN-AT-BOOT SEMANTICS (Plan 04d I-C dual-adversarial note):
	// `registerAgent` for cron agents spawns a real PTY at daemon
	// startup. The handle stays alive across many cron fires (persistent
	// PTY adapter — see `makeTaskDispatchHandler` JSDoc). If that PTY
	// exits before a cron-fire (credential expiry, crash,
	// heartbeat-driven recycle), `isAgentRegistered` would return false
	// and dispatch would emit `pr-triage-dispatch-failed { reason:
	// "unregistered" }` silently for every subsequent cron-fire until
	// the daemon was restarted. The re-register loop below
	// (`scheduleCronAgentRestart`) subscribes to the runtime's status
	// callback and re-runs `registerAgent` on exit/crash with
	// exponential backoff (3 attempts at 5s/30s/60s).
	const cronRestartCleanups: Array<() => void> = [];
	for (const opts of cronEntries) {
		let agentConfig: AgentConfigShape;
		try {
			agentConfig = await loadAgentConfig(agentsDir, opts.agentId);
		} catch (err) {
			console.error(
				`[daemon] loadAgentConfig(${opts.agentId}) failed: ${err instanceof Error ? err.message : String(err)} — agent will be unrouted; dispatch will emit pr-triage-dispatch-failed`,
			);
			continue;
		}
		cronRestartCleanups.push(
			await registerCronAgentWithRestart({
				agentManager,
				agentId: opts.agentId,
				agentConfig,
				isShuttingDown: () => shuttingDown,
			}),
		);
	}

	// R1 (feature-pr84-r1-daemon-creds, D4) + Task 6 — shared dead-letter timer
	// closures the dispatch handler (arm-on-dispatch) and the send handler
	// (clear-on-envelope) both use. A dispatched pr-triage PROMPT that produces
	// no result envelope within `RESULT_TIMEOUT_MS` surfaces as
	// `pr-triage-result-timeout` rather than a silently lost notification.
	const {
		startResultTimer,
		persistResultMarker,
		removeResultMarker,
		clearResultTimer,
		recoverResultTimers,
		isActiveRun,
	} = makeResultTimers({
		emit,
		// Task 6 gate-finding #2 (hold-slot-until-result) — when a pr-triage run
		// COMPLETES (envelope processed or durable dead-letter fires), emit the
		// run-completion event on the AgentManager so the CronScheduler releases
		// the cron concurrency slot it has been HOLDING since dispatch (the slot
		// is NOT released at `claimTask`/prompt-handoff for send-contract agents).
		// Carries the original cron task filename so the correct slot is released.
		onResultComplete: (agentId, filename) => {
			if (filename === null) return;
			agentManager.emit("cron-result-complete", { agentId, filename });
		},
		// Round-2 Minor (Codex) — re-hold the cron concurrency slot for an in-flight
		// run recovered from a still-future result-pending marker after a restart,
		// so a matching cron tick cannot dispatch a second prompt that overwrites the
		// single marker (duplicate/stale-run under non-daily cadences). Released
		// later via the onResultComplete chain above.
		onResultRecovered: (agentId, filename) => {
			if (filename === null) return;
			scheduler.restoreOutstanding(agentId, filename);
		},
	});
	// Task 6 (Critical) — recover dead-letter markers orphaned by a restart: a
	// dispatch in flight when the daemon went down left a durable
	// `result-pending/<agentId>.json` marker. Re-arm a still-future deadline or
	// immediately dead-letter an expired one, so the daily summary is never
	// silently dropped across a restart. Runs alongside bootRecovery /
	// recoverStrandedApprovals; awaited so recovery completes before the polling
	// loop starts.
	await recoverResultTimers();

	// Plan 04d Task 3 — subscribe the dispatch handler BEFORE
	// `startPollingLoop` (called below at the post-shutdown-guard step) so
	// the first tick already sees a listener. C2 stress fix: the
	// removeAllListeners('task-dispatch-needed') teardown must run BEFORE
	// `agentManager.stopPollingLoop()` so a tick that fires during
	// shutdown does not silently decrement via the listener-less
	// `claimTask` fallback path.
	const taskDispatchHandler = makeTaskDispatchHandler({
		agentManager,
		emit,
		startResultTimer,
		// Dual-adversarial #92 Critical (C1) — load-bearing pre-claim durable marker
		// write + the cleanup unlink for a claim-faulted dispatch.
		persistResultMarker,
		removeResultMarker,
	});
	const taskDispatchListener = (evt: TaskDispatchEvent): void => {
		void taskDispatchHandler(evt);
	};
	agentManager.on("task-dispatch-needed", taskDispatchListener);

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
			agentManager: buildBotAgentManagerAdapter(agentManager),
			injectIntoAgent: async (agentId, text) => {
				await injectIntoAgent(agentManager, agentId, text);
			},
		});
		await bot.start();
	}

	// R1 (feature-pr84-r1-daemon-creds, D2/D4) — subscribe the send handler
	// AFTER `bot` is constructed so it owns the live TelegramBot reference (may
	// be null in local-dev; `sendAgentNotification` guards that). The handler
	// sends the agent's text summary to Santiago itself and clears the
	// dead-letter timer when the result envelope arrives. Teardown removes this
	// listener alongside the dispatch listener in `shutdown`.
	const taskSendHandler = makeTaskSendHandler({
		agentManager,
		emit,
		telegramBot: bot,
		clearResultTimer,
		// Round-2 Important (Codex) — pre-send wrong-run guard: drop a stale-runId
		// envelope BEFORE the irreversible Telegram send instead of after.
		isActiveRun,
	});
	const taskSendListener = (evt: TaskSendEvent): void => {
		void taskSendHandler(evt);
	};
	agentManager.on("task-send-needed", taskSendListener);

	// `shuttingDown` is declared above (hoisted for the I-C cron-agent
	// restart loop). All assignments happen inside `shutdown`.
	const shutdownHandlers = new Set<() => void>();
	for (const cleanup of cronRestartCleanups) {
		shutdownHandlers.add(cleanup);
	}
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
		// Plan 04b Task 3 — stop scheduler + polling loop BEFORE heartbeat /
		// bot / IPC teardown. Order matters: scheduler.stop quiesces new
		// cron-fires so no fresh task files land in `tasks/pending/`; then
		// agentManager.stopPollingLoop drains the in-flight claim tick so no
		// fresh handle work spawns; then the existing per-stage teardowns
		// run. Reverse order would let an in-flight tick claim a task and
		// spawn an agent while we're already mid-handle-shutdown.
		await withTimeout(
			"scheduler.stop",
			async () => {
				try {
					await scheduler.stop();
				} catch (err) {
					console.error(
						`[daemon] scheduler.stop failed: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			},
			stageTimeoutMs,
		);
		// Dual-adversarial C-2 fix: REORDERED — stop the polling loop
		// FIRST so the in-flight tick drains (no fresh dispatch emits),
		// THEN remove the listener. The previous order (removeListener
		// BEFORE stopPollingLoop) created a window where an in-flight
		// tick observed zero listeners and used the now-removed
		// `claimTask` fallback path to silently advance the cron-fired
		// task to `resolved/` without dispatching it — a real data-loss
		// path on every deploy that coincided with a pending task.
		// Belt-and-suspenders pairing with the agent-manager C-2 fix
		// (which drops the listener-less fallback entirely and emits
		// `pr-triage-dispatch-failed { reason: "no-listener" }` if the
		// race ever does fire).
		await withTimeout(
			"agentManager.stopPollingLoop",
			async () => {
				try {
					await agentManager.stopPollingLoop();
				} catch (err) {
					console.error(
						`[daemon] agentManager.stopPollingLoop failed: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			},
			stageTimeoutMs,
		);
		try {
			agentManager.removeListener("task-dispatch-needed", taskDispatchListener);
		} catch (err) {
			console.error(
				`[daemon] removeListener(task-dispatch-needed) failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		// R1 (feature-pr84-r1-daemon-creds) — drop the send listener too so a
		// tick that fires during shutdown cannot route a send envelope into a
		// torn-down handler. Order is irrelevant relative to the dispatch
		// listener removal; both must run before the daemon exits.
		try {
			agentManager.removeListener("task-send-needed", taskSendListener);
		} catch (err) {
			console.error(
				`[daemon] removeListener(task-send-needed) failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
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

	// Plan 04b Task 3 — start the cron-scheduler interval + the AgentManager
	// polling loop AFTER the synchronous auto-start loop drains and AFTER
	// `heartbeat.start()`. EC1 carry-over: guard against `shuttingDown` so a
	// SIGINT arriving during the auto-start loop above does not leave new
	// background timers running. The polling interval is 5000ms — short
	// enough to give cron-fires a sub-tick reaction time, long enough to
	// avoid burning CPU on an idle daemon. Documented in Plan 04b Task 3.
	if (!shuttingDown) {
		scheduler.start();
		agentManager.startPollingLoop({ intervalMs: 5000 });
	}

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

/**
 * Build the `AgentManagerInterface` adapter the Telegram bot consumes.
 *
 * Extracted from the inline `new TelegramBot({ agentManager: {…} })` literal so
 * the COMPOSITION wiring — which manager methods the bot actually receives — is
 * a unit-testable surface. dual-adversarial #B: `getLastStatus`/`isAlive` were
 * present on the real `AgentManager` and consumed (optionally) by the bot's
 * `/status` renderer, but the inline literal forwarded neither, so the
 * `Last status:`/`Alive:` lines silently never rendered in production while the
 * mock-injected bot unit tests still passed. Forwarding them here (and pinning
 * the forward with `buildBotAgentManagerAdapter` tests) closes that gap.
 */
export function buildBotAgentManagerAdapter(
	agentManager: AgentManager,
): AgentManagerInterface {
	return {
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
		getLastStatus: (id) => agentManager.getLastStatus(id),
		isAlive: (id) => agentManager.isAlive(id),
	};
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
