import { describe, expect, it } from "vitest";

import type { AgentShape } from "../agent-runtime/types.js";
import { isCommandAvailableForShape, parseCommand } from "./commands.js";

describe("commands / parseCommand", () => {
	it("parses /start agent-foo", () => {
		const r = parseCommand("/start agent-foo");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.command).toEqual({ name: "start", agent: "agent-foo" });
		}
	});

	it("parses /agents", () => {
		const r = parseCommand("/agents");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.command).toEqual({ name: "agents" });
		}
	});

	it("parses /approve_allow_abc123 (callback form)", () => {
		const r = parseCommand("/approve_allow_abc123");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.command).toEqual({
				name: "approve",
				approvalId: "abc123",
				decision: "allow",
			});
		}
	});

	it("parses /approve_deny_xyz (callback form)", () => {
		const r = parseCommand("/approve_deny_xyz");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.command).toEqual({
				name: "approve",
				approvalId: "xyz",
				decision: "deny",
			});
		}
	});

	it("parses text-form /approve abc deny", () => {
		const r = parseCommand("/approve abc deny");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.command).toEqual({
				name: "approve",
				approvalId: "abc",
				decision: "deny",
			});
		}
	});

	it("parses /abort agent-foo", () => {
		const r = parseCommand("/abort agent-foo");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.command).toEqual({ name: "abort", agent: "agent-foo" });
		}
	});

	it("parses /inject agent-foo hello world (joins remaining tokens)", () => {
		const r = parseCommand("/inject agent-foo hello world");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.command).toEqual({
				name: "inject",
				agent: "agent-foo",
				text: "hello world",
			});
		}
	});

	it("parses /status agent-foo", () => {
		const r = parseCommand("/status agent-foo");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.command).toEqual({ name: "status", agent: "agent-foo" });
		}
	});

	it("/start (missing agent) returns missing argument error", () => {
		const r = parseCommand("/start");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toContain("missing argument");
			expect(r.error).toContain("agent");
		}
	});

	it("/unknown returns unknown command error", () => {
		const r = parseCommand("/unknown");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toContain("unknown command");
		}
	});

	it("/inject agent-foo (missing text) returns missing argument: text", () => {
		const r = parseCommand("/inject agent-foo");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toBe("missing argument: text");
		}
	});
});

describe("commands / isCommandAvailableForShape", () => {
	it("/inject on a PTY agent returns available", async () => {
		const getShape = async (): Promise<AgentShape | null> => "pty";
		const result = await isCommandAvailableForShape(
			{ name: "inject", agent: "agent-foo", text: "hello" },
			getShape,
		);
		expect(result.available).toBe(true);
	});

	it("/inject on an HTTP agent returns rejection", async () => {
		const getShape = async (): Promise<AgentShape | null> => "http";
		const result = await isCommandAvailableForShape(
			{ name: "inject", agent: "agent-foo", text: "hello" },
			getShape,
		);
		expect(result.available).toBe(false);
		if (!result.available) {
			expect(result.reason).toContain("inject");
			expect(result.reason).toContain("pty");
		}
	});

	it.each([["pty"], ["http"], ["mcp"], ["event"], ["daemon"]] as const)(
		"/start is available for shape %s",
		async ([shape]) => {
			const getShape = async (): Promise<AgentShape | null> =>
				shape as AgentShape;
			const result = await isCommandAvailableForShape(
				{ name: "start", agent: "agent-foo" },
				getShape,
			);
			expect(result.available).toBe(true);
		},
	);

	it("/inject on an unregistered agent returns 'agent not registered'", async () => {
		const getShape = async (): Promise<AgentShape | null> => null;
		const result = await isCommandAvailableForShape(
			{ name: "inject", agent: "agent-missing", text: "hello" },
			getShape,
		);
		expect(result.available).toBe(false);
		if (!result.available) {
			expect(result.reason).toBe("agent not registered: agent-missing");
		}
	});

	it("/agents is global — never calls getShape", async () => {
		let called = false;
		const getShape = async (): Promise<AgentShape | null> => {
			called = true;
			return null;
		};
		const result = await isCommandAvailableForShape(
			{ name: "agents" },
			getShape,
		);
		expect(result.available).toBe(true);
		expect(called).toBe(false);
	});

	it("/approve is global — never calls getShape", async () => {
		let called = false;
		const getShape = async (): Promise<AgentShape | null> => {
			called = true;
			return null;
		};
		const result = await isCommandAvailableForShape(
			{ name: "approve", approvalId: "x", decision: "allow" },
			getShape,
		);
		expect(result.available).toBe(true);
		expect(called).toBe(false);
	});

	it("/abort on an unregistered agent returns rejection", async () => {
		const getShape = async (): Promise<AgentShape | null> => null;
		const result = await isCommandAvailableForShape(
			{ name: "abort", agent: "missing" },
			getShape,
		);
		expect(result.available).toBe(false);
		if (!result.available) {
			expect(result.reason).toBe("agent not registered: missing");
		}
	});
});
