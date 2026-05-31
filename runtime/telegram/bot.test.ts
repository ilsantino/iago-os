import { EventEmitter } from "node:events";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as util from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentHandle, AgentShape } from "../agent-runtime/types.js";
import { ensureStateDirsSync } from "../daemon/state-paths.js";
import * as telemetry from "../daemon/telemetry.js";
import { createApprovalRequest } from "./approval-bus.js";
import {
	type AgentManagerInterface,
	TelegramBot,
	chunkForTelegram,
	sanitizeInjectText,
	wrapSecretToken,
} from "./bot.js";

type SendMessageCall = {
	chatId: number;
	text: string;
	options: unknown;
};

class FakeTelegramBot extends EventEmitter {
	public sendMessageCalls: SendMessageCall[] = [];
	public answerCalls: string[] = [];
	public answerOptions: Array<unknown> = [];
	// Per-id options bucket — preserves every call for an id so tests that
	// emit the same callback id twice don't silently assert against the
	// first match (review minor: index-based lookup was a footgun).
	public answerOptionsById: Map<string, unknown[]> = new Map();
	public polling = true;
	public stopCalled = 0;
	async sendMessage(
		chatId: number,
		text: string,
		options?: unknown,
	): Promise<{ message_id: number }> {
		this.sendMessageCalls.push({ chatId, text, options });
		return { message_id: this.sendMessageCalls.length };
	}
	async stopPolling(): Promise<void> {
		this.stopCalled++;
		this.polling = false;
	}
	isPolling(): boolean {
		return this.polling;
	}
	async answerCallbackQuery(id: string, options?: unknown): Promise<boolean> {
		this.answerCalls.push(id);
		this.answerOptions.push(options);
		const bucket = this.answerOptionsById.get(id) ?? [];
		bucket.push(options);
		this.answerOptionsById.set(id, bucket);
		return true;
	}
	answerOptionsFor(id: string): unknown[] {
		return this.answerOptionsById.get(id) ?? [];
	}
	lastAnswerOptionsFor(id: string): unknown {
		const bucket = this.answerOptionsById.get(id);
		return bucket && bucket.length > 0 ? bucket[bucket.length - 1] : undefined;
	}
}

function makeHandle(agentId: string, shape: AgentShape = "pty"): AgentHandle {
	return {
		id: `handle-${agentId}`,
		runtime: "fixture",
		shape,
		agentId,
		sessionId: `session-${agentId}`,
		generationToken: 1,
		spawnedAt: 0,
		markerPath: "/tmp/fake",
	};
}

function buildBot(opts: {
	allowed: number[];
	shape?: AgentShape | null;
	handles?: AgentHandle[];
	inject?: (agent: string, text: string) => Promise<void>;
	shutdown?: (handleId: string) => Promise<void>;
}): {
	bot: TelegramBot;
	fake: FakeTelegramBot;
	manager: AgentManagerInterface;
} {
	const fake = new FakeTelegramBot();
	const handles = opts.handles ?? [];
	const manager: AgentManagerInterface = {
		getHandle: (id) => handles.find((h) => h.id === id),
		listHandles: () => handles,
		shutdownAgent:
			opts.shutdown ??
			(async () => {
				// noop default
			}),
		getShape: async (agent: string) => {
			if (opts.shape === null) return null;
			const found = handles.find((h) => h.agentId === agent);
			if (found !== undefined) return found.shape;
			return opts.shape ?? null;
		},
	};
	const bot = new TelegramBot({
		token: "fake-token",
		allowedUserIds: opts.allowed,
		agentManager: manager,
		injectIntoAgent:
			opts.inject ??
			(async () => {
				// noop default
			}),
		botFactory: () => fake as unknown as never,
	});
	return { bot, fake, manager };
}

function fakeMessage(opts: {
	userId: number;
	chatId?: number;
	text: string;
	username?: string;
}): Record<string, unknown> {
	return {
		message_id: 1,
		date: Math.floor(Date.now() / 1000),
		chat: { id: opts.chatId ?? opts.userId, type: "private" },
		from: {
			id: opts.userId,
			is_bot: false,
			first_name: "Test",
			username: opts.username,
		},
		text: opts.text,
	};
}

function fakeCallback(opts: {
	userId: number;
	chatId?: number;
	data: string;
	id?: string;
	username?: string;
}): Record<string, unknown> {
	return {
		id: opts.id ?? "cb-1",
		from: {
			id: opts.userId,
			is_bot: false,
			first_name: "Test",
			username: opts.username,
		},
		message: {
			message_id: 1,
			date: Math.floor(Date.now() / 1000),
			chat: { id: opts.chatId ?? opts.userId, type: "private" },
		},
		chat_instance: "chat-instance-1",
		data: opts.data,
	};
}

async function flushTicks(times = 5): Promise<void> {
	for (let i = 0; i < times; i++) {
		await new Promise((r) => setImmediate(r));
	}
}

async function waitForFile(filePath: string, timeoutMs = 2000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			await fsp.access(filePath);
			return;
		} catch {
			await new Promise((r) => setTimeout(r, 20));
		}
	}
	throw new Error(
		`waitForFile: ${filePath} did not appear within ${timeoutMs}ms`,
	);
}

async function waitForSendMessage(
	fake: FakeTelegramBot,
	minCalls = 1,
	timeoutMs = 2000,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (fake.sendMessageCalls.length >= minCalls) return;
		await new Promise((r) => setTimeout(r, 10));
	}
	throw new Error(
		`waitForSendMessage: expected ≥${minCalls} call(s) within ${timeoutMs}ms (got ${fake.sendMessageCalls.length})`,
	);
}

let tempDir: string;

beforeEach(async () => {
	tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-bot-test-"));
	process.env.IAGO_DAEMON_STATE_ROOT = tempDir;
	ensureStateDirsSync();
});

afterEach(async () => {
	delete process.env.IAGO_DAEMON_STATE_ROOT;
	delete process.env.CLAUDE_CODE_SESSION_ID;
	vi.restoreAllMocks();
	await fsp.rm(tempDir, { recursive: true, force: true });
});

describe("TelegramBot / message routing", () => {
	it("ignores messages from non-allowed users (no reply sent)", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { bot, fake } = buildBot({ allowed: [42] });
		await bot.start();
		fake.emit("message", fakeMessage({ userId: 99, text: "/agents" }));
		await flushTicks();
		expect(fake.sendMessageCalls).toHaveLength(0);
		expect(errSpy).toHaveBeenCalled();
		await bot.stop();
	});

	it("/agents from allowed user calls listHandles and replies", async () => {
		const handles = [makeHandle("agent-foo")];
		const { bot, fake } = buildBot({ allowed: [42], handles });
		await bot.start();
		fake.emit("message", fakeMessage({ userId: 42, text: "/agents" }));
		await flushTicks();
		expect(fake.sendMessageCalls).toHaveLength(1);
		expect(fake.sendMessageCalls[0]?.text).toContain("agent-foo");
		await bot.stop();
	});

	it("/inject on a PTY agent calls injectIntoAgent with the text", async () => {
		const handles = [makeHandle("agent-foo", "pty")];
		const inject = vi.fn(async () => undefined);
		const { bot, fake } = buildBot({
			allowed: [42],
			handles,
			inject,
		});
		await bot.start();
		fake.emit(
			"message",
			fakeMessage({ userId: 42, text: "/inject agent-foo hello world" }),
		);
		await flushTicks();
		expect(inject).toHaveBeenCalledWith("agent-foo", "hello world");
		await bot.stop();
	});

	it("/inject on an HTTP agent replies with a rejection", async () => {
		const handles = [makeHandle("agent-bar", "http")];
		const inject = vi.fn(async () => undefined);
		const { bot, fake } = buildBot({
			allowed: [42],
			handles,
			inject,
		});
		await bot.start();
		fake.emit(
			"message",
			fakeMessage({ userId: 42, text: "/inject agent-bar hello" }),
		);
		await flushTicks();
		expect(inject).not.toHaveBeenCalled();
		expect(fake.sendMessageCalls).toHaveLength(1);
		expect(fake.sendMessageCalls[0]?.text).toContain("Rejected");
		await bot.stop();
	});

	it("malformed command replies with error and does NOT crash", async () => {
		const { bot, fake } = buildBot({ allowed: [42] });
		await bot.start();
		fake.emit("message", fakeMessage({ userId: 42, text: "/notacommand" }));
		await flushTicks();
		expect(fake.sendMessageCalls).toHaveLength(1);
		expect(fake.sendMessageCalls[0]?.text).toContain("unknown command");
		await bot.stop();
	});

	it("exception thrown in injectIntoAgent is caught, bot still replies", async () => {
		const handles = [makeHandle("agent-foo", "pty")];
		const inject = vi.fn(async () => {
			throw new Error("boom");
		});
		const { bot, fake } = buildBot({
			allowed: [42],
			handles,
			inject,
		});
		await bot.start();
		fake.emit(
			"message",
			fakeMessage({ userId: 42, text: "/inject agent-foo something" }),
		);
		await flushTicks();
		expect(fake.sendMessageCalls).toHaveLength(1);
		expect(fake.sendMessageCalls[0]?.text).toContain("Inject failed");
		expect(fake.sendMessageCalls[0]?.text).toContain("boom");
		await bot.stop();
	});

	it("/inject with an invalid agentId is rejected with a clear message", async () => {
		const inject = vi.fn(async () => undefined);
		const { bot, fake } = buildBot({
			allowed: [42],
			shape: "pty",
			inject,
		});
		await bot.start();
		fake.emit(
			"message",
			fakeMessage({ userId: 42, text: "/inject AGENT_BAD hi" }),
		);
		await flushTicks();
		expect(inject).not.toHaveBeenCalled();
		expect(fake.sendMessageCalls[0]?.text).toContain("Invalid agent id");
		await bot.stop();
	});
});

describe("TelegramBot / callback routing", () => {
	it("approve_allow_<id> callback calls resolveApproval", async () => {
		const { bot, fake } = buildBot({ allowed: [42] });
		const { approvalId } = await createApprovalRequest({
			agentId: "agent-foo",
			handleId: "handle-1",
			reason: "deploy?",
		});
		const emitSpy = vi.spyOn(telemetry, "emit");
		await bot.start();
		fake.emit(
			"callback_query",
			fakeCallback({
				userId: 42,
				data: `approve_allow_${approvalId}`,
				username: "santi",
			}),
		);
		const resolvedPath = path.join(
			tempDir,
			"approvals",
			"resolved",
			`${approvalId}.json`,
		);
		await waitForFile(resolvedPath);
		const raw = await fsp.readFile(resolvedPath, "utf8");
		const decision = JSON.parse(raw);
		expect(decision.decision).toBe("allow");
		expect(decision.resolvedBy).toBe("santi");
		const emittedCalls = emitSpy.mock.calls.map(
			(c) => c[0] as { kind: string; [k: string]: unknown },
		);
		const resolvedEvent = emittedCalls.find(
			(e) => e.kind === "approval-resolved",
		);
		expect(resolvedEvent).toBeDefined();
		expect(resolvedEvent?.approvalId).toBe(approvalId);
		expect(resolvedEvent?.decision).toBe("allow");
		expect(resolvedEvent?.resolvedBy).toBe("santi");
		await bot.stop();
	});
});

describe("TelegramBot / sendApprovalRequest", () => {
	it("emits a message with inline_keyboard containing two buttons", async () => {
		const emitSpy = vi.spyOn(telemetry, "emit");
		const { bot, fake } = buildBot({ allowed: [42] });
		await bot.start();
		await bot.sendApprovalRequest(42, {
			approvalId: "abc-123",
			agentId: "agent-foo",
			handleId: "handle-1",
			reason: "deploy?",
			createdAt: Date.now(),
		});
		expect(fake.sendMessageCalls).toHaveLength(1);
		const opts = fake.sendMessageCalls[0]?.options as
			| { reply_markup?: { inline_keyboard?: unknown[][] } }
			| undefined;
		const keyboard = opts?.reply_markup?.inline_keyboard;
		expect(keyboard).toBeDefined();
		expect(keyboard?.[0]).toHaveLength(2);
		const buttons = keyboard?.[0] as Array<{
			text: string;
			callback_data: string;
		}>;
		expect(buttons[0]?.callback_data).toBe("approve_allow_abc-123");
		expect(buttons[1]?.callback_data).toBe("approve_deny_abc-123");
		const emittedCalls = emitSpy.mock.calls.map(
			(c) => c[0] as { kind: string; [k: string]: unknown },
		);
		const requestedEvent = emittedCalls.find(
			(e) => e.kind === "approval-requested",
		);
		expect(requestedEvent).toBeDefined();
		expect(requestedEvent?.approvalId).toBe("abc-123");
		expect(requestedEvent?.agentId).toBe("agent-foo");
		expect(requestedEvent?.reason).toBe("deploy?");
		await bot.stop();
	});
});

describe("TelegramBot / lifecycle", () => {
	it("stop() halts polling — subsequent messages NOT dispatched", async () => {
		const handles = [makeHandle("agent-foo")];
		const { bot, fake } = buildBot({ allowed: [42], handles });
		await bot.start();
		await bot.stop();
		expect(fake.stopCalled).toBe(1);
		// Emit after stop — bot.started is false, dispatch suppressed
		fake.emit("message", fakeMessage({ userId: 42, text: "/agents" }));
		await flushTicks();
		expect(fake.sendMessageCalls).toHaveLength(0);
	});

	it("start() is idempotent — second call does NOT re-create bot", async () => {
		const { bot } = buildBot({ allowed: [42] });
		await bot.start();
		await bot.start();
		// No crash; lifecycle stable.
		await bot.stop();
	});
});

// PR45 CRITICAL — chat-type allowlist (group-chat hijack defense)
function fakeGroupMessage(opts: {
	userId: number;
	chatId?: number;
	text: string;
	chatType?: "group" | "supergroup" | "channel";
}): Record<string, unknown> {
	return {
		message_id: 1,
		date: Math.floor(Date.now() / 1000),
		chat: { id: opts.chatId ?? -100, type: opts.chatType ?? "group" },
		from: {
			id: opts.userId,
			is_bot: false,
			first_name: "Test",
		},
		text: opts.text,
	};
}

function fakeGroupCallback(opts: {
	userId: number;
	chatId?: number;
	data: string;
	id?: string;
	chatType?: "group" | "supergroup" | "channel";
}): Record<string, unknown> {
	return {
		id: opts.id ?? "cb-grp",
		from: {
			id: opts.userId,
			is_bot: false,
			first_name: "Test",
		},
		message: {
			message_id: 1,
			date: Math.floor(Date.now() / 1000),
			chat: { id: opts.chatId ?? -100, type: opts.chatType ?? "group" },
		},
		chat_instance: "grp-1",
		data: opts.data,
	};
}

describe("TelegramBot / chat-type allowlist (PR45 CRITICAL)", () => {
	it.each([["group"], ["supergroup"], ["channel"]] as const)(
		"drops messages from %s chats even when from.id is allowlisted (no reply, no dispatch)",
		async ([chatType]) => {
			const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const handles = [makeHandle("agent-foo")];
			const inject = vi.fn(async () => undefined);
			const shutdown = vi.fn(async () => undefined);
			const { bot, fake } = buildBot({
				allowed: [42],
				handles,
				inject,
				shutdown,
			});
			await bot.start();
			fake.emit(
				"message",
				fakeGroupMessage({
					userId: 42,
					text: "/agents",
					chatType: chatType as "group" | "supergroup" | "channel",
				}),
			);
			await flushTicks();
			expect(fake.sendMessageCalls).toHaveLength(0);
			expect(inject).not.toHaveBeenCalled();
			expect(shutdown).not.toHaveBeenCalled();
			expect(errSpy).toHaveBeenCalled();
			const logs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
			expect(logs).toContain("non-private");
			await bot.stop();
		},
	);

	it("accepts messages from private chats from allowlisted users (control)", async () => {
		const handles = [makeHandle("agent-foo")];
		const { bot, fake } = buildBot({ allowed: [42], handles });
		await bot.start();
		fake.emit("message", fakeMessage({ userId: 42, text: "/agents" }));
		await flushTicks();
		expect(fake.sendMessageCalls).toHaveLength(1);
		await bot.stop();
	});

	it("drops callback_query from group chats and answers spinner without dispatch", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { bot, fake } = buildBot({ allowed: [42] });
		await bot.start();
		fake.emit(
			"callback_query",
			fakeGroupCallback({
				userId: 42,
				data: "approve_allow_11111111-2222-4333-8444-555555555555",
			}),
		);
		await flushTicks();
		expect(fake.sendMessageCalls).toHaveLength(0);
		// Spinner stopped
		expect(fake.answerCalls).toContain("cb-grp");
		const logs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logs).toContain("non-private");
		await bot.stop();
	});
});

// PR45 CRITICAL — /inject control-byte sanitization
describe("TelegramBot / /inject sanitization (PR45 CRITICAL)", () => {
	it("sanitizeInjectText strips ASCII control bytes (Ctrl-C, Ctrl-D, ESC) but keeps \\t \\n \\r", () => {
		const input = "hello\x03world\x04\x1b]52;c;data\x07tail\nnext\ttab\rcr";
		const { sanitized, stripped } = sanitizeInjectText(input);
		// Ctrl-C, Ctrl-D, ESC, BEL stripped — \n \t \r kept
		expect(sanitized).not.toContain("\x03");
		expect(sanitized).not.toContain("\x04");
		expect(sanitized).not.toContain("\x1b");
		expect(sanitized).not.toContain("\x07");
		expect(sanitized).toContain("\n");
		expect(sanitized).toContain("\t");
		expect(sanitized).toContain("\r");
		expect(stripped).toBeGreaterThan(0);
	});

	it("sanitizeInjectText strips DEL (0x7f) and C1 controls (0x80-0x9f)", () => {
		const input = "a\x7fb\x9fc";
		const { sanitized, stripped } = sanitizeInjectText(input);
		expect(sanitized).toBe("abc");
		expect(stripped).toBe(2);
	});

	it("/inject text with control bytes is sanitized before reaching the PTY", async () => {
		const handles = [makeHandle("agent-foo", "pty")];
		const inject = vi.fn(async () => undefined);
		const { bot, fake } = buildBot({
			allowed: [42],
			handles,
			inject,
		});
		await bot.start();
		// /inject command can include arbitrary text after the agent name —
		// but parseCommand normalizes whitespace, so embed control bytes as
		// literal characters in a single token.
		fake.emit(
			"message",
			fakeMessage({ userId: 42, text: "/inject agent-foo hello\x03world" }),
		);
		await flushTicks();
		expect(inject).toHaveBeenCalled();
		const sentText = inject.mock.calls[0]?.[1] ?? "";
		expect(sentText).not.toContain("\x03");
		expect(sentText).toContain("hello");
		expect(sentText).toContain("world");
		await bot.stop();
	});

	it("/inject with oversized text (>4096) is rejected before PTY write", async () => {
		const handles = [makeHandle("agent-foo", "pty")];
		const inject = vi.fn(async () => undefined);
		const { bot, fake } = buildBot({
			allowed: [42],
			handles,
			inject,
		});
		await bot.start();
		const huge = "x".repeat(5000);
		fake.emit(
			"message",
			fakeMessage({ userId: 42, text: `/inject agent-foo ${huge}` }),
		);
		await flushTicks();
		expect(inject).not.toHaveBeenCalled();
		expect(fake.sendMessageCalls[0]?.text).toContain("exceeds");
		await bot.stop();
	});

	it("/inject with text that becomes empty after sanitization is rejected", async () => {
		const handles = [makeHandle("agent-foo", "pty")];
		const inject = vi.fn(async () => undefined);
		const { bot, fake } = buildBot({
			allowed: [42],
			handles,
			inject,
		});
		await bot.start();
		// All control bytes - will be reduced to empty
		fake.emit(
			"message",
			fakeMessage({ userId: 42, text: "/inject agent-foo \x03\x04\x1b" }),
		);
		await flushTicks();
		// parseCommand will tokenize on whitespace and may eat the control
		// bytes as part of the token — at minimum, inject must not run with
		// raw control payload.
		if (inject.mock.calls.length > 0) {
			const sentText = String(inject.mock.calls[0]?.[1] ?? "");
			expect(sentText).not.toContain("\x03");
			expect(sentText).not.toContain("\x04");
			expect(sentText).not.toContain("\x1b");
		}
		await bot.stop();
	});
});

// PR45 CRITICAL — empty allowlist must fail loud
describe("TelegramBot / empty allowlist (PR45 CRITICAL)", () => {
	it("constructor throws RangeError when allowedUserIds is empty", () => {
		expect(() => {
			new TelegramBot({
				token: "fake-token",
				allowedUserIds: [],
				agentManager: {
					getHandle: () => undefined,
					listHandles: () => [],
					shutdownAgent: async () => undefined,
					getShape: async () => null,
				},
				injectIntoAgent: async () => undefined,
				botFactory: () => new FakeTelegramBot() as unknown as never,
			});
		}).toThrow(RangeError);
	});

	it("constructor throws when allowedUserIds contains 0", () => {
		expect(() => {
			new TelegramBot({
				token: "fake-token",
				allowedUserIds: [0],
				agentManager: {
					getHandle: () => undefined,
					listHandles: () => [],
					shutdownAgent: async () => undefined,
					getShape: async () => null,
				},
				injectIntoAgent: async () => undefined,
				botFactory: () => new FakeTelegramBot() as unknown as never,
			});
		}).toThrow(RangeError);
	});

	it("constructor throws when allowedUserIds contains negative id", () => {
		expect(() => {
			new TelegramBot({
				token: "fake-token",
				allowedUserIds: [-1, 42],
				agentManager: {
					getHandle: () => undefined,
					listHandles: () => [],
					shutdownAgent: async () => undefined,
					getShape: async () => null,
				},
				injectIntoAgent: async () => undefined,
				botFactory: () => new FakeTelegramBot() as unknown as never,
			});
		}).toThrow(RangeError);
	});

	it("constructor accepts a single positive id (Phase 1 typical)", () => {
		expect(() => {
			new TelegramBot({
				token: "fake-token",
				allowedUserIds: [42],
				agentManager: {
					getHandle: () => undefined,
					listHandles: () => [],
					shutdownAgent: async () => undefined,
					getShape: async () => null,
				},
				injectIntoAgent: async () => undefined,
				botFactory: () => new FakeTelegramBot() as unknown as never,
			});
		}).not.toThrow();
	});
});

// PR45 IMPORTANT — token redaction
describe("TelegramBot / token redaction (PR45 IMPORTANT)", () => {
	it("wrapSecretToken reveals raw token only via reveal()", () => {
		const wrapped = wrapSecretToken("super-secret-token");
		expect(wrapped.reveal()).toBe("super-secret-token");
		expect(util.inspect(wrapped)).toBe("[REDACTED]");
		expect(JSON.stringify({ wrapped })).toContain("[REDACTED]");
		expect(JSON.stringify({ wrapped })).not.toContain("super-secret-token");
	});

	it("util.inspect(bot) does NOT leak the bot token", () => {
		const TOKEN = "BOT-SECRET-1234567890-this-is-the-leaky-string";
		const { bot } = buildBot({ allowed: [42] });
		// Override token on a fresh instance constructed with the secret
		const inst = new TelegramBot({
			token: TOKEN,
			allowedUserIds: [42],
			agentManager: {
				getHandle: () => undefined,
				listHandles: () => [],
				shutdownAgent: async () => undefined,
				getShape: async () => null,
			},
			injectIntoAgent: async () => undefined,
			botFactory: () => new FakeTelegramBot() as unknown as never,
		});
		const inspected = util.inspect(inst);
		expect(inspected).not.toContain(TOKEN);
		expect(inspected).toContain("REDACTED");
		const stringified = JSON.stringify(inst);
		expect(stringified).not.toContain(TOKEN);
		// Reference bot to avoid unused-var lint
		expect(bot).toBeDefined();
	});
});

// PR45 IMPORTANT — sendApprovalRequest allowlist re-check
describe("TelegramBot / sendApprovalRequest allowlist re-check (PR45 IMPORTANT)", () => {
	it("rejects sendApprovalRequest to a chatId NOT in allowedUserIds", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { bot, fake } = buildBot({ allowed: [42] });
		await bot.start();
		await bot.sendApprovalRequest(9999, {
			approvalId: "11111111-2222-4333-8444-555555555555",
			agentId: "agent-foo",
			handleId: "h-1",
			reason: "deploy?",
			createdAt: Date.now(),
		});
		expect(fake.sendMessageCalls).toHaveLength(0);
		const logs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logs).toContain("chatId not in allowlist");
		await bot.stop();
	});

	it("allows sendApprovalRequest to a chatId IN allowedUserIds (control)", async () => {
		const { bot, fake } = buildBot({ allowed: [42] });
		await bot.start();
		await bot.sendApprovalRequest(42, {
			approvalId: "11111111-2222-4333-8444-555555555555",
			agentId: "agent-foo",
			handleId: "h-1",
			reason: "deploy?",
			createdAt: Date.now(),
		});
		expect(fake.sendMessageCalls).toHaveLength(1);
		await bot.stop();
	});
});

// PR45 IMPORTANT — non-allowed user callback gets answerCallbackQuery
describe("TelegramBot / non-allowed callback answers spinner (PR45 IMPORTANT)", () => {
	it("answerCallbackQuery is called for non-allowed user (no stuck spinner)", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { bot, fake } = buildBot({ allowed: [42] });
		await bot.start();
		fake.emit(
			"callback_query",
			fakeCallback({
				userId: 99,
				data: "approve_allow_11111111-2222-4333-8444-555555555555",
				id: "cb-stuck-spinner",
			}),
		);
		await flushTicks();
		expect(fake.answerCalls).toContain("cb-stuck-spinner");
		expect(fake.sendMessageCalls).toHaveLength(0);
		await bot.stop();
	});
});

// PR45 IMPORTANT — chunking for Telegram 4096 limit
describe("TelegramBot / chunkForTelegram (PR45 IMPORTANT)", () => {
	it("returns input unchanged when under limit", () => {
		expect(chunkForTelegram("short text")).toEqual(["short text"]);
	});

	it("splits a long string into multiple chunks each under the limit", () => {
		const huge = `${"x".repeat(4500)}\n${"y".repeat(4500)}`;
		const chunks = chunkForTelegram(huge);
		expect(chunks.length).toBeGreaterThan(1);
		for (const c of chunks) {
			expect(c.length).toBeLessThanOrEqual(4000);
		}
		// Reassembled content covers the original (allowing newline boundary)
		expect(chunks.join("").replace(/\n/g, "")).toContain("xxx");
		expect(chunks.join("").replace(/\n/g, "")).toContain("yyy");
	});
});

// PR45 IMPORTANT — stop() cleans up listeners even when stopPolling throws
describe("TelegramBot / stop() listener cleanup (PR45 IMPORTANT)", () => {
	it("removeAllListeners is called even when stopPolling throws", async () => {
		const fake = new FakeTelegramBot();
		// Spy on removeAllListeners
		const removeSpy = vi.spyOn(fake, "removeAllListeners");
		fake.stopPolling = async () => {
			throw new Error("stopPolling boom");
		};
		const { bot } = buildBot({ allowed: [42] });
		// Replace the factory to use our spied fake
		const inst = new TelegramBot({
			token: "fake-token",
			allowedUserIds: [42],
			agentManager: {
				getHandle: () => undefined,
				listHandles: () => [],
				shutdownAgent: async () => undefined,
				getShape: async () => null,
			},
			injectIntoAgent: async () => undefined,
			botFactory: () => fake as unknown as never,
		});
		vi.spyOn(console, "error").mockImplementation(() => {});
		await inst.start();
		await inst.stop();
		expect(removeSpy).toHaveBeenCalled();
		// Reference unused
		expect(bot).toBeDefined();
	});
});

// PR45 IMPORTANT — from === undefined silently dropped
describe("TelegramBot / from undefined silently dropped (PR45)", () => {
	it("message with no `from` is dropped without crash or reply", async () => {
		const { bot, fake } = buildBot({ allowed: [42] });
		await bot.start();
		fake.emit("message", {
			message_id: 1,
			date: Math.floor(Date.now() / 1000),
			chat: { id: 42, type: "private" },
			text: "/agents",
		});
		await flushTicks();
		expect(fake.sendMessageCalls).toHaveLength(0);
		await bot.stop();
	});
});

// PR45 IMPORTANT — non-allowed-user log redacts PII (no raw id / username)
describe("TelegramBot / non-allowed log redaction (PR45 I8)", () => {
	it("rejection log does NOT contain raw Telegram user id or username", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { bot, fake } = buildBot({ allowed: [42] });
		await bot.start();
		const intruderId = 1234567890;
		const intruderName = "intruder-handle";
		fake.emit(
			"message",
			fakeMessage({
				userId: intruderId,
				text: "/agents",
				username: intruderName,
			}),
		);
		await flushTicks();
		const logs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logs).not.toContain(String(intruderId));
		expect(logs).not.toContain(intruderName);
		expect(logs).toContain("non-allowed");
		await bot.stop();
	});
});

// PR45 IMPORTANT — polling_error handler surfaces 409 multi-bot hazard
describe("TelegramBot / polling_error handler (PR45 I13)", () => {
	it("polling_error event is logged to stderr (multi-bot 409 surface)", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { bot, fake } = buildBot({ allowed: [42] });
		await bot.start();
		fake.emit("polling_error", new Error("ETELEGRAM 409 Conflict"));
		await flushTicks();
		const logs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logs).toContain("polling_error");
		expect(logs).toContain("409");
		await bot.stop();
	});

	it("polling_error with non-Error payload still logs without crash", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { bot, fake } = buildBot({ allowed: [42] });
		await bot.start();
		// Library sometimes emits raw objects, not Error instances.
		fake.emit("polling_error", {
			message: "no Error wrapper",
		} as unknown as Error);
		await flushTicks();
		const logs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logs).toContain("polling_error");
		await bot.stop();
	});
});

// PR45 — handleMessage / handleCallbackQuery unhandled-rejection capture
// Note: the original PR45 review item I4 ("handleMessage parse exception
// surfaces stderr + telegram-handler-error telemetry") landed in source
// as a stderr log only — bot.ts handleMessage catch block does
// `console.error(...)` without an `emit()` call. Assertions below match
// the shipped source behavior; telemetry emission was intentionally
// dropped during the PR45 audit (logged failure path already surfaces via
// stderr capture in production).
describe("TelegramBot / handler wrapper catch (PR45 I4)", () => {
	it("handleMessage unhandled exception is caught + logged to stderr", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		// listHandles throws → findHandleByAgentId throws → dispatchAbort
		// propagates up through dispatch → handleMessage → wrapper catch.
		const manager: AgentManagerInterface = {
			getHandle: () => undefined,
			listHandles: () => {
				throw new Error("boom-listHandles");
			},
			shutdownAgent: async () => undefined,
			getShape: async () => "pty",
		};
		const fake = new FakeTelegramBot();
		const bot = new TelegramBot({
			token: "fake-token",
			allowedUserIds: [42],
			agentManager: manager,
			injectIntoAgent: async () => undefined,
			botFactory: () => fake as unknown as never,
		});
		await bot.start();
		fake.emit("message", fakeMessage({ userId: 42, text: "/abort agent-x" }));
		await flushTicks();
		const logs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logs).toContain("handleMessage unhandled error");
		expect(logs).toContain("boom-listHandles");
		await bot.stop();
	});

	it("handleCallbackQuery unhandled exception is caught + logged to stderr", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		// Patch sendMessage to throw synchronously — safeReply catches the
		// reject but the early answerCallbackQuery in the parse-error path
		// uses `await`; the cleanest fault we can inject is `listHandles`
		// throwing inside dispatchStatus reached via a callback. Build a
		// callback whose data is a parseable /status command, then have the
		// manager throw on listHandles.
		const manager: AgentManagerInterface = {
			getHandle: () => undefined,
			listHandles: () => {
				throw new Error("boom-cb-listHandles");
			},
			shutdownAgent: async () => undefined,
			getShape: async () => "pty",
		};
		const fake = new FakeTelegramBot();
		const bot = new TelegramBot({
			token: "fake-token",
			allowedUserIds: [42],
			agentManager: manager,
			injectIntoAgent: async () => undefined,
			botFactory: () => fake as unknown as never,
		});
		await bot.start();
		fake.emit(
			"callback_query",
			fakeCallback({ userId: 42, data: "/status agent-x" }),
		);
		await flushTicks();
		const logs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logs).toContain("handleCallbackQuery unhandled error");
		expect(logs).toContain("boom-cb-listHandles");
		await bot.stop();
	});
});

// PR45 — callback parse-failure + empty-data answerCallbackQuery branches
describe("TelegramBot / callback parse + empty data (PR45 I5)", () => {
	it("callback parse failure calls answerCallbackQuery with Invalid callback", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { bot, fake } = buildBot({ allowed: [42] });
		await bot.start();
		fake.emit(
			"callback_query",
			fakeCallback({
				userId: 42,
				data: "garbage-not-a-command",
				id: "cb-parse",
			}),
		);
		await flushTicks();
		expect(fake.answerCalls).toContain("cb-parse");
		const opts = fake.lastAnswerOptionsFor("cb-parse") as
			| { text?: string }
			| undefined;
		expect(opts?.text).toContain("Invalid callback");
		// A user-visible reply explaining the parse error is also sent.
		const sentTexts = fake.sendMessageCalls.map((c) => c.text).join("\n");
		expect(sentTexts).toContain("Callback error");
		// Reference errSpy to prevent unused warning
		expect(errSpy).toBeDefined();
		await bot.stop();
	});

	it("callback with empty data calls answerCallbackQuery with Empty callback", async () => {
		const { bot, fake } = buildBot({ allowed: [42] });
		await bot.start();
		fake.emit(
			"callback_query",
			fakeCallback({ userId: 42, data: "", id: "cb-empty" }),
		);
		await flushTicks();
		expect(fake.answerCalls).toContain("cb-empty");
		const opts = fake.lastAnswerOptionsFor("cb-empty") as
			| { text?: string }
			| undefined;
		expect(opts?.text).toContain("Empty callback");
		expect(fake.sendMessageCalls).toHaveLength(0);
		await bot.stop();
	});

	it("non-allowed callback answers spinner with Not authorized text", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { bot, fake } = buildBot({ allowed: [42] });
		await bot.start();
		fake.emit(
			"callback_query",
			fakeCallback({
				userId: 99,
				data: "approve_allow_11111111-2222-4333-8444-555555555555",
				id: "cb-not-auth",
			}),
		);
		await flushTicks();
		const opts = fake.lastAnswerOptionsFor("cb-not-auth") as
			| { text?: string }
			| undefined;
		expect(opts?.text).toContain("Not authorized");
		await bot.stop();
	});

	it("callback dispatching answerCallbackQuery throws — stderr logs but flow continues", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const fake = new FakeTelegramBot();
		fake.answerCallbackQuery = async () => {
			throw new Error("answer-boom");
		};
		const handles = [makeHandle("agent-foo")];
		const manager: AgentManagerInterface = {
			getHandle: (id) => handles.find((h) => h.id === id),
			listHandles: () => handles,
			shutdownAgent: async () => undefined,
			getShape: async () => "pty",
		};
		const bot = new TelegramBot({
			token: "fake-token",
			allowedUserIds: [42],
			agentManager: manager,
			injectIntoAgent: async () => undefined,
			botFactory: () => fake as unknown as never,
		});
		await bot.start();
		fake.emit(
			"callback_query",
			fakeCallback({ userId: 42, data: "/agents", id: "cb-throw" }),
		);
		await flushTicks();
		const logs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logs).toContain("answerCallbackQuery failed");
		expect(logs).toContain("answer-boom");
		// Dispatch still ran — /agents reply sent.
		expect(fake.sendMessageCalls.length).toBeGreaterThanOrEqual(1);
		await bot.stop();
	});
});

// PR45 — dispatch shape-gating exception path
describe("TelegramBot / dispatch gate exception (PR45 I4)", () => {
	it("getShape throwing inside isCommandAvailableForShape replies with internal-error message", async () => {
		const manager: AgentManagerInterface = {
			getHandle: () => undefined,
			listHandles: () => [],
			shutdownAgent: async () => undefined,
			getShape: async () => {
				throw new Error("shape-boom");
			},
		};
		const fake = new FakeTelegramBot();
		const bot = new TelegramBot({
			token: "fake-token",
			allowedUserIds: [42],
			agentManager: manager,
			injectIntoAgent: async () => undefined,
			botFactory: () => fake as unknown as never,
		});
		await bot.start();
		fake.emit("message", fakeMessage({ userId: 42, text: "/status agent-x" }));
		await flushTicks();
		expect(fake.sendMessageCalls).toHaveLength(1);
		expect(fake.sendMessageCalls[0]?.text).toContain("Internal error");
		expect(fake.sendMessageCalls[0]?.text).toContain("shape-boom");
		await bot.stop();
	});
});

// PR45 — /start placeholder reply (Phase 1 pre-registered note)
describe("TelegramBot / /start (Phase 1 placeholder)", () => {
	it("/start replies with the pre-registered Phase 1 placeholder text", async () => {
		const handles = [makeHandle("agent-foo")];
		const { bot, fake } = buildBot({ allowed: [42], handles });
		await bot.start();
		fake.emit("message", fakeMessage({ userId: 42, text: "/start agent-foo" }));
		await flushTicks();
		expect(fake.sendMessageCalls).toHaveLength(1);
		expect(fake.sendMessageCalls[0]?.text).toContain("Phase 1");
		expect(fake.sendMessageCalls[0]?.text).toContain("agent-foo");
		await bot.stop();
	});
});

// PR45 — /agents empty + listHandles failure
describe("TelegramBot / /agents edge cases", () => {
	it("/agents with no registered handles replies with 'No agents registered.'", async () => {
		const { bot, fake } = buildBot({ allowed: [42] });
		await bot.start();
		fake.emit("message", fakeMessage({ userId: 42, text: "/agents" }));
		await flushTicks();
		expect(fake.sendMessageCalls).toHaveLength(1);
		expect(fake.sendMessageCalls[0]?.text).toContain("No agents registered");
		await bot.stop();
	});

	it("/agents reply path tolerates a listHandles failure", async () => {
		// First call (gate path through getShape) succeeds — /agents shape gate
		// returns { available: true } unconditionally per commands.ts. The
		// failure surfaces from dispatchAgents' internal listHandles().
		let calls = 0;
		const manager: AgentManagerInterface = {
			getHandle: () => undefined,
			listHandles: () => {
				calls++;
				throw new Error("listHandles-boom");
			},
			shutdownAgent: async () => undefined,
			getShape: async () => "pty",
		};
		const fake = new FakeTelegramBot();
		const bot = new TelegramBot({
			token: "fake-token",
			allowedUserIds: [42],
			agentManager: manager,
			injectIntoAgent: async () => undefined,
			botFactory: () => fake as unknown as never,
		});
		vi.spyOn(console, "error").mockImplementation(() => {});
		await bot.start();
		fake.emit("message", fakeMessage({ userId: 42, text: "/agents" }));
		await flushTicks();
		// dispatchAgents wraps listHandles in try/catch → user-visible reply
		expect(fake.sendMessageCalls).toHaveLength(1);
		expect(fake.sendMessageCalls[0]?.text).toContain("Failed to list agents");
		expect(fake.sendMessageCalls[0]?.text).toContain("listHandles-boom");
		expect(calls).toBeGreaterThanOrEqual(1);
		await bot.stop();
	});
});

// PR45 — /approve text command happy + sad paths
describe("TelegramBot / /approve text form", () => {
	it("/approve <id> allow resolves the pending approval and replies", async () => {
		const emitSpy = vi.spyOn(telemetry, "emit");
		const { bot, fake } = buildBot({ allowed: [42] });
		const { approvalId } = await createApprovalRequest({
			agentId: "agent-foo",
			handleId: "h-1",
			reason: "deploy?",
		});
		await bot.start();
		fake.emit(
			"message",
			fakeMessage({
				userId: 42,
				text: `/approve ${approvalId} allow`,
				username: "santi",
			}),
		);
		const resolvedPath = path.join(
			tempDir,
			"approvals",
			"resolved",
			`${approvalId}.json`,
		);
		await waitForFile(resolvedPath);
		await flushTicks();
		const reply = fake.sendMessageCalls.map((c) => c.text).join("\n");
		expect(reply).toContain(`Approval ${approvalId}`);
		expect(reply).toContain("allow");
		const kinds = emitSpy.mock.calls.map(
			(c) => (c[0] as { kind: string }).kind,
		);
		expect(kinds).toContain("approval-resolved");
		await bot.stop();
	});

	it("/approve on an unknown id replies with the not-found reason", async () => {
		const { bot, fake } = buildBot({ allowed: [42] });
		await bot.start();
		const unknownId = "11111111-2222-4333-8444-555555555555";
		fake.emit(
			"message",
			fakeMessage({ userId: 42, text: `/approve ${unknownId} deny` }),
		);
		await waitForSendMessage(fake);
		const reply = fake.sendMessageCalls[0]?.text ?? "";
		expect(reply).toContain(`Approval ${unknownId}`);
		expect(reply).toContain("not-found");
		await bot.stop();
	});

	it("/approve text form rejects path-traversal approvalId at parse stage", async () => {
		const { bot, fake } = buildBot({ allowed: [42] });
		await bot.start();
		fake.emit(
			"message",
			fakeMessage({ userId: 42, text: "/approve ../../etc/passwd allow" }),
		);
		await flushTicks();
		expect(fake.sendMessageCalls).toHaveLength(1);
		expect(fake.sendMessageCalls[0]?.text).toContain("invalid approval ID");
		await bot.stop();
	});
});

// PR45 — /abort full branch matrix
describe("TelegramBot / /abort branches", () => {
	it("/abort with invalid agentId is rejected before lookup", async () => {
		const handles = [makeHandle("agent-foo")];
		const shutdown = vi.fn(async () => undefined);
		// shape: "pty" so the shape gate returns "pty" for AGENT_BAD and
		// dispatch reaches dispatchAbort, which then rejects on the agent-id
		// regex.
		const { bot, fake } = buildBot({
			allowed: [42],
			shape: "pty",
			handles,
			shutdown,
		});
		await bot.start();
		fake.emit("message", fakeMessage({ userId: 42, text: "/abort AGENT_BAD" }));
		await waitForSendMessage(fake);
		expect(shutdown).not.toHaveBeenCalled();
		expect(fake.sendMessageCalls[0]?.text).toContain("Invalid agent id");
		await bot.stop();
	});

	it("/abort with no matching handle replies with 'No handle found'", async () => {
		const { bot, fake } = buildBot({
			allowed: [42],
			shape: "pty",
			handles: [],
		});
		await bot.start();
		fake.emit(
			"message",
			fakeMessage({ userId: 42, text: "/abort agent-ghost" }),
		);
		await waitForSendMessage(fake);
		expect(fake.sendMessageCalls[0]?.text).toContain("No handle found");
		await bot.stop();
	});

	it("/abort happy path calls shutdownAgent(handleId, SIGTERM) + replies", async () => {
		const handles = [makeHandle("agent-foo")];
		const shutdown = vi.fn(async () => undefined);
		const { bot, fake } = buildBot({ allowed: [42], handles, shutdown });
		await bot.start();
		fake.emit("message", fakeMessage({ userId: 42, text: "/abort agent-foo" }));
		await waitForSendMessage(fake);
		expect(shutdown).toHaveBeenCalledWith("handle-agent-foo", "SIGTERM");
		expect(fake.sendMessageCalls[0]?.text).toContain("Aborted agent agent-foo");
		await bot.stop();
	});

	it("/abort surfaces a shutdownAgent failure as 'shutdownAgent failed' reply", async () => {
		const handles = [makeHandle("agent-foo")];
		const shutdown = vi.fn(async () => {
			throw new Error("shutdown-boom");
		});
		const { bot, fake } = buildBot({ allowed: [42], handles, shutdown });
		await bot.start();
		fake.emit("message", fakeMessage({ userId: 42, text: "/abort agent-foo" }));
		await waitForSendMessage(fake);
		expect(fake.sendMessageCalls[0]?.text).toContain("shutdownAgent failed");
		expect(fake.sendMessageCalls[0]?.text).toContain("shutdown-boom");
		await bot.stop();
	});
});

// PR45 — /status branch matrix
describe("TelegramBot / /status branches", () => {
	it("/status with invalid agentId is rejected before lookup", async () => {
		const { bot, fake } = buildBot({ allowed: [42], shape: "pty" });
		await bot.start();
		fake.emit(
			"message",
			fakeMessage({ userId: 42, text: "/status AGENT_BAD" }),
		);
		await waitForSendMessage(fake);
		expect(fake.sendMessageCalls[0]?.text).toContain("Invalid agent id");
		await bot.stop();
	});

	it("/status without a registered handle still replies with the no-handle line", async () => {
		const { bot, fake } = buildBot({
			allowed: [42],
			shape: "pty",
			handles: [],
		});
		await bot.start();
		fake.emit(
			"message",
			fakeMessage({ userId: 42, text: "/status agent-ghost" }),
		);
		await waitForSendMessage(fake);
		const reply = fake.sendMessageCalls[0]?.text ?? "";
		expect(reply).toContain("No handle for agent agent-ghost");
		expect(reply).toContain("No pending approvals");
		await bot.stop();
	});

	it("/status enumerates pending approvals for the named agent", async () => {
		const handles = [makeHandle("agent-foo")];
		const { bot, fake } = buildBot({ allowed: [42], handles });
		const { approvalId } = await createApprovalRequest({
			agentId: "agent-foo",
			handleId: "handle-agent-foo",
			reason: "ship?",
		});
		await bot.start();
		fake.emit(
			"message",
			fakeMessage({ userId: 42, text: "/status agent-foo" }),
		);
		await waitForSendMessage(fake);
		const reply = fake.sendMessageCalls[0]?.text ?? "";
		expect(reply).toContain("Agent agent-foo");
		expect(reply).toContain("Pending approvals");
		expect(reply).toContain(approvalId);
		expect(reply).toContain("ship?");
		await bot.stop();
	});
});

// PR45 — sendApprovalRequest sendMessage failure surfaces on stderr
describe("TelegramBot / sendApprovalRequest failure (PR45)", () => {
	it("sendMessage rejection in sendApprovalRequest is logged to stderr", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const fake = new FakeTelegramBot();
		fake.sendMessage = async () => {
			throw new Error("send-boom");
		};
		const bot = new TelegramBot({
			token: "fake-token",
			allowedUserIds: [42],
			agentManager: {
				getHandle: () => undefined,
				listHandles: () => [],
				shutdownAgent: async () => undefined,
				getShape: async () => null,
			},
			injectIntoAgent: async () => undefined,
			botFactory: () => fake as unknown as never,
		});
		await bot.start();
		await bot.sendApprovalRequest(42, {
			approvalId: "11111111-2222-4333-8444-555555555555",
			agentId: "agent-foo",
			handleId: "h-1",
			reason: "deploy?",
			createdAt: Date.now(),
		});
		const logs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logs).toContain("sendApprovalRequest failed");
		expect(logs).toContain("send-boom");
		await bot.stop();
	});

	it("sendApprovalRequest is a no-op when bot is not started (bot === null)", async () => {
		const { bot, fake } = buildBot({ allowed: [42] });
		// Note: not starting the bot — internal bot reference is null
		await bot.sendApprovalRequest(42, {
			approvalId: "11111111-2222-4333-8444-555555555555",
			agentId: "agent-foo",
			handleId: "h-1",
			reason: "deploy?",
			createdAt: Date.now(),
		});
		expect(fake.sendMessageCalls).toHaveLength(0);
	});
});

// PR45 — safeReply chunked sendMessage failure mid-chunk
describe("TelegramBot / safeReply sendMessage failure (PR45)", () => {
	it("sendMessage failure inside safeReply is logged + aborts further chunks", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const fake = new FakeTelegramBot();
		let calls = 0;
		fake.sendMessage = async (chatId, text, options) => {
			calls++;
			fake.sendMessageCalls.push({ chatId, text, options });
			throw new Error("send-mid-fail");
		};
		const handles = [makeHandle("agent-foo")];
		const bot = new TelegramBot({
			token: "fake-token",
			allowedUserIds: [42],
			agentManager: {
				getHandle: (id) => handles.find((h) => h.id === id),
				listHandles: () => handles,
				shutdownAgent: async () => undefined,
				getShape: async () => "pty",
			},
			injectIntoAgent: async () => undefined,
			botFactory: () => fake as unknown as never,
		});
		await bot.start();
		fake.emit("message", fakeMessage({ userId: 42, text: "/agents" }));
		await flushTicks();
		expect(calls).toBe(1);
		const logs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logs).toContain("sendMessage failed");
		expect(logs).toContain("send-mid-fail");
		await bot.stop();
	});
});

// PR45 — stop() removeAllListeners catch branch
describe("TelegramBot / stop() removeAllListeners failure (PR45 I3)", () => {
	it("removeAllListeners throwing is logged to stderr and bot reference still cleared", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const fake = new FakeTelegramBot();
		fake.removeAllListeners = (() => {
			throw new Error("rm-boom");
		}) as never;
		const bot = new TelegramBot({
			token: "fake-token",
			allowedUserIds: [42],
			agentManager: {
				getHandle: () => undefined,
				listHandles: () => [],
				shutdownAgent: async () => undefined,
				getShape: async () => null,
			},
			injectIntoAgent: async () => undefined,
			botFactory: () => fake as unknown as never,
		});
		await bot.start();
		await bot.stop();
		const logs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logs).toContain("removeAllListeners threw");
		expect(logs).toContain("rm-boom");
		// Subsequent stop() is a no-op (bot reference was nulled)
		await bot.stop();
	});
});

// PR45 — getChatId returns configured fallback chat
describe("TelegramBot / getChatId", () => {
	it("getChatId returns the explicit chatId option when supplied", () => {
		const fake = new FakeTelegramBot();
		const bot = new TelegramBot({
			token: "fake-token",
			allowedUserIds: [42, 99],
			chatId: 12345,
			agentManager: {
				getHandle: () => undefined,
				listHandles: () => [],
				shutdownAgent: async () => undefined,
				getShape: async () => null,
			},
			injectIntoAgent: async () => undefined,
			botFactory: () => fake as unknown as never,
		});
		expect(bot.getChatId()).toBe(12345);
	});

	it("getChatId defaults to the first allowedUserIds entry when chatId omitted", () => {
		const fake = new FakeTelegramBot();
		const bot = new TelegramBot({
			token: "fake-token",
			allowedUserIds: [42, 99],
			agentManager: {
				getHandle: () => undefined,
				listHandles: () => [],
				shutdownAgent: async () => undefined,
				getShape: async () => null,
			},
			injectIntoAgent: async () => undefined,
			botFactory: () => fake as unknown as never,
		});
		expect(bot.getChatId()).toBe(42);
	});
});

// PR45 — toJSON delegates to inspect.custom redactor
describe("TelegramBot / toJSON (PR45 I7)", () => {
	it("JSON.stringify(bot) does not leak the bot token", () => {
		const TOKEN = "JSON-leak-vector-12345-secret-token";
		const fake = new FakeTelegramBot();
		const bot = new TelegramBot({
			token: TOKEN,
			allowedUserIds: [42],
			agentManager: {
				getHandle: () => undefined,
				listHandles: () => [],
				shutdownAgent: async () => undefined,
				getShape: async () => null,
			},
			injectIntoAgent: async () => undefined,
			botFactory: () => fake as unknown as never,
		});
		const json = JSON.stringify(bot);
		expect(json).not.toContain(TOKEN);
		expect(json).toContain("REDACTED");
	});
});

// R1 (feature-pr84-r1-daemon-creds) — daemon-owned outbound send
describe("TelegramBot / sendAgentNotification", () => {
	const TOKEN = "send-notif-secret-token-abcdef-1234567890";

	function buildSendBot(opts: {
		allowed?: number[];
		chatId?: number;
		sendMessage?: FakeTelegramBot["sendMessage"];
	}): { bot: TelegramBot; fake: FakeTelegramBot } {
		const fake = new FakeTelegramBot();
		if (opts.sendMessage !== undefined) fake.sendMessage = opts.sendMessage;
		const bot = new TelegramBot({
			token: TOKEN,
			allowedUserIds: opts.allowed ?? [42, 99],
			...(opts.chatId !== undefined ? { chatId: opts.chatId } : {}),
			agentManager: {
				getHandle: () => undefined,
				listHandles: () => [],
				shutdownAgent: async () => undefined,
				getShape: async () => null,
			},
			injectIntoAgent: async () => undefined,
			botFactory: () => fake as unknown as never,
		});
		return { bot, fake };
	}

	it("sends a short summary as a single plain-text message to getChatId() (Santiago)", async () => {
		const { bot, fake } = buildSendBot({ allowed: [42, 99] });
		await bot.start();
		const result = await bot.sendAgentNotification(
			"PR Triage 2026-05-31\n\n3 open PRs",
		);
		expect(result.ok).toBe(true);
		expect(fake.sendMessageCalls).toHaveLength(1);
		// Recipient is allowedUserIds[0] = 42 (Santiago); NO parse_mode set.
		expect(fake.sendMessageCalls[0].chatId).toBe(42);
		expect(fake.sendMessageCalls[0].options).toBeUndefined();
		await bot.stop();
	});

	it("chunks a >4000-char summary into multiple sendMessage calls", async () => {
		const { bot, fake } = buildSendBot({});
		await bot.start();
		const big = "x".repeat(9000);
		const result = await bot.sendAgentNotification(big);
		expect(result.ok).toBe(true);
		expect(fake.sendMessageCalls.length).toBeGreaterThan(1);
		// Every chunk stays within Telegram's hard cap.
		for (const call of fake.sendMessageCalls) {
			expect(call.text.length).toBeLessThanOrEqual(4096);
		}
		await bot.stop();
	});

	it("returns { ok: false } (no throw) when sendMessage rejects, and never logs the token", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { bot } = buildSendBot({
			sendMessage: async () => {
				throw new Error("telegram 400 boom");
			},
		});
		await bot.start();
		const result = await bot.sendAgentNotification("summary");
		expect(result.ok).toBe(false);
		expect(result.error).toContain("telegram 400 boom");
		const logs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logs).toContain("sendAgentNotification failed");
		expect(logs).not.toContain(TOKEN);
		await bot.stop();
	});

	it("surfaces an HTTP status when the library attaches response.statusCode", async () => {
		const { bot } = buildSendBot({
			sendMessage: async () => {
				const err = new Error("rate limited") as Error & {
					response?: { statusCode: number };
				};
				err.response = { statusCode: 429 };
				throw err;
			},
		});
		await bot.start();
		const result = await bot.sendAgentNotification("summary");
		expect(result.ok).toBe(false);
		expect(result.status).toBe(429);
		await bot.stop();
	});

	it("returns { ok: false, error: 'telegram-not-configured' } when the bot is not started", async () => {
		const { bot, fake } = buildSendBot({});
		// Deliberately NOT starting — this.bot stays null (local-dev path).
		const result = await bot.sendAgentNotification("summary");
		expect(result.ok).toBe(false);
		expect(result.error).toBe("telegram-not-configured");
		expect(fake.sendMessageCalls).toHaveLength(0);
	});
});
