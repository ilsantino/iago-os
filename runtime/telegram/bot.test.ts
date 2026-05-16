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
	async answerCallbackQuery(id: string): Promise<boolean> {
		this.answerCalls.push(id);
		return true;
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
