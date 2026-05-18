/**
 * Adapter fail-isolation regression test — fulfills the
 * `runtime/agent-runtime/README.md` line 63–65 promise + PR #46 Opus
 * adversarial Critical #2 ("Adapter module that throws at registerRuntime
 * is skipped; daemon continues with remaining runtimes.").
 *
 * Contract under test (per the README's "Fail-isolated policy" section):
 *
 *   - The registry layer ITSELF throws on invalid registration.
 *   - The daemon entry point wraps each adapter import in try/catch so a
 *     single broken adapter does NOT crash the daemon — the daemon logs
 *     the failure, emits a `runtime-registration-failed` telemetry event,
 *     and continues booting with the remaining registered runtimes.
 *
 * The test exercises the real `loadAdapterFailIsolated` helper from
 * `daemon/main.ts` against two real fixture modules in
 * `integration/fixtures/`:
 *
 *   - `fake-broken-adapter` — top-level `registerRuntime` throws because
 *     the adapter shape is missing `spawn`.
 *   - `fake-good-adapter` — registers a valid `pty`-shaped runtime named
 *     `"fake-good-adapter"`.
 *
 * No `vi.mock` is used (per plan stress-test I3): `vi.mock` would not
 * exercise the ESM-import boundary that the production daemon hits.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	_resetRegistryForTests,
	listRuntimes,
} from "../agent-runtime/registry.js";
import { loadAdapterFailIsolated } from "../daemon/main.js";
import { ensureStateDirsSync, pathFor } from "../daemon/state-paths.js";
import {
	__resetTelemetryWarningFlagForTests,
	getTelemetryPath,
} from "../daemon/telemetry.js";

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let stateRoot: string;
const originalEnv: Record<string, string | undefined> = {
	IAGO_DAEMON_STATE_ROOT: undefined,
	CLAUDE_CODE_SESSION_ID: undefined,
};

beforeEach(async () => {
	for (const k of Object.keys(originalEnv)) {
		originalEnv[k] = process.env[k];
	}
	stateRoot = path.join(
		tmpdir(),
		`iago-adapter-isolation-${process.pid}-${randomUUID()}`,
	);
	await fs.mkdir(stateRoot, { recursive: true });
	process.env.IAGO_DAEMON_STATE_ROOT = stateRoot;
	process.env.CLAUDE_CODE_SESSION_ID = "adapter-isolation-session";
	_resetRegistryForTests();
	__resetTelemetryWarningFlagForTests();
	ensureStateDirsSync();
});

afterEach(async () => {
	_resetRegistryForTests();
	await fs.rm(stateRoot, { recursive: true, force: true });
	for (const [k, v] of Object.entries(originalEnv)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	vi.restoreAllMocks();
});

async function readTelemetry(): Promise<
	Array<Record<string, unknown> & { kind: string }>
> {
	const raw = await fs.readFile(getTelemetryPath(), "utf8").catch(() => "");
	if (raw.length === 0) return [];
	return raw
		.trim()
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l) as Record<string, unknown> & { kind: string });
}

describe("adapter fail-isolation (Plan 04 / PR #46 C2)", () => {
	// ESM cache note: fixture modules run their top-level `registerRuntime` exactly
	// once per vitest process — Node caches the module after the first `import()`.
	// `_resetRegistryForTests()` clears the registry Map but NOT the ESM cache.
	// Consequence: adding a second `it()` that expects re-registration after a
	// registry reset will silently fail — the second `import()` returns the cached
	// module without re-running top-level code. Keep one test per fixture specifier.
	it("adapter module that throws at top-level registerRuntime is fail-isolated — daemon continues with remaining runtimes", async () => {
		// Suppress the expected stderr noise for the broken-adapter import so
		// the test output stays clean. The stderr-log behavior is asserted on
		// the spy below.
		const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		// Specifiers are relative to `daemon/main.ts` (the module that owns
		// `loadAdapterFailIsolated`'s `import()`), not the test file. The
		// fixtures live at `integration/fixtures/`, so we walk up one dir.
		const goodResult = await loadAdapterFailIsolated(
			"../integration/fixtures/fake-good-adapter.js",
		);
		const brokenResult = await loadAdapterFailIsolated(
			"../integration/fixtures/fake-broken-adapter.js",
		);

		// The good adapter registers.
		expect(goodResult.loaded).toBe(true);
		expect(goodResult.error).toBeUndefined();
		// The broken adapter throws at the import boundary, the helper catches.
		expect(brokenResult.loaded).toBe(false);
		expect(brokenResult.error).toBeInstanceOf(Error);
		expect(brokenResult.error?.message).toMatch(
			/AgentRuntime registration failed: missing required method "spawn"/,
		);

		// The stderr log surfaced the failure for operators tailing the
		// daemon log — exact message format is the helper's contract.
		expect(stderrSpy).toHaveBeenCalledWith(
			expect.stringMatching(
				/\[daemon\] adapter \.\.\/integration\/fixtures\/fake-broken-adapter\.js failed to register:/,
			),
		);

		// Registry contract: good adapter is present, broken adapter is NOT.
		const ids = listRuntimes().map((r) => r.id);
		expect(ids).toContain("fake-good-adapter");
		expect(ids).not.toContain("fake-broken-adapter");

		// Telemetry contract: a `runtime-registration-failed` event landed
		// for the broken adapter, no event for the good one.
		const events = await readTelemetry();
		const failed = events.filter((e) => e.kind === "runtime-registration-failed");
		expect(failed).toHaveLength(1);
		expect(failed[0]).toMatchObject({
			kind: "runtime-registration-failed",
			adapterModule: "../integration/fixtures/fake-broken-adapter.js",
		});
		expect(typeof failed[0]!.message).toBe("string");
		expect((failed[0]!.message as string).length).toBeGreaterThan(0);
		expect(typeof failed[0]!.stackTrace).toBe("string");
		// Stack trace is truncated to ≤3 lines per the helper's contract.
		expect(
			(failed[0]!.stackTrace as string).split("\n").length,
		).toBeLessThanOrEqual(3);

		stderrSpy.mockRestore();
	});

	it("telemetry path under IAGO_DAEMON_STATE_ROOT is non-empty (sanity)", async () => {
		expect(pathFor("telemetry")).toContain(stateRoot);
	});
});
