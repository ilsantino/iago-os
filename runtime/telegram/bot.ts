/**
 * TelegramBot — single-bot routing layer for the v2 daemon.
 *
 * Per Plan 06 stress-test PR1 (LOCKED 2026-05-15): one bot routes
 * messages to N agents via per-agent file-bus task tagging.
 * Filename form: `${agentId}__${crypto.randomUUID()}.json`. Agents
 * discover their own tasks by `fs.readdir` + `name.startsWith(agentId
 * + "__")` filter; the file-bus itself is agentId-agnostic and treats
 * the full filename minus `.json` as the opaque taskId.
 *
 * Approval handshake (Plan 06 stress-test 2nd-pass): the bot does NOT
 * push approvals via `runtime.send({ kind: "approval", ... })`. The
 * `approval` kind on `AgentRuntime.send()` is a RESERVED future
 * channel. The active path is the file-bus: `resolveApproval()` moves
 * `approvals/pending/ → approvals/resolved/`; the agent's
 * `waitForApproval` polling loop picks the decision up.
 *
 * Failure-isolation: every dispatch path is wrapped in try/catch. Bot
 * MUST NOT crash on user input or downstream exceptions.
 */

import TelegramBotApi from "node-telegram-bot-api";

import type { AgentHandle, AgentShape } from "../agent-runtime/types.js";
import { validateAgentId } from "../daemon/state-paths.js";
import { emit } from "../daemon/telemetry.js";
import type { ApprovalRequest } from "./approval-bus.js";
import { listPendingApprovals, resolveApproval } from "./approval-bus.js";
import {
	type Command,
	isCommandAvailableForShape,
	parseCommand,
} from "./commands.js";

export interface AgentManagerInterface {
	getHandle(handleId: string): AgentHandle | undefined;
	listHandles(): AgentHandle[];
	shutdownAgent(
		handleId: string,
		signal?: "SIGTERM" | "SIGKILL",
	): Promise<void>;
	restartAgent?(handleId: string, reason: string): Promise<unknown>;
	getShape(agent: string): Promise<AgentShape | null>;
}

export interface TelegramBotOpts {
	readonly token: string;
	readonly allowedUserIds: number[];
	readonly chatId?: number;
	readonly agentManager: AgentManagerInterface;
	readonly injectIntoAgent: (agentId: string, text: string) => Promise<void>;
	/** Override for tests; defaults to the real `node-telegram-bot-api`. */
	readonly botFactory?: (
		token: string,
		options: TelegramBotApi.ConstructorOptions,
	) => TelegramBotApi;
}

interface ReplyTarget {
	readonly chatId: number;
	readonly userId: number;
	readonly username: string | null;
}

export class TelegramBot {
	private readonly token: string;
	private readonly allowedUserIds: ReadonlySet<number>;
	private readonly chatId: number | undefined;
	private readonly agentManager: AgentManagerInterface;
	private readonly injectIntoAgent: (
		agentId: string,
		text: string,
	) => Promise<void>;
	private readonly botFactory: (
		token: string,
		options: TelegramBotApi.ConstructorOptions,
	) => TelegramBotApi;
	private bot: TelegramBotApi | null = null;
	private started = false;

	constructor(opts: TelegramBotOpts) {
		this.token = opts.token;
		this.allowedUserIds = new Set(opts.allowedUserIds);
		this.chatId =
			opts.chatId !== undefined ? opts.chatId : opts.allowedUserIds[0];
		this.agentManager = opts.agentManager;
		this.injectIntoAgent = opts.injectIntoAgent;
		this.botFactory =
			opts.botFactory ??
			((token, options) => new TelegramBotApi(token, options));
	}

	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;
		this.bot = this.botFactory(this.token, { polling: true });
		this.bot.on("message", (msg) => {
			void this.handleMessage(msg);
		});
		this.bot.on("callback_query", (query) => {
			void this.handleCallbackQuery(query);
		});
	}

	async stop(): Promise<void> {
		if (!this.started || this.bot === null) return;
		this.started = false;
		try {
			await this.bot.stopPolling();
		} catch (err) {
			console.error(
				`[telegram] stopPolling threw: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		this.bot = null;
	}

	private async handleMessage(msg: TelegramBotApi.Message): Promise<void> {
		if (!this.started) return;
		const from = msg.from;
		if (from === undefined) return;
		if (!this.allowedUserIds.has(from.id)) {
			console.error(
				`[telegram] rejected message from non-allowed user ${from.id} (@${from.username ?? "?"})`,
			);
			return;
		}
		const text = msg.text;
		if (typeof text !== "string" || text.length === 0) return;

		const target: ReplyTarget = {
			chatId: msg.chat.id,
			userId: from.id,
			username: from.username ?? null,
		};

		const parsed = parseCommand(text);
		if (!parsed.ok) {
			await this.safeReply(target, `Error: ${parsed.error}`);
			return;
		}
		await this.dispatch(parsed.command, target);
	}

	private async handleCallbackQuery(
		query: TelegramBotApi.CallbackQuery,
	): Promise<void> {
		if (!this.started) return;
		const from = query.from;
		if (!this.allowedUserIds.has(from.id)) {
			console.error(
				`[telegram] rejected callback from non-allowed user ${from.id}`,
			);
			return;
		}
		const data = query.data;
		if (typeof data !== "string" || data.length === 0) return;
		const chatId = query.message?.chat?.id ?? this.chatId;
		if (chatId === undefined) return;

		const parsed = parseCommand(data);
		const target: ReplyTarget = {
			chatId,
			userId: from.id,
			username: from.username ?? null,
		};
		if (!parsed.ok) {
			await this.safeReply(target, `Callback error: ${parsed.error}`);
			if (this.bot !== null && query.id !== undefined) {
				await this.bot.answerCallbackQuery(query.id).catch(() => {});
			}
			return;
		}

		// Answer immediately so the button stops spinning before I/O-heavy dispatch runs.
		if (this.bot !== null && query.id !== undefined) {
			try {
				await this.bot.answerCallbackQuery(query.id);
			} catch (err) {
				console.error(
					`[telegram] answerCallbackQuery failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}

		await this.dispatch(parsed.command, target);
	}

	private async dispatch(command: Command, target: ReplyTarget): Promise<void> {
		try {
			const gate = await isCommandAvailableForShape(
				command,
				this.agentManager.getShape.bind(this.agentManager),
			);
			if (!gate.available) {
				await this.safeReply(target, `Rejected: ${gate.reason}`);
				return;
			}
		} catch (err) {
			await this.safeReply(
				target,
				`Internal error during shape gating: ${err instanceof Error ? err.message : String(err)}`,
			);
			return;
		}

		switch (command.name) {
			case "start":
				await this.dispatchStart(command, target);
				return;
			case "agents":
				await this.dispatchAgents(target);
				return;
			case "approve":
				await this.dispatchApprove(command, target);
				return;
			case "abort":
				await this.dispatchAbort(command, target);
				return;
			case "inject":
				await this.dispatchInject(command, target);
				return;
			case "status":
				await this.dispatchStatus(command, target);
				return;
		}
	}

	private async dispatchStart(
		command: Extract<Command, { name: "start" }>,
		target: ReplyTarget,
	): Promise<void> {
		await this.safeReply(
			target,
			`Phase 1 hello-world: agent "${command.agent}" must be pre-registered in config. Dynamic spawn lands in Phase 3.`,
		);
	}

	private async dispatchAgents(target: ReplyTarget): Promise<void> {
		try {
			const handles = this.agentManager.listHandles();
			if (handles.length === 0) {
				await this.safeReply(target, "No agents registered.");
				return;
			}
			const lines = handles.map(
				(h) => `• ${h.agentId} (handle ${h.id}, shape ${h.shape})`,
			);
			await this.safeReply(target, `Registered agents:\n${lines.join("\n")}`);
		} catch (err) {
			await this.safeReply(
				target,
				`Failed to list agents: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	private async dispatchApprove(
		command: Extract<Command, { name: "approve" }>,
		target: ReplyTarget,
	): Promise<void> {
		const resolvedBy = target.username ?? target.userId.toString();
		try {
			const result = await resolveApproval(
				command.approvalId,
				command.decision,
				resolvedBy,
			);
			if (result.ok) {
				await this.safeReply(
					target,
					`Approval ${command.approvalId} → ${command.decision}.`,
				);
				await emit({
					kind: "approval-resolved",
					approvalId: command.approvalId,
					decision: command.decision,
					resolvedBy,
				});
			} else {
				await this.safeReply(
					target,
					`Approval ${command.approvalId}: ${result.reason}.`,
				);
			}
		} catch (err) {
			await this.safeReply(
				target,
				`resolveApproval failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	private async dispatchAbort(
		command: Extract<Command, { name: "abort" }>,
		target: ReplyTarget,
	): Promise<void> {
		const handle = this.findHandleByAgentId(command.agent);
		if (handle === null) {
			await this.safeReply(
				target,
				`No handle found for agent ${command.agent}.`,
			);
			return;
		}
		try {
			await this.agentManager.shutdownAgent(handle.id, "SIGTERM");
			await this.safeReply(
				target,
				`Aborted agent ${command.agent} (handle ${handle.id}).`,
			);
		} catch (err) {
			await this.safeReply(
				target,
				`shutdownAgent failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	private async dispatchInject(
		command: Extract<Command, { name: "inject" }>,
		target: ReplyTarget,
	): Promise<void> {
		const validation = validateAgentId(command.agent);
		if (!validation.valid) {
			await this.safeReply(
				target,
				`Invalid agent id "${command.agent}": ${validation.reason}. Must match ^[a-z][a-z0-9-]{0,62}$ and exclude reserved names.`,
			);
			return;
		}
		try {
			// Per-agent file-bus tagging: the tagged-task-bus writes the task
			// envelope to `tasks/pending/<agentId>__<uuid>.json`. The bot's
			// active inject path is `injectIntoAgent` (which the daemon
			// wires to either runtime.send for PTY shapes or a tagged
			// file-bus task for non-PTY shapes in Phase 3+). For Phase 1,
			// `injectIntoAgent` calls into the PTY adapter directly.
			await this.injectIntoAgent(command.agent, command.text);
			await this.safeReply(
				target,
				`Injected into ${command.agent}: ${command.text}`,
			);
		} catch (err) {
			await this.safeReply(
				target,
				`Inject failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	private async dispatchStatus(
		command: Extract<Command, { name: "status" }>,
		target: ReplyTarget,
	): Promise<void> {
		const handle = this.findHandleByAgentId(command.agent);
		const lines: string[] = [];
		if (handle === null) {
			lines.push(`No handle for agent ${command.agent}.`);
		} else {
			lines.push(
				`Agent ${command.agent} → handle ${handle.id} (shape ${handle.shape}, gen ${handle.generationToken})`,
			);
		}
		try {
			const pending = await listPendingApprovals();
			const filtered = pending.filter((p) => p.agentId === command.agent);
			if (filtered.length === 0) {
				lines.push("No pending approvals for this agent.");
			} else {
				lines.push("Pending approvals:");
				for (const p of filtered) {
					lines.push(`  • ${p.approvalId} — ${p.reason}`);
				}
			}
		} catch (err) {
			lines.push(
				`(listPendingApprovals failed: ${err instanceof Error ? err.message : String(err)})`,
			);
		}
		await this.safeReply(target, lines.join("\n"));
	}

	/**
	 * Send an inline-keyboard approval request to the configured chat.
	 * Used by the daemon's bot-side poller (Plan 07) to broadcast new
	 * pending approvals.
	 */
	async sendApprovalRequest(
		chatId: number,
		req: ApprovalRequest,
	): Promise<void> {
		if (this.bot === null) return;
		const text = `Approval needed (${req.agentId} / handle ${req.handleId}):\n${req.reason}\n\nID: ${req.approvalId}`;
		const keyboard: TelegramBotApi.InlineKeyboardMarkup = {
			inline_keyboard: [
				[
					{
						text: "Allow",
						callback_data: `approve_allow_${req.approvalId}`,
					},
					{
						text: "Deny",
						callback_data: `approve_deny_${req.approvalId}`,
					},
				],
			],
		};
		try {
			await this.bot.sendMessage(chatId, text, {
				reply_markup: keyboard,
			});
			await emit({
				kind: "approval-requested",
				approvalId: req.approvalId,
				agentId: req.agentId,
				reason: req.reason,
			});
		} catch (err) {
			console.error(
				`[telegram] sendApprovalRequest failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	getChatId(): number | undefined {
		return this.chatId;
	}

	private findHandleByAgentId(agentId: string): AgentHandle | null {
		for (const h of this.agentManager.listHandles()) {
			if (h.agentId === agentId) return h;
		}
		return null;
	}

	private async safeReply(target: ReplyTarget, text: string): Promise<void> {
		if (this.bot === null) return;
		try {
			await this.bot.sendMessage(target.chatId, text);
		} catch (err) {
			console.error(
				`[telegram] sendMessage failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
}
