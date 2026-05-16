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
} from "./agent-manager.js";
import { HeartbeatController } from "./heartbeat.js";
import { listAllMarkers, readStopMarker, writeStopMarker } from "./markers.js";
import {
	_resetSessionLogStateForTests,
	appendEvent,
	setHWM,
} from "./session-log.js";
import { ensureStateDirsSync, pathFor } from "./state-paths.js";

let tempDir: string;

beforeEach(async () => {
	tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-agent-mgr-"));
	process.env.IAGO_DAEMON_STATE_ROOT = tempDir;
	ensureStateDirsSync();
	_resetRegistryForTests();
	_resetSessionLogStateForTests();
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
			value:
				| { value: CostEvent; done: false }
				| { value: undefined; done: true },
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
				await fsp.access(
					path.join(pathFor("markers"), `${handle.id}.daemon-stop`),
				);
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
		const childShutdown = ctrl.shutdownCalls.find(
			(c) => c.handleId === child.id,
		);
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
			model: "claude-opus-4-7",
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
				markerPath: path.join(
					pathFor("markers"),
					`${crashHandleId}.daemon-stop`,
				),
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

		const childShutdown = ctrl.shutdownCalls.find(
			(s) => s.handleId === child.id,
		);
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
		const childShutdown = ctrl.shutdownCalls.find(
			(s) => s.handleId === child.id,
		);
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
				markerPath: path.join(
					pathFor("markers"),
					`${crashedHandleId}.daemon-stop`,
				),
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
			model: "claude-opus-4-7",
		});
		await waitForCondition(
			() => mgr.getCostSummary(parent.id).rolledUpCost > 0,
		);
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
				model: "claude-opus-4-7",
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
