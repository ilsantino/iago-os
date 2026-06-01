/**
 * Test fixture — a valid AgentRuntime adapter that registers cleanly at
 * module load (mimics `runtime/agent-runtime/pty/claude-pty.ts`'s
 * side-effect registration). Used by `adapter-isolation.test.ts` to verify
 * that a broken adapter does NOT prevent good adapters from registering.
 *
 * Per stress test I3 of plan
 * `.iago/plans/feature-phase-1-deferred-hardening/04-pr40-deferred-items.md`:
 * real fixture files instead of `vi.mock` so the fail-isolation contract is
 * exercised on actual ESM import behavior.
 */

import {
	type AgentRuntime,
	registerRuntime,
} from "../../agent-runtime/registry.js";
import {
	type AgentHandle,
	type AgentMessage,
	INTERFACE_VERSION,
	type StatusCallback,
} from "../../agent-runtime/types.js";

export const FAKE_GOOD_RUNTIME_ID = "fake-good-adapter";

const fakeGood: AgentRuntime = {
	shape: "pty",
	id: FAKE_GOOD_RUNTIME_ID,
	version: "0.0.1-test",
	interfaceVersion: INTERFACE_VERSION,
	spawn: async () => {
		throw new Error("fake-good-adapter: spawn not implemented in test fixture");
	},
	send: async (_h: AgentHandle, _m: AgentMessage) => {},
	onStatusChanged: (_h: AgentHandle, _cb: StatusCallback) => () => {},
	isAlive: async () => true,
	shutdown: async () => {},
	restoreFromMarker: async () => null,
};

registerRuntime(fakeGood);
