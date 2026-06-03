import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type AgentRuntime,
	_resetRegistryForTests,
	registerRuntime,
} from "../agent-runtime/registry.js";
import type {
	AgentHandle,
	AgentMessage,
	CostEvent,
	SpawnOpts,
	StatusCallback,
	StatusValue,
} from "../agent-runtime/types.js";

import {
	AgentIdAlreadyRegisteredError,
	AgentManager,
	TASK_PAYLOAD_MAX_BYTES,
} from "./agent-manager.js";
import { CronScheduler } from "./cron-scheduler.js";
import { HeartbeatController } from "./heartbeat.js";
import { listAllMarkers, readStopMarker, writeStopMarker } from "./markers.js";
import {
	_resetSessionLogStateForTests,
	appendEvent,
	setHWM,
} from "./session-log.js";
import { ensureStateDirsSync, pathFor } from "./state-paths.js";
import type { DaemonEvent } from "./telemetry.js";

// Module-level telemetry mock for the Plan 07b polling-loop tests below.
// Pass-through by default so Plan 07b tests using `readTelemetry()` still
// see real NDJSON on disk; tests can also inspect `emitMock.mock.calls`
// directly for synchronous assertions. Mocking telemetry at the module
// boundary is the same pattern used by `cron-scheduler.test.ts`.
const { emitMock, emitState } = vi.hoisted(() => ({
	emitMock: vi.fn(),
	emitState: {
		real: null as ((e: DaemonEvent) => Promise<void>) | null,
	},
}));
vi.mock("./telemetry.js", async () => {
	const actual =
		await vi.importActual<typeof import("./telemetry.js")>("./telemetry.js");
	emitState.real = actual.emit;
	return {
		...actual,
		emit: emitMock,
	};
});

// PL-8: ESM namespace imports cannot be redefined with `vi.spyOn`, so the
// only way to make `agent-manager.ts`'s `import * as fsp from
// "node:fs/promises"` resolve to a mockable rename is via a module-level
// `vi.mock` with a passthrough wrapper. The hoisted `renameMock` is
// reset to pass-through in beforeEach so once-rejections do not leak
// across tests. PL-8 queues a one-shot failure via
// `renameMock.mockRejectedValueOnce(...)` to exercise the
// `claim-task-failed` telemetry branch in `claimTask`; every other test
// and every other fs method calls the real implementation.
type RenameFn = (
	source: import("node:fs").PathLike,
	dest: import("node:fs").PathLike,
) => Promise<void>;
type ReadFileFn = (
	path: import("node:fs").PathLike,
	options: BufferEncoding | { encoding: BufferEncoding; flag?: string },
) => Promise<string>;
type WriteFileFn = (
	path: import("node:fs").PathLike,
	data: string | Uint8Array,
	options?: unknown,
) => Promise<void>;
const {
	renameMock,
	renameState,
	readFileMock,
	readFileState,
	writeFileMock,
	writeFileState,
} = vi.hoisted(() => ({
	renameMock: vi.fn(),
	renameState: { real: null as RenameFn | null },
	readFileMock: vi.fn(),
	readFileState: { real: null as ReadFileFn | null },
	writeFileMock: vi.fn(),
	writeFileState: { real: null as WriteFileFn | null },
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	renameState.real = actual.rename as RenameFn;
	readFileState.real = actual.readFile as unknown as ReadFileFn;
	writeFileState.real = actual.writeFile as unknown as WriteFileFn;
	return {
		...actual,
		rename: (
			source: import("node:fs").PathLike,
			dest: import("node:fs").PathLike,
		) => renameMock(source, dest),
		readFile: (
			p: import("node:fs").PathLike,
			options: BufferEncoding | { encoding: BufferEncoding; flag?: string },
		) => readFileMock(p, options),
		writeFile: (
			p: import("node:fs").PathLike,
			data: string | Uint8Array,
			options?: unknown,
		) => writeFileMock(p, data, options),
	};
});

// Round-2 Critical (Codex) — make `writeStopMarker` independently failable so
// the persist-rollback test can simulate a degraded state root that breaks BOTH
// persistence AND the marker write. Pass-through by default (so every other test
// keeps real marker semantics); the regression test queues a one-shot rejection
// via `writeStopMarkerMock.mockRejectedValueOnce(...)` to drive the rollback path
// where `shutdownAgentInternal` throws BEFORE reaching `runtime.shutdown`.
type WriteStopMarkerFn = (
	handleId: string,
	reason: import("./markers.js").StopMarkerReason,
) => Promise<void>;
const { writeStopMarkerMock, markersState } = vi.hoisted(() => ({
	writeStopMarkerMock: vi.fn(),
	markersState: { realWriteStopMarker: null as WriteStopMarkerFn | null },
}));
vi.mock("./markers.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./markers.js")>();
	markersState.realWriteStopMarker = actual.writeStopMarker as WriteStopMarkerFn;
	return {
		...actual,
		writeStopMarker: (
			handleId: string,
			reason: import("./markers.js").StopMarkerReason,
		) => writeStopMarkerMock(handleId, reason),
	};
});

let tempDir: string;

beforeEach(async () => {
	tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-agent-mgr-"));
	process.env.IAGO_DAEMON_STATE_ROOT = tempDir;
	ensureStateDirsSync();
	_resetRegistryForTests();
	_resetSessionLogStateForTests();
	emitMock.mockReset();
	emitMock.mockImplementation((e: DaemonEvent) => {
		if (emitState.real === null) return Promise.resolve();
		return emitState.real(e);
	});
	renameMock.mockReset();
	renameMock.mockImplementation((source, dest) => {
		if (renameState.real === null) {
			throw new Error("renameState.real not initialized by vi.mock factory");
		}
		return renameState.real(source, dest);
	});
	readFileMock.mockReset();
	readFileMock.mockImplementation((p, options) => {
		if (readFileState.real === null) {
			throw new Error("readFileState.real not initialized by vi.mock factory");
		}
		return readFileState.real(p, options);
	});
	writeFileMock.mockReset();
	writeFileMock.mockImplementation((p, data, options) => {
		if (writeFileState.real === null) {
			throw new Error("writeFileState.real not initialized by vi.mock factory");
		}
		return writeFileState.real(p, data, options);
	});
	writeStopMarkerMock.mockReset();
	writeStopMarkerMock.mockImplementation((handleId, reason) => {
		if (markersState.realWriteStopMarker === null) {
			throw new Error(
				"markersState.realWriteStopMarker not initialized by vi.mock factory",
			);
		}
		return markersState.realWriteStopMarker(handleId, reason);
	});
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
	delete process.env.IAGO_DAEMON_STATE_ROOT;
	vi.restoreAllMocks();
	_resetRegistryForTests();
	_resetSessionLogStateForTests();
	await fsp.rm(tempDir, { recursive: true, force: true });
});

interface MockRuntimeControls {
	runtime: AgentRuntime;
	emitStatus: (handleId: string, status: StatusValue, code?: number) => void;
	setAlive: (handleId: string, alive: boolean) => void;
	setRss: (handleId: string, rssBytes: number) => void;
	pushCost: (handleId: string, event: CostEvent) => Promise<void>;
	finishCost: (handleId: string) => void;
	setRestoreFromMarker: (impl: () => Promise<AgentHandle | null>) => void;
	spawnCalls: SpawnOpts[];
	shutdownCalls: Array<{
		handleId: string;
		signal?: string;
		markerSeen: boolean;
	}>;
	sendCalls: Array<{ handleId: string; message: AgentMessage }>;
}

interface CostQueueState {
	queue: CostEvent[];
	resolvers: Array<
		(
			value: { value: CostEvent; done: false } | { value: undefined; done: true },
		) => void
	>;
	closed: boolean;
}

function makeMockRuntime(id: string): MockRuntimeControls {
	const callbacks = new Map<string, Set<StatusCallback>>();
	const aliveByHandle = new Map<string, boolean>();
	const rssByHandle = new Map<string, number>();
	const costStreams = new Map<string, CostQueueState>();
	const spawnCalls: SpawnOpts[] = [];
	const shutdownCalls: Array<{
		handleId: string;
		signal?: string;
		markerSeen: boolean;
	}> = [];
	const sendCalls: Array<{ handleId: string; message: AgentMessage }> = [];
	let spawnCounter = 0;
	let restoreFromMarkerImpl: () => Promise<AgentHandle | null> = async () =>
		null;

	const runtime: AgentRuntime = {
		shape: "pty",
		id,
		version: "test-0.0.1",
		interfaceVersion: "v1",
		async spawn(opts: SpawnOpts): Promise<AgentHandle> {
			spawnCalls.push(opts);
			spawnCounter++;
			// CRITICAL #3: honor SpawnOpts.restoreId so restart preserves
			// handle-id stability. The mock matches the contract the real
			// Plan 04 PTY adapter will also implement — adapters that
			// cannot honor a caller-supplied id MUST throw rather than
			// substitute, per `AgentRuntime.spawn` JSDoc.
			const handleId = opts.restoreId ?? `${id}-h${spawnCounter}`;
			const handle: AgentHandle = {
				id: handleId,
				runtime: id,
				shape: "pty",
				agentId: opts.agentId,
				sessionId: opts.sessionId,
				generationToken: 0,
				org: opts.org,
				parentHandleId: opts.parentHandle?.id,
				spawnedAt: Date.now(),
				markerPath: path.join(pathFor("markers"), `${handleId}.daemon-stop`),
			};
			aliveByHandle.set(handleId, true);
			return handle;
		},
		async send(handle, message): Promise<void> {
			sendCalls.push({ handleId: handle.id, message });
		},
		onStatusChanged(handle, cb): () => void {
			let set = callbacks.get(handle.id);
			if (set === undefined) {
				set = new Set();
				callbacks.set(handle.id, set);
			}
			set.add(cb);
			return () => {
				const inner = callbacks.get(handle.id);
				if (inner !== undefined) inner.delete(cb);
			};
		},
		async isAlive(handle): Promise<boolean> {
			return aliveByHandle.get(handle.id) ?? false;
		},
		async getStatus(handle): Promise<{ alive: boolean; rssBytes?: number }> {
			return {
				alive: aliveByHandle.get(handle.id) ?? false,
				rssBytes: rssByHandle.get(handle.id),
			};
		},
		async shutdown(handle, signal): Promise<void> {
			// Capture whether the graceful marker was already on disk at the
			// moment shutdown was invoked — used by ordering assertions.
			let markerSeen = false;
			try {
				await fsp.access(path.join(pathFor("markers"), `${handle.id}.daemon-stop`));
				markerSeen = true;
			} catch {
				markerSeen = false;
			}
			shutdownCalls.push({ handleId: handle.id, signal, markerSeen });
			aliveByHandle.set(handle.id, false);
			const stream = costStreams.get(handle.id);
			if (stream !== undefined) {
				stream.closed = true;
				const drained = stream.resolvers.splice(0);
				for (const r of drained) r({ value: undefined, done: true });
			}
		},
		async restoreFromMarker(): Promise<AgentHandle | null> {
			return restoreFromMarkerImpl();
		},
		costTap(handle): AsyncIterable<CostEvent> {
			let state = costStreams.get(handle.id);
			if (state === undefined) {
				state = { queue: [], resolvers: [], closed: false };
				costStreams.set(handle.id, state);
			}
			const stream = state;
			return {
				[Symbol.asyncIterator](): AsyncIterator<CostEvent> {
					return {
						next(): Promise<IteratorResult<CostEvent>> {
							if (stream.queue.length > 0) {
								const next = stream.queue.shift() as CostEvent;
								return Promise.resolve({ value: next, done: false });
							}
							if (stream.closed) {
								return Promise.resolve({
									value: undefined as unknown as CostEvent,
									done: true,
								});
							}
							return new Promise((resolve) => {
								stream.resolvers.push((r) => {
									if (r.done) {
										resolve({
											value: undefined as unknown as CostEvent,
											done: true,
										});
									} else {
										resolve({ value: r.value, done: false });
									}
								});
							});
						},
					};
				},
			};
		},
	};

	return {
		runtime,
		emitStatus(handleId, status, code) {
			const set = callbacks.get(handleId);
			if (set === undefined) return;
			for (const cb of set) cb(status, code);
		},
		setAlive(handleId, alive) {
			aliveByHandle.set(handleId, alive);
		},
		setRss(handleId, rssBytes) {
			rssByHandle.set(handleId, rssBytes);
		},
		async pushCost(handleId, event) {
			let stream = costStreams.get(handleId);
			if (stream === undefined) {
				stream = { queue: [], resolvers: [], closed: false };
				costStreams.set(handleId, stream);
			}
			if (stream.resolvers.length > 0) {
				const next = stream.resolvers.shift();
				if (next !== undefined) next({ value: event, done: false });
			} else {
				stream.queue.push(event);
			}
			// Yield to let consumer loop apply the event.
			await new Promise<void>((resolve) => setImmediate(resolve));
		},
		finishCost(handleId) {
			const stream = costStreams.get(handleId);
			if (stream === undefined) return;
			stream.closed = true;
			const drained = stream.resolvers.splice(0);
			for (const r of drained) r({ value: undefined, done: true });
		},
		setRestoreFromMarker(impl) {
			restoreFromMarkerImpl = impl;
		},
		spawnCalls,
		shutdownCalls,
		sendCalls,
	};
}

async function waitForCondition(
	check: () => boolean | Promise<boolean>,
	timeoutMs = 2000,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await check()) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 5));
	}
	if (!(await check())) {
		throw new Error("condition not met within timeout");
	}
}

describe("AgentManager / registerAgent", () => {
	it("calls runtime.spawn with correct SpawnOpts and registers handle in heartbeat", async () => {
		const ctrl = makeMockRuntime("mock-pty-1");
		registerRuntime(ctrl.runtime);
		const hb = new HeartbeatController({
			intervalMs: 60_000,
			onForceRestart: async () => {},
		});
		const hbRegister = vi.spyOn(hb, "register");
		const mgr = new AgentManager({ heartbeat: hb });

		const handle = await mgr.registerAgent({
			agentId: "alpha",
			runtimeId: "mock-pty-1",
			org: "org-1",
			cwd: "/tmp/work",
			env: { FOO: "bar" },
			sessionId: "sess-1",
		});

		expect(ctrl.spawnCalls).toHaveLength(1);
		const spawnOpts = ctrl.spawnCalls[0];
		expect(spawnOpts).toBeDefined();
		expect(spawnOpts?.agentId).toBe("alpha");
		expect(spawnOpts?.sessionId).toBe("sess-1");
		expect(spawnOpts?.cwd).toBe("/tmp/work");
		expect(spawnOpts?.org).toBe("org-1");
		expect(hbRegister).toHaveBeenCalledWith(handle.id, expect.any(Function));
	});

	it("persist-fail after spawn: registerAgent rejects fail-closed, shuts down + untracks the spawned handle, no config on disk", async () => {
		// Task 1 Critical (fail-closed): spawn succeeds but persistAgentConfig's
		// writeFile fails (ENOSPC). The OLD behavior returned a tracked-but-
		// unpersisted live handle (the orphan window). The fix rolls the spawn
		// back: registerAgent REJECTS, the spawned handle is shut down + untracked,
		// and no `<handle.id>.json` lands on disk. This test fails without the fix
		// (old code resolved with a live handle) and passes with it.
		const ctrl = makeMockRuntime("mock-pty-persist-fail");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const agentsDir = pathFor("agents");
		// Reject ONLY the persistAgentConfig write (under agents/), so the
		// session-log/marker writes from spawn/track are unaffected.
		writeFileMock.mockImplementation((p, data, options) => {
			if (String(p).startsWith(agentsDir)) {
				return Promise.reject(
					Object.assign(new Error("simulated ENOSPC"), { code: "ENOSPC" }),
				);
			}
			if (writeFileState.real === null) {
				throw new Error("writeFileState.real not initialized by vi.mock factory");
			}
			return writeFileState.real(p, data, options);
		});

		// registerAgent MUST reject (fail-closed) rather than resolve with a
		// live-but-unpersisted handle.
		await expect(
			mgr.registerAgent({
				agentId: "persist-orphan",
				runtimeId: "mock-pty-persist-fail",
				cwd: "/tmp/work",
				env: {},
				sessionId: "sess-po",
			}),
		).rejects.toThrow(/ENOSPC/);

		// The process WAS spawned, then rolled back: no handle leaks in-memory.
		expect(ctrl.spawnCalls).toHaveLength(1);
		expect(mgr.listHandles()).toHaveLength(0);

		// The spawned handle was shut down during rollback (no orphan PTY).
		const spawnedId = `${ctrl.runtime.id}-h1`;
		expect(mgr.getHandle(spawnedId)).toBeUndefined();
		expect(ctrl.shutdownCalls.some((c) => c.handleId === spawnedId)).toBe(true);

		// No persisted config file exists on disk (the write was the failure).
		const configPath = path.join(agentsDir, `${spawnedId}.json`);
		await expect(fsp.access(configPath)).rejects.toBeDefined();
	});

	it("persist-fail rollback where writeStopMarker ALSO throws: still force-kills the adapter (no orphan live PTY)", async () => {
		// Round-2 Critical (Codex): the persist-failure rollback calls
		// `shutdownAgentInternal`, which writes the stop marker AND cascades
		// children BEFORE it ever reaches `runtime.shutdown`. If the same degraded
		// state root that broke persistence ALSO makes `writeStopMarker` throw,
		// `shutdownAgentInternal` aborts before the adapter is killed and control
		// lands in the rollback catch. WITHOUT the force-kill fix, the `finally`
		// then tears the handle out of `handles` while the PTY is still alive — an
		// untracked, unrecoverable live process. WITH the fix, the rollback forces
		// `runtime.shutdown(handle, "SIGKILL")` before teardown.
		//
		// This test FAILS without the fix (no shutdown call for the spawned
		// handle) and PASSES with it.
		const ctrl = makeMockRuntime("mock-pty-persist-marker-fail");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const agentsDir = pathFor("agents");
		// (1) Break the persist write (ENOSPC) — triggers the rollback.
		writeFileMock.mockImplementation((p, data, options) => {
			if (String(p).startsWith(agentsDir)) {
				return Promise.reject(
					Object.assign(new Error("simulated ENOSPC"), { code: "ENOSPC" }),
				);
			}
			if (writeFileState.real === null) {
				throw new Error("writeFileState.real not initialized by vi.mock factory");
			}
			return writeFileState.real(p, data, options);
		});
		// (2) Break the FIRST stop-marker write (the rollback's
		// `shutdownAgentInternal` marker write) so it throws BEFORE the adapter
		// shutdown is reached. One-shot: only the rollback marker write fails.
		writeStopMarkerMock.mockRejectedValueOnce(
			Object.assign(new Error("simulated marker EIO"), { code: "EIO" }),
		);

		await expect(
			mgr.registerAgent({
				agentId: "persist-marker-orphan",
				runtimeId: "mock-pty-persist-marker-fail",
				cwd: "/tmp/work",
				env: {},
				sessionId: "sess-pmo",
			}),
		).rejects.toThrow(/ENOSPC/);

		// The process WAS spawned then rolled back — no handle leaks in-memory.
		expect(ctrl.spawnCalls).toHaveLength(1);
		expect(mgr.listHandles()).toHaveLength(0);

		const spawnedId = `${ctrl.runtime.id}-h1`;
		expect(mgr.getHandle(spawnedId)).toBeUndefined();
		// The KEY assertion: even though the marker write threw before
		// `shutdownAgentInternal` could call `runtime.shutdown`, the forced
		// adapter shutdown in the rollback catch reaped the live PTY.
		expect(ctrl.shutdownCalls.some((c) => c.handleId === spawnedId)).toBe(true);
		expect(
			ctrl.shutdownCalls.some(
				(c) => c.handleId === spawnedId && c.signal === "SIGKILL",
			),
		).toBe(true);

		// No persisted config on disk (the persist write was the failure).
		const configPath = path.join(agentsDir, `${spawnedId}.json`);
		await expect(fsp.access(configPath)).rejects.toBeDefined();
	});
});

describe("AgentManager / getLastStatus + isAlive (PR45 M6)", () => {
	it("getLastStatus returns undefined for unknown handle and tracks status transitions", async () => {
		const ctrl = makeMockRuntime("mock-pty-status-a");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		expect(mgr.getLastStatus("never-registered")).toBeUndefined();

		const handle = await mgr.registerAgent({
			agentId: "status-track",
			runtimeId: "mock-pty-status-a",
			cwd: "/tmp/work",
			env: {},
			sessionId: "sess-st",
		});

		// trackHandle seeds lastStatus = "running".
		expect(mgr.getLastStatus(handle.id)).toBe("running");

		ctrl.emitStatus(handle.id, "idle", 0);
		await waitForCondition(() => mgr.getLastStatus(handle.id) === "idle");
		expect(mgr.getLastStatus(handle.id)).toBe("idle");
	});

	it("isAlive pins every status branch against a real AgentManager", async () => {
		const ctrl = makeMockRuntime("mock-pty-status-b");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		// unknown handle → undefined
		expect(mgr.isAlive("never-registered")).toBeUndefined();

		const handle = await mgr.registerAgent({
			agentId: "alive-branches",
			runtimeId: "mock-pty-status-b",
			cwd: "/tmp/work",
			env: {},
			sessionId: "sess-al",
		});

		// running (seeded) → true
		expect(mgr.isAlive(handle.id)).toBe(true);

		// idle → true
		ctrl.emitStatus(handle.id, "idle");
		await waitForCondition(() => mgr.getLastStatus(handle.id) === "idle");
		expect(mgr.isAlive(handle.id)).toBe(true);

		// unknown status → undefined (adapter has not reported a real state)
		ctrl.emitStatus(handle.id, "unknown");
		await waitForCondition(() => mgr.getLastStatus(handle.id) === "unknown");
		expect(mgr.isAlive(handle.id)).toBeUndefined();

		// exited → false
		ctrl.emitStatus(handle.id, "exited", 0);
		await waitForCondition(() => mgr.getLastStatus(handle.id) === "exited");
		expect(mgr.isAlive(handle.id)).toBe(false);

		// crashed → false
		ctrl.emitStatus(handle.id, "crashed", 1);
		await waitForCondition(() => mgr.getLastStatus(handle.id) === "crashed");
		expect(mgr.isAlive(handle.id)).toBe(false);
	});
});

describe("AgentManager / status persistence", () => {
	it("status change fires appendEvent to session.jsonl", async () => {
		const ctrl = makeMockRuntime("mock-pty-2");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const handle = await mgr.registerAgent({
			agentId: "beta",
			runtimeId: "mock-pty-2",
			cwd: "/tmp/work",
			env: {},
			sessionId: "sess-2",
		});
		ctrl.emitStatus(handle.id, "idle", 0);

		const logPath = path.join(pathFor("session-logs"), `${handle.id}.jsonl`);
		await waitForCondition(async () => {
			try {
				await fsp.access(logPath);
				return true;
			} catch {
				return false;
			}
		});
		const raw = await fsp.readFile(logPath, "utf8");
		const lines = raw.split("\n").filter((l) => l.length > 0);
		expect(lines.length).toBeGreaterThanOrEqual(1);
		const parsed = JSON.parse(lines[0] as string);
		expect(parsed.kind).toBe("status");
		expect(parsed.status).toBe("idle");
	});
});

describe("AgentManager / shutdownAgent ordering", () => {
	it("writes graceful marker BEFORE calling runtime.shutdown", async () => {
		const ctrl = makeMockRuntime("mock-pty-3");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const handle = await mgr.registerAgent({
			agentId: "gamma",
			runtimeId: "mock-pty-3",
			cwd: "/tmp/work",
			env: {},
			sessionId: "sess-3",
		});

		await mgr.shutdownAgent(handle.id, "SIGTERM");

		expect(ctrl.shutdownCalls).toHaveLength(1);
		expect(ctrl.shutdownCalls[0]?.markerSeen).toBe(true);
	});
});

describe("AgentManager / restartAgent", () => {
	it("writes recycle marker, shuts down, re-spawns, increments generationToken", async () => {
		const ctrl = makeMockRuntime("mock-pty-4");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const handle = await mgr.registerAgent({
			agentId: "delta",
			runtimeId: "mock-pty-4",
			cwd: "/tmp/work",
			env: {},
			sessionId: "sess-4",
		});

		const restarted = await mgr.restartAgent(handle.id, "stalled");

		expect(ctrl.spawnCalls).toHaveLength(2);
		expect(ctrl.shutdownCalls).toHaveLength(1);
		expect(restarted.generationToken).toBe(1);
		// `restartAgent` clears the marker via teardown path on the
		// pre-restart handle, but the new generation has no marker; check
		// the original handle id still has the recycle marker on disk
		// AT MOST until clearStopMarker is called by bootRecovery. Since
		// we did not boot, marker should still be present.
		const stillMarker = await readStopMarker(handle.id);
		expect(stillMarker?.reason).toBe("recycle");
	});

	it("(Task 8) emits agent-restarted with the new generation so the cron loop can re-arm", async () => {
		// Task 8 (single restart authority): a heartbeat recycle (or any
		// restartAgent caller) must ANNOUNCE the new generation so the cron-restart
		// loop re-arms its exit listener on the fresh handle. Without this event,
		// a heartbeat recycle leaves the new generation with no cron-side exit
		// listener and a later exit goes un-restarted.
		const ctrl = makeMockRuntime("mock-pty-restarted-evt");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		const handle = await mgr.registerAgent({
			agentId: "evt-agent",
			runtimeId: "mock-pty-restarted-evt",
			cwd: "/tmp/work",
			env: {},
			sessionId: "sess-evt",
		});

		const events: Array<{
			agentId: string;
			handleId: string;
			generationToken: number;
		}> = [];
		mgr.on("agent-restarted", (e) => events.push(e));

		const restarted = await mgr.restartAgent(handle.id, "stalled");

		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({
			agentId: "evt-agent",
			handleId: handle.id,
			generationToken: restarted.generationToken,
		});
		// The announced handleId resolves to the live new generation.
		expect(mgr.getHandle(events[0].handleId)?.generationToken).toBe(
			restarted.generationToken,
		);
	});

	it("(Task 8) isRestarting reports true only while a restart is in flight", async () => {
		// Task 8 (no double-restart): the cron exit listener consults isRestarting
		// before scheduling, so a heartbeat recycle tearing the PTY down (which
		// trips the same exited/crashed status the listener watches) does not race
		// a competing cron restart. The flag is true DURING doRestart and clears
		// after it settles.
		const ctrl = makeMockRuntime("mock-pty-isrestarting");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		const handle = await mgr.registerAgent({
			agentId: "isr-agent",
			runtimeId: "mock-pty-isrestarting",
			cwd: "/tmp/work",
			env: {},
			sessionId: "sess-isr",
		});

		expect(mgr.isRestarting(handle.id)).toBe(false);
		const p = mgr.restartAgent(handle.id, "stalled");
		// Synchronously after kicking restartAgent, the in-flight promise is
		// registered → isRestarting is true.
		expect(mgr.isRestarting(handle.id)).toBe(true);
		await p;
		// Settled → flag cleared.
		expect(mgr.isRestarting(handle.id)).toBe(false);
	});
});

describe("AgentManager / spawnSubagent", () => {
	it("links parent-child; parent 'exited' triggers child shutdown cascade", async () => {
		const ctrl = makeMockRuntime("mock-pty-5");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const parent = await mgr.registerAgent({
			agentId: "parent",
			runtimeId: "mock-pty-5",
			cwd: "/tmp/work",
			env: { AWS_REGION: "us-east-1", FOO: "parent" },
			sessionId: "sess-p",
		});
		const child = await mgr.spawnSubagent({
			parentHandleId: parent.id,
			agentId: "child",
			runtimeId: "mock-pty-5",
			sessionId: "sess-c",
			env: { AWS_REGION: "us-west-2", BAR: "child" },
		});

		const state = mgr._internalState();
		const link = state.parentChildren.find((p) => p.parent === parent.id);
		expect(link?.children).toContain(child.id);

		// Verify env-merge policy: parent's AWS_REGION wins.
		const childSpawn = ctrl.spawnCalls[1];
		expect(childSpawn?.env.AWS_REGION).toBe("us-east-1");
		expect(childSpawn?.env.BAR).toBe("child");

		// Trigger parent exit — child must auto-shutdown.
		ctrl.emitStatus(parent.id, "exited", 0);
		await waitForCondition(() =>
			ctrl.shutdownCalls.some((c) => c.handleId === child.id),
		);
		const childShutdown = ctrl.shutdownCalls.find((c) => c.handleId === child.id);
		expect(childShutdown).toBeDefined();
	});
});

describe("AgentManager / cost rollup", () => {
	it("child costTap event increments child selfCost AND parent rolledUpCost", async () => {
		const ctrl = makeMockRuntime("mock-pty-6");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const parent = await mgr.registerAgent({
			agentId: "rollup-parent",
			runtimeId: "mock-pty-6",
			cwd: "/tmp/work",
			env: {},
			sessionId: "sess-rp",
		});
		const child = await mgr.spawnSubagent({
			parentHandleId: parent.id,
			agentId: "rollup-child",
			runtimeId: "mock-pty-6",
			sessionId: "sess-rc",
		});

		await ctrl.pushCost(child.id, {
			at: Date.now(),
			agentId: "rollup-child",
			sessionId: "sess-rc",
			dollarsUsd: 0.42,
			provider: "anthropic",
			model: "claude-opus-4-8",
		});

		await waitForCondition(() => mgr.getCostSummary(child.id).selfCost > 0);

		const childSummary = mgr.getCostSummary(child.id);
		const parentSummary = mgr.getCostSummary(parent.id);
		expect(childSummary.selfCost).toBeCloseTo(0.42, 6);
		expect(parentSummary.rolledUpCost).toBeCloseTo(0.42, 6);
		expect(parentSummary.selfCost).toBe(0);
	});
});

describe("AgentManager / bootRecovery", () => {
	it("categorizes graceful + crash markers; attempts replay on crash", async () => {
		const ctrl = makeMockRuntime("mock-pty-7");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		// Stage state from a "previous" daemon run.
		const gracefulHandleId = "prev-graceful";
		const crashHandleId = "prev-crash";
		await writeStopMarker(gracefulHandleId, "graceful");
		await writeStopMarker(crashHandleId, "crash");

		// Seed crash handle's session log + HWM so replay has something to do.
		await appendEvent(crashHandleId, {
			kind: "prompt",
			payload: { text: "resume-me" },
		});
		const beforeStat = await fsp.stat(
			path.join(pathFor("session-logs"), `${crashHandleId}.jsonl`),
		);
		await setHWM(crashHandleId, {
			byteOffset: beforeStat.size,
			sequence: 1,
		});

		// Adapter knows how to resume — return a synthetic restored handle.
		let restoreCalled = false;
		ctrl.setRestoreFromMarker(async () => {
			restoreCalled = true;
			return {
				id: crashHandleId,
				runtime: "mock-pty-7",
				shape: "pty",
				agentId: "crashed",
				sessionId: "sess-crash",
				generationToken: 1,
				org: undefined,
				parentHandleId: undefined,
				spawnedAt: Date.now(),
				markerPath: path.join(pathFor("markers"), `${crashHandleId}.daemon-stop`),
			};
		});

		const knownConfigs = new Map([
			[
				crashHandleId,
				{
					agentId: "crashed",
					runtimeId: "mock-pty-7",
					cwd: "/tmp/work",
					env: {},
					sessionId: "sess-crash",
				},
			],
		]);

		const result = await mgr.bootRecovery({ knownConfigs });

		expect(result.cleanShutdowns).toContain(gracefulHandleId);
		expect(result.crashes).toContain(crashHandleId);
		expect(restoreCalled).toBe(true);
		// Replay re-fed the prompt to the runtime.
		const replayedSend = ctrl.sendCalls.find(
			(s) => s.handleId === crashHandleId && s.message.kind === "prompt",
		);
		expect(replayedSend).toBeDefined();

		// EC3: second call returns cached result without re-running.
		const second = await mgr.bootRecovery({ knownConfigs });
		expect(second).toBe(result);
	});
});

describe("AgentManager / resolveAgentOrg", () => {
	it("returns stored org when handle is in memory", async () => {
		const ctrl = makeMockRuntime("mock-pty-8");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		await mgr.registerAgent({
			agentId: "lookup-me",
			runtimeId: "mock-pty-8",
			org: "org-Z",
			cwd: "/tmp/work",
			env: {},
			sessionId: "sess-z",
		});

		expect(await mgr.resolveAgentOrg("lookup-me")).toBe("org-Z");
		expect(await mgr.resolveAgentOrg("unknown-agent")).toBeNull();
	});
});

describe("AgentManager / PR1 lastStatusChangeMs refresh", () => {
	it("10 successive status callbacks keep lastStatusChangeMs fresh; stall detector does NOT trigger", async () => {
		const ctrl = makeMockRuntime("mock-pty-9");
		registerRuntime(ctrl.runtime);
		const forceCalls: string[] = [];
		const hb = new HeartbeatController({
			intervalMs: 60_000,
			stallThresholdMs: 1_000,
			onForceRestart: async (handleId) => {
				forceCalls.push(handleId);
			},
		});
		const mgr = new AgentManager({ heartbeat: hb });
		const handle = await mgr.registerAgent({
			agentId: "fresh",
			runtimeId: "mock-pty-9",
			cwd: "/tmp/work",
			env: {},
			sessionId: "sess-f",
		});

		// 10 status callbacks over time, each refreshing lastStatusChangeMs.
		for (let i = 0; i < 10; i++) {
			ctrl.emitStatus(handle.id, "running");
			await new Promise<void>((resolve) => setImmediate(resolve));
		}

		// Tick the heartbeat immediately; lastStatusChangeMs is fresh (just
		// refreshed by the last callback), so even with stallThresholdMs=1s
		// the detector should NOT fire on this tick.
		await hb._tickForTests();

		expect(forceCalls).toHaveLength(0);

		// Drain any pending appendEvent writes before teardown deletes the
		// temp state root — otherwise stragglers log spurious ENOENT errors
		// resolved against the homedir fallback after env override is unset.
		const logPath = path.join(pathFor("session-logs"), `${handle.id}.jsonl`);
		await waitForCondition(async () => {
			try {
				const raw = await fsp.readFile(logPath, "utf8");
				return raw.split("\n").filter((l) => l.length > 0).length >= 10;
			} catch {
				return false;
			}
		});
	});
});

describe("AgentManager / EC1 double-restart guard", () => {
	it("re-entrant restartAgent call returns current handle without double-spawn", async () => {
		const ctrl = makeMockRuntime("mock-pty-10");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const handle = await mgr.registerAgent({
			agentId: "guard",
			runtimeId: "mock-pty-10",
			cwd: "/tmp/work",
			env: {},
			sessionId: "sess-g",
		});

		// Kick off two concurrent restarts on the same handle id. The
		// second MUST NOT trigger a second runtime.shutdown + spawn pair.
		const [first, second] = await Promise.all([
			mgr.restartAgent(handle.id, "stalled"),
			mgr.restartAgent(handle.id, "stalled"),
		]);

		expect(ctrl.spawnCalls).toHaveLength(2); // original + one restart
		expect(ctrl.shutdownCalls).toHaveLength(1); // one shutdown only
		// Both calls resolved with a handle.
		expect(first.id).toBeDefined();
		expect(second.id).toBeDefined();

		// Drain pending status writes before teardown.
		await new Promise<void>((resolve) => setTimeout(resolve, 50));
	});
});

describe("AgentManager / bootRecovery recycle path", () => {
	it("re-spawns handle from knownConfigs when marker reason is 'recycle'", async () => {
		const ctrl = makeMockRuntime("mock-pty-11");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const recycledHandleId = "prev-recycled";
		await writeStopMarker(recycledHandleId, "recycle");

		const knownConfigs = new Map([
			[
				recycledHandleId,
				{
					agentId: "recycle-me",
					runtimeId: "mock-pty-11",
					cwd: "/tmp/work",
					env: {},
					sessionId: "sess-r",
				},
			],
		]);

		const result = await mgr.bootRecovery({ knownConfigs });

		expect(result.cleanShutdowns).toContain(recycledHandleId);
		// Recycle path triggers a fresh spawn through registerAgent.
		expect(ctrl.spawnCalls).toHaveLength(1);
		// Marker is cleared after re-spawn.
		const after = await readStopMarker(recycledHandleId);
		expect(after).toBeNull();
	});
});

describe("AgentManager / getCostSummary missing handle", () => {
	it("returns zeros for an unknown handleId", () => {
		const mgr = new AgentManager();
		const summary = mgr.getCostSummary("does-not-exist");
		expect(summary.selfCost).toBe(0);
		expect(summary.rolledUpCost).toBe(0);
		expect(summary.total).toBe(0);
	});
});

describe("AgentManager / EC2 parent-died-during-spawn", () => {
	it("short-circuits via pre-check (IMPORTANT #4) when parent is already dead before spawn", async () => {
		const ctrl = makeMockRuntime("mock-pty-12");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const parent = await mgr.registerAgent({
			agentId: "parent-ec2",
			runtimeId: "mock-pty-12",
			cwd: "/tmp/work",
			env: {},
			sessionId: "sess-p2",
		});

		// Mark the parent as not-alive BEFORE spawnSubagent fires. The
		// IMPORTANT #4 pre-check short-circuits before paying the spawn
		// cost — no second runtime.spawn call should land.
		const spawnsBefore = ctrl.spawnCalls.length;
		ctrl.setAlive(parent.id, false);

		await expect(
			mgr.spawnSubagent({
				parentHandleId: parent.id,
				agentId: "child-ec2",
				runtimeId: "mock-pty-12",
				sessionId: "sess-c2",
			}),
		).rejects.toThrow(/Parent handle died during subagent spawn/);

		// IMPORTANT #4: pre-check fired BEFORE runtime.spawn. No new
		// spawn call landed (saves the expensive PTY allocation when
		// parent is obviously gone).
		expect(ctrl.spawnCalls.length).toBe(spawnsBefore);
	});

	it("post-spawn re-check (EC2 path) kills the child and throws when parent dies DURING spawn", async () => {
		const ctrl = makeMockRuntime("mock-pty-12b");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const parent = await mgr.registerAgent({
			agentId: "parent-ec2b",
			runtimeId: "mock-pty-12b",
			cwd: "/tmp/work",
			env: {},
			sessionId: "sess-p2b",
		});

		// Override isAlive: pre-check sees alive; post-check sees dead.
		// Simulates the race window where parent exits between
		// runtime.spawn returning and the linkage insertion.
		let isAliveCallCount = 0;
		ctrl.runtime.isAlive = async () => {
			isAliveCallCount++;
			// Calls 1 = pre-check (alive). Call 2 = post-check (dead).
			return isAliveCallCount === 1;
		};

		const spawnsBefore = ctrl.spawnCalls.length;

		await expect(
			mgr.spawnSubagent({
				parentHandleId: parent.id,
				agentId: "child-ec2b",
				runtimeId: "mock-pty-12b",
				sessionId: "sess-c2b",
			}),
		).rejects.toThrow(/Parent handle died during subagent spawn/);

		// Spawn DID run (pre-check passed), but the post-check killed
		// the child and threw.
		expect(ctrl.spawnCalls.length).toBe(spawnsBefore + 1);
		const childShutdown = ctrl.shutdownCalls.find(
			(s) => s.handleId !== parent.id,
		);
		expect(childShutdown).toBeDefined();
	});
});

describe("AgentManager / shutdown cascade without status callback (Codex H2)", () => {
	it("explicitly cascades children when adapter shutdown does not emit a terminal status", async () => {
		const ctrl = makeMockRuntime("mock-pty-cascade-shut");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const parent = await mgr.registerAgent({
			agentId: "cascade-parent",
			runtimeId: "mock-pty-cascade-shut",
			cwd: "/tmp/work",
			env: {},
			sessionId: "sess-cp",
		});
		const child = await mgr.spawnSubagent({
			parentHandleId: parent.id,
			agentId: "cascade-child",
			runtimeId: "mock-pty-cascade-shut",
			sessionId: "sess-cc",
		});

		// Mock `runtime.shutdown` does NOT emit `exited`/`crashed` — the
		// status-driven cascade in `handleStatusChange` therefore never
		// fires. The fix routes the cascade through `shutdownAgent`
		// directly so the child cleanup is independent of adapter
		// callback semantics.
		await mgr.shutdownAgent(parent.id, "SIGTERM");

		const childShutdown = ctrl.shutdownCalls.find((s) => s.handleId === child.id);
		expect(childShutdown).toBeDefined();
		expect(mgr.getHandle(child.id)).toBeUndefined();
		expect(mgr.getHandle(parent.id)).toBeUndefined();
	});

	it("restartAgent cascades children before tearing the parent down", async () => {
		const ctrl = makeMockRuntime("mock-pty-cascade-restart");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const parent = await mgr.registerAgent({
			agentId: "restart-parent",
			runtimeId: "mock-pty-cascade-restart",
			cwd: "/tmp/work",
			env: {},
			sessionId: "sess-rp",
		});
		const child = await mgr.spawnSubagent({
			parentHandleId: parent.id,
			agentId: "restart-child",
			runtimeId: "mock-pty-cascade-restart",
			sessionId: "sess-rc",
		});

		await mgr.restartAgent(parent.id, "stalled");

		// Child handle was shut down and removed; the new parent
		// generation has no children linked (application layer must
		// respawn).
		const childShutdown = ctrl.shutdownCalls.find((s) => s.handleId === child.id);
		expect(childShutdown).toBeDefined();
		expect(mgr.getHandle(child.id)).toBeUndefined();
		const link = mgr
			._internalState()
			.parentChildren.find((p) => p.parent === parent.id);
		expect(link).toBeUndefined();
	});
});

describe("AgentManager / bootRecovery crash without marker (Codex H1)", () => {
	it("treats knownConfigs entries with no marker on disk as crash candidates", async () => {
		const ctrl = makeMockRuntime("mock-pty-no-marker");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const crashedHandleId = "no-marker-crash";

		// Seed the session log so replay has at least one prompt to
		// re-feed once the adapter resumes.
		await appendEvent(crashedHandleId, {
			kind: "prompt",
			payload: { text: "resume-after-hard-crash" },
		});
		const stat = await fsp.stat(
			path.join(pathFor("session-logs"), `${crashedHandleId}.jsonl`),
		);
		await setHWM(crashedHandleId, {
			byteOffset: stat.size,
			sequence: 1,
		});

		let restoreCalled = false;
		ctrl.setRestoreFromMarker(async () => {
			restoreCalled = true;
			return {
				id: crashedHandleId,
				runtime: "mock-pty-no-marker",
				shape: "pty",
				agentId: "hard-crashed",
				sessionId: "sess-hc",
				generationToken: 1,
				org: undefined,
				parentHandleId: undefined,
				spawnedAt: Date.now(),
				markerPath: path.join(pathFor("markers"), `${crashedHandleId}.daemon-stop`),
			};
		});

		const knownConfigs = new Map([
			[
				crashedHandleId,
				{
					agentId: "hard-crashed",
					runtimeId: "mock-pty-no-marker",
					cwd: "/tmp/work",
					env: {},
					sessionId: "sess-hc",
				},
			],
		]);

		// Confirm there really is no marker on disk for this handleId.
		const markersBefore = await listAllMarkers();
		expect(
			markersBefore.find((m) => m.handleId === crashedHandleId),
		).toBeUndefined();

		const result = await mgr.bootRecovery({ knownConfigs });

		expect(result.crashes).toContain(crashedHandleId);
		expect(restoreCalled).toBe(true);
		const replayedSend = ctrl.sendCalls.find(
			(s) => s.handleId === crashedHandleId && s.message.kind === "prompt",
		);
		expect(replayedSend).toBeDefined();
		expect(result.recovered).toContain(crashedHandleId);
	});
});

describe("AgentManager / bootRecovery with unregistered runtime (dual-adversarial Critical)", () => {
	it("boots degraded and emits recovery-skipped when a known crash config references a runtime that failed to register", async () => {
		// Deliberately DO NOT register any runtime — mirrors the production
		// scenario where the built-in adapter (e.g. claude-pty) failed to load
		// via loadAdapterFailIsolated (which only WARNS, never registers) AND a
		// prior daemon run left a persisted config pointing at that runtimeId.
		const mgr = new AgentManager();

		const crashHandleId = "unregistered-runtime-crash";
		await writeStopMarker(crashHandleId, "crash");

		const knownConfigs = new Map([
			[
				crashHandleId,
				{
					agentId: "orphaned",
					runtimeId: "claude-pty", // never registered in this test
					cwd: "/tmp/work",
					env: {},
					sessionId: "sess-orphan",
				},
			],
		]);

		// MUST NOT throw — the daemon boots degraded rather than crashing.
		const result = await mgr.bootRecovery({ knownConfigs });

		// The crash candidate is still categorized as a crash, but it is NOT
		// recovered (no runtime to resolve/replay against).
		expect(result.crashes).toContain(crashHandleId);
		expect(result.recovered).not.toContain(crashHandleId);

		// A recovery-skipped telemetry event fired for that handle.
		const skipped = emitMock.mock.calls
			.map((c) => c[0] as DaemonEvent)
			.filter((e) => e.kind === "recovery-skipped");
		expect(skipped).toHaveLength(1);
		expect(skipped[0]).toMatchObject({
			kind: "recovery-skipped",
			handleId: crashHandleId,
			runtimeId: "claude-pty",
			reason: "runtime-not-registered",
		});

		// The marker is cleared so the next boot does not re-trip on it.
		const after = await readStopMarker(crashHandleId);
		expect(after).toBeNull();
	});

	it("isolates per-handle: an unregistered-runtime crash does not block recovery of a sibling with a registered runtime", async () => {
		// One sibling HAS a registered runtime and a resumable session; the
		// other references an unregistered runtime. Recovery must process both
		// — the unregistered one is skipped, the registered one is recovered.
		const ctrl = makeMockRuntime("mock-pty-sibling");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const badHandleId = "sibling-bad-runtime";
		const goodHandleId = "sibling-good-runtime";
		await writeStopMarker(badHandleId, "crash");
		await writeStopMarker(goodHandleId, "crash");

		await appendEvent(goodHandleId, {
			kind: "prompt",
			payload: { text: "resume-good" },
		});
		const goodStat = await fsp.stat(
			path.join(pathFor("session-logs"), `${goodHandleId}.jsonl`),
		);
		await setHWM(goodHandleId, { byteOffset: goodStat.size, sequence: 1 });

		ctrl.setRestoreFromMarker(async () => ({
			id: goodHandleId,
			runtime: "mock-pty-sibling",
			shape: "pty",
			agentId: "good",
			sessionId: "sess-good",
			generationToken: 1,
			org: undefined,
			parentHandleId: undefined,
			spawnedAt: Date.now(),
			markerPath: path.join(pathFor("markers"), `${goodHandleId}.daemon-stop`),
		}));

		const knownConfigs = new Map([
			[
				badHandleId,
				{
					agentId: "bad",
					runtimeId: "never-registered-runtime",
					cwd: "/tmp/work",
					env: {},
					sessionId: "sess-bad",
				},
			],
			[
				goodHandleId,
				{
					agentId: "good",
					runtimeId: "mock-pty-sibling",
					cwd: "/tmp/work",
					env: {},
					sessionId: "sess-good",
				},
			],
		]);

		const result = await mgr.bootRecovery({ knownConfigs });

		// Bad one skipped, good one recovered — per-handle isolation holds.
		expect(result.crashes).toContain(badHandleId);
		expect(result.crashes).toContain(goodHandleId);
		expect(result.recovered).not.toContain(badHandleId);
		expect(result.recovered).toContain(goodHandleId);

		const skipped = emitMock.mock.calls
			.map((c) => c[0] as DaemonEvent)
			.filter((e) => e.kind === "recovery-skipped");
		expect(skipped).toHaveLength(1);
		expect(skipped[0]).toMatchObject({
			kind: "recovery-skipped",
			handleId: badHandleId,
			runtimeId: "never-registered-runtime",
		});
	});
});

describe("AgentManager / RSS-driven heartbeat recycling (Codex H3)", () => {
	it("adapter getStatus surfaces RSS; heartbeat triggers force-restart on exceedance", async () => {
		const ctrl = makeMockRuntime("mock-pty-rss");
		registerRuntime(ctrl.runtime);
		const hb = new HeartbeatController({
			intervalMs: 60_000,
			rssLimitBytes: 100 * 1024 * 1024,
			stallThresholdMs: 60 * 60_000,
			onForceRestart: async () => {},
		});
		const mgr = new AgentManager({ heartbeat: hb });

		const handle = await mgr.registerAgent({
			agentId: "rss-hot",
			runtimeId: "mock-pty-rss",
			cwd: "/tmp/work",
			env: {},
			sessionId: "sess-rss",
		});

		// Push the adapter's reported RSS above the 100MB recycle limit.
		ctrl.setRss(handle.id, 600 * 1024 * 1024);

		await hb._tickForTests();

		// `restartAgent` re-spawns; total spawn calls should be 2
		// (initial + recycle). The new generation token confirms the
		// restart took effect.
		await waitForCondition(() => ctrl.spawnCalls.length >= 2);
		expect(ctrl.spawnCalls.length).toBe(2);

		// Marker on the original handle id reflects the recycle reason.
		const marker = await readStopMarker(handle.id);
		expect(marker?.reason).toBe("recycle");

		// Drain pending status writes before teardown.
		await new Promise<void>((resolve) => setTimeout(resolve, 50));
	});
});

describe("AgentManager / EC5 cost event after parent teardown", () => {
	it("normal rollup works; post-shutdown getCostSummary is stable and pushCost to closed stream does not throw", async () => {
		// The cascade from shutdownAgent always tears down children before the
		// parent, so "child alive, parent gone" is not reachable via the
		// public API. This test verifies the adjacent observables that ARE
		// reachable: normal rollup works, and the post-shutdown state is
		// stable (no throw from getCostSummary or a pushCost on the now-closed
		// child stream). The applyCostEvent guard at line 747 is exercised
		// when a queued cost event fires after teardown removes the handle —
		// that path is covered by the race on the existing cost rollup test
		// plus the shutdown-path assertions here.
		const ctrl = makeMockRuntime("mock-pty-ec5");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const parent = await mgr.registerAgent({
			agentId: "ec5-parent",
			runtimeId: "mock-pty-ec5",
			cwd: "/tmp/work",
			env: {},
			sessionId: "sess-ec5-p",
		});
		const child = await mgr.spawnSubagent({
			parentHandleId: parent.id,
			agentId: "ec5-child",
			runtimeId: "mock-pty-ec5",
			sessionId: "sess-ec5-c",
		});

		// Normal rollup works: child cost event increments parent rolledUpCost.
		await ctrl.pushCost(child.id, {
			at: Date.now(),
			agentId: "ec5-child",
			sessionId: "sess-ec5-c",
			dollarsUsd: 0.1,
			provider: "anthropic",
			model: "claude-opus-4-8",
		});
		await waitForCondition(() => mgr.getCostSummary(parent.id).rolledUpCost > 0);
		expect(mgr.getCostSummary(parent.id).rolledUpCost).toBeCloseTo(0.1, 6);

		// Shut down the parent — cascade tears down the child too.
		await mgr.shutdownAgent(parent.id, "SIGTERM");
		expect(mgr.getHandle(parent.id)).toBeUndefined();
		expect(mgr.getHandle(child.id)).toBeUndefined();

		// getCostSummary must not throw for removed handles; returns zeros.
		expect(mgr.getCostSummary(parent.id)).toEqual({
			selfCost: 0,
			rolledUpCost: 0,
			total: 0,
		});
		expect(mgr.getCostSummary(child.id)).toEqual({
			selfCost: 0,
			rolledUpCost: 0,
			total: 0,
		});

		// pushCost into the closed child stream must not throw.
		await expect(
			ctrl.pushCost(child.id, {
				at: Date.now(),
				agentId: "ec5-child",
				sessionId: "sess-ec5-c",
				dollarsUsd: 0.1,
				provider: "anthropic",
				model: "claude-opus-4-8",
			}),
		).resolves.toBeUndefined();
	});
});

describe("AgentManager / CRITICAL #1 — agentId uniqueness at write-side", () => {
	it("parallel registerAgent of same agentId in DIFFERENT orgs: one succeeds, one throws AgentIdAlreadyRegisteredError", async () => {
		const ctrlA = makeMockRuntime("mock-pty-uniq-a");
		const ctrlB = makeMockRuntime("mock-pty-uniq-b");
		registerRuntime(ctrlA.runtime);
		registerRuntime(ctrlB.runtime);
		const mgr = new AgentManager();

		const results = await Promise.allSettled([
			mgr.registerAgent({
				agentId: "alpha",
				runtimeId: "mock-pty-uniq-a",
				org: "org-1",
				cwd: "/tmp/w",
				env: {},
				sessionId: "sess-1",
			}),
			mgr.registerAgent({
				agentId: "alpha",
				runtimeId: "mock-pty-uniq-b",
				org: "org-2",
				cwd: "/tmp/w",
				env: {},
				sessionId: "sess-2",
			}),
		]);

		const fulfilled = results.filter((r) => r.status === "fulfilled");
		const rejected = results.filter((r) => r.status === "rejected");
		expect(fulfilled.length).toBe(1);
		expect(rejected.length).toBe(1);
		const rejection = rejected[0];
		if (rejection?.status === "rejected") {
			expect(rejection.reason).toBeInstanceOf(AgentIdAlreadyRegisteredError);
		}
	});

	it("sequential registerAgent of same agentId in DIFFERENT orgs throws on the second call before spawn runs", async () => {
		const ctrl = makeMockRuntime("mock-pty-uniq-seq");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		await mgr.registerAgent({
			agentId: "beta",
			runtimeId: "mock-pty-uniq-seq",
			org: "org-X",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-X",
		});

		const spawnsBefore = ctrl.spawnCalls.length;
		await expect(
			mgr.registerAgent({
				agentId: "beta",
				runtimeId: "mock-pty-uniq-seq",
				org: "org-Y",
				cwd: "/tmp/w",
				env: {},
				sessionId: "sess-Y",
			}),
		).rejects.toBeInstanceOf(AgentIdAlreadyRegisteredError);
		// No second spawn should have landed — the throw is at the
		// write boundary before runtime.spawn.
		expect(ctrl.spawnCalls.length).toBe(spawnsBefore);
	});

	it("same agentId in the SAME org is permitted (re-registration of an idle agent)", async () => {
		const ctrl = makeMockRuntime("mock-pty-uniq-same");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		await mgr.registerAgent({
			agentId: "gamma",
			runtimeId: "mock-pty-uniq-same",
			org: "org-1",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-g1",
		});

		// Same agentId + same org → permitted.
		await expect(
			mgr.registerAgent({
				agentId: "gamma",
				runtimeId: "mock-pty-uniq-same",
				org: "org-1",
				cwd: "/tmp/w",
				env: {},
				sessionId: "sess-g2",
			}),
		).resolves.toBeDefined();
	});
});

describe("AgentManager / CRITICAL #2 — cascade marker reason propagation", () => {
	it("parent CRASHES → children get 'crash' markers (replayed on next boot)", async () => {
		const ctrl = makeMockRuntime("mock-pty-crash-cascade");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const parent = await mgr.registerAgent({
			agentId: "crash-parent",
			runtimeId: "mock-pty-crash-cascade",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-cp",
		});
		const child = await mgr.spawnSubagent({
			parentHandleId: parent.id,
			agentId: "crash-child",
			runtimeId: "mock-pty-crash-cascade",
			sessionId: "sess-cc",
		});

		// Parent crashes → cascade fires with reason "crash".
		ctrl.emitStatus(parent.id, "crashed", 137);
		await waitForCondition(() =>
			ctrl.shutdownCalls.some((c) => c.handleId === child.id),
		);
		// Marker on the CHILD must be "crash" so boot recovery
		// includes it in the replay set.
		const childMarker = await readStopMarker(child.id);
		expect(childMarker?.reason).toBe("crash");
	});

	it("parent shuts down RESTART (recycle) → children get 'recycle' markers (NOT replayed on next boot)", async () => {
		const ctrl = makeMockRuntime("mock-pty-recycle-cascade");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const parent = await mgr.registerAgent({
			agentId: "recycle-parent",
			runtimeId: "mock-pty-recycle-cascade",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-rp",
		});
		const child = await mgr.spawnSubagent({
			parentHandleId: parent.id,
			agentId: "recycle-child",
			runtimeId: "mock-pty-recycle-cascade",
			sessionId: "sess-rc",
		});

		// Restart parent with reason "stalled" → child cascade reason
		// is "recycle".
		await mgr.restartAgent(parent.id, "stalled");
		const childMarker = await readStopMarker(child.id);
		expect(childMarker?.reason).toBe("recycle");
	});

	it("parent gracefully shutdownAgent → children get 'graceful' markers (NOT replayed)", async () => {
		const ctrl = makeMockRuntime("mock-pty-graceful-cascade");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const parent = await mgr.registerAgent({
			agentId: "graceful-parent",
			runtimeId: "mock-pty-graceful-cascade",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-gp",
		});
		const child = await mgr.spawnSubagent({
			parentHandleId: parent.id,
			agentId: "graceful-child",
			runtimeId: "mock-pty-graceful-cascade",
			sessionId: "sess-gc",
		});

		await mgr.shutdownAgent(parent.id, "SIGTERM");
		const childMarker = await readStopMarker(child.id);
		expect(childMarker?.reason).toBe("graceful");
	});
});

describe("AgentManager / CRITICAL #3 — handle-id stability across restart", () => {
	it("3 concurrent restartAgent calls all resolve to handle with SAME id; getHandle(id) returns it after", async () => {
		const ctrl = makeMockRuntime("mock-pty-stable");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const handle = await mgr.registerAgent({
			agentId: "stable",
			runtimeId: "mock-pty-stable",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-s",
		});
		const originalId = handle.id;

		const results = await Promise.all([
			mgr.restartAgent(originalId, "stalled"),
			mgr.restartAgent(originalId, "stalled"),
			mgr.restartAgent(originalId, "stalled"),
		]);

		// CRITICAL #3: all three callers resolve to the SAME handle id
		// (preserved across restart via SpawnOpts.restoreId).
		for (const r of results) {
			expect(r.id).toBe(originalId);
		}
		// And `getHandle(originalId)` returns the new generation.
		const retrieved = mgr.getHandle(originalId);
		expect(retrieved?.id).toBe(originalId);
		expect(retrieved?.generationToken).toBeGreaterThan(0);
	});

	it("restartAgent twice sequentially: second call resolves to same id, generation increments", async () => {
		const ctrl = makeMockRuntime("mock-pty-stable-seq");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const handle = await mgr.registerAgent({
			agentId: "stable-seq",
			runtimeId: "mock-pty-stable-seq",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-ss",
		});
		const originalId = handle.id;

		const r1 = await mgr.restartAgent(originalId, "stalled");
		expect(r1.id).toBe(originalId);
		expect(r1.generationToken).toBe(1);

		const r2 = await mgr.restartAgent(originalId, "stalled");
		expect(r2.id).toBe(originalId);
		expect(r2.generationToken).toBe(2);
	});

	it("adapter that ignores restoreId throws contract-violation error", async () => {
		const ctrl = makeMockRuntime("mock-pty-rogue");
		// Override spawn to ignore restoreId.
		ctrl.runtime.spawn = async (opts: SpawnOpts): Promise<AgentHandle> => {
			ctrl.spawnCalls.push(opts);
			const newId = `rogue-${Math.random().toString(36).slice(2, 9)}`;
			return {
				id: newId,
				runtime: "mock-pty-rogue",
				shape: "pty",
				agentId: opts.agentId,
				sessionId: opts.sessionId,
				generationToken: 0,
				org: opts.org,
				parentHandleId: opts.parentHandle?.id,
				spawnedAt: Date.now(),
				markerPath: path.join(pathFor("markers"), `${newId}.daemon-stop`),
			};
		};
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const handle = await mgr.registerAgent({
			agentId: "rogue-agent",
			runtimeId: "mock-pty-rogue",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-rog",
		});

		await expect(mgr.restartAgent(handle.id, "stalled")).rejects.toThrow(
			/violated SpawnOpts.restoreId contract/,
		);
	});
});

describe("AgentManager / IMPORTANT #5 — adapter liveness probe overrides stall detection", () => {
	it("liveness probe returning true suppresses stall trip even when lastStatusChangeMs is stale", async () => {
		const ctrl = makeMockRuntime("mock-pty-liveness");
		registerRuntime(ctrl.runtime);
		const hb = new HeartbeatController({
			intervalMs: 60_000,
			stallThresholdMs: 10,
			// onForceRestart REPLACED by AgentManager auto-wiring; we
			// observe absence of restart via ctrl.spawnCalls.
			onForceRestart: async () => {},
		});
		const mgr = new AgentManager({ heartbeat: hb });
		// Register adapter-side liveness probe BEFORE registerAgent so
		// trackHandle's probe closure picks it up.
		mgr.registerLivenessProbe("mock-pty-liveness", () => true);

		const handle = await mgr.registerAgent({
			agentId: "long-runner",
			runtimeId: "mock-pty-liveness",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-lr",
		});
		const spawnsBefore = ctrl.spawnCalls.length;

		// Advance heartbeat clock far past stallThreshold — without
		// the liveness override, this would trigger a stall trip.
		hb._setNowForTests(() => Date.now() + 10_000);

		await hb._tickForTests();
		// Yield to let any restart-triggered spawn settle.
		await new Promise<void>((resolve) => setTimeout(resolve, 50));

		// Liveness probe returned true → no force-restart, no new spawn.
		expect(ctrl.spawnCalls.length).toBe(spawnsBefore);
		// Handle is still tracked under the original id.
		expect(mgr.getHandle(handle.id)).toBeDefined();
	});

	it("liveness probe returning false leaves stall detection unchanged (stalled handle still fires restart)", async () => {
		const ctrl = makeMockRuntime("mock-pty-liveness-false");
		registerRuntime(ctrl.runtime);
		const hb = new HeartbeatController({
			intervalMs: 60_000,
			stallThresholdMs: 10,
			// onForceRestart will be REPLACED by AgentManager constructor
			// (auto-wired to restartAgent). We observe the restart via
			// ctrl.spawnCalls instead.
			onForceRestart: async () => {},
		});
		const mgr = new AgentManager({ heartbeat: hb });
		mgr.registerLivenessProbe("mock-pty-liveness-false", () => false);

		const handle = await mgr.registerAgent({
			agentId: "really-stalled",
			runtimeId: "mock-pty-liveness-false",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-rs",
		});
		const spawnsBefore = ctrl.spawnCalls.length;

		// Drive heartbeat's clock forward beyond stallThreshold so the
		// stall trip is unambiguous regardless of test scheduling.
		// Set AFTER registerAgent so lastStatusChangeMs (at register time)
		// is in the past relative to now().
		hb._setNowForTests(() => Date.now() + 10_000);

		await hb._tickForTests();

		// Probe said NOT alive (liveness false) → stall detection
		// uses original lastStatusChangeMs, which is now 10s old
		// against the fake-clock now() → restart fires (spawn increments).
		await waitForCondition(() => ctrl.spawnCalls.length > spawnsBefore, 500);
		expect(ctrl.spawnCalls.length).toBeGreaterThan(spawnsBefore);
		expect(mgr.getHandle(handle.id)).toBeDefined();

		// Drain pending status writes before teardown.
		await new Promise<void>((resolve) => setTimeout(resolve, 50));
	});
});

describe("AgentManager / IMPORTANT #7 — adapter version drift detection", () => {
	it("persists runtimeVersion at register time; logs warning on replay when adapter version differs", async () => {
		const ctrl = makeMockRuntime("mock-pty-drift");
		ctrl.runtime.version = "v1.0.0";
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const handle = await mgr.registerAgent({
			agentId: "drift-agent",
			runtimeId: "mock-pty-drift",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-drift",
		});

		// Read persisted file directly to confirm runtimeVersion is recorded.
		const configFile = path.join(pathFor("agents"), `${handle.id}.json`);
		const raw = await fsp.readFile(configFile, "utf8");
		const parsed = JSON.parse(raw);
		expect(parsed.runtimeVersion).toBe("v1.0.0");

		// Simulate adapter upgrade between boots.
		ctrl.runtime.version = "v2.0.0";

		// Simulate crash-replay: stamp a crash marker + HWM, then call
		// bootRecovery with knownConfigs.
		await mgr.shutdownAgent(handle.id, "SIGTERM");
		// Replace the graceful marker with a crash marker to drive
		// attemptCrashReplay.
		await writeStopMarker(handle.id, "crash");
		ctrl.setRestoreFromMarker(async () => ({
			id: handle.id,
			runtime: "mock-pty-drift",
			shape: "pty",
			agentId: "drift-agent",
			sessionId: "sess-drift",
			generationToken: 1,
			spawnedAt: Date.now(),
			markerPath: path.join(pathFor("markers"), `${handle.id}.daemon-stop`),
		}));

		mgr._resetBootRecoveryForTests();
		await mgr.bootRecovery({
			knownConfigs: new Map([
				[
					handle.id,
					{
						agentId: "drift-agent",
						runtimeId: "mock-pty-drift",
						cwd: "/tmp/w",
						env: {},
						sessionId: "sess-drift",
					},
				],
			]),
		});

		// Warning emitted via console.error (which the test spy already
		// captures). Look for the drift message.
		const errorCalls = (console.error as ReturnType<typeof vi.fn>).mock.calls;
		const driftMessage = errorCalls.find((args) =>
			String(args[0]).includes("adapter version drifted"),
		);
		expect(driftMessage).toBeDefined();
	});
});

describe("AgentManager / shutdownAgent + cascadeShutdownChildren — mutex hardening (IMPORTANT #4)", () => {
	it("parallel spawnSubagent + shutdownAgent on parent: shutdown waits for spawn to complete (no orphan child)", async () => {
		const ctrl = makeMockRuntime("mock-pty-mutex");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const parent = await mgr.registerAgent({
			agentId: "mutex-parent",
			runtimeId: "mock-pty-mutex",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-mp",
		});

		// Kick off spawn + shutdown concurrently. The parent mutex
		// serializes them — either spawn completes then shutdown
		// cascades the new child, OR shutdown wins first and
		// spawnSubagent throws ParentDiedDuringSpawn.
		const spawnPromise = mgr
			.spawnSubagent({
				parentHandleId: parent.id,
				agentId: "mutex-child",
				runtimeId: "mock-pty-mutex",
				sessionId: "sess-mc",
			})
			.catch((err) => err);
		const shutdownPromise = mgr.shutdownAgent(parent.id, "SIGTERM");

		const [spawnResult] = await Promise.all([spawnPromise, shutdownPromise]);

		// After both settle, no live handles remain for the parent.
		expect(mgr.getHandle(parent.id)).toBeUndefined();

		// If spawn succeeded, the child must have been cascaded down.
		if (spawnResult && typeof spawnResult === "object" && "id" in spawnResult) {
			const childId = (spawnResult as AgentHandle).id;
			expect(mgr.getHandle(childId)).toBeUndefined();
		}
	});
});

// ============================================================
// Plan 07b: polling-loop + claimTask tests (PL-1 through PL-6)
// ============================================================

function writePendingTask(filename: string, body: unknown): string {
	const p = path.join(pathFor("tasks/pending"), filename);
	const serialized = typeof body === "string" ? body : JSON.stringify(body);
	// Sync write so the test observes the file before driving the polling
	// tick. The polling loop's readdir+readFile are async — sync write keeps
	// the test sequence simple.
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	require("node:fs").writeFileSync(p, serialized, "utf8");
	return p;
}

function emittedEventsOfKind(kind: DaemonEvent["kind"]): DaemonEvent[] {
	const out: DaemonEvent[] = [];
	for (const call of emitMock.mock.calls) {
		const e = call[0] as DaemonEvent;
		if (e.kind === kind) out.push(e);
	}
	return out;
}

/**
 * Dual-adversarial C-2 reconcile helper: wires a `task-dispatch-needed`
 * listener that immediately drives `claimTask`. Mirrors how
 * `makeTaskDispatchHandler` (main.ts) bridges polling emit → claim in
 * production, minus runtime.send (PL tests do not exercise the runtime
 * path). The C-2 fix removed the listener-less fallback in
 * `processPendingTask`, so PL-1/4/5/8 must register a listener to keep
 * the claim path live. `flush()` awaits any in-flight claim promises so
 * assertions run AFTER the rename + telemetry land.
 */
function wireAutoClaim(mgr: AgentManager): { flush: () => Promise<void> } {
	const pending: Array<Promise<void>> = [];
	mgr.on(
		"task-dispatch-needed",
		(evt: { filename: string; agentId: string }) => {
			pending.push(
				mgr
					.claimTask(evt.filename, evt.agentId)
					.catch(() => {})
					.finally(() => {
						mgr.releaseDispatchSlot(evt.filename);
					}),
			);
		},
	);
	return {
		async flush(): Promise<void> {
			while (pending.length > 0) {
				await Promise.all(pending.splice(0));
			}
		},
	};
}

describe("AgentManager / polling-loop (Plan 07b)", () => {
	it("(PL-1) happy path: claims a registered agent's pending task and emits task-resolved", async () => {
		const ctrl = makeMockRuntime("mock-pty-pl1");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-pl1",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-pl1",
		});

		const filename = "pr-triage__1700000000.json";
		writePendingTask(filename, {
			prompt: "do the triage",
			agentId: "pr-triage",
			needsApproval: false,
		});

		const eventLog: Array<{ agentId: string; filename: string }> = [];
		mgr.on("task-resolved", (e: { agentId: string; filename: string }) => {
			eventLog.push(e);
		});
		const dispatch = wireAutoClaim(mgr);

		await mgr._pollingTickForTests();
		await dispatch.flush();

		// File moved from pending → resolved.
		await expect(
			fsp.access(path.join(pathFor("tasks/pending"), filename)),
		).rejects.toThrow();
		await fsp.access(path.join(pathFor("tasks/resolved"), filename));

		// EventEmitter event emitted exactly once with correct payload.
		expect(eventLog).toEqual([{ agentId: "pr-triage", filename }]);

		// Telemetry mirror emitted.
		const resolved = emittedEventsOfKind("task-resolved");
		expect(resolved).toHaveLength(1);
		expect(resolved[0]).toMatchObject({
			kind: "task-resolved",
			agentId: "pr-triage",
			filename,
		});
	});

	it("(PL-2) malformed JSON → moved to tasks/poisoned + task-poisoned telemetry", async () => {
		const ctrl = makeMockRuntime("mock-pty-pl2");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-pl2",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-pl2",
		});

		const filename = "pr-triage__1700000001.json";
		writePendingTask(filename, "{ not valid json");

		// pr84 consumer-tolerance: a JSON.parse failure is granted
		// JSON_PARSE_RETRY_BUDGET (=1) tick(s) of grace (transient mid-write
		// protection) and only poisoned on the FOLLOWING tick. Run budget+1
		// ticks so this persistently-malformed file lands in poisoned/.
		await mgr._pollingTickForTests();
		await mgr._pollingTickForTests();

		// Pending no longer has the file; poisoned has it.
		await expect(
			fsp.access(path.join(pathFor("tasks/pending"), filename)),
		).rejects.toThrow();
		await fsp.access(path.join(pathFor("tasks/poisoned"), filename));

		const poisoned = emittedEventsOfKind("task-poisoned");
		expect(poisoned).toHaveLength(1);
		expect(poisoned[0]).toMatchObject({
			kind: "task-poisoned",
			filename,
			reason: "json-parse-error",
		});
	});

	it("(PL-3) unrouted agent: file stays in pending, task-unrouted emitted once across multiple ticks", async () => {
		const mgr = new AgentManager();
		// No agents registered — all tasks are unrouted.

		const filename = "ghost__1700000002.json";
		writePendingTask(filename, {
			prompt: "nobody home",
			agentId: "ghost",
			needsApproval: false,
		});

		await mgr._pollingTickForTests();
		await mgr._pollingTickForTests();
		await mgr._pollingTickForTests();

		// File still in pending (no agent claimed it).
		await fsp.access(path.join(pathFor("tasks/pending"), filename));

		// task-unrouted telemetry fired exactly once for this filename
		// across all three ticks (suppression set).
		const unrouted = emittedEventsOfKind("task-unrouted");
		const forThisFile = unrouted.filter(
			(e) => "filename" in e && e.filename === filename,
		);
		expect(forThisFile).toHaveLength(1);
		expect(forThisFile[0]).toMatchObject({
			kind: "task-unrouted",
			filename,
			agentId: "ghost",
		});
	});

	it("(PL-4) task-resolved drives CronScheduler decrement: runningCount falls back to 0", async () => {
		const ctrl = makeMockRuntime("mock-pty-pl4");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-pl4",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-pl4",
		});

		// Prompt template the scheduler will read on fire.
		const promptPath = path.join(tempDir, "pr-triage-prompt.md");
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		require("node:fs").writeFileSync(
			promptPath,
			"do the daily pr-triage",
			"utf8",
		);

		// Fix the cron clock so `0 14 * * *` matches every _tickForTests().
		const fixedNow = new Date(Date.UTC(2026, 4, 18, 14, 0, 0));
		const scheduler = new CronScheduler({
			agentManager: mgr,
			nowFn: () => fixedNow,
		});
		scheduler.registerCron({
			agentId: "pr-triage",
			schedule: "0 14 * * *",
			promptTemplatePath: promptPath,
			outputTaskNamePrefix: "pr-triage",
			maxConcurrent: 1,
		});
		const dispatch = wireAutoClaim(mgr);

		// Fire 1: writes task file, runningCount → 1.
		await scheduler._tickForTests();
		expect(scheduler._runningCountForTests().get("pr-triage")).toBe(1);

		// Polling tick claims the cron-fired task, emits task-resolved →
		// CronScheduler decrement listener drops runningCount back to 0.
		await mgr._pollingTickForTests();
		await dispatch.flush();
		expect(scheduler._runningCountForTests().get("pr-triage") ?? 0).toBe(0);

		// Fire 2: same UTC minute as fire 1 — should NOT be overlap-prevented
		// because the decrement landed.
		await scheduler._tickForTests();
		const overlap = emittedEventsOfKind("cron-overlap-prevented");
		expect(overlap).toHaveLength(0);
		expect(scheduler._runningCountForTests().get("pr-triage")).toBe(1);

		await scheduler.stop();
	});

	it("(PL-5) .tmp mid-rename file is skipped; renamed to .json is picked up next tick", async () => {
		const ctrl = makeMockRuntime("mock-pty-pl5");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-pl5",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-pl5",
		});

		const tmpName = ".pr-triage__1700000005.abc.tmp";
		const tmpPath = path.join(pathFor("tasks/pending"), tmpName);
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		require("node:fs").writeFileSync(
			tmpPath,
			JSON.stringify({
				prompt: "mid rename",
				agentId: "pr-triage",
				needsApproval: false,
			}),
			"utf8",
		);
		const dispatch = wireAutoClaim(mgr);

		// Tick 1: tmp file present, no .json yet → polling loop ignores.
		await mgr._pollingTickForTests();
		await dispatch.flush();

		// Tmp file still there, untouched.
		await fsp.access(tmpPath);
		// No task-resolved fired.
		expect(emittedEventsOfKind("task-resolved")).toHaveLength(0);

		// Atomic rename .tmp → .json (simulates the cron tmp-rename completing).
		const finalName = "pr-triage__1700000005.json";
		const finalPath = path.join(pathFor("tasks/pending"), finalName);
		await fsp.rename(tmpPath, finalPath);

		// Tick 2: .json file present → claimed + task-resolved emitted.
		await mgr._pollingTickForTests();
		await dispatch.flush();
		await fsp.access(path.join(pathFor("tasks/resolved"), finalName));
		const resolved = emittedEventsOfKind("task-resolved");
		expect(resolved).toHaveLength(1);
		expect(resolved[0]).toMatchObject({
			kind: "task-resolved",
			agentId: "pr-triage",
			filename: finalName,
		});
	});

	it("(PL-7) cron fires → task poisoned → CronScheduler slot decrements back to 0", async () => {
		const ctrl = makeMockRuntime("mock-pty-pl7");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-pl7",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-pl7",
		});

		const promptPath = path.join(tempDir, "pr-triage-prompt-pl7.md");
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		require("node:fs").writeFileSync(
			promptPath,
			"do the daily pr-triage",
			"utf8",
		);

		const fixedNow = new Date(Date.UTC(2026, 4, 18, 15, 0, 0));
		const scheduler = new CronScheduler({
			agentManager: mgr,
			nowFn: () => fixedNow,
		});
		scheduler.registerCron({
			agentId: "pr-triage",
			schedule: "0 15 * * *",
			promptTemplatePath: promptPath,
			outputTaskNamePrefix: "pr-triage",
			maxConcurrent: 1,
		});

		// Fire 1: writes task file, runningCount → 1.
		await scheduler._tickForTests();
		expect(scheduler._runningCountForTests().get("pr-triage")).toBe(1);

		// Corrupt the cron-fired task file so the polling tick poisons it.
		const pendingDir = pathFor("tasks/pending");
		const [taskFile] = (await fsp.readdir(pendingDir)).filter((f) =>
			f.endsWith(".json"),
		);
		expect(taskFile).toBeDefined();
		await fsp.writeFile(
			path.join(pendingDir, taskFile),
			"{ corrupted json",
			"utf8",
		);

		// Polling tick: malformed JSON → poisonTask → emits task-poisoned with
		// derived agentId "pr-triage" → CronScheduler decrements runningCount.
		// pr84 consumer-tolerance: 1 tick of grace before poisoning, so run
		// budget+1 (=2) ticks for the persistently-corrupt file to be poisoned.
		await mgr._pollingTickForTests();
		await mgr._pollingTickForTests();
		expect(scheduler._runningCountForTests().get("pr-triage") ?? 0).toBe(0);

		// Confirm the task landed in poisoned/.
		await expect(
			fsp.access(path.join(pathFor("tasks/poisoned"), taskFile)),
		).resolves.toBeUndefined();

		await scheduler.stop();
	});

	it("(PL-6) unrouted files beyond cap → overflow event emitted exactly once", async () => {
		// Shrink the unroutedSet cap via the test-only setter so we can
		// exercise the overflow branch without writing 1001 task files
		// (1001 writeFileSync + 1001 readFile ops are prohibitively slow on
		// Windows). The behavior under test is the cap-vs-overflow logic,
		// not the cap's specific numeric value.
		emitMock.mockImplementation(() => Promise.resolve());

		const mgr = new AgentManager();
		mgr._setUnroutedSetCapForTests(5);
		// No agents registered → all 6 files are unrouted; the 6th trips
		// the overflow branch (size >= cap of 5 before the add).

		for (let i = 0; i < 6; i++) {
			const filename = `ghost__${String(2000000000 + i).padStart(13, "0")}.json`;
			writePendingTask(filename, {
				prompt: `unrouted ${i}`,
				agentId: "ghost",
				needsApproval: false,
			});
		}

		await mgr._pollingTickForTests();

		const overflow = emittedEventsOfKind("task-unrouted-set-overflow");
		expect(overflow).toHaveLength(1);
		expect(overflow[0]).toMatchObject({
			kind: "task-unrouted-set-overflow",
			cap: 5,
		});
		// All 6 files emit task-unrouted on first appearance (first 5 via
		// suppression-set add, the 6th via the overflow branch).
		const unrouted = emittedEventsOfKind("task-unrouted");
		expect(unrouted).toHaveLength(6);
	});

	it("(PL-8) claimTask: fs.rename failure emits claim-task-failed telemetry, no task-resolved event, file stays in pending", async () => {
		const ctrl = makeMockRuntime("mock-pty-pl8");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-pl8",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-pl8",
		});

		const filename = "pr-triage__1700000000.json";
		writePendingTask(filename, {
			prompt: "do the triage",
			agentId: "pr-triage",
			needsApproval: false,
		});

		// pr84: persistAgentConfig now publishes the agent config via an atomic
		// temp-file rename during registerAgent (above), which calls renameMock
		// once. Clear that setup call so the count assertion below reflects ONLY
		// the claimTask rename under test.
		renameMock.mockClear();

		// Force the next fsp.rename to throw EACCES. The polling tick for a
		// valid+routed task hits exactly one rename (claimTask), so the
		// once-rejection fires precisely at the claim attempt; subsequent
		// renames (and the afterEach cleanup) fall back to the pass-through
		// implementation installed in beforeEach.
		const renameErr = Object.assign(
			new Error("EACCES: permission denied, rename"),
			{ code: "EACCES" },
		);
		renameMock.mockRejectedValueOnce(renameErr);

		const resolvedEvents: Array<{ agentId: string; filename: string }> = [];
		mgr.on("task-resolved", (e: { agentId: string; filename: string }) => {
			resolvedEvents.push(e);
		});
		const dispatch = wireAutoClaim(mgr);

		await mgr._pollingTickForTests();
		await dispatch.flush();

		// claimTask attempted exactly one rename.
		expect(renameMock).toHaveBeenCalledTimes(1);

		// claim-task-failed telemetry emitted ONCE with filename + agentId
		// and the underlying rename error surfaced via `message` + `errno`
		// so operators can trace back to the fs failure.
		const failures = emittedEventsOfKind("claim-task-failed");
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			kind: "claim-task-failed",
			agentId: "pr-triage",
			filename,
			errno: "EACCES",
		});
		expect((failures[0] as { message: string }).message).toContain("EACCES");

		// task-resolved EventEmitter event NEVER fires when rename fails —
		// CronScheduler's slot stays held until a retry succeeds.
		expect(resolvedEvents).toHaveLength(0);
		// And no task-resolved telemetry mirror either.
		expect(emittedEventsOfKind("task-resolved")).toHaveLength(0);

		// File still exists in tasks/pending/ (not moved to resolved).
		await fsp.access(path.join(pathFor("tasks/pending"), filename));
		await expect(
			fsp.access(path.join(pathFor("tasks/resolved"), filename)),
		).rejects.toThrow();
	});
});

// ============================================================
// pr84 IMPORTANT — persistAgentConfig at-rest secret race on OVERWRITE
// ============================================================

describe("AgentManager / persistAgentConfig overwrite-mode (pr84 Codex at-rest)", () => {
	it.skipIf(process.platform === "win32")(
		"persists <handleId>.json at mode 0600 even when the dest PRE-EXISTS at 0644",
		async () => {
			// `fsp.writeFile`'s `mode` option is honored ONLY on file CREATION.
			// On OVERWRITE (e.g. a re-registration reusing the same handleId →
			// same filename) the prior — possibly looser — mode would persist
			// unless the write path forces 0600. The fix writes a FRESH 0600 temp
			// file then atomic-renames over the dest, so the published file is
			// always 0600 regardless of any prior mode. This test fails pre-fix
			// (the dest kept its 0644 mode through the overwrite window) and
			// passes after. POSIX-only — NTFS ignores POSIX mode bits.
			//
			// A custom mock runtime returns a FIXED handle id so the second
			// registerAgent OVERWRITES the first's persisted `<handleId>.json`
			// (same agentId + same org re-registration is permitted; see the
			// CRITICAL #1 "same org" test above).
			const fixedHandleId = "overwrite-fixed-h";
			const ctrl = makeMockRuntime("mock-pty-overwrite");
			ctrl.runtime.spawn = async (opts: SpawnOpts): Promise<AgentHandle> => {
				ctrl.spawnCalls.push(opts);
				return {
					id: fixedHandleId,
					runtime: "mock-pty-overwrite",
					shape: "pty",
					agentId: opts.agentId,
					sessionId: opts.sessionId,
					generationToken: 0,
					org: opts.org,
					parentHandleId: opts.parentHandle?.id,
					spawnedAt: Date.now(),
					markerPath: path.join(pathFor("markers"), `${fixedHandleId}.daemon-stop`),
				};
			};
			registerRuntime(ctrl.runtime);
			const mgr = new AgentManager();

			const persistedFile = path.join(pathFor("agents"), `${fixedHandleId}.json`);

			// First registration creates the persisted config at 0600.
			await mgr.registerAgent({
				agentId: "overwrite-agent",
				runtimeId: "mock-pty-overwrite",
				org: "org-1",
				cwd: "/tmp/w",
				env: { IAGO_TELEGRAM_BOT_TOKEN: "secret-token" },
				sessionId: "sess-ow-1",
			});
			expect((await fsp.stat(persistedFile)).mode & 0o777).toBe(0o600);

			// Simulate an older build / a leak: loosen the dest to 0644 so the
			// OVERWRITE path is exercised on the next registerAgent.
			await fsp.chmod(persistedFile, 0o644);
			expect((await fsp.stat(persistedFile)).mode & 0o777).toBe(0o644);

			// Re-register (same agentId + same org) → persistAgentConfig OVERWRITES
			// the pre-existing 0644 file. The fix re-tightens it to 0600.
			await mgr.registerAgent({
				agentId: "overwrite-agent",
				runtimeId: "mock-pty-overwrite",
				org: "org-1",
				cwd: "/tmp/w",
				env: { IAGO_TELEGRAM_BOT_TOKEN: "secret-token" },
				sessionId: "sess-ow-2",
			});

			expect((await fsp.stat(persistedFile)).mode & 0o777).toBe(0o600);
			// No stray temp file left behind by the atomic-rename publish.
			await expect(fsp.stat(`${persistedFile}.tmp`)).rejects.toThrow();
		},
	);

	it("on a persist write/rename failure: cleans up the secret-bearing .tmp AND rejects fail-closed (pr84 Finding 3 + Task 1)", async () => {
		// Finding 3 (pr84 dual-adversarial) + Task 1 (Critical, 2026-06-02): the
		// persist path writes a fresh 0o600 temp file then atomic-renames it over
		// the dest. If the write/chmod/rename throws (ENOSPC/EACCES/ENOTDIR), the
		// catch MUST (a) best-effort unlink the stray secret-bearing `.tmp` so a
		// Telegram token + GH PAT are not left on disk, and — UPDATED for Task 1 —
		// (b) RETHROW so `registerAgent` rolls the spawn back and REJECTS
		// fail-closed (was: swallow + resolve, which leaked an unrecoverable
		// tracked handle). Platform-agnostic: asserts cleanup + rejection +
		// no-handle-leak, not POSIX mode bits.
		const fixedHandleId = "persist-fail-fixed-h";
		const ctrl = makeMockRuntime("mock-pty-persist-fail");
		ctrl.runtime.spawn = async (opts: SpawnOpts): Promise<AgentHandle> => {
			ctrl.spawnCalls.push(opts);
			return {
				id: fixedHandleId,
				runtime: "mock-pty-persist-fail",
				shape: "pty",
				agentId: opts.agentId,
				sessionId: opts.sessionId,
				generationToken: 0,
				org: opts.org,
				parentHandleId: opts.parentHandle?.id,
				spawnedAt: Date.now(),
				markerPath: path.join(pathFor("markers"), `${fixedHandleId}.daemon-stop`),
			};
		};
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();

		const persistedFile = path.join(pathFor("agents"), `${fixedHandleId}.json`);
		const tmpFile = `${persistedFile}.tmp`;

		// Force ONLY the persist rename (`<tmp>` -> `<handleId>.json`) to fail,
		// passing every OTHER rename through to the real fs so the rest of
		// registration is unaffected (deterministic regardless of call order).
		renameMock.mockImplementation((source, dest) => {
			if (String(dest).endsWith(`${fixedHandleId}.json`)) {
				return Promise.reject(
					Object.assign(new Error("ENOSPC: no space left on device, rename"), {
						code: "ENOSPC",
					}),
				);
			}
			if (renameState.real === null) {
				throw new Error("renameState.real not initialized by vi.mock factory");
			}
			return renameState.real(source, dest);
		});

		// (b) registerAgent REJECTS fail-closed on the persist failure (Task 1).
		await expect(
			mgr.registerAgent({
				agentId: "persist-fail-agent",
				runtimeId: "mock-pty-persist-fail",
				org: "org-1",
				cwd: "/tmp/w",
				env: { IAGO_TELEGRAM_BOT_TOKEN: "secret-token", GH_TOKEN: "gh-pat" },
				sessionId: "sess-persist-fail",
			}),
		).rejects.toThrow(/ENOSPC/);

		// (a) The stray secret-bearing `.tmp` was cleaned up by the catch's unlink.
		await expect(fsp.stat(tmpFile)).rejects.toThrow();
		// The dest config was never published (the rename failed before publish).
		await expect(fsp.stat(persistedFile)).rejects.toThrow();
		// (c) Task 1: the spawned handle was rolled back — no in-memory leak.
		expect(mgr.listHandles()).toHaveLength(0);
		expect(mgr.getHandle(fixedHandleId)).toBeUndefined();
	});
});

describe("AgentManager / restartAgent reuse-id + env re-compose (pr84 R2)", () => {
	it("reuses the stable handle id, tears down the dead handle, and overwrites the config with the re-composed env", async () => {
		// pr84 R2 + twin: on a cron crash-restart the daemon must reuse the
		// STABLE handle id (teardown the dead handle, re-spawn via restoreId) so
		// exactly ONE handle remains and `findHandleForAgent` resolves the LIVE
		// one — a plain re-register would ADD a second handle and route every
		// dispatch to the DEAD one. Reusing the id also OVERWRITES the same
		// `<handleId>.json`, so secret-bearing orphan configs do not accumulate
		// and a rotated cred replaces the stale one on disk.
		const ctrl = makeMockRuntime("mock-pty-r2");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		const h1 = await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-r2",
			org: "internal",
			cwd: "/tmp/w",
			env: { GH_TOKEN: "old-pat" },
			sessionId: "sess-r2",
		});
		const agentsDir = pathFor("agents");
		const jsonAfterRegister = (await fsp.readdir(agentsDir)).filter((f) =>
			f.endsWith(".json"),
		);
		expect(jsonAfterRegister).toHaveLength(1);

		// Restart with a RE-COMPOSED env (simulates the cron loop re-running
		// composeCronAgentEnv against rotated daemon creds).
		const h2 = await mgr.restartAgent(h1.id, "crash", {
			envOverride: { GH_TOKEN: "new-pat" },
		});

		// (1) Same stable id — restoreId reuse, not a fresh id.
		expect(h2.id).toBe(h1.id);
		// (2) Exactly ONE handle for the agent — the dead handle was torn down,
		// not left to coexist (the R2 routing defect).
		const live = mgr.listHandles().filter((h) => h.agentId === "pr-triage");
		expect(live).toHaveLength(1);
		expect(live[0]?.id).toBe(h1.id);
		expect(mgr.getHandle(h1.id)).toBeDefined();
		// (3) No orphan config accumulation — still ONE file (overwritten), now
		// carrying the ROTATED cred (boot-recovery rebuilds from current creds).
		const jsonAfterRestart = (await fsp.readdir(agentsDir)).filter((f) =>
			f.endsWith(".json"),
		);
		expect(jsonAfterRestart).toHaveLength(1);
		const persisted = JSON.parse(
			await fsp.readFile(
				path.join(agentsDir, jsonAfterRestart[0] as string),
				"utf8",
			),
		) as { env?: Record<string, string> };
		expect(persisted.env?.GH_TOKEN).toBe("new-pat");
	});
});

// ============================================================
// Plan 04d: task-dispatch-needed event tests (DN-1 through DN-5)
// ============================================================

describe("AgentManager / task-dispatch-needed event (Plan 04d)", () => {
	it("(DN-1) emits 'task-dispatch-needed' when listeners subscribed; does NOT auto-claim", async () => {
		const ctrl = makeMockRuntime("mock-pty-dn1");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-dn1",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-dn1",
		});

		const filename = "pr-triage__1700000100.json";
		writePendingTask(filename, {
			prompt: "do the triage",
			agentId: "pr-triage",
			needsApproval: false,
		});

		const dispatchEvents: Array<{
			filename: string;
			agentId: string;
			taskContent: Record<string, unknown>;
		}> = [];
		mgr.on(
			"task-dispatch-needed",
			(e: {
				filename: string;
				agentId: string;
				taskContent: Record<string, unknown>;
			}) => {
				dispatchEvents.push(e);
			},
		);

		await mgr._pollingTickForTests();

		// Dispatch event fired exactly once for the file.
		expect(dispatchEvents).toHaveLength(1);
		expect(dispatchEvents[0]).toMatchObject({
			filename,
			agentId: "pr-triage",
		});

		// File NOT moved to resolved (listener owns claim timing).
		await fsp.access(path.join(pathFor("tasks/pending"), filename));
		await expect(
			fsp.access(path.join(pathFor("tasks/resolved"), filename)),
		).rejects.toThrow();

		// No task-resolved telemetry either — claim has not happened.
		expect(emittedEventsOfKind("task-resolved")).toHaveLength(0);
	});

	it("(DN-2/C-2) no listener subscribed: file stays in pending, emits pr-triage-dispatch-failed { reason: 'no-listener' }, claimTask NOT called", async () => {
		// Dual-adversarial C-2 regression: the listener-less fallback was a
		// silent data-loss path during shutdown (between removeAllListeners
		// and stopPollingLoop, in-flight ticks would claimTask without ever
		// sending the prompt to a runtime). The fallback is removed; tasks
		// MUST stay in pending/ and emit `no-listener` telemetry so the next
		// boot retries them.
		const ctrl = makeMockRuntime("mock-pty-dn2");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-dn2",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-dn2",
		});

		const filename = "pr-triage__1700000101.json";
		writePendingTask(filename, {
			prompt: "do the triage",
			agentId: "pr-triage",
			needsApproval: false,
		});

		const claimSpy = vi.spyOn(mgr, "claimTask");

		// No 'task-dispatch-needed' listener subscribed.
		await mgr._pollingTickForTests();

		// File stays in pending/, NOT moved to resolved/.
		await fsp.access(path.join(pathFor("tasks/pending"), filename));
		await expect(
			fsp.access(path.join(pathFor("tasks/resolved"), filename)),
		).rejects.toThrow();

		// claimTask never invoked — no silent decrement.
		expect(claimSpy).not.toHaveBeenCalled();

		// No task-resolved telemetry.
		expect(emittedEventsOfKind("task-resolved")).toHaveLength(0);

		// `pr-triage-dispatch-failed { reason: "no-listener" }` emitted so
		// operators can detect listener-less drift.
		const failed = emittedEventsOfKind("pr-triage-dispatch-failed");
		expect(failed).toHaveLength(1);
		expect(failed[0]).toMatchObject({
			kind: "pr-triage-dispatch-failed",
			filename,
			reason: "no-listener",
		});
	});

	it("(DN-2b/C-1) per-filename dispatchInFlight guard: two rapid ticks for same file emit dispatch ONCE", async () => {
		// Dual-adversarial C-1 regression: processPendingTask emits
		// 'task-dispatch-needed' synchronously and returns before the handler
		// awaits runtime.send. A polling tick that fires before the handler
		// resolves would re-emit the same filename. The per-filename
		// dispatchInFlight guard suppresses the second emit until the handler
		// calls releaseDispatchSlot from its finally block.
		const ctrl = makeMockRuntime("mock-pty-dn2b");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-dn2b",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-dn2b",
		});

		const filename = "pr-triage__1700000110.json";
		writePendingTask(filename, {
			prompt: "do the triage",
			agentId: "pr-triage",
			needsApproval: false,
		});

		const dispatchEvents: unknown[] = [];
		// Slow listener: holds the dispatch slot for 100ms. Without the
		// guard, the second tick would emit again before this resolves.
		mgr.on("task-dispatch-needed", async () => {
			dispatchEvents.push({ at: Date.now() });
			await new Promise<void>((r) => setTimeout(r, 100));
		});

		await mgr._pollingTickForTests();
		// Second tick fires immediately while the listener is still awaiting.
		await mgr._pollingTickForTests();

		expect(dispatchEvents).toHaveLength(1);

		// File still in pending (listener owns claim; nobody called claimTask).
		await fsp.access(path.join(pathFor("tasks/pending"), filename));
	});

	it("(DN-2c/C-1) releaseDispatchSlot allows a subsequent tick to re-emit after handler completes", async () => {
		// Companion to DN-2b: once the handler signals it has finished by
		// calling releaseDispatchSlot, a later tick must be free to emit for
		// the same filename (e.g., a retry scenario where the file was not
		// claimed because the runtime was unregistered). Asserts the guard
		// does not leak across handler completions.
		const ctrl = makeMockRuntime("mock-pty-dn2c");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-dn2c",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-dn2c",
		});

		const filename = "pr-triage__1700000111.json";
		writePendingTask(filename, {
			prompt: "do the triage",
			agentId: "pr-triage",
			needsApproval: false,
		});

		const dispatchEvents: unknown[] = [];
		mgr.on("task-dispatch-needed", (e: { filename: string }) => {
			dispatchEvents.push(e);
		});

		await mgr._pollingTickForTests();
		expect(dispatchEvents).toHaveLength(1);

		// Handler signals completion → next tick is allowed to re-emit.
		mgr.releaseDispatchSlot(filename);
		await mgr._pollingTickForTests();
		expect(dispatchEvents).toHaveLength(2);
	});

	it("(DN-3) payload includes parsed taskContent with prompt + agentId", async () => {
		const ctrl = makeMockRuntime("mock-pty-dn3");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-dn3",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-dn3",
		});

		const filename = "pr-triage__1700000102.json";
		const body = {
			prompt: "review PR #42",
			agentId: "pr-triage",
			needsApproval: false,
			extraField: "carry-through",
		};
		writePendingTask(filename, body);

		const captured: Array<Record<string, unknown>> = [];
		mgr.on(
			"task-dispatch-needed",
			(e: { taskContent: Record<string, unknown> }) => {
				captured.push(e.taskContent);
			},
		);

		await mgr._pollingTickForTests();

		expect(captured).toHaveLength(1);
		expect(captured[0]).toEqual(body);
	});

	it("(DN-4/I-A) listener exception: claimTask spied + NEVER called, polling-loop-error telemetry emitted, file stays pending", async () => {
		// Dual-adversarial I-A hardening: prior DN-4 only checked filesystem
		// state. A direct spy on mgr.claimTask is the strongest assertion
		// that the C1 invariant ("listener crashes must not silently advance
		// the file to resolved") holds — even if a future refactor changes
		// the post-failure move target. Also asserts the wrapper surfaces
		// the crash as polling-loop-error telemetry (no .catch swallow on
		// the tick itself; runPollingTickGuarded owns the try/catch).
		const ctrl = makeMockRuntime("mock-pty-dn4");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-dn4",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-dn4",
		});

		const filename = "pr-triage__1700000103.json";
		writePendingTask(filename, {
			prompt: "do the triage",
			agentId: "pr-triage",
			needsApproval: false,
		});

		const claimSpy = vi.spyOn(mgr, "claimTask");

		mgr.on("task-dispatch-needed", () => {
			throw new Error("simulated listener crash");
		});

		// runPollingTickGuarded swallows the listener crash and surfaces it
		// as polling-loop-error telemetry; the tick itself MUST resolve
		// (no .catch wrapper needed).
		await mgr._pollingTickForTests();

		// I-A: direct spy assertion — claimTask never invoked.
		expect(claimSpy).not.toHaveBeenCalled();

		// File NOT moved to resolved — listener crash does not cause an
		// accidental decrement.
		await fsp.access(path.join(pathFor("tasks/pending"), filename));
		await expect(
			fsp.access(path.join(pathFor("tasks/resolved"), filename)),
		).rejects.toThrow();

		// task-resolved NEVER fired.
		expect(emittedEventsOfKind("task-resolved")).toHaveLength(0);

		// I-A: polling-loop-error telemetry emitted with the listener crash.
		const errors = emittedEventsOfKind("polling-loop-error");
		expect(errors.length).toBeGreaterThanOrEqual(1);
	});

	it("(DN-5/I-B) oversized task payload: stat-rejected BEFORE readFile allocation; poisoned with oversized-task", async () => {
		// Dual-adversarial I-B regression: prior implementation called
		// fsp.readFile(src, "utf8") and THEN checked Buffer.byteLength,
		// allocating the full string per polling tick. The fix routes
		// through fsp.stat first; oversized files never reach readFile.
		// Spy on readFile to assert it was NEVER called for the oversized
		// path — the strongest evidence the heap allocation was skipped.
		const ctrl = makeMockRuntime("mock-pty-dn5");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-dn5",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-dn5",
		});

		const filename = "pr-triage__1700000104.json";
		// Write a payload that exceeds the cap with valid JSON structure
		// (the size check must run BEFORE JSON.parse so the file is
		// poisoned before AgentManager spends CPU parsing 1MB+ of input).
		const pad = "x".repeat(TASK_PAYLOAD_MAX_BYTES + 1024);
		writePendingTask(filename, {
			prompt: "huge",
			agentId: "pr-triage",
			needsApproval: false,
			pad,
		});

		const dispatchEvents: unknown[] = [];
		mgr.on("task-dispatch-needed", (e: unknown) => {
			dispatchEvents.push(e);
		});

		// Reset readFileMock call count so we only count calls during the
		// polling tick (registerAgent + setup may invoke readFile elsewhere).
		const callsBeforeTick = readFileMock.mock.calls.length;

		await mgr._pollingTickForTests();

		// I-B: readFile MUST NOT have been called for the oversized src
		// path. Filter by source path to ignore unrelated readFile calls
		// (state-paths bootstrap, session-log reads, etc.).
		const srcAbs = path.join(pathFor("tasks/pending"), filename);
		const readsOfSrc = readFileMock.mock.calls
			.slice(callsBeforeTick)
			.filter((call) => call[0] === srcAbs);
		expect(readsOfSrc).toHaveLength(0);

		// File moved to poisoned/, not emitted to dispatch listeners.
		await fsp.access(path.join(pathFor("tasks/poisoned"), filename));
		expect(dispatchEvents).toHaveLength(0);

		const poisoned = emittedEventsOfKind("task-poisoned");
		expect(poisoned).toHaveLength(1);
		expect(poisoned[0]).toMatchObject({
			kind: "task-poisoned",
			filename,
			reason: "oversized-task",
		});
	});

	it("(DN-6/M-A) agentId exceeding 255 chars is poisoned as missing-agent-id; no dispatch emit, no isAgentRegistered lookup with crafted id", async () => {
		// Dual-adversarial M-A regression: an adversarial task file with a
		// 10KB agentId would have flowed through isAgentRegistered (bounded
		// by Map size, fine) but ended up in telemetry strings, filenames,
		// and log lines (unbounded). The cap fires BEFORE any of those
		// touch the value.
		const ctrl = makeMockRuntime("mock-pty-dn6");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-dn6",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-dn6",
		});

		const filename = "pr-triage__1700000105.json";
		const oversizedAgentId = "x".repeat(256);
		writePendingTask(filename, {
			prompt: "do the triage",
			agentId: oversizedAgentId,
			needsApproval: false,
		});

		const dispatchEvents: unknown[] = [];
		mgr.on("task-dispatch-needed", (e: unknown) => {
			dispatchEvents.push(e);
		});

		await mgr._pollingTickForTests();

		// File moved to poisoned/, NOT to resolved/, NOT in pending/.
		await fsp.access(path.join(pathFor("tasks/poisoned"), filename));
		await expect(
			fsp.access(path.join(pathFor("tasks/pending"), filename)),
		).rejects.toThrow();
		expect(dispatchEvents).toHaveLength(0);

		const poisoned = emittedEventsOfKind("task-poisoned");
		expect(poisoned).toHaveLength(1);
		expect(poisoned[0]).toMatchObject({
			kind: "task-poisoned",
			filename,
			reason: "missing-agent-id",
		});
	});
});

// ============================================================
// R1 (feature-pr84-r1-daemon-creds): task-send-needed envelope routing
// ============================================================

describe("AgentManager / task-send-needed envelope (R1)", () => {
	it("(SE-1) a pr-triage-send__ envelope with sendText routes to 'task-send-needed', NOT dispatch, NOT poisoned", async () => {
		const ctrl = makeMockRuntime("mock-pty-se1");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-se1",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-se1",
		});

		const filename = "pr-triage-send__1700000200-123.json";
		writePendingTask(filename, {
			agentId: "pr-triage",
			sendText: "PR Triage summary\n\n3 open PRs",
		});

		const sendEvents: Array<{
			filename: string;
			agentId: string;
			sendText?: string;
		}> = [];
		const dispatchEvents: unknown[] = [];
		mgr.on(
			"task-send-needed",
			(e: { filename: string; agentId: string; sendText?: string }) => {
				sendEvents.push(e);
			},
		);
		mgr.on("task-dispatch-needed", (e: unknown) => {
			dispatchEvents.push(e);
		});

		await mgr._pollingTickForTests();

		expect(sendEvents).toHaveLength(1);
		expect(sendEvents[0]).toMatchObject({
			filename,
			agentId: "pr-triage",
			sendText: "PR Triage summary\n\n3 open PRs",
		});
		// Never routes into the dispatch path (would be `malformed-task`).
		expect(dispatchEvents).toHaveLength(0);
		// processPendingTask does NOT claim — the daemon send handler owns that.
		await fsp.access(path.join(pathFor("tasks/pending"), filename));
		await expect(
			fsp.access(path.join(pathFor("tasks/poisoned"), filename)),
		).rejects.toThrow();
		expect(emittedEventsOfKind("pr-triage-dispatch-failed")).toHaveLength(0);
	});

	it("(SE-2) a pr-triage-send__ envelope with noSend routes to 'task-send-needed' with noSend:true", async () => {
		const ctrl = makeMockRuntime("mock-pty-se2");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-se2",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-se2",
		});

		const filename = "pr-triage-send__1700000201-456.json";
		writePendingTask(filename, { agentId: "pr-triage", noSend: true });

		const sendEvents: Array<{ noSend?: boolean; sendText?: string }> = [];
		mgr.on("task-send-needed", (e: { noSend?: boolean; sendText?: string }) => {
			sendEvents.push(e);
		});

		await mgr._pollingTickForTests();

		expect(sendEvents).toHaveLength(1);
		expect(sendEvents[0].noSend).toBe(true);
		expect(sendEvents[0].sendText).toBeUndefined();
	});

	it("(SE-5 dedup, Critical-1) two ticks while the send is in-flight emit 'task-send-needed' only ONCE; releaseSendSlot re-arms it", async () => {
		const ctrl = makeMockRuntime("mock-pty-se5");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-se5",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-se5",
		});

		const filename = "pr-triage-send__1700000205-555.json";
		writePendingTask(filename, { agentId: "pr-triage", sendText: "summary" });

		const sendEvents: unknown[] = [];
		mgr.on("task-send-needed", (e: unknown) => sendEvents.push(e));

		// The daemon send handler (which awaits the Telegram round-trip THEN claims)
		// is NOT wired here, so the envelope stays in pending/ across ticks — exactly
		// the slow-send window. Critical-1: the `sendInFlight` guard must suppress the
		// duplicate emit so the daemon never fires a SECOND Telegram send for the
		// same summary while the first is still in flight.
		await mgr._pollingTickForTests();
		await mgr._pollingTickForTests();
		expect(sendEvents).toHaveLength(1);

		// Once the send handler resolves (success OR failure) it releases the slot
		// in its `finally`; a later tick may then legitimately re-emit (a failed send
		// left in pending/ re-trips). Proves the guard is released, not leaked.
		mgr.releaseSendSlot(filename);
		await mgr._pollingTickForTests();
		expect(sendEvents).toHaveLength(2);
	});

	it("(SE-3 provenance) a foreign rogue-agent__ file with a sendText body does NOT match the send branch", async () => {
		const ctrl = makeMockRuntime("mock-pty-se3");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		// Register the rogue agent so the file does not just go unrouted —
		// we want to prove it falls through to the DISPATCH path, not send.
		await mgr.registerAgent({
			agentId: "rogue-agent",
			runtimeId: "mock-pty-se3",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-se3",
		});

		const filename = "rogue-agent__1700000202-789.json";
		writePendingTask(filename, {
			agentId: "rogue-agent",
			sendText: "attacker-controlled summary",
		});

		const sendEvents: unknown[] = [];
		const dispatchEvents: unknown[] = [];
		mgr.on("task-send-needed", (e: unknown) => sendEvents.push(e));
		mgr.on("task-dispatch-needed", (e: unknown) => dispatchEvents.push(e));

		await mgr._pollingTickForTests();

		// The provenance guard (filename prefix + agentId === "pr-triage")
		// prevents a foreign producer from triggering a daemon send.
		expect(sendEvents).toHaveLength(0);
		// It falls through to the normal dispatch path instead.
		expect(dispatchEvents).toHaveLength(1);
	});

	it("(SE-4 provenance) a pr-triage-send__ file with a non-empty prompt does NOT match the send branch (falls through to dispatch)", async () => {
		const ctrl = makeMockRuntime("mock-pty-se4");
		registerRuntime(ctrl.runtime);
		const mgr = new AgentManager();
		await mgr.registerAgent({
			agentId: "pr-triage",
			runtimeId: "mock-pty-se4",
			cwd: "/tmp/w",
			env: {},
			sessionId: "sess-se4",
		});

		const filename = "pr-triage-send__1700000203-111.json";
		writePendingTask(filename, {
			agentId: "pr-triage",
			sendText: "summary",
			prompt: "but also a prompt",
		});

		const sendEvents: unknown[] = [];
		const dispatchEvents: unknown[] = [];
		mgr.on("task-send-needed", (e: unknown) => sendEvents.push(e));
		mgr.on("task-dispatch-needed", (e: unknown) => dispatchEvents.push(e));

		await mgr._pollingTickForTests();

		// A combined prompt+sendText shape is NOT a clean send envelope — the
		// `!sendHasPrompt` guard routes it to dispatch.
		expect(sendEvents).toHaveLength(0);
		expect(dispatchEvents).toHaveLength(1);
	});
});
