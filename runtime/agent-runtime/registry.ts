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

import type {
	AgentHandle,
	AgentMessage,
	AgentShape,
	CostEvent,
	InterfaceVersion,
	SpawnOpts,
	StatusCallback,
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

function isFunction(value: unknown): boolean {
	return typeof value === "function";
}

export function registerRuntime(rt: AgentRuntime): void {
	if (registry.has(rt.id)) {
		throw new Error(
			`AgentRuntime registration failed: id "${rt.id}" is already registered`,
		);
	}

	if (rt.interfaceVersion !== "v1") {
		throw new Error(
			`AgentRuntime registration failed: unsupported interfaceVersion "${String(
				rt.interfaceVersion,
			)}" for id "${rt.id}" — expected "v1"`,
		);
	}

	if (!VALID_SHAPES.has(rt.shape)) {
		throw new Error(
			`AgentRuntime registration failed: invalid shape "${String(
				rt.shape,
			)}" for id "${rt.id}" — expected one of ${[...VALID_SHAPES].join(", ")}`,
		);
	}

	for (const method of REQUIRED_METHODS) {
		const candidate = Reflect.get(rt, method);
		if (!isFunction(candidate)) {
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

export function listRuntimes(): ReadonlyArray<{
	id: string;
	shape: AgentShape;
	version: string;
}> {
	const out: Array<{ id: string; shape: AgentShape; version: string }> = [];
	for (const rt of registry.values()) {
		out.push({ id: rt.id, shape: rt.shape, version: rt.version });
	}
	return out;
}

/**
 * Test-only registry reset. The underscore prefix marks it as test
 * infrastructure — do not re-export from any barrel `index.ts`, do not call
 * from production code paths.
 */
export function _resetRegistryForTests(): void {
	registry.clear();
}
