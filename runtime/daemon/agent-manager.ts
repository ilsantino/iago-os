/**
 * AgentManager — lifecycle layer over `AgentRuntime`.
 *
 * Responsibilities (Plan 03):
 *   - Registration: resolve runtime → spawn → track handle + subscriptions
 *   - Heartbeat wiring: every handle is registered with HeartbeatController;
 *     the heartbeat owns recycling decisions (stress-test PR2 canonical).
 *   - Status persistence: every `onStatusChanged` callback appends to
 *     session.jsonl AND refreshes the in-memory `lastStatusChangeMs`
 *     used by the heartbeat (stress-test PR1).
 *   - Crash recovery: `.daemon-stop` markers written BEFORE shutdown;
 *     absent marker on next boot → crash.
 *   - Subagent semantics: parent-child handle linkage, cost rollup,
 *     auto-shutdown on parent exit, env-merge policy.
 *   - Multi-org cascade: in-memory map → on-disk `pathFor("agents")`
 *     scan → fail-loud on duplicate agentId across orgs
 *     (stress-test PR4).
 *   - Boot recovery: marker scan + session.jsonl two-phase replay.
 *
 * Class chosen over factory function for: lifecycle methods, dependency
 * injection of HeartbeatController, internal-state surface for test
 * introspection (`_internalState`), and coordinated shutdown. CLAUDE.md's
 * "Functional components only" rule is React-scoped — Node stateful
 * daemon code uses classes where lifecycle is intrinsic.
 *
 * Heartbeat-restart NO-replay policy (stress-test MC1): `restartAgent`
 * (called from the heartbeat or any in-process trigger) does NOT replay
 * `session.jsonl`. Replay is BOOT-TIME only via `bootRecovery`. Mid-run
 * restarts continue appending to the same log; the re-spawn picks up
 * fresh from current state. Replay during a running daemon would
 * interleave with live appends.
 */

import { EventEmitter } from "node:events";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

import {
	type AgentRuntime,
	resolveRuntime,
} from "../agent-runtime/registry.js";
import type {
	AgentHandle,
	AgentMessage,
	CostEvent,
	SpawnOpts,
	StatusValue,
} from "../agent-runtime/types.js";

import type {
	ForceRestartReason,
	HeartbeatController,
	HeartbeatStatus,
} from "./heartbeat.js";
import {
	type StopMarkerReason,
	clearStopMarker,
	listAllMarkers,
	writeStopMarker,
} from "./markers.js";
import {
	ReplayController,
	appendEvent,
	cancelPendingAppends,
} from "./session-log.js";
import {
	assertSafeIdentifier,
	atomicRenameStaleDest,
	getErrnoCode,
	pathFor,
} from "./state-paths.js";
import { PR_TRIAGE_ALERT_KINDS, emit as emitTelemetry } from "./telemetry.js";

export interface AgentManagerOpts {
	readonly heartbeat?: HeartbeatController;
}

export interface RegisterAgentConfig {
	readonly agentId: string;
	readonly runtimeId: string;
	readonly org?: string;
	readonly cwd: string;
	readonly env: Record<string, string>;
	readonly sessionId: string;
}

export interface SpawnSubagentOpts {
	readonly parentHandleId: string;
	readonly agentId: string;
	readonly runtimeId: string;
	readonly sessionId: string;
	readonly env?: Record<string, string>;
}

/**
 * Optional inputs for {@link AgentManager.restartAgent}.
 *
 * `envOverride` lets a restart RE-COMPOSE the spawn env from current sources
 * (e.g. the cron restart loop re-running `composeCronAgentEnv` against the
 * live `process.env`) instead of reusing the env captured at the first spawn.
 * When omitted, the existing env is preserved verbatim — heartbeat-, IPC-, and
 * Telegram-triggered restarts deliberately reuse the prior creds. When
 * supplied, the on-disk `<handleId>.json` config is also re-persisted so
 * boot-recovery rebuilds the spawn env from the rotated creds, not a stale
 * snapshot (pr84 R2/twin).
 */
export interface RestartAgentOpts {
	readonly envOverride?: Record<string, string>;
}

export interface BootRecoveryResult {
	readonly recovered: string[];
	readonly cleanShutdowns: string[];
	readonly crashes: string[];
}

export interface BootRecoveryOpts {
	readonly knownConfigs?: ReadonlyMap<string, RegisterAgentConfig>;
}

export interface CostSummary {
	readonly selfCost: number;
	readonly rolledUpCost: number;
	readonly total: number;
}

export class ParentDiedDuringSpawn extends Error {
	readonly parentHandleId: string;
	constructor(parentHandleId: string) {
		super(`Parent handle died during subagent spawn: ${parentHandleId}`);
		this.name = "ParentDiedDuringSpawn";
		this.parentHandleId = parentHandleId;
	}
}

/**
 * Thrown by `registerAgent` when an `agentId` is already registered in
 * a DIFFERENT org. Enforces the stress-test PR4 invariant at the write
 * boundary — without this the dup is only surfaced later by a
 * `resolveAgentOrg` lookup nobody expects to fail, by which time both
 * agents are running (review CRITICAL #1).
 */
export class AgentIdAlreadyRegisteredError extends Error {
	readonly agentId: string;
	readonly existingOrg: string | null;
	readonly attemptedOrg: string | null;
	constructor(
		agentId: string,
		existingOrg: string | null,
		attemptedOrg: string | null,
	) {
		super(
			`Agent id "${agentId}" is already registered (existing org: ${
				existingOrg ?? "(none)"
			}; attempted org: ${attemptedOrg ?? "(none)"})`,
		);
		this.name = "AgentIdAlreadyRegisteredError";
		this.agentId = agentId;
		this.existingOrg = existingOrg;
		this.attemptedOrg = attemptedOrg;
	}
}

/**
 * Plan 04d I3: cap task-file payload size emitted in the
 * `'task-dispatch-needed'` event payload. Oversize files are rejected via
 * `poisonTask` with reason `oversized-task` BEFORE JSON.parse and BEFORE
 * the EventEmitter emit, so a malicious or buggy upstream cannot blow up
 * AgentManager memory by writing a 1GB task. Exported for test access.
 */
export const TASK_PAYLOAD_MAX_BYTES = 1_048_576;

/**
 * pr84 CRITICAL (consumer tolerance): number of consecutive polling ticks a
 * `.json` task file may fail `JSON.parse` before it is poisoned. A
 * non-atomically-written file caught mid-write parses on a later tick; a
 * genuinely-malformed file exhausts the budget and is poisoned. Set to 1 so
 * a single transient failure is tolerated (the file is re-read next tick) but
 * a persistently-broken file poisons promptly on the second failure — bounding
 * the retry so a corrupt task cannot loop forever. Exported for test access.
 */
export const JSON_PARSE_RETRY_BUDGET = 1;

/**
 * Plan 04d Task 1 — typed shape of the `taskContent` payload carried on
 * the `'task-dispatch-needed'` event. `agentId` is guaranteed to be a
 * non-empty string at emit time (validated by `processPendingTask` via
 * the `missing-agent-id` poison path before the listener fires). The
 * index signature captures the rest of the task-file's free-form
 * fields (e.g., `prompt`, `needsApproval`, downstream-defined extras).
 *
 * Review #5 (Plan 04d, minor): preserves the `agentId: string` property
 * type on the payload instead of widening to a bare
 * `Record<string, unknown>` — so upstream drift on the `agentId` field
 * fails the type check at the emit site rather than at the listener.
 */
export interface TaskDispatchPayload {
	readonly agentId: string;
	readonly [key: string]: unknown;
}

interface TrackedHandle {
	handle: AgentHandle;
	runtime: AgentRuntime;
	unsubscribe: () => void;
	spawnOpts: SpawnOpts;
	config: RegisterAgentConfig;
	org: string | null;
	parentHandleId: string | null;
	lastStatusChangeMs: number;
	lastStatus: StatusValue;
	selfCost: number;
	rolledUpCost: number;
	costTapDone: boolean;
}

/**
 * Adapter-provided optional liveness signal that OVERRIDES
 * `lastStatusChangeMs` for stall-detection purposes when the adapter
 * has a richer health signal than status callbacks. Returning `true`
 * tells the heartbeat "this handle is doing legitimate steady-state
 * work; don't restart on stall even if no status change has been
 * observed within `stallThresholdMs`" (review IMPORTANT #5 +
 * cross-cutting probe Q3 — long-running adapter calls like
 * `git clone` keep status in `running` for the whole operation, so
 * `lastStatusChangeMs` never refreshes and the stall detector
 * misfires).
 *
 * Adapters expose this via `AgentManager.registerLivenessProbe`. The
 * probe runs INSIDE the heartbeat probe and must not throw —
 * exceptions are logged and the heartbeat falls back to plain
 * `lastStatusChangeMs` comparison.
 */
export type AdapterLivenessProbe = (
	handle: AgentHandle,
) => Promise<boolean> | boolean;

interface InternalStateSnapshot {
	readonly handles: Array<{
		handleId: string;
		agentId: string;
		runtimeId: string;
		org: string | null;
		parentHandleId: string | null;
		lastStatus: StatusValue;
		lastStatusChangeMs: number;
		selfCost: number;
		rolledUpCost: number;
	}>;
	readonly parentChildren: Array<{ parent: string; children: string[] }>;
	readonly restarting: string[];
	readonly bootRecoveryRan: boolean;
}

const PROTECTED_ENV_PREFIXES = ["AWS_", "IAGO_"];

function mergeEnv(
	parentEnv: Record<string, string>,
	childEnv: Record<string, string>,
): Record<string, string> {
	const merged: Record<string, string> = { ...childEnv };
	for (const [key, value] of Object.entries(parentEnv)) {
		if (PROTECTED_ENV_PREFIXES.some((p) => key.startsWith(p))) {
			merged[key] = value;
			continue;
		}
		if (merged[key] === undefined) {
			merged[key] = value;
		}
	}
	return merged;
}

export class AgentManager extends EventEmitter {
	private readonly heartbeat: HeartbeatController | undefined;
	private readonly handles = new Map<string, TrackedHandle>();
	private readonly parentChildren = new Map<string, Set<string>>();
	// In-flight restart promises keyed by handleId. Concurrent
	// `restartAgent` calls receive the same promise — eliminates the
	// teardown→track window where a guard could throw (M1).
	private readonly restartingPromises = new Map<string, Promise<AgentHandle>>();
	// CRITICAL #1: per-agentId in-process mutex for registerAgent. Two
	// parallel `registerAgent({agentId: "x", ...})` calls would otherwise
	// race past the disk pre-check and both succeed; the second arrival
	// awaits the first via this chain and then re-runs the pre-check
	// against the now-persisted record.
	private readonly registrationLocks = new Map<string, Promise<unknown>>();
	// IMPORTANT #4: per-parentHandleId mutex held for the entire
	// spawnSubagent → linkage block AND the parent's cascade path so
	// child creation cannot interleave with parent teardown.
	private readonly parentLocks = new Map<string, Promise<unknown>>();
	// IMPORTANT #5: optional per-runtime liveness probe registered by
	// adapters whose status callbacks fire only on transitions (e.g.,
	// PTY adapter, which stays in `running` for the whole `git clone`
	// without refreshing `lastStatusChangeMs`).
	private readonly livenessProbes = new Map<string, AdapterLivenessProbe>();
	private bootRecoveryRan = false;
	private cachedBootRecovery: BootRecoveryResult | null = null;
	// Same promise-capture pattern as restartingPromises: assigned synchronously
	// before the first await so concurrent callers share a single in-flight run.
	private bootRecoveryPromise: Promise<BootRecoveryResult> | null = null;
	// Plan 07b: tasks/pending/ polling loop state (deferred from Phase 1
	// Plan 07 stress-test M3).
	private pollingInterval: NodeJS.Timeout | null = null;
	private pollingTickInFlight: Promise<void> | null = null;
	private pollingStopped = false;
	private readonly unroutedSet = new Set<string>();
	private unroutedSetOverflowed = false;
	private unroutedSetCap = 1000;
	/**
	 * Plan 04d dual-adversarial C-1 fix: per-filename guard preventing
	 * duplicate `'task-dispatch-needed'` emits when a polling tick fires
	 * before the prior tick's handler has resolved. Population is in
	 * `processPendingTask` just before `this.emit(...)`; clearing is the
	 * dispatch listener's responsibility via `releaseDispatchSlot`,
	 * called from the listener's `finally` block.
	 */
	private readonly dispatchInFlight = new Set<string>();
	/**
	 * R1 dual-adversarial round-1 Critical fix: per-filename guard preventing
	 * duplicate `'task-send-needed'` emits — the SEND-path analogue of
	 * `dispatchInFlight`. The send branch in `processPendingTask` emits and
	 * returns WITHOUT claiming the file (the daemon's `makeTaskSendHandler`
	 * claims only AFTER `telegramBot.sendAgentNotification` completes a network
	 * round-trip). Without this guard, a Telegram send slower than one polling
	 * interval (network latency, a 429 rate-limit, a multi-chunk send) lets the
	 * next tick re-read the SAME still-present `pr-triage-send__*.json` and emit
	 * `task-send-needed` AGAIN → two handlers both call `sendAgentNotification`
	 * → Santiago receives the same PR summary twice. Population is in
	 * `processPendingTask` just before `this.emit("task-send-needed", ...)`;
	 * clearing is the send listener's responsibility via `releaseSendSlot`,
	 * called from the listener's `finally` block.
	 */
	private readonly sendInFlight = new Set<string>();
	/**
	 * pr84 CRITICAL (consumer tolerance): per-filename count of consecutive
	 * JSON.parse failures. A producer that writes a `.json` file directly
	 * (instead of the atomic `.tmp`-then-rename discipline) can be caught
	 * mid-write by a polling tick, yielding a TRANSIENT parse error on a
	 * file that becomes valid microseconds later. Poisoning on the first
	 * failure permanently LOSES that task (it moves to `tasks/poisoned/`).
	 * The consumer instead grants `JSON_PARSE_RETRY_BUDGET` ticks of grace:
	 * a parse failure increments the counter and leaves the file in
	 * `pending/` for the next tick; only once the budget is exhausted is a
	 * genuinely-malformed file poisoned. A successful parse clears the
	 * counter. `stopPollingLoop` clears the whole map.
	 *
	 * This is defense-in-depth — the root fix is the atomic producer
	 * (`agents/pr-triage/prompt-template.md`). It does NOT weaken poison
	 * handling: a file that stays unparseable for the full budget is still
	 * poisoned, so a truly corrupt task does not loop forever.
	 */
	private readonly jsonParseRetries = new Map<string, number>();

	constructor(opts?: AgentManagerOpts) {
		super();
		// EventEmitter's default `maxListeners` is 10; the cron-scheduler
		// alone subscribes 3 listeners (`task-resolved`/`task-poisoned`/
		// `task-unrouted`) and downstream consumers (dashboards, audit
		// hooks) will subscribe more. Bump to 0 (unlimited) since the
		// daemon controls its own listener surface — we are not exposing
		// the EventEmitter to untrusted callers.
		this.setMaxListeners(0);
		this.heartbeat = opts?.heartbeat;
		// Auto-wire `onForceRestart → restartAgent` so heartbeat-triggered
		// recycle/stall events drive the manager's restart path. Required by
		// Plan 03 Task 3; without this binding the entire heartbeat→recycle
		// pipeline is silently inert if the caller-supplied callback is a
		// no-op (review finding I1).
		if (this.heartbeat !== undefined) {
			this.heartbeat.setForceRestartCallback(async (id, reason) => {
				try {
					await this.restartAgent(id, reason);
				} catch (err) {
					console.error(
						`[agent-manager] heartbeat-driven restart of ${id} failed: ${
							err instanceof Error ? err.message : String(err)
						}`,
					);
				}
			});
		}
	}

	/**
	 * Persistence order: `runtime.spawn` → `trackHandle` → `persistAgentConfig`.
	 * `persistAgentConfig` is keyed on `handle.id`, which does not exist until
	 * `spawn` returns, so persist-before-spawn is structurally impossible.
	 *
	 * DURABILITY CONTRACT (Task 1 Critical — fail-closed, 2026-06-02):
	 * persistence is LOAD-BEARING. If `persistAgentConfig` throws after a
	 * successful spawn (disk fault / ENOSPC / EACCES), `registerAgent` does
	 * NOT return a live-but-unpersisted handle — it tears the spawned handle
	 * down (`shutdownAgentInternal` → marker + cascade + `runtime.shutdown` +
	 * `teardown`) and REJECTS. Rationale: a tracked handle with no
	 * `agents/<id>.json` on disk is invisible to boot recovery's
	 * `knownConfigs` AND to the on-disk uniqueness scan
	 * (`assertAgentIdAvailable`) — so a daemon crash would strand the live
	 * process unrecoverably AND a later `registerAgent` of the same id could
	 * duplicate it. Fail-closed eliminates both: either a fully-registered,
	 * recoverable agent or a clean rejection with NO leaked process.
	 *
	 * Partial-state windows (post-fix):
	 *   - If `spawn` throws, no handle id exists yet — nothing is tracked and
	 *     nothing is persisted. The caller sees the throw; there is no orphan.
	 *   - If `persistAgentConfig` throws AFTER a successful spawn, the spawned
	 *     handle is shut down + untracked before the throw propagates — no
	 *     live process, no tracked handle, no on-disk config. There is no
	 *     longer a "tracked-but-unpersisted" window.
	 *
	 * The in-process registration lock (`withAgentRegistrationLock`) is held
	 * across the whole sequence so the rollback completes before a competing
	 * same-id `registerAgent` re-checks availability.
	 */
	async registerAgent(config: RegisterAgentConfig): Promise<AgentHandle> {
		assertSafeIdentifier(config.agentId, "agentId");
		assertSafeIdentifier(config.sessionId, "sessionId");
		// CRITICAL #1: in-process mutex keyed on agentId so two parallel
		// `registerAgent({agentId: "x", ...})` calls cannot both race past
		// the on-disk uniqueness check. The second arrival awaits the
		// first via the chain, then re-runs the check against the
		// persisted record (and either finds itself in the same org and
		// can proceed, or throws `AgentIdAlreadyRegisteredError`).
		return this.withAgentRegistrationLock(config.agentId, async () => {
			// Write-side enforcement of PR4 (agentIds globally unique).
			// Walks in-memory handles first, then the on-disk
			// `pathFor("agents")` scan. If a record for `config.agentId`
			// exists in a DIFFERENT org, throw immediately — no spawn,
			// no marker, no orphan adapter resources.
			await this.assertAgentIdAvailable(config.agentId, config.org ?? null);

			const runtime = resolveRuntime(config.runtimeId);
			const spawnOpts: SpawnOpts = {
				cwd: config.cwd,
				env: { ...config.env },
				agentId: config.agentId,
				sessionId: config.sessionId,
				org: config.org,
			};
			const handle = await runtime.spawn(spawnOpts);
			await this.trackHandle({
				handle,
				runtime,
				spawnOpts,
				config,
				org: config.org ?? null,
				parentHandleId: null,
			});
			try {
				await this.persistAgentConfig(handle.id, config, runtime);
			} catch (persistErr) {
				// Task 1 Critical (fail-closed): persistence is load-bearing. A
				// tracked handle with no `agents/<id>.json` is unrecoverable after a
				// crash and duplicable on re-register. Roll the spawn back — shut the
				// live process down, cascade children, write the marker, and untrack —
				// then reject so the caller never sees a half-registered agent.
				// `shutdownAgentInternal` is keyed on `withParentLock(handle.id)`, a
				// DIFFERENT lock from the `withAgentRegistrationLock(agentId)` held
				// here, so there is no self-deadlock. A best-effort second teardown
				// guards the case where shutdown itself throws before `teardown` runs.
				try {
					await this.shutdownAgentInternal(handle.id, "SIGKILL", "crash");
				} catch (rollbackErr) {
					console.error(
						`[agent-manager] rollback shutdown of ${handle.id} after persist failure failed: ${
							rollbackErr instanceof Error
								? rollbackErr.message
								: String(rollbackErr)
						}`,
					);
				} finally {
					// Ensure the handle is gone from `handles` even if shutdown threw
					// before reaching its own `teardown` (idempotent: no-op if already
					// torn down).
					this.teardown(handle.id);
				}
				throw persistErr;
			}
			return handle;
		});
	}

	/**
	 * Register an adapter-side liveness probe for a specific runtime id.
	 * The heartbeat consults this probe BEFORE concluding "stalled" — if
	 * the probe resolves `true`, the stall trip is suppressed for the
	 * current tick. Addresses IMPORTANT #5 / Q3 (long-running adapter
	 * operations like `git clone` keep status in `running` and never
	 * refresh `lastStatusChangeMs`).
	 *
	 * Probe is keyed by `runtimeId` because all handles of a given
	 * adapter share the liveness semantics (e.g., every PTY handle uses
	 * the same `pty.isAlive()` mechanism).
	 */
	registerLivenessProbe(runtimeId: string, probe: AdapterLivenessProbe): void {
		this.livenessProbes.set(runtimeId, probe);
	}

	getHandle(handleId: string): AgentHandle | undefined {
		return this.handles.get(handleId)?.handle;
	}

	listHandles(): AgentHandle[] {
		return Array.from(this.handles.values()).map((t) => t.handle);
	}

	/**
	 * Last status observed for this handle (per status-callback wiring in
	 * `trackHandle`). Returns `undefined` if the handle is unknown.
	 * Synchronous read of the in-memory tracked record — safe to call
	 * from the Telegram bot's `/status` reply path. PR45 M6.
	 *
	 * Minor (Task 3 type-tighten): the return is `StatusValue | undefined`
	 * (not the looser `string | undefined`) — `lastStatus` is already a
	 * `StatusValue`, so the narrower type lets callers `switch` exhaustively
	 * over the union without a string-widening cast.
	 */
	getLastStatus(handleId: string): StatusValue | undefined {
		return this.handles.get(handleId)?.lastStatus;
	}

	/**
	 * Synchronous liveness derivation from the tracked `lastStatus`.
	 * Returns `undefined` for unknown handles, `true` for `running` /
	 * `idle` (the runtime considers the process alive even when blocked
	 * on input), `false` for `exited` / `crashed`, and `undefined` for
	 * `unknown` (the adapter has not reported yet — caller should not
	 * assume either state). Async liveness probes registered via
	 * `registerLivenessProbe` deliberately bypass this method; they are
	 * consumed by the heartbeat loop, not the bot. PR45 M6.
	 *
	 * CACHED-STATUS SEMANTICS (dual-adversarial Important — explicit by
	 * design): this reads the last value pushed by the adapter's
	 * `onStatusChanged` callback, NOT the authoritative async
	 * `runtime.isAlive(handle)` probe. For adapters whose status callback
	 * fires only on transitions, the cached value is stale between
	 * transitions. Concretely, a PTY handle that stays in `running` for
	 * the whole duration of a long operation (e.g. `git clone`) reports
	 * `true` here even after the underlying process has died, until the
	 * adapter emits the next `exited`/`crashed` callback. This method is
	 * the synchronous, best-effort signal for the bot's `/status` reply
	 * (no await on the hot path); callers needing ground-truth liveness
	 * must await `runtime.isAlive(handle)` (the heartbeat loop already
	 * does, via the per-handle probe wired in `trackHandle`).
	 *
	 * NAMING COLLISION (Task 3 Minor — intentional, kept-with-JSDoc per the
	 * plan's "rename OR strengthen the JSDoc" choice): this method shares the
	 * bare name `isAlive` with the runtime adapter's
	 * `AgentRuntime.isAlive(handle): Promise<boolean>`, but the two are NOT
	 * interchangeable. `AgentManager.isAlive(handleId)` is SYNCHRONOUS, keyed
	 * by `handleId` (string), derives liveness from the CACHED `lastStatus`,
	 * and returns `boolean | undefined`. `AgentRuntime.isAlive(handle)` is
	 * ASYNC, takes an `AgentHandle`, actively PROBES the underlying process,
	 * and returns `Promise<boolean>`. The differing signatures (sync vs
	 * Promise, string vs handle, tri-state vs boolean) make an accidental
	 * swap a type error, so the shared name is retained rather than renamed.
	 * Do NOT call this where ground-truth liveness is required — await the
	 * runtime probe instead.
	 */
	isAlive(handleId: string): boolean | undefined {
		const tracked = this.handles.get(handleId);
		if (tracked === undefined) return undefined;
		switch (tracked.lastStatus) {
			case "running":
			case "idle":
				return true;
			case "exited":
			case "crashed":
				return false;
			case "unknown":
				return undefined;
		}
	}

	async shutdownAgent(
		handleId: string,
		signal: "SIGTERM" | "SIGKILL" = "SIGTERM",
	): Promise<void> {
		return this.shutdownAgentInternal(handleId, signal, "graceful");
	}

	/**
	 * Internal shutdown that takes an explicit `markerReason`. Called by:
	 *   - `shutdownAgent` (public) — always `"graceful"` (user intent).
	 *   - `cascadeShutdownChildren` — propagates the parent's exit
	 *     reason (CRITICAL #2). When a parent CRASHES, its children
	 *     receive `"crash"` markers — the boot-recovery replay set then
	 *     includes them. Stamping `"graceful"` on crash-cascaded children
	 *     would silently skip them from replay (inverted behavior).
	 */
	private async shutdownAgentInternal(
		handleId: string,
		signal: "SIGTERM" | "SIGKILL",
		markerReason: StopMarkerReason,
	): Promise<void> {
		const tracked = this.handles.get(handleId);
		if (tracked === undefined) return;
		// IMPORTANT #4: hold the parent-lock for this handle so a
		// concurrent `spawnSubagent` cannot insert a new child between
		// `cascadeShutdownChildren`'s snapshot and `teardown`.
		return this.withParentLock(handleId, async () => {
			// Re-check after acquiring the lock — concurrent shutdown could
			// have already torn this handle down.
			if (!this.handles.has(handleId)) return;
			// Write marker BEFORE calling runtime.shutdown — absent
			// marker on next boot means crash.
			await writeStopMarker(handleId, markerReason);
			// Cascade children BEFORE invoking the adapter's shutdown. Some
			// adapters do not emit a terminal `exited`/`crashed` status
			// callback on shutdown, so the status-driven cascade in
			// `handleStatusChange` would never fire and child handles
			// would orphan. Explicit cascade here makes the cleanup
			// independent of adapter callback semantics. The cascade
			// PROPAGATES the parent's exit reason so children get
			// matching markers (CRITICAL #2).
			await this.cascadeShutdownChildren(handleId, markerReason);
			// Cancel any queued session-log appends so callers awaiting
			// `appendEvent` while the controller was paused don't hang
			// after teardown completes (wave 1 contract).
			cancelPendingAppends(handleId, `shutdown:${markerReason}`);
			try {
				await tracked.runtime.shutdown(tracked.handle, signal);
			} finally {
				this.teardown(handleId);
			}
		});
	}

	/**
	 * Task 8 (single restart authority) — is a restart currently in flight for
	 * this handle id? Both restart paths (the heartbeat recycle via
	 * `restartAgent` and the cron-restart loop's exit listener) consult this so
	 * the SECOND arrival yields to the first instead of double-restarting. The
	 * cron exit listener checks it before calling `scheduleRestart`: a heartbeat
	 * recycle that is tearing the PTY down (which trips the same `exited` status
	 * the cron listener watches) is already restarting, so the cron listener
	 * must NOT fire a competing restart.
	 */
	isRestarting(handleId: string): boolean {
		return this.restartingPromises.has(handleId);
	}

	async restartAgent(
		handleId: string,
		reason: ForceRestartReason | "crash",
		opts?: RestartAgentOpts,
	): Promise<AgentHandle> {
		// M1: hand back the in-flight promise instead of throwing during the
		// teardown→track window. Concurrent callers receive the new
		// generation rather than a "no handle" error if they hit between
		// teardown and trackHandle.
		const inflight = this.restartingPromises.get(handleId);
		if (inflight !== undefined) return inflight;
		const existing = this.handles.get(handleId);
		if (existing === undefined) {
			throw new Error(`No handle to restart: ${handleId}`);
		}
		const promise = this.doRestart(handleId, reason, existing, opts);
		this.restartingPromises.set(handleId, promise);
		try {
			return await promise;
		} finally {
			this.restartingPromises.delete(handleId);
		}
	}

	private async doRestart(
		handleId: string,
		reason: ForceRestartReason | "crash",
		existing: TrackedHandle,
		opts?: RestartAgentOpts,
	): Promise<AgentHandle> {
		const markerReason: StopMarkerReason =
			reason === "crash" || reason === "dead" ? "crash" : "recycle";
		await writeStopMarker(handleId, markerReason);
		// Cascade children BEFORE the parent shutdown so they are torn
		// down cleanly even when the adapter does not emit a terminal
		// callback. Cascade marker reason matches the parent's reason —
		// crash-restarts produce `crash`-marker children that replay on
		// next boot; recycle-restarts produce `recycle` children that do
		// NOT replay (CRITICAL #2).
		await this.cascadeShutdownChildren(handleId, markerReason);
		try {
			await existing.runtime.shutdown(existing.handle, "SIGTERM");
		} catch (err) {
			console.error(
				`[agent-manager] shutdown during restart of ${handleId} failed: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
		this.teardown(handleId);

		// pr84 R2/twin: a caller (the cron restart loop) may supply a freshly
		// RE-COMPOSED env so a restart picks up rotated daemon secrets instead
		// of reusing the stale snapshot captured at the first spawn. When no
		// override is given (heartbeat / IPC / Telegram restarts) the existing
		// env is preserved verbatim — those paths intentionally reuse creds.
		const envOverride = opts?.envOverride;
		const respawnSpawnOpts: SpawnOpts =
			envOverride === undefined
				? existing.spawnOpts
				: { ...existing.spawnOpts, env: { ...envOverride } };
		const respawnConfig: RegisterAgentConfig =
			envOverride === undefined
				? existing.config
				: { ...existing.config, env: { ...envOverride } };

		// CRITICAL #3: re-spawn with the SAME handle id via SpawnOpts.restoreId
		// so the new handle is keyed identically — `getHandle(handleId)` after
		// restart returns the new generation, and any external reference
		// (heartbeat, IPC, dashboard, prior restartAgent caller) continues to
		// resolve the same logical agent. SessionId is also preserved so
		// session.jsonl is continuous; the generation increment is the only
		// signal callers should use to discriminate generations.
		const restoreSpawnOpts: SpawnOpts = {
			...respawnSpawnOpts,
			restoreId: handleId,
		};
		const freshHandle = await existing.runtime.spawn(restoreSpawnOpts);
		if (freshHandle.id !== handleId) {
			// Adapter ignored restoreId — that's a contract violation. Tear
			// down the rogue handle and throw so the bug is loud rather than
			// silently producing a stale handle map.
			try {
				await existing.runtime.shutdown(freshHandle, "SIGTERM");
			} catch (err) {
				console.error(
					`[agent-manager] cleanup after rogue restart handle ${freshHandle.id} (expected ${handleId}) failed: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
			throw new Error(
				`AgentRuntime "${existing.runtime.id}" violated SpawnOpts.restoreId contract: returned handle id "${freshHandle.id}" instead of "${handleId}"`,
			);
		}
		const newGeneration: AgentHandle = {
			...freshHandle,
			id: handleId,
			generationToken: existing.handle.generationToken + 1,
		};
		await this.trackHandle({
			handle: newGeneration,
			runtime: existing.runtime,
			spawnOpts: respawnSpawnOpts,
			config: respawnConfig,
			org: existing.org,
			parentHandleId: existing.parentHandleId,
		});
		// pr84 twin: when the env was re-composed, re-persist the on-disk
		// `<handleId>.json` so boot-recovery's `restoreFromMarker` rebuilds the
		// spawn env from CURRENT creds — not the stale tokens captured at first
		// register. The filename is keyed on the stable handleId (restoreId), so
		// this OVERWRITES the same file: no orphan `<oldHandleId>.json`
		// accumulates across restarts (atomic 0o600 temp-then-rename in
		// persistAgentConfig). Skipped when env is unchanged (nothing to rewrite).
		if (envOverride !== undefined) {
			// Task 1: persistAgentConfig now THROWS on write failure. In the
			// restart path the respawn ALREADY succeeded and the new generation is
			// tracked, so a failed env-rewrite must NOT undo the recovery — catch
			// it locally and log. This is the documented narrow window: boot
			// recovery would rebuild from the stale-but-present prior config (or
			// none) rather than the freshly-rotated env. Distinct from the
			// register path, where the spawn is rolled back fail-closed because no
			// live agent existed before it.
			try {
				await this.persistAgentConfig(
					handleId,
					respawnConfig,
					existing.runtime,
				);
			} catch (persistErr) {
				console.error(
					`[agent-manager] restart env-rewrite persist for ${handleId} failed (respawn kept): ${
						persistErr instanceof Error
							? persistErr.message
							: String(persistErr)
					}`,
				);
			}
		}
		// Task 8 (single restart authority) — announce the new generation so the
		// cron-restart loop re-arms its exit listener on the FRESH handle,
		// regardless of WHO triggered this restart (heartbeat recycle, IPC, or the
		// cron loop itself). Without this, a heartbeat-initiated recycle would
		// re-spawn a generation with NO cron-side exit listener, and a later exit
		// of the cron agent would go un-restarted (silent death of the daily job).
		// Carries the agentId so the cron loop (which keys by agentId) can match,
		// plus the handleId + new generationToken so the listener re-arms against
		// the exact new handle.
		this.emit("agent-restarted", {
			agentId: newGeneration.agentId,
			handleId,
			generationToken: newGeneration.generationToken,
		});
		return newGeneration;
	}

	async spawnSubagent(opts: SpawnSubagentOpts): Promise<AgentHandle> {
		// IMPORTANT #4: hold the parent-lock for the ENTIRE spawn+linkage
		// block. The cascade path acquires the same lock so it cannot
		// start tearing children down mid-spawn. The pre-check before
		// spawn short-circuits the expensive runtime.spawn cost when
		// parent is already gone (avoids paying for a PTY allocation
		// just to throw immediately).
		return this.withParentLock(opts.parentHandleId, async () => {
			const parent = this.handles.get(opts.parentHandleId);
			if (parent === undefined) {
				throw new Error(`Parent handle not registered: ${opts.parentHandleId}`);
			}
			// Cheap pre-check: if parent is already dead before we even
			// pay the spawn cost, throw early.
			const aliveBeforeSpawn = await parent.runtime.isAlive(parent.handle);
			if (!aliveBeforeSpawn || !this.handles.has(opts.parentHandleId)) {
				throw new ParentDiedDuringSpawn(opts.parentHandleId);
			}

			const runtime = resolveRuntime(opts.runtimeId);
			const mergedEnv = mergeEnv(parent.spawnOpts.env, opts.env ?? {});
			const spawnOpts: SpawnOpts = {
				cwd: parent.spawnOpts.cwd,
				env: mergedEnv,
				agentId: opts.agentId,
				sessionId: opts.sessionId,
				org: parent.org ?? undefined,
				parentHandle: parent.handle,
			};
			const childHandle = await runtime.spawn(spawnOpts);

			// EC2: between spawn returning and the linkage insertion, the parent
			// may have exited. Re-check parent liveness before completing the
			// linkage; if the parent is dead, shut the child down and throw.
			const stillAlive = await parent.runtime.isAlive(parent.handle);
			if (!stillAlive || !this.handles.has(opts.parentHandleId)) {
				try {
					await runtime.shutdown(childHandle, "SIGTERM");
				} catch (err) {
					console.error(
						`[agent-manager] child shutdown after parent-died-during-spawn failed: ${
							err instanceof Error ? err.message : String(err)
						}`,
					);
				}
				throw new ParentDiedDuringSpawn(opts.parentHandleId);
			}

			const childConfig: RegisterAgentConfig = {
				agentId: opts.agentId,
				runtimeId: opts.runtimeId,
				org: parent.org ?? undefined,
				cwd: parent.spawnOpts.cwd,
				env: mergedEnv,
				sessionId: opts.sessionId,
			};
			await this.trackHandle({
				handle: childHandle,
				runtime,
				spawnOpts,
				config: childConfig,
				org: parent.org,
				parentHandleId: opts.parentHandleId,
			});

			let children = this.parentChildren.get(opts.parentHandleId);
			if (children === undefined) {
				children = new Set<string>();
				this.parentChildren.set(opts.parentHandleId, children);
			}
			children.add(childHandle.id);

			return childHandle;
		});
	}

	getCostSummary(handleId: string): CostSummary {
		const tracked = this.handles.get(handleId);
		if (tracked === undefined) {
			return { selfCost: 0, rolledUpCost: 0, total: 0 };
		}
		return {
			selfCost: tracked.selfCost,
			rolledUpCost: tracked.rolledUpCost,
			total: tracked.selfCost + tracked.rolledUpCost,
		};
	}

	/**
	 * Walk the in-memory map first; on miss, scan the on-disk
	 * `pathFor("agents")` directory for matching `agentId` across orgs.
	 * If the same `agentId` appears in two orgs, throw — agentIds MUST be
	 * globally unique (stress-test PR4).
	 */
	async resolveAgentOrg(agentId: string): Promise<string | null> {
		for (const tracked of this.handles.values()) {
			if (tracked.handle.agentId === agentId) {
				return tracked.org;
			}
		}

		const dir = pathFor("agents");
		let entries: string[];
		try {
			entries = await fsp.readdir(dir);
		} catch (err) {
			if (getErrnoCode(err) === "ENOENT") return null;
			throw err;
		}

		const found: Array<{ org: string | null }> = [];
		for (const entry of entries) {
			if (!entry.endsWith(".json")) continue;
			let raw: string;
			try {
				raw = await fsp.readFile(path.join(dir, entry), "utf8");
			} catch {
				continue;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				continue;
			}
			if (
				typeof parsed === "object" &&
				parsed !== null &&
				(parsed as { agentId?: unknown }).agentId === agentId
			) {
				const orgVal = (parsed as { org?: unknown }).org;
				found.push({ org: typeof orgVal === "string" ? orgVal : null });
			}
		}

		if (found.length === 0) return null;
		const uniqueOrgs = new Set(found.map((f) => f.org ?? "__no_org__"));
		if (uniqueOrgs.size > 1) {
			throw new Error(`Ambiguous agentId across orgs: ${agentId}`);
		}
		const first = found[0];
		return first?.org ?? null;
	}

	/**
	 * Daemon boot recovery: scan `.daemon-stop` markers, categorize each
	 * by reason, and (for crashes) attempt session.jsonl two-phase replay.
	 *
	 * Replay is best-effort. Adapters that cannot resume (e.g., PTY whose
	 * subprocess is gone) return null from `restoreFromMarker`; we record
	 * the crash and skip replay rather than failing boot.
	 *
	 * Per-kind replay policy: only `prompt` and `inject` AgentMessages are
	 * re-fed to the runtime. `approval`, `abort`, and `custom` are
	 * application-level and not replayed — operators handle them out of
	 * band.
	 *
	 * Idempotency: second call returns the cached result (EC3).
	 */
	async bootRecovery(opts?: BootRecoveryOpts): Promise<BootRecoveryResult> {
		if (this.bootRecoveryPromise !== null) return this.bootRecoveryPromise;
		const bootRecoveryPromise = (async (): Promise<BootRecoveryResult> => {
			this.bootRecoveryRan = true;

			const recovered: string[] = [];
			const cleanShutdowns: string[] = [];
			const crashes: string[] = [];

			const markers = await listAllMarkers();
			const knownConfigs = opts?.knownConfigs;
			// Track every handleId we observed via a marker so we can detect
			// daemon-crash-before-marker-write below: any knownConfigs entry
			// without a marker on disk means the daemon died before it could
			// stamp one. That path was previously skipped (highest-value
			// recovery case) and is now treated as a crash candidate.
			const seenHandleIds = new Set<string>();

			for (const { handleId, marker } of markers) {
				seenHandleIds.add(handleId);
				if (marker.reason === "graceful") {
					cleanShutdowns.push(handleId);
					await clearStopMarker(handleId);
					continue;
				}
				if (marker.reason === "recycle") {
					// Voluntary restart: re-spawn cleanly, NO replay.
					cleanShutdowns.push(handleId);
					if (knownConfigs !== undefined) {
						const cfg = knownConfigs.get(handleId);
						if (cfg !== undefined) {
							try {
								await this.registerAgent(cfg);
								// M2: the new handle has its own `<newHandleId>.json`
								// (written by registerAgent → persistAgentConfig). The
								// pre-restart `<originalHandleId>.json` is orphan
								// housekeeping — unlink it so resolveAgentOrg cannot
								// later see duplicates.
								await this.removeOrphanAgentConfig(handleId);
							} catch (err) {
								console.error(
									`[agent-manager] recycle re-spawn failed for ${handleId}: ${
										err instanceof Error ? err.message : String(err)
									}`,
								);
							}
						}
					}
					await clearStopMarker(handleId);
					continue;
				}
				// reason === "crash"
				crashes.push(handleId);
				// I2: capture the restored handle's id rather than assuming it
				// matches the marker's handleId. Adapters MAY return a handle
				// with a different id (e.g., generation suffix); the recovered
				// listing reflects what was actually tracked.
				const recoveredId = await this.attemptCrashReplay(
					handleId,
					knownConfigs,
				);
				if (recoveredId !== null && this.handles.has(recoveredId)) {
					recovered.push(recoveredId);
				}
				await clearStopMarker(handleId);
			}

			// Daemon-crash-without-marker: any knownConfigs entry that did not
			// surface a marker on disk means the daemon (or the host) died
			// before the agent's exit path could stamp one. The marker
			// invariant — "absent marker on next boot means crash" — is
			// enforced here. Without this branch the highest-value recovery
			// case (daemon hard-crash) was silently skipped and replay never
			// ran for those handles.
			if (knownConfigs !== undefined) {
				for (const handleId of knownConfigs.keys()) {
					if (seenHandleIds.has(handleId)) continue;
					crashes.push(handleId);
					const recoveredId = await this.attemptCrashReplay(
						handleId,
						knownConfigs,
					);
					if (recoveredId !== null && this.handles.has(recoveredId)) {
						recovered.push(recoveredId);
					}
				}
			}

			const result: BootRecoveryResult = {
				recovered,
				cleanShutdowns,
				crashes,
			};
			this.cachedBootRecovery = result;
			return result;
		})();
		// Assigned synchronously (no await precedes this), so the guard above
		// memoizes correctly for concurrent callers. Return the local to avoid
		// a non-null assertion on the nullable field.
		this.bootRecoveryPromise = bootRecoveryPromise;
		return bootRecoveryPromise;
	}

	/**
	 * Test-only internal-state surface. Underscore prefix marks it as
	 * test infrastructure — do not call from production code paths.
	 */
	_internalState(): InternalStateSnapshot {
		return {
			handles: Array.from(this.handles.entries()).map(([handleId, t]) => ({
				handleId,
				agentId: t.handle.agentId,
				runtimeId: t.runtime.id,
				org: t.org,
				parentHandleId: t.parentHandleId,
				lastStatus: t.lastStatus,
				lastStatusChangeMs: t.lastStatusChangeMs,
				selfCost: t.selfCost,
				rolledUpCost: t.rolledUpCost,
			})),
			parentChildren: Array.from(this.parentChildren.entries()).map(
				([parent, children]) => ({
					parent,
					children: Array.from(children),
				}),
			),
			restarting: Array.from(this.restartingPromises.keys()),
			bootRecoveryRan: this.bootRecoveryRan,
		};
	}

	/** Test-only reset of boot-recovery idempotency flag. */
	_resetBootRecoveryForTests(): void {
		this.bootRecoveryRan = false;
		this.cachedBootRecovery = null;
		this.bootRecoveryPromise = null;
	}

	private async trackHandle(args: {
		handle: AgentHandle;
		runtime: AgentRuntime;
		spawnOpts: SpawnOpts;
		config: RegisterAgentConfig;
		org: string | null;
		parentHandleId: string | null;
	}): Promise<void> {
		const { handle, runtime, spawnOpts, config, org, parentHandleId } = args;
		const tracked: TrackedHandle = {
			handle,
			runtime,
			unsubscribe: () => {},
			spawnOpts,
			config,
			org,
			parentHandleId,
			lastStatusChangeMs: Date.now(),
			lastStatus: "running",
			selfCost: 0,
			rolledUpCost: 0,
			costTapDone: false,
		};
		this.handles.set(handle.id, tracked);

		// Wire status callback: persist to session.jsonl AND refresh
		// in-memory `lastStatusChangeMs` (stress-test PR1).
		const unsubscribe = runtime.onStatusChanged(handle, (status, code) => {
			void this.handleStatusChange(handle.id, status, code);
		});
		tracked.unsubscribe = unsubscribe;

		if (this.heartbeat !== undefined) {
			const probe = async (): Promise<HeartbeatStatus> => {
				const current = this.handles.get(handle.id);
				if (current === undefined) {
					return {
						alive: false,
						lastStatusChangeMs: tracked.lastStatusChangeMs,
					};
				}

				// IMPORTANT #5: consult the adapter-registered liveness
				// probe (if any) and let it suppress a stale-status
				// trip by reporting a "just now" `lastStatusChangeMs`.
				// The adapter knows its own work pattern; for adapters
				// whose status callback stays in `running` for the
				// whole operation (PTY git clone), the probe is the
				// only way the heartbeat learns the agent is
				// alive-and-working.
				//
				// We return `Number.MAX_SAFE_INTEGER` when liveness is
				// true so the heartbeat's stall test
				// `this.now() - status.lastStatusChangeMs > threshold`
				// is unconditionally false regardless of which clock
				// the heartbeat uses (real or test-fake). Returning
				// `Date.now()` would not suppress the trip when the
				// heartbeat runs on a fast-forwarded test clock.
				let effectiveLastStatusChangeMs = current.lastStatusChangeMs;
				const liveness = this.livenessProbes.get(runtime.id);
				if (liveness !== undefined) {
					try {
						const alive = await liveness(handle);
						if (alive) {
							effectiveLastStatusChangeMs = Number.MAX_SAFE_INTEGER;
						}
					} catch (err) {
						console.error(
							`[agent-manager] adapter liveness probe for ${handle.id} (runtime ${runtime.id}) threw: ${
								err instanceof Error ? err.message : String(err)
							}`,
						);
					}
				}

				// Prefer the adapter's richer `getStatus` when present so
				// the heartbeat actually receives RSS for recycle-policy
				// evaluation. Without this branch the rssLimitBytes gate
				// is permanently inert and 512MB recycling never fires.
				if (typeof runtime.getStatus === "function") {
					try {
						const status = await runtime.getStatus(handle);
						return {
							alive: status.alive,
							lastStatusChangeMs: effectiveLastStatusChangeMs,
							rssBytes: status.rssBytes,
						};
					} catch (err) {
						// `getStatus` is best-effort. On error fall back
						// to `isAlive` so liveness/stall detection still
						// runs even when the richer probe blows up.
						console.error(
							`[agent-manager] runtime.getStatus for ${handle.id} threw: ${
								err instanceof Error ? err.message : String(err)
							}`,
						);
					}
				}
				const alive = await runtime.isAlive(handle);
				return {
					alive,
					lastStatusChangeMs: effectiveLastStatusChangeMs,
					rssBytes: undefined,
				};
			};
			this.heartbeat.register(handle.id, probe);
		}

		// Subscribe to costTap if the adapter exposes one — feed the
		// rollup loop asynchronously, never blocking spawn completion.
		if (typeof runtime.costTap === "function") {
			void this.consumeCostTap(handle.id, runtime, handle);
		}
	}

	private async handleStatusChange(
		handleId: string,
		status: StatusValue,
		code: number | undefined,
	): Promise<void> {
		const tracked = this.handles.get(handleId);
		if (tracked === undefined) return;
		// PR1: refresh on EVERY callback, regardless of new value, so the
		// stall detector does NOT misfire on long-running steady-state agents.
		tracked.lastStatusChangeMs = Date.now();
		tracked.lastStatus = status;

		try {
			await appendEvent(handleId, {
				kind: "status",
				status,
				code,
				at: tracked.lastStatusChangeMs,
			});
		} catch (err) {
			console.error(
				`[agent-manager] appendEvent(status) for ${handleId} failed: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}

		if (status === "exited" || status === "crashed") {
			// CRITICAL #2: propagate the parent's exit reason to children.
			// `exited` is a clean intentional stop → children get
			// `graceful` markers (skipped from replay on next boot).
			// `crashed` is involuntary → children get `crash` markers
			// (included in replay set on next boot). Stamping
			// `graceful` on crash-cascaded children would silently skip
			// them from replay (inverted behavior — children would be
			// silently lost).
			const cascadeReason: StopMarkerReason =
				status === "crashed" ? "crash" : "graceful";
			await this.cascadeShutdownChildren(handleId, cascadeReason);
		}
	}

	private async cascadeShutdownChildren(
		parentId: string,
		cascadeReason: StopMarkerReason,
	): Promise<void> {
		const children = this.parentChildren.get(parentId);
		if (children === undefined) return;
		const toShutdown = Array.from(children);
		this.parentChildren.delete(parentId);
		// MINOR (carried forward from earlier review): fan-out so one slow
		// child doesn't block the rest. `allSettled` preserves the
		// per-child error logging done inside `shutdownAgentInternal`.
		await Promise.allSettled(
			toShutdown.map(async (childId) => {
				try {
					await this.shutdownAgentInternal(childId, "SIGTERM", cascadeReason);
				} catch (err) {
					console.error(
						`[agent-manager] cascade shutdown of ${childId} (parent ${parentId}, reason ${cascadeReason}) failed: ${
							err instanceof Error ? err.message : String(err)
						}`,
					);
				}
			}),
		);
	}

	private async consumeCostTap(
		handleId: string,
		runtime: AgentRuntime,
		handle: AgentHandle,
	): Promise<void> {
		if (typeof runtime.costTap !== "function") return;
		try {
			for await (const event of runtime.costTap(handle)) {
				this.applyCostEvent(handleId, event);
			}
		} catch (err) {
			console.error(
				`[agent-manager] costTap for ${handleId} errored: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
		const tracked = this.handles.get(handleId);
		if (tracked !== undefined) tracked.costTapDone = true;
	}

	private applyCostEvent(handleId: string, event: CostEvent): void {
		const dollars = event.dollarsUsd;
		if (typeof dollars !== "number" || !Number.isFinite(dollars)) return;
		const tracked = this.handles.get(handleId);
		if (tracked === undefined) return;
		tracked.selfCost += dollars;

		// EC5: walk parent chain — silently drop missing ancestors.
		let cursor: string | null = tracked.parentHandleId;
		const visited = new Set<string>();
		while (cursor !== null) {
			if (visited.has(cursor)) break;
			visited.add(cursor);
			const ancestor = this.handles.get(cursor);
			if (ancestor === undefined) break;
			ancestor.rolledUpCost += dollars;
			cursor = ancestor.parentHandleId;
		}
	}

	/**
	 * Crash-path replay attempt. Tries `restoreFromMarker` first; if the
	 * adapter cannot resume, records the crash and returns `null`. On
	 * success, runs the two-phase replay (pause → replay-up-to-HWM →
	 * resume) and registers the resumed handle in the in-memory map.
	 *
	 * Returns the id of the restored handle (so `bootRecovery` can list
	 * what was actually tracked, not the marker's handleId — adapters MAY
	 * return a handle whose id differs from the original, per I2).
	 */
	private async attemptCrashReplay(
		handleId: string,
		knownConfigs: ReadonlyMap<string, RegisterAgentConfig> | undefined,
	): Promise<string | null> {
		if (knownConfigs === undefined) return null;
		const cfg = knownConfigs.get(handleId);
		if (cfg === undefined) return null;

		// CRITICAL (dual-adversarial): isolate a missing-runtime failure per
		// persisted handle. `resolveRuntime` THROWS when the runtime was not
		// registered — the common case after a prior run left persisted
		// configs AND the built-in adapter failed to load
		// (`loadAdapterFailIsolated` only WARNS, it does not register the
		// adapter). Without this catch the throw propagates through
		// `bootRecovery` → `startDaemon` and the daemon crashes on boot
		// instead of booting degraded — defeating the advertised
		// fail-isolation in exactly the recovery scenario it exists for.
		// We emit `recovery-skipped { reason: "runtime-not-registered" }`
		// for this handle and return null so the remaining handles still
		// get processed.
		let runtime: AgentRuntime;
		try {
			runtime = resolveRuntime(cfg.runtimeId);
		} catch (err) {
			console.error(
				`[agent-manager] bootRecovery skipping ${handleId}: runtime "${cfg.runtimeId}" is not registered — ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
			await emitTelemetry({
				kind: "recovery-skipped",
				handleId,
				runtimeId: cfg.runtimeId,
				reason: "runtime-not-registered",
			});
			return null;
		}

		// IMPORTANT #7: adapter-version drift detection. The persisted
		// config records `runtimeVersion` at registration time; on
		// replay, compare against the current adapter's version. If the
		// operator upgraded the adapter between runs, replay is best-
		// effort — log loudly and continue (not block boot).
		const persistedVersion = await this.readPersistedRuntimeVersion(handleId);
		if (persistedVersion !== null && persistedVersion !== runtime.version) {
			console.error(
				`[agent-manager] adapter version drifted on replay for ${handleId}: persisted=${persistedVersion}, current=${runtime.version} — replay continues but may be unsafe`,
			);
		}

		const markerPath = path.join(pathFor("markers"), `${handleId}.daemon-stop`);
		let restored: AgentHandle | null = null;
		try {
			restored = await runtime.restoreFromMarker(markerPath);
		} catch (err) {
			console.error(
				`[agent-manager] restoreFromMarker for ${handleId} threw: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
			return null;
		}
		if (restored === null) return null;

		const replay = new ReplayController(handleId);
		await replay.pauseIntake();
		try {
			await replay.replay(async (event) => {
				const message = this.eventToReplayableMessage(event);
				if (message === null) return;
				try {
					await runtime.send(restored as AgentHandle, message);
				} catch (err) {
					console.error(
						`[agent-manager] replay send for ${handleId} failed: ${
							err instanceof Error ? err.message : String(err)
						}`,
					);
				}
			});
		} finally {
			await replay.resumeIntake();
		}

		const spawnOpts: SpawnOpts = {
			cwd: cfg.cwd,
			env: { ...cfg.env },
			agentId: cfg.agentId,
			sessionId: cfg.sessionId,
			org: cfg.org,
		};
		await this.trackHandle({
			handle: restored,
			runtime,
			spawnOpts,
			config: cfg,
			org: cfg.org ?? null,
			parentHandleId: null,
		});
		return restored.id;
	}

	/**
	 * Unlink an orphan `<handleId>.json` left over from a previous
	 * incarnation (e.g., after a recycle re-spawn the new handle has its
	 * own config file keyed on its new id, and the old file is no longer
	 * referenced). Best-effort — ENOENT is silently ignored.
	 */
	private async removeOrphanAgentConfig(handleId: string): Promise<void> {
		const orphan = path.join(pathFor("agents"), `${handleId}.json`);
		try {
			await fsp.unlink(orphan);
		} catch (err) {
			if (getErrnoCode(err) === "ENOENT") return;
			console.error(
				`[agent-manager] removeOrphanAgentConfig for ${handleId} failed: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
	}

	/**
	 * Read the persisted `runtimeVersion` from `<handleId>.json`.
	 * Returns `null` if the file is absent, unparseable, or pre-dates
	 * the runtimeVersion field (legacy records written before
	 * IMPORTANT #7 landed). Best-effort — version drift detection is
	 * informational, not blocking.
	 */
	private async readPersistedRuntimeVersion(
		handleId: string,
	): Promise<string | null> {
		const file = path.join(pathFor("agents"), `${handleId}.json`);
		let raw: string;
		try {
			raw = await fsp.readFile(file, "utf8");
		} catch (err) {
			if (getErrnoCode(err) === "ENOENT") return null;
			return null;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return null;
		}
		if (typeof parsed !== "object" || parsed === null) return null;
		const v = (parsed as { runtimeVersion?: unknown }).runtimeVersion;
		return typeof v === "string" ? v : null;
	}

	/**
	 * Filter session-log events for the replay re-feed loop. Only
	 * `prompt` and `inject` AgentMessages are replayed; `approval`,
	 * `abort`, and `custom` are application-level. Status events
	 * (`kind: "status"`) are observational and never replayed.
	 *
	 * Event shapes accepted (any of):
	 *   - `{ kind: "prompt"|"inject", payload: { text } }` — direct
	 *     AgentMessage shape (legacy / handwritten test fixtures).
	 *   - `{ kind: "input", messageKind: "prompt"|"inject",
	 *      payload: { text } }` — wrapped shape emitted by
	 *      `claude-pty.send` (PR43 adv IMPORTANT #6). The wrapper allows
	 *      adapters to disambiguate input events from other persisted
	 *      side-effects without colliding with the AgentMessage `kind`
	 *      tag.
	 */
	private eventToReplayableMessage(event: unknown): AgentMessage | null {
		if (typeof event !== "object" || event === null) return null;
		const kindVal = (event as { kind?: unknown }).kind;
		const payloadVal = (event as { payload?: unknown }).payload;
		if (kindVal === "prompt") {
			if (
				typeof payloadVal === "object" &&
				payloadVal !== null &&
				typeof (payloadVal as { text?: unknown }).text === "string"
			) {
				const text = (payloadVal as { text: string }).text;
				return { kind: "prompt", payload: { text } };
			}
		}
		if (kindVal === "inject") {
			if (
				typeof payloadVal === "object" &&
				payloadVal !== null &&
				typeof (payloadVal as { text?: unknown }).text === "string"
			) {
				const text = (payloadVal as { text: string }).text;
				return { kind: "inject", payload: { text } };
			}
		}
		if (kindVal === "input") {
			const messageKindVal = (event as { messageKind?: unknown }).messageKind;
			if (
				(messageKindVal === "prompt" || messageKindVal === "inject") &&
				typeof payloadVal === "object" &&
				payloadVal !== null &&
				typeof (payloadVal as { text?: unknown }).text === "string"
			) {
				const text = (payloadVal as { text: string }).text;
				return { kind: messageKindVal, payload: { text } };
			}
		}
		return null;
	}

	private async persistAgentConfig(
		handleId: string,
		config: RegisterAgentConfig,
		runtime: AgentRuntime,
	): Promise<void> {
		const dir = pathFor("agents");
		const file = path.join(dir, `${handleId}.json`);
		const payload = {
			agentId: config.agentId,
			runtimeId: config.runtimeId,
			org: config.org ?? null,
			cwd: config.cwd,
			sessionId: config.sessionId,
			// IMPORTANT #7: record the adapter version observed at register
			// time so `attemptCrashReplay` can detect drift on the next
			// boot (operator upgraded the adapter between runs). EC4
			// documented the gap; this records the data so we can act on
			// it instead of just warning in the README.
			runtimeVersion: runtime.version,
			// PR43 adv CRITICAL #1: env is now persisted so adapters'
			// `restoreFromMarker` can rebuild the original spawn environment.
			// Without this, restore substituted the daemon's ambient
			// `process.env` and silently dropped per-agent credentials
			// (cross-client leak risk). The previous "intentionally omitted"
			// stance was unsafe — knownConfigs is in-memory only and the
			// daemon-crash-without-marker recovery path could not reach it
			// in some scenarios, leaving restoreFromMarker no env source at
			// all.
			//
			// Security (R1 — feature-pr84-r1-daemon-creds): under R1 the DAEMON
			// owns all Telegram/GitHub calls, so this per-agent `env` no longer
			// carries daemon-owned secrets — the Telegram bot token and GH PAT
			// were removed from the cron-agent env allowlist (see
			// `composeCronAgentEnv`: "the former secret allowlist is gone").
			// The 0o600-temp-file + atomic-rename hardening below (inside the
			// `agents/` dir created+chmod'd mode 0700 by state-paths
			// `ensureStateDirsSync`) is RETAINED as defense-in-depth for any
			// future secret-bearing agent type and for non-secret env that
			// still should not be world-readable: a fresh 0o600 temp file then
			// atomic rename means other local users cannot read it and there is
			// no overwrite window where the dest briefly carries a looser mode
			// (pr84). systemd `LoadCredential=` would add at-rest ENCRYPTION in
			// Phase 2 IF a secret-bearing agent type is ever (re)introduced
			// (perms protect against other local users; encryption protects
			// disk images / backups).
			env: config.env,
		};
		// pr84 IMPORTANT (at-rest secret race on overwrite): write to a FRESH
		// temp file at 0o600, then atomic-rename over the dest. `fsp.writeFile`'s
		// `mode` option is honored only on file CREATION; on OVERWRITE (restore
		// reuses the same handleId → same filename) the prior — possibly
		// looser — mode persists until the trailing chmod, a window where the
		// secret is world-readable. A fresh temp file is always created (so 0o600
		// is enforced at creation, never inherited), and the rename publishes it
		// atomically — the dest never exists in a partially-written or
		// loose-mode state. `atomicRenameStaleDest` is correct here: the prior
		// `<handleId>.json` is by definition stale (same logical agent,
		// superseded config), so destructive replace is the intended semantics.
		// No-op security difference on Windows (NTFS ignores POSIX bits) — the
		// daemon's at-rest target is the POSIX VPS.
		const tmpFile = path.join(dir, `${handleId}.json.tmp`);
		try {
			await fsp.writeFile(tmpFile, JSON.stringify(payload), { mode: 0o600 });
			// Guard against an inherited loose mode if the tmp file somehow
			// pre-existed (e.g., a crash between a prior write and rename) — the
			// `mode` above would not have applied to an already-present file.
			await fsp.chmod(tmpFile, 0o600);
			await atomicRenameStaleDest(tmpFile, file);
		} catch (err) {
			// Best-effort cleanup of the temp file so a failed write does not
			// leave a stray secret-bearing `.tmp` on disk.
			await fsp.unlink(tmpFile).catch(() => undefined);
			// Task 1 Critical (fail-closed): persistence is load-bearing. RETHROW
			// instead of swallowing — the previous console.error-and-resolve let
			// `registerAgent` return a tracked-but-unpersisted (unrecoverable,
			// duplicable) handle. The caller (`registerAgent`) rolls the spawn back
			// on this throw; the restart re-persist call site (`doRestart`) catches
			// it locally because the respawn already succeeded (the env-rewrite is
			// the only casualty and is the documented narrow restart window).
			console.error(
				`[agent-manager] persistAgentConfig for ${handleId} failed: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
			throw err instanceof Error ? err : new Error(String(err));
		}
	}

	/**
	 * Per-agentId mutex. Chains tail-on-tail so two concurrent
	 * `registerAgent({agentId: "x"})` calls execute in arrival order —
	 * the second sees the persisted record from the first and either
	 * proceeds (same org) or throws (different org).
	 *
	 * Mirrors the session-log `withFileLock` pattern used in
	 * `runtime/daemon/session-log.ts` for cross-call serialization.
	 */
	private async withAgentRegistrationLock<T>(
		agentId: string,
		fn: () => Promise<T>,
	): Promise<T> {
		const prev = this.registrationLocks.get(agentId) ?? Promise.resolve();
		let release!: () => void;
		const myLock = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.registrationLocks.set(
			agentId,
			prev.then(() => myLock).catch(() => undefined),
		);
		try {
			await prev;
		} catch {
			// Previous holder rejected; claim the lock anyway.
		}
		try {
			return await fn();
		} finally {
			release();
			// Best-effort GC of the lock map entry once everyone behind us
			// has drained. Safe to leave entries around — they're cheap
			// promises.
			if (this.registrationLocks.get(agentId) === myLock) {
				this.registrationLocks.delete(agentId);
			}
		}
	}

	/**
	 * Per-parentHandleId mutex (IMPORTANT #4). Held for the entire
	 * `spawnSubagent` block AND the `shutdownAgentInternal` block of
	 * the parent so cascade tearing-down cannot interleave with child
	 * insertion. Same chain pattern as `withAgentRegistrationLock`.
	 */
	private async withParentLock<T>(
		parentHandleId: string,
		fn: () => Promise<T>,
	): Promise<T> {
		const prev = this.parentLocks.get(parentHandleId) ?? Promise.resolve();
		let release!: () => void;
		const myLock = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.parentLocks.set(
			parentHandleId,
			prev.then(() => myLock).catch(() => undefined),
		);
		try {
			await prev;
		} catch {
			// Previous holder rejected; claim the lock anyway.
		}
		try {
			return await fn();
		} finally {
			release();
			if (this.parentLocks.get(parentHandleId) === myLock) {
				this.parentLocks.delete(parentHandleId);
			}
		}
	}

	/**
	 * Throws `AgentIdAlreadyRegisteredError` if an `agentId` is registered
	 * in a different org. Same-org re-registration is permitted (a
	 * higher layer may legitimately re-register an idle agent under the
	 * same identity). Walks in-memory first, then on-disk records.
	 */
	private async assertAgentIdAvailable(
		agentId: string,
		attemptedOrg: string | null,
	): Promise<void> {
		// In-memory check
		for (const tracked of this.handles.values()) {
			if (tracked.handle.agentId !== agentId) continue;
			const existingOrg = tracked.org;
			if (existingOrg !== attemptedOrg) {
				throw new AgentIdAlreadyRegisteredError(
					agentId,
					existingOrg,
					attemptedOrg,
				);
			}
		}

		// On-disk scan
		const dir = pathFor("agents");
		let entries: string[];
		try {
			entries = await fsp.readdir(dir);
		} catch (err) {
			if (getErrnoCode(err) === "ENOENT") return;
			throw err;
		}
		for (const entry of entries) {
			if (!entry.endsWith(".json")) continue;
			let raw: string;
			try {
				raw = await fsp.readFile(path.join(dir, entry), "utf8");
			} catch {
				continue;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				continue;
			}
			if (
				typeof parsed !== "object" ||
				parsed === null ||
				(parsed as { agentId?: unknown }).agentId !== agentId
			) {
				continue;
			}
			const orgVal = (parsed as { org?: unknown }).org;
			const existingOrg = typeof orgVal === "string" ? orgVal : null;
			if (existingOrg !== attemptedOrg) {
				throw new AgentIdAlreadyRegisteredError(
					agentId,
					existingOrg,
					attemptedOrg,
				);
			}
		}
	}

	private teardown(handleId: string): void {
		const tracked = this.handles.get(handleId);
		if (tracked === undefined) return;
		try {
			tracked.unsubscribe();
		} catch {
			// Unsubscribe MUST be idempotent; swallow.
		}
		if (this.heartbeat !== undefined) {
			this.heartbeat.unregister(handleId);
		}
		this.handles.delete(handleId);
		this.parentChildren.delete(handleId);
		// Children of this handle stay tracked separately — the cascade is
		// fired from handleStatusChange when the parent emits exited/crashed.
	}

	// ============================================================
	// Plan 07b: tasks/pending polling loop + claimTask
	// ============================================================

	/**
	 * Atomically move a pending task file to `tasks/resolved/` and emit the
	 * `'task-resolved'` EventEmitter event + telemetry. The event is the
	 * decrement hook CronScheduler (07a) subscribes to — without it,
	 * `runningCount` only grows and `maxConcurrent` permanently blocks
	 * after the first cron-fire.
	 *
	 * Failure handling (stress-test I2): `fs.rename` errors are caught and
	 * surfaced as `claim-task-failed` telemetry. The file is left in
	 * `tasks/pending/` so the next polling tick retries; `task-resolved`
	 * is NOT emitted, so the cron `runningCount` stays elevated. Sustained
	 * filesystem faults eventually surface as `cron-overlap-prevented` —
	 * the operator should investigate the upstream `claim-task-failed`
	 * events first.
	 *
	 * **Scope note (Plan 07b):** claimTask is decrement-only — it moves
	 * pending→resolved + emits task-resolved so CronScheduler can release
	 * its slot. It does NOT dispatch the task content to a registered agent
	 * runtime; that dispatch logic is deferred to Plan 04b Task 3
	 * (`wireAgentManagerIntoStartDaemon`) which will subscribe a real
	 * dispatch handler to the agent registry's runtime channel. A Codex
	 * adversarial pass on PR #64 correctly flagged the absence of dispatch
	 * as a design gap; this is documented intentional scope, not an
	 * implementation bug.
	 */
	async claimTask(filename: string, agentId: string): Promise<boolean> {
		assertSafeIdentifier(filename, "filename");
		assertSafeIdentifier(agentId, "agentId");
		const src = path.join(pathFor("tasks/pending"), filename);
		const dst = path.join(pathFor("tasks/resolved"), filename);
		try {
			await fsp.rename(src, dst);
		} catch (err) {
			const errno = getErrnoCode(err);
			const message = err instanceof Error ? err.message : String(err);
			await emitTelemetry({
				kind: "claim-task-failed",
				agentId,
				filename,
				errno,
				message,
			});
			// R1 dual-adversarial pass#2 Critical fix: REPORT the rename failure to
			// the caller (was silently `return`). The pr-triage send path claims the
			// envelope BEFORE the irreversible Telegram send and uses this boolean to
			// decide whether to send — so a failed claim must be observable, not
			// swallowed. Callers that ignore the return (dispatch / noSend / alert
			// paths) are unaffected: those paths have no external side effect.
			return false;
		}
		await emitTelemetry({ kind: "task-resolved", agentId, filename });
		// EventEmitter emit comes AFTER telemetry so a subscriber crash
		// does not lose the audit trail. The cron-scheduler listener is
		// synchronous; if it throws, EventEmitter will surface that to the
		// caller — but the file is already moved and telemetry already
		// flushed, so the only observable side-effect is the throw.
		this.emit("task-resolved", { agentId, filename });
		// The envelope was durably moved pending→resolved.
		return true;
	}

	/**
	 * Start the `tasks/pending/` polling loop (Plan 07b — deferred from
	 * Phase 1 Plan 07 stress-test M3). Every `intervalMs` (default 5s),
	 * the loop:
	 *
	 *   1. `fs.readdir(pathFor('tasks/pending'))`, filter to `.json`
	 *      (skip `.tmp` mid-rename files per C1 stress-test fix).
	 *   2. Sort ascending by name (unix timestamp embedded in filename
	 *      gives FIFO order).
	 *   3. For each file:
	 *        a. `JSON.parse` → malformed → move to `tasks/poisoned/`,
	 *           emit `task-poisoned` (EventEmitter + telemetry).
	 *        b. Inspect `agentId` field → unregistered → leave in pending,
	 *           emit `task-unrouted` once per filename (in-memory Set
	 *           suppression; cap 1000 per C2; `stopPollingLoop` clears).
	 *        c. Registered → `claimTask(filename, agentId)` → atomic
	 *           rename + `task-resolved` emit.
	 *
	 * Boolean re-entrancy guard: a tick that overruns the interval skips
	 * the next firing instead of overlapping. Tick exceptions are caught
	 * and surfaced as `polling-loop-error` telemetry; the interval
	 * continues. `stopPollingLoop()` clears the interval AND awaits any
	 * in-flight tick.
	 *
	 * The wire-up (calling `startPollingLoop()` from `startDaemon`) is
	 * Plan 04b Task 3's responsibility — this method only owns the loop
	 * mechanics.
	 */
	startPollingLoop(opts?: { intervalMs?: number }): void {
		if (this.pollingInterval !== null) return;
		if (this.pollingStopped) {
			throw new Error(
				"AgentManager.startPollingLoop() called after stopPollingLoop(); construct a fresh instance",
			);
		}
		const intervalMs =
			typeof opts?.intervalMs === "number" && opts.intervalMs > 0
				? opts.intervalMs
				: 5_000;
		this.pollingInterval = setInterval(() => {
			void this.runPollingTickGuarded();
		}, intervalMs);
		// `unref` so the interval does not pin the Node event loop if a
		// test forgets to call `stopPollingLoop()`. Production daemon has
		// its own keepalive sources.
		if (typeof this.pollingInterval.unref === "function") {
			this.pollingInterval.unref();
		}
	}

	/**
	 * Stop the polling loop. Clears the interval, awaits any in-flight
	 * tick, and clears the unrouted-suppression set (so a future
	 * `startPollingLoop()` on a fresh instance re-emits `task-unrouted`).
	 */
	async stopPollingLoop(): Promise<void> {
		this.pollingStopped = true;
		if (this.pollingInterval !== null) {
			clearInterval(this.pollingInterval);
			this.pollingInterval = null;
		}
		if (this.pollingTickInFlight !== null) {
			try {
				await this.pollingTickInFlight;
			} catch {
				// Already surfaced via telemetry.
			}
		}
		this.unroutedSet.clear();
		this.unroutedSetOverflowed = false;
		this.jsonParseRetries.clear();
	}

	/**
	 * Test-only: synchronously fire a polling tick and await it. Allows
	 * tests to drive the loop deterministically without running the
	 * actual `setInterval`. @internal
	 */
	async _pollingTickForTests(): Promise<void> {
		await this.runPollingTickGuarded();
	}

	private async runPollingTickGuarded(): Promise<void> {
		if (this.pollingTickInFlight !== null) return;
		const p = this.runPollingTick();
		this.pollingTickInFlight = p;
		try {
			await p;
		} finally {
			this.pollingTickInFlight = null;
		}
	}

	private async runPollingTick(): Promise<void> {
		const pendingDir = pathFor("tasks/pending");
		let entries: string[];
		try {
			entries = await fsp.readdir(pendingDir);
		} catch (err) {
			const errno = getErrnoCode(err);
			if (errno === "ENOENT") return;
			const message = err instanceof Error ? err.message : String(err);
			await emitTelemetry({
				kind: "polling-loop-error",
				errno,
				message,
			});
			return;
		}
		// C1 stress-test fix: only process `.json` files. During the
		// tmp-rename window the file is named `.<...>.tmp` and only renames
		// to `.json` atomically; skipping non-`.json` filenames prevents
		// half-written JSON.parse failures.
		const jsonFiles = entries.filter((f) => f.endsWith(".json")).sort();
		for (const filename of jsonFiles) {
			try {
				await this.processPendingTask(filename);
			} catch (err) {
				const errno = getErrnoCode(err);
				const message = err instanceof Error ? err.message : String(err);
				await emitTelemetry({
					kind: "polling-loop-error",
					errno,
					message: `processPendingTask(${filename}): ${message}`,
				});
			}
		}
	}

	/**
	 * Process a single task file from `tasks/pending/`.
	 *
	 * Plan 04d contract change: between the `isAgentRegistered(agentId)`
	 * check and the `claimTask(filename, agentId)` call, the polling loop
	 * emits a `'task-dispatch-needed'` EventEmitter event when one or more
	 * listeners are subscribed. The listener owns the dispatch lifecycle
	 * (forward prompt to the persistent runtime, optionally await
	 * completion if the runtime adapter exposes a signal) and is
	 * responsible for calling `claimTask` itself. The current Shape 1
	 * PTY adapter is persistent (pre-registered at daemon startup) and
	 * has no per-task completion signal, so the live handler claims on
	 * send-return — see `makeTaskDispatchHandler` JSDoc for the full
	 * claim-on-send rationale and the conditions under which await-exit
	 * semantics would reappear.
	 *
	 * Dual-adversarial C-2 fix: when NO listener is subscribed,
	 * `processPendingTask` no longer falls through to `claimTask`. It
	 * emits `pr-triage-dispatch-failed { reason: "no-listener" }` and
	 * leaves the file in `tasks/pending/` for the next tick. The
	 * previous fallback was a Phase 2 stress-test artifact and silently
	 * advanced cron-fired tasks to `resolved/` during the shutdown
	 * removeListener→stopPollingLoop window — a real data-loss path on
	 * every deploy that coincided with an in-flight task.
	 *
	 * Dual-adversarial C-1 fix: per-filename `dispatchInFlight` guard
	 * suppresses duplicate emits when a polling tick fires before the
	 * prior tick's listener resolved. The listener clears the slot via
	 * `releaseDispatchSlot` from its `finally` block.
	 *
	 * Dual-adversarial I-B fix: size-check via `fsp.stat` BEFORE
	 * `readFile` so a 10MB adversarial task does not allocate 10MB of
	 * string heap per polling tick.
	 *
	 * Dual-adversarial M-A fix: cap `agentId` at 255 chars to prevent
	 * a path-length DoS via crafted task files.
	 *
	 * I3 stress-test fix: oversized task payloads (>`TASK_PAYLOAD_MAX_BYTES`)
	 * are rejected as `task-poisoned` with reason `oversized-task` before
	 * parsing.
	 */
	private async processPendingTask(filename: string): Promise<void> {
		const pendingDir = pathFor("tasks/pending");
		const src = path.join(pendingDir, filename);
		// Dual-adversarial I-B fix: size-check via fsp.stat BEFORE readFile
		// so a 10MB+ adversarial file does not allocate 10MB+ of string
		// heap per polling tick. The original Buffer.byteLength check fired
		// AFTER the allocation, defeating the bound the cap is meant to
		// enforce.
		let stats: import("node:fs").Stats;
		try {
			stats = await fsp.stat(src);
		} catch (err) {
			const errno = getErrnoCode(err);
			if (errno === "ENOENT") {
				// Concurrent claim moved it out from under us — fine. Clear any
				// transient parse-retry tally for this filename so a file that
				// failed parse once then vanished does not leak a map entry
				// forever (M-1: unbounded jsonParseRetries growth).
				this.jsonParseRetries.delete(filename);
				return;
			}
			throw err;
		}
		if (stats.size > TASK_PAYLOAD_MAX_BYTES) {
			await this.poisonTask(filename, "oversized-task");
			return;
		}
		let raw: string;
		try {
			raw = await fsp.readFile(src, "utf8");
		} catch (err) {
			const errno = getErrnoCode(err);
			if (errno === "ENOENT") {
				// Same M-1 concern as the stat ENOENT branch above: a file that
				// failed parse once then vanished must not leak its retry tally.
				this.jsonParseRetries.delete(filename);
				return;
			}
			throw err;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (err) {
			// pr84 CRITICAL (consumer tolerance): a non-atomically-written
			// `.json` file can be caught mid-write, yielding a TRANSIENT parse
			// failure on a file that is valid microseconds later. Grant a
			// bounded grace window before poisoning so an alert envelope from a
			// producer that wrote the final path directly is NOT permanently
			// lost. The file stays in `pending/` and is re-read next tick; only
			// once the per-filename failure count exceeds JSON_PARSE_RETRY_BUDGET
			// is the file poisoned as genuinely malformed.
			const priorFailures = this.jsonParseRetries.get(filename) ?? 0;
			if (priorFailures < JSON_PARSE_RETRY_BUDGET) {
				this.jsonParseRetries.set(filename, priorFailures + 1);
				return;
			}
			this.jsonParseRetries.delete(filename);
			await this.poisonTask(filename, "json-parse-error", getErrnoCode(err));
			return;
		}
		// Parse succeeded — clear any transient-failure tally for this file.
		this.jsonParseRetries.delete(filename);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			typeof (parsed as { agentId?: unknown }).agentId !== "string"
		) {
			await this.poisonTask(filename, "missing-agent-id");
			return;
		}
		const agentId = (parsed as { agentId: string }).agentId;
		// Dual-adversarial M-A fix: cap agentId length BEFORE
		// `isAgentRegistered` to prevent a path-length DoS via crafted
		// task files. The map lookup is bounded but downstream consumers
		// (filenames, log lines, telemetry) are not.
		if (agentId.length > 255) {
			await this.poisonTask(filename, "missing-agent-id");
			return;
		}
		// pr84-gap-closure (Codex H1): an `ndjsonAlert` envelope is a
		// record-and-resolve signal, NOT a prompt task. RETIRED under R1 — the
		// pr-triage agent no longer emits `ndjsonAlert`: it writes
		// `pr-triage-send__` {sendText|noSend} envelopes and the DAEMON owns
		// send-failure handling (makeTaskSendHandler). This branch is now INERT
		// (no current producer) and kept only as defensive handling. It needs no
		// live handle and must NEVER reach
		// the dispatch path — falling through would mis-classify the
		// prompt-less envelope as `malformed-task`. Branch here, BEFORE the
		// `isAgentRegistered` check, so the alert resolves even if the agent
		// is (de)registered. Emit telemetry BEFORE `claimTask` so a rename
		// failure leaves the file in pending/ and the alert re-trips next
		// tick rather than being lost.
		//
		// Codex H1 follow-up (un-scoped-bypass close): `tasks/pending/` is the
		// GENERIC bus shared by ALL agents. Treating ANY non-empty `ndjsonAlert`
		// on ANY task as a terminal alert let a malformed/adversarial task for
		// another (or unregistered) agent skip runtime execution and still get
		// silently resolved — possibly releasing a cron slot it doesn't own.
		// The branch now fires ONLY when ALL of: (a) `agentId === "pr-triage"`
		// (the sole producer today; daemon-owned, not self-declared),
		// (b) the alert kind is in the daemon-owned `PR_TRIAGE_ALERT_KINDS`
		// set, and (c) there is NO non-empty `prompt` field (a real alert
		// envelope is prompt-less). Any other shape (alert for a different
		// agent, unknown kind, or prompt+alert combined) FALLS THROUGH to the
		// existing handling (registration check / dispatch / poison).
		const ndjsonAlert = (parsed as { ndjsonAlert?: unknown }).ndjsonAlert;
		const alertPromptRaw = (parsed as { prompt?: unknown }).prompt;
		const alertHasPrompt =
			typeof alertPromptRaw === "string" && alertPromptRaw.length > 0;
		// I-3 (dual-adversarial pass #2): ALSO require the FILENAME to match
		// the pr-triage producer convention (`pr-triage__<ts>-<pid>.json`, see
		// prompt-template.md). `tasks/pending/` is the GENERIC bus shared by all
		// agents; without a filename-provenance check, a foreign producer's file
		// whose BODY is shaped like a pr-triage alert would be silently
		// record-and-resolved here, destroying the real producer's signal (data
		// loss). A `rogue-agent__*.json` with a pr-triage body now FALLS THROUGH
		// to normal routing (registration check / dispatch / unrouted).
		if (
			agentId === "pr-triage" &&
			filename.startsWith("pr-triage__") &&
			typeof ndjsonAlert === "string" &&
			PR_TRIAGE_ALERT_KINDS.has(ndjsonAlert) &&
			!alertHasPrompt
		) {
			const detailsRaw = (parsed as { details?: unknown }).details;
			const details = typeof detailsRaw === "string" ? detailsRaw : "";
			// Codex Medium (durability): `emitTelemetry` swallows append
			// failures and returns `false` on a degraded telemetry dir
			// (ENOSPC/EACCES). Resolve the fallback-alert file ONLY when its
			// record durably landed — otherwise leave it in `pending/` so the
			// alert re-trips next tick instead of being silently resolved
			// without ever surfacing the double-failure signal.
			const recorded = await emitTelemetry({
				kind: "pr-triage-telegram-send-failed",
				agentId,
				filename,
				alertKind: ndjsonAlert,
				details,
			});
			if (recorded) {
				await this.claimTask(filename, agentId);
			}
			return;
		}
		// R1 (feature-pr84-r1-daemon-creds, D2) — a pr-triage RESULT envelope is
		// a record-and-send signal, NOT a prompt task. The agent (a pure
		// data-in → text-out transform) writes `{ agentId: "pr-triage",
		// sendText: "<summary>" }` (or `{ agentId: "pr-triage", noSend: true }`)
		// to `tasks/pending/` and the DAEMON owns the Telegram send. Like the
		// ndjsonAlert branch above, this needs no live handle and must NEVER
		// reach the dispatch path (a prompt-less `{sendText}` envelope would be
		// mis-classified as `malformed-task` at main.ts:661-677).
		//
		// Provenance guard (mirrors I-3): `tasks/pending/` is the GENERIC bus
		// shared by all agents. The branch fires ONLY when ALL of:
		//   (a) `agentId === "pr-triage"` (the sole producer),
		//   (b) the filename uses the DISTINCT `pr-triage-send__` prefix — NOT
		//       `pr-triage__` (which the alert branch owns), so a foreign
		//       `rogue-agent__*.json` with a `sendText` body CANNOT trigger a
		//       daemon send,
		//   (c) the discriminator is present (`sendText` is a string OR
		//       `noSend === true`), and
		//   (d) there is NO non-empty `prompt` field.
		// Any other shape falls through to the registration/dispatch/poison
		// path. The actual send + dead-letter timer live in main.ts's
		// `task-send-needed` handler (it owns the TelegramBot + clearResultTimer).
		const sendTextRaw = (parsed as { sendText?: unknown }).sendText;
		const noSendRaw = (parsed as { noSend?: unknown }).noSend;
		const sendPromptRaw = (parsed as { prompt?: unknown }).prompt;
		const sendHasPrompt =
			typeof sendPromptRaw === "string" && sendPromptRaw.length > 0;
		const hasSendText = typeof sendTextRaw === "string";
		const isNoSend = noSendRaw === true;
		// Critical (Codex, round 1) — carry the agent-echoed correlation runId
		// THROUGH to the send handler so it passes the ENVELOPE's runId (not the
		// live marker's) to `clearResultTimer`. A late/stale envelope from a prior
		// run carries the OLD runId and is rejected by the wrong-run guard. Absent
		// on a legacy envelope (handler then clears unconditionally).
		const sendRunIdRaw = (parsed as { runId?: unknown }).runId;
		const sendRunId =
			typeof sendRunIdRaw === "string" ? sendRunIdRaw : undefined;
		if (
			agentId === "pr-triage" &&
			filename.startsWith("pr-triage-send__") &&
			(hasSendText || isNoSend) &&
			!sendHasPrompt
		) {
			// R1 dual-adversarial round-1 Critical fix: per-filename in-flight
			// guard, mirroring the dispatch branch's `dispatchInFlight`. The send
			// handler claims the envelope ONLY after an awaited
			// `telegramBot.sendAgentNotification` network round-trip; the handler
			// is invoked fire-and-forget, so `processPendingTask` returns
			// immediately and the file stays in `pending/` until that claim lands.
			// Without this guard, a send slower than one polling interval would let
			// the next tick re-emit `task-send-needed` for the SAME file, firing a
			// SECOND `sendAgentNotification` → DUPLICATE Telegram notification to
			// Santiago + racing `claimTask` calls. The send listener clears the
			// slot via `releaseSendSlot` from its `finally` block.
			if (this.sendInFlight.has(filename)) {
				return;
			}
			this.sendInFlight.add(filename);
			this.emit("task-send-needed", {
				filename,
				agentId,
				...(hasSendText ? { sendText: sendTextRaw } : {}),
				...(isNoSend ? { noSend: true } : {}),
				// Critical (Codex, round 1) — forward the agent-echoed runId so the
				// send handler can run-correlate the clear. Omitted when absent.
				...(sendRunId !== undefined ? { runId: sendRunId } : {}),
			});
			return;
		}
		if (!this.isAgentRegistered(agentId)) {
			await this.emitUnrouted(filename, agentId);
			return;
		}
		// Dual-adversarial C-2 fix: REMOVED the listener-less fallback
		// that previously called `claimTask` directly when
		// `listenerCount("task-dispatch-needed") === 0`. The fallback was
		// a Plan 04d stress-test artifact (C1 backwards-compat) and
		// became a data-loss path during shutdown: when `removeListener`
		// ran before `stopPollingLoop`, an in-flight tick would observe
		// zero listeners, claim the task, and advance the file to
		// `resolved/` WITHOUT EVER DISPATCHING IT to the runtime. The
		// fix is two-pronged — drop the fallback here AND reorder
		// shutdown in `startDaemon` to drain the polling loop BEFORE
		// removing listeners. Either alone would be sufficient; both
		// together close the foot-gun for Phase 3 callers.
		if (this.listenerCount("task-dispatch-needed") === 0) {
			await emitTelemetry({
				kind: "pr-triage-dispatch-failed",
				agentId,
				filename,
				reason: "no-listener",
				message:
					"processPendingTask: no 'task-dispatch-needed' listener subscribed; task left in pending/ for retry",
			});
			return;
		}
		// Dual-adversarial C-1 fix: per-filename in-flight guard. If a
		// previous polling tick emitted dispatch for this filename and
		// the listener has not yet released its slot, suppress the
		// duplicate emit. The listener clears the slot in its `finally`
		// block via `releaseDispatchSlot`. Without this guard, a polling
		// interval shorter than the listener's runtime.send + claimTask
		// latency would emit the same prompt twice and both handlers
		// would race on `claimTask`.
		if (this.dispatchInFlight.has(filename)) {
			return;
		}
		this.dispatchInFlight.add(filename);
		// Plan 04d: hand off to dispatch listener — listener owns
		// claimTask timing.
		const taskContent: TaskDispatchPayload = {
			...(parsed as Record<string, unknown>),
			agentId,
		};
		this.emit("task-dispatch-needed", {
			filename,
			agentId,
			taskContent,
		});
	}

	/**
	 * Dual-adversarial C-1 fix: clear the per-filename in-flight guard
	 * after the dispatch handler resolves (success OR failure). MUST be
	 * called from the handler's `finally` block — otherwise the slot
	 * leaks and the next polling tick suppresses every subsequent
	 * dispatch for that filename.
	 *
	 * Public so `makeTaskDispatchHandler` (which lives in `main.ts`) can
	 * release without circular-import.
	 */
	releaseDispatchSlot(filename: string): void {
		this.dispatchInFlight.delete(filename);
	}

	/**
	 * R1 dual-adversarial round-1 Critical fix: clear the per-filename SEND
	 * in-flight guard after the send handler resolves (success OR failure). MUST
	 * be called from the handler's `finally` block — otherwise the slot leaks and
	 * the next polling tick suppresses every subsequent send for that filename
	 * (a failed send would never re-trip). The analogue of `releaseDispatchSlot`
	 * for the `task-send-needed` path.
	 *
	 * Public so `makeTaskSendHandler` (which lives in `main.ts`) can release
	 * without a circular import.
	 */
	releaseSendSlot(filename: string): void {
		this.sendInFlight.delete(filename);
	}

	private async poisonTask(
		filename: string,
		reason: "json-parse-error" | "missing-agent-id" | "oversized-task",
		errno?: string,
	): Promise<void> {
		const src = path.join(pathFor("tasks/pending"), filename);
		const dst = path.join(pathFor("tasks/poisoned"), filename);
		try {
			await fsp.mkdir(pathFor("tasks/poisoned"), { recursive: true });
			await fsp.rename(src, dst);
		} catch (err) {
			const moveErrno = getErrnoCode(err);
			const message = err instanceof Error ? err.message : String(err);
			// Mirror claimTask's failure shape so operators get the same
			// taxonomy. The file stays in pending; the polling loop will
			// re-trip on it next tick — that's acceptable because the
			// surrounding `polling-loop-error` catch will surface the
			// repeated failure.
			await emitTelemetry({
				kind: "polling-loop-error",
				errno: moveErrno,
				message: `poisonTask(${filename}): ${message}`,
			});
			return;
		}
		await emitTelemetry({
			kind: "task-poisoned",
			filename,
			reason,
			errno,
		});
		// EventEmitter emit so cron-scheduler can release the slot if this
		// poisoned file was cron-fired. Extract agentId from the cron filename
		// convention (<agentId>__<unix>.json); fall back to "(unknown)" for
		// files that don't follow the convention (no cron slot to release).
		const separatorIdx = filename.indexOf("__");
		const derivedAgentId =
			separatorIdx > 0 ? filename.slice(0, separatorIdx) : "(unknown)";
		this.emit("task-poisoned", { agentId: derivedAgentId, filename });
	}

	private async emitUnrouted(filename: string, agentId: string): Promise<void> {
		if (this.unroutedSet.has(filename)) {
			// Already emitted for this filename — suppress.
			return;
		}
		if (this.unroutedSet.size >= this.unroutedSetCap) {
			// C2 stress-test fix: cap the suppression set at `unroutedSetCap`
			// (default 1000). On overflow, emit a single overflow telemetry
			// event (one-time flag) and continue without further suppression.
			// From this point until `stopPollingLoop()`, every unrouted file
			// will emit `task-unrouted` on every tick (deliberately lossy —
			// the operator should be looking at the overflow event first).
			if (!this.unroutedSetOverflowed) {
				this.unroutedSetOverflowed = true;
				await emitTelemetry({
					kind: "task-unrouted-set-overflow",
					cap: this.unroutedSetCap,
				});
			}
			// Still emit task-unrouted for this filename (no suppression).
			await emitTelemetry({ kind: "task-unrouted", filename, agentId });
			this.emit("task-unrouted", { agentId, filename });
			return;
		}
		this.unroutedSet.add(filename);
		await emitTelemetry({ kind: "task-unrouted", filename, agentId });
		this.emit("task-unrouted", { agentId, filename });
	}

	private isAgentRegistered(agentId: string): boolean {
		for (const tracked of this.handles.values()) {
			if (tracked.handle.agentId === agentId) return true;
		}
		return false;
	}

	/**
	 * Test-only: shrink the unroutedSet cap so PL-6 can exercise the
	 * overflow path without writing 1001 task files (prohibitively slow on
	 * Windows). Not part of the public API.
	 */
	_setUnroutedSetCapForTests(n: number): void {
		this.unroutedSetCap = n;
	}
}
