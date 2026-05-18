/**
 * AgentRuntime polymorphic interface + module-scope registry.
 *
 * Daemon boot sequence: each adapter module side-effects `registerRuntime()`
 * at import time. The daemon entry point (Phase 1 Plan 07) is responsible
 * for wrapping adapter imports in try/catch to enforce the fail-isolated
 * policy — a single adapter that throws at registerRuntime() must not crash
 * the daemon; the daemon logs the failed adapter and continues with the
 * remaining registered runtimes. The registry layer ITSELF throws on
 * invalid registration; the isolation belongs to the importer.
 *
 * Interface versioning: every AgentRuntime declares `interfaceVersion: "v1"`.
 * The registry rejects any other value at registration. Future major bumps
 * land via RuntimeAdapterShim (Phase 3+ concern) — adapters do not migrate
 * in place.
 */

import {
	type AgentHandle,
	type AgentMessage,
	type AgentShape,
	type CostEvent,
	INTERFACE_VERSION,
	type InterfaceVersion,
	type SpawnOpts,
	type StatusCallback,
} from "./types.js";

const VALID_SHAPES: ReadonlySet<AgentShape> = new Set<AgentShape>([
	"pty",
	"http",
	"mcp",
	"event",
	"daemon",
]);

const REQUIRED_METHODS = [
	"spawn",
	"send",
	"onStatusChanged",
	"isAlive",
	"shutdown",
	"restoreFromMarker",
] as const;

export interface AgentRuntime {
	readonly shape: AgentShape;
	readonly id: string;
	readonly version: string;
	readonly interfaceVersion: InterfaceVersion;

	/**
	 * Spawn a fresh handle. If `opts.restoreId` is supplied, the returned
	 * `AgentHandle.id` MUST equal `opts.restoreId` exactly — caller
	 * (typically `AgentManager.restartAgent`) is preserving id stability
	 * across restart. Adapters that mint ids externally and cannot honor
	 * a caller-supplied id MUST throw rather than substitute a fresh id;
	 * silent substitution re-introduces the concurrent-restart
	 * staleness bug (review CRITICAL #3 of PR #42 adversarial pass).
	 */
	spawn(opts: SpawnOpts): Promise<AgentHandle>;
	send(handle: AgentHandle, message: AgentMessage): Promise<void>;
	/**
	 * Subscribe to status transitions for `handle`. The returned function
	 * unsubscribes the callback. Callers MUST invoke it when the
	 * subscription is no longer needed; failure to do so leaks the listener
	 * for the lifetime of the handle.
	 */
	onStatusChanged(handle: AgentHandle, cb: StatusCallback): () => void;
	isAlive(handle: AgentHandle): Promise<boolean>;
	/**
	 * Optional richer status probe. When present, `AgentManager` calls this
	 * from the heartbeat probe in preference to `isAlive()` so the
	 * `HeartbeatController` can evaluate the 512MB RSS recycle threshold
	 * (Plan 03 PR2: the heartbeat OWNS recycling decisions; adapters
	 * supply the data). Adapters that cannot measure RSS may omit this
	 * method or return `rssBytes: undefined`; recycling on RSS is then a
	 * no-op for that adapter and stall/liveness-only recycling still
	 * applies.
	 */
	getStatus?(
		handle: AgentHandle,
	): Promise<{ alive: boolean; rssBytes?: number }>;
	shutdown(handle: AgentHandle, signal?: "SIGTERM" | "SIGKILL"): Promise<void>;
	restoreFromMarker(markerPath: string): Promise<AgentHandle | null>;
	costTap?(handle: AgentHandle): AsyncIterable<CostEvent>;
}

const registry = new Map<string, AgentRuntime>();

export function registerRuntime(rt: AgentRuntime): void {
	if (registry.has(rt.id)) {
		throw new Error(
			`AgentRuntime registration failed: id "${rt.id}" is already registered`,
		);
	}

	if (rt.interfaceVersion !== INTERFACE_VERSION) {
		throw new Error(
			`AgentRuntime registration failed: unsupported interfaceVersion "${String(
				rt.interfaceVersion,
			)}" for id "${rt.id}" — expected "${INTERFACE_VERSION}"`,
		);
	}

	if (!VALID_SHAPES.has(rt.shape)) {
		throw new Error(
			`AgentRuntime registration failed: invalid shape "${String(
				rt.shape,
			)}" for id "${rt.id}" — expected one of ${[...VALID_SHAPES].join(", ")}`,
		);
	}

	/**
	 * Structural probe via property descriptors instead of `Reflect.get` so a
	 * hostile adapter exposing a getter cannot run arbitrary code during
	 * registration — the probe stays purely introspective. We walk the own
	 * properties first, then the prototype chain (most adapters define methods
	 * on a class prototype, not as own properties); a descriptor whose `value`
	 * is a function counts as a valid method. Accessor descriptors (getters)
	 * are intentionally rejected so the registry never invokes adapter code
	 * during shape validation.
	 */
	for (const method of REQUIRED_METHODS) {
		let desc = Object.getOwnPropertyDescriptor(rt, method);
		if (desc === undefined) {
			let proto: object | null = Object.getPrototypeOf(rt);
			while (proto !== null && desc === undefined) {
				desc = Object.getOwnPropertyDescriptor(proto, method);
				proto = Object.getPrototypeOf(proto);
			}
		}
		if (desc === undefined || typeof desc.value !== "function") {
			throw new Error(
				`AgentRuntime registration failed: missing required method "${method}" on id "${rt.id}"`,
			);
		}
	}

	registry.set(rt.id, rt);
}

export function resolveRuntime(id: string): AgentRuntime {
	const rt = registry.get(id);
	if (rt === undefined) {
		throw new Error(`No AgentRuntime registered for id: ${id}`);
	}
	return rt;
}

/**
 * Returns a frozen snapshot of every registered runtime. Each element AND the
 * outer array are `Object.freeze`d so callers cannot mutate the snapshot or
 * the registry through it. Use the snapshot as a read-only inspection
 * surface; mutations MUST go through `registerRuntime` or
 * `_resetRegistryForTests` (test-only). The return type intentionally widens
 * to `ReadonlyArray<Readonly<...>>` so the immutability shows up in callers'
 * TypeScript checks, not just at runtime.
 */
export function listRuntimes(): ReadonlyArray<
	Readonly<{ id: string; shape: AgentShape; version: string }>
> {
	const out: Array<
		Readonly<{ id: string; shape: AgentShape; version: string }>
	> = [];
	for (const rt of registry.values()) {
		out.push(Object.freeze({ id: rt.id, shape: rt.shape, version: rt.version }));
	}
	return Object.freeze(out);
}

/**
 * Test-only registry reset. The underscore prefix marks it as test
 * infrastructure — do not re-export from any barrel `index.ts`, do not call
 * from production code paths. As defense-in-depth the function throws when
 * `NODE_ENV === "production"` so an accidental public-API surface leak still
 * cannot blow away the registry at runtime.
 */
export function _resetRegistryForTests(): void {
	if (process.env.NODE_ENV === "production") {
		throw new Error("_resetRegistryForTests cannot run in production");
	}
	registry.clear();
}
