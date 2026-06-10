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

import { EventEmitter } from "node:events";
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
	PR_DATA_PLACEHOLDER,
	RESULT_TIMEOUT_MS,
	SHUTDOWN_STAGE_TIMEOUT_MS,
	TELEGRAM_SEND_RETRY_BACKOFF_MS,
	type TaskDispatchEvent,
	type TaskSendEvent,
	buildBotAgentManagerAdapter,
	buildFleetHealth,
	composeCronAgentEnv,
	computeRunUnder,
	findHandleForAgent,
	getShapeForAgent,
	injectIntoAgent,
	isDirectlyExecuted,
	loadAgentConfig,
	loadPersistedConfigs,
	makeDaemonStartupSessionId,
	makePrTriageCronPrompt,
	makeResultTimers,
	makeTaskDispatchHandler,
	makeTaskSendHandler,
	registerCronAgentWithRestart,
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
	// Computed-key `delete` (not `delete process.env.X`) stays Biome-clean:
	// `noDelete` flags only static member deletes, and the autofix it would
	// apply (`= undefined`) coerces the value to the literal string "undefined",
	// breaking isolation. Matches the loop-delete idiom in config.test.ts /
	// sighup.test.ts.
	const stateRootKey = "IAGO_DAEMON_STATE_ROOT";
	delete process.env[stateRootKey];
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
		const entry = result.get("h-valid");
		expect(entry).toBeDefined();
		expect(entry?.agentId).toBe("agent-good");
		expect(entry?.runtimeId).toBe("claude-pty");
		expect(entry?.cwd).toBe("/tmp/wd");
		expect(entry?.sessionId).toBe("session-1");
		expect(entry?.org).toBe("org-a");
		// Non-string env values were skipped; string ones preserved.
		expect(entry?.env).toEqual({ FOO: "bar", KEEP: "yes" });
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
		expect(result.get("h-bad-env")?.env).toEqual({});
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
		expect(result.get("h-null-env")?.env).toEqual({});
	});

	it("accepts a record with no env field at all (defaults to empty)", async () => {
		await writeAgentFile("h-no-env", {
			agentId: "agent-z",
			runtimeId: "claude-pty",
			cwd: "/tmp/wd",
			sessionId: "session-1",
		});
		const result = await loadPersistedConfigs();
		expect(result.get("h-no-env")?.env).toEqual({});
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
		expect(result[0]?.handleId).toBe("h-1");
		expect(result[1]?.agentId).toBe("agent-b");
		expect(result[1]?.shape).toBe("http");
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
// buildBotAgentManagerAdapter (dual-adversarial #B — composition wiring)
// ---------------------------------------------------------------------------

describe("buildBotAgentManagerAdapter", () => {
	it("forwards getLastStatus + isAlive (regression: bot /status liveness wiring)", async () => {
		const handle = makeHandle({ agentId: "agent-a", shape: "pty" });
		const getLastStatus = vi.fn(() => "running");
		const isAlive = vi.fn(() => true);
		const manager = {
			getHandle: (id: string) => (id === handle.id ? handle : undefined),
			listHandles: () => [handle],
			shutdownAgent: vi.fn(async () => {}),
			restartAgent: vi.fn(async () => undefined),
			getLastStatus,
			isAlive,
		} as unknown as AgentManager;

		const adapter = buildBotAgentManagerAdapter(manager);

		// The two methods the inline literal previously DROPPED must be present
		// AND delegate — their absence silently disabled the /status
		// "Last status:" / "Alive:" lines in production (dual-adversarial #B).
		expect(typeof adapter.getLastStatus).toBe("function");
		expect(typeof adapter.isAlive).toBe("function");
		expect(adapter.getLastStatus?.(handle.id)).toBe("running");
		expect(adapter.isAlive?.(handle.id)).toBe(true);
		expect(getLastStatus).toHaveBeenCalledWith(handle.id);
		expect(isAlive).toHaveBeenCalledWith(handle.id);

		// Core forwards still intact.
		expect(adapter.getHandle(handle.id)).toBe(handle);
		expect(await adapter.getShape("agent-a")).toBe("pty");
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
		expect(rt.sendCalls[0]?.message).toEqual({
			kind: "inject",
			payload: { text: "hello world" },
		});
		expect(rt.sendCalls[0]?.handle.id).toBe(handle.id);
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
		process.argv = [process.argv[0] ?? "node", mainPath];
		// Note: the test is meaningful only when main.ts is loaded as a
		// .ts module under vitest. If the bundled .js path is loaded
		// instead (production), the comparison would still equal because
		// import.meta.url tracks the executing module.
		expect(isDirectlyExecuted()).toBe(true);
	});

	it("returns false when process.argv[1] points to an unrelated file", () => {
		// Use a real path that's not main.ts so pathToFileURL succeeds but
		// the URL does NOT match import.meta.url.
		process.argv = [process.argv[0] ?? "node", path.join(tempDir, "other.ts")];
		expect(isDirectlyExecuted()).toBe(false);
	});

	it("returns false when pathToFileURL throws on argv[1]", () => {
		// NUL byte is rejected by pathToFileURL (ERR_INVALID_ARG_VALUE).
		// Cover the catch branch without mocking node:url.
		process.argv = [process.argv[0] ?? "node", "\x00"];
		expect(isDirectlyExecuted()).toBe(false);
	});

	it("returns false when argv[1] is the empty string", () => {
		// Empty string is treated as undefined by the typeof-string check
		// only on non-Node engines; node argv[1] = "" is a defined string,
		// so pathToFileURL(\"\") triggers ERR_INVALID_FILE_URL_PATH on
		// most platforms — that throw is caught and false returned.
		process.argv = [process.argv[0] ?? "node", ""];
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
		claimTask?: (filename: string, agentId: string) => Promise<boolean>;
		claimSucceeds?: boolean;
	}): AgentManager {
		const calls: Array<{ filename: string; agentId: string }> = [];
		const releaseCalls: string[] = [];
		const emitCalls: Array<{ event: string; payload: unknown }> = [];
		const mgr = {
			listHandles: () => (opts.handle === null ? [] : [opts.handle]),
			// `claimTask` mirrors the real contract: RESOLVES `true` on a clean claim
			// and `false` on a pending→resolved rename fault (the dispatch path now
			// honors that boolean). Default success keeps the happy-path tests green;
			// pass `claimSucceeds: false` to drive the claim-fault branch, or a custom
			// `claimTask` to throw.
			claimTask:
				opts.claimTask ??
				(async (filename: string, agentId: string): Promise<boolean> => {
					calls.push({ filename, agentId });
					return opts.claimSucceeds ?? true;
				}),
			// Dual-adversarial C-1: handler ALWAYS calls releaseDispatchSlot
			// from its finally block. The stub records calls so tests can
			// assert the guard is properly released even on the malformed-
			// task / unregistered / send-failed branches.
			releaseDispatchSlot: (filename: string) => {
				releaseCalls.push(filename);
			},
			// Dual-adversarial pass #2 — the dispatch handler releases a HELD
			// CronScheduler slot for a send-contract agent by emitting
			// `cron-result-complete` on the AgentManager when a claim faults or throws.
			// Record emits so tests can assert the slot is released (not leaked).
			emit: (event: string, payload: unknown): boolean => {
				emitCalls.push({ event, payload });
				return true;
			},
			_claimCalls: calls,
			_releaseCalls: releaseCalls,
			_emitCalls: emitCalls,
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
			.filter((e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed");
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
			.filter((e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed");
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
			.filter((e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed");
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
			.filter((e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed");
		expect(failedCalls).toHaveLength(1);
		expect(failedCalls[0]).toMatchObject({
			kind: "pr-triage-dispatch-failed",
			agentId: "pr-triage",
			filename: evt.filename,
			reason: "malformed-task",
		});
		expect((failedCalls[0] as { message: string }).message).toContain("absent");

		// C-1: dispatch slot released even on the malformed-task branch.
		expect((mgr as unknown as { _releaseCalls: string[] })._releaseCalls).toEqual(
			[evt.filename],
		);
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
			.filter((e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed");
		expect(failedCalls).toHaveLength(1);
		expect(failedCalls[0]).toMatchObject({
			kind: "pr-triage-dispatch-failed",
			filename: evt.filename,
			reason: "malformed-task",
		});
		expect((failedCalls[0] as { message: string }).message).toContain(
			"empty string",
		);

		expect((mgr as unknown as { _releaseCalls: string[] })._releaseCalls).toEqual(
			[evt.filename],
		);
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
			.filter((e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed");
		expect(failedCalls).toHaveLength(1);
		expect(failedCalls[0]).toMatchObject({
			kind: "pr-triage-dispatch-failed",
			filename: evt.filename,
			reason: "malformed-task",
		});
		expect((failedCalls[0] as { message: string }).message).toContain(
			"type number",
		);

		expect((mgr as unknown as { _releaseCalls: string[] })._releaseCalls).toEqual(
			[evt.filename],
		);
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

		expect((mgr as unknown as { _releaseCalls: string[] })._releaseCalls).toEqual(
			[evt.filename],
		);
	});

	it("(DH-8/H1) ndjsonAlert envelope: emits pr-triage-telegram-send-failed + claims, NOT malformed-task", async () => {
		// pr84-gap-closure (Codex H1) — the mirror branch. In production the
		// polling path short-circuits an ndjsonAlert envelope in
		// AgentManager.processPendingTask BEFORE the task-dispatch-needed
		// emit, so this handler branch is exercised only by a direct
		// invocation (this test). A prompt-less alert envelope must
		// record-and-resolve (emit pr-triage-telegram-send-failed +
		// claimTask), NEVER fall through to the malformed-task path on its
		// absent `prompt`.
		const { runtime, sendCalls } = makeStubRuntime("dh8-runtime");
		registerRuntime(runtime);
		const handle = makeHandleFixture("pr-triage", "dh8-runtime");
		const mgr = makeStubManager({ handle });
		const emitMock = vi.fn().mockResolvedValue(true); // pr84: durable write -> mirror durability-gate claims (main.ts)

		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
		});

		const details =
			'429 Too Many Requests body={"ok":false,"description":"Too Many Requests"}';
		const evt: TaskDispatchEvent = {
			filename: "pr-triage__1700000208.json",
			agentId: "pr-triage",
			taskContent: {
				agentId: "pr-triage",
				ndjsonAlert: "pr-triage-telegram-send-failed",
				details,
			},
		};

		await handler(evt);

		// Record-and-resolve, not dispatch — nothing sent to the runtime.
		expect(sendCalls).toHaveLength(0);

		// Exactly one pr-triage-telegram-send-failed, payload mirrored from
		// the envelope (alertKind = the verbatim ndjsonAlert value).
		const alertCalls = emitMock.mock.calls
			.map((c) => c[0])
			.filter(
				(e) => (e as { kind: string }).kind === "pr-triage-telegram-send-failed",
			);
		expect(alertCalls).toHaveLength(1);
		expect(alertCalls[0]).toMatchObject({
			kind: "pr-triage-telegram-send-failed",
			agentId: "pr-triage",
			filename: evt.filename,
			alertKind: "pr-triage-telegram-send-failed",
			details,
		});

		// NOT mis-classified as malformed-task (or any dispatch-failed).
		const failedCalls = emitMock.mock.calls
			.map((c) => c[0])
			.filter((e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed");
		expect(failedCalls).toHaveLength(0);

		// File claimed (pending → resolved).
		expect((mgr as unknown as { _claimCalls: unknown[] })._claimCalls).toEqual([
			{ filename: evt.filename, agentId: "pr-triage" },
		]);

		// C-1: dispatch slot released on the alert branch too.
		expect((mgr as unknown as { _releaseCalls: string[] })._releaseCalls).toEqual(
			[evt.filename],
		);
	});

	it("(DH-R1) arms the dead-letter result timer after a successful pr-triage dispatch (with a correlation runId)", async () => {
		const { runtime, sendCalls } = makeStubRuntime("dhr1-runtime");
		registerRuntime(runtime);
		const handle = makeHandleFixture("pr-triage", "dhr1-runtime");
		const mgr = makeStubManager({ handle });
		const emitMock = vi.fn().mockResolvedValue(undefined);
		const timerCalls: Array<{
			agentId: string;
			runId: string;
			filename?: string | null;
			timeoutMs?: number;
		}> = [];

		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
			startResultTimer: async (agentId, runId, filename, timeoutMs) => {
				timerCalls.push({ agentId, runId, filename, timeoutMs });
			},
		});

		await handler({
			filename: "pr-triage__1700000400.json",
			agentId: "pr-triage",
			taskContent: { prompt: "do the triage", agentId: "pr-triage" },
		});

		// Task 6: timer armed exactly once for pr-triage, with the result-timeout
		// window, the dispatched filename, AND a non-empty correlation runId.
		expect(timerCalls).toHaveLength(1);
		const call = timerCalls[0];
		if (call === undefined) throw new Error("expected exactly one timer call");
		expect(call.agentId).toBe("pr-triage");
		expect(call.timeoutMs).toBe(RESULT_TIMEOUT_MS);
		expect(call.filename).toBe("pr-triage__1700000400.json");
		expect(typeof call.runId).toBe("string");
		expect(call.runId.length).toBeGreaterThan(0);

		// Critical (Codex, round 1): the SAME runId armed in the timer must be
		// ECHOED into the dispatched PROMPT so the agent copies it into its result
		// envelope. Without the echo, the send handler could only re-read the runId
		// from the live marker (which always matches), defeating the wrong-run
		// guard. The original prompt text is preserved (instruction is appended).
		expect(sendCalls).toHaveLength(1);
		const firstSend = sendCalls[0];
		if (firstSend === undefined) throw new Error("expected exactly one send");
		const sentText = (firstSend.payload as { text: string }).text;
		expect(sentText).toContain("do the triage");
		expect(sentText).toContain("DAEMON RUN CORRELATION");
		expect(sentText).toContain(`"runId":"${call.runId}"`);
	});

	it("(DH-R1b) does NOT arm the timer for a non-pr-triage agent", async () => {
		const { runtime } = makeStubRuntime("dhr1b-runtime");
		registerRuntime(runtime);
		const handle = makeHandleFixture("other-agent", "dhr1b-runtime");
		const mgr = makeStubManager({ handle });
		const emitMock = vi.fn().mockResolvedValue(undefined);
		const timerCalls: string[] = [];

		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
			startResultTimer: (agentId) => timerCalls.push(agentId),
		});

		await handler({
			filename: "other-agent__1700000401.json",
			agentId: "other-agent",
			taskContent: { prompt: "do something", agentId: "other-agent" },
		});

		expect(timerCalls).toHaveLength(0);
	});

	it("(DH-R2, dual-adversarial pass #2 Critical) a claim fault after a successful send does NOT arm/overwrite the result timer AND releases the held cron slot for retry", async () => {
		// Without the fix the dispatch path discarded claimTask's boolean: it armed the
		// result timer with a NEW runId (overwriting a live run's marker → the
		// legitimate daily summary is quarantined as stale) and never released the held
		// CronScheduler slot, permanently stalling pr-triage at maxConcurrent:1. With
		// the fix, on `claimed === false` the handler emits
		// pr-triage-dispatch-failed{claim-failed}, does NOT arm the timer, and emits
		// `cron-result-complete` so the next cron tick can retry. RED without the slot
		// release: `_emitCalls` would be empty and this assertion fails.
		const { runtime } = makeStubRuntime("dhr2-runtime");
		registerRuntime(runtime);
		const handle = makeHandleFixture("pr-triage", "dhr2-runtime");
		const mgr = makeStubManager({ handle, claimSucceeds: false });
		const emitMock = vi.fn().mockResolvedValue(undefined);
		const timerCalls: string[] = [];

		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
			startResultTimer: (agentId) => {
				timerCalls.push(agentId);
			},
		});

		const evt: TaskDispatchEvent = {
			filename: "pr-triage__1700000402.json",
			agentId: "pr-triage",
			taskContent: { prompt: "do the daily triage", agentId: "pr-triage" },
		};
		await handler(evt);

		const failed = emitMock.mock.calls
			.map((c) => c[0])
			.filter((e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed");
		expect(failed).toHaveLength(1);
		expect(failed[0]).toMatchObject({ reason: "claim-failed" });
		// Result timer NOT armed — a live run's durable marker is never overwritten.
		expect(timerCalls).toHaveLength(0);
		// Held cron slot released so the file (still in pending/) can be retried.
		const emitted = (
			mgr as unknown as {
				_emitCalls: Array<{ event: string; payload: unknown }>;
			}
		)._emitCalls;
		expect(emitted).toEqual([
			{
				event: "cron-result-complete",
				payload: { agentId: "pr-triage", filename: evt.filename },
			},
		]);
	});

	it("(DH-R3, dual-adversarial pass #2 Minor) a claimTask THROW releases the held cron slot (no permanent overlap-prevention)", async () => {
		// Without the fix a throw from claimTask (e.g. assertSafeIdentifier) jumped to
		// the catch, emitted dispatch-failed, but never released the held cron slot —
		// leaking it until daemon restart, overlap-preventing every future pr-triage
		// fire. With the fix the catch emits `cron-result-complete`. RED without it.
		const { runtime } = makeStubRuntime("dhr3-runtime");
		registerRuntime(runtime);
		const handle = makeHandleFixture("pr-triage", "dhr3-runtime");
		const mgr = makeStubManager({
			handle,
			claimTask: async () => {
				throw new Error("assertSafeIdentifier: bad filename");
			},
		});
		const emitMock = vi.fn().mockResolvedValue(undefined);
		const timerCalls: string[] = [];

		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
			startResultTimer: (agentId) => {
				timerCalls.push(agentId);
			},
		});

		const evt: TaskDispatchEvent = {
			filename: "pr-triage__1700000403.json",
			agentId: "pr-triage",
			taskContent: { prompt: "do the daily triage", agentId: "pr-triage" },
		};
		await handler(evt);

		const failed = emitMock.mock.calls
			.map((c) => c[0])
			.filter((e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed");
		expect(failed).toHaveLength(1);
		expect(failed[0]).toMatchObject({ reason: "listener-exception" });
		expect(timerCalls).toHaveLength(0);
		const emitted = (
			mgr as unknown as {
				_emitCalls: Array<{ event: string; payload: unknown }>;
			}
		)._emitCalls;
		expect(emitted).toEqual([
			{
				event: "cron-result-complete",
				payload: { agentId: "pr-triage", filename: evt.filename },
			},
		]);
	});

	it("(DH-R4, dual-adversarial #92 Critical C1) a marker-write fault ABORTS the dispatch before the claim resolves the task", async () => {
		// C1: durability is load-bearing. persistResultMarker returns false (the
		// durable result-pending marker could not be written). The handler MUST
		// abort — NOT call claimTask (which would resolve the cron task out of
		// tasks/pending/, leaving no pending task AND no marker → silent summary
		// drop on a restart), emit dispatch-failed{marker-write-failed}, release the
		// held cron slot so the next tick retries, and arm NO timer. RED without the
		// fix: the handler would skip the guard, call claimTask, and arm the timer.
		const { runtime } = makeStubRuntime("dhr4-runtime");
		registerRuntime(runtime);
		const handle = makeHandleFixture("pr-triage", "dhr4-runtime");
		let claimCalled = false;
		const mgr = makeStubManager({
			handle,
			claimTask: async () => {
				claimCalled = true;
				return true;
			},
		});
		const emitMock = vi.fn().mockResolvedValue(undefined);
		const timerCalls: string[] = [];
		const removed: string[] = [];

		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
			startResultTimer: (agentId) => {
				timerCalls.push(agentId);
			},
			persistResultMarker: async () => false,
			removeResultMarker: async (agentId) => {
				removed.push(agentId);
			},
		});

		const evt: TaskDispatchEvent = {
			filename: "pr-triage__1700000404.json",
			agentId: "pr-triage",
			taskContent: { prompt: "do the daily triage", agentId: "pr-triage" },
		};
		await handler(evt);

		// Claim never ran — the task stays in tasks/pending/ for the next tick.
		expect(claimCalled).toBe(false);
		const failed = emitMock.mock.calls
			.map((c) => c[0])
			.filter((e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed");
		expect(failed).toHaveLength(1);
		expect(failed[0]).toMatchObject({ reason: "marker-write-failed" });
		// No timer armed, and no marker cleanup needed (none was written).
		expect(timerCalls).toHaveLength(0);
		expect(removed).toHaveLength(0);
		// Held cron slot released so the file (still in pending/) can be retried.
		const emitted = (
			mgr as unknown as {
				_emitCalls: Array<{ event: string; payload: unknown }>;
			}
		)._emitCalls;
		expect(emitted).toEqual([
			{
				event: "cron-result-complete",
				payload: { agentId: "pr-triage", filename: evt.filename },
			},
		]);
	});

	it("(DH-R5, #92 C1) a successful marker persist proceeds to claim + arms the timer", async () => {
		// The pre-claim marker guard aborts ONLY on a write fault. On a successful
		// persist the dispatch proceeds exactly as before: claimTask runs and the
		// dead-letter timer is armed. Guards against the abort firing on the happy
		// path and pins that the marker is written with the dispatch runId.
		const { runtime } = makeStubRuntime("dhr5-runtime");
		registerRuntime(runtime);
		const handle = makeHandleFixture("pr-triage", "dhr5-runtime");
		let claimCalled = false;
		const mgr = makeStubManager({
			handle,
			claimTask: async () => {
				claimCalled = true;
				return true;
			},
		});
		const emitMock = vi.fn().mockResolvedValue(undefined);
		const timerCalls: string[] = [];
		const persistArgs: Array<{ agentId: string; runId: string }> = [];

		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
			startResultTimer: (agentId) => {
				timerCalls.push(agentId);
			},
			persistResultMarker: async (agentId, runId) => {
				persistArgs.push({ agentId, runId });
				return true;
			},
			removeResultMarker: async () => {},
		});

		const evt: TaskDispatchEvent = {
			filename: "pr-triage__1700000405.json",
			agentId: "pr-triage",
			taskContent: { prompt: "do the daily triage", agentId: "pr-triage" },
		};
		await handler(evt);

		// Marker persisted BEFORE the claim, stamped with the dispatch runId (UUID).
		expect(persistArgs).toHaveLength(1);
		expect(persistArgs[0].runId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
		expect(claimCalled).toBe(true);
		expect(timerCalls).toEqual(["pr-triage"]);
		const failed = emitMock.mock.calls
			.map((c) => c[0])
			.filter((e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed");
		expect(failed).toHaveLength(0);
	});

	it("(DH-R6, #92 re-gate C1) a marker-write fault aborts BEFORE the prompt is sent — the retry tick is a true first delivery", async () => {
		// Pass-#2 re-gate Critical: the prompt was runtime.send-delivered BEFORE the
		// durable marker write, so the marker-fault abort left the task pending with
		// the prompt ALREADY in the PTY — the next tick re-SENT it (duplicate agent
		// work; the retry's fresh-runId marker stale-quarantined the first run's
		// legitimate envelope). With the fix the marker is persisted BEFORE the
		// send: on a fault NOTHING was delivered, so the retry is a clean first
		// delivery. RED without the fix: sendCalls has 1 entry.
		const { runtime, sendCalls } = makeStubRuntime("dhr6-runtime");
		registerRuntime(runtime);
		const handle = makeHandleFixture("pr-triage", "dhr6-runtime");
		let claimCalled6 = false;
		const mgr = makeStubManager({
			handle,
			claimTask: async () => {
				claimCalled6 = true;
				return true;
			},
		});
		const emitMock = vi.fn().mockResolvedValue(undefined);
		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
			startResultTimer: () => {},
			persistResultMarker: async () => false,
			removeResultMarker: async () => {},
		});
		await handler({
			filename: "pr-triage__1700000406.json",
			agentId: "pr-triage",
			taskContent: { prompt: "do the daily triage", agentId: "pr-triage" },
		});
		// The irreversible send NEVER happened — nothing to duplicate on retry.
		expect(sendCalls).toHaveLength(0);
		expect(claimCalled6).toBe(false);
		const failed6 = emitMock.mock.calls
			.map((c) => c[0])
			.filter((e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed");
		expect(failed6).toHaveLength(1);
		expect(failed6[0]).toMatchObject({ reason: "marker-write-failed" });
	});

	it("(DH-R7, #92 re-gate C1) a claim fault KEEPS the durable marker — it is the live run's only record", async () => {
		// The prior fix REMOVED the pre-written marker on a claim fault and let the
		// next tick re-dispatch under a fresh runId — but the prompt had already
		// been delivered: the retry re-sent it. Now the marker is KEPT (the run is
		// live) and the retry tick RESUMES the claim instead (DH-R8). RED without
		// the fix: removed has 1 entry.
		const { runtime, sendCalls } = makeStubRuntime("dhr7-runtime");
		registerRuntime(runtime);
		const handle = makeHandleFixture("pr-triage", "dhr7-runtime");
		const mgr = makeStubManager({ handle, claimSucceeds: false });
		const emitMock = vi.fn().mockResolvedValue(undefined);
		const removed7: string[] = [];
		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
			startResultTimer: () => {},
			persistResultMarker: async () => true,
			removeResultMarker: async (agentId) => {
				removed7.push(agentId);
			},
		});
		const evt: TaskDispatchEvent = {
			filename: "pr-triage__1700000407.json",
			agentId: "pr-triage",
			taskContent: { prompt: "do the daily triage", agentId: "pr-triage" },
		};
		await handler(evt);
		// Prompt delivered exactly once; the marker survives as the run's record.
		expect(sendCalls).toHaveLength(1);
		expect(removed7).toHaveLength(0);
		const failed7 = emitMock.mock.calls
			.map((c) => c[0])
			.filter((e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed");
		expect(failed7).toHaveLength(1);
		expect(failed7[0]).toMatchObject({ reason: "claim-failed" });
	});

	it("(DH-R8, #92 re-gate C1) a pending file matching the durable marker RESUMES the claim — never a second send", async () => {
		// The retry tick after a claim fault: the durable marker references THIS
		// filename (the prompt was delivered; only the pending→resolved rename
		// faulted). The handler must re-attempt ONLY the claim, re-arm the timer
		// with the ORIGINAL runId + the REMAINING deadline window, and emit
		// dispatch-resumed. RED without the fix: the handler re-sends under a
		// FRESH runId, stale-quarantining the live run's envelope.
		const { runtime, sendCalls } = makeStubRuntime("dhr8-runtime");
		registerRuntime(runtime);
		const handle = makeHandleFixture("pr-triage", "dhr8-runtime");
		const mgr = makeStubManager({ handle });
		const emitMock = vi.fn().mockResolvedValue(undefined);
		const resumed8: Array<{ runId: string; remainingMs: number }> = [];
		const timerCalls8: string[] = [];
		const ORIGINAL_RUN_ID = "11111111-2222-4333-8444-555555555555";
		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
			startResultTimer: (agentId) => {
				timerCalls8.push(agentId);
			},
			persistResultMarker: async () => true,
			removeResultMarker: async () => {},
			hasLiveResultTimer: () => false,
			readResultMarker: async () => ({
				runId: ORIGINAL_RUN_ID,
				filename: "pr-triage__1700000408.json",
				deadlineMs: Date.now() + 60_000,
			}),
			resumeResultTimer: (_agentId, runId, _filename, remainingMs) => {
				resumed8.push({ runId, remainingMs });
			},
		});
		const evt: TaskDispatchEvent = {
			filename: "pr-triage__1700000408.json",
			agentId: "pr-triage",
			taskContent: { prompt: "do the daily triage", agentId: "pr-triage" },
		};
		await handler(evt);
		// NO second delivery; the claim was re-attempted; the timer re-armed with
		// the ORIGINAL runId and a remaining (not full) window.
		expect(sendCalls).toHaveLength(0);
		expect(
			(mgr as unknown as { _claimCalls: Array<unknown> })._claimCalls,
		).toHaveLength(1);
		expect(resumed8).toHaveLength(1);
		expect(resumed8[0].runId).toBe(ORIGINAL_RUN_ID);
		expect(resumed8[0].remainingMs).toBeGreaterThan(0);
		expect(resumed8[0].remainingMs).toBeLessThanOrEqual(60_000);
		// The fresh-dispatch timer path (full window, NEW runId) did NOT run.
		expect(timerCalls8).toHaveLength(0);
		const resumedEvents = emitMock.mock.calls
			.map((c) => c[0])
			.filter(
				(e) => (e as { kind: string }).kind === "pr-triage-dispatch-resumed",
			);
		expect(resumedEvents).toHaveLength(1);
		expect(resumedEvents[0]).toMatchObject({ runId: ORIGINAL_RUN_ID });
	});

	it("(DH-R9, #92 re-gate C1/I1) a pending file is DEFERRED while another run is in flight — no send, no marker overwrite, telemetry once per filename", async () => {
		// re-gate I1: dispatching a second file while a run is live re-sends into
		// the persistent PTY and the marker overwrite strands the first run with NO
		// completion path (superseded-run slot leak + silent summary drop). The
		// handler now DEFERS: nothing sent, nothing claimed, live marker untouched;
		// the polling loop re-attempts after the live run completes (envelope or
		// dead-letter). RED without the fix: sendCalls has 2 entries.
		const { runtime, sendCalls } = makeStubRuntime("dhr9-runtime");
		registerRuntime(runtime);
		const handle = makeHandleFixture("pr-triage", "dhr9-runtime");
		const mgr = makeStubManager({ handle });
		const emitMock = vi.fn().mockResolvedValue(undefined);
		const persisted9: string[] = [];
		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
			startResultTimer: () => {},
			persistResultMarker: async (agentId) => {
				persisted9.push(agentId);
				return true;
			},
			removeResultMarker: async () => {},
			hasLiveResultTimer: () => true, // another run is in flight
			readResultMarker: async () => ({
				runId: "99999999-8888-4777-8666-555555555555",
				filename: "pr-triage__SOME_OTHER_FILE.json",
				deadlineMs: Date.now() + 60_000,
			}),
			resumeResultTimer: () => {},
		});
		const evt: TaskDispatchEvent = {
			filename: "pr-triage__1700000409.json",
			agentId: "pr-triage",
			taskContent: { prompt: "do the daily triage", agentId: "pr-triage" },
		};
		await handler(evt);
		await handler(evt); // second polling tick while the run is still live
		expect(sendCalls).toHaveLength(0);
		expect(
			(mgr as unknown as { _claimCalls: Array<unknown> })._claimCalls,
		).toHaveLength(0);
		expect(persisted9).toHaveLength(0); // live marker NOT overwritten
		const deferred = emitMock.mock.calls
			.map((c) => c[0])
			.filter(
				(e) => (e as { kind: string }).kind === "pr-triage-dispatch-deferred",
			);
		expect(deferred).toHaveLength(1); // once per filename, not per tick
	});

	it("(DH-R10, #92 re-gate C1) a send fault removes the pre-written marker AND releases the held cron slot", async () => {
		// With marker-before-send, a send fault leaves a durable marker for a run
		// whose prompt never delivered — recovery would dead-letter a phantom run.
		// The handler must remove it (best-effort) AND release the held slot: the
		// pre-existing send-fault branch released NOTHING, so with maxConcurrent:1
		// every future pr-triage cron fire was overlap-prevented until restart.
		// RED without the fix: removed is empty and _emitCalls is empty.
		const { runtime } = makeStubRuntime("dhr10-runtime", async () => {
			throw new Error("PTY write EPIPE");
		});
		registerRuntime(runtime);
		const handle = makeHandleFixture("pr-triage", "dhr10-runtime");
		const mgr = makeStubManager({ handle });
		const emitMock = vi.fn().mockResolvedValue(undefined);
		const removed10: string[] = [];
		const handler = makeTaskDispatchHandler({
			agentManager: mgr,
			emit: emitMock,
			startResultTimer: () => {},
			persistResultMarker: async () => true,
			removeResultMarker: async (agentId) => {
				removed10.push(agentId);
			},
		});
		const evt: TaskDispatchEvent = {
			filename: "pr-triage__1700000410.json",
			agentId: "pr-triage",
			taskContent: { prompt: "do the daily triage", agentId: "pr-triage" },
		};
		await handler(evt);
		expect(removed10).toEqual(["pr-triage"]);
		const failed10 = emitMock.mock.calls
			.map((c) => c[0])
			.filter((e) => (e as { kind: string }).kind === "pr-triage-dispatch-failed");
		expect(failed10).toHaveLength(1);
		expect(failed10[0]).toMatchObject({ reason: "send-failed" });
		const emitted10 = (
			mgr as unknown as {
				_emitCalls: Array<{ event: string; payload: unknown }>;
			}
		)._emitCalls;
		expect(emitted10).toEqual([
			{
				event: "cron-result-complete",
				payload: { agentId: "pr-triage", filename: evt.filename },
			},
		]);
	});
});

describe("composeCronAgentEnv (R1 — NO secrets, only non-secret runtime vars)", () => {
	// The former secret allowlist is GONE — the agent holds no token. These
	// secrets are present in the daemon env ONLY to prove they are NEVER copied
	// into the composed agent env.
	const SECRETS = {
		IAGO_TELEGRAM_BOT_TOKEN: "tg-secret",
		IAGO_TELEGRAM_ALLOWED_USER_IDS: "42,99",
		GH_TOKEN: "gh-pat-secret",
	} as const;

	// Test 5 (KEPT, SECRETS spread dropped) — node-pty REPLACES the parent env,
	// so a trusted cron agent's composed env MUST carry the non-secret
	// base-runtime vars (PATH/HOME/SHELL/LANG) or node-pty cannot locate
	// `claude`.
	it("trusted 'pr-triage' inherits the non-secret runtime vars (PATH/HOME/SHELL/LANG)", () => {
		const env = composeCronAgentEnv(
			"pr-triage",
			{ IAGO_DAEMON_STATE_ROOT: "/state" },
			{
				PATH: "/usr/bin:/bin",
				HOME: "/home/iago",
				SHELL: "/bin/bash",
				LANG: "en_US.UTF-8",
			} as NodeJS.ProcessEnv,
		);
		expect(env.PATH).toBe("/usr/bin:/bin");
		expect(env.HOME).toBe("/home/iago");
		expect(env.SHELL).toBe("/bin/bash");
		expect(env.LANG).toBe("en_US.UTF-8");
		// Declared base env preserved.
		expect(env.IAGO_DAEMON_STATE_ROOT).toBe("/state");
	});

	// Test 6 (REWRITTEN) — the composed env is runtime-vars + declared base
	// ONLY, and the three secrets are NEVER present even when in the daemon env.
	it("composes ONLY runtime-vars + declared base — and NEVER any secret", () => {
		const env = composeCronAgentEnv(
			"pr-triage",
			{ IAGO_DAEMON_STATE_ROOT: "/state" },
			{
				PATH: "/usr/bin",
				HOME: "/home/iago",
				...SECRETS,
				// Arbitrary daemon-process vars that are NOT runtime-allowlist
				// members — these must NOT cross into the composed agent env.
				AWS_SECRET_ACCESS_KEY: "must-not-leak",
				SOME_OTHER_TOKEN: "also-must-not-leak",
				NODE_ENV: "production",
			} as NodeJS.ProcessEnv,
		);
		// NEW CORE SECURITY ASSERTION (R1/D1): no secret crosses into the agent
		// env, even when present in the daemon env.
		expect("IAGO_TELEGRAM_BOT_TOKEN" in env).toBe(false);
		expect("GH_TOKEN" in env).toBe(false);
		expect("IAGO_TELEGRAM_ALLOWED_USER_IDS" in env).toBe(false);
		// No other arbitrary daemon-process var crossed over.
		expect("AWS_SECRET_ACCESS_KEY" in env).toBe(false);
		expect("SOME_OTHER_TOKEN" in env).toBe(false);
		expect("NODE_ENV" in env).toBe(false);
		// The composed env contains ONLY: the declared base key + the 2 runtime
		// vars present in the daemon env — nothing else.
		expect(Object.keys(env).sort()).toEqual(
			["HOME", "IAGO_DAEMON_STATE_ROOT", "PATH"].sort(),
		);
	});

	// REGRESSION (R1) — a GH/Telegram secret in daemonEnv is NEVER copied into
	// the composed agent env (the load-bearing D1 property).
	it("a GH/Telegram secret in daemonEnv is NEVER copied into the composed agent env", () => {
		const env = composeCronAgentEnv(
			"pr-triage",
			{ IAGO_DAEMON_STATE_ROOT: "/state" },
			{ PATH: "/usr/bin", ...SECRETS } as NodeJS.ProcessEnv,
		);
		const serialized = JSON.stringify(env);
		expect(serialized).not.toContain("tg-secret");
		expect(serialized).not.toContain("gh-pat-secret");
		expect(env.IAGO_TELEGRAM_BOT_TOKEN).toBeUndefined();
		expect(env.GH_TOKEN).toBeUndefined();
		expect(env.IAGO_TELEGRAM_ALLOWED_USER_IDS).toBeUndefined();
	});

	// pass#2 FIX D — the daemon's resolved IAGO_DAEMON_STATE_ROOT is overlaid onto
	// the agent env, OVERWRITING any agent-config default, so the agent writes its
	// pr-triage-send__ result envelope to the SAME directory the daemon polls.
	it("(FIX D) overlays the daemon's IAGO_DAEMON_STATE_ROOT (rendezvous coherence)", () => {
		const env = composeCronAgentEnv(
			"pr-triage",
			{ IAGO_DAEMON_STATE_ROOT: "/var/lib/iago-os/daemon-state" },
			{
				PATH: "/usr/bin",
				IAGO_DAEMON_STATE_ROOT: "/resolved/daemon/root",
			} as NodeJS.ProcessEnv,
		);
		// The daemon's resolved value WINS over the agent-config default so the
		// agent's envelope-write dir and the daemon's poll dir cannot diverge.
		expect(env.IAGO_DAEMON_STATE_ROOT).toBe("/resolved/daemon/root");
	});

	// Test 7 (KEPT, under the renamed runtime-trust gate) — an untrusted /
	// client agent still gets baseEnv UNCHANGED (no PATH injection): the
	// multi-tenant isolation invariant the claude-pty adapter encodes.
	it("an UNTRUSTED agent gets baseEnv UNCHANGED — no PATH injected (isolation invariant held)", () => {
		const base = { IAGO_DAEMON_STATE_ROOT: "/state" };
		const env = composeCronAgentEnv("rogue-agent", base, {
			PATH: "/usr/bin:/bin",
			HOME: "/home/iago",
			SHELL: "/bin/bash",
			LANG: "en_US.UTF-8",
			...SECRETS,
		} as NodeJS.ProcessEnv);
		// baseEnv returned unchanged — neither runtime vars NOR secrets injected.
		expect(env).toEqual(base);
		expect("PATH" in env).toBe(false);
		expect("HOME" in env).toBe(false);
		expect("IAGO_TELEGRAM_BOT_TOKEN" in env).toBe(false);
		expect("GH_TOKEN" in env).toBe(false);
	});

	// An absent/empty runtime var is skipped (no empty-string injection).
	it("a runtime var ABSENT from the daemon env is not injected (no empty entry)", () => {
		const env = composeCronAgentEnv("pr-triage", {}, {
			PATH: "/usr/bin",
		} as NodeJS.ProcessEnv);
		expect(env.PATH).toBe("/usr/bin");
		expect("HOME" in env).toBe(false);
		expect("SHELL" in env).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// R1 (feature-pr84-r1-daemon-creds): makeTaskSendHandler + makeResultTimers
// ---------------------------------------------------------------------------

function makeSendStubManager(opts?: { claimSucceeds?: boolean }): {
	mgr: AgentManager;
	claimCalls: Array<{ filename: string; agentId: string }>;
	releaseCalls: string[];
} {
	const claimSucceeds = opts?.claimSucceeds ?? true;
	const claimCalls: Array<{ filename: string; agentId: string }> = [];
	const releaseCalls: string[] = [];
	const mgr = {
		// pass#2 Critical fix: claimTask now reports whether the pending→resolved
		// rename succeeded. The send handler claims the envelope BEFORE the
		// irreversible Telegram send (at-most-once); a false return means the
		// rename failed and NO send must happen.
		claimTask: async (filename: string, agentId: string) => {
			claimCalls.push({ filename, agentId });
			return claimSucceeds;
		},
		// R1 Critical-1 fix: the send handler ALWAYS releases the per-filename
		// in-flight guard in its `finally`. The stub records the release so tests
		// can assert the slot is freed on every outcome (success/failure/noSend).
		releaseSendSlot: (filename: string) => {
			releaseCalls.push(filename);
		},
	} as unknown as AgentManager;
	return { mgr, claimCalls, releaseCalls };
}

function makeFakeTelegram(
	send: (
		text: string,
	) => Promise<{ ok: boolean; status?: number; error?: string }>,
): {
	bot: { sendAgentNotification: typeof send };
	calls: string[];
} {
	const calls: string[] = [];
	const bot = {
		sendAgentNotification: async (text: string) => {
			calls.push(text);
			return send(text);
		},
	};
	return { bot, calls };
}

describe("makeTaskSendHandler (R1)", () => {
	it("(TS-1) sendText envelope → sendAgentNotification + claimTask + clearResultTimer", async () => {
		const { mgr, claimCalls, releaseCalls } = makeSendStubManager();
		const { bot, calls } = makeFakeTelegram(async () => ({ ok: true }));
		const emitMock = vi.fn().mockResolvedValue(true);
		const cleared: string[] = [];
		const handler = makeTaskSendHandler({
			agentManager: mgr,
			emit: emitMock,
			telegramBot: bot as unknown as import("../telegram/bot.js").TelegramBot,
			clearResultTimer: (id) => cleared.push(id),
		});

		const evt: TaskSendEvent = {
			filename: "pr-triage-send__1700000300-1.json",
			agentId: "pr-triage",
			sendText: "PR Triage summary",
		};
		await handler(evt);

		expect(calls).toEqual(["PR Triage summary"]);
		expect(claimCalls).toEqual([
			{ filename: evt.filename, agentId: "pr-triage" },
		]);
		expect(cleared).toEqual(["pr-triage"]);
		// Critical-1: the in-flight send guard is released on the happy path.
		expect(releaseCalls).toEqual([evt.filename]);
		// No send-failed telemetry on the happy path.
		const failed = emitMock.mock.calls.filter(
			(c) => (c[0] as { kind: string }).kind === "pr-triage-telegram-send-failed",
		);
		expect(failed).toHaveLength(0);
	});

	it("(TS-2) failed send → claimed FIRST (at-most-once), send-failed telemetry, no re-trip", async () => {
		const { mgr, claimCalls, releaseCalls } = makeSendStubManager();
		const { bot } = makeFakeTelegram(async () => ({
			ok: false,
			status: 429,
			error: "rate",
		}));
		const emitMock = vi.fn().mockResolvedValue(true);
		const cleared: string[] = [];
		const handler = makeTaskSendHandler({
			agentManager: mgr,
			emit: emitMock,
			telegramBot: bot as unknown as import("../telegram/bot.js").TelegramBot,
			clearResultTimer: (id) => cleared.push(id),
		});

		await handler({
			filename: "pr-triage-send__1700000301-1.json",
			agentId: "pr-triage",
			sendText: "summary",
		});

		// AT-MOST-ONCE: claimed (resolved) BEFORE the send, so a failed send does
		// NOT re-trip (which would duplicate or storm) — it is recorded instead.
		expect(claimCalls).toHaveLength(1);
		const failed = emitMock.mock.calls
			.map((c) => c[0] as { kind: string; alertKind?: string; details?: string })
			.filter((e) => e.kind === "pr-triage-telegram-send-failed");
		expect(failed).toHaveLength(1);
		expect(failed[0].alertKind).toBe("pr-triage-telegram-send-failed");
		expect(failed[0].details).toContain("429");
		// Timer always cleared in finally.
		expect(cleared).toEqual(["pr-triage"]);
		// The in-flight send guard is released in finally.
		expect(releaseCalls).toEqual(["pr-triage-send__1700000301-1.json"]);
	});

	it("(TS-3) noSend envelope → pr-triage-no-send + claim, NO send call", async () => {
		const { mgr, claimCalls } = makeSendStubManager();
		const { bot, calls } = makeFakeTelegram(async () => ({ ok: true }));
		const emitMock = vi.fn().mockResolvedValue(true);
		const handler = makeTaskSendHandler({
			agentManager: mgr,
			emit: emitMock,
			telegramBot: bot as unknown as import("../telegram/bot.js").TelegramBot,
			clearResultTimer: () => {},
		});

		await handler({
			filename: "pr-triage-send__1700000302-1.json",
			agentId: "pr-triage",
			noSend: true,
		});

		expect(calls).toHaveLength(0);
		expect(claimCalls).toEqual([
			{ filename: "pr-triage-send__1700000302-1.json", agentId: "pr-triage" },
		]);
		const noSend = emitMock.mock.calls.filter(
			(c) => (c[0] as { kind: string }).kind === "pr-triage-no-send",
		);
		expect(noSend).toHaveLength(1);
	});

	it("(TS-4) null telegramBot (local-dev) → claimed FIRST (no re-trip storm), records non-delivery", async () => {
		const { mgr, claimCalls } = makeSendStubManager();
		const emitMock = vi.fn().mockResolvedValue(true);
		const handler = makeTaskSendHandler({
			agentManager: mgr,
			emit: emitMock,
			telegramBot: null,
			clearResultTimer: () => {},
		});

		await handler({
			filename: "pr-triage-send__1700000303-1.json",
			agentId: "pr-triage",
			sendText: "summary",
		});

		// AT-MOST-ONCE: claimed (resolved) before the null-bot check, so a
		// token-less local-dev run records the non-delivery ONCE and does NOT
		// re-trip every 5s (the unbounded-retry storm the gate flagged).
		expect(claimCalls).toHaveLength(1);
		const failed = emitMock.mock.calls
			.map((c) => c[0] as { kind: string; details?: string })
			.filter((e) => e.kind === "pr-triage-telegram-send-failed");
		expect(failed).toHaveLength(1);
		expect(failed[0].details).toContain("telegram-not-configured");
	});

	it("(TS-5) noSend NOT claimed when telemetry record fails to persist (durability)", async () => {
		const { mgr, claimCalls } = makeSendStubManager();
		const { bot } = makeFakeTelegram(async () => ({ ok: true }));
		// emit resolves false → degraded telemetry dir.
		const emitMock = vi.fn().mockResolvedValue(false);
		const handler = makeTaskSendHandler({
			agentManager: mgr,
			emit: emitMock,
			telegramBot: bot as unknown as import("../telegram/bot.js").TelegramBot,
			clearResultTimer: () => {},
		});

		await handler({
			filename: "pr-triage-send__1700000304-1.json",
			agentId: "pr-triage",
			noSend: true,
		});

		// Not claimed — the no-send event must re-trip next tick.
		expect(claimCalls).toHaveLength(0);
	});

	it("(TS-6, Critical) a failed claim (rename fault) does NOT send — no duplicate-send vector", async () => {
		const { mgr, claimCalls, releaseCalls } = makeSendStubManager({
			claimSucceeds: false,
		});
		const { bot, calls } = makeFakeTelegram(async () => ({ ok: true }));
		const emitMock = vi.fn().mockResolvedValue(true);
		const handler = makeTaskSendHandler({
			agentManager: mgr,
			emit: emitMock,
			telegramBot: bot as unknown as import("../telegram/bot.js").TelegramBot,
			clearResultTimer: () => {},
		});

		await handler({
			filename: "pr-triage-send__1700000306-1.json",
			agentId: "pr-triage",
			sendText: "summary",
		});

		// Claim was ATTEMPTED but FAILED → the envelope stays in pending/ for a
		// later retry and the Telegram send is NEVER attempted, so a post-send
		// claim failure can never produce a duplicate user-visible send (the
		// pass#2 Critical). The in-flight slot is still released so a later tick
		// can retry the claim.
		expect(claimCalls).toHaveLength(1);
		expect(calls).toHaveLength(0);
		expect(releaseCalls).toEqual(["pr-triage-send__1700000306-1.json"]);
	});

	it("(TS-7, F3) a transient {ok:false} then {ok:true} → exactly ONE delivery, claimed once, no duplicate (fake timers)", async () => {
		vi.useFakeTimers();
		try {
			const { mgr, claimCalls, releaseCalls } = makeSendStubManager();
			// First attempt fails (429), second succeeds — the bounded retry must
			// absorb the blip rather than losing the day's summary.
			const responses: Array<{
				ok: boolean;
				status?: number;
				error?: string;
			}> = [{ ok: false, status: 429, error: "rate" }, { ok: true }];
			const { bot, calls } = makeFakeTelegram(async () => {
				const next = responses.shift();
				return next ?? { ok: true };
			});
			const emitMock = vi.fn().mockResolvedValue(true);
			const cleared: string[] = [];
			const handler = makeTaskSendHandler({
				agentManager: mgr,
				emit: emitMock,
				telegramBot: bot as unknown as import("../telegram/bot.js").TelegramBot,
				clearResultTimer: (id) => cleared.push(id),
				backoffMs: [10, 20],
			});

			const p = handler({
				filename: "pr-triage-send__1700000307-1.json",
				agentId: "pr-triage",
				sendText: "summary",
			});
			// Drain the awaited backoff delay between attempt 1 and attempt 2.
			await vi.advanceTimersByTimeAsync(10);
			await p;

			// Exactly two send attempts (fail → retry → success); ONE delivery to
			// the user (the second call) and never a duplicate.
			expect(calls).toHaveLength(2);
			// Claimed exactly once — the at-most-once claim happens before the
			// first attempt and is NOT repeated on retry.
			expect(claimCalls).toHaveLength(1);
			// No send-failed telemetry: the retry recovered.
			const failed = emitMock.mock.calls.filter(
				(c) => (c[0] as { kind: string }).kind === "pr-triage-telegram-send-failed",
			);
			expect(failed).toHaveLength(0);
			expect(cleared).toEqual(["pr-triage"]);
			expect(releaseCalls).toEqual(["pr-triage-send__1700000307-1.json"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("(TS-8, F3) a persistent {ok:false} → BOUNDED attempts then ONE send-failed + resolved, no infinite loop (fake timers)", async () => {
		vi.useFakeTimers();
		try {
			const { mgr, claimCalls, releaseCalls } = makeSendStubManager();
			// Every attempt fails — the loop MUST give up after the bounded budget,
			// never spin forever.
			const { bot, calls } = makeFakeTelegram(async () => ({
				ok: false,
				status: 500,
				error: "server",
			}));
			const emitMock = vi.fn().mockResolvedValue(true);
			const backoff = [10, 20];
			const handler = makeTaskSendHandler({
				agentManager: mgr,
				emit: emitMock,
				telegramBot: bot as unknown as import("../telegram/bot.js").TelegramBot,
				clearResultTimer: () => {},
				backoffMs: backoff,
			});

			const p = handler({
				filename: "pr-triage-send__1700000308-1.json",
				agentId: "pr-triage",
				sendText: "summary",
			});
			// Advance past every backoff delay so all retries resolve.
			await vi.advanceTimersByTimeAsync(10 + 20 + 1);
			await p;

			// BOUNDED: exactly 1 + backoff.length total attempts, never more.
			expect(calls).toHaveLength(1 + backoff.length);
			// Claimed exactly once (at-most-once before the first attempt).
			expect(claimCalls).toHaveLength(1);
			// EXACTLY ONE send-failed telemetry after the budget is exhausted —
			// not one-per-attempt, and not an unbounded storm.
			const failed = emitMock.mock.calls.filter(
				(c) => (c[0] as { kind: string }).kind === "pr-triage-telegram-send-failed",
			);
			expect(failed).toHaveLength(1);
			expect(releaseCalls).toEqual(["pr-triage-send__1700000308-1.json"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("(TS-9, Minor) an empty sendText is treated as noSend → pr-triage-no-send, NO blank delivery", async () => {
		const { mgr, claimCalls } = makeSendStubManager();
		const { bot, calls } = makeFakeTelegram(async () => ({ ok: true }));
		const emitMock = vi.fn().mockResolvedValue(true);
		const handler = makeTaskSendHandler({
			agentManager: mgr,
			emit: emitMock,
			telegramBot: bot as unknown as import("../telegram/bot.js").TelegramBot,
			clearResultTimer: () => {},
		});

		await handler({
			filename: "pr-triage-send__1700000309-1.json",
			agentId: "pr-triage",
			sendText: "   ",
		});

		// No blank message delivered.
		expect(calls).toHaveLength(0);
		// Recorded as no-send and resolved (durability gate satisfied).
		const noSend = emitMock.mock.calls.filter(
			(c) => (c[0] as { kind: string }).kind === "pr-triage-no-send",
		);
		expect(noSend).toHaveLength(1);
		expect(claimCalls).toHaveLength(1);
		// Must NOT emit a send-failed for an empty summary.
		const failed = emitMock.mock.calls.filter(
			(c) => (c[0] as { kind: string }).kind === "pr-triage-telegram-send-failed",
		);
		expect(failed).toHaveLength(0);
	});

	it("(TS-10) TELEGRAM_SEND_RETRY_BACKOFF_MS is a bounded, non-empty positive schedule", () => {
		expect(Array.isArray(TELEGRAM_SEND_RETRY_BACKOFF_MS)).toBe(true);
		expect(TELEGRAM_SEND_RETRY_BACKOFF_MS.length).toBeGreaterThan(0);
		for (const d of TELEGRAM_SEND_RETRY_BACKOFF_MS) {
			expect(typeof d).toBe("number");
			expect(d).toBeGreaterThan(0);
		}
	});

	it("(TS-11, round-2 Important) a stale-runId envelope is QUARANTINED before the send — sendAgentNotification is NOT called", async () => {
		// Round-2 Important (Codex): the wrong-run guard previously ran only AFTER
		// the irreversible Telegram send (inside `clearResultTimer`, in the
		// `finally`). A late/stale envelope from a PRIOR run was therefore delivered
		// to the user FIRST; the guard only prevented clearing the current run's
		// timer afterward. The fix consults `isActiveRun` BEFORE the claim/send: on a
		// runId mismatch the envelope is quarantined (claimed out of pending/) and
		// `pr-triage-stale-run-dropped` telemetry fires, and NO send happens.
		//
		// This test FAILS without the fix (sendAgentNotification IS called) and
		// PASSES with it.
		const { mgr, claimCalls } = makeSendStubManager();
		const { bot, calls } = makeFakeTelegram(async () => ({ ok: true }));
		const emitMock = vi.fn().mockResolvedValue(true);
		const cleared: Array<{ id: string; runId?: string }> = [];
		const handler = makeTaskSendHandler({
			agentManager: mgr,
			emit: emitMock,
			telegramBot: bot as unknown as import("../telegram/bot.js").TelegramBot,
			clearResultTimer: (id, runId) => {
				cleared.push({ id, runId });
			},
			// The active run is "run-NEW"; the inbound envelope carries the stale
			// "run-OLD", so isActiveRun resolves false → quarantine, no send.
			isActiveRun: async (_agentId, runId) => runId === "run-NEW",
		});

		await handler({
			filename: "pr-triage-send__stale-old.json",
			agentId: "pr-triage",
			sendText: "stale summary from a prior run",
			runId: "run-OLD",
		});

		// KEY assertion: the irreversible Telegram send NEVER happened.
		expect(calls).toHaveLength(0);
		// The stale envelope was quarantined out of pending/ (claimed once) so it
		// stops re-tripping every poll tick.
		expect(claimCalls).toEqual([
			{ filename: "pr-triage-send__stale-old.json", agentId: "pr-triage" },
		]);
		// Quarantine telemetry recorded with the stale runId.
		const dropped = emitMock.mock.calls
			.map((c) => c[0] as { kind: string; runId?: string })
			.filter((e) => e.kind === "pr-triage-stale-run-dropped");
		expect(dropped).toHaveLength(1);
		expect(dropped[0].runId).toBe("run-OLD");
		// No send was attempted, so no send-failed telemetry.
		const failed = emitMock.mock.calls.filter(
			(c) => (c[0] as { kind: string }).kind === "pr-triage-telegram-send-failed",
		);
		expect(failed).toHaveLength(0);
		// Dual-adversarial pass #2: a QUARANTINED envelope now SKIPS the finally's
		// clearResultTimer entirely (the handler set the `quarantined` flag) — strictly
		// safer than the prior call-then-inner-guard, and identical in outcome (the live
		// run is untouched). So no clear is attempted for the stale envelope.
		expect(cleared).toHaveLength(0);
	});

	it("(TS-12, round-2 Important) a MATCHING-runId envelope still sends (the guard does not block the live run)", async () => {
		// Companion to TS-11: when isActiveRun returns true (the envelope's runId
		// matches the active run), the send proceeds normally. Guards against an
		// over-eager pre-send guard that would suppress legitimate deliveries.
		const { mgr, claimCalls } = makeSendStubManager();
		const { bot, calls } = makeFakeTelegram(async () => ({ ok: true }));
		const emitMock = vi.fn().mockResolvedValue(true);
		const handler = makeTaskSendHandler({
			agentManager: mgr,
			emit: emitMock,
			telegramBot: bot as unknown as import("../telegram/bot.js").TelegramBot,
			clearResultTimer: () => {},
			isActiveRun: async (_agentId, runId) => runId === "run-NEW",
		});

		await handler({
			filename: "pr-triage-send__live.json",
			agentId: "pr-triage",
			sendText: "live summary",
			runId: "run-NEW",
		});

		// The send happened (the guard passed).
		expect(calls).toEqual(["live summary"]);
		expect(claimCalls).toHaveLength(1);
		// No quarantine telemetry for a live run.
		const dropped = emitMock.mock.calls.filter(
			(c) => (c[0] as { kind: string }).kind === "pr-triage-stale-run-dropped",
		);
		expect(dropped).toHaveLength(0);
	});

	it("(TS-12b, dual-adversarial pass #2 Critical) a runId-LESS envelope arriving while a run is ACTIVE is quarantined, NOT sent, and does NOT clear the live run's timer", async () => {
		// Without the fix the pre-send guard was gated on `evt.runId !== undefined`, so
		// a runId-less envelope (a NORMAL agent failure mode — the echo is optional)
		// skipped the guard and (1) pushed a stale prior summary to Telegram and (2)
		// `clearResultTimer(agentId, undefined)` matched the live timer by agentId and
		// stripped the CURRENT run's dead-letter protection. The fix calls isActiveRun
		// even with no runId (quarantine when a run is active) AND skips the finally
		// clear on quarantine. RED without the fix: a send happens and clear is called.
		const { mgr, claimCalls } = makeSendStubManager();
		const { bot, calls } = makeFakeTelegram(async () => ({ ok: true }));
		const emitMock = vi.fn().mockResolvedValue(true);
		const cleared: Array<{ id: string; runId?: string }> = [];
		const handler = makeTaskSendHandler({
			agentManager: mgr,
			emit: emitMock,
			telegramBot: bot as unknown as import("../telegram/bot.js").TelegramBot,
			clearResultTimer: (id, runId) => cleared.push({ id, runId }),
			// A run IS active; only its own runId ("run-LIVE") is confirmable. A
			// runId-less envelope cannot be confirmed, so isActiveRun returns false.
			isActiveRun: async (_agentId, runId) => runId === "run-LIVE",
		});

		await handler({
			filename: "pr-triage-send__norunid.json",
			agentId: "pr-triage",
			sendText: "stale summary from a prior run",
			// no runId
		});

		// Quarantined BEFORE the irreversible Telegram send.
		expect(calls).toHaveLength(0);
		// stale-run-dropped telemetry recorded (with NO runId field on a runId-less env).
		const dropped = emitMock.mock.calls
			.map((c) => c[0])
			.filter(
				(e) => (e as { kind: string }).kind === "pr-triage-stale-run-dropped",
			);
		expect(dropped).toHaveLength(1);
		expect(dropped[0]).not.toHaveProperty("runId");
		// Envelope claimed out of pending/ so it stops re-tripping.
		expect(claimCalls).toHaveLength(1);
		// CRITICAL: clearResultTimer must NOT be called — a runId-less clear would
		// strip the live run's timer/marker/held slot.
		expect(cleared).toHaveLength(0);
	});

	it("(TS-12c, dual-adversarial pass #2 Critical) a runId-LESS noSend envelope arriving while a run is ACTIVE is quarantined, NOT recorded as no-send, and does NOT clear the live run's timer", async () => {
		// Twin of TS-12b for the noSend/empty-summary path. Without the fix the noSend
		// branch returned BEFORE the isActiveRun guard, so `quarantined` stayed false
		// and the `finally` called clearResultTimer(agentId, undefined) — stripping the
		// live run's dead-letter timer/marker/held cron slot (silent summary drop +
		// duplicate dispatch). The fix hoists the quarantine guard ABOVE the noSend
		// branch. RED without the fix: pr-triage-no-send is emitted and clearResultTimer
		// is called.
		const { mgr, claimCalls } = makeSendStubManager();
		const { bot, calls } = makeFakeTelegram(async () => ({ ok: true }));
		const emitMock = vi.fn().mockResolvedValue(true);
		const cleared: Array<{ id: string; runId?: string }> = [];
		const handler = makeTaskSendHandler({
			agentManager: mgr,
			emit: emitMock,
			telegramBot: bot as unknown as import("../telegram/bot.js").TelegramBot,
			clearResultTimer: (id, runId) => cleared.push({ id, runId }),
			// A run IS active; only its own runId ("run-LIVE") is confirmable. A
			// runId-less noSend envelope cannot be confirmed, so isActiveRun returns false.
			isActiveRun: async (_agentId, runId) => runId === "run-LIVE",
		});

		await handler({
			filename: "pr-triage-send__norunid-nosend.json",
			agentId: "pr-triage",
			noSend: true,
			// no runId
		});

		// No Telegram send for a noSend (and none for a quarantine).
		expect(calls).toHaveLength(0);
		// Quarantined → stale-run-dropped recorded; pr-triage-no-send must NOT fire (a
		// stale envelope is not a legitimate "nothing to send" for the live run).
		const kinds = emitMock.mock.calls.map((c) => (c[0] as { kind: string }).kind);
		expect(kinds).toContain("pr-triage-stale-run-dropped");
		expect(kinds).not.toContain("pr-triage-no-send");
		// Claimed out of pending/ exactly once (the quarantine claim).
		expect(claimCalls).toHaveLength(1);
		// CRITICAL: clearResultTimer must NOT be called — a runId-less clear would
		// strip the live run's timer/marker/held slot.
		expect(cleared).toHaveLength(0);
	});

	it("(TS-12d, dual-adversarial pass #2 Critical) a runId-LESS empty-summary envelope (no noSend flag) while a run is ACTIVE is also quarantined", async () => {
		// The noSend/empty branch has TWO entries: explicit `noSend:true` (TS-12c) and
		// an empty/whitespace `sendText` with no flag (this test). Both must pass through
		// the hoisted quarantine guard. RED without the fix: clearResultTimer is called
		// for the empty-summary path too.
		const { mgr, claimCalls } = makeSendStubManager();
		const { bot, calls } = makeFakeTelegram(async () => ({ ok: true }));
		const emitMock = vi.fn().mockResolvedValue(true);
		const cleared: Array<{ id: string; runId?: string }> = [];
		const handler = makeTaskSendHandler({
			agentManager: mgr,
			emit: emitMock,
			telegramBot: bot as unknown as import("../telegram/bot.js").TelegramBot,
			clearResultTimer: (id, runId) => cleared.push({ id, runId }),
			isActiveRun: async (_agentId, runId) => runId === "run-LIVE",
		});

		await handler({
			filename: "pr-triage-send__norunid-empty.json",
			agentId: "pr-triage",
			sendText: "   ", // whitespace-only → treated as empty-summary
			// no runId, no noSend flag
		});

		expect(calls).toHaveLength(0);
		const kinds = emitMock.mock.calls.map((c) => (c[0] as { kind: string }).kind);
		expect(kinds).toContain("pr-triage-stale-run-dropped");
		expect(kinds).not.toContain("pr-triage-no-send");
		expect(claimCalls).toHaveLength(1);
		expect(cleared).toHaveLength(0);
	});
});

describe("makeResultTimers + dispatch arming (R1 D4 dead-letter)", () => {
	it("(RT-1) startResultTimer emits pr-triage-result-timeout after the deadline (fake timers)", async () => {
		vi.useFakeTimers();
		const emitMock = vi.fn().mockResolvedValue(true);
		const { startResultTimer } = makeResultTimers({
			emit: emitMock,
			timeoutMs: 1000,
		});

		// Task 6: startResultTimer is now async (writes the durable marker before
		// arming the in-memory timer) and takes a correlation runId — await it so
		// the setTimeout is scheduled before the fake clock advances.
		await startResultTimer("pr-triage", "run-rt1");
		expect(emitMock).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1000);

		const timeouts = emitMock.mock.calls.filter(
			(c) => (c[0] as { kind: string }).kind === "pr-triage-result-timeout",
		);
		expect(timeouts).toHaveLength(1);
		expect(timeouts[0][0]).toMatchObject({
			kind: "pr-triage-result-timeout",
			agentId: "pr-triage",
			reason: "no-envelope-before-deadline",
		});
	});

	it("(RT-2) clearResultTimer cancels the dead-letter timer (no emit)", async () => {
		vi.useFakeTimers();
		const emitMock = vi.fn().mockResolvedValue(true);
		const { startResultTimer, clearResultTimer } = makeResultTimers({
			emit: emitMock,
			timeoutMs: 1000,
		});

		await startResultTimer("pr-triage", "run-rt2");
		// Clear with no runId → unconditional clear (the matching-run case is
		// covered by the wrong-run regression below).
		await clearResultTimer("pr-triage");
		await vi.advanceTimersByTimeAsync(2000);

		expect(
			emitMock.mock.calls.filter(
				(c) => (c[0] as { kind: string }).kind === "pr-triage-result-timeout",
			),
		).toHaveLength(0);
	});

	it("(RT-3) a re-fire overwrites the prior timer (single in-flight per agent)", async () => {
		vi.useFakeTimers();
		const emitMock = vi.fn().mockResolvedValue(true);
		const { startResultTimer } = makeResultTimers({
			emit: emitMock,
			timeoutMs: 1000,
		});

		await startResultTimer("pr-triage", "run-rt3a");
		await vi.advanceTimersByTimeAsync(500);
		// Re-fire resets the clock (clear-then-set). A NEW dispatch supersedes the
		// prior run's timer + marker regardless of runId.
		await startResultTimer("pr-triage", "run-rt3b");
		// Minor (Opus, round 1): the overwrite must ATOMICALLY replace the marker —
		// a marker is ALWAYS on disk across the re-fire (no pre-write unlink window),
		// and it now carries the NEW run's runId.
		const markerPath = path.join(pathFor("result-pending"), "pr-triage.json");
		const marker = JSON.parse(await fsp.readFile(markerPath, "utf-8")) as {
			runId: string;
		};
		expect(marker.runId).toBe("run-rt3b");
		await vi.advanceTimersByTimeAsync(700);
		// 1200ms total elapsed but only 700ms since the re-fire — not yet fired.
		expect(
			emitMock.mock.calls.filter(
				(c) => (c[0] as { kind: string }).kind === "pr-triage-result-timeout",
			),
		).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(400);
		expect(
			emitMock.mock.calls.filter(
				(c) => (c[0] as { kind: string }).kind === "pr-triage-result-timeout",
			),
		).toHaveLength(1);
	});

	it("(RT-4) RESULT_TIMEOUT_MS default is a positive number", () => {
		expect(typeof RESULT_TIMEOUT_MS).toBe("number");
		expect(RESULT_TIMEOUT_MS).toBeGreaterThan(0);
	});

	it("(RT-6, dual-adversarial pass #2 Critical) isActiveRun quarantines a missing/mismatched runId while a run is ACTIVE, and allows it when none is active", async () => {
		const emitMock = vi.fn().mockResolvedValue(true);
		const { startResultTimer, isActiveRun } = makeResultTimers({
			emit: emitMock,
			timeoutMs: 60_000,
		});

		// No active run → an undefined/empty runId is NOT quarantined (no live run to
		// misattribute against — the legacy/no-correlation path).
		expect(await isActiveRun("pr-triage", undefined)).toBe(true);
		expect(await isActiveRun("pr-triage", "")).toBe(true);

		// Arm a live run.
		await startResultTimer("pr-triage", "run-A", "pr-triage__1.json");

		// The live run's own runId → active (the send proceeds).
		expect(await isActiveRun("pr-triage", "run-A")).toBe(true);
		// A DIFFERENT runId (a stale/prior run's envelope) → quarantine.
		expect(await isActiveRun("pr-triage", "run-B")).toBe(false);
		// A MISSING runId while a run IS active → quarantine. THE Critical fix: the
		// prior code short-circuited `undefined` to `true`, letting a runId-less stale
		// summary bypass the guard and be pushed to Telegram. RED without the fix.
		expect(await isActiveRun("pr-triage", undefined)).toBe(false);
		// An empty-string runId behaves identically to missing (it cannot match the
		// live UUID); upstream normalization maps it to undefined too.
		expect(await isActiveRun("pr-triage", "")).toBe(false);
	});

	it("(RT-13, #92 gate Imp 1) isActiveRun + clearResultTimer resolve a marker-ONLY run (no in-memory timer) after a restart", async () => {
		// #92 gate finding (lens:tests): every other RT-* test arms a LIVE in-memory
		// timer via startResultTimer, so the `existing === undefined` marker-AUTHORITY
		// branch — isActiveRun's durable-marker fallback and clearResultTimer's
		// no-in-memory-timer path (both load-bearing after a daemon RESTART, where the
		// in-memory timer is gone but the durable marker survives) — was exercised by
		// no test. This builds a FRESH makeResultTimers (NO startResultTimer → empty
		// timers map) and seeds the marker by hand to pin that branch directly.
		const emitMock = vi.fn().mockResolvedValue(true);
		const completions: Array<{ agentId: string; filename: string | null }> = [];
		const { isActiveRun, clearResultTimer } = makeResultTimers({
			emit: emitMock,
			timeoutMs: 60_000,
			onResultComplete: (agentId, filename) =>
				completions.push({ agentId, filename }),
		});

		// Seed a durable marker as if a prior process armed it then restarted — THIS
		// instance has no in-memory timer for the agent.
		const markerPath = path.join(pathFor("result-pending"), "pr-triage.json");
		await fsp.writeFile(
			markerPath,
			JSON.stringify({
				agentId: "pr-triage",
				runId: "run-marker",
				filename: "pr-triage__marker.json",
				deadlineMs: Date.now() + 60_000,
			}),
		);

		// isActiveRun marker-authority branch: the marker's runId is the active run;
		// a DIFFERENT runId is quarantined, and a MISSING runId is quarantined too —
		// the same short-circuit-undefined Critical the live-timer RT-6 pins, but on
		// the post-restart marker path.
		expect(await isActiveRun("pr-triage", "run-marker")).toBe(true);
		expect(await isActiveRun("pr-triage", "run-other")).toBe(false);
		expect(await isActiveRun("pr-triage", undefined)).toBe(false);

		// clearResultTimer marker-authority branch: a wrong-run clear is a no-op —
		// returns false, retains the marker, and does NOT release the cron slot.
		expect(await clearResultTimer("pr-triage", "run-other")).toBe(false);
		await expect(fsp.access(markerPath)).resolves.toBeUndefined();
		expect(completions).toHaveLength(0);

		// The matching-run clear removes the marker and releases the slot with the
		// marker's ORIGINAL cron filename (read from disk, since there is no in-memory
		// timer to source it from).
		expect(await clearResultTimer("pr-triage", "run-marker")).toBe(true);
		await expect(fsp.access(markerPath)).rejects.toBeDefined();
		expect(completions).toEqual([
			{ agentId: "pr-triage", filename: "pr-triage__marker.json" },
		]);
	});

	it("(RT-7, dual-adversarial pass #2 Important) a FAILED timeout-telemetry write retains the durable marker and does not release the slot (real timers)", async () => {
		// Durability gate: the prior order (delete marker -> fire-and-forget emit) lost
		// the dropped-summary signal when the telemetry append failed (ENOSPC/EACCES).
		// The fix records the timeout FIRST and only removes the marker / releases the
		// slot on a durable write. RED without the fix: the marker is unlinked anyway.
		const released: Array<{ agentId: string; filename: string | null }> = [];
		// emit returns FALSE for the timeout event (simulated telemetry-disk fault).
		const emitMock = vi
			.fn()
			.mockImplementation(
				async (e: { kind: string }) => e.kind !== "pr-triage-result-timeout",
			);
		const { startResultTimer } = makeResultTimers({
			emit: emitMock,
			timeoutMs: 20,
			onResultComplete: (agentId, filename) =>
				released.push({ agentId, filename }),
		});

		const exists = (p: string) =>
			fsp
				.access(p)
				.then(() => true)
				.catch(() => false);
		const markerPath = path.join(pathFor("result-pending"), "pr-triage.json");

		await startResultTimer("pr-triage", "run-rt7", "pr-triage__7.json");
		expect(await exists(markerPath)).toBe(true);

		// Real timers: wait past the 20ms deadline so the timeout callback + its async
		// durability gate fully run.
		await new Promise<void>((r) => setTimeout(r, 80));

		// The timeout telemetry was attempted...
		expect(
			emitMock.mock.calls.filter(
				(c) => (c[0] as { kind: string }).kind === "pr-triage-result-timeout",
			),
		).toHaveLength(1);
		// ...but FAILED to record, so the marker is RETAINED (boot recovery can
		// re-surface the dropped-summary signal) and the cron slot is NOT released.
		expect(await exists(markerPath)).toBe(true);
		expect(released).toHaveLength(0);
	});

	it("(RT-5) startResultTimer writes a durable result-pending marker carrying the runId + deadline", async () => {
		// Task 6 (Critical) durability: the dead-letter must survive a restart, so
		// startResultTimer persists `result-pending/<agentId>.json` BEFORE arming
		// the in-memory timer. Asserts the marker lands on disk with the
		// correlation runId, the dispatched filename, and a future deadline.
		const emitMock = vi.fn().mockResolvedValue(true);
		const { startResultTimer } = makeResultTimers({
			emit: emitMock,
			timeoutMs: 60_000,
		});

		const before = Date.now();
		await startResultTimer("pr-triage", "run-marker", "pr-triage__9.json");

		const markerPath = path.join(pathFor("result-pending"), "pr-triage.json");
		const marker = JSON.parse(await fsp.readFile(markerPath, "utf-8")) as {
			agentId: string;
			runId: string;
			filename: string | null;
			deadlineMs: number;
		};
		expect(marker.agentId).toBe("pr-triage");
		expect(marker.runId).toBe("run-marker");
		expect(marker.filename).toBe("pr-triage__9.json");
		expect(marker.deadlineMs).toBeGreaterThanOrEqual(before + 60_000);
	});

	it("(RT-6) a stale/wrong-run envelope does NOT clear the live run's timer or marker", async () => {
		// Task 6 (Critical) correlation: clearResultTimer(agentId, wrongRunId) must
		// be a no-op (returns false) so a late envelope from a PRIOR dispatch
		// cannot cancel the CURRENT run's dead-letter timer. The live timer must
		// still fire and the marker must still be present after the wrong-run clear.
		vi.useFakeTimers();
		const emitMock = vi.fn().mockResolvedValue(true);
		const { startResultTimer, clearResultTimer } = makeResultTimers({
			emit: emitMock,
			timeoutMs: 1000,
		});

		await startResultTimer("pr-triage", "live-run");
		// A stale envelope from a prior run tries to clear with the wrong runId.
		const cleared = await clearResultTimer("pr-triage", "stale-prior-run");
		expect(cleared).toBe(false);

		// Marker is still on disk (not removed by the wrong-run clear).
		const markerPath = path.join(pathFor("result-pending"), "pr-triage.json");
		await expect(fsp.access(markerPath)).resolves.toBeUndefined();

		// The live timer still fires its dead-letter.
		await vi.advanceTimersByTimeAsync(1000);
		const timeouts = emitMock.mock.calls.filter(
			(c) => (c[0] as { kind: string }).kind === "pr-triage-result-timeout",
		);
		expect(timeouts).toHaveLength(1);

		// A matching-run clear DOES succeed and removes the marker.
		await startResultTimer("pr-triage", "second-run");
		const ok = await clearResultTimer("pr-triage", "second-run");
		expect(ok).toBe(true);
		await expect(fsp.access(markerPath)).rejects.toBeDefined();
	});

	it("(RT-7) recoverResultTimers re-arms a still-future orphaned marker after a restart", async () => {
		// Task 6 (Critical) restart recovery: a dispatch in flight when the daemon
		// restarts leaves a durable marker with a FUTURE deadline. A fresh
		// makeResultTimers (simulating the new process) must re-arm the timer from
		// the marker so the dead-letter still fires — the daily summary is not
		// silently dropped.
		vi.useFakeTimers();
		// Simulate the marker the dead process left behind: deadline 1000ms out.
		const markerPath = path.join(pathFor("result-pending"), "pr-triage.json");
		await fsp.writeFile(
			markerPath,
			JSON.stringify({
				agentId: "pr-triage",
				runId: "orphaned-run",
				filename: "pr-triage__7.json",
				deadlineMs: Date.now() + 1000,
			}),
		);

		const emitMock = vi.fn().mockResolvedValue(true);
		const { recoverResultTimers } = makeResultTimers({
			emit: emitMock,
			timeoutMs: 120_000,
		});
		await recoverResultTimers();

		// Not yet fired.
		expect(
			emitMock.mock.calls.filter(
				(c) => (c[0] as { kind: string }).kind === "pr-triage-result-timeout",
			),
		).toHaveLength(0);

		await vi.advanceTimersByTimeAsync(1000);
		const timeouts = emitMock.mock.calls.filter(
			(c) => (c[0] as { kind: string }).kind === "pr-triage-result-timeout",
		);
		expect(timeouts).toHaveLength(1);
		// Marker removed once the re-armed timer fired. #92 I4 — the removal is
		// fire-and-forget (`void removeMarker` inside fireTimeout), so its unlink
		// microtask may not have flushed when `advanceTimersByTimeAsync` returns.
		// Asserting absence synchronously flaked under parallel-worker contention
		// (the unlink's real fs IO lags). Poll for absence instead: each
		// `fsp.access` await yields to the event loop so the pending unlink settles.
		let markerGone = false;
		for (let i = 0; i < 100 && !markerGone; i++) {
			markerGone = await fsp
				.access(markerPath)
				.then(() => false)
				.catch(() => true);
			if (!markerGone) await vi.advanceTimersByTimeAsync(1);
		}
		expect(markerGone).toBe(true);
	});

	it("(RT-9 — Task 6 #2) onResultComplete fires with the cron filename on envelope-clear AND on dead-letter timeout", async () => {
		// Task 6 gate-finding #2 (hold-slot-until-result): the result-timer
		// machinery must signal RUN COMPLETION (so the daemon releases the held
		// cron slot) at BOTH terminal points — the envelope being processed
		// (clearResultTimer) and the dead-letter timeout firing — echoing the
		// original cron task filename both times.
		vi.useFakeTimers();
		const emitMock = vi.fn().mockResolvedValue(true);
		const completions: Array<{ agentId: string; filename: string | null }> = [];
		const { startResultTimer, clearResultTimer } = makeResultTimers({
			emit: emitMock,
			timeoutMs: 1000,
			onResultComplete: (agentId, filename) =>
				completions.push({ agentId, filename }),
		});

		// (a) envelope processed → completion fires with the cron filename.
		await startResultTimer("pr-triage", "run-a", "pr-triage__111.json");
		await clearResultTimer("pr-triage", "run-a");
		expect(completions).toContainEqual({
			agentId: "pr-triage",
			filename: "pr-triage__111.json",
		});

		// (b) dead-letter timeout → completion fires with the cron filename.
		completions.length = 0;
		await startResultTimer("pr-triage", "run-b", "pr-triage__222.json");
		await vi.advanceTimersByTimeAsync(1000);
		expect(completions).toContainEqual({
			agentId: "pr-triage",
			filename: "pr-triage__222.json",
		});

		// (c) a re-fire OVERWRITE must NOT fire completion (the prior run is
		// superseded, not finished) — only the new run's terminal point does.
		completions.length = 0;
		await startResultTimer("pr-triage", "run-c1", "pr-triage__333.json");
		await startResultTimer("pr-triage", "run-c2", "pr-triage__444.json");
		expect(completions).toHaveLength(0);
	});

	it("(RT-11, round-2 Minor) recoverResultTimers RE-HOLDS the cron slot for a still-future marker via onResultRecovered (and NOT for an expired one)", async () => {
		// Round-2 Minor (Codex): a still-in-flight run recovered from a future
		// result-pending marker must RE-HELD its CronScheduler concurrency slot, or
		// the scheduler boots at runningCount=0 and a matching cron tick could
		// dispatch a SECOND prompt that overwrites the single marker. The
		// expired-marker branch dead-letters (releases via onResultComplete) and must
		// NOT re-hold. This test asserts onResultRecovered fires for the future
		// marker only.
		//
		// FAILS without the fix (onResultRecovered never wired/called) — the recovered
		// run's slot is never re-held.
		vi.useFakeTimers();
		const recovered: Array<{ agentId: string; filename: string | null }> = [];
		const completed: Array<{ agentId: string; filename: string | null }> = [];

		// (a) future marker → re-hold.
		const futureMarker = path.join(pathFor("result-pending"), "pr-triage.json");
		await fsp.writeFile(
			futureMarker,
			JSON.stringify({
				agentId: "pr-triage",
				runId: "inflight-run",
				filename: "pr-triage__900.json",
				deadlineMs: Date.now() + 5000,
			}),
		);
		const emitMock = vi.fn().mockResolvedValue(true);
		const { recoverResultTimers } = makeResultTimers({
			emit: emitMock,
			timeoutMs: 120_000,
			onResultComplete: (agentId, filename) =>
				completed.push({ agentId, filename }),
			onResultRecovered: (agentId, filename) =>
				recovered.push({ agentId, filename }),
		});
		await recoverResultTimers();

		// The recovered in-flight run re-held its slot with the cron filename.
		expect(recovered).toEqual([
			{ agentId: "pr-triage", filename: "pr-triage__900.json" },
		]);
		// It is still in flight (no completion yet — slot stays held).
		expect(completed).toHaveLength(0);

		// (b) expired marker → dead-letter, release (NOT re-hold).
		// Remove the future pr-triage marker first so part (b)'s scan only sees the
		// expired other-agent marker (recoverResultTimers scans the whole dir).
		await fsp.unlink(futureMarker).catch(() => undefined);
		recovered.length = 0;
		completed.length = 0;
		const expiredMarker = path.join(
			pathFor("result-pending"),
			"other-agent.json",
		);
		await fsp.writeFile(
			expiredMarker,
			JSON.stringify({
				agentId: "other-agent",
				runId: "expired-run",
				filename: "other-agent__1.json",
				deadlineMs: Date.now() - 1000,
			}),
		);
		const emitMock2 = vi.fn().mockResolvedValue(true);
		const { recoverResultTimers: recover2 } = makeResultTimers({
			emit: emitMock2,
			onResultComplete: (agentId, filename) =>
				completed.push({ agentId, filename }),
			onResultRecovered: (agentId, filename) =>
				recovered.push({ agentId, filename }),
		});
		await recover2();

		// Expired → released (slot freed), NOT re-held.
		expect(recovered).toHaveLength(0);
		expect(completed).toEqual([
			{ agentId: "other-agent", filename: "other-agent__1.json" },
		]);
	});

	it("(RT-8) recoverResultTimers immediately dead-letters an already-expired orphaned marker", async () => {
		// Task 6 (Critical) restart recovery, expired branch: if the marker's
		// deadline already passed while the daemon was down, recovery must emit the
		// dead-letter immediately (reason orphaned-dispatch-recovered) and remove
		// the marker — the orphaned dispatch is never silently lost.
		const markerPath = path.join(pathFor("result-pending"), "pr-triage.json");
		await fsp.writeFile(
			markerPath,
			JSON.stringify({
				agentId: "pr-triage",
				runId: "expired-run",
				filename: "pr-triage__7.json",
				deadlineMs: Date.now() - 5000,
			}),
		);

		const emitMock = vi.fn().mockResolvedValue(true);
		const { recoverResultTimers } = makeResultTimers({ emit: emitMock });
		await recoverResultTimers();

		const timeouts = emitMock.mock.calls.filter(
			(c) => (c[0] as { kind: string }).kind === "pr-triage-result-timeout",
		);
		expect(timeouts).toHaveLength(1);
		expect(timeouts[0][0]).toMatchObject({
			kind: "pr-triage-result-timeout",
			agentId: "pr-triage",
			reason: "orphaned-dispatch-recovered",
		});
		await expect(fsp.access(markerPath)).rejects.toBeDefined();
	});

	it("(RT-12, dual-adversarial pass #2 Important) an expired orphaned marker whose timeout telemetry FAILS to record is RETAINED and the slot is NOT released", async () => {
		// Durability gate, the BOOT-recovery twin of RT-7's live-fireTimeout coverage.
		// The prior order (unlink marker → ignore emit's boolean) lost the
		// orphaned-dispatch signal when the telemetry append failed (ENOSPC/EACCES) —
		// nothing remained for the next boot to re-scan. The fix records the timeout
		// FIRST and only unlinks the marker / releases the slot on a durable write. RED
		// without the fix: the marker is unlinked anyway and onResultComplete fires.
		const markerPath = path.join(pathFor("result-pending"), "pr-triage.json");
		await fsp.writeFile(
			markerPath,
			JSON.stringify({
				agentId: "pr-triage",
				runId: "expired-run",
				filename: "pr-triage__7.json",
				deadlineMs: Date.now() - 5000,
			}),
		);
		const completed: Array<{ agentId: string; filename: string | null }> = [];
		// emit returns FALSE for the timeout event (simulated telemetry-disk fault).
		const emitMock = vi
			.fn()
			.mockImplementation(
				async (e: { kind: string }) => e.kind !== "pr-triage-result-timeout",
			);
		const { recoverResultTimers } = makeResultTimers({
			emit: emitMock,
			onResultComplete: (agentId, filename) =>
				completed.push({ agentId, filename }),
		});
		await recoverResultTimers();

		// The timeout telemetry was attempted...
		expect(
			emitMock.mock.calls.filter(
				(c) => (c[0] as { kind: string }).kind === "pr-triage-result-timeout",
			),
		).toHaveLength(1);
		// ...but FAILED to record, so the marker is RETAINED (the next boot re-surfaces
		// the orphaned-dispatch signal) and the cron slot is NOT released.
		await expect(fsp.access(markerPath)).resolves.toBeUndefined();
		expect(completed).toHaveLength(0);
	});

	it("(RT-10 — Critical, round 1) a late stale envelope (old runId) does NOT clear the NEW run's timer via the send handler", async () => {
		// Critical (Codex, round 1): the send handler must run-correlate the clear
		// using the ENVELOPE's runId (carried through `task-send-needed`), NOT the
		// runId re-read from the live on-disk marker. The marker always holds the
		// CURRENT run's runId, so reading it made the wrong-run guard a dead branch.
		//
		// Scenario: run-A dispatched, then run-B started (overwrite — new
		// marker/timer). A LATE envelope from run-A arrives. With the bug, the
		// handler reads the marker (now run-B's runId) and clears run-B's live
		// timer + marker, releasing its slot and suppressing its dead-letter. With
		// the fix, the handler passes the envelope's `runId: "run-a"`, the wrong-run
		// guard fails the clear, and run-B's dead-letter STILL fires.
		vi.useFakeTimers();
		try {
			const emitMock = vi.fn().mockResolvedValue(true);
			const completions: Array<{
				agentId: string;
				filename: string | null;
			}> = [];
			const { startResultTimer, clearResultTimer } = makeResultTimers({
				emit: emitMock,
				timeoutMs: 1000,
				onResultComplete: (agentId, filename) =>
					completions.push({ agentId, filename }),
			});

			// run-A dispatched, then superseded by run-B (overwrite).
			await startResultTimer("pr-triage", "run-a", "pr-triage__a.json");
			await startResultTimer("pr-triage", "run-b", "pr-triage__b.json");

			// A LATE envelope from run-A reaches the send handler. The handler is
			// wired to the REAL run-correlated clearResultTimer. The envelope echoes
			// run-A's runId — the value the agent copied in at run-A's dispatch.
			const { mgr } = makeSendStubManager();
			const { bot } = makeFakeTelegram(async () => ({ ok: true }));
			const sendHandler = makeTaskSendHandler({
				agentManager: mgr,
				emit: emitMock,
				telegramBot: bot as unknown as import("../telegram/bot.js").TelegramBot,
				clearResultTimer,
			});
			await sendHandler({
				filename: "pr-triage-send__stale.json",
				agentId: "pr-triage",
				sendText: "stale summary from run-A",
				runId: "run-a",
			});

			// The stale clear must NOT have completed run-B (no slot release for it).
			expect(completions).toHaveLength(0);
			// run-B's marker is still on disk.
			const markerPath = path.join(pathFor("result-pending"), "pr-triage.json");
			await expect(fsp.access(markerPath)).resolves.toBeUndefined();

			// run-B's dead-letter STILL fires (its timer was not cleared by the stale
			// envelope).
			await vi.advanceTimersByTimeAsync(1000);
			const timeouts = emitMock.mock.calls.filter(
				(c) => (c[0] as { kind: string }).kind === "pr-triage-result-timeout",
			);
			expect(timeouts).toHaveLength(1);
			// And the completion that DID fire is run-B's (via its dead-letter), with
			// run-B's filename — never run-A's.
			expect(completions).toEqual([
				{ agentId: "pr-triage", filename: "pr-triage__b.json" },
			]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("(RT-11 — Critical, round 1) the LIVE run's envelope (matching runId) clears its own timer via the send handler", async () => {
		// Companion to RT-10: the in-run envelope (carrying the CURRENT run's runId)
		// DOES clear the timer + marker and release the slot — the guard only
		// rejects MISMATCHED runIds, never the live one.
		vi.useFakeTimers();
		try {
			const emitMock = vi.fn().mockResolvedValue(true);
			const completions: Array<{
				agentId: string;
				filename: string | null;
			}> = [];
			const { startResultTimer, clearResultTimer } = makeResultTimers({
				emit: emitMock,
				timeoutMs: 1000,
				onResultComplete: (agentId, filename) =>
					completions.push({ agentId, filename }),
			});
			await startResultTimer("pr-triage", "run-live", "pr-triage__live.json");

			const { mgr } = makeSendStubManager();
			const { bot } = makeFakeTelegram(async () => ({ ok: true }));
			const sendHandler = makeTaskSendHandler({
				agentManager: mgr,
				emit: emitMock,
				telegramBot: bot as unknown as import("../telegram/bot.js").TelegramBot,
				clearResultTimer,
			});
			await sendHandler({
				filename: "pr-triage-send__live.json",
				agentId: "pr-triage",
				sendText: "today's summary",
				runId: "run-live",
			});

			// The matching-run clear completed the run with its cron filename.
			expect(completions).toEqual([
				{ agentId: "pr-triage", filename: "pr-triage__live.json" },
			]);
			// Marker removed; no dead-letter ever fires.
			const markerPath = path.join(pathFor("result-pending"), "pr-triage.json");
			await expect(fsp.access(markerPath)).rejects.toBeDefined();
			await vi.advanceTimersByTimeAsync(1000);
			const timeouts = emitMock.mock.calls.filter(
				(c) => (c[0] as { kind: string }).kind === "pr-triage-result-timeout",
			);
			expect(timeouts).toHaveLength(0);
		} finally {
			vi.useRealTimers();
		}
	});
});

// ---------------------------------------------------------------------------
// R1 (feature-pr84-r1-daemon-creds): makePrTriageCronPrompt
// ---------------------------------------------------------------------------

describe("makePrTriageCronPrompt (R1)", () => {
	const cron = {
		agentId: "pr-triage",
		schedule: "0 14 * * *",
		wakeCheck: undefined,
		promptTemplatePath: "/tmp/template.md",
		outputTaskNamePrefix: "pr-triage",
		maxConcurrent: 1,
	};

	it("(CP-1) zero open PRs → { skip: true, reason: 'no-open-prs' } (replaces wake-check)", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(JSON.stringify({ data: { search: { nodes: [] } } }), {
					status: 200,
				}),
		) as unknown as typeof fetch;
		const prepare = makePrTriageCronPrompt({
			token: "ghp_token",
			fetchImpl,
			readTemplate: () => `prompt ${PR_DATA_PLACEHOLDER}`,
		});
		const result = await prepare(cron);
		expect(result.skip).toBe(true);
		expect(result.reason).toBe("no-open-prs");
		expect(result.prompt).toBeUndefined();
	});

	it("(CP-3, FIX C) reads GH_TOKEN lazily via getToken at fire-time (picks up SIGHUP rotation)", async () => {
		let currentToken: string | undefined = "ghp_old_token";
		const seenAuth: Array<string | undefined> = [];
		const fetchImpl = vi.fn(
			async (_url: string | URL | Request, init?: RequestInit) => {
				const auth = (init?.headers as Record<string, string> | undefined)
					?.Authorization;
				seenAuth.push(auth);
				return new Response(JSON.stringify({ data: { search: { nodes: [] } } }), {
					status: 200,
				});
			},
		) as unknown as typeof fetch;
		const prepare = makePrTriageCronPrompt({
			getToken: () => currentToken,
			fetchImpl,
			readTemplate: () => `prompt ${PR_DATA_PLACEHOLDER}`,
		});
		await prepare(cron);
		// Simulate a SIGHUP credential rotation between daily fires.
		currentToken = "ghp_rotated_token";
		await prepare(cron);
		// The SECOND fetch used the ROTATED token — the closure read it at fire
		// time rather than capturing a value once at startDaemon.
		expect(seenAuth[0]).toBe("Bearer ghp_old_token");
		expect(seenAuth[1]).toBe("Bearer ghp_rotated_token");
	});

	it("(CP-2) non-zero PRs → { skip: false, prompt } with the payload injected and NO credentials", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						data: {
							search: {
								nodes: [
									{
										number: 42,
										title: "Fix",
										url: "u",
										author: { login: "ilsantino" },
										reviewDecision: "APPROVED",
										createdAt: "2026-05-20T00:00:00.000Z",
										updatedAt: "2026-05-29T00:00:00.000Z",
										body: "x",
										labels: { nodes: [] },
										comments: { nodes: [] },
										statusCheckRollup: {
											state: "SUCCESS",
											contexts: { nodes: [] },
										},
									},
								],
							},
						},
					}),
					{ status: 200 },
				),
		) as unknown as typeof fetch;
		const prepare = makePrTriageCronPrompt({
			token: "ghp_secret_token_value",
			fetchImpl,
			readTemplate: () => `PR DATA: ${PR_DATA_PLACEHOLDER}\nclassify it`,
			nowFn: () => Date.parse("2026-05-31T00:00:00.000Z"),
		});
		const result = await prepare(cron);
		expect(result.skip).toBe(false);
		expect(typeof result.prompt).toBe("string");
		const prompt = result.prompt ?? "";
		// Payload injected.
		expect(prompt).toContain('"totalCount": 1');
		expect(prompt).toContain('"number": 42');
		expect(prompt).toContain('"ageDays": 2');
		// Placeholder consumed.
		expect(prompt).not.toContain(PR_DATA_PLACEHOLDER);
		// No credential / gh / curl leaks into the rendered prompt.
		expect(prompt).not.toContain("ghp_secret_token_value");
		expect(prompt).not.toContain("GH_TOKEN");
		expect(prompt).not.toContain("IAGO_TELEGRAM_BOT_TOKEN");
	});

	it("(CP-3) fetch error → { skip: true, reason: 'pr-fetch-failed' } (no spawn with stale data)", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(JSON.stringify({ message: "Bad credentials" }), {
					status: 401,
				}),
		) as unknown as typeof fetch;
		const prepare = makePrTriageCronPrompt({
			token: "ghp_token",
			fetchImpl,
			readTemplate: () => "prompt",
		});
		const result = await prepare(cron);
		expect(result.skip).toBe(true);
		expect(result.reason).toBe("pr-fetch-failed");
	});

	it("(CP-4) missing GH_TOKEN → { skip: true, reason: 'pr-fetch-failed' } (no fetch attempted)", async () => {
		const fetchImpl = vi.fn() as unknown as typeof fetch;
		const prepare = makePrTriageCronPrompt({
			token: undefined,
			fetchImpl,
			readTemplate: () => "prompt",
		});
		const result = await prepare(cron);
		expect(result.skip).toBe(true);
		expect(result.reason).toBe("pr-fetch-failed");
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

describe("registerCronAgentWithRestart (Task 8 — deferred double-restart race)", () => {
	type StatusCb = (status: string) => void;

	function makeRestartHarness() {
		const restartCalls: Array<{ handleId: string; reason: string }> = [];
		const registerCalls: string[] = [];
		let restarting = false;
		let handleN = 0;
		const handles = new Map<string, AgentHandle>();
		const emitter = new EventEmitter();
		// armExitListener subscribes via runtime.onStatusChanged; capture the LIVE
		// callback for the most-recently-armed handle so the test can drive an exit.
		let statusCb: StatusCb | null = null;

		const mkHandle = (): AgentHandle => {
			handleN += 1;
			const h: AgentHandle = {
				id: `pr-triage-h${handleN}`,
				runtime: "cr-runtime",
				shape: "pty",
				agentId: "pr-triage",
				sessionId: `sess-${handleN}`,
				generationToken: handleN,
				spawnedAt: 1000 + handleN,
				markerPath: "/tmp/marker",
			};
			handles.set(h.id, h);
			return h;
		};

		const runtime: AgentRuntime = {
			shape: "pty",
			id: "cr-runtime",
			version: "test-0.0.1",
			interfaceVersion: "v1",
			spawn: async () => {
				throw new Error("not used in restart tests");
			},
			send: async () => {},
			onStatusChanged: (_handle: AgentHandle, cb: StatusCb) => {
				statusCb = cb;
				return () => {
					if (statusCb === cb) statusCb = null;
				};
			},
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
		registerRuntime(runtime);

		const mgr = {
			listHandles: () => [...handles.values()],
			getHandle: (id: string) => handles.get(id),
			isRestarting: () => restarting,
			registerAgent: async () => {
				registerCalls.push("register");
				return mkHandle();
			},
			restartAgent: async (handleId: string, reason: string) => {
				restartCalls.push({ handleId, reason });
				const fresh = mkHandle();
				// restartAgent broadcasts agent-restarted (re-arm authority).
				emitter.emit("agent-restarted", {
					agentId: "pr-triage",
					handleId: fresh.id,
				});
				return fresh;
			},
			on: (ev: string, cb: (...a: unknown[]) => void) => {
				emitter.on(ev, cb);
			},
			emit: (ev: string, payload: unknown) => emitter.emit(ev, payload),
		} as unknown as AgentManager;

		return {
			mgr,
			restartCalls,
			registerCalls,
			fireExit: (status = "crashed") => {
				statusCb?.(status);
			},
			setRestarting: (v: boolean) => {
				restarting = v;
			},
			// Simulate a heartbeat recycle COMPLETING: a fresh handle now exists and the
			// AgentManager broadcasts agent-restarted (exactly what restartAgent does).
			simulateRecycleCompleted: () => {
				const fresh = mkHandle();
				emitter.emit("agent-restarted", {
					agentId: "pr-triage",
					handleId: fresh.id,
				});
			},
		};
	}

	const agentConfig = {
		runtimeId: "cr-runtime",
		cwd: "/tmp",
		env: {},
	} as unknown as AgentConfigShape;

	it("(CR-1 control) a genuine crash with NO concurrent recycle fires exactly one cron restart", async () => {
		vi.useFakeTimers();
		const h = makeRestartHarness();
		await registerCronAgentWithRestart({
			agentManager: h.mgr,
			agentId: "pr-triage",
			agentConfig,
			isShuttingDown: () => false,
			backoffMs: [50],
		});
		// Genuine unsolicited crash: no restart in flight → the cron loop owns it.
		h.setRestarting(false);
		h.fireExit("crashed");
		await vi.advanceTimersByTimeAsync(0);
		// Still inside the 50ms backoff — nothing fired yet.
		expect(h.restartCalls).toHaveLength(0);
		// Past the backoff → the cron restart fires exactly once.
		await vi.advanceTimersByTimeAsync(60);
		expect(h.restartCalls).toHaveLength(1);
		expect(h.restartCalls[0]).toMatchObject({ reason: "crash" });
	});

	it("(CR-2, dual-adversarial pass #2 Important) a heartbeat recycle that COMPLETES inside the cron backoff window cancels the cron-deferred restart (no spurious double-restart)", async () => {
		// Without the fix the cron loop's scheduled restart fires after the backoff
		// even though a heartbeat recycle already produced a fresh, healthy generation
		// (restartingPromises was already cleared; `scheduled=true` lived in the old
		// closure) → a spurious double-restart of a healthy agent. With the fix,
		// onAgentRestarted cancels the pending backoff timer and bumps the generation
		// so the awaiting scheduleRestart aborts. RED without the fix: restartCalls
		// would be length 1.
		vi.useFakeTimers();
		const h = makeRestartHarness();
		await registerCronAgentWithRestart({
			agentManager: h.mgr,
			agentId: "pr-triage",
			agentConfig,
			isShuttingDown: () => false,
			backoffMs: [50],
		});
		// Genuine crash → cron loop schedules a restart and enters the 50ms backoff.
		h.setRestarting(false);
		h.fireExit("crashed");
		await vi.advanceTimersByTimeAsync(0);
		expect(h.restartCalls).toHaveLength(0);
		// DURING the backoff window, a heartbeat recycle completes → agent-restarted.
		h.simulateRecycleCompleted();
		await vi.advanceTimersByTimeAsync(0);
		// Advance well past the original backoff: the cron-deferred restart must NOT
		// fire — the agent is already a fresh, healthy generation.
		await vi.advanceTimersByTimeAsync(200);
		expect(h.restartCalls).toHaveLength(0);
	});
});
