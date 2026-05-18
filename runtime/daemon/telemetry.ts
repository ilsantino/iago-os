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
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";

import { pathFor } from "./state-paths.js";

export type DaemonEvent =
	| {
			readonly kind: "daemon-start";
			readonly pid: number;
			readonly nodeVersion: string;
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
			readonly reason: "wake-check-failed" | "wake-check-timeout";
			readonly exitCode: number | null;
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
	  };

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

export async function emit(
	event: DaemonEvent,
	extra?: Record<string, unknown>,
): Promise<void> {
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
	} catch (err) {
		console.error("[telemetry] write failed:", err);
	}
}

/**
 * Test-only helper: reset the module-scope "warned once" flag so multiple
 * tests in the same Vitest process can re-assert the warning fires.
 */
export function __resetTelemetryWarningFlagForTests(): void {
	missingSessionIdWarned = false;
}
