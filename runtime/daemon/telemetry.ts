/**
 * Telemetry — NDJSON event emitter keyed on `CLAUDE_CODE_SESSION_ID`.
 *
 * Plan 05 contract notes (binding for callers and future maintainers):
 *
 * - **One file per UTC date** under `pathFor("telemetry")/<yyyy-mm-dd>.ndjson`.
 *   Midnight rollover happens implicitly because every `emit()` resolves the
 *   target file via `Date.now()`. Known edge case (M2): an emit that begins
 *   just before midnight and resolves just after will land in the new file
 *   — acceptable for Phase 1.
 * - **Session correlation key:** every line includes
 *   `sessionId: process.env.CLAUDE_CODE_SESSION_ID || "no-session-id"`.
 *   We use `||` not `??` so an empty-string env var is also treated as
 *   missing (stress-test MC2). When missing, a stderr warning fires
 *   exactly once per daemon process (module-scope boolean flag).
 * - **No throws on write failure.** Telemetry MUST NOT break the daemon —
 *   `appendFile` rejections log to stderr and resolve normally.
 * - **Lazy mkdir.** `emit()` ensures the telemetry directory exists before
 *   the first append. Idempotent across concurrent calls (stress-test MC1).
 *
 * Canonical event kinds (9 + heartbeat = 10 lifecycle hooks):
 *   daemon-start, daemon-stop, agent-registered, agent-spawned,
 *   task-claimed, approval-requested, approval-resolved, agent-exited,
 *   agent-restarted, heartbeat.
 *
 * Plan feature-phase-1-deferred-hardening/02 added:
 *   `atomic-rename-stale-dest-window` — emitted from
 *   `state-paths.ts::atomicRenameStaleDest` on the Windows
 *   `EEXIST`/`EPERM` unlink-then-rename recovery path. Fields:
 *     - `dst` (basename only — full path elided to avoid leaking
 *       state-root layout)
 *     - `windowMs` (number of ms between unlink and the second rename)
 *     - `platform` ("win32")
 *   Cost is bounded — fires only on Windows when EEXIST/EPERM recovers
 *   a stale dest. Phase 7 will use the collected window data to decide
 *   whether to harden the Windows path to a strictly-atomic primitive.
 *
 * Plan feature-phase-1-deferred-hardening/04 added:
 *   `runtime-registration-failed` — emitted from `daemon/main.ts` when an
 *   adapter side-effect import throws at the import boundary. Fields:
 *     - `adapterModule` (the module specifier that failed to load — e.g.,
 *       `"../agent-runtime/pty/claude-pty.js"`)
 *     - `message` (Error.message; non-Error values get `String(value)`)
 *     - `stackTrace` (first 3 lines of the stack — truncated to avoid
 *       blowing up the NDJSON line and to keep PII surface low)
 *   Fail-isolated: the daemon continues with the remaining registered
 *   runtimes. Operators monitor this event to triage adapter regressions
 *   without scraping stderr.
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";

import { pathFor } from "./state-paths.js";

export type DaemonEvent =
	| {
			readonly kind: "daemon-start";
			readonly pid: number;
			readonly nodeVersion: string;
			/**
			 * Plan 01b Task 4 (C1 carry-over): identifies the runtime
			 * context the daemon booted under so Phase 2 telemetry
			 * consumers can filter systemd-on-VPS vs local-dev vs unit-test
			 * runs cleanly. Detection order: `NODE_ENV=test` → `"test"`
			 * (preserves Phase 1 test semantics); else
			 * `CREDENTIALS_DIRECTORY` non-empty OR `INVOCATION_ID` set
			 * (systemd auto-sets `INVOCATION_ID`) → `"systemd"`; else
			 * `"local"`.
			 */
			readonly runUnder: "systemd" | "local" | "test";
	  }
	| {
			readonly kind: "daemon-stop";
			readonly pid: number;
			readonly reason?: string;
	  }
	| {
			readonly kind: "agent-registered";
			readonly agentId: string;
			readonly runtimeId: string;
			readonly org?: string;
	  }
	| {
			readonly kind: "agent-spawned";
			readonly handleId: string;
			readonly agentId: string;
			readonly sessionId: string;
			readonly runtimeId: string;
			readonly generationToken: number;
	  }
	| {
			readonly kind: "task-claimed";
			readonly taskId: string;
			readonly ownerId: string;
			readonly attemptId: string;
	  }
	| {
			readonly kind: "approval-requested";
			readonly approvalId: string;
			readonly agentId: string;
			readonly reason: string;
	  }
	| {
			readonly kind: "approval-resolved";
			readonly approvalId: string;
			readonly decision: "allow" | "deny";
			readonly resolvedBy: string;
	  }
	| {
			readonly kind: "agent-exited";
			readonly handleId: string;
			readonly reason: "graceful" | "crash" | "recycle";
			readonly exitCode?: number;
	  }
	| {
			readonly kind: "agent-restarted";
			readonly handleId: string;
			readonly reason: "stalled" | "rss-exceeded" | "crash";
			readonly generationToken: number;
	  }
	| {
			readonly kind: "heartbeat";
			readonly handleId: string;
			readonly alive: boolean;
			readonly rssBytes?: number;
	  }
	| {
			readonly kind: "atomic-rename-stale-dest-window";
			readonly dst: string;
			readonly windowMs: number;
			readonly platform: "win32";
	  }
	| {
			/**
			 * Emitted when CLAIM's `link(2)` returns EPERM AND no winning
			 * resolver state exists on disk. On Linux with
			 * `fs.protected_hardlinks=1` (kernel default on modern distros),
			 * `link(2)` returns EPERM when the caller cannot hard-link the
			 * source — a permission/configuration problem, not a lost race.
			 * Surfacing this as telemetry distinguishes the two: a healthy
			 * loss-of-race resolves elsewhere within milliseconds; a true
			 * EPERM-no-winner means every approval for this approvalId will
			 * silently report `not-found` until the misconfig is fixed.
			 * Opus dual-review I2 of PR #50.
			 */
			readonly kind: "approval-claim-link-eperm";
			readonly approvalIdHash: string;
	  }
	| {
			/**
			 * Plan 01b Task 4 (spec § 10 criterion #5): emitted by
			 * `startDaemon()` immediately after `loadSystemdCredentials()`
			 * returns. `credentialsLoaded` carries the credstore FILE NAMES
			 * (e.g., `["iago-telegram-token"]`) that wrote to env on this
			 * call — NEVER the values. Computed by diffing env-var
			 * keys-of-interest before vs after the call so the rule
			 * "credstore wins only when env is unset" stays
			 * locally testable.
			 */
			readonly kind: "cred-bootstrap-loaded";
			readonly credentialsLoaded: string[];
	  }
	| {
			/**
			 * Plan 06 (SIGHUP credential reload): emitted by the SIGHUP
			 * handler after `loadSystemdCredentials()` re-reads the
			 * credstore files. `credentialsReloaded` carries env-var NAMES
			 * whose value changed across the reload; `unchanged` carries
			 * env-var NAMES that were re-read but kept the same value;
			 * `errors` carries env-var NAMES that failed to read.
			 * NEVER carries credential values (matches Plan 01 Task 4 C2
			 * posture). Operators consume via `journalctl ... | grep
			 * cred-reload-fired` to confirm a credential rotation took
			 * effect without a daemon restart.
			 *
			 * SCHEMA NOTE (F16): the three string arrays here carry
			 * ENV-VAR NAMES (e.g., `IAGO_TELEGRAM_BOT_TOKEN`). The
			 * companion `cred-bootstrap-loaded` event above carries
			 * credstore FILE NAMES (e.g., `iago-telegram-token`). The
			 * two axes are deliberately different — bootstrap telemetry
			 * documents which on-disk file wrote to env; reload telemetry
			 * documents which env-var consumers should pick up. Use
			 * `envVarToFileName()` in `cred-bootstrap.ts` to map between
			 * them when correlating events.
			 */
			readonly kind: "cred-reload-fired";
			readonly credentialsReloaded: string[];
			readonly unchanged: string[];
			readonly errors: string[];
	  }
	| {
			/**
			 * Plan 06 (SIGHUP credential reload): emitted when
			 * `loadSystemdCredentials()` itself threw (e.g., a credstore
			 * file became unreadable mid-rotation). The daemon continues
			 * running with the old credentials in memory — SIGHUP is
			 * informational and a failed reload is safer than killing
			 * the daemon.
			 *
			 * F1 (telemetry value-leak prohibition): `errorCode` carries
			 * a typed error code (Node ErrnoException `code` like
			 * `"ENOENT"` / `"EACCES"`, or the error constructor name
			 * like `"TypeError"`, or `"unknown"` for non-Error throws).
			 * The previous `error: string` field carried `err.message`,
			 * which a future thrower in the credstore-read path could
			 * use to surface bytes adjacent to the credential value via
			 * a parse-error position context. SECURITY: do not include
			 * value bytes — only typed codes.
			 */
			readonly kind: "cred-reload-failed";
			readonly errorCode: string;
	  }
	| {
			/**
			 * Plan 06 (SIGHUP credential reload): emitted when a second
			 * SIGHUP arrives while a prior reload is still in flight.
			 * The handler sets a `reloadPending` flag and runs ONE
			 * trailing reload after the current one finishes (only one,
			 * regardless of how many SIGHUPs piled up during the
			 * window).
			 *
			 * PR #74 dual-review F3: the prior "drop on conflict"
			 * semantics would lose a rotation if the credstore changed
			 * during the await window of the prior reload. The coalesce
			 * variant preserves the "latest rotation is visible"
			 * invariant while retaining the Phase 2 "no queue"
			 * simplicity.
			 */
			readonly kind: "cred-reload-coalesced";
	  }
	| {
			/**
			 * Plan 07a (CronScheduler): a registered cron expression matched
			 * the current tick, wake-check (if any) passed, and the task
			 * file was written to `tasks/pending/`. `runningCount` is the
			 * value AFTER increment for this fire.
			 */
			readonly kind: "cron-fired";
			readonly agentId: string;
			readonly schedule: string;
			readonly taskFile: string;
			readonly runningCount: number;
	  }
	| {
			/**
			 * Plan 07a (CronScheduler): a cron-tick matched but was skipped
			 * because the optional `wakeCheck` script returned non-zero or
			 * was SIGKILL'd after the 30s `spawnSync` timeout. `exitCode`
			 * is null when the script was timeout-killed (signal: SIGKILL).
			 */
			readonly kind: "cron-skipped";
			readonly agentId: string;
			readonly schedule: string;
			/**
			 * `wake-check-*` are the legacy bash-gate reasons. R1
			 * (feature-pr84-r1-daemon-creds) adds the daemon-side
			 * `prepareCronPrompt` gate reasons: `no-open-prs` (zero open PRs →
			 * no spawn, REPLACES the wake-check exit-1 gate), `pr-fetch-failed`
			 * (the daemon GitHub fetch threw → do NOT spawn with stale/no data),
			 * and `prepare-skip` (a generic hook skip with no specific reason).
			 */
			readonly reason:
				| "wake-check-failed"
				| "wake-check-timeout"
				| "no-open-prs"
				| "pr-fetch-failed"
				| "prepare-skip";
			readonly exitCode: number | null;
	  }
	| {
			/**
			 * Plan 04b (loadCronEntries): a crons.json entry had
			 * `schedule: null` (intentionally muted). The agent is visible in
			 * the agents directory but its cron is not registered. Emitted so
			 * operators watching the NDJSON stream can see which agents are
			 * silenced without grepping for absence of cron-fired events.
			 */
			readonly kind: "cron-skipped-null";
			readonly agentId: string;
	  }
	| {
			/**
			 * Plan 07a (CronScheduler): a cron-tick matched but was skipped
			 * because the agent's in-flight task count
			 * (`runningCount.get(agentId)`) already equals `maxConcurrent`.
			 * Carries the production-breaking-overlap fix (Codex P1-8).
			 */
			readonly kind: "cron-overlap-prevented";
			readonly agentId: string;
			readonly schedule: string;
			readonly runningCount: number;
			readonly maxConcurrent: number;
	  }
	| {
			/**
			 * Plan 07a (CronScheduler): the prompt-template file referenced
			 * by `registerCron({ promptTemplatePath })` could not be read
			 * (ENOENT, EACCES, etc.). The cron-fire is aborted — no task
			 * file is written and `runningCount` is NOT incremented.
			 */
			readonly kind: "cron-fired-prompt-missing";
			readonly agentId: string;
			readonly schedule: string;
			readonly promptTemplatePath: string;
			readonly errno: string;
	  }
	| {
			/**
			 * Plan 07a (CronScheduler): writing the task file into
			 * `tasks/pending/` failed (ENOSPC, EACCES, EBUSY on tmp-rename,
			 * etc.). The cron-fire is aborted — `runningCount` is NOT
			 * incremented.
			 */
			readonly kind: "cron-fired-write-failed";
			readonly agentId: string;
			readonly schedule: string;
			readonly taskFile: string;
			readonly errno: string;
	  }
	| {
			/**
			 * Plan 07b (AgentManager polling loop): `claimTask` successfully
			 * moved a task file from `tasks/pending/` to `tasks/resolved/`.
			 * Mirrors the EventEmitter `'task-resolved'` event the
			 * CronScheduler subscribes to — closes the decrement chain so
			 * cron `runningCount` releases its slot.
			 */
			readonly kind: "task-resolved";
			readonly agentId: string;
			readonly filename: string;
	  }
	| {
			/**
			 * Plan 07b (AgentManager polling loop): a pending task file was
			 * unreadable JSON. The file was moved to `tasks/poisoned/` so
			 * the polling loop does not re-trip on it. The matching
			 * EventEmitter `'task-poisoned'` event releases the cron
			 * concurrency slot (if any) via the CronScheduler listener.
			 */
			readonly kind: "task-poisoned";
			readonly filename: string;
			readonly reason: "json-parse-error" | "missing-agent-id" | "oversized-task";
			readonly errno?: string;
	  }
	| {
			/**
			 * Plan 04d (pr-triage dispatch handler): the dispatch handler
			 * subscribed to `task-dispatch-needed` failed to execute the
			 * task. The task file is LEFT in `tasks/pending/` so the next
			 * polling tick retries; `claimTask` is NOT called, so the cron
			 * `runningCount` stays elevated until a retry succeeds or
			 * `cron-overlap-prevented` surfaces the stall to the operator.
			 *
			 * Reasons currently emitted by `makeTaskDispatchHandler` and
			 * `AgentManager.processPendingTask`:
			 *   - `unregistered`: no live `AgentHandle` resolved at
			 *     dispatch time (pre-registration failed or was
			 *     deregistered).
			 *   - `send-failed`: `runtime.send(handle, promptMessage)`
			 *     threw (PTY closed, stdin write error, etc.).
			 *   - `listener-exception`: any other unexpected throw caught
			 *     by the outermost try/catch (e.g., runtime resolution
			 *     miss, `claimTask` failure).
			 *   - `malformed-task`: task body lacked a non-empty string
			 *     `prompt` field. File is LEFT in `tasks/pending/` for
			 *     human inspection; `runtime.send` and `claimTask` are NOT
			 *     called so cron `runningCount` stays elevated and the
			 *     operator sees `cron-overlap-prevented` if the bad task
			 *     persists.
			 *   - `no-listener`: `processPendingTask` saw an empty
			 *     listener set on `'task-dispatch-needed'`. The previous
			 *     behavior was to fall through to `claimTask`, silently
			 *     advancing the file to `resolved/` without dispatch —
			 *     the C-2 data-loss path during shutdown. File stays in
			 *     `tasks/pending/` so a re-registered listener picks it
			 *     up on the next tick.
			 *
			 * NOTE on `exit-*` / `spawn-failed` (Plan 04d review #2):
			 * earlier drafts of the plan included an "await clean exit"
			 * step which would have emitted `spawn-failed`, `exit-nonzero`,
			 * and `exit-timeout`. The Shape 1 PTY runtime is persistent
			 * (registered once at daemon startup, never per-task respawned)
			 * so those reasons have no live code path and would be dead
			 * union members. They are intentionally omitted from this
			 * union until a runtime adapter ships a per-task completion
			 * signal. See `makeTaskDispatchHandler` JSDoc for the full
			 * persistent-PTY claim-on-send rationale.
			 */
			readonly kind: "pr-triage-dispatch-failed";
			readonly agentId: string;
			readonly filename: string;
			readonly reason:
				| "send-failed"
				| "listener-exception"
				| "unregistered"
				| "malformed-task"
				| "no-listener";
			readonly message: string;
	  }
	| {
			/**
			 * Plan pr84-gap-closure (Codex H1) — the pr-triage agent's bash
			 * failed to deliver a Telegram alert and wrote an `ndjsonAlert`
			 * fallback envelope instead of a `prompt` task. The daemon
			 * records-and-resolves it: no live handle is needed, the file
			 * moves pending→resolved, and this event carries the audit trail.
			 *
			 * `alertKind` is the verbatim `ndjsonAlert` value from the
			 * envelope — it disambiguates the two historical producer shapes
			 * (the telegram-send-failed alert and the `pr-triage-double-failure`
			 * alert) plus any future alert kind. (RETIRED under R1: the agent no
			 * longer emits `ndjsonAlert`; the daemon now emits
			 * `pr-triage-telegram-send-failed` directly from makeTaskSendHandler.)
			 * without multiplying union members. `details` is the verbatim
			 * `details` string from the envelope, already token-redacted by
			 * the agent (it captures `$HTTP_STATUS` + a redacted response
			 * body, NOT the curl process exit) — so there are deliberately
			 * no `curlExitCode`/`telegramResponseBody` fields here.
			 */
			readonly kind: "pr-triage-telegram-send-failed";
			readonly agentId: string;
			readonly filename: string;
			readonly alertKind: string;
			readonly details: string;
	  }
	| {
			/**
			 * R1 (feature-pr84-r1-daemon-creds, D4) — the pr-triage agent
			 * computed an EMPTY summary and wrote a `{ noSend: true }` envelope
			 * (or the daemon resolved a no-send result). This distinguishes
			 * "nothing to send" from "agent died without writing an envelope"
			 * (which surfaces as `pr-triage-result-timeout`). The send handler
			 * claims the envelope file after recording this event.
			 */
			readonly kind: "pr-triage-no-send";
			readonly agentId: string;
			readonly filename: string;
	  }
	| {
			/**
			 * R1 (feature-pr84-r1-daemon-creds, D4 — dead-letter) — a dispatched
			 * pr-triage PROMPT did not produce a result envelope
			 * (`pr-triage-send__*.json`) before the result-timeout deadline. The
			 * agent likely crashed mid-run; surface it as telemetry rather than a
			 * silent lost notification. KNOWN LIMIT: the timer does not survive a
			 * daemon restart (the next cron fire recovers; full durability is
			 * deferred #5).
			 */
			readonly kind: "pr-triage-result-timeout";
			readonly agentId: string;
			readonly reason: string;
	  }
	| {
			/**
			 * Round-2 Important (Codex) — a late/stale result envelope arrived
			 * carrying a runId that does NOT match the active run for the agent
			 * (a prior dispatch's envelope surfacing after a newer run started,
			 * or a duplicate emit after a restart). The send handler validates
			 * the runId BEFORE the irreversible Telegram send and QUARANTINES the
			 * stale envelope (claims it out of `pending/`) instead of pushing a
			 * wrong/stale summary to the user. The current run's dead-letter
			 * timer/marker/held slot are left intact. `runId` is the stale id from
			 * the envelope (token-free correlation id, safe to log).
			 */
			readonly kind: "pr-triage-stale-run-dropped";
			readonly agentId: string;
			readonly filename: string;
			readonly runId: string;
	  }
	| {
			/**
			 * Plan 04d dual-adversarial I-C fix: a cron-driven agent that
			 * was pre-registered at daemon startup exited (PTY crash,
			 * credential expiry, heartbeat-driven recycle). Re-registration
			 * succeeded after `attempt` tries (1-indexed). Without the
			 * re-register loop the agent would silently become unrouted
			 * and `pr-triage-dispatch-failed { reason: "unregistered" }`
			 * would fire on every cron tick until manual operator
			 * intervention.
			 */
			readonly kind: "cron-agent-restarted";
			readonly agentId: string;
			readonly attempt: number;
	  }
	| {
			/**
			 * Plan 04d dual-adversarial I-C fix: the re-register loop
			 * exhausted its 3-attempt budget for a cron-driven agent that
			 * exited after boot pre-registration. The agent stays
			 * unrouted; future cron-fires will emit
			 * `pr-triage-dispatch-failed { reason: "unregistered" }` until
			 * the daemon is restarted or a manual `registerAgent` call
			 * fires.
			 */
			readonly kind: "cron-agent-restart-failed";
			readonly agentId: string;
	  }
	| {
			/**
			 * Plan 07b (AgentManager polling loop): a pending task references
			 * an `agentId` that is not registered with the manager. The
			 * file stays in pending (a later registration may pick it up).
			 * Emitted once per (filename) until `stopPollingLoop()` clears
			 * the suppression set; the matching EventEmitter
			 * `'task-unrouted'` event releases the cron concurrency slot
			 * (if any) so a cron-fired-then-deregistered agent does not
			 * leak its slot forever.
			 */
			readonly kind: "task-unrouted";
			readonly filename: string;
			readonly agentId: string;
	  }
	| {
			/**
			 * Plan 07b (AgentManager polling loop): the suppression set for
			 * repeated `task-unrouted` events hit the 1000-entry cap. From
			 * this point until `stopPollingLoop()`, every unrouted file
			 * emits `task-unrouted` again on each tick. Fires exactly once
			 * per polling-loop lifetime (C2 stress-test mitigation).
			 */
			readonly kind: "task-unrouted-set-overflow";
			readonly cap: number;
	  }
	| {
			/**
			 * Plan 07b (AgentManager polling loop): the tick body threw an
			 * uncaught exception. The interval continues; the next tick
			 * starts fresh. Surfacing this lets operators see polling-loop
			 * health without scraping the daemon log.
			 */
			readonly kind: "polling-loop-error";
			readonly errno?: string;
			readonly message: string;
	  }
	| {
			/**
			 * Plan 07b (AgentManager polling loop): `claimTask`'s
			 * `fs.rename` failed (ENOSPC, EACCES, EBUSY, etc.). The task
			 * file is left in `tasks/pending/` so the next tick retries.
			 * `'task-resolved'` is NOT emitted, so the cron `runningCount`
			 * stays elevated — sustained failures eventually exhaust the
			 * overlap budget and surface as `cron-overlap-prevented`
			 * (intentional; the operator should be looking at this event
			 * first).
			 */
			readonly kind: "claim-task-failed";
			readonly agentId: string;
			readonly filename: string;
			readonly errno?: string;
			readonly message: string;
	  }
	| {
			readonly kind: "runtime-registration-failed";
			readonly adapterModule: string;
			readonly message: string;
			readonly stackTrace: string;
	  }
	| {
			/**
			 * Emitted by `AgentManager.attemptCrashReplay` when boot recovery
			 * cannot resolve the runtime a persisted/known config references —
			 * the runtime was never registered (the common case after a prior
			 * run left persisted configs AND the built-in adapter failed to
			 * load; `loadAdapterFailIsolated` only warns, it does not register
			 * the adapter). The handle is skipped from replay and the rest of
			 * the recovery set continues — the daemon boots degraded with
			 * telemetry rather than crashing on boot. Fields:
			 *   - `handleId` (the persisted handle that could not be replayed)
			 *   - `runtimeId` (the runtime id that was not registered)
			 *   - `reason` (currently only `"runtime-not-registered"`)
			 */
			readonly kind: "recovery-skipped";
			readonly handleId: string;
			readonly runtimeId: string;
			readonly reason: "runtime-not-registered";
	  };

/**
 * pr84-gap-closure (Codex H1 follow-up) — the daemon-owned set of recognized
 * `ndjsonAlert` kinds the `pr-triage` agent may emit. An alert envelope is a
 * record-and-resolve signal that bypasses the dispatch path; treating ANY
 * non-empty `ndjsonAlert` string as a terminal alert was an un-scoped dispatch
 * bypass — `tasks/pending/` is the GENERIC bus shared by all agents, so a
 * malformed or adversarial task for another (or unregistered) agent could skip
 * runtime execution and still get silently resolved.
 *
 * Both `AgentManager.processPendingTask` (agent-manager.ts) and
 * `makeTaskDispatchHandler` (main.ts) gate the alert branch on membership in
 * THIS set (plus `agentId === "pr-triage"` and no `prompt` field), so the
 * branch is daemon-owned, not self-declared by the task envelope. Any other
 * shape falls through to the existing registration/dispatch/poison handling.
 *
 * Defined here (not in main.ts) so both consumers import it from the module
 * they already depend on — avoids a circular import between agent-manager.ts
 * and main.ts. Values mirror the two HISTORICAL producer shapes. (RETIRED under
 * R1: the pr-triage agent no longer emits `ndjsonAlert`; the daemon owns
 * send-failure telemetry. The set is kept for the inert defensive branch.)
 */
export const PR_TRIAGE_ALERT_KINDS: ReadonlySet<string> = new Set([
	"pr-triage-telegram-send-failed",
	"pr-triage-double-failure",
]);

let missingSessionIdWarned = false;

function formatDate(date: Date): string {
	const yyyy = date.getUTCFullYear().toString().padStart(4, "0");
	const mm = (date.getUTCMonth() + 1).toString().padStart(2, "0");
	const dd = date.getUTCDate().toString().padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

export function getTelemetryPath(date?: Date): string {
	const d = date ?? new Date();
	return path.join(pathFor("telemetry"), `${formatDate(d)}.ndjson`);
}

function resolveSessionId(): string {
	const raw = process.env.CLAUDE_CODE_SESSION_ID;
	if (raw && raw.length > 0) {
		return raw;
	}
	if (!missingSessionIdWarned) {
		missingSessionIdWarned = true;
		console.error(
			'[telemetry] CLAUDE_CODE_SESSION_ID is unset; using "no-session-id" sentinel.',
		);
	}
	return "no-session-id";
}

/**
 * Append a telemetry event to the daily NDJSON file.
 *
 * Returns `true` if the line durably landed on disk, `false` if the append
 * failed (the error is logged, never thrown — fire-and-forget callers can
 * keep ignoring the result). The boolean exists for the rare caller that
 * must NOT take an irreversible action unless the event was durably
 * recorded: the pr-triage ndjsonAlert path (agent-manager `processPendingTask`)
 * uses it to avoid resolving a fallback-alert task out of `pending/` when its
 * `pr-triage-telegram-send-failed` record could not be written — otherwise a
 * degraded telemetry dir (ENOSPC/EACCES) would silently swallow the
 * double-failure signal AND stop the task from retrying (Codex Medium).
 */
export async function emit(
	event: DaemonEvent,
	extra?: Record<string, unknown>,
): Promise<boolean> {
	const filePath = getTelemetryPath();
	const sessionId = resolveSessionId();
	const line = {
		at: new Date().toISOString(),
		sessionId,
		pid: process.pid,
		...event,
		...(extra ?? {}),
	};
	const serialized = `${JSON.stringify(line)}\n`;
	try {
		await fsp.mkdir(path.dirname(filePath), { recursive: true });
		await fsp.appendFile(filePath, serialized, "utf8");
		return true;
	} catch (err) {
		console.error("[telemetry] write failed:", err);
		return false;
	}
}

/**
 * Test-only helper: reset the module-scope "warned once" flag so multiple
 * tests in the same Vitest process can re-assert the warning fires.
 */
export function __resetTelemetryWarningFlagForTests(): void {
	missingSessionIdWarned = false;
}
