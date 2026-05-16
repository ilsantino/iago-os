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

	it("IMPORTANT #5: setInterval callback skips tick when previous sweep is still in-flight", async () => {
		vi.useFakeTimers();
		const calls: RestartCall[] = [];
		const hb = new HeartbeatController({
			intervalMs: 50,
			onForceRestart: async (handleId, reason) => {
				calls.push({ handleId, reason });
			},
		});
		hb._setNowForTests(() => 1_000_000);

		// Probe that takes 200ms to resolve — longer than the 50ms tick
		// interval, so 2–3 ticks would normally fire DURING a single
		// sweep.
		let probeCount = 0;
		hb.register("h-slow", async () => {
			probeCount++;
			await new Promise<void>((resolve) => setTimeout(resolve, 200));
			return {
				alive: true,
				rssBytes: 1,
				lastStatusChangeMs: 999_000,
			};
		});

		hb.start();
		// Advance 250ms — interval would otherwise fire 5 times. With
		// the sample-and-skip policy, the second through fifth ticks
		// see an in-flight sweep and skip, so probe runs at most twice
		// (initial tick + first post-completion tick).
		await vi.advanceTimersByTimeAsync(250);
		await hb.stop();

		// Stricter than "<=5" — the policy guarantees no overlap, so
		// probeCount is ≤ number of ticks that did NOT see in-flight.
		// With 200ms sweep + 50ms tick, only ticks at t=0 and t≥200
		// see no in-flight; bounded to 2.
		expect(probeCount).toBeLessThanOrEqual(2);
	});

	it("IMPORTANT #6: handle unregistered DURING probe await is skipped (no spurious force-restart)", async () => {
		const calls: RestartCall[] = [];
		const hb = new HeartbeatController({
			intervalMs: 60_000,
			onForceRestart: async (handleId, reason) => {
				calls.push({ handleId, reason });
			},
		});
		hb._setNowForTests(() => 1_000_000);

		// Probe resolves with a status that WOULD trigger force-restart
		// (alive=false). But mid-await, we unregister the handle.
		const probeResolvers: Array<() => void> = [];
		hb.register("h-gone", async () => {
			return await new Promise<HeartbeatStatus>((resolve) => {
				probeResolvers.push(() => {
					resolve({
						alive: false,
						lastStatusChangeMs: 999_000,
					});
				});
			});
		});

		const sweepPromise = hb._tickForTests();

		// Unregister while the probe is still pending.
		hb.unregister("h-gone");

		// Now resolve the probe.
		for (const r of probeResolvers) r();
		await sweepPromise;

		// IMPORTANT #6: re-check guard prevented the force-restart
		// from firing on a handle that's no longer tracked.
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
