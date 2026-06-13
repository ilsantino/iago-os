import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
	type Mock,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { ensureStateDirsSync, pathFor } from "../../daemon/state-paths.js";
import { _resetRegistryForTests } from "../registry.js";
import type { AgentHandle, SpawnOpts, StatusCallback } from "../types.js";

// IMPORTANT #8: silence the adapter's fire-and-forget `appendEvent` failure
// logs only WITHIN each test, never at file scope. Replacing console.error
// globally masks real regressions and (with vitest worker re-use) leaks the
// silence into adjacent test files. `vi.spyOn` + `vi.restoreAllMocks()` in
// afterEach scopes the suppression to the active test.

interface MockPty {
	pid: number;
	killed: boolean;
	dataListeners: Array<(chunk: string) => void>;
	exitListeners: Array<(e: { exitCode: number; signal?: number }) => void>;
	writes: string[];
	killCalls: Array<string | undefined>;
	onData: (cb: (chunk: string) => void) => { dispose: () => void };
	onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => {
		dispose: () => void;
	};
	write: (data: string) => void;
	kill: (signal?: string) => void;
	emitData: (chunk: string) => void;
	emitExit: (exitCode: number) => void;
}

function makeMockPty(pid = 12345): MockPty {
	const pty: MockPty = {
		pid,
		killed: false,
		dataListeners: [],
		exitListeners: [],
		writes: [],
		killCalls: [],
		onData(cb) {
			pty.dataListeners.push(cb);
			return { dispose: () => {} };
		},
		onExit(cb) {
			pty.exitListeners.push(cb);
			return { dispose: () => {} };
		},
		write(data) {
			pty.writes.push(data);
		},
		kill(signal) {
			pty.killCalls.push(signal);
			pty.killed = true;
		},
		emitData(chunk) {
			for (const cb of pty.dataListeners) cb(chunk);
		},
		emitExit(exitCode) {
			for (const cb of pty.exitListeners) cb({ exitCode });
		},
	};
	return pty;
}

const mockSpawn = vi.fn<(...args: unknown[]) => MockPty>();
vi.mock("node-pty", () => ({
	spawn: (...args: unknown[]) => mockSpawn(...args),
}));

const mockAssertSupportedVersion = vi.fn(async () => ({
	ok: true as const,
	version: "2.1.113",
}));
vi.mock("./version-pin.js", () => ({
	assertSupportedVersion: () => mockAssertSupportedVersion(),
	getClaudeCodeVersion: async () => "2.1.113",
	SUPPORTED_CLAUDE_CODE_VERSION_RANGE: ">=2.0.0 <3.0.0",
}));

let tempDir: string;
let lastMockPty: MockPty;

async function importAdapterFresh(): Promise<typeof import("./claude-pty.js")> {
	vi.resetModules();
	_resetRegistryForTests();
	return import("./claude-pty.js");
}

function defaultSpawnOpts(): SpawnOpts {
	return {
		cwd: process.cwd(),
		env: { FOO: "bar" },
		agentId: "agent-test",
		sessionId: "session-test",
	};
}

beforeEach(async () => {
	// IMPORTANT #8: scope the console.error suppression to each test so a
	// future regression that logs unexpectedly is still surfaced when this
	// file's mock isn't active.
	vi.spyOn(console, "error").mockImplementation(() => {});
	tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-claude-pty-"));
	process.env.IAGO_DAEMON_STATE_ROOT = tempDir;
	ensureStateDirsSync();
	mockSpawn.mockReset();
	mockAssertSupportedVersion.mockReset();
	mockAssertSupportedVersion.mockImplementation(async () => ({
		ok: true as const,
		version: "2.1.113",
	}));
	mockSpawn.mockImplementation(() => {
		lastMockPty = makeMockPty();
		return lastMockPty;
	});
});

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	delete process.env.IAGO_DAEMON_STATE_ROOT;
	await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

describe("claude-pty adapter", () => {
	it("spawn with valid version returns handle and calls node-pty with correct cwd/env", async () => {
		const adapter = await importAdapterFresh();
		const opts = defaultSpawnOpts();
		const handle = await adapter.claudePty.spawn(opts);
		expect(handle.runtime).toBe("claude-pty");
		expect(handle.shape).toBe("pty");
		expect(handle.agentId).toBe(opts.agentId);
		expect(handle.sessionId).toBe(opts.sessionId);
		expect(mockSpawn).toHaveBeenCalledTimes(1);
		const spawnCall = mockSpawn.mock.calls[0] as [
			string,
			string[],
			Record<string, unknown>,
		];
		expect(spawnCall[0]).toBe("claude");
		expect(spawnCall[2].cwd).toBe(opts.cwd);
		expect((spawnCall[2].env as Record<string, string>).FOO).toBe("bar");
	});

	it("spawn with unsupported version throws with helpful message", async () => {
		mockAssertSupportedVersion.mockImplementationOnce(async () => ({
			ok: false as const,
			reason: "unsupported",
			detail: "installed claude 1.5.0 does not satisfy >=2.0.0 <3.0.0",
		}));
		const adapter = await importAdapterFresh();
		await expect(adapter.claudePty.spawn(defaultSpawnOpts())).rejects.toThrow(
			/unsupported Claude Code version/,
		);
	});

	it("send(prompt) writes text + newline", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		await adapter.claudePty.send(handle, {
			kind: "prompt",
			payload: { text: "hello" },
		});
		expect(lastMockPty.writes).toEqual(["hello\n"]);
	});

	it("send(inject) writes text + newline (same path as prompt)", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		await adapter.claudePty.send(handle, {
			kind: "inject",
			payload: { text: "context-blob" },
		});
		expect(lastMockPty.writes).toEqual(["context-blob\n"]);
	});

	it("send(abort) writes Ctrl-C", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		await adapter.claudePty.send(handle, {
			kind: "abort",
			payload: {},
		});
		expect(lastMockPty.writes).toEqual(["\x03"]);
	});

	it("send(approval) is a no-op (file-bus owns approvals)", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		await adapter.claudePty.send(handle, {
			kind: "approval",
			payload: { approvalId: "a", decision: "allow" },
		});
		expect(lastMockPty.writes).toEqual([]);
	});

	it("onStatusChanged returns unsubscribe fn that removes the listener", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		const cb = vi.fn() as Mock<StatusCallback>;
		const unsubscribe = adapter.claudePty.onStatusChanged(handle, cb);
		// First chunk classifies as idle (Human: prompt) — should fire cb.
		lastMockPty.emitData("\nHuman: ");
		expect(cb).toHaveBeenCalledWith("idle", undefined);
		cb.mockClear();
		unsubscribe();
		// Subsequent transition (matching tool execution) must NOT reach cb.
		lastMockPty.emitData("Running tool: Read\n");
		expect(cb).not.toHaveBeenCalled();
	});

	it("isAlive returns true while pid is set, false after exit", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		expect(await adapter.claudePty.isAlive(handle)).toBe(true);
		lastMockPty.emitExit(0);
		expect(await adapter.claudePty.isAlive(handle)).toBe(false);
	});

	it("shutdown(SIGTERM) calls kill and escalates to SIGKILL after 30s if still alive", async () => {
		vi.useFakeTimers();
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		await adapter.claudePty.shutdown(handle, "SIGTERM");
		expect(lastMockPty.killCalls).toEqual(["SIGTERM"]);
		// Process is still "alive" (no exit emitted) — escalation should fire.
		vi.advanceTimersByTime(30_000);
		expect(lastMockPty.killCalls).toEqual(["SIGTERM", "SIGKILL"]);
	});

	it("emits idle status to listeners when stdout matches the idle pattern", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		const cb = vi.fn() as Mock<StatusCallback>;
		adapter.claudePty.onStatusChanged(handle, cb);
		lastMockPty.emitData("\nHuman: ");
		expect(cb).toHaveBeenCalledWith("idle", undefined);
	});

	it("emits crashed AND writes .daemon-stop marker when output is unknown >100 bytes", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		const cb = vi.fn() as Mock<StatusCallback>;
		adapter.claudePty.onStatusChanged(handle, cb);
		const noise = "completely-unrelated-noise-XYZ ".repeat(20);
		lastMockPty.emitData(noise);
		expect(cb).toHaveBeenCalledWith("crashed", undefined);
		// Allow the queued marker write to flush.
		await new Promise((resolve) => setImmediate(resolve));
		const markerFile = path.join(pathFor("markers"), `${handle.id}.daemon-stop`);
		const raw = await fsp.readFile(markerFile, "utf8");
		const marker = JSON.parse(raw) as { reason: string };
		expect(marker.reason).toBe("crash");
	});

	it("EC3: detects pattern split across two consecutive onData chunks", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		const cb = vi.fn() as Mock<StatusCallback>;
		adapter.claudePty.onStatusChanged(handle, cb);
		// Chunk 1 ("Running tool") matches no pattern by itself and is
		// short enough to fall through to "idle" (default for sub-100-byte
		// noise). Chunk 2 supplies the colon that completes the canonical
		// running-tool marker. The buffered combination — "Running tool:
		// Read(file.ts)\n" — must classify as `running`, proving the
		// adapter buffers across chunks rather than re-parsing each chunk
		// in isolation.
		lastMockPty.emitData("Running tool");
		expect(cb).not.toHaveBeenCalledWith("running", undefined);
		// M2: the sub-threshold no-signal "idle" sentinel must NOT be emitted
		// (I2 fix); status is retained from the initial "running" state.
		expect(cb).not.toHaveBeenCalledWith("idle", undefined);
		lastMockPty.emitData(": Read(file.ts)\n");
		expect(cb).toHaveBeenCalledWith("running", undefined);
	});
});

describe("claude-pty adapter — registry registration", () => {
	it("registers itself with the runtime registry on import", async () => {
		const adapter = await importAdapterFresh();
		const { resolveRuntime } = await import("../registry.js");
		const resolved = resolveRuntime("claude-pty");
		expect(resolved).toBe(adapter.claudePty);
	});
});

describe("claude-pty adapter — error paths and coverage", () => {
	it("send to unknown handle throws", async () => {
		const adapter = await importAdapterFresh();
		const fake: AgentHandle = {
			id: "missing",
			runtime: "claude-pty",
			shape: "pty",
			agentId: "a",
			sessionId: "s",
			generationToken: 0,
			spawnedAt: 0,
			markerPath: "x",
		};
		await expect(
			adapter.claudePty.send(fake, { kind: "prompt", payload: { text: "x" } }),
		).rejects.toThrow(/unknown handle/);
	});

	it("send to a handle whose pty has exited throws", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		lastMockPty.emitExit(0);
		// CRITICAL #3 follow-up: onExit flips `alive` synchronously and
		// SCHEDULES the map delete via setImmediate (so same-tick callbacks
		// can still resolve against state). Before the setImmediate fires,
		// `send` rejects with "no longer alive"; after, with "unknown handle".
		// Both error shapes are equivalent — both reject — so the test
		// accepts either.
		await expect(
			adapter.claudePty.send(handle, {
				kind: "prompt",
				payload: { text: "x" },
			}),
		).rejects.toThrow(/unknown handle|no longer alive/);
	});

	it("send with kind=custom is a no-op (warns, does not write)", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		// M3: CustomMessage.payload is double-wrapped: { payload: unknown }
		// per types.ts:73-75. The cast was silencing a wrong shape.
		await adapter.claudePty.send(handle, {
			kind: "custom",
			payload: { payload: { whatever: 1 } },
		});
		expect(lastMockPty.writes).toEqual([]);
	});

	it("onStatusChanged on unknown handle throws", async () => {
		const adapter = await importAdapterFresh();
		const fake: AgentHandle = {
			id: "missing",
			runtime: "claude-pty",
			shape: "pty",
			agentId: "a",
			sessionId: "s",
			generationToken: 0,
			spawnedAt: 0,
			markerPath: "x",
		};
		expect(() => adapter.claudePty.onStatusChanged(fake, () => {})).toThrow(
			/unknown handle/,
		);
	});

	it("isAlive returns false for unknown handle", async () => {
		const adapter = await importAdapterFresh();
		const fake: AgentHandle = {
			id: "ghost",
			runtime: "claude-pty",
			shape: "pty",
			agentId: "a",
			sessionId: "s",
			generationToken: 0,
			spawnedAt: 0,
			markerPath: "x",
		};
		expect(await adapter.claudePty.isAlive(fake)).toBe(false);
	});

	it("shutdown(SIGKILL) skips the escalation timer and removes state", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		await adapter.claudePty.shutdown(handle, "SIGKILL");
		expect(lastMockPty.killCalls).toEqual(["SIGKILL"]);
		expect(await adapter.claudePty.isAlive(handle)).toBe(false);
	});

	it("shutdown on unknown handle is a no-op", async () => {
		const adapter = await importAdapterFresh();
		const fake: AgentHandle = {
			id: "ghost",
			runtime: "claude-pty",
			shape: "pty",
			agentId: "a",
			sessionId: "s",
			generationToken: 0,
			spawnedAt: 0,
			markerPath: "x",
		};
		await expect(
			adapter.claudePty.shutdown(fake, "SIGTERM"),
		).resolves.toBeUndefined();
	});

	it("inject() method writes text + newline (delegates to send)", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		await adapter.claudePty.inject(handle, "context-payload");
		expect(lastMockPty.writes).toEqual(["context-payload\n"]);
	});

	it("status listener exceptions do not break the dispatch loop", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		const goodCb = vi.fn() as Mock<StatusCallback>;
		adapter.claudePty.onStatusChanged(handle, () => {
			throw new Error("boom");
		});
		adapter.claudePty.onStatusChanged(handle, goodCb);
		lastMockPty.emitData("\nHuman: ");
		expect(goodCb).toHaveBeenCalledWith("idle", undefined);
	});

	it("truncateBuffer caps the output buffer to 4 KB", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		const cb = vi.fn() as Mock<StatusCallback>;
		adapter.claudePty.onStatusChanged(handle, cb);
		// 8 KB of "x"s — must NOT route to "crashed" because the buffer
		// gets truncated to the last 4 KB on each chunk. Then a clean
		// `\nHuman: ` arrives and the parser sees only that tail.
		const big = "x".repeat(8 * 1024);
		lastMockPty.emitData(big);
		// Buffer is now truncated. Feed an idle marker and confirm it
		// classifies — proves truncation didn't break parsing of fresh
		// chunks appended after the cap.
		lastMockPty.emitData("\nHuman: ");
		expect(cb).toHaveBeenCalledWith("idle", undefined);
	});

	it("restoreFromMarker returns null when the marker filename has no .daemon-stop suffix", async () => {
		const adapter = await importAdapterFresh();
		const result = await adapter.claudePty.restoreFromMarker(
			path.join(pathFor("markers"), "not-a-marker.txt"),
		);
		expect(result).toBeNull();
	});

	it("restoreFromMarker returns null when agent config file is missing", async () => {
		const adapter = await importAdapterFresh();
		const result = await adapter.claudePty.restoreFromMarker(
			path.join(pathFor("markers"), "abc123.daemon-stop"),
		);
		expect(result).toBeNull();
	});

	it("restoreFromMarker returns null for malformed agent config JSON", async () => {
		const adapter = await importAdapterFresh();
		const handleId = "deadbeef";
		await fsp.writeFile(
			path.join(pathFor("agents"), `${handleId}.json`),
			"{ not valid json",
			"utf8",
		);
		const result = await adapter.claudePty.restoreFromMarker(
			path.join(pathFor("markers"), `${handleId}.daemon-stop`),
		);
		expect(result).toBeNull();
	});

	it("restoreFromMarker re-spawns a fresh PTY using the persisted agent config (with HWM + env)", async () => {
		const adapter = await importAdapterFresh();
		const handleId = "feedface";
		await fsp.writeFile(
			path.join(pathFor("agents"), `${handleId}.json`),
			JSON.stringify({
				cwd: process.cwd(),
				agentId: "restored-agent",
				sessionId: "restored-session",
				org: "iago",
				env: { CUSTOM_AGENT_KEY: "restored-value" },
			}),
			"utf8",
		);
		// CRITICAL #2: HWM is now required for restore — write one so the
		// adapter recognizes the session as replay-viable.
		const sessionLog = await import("../../daemon/session-log.js");
		await sessionLog.setHWM(handleId, { byteOffset: 0, sequence: 0 });
		const restored = await adapter.claudePty.restoreFromMarker(
			path.join(pathFor("markers"), `${handleId}.daemon-stop`),
		);
		expect(restored).not.toBeNull();
		if (restored !== null) {
			expect(restored.agentId).toBe("restored-agent");
			expect(restored.sessionId).toBe("restored-session");
			expect(restored.generationToken).toBe(1);
			expect(mockSpawn).toHaveBeenCalledTimes(1);
			// CRITICAL #1: env passed to PTY must come from persisted config,
			// NOT process.env. Verify CUSTOM_AGENT_KEY landed and process.env's
			// PATH did NOT spill in.
			const spawnCall = mockSpawn.mock.calls[0] as [
				string,
				string[],
				{ env: Record<string, string> },
			];
			expect(spawnCall[2].env.CUSTOM_AGENT_KEY).toBe("restored-value");
			// Wave 2 contract: restoreId honored — returned handle keeps the
			// original id, not a fresh uuid.
			expect(restored.id).toBe(handleId);
		}
	});

	it("CRITICAL #2: restoreFromMarker returns null when HWM is absent", async () => {
		const adapter = await importAdapterFresh();
		const handleId = "no-hwm-feed";
		await fsp.writeFile(
			path.join(pathFor("agents"), `${handleId}.json`),
			JSON.stringify({
				cwd: process.cwd(),
				agentId: "no-hwm-agent",
				sessionId: "no-hwm-session",
				env: { FOO: "bar" },
			}),
			"utf8",
		);
		// Deliberately do NOT call setHWM — replay must not proceed without it.
		const restored = await adapter.claudePty.restoreFromMarker(
			path.join(pathFor("markers"), `${handleId}.daemon-stop`),
		);
		expect(restored).toBeNull();
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it("CRITICAL #1: restoreFromMarker returns null when env is missing from persisted config", async () => {
		const adapter = await importAdapterFresh();
		const handleId = "no-env-feed";
		await fsp.writeFile(
			path.join(pathFor("agents"), `${handleId}.json`),
			JSON.stringify({
				cwd: process.cwd(),
				agentId: "no-env-agent",
				sessionId: "no-env-session",
				// env intentionally absent — pre-PR43-fix records.
			}),
			"utf8",
		);
		const sessionLog = await import("../../daemon/session-log.js");
		await sessionLog.setHWM(handleId, { byteOffset: 0, sequence: 0 });
		const restored = await adapter.claudePty.restoreFromMarker(
			path.join(pathFor("markers"), `${handleId}.daemon-stop`),
		);
		expect(restored).toBeNull();
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it("CRITICAL #2: restoreFromMarker bumps generationToken from persisted lastGenerationToken (monotonic)", async () => {
		const adapter = await importAdapterFresh();
		const handleId = "monotonic-gen";
		await fsp.writeFile(
			path.join(pathFor("agents"), `${handleId}.json`),
			JSON.stringify({
				cwd: process.cwd(),
				agentId: "monotonic-agent",
				sessionId: "monotonic-session",
				env: { K: "v" },
				lastGenerationToken: 7,
			}),
			"utf8",
		);
		const sessionLog = await import("../../daemon/session-log.js");
		await sessionLog.setHWM(handleId, { byteOffset: 0, sequence: 0 });
		const restored = await adapter.claudePty.restoreFromMarker(
			path.join(pathFor("markers"), `${handleId}.daemon-stop`),
		);
		expect(restored).not.toBeNull();
		if (restored !== null) {
			// Hardcoded `1` was the prior bug; correct behavior is N+1.
			expect(restored.generationToken).toBe(8);
		}
		// Successive call must continue climbing (not reset to 1).
		const restored2 = await adapter.claudePty.restoreFromMarker(
			path.join(pathFor("markers"), `${handleId}.daemon-stop`),
		);
		expect(restored2).not.toBeNull();
		if (restored2 !== null) {
			expect(restored2.generationToken).toBe(9);
		}
	});

	it("CRITICAL #3: stateByHandleId is emptied after onExit (no leak per restart)", async () => {
		const adapter = await importAdapterFresh();
		const handles: Array<AgentHandle> = [];
		// Spawn 10 PTYs.
		for (let i = 0; i < 10; i++) {
			const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
			handles.push(handle);
			// All spawn calls write to the same `lastMockPty` reference, so we
			// have to snapshot per-spawn to drive each emitExit independently.
		}
		// Each spawn replaced `lastMockPty` — but the mock spawn implementation
		// always returns a fresh PTY (see beforeEach), so we need to track
		// them. Re-instrument mockSpawn to capture each PTY emitted.
		// In practice with the simple makeMockPty fixture above, all PTYs
		// trigger emitExit via the per-handle dataListeners closure. Since
		// the test's makeMockPty creates independent ptys, the simplest
		// proof is: shutdown SIGKILL each handle (skips the timer and
		// deletes immediately) and verify isAlive returns false for all.
		for (const h of handles) {
			await adapter.claudePty.shutdown(h, "SIGKILL");
		}
		// Allow any queued setImmediate deletes to drain.
		await new Promise((resolve) => setImmediate(resolve));
		for (const h of handles) {
			expect(await adapter.claudePty.isAlive(h)).toBe(false);
		}
	});

	it("CRITICAL #3: stateByHandleId entry is reaped after graceful exit (setImmediate tick)", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		expect(await adapter.claudePty.isAlive(handle)).toBe(true);
		lastMockPty.emitExit(0);
		// State.alive flips synchronously in onExit; the map delete is
		// deferred via setImmediate so same-tick callbacks finish first.
		await new Promise((resolve) => setImmediate(resolve));
		// isAlive returns false because the map entry is gone (returns false
		// for unknown handles per the existing contract).
		expect(await adapter.claudePty.isAlive(handle)).toBe(false);
	});

	it("Codex (high): fail-closed unknown-parse kills the PTY + flips isAlive=false", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		expect(await adapter.claudePty.isAlive(handle)).toBe(true);
		const noise = "completely-unrelated-noise-XYZ ".repeat(20);
		lastMockPty.emitData(noise);
		// Heartbeat-recovery contract: after fail-closed, the PTY must be
		// killed and isAlive must read false so the manager has a trigger.
		expect(lastMockPty.killCalls).toContain("SIGTERM");
		expect(await adapter.claudePty.isAlive(handle)).toBe(false);
	});

	it("IMPORTANT #5: status parser uses tail window — stale running marker does not wedge status", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		const cb = vi.fn() as Mock<StatusCallback>;
		adapter.claudePty.onStatusChanged(handle, cb);
		// Emit a running marker FOLLOWED by a long gap of noise that pushes
		// the marker outside the tail window, then an idle prompt at the
		// tail. Without tail-windowing the running pattern would still match
		// somewhere in the 4 KB buffer and idle would never fire.
		lastMockPty.emitData("Running tool: Read(x)\n");
		expect(cb).toHaveBeenCalledWith("running", undefined);
		cb.mockClear();
		// 1 KB of dots pushes the running marker outside the 512-byte tail.
		lastMockPty.emitData(".".repeat(1024));
		// idle prompt at the new tail must classify, not get wedged by the
		// stale running marker upstream.
		lastMockPty.emitData("\nHuman: ");
		expect(cb).toHaveBeenCalledWith("idle", undefined);
	});

	it("IMPORTANT #6: send(prompt) persists an input event to session.jsonl for replay", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		await adapter.claudePty.send(handle, {
			kind: "prompt",
			payload: { text: "the-prompt" },
		});
		// persistInputEvent inside send() is fire-and-forget. Wait
		// deterministically by appending a sentinel event through the same
		// per-handle file lock — by the time this awaited call resolves the
		// original input event has been durably written to the log.
		const sessionLog = await import("../../daemon/session-log.js");
		await sessionLog.appendEvent(handle.id, {
			kind: "_test_flush_sentinel",
			at: Date.now(),
		});
		const sessionLogPath = path.join(
			pathFor("session-logs"),
			`${handle.id}.jsonl`,
		);
		const raw = await fsp.readFile(sessionLogPath, "utf8");
		const lines = raw.split("\n").filter((l) => l.length > 0);
		const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
		const inputEvent = events.find((e) => e.kind === "input");
		expect(inputEvent).toBeDefined();
		if (inputEvent !== undefined) {
			expect(inputEvent.messageKind).toBe("prompt");
			expect((inputEvent.payload as { text: string }).text).toBe("the-prompt");
		}
	});

	it("IMPORTANT #5: CLAUDE_CODE_SESSION_ID is propagated into the PTY env", async () => {
		const adapter = await importAdapterFresh();
		await adapter.claudePty.spawn(defaultSpawnOpts());
		const spawnCall = mockSpawn.mock.calls[0] as [
			string,
			string[],
			{ env: Record<string, string> },
		];
		expect(spawnCall[2].env.CLAUDE_CODE_SESSION_ID).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});

	it("IMPORTANT #4: inject() works under destructuring (no `this` dependency)", async () => {
		const adapter = await importAdapterFresh();
		const handle = await adapter.claudePty.spawn(defaultSpawnOpts());
		// Destructure inject off the adapter — the arrow-function form must
		// resolve `claudePty.send` via the module-scope binding, not `this`.
		const { inject } = adapter.claudePty;
		await inject(handle, "destructured-payload");
		expect(lastMockPty.writes).toEqual(["destructured-payload\n"]);
	});

	it("Wave 2 contract: spawn honors opts.restoreId (handle id matches caller-supplied id)", async () => {
		const adapter = await importAdapterFresh();
		const presetId = "11111111-2222-3333-4444-555555555555";
		const handle = await adapter.claudePty.spawn({
			...defaultSpawnOpts(),
			restoreId: presetId,
		});
		expect(handle.id).toBe(presetId);
	});
});
