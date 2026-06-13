/**
 * Test fixture — an adapter whose top-level `registerRuntime` call throws.
 * Mimics a real-world adapter regression where the adapter's shape is
 * malformed (e.g., a missing required method) — registry throws synchronously
 * at module load, the import boundary propagates the throw, and the
 * `loadAdapterFailIsolated` helper in `runtime/daemon/main.ts` must catch
 * the throw and continue booting.
 *
 * Per stress test I3 of plan
 * `.iago/plans/feature-phase-1-deferred-hardening/04-pr40-deferred-items.md`:
 * real fixture files instead of `vi.mock` so the fail-isolation contract is
 * exercised on actual ESM import behavior.
 */

import { registerRuntime } from "../../agent-runtime/registry.js";
import {
	type AgentHandle,
	type AgentMessage,
	INTERFACE_VERSION,
	type StatusCallback,
} from "../../agent-runtime/types.js";

export const FAKE_BROKEN_RUNTIME_ID = "fake-broken-adapter";

// Intentionally malformed — `spawn` is missing so the registry's structural
// probe rejects the adapter and throws at module load.
const broken = {
	shape: "pty" as const,
	id: FAKE_BROKEN_RUNTIME_ID,
	version: "0.0.1-test",
	interfaceVersion: INTERFACE_VERSION,
	send: async (_h: AgentHandle, _m: AgentMessage) => {},
	onStatusChanged: (_h: AgentHandle, _cb: StatusCallback) => () => {},
	isAlive: async () => true,
	shutdown: async () => {},
	restoreFromMarker: async () => null,
};

// Forces a runtime registration error. `registerRuntime` runs the structural
// probe and throws because `spawn` is missing. The throw escapes the module
// body so any importer (static or dynamic) observes a rejected import.
// (The `as unknown as` cast deliberately feeds a malformed adapter through the
// typed signature to exercise the fail-isolation path.)
registerRuntime(broken as unknown as Parameters<typeof registerRuntime>[0]);
