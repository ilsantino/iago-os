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
 *
 * SECURITY MODEL (PR45 adversarial fixes):
 *
 *   - `chat.type === "private"` is enforced before processing any
 *     message or callback. Group/supergroup/channel messages from an
 *     allowlisted user would otherwise leak agent state, pending
 *     approvals, and command output to every group member.
 *   - The bot token is wrapped in an opaque object with a custom
 *     `util.inspect` redactor; `JSON.stringify(bot)` and `console.dir(bot)`
 *     never emit the token. The plain string is held only inside the
 *     wrapper and passed to `node-telegram-bot-api` once at start().
 *   - `IAGO_TELEGRAM_ALLOWED_USER_IDS` must be non-empty — the
 *     constructor throws `RangeError` if not. Empty allowlist would
 *     silently break command routing and approval broadcast in
 *     production.
 *   - `/inject` text is sanitized before reaching the PTY: control
 *     bytes (`\x00-\x08`, `\x0b`, `\x0c`, `\x0e-\x1f`, `\x7f`) are
 *     stripped (tab, newline, carriage-return retained). Length is
 *     capped at 4096 bytes — Telegram's per-message cap.
 *   - `sendApprovalRequest` re-checks the destination `chatId` against
 *     the allowlist before sending; an attacker who plumbs a hostile
 *     chatId cannot redirect approval prompts.
 *   - Non-allowed-user rejection logs only an event counter, not the
 *     Telegram user id / username — these are PII that persists in
 *     journald on VPS deploys.
 *   - `polling_error` handler is registered to surface the multi-bot
 *     HTTP 409 hazard (Telegram allows one polling client per token).
 */

import * as util from "node:util";

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
	shutdownAgent(handleId: string, signal?: "SIGTERM" | "SIGKILL"): Promise<void>;
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

/** Telegram's per-message text limit. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;
/** Soft headroom for chunking to avoid UTF-16 surrogate splits. */
const TELEGRAM_CHUNK_LIMIT = 4000;
/** Max bytes accepted by `/inject` to forward to the PTY. */
export const INJECT_TEXT_LIMIT = 4096;

/**
 * Strip ASCII control bytes that would let `/inject` issue PTY control
 * sequences (Ctrl-C `\x03`, Ctrl-D `\x04`, OSC 52 `\x1b]52`...). Keeps
 * printable + `\t` + `\n` + `\r`. Returns `{ sanitized, stripped }` so
 * the bot can report when bytes were removed.
 */
export function sanitizeInjectText(text: string): {
	readonly sanitized: string;
	readonly stripped: number;
} {
	let stripped = 0;
	const out: string[] = [];
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 0;
		// Allow tab (9), newline (10), carriage-return (13). Strip the
		// rest of C0 (< 0x20) and DEL (0x7f). Strip C1 controls
		// (0x80-0x9f) as well — those drive terminal escape sequences.
		if (
			(code < 0x20 && code !== 9 && code !== 10 && code !== 13) ||
			code === 0x7f ||
			(code >= 0x80 && code <= 0x9f)
		) {
			stripped++;
			continue;
		}
		out.push(ch);
	}
	return { sanitized: out.join(""), stripped };
}

/**
 * Opaque token wrapper. Holds the raw token only inside the closure
 * returned by `reveal()`, and overrides `util.inspect` + JSON
 * serialization so logs and error reports never emit the secret.
 */
export interface SecretToken {
	reveal(): string;
	[util.inspect.custom]?(): string;
	toJSON?(): string;
}

export function wrapSecretToken(raw: string): SecretToken {
	return {
		reveal: () => raw,
		[util.inspect.custom]: () => "[REDACTED]",
		toJSON: () => "[REDACTED]",
	};
}

/**
 * Split a long reply into Telegram-safe chunks (<=4000 chars each).
 * Splits on newline where possible to keep messages readable.
 */
export function chunkForTelegram(
	text: string,
	limit = TELEGRAM_CHUNK_LIMIT,
): string[] {
	if (text.length <= limit) return [text];
	const chunks: string[] = [];
	let remaining = text;
	while (remaining.length > limit) {
		// Prefer splitting at last newline within the limit.
		let cut = remaining.lastIndexOf("\n", limit);
		if (cut <= 0) cut = limit;
		chunks.push(remaining.slice(0, cut));
		remaining = remaining.slice(cut).replace(/^\n/, "");
	}
	if (remaining.length > 0) chunks.push(remaining);
	return chunks;
}

export class TelegramBot {
	private readonly tokenWrapper: SecretToken;
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
	private rejectedNonPrivateCount = 0;
	private rejectedNotAllowedCount = 0;

	constructor(opts: TelegramBotOpts) {
		// PR45 CRITICAL: empty allowlist would silently break command
		// routing AND approval broadcast (chatId becomes undefined).
		// Fail loud at startup.
		if (!Array.isArray(opts.allowedUserIds) || opts.allowedUserIds.length === 0) {
			void emit(
				{
					kind: "agent-registered",
					agentId: "_telegram_bot_",
					runtimeId: "telegram",
				},
				{
					telegram_config_error:
						"IAGO_TELEGRAM_ALLOWED_USER_IDS must contain at least one Telegram user ID",
				},
			).catch(() => undefined);
			throw new RangeError(
				"TelegramBot: IAGO_TELEGRAM_ALLOWED_USER_IDS must contain at least one Telegram user ID",
			);
		}
		// Reject non-positive ids — real Telegram user IDs are positive
		// 32-/64-bit integers. A 0 or negative in the allowlist is a typo
		// that would match spoofed updates from a compromised proxy.
		for (const id of opts.allowedUserIds) {
			if (!Number.isInteger(id) || id <= 0) {
				throw new RangeError(
					`TelegramBot: allowedUserIds entries must be positive integers (got ${id})`,
				);
			}
		}
		this.tokenWrapper = wrapSecretToken(opts.token);
		this.allowedUserIds = new Set(opts.allowedUserIds);
		this.chatId =
			opts.chatId !== undefined ? opts.chatId : opts.allowedUserIds[0];
		this.agentManager = opts.agentManager;
		this.injectIntoAgent = opts.injectIntoAgent;
		this.botFactory =
			opts.botFactory ?? ((token, options) => new TelegramBotApi(token, options));
	}

	/**
	 * Custom inspector — never include the token wrapper or any field
	 * that could leak the raw token in a stack trace or console.dir.
	 */
	[util.inspect.custom](): Record<string, unknown> {
		return {
			started: this.started,
			allowedUserIdsSize: this.allowedUserIds.size,
			chatId: this.chatId,
			rejectedNonPrivateCount: this.rejectedNonPrivateCount,
			rejectedNotAllowedCount: this.rejectedNotAllowedCount,
			token: "[REDACTED]",
		};
	}

	toJSON(): Record<string, unknown> {
		return this[util.inspect.custom]();
	}

	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;
		this.bot = this.botFactory(this.tokenWrapper.reveal(), {
			polling: true,
		});
		this.bot.on("message", (msg) => {
			this.handleMessage(msg).catch((err) => {
				console.error(
					`[telegram] handleMessage unhandled error: ${err instanceof Error ? err.message : String(err)}`,
				);
			});
		});
		this.bot.on("callback_query", (query) => {
			this.handleCallbackQuery(query).catch((err) => {
				console.error(
					`[telegram] handleCallbackQuery unhandled error: ${err instanceof Error ? err.message : String(err)}`,
				);
			});
		});
		// PR45 IMPORTANT: surface multi-bot HTTP 409 hazard. Telegram
		// allows ONE polling client per token; if the daemon is running
		// twice or OpenClaw still polls during Phase 2 cutover, getUpdates
		// returns 409 and the library emits polling_error. Without this
		// handler, Santiago sees "the bot is not responding" silently.
		this.bot.on("polling_error", (err: Error) => {
			console.error(
				`[telegram] polling_error: ${err instanceof Error ? err.message : String(err)}`,
			);
		});
	}

	async stop(): Promise<void> {
		if (!this.started || this.bot === null) return;
		this.started = false;
		const inst = this.bot;
		try {
			await inst.stopPolling();
		} catch (err) {
			console.error(
				`[telegram] stopPolling threw: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		// PR45 IMPORTANT: removeAllListeners even if stopPolling threw —
		// otherwise the old emitter keeps firing handlers against a bot
		// that thinks it's stopped, and the next start() spawns a SECOND
		// polling client → Telegram 409.
		try {
			inst.removeAllListeners();
		} catch (err) {
			console.error(
				`[telegram] removeAllListeners threw: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		this.bot = null;
	}

	private async handleMessage(msg: TelegramBotApi.Message): Promise<void> {
		if (!this.started) return;
		// PR45 CRITICAL: group-chat hijack. Telegram delivers messages from
		// allowlisted users in group/supergroup chats with `from.id`
		// matching but `chat.id` pointing at the group. Without this
		// gate, `/agents` and `/status` replies broadcast agent topology
		// to every group member. Only `chat.type === "private"` is
		// allowed; everything else is dropped silently with a counter.
		if (msg.chat.type !== "private") {
			this.rejectedNonPrivateCount++;
			console.error(
				`[telegram] rejected non-private chat (type=${msg.chat.type}); total=${this.rejectedNonPrivateCount}`,
			);
			return;
		}
		const from = msg.from;
		if (from === undefined) return;
		if (!this.allowedUserIds.has(from.id)) {
			this.rejectedNotAllowedCount++;
			// PR45 IMPORTANT: do NOT log the Telegram user id or username
			// — both are PII that lands in journald on VPS. Log only a
			// counter for operator visibility.
			console.error(
				`[telegram] rejected message from non-allowed user; total=${this.rejectedNotAllowedCount}`,
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
		// PR45 CRITICAL: enforce private-chat on callbacks too. A user
		// can tap an inline-keyboard button on a message that landed in
		// a group chat; the callback fires with `from.id` matching but
		// `query.message.chat` pointing at the group.
		const cbChat = query.message?.chat;
		if (cbChat !== undefined && cbChat.type !== "private") {
			this.rejectedNonPrivateCount++;
			console.error(
				`[telegram] rejected non-private callback (type=${cbChat.type}); total=${this.rejectedNonPrivateCount}`,
			);
			// Answer to stop the spinner — no information disclosed.
			if (this.bot !== null && query.id !== undefined) {
				await this.bot
					.answerCallbackQuery(query.id, { text: "Not authorized" })
					.catch(() => undefined);
			}
			return;
		}
		const from = query.from;
		if (!this.allowedUserIds.has(from.id)) {
			this.rejectedNotAllowedCount++;
			console.error(
				`[telegram] rejected callback from non-allowed user; total=${this.rejectedNotAllowedCount}`,
			);
			// PR45 IMPORTANT: always answer the callback so the user's
			// Telegram client stops showing the loading spinner. Stuck
			// spinners are an info leak (bot reacts to events).
			if (this.bot !== null && query.id !== undefined) {
				await this.bot
					.answerCallbackQuery(query.id, { text: "Not authorized" })
					.catch(() => undefined);
			}
			return;
		}
		const data = query.data;
		if (typeof data !== "string" || data.length === 0) {
			if (this.bot !== null && query.id !== undefined) {
				await this.bot
					.answerCallbackQuery(query.id, { text: "Empty callback" })
					.catch(() => undefined);
			}
			return;
		}
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
				await this.bot
					.answerCallbackQuery(query.id, { text: "Invalid callback" })
					.catch(() => undefined);
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
		// PR45 MINOR: validate agentId before lookup for consistency.
		const validation = validateAgentId(command.agent);
		if (!validation.valid) {
			await this.safeReply(
				target,
				`Invalid agent id "${command.agent.slice(0, 64)}": ${validation.reason}.`,
			);
			return;
		}
		const handle = this.findHandleByAgentId(command.agent);
		if (handle === null) {
			await this.safeReply(target, `No handle found for agent ${command.agent}.`);
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
				`Invalid agent id "${command.agent.slice(0, 64)}": ${validation.reason}. Must match ^[a-z][a-z0-9-]{0,62}$ and exclude reserved names.`,
			);
			return;
		}
		// PR45 CRITICAL: sanitize PTY stdin. Control bytes let an
		// allowlisted user (or anyone who phishes Santiago's Telegram
		// session) drive Ctrl-C / Ctrl-D / OSC 52 clipboard escapes
		// directly into the running TUI. Length cap matches Telegram's
		// per-message limit.
		if (command.text.length > INJECT_TEXT_LIMIT) {
			await this.safeReply(
				target,
				`Inject rejected: text exceeds ${INJECT_TEXT_LIMIT} chars (${command.text.length}).`,
			);
			return;
		}
		const { sanitized, stripped } = sanitizeInjectText(command.text);
		if (sanitized.length === 0) {
			await this.safeReply(
				target,
				`Inject rejected: text was empty after stripping ${stripped} control byte(s).`,
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
			await this.injectIntoAgent(command.agent, sanitized);
			const note = stripped > 0 ? ` (${stripped} control byte(s) stripped)` : "";
			await this.safeReply(
				target,
				`Injected into ${command.agent}${note}: ${sanitized}`,
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
		const validation = validateAgentId(command.agent);
		if (!validation.valid) {
			await this.safeReply(
				target,
				`Invalid agent id "${command.agent.slice(0, 64)}": ${validation.reason}.`,
			);
			return;
		}
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
	 *
	 * PR45 IMPORTANT: `chatId` is re-validated against the allowlist
	 * before send — an attacker who can influence the caller-supplied
	 * chatId cannot redirect approval prompts to their own chat.
	 */
	async sendApprovalRequest(
		chatId: number,
		req: ApprovalRequest,
	): Promise<void> {
		if (this.bot === null) return;
		if (!this.allowedUserIds.has(chatId)) {
			console.error(
				`[telegram] sendApprovalRequest rejected: chatId not in allowlist`,
			);
			return;
		}
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
		// PR45 IMPORTANT: chunk replies to fit Telegram's 4096-char
		// per-message limit. Long /agents and /status outputs would
		// otherwise return 400 from the Telegram API; safeReply would
		// log the error but the user sees no reply.
		const chunks = chunkForTelegram(text);
		for (const chunk of chunks) {
			try {
				await this.bot.sendMessage(target.chatId, chunk);
			} catch (err) {
				console.error(
					`[telegram] sendMessage failed: ${err instanceof Error ? err.message : String(err)}`,
				);
				return;
			}
		}
	}
}
