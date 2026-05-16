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
	readonly getFleetHealth: () => Promise<unknown>;
	readonly listAgents: () => Promise<unknown>;
	readonly getHandle: (id: string) => unknown;
}

const DEFAULT_CACHE_TTL_MS = 30_000;

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

	private readonly getFleetHealth: () => Promise<unknown>;
	private readonly listAgents: () => Promise<unknown>;
	private readonly getHandle: (id: string) => unknown;

	private server: net.Server | null = null;
	private startingPromise: Promise<void> | null = null;
	private cachedFleetHealth: CachedFleetHealth | null = null;
	private cachedFleetHealthPromise: Promise<unknown> | null = null;
	private readonly inflight = new Set<Promise<void>>();
	private readonly sockets = new Set<net.Socket>();
	private readonly socketTails = new WeakMap<net.Socket, Promise<void>>();
	private now: () => number = Date.now;

	constructor(opts: IpcServerOpts) {
		this.socketPath = opts.socketPath ?? defaultSocketPath();
		this.cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
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

		this.server = server;

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
	}

	private handleConnection(socket: net.Socket): void {
		this.sockets.add(socket);
		let buffer = "";

		socket.setEncoding("utf8");

		socket.on("data", (chunk: string) => {
			buffer += chunk;
			// EC3: parse complete lines only.
			let newlineIdx = buffer.indexOf("\n");
			while (newlineIdx !== -1) {
				const line = buffer.slice(0, newlineIdx);
				buffer = buffer.slice(newlineIdx + 1);
				if (line.length > 0) {
					this.processLine(socket, line);
				}
				newlineIdx = buffer.indexOf("\n");
			}
		});

		socket.on("close", () => {
			this.sockets.delete(socket);
		});

		socket.on("error", () => {
			this.sockets.delete(socket);
		});
	}

	private processLine(socket: net.Socket, line: string): void {
		// Per-connection serialization: chain each response on the
		// previous request's tail so writes go out in arrival order even
		// when handlers resolve out-of-order. Dispatch itself runs eagerly
		// (the Promise constructor calls dispatch synchronously) so a slow
		// handler does not stall later cache-hit responses on its own
		// connection — only the WRITE waits for the previous write.
		const dispatched = this.dispatch(line);
		const previousTail = this.socketTails.get(socket) ?? Promise.resolve();
		const work = previousTail.then(async () => {
			let response: IpcResponse;
			try {
				response = await dispatched;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				response = { ok: false, error: `internal: ${message}` };
			}
			if (!socket.destroyed && socket.writable) {
				socket.write(`${JSON.stringify(response)}\n`);
			}
		});
		this.socketTails.set(socket, work);
		this.inflight.add(work);
		work.finally(() => {
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
			const message = err instanceof Error ? err.message : String(err);
			return { ok: false, error: `handler-error: ${message}` };
		}
	}

	private async resolveFleetHealth(): Promise<unknown> {
		const cached = this.cachedFleetHealth;
		if (cached !== null && this.now() - cached.at < this.cacheTtlMs) {
			return cached.data;
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
				return data;
			} finally {
				this.cachedFleetHealthPromise = null;
			}
		})();
		this.cachedFleetHealthPromise = refresh;
		return refresh;
	}
}
