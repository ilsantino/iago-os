/**
 * Heartbeat health-check loop for live agent handles.
 *
 * Plan 03 contract notes (binding):
 *
 * - **Canonical RSS gating layer:** the heartbeat OWNS recycling decisions
 *   for ALL shapes (stress-test PR2). Adapter `isAlive()` returns the
 *   liveness signal AND the data (via `getStatus().rssBytes`) that the
 *   heartbeat then evaluates. Adapters do NOT decide recycling locally.
 * - **Probe cadence:** 60s interval, 512MB RSS recycle threshold, 5min
 *   `lastStatusChangeMs` stall threshold. All three overridable via the
 *   `HeartbeatController` constructor.
 * - **`lastStatusChangeMs` is owned by the registrant** (agent-manager),
 *   not by the heartbeat. The heartbeat reads it via `getStatus()` and
 *   compares against `Date.now()`. The agent-manager MUST refresh the
 *   value on every `onStatusChanged` callback (stress-test PR1).
 * - **Probe errors are swallowed.** A `getStatus()` rejection logs to
 *   stderr and skips the handle for that tick — the heartbeat MUST NOT
 *   crash the daemon.
 * - **`onForceRestart` errors are swallowed.** A rejection from the
 *   callback logs to stderr; the heartbeat continues its sweep so a single
 *   broken agent does not stall recycling of healthy peers.
 * - **`start`/`stop` are idempotent**: double-start is a no-op; `stop`
 *   waits for the in-flight sweep to settle so test teardown is clean.
 *
 * Class chosen over factory function for: lifecycle methods, dependency
 * injection of `onForceRestart`, fake-timer-driven testability, and
 * coordinated stop. CLAUDE.md's "Functional components only" rule is
 * React-component-scoped — Node stateful daemon code uses classes where
 * lifecycle is intrinsic.
 */

export interface HeartbeatStatus {
	readonly alive: boolean;
	readonly rssBytes?: number;
	readonly lastStatusChangeMs: number;
}

export type ForceRestartReason = "stalled" | "rss-exceeded";

export type ForceRestartCallback = (
	handleId: string,
	reason: ForceRestartReason,
) => Promise<void>;

export type StatusProbe = () => Promise<HeartbeatStatus>;

export interface HeartbeatOpts {
	readonly intervalMs?: number;
	readonly rssLimitBytes?: number;
	readonly stallThresholdMs?: number;
	readonly onForceRestart: ForceRestartCallback;
}

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_RSS_LIMIT_BYTES = 512 * 1024 * 1024;
const DEFAULT_STALL_THRESHOLD_MS = 5 * 60_000;

export class HeartbeatController {
	private readonly intervalMs: number;
	private readonly rssLimitBytes: number;
	private readonly stallThresholdMs: number;
	private onForceRestart: ForceRestartCallback;
	private readonly handles = new Map<string, StatusProbe>();
	private timer: ReturnType<typeof setInterval> | null = null;
	private inflightSweep: Promise<void> | null = null;
	private now: () => number = Date.now;

	constructor(opts: HeartbeatOpts) {
		this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
		this.rssLimitBytes = opts.rssLimitBytes ?? DEFAULT_RSS_LIMIT_BYTES;
		this.stallThresholdMs = opts.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS;
		this.onForceRestart = opts.onForceRestart;
	}

	/**
	 * Replace the force-restart callback after construction. Used by
	 * `AgentManager.constructor` to wire the heartbeat to `restartAgent`
	 * (Plan 03 Task 3: "Wire `onForceRestart` callback to `restartAgent`").
	 * Safe to call at any point — the next sweep picks up the new callback.
	 */
	setForceRestartCallback(cb: ForceRestartCallback): void {
		this.onForceRestart = cb;
	}

	register(handleId: string, getStatus: StatusProbe): void {
		this.handles.set(handleId, getStatus);
	}

	unregister(handleId: string): void {
		this.handles.delete(handleId);
	}

	start(): void {
		if (this.timer !== null) return;
		this.timer = setInterval(() => {
			this.inflightSweep = this.sweep();
		}, this.intervalMs);
	}

	async stop(): Promise<void> {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
		if (this.inflightSweep !== null) {
			try {
				await this.inflightSweep;
			} catch {
				// Sweep errors are already swallowed inside sweep().
			}
			this.inflightSweep = null;
		}
	}

	/**
	 * Test-only override for `Date.now`. The heartbeat reads its own
	 * clock to compare against `lastStatusChangeMs`; tests that drive
	 * fake timers can replace it to deterministically trigger stall
	 * detection without sleeping.
	 */
	_setNowForTests(now: () => number): void {
		this.now = now;
	}

	/**
	 * Test-only single-tick driver. Production code uses `start()` to
	 * schedule sweeps via `setInterval`; tests prefer this entry point to
	 * avoid coupling to timer mocks.
	 */
	async _tickForTests(): Promise<void> {
		await this.sweep();
	}

	private async sweep(): Promise<void> {
		const snapshot: Array<[string, StatusProbe]> = [];
		for (const entry of this.handles.entries()) {
			snapshot.push(entry);
		}

		for (const [handleId, probe] of snapshot) {
			let status: HeartbeatStatus;
			try {
				status = await probe();
			} catch (err) {
				console.error(
					`[heartbeat] probe error for ${handleId}: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
				continue;
			}

			let reason: ForceRestartReason | null = null;
			if (!status.alive) {
				reason = "stalled";
			} else if (
				status.rssBytes !== undefined &&
				status.rssBytes > this.rssLimitBytes
			) {
				reason = "rss-exceeded";
			} else if (
				this.now() - status.lastStatusChangeMs >
				this.stallThresholdMs
			) {
				reason = "stalled";
			}

			if (reason === null) continue;

			try {
				await this.onForceRestart(handleId, reason);
			} catch (err) {
				console.error(
					`[heartbeat] onForceRestart(${handleId}, ${reason}) failed: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
		}
	}
}
