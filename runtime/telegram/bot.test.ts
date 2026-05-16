import { EventEmitter } from "node:events";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentHandle, AgentShape } from "../agent-runtime/types.js";
import { ensureStateDirsSync } from "../daemon/state-paths.js";
import * as telemetry from "../daemon/telemetry.js";
import { createApprovalRequest } from "./approval-bus.js";
import { type AgentManagerInterface, TelegramBot } from "./bot.js";

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
