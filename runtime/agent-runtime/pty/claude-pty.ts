/**
 * Shape 1 PTY adapter for Claude Code.
 *
 * Architectural notes (Plan 04 + stress-test PR1/C1/EC1/EC2/EC3):
 *
 * - **PTYAdapter shape** — exports `claudePty: PTYAdapter`, where
 *   `PTYAdapter extends AgentRuntime` adds `inject(handle, text)` as a
 *   first-class method (C1). The same effect is reachable via the
 *   canonical `runtime.send(handle, { kind: "inject", payload })` path;
 *   `inject` is exposed on the adapter for ergonomics in PTY-aware
 *   callers (Telegram `/inject` routing in Plan 06+).
 * - **Event-driven parse** (EC2) — `parseStatusFromOutput` is invoked
 *   on every `onData` chunk rather than on a 250ms timer. Trade-off:
 *   slightly more CPU per chunk, but bounded status latency and zero
 *   risk of bursty buffers between polls.
 * - **4 KB output buffer ceiling** (EC1) — every `onData` truncates
 *   the per-handle buffer to the last 4 KB before re-parsing. Keeps
 *   memory bounded and matches the parser's "operate on what you're
 *   handed" contract.
 * - **Fail-closed → crashed** — when the parser returns
 *   `status: "unknown"` we emit `"crashed"` to listeners AND write a
 *   `.daemon-stop` marker with reason `"crash"`. The agent-manager's
 *   heartbeat / boot recovery picks it up from there.
 * - **Version pinning** — every `spawn` first awaits
 *   `assertSupportedVersion`. An unsupported / missing / unparseable
 *   Claude Code binary throws synchronously from `spawn` so the daemon
 *   surfaces the failure at registration time, not at first use.
 * - **Replay split** — `restoreFromMarker` re-spawns a fresh PTY (using
 *   the persisted agent config) and returns the new handle. The
 *   two-phase session.jsonl replay is OWNED by `AgentManager.bootRecovery`,
 *   which calls `runtime.send(restored, ...)` for each replayable
 *   event. The adapter's `send` supports `prompt` and `inject` writes,
 *   which is everything the manager re-feeds.
 * - **`approval` / `custom` are no-ops here** — file-bus owns approvals
 *   (Plan 06); `custom` has no PTY semantics.
 *
 * Side-effect: `registerRuntime(claudePty)` runs at module load so
 * `import "agent-runtime/pty/claude-pty.js"` is enough to make the
 * adapter discoverable from the registry.
 */

import * as crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

import { type IPty, spawn as ptySpawn } from "node-pty";

import { writeStopMarker } from "../../daemon/markers.js";
import { appendEvent, getHWM } from "../../daemon/session-log.js";
import { getErrnoCode, pathFor } from "../../daemon/state-paths.js";
import { type AgentRuntime, registerRuntime } from "../registry.js";
import {
	type AgentHandle,
	type AgentMessage,
	INTERFACE_VERSION,
	type SpawnOpts,
	type StatusCallback,
	type StatusValue,
} from "../types.js";

import { parseStatusFromOutput } from "./prompt-parser.js";
import { assertSupportedVersion } from "./version-pin.js";

export interface PTYAdapter extends AgentRuntime {
	readonly shape: "pty";
	inject(handle: AgentHandle, text: string): Promise<void>;
}

interface PtyHandleState {
	ptyProcess: IPty;
	statusListeners: Set<StatusCallback>;
	lastStatus: StatusValue;
	lastStatusChangeMs: number;
	outputBuffer: string[];
	sessionId: string;
	agentId: string;
	markerPath: string;
	generationToken: number;
	alive: boolean;
	sigkillTimer: ReturnType<typeof setTimeout> | null;
	cwd: string;
	env: Record<string, string>;
	// I5: per-spawn Claude Code session id propagated via the
	// `CLAUDE_CODE_SESSION_ID` env var to the PTY child. Recorded here so
	// every telemetry event emitted by this adapter can be keyed on it
	// (per L2 acceptance criterion #5).
	claudeCodeSessionId: string;
	// false until the first real signal is emitted; prevents de-dup from
	// suppressing the first pattern match when lastStatus equals the initial
	// assumed "running" state (which was never actually observed from output).
	hasEmitted: boolean;
}

const RUNTIME_ID = "claude-pty";
const ADAPTER_VERSION = "0.1.0";
const MAX_BUFFER_BYTES = 4 * 1024;
const SIGKILL_GRACE_MS = 30_000;
const PTY_COLS = 200;
const PTY_ROWS = 50;

// IMPORTANT #5: tail window for current-status determination. The full
// `outputBuffer` carries up to 4 KB so the parser can spot end-of-buffer
// markers (`\nHuman: ` for idle, `: Read(...)` for running), but a stale
// "Running tool:" line from 3 KB back must NOT wedge status at `running`
// after the agent has returned to its prompt. Trim to the last
// TAIL_PARSE_BYTES before classification so the running-status decision
// reflects the CURRENT tail, not anywhere in the buffer.
const TAIL_PARSE_BYTES = 512;

const stateByHandleId = new Map<string, PtyHandleState>();

function markerPathOf(handleId: string): string {
	return path.join(pathFor("markers"), `${handleId}.daemon-stop`);
}

function agentConfigPathOf(handleId: string): string {
	return path.join(pathFor("agents"), `${handleId}.json`);
}

function truncateBuffer(buffer: string[]): string[] {
	let total = 0;
	for (const chunk of buffer) total += chunk.length;
	if (total <= MAX_BUFFER_BYTES) return buffer;
	const joined = buffer.join("");
	return [joined.slice(joined.length - MAX_BUFFER_BYTES)];
}

/**
 * Return the last `TAIL_PARSE_BYTES` of the joined buffer as a single-element
 * array suitable for `parseStatusFromOutput`. IMPORTANT #5: the running
 * pattern is NOT end-anchored — a stale `Running tool:` line that scrolled
 * up earlier in the 4 KB window would wedge status at `running` even after
 * `\nHuman: ` arrives at the tail. Slicing to a small tail before
 * classification reflects the agent's CURRENT state, not anywhere in
 * recent-ish memory.
 */
function tailWindow(buffer: string[]): string[] {
	let total = 0;
	for (const chunk of buffer) total += chunk.length;
	if (total <= TAIL_PARSE_BYTES) return buffer;
	const joined = buffer.join("");
	return [joined.slice(joined.length - TAIL_PARSE_BYTES)];
}

function emitStatus(
	state: PtyHandleState,
	status: StatusValue,
	code?: number,
): void {
	state.lastStatus = status;
	state.lastStatusChangeMs = Date.now();
	state.hasEmitted = true;
	for (const cb of state.statusListeners) {
		try {
			cb(status, code);
		} catch (err) {
			console.error(
				`[claude-pty] status listener threw: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
	}
}

async function persistStatusEvent(
	handleId: string,
	state: PtyHandleState,
	status: StatusValue,
	code: number | undefined,
): Promise<void> {
	try {
		await appendEvent(handleId, {
			kind: "status",
			status,
			code,
			at: Date.now(),
			// I5: every adapter-emitted event is keyed on the per-spawn
			// Claude Code session id so iaGO's session.jsonl events
			// cross-correlate with Claude Code's own internal session log.
			claudeCodeSessionId: state.claudeCodeSessionId,
		});
	} catch (err) {
		console.error(
			`[claude-pty] appendEvent(status) for ${handleId} failed: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
}

/**
 * IMPORTANT #6: persist the actual prompt/inject text to session.jsonl so
 * the agent-manager's two-phase replay loop has something to re-feed. Status
 * events alone carry no recoverable input; replay was a no-op before this
 * landed (Opus review IMPORTANT #6). `eventToReplayableMessage` in
 * agent-manager reads `kind === "input"`.
 */
async function persistInputEvent(
	handleId: string,
	state: PtyHandleState,
	messageKind: "prompt" | "inject",
	text: string,
): Promise<void> {
	try {
		await appendEvent(handleId, {
			kind: "input",
			messageKind,
			payload: { text },
			at: Date.now(),
			claudeCodeSessionId: state.claudeCodeSessionId,
		});
	} catch (err) {
		console.error(
			`[claude-pty] appendEvent(input:${messageKind}) for ${handleId} failed: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
}

/**
 * Codex finding (high): fail-closed terminal teardown for the
 * `unknown` parse path. Without this the PTY stays writable + `isAlive`
 * remains true, so heartbeat has no trigger and the handle strands in a
 * permanently-crashed state until a later stall fires. Sequence:
 *   1. emit `crashed` to listeners (already done by caller)
 *   2. write the `.daemon-stop` crash marker (already done by caller)
 *   3. mark state dead so subsequent `send` rejects + `isAlive` returns false
 *   4. SIGTERM the PTY so heartbeat's `isAlive=false` triggers restart
 *
 * `state.alive = false` is set BEFORE the kill so a heartbeat tick that
 * lands between this function call and the actual PTY exit sees the dead
 * state and routes to restart. The `setImmediate` delete mirrors the
 * graceful-exit cleanup so any in-flight callbacks fired during this tick
 * still resolve against the now-dead state before the entry is reaped.
 */
function failClosedTerminate(handleId: string, state: PtyHandleState): void {
	if (!state.alive) return;
	state.alive = false;
	if (state.sigkillTimer !== null) {
		clearTimeout(state.sigkillTimer);
		state.sigkillTimer = null;
	}
	try {
		state.ptyProcess.kill("SIGTERM");
	} catch (err) {
		console.error(
			`[claude-pty] failClosedTerminate kill(SIGTERM) for ${handleId} threw: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
	setImmediate(() => {
		stateByHandleId.delete(handleId);
	});
}

function wireDataAndExit(handleId: string, state: PtyHandleState): void {
	state.ptyProcess.onData((chunk: string) => {
		state.outputBuffer.push(chunk);
		state.outputBuffer = truncateBuffer(state.outputBuffer);
		// IMPORTANT #5: parse against the TAIL window, not the full 4 KB
		// buffer. The running pattern is unanchored — a stale tool-marker
		// from 3 KB back would otherwise wedge status at `running` after
		// the agent has returned to its idle prompt. The full buffer is
		// still retained so the parser can see chunk-split markers near
		// the tail (EC3 / test "EC3: detects pattern split across two
		// consecutive onData chunks").
		const parse = parseStatusFromOutput(tailWindow(state.outputBuffer));
		// De-dup: skip if same as last observed status. The `hasEmitted` guard
		// prevents suppression when lastStatus equals the initial assumed
		// "running" state that was never actually observed from output.
		if (state.hasEmitted && parse.status === state.lastStatus) return;
		// I2: sub-threshold chunks return status "idle" with matchedPattern null
		// as a "no-signal" sentinel. Emitting that would cause spurious
		// running→idle→running round-trips during multi-chunk tool runs.
		if (parse.status === "idle" && parse.matchedPattern === null) return;
		if (parse.status === "unknown") {
			emitStatus(state, "crashed");
			void persistStatusEvent(handleId, state, "crashed", undefined);
			void writeStopMarker(handleId, "crash").catch((err) => {
				console.error(
					`[claude-pty] writeStopMarker(crash) for ${handleId} failed: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			});
			// Codex (high): fail-closed terminal teardown. Without killing
			// the PTY + flipping `alive`, the handle stays writable and
			// `isAlive` keeps returning true — heartbeat has no immediate
			// liveness trigger to restart, so the agent strands in a
			// permanently-crashed state.
			failClosedTerminate(handleId, state);
			return;
		}
		emitStatus(state, parse.status);
		void persistStatusEvent(handleId, state, parse.status, undefined);
	});

	state.ptyProcess.onExit(({ exitCode }) => {
		state.alive = false;
		if (state.sigkillTimer !== null) {
			clearTimeout(state.sigkillTimer);
			state.sigkillTimer = null;
		}
		emitStatus(state, "exited", exitCode);
		void persistStatusEvent(handleId, state, "exited", exitCode);
		// I1: clean up dead handle so long-lived daemon does not accumulate
		// O(total restarts) entries in the module-scope Map. setImmediate
		// gives any same-tick callbacks (status listeners, persistStatusEvent
		// completion) safe access to `state` before the map entry is reaped.
		setImmediate(() => {
			stateByHandleId.delete(handleId);
		});
	});
}

async function spawnInternal(
	opts: SpawnOpts,
	generationToken: number,
): Promise<{ handle: AgentHandle; state: PtyHandleState }> {
	const versionCheck = await assertSupportedVersion();
	if (!versionCheck.ok) {
		throw new Error(
			`claude-pty: unsupported Claude Code version: ${versionCheck.detail}`,
		);
	}

	// Wave 2 contract (SpawnOpts.restoreId): if the caller supplies a
	// restoreId, the returned `AgentHandle.id` MUST equal it exactly so the
	// AgentManager's restart path keeps a stable id across generations.
	// AgentManager throws a contract-violation error if id substitution
	// happens (agent-manager.ts:455-457).
	const handleId = opts.restoreId ?? crypto.randomUUID();

	// I5: per-spawn Claude Code session id. Propagated into the PTY child via
	// `CLAUDE_CODE_SESSION_ID` so Claude Code's internal session log can be
	// cross-referenced with iaGO's session.jsonl entries.
	const claudeCodeSessionId = crypto.randomUUID();
	const ptyEnv = {
		...opts.env,
		CLAUDE_CODE_SESSION_ID: claudeCodeSessionId,
	};
	const ptyProcess = ptySpawn("claude", [], {
		cwd: opts.cwd,
		env: ptyEnv,
		cols: PTY_COLS,
		rows: PTY_ROWS,
		name: "xterm-256color",
	});

	const now = Date.now();
	const state: PtyHandleState = {
		ptyProcess,
		statusListeners: new Set<StatusCallback>(),
		lastStatus: "running",
		lastStatusChangeMs: now,
		outputBuffer: [],
		sessionId: opts.sessionId,
		agentId: opts.agentId,
		markerPath: markerPathOf(handleId),
		generationToken,
		alive: true,
		sigkillTimer: null,
		cwd: opts.cwd,
		env: { ...opts.env },
		claudeCodeSessionId,
		hasEmitted: false,
	};
	stateByHandleId.set(handleId, state);
	wireDataAndExit(handleId, state);

	const handle: AgentHandle = {
		id: handleId,
		runtime: RUNTIME_ID,
		shape: "pty",
		agentId: opts.agentId,
		sessionId: opts.sessionId,
		generationToken,
		org: opts.org,
		parentHandleId: opts.parentHandle?.id,
		spawnedAt: now,
		markerPath: state.markerPath,
	};
	return { handle, state };
}

/**
 * CRITICAL #2: write back the freshly-incremented generationToken to the
 * persisted agent config so subsequent restoreFromMarker calls continue the
 * monotonic climb. Best-effort — failure here does not poison the restore
 * (the in-memory generation is already bumped on the returned handle);
 * worst case is the NEXT restore reads a stale lastGenerationToken and
 * skips ahead by 1 instead of N+1.
 */
async function updatePersistedGenerationToken(
	handleId: string,
	generationToken: number,
): Promise<void> {
	const file = agentConfigPathOf(handleId);
	let raw: string;
	try {
		raw = await fsp.readFile(file, "utf8");
	} catch (err) {
		if (getErrnoCode(err) === "ENOENT") return;
		console.error(
			`[claude-pty] updatePersistedGenerationToken read for ${handleId} failed: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
		return;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null) return;
	const updated = {
		...(parsed as Record<string, unknown>),
		lastGenerationToken: generationToken,
	};
	try {
		await fsp.writeFile(file, JSON.stringify(updated));
	} catch (err) {
		console.error(
			`[claude-pty] updatePersistedGenerationToken write for ${handleId} failed: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
}

async function readPersistedAgentConfig(handleId: string): Promise<{
	cwd: string;
	agentId: string;
	sessionId: string;
	org?: string;
	env?: Record<string, string>;
	lastGenerationToken?: number;
} | null> {
	let raw: string;
	try {
		raw = await fsp.readFile(agentConfigPathOf(handleId), "utf8");
	} catch (err) {
		if (getErrnoCode(err) === "ENOENT") return null;
		throw err;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (
		typeof parsed === "object" &&
		parsed !== null &&
		typeof (parsed as { cwd?: unknown }).cwd === "string" &&
		typeof (parsed as { agentId?: unknown }).agentId === "string" &&
		typeof (parsed as { sessionId?: unknown }).sessionId === "string"
	) {
		const o = parsed as {
			cwd: string;
			agentId: string;
			sessionId: string;
			org?: unknown;
			env?: unknown;
			lastGenerationToken?: unknown;
		};
		// CRITICAL #1: env must be carried from the persisted record (not
		// substituted from `process.env`). agent-manager.persistAgentConfig
		// records env explicitly so per-agent credentials survive restart.
		// Records that pre-date the env field surface `env: undefined`; the
		// caller treats that as a missing precondition.
		let env: Record<string, string> | undefined;
		if (typeof o.env === "object" && o.env !== null) {
			const envObj = o.env as Record<string, unknown>;
			const envOut: Record<string, string> = {};
			for (const [k, v] of Object.entries(envObj)) {
				if (typeof v === "string") envOut[k] = v;
			}
			env = envOut;
		}
		const lastGenerationToken =
			typeof o.lastGenerationToken === "number" &&
			Number.isFinite(o.lastGenerationToken)
				? o.lastGenerationToken
				: undefined;
		return {
			cwd: o.cwd,
			agentId: o.agentId,
			sessionId: o.sessionId,
			org: typeof o.org === "string" ? o.org : undefined,
			env,
			lastGenerationToken,
		};
	}
	return null;
}

export const claudePty: PTYAdapter = {
	shape: "pty",
	id: RUNTIME_ID,
	version: ADAPTER_VERSION,
	interfaceVersion: INTERFACE_VERSION,

	async spawn(opts: SpawnOpts): Promise<AgentHandle> {
		const { handle } = await spawnInternal(opts, 0);
		return handle;
	},

	async send(handle: AgentHandle, message: AgentMessage): Promise<void> {
		const state = stateByHandleId.get(handle.id);
		if (state === undefined) {
			throw new Error(`claude-pty: unknown handle ${handle.id}`);
		}
		if (!state.alive) {
			throw new Error(`claude-pty: handle ${handle.id} is no longer alive`);
		}
		switch (message.kind) {
			case "prompt":
			case "inject":
				state.ptyProcess.write(`${message.payload.text}\n`);
				// IMPORTANT #6: persist the actual input text to session.jsonl
				// AFTER successful PTY write. Without this the agent-manager's
				// two-phase replay loop has no payload to re-feed — status
				// events alone don't carry the prompt/inject content. Replay
				// was a no-op before this landed.
				void persistInputEvent(
					handle.id,
					state,
					message.kind,
					message.payload.text,
				);
				return;
			case "abort":
				state.ptyProcess.write("\x03");
				return;
			case "approval":
				// File-bus owns approval routing; PTY adapter intentionally ignores.
				return;
			case "custom":
				console.warn(
					`[claude-pty] received custom message for ${handle.id}; PTY adapter has no custom semantics`,
				);
				return;
		}
	},

	onStatusChanged(handle: AgentHandle, cb: StatusCallback): () => void {
		const state = stateByHandleId.get(handle.id);
		if (state === undefined) {
			throw new Error(`claude-pty: unknown handle ${handle.id}`);
		}
		state.statusListeners.add(cb);
		return () => {
			const current = stateByHandleId.get(handle.id);
			if (current === undefined) return;
			current.statusListeners.delete(cb);
		};
	},

	async isAlive(handle: AgentHandle): Promise<boolean> {
		const state = stateByHandleId.get(handle.id);
		if (state === undefined) return false;
		return state.alive;
	},

	async shutdown(
		handle: AgentHandle,
		signal: "SIGTERM" | "SIGKILL" = "SIGTERM",
	): Promise<void> {
		const state = stateByHandleId.get(handle.id);
		if (state === undefined) return;
		try {
			state.ptyProcess.kill(signal);
		} catch (err) {
			console.error(
				`[claude-pty] kill(${signal}) for ${handle.id} threw: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
		if (signal === "SIGTERM") {
			if (state.sigkillTimer !== null) clearTimeout(state.sigkillTimer);
			state.sigkillTimer = setTimeout(() => {
				const current = stateByHandleId.get(handle.id);
				if (current === undefined || !current.alive) return;
				try {
					current.ptyProcess.kill("SIGKILL");
				} catch (err) {
					console.error(
						`[claude-pty] SIGKILL escalation for ${handle.id} threw: ${
							err instanceof Error ? err.message : String(err)
						}`,
					);
				}
			}, SIGKILL_GRACE_MS);
		} else {
			state.alive = false;
			stateByHandleId.delete(handle.id);
		}
	},

	async restoreFromMarker(markerPath: string): Promise<AgentHandle | null> {
		const base = path.basename(markerPath);
		const suffix = ".daemon-stop";
		if (!base.endsWith(suffix)) return null;
		const handleId = base.slice(0, base.length - suffix.length);
		if (handleId.length === 0) return null;

		const cfg = await readPersistedAgentConfig(handleId);
		if (cfg === null) return null;

		// CRITICAL #2 / Plan 04 Task 5 + JSDoc + claude-pty.md L122-142:
		// `restoreFromMarker` requires a stored HWM to be replay-viable. If
		// the HWM is absent the session log is not durably committed at any
		// recoverable point — bail null and let agent-manager fall through to
		// a clean spawn rather than fabricating a fresh handle pointing at an
		// uncommitted log.
		const hwm = await getHWM(handleId);
		if (hwm === null) return null;

		// CRITICAL #1: env is read from the persisted agent config (recorded
		// by agent-manager.persistAgentConfig). NEVER substitute
		// `process.env` — the daemon's ambient env can differ from the
		// per-agent env originally used at spawn, leaking cross-client
		// credentials or stripping scoped API keys. A persisted record
		// without env is treated as a missing precondition (bail null).
		if (cfg.env === undefined) return null;

		// CRITICAL #2 (continued): generation token must monotonically
		// increase across restarts so Shape 4/5 generation-token comparison
		// for stale-completion detection works. Hardcoding 1 reset the
		// counter on every standalone restoreFromMarker invocation. Read the
		// last observed token from the persisted record (recorded by
		// `updatePersistedGenerationToken` whenever this adapter spawns) and
		// increment. Records that pre-date the field fall back to 1 — same
		// floor as the prior implementation, but every subsequent restore
		// from this point monotonically climbs.
		const nextGenerationToken = (cfg.lastGenerationToken ?? 0) + 1;

		const opts: SpawnOpts = {
			cwd: cfg.cwd,
			env: { ...cfg.env },
			agentId: cfg.agentId,
			sessionId: cfg.sessionId,
			org: cfg.org,
			// Wave 2 contract: re-use the original handle id so external
			// references (heartbeat, IPC, dashboard) continue to resolve the
			// same logical agent after restoreFromMarker. AgentManager's
			// `attemptCrashReplay` does NOT pass restoreId today (it relies
			// on this adapter restoring the id from the marker filename), so
			// we set restoreId ourselves to keep the contract uniform.
			restoreId: handleId,
		};
		const { handle } = await spawnInternal(opts, nextGenerationToken);
		// Persist the new generation token so the NEXT restoreFromMarker
		// continues the monotonic climb instead of resetting.
		await updatePersistedGenerationToken(handleId, nextGenerationToken);
		return handle;
	},

	// M4: arrow fn closes over the binding so `const { inject } = claudePty`
	// destructuring works correctly (no implicit `this` dependency).
	inject: async (handle: AgentHandle, text: string): Promise<void> => {
		await claudePty.send(handle, { kind: "inject", payload: { text } });
	},
};

registerRuntime(claudePty);

/**
 * Test-only reset of the PTY adapter's module-scope handle state.
 * Underscore prefix marks test infrastructure — do not call from
 * production paths. Note this does NOT touch the global `registry` (the
 * adapter stays registered).
 */
export function _resetPtyAdapterStateForTests(): void {
	for (const state of stateByHandleId.values()) {
		if (state.sigkillTimer !== null) clearTimeout(state.sigkillTimer);
	}
	stateByHandleId.clear();
}
