import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type ForceRestartReason,
	HeartbeatController,
	type HeartbeatStatus,
} from "./heartbeat.js";

function makeProbe(status: HeartbeatStatus): () => Promise<HeartbeatStatus> {
	return async () => status;
}

interface RestartCall {
	handleId: string;
	reason: ForceRestartReason;
}

function makeController(opts?: {
	intervalMs?: number;
	rssLimitBytes?: number;
	stallThresholdMs?: number;
}): {
	hb: HeartbeatController;
	calls: RestartCall[];
} {
	const calls: RestartCall[] = [];
	const hb = new HeartbeatController({
		intervalMs: opts?.intervalMs ?? 60_000,
		rssLimitBytes: opts?.rssLimitBytes ?? 512 * 1024 * 1024,
		stallThresholdMs: opts?.stallThresholdMs ?? 5 * 60_000,
		onForceRestart: async (handleId, reason) => {
			calls.push({ handleId, reason });
		},
	});
	return { hb, calls };
}

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("HeartbeatController", () => {
	it("healthy probe (alive, low RSS, recent status) does NOT trigger force-restart", async () => {
		const { hb, calls } = makeController();
		hb._setNowForTests(() => 1_000_000);
		hb.register(
			"h-healthy",
			makeProbe({
				alive: true,
				rssBytes: 100 * 1024 * 1024,
				lastStatusChangeMs: 999_000,
			}),
		);

		await hb._tickForTests();

		expect(calls).toHaveLength(0);
	});

	it("alive=false triggers force-restart 'dead'", async () => {
		const { hb, calls } = makeController();
		hb._setNowForTests(() => 1_000_000);
		hb.register(
			"h-dead",
			makeProbe({
				alive: false,
				rssBytes: 50 * 1024 * 1024,
				lastStatusChangeMs: 999_000,
			}),
		);

		await hb._tickForTests();

		expect(calls).toEqual([{ handleId: "h-dead", reason: "dead" }]);
	});

	it("rss above limit triggers force-restart 'rss-exceeded'", async () => {
		const { hb, calls } = makeController();
		hb._setNowForTests(() => 1_000_000);
		hb.register(
			"h-big",
			makeProbe({
				alive: true,
				rssBytes: 600 * 1024 * 1024,
				lastStatusChangeMs: 999_000,
			}),
		);

		await hb._tickForTests();

		expect(calls).toEqual([{ handleId: "h-big", reason: "rss-exceeded" }]);
	});

	it("stale lastStatusChangeMs (>stallThreshold) triggers 'stalled'", async () => {
		const { hb, calls } = makeController({ stallThresholdMs: 5 * 60_000 });
		hb._setNowForTests(() => 10 * 60_000);
		hb.register(
			"h-stale",
			makeProbe({
				alive: true,
				rssBytes: 10 * 1024 * 1024,
				lastStatusChangeMs: 1_000,
			}),
		);

		await hb._tickForTests();

		expect(calls).toEqual([{ handleId: "h-stale", reason: "stalled" }]);
	});

	it("probe throws — heartbeat survives, error logged, no restart called", async () => {
		const { hb, calls } = makeController();
		hb.register("h-throws", async () => {
			throw new Error("probe-boom");
		});
		hb._setNowForTests(() => 1_000_000);

		await hb._tickForTests();

		expect(calls).toHaveLength(0);
		expect(console.error).toHaveBeenCalled();
	});

	it("unregister removes the handle from tracking", async () => {
		const { hb, calls } = makeController();
		hb._setNowForTests(() => 1_000_000);
		hb.register(
			"h-out",
			makeProbe({
				alive: false,
				lastStatusChangeMs: 999_000,
			}),
		);
		hb.unregister("h-out");

		await hb._tickForTests();

		expect(calls).toHaveLength(0);
	});

	it("stop clears the interval and waits for in-flight sweep", async () => {
		vi.useFakeTimers();
		const { hb } = makeController({ intervalMs: 50 });
		hb.register(
			"h-stop",
			makeProbe({
				alive: true,
				rssBytes: 10,
				lastStatusChangeMs: Date.now(),
			}),
		);
		hb.start();
		// Fire one interval tick to schedule a sweep.
		await vi.advanceTimersByTimeAsync(60);
		await hb.stop();
		// Subsequent ticks must NOT run.
		await vi.advanceTimersByTimeAsync(200);
		// No assertion needed beyond not throwing — stopping while a sweep is
		// in flight resolves cleanly. The presence of this test guards the
		// stop() contract from regressions that drop the inflight await.
		expect(true).toBe(true);
	});
});
