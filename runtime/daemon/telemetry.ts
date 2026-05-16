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
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";

import { pathFor } from "./state-paths.js";

export type DaemonEvent =
	| { readonly kind: "daemon-start"; readonly pid: number; readonly nodeVersion: string }
	| { readonly kind: "daemon-stop"; readonly pid: number; readonly reason?: string }
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
			"[telemetry] CLAUDE_CODE_SESSION_ID is unset; using \"no-session-id\" sentinel.",
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
