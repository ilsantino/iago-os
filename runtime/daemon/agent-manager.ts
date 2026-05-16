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
} from "./session-log.js";
import { assertSafeIdentifier, getErrnoCode, pathFor } from "./state-paths.js";

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

export class AgentManager {
	private readonly heartbeat: HeartbeatController | undefined;
	private readonly handles = new Map<string, TrackedHandle>();
	private readonly parentChildren = new Map<string, Set<string>>();
	// In-flight restart promises keyed by handleId. Concurrent
	// `restartAgent` calls receive the same promise — eliminates the
	// teardown→track window where a guard could throw (M1).
	private readonly restartingPromises = new Map<string, Promise<AgentHandle>>();
	private bootRecoveryRan = false;
	private cachedBootRecovery: BootRecoveryResult | null = null;
	// Same promise-capture pattern as restartingPromises: assigned synchronously
	// before the first await so concurrent callers share a single in-flight run.
	private bootRecoveryPromise: Promise<BootRecoveryResult> | null = null;

	constructor(opts?: AgentManagerOpts) {
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

	async registerAgent(config: RegisterAgentConfig): Promise<AgentHandle> {
		assertSafeIdentifier(config.agentId, "agentId");
		assertSafeIdentifier(config.sessionId, "sessionId");
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
		await this.persistAgentConfig(handle.id, config);
		return handle;
	}

	getHandle(handleId: string): AgentHandle | undefined {
		return this.handles.get(handleId)?.handle;
	}

	listHandles(): AgentHandle[] {
		return Array.from(this.handles.values()).map((t) => t.handle);
	}

	async shutdownAgent(
		handleId: string,
		signal: "SIGTERM" | "SIGKILL" = "SIGTERM",
	): Promise<void> {
		const tracked = this.handles.get(handleId);
		if (tracked === undefined) return;
		// Write graceful marker BEFORE calling runtime.shutdown — absent
		// marker on next boot means crash.
		await writeStopMarker(handleId, "graceful");
		// Cascade children BEFORE invoking the adapter's shutdown. Some
		// adapters do not emit a terminal `exited`/`crashed` status
		// callback on shutdown, so the status-driven cascade in
		// `handleStatusChange` would never fire and child handles would
		// orphan. Explicit cascade here makes the cleanup independent of
		// adapter callback semantics.
		await this.cascadeShutdownChildren(handleId);
		try {
			await tracked.runtime.shutdown(tracked.handle, signal);
		} finally {
			this.teardown(handleId);
		}
	}

	async restartAgent(
		handleId: string,
		reason: ForceRestartReason | "crash",
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
		const promise = this.doRestart(handleId, reason, existing);
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
	): Promise<AgentHandle> {
		const markerReason: StopMarkerReason =
			reason === "crash" || reason === "dead" ? "crash" : "recycle";
		await writeStopMarker(handleId, markerReason);
		// Cascade children BEFORE the parent shutdown so they are torn
		// down cleanly even when the adapter does not emit a terminal
		// callback. Restart breaks parent identity (new handle id, new
		// generation token), so the application layer must respawn
		// children against the new parent — silently re-linking to a
		// stale id would mask resource leaks.
		await this.cascadeShutdownChildren(handleId);
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

		// Re-spawn with the SAME sessionId so session.jsonl is continuous.
		const freshHandle = await existing.runtime.spawn(existing.spawnOpts);
		const newGeneration: AgentHandle = {
			...freshHandle,
			generationToken: existing.handle.generationToken + 1,
		};
		await this.trackHandle({
			handle: newGeneration,
			runtime: existing.runtime,
			spawnOpts: existing.spawnOpts,
			config: existing.config,
			org: existing.org,
			parentHandleId: existing.parentHandleId,
		});
		return newGeneration;
	}

	async spawnSubagent(opts: SpawnSubagentOpts): Promise<AgentHandle> {
		const parent = this.handles.get(opts.parentHandleId);
		if (parent === undefined) {
			throw new Error(`Parent handle not registered: ${opts.parentHandleId}`);
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
		this.bootRecoveryPromise = (async () => {
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
			const recoveredId = await this.attemptCrashReplay(handleId, knownConfigs);
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
		// bootRecoveryPromise was just assigned above; non-null assertion is safe.
		return this.bootRecoveryPromise!;
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
				// Prefer the adapter's richer `getStatus` when present so
				// the heartbeat actually receives RSS for recycle-policy
				// evaluation. Without this branch the rssLimitBytes gate
				// is permanently inert and 512MB recycling never fires.
				if (typeof runtime.getStatus === "function") {
					try {
						const status = await runtime.getStatus(handle);
						return {
							alive: status.alive,
							lastStatusChangeMs: current.lastStatusChangeMs,
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
					lastStatusChangeMs: current.lastStatusChangeMs,
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
			await this.cascadeShutdownChildren(handleId);
		}
	}

	private async cascadeShutdownChildren(parentId: string): Promise<void> {
		const children = this.parentChildren.get(parentId);
		if (children === undefined) return;
		const toShutdown = Array.from(children);
		this.parentChildren.delete(parentId);
		for (const childId of toShutdown) {
			try {
				await this.shutdownAgent(childId, "SIGTERM");
			} catch (err) {
				console.error(
					`[agent-manager] cascade shutdown of ${childId} (parent ${parentId}) failed: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
		}
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

		const runtime = resolveRuntime(cfg.runtimeId);
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
	 * Filter session-log events for the replay re-feed loop. Only
	 * `prompt` and `inject` AgentMessages are replayed; `approval`,
	 * `abort`, and `custom` are application-level. Status events
	 * (`kind: "status"`) are observational and never replayed.
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
		return null;
	}

	private async persistAgentConfig(
		handleId: string,
		config: RegisterAgentConfig,
	): Promise<void> {
		const dir = pathFor("agents");
		const file = path.join(dir, `${handleId}.json`);
		const payload = {
			agentId: config.agentId,
			runtimeId: config.runtimeId,
			org: config.org ?? null,
			cwd: config.cwd,
			sessionId: config.sessionId,
			// env intentionally omitted — avoids persisting AWS_* / IAGO_*
			// credentials on disk; knownConfigs must supply env at boot
			// recovery time (see daemon/README.md "Boot recovery" section).
		};
		try {
			await fsp.writeFile(file, JSON.stringify(payload));
		} catch (err) {
			console.error(
				`[agent-manager] persistAgentConfig for ${handleId} failed: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
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
}
