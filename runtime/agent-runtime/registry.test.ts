import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type AgentRuntime,
	_resetRegistryForTests,
	listRuntimes,
	registerRuntime,
	resolveRuntime,
} from "./registry.js";
import {
	type AgentHandle,
	type AgentMessage,
	INTERFACE_VERSION,
	type StatusCallback,
} from "./types.js";

function makeHandle(): AgentHandle {
	return {
		id: "h-1",
		runtime: "fixture",
		shape: "pty",
		agentId: "a-1",
		sessionId: "s-1",
		generationToken: 1,
		spawnedAt: 0,
		markerPath: "/tmp/marker",
	};
}

function makeValidRuntime(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
	const base: AgentRuntime = {
		shape: "pty",
		id: "fixture-pty",
		version: "0.0.1",
		interfaceVersion: "v1",
		spawn: async () => makeHandle(),
		send: async (_h: AgentHandle, _m: AgentMessage) => {},
		onStatusChanged: (_h: AgentHandle, _cb: StatusCallback) => () => {},
		isAlive: async () => true,
		shutdown: async () => {},
		restoreFromMarker: async () => null,
	};
	return { ...base, ...overrides };
}

describe("agent-runtime registry", () => {
	beforeEach(() => {
		_resetRegistryForTests();
	});

	it("registers a valid runtime and resolves it back", () => {
		const rt = makeValidRuntime();
		registerRuntime(rt);
		expect(resolveRuntime("fixture-pty")).toBe(rt);
	});

	it("rejects duplicate id", () => {
		registerRuntime(makeValidRuntime());
		expect(() => registerRuntime(makeValidRuntime())).toThrowError(
			/^AgentRuntime registration failed:/,
		);
	});

	it("rejects interfaceVersion other than the centralized INTERFACE_VERSION const", () => {
		// @ts-expect-error — registry probes at runtime; force "v2" through the type system to test the runtime guard
		const bad = makeValidRuntime({ interfaceVersion: "v2" });
		expect(() => registerRuntime(bad)).toThrowError(
			new RegExp(
				`AgentRuntime registration failed: unsupported interfaceVersion "v2"[\\s\\S]*expected "${INTERFACE_VERSION}"`,
			),
		);
	});

	it("rejects runtime missing the spawn method", () => {
		const partial = {
			shape: "pty" as const,
			id: "missing-spawn",
			version: "0.0.1",
			interfaceVersion: "v1" as const,
			send: async (_h: AgentHandle, _m: AgentMessage) => {},
			onStatusChanged: (_h: AgentHandle, _cb: StatusCallback) => () => {},
			isAlive: async () => true,
			shutdown: async () => {},
			restoreFromMarker: async () => null,
		} satisfies Partial<AgentRuntime>;
		// @ts-expect-error — intentionally missing `spawn` to exercise the runtime probe
		expect(() => registerRuntime(partial)).toThrowError(
			/missing required method "spawn"/,
		);
	});

	it("rejects runtime missing the onStatusChanged method", () => {
		const partial = {
			shape: "pty" as const,
			id: "missing-onstatus",
			version: "0.0.1",
			interfaceVersion: "v1" as const,
			spawn: async () => makeHandle(),
			send: async (_h: AgentHandle, _m: AgentMessage) => {},
			isAlive: async () => true,
			shutdown: async () => {},
			restoreFromMarker: async () => null,
		} satisfies Partial<AgentRuntime>;
		// @ts-expect-error — intentionally missing `onStatusChanged` to exercise the runtime probe
		expect(() => registerRuntime(partial)).toThrowError(
			/missing required method "onStatusChanged"/,
		);
	});

	it("rejects runtime missing the send method", () => {
		const partial = {
			shape: "pty" as const,
			id: "missing-send",
			version: "0.0.1",
			interfaceVersion: "v1" as const,
			spawn: async () => makeHandle(),
			onStatusChanged: (_h: AgentHandle, _cb: StatusCallback) => () => {},
			isAlive: async () => true,
			shutdown: async () => {},
			restoreFromMarker: async () => null,
		} satisfies Partial<AgentRuntime>;
		// @ts-expect-error — intentionally missing `send` to exercise the runtime probe
		expect(() => registerRuntime(partial)).toThrowError(
			/missing required method "send"/,
		);
	});

	it("rejects runtime missing the isAlive method", () => {
		const partial = {
			shape: "pty" as const,
			id: "missing-isalive",
			version: "0.0.1",
			interfaceVersion: "v1" as const,
			spawn: async () => makeHandle(),
			send: async (_h: AgentHandle, _m: AgentMessage) => {},
			onStatusChanged: (_h: AgentHandle, _cb: StatusCallback) => () => {},
			shutdown: async () => {},
			restoreFromMarker: async () => null,
		} satisfies Partial<AgentRuntime>;
		// @ts-expect-error — intentionally missing `isAlive` to exercise the runtime probe
		expect(() => registerRuntime(partial)).toThrowError(
			/missing required method "isAlive"/,
		);
	});

	it("rejects runtime missing the shutdown method", () => {
		const partial = {
			shape: "pty" as const,
			id: "missing-shutdown",
			version: "0.0.1",
			interfaceVersion: "v1" as const,
			spawn: async () => makeHandle(),
			send: async (_h: AgentHandle, _m: AgentMessage) => {},
			onStatusChanged: (_h: AgentHandle, _cb: StatusCallback) => () => {},
			isAlive: async () => true,
			restoreFromMarker: async () => null,
		} satisfies Partial<AgentRuntime>;
		// @ts-expect-error — intentionally missing `shutdown` to exercise the runtime probe
		expect(() => registerRuntime(partial)).toThrowError(
			/missing required method "shutdown"/,
		);
	});

	it("rejects runtime missing the restoreFromMarker method", () => {
		const partial = {
			shape: "pty" as const,
			id: "missing-restore",
			version: "0.0.1",
			interfaceVersion: "v1" as const,
			spawn: async () => makeHandle(),
			send: async (_h: AgentHandle, _m: AgentMessage) => {},
			onStatusChanged: (_h: AgentHandle, _cb: StatusCallback) => () => {},
			isAlive: async () => true,
			shutdown: async () => {},
		} satisfies Partial<AgentRuntime>;
		// @ts-expect-error — intentionally missing `restoreFromMarker` to exercise the runtime probe
		expect(() => registerRuntime(partial)).toThrowError(
			/missing required method "restoreFromMarker"/,
		);
	});

	it("rejects invalid shape", () => {
		// @ts-expect-error — registry probes at runtime; force "browser" through the type system to test the runtime guard
		const bad = makeValidRuntime({ shape: "browser" });
		expect(() => registerRuntime(bad)).toThrowError(
			/^AgentRuntime registration failed: invalid shape "browser"/,
		);
	});

	it("resolveRuntime throws when id is not registered", () => {
		expect(() => resolveRuntime("nonexistent")).toThrowError(
			"No AgentRuntime registered for id: nonexistent",
		);
	});

	it("listRuntimes returns id/shape/version triples for all registered runtimes", () => {
		registerRuntime(
			makeValidRuntime({ id: "rt-a", shape: "pty", version: "0.0.1" }),
		);
		registerRuntime(
			makeValidRuntime({ id: "rt-b", shape: "http", version: "0.2.0" }),
		);
		const listing = listRuntimes();
		expect(listing).toHaveLength(2);
		expect(listing).toContainEqual({
			id: "rt-a",
			shape: "pty",
			version: "0.0.1",
		});
		expect(listing).toContainEqual({
			id: "rt-b",
			shape: "http",
			version: "0.2.0",
		});
	});

	it("registerRuntime does not invoke getter-defined methods on the adapter", () => {
		let getterInvoked = false;
		const base = {
			shape: "pty" as const,
			id: "hostile-getter",
			version: "0.0.1",
			interfaceVersion: INTERFACE_VERSION,
			send: async (_h: AgentHandle, _m: AgentMessage) => {},
			onStatusChanged: (_h: AgentHandle, _cb: StatusCallback) => () => {},
			isAlive: async () => true,
			shutdown: async () => {},
			restoreFromMarker: async () => null,
		};
		// Define `spawn` as a getter that throws — if registerRuntime uses
		// Reflect.get (the pre-hardening behavior) it would invoke the getter
		// and either throw the getter's error OR flip `getterInvoked` to true.
		// The hardened implementation MUST read the property descriptor
		// without invoking the accessor, so we expect a structural-probe
		// "missing required method" error AND `getterInvoked` stays false.
		Object.defineProperty(base, "spawn", {
			get() {
				getterInvoked = true;
				throw new Error("getter side effect — must NOT run");
			},
			enumerable: true,
			configurable: true,
		});
		const adapter = base as unknown as AgentRuntime;
		expect(() => registerRuntime(adapter)).toThrowError(
			/missing required method "spawn"/,
		);
		expect(getterInvoked).toBe(false);
	});

	it("listRuntimes returns a frozen snapshot — neither the array nor its elements can be mutated", () => {
		registerRuntime(
			makeValidRuntime({ id: "rt-frozen-a", shape: "pty", version: "0.0.1" }),
		);
		registerRuntime(
			makeValidRuntime({ id: "rt-frozen-b", shape: "http", version: "0.2.0" }),
		);
		const listing = listRuntimes();
		expect(Object.isFrozen(listing)).toBe(true);
		expect(Object.isFrozen(listing[0])).toBe(true);
		expect(Object.isFrozen(listing[1])).toBe(true);

		expect(() => {
			(listing as Array<{ id: string }>).push({ id: "rt-injected" });
		}).toThrowError(TypeError);
		expect(() => {
			(listing[0] as { id: string }).id = "mutated";
		}).toThrowError(TypeError);

		// Registry state is unchanged after the failed mutation attempts.
		const again = listRuntimes();
		expect(again).toHaveLength(2);
		expect(again.map((r) => r.id).sort()).toEqual(["rt-frozen-a", "rt-frozen-b"]);
	});

	describe("_resetRegistryForTests production guard", () => {
		afterEach(() => {
			vi.unstubAllEnvs();
		});

		it("throws when NODE_ENV === 'production'", () => {
			vi.stubEnv("NODE_ENV", "production");
			expect(() => _resetRegistryForTests()).toThrowError(
				"_resetRegistryForTests cannot run in production",
			);
		});

		it("succeeds when NODE_ENV !== 'production'", () => {
			vi.stubEnv("NODE_ENV", "test");
			registerRuntime(makeValidRuntime({ id: "rt-prod-guard" }));
			expect(listRuntimes()).toHaveLength(1);
			_resetRegistryForTests();
			expect(listRuntimes()).toHaveLength(0);
		});
	});
});
