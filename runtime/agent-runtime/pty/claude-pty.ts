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

import { spawn as ptySpawn, type IPty } from "node-pty";

import {
	type AgentRuntime,
	registerRuntime,
} from "../registry.js";
import type {
	AgentHandle,
	AgentMessage,
	SpawnOpts,
	StatusCallback,
	StatusValue,
} from "../types.js";
import { writeStopMarker } from "../../daemon/markers.js";
import { appendEvent } from "../../daemon/session-log.js";
import { getErrnoCode, pathFor } from "../../daemon/state-paths.js";

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
}

const RUNTIME_ID = "claude-pty";
const ADAPTER_VERSION = "0.1.0";
const MAX_BUFFER_BYTES = 4 * 1024;
const SIGKILL_GRACE_MS = 30_000;
const PTY_COLS = 200;
const PTY_ROWS = 50;

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

function emitStatus(
	state: PtyHandleState,
	status: StatusValue,
	code?: number,
): void {
	state.lastStatus = status;
	state.lastStatusChangeMs = Date.now();
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
	status: StatusValue,
	code: number | undefined,
): Promise<void> {
	try {
		await appendEvent(handleId, {
			kind: "status",
			status,
			code,
			at: Date.now(),
		});
	} catch (err) {
		console.error(
			`[claude-pty] appendEvent(status) for ${handleId} failed: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
}

function wireDataAndExit(handleId: string, state: PtyHandleState): void {
	state.ptyProcess.onData((chunk: string) => {
		state.outputBuffer.push(chunk);
		state.outputBuffer = truncateBuffer(state.outputBuffer);
		const parse = parseStatusFromOutput(state.outputBuffer);
		if (parse.status === state.lastStatus) return;
		if (parse.status === "unknown") {
			emitStatus(state, "crashed");
			void persistStatusEvent(handleId, "crashed", undefined);
			void writeStopMarker(handleId, "crash").catch((err) => {
				console.error(
					`[claude-pty] writeStopMarker(crash) for ${handleId} failed: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			});
			return;
		}
		emitStatus(state, parse.status);
		void persistStatusEvent(handleId, parse.status, undefined);
	});

	state.ptyProcess.onExit(({ exitCode }) => {
		state.alive = false;
		if (state.sigkillTimer !== null) {
			clearTimeout(state.sigkillTimer);
			state.sigkillTimer = null;
		}
		emitStatus(state, "exited", exitCode);
		void persistStatusEvent(handleId, "exited", exitCode);
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

	const handleId = crypto.randomUUID();
	const ptyProcess = ptySpawn("claude", [], {
		cwd: opts.cwd,
		env: { ...opts.env },
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

async function readPersistedAgentConfig(
	handleId: string,
): Promise<{ cwd: string; agentId: string; sessionId: string; org?: string } | null> {
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
		};
		return {
			cwd: o.cwd,
			agentId: o.agentId,
			sessionId: o.sessionId,
			org: typeof o.org === "string" ? o.org : undefined,
		};
	}
	return null;
}

export const claudePty: PTYAdapter = {
	shape: "pty",
	id: RUNTIME_ID,
	version: ADAPTER_VERSION,
	interfaceVersion: "v1",

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

		const opts: SpawnOpts = {
			cwd: cfg.cwd,
			env: { ...process.env } as Record<string, string>,
			agentId: cfg.agentId,
			sessionId: cfg.sessionId,
			org: cfg.org,
		};
		const { handle } = await spawnInternal(opts, 1);
		return handle;
	},

	async inject(handle: AgentHandle, text: string): Promise<void> {
		await this.send(handle, { kind: "inject", payload: { text } });
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
