/**
 * Command parser + per-shape gating for the Telegram control surface.
 *
 * Phase 1 command matrix:
 *
 *   | Command               | Available on shape  | Notes                       |
 *   |-----------------------|---------------------|-----------------------------|
 *   | /start <agent>        | all (placeholder)   | Phase 1 = pre-registered    |
 *   | /agents               | all                 | Lists all registered handles|
 *   | /approve_allow_<id>   | n/a (callback form) | Inline-keyboard callback    |
 *   | /approve_deny_<id>    | n/a (callback form) | Inline-keyboard callback    |
 *   | /approve <id> allow   | n/a                 | Text-form alternative       |
 *   | /abort <agent>        | all                 |                             |
 *   | /inject <agent> ...   | pty ONLY            | Shape 1 only — gated        |
 *   | /status <agent>       | all                 |                             |
 *
 * Phase 3+ adds `/send <agent> <message>` for non-PTY shapes. The
 * `isCommandAvailableForShape` gating logic is in place from Phase 1 so
 * that adding new shapes is a pure rules-table edit, not a routing
 * rewrite.
 *
 * Callback-form rename note (Plan 06 stress-test PR3): the cortextOS
 * upstream uses `appr_*` callback IDs. iaGO renames to `approve_allow_*`
 * / `approve_deny_*` for clarity and to match the text-form `/approve`
 * command. Bot code MUST emit the `approve_*` form on inline keyboards;
 * the legacy `appr_*` form is NOT accepted.
 */

import type { AgentShape } from "../agent-runtime/types.js";

export type Command =
	| { readonly name: "start"; readonly agent: string }
	| { readonly name: "agents" }
	| {
			readonly name: "approve";
			readonly approvalId: string;
			readonly decision: "allow" | "deny";
	  }
	| { readonly name: "abort"; readonly agent: string }
	| { readonly name: "inject"; readonly agent: string; readonly text: string }
	| { readonly name: "status"; readonly agent: string };

export type ParseResult =
	| { readonly ok: true; readonly command: Command }
	| { readonly ok: false; readonly error: string };

export type ShapeGateResult =
	| { readonly available: true }
	| { readonly available: false; readonly reason: string };

const APPROVE_CALLBACK_PREFIX_ALLOW = "/approve_allow_";
const APPROVE_CALLBACK_PREFIX_DENY = "/approve_deny_";

function tokenize(text: string): string[] {
	return text.trim().split(/\s+/);
}

export function parseCommand(text: string): ParseResult {
	if (typeof text !== "string" || text.length === 0) {
		return { ok: false, error: "empty command" };
	}
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return { ok: false, error: "empty command" };
	}

	// Inline-keyboard callback form for approvals: leading slash optional
	// because Telegram callback_data does not require it. Accept both.
	const callbackBody = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
	if (callbackBody.startsWith(APPROVE_CALLBACK_PREFIX_ALLOW)) {
		const id = callbackBody.slice(APPROVE_CALLBACK_PREFIX_ALLOW.length);
		if (id.length === 0) {
			return { ok: false, error: "missing argument: approvalId" };
		}
		return { ok: true, command: { name: "approve", approvalId: id, decision: "allow" } };
	}
	if (callbackBody.startsWith(APPROVE_CALLBACK_PREFIX_DENY)) {
		const id = callbackBody.slice(APPROVE_CALLBACK_PREFIX_DENY.length);
		if (id.length === 0) {
			return { ok: false, error: "missing argument: approvalId" };
		}
		return { ok: true, command: { name: "approve", approvalId: id, decision: "deny" } };
	}

	if (!trimmed.startsWith("/")) {
		return { ok: false, error: "unknown command: <not a command>" };
	}

	const tokens = tokenize(trimmed);
	const head = tokens[0];
	if (head === undefined) {
		return { ok: false, error: "empty command" };
	}
	const cmd = head.slice(1);

	switch (cmd) {
		case "start": {
			const agent = tokens[1];
			if (agent === undefined) {
				return { ok: false, error: "missing argument: agent" };
			}
			return { ok: true, command: { name: "start", agent } };
		}
		case "agents": {
			return { ok: true, command: { name: "agents" } };
		}
		case "approve": {
			const id = tokens[1];
			const decision = tokens[2];
			if (id === undefined) {
				return { ok: false, error: "missing argument: approvalId" };
			}
			if (decision === undefined) {
				return { ok: false, error: "missing argument: decision" };
			}
			if (decision !== "allow" && decision !== "deny") {
				return { ok: false, error: `invalid decision: ${decision}` };
			}
			return {
				ok: true,
				command: { name: "approve", approvalId: id, decision },
			};
		}
		case "abort": {
			const agent = tokens[1];
			if (agent === undefined) {
				return { ok: false, error: "missing argument: agent" };
			}
			return { ok: true, command: { name: "abort", agent } };
		}
		case "inject": {
			const agent = tokens[1];
			if (agent === undefined) {
				return { ok: false, error: "missing argument: agent" };
			}
			if (tokens.length < 3) {
				return { ok: false, error: "missing argument: text" };
			}
			const text = tokens.slice(2).join(" ");
			return { ok: true, command: { name: "inject", agent, text } };
		}
		case "status": {
			const agent = tokens[1];
			if (agent === undefined) {
				return { ok: false, error: "missing argument: agent" };
			}
			return { ok: true, command: { name: "status", agent } };
		}
		default: {
			return { ok: false, error: `unknown command: ${head}` };
		}
	}
}

/**
 * Per-shape command gating.
 *
 * `getShape` resolves the registered shape for the given `agentId`,
 * returning `null` when the agent is not registered. Commands that name
 * an agent (`start`, `abort`, `inject`, `status`) require a registered
 * shape; the `/agents` and `/approve` commands are global.
 *
 * Phase 1 — only `pty` is registered, but `/inject` is gated to that
 * shape so Phase 3+ adapters (HTTP, MCP, event, daemon) require the
 * forthcoming `/send` command instead.
 */
export async function isCommandAvailableForShape(
	command: Command,
	getShape: (agent: string) => Promise<AgentShape | null>,
): Promise<ShapeGateResult> {
	switch (command.name) {
		case "agents":
		case "approve":
			return { available: true };
		case "start":
		case "abort":
		case "status": {
			const shape = await getShape(command.agent);
			if (shape === null) {
				return {
					available: false,
					reason: `agent not registered: ${command.agent}`,
				};
			}
			return { available: true };
		}
		case "inject": {
			const shape = await getShape(command.agent);
			if (shape === null) {
				return {
					available: false,
					reason: `agent not registered: ${command.agent}`,
				};
			}
			if (shape !== "pty") {
				return {
					available: false,
					reason: `/inject is only available for shape "pty" (agent ${command.agent} is shape "${shape}")`,
				};
			}
			return { available: true };
		}
	}
}
