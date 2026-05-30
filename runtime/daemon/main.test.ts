/**
 * Unit tests for pure-function exports of `runtime/daemon/main.ts`.
 *
 * Plan feature-phase-1-deferred-hardening/03 Task 2: lift `daemon/main.ts`
 * from 62.89% to ≥80% lines + 75% branches. The wire branches
 * (startDaemon / shutdown stages, signal handlers) are exercised by the
 * extended `runtime/integration/hello-world.test.ts` suite. THIS file
 * targets the 8 pure helpers:
 *
 *   loadPersistedConfigs, withTimeout, buildFleetHealth,
 *   getShapeForAgent, injectIntoAgent, findHandleForAgent,
 *   resolveSessionId, isDirectlyExecuted.
 */

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type AgentRuntime,
	_resetRegistryForTests,
	registerRuntime,
} from "../agent-runtime/registry.js";
import type {
	AgentHandle,
	AgentMessage,
	AgentShape,
} from "../agent-runtime/types.js";

import type { AgentManager } from "./agent-manager.js";
import type { AgentConfig } from "./config.js";
import { ensureStateDirsSync, pathFor } from "./state-paths.js";

import {
	type AgentConfigShape,
	SHUTDOWN_STAGE_TIMEOUT_MS,
	type TaskDispatchEvent,
	buildFleetHealth,
	computeRunUnder,
	findHandleForAgent,
	getShapeForAgent,
	injectIntoAgent,
	isDirectlyExecuted,
	loadAgentConfig,
	loadPersistedConfigs,
	makeDaemonStartupSessionId,
	makeTaskDispatchHandler,
	resolveSessionId,
	withTimeout,
} from "./main.js";

// ---------------------------------------------------------------------------
// Per-test environment — every test gets a fresh state root via
// IAGO_DAEMON_STATE_ROOT so loadPersistedConfigs reads from a known dir.
// ---------------------------------------------------------------------------

let tempDir: string;
let originalArgv: string[];

beforeEach(async () => {
	tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-main-test-"));
	process.env.IAGO_DAEMON_STATE_ROOT = tempDir;
	originalArgv = [...process.argv];
	ensureStateDirsSync();
	_resetRegistryForTests();
});

afterEach(async () => {
	delete process.env.IAGO_DAEMON_STATE_ROOT;
	process.argv = originalArgv;
	vi.restoreAllMocks();
	vi.useRealTimers();
	_resetRegistryForTests();
	await fsp.rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHandle(opts: {
	id?: string;
	agentId: string;
	runtime?: string;
	shape?: AgentShape;
}): AgentHandle {
	return {
		id: opts.id ?? `handle-${opts.agentId}`,
		runtime: opts.runtime ?? "fixture",
		shape: opts.shape ?? "pty",
		agentId: opts.agentId,
		sessionId: `session-${opts.agentId}`,
		generationToken: 1,
		spawnedAt: 1000,
		markerPath: "/tmp/marker",
	};
}

function makeManager(handles: AgentHandle[]): AgentManager {
	return {
		listHandles: () => handles,
	} as unknown as AgentManager;
}

function writeAgentFile(handleId: string, payload: unknown): Promise<void> {
	return fsp.writeFile(
		path.join(pathFor("agents"), `${handleId}.json`),
		typeof payload === "string" ? payload : JSON.stringify(payload),
	);
}

// ---------------------------------------------------------------------------
// loadPersistedConfigs
// ---------------------------------------------------------------------------

describe("loadPersistedConfigs", () => {
	it("returns an empty Map when the agents dir does not exist (ENOENT)", async () => {
		// Remove the agents dir ensureStateDirsSync created above.
		await fsp.rm(pathFor("agents"), { recursive: true, force: true });
		const result = await loadPersistedConfigs();
		expect(result.size).toBe(0);
	});

	it("returns an empty Map and logs to stderr on non-ENOENT readdir error", async () => {
		// Replace agents dir with a regular file so readdir throws ENOTDIR
		// (a non-ENOENT errno). This avoids ESM namespace re-stubbing which
		// throws "Cannot redefine property" on `fsp.readdir` under Node 20.
		await fsp.rm(pathFor("agents"), { recursive: true, force: true });
		await fsp.writeFile(pathFor("agents"), "not a directory");
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const result = await loadPersistedConfigs();
		expect(result.size).toBe(0);
		const logs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logs).toContain("readdir");
		expect(logs).toMatch(/ENOTDIR|EACCES|EPERM/);
	});

	it("skips directory entries without a .json extension", async () => {
		await fsp.writeFile(path.join(pathFor("agents"), "notes.txt"), "ignore me");
		const result = await loadPersistedConfigs();
		expect(result.size).toBe(0);
	});

	it("logs and continues on a per-file read error", async () => {
		// Create a *directory* named like a .json entry so readdir lists it
		// but readFile throws EISDIR. Avoids ESM namespace re-stubbing.
		await fsp.mkdir(path.join(pathFor("agents"), "h-eisdir.json"), {
			recursive: true,
		});
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const result = await loadPersistedConfigs();
		expect(result.size).toBe(0);
		const logs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logs).toContain("read");
		expect(logs).toMatch(/EISDIR|EACCES|illegal operation/i);
	});

	it("logs and continues on a JSON parse error", async () => {
		await fsp.writeFile(path.join(pathFor("agents"), "bad.json"), "{not-json");
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const result = await loadPersistedConfigs();
		expect(result.size).toBe(0);
		const logs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logs).toContain("parse");
	});

	it("silently skips files whose parsed JSON is not an object", async () => {
		await fsp.writeFile(
			path.join(pathFor("agents"), "scalar.json"),
			JSON.stringify(42),
		);
		const result = await loadPersistedConfigs();
		expect(result.size).toBe(0);
	});

	it("logs and skips records missing a required field (agentId)", async () => {
		await writeAgentFile("h-missing", {
			// agentId omitted
			runtimeId: "claude-pty",
			cwd: "/tmp",
			sessionId: "s-1",
		});
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const result = await loadPersistedConfigs();
		expect(result.size).toBe(0);
		const logs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logs).toContain("missing required field");
	});

	it("skips records missing runtimeId", async () => {
		await writeAgentFile("h-missing-runtime", {
			agentId: "agent-1",
			cwd: "/tmp",
			sessionId: "s-1",
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const result = await loadPersistedConfigs();
		expect(result.size).toBe(0);
	});

	it("skips records missing cwd", async () => {
		await writeAgentFile("h-missing-cwd", {
			agentId: "agent-1",
			runtimeId: "claude-pty",
			sessionId: "s-1",
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const result = await loadPersistedConfigs();
		expect(result.size).toBe(0);
	});

	it("skips records missing sessionId", async () => {
		await writeAgentFile("h-missing-session", {
			agentId: "agent-1",
			runtimeId: "claude-pty",
			cwd: "/tmp",
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const result = await loadPersistedConfigs();
		expect(result.size).toBe(0);
	});

	it("includes a valid record and normalizes env (string values only)", async () => {
		await writeAgentFile("h-valid", {
			agentId: "agent-good",
			runtimeId: "claude-pty",
			cwd: "/tmp/wd",
			sessionId: "session-1",
			org: "org-a",
			env: { FOO: "bar", PORT: 1234, NESTED: { a: 1 }, KEEP: "yes" },
		});
		const result = await loadPersistedConfigs();
		expect(result.size).toBe(1);
		const entry = result.get("h-valid")!;
		expect(entry.agentId).toBe("agent-good");
		expect(entry.runtimeId).toBe("claude-pty");
		expect(entry.cwd).toBe("/tmp/wd");
		expect(entry.sessionId).toBe("session-1");
		expect(entry.org).toBe("org-a");
		// Non-string env values were skipped; string ones preserved.
		expect(entry.env).toEqual({ FOO: "bar", KEEP: "yes" });
	});

	it("treats env as empty when env field is not an object", async () => {
		await writeAgentFile("h-bad-env", {
			agentId: "agent-x",
			runtimeId: "claude-pty",
			cwd: "/tmp/wd",
			sessionId: "session-1",
			env: "not-an-object",
		});
		const result = await loadPersistedConfigs();
		expect(result.size).toBe(1);
		expect(result.get("h-bad-env")!.env).toEqual({});
	});

	it("treats env as empty when env field is null", async () => {
		await writeAgentFile("h-null-env", {
			agentId: "agent-y",
			runtimeId: "claude-pty",
			cwd: "/tmp/wd",
			sessionId: "session-1",
			env: null,
		});
		const result = await loadPersistedConfigs();
		expect(result.size).toBe(1);
		expect(result.get("h-null-env")!.env).toEqual({});
	});

	it("accepts a record with no env field at all (defaults to empty)", async () => {
		await writeAgentFile("h-no-env", {
			agentId: "agent-z",
			runtimeId: "claude-pty",
			cwd: "/tmp/wd",
			sessionId: "session-1",
		});
		const result = await loadPersistedConfigs();
		expect(result.get("h-no-env")!.env).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

describe("withTimeout", () => {
	it("returns the op's value when it resolves within the timeout", async () => {
		const result = await withTimeout("fast-op", async () => 42, 1_000);
		expect(result).toBe(42);
	});

	it('returns "timeout" and writes a stderr warning when the op exceeds the timeout', async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const result = await withTimeout(
			"slow-op",
			() => new Promise<number>((resolve) => setTimeout(() => resolve(1), 200)),
			20,
		);
		expect(result).toBe("timeout");
		const logs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logs).toContain("slow-op");
		expect(logs).toContain("exceeded");
		expect(logs).toContain("20ms");
	});

	it("clears its timer when the op resolves first (finally block)", async () => {
		// Spy on clearTimeout to assert the finally branch ran.
		const clearSpy = vi.spyOn(global, "clearTimeout");
		const result = await withTimeout("fast-clear", async () => "ok", 5_000);
		expect(result).toBe("ok");
		expect(clearSpy).toHaveBeenCalled();
	});

	it("propagates op rejections (not wrapped as 'timeout')", async () => {
		await expect(
			withTimeout(
				"rejecting-op",
				async () => {
					throw new Error("boom");
				},
				1_000,
			),
		).rejects.toThrow("boom");
	});

	it("uses SHUTDOWN_STAGE_TIMEOUT_MS as the default when timeoutMs is omitted", async () => {
		// Just verifies the constant is exported and the default-arg path
		// works; we don't actually wait the full 10s.
		expect(SHUTDOWN_STAGE_TIMEOUT_MS).toBe(10_000);
		const result = await withTimeout("default", async () => "fine");
		expect(result).toBe("fine");
	});
});

// ---------------------------------------------------------------------------
// buildFleetHealth
// ---------------------------------------------------------------------------

describe("buildFleetHealth", () => {
	it("returns an empty array when the manager has no handles", async () => {
		const result = await buildFleetHealth(makeManager([]));
		expect(result).toEqual([]);
	});

	it("maps every handle to a 5-key health record", async () => {
		const handles = [
			makeHandle({ id: "h-1", agentId: "agent-a", shape: "pty" }),
			makeHandle({ id: "h-2", agentId: "agent-b", shape: "http" }),
		];
		const result = await buildFleetHealth(makeManager(handles));
		expect(result).toHaveLength(2);
		for (const row of result) {
			expect(row).toHaveProperty("handleId");
			expect(row).toHaveProperty("agentId");
			expect(row).toHaveProperty("shape");
			expect(row).toHaveProperty("generationToken");
			expect(row).toHaveProperty("spawnedAt");
		}
		expect(result[0]!.handleId).toBe("h-1");
		expect(result[1]!.agentId).toBe("agent-b");
		expect(result[1]!.shape).toBe("http");
	});
});

// ---------------------------------------------------------------------------
// getShapeForAgent
// ---------------------------------------------------------------------------

describe("getShapeForAgent", () => {
	it("returns the matching handle's shape", async () => {
		const handles = [
			makeHandle({ agentId: "agent-a", shape: "pty" }),
			makeHandle({ agentId: "agent-b", shape: "http" }),
		];
		const shape = await getShapeForAgent(makeManager(handles), "agent-b");
		expect(shape).toBe("http");
	});

	it("returns null when no handle matches the agent id", async () => {
		const handles = [makeHandle({ agentId: "agent-a" })];
		const shape = await getShapeForAgent(makeManager(handles), "missing");
		expect(shape).toBeNull();
	});

	it("returns null on an empty handle list", async () => {
		const shape = await getShapeForAgent(makeManager([]), "any");
		expect(shape).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// findHandleForAgent
// ---------------------------------------------------------------------------

describe("findHandleForAgent", () => {
	it("returns the matching handle", () => {
		const handles = [
			makeHandle({ agentId: "agent-a" }),
			makeHandle({ agentId: "agent-b" }),
		];
		const handle = findHandleForAgent(makeManager(handles), "agent-b");
		expect(handle).not.toBeNull();
		expect(handle?.agentId).toBe("agent-b");
	});

	it("returns null when no handle matches", () => {
		const handles = [makeHandle({ agentId: "agent-a" })];
		const handle = findHandleForAgent(makeManager(handles), "missing");
		expect(handle).toBeNull();
	});

	it("returns null when the manager has no handles", () => {
		const handle = findHandleForAgent(makeManager([]), "agent-a");
		expect(handle).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// injectIntoAgent
// ---------------------------------------------------------------------------

describe("injectIntoAgent", () => {
	function fakeRuntime(id = "test-runtime"): AgentRuntime & {
		sendCalls: Array<{ handle: AgentHandle; message: AgentMessage }>;
	} {
		const sendCalls: Array<{ handle: AgentHandle; message: AgentMessage }> = [];
		const rt: AgentRuntime = {
			shape: "pty",
			id,
			version: "1.0.0",
			interfaceVersion: "v1",
			spawn: async () => {
				throw new Error("not used");
			},
			send: async (handle, message) => {
				sendCalls.push({ handle, message });
			},
			onStatusChanged: () => () => undefined,
			isAlive: async () => true,
			shutdown: async () => undefined,
			restoreFromMarker: async () => null,
		};
		return Object.assign(rt, { sendCalls });
	}

	it("throws when no handle exists for the agent id", async () => {
		await expect(
			injectIntoAgent(makeManager([]), "missing", "hello"),
		).rejects.toThrow("no live handle for agent: missing");
	});

	it("forwards the text to the resolved runtime via send()", async () => {
		const rt = fakeRuntime("rt-inject-1");
		registerRuntime(rt);
		const handle = makeHandle({
			agentId: "agent-a",
			runtime: "rt-inject-1",
		});
		await injectIntoAgent(makeManager([handle]), "agent-a", "hello world");
		expect(rt.sendCalls).toHaveLength(1);
		expect(rt.sendCalls[0]!.message).toEqual({
			kind: "inject",
			payload: { text: "hello world" },
		});
		expect(rt.sendCalls[0]!.handle.id).toBe(handle.id);
	});

	it("propagates send() failures from the runtime", async () => {
		const rt: AgentRuntime = {
			shape: "pty",
			id: "rt-inject-2",
			version: "1.0.0",
			interfaceVersion: "v1",
			spawn: async () => {
				throw new Error("not used");
			},
			send: async () => {
				throw new Error("send boom");
			},
			onStatusChanged: () => () => undefined,
			isAlive: async () => true,
			shutdown: async () => undefined,
			restoreFromMarker: async () => null,
		};
		registerRuntime(rt);
		const handle = makeHandle({
			agentId: "agent-b",
			runtime: "rt-inject-2",
		});
		await expect(
			injectIntoAgent(makeManager([handle]), "agent-b", "x"),
		).rejects.toThrow("send boom");
	});
});

// ---------------------------------------------------------------------------
// resolveSessionId
// ---------------------------------------------------------------------------

describe("resolveSessionId", () => {
	function cfgWith(env: Record<string, string>): AgentConfig {
		return {
			agentId: "agent-x",
			runtimeId: "claude-pty",
			cwd: "/tmp",
			env,
			autoStart: true,
		};
	}

	it("returns env.CLAUDE_CODE_SESSION_ID when present and non-empty", () => {
		const id = resolveSessionId(cfgWith({ CLAUDE_CODE_SESSION_ID: "abc123" }));
		expect(id).toBe("abc123");
	});

	it("derives ${agentId}-session when CLAUDE_CODE_SESSION_ID is unset", () => {
		const id = resolveSessionId(cfgWith({}));
		expect(id).toBe("agent-x-session");
	});

	it("derives ${agentId}-session when CLAUDE_CODE_SESSION_ID is the empty string", () => {
		const id = resolveSessionId(cfgWith({ CLAUDE_CODE_SESSION_ID: "" }));
		expect(id).toBe("agent-x-session");
	});
});

// ---------------------------------------------------------------------------
// isDirectlyExecuted
// ---------------------------------------------------------------------------

describe("isDirectlyExecuted", () => {
	it("returns false when process.argv[1] is undefined", () => {
		// process.argv is a real Array; deleting the index keeps the
		// property reference but the slot reads as undefined.
		// Replace via index assignment with undefined cast — node accepts
		// argv[1] = undefined at runtime but TypeScript types are strict.
		const next = [...originalArgv];
		next.length = 1; // truncate so [1] is undefined
		process.argv = next;
		expect(isDirectlyExecuted()).toBe(false);
	});

	it("returns true when process.argv[1] resolves to main.ts's own file URL", () => {
		// Compute main.ts's own URL from this test file's location.
		const mainUrl = new URL("./main.ts", import.meta.url).href;
		const mainPath = fileURLToPath(mainUrl);
		process.argv = [process.argv[0]!, mainPath];
		// Note: the test is meaningful only when main.ts is loaded as a
		// .ts module under vitest. If the bundled .js path is loaded
		// instead (production), the comparison would still equal because
		// import.meta.url tracks the executing module.
		expect(isDirectlyExecuted()).toBe(true);
	});

	it("returns false when process.argv[1] points to an unrelated file", () => {
		// Use a real path that's not main.ts so pathToFileURL succeeds but
		// the URL does NOT match import.meta.url.
		process.argv = [process.argv[0]!, path.join(tempDir, "other.ts")];
		expect(isDirectlyExecuted()).toBe(false);
	});

	it("returns false when pathToFileURL throws on argv[1]", () => {
		// NUL byte is rejected by pathToFileURL (ERR_INVALID_ARG_VALUE).
		// Cover the catch branch without mocking node:url.
		process.argv = [process.argv[0]!, "\x00"];
		expect(isDirectlyExecuted()).toBe(false);
	});

	it("returns false when argv[1] is the empty string", () => {
		// Empty string is treated as undefined by the typeof-string check
		// only on non-Node engines; node argv[1] = "" is a defined string,
		// so pathToFileURL(\"\") triggers ERR_INVALID_FILE_URL_PATH on
		// most platforms — that throw is caught and false returned.
		process.argv = [process.argv[0]!, ""];
		// Empty string is a falsy but non-undefined string so the first
		// guard does not return false; pathToFileURL throws → catch → false.
		// (On platforms where pathToFileURL accepts \"\" and returns the
		// cwd URL, the comparison still does not match main's URL.)
		const result = isDirectlyExecuted();
		expect(result).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// computeRunUnder — Plan 01b Task 4 C1 carry-over.
// Enforces the contract: NODE_ENV=test is a HARD OVERRIDE that wins over
// CREDENTIALS_DIRECTORY and INVOCATION_ID. A future refactor of the runUnder
// branch could silently re-order these checks and the daemon-start event
// would falsely report "systemd" from a unit-test harness; these tests fail
// loudly if that happens.
// ---------------------------------------------------------------------------

describe("computeRunUnder", () => {
	it('returns "test" when NODE_ENV=test and no systemd env vars are set', () => {
		expect(computeRunUnder({ NODE_ENV: "test" })).toBe("test");
	});

	it('returns "test" when NODE_ENV=test EVEN IF CREDENTIALS_DIRECTORY is set (override)', () => {
		expect(
			computeRunUnder({
				NODE_ENV: "test",
				CREDENTIALS_DIRECTORY: "/run/credentials/iago-os-v2-daemon.service",
			}),
		).toBe("test");
	});

	it('returns "test" when NODE_ENV=test EVEN IF INVOCATION_ID is set (override)', () => {
		expect(
			computeRunUnder({
				NODE_ENV: "test",
				INVOCATION_ID: "deadbeefcafebabe",
			}),
		).toBe("test");
	});

	it('returns "test" when NODE_ENV=test AND BOTH systemd env vars are set (override)', () => {
		expect(
			computeRunUnder({
				NODE_ENV: "test",
				CREDENTIALS_DIRECTORY: "/run/credentials/iago-os-v2-daemon.service",
				INVOCATION_ID: "deadbeefcafebabe",
			}),
		).toBe("test");
	});

	it('returns "systemd" when NODE_ENV is unset and CREDENTIALS_DIRECTORY is non-empty', () => {
		expect(
			computeRunUnder({
				CREDENTIALS_DIRECTORY: "/run/credentials/iago-os-v2-daemon.service",
			}),
		).toBe("systemd");
	});

	it('returns "systemd" when NODE_ENV is unset and INVOCATION_ID is set', () => {
		expect(
			computeRunUnder({
				INVOCATION_ID: "deadbeefcafebabe",
			}),
		).toBe("systemd");
	});

	it('returns "systemd" when NODE_ENV=production and INVOCATION_ID is set', () => {
		expect(
			computeRunUnder({
				NODE_ENV: "production",
				INVOCATION_ID: "deadbeefcafebabe",
			}),
		).toBe("systemd");
	});

	it('returns "local" when no systemd env vars are set and NODE_ENV is not "test"', () => {
		expect(computeRunUnder({})).toBe("local");
		expect(computeRunUnder({ NODE_ENV: "development" })).toBe("local");
		expect(computeRunUnder({ NODE_ENV: "production" })).toBe("local");
	});

	it('returns "local" when CREDENTIALS_DIRECTORY is the empty string (matches Phase 2 spec)', () => {
		expect(computeRunUnder({ CREDENTIALS_DIRECTORY: "" })).toBe("local");
	});

	it('returns "local" when INVOCATION_ID is the empty string (matches Phase 2 spec)', () => {
		expect(computeRunUnder({ INVOCATION_ID: "" })).toBe("local");
	});
});

// ---------------------------------------------------------------------------
// loadAgentConfig (Plan 04d Task 2)
// ---------------------------------------------------------------------------

describe("loadAgentConfig (Plan 04d)", () => {
	async function writeAgentConfig(
		agentsDir: string,
		agentId: string,
		body: unknown,
	): Promise<void> {
		await fsp.mkdir(path.join(agentsDir, agentId), { recursive: true });
		const file = path.join(agentsDir, agentId, "agent-config.json");
		await fsp.writeFile(
			file,
			typeof body === "string" ? body : JSON.stringify(body),
			"utf8",
		);
	}

	it("(LC-1) happy path: returns typed config with all required fields", async () => {
		const agentsDir = path.join(tempDir, "agents");
		await writeAgentConfig(agentsDir, "pr-triage", {
			agentId: "pr-triage",
			runtimeId: "claude-pty",
			org: "internal",
			cwd: "/opt/iago-os",
			env: { IAGO_DAEMON_STATE_ROOT: "/var/lib/iago-os/daemon-state" },
			autoStart: false,
			authProfile: "default",
		});

		const config: AgentConfigShape = await loadAgentConfig(
			agentsDir,
			"pr-triage",
		);

		expect(config.runtimeId).toBe("claude-pty");
		expect(config.cwd).toBe("/opt/iago-os");
		expect(config.env).toEqual({
			IAGO_DAEMON_STATE_ROOT: "/var/lib/iago-os/daemon-state",
		});
		expect(config.authProfile).toBe("default");
		expect(config.org).toBe("internal");
	});

	it("(LC-2) ENOENT throws with file + code in message", async () => {
		const agentsDir = path.join(tempDir, "agents");
		await fsp.mkdir(agentsDir, { recursive: true });
		await expect(loadAgentConfig(agentsDir, "missing-agent")).rejects.toThrow(
			/loadAgentConfig\(missing-agent\).*cannot read.*agent-config\.json.*ENOENT/i,
		);
	});

	it("(LC-3) invalid JSON throws with file + parse-error context", async () => {
		const agentsDir = path.join(tempDir, "agents");
		await writeAgentConfig(agentsDir, "pr-triage", "{ not valid json");
		await expect(loadAgentConfig(agentsDir, "pr-triage")).rejects.toThrow(
			/loadAgentConfig\(pr-triage\).*invalid JSON/,
		);
	});

	it("(LC-4) missing required field 'runtimeId' throws naming the field", async () => {
		const agentsDir = path.join(tempDir, "agents");
		await writeAgentConfig(agentsDir, "pr-triage", {
			agentId: "pr-triage",
			cwd: "/opt/iago-os",
			env: {},
			authProfile: "default",
		});
		await expect(loadAgentConfig(agentsDir, "pr-triage")).rejects.toThrow(
			/missing or invalid required field 'runtimeId'/,
		);
	});

	it("(LC-5) missing required field 'authProfile' throws naming the field", async () => {
		const agentsDir = path.join(tempDir, "agents");
		await writeAgentConfig(agentsDir, "pr-triage", {
			agentId: "pr-triage",
			runtimeId: "claude-pty",
			cwd: "/opt/iago-os",
			env: {},
		});
		await expect(loadAgentConfig(agentsDir, "pr-triage")).rejects.toThrow(
			/missing or invalid required field 'authProfile'/,
		);
	});

	it("(LC-6) non-string env value throws with the offending key", async () => {
		const agentsDir = path.join(tempDir, "agents");
		await writeAgentConfig(agentsDir, "pr-triage", {
			runtimeId: "claude-pty",
			cwd: "/opt/iago-os",
			env: { OK_VAR: "ok", BAD_VAR: 123 },
			authProfile: "default",
		});
		await expect(loadAgentConfig(agentsDir, "pr-triage")).rejects.toThrow(
			/'env\.BAD_VAR' is not a string/,
		);
	});

	it("(LC-7) optional org omitted is fine; result lacks org key", async () => {
		const agentsDir = path.join(tempDir, "agents");
		await writeAgentConfig(agentsDir, "pr-triage", {
			runtimeId: "claude-pty",
			cwd: "/opt/iago-os",
			env: {},
			authProfile: "default",
		});
		const config = await loadAgentConfig(agentsDir, "pr-triage");
		expect(config.org).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// makeDaemonStartupSessionId (Plan 04d Task 3)
// ---------------------------------------------------------------------------

describe("makeDaemonStartupSessionId (Plan 04d)", () => {
	it("(SID-1) returns a safe-identifier-compliant string carrying the daemon-startup prefix and the agentId", () => {
		const sid = makeDaemonStartupSessionId("pr-triage");
		expect(sid).toMatch(/^daemon-startup-[0-9a-f]{32}-pr-triage$/);
		// Safe-identifier invariants (matches assertSafeIdentifier rules).
		expect(sid).not.toContain("/");
		expect(sid).not.toContain("\\");
		expect(sid).not.toContain("..");
		expect(sid).not.toContain("\0");
		expect(sid.length).toBeGreaterThan(0);
		expect(sid.length).toBeLessThan(255);
	});

	it("(SID-2) returns a fresh suffix on every call (collision-resistant)", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 32; i++) {
			seen.add(makeDaemonStartupSessionId("pr-triage"));
		}
		// 32 random UUID4-derived suffixes — collision is astronomically
		// unlikely. Assertion catches an accidental cached/constant suffix.
		expect(seen.size).toBe(32);
	});
});

// ---------------------------------------------------------------------------
// makeTaskDispatchHandler (Plan 04d Task 3)
// ---------------------------------------------------------------------------

describe("makeTaskDispatchHandler (Plan 04d)", () => {
	function makeStubManager(opts: {
		handle: AgentHandle | null;
		claimTask?: (filename: string, agentId: string) => Promise<void>;
	}): AgentManager {
		const calls: Array<{ filename: string; agentId: string }> = [];
		const releaseCalls: string[] = [];
		const mgr = {
			listHandles: () => (opts.handle === null ? [] : [opts.handle]),
			claimTask:
				opts.claimTask ??
				(async (filename: string, agentId: string) => {
					calls.push({ filename, agentId });
				}),
			// Dual-adversarial C-1: handler ALWAYS calls releaseDispatchSlot
			// from its finally block. The stub records calls so tests can
			// assert the guard is properly released even on the malformed-
			// task / unregistered / send-failed branches.
			releaseDispatchSlot: (filename: string) => {
				releaseCalls.push(filename);
			},
			_claimCalls: calls,
			_releaseCalls: releaseCalls,
		} as unknown as AgentManager;
		return mgr;
	}

	function makeStubRuntime(
		runtimeId: string,
		sendImpl: (
			handle: AgentHandle,
			message: AgentMessage,
		) => Promise<void> = async () => {},
	): { runtime: AgentRuntime; sendCalls: AgentMessage[] } {
		const sendCalls: AgentMessage[] = [];
		const runtime: AgentRuntime = {
			shape: "pty",
			id: runtimeId,
			version: "test-0.0.1",
			interfaceVersion: "v1",
			spawn: async () => {
				throw new Error("not used in handler tests");
			},
			send: async (handle: AgentHandle, message: AgentMessage) => {
				sendCalls.push(message);
				await sendImpl(handle, message);
			},
			onStatusChanged: () => () => {},
			isAlive: async () => true,
			getStatus: async () => ({ alive: true }),
			shutdown: async () => {},
			restoreFromMarker: async () => null,
			costTap: () => ({
				[Symbol.asyncIterator]: () => ({
					next: async () => ({ value: undefined, done: true }) as const,
				}),
			}),
		};
		return { runtime, sendCalls };
	}

	function makeHandleFixture(agentId: string, runtimeId: string): AgentHandle {
		return {
			id: `${agentId}-handle-1`,
			runtime: runtimeId,
			shape: "pty",
			agentId,
			sessionId: "sess-stub",
			generationToken: 0,
			spawnedAt: 1000,
			markerPath: "/tmp/marker",
		};
	}

	it("(DH-1) happy path: sends prompt and calls claimTask after send resolves", async () => {
		const { runtime, sendCalls } = makeStubRuntime("dh1-runtime");
		registerRuntime(runtime);
		const handle = makeHandleFixture("pr-triage", "dh1-runtime");
		const mgr = makeStubManager({ handle });
		const emitMock = vi.fn().mockResolvedValue(undefined);

		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
		});

		const evt: TaskDispatchEvent = {
			filename: "pr-triage__1700000200.json",
			agentId: "pr-triage",
			taskContent: { prompt: "do the daily triage", agentId: "pr-triage" },
		};

		await handler(evt);

		expect(sendCalls).toHaveLength(1);
		expect(sendCalls[0]).toEqual({
			kind: "prompt",
			payload: { text: "do the daily triage" },
		});
		expect((mgr as unknown as { _claimCalls: unknown[] })._claimCalls).toEqual([
			{ filename: evt.filename, agentId: "pr-triage" },
		]);
		// No pr-triage-dispatch-failed telemetry on happy path.
		const failedCalls = emitMock.mock.calls.filter(
			(c) => (c[0] as { kind: string }).kind === "pr-triage-dispatch-failed",
		);
		expect(failedCalls).toHaveLength(0);
	});

	it("(DH-2) no live handle: emits pr-triage-dispatch-failed(unregistered) and does NOT call claimTask", async () => {
		const mgr = makeStubManager({ handle: null });
		const emitMock = vi.fn().mockResolvedValue(undefined);
		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
		});

		const evt: TaskDispatchEvent = {
			filename: "pr-triage__1700000201.json",
			agentId: "pr-triage",
			taskContent: { prompt: "x", agentId: "pr-triage" },
		};

		await handler(evt);

		const failedCalls = emitMock.mock.calls
			.map((c) => c[0])
			.filter(
				(e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed",
			);
		expect(failedCalls).toHaveLength(1);
		expect(failedCalls[0]).toMatchObject({
			kind: "pr-triage-dispatch-failed",
			agentId: "pr-triage",
			filename: evt.filename,
			reason: "unregistered",
		});
		expect((mgr as unknown as { _claimCalls: unknown[] })._claimCalls).toEqual(
			[],
		);
	});

	it("(DH-3) runtime.send rejection: emits pr-triage-dispatch-failed(send-failed) and does NOT call claimTask", async () => {
		const { runtime } = makeStubRuntime("dh3-runtime", async () => {
			throw new Error("PTY closed unexpectedly");
		});
		registerRuntime(runtime);
		const handle = makeHandleFixture("pr-triage", "dh3-runtime");
		const mgr = makeStubManager({ handle });
		const emitMock = vi.fn().mockResolvedValue(undefined);

		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
		});

		const evt: TaskDispatchEvent = {
			filename: "pr-triage__1700000202.json",
			agentId: "pr-triage",
			taskContent: { prompt: "x", agentId: "pr-triage" },
		};

		await handler(evt);

		const failedCalls = emitMock.mock.calls
			.map((c) => c[0])
			.filter(
				(e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed",
			);
		expect(failedCalls).toHaveLength(1);
		expect(failedCalls[0]).toMatchObject({
			kind: "pr-triage-dispatch-failed",
			agentId: "pr-triage",
			filename: evt.filename,
			reason: "send-failed",
		});
		expect((failedCalls[0] as { message: string }).message).toContain(
			"PTY closed unexpectedly",
		);
		expect((mgr as unknown as { _claimCalls: unknown[] })._claimCalls).toEqual(
			[],
		);
	});

	it("(DH-4) unexpected throw (resolveRuntime miss): wrapped as listener-exception, no claimTask", async () => {
		// Do NOT register the runtime — resolveRuntime will throw, hitting
		// the outermost catch block.
		const handle = makeHandleFixture("pr-triage", "dh4-missing-runtime");
		const mgr = makeStubManager({ handle });
		const emitMock = vi.fn().mockResolvedValue(undefined);

		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
		});

		const evt: TaskDispatchEvent = {
			filename: "pr-triage__1700000203.json",
			agentId: "pr-triage",
			taskContent: { prompt: "x", agentId: "pr-triage" },
		};

		// The handler MUST resolve (not reject) — uncaught exceptions in
		// EventEmitter listeners would otherwise crash the polling tick.
		await expect(handler(evt)).resolves.toBeUndefined();

		const failedCalls = emitMock.mock.calls
			.map((c) => c[0])
			.filter(
				(e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed",
			);
		expect(failedCalls).toHaveLength(1);
		expect(failedCalls[0]).toMatchObject({
			kind: "pr-triage-dispatch-failed",
			agentId: "pr-triage",
			filename: evt.filename,
			reason: "listener-exception",
		});
		expect((mgr as unknown as { _claimCalls: unknown[] })._claimCalls).toEqual(
			[],
		);
	});

	it("(DH-5/I-E) missing prompt key: emits pr-triage-dispatch-failed(malformed-task), does NOT send, does NOT claim, file stays in pending", async () => {
		// Dual-adversarial I-E regression (extends async-bot M-3 from
		// log-only to block-and-leave-for-operator). The prior behavior
		// sent runtime.send("") and then claimTask, which moved the file
		// to resolved/ and released the cron slot — a silent-loss path
		// because the task looked completed despite never reaching a
		// meaningful prompt. Now the dispatch is blocked, the file stays
		// in pending/ (no claimTask call), and the malformed-task
		// telemetry surfaces the issue to operators.
		const { runtime, sendCalls } = makeStubRuntime("dh5-runtime");
		registerRuntime(runtime);
		const handle = makeHandleFixture("pr-triage", "dh5-runtime");
		const mgr = makeStubManager({ handle });
		const emitMock = vi.fn().mockResolvedValue(undefined);

		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
		});

		const evt: TaskDispatchEvent = {
			filename: "pr-triage__1700000204.json",
			agentId: "pr-triage",
			taskContent: { agentId: "pr-triage" }, // no prompt field
		};

		await handler(evt);

		// NOT sent, NOT claimed.
		expect(sendCalls).toHaveLength(0);
		expect((mgr as unknown as { _claimCalls: unknown[] })._claimCalls).toEqual(
			[],
		);

		// malformed-task telemetry emitted with absent-prompt diagnostic.
		const failedCalls = emitMock.mock.calls
			.map((c) => c[0])
			.filter(
				(e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed",
			);
		expect(failedCalls).toHaveLength(1);
		expect(failedCalls[0]).toMatchObject({
			kind: "pr-triage-dispatch-failed",
			agentId: "pr-triage",
			filename: evt.filename,
			reason: "malformed-task",
		});
		expect((failedCalls[0] as { message: string }).message).toContain("absent");

		// C-1: dispatch slot released even on the malformed-task branch.
		expect(
			(mgr as unknown as { _releaseCalls: string[] })._releaseCalls,
		).toEqual([evt.filename]);
	});

	it("(DH-6/I-E) empty-string prompt: emits pr-triage-dispatch-failed(malformed-task), does NOT send, does NOT claim", async () => {
		// Companion to DH-5. The prior fallback at `prompt = prompt || ""`
		// treated an explicit empty string identically to a missing key —
		// both routes silently advanced the file. The fix uses
		// `typeof === "string" && length > 0` so empty strings are now
		// rejected explicitly.
		const { runtime, sendCalls } = makeStubRuntime("dh6-runtime");
		registerRuntime(runtime);
		const handle = makeHandleFixture("pr-triage", "dh6-runtime");
		const mgr = makeStubManager({ handle });
		const emitMock = vi.fn().mockResolvedValue(undefined);

		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
		});

		const evt: TaskDispatchEvent = {
			filename: "pr-triage__1700000205.json",
			agentId: "pr-triage",
			taskContent: { prompt: "", agentId: "pr-triage" },
		};

		await handler(evt);

		expect(sendCalls).toHaveLength(0);
		expect((mgr as unknown as { _claimCalls: unknown[] })._claimCalls).toEqual(
			[],
		);

		const failedCalls = emitMock.mock.calls
			.map((c) => c[0])
			.filter(
				(e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed",
			);
		expect(failedCalls).toHaveLength(1);
		expect(failedCalls[0]).toMatchObject({
			kind: "pr-triage-dispatch-failed",
			filename: evt.filename,
			reason: "malformed-task",
		});
		expect((failedCalls[0] as { message: string }).message).toContain(
			"empty string",
		);

		expect(
			(mgr as unknown as { _releaseCalls: string[] })._releaseCalls,
		).toEqual([evt.filename]);
	});

	it("(DH-7/I-E) non-string prompt (number): emits pr-triage-dispatch-failed(malformed-task), does NOT send, does NOT claim", async () => {
		// Third I-E branch: a task file that round-trips through JSON.parse
		// with `prompt: 42` (or null, boolean, object) would have hit the
		// `prompt || ""` fallback and sent an empty string. The fix
		// validates type explicitly so the operator sees the typeof in the
		// telemetry message.
		const { runtime, sendCalls } = makeStubRuntime("dh7-runtime");
		registerRuntime(runtime);
		const handle = makeHandleFixture("pr-triage", "dh7-runtime");
		const mgr = makeStubManager({ handle });
		const emitMock = vi.fn().mockResolvedValue(undefined);

		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
		});

		const evt: TaskDispatchEvent = {
			filename: "pr-triage__1700000206.json",
			agentId: "pr-triage",
			taskContent: { prompt: 42 as unknown as string, agentId: "pr-triage" },
		};

		await handler(evt);

		expect(sendCalls).toHaveLength(0);
		expect((mgr as unknown as { _claimCalls: unknown[] })._claimCalls).toEqual(
			[],
		);

		const failedCalls = emitMock.mock.calls
			.map((c) => c[0])
			.filter(
				(e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed",
			);
		expect(failedCalls).toHaveLength(1);
		expect(failedCalls[0]).toMatchObject({
			kind: "pr-triage-dispatch-failed",
			filename: evt.filename,
			reason: "malformed-task",
		});
		expect((failedCalls[0] as { message: string }).message).toContain(
			"type number",
		);

		expect(
			(mgr as unknown as { _releaseCalls: string[] })._releaseCalls,
		).toEqual([evt.filename]);
	});

	it("(DH-1b/C-1) happy path also releases dispatch slot in finally", async () => {
		// Belt-and-suspenders for the C-1 invariant: the `finally` block
		// fires on every code path through the handler. DH-2..DH-7 cover
		// the failure branches; this asserts the happy path too. Without
		// this, a future refactor that returns early from the success
		// branch could silently regress the guard.
		const { runtime } = makeStubRuntime("dh1b-runtime");
		registerRuntime(runtime);
		const handle = makeHandleFixture("pr-triage", "dh1b-runtime");
		const mgr = makeStubManager({ handle });
		const emitMock = vi.fn().mockResolvedValue(undefined);

		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
		});

		const evt: TaskDispatchEvent = {
			filename: "pr-triage__1700000207.json",
			agentId: "pr-triage",
			taskContent: { prompt: "hello", agentId: "pr-triage" },
		};

		await handler(evt);

		expect(
			(mgr as unknown as { _releaseCalls: string[] })._releaseCalls,
		).toEqual([evt.filename]);
	});
});
