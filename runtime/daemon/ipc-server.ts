/**
 * IPC server — Unix socket on Linux/macOS, named pipe on Windows.
 *
 * Phase 1 scope (Plan 05): stub IPC sufficient for the hello-world
 * `fleet-health` endpoint with a 30s cache. Full dashboard wiring
 * (Phase 6) will extend the request schema with additional methods
 * and add an event bus for cache invalidation.
 *
 * Wire protocol: newline-delimited JSON. Each connection MAY send one
 * or more `IpcRequest` lines; the server writes one `IpcResponse` line
 * per request, in arrival order. Per-socket serialization is enforced
 * by chaining each dispatch on the connection's tail promise so a slow
 * handler cannot let a later request's response overtake it.
 *
 * Stress-test bindings (Plan 05):
 * - **EC1** — `start()` preemptively unlinks any stale socket file on
 *   POSIX before `listen()`. Otherwise a previous crash-without-stop
 *   bricks the next boot with EADDRINUSE.
 * - **EC2** — concurrent fleet-health requests at the TTL boundary share
 *   the same in-flight refresh promise (`cachedFleetHealthPromise`).
 * - **EC3** — the connection handler buffers chunks until `\n`, so a
 *   JSON request split across multiple TCP `data` events still parses.
 *
 * Hardening bindings (Plan 01 of feature-phase-1-deferred-hardening,
 * landing PR #44 Important #1-#4 + Minor #1):
 * - **H1 (PR #44 Important #1)** — per-connection buffer cap. A line
 *   exceeding `maxLineBytes` (default 64 KiB) triggers a
 *   `parse-error: line-too-long` response + `socket.destroy()`. The cap
 *   is enforced as a UTF-8 byte bound on every extracted line BEFORE
 *   dispatch and on the residual buffer after each chunk's parse loop,
 *   so it cannot be bypassed by a newline arriving in the same data
 *   event (Codex M) or by multibyte input whose UTF-16 length is under
 *   the bound. Threat model: same-host owner-only socket (`0o600`); the
 *   cap is hygiene to stop a compromised daemon-user process from
 *   exhausting RSS via unbounded input. Configurable per-instance for
 *   Phase 6 dashboard endpoints that may legitimately need larger payloads.
 * - **H2 (PR #44 Important #3)** — per-connection idle timeout. After
 *   `idleTimeoutMs` (default 5 min) of no data, the socket is destroyed.
 *   Configurable per-instance so the Phase 6 dashboard long-poll path
 *   can raise the floor without touching the daemon default.
 * - **H3 (PR #44 Important #2)** — `socketTails` previousTail chain
 *   swallows prior-tail rejections with `.catch()` so a write error on
 *   request N does not bubble as `unhandledRejection` on request N+1.
 *   The swallow logs to stderr so a real bug remains observable. The
 *   write path additionally protects the 1:1 request/response invariant
 *   by catching serialization failures (circular references, BigInt, ...)
 *   and emitting a guaranteed-serializable
 *   `{ ok:false, error:"internal: response serialization failed" }`
 *   fallback so a pipelined client cannot misalign request N+1's
 *   response onto request N (Codex H).
 * - **H4 (PR #44 Important #4)** — `cachedFleetHealthPromise` rejection
 *   cooldown: a failed upstream `getFleetHealth` arms a 1-second
 *   cooldown. Subsequent calls during the cooldown short-circuit with
 *   `fleet-health: temporarily unavailable (retry in <Nms>)` rather
 *   than re-invoking the failing upstream. Absorbs error bursts during
 *   transient upstream outages without enabling thundering-herd.
 */

import * as fsp from "node:fs/promises";
import * as net from "node:net";

import { getErrnoCode } from "./state-paths.js";

export type IpcRequest =
	| { readonly method: "fleet-health"; readonly params?: Record<string, never> }
	| { readonly method: "list-agents"; readonly params?: Record<string, never> }
	| {
			readonly method: "get-handle";
			readonly params: { readonly handleId: string };
	  };

export type IpcResponse =
	| { readonly ok: true; readonly data: unknown }
	| { readonly ok: false; readonly error: string };

export interface IpcServerOpts {
	readonly socketPath?: string;
	readonly cacheTtlMs?: number;
	/**
	 * Per-connection line-buffer cap, in bytes. A single line exceeding
	 * this length without a trailing newline triggers a parse-error
	 * response + socket destroy. Default: 64 KiB. Test-affordance and
	 * Phase 6 forward-compat option — production callers should rely on
	 * the default unless a specific endpoint's payload bound exceeds it.
	 */
	readonly maxLineBytes?: number;
	/**
	 * Per-connection idle timeout, in ms. Sockets that go this long
	 * without data are destroyed. Default: 5 min (300_000 ms).
	 * Test-affordance and Phase 6 long-poll forward-compat option.
	 */
	readonly idleTimeoutMs?: number;
	readonly getFleetHealth: () => Promise<unknown>;
	readonly listAgents: () => Promise<unknown>;
	readonly getHandle: (id: string) => unknown;
}

const DEFAULT_CACHE_TTL_MS = 30_000;
// PR #44 Important #1: 64 KiB per-connection line-buffer cap.
const DEFAULT_MAX_LINE_BYTES = 64 * 1024;
// PR #44 Important #3: 5-minute per-connection idle timeout.
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
// PR #44 Important #4: 1-second rejection cooldown for fleet-health
// upstream failures. Minimum-viable absorb window — short enough that a
// recovering upstream is sampled quickly, long enough to debounce a
// transient burst (sub-second retry storm).
const FLEET_HEALTH_REJECTION_COOLDOWN_MS = 1_000;

function defaultSocketPath(): string {
	if (process.platform === "win32") {
		return "\\\\.\\pipe\\iago-os-v2-daemon";
	}
	return "/tmp/iago-os-v2-daemon.sock";
}

interface CachedFleetHealth {
	readonly data: unknown;
	readonly at: number;
}

export class IpcServer {
	readonly socketPath: string;
	readonly cacheTtlMs: number;
	readonly maxLineBytes: number;
	readonly idleTimeoutMs: number;

	private readonly getFleetHealth: () => Promise<unknown>;
	private readonly listAgents: () => Promise<unknown>;
	private readonly getHandle: (id: string) => unknown;

	private server: net.Server | null = null;
	private startingPromise: Promise<void> | null = null;
	private cachedFleetHealth: CachedFleetHealth | null = null;
	private cachedFleetHealthPromise: Promise<unknown> | null = null;
	/**
	 * Absolute clock-ms after which a previously-armed cooldown expires
	 * and the next call may re-invoke the upstream. `null` when no
	 * cooldown is armed. See H4 in the file header.
	 */
	private cachedFleetHealthRejectionUntilMs: number | null = null;
	private readonly inflight = new Set<Promise<void>>();
	private readonly sockets = new Set<net.Socket>();
	private readonly socketTails = new WeakMap<net.Socket, Promise<void>>();
	private now: () => number = Date.now;

	constructor(opts: IpcServerOpts) {
		this.socketPath = opts.socketPath ?? defaultSocketPath();
		this.cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
		this.maxLineBytes = opts.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
		this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
		this.getFleetHealth = opts.getFleetHealth;
		this.listAgents = opts.listAgents;
		this.getHandle = opts.getHandle;
	}

	/**
	 * Test-only seam: override the clock used for cache TTL evaluation.
	 * Production code keeps the default `Date.now`.
	 */
	_setNowForTests(now: () => number): void {
		this.now = now;
	}

	async start(): Promise<void> {
		if (this.server !== null) {
			return;
		}
		// Single-shot guard: if a concurrent start() is already running,
		// await it instead of racing a second listen() onto the same path.
		if (this.startingPromise !== null) {
			return this.startingPromise;
		}
		this.startingPromise = this.doStart().finally(() => {
			this.startingPromise = null;
		});
		return this.startingPromise;
	}

	private async doStart(): Promise<void> {
		// EC1: preemptively unlink stale socket file on POSIX.
		if (process.platform !== "win32") {
			try {
				await fsp.unlink(this.socketPath);
			} catch (err) {
				if (getErrnoCode(err) !== "ENOENT") {
					throw err;
				}
			}
		}

		const server = net.createServer((socket) => {
			this.handleConnection(socket);
		});

		await new Promise<void>((resolve, reject) => {
			const onError = (err: Error) => {
				server.removeListener("listening", onListening);
				reject(err);
			};
			const onListening = () => {
				server.removeListener("error", onError);
				resolve();
			};
			server.once("error", onError);
			server.once("listening", onListening);
			server.listen(this.socketPath);
		});

		// Assign only after a successful listen so that a failed start() leaves
		// this.server null — allowing a subsequent start() to retry instead of
		// silently no-opping with a non-listening server.
		this.server = server;

		// Restrict the Unix socket to the daemon owner so a permissive
		// umask doesn't let other local users dial fleet-health/list-agents.
		// Best-effort: log and continue if chmod fails (filesystem may not
		// support it). Named pipes on Windows ignore POSIX modes.
		if (process.platform !== "win32") {
			try {
				await fsp.chmod(this.socketPath, 0o600);
			} catch (err) {
				console.error("[ipc-server] socket chmod failed:", err);
			}
		}
	}

	async stop(): Promise<void> {
		const server = this.server;
		if (server === null) {
			return;
		}

		for (const sock of this.sockets) {
			sock.end();
		}

		await new Promise<void>((resolve, reject) => {
			server.close((err) => {
				if (err) {
					reject(err);
					return;
				}
				resolve();
			});
		});

		// Wait for any in-flight request handlers to settle.
		if (this.inflight.size > 0) {
			await Promise.allSettled(Array.from(this.inflight));
		}

		// Best-effort unlink on POSIX.
		if (process.platform !== "win32") {
			try {
				await fsp.unlink(this.socketPath);
			} catch (err) {
				if (getErrnoCode(err) !== "ENOENT") {
					// Non-fatal — log and continue.
					console.error("[ipc-server] socket unlink failed:", err);
				}
			}
		}

		this.server = null;
		this.cachedFleetHealth = null;
		this.cachedFleetHealthPromise = null;
		// I3 fix: cooldown is per-process cache and MUST NOT persist
		// across stop/start. A fresh start should re-sample the upstream
		// without inheriting the prior boot's cooldown timer.
		this.cachedFleetHealthRejectionUntilMs = null;
	}

	private handleConnection(socket: net.Socket): void {
		this.sockets.add(socket);
		let buffer = "";

		socket.setEncoding("utf8");
		// H2: per-connection idle timeout. Phase 6 dashboard long-poll
		// endpoints may override via constructor `idleTimeoutMs`.
		socket.setTimeout(this.idleTimeoutMs);
		socket.on("timeout", () => {
			socket.destroy();
		});

		// Per-connection rejected flag: once an oversized line has been seen
		// and the connection rejected, any subsequent `data` event must be a
		// no-op. Node's stream contract is that no further `data` events
		// fire after `socket.destroy()`, but Node has historically allowed
		// already-queued microtask events to drain. Without this flag, a
		// late `data` event would re-enter the parse loop on a destroyed
		// socket: writes are short-circuited by `!socket.destroyed &&
		// socket.writable` later, but `processLine` + `inflight.add(work)`
		// still execute (Opus dual-review I1, PR #49). Clearing `buffer`
		// AFTER the reject also bounds residual memory immediately.
		let rejected = false;
		socket.on("data", (chunk: string) => {
			if (rejected) {
				return;
			}
			buffer += chunk;
			// EC3: parse complete lines only.
			// H1 (Codex M): enforce `maxLineBytes` as a UTF-8 byte bound
			// on EVERY extracted line BEFORE dispatch, and on the residual
			// buffer after the parse loop. This prevents two prior
			// bypasses:
			//   1. An oversized line arriving with a trailing newline in
			//      the same data event would have skipped the legacy
			//      chunk-level guard (`!buffer.includes("\n")` was false).
			//   2. Multibyte input would have evaded a UTF-16 `string.length`
			//      check whose value can be far smaller than the byte cost
			//      after `setEncoding("utf8")` decoded the bytes.
			let newlineIdx = buffer.indexOf("\n");
			while (newlineIdx !== -1) {
				const line = buffer.slice(0, newlineIdx);
				buffer = buffer.slice(newlineIdx + 1);
				if (Buffer.byteLength(line, "utf8") > this.maxLineBytes) {
					this.rejectOversizedLine(socket);
					rejected = true;
					buffer = "";
					return;
				}
				if (line.length > 0) {
					this.processLine(socket, line);
				}
				newlineIdx = buffer.indexOf("\n");
			}
			// Residual: a partial line still in flight. If it has already
			// exceeded the cap, no future newline can rescue it — drop the
			// connection now to bound memory.
			if (Buffer.byteLength(buffer, "utf8") > this.maxLineBytes) {
				this.rejectOversizedLine(socket);
				rejected = true;
				buffer = "";
				return;
			}
		});

		socket.on("close", () => {
			this.sockets.delete(socket);
		});

		socket.on("error", () => {
			this.sockets.delete(socket);
		});
	}

	/**
	 * Emit a `parse-error: line-too-long` response and destroy the
	 * socket. Used by the H1 byte-cap enforcement on both the
	 * per-extracted-line path and the residual-buffer path. Centralized
	 * here so the error string and destroy ordering stay identical
	 * across both call sites.
	 */
	private rejectOversizedLine(socket: net.Socket): void {
		if (!socket.destroyed && socket.writable) {
			const errResponse: IpcResponse = {
				ok: false,
				error: "parse-error: line-too-long",
			};
			socket.write(`${JSON.stringify(errResponse)}\n`);
		}
		socket.destroy();
	}

	/**
	 * Per-connection serialization. Each new request awaits the previous
	 * request's tail before writing its own response so writes go out in
	 * arrival order even when handlers resolve out-of-order.
	 *
	 * H3 (PR #44 Important #2): the chain swallows prior-tail rejections
	 * with `.catch` so a `socket.write` failure on request N does not
	 * propagate as an unhandled rejection on request N+1. The swallow
	 * logs to stderr so a real bug remains observable — the `.catch`
	 * neutralizes the unhandled-rejection blast but does not silence
	 * the signal. Dispatch itself runs eagerly (the Promise constructor
	 * calls dispatch synchronously) so a slow handler does not stall
	 * later cache-hit responses on its own connection — only the WRITE
	 * waits for the previous write.
	 *
	 * Codex H (high): serialization failure MUST NOT drop the request's
	 * response line. The newline-delimited protocol has no request IDs,
	 * so a missing response line on request N would cause a pipelined
	 * client to interpret request N+1's response as request N's. The
	 * write path wraps `JSON.stringify(response)` in try/catch and falls
	 * back to a guaranteed-serializable
	 * `{ ok:false, error:"internal: response serialization failed" }`
	 * line so every request receives exactly one response. The fallback
	 * uses only string + boolean fields and cannot itself fail to encode.
	 */
	private processLine(socket: net.Socket, line: string): void {
		const dispatched = this.dispatch(line);
		const previousTail = this.socketTails.get(socket) ?? Promise.resolve();
		const safePrevious = previousTail.catch((err: unknown) => {
			console.error("[ipc-server] previous tail rejected:", err);
		});
		const work = safePrevious.then(async () => {
			let response: IpcResponse;
			try {
				response = await dispatched;
			} catch (err) {
				// adv-pr44 M5 (Opus PR #56 dual-review I2): redact raw
				// error text before it leaves the daemon. Today the 0o600
				// socket perimeter limits exposure, but Phase 6 dashboard
				// + Phase 7 multi-tenancy will widen the trust boundary
				// and any tenant code must not probe handler internals
				// via crafted inputs. Log the full message to stderr for
				// ops; return generic "internal-error" to clients.
				const message = err instanceof Error ? err.message : String(err);
				console.error(
					"[ipc-server] handler error (redacted from client):",
					message,
				);
				response = { ok: false, error: "internal-error" };
			}
			let serialized: string;
			try {
				serialized = `${JSON.stringify(response)}\n`;
			} catch (err) {
				const fallback: IpcResponse = {
					ok: false,
					error: "internal: response serialization failed",
				};
				serialized = `${JSON.stringify(fallback)}\n`;
				console.error("[ipc-server] response serialization failed:", err);
			}
			if (!socket.destroyed && socket.writable) {
				socket.write(serialized);
			}
		});
		this.socketTails.set(socket, work);
		this.inflight.add(work);
		// Tail safety: attach a .catch so a work rejection (e.g., a
		// circular-reference JSON.stringify throw inside the response
		// write) is logged and consumed here. The `safePrevious` chain
		// above handles the case where a LATER request on the same
		// socket would otherwise observe the rejection; this catch
		// covers the case where no later request arrives. Together they
		// neutralize the H3 unhandled-rejection blast on every path.
		work
			.catch((err: unknown) => {
				console.error("[ipc-server] work rejected:", err);
			})
			.finally(() => {
				this.inflight.delete(work);
			});
	}

	private async dispatch(line: string): Promise<IpcResponse> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { ok: false, error: `parse-error: ${message}` };
		}

		if (
			typeof parsed !== "object" ||
			parsed === null ||
			typeof (parsed as { method?: unknown }).method !== "string"
		) {
			return { ok: false, error: "parse-error: missing method field" };
		}

		const method = (parsed as { method: string }).method;

		try {
			if (method === "fleet-health") {
				const data = await this.resolveFleetHealth();
				return { ok: true, data };
			}
			if (method === "list-agents") {
				const data = await this.listAgents();
				return { ok: true, data };
			}
			if (method === "get-handle") {
				const params = (parsed as { params?: unknown }).params;
				if (
					typeof params !== "object" ||
					params === null ||
					typeof (params as { handleId?: unknown }).handleId !== "string"
				) {
					return {
						ok: false,
						error: "parse-error: get-handle requires params.handleId",
					};
				}
				const data = this.getHandle((params as { handleId: string }).handleId);
				return { ok: true, data };
			}
			return { ok: false, error: `unknown-method: ${method}` };
		} catch (err) {
			// adv-pr44 M5 (Opus PR #56 dual-review I2): redact raw handler
			// message before it leaves the daemon UNLESS it starts with a
			// known-public protocol prefix. The cooldown path explicitly
			// throws "fleet-health: temporarily unavailable (retry in Nms)"
			// as a dashboard-actionable signal — that message is safe by
			// design. Everything else (e.g., raw downstream exception text)
			// gets redacted to "handler-error"; the full message stays in
			// stderr for ops.
			const message = err instanceof Error ? err.message : String(err);
			const isSafeProtocolError =
				message.startsWith("fleet-health:") ||
				message.startsWith("parse-error:");
			if (isSafeProtocolError) {
				return { ok: false, error: `handler-error: ${message}` };
			}
			console.error(
				"[ipc-server] handler-error (redacted from client):",
				message,
			);
			return { ok: false, error: "handler-error" };
		}
	}

	/**
	 * Resolve fleet-health with a layered thundering-herd posture:
	 *
	 * 1. Cache hit (< `cacheTtlMs` since last successful resolve) → return cached.
	 * 2. Cooldown active (last upstream call rejected within the last
	 *    `FLEET_HEALTH_REJECTION_COOLDOWN_MS` ms) → throw a typed
	 *    "temporarily unavailable" error WITHOUT re-invoking upstream.
	 *    The error string carries the remaining cooldown so dashboards
	 *    can render an actionable countdown.
	 * 3. In-flight refresh promise exists → join it (EC2).
	 * 4. Otherwise → start a fresh refresh, populate cache on success,
	 *    arm cooldown on rejection.
	 *
	 * The 1s cooldown is the minimum-viable absorb window: short enough
	 * that a recovering upstream is sampled quickly, long enough to
	 * debounce a sub-second retry storm. Phase 6 dashboard wiring may
	 * extend this with per-method cooldowns + richer error-state caching.
	 */
	private async resolveFleetHealth(): Promise<unknown> {
		const cached = this.cachedFleetHealth;
		if (cached !== null && this.now() - cached.at < this.cacheTtlMs) {
			return cached.data;
		}

		// H4 cooldown: if a recent upstream call rejected, short-circuit
		// without re-invoking. The C2 fix keeps the error message
		// dashboard-actionable (carries the retry-in countdown) rather
		// than leaking internal "upstream rejected" terminology.
		if (this.cachedFleetHealthRejectionUntilMs !== null) {
			const remaining = this.cachedFleetHealthRejectionUntilMs - this.now();
			if (remaining > 0) {
				throw new Error(
					`fleet-health: temporarily unavailable (retry in ${remaining}ms)`,
				);
			}
			// Cooldown elapsed — clear and fall through to a fresh probe.
			this.cachedFleetHealthRejectionUntilMs = null;
		}

		// EC2: concurrent expiry refresh share an in-flight promise.
		const existing = this.cachedFleetHealthPromise;
		if (existing !== null) {
			return existing;
		}

		const refresh = (async () => {
			try {
				const data = await this.getFleetHealth();
				this.cachedFleetHealth = { data, at: this.now() };
				// Successful resolve clears any prior cooldown.
				this.cachedFleetHealthRejectionUntilMs = null;
				return data;
			} catch (err) {
				// Arm the cooldown BEFORE rethrowing so concurrent joiners
				// see the cooldown when they fall through after this
				// rejection settles.
				this.cachedFleetHealthRejectionUntilMs =
					this.now() + FLEET_HEALTH_REJECTION_COOLDOWN_MS;
				throw err;
			} finally {
				this.cachedFleetHealthPromise = null;
			}
		})();
		this.cachedFleetHealthPromise = refresh;
		return refresh;
	}
}
