import { describe, expect, it } from "vitest";

import type { AgentShape } from "../agent-runtime/types.js";
import { isCommandAvailableForShape, parseCommand } from "./commands.js";

// PR45 critical: approvalId must match UUID v4. Tests that previously
// used arbitrary strings like "abc123" must use real UUIDs now.
const UUID_A = "11111111-2222-4333-8444-555555555555";
const UUID_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

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

	it("parses /approve_allow_<uuid> (callback form)", () => {
		const r = parseCommand(`/approve_allow_${UUID_A}`);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.command).toEqual({
				name: "approve",
				approvalId: UUID_A,
				decision: "allow",
			});
		}
	});

	it("parses approve_allow_<uuid> without leading slash (inline-keyboard callback_data format)", () => {
		const r = parseCommand(`approve_allow_${UUID_A}`);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.command).toEqual({
				name: "approve",
				approvalId: UUID_A,
				decision: "allow",
			});
		}
	});

	it("parses approve_deny_<uuid> without leading slash (inline-keyboard callback_data format)", () => {
		const r = parseCommand(`approve_deny_${UUID_B}`);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.command).toEqual({
				name: "approve",
				approvalId: UUID_B,
				decision: "deny",
			});
		}
	});

	it("parses /approve_deny_<uuid> (callback form)", () => {
		const r = parseCommand(`/approve_deny_${UUID_B}`);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.command).toEqual({
				name: "approve",
				approvalId: UUID_B,
				decision: "deny",
			});
		}
	});

	it("parses text-form /approve <uuid> deny", () => {
		const r = parseCommand(`/approve ${UUID_A} deny`);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.command).toEqual({
				name: "approve",
				approvalId: UUID_A,
				decision: "deny",
			});
		}
	});

	// PR45 CRITICAL — approvalId validation closes path-traversal surface
	it("rejects /approve ../../agents/foo allow (path-traversal attempt via text form)", () => {
		const r = parseCommand("/approve ../../agents/foo allow");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toContain("invalid approval ID");
		}
	});

	it("rejects callback approve_allow_../../etc/passwd (path-traversal attempt via callback)", () => {
		const r = parseCommand("approve_allow_../../etc/passwd");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toContain("invalid approval ID");
		}
	});

	it("rejects callback approve_allow_<uuid>.extra (UUID with trailing chars)", () => {
		const r = parseCommand(`approve_allow_${UUID_A}.extra`);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toContain("invalid approval ID");
		}
	});

	it("rejects /approve abc123 allow (legacy short id no longer accepted)", () => {
		const r = parseCommand("/approve abc123 allow");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toContain("invalid approval ID");
		}
	});

	it("rejects callback approve_allow_<uuid with path separator> (defense-in-depth)", () => {
		const r = parseCommand(
			"approve_allow_11111111-2222/4333-8444-555555555555",
		);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toContain("invalid approval ID");
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

	// PR45 M2 — whitespace preservation. tokens.slice(2).join(" ")
	// collapsed every run of whitespace to a single space, which silently
	// rewrote multi-line payloads before they reached the PTY. The
	// slice-from-prefix implementation preserves newlines + tabs +
	// repeated spaces verbatim.
	it("parses /inject and preserves newlines + repeated whitespace in payload", () => {
		const r = parseCommand("/inject claude-main hello\n  world");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.command).toEqual({
				name: "inject",
				agent: "claude-main",
				text: "hello\n  world",
			});
		}
	});

	it("parses /inject and preserves tabs in payload", () => {
		const r = parseCommand("/inject claude-main col1\tcol2\tcol3");
		expect(r.ok).toBe(true);
		if (r.ok && r.command.name === "inject") {
			expect(r.command.text).toBe("col1\tcol2\tcol3");
		}
	});

	it("parses /inject when a TAB separates agent from text (any-whitespace boundary)", () => {
		// Regression: a literal indexOf(" ") boundary folded a tab-separated
		// agent/text into the agent token (then "missing argument: text").
		const r = parseCommand("/inject claude-main\thello world");
		expect(r.ok).toBe(true);
		if (r.ok && r.command.name === "inject") {
			expect(r.command.agent).toBe("claude-main");
			expect(r.command.text).toBe("hello world");
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
