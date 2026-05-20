/**
 * Plan 06 Task 2: Unit tests for `registerSighupHandler`.
 *
 * The handler is exposed as a named export from `main.ts` so these tests
 * import it directly without spinning up a full daemon. The handler
 * registers a `process.on("SIGHUP", listener)` whose body is async-fire-
 * and-forget (`void handler()`); tests await completion by spinning the
 * microtask queue and polling the captured-events array.
 *
 * Test cases (≥6 mandatory per plan Task 2 + C1 fix + PR #74 F2/F3 fixes):
 *   1. SIGHUP received → `loadCredentials` invoked once →
 *      `cred-reload-fired` telemetry emitted with empty field arrays
 *      (F9 field-shape assertion).
 *   2. SIGHUP changes `IAGO_TELEGRAM_BOT_TOKEN` value →
 *      `credentialsReloaded` array contains `"IAGO_TELEGRAM_BOT_TOKEN"`
 *      AND `unchanged` does NOT contain it (F5 mutex assertion).
 *   3. SIGHUP with no actual changes → `credentialsReloaded` empty,
 *      `unchanged` array has entries (only env-vars in `loader.read`,
 *      F8 fix) → telemetry emitted with both fields.
 *   4. `loadCredentials` throws → `cred-reload-failed` telemetry emitted
 *      with `errorCode` (F1 fix — drops free-form `err.message`) → process
 *      is NOT killed.
 *   5. Two SIGHUPs in rapid succession while the first is mid-await →
 *      handler coalesces (F3 fix): exactly 1 `cred-reload-coalesced`
 *      event AND exactly 2 `cred-reload-fired` events (first + trailing).
 *   6. SIGHUP fired after `isShuttingDown()` returns true → handler
 *      returns without calling `loadCredentials`; no telemetry emitted
 *      (C1 shutdown-race fix).
 *   7. `drainInFlight` (F2) — handler in-flight when shutdown begins;
 *      `drainInFlight()` resolves only after the in-flight
 *      `cred-reload-fired` emit completes.
 *
 * Coverage extras lift coverage on edge branches without duplicating
 * the mandatory cases.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerSighupHandler } from "./main.js";
import type { DaemonEvent } from "./telemetry.js";

const TEST_ENV_VARS = ["IAGO_TELEGRAM_BOT_TOKEN", "GH_TOKEN"] as const;

/**
 * Helper: build the `{ read, failed }` shape that production
 * `loadSystemdCredentials` now returns (F7). Most tests use this default
 * (both env-vars actually read, none failed) so test bodies stay focused
 * on the diff behavior, not the loader contract.
 */
function defaultLoadResult(): {
	read: readonly string[];
	failed: readonly string[];
} {
	return { read: TEST_ENV_VARS, failed: [] };
}

interface HarnessOpts {
	readonly loadCredentials: () => {
		read: readonly string[];
		failed: readonly string[];
	} | void;
	readonly isShuttingDown: () => boolean;
	readonly emit?: (event: DaemonEvent) => Promise<void>;
	readonly envVars?: () => readonly string[];
}

interface Harness {
	readonly emittedEvents: DaemonEvent[];
	readonly loadCallCount: () => number;
	readonly fire: () => void;
	readonly drain: (rounds?: number) => Promise<void>;
	readonly waitForEventCount: (n: number, timeoutMs?: number) => Promise<void>;
	readonly drainInFlight: () => Promise<void>;
	readonly teardown: () => void;
}

/**
 * Register the SIGHUP handler with instrumented deps. The handler is
 * invoked deterministically via the `listener` returned by
 * `registerSighupHandler` (rather than `process.emit("SIGHUP")` which
 * would also fire any other tests' leaked listeners on Linux CI).
 */
function makeHarness(opts: HarnessOpts): Harness {
	const emittedEvents: DaemonEvent[] = [];
	let loadCalls = 0;

	// Always record into `emittedEvents`. If the caller supplied a custom
	// emit (for blocking-promise scenarios), invoke it AFTER recording so
	// the event is observable to `waitForEventCount` regardless of what
	// the custom emit does (block, reject, etc.).
	const wrappingEmit = async (event: DaemonEvent): Promise<void> => {
		emittedEvents.push(event);
		if (opts.emit !== undefined) {
			await opts.emit(event);
		}
	};

	const wrappedLoad = (): {
		read: readonly string[];
		failed: readonly string[];
	} | void => {
		loadCalls += 1;
		const result = opts.loadCredentials();
		if (result === undefined) {
			// F7: production `loadSystemdCredentials` always returns the
			// `{ read, failed }` shape. Tests that don't care about the
			// partition default to "all env-vars read, none failed" so the
			// before/after diff in the handler runs against the realistic
			// envelope.
			return defaultLoadResult();
		}
		return result;
	};

	const registration = registerSighupHandler({
		loadCredentials: wrappedLoad,
		emit: wrappingEmit,
		envVars: opts.envVars ?? ((): readonly string[] => TEST_ENV_VARS),
		isShuttingDown: opts.isShuttingDown,
	});

	const drain = async (rounds = 8): Promise<void> => {
		for (let i = 0; i < rounds; i++) {
			// setImmediate yields macrotask + microtasks; alternating
			// `Promise.resolve()` keeps microtask-only awaits draining too.
			await new Promise<void>((r) => setImmediate(r));
			await Promise.resolve();
		}
	};

	const waitForEventCount = async (
		n: number,
		timeoutMs = 1000,
	): Promise<void> => {
		const start = Date.now();
		while (emittedEvents.length < n) {
			if (Date.now() - start > timeoutMs) {
				throw new Error(
					`timeout: expected ${n} events, got ${emittedEvents.length} (kinds=${emittedEvents.map((e) => e.kind).join(",")})`,
				);
			}
			await new Promise<void>((r) => setImmediate(r));
		}
	};

	return {
		emittedEvents,
		loadCallCount: () => loadCalls,
		fire: () => registration.listener(),
		drain,
		waitForEventCount,
		drainInFlight: () => registration.drainInFlight(),
		teardown: () => {
			registration.removeListener();
		},
	};
}

describe("registerSighupHandler", () => {
	let originalEnv: Record<string, string | undefined>;

	beforeEach(() => {
		originalEnv = {
			IAGO_TELEGRAM_BOT_TOKEN: process.env.IAGO_TELEGRAM_BOT_TOKEN,
			GH_TOKEN: process.env.GH_TOKEN,
		};
		delete process.env.IAGO_TELEGRAM_BOT_TOKEN;
		delete process.env.GH_TOKEN;
	});

	afterEach(() => {
		for (const [k, v] of Object.entries(originalEnv)) {
			if (v === undefined) {
				delete process.env[k];
			} else {
				process.env[k] = v;
			}
		}
		vi.restoreAllMocks();
	});

	// Case 1
	it("invokes loadCredentials and emits cred-reload-fired on SIGHUP", async () => {
		const harness = makeHarness({
			loadCredentials: () => undefined,
			isShuttingDown: () => false,
		});
		try {
			harness.fire();
			await harness.waitForEventCount(1);
			expect(harness.loadCallCount()).toBe(1);
			expect(harness.emittedEvents).toHaveLength(1);
			const fired = harness.emittedEvents[0];
			expect(fired?.kind).toBe("cred-reload-fired");
			if (fired?.kind !== "cred-reload-fired") throw new Error("wrong kind");
			// F9: field-shape assertions — both env vars were unset before and
			// after (beforeEach deletes them; loader is a no-op), so all three
			// arrays are empty.
			expect(fired.credentialsReloaded).toEqual([]);
			expect(fired.unchanged).toEqual([]);
			expect(fired.errors).toEqual([]);
		} finally {
			harness.teardown();
		}
	});

	// Case 2
	it("lists changed env vars in credentialsReloaded", async () => {
		const harness = makeHarness({
			loadCredentials: () => {
				process.env.IAGO_TELEGRAM_BOT_TOKEN = "newly-rotated-token";
			},
			isShuttingDown: () => false,
		});
		try {
			harness.fire();
			await harness.waitForEventCount(1);
			const fired = harness.emittedEvents[0];
			expect(fired?.kind).toBe("cred-reload-fired");
			if (fired?.kind !== "cred-reload-fired") throw new Error("wrong kind");
			expect(fired.credentialsReloaded).toContain("IAGO_TELEGRAM_BOT_TOKEN");
			// F5: mutex assertion — a var that appears in credentialsReloaded
			// must NOT appear in unchanged (they are mutually exclusive partitions).
			expect(fired.unchanged).not.toContain("IAGO_TELEGRAM_BOT_TOKEN");
			expect(fired.errors).toEqual([]);
		} finally {
			harness.teardown();
		}
	});

	// Case 3
	it("populates unchanged array when nothing changes", async () => {
		process.env.IAGO_TELEGRAM_BOT_TOKEN = "stable-token";
		process.env.GH_TOKEN = "stable-gh";
		const harness = makeHarness({
			loadCredentials: () => undefined,
			isShuttingDown: () => false,
		});
		try {
			harness.fire();
			await harness.waitForEventCount(1);
			const fired = harness.emittedEvents[0];
			expect(fired?.kind).toBe("cred-reload-fired");
			if (fired?.kind !== "cred-reload-fired") throw new Error("wrong kind");
			expect(fired.credentialsReloaded).toEqual([]);
			expect(fired.unchanged).toContain("IAGO_TELEGRAM_BOT_TOKEN");
			expect(fired.unchanged).toContain("GH_TOKEN");
		} finally {
			harness.teardown();
		}
	});

	// Case 4 — F1: assert typed `errorCode` field, NEVER the free-form
	// `err.message`. The handler maps `Error.constructor.name` → `errorCode`
	// for thrown plain `Error` (so this throws "Error"), or
	// `(err as NodeJS.ErrnoException).code` for filesystem errors. The
	// previous `error: string` field carried `err.message` which could
	// surface credential value bytes via a parse-error position context.
	it("emits cred-reload-failed and keeps the process alive when loadCredentials throws", async () => {
		const sentinelPid = process.pid;
		const harness = makeHarness({
			loadCredentials: () => {
				throw new Error("credstore file went missing mid-rotation");
			},
			isShuttingDown: () => false,
		});
		try {
			harness.fire();
			await harness.waitForEventCount(1);
			expect(harness.emittedEvents).toHaveLength(1);
			const failed = harness.emittedEvents[0];
			expect(failed?.kind).toBe("cred-reload-failed");
			if (failed?.kind !== "cred-reload-failed") {
				throw new Error("wrong kind");
			}
			expect(failed.errorCode).toBe("Error");
			expect(process.pid).toBe(sentinelPid);
		} finally {
			harness.teardown();
		}
	});

	// Case 5 — F3 coalesce semantics: a second SIGHUP arriving while a prior
	// reload is in flight is COALESCED into ONE trailing reload (not dropped).
	// The handler must emit:
	//   * exactly 1 `cred-reload-coalesced` event (for the queued second SIGHUP)
	//   * exactly 2 `cred-reload-fired` events (initial + trailing)
	// AND `loadCredentials` is called twice (the initial + the trailing).
	// Event ORDER on the wire: fired → coalesced → fired.
	it("coalesces a second SIGHUP arriving while the first is in flight", async () => {
		let releaseFirst: (() => void) | null = null;
		const firstEmitGate = new Promise<void>((r) => {
			releaseFirst = r;
		});
		let firedEmitNumber = 0;
		const harness = makeHarness({
			loadCredentials: () => undefined,
			isShuttingDown: () => false,
			emit: async (event: DaemonEvent): Promise<void> => {
				// Block ONLY the first `cred-reload-fired` emit so the second
				// SIGHUP arrives while `inFlight === true`. The coalesce emit
				// and the trailing fired emit must not block (otherwise the
				// trailing iteration's await never settles).
				if (event.kind === "cred-reload-fired") {
					firedEmitNumber += 1;
					if (firedEmitNumber === 1) {
						await firstEmitGate;
					}
				}
			},
		});
		try {
			// Fire #1: handler enters loadCredentials (sync), then enters
			// `await deps.emit(cred-reload-fired)` which blocks.
			harness.fire();
			await harness.drain(2);
			// Fire #2: handler sees inFlight === true → emits coalesced
			// and sets `reloadPending = true`.
			harness.fire();
			await harness.waitForEventCount(2);
			// Release the first emit so the in-flight promise settles. The
			// do/while in the handler then runs ONE trailing reload, which
			// performs a second loadCredentials call and emits a second
			// `cred-reload-fired`.
			releaseFirst?.();
			await harness.waitForEventCount(3);
			await harness.drain(4);
			const kinds = harness.emittedEvents.map((e) => e.kind);
			expect(kinds.filter((k) => k === "cred-reload-fired").length).toBe(2);
			expect(kinds.filter((k) => k === "cred-reload-coalesced").length).toBe(1);
			expect(harness.loadCallCount()).toBe(2);
			// Event order on the wire: fired → coalesced → fired.
			expect(kinds).toEqual([
				"cred-reload-fired",
				"cred-reload-coalesced",
				"cred-reload-fired",
			]);
		} finally {
			releaseFirst?.();
			harness.teardown();
		}
	});

	// Case 6 (C1 fix) — SIGHUP after shutdown flag set → handler returns silently.
	it("ignores SIGHUP and emits nothing when isShuttingDown returns true", async () => {
		const harness = makeHarness({
			loadCredentials: () => undefined,
			isShuttingDown: () => true,
		});
		try {
			const errSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => undefined);
			harness.fire();
			await harness.drain(4);
			expect(harness.loadCallCount()).toBe(0);
			expect(harness.emittedEvents).toEqual([]);
			expect(errSpy).toHaveBeenCalled();
			const messages = errSpy.mock.calls
				.map((args) => args.join(" "))
				.join("\n");
			expect(messages).toContain("SIGHUP ignored");
			errSpy.mockRestore();
		} finally {
			harness.teardown();
		}
	});

	// Coverage extra — telemetry emit failure on the success path is
	// caught and logged; the handler does not crash and `inFlight` clears.
	it("survives a telemetry emit() rejection on the success path", async () => {
		let emitCalls = 0;
		const harness = makeHarness({
			loadCredentials: () => undefined,
			isShuttingDown: () => false,
			emit: async (_event: DaemonEvent): Promise<void> => {
				emitCalls += 1;
				throw new Error("telemetry write failed");
			},
		});
		try {
			const errSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => undefined);
			harness.fire();
			await harness.drain(4);
			expect(emitCalls).toBeGreaterThanOrEqual(1);
			// Fire a second SIGHUP — inFlight must have cleared so this runs.
			harness.fire();
			await harness.drain(4);
			expect(emitCalls).toBeGreaterThanOrEqual(2);
			expect(errSpy).toHaveBeenCalled();
			errSpy.mockRestore();
		} finally {
			harness.teardown();
		}
	});

	// Coverage extra — the teardown function removes the SIGHUP listener.
	it("teardown removes the SIGHUP listener", () => {
		const before = process.listenerCount("SIGHUP");
		const harness = makeHarness({
			loadCredentials: () => undefined,
			isShuttingDown: () => false,
		});
		expect(process.listenerCount("SIGHUP")).toBe(before + 1);
		harness.teardown();
		expect(process.listenerCount("SIGHUP")).toBe(before);
	});

	// Coverage extra — when an env var was unset before AND remains unset
	// after the reload (file missing), it appears in neither `credentialsReloaded`
	// nor `unchanged`. Confirms the diff logic's empty-state behavior.
	it("does NOT list env vars that were unset before and after the reload", async () => {
		// Both env vars are deleted in beforeEach. loadCredentials is a no-op.
		const harness = makeHarness({
			loadCredentials: () => undefined,
			isShuttingDown: () => false,
		});
		try {
			harness.fire();
			await harness.waitForEventCount(1);
			const fired = harness.emittedEvents[0];
			expect(fired?.kind).toBe("cred-reload-fired");
			if (fired?.kind !== "cred-reload-fired") throw new Error("wrong kind");
			expect(fired.credentialsReloaded).toEqual([]);
			expect(fired.unchanged).toEqual([]);
		} finally {
			harness.teardown();
		}
	});

	// Review M1 regression — when `loadCredentials` returns
	// `{ failed: [<envVar>] }`, the env-var names are propagated into
	// `cred-reload-fired.errors` (NEVER values), and those env vars are
	// excluded from the `credentialsReloaded` / `unchanged` partitions
	// so a half-loaded credential is not mistaken for a successful reload.
	it("propagates failed env-var names from loadCredentials.failed into errors", async () => {
		const harness = makeHarness({
			loadCredentials: () => ({
				// `read` lists the env-vars the loader attempted to read.
				// `failed` is a subset whose read attempt did not write to
				// env (parse error, missing file). The handler partitions
				// by `read` then skips anything in `failed`.
				read: TEST_ENV_VARS,
				failed: ["IAGO_TELEGRAM_BOT_TOKEN"] as const,
			}),
			isShuttingDown: () => false,
		});
		try {
			harness.fire();
			await harness.waitForEventCount(1);
			const fired = harness.emittedEvents[0];
			expect(fired?.kind).toBe("cred-reload-fired");
			if (fired?.kind !== "cred-reload-fired") throw new Error("wrong kind");
			expect(fired.errors).toEqual(["IAGO_TELEGRAM_BOT_TOKEN"]);
			expect(fired.credentialsReloaded).not.toContain(
				"IAGO_TELEGRAM_BOT_TOKEN",
			);
			expect(fired.unchanged).not.toContain("IAGO_TELEGRAM_BOT_TOKEN");
		} finally {
			harness.teardown();
		}
	});

	// Case F2 (Opus + Codex convergent) — `drainInFlight()` resolves only
	// AFTER the in-flight `cred-reload-fired` emit completes. Without this,
	// a SIGHUP that began just before SIGTERM/SIGINT would lose its
	// telemetry emit because `shutdown()` exits while the `appendFile`
	// is still pending.
	it("drainInFlight resolves only after the in-flight emit completes", async () => {
		let releaseFirstEmit: (() => void) | null = null;
		const emitGate = new Promise<void>((r) => {
			releaseFirstEmit = r;
		});
		let firstEmitCompleted = false;
		const harness = makeHarness({
			loadCredentials: () => undefined,
			isShuttingDown: () => false,
			emit: async (_event: DaemonEvent): Promise<void> => {
				await emitGate;
				firstEmitCompleted = true;
			},
		});
		try {
			harness.fire();
			// Spin enough rounds to let the handler enter the awaiting state
			// on the emit gate.
			await harness.drain(2);
			expect(firstEmitCompleted).toBe(false);

			// drainInFlight() must be pending while the emit is blocked.
			let drainResolved = false;
			const drainPromise = harness.drainInFlight().then(() => {
				drainResolved = true;
			});
			await harness.drain(2);
			expect(drainResolved).toBe(false);
			expect(firstEmitCompleted).toBe(false);

			// Release the emit gate. drainInFlight() must resolve only AFTER
			// the in-flight emit completes.
			releaseFirstEmit?.();
			await drainPromise;
			expect(firstEmitCompleted).toBe(true);
			expect(drainResolved).toBe(true);
		} finally {
			releaseFirstEmit?.();
			harness.teardown();
		}
	});

	// drainInFlight is a no-op when no reload is currently running.
	it("drainInFlight resolves immediately when no reload is in flight", async () => {
		const harness = makeHarness({
			loadCredentials: () => undefined,
			isShuttingDown: () => false,
		});
		try {
			// No fire() — registration is fresh; activeReload is null.
			await expect(harness.drainInFlight()).resolves.toBeUndefined();
		} finally {
			harness.teardown();
		}
	});
});
