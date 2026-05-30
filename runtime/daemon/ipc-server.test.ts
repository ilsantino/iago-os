import * as fsp from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { IpcServer } from "./ipc-server.js";

const isWindows = process.platform === "win32";

function makeSocketPath(label: string): string {
	const tag = `iago-ipc-${label}-${process.pid}-${Date.now()}`;
	return isWindows
		? `\\\\.\\pipe\\${tag}`
		: path.join(os.tmpdir(), `${tag}.sock`);
}

async function sendRequest(
	socketPath: string,
	requests: unknown[],
	expectedCount = requests.length,
): Promise<{ responses: unknown[] }> {
	return new Promise<{ responses: unknown[] }>((resolve, reject) => {
		const client = net.createConnection(socketPath);
		let buffer = "";
		const responses: unknown[] = [];
		const fail = (err: Error) => {
			client.destroy();
			reject(err);
		};
		client.setEncoding("utf8");
		client.on("connect", () => {
			for (const req of requests) {
				client.write(`${JSON.stringify(req)}\n`);
			}
		});
		client.on("data", (chunk: string) => {
			buffer += chunk;
			let nl = buffer.indexOf("\n");
			while (nl !== -1) {
				const line = buffer.slice(0, nl);
				buffer = buffer.slice(nl + 1);
				if (line.length > 0) {
					try {
						responses.push(JSON.parse(line));
					} catch (err) {
						fail(err as Error);
						return;
					}
				}
				if (responses.length >= expectedCount) {
					client.end();
					resolve({ responses });
					return;
				}
				nl = buffer.indexOf("\n");
			}
		});
		client.on("error", fail);
		client.on("end", () => {
			if (responses.length < expectedCount) {
				reject(new Error(`closed early: ${responses.length}/${expectedCount}`));
			}
		});
	});
}

// Connect, run a writer that may emit raw / chunked bytes, and resolve
// with the first JSON-parsed response. Used by tests that bypass the
// standard newline-delimited send path (parse-error, EC3 chunking).
function readOneRaw(
	socketPath: string,
	bytesOrWriter: string | ((c: net.Socket) => void),
): Promise<unknown> {
	return new Promise<unknown>((resolve, reject) => {
		const client = net.createConnection(socketPath);
		let buffer = "";
		client.setEncoding("utf8");
		client.on("connect", () => {
			if (typeof bytesOrWriter === "string") client.write(bytesOrWriter);
			else bytesOrWriter(client);
		});
		client.on("data", (chunk: string) => {
			buffer += chunk;
			const nl = buffer.indexOf("\n");
			if (nl !== -1) {
				client.end();
				resolve(JSON.parse(buffer.slice(0, nl)));
			}
		});
		client.on("error", reject);
	});
}

interface ServerOverrides {
	readonly socketPath: string;
	readonly cacheTtlMs?: number;
	readonly maxLineBytes?: number;
	readonly idleTimeoutMs?: number;
	readonly getFleetHealth?: () => Promise<unknown>;
	readonly listAgents?: () => Promise<unknown>;
	readonly getHandle?: (id: string) => unknown;
}

function makeServer(opts: ServerOverrides): IpcServer {
	return new IpcServer({
		socketPath: opts.socketPath,
		cacheTtlMs: opts.cacheTtlMs,
		maxLineBytes: opts.maxLineBytes,
		idleTimeoutMs: opts.idleTimeoutMs,
		getFleetHealth: opts.getFleetHealth ?? (async () => ({})),
		listAgents: opts.listAgents ?? (async () => []),
		getHandle: opts.getHandle ?? (() => null),
	});
}

let server: IpcServer | null = null;

afterEach(async () => {
	if (server !== null) {
		await server.stop().catch(() => {});
		server = null;
	}
	vi.restoreAllMocks();
});

describe("IpcServer", () => {
	it("default socketPath matches platform", () => {
		const def = new IpcServer({
			getFleetHealth: async () => ({}),
			listAgents: async () => [],
			getHandle: () => null,
		});
		expect(def.socketPath).toBe(
			isWindows
				? "\\\\.\\pipe\\iago-os-v2-daemon"
				: "/tmp/iago-os-v2-daemon.sock",
		);
	});

	it("fleet-health roundtrip returns data", async () => {
		const socketPath = makeSocketPath("rt");
		const health = { agents: 3, ok: true };
		server = makeServer({ socketPath, getFleetHealth: async () => health });
		await server.start();

		const { responses } = await sendRequest(socketPath, [
			{ method: "fleet-health" },
		]);
		expect(responses[0]).toEqual({ ok: true, data: health });
	});

	it("caches fleet-health within TTL and refreshes after expiry", async () => {
		const socketPath = makeSocketPath("ttl");
		const probe = vi.fn(async () => ({ value: 1 }));
		server = makeServer({
			socketPath,
			cacheTtlMs: 30_000,
			getFleetHealth: probe,
		});
		let virtualNow = 1_000_000;
		server._setNowForTests(() => virtualNow);
		await server.start();
		await sendRequest(socketPath, [{ method: "fleet-health" }]);
		await sendRequest(socketPath, [{ method: "fleet-health" }]);
		expect(probe).toHaveBeenCalledTimes(1);
		virtualNow += 31_000;
		await sendRequest(socketPath, [{ method: "fleet-health" }]);
		expect(probe).toHaveBeenCalledTimes(2);
	});

	it("error responses: unknown / parse / missing-method / handler-error", async () => {
		const socketPath = makeSocketPath("errs");
		server = makeServer({
			socketPath,
			getFleetHealth: async () => {
				throw new Error("downstream-failure");
			},
		});
		await server.start();
		const errOf = (r: unknown) => (r as { error: string }).error;
		const unk = await sendRequest(socketPath, [{ method: "bogus" }]);
		expect(unk.responses[0]).toMatchObject({ ok: false });
		expect(errOf(unk.responses[0])).toMatch(/unknown-method/);
		const noMethod = await sendRequest(socketPath, [{ notMethod: "x" }]);
		expect(errOf(noMethod.responses[0])).toMatch(/missing method field/);
		const handlerErr = await sendRequest(socketPath, [
			{ method: "fleet-health" },
		]);
		expect(errOf(handlerErr.responses[0])).toMatch(/handler-error/);
		// adv-pr44 M5 (Opus PR #56 dual-review I2): redaction contract —
		// raw thrown message "downstream-failure" must NOT leak to the
		// client response. Stays in stderr for ops; wire payload generic.
		expect(errOf(handlerErr.responses[0])).not.toContain("downstream-failure");
		const parseErr = await readOneRaw(socketPath, "{ not json }\n");
		expect(errOf(parseErr)).toMatch(/parse-error/);
	});

	it("stop() closes server and rejects new connections", async () => {
		const socketPath = makeSocketPath("stop");
		server = makeServer({ socketPath });
		await server.start();
		await server.stop();
		server = null;
		await expect(
			new Promise<void>((_resolve, reject) => {
				const client = net.createConnection(socketPath);
				client.on("connect", () => client.destroy());
				client.on("error", reject);
			}),
		).rejects.toBeDefined();
	});

	it("handles multiple concurrent connections", async () => {
		const socketPath = makeSocketPath("conc");
		server = makeServer({
			socketPath,
			getFleetHealth: async () => ({ value: "ok" }),
		});
		await server.start();
		const results = await Promise.all(
			Array.from({ length: 10 }, () =>
				sendRequest(socketPath, [{ method: "fleet-health" }]),
			),
		);
		for (const r of results) {
			expect(r.responses[0]).toEqual({ ok: true, data: { value: "ok" } });
		}
	});

	it.skipIf(isWindows)(
		"start() succeeds with stale socket file (EC1)",
		async () => {
			const socketPath = makeSocketPath("stale");
			await fsp.writeFile(socketPath, "stale junk");
			server = makeServer({
				socketPath,
				getFleetHealth: async () => ({ ok: 1 }),
			});
			await expect(server.start()).resolves.toBeUndefined();
			const { responses } = await sendRequest(socketPath, [
				{ method: "fleet-health" },
			]);
			expect(responses[0]).toEqual({ ok: true, data: { ok: 1 } });
		},
	);

	it("concurrent fleet-health at expiry share one refresh (EC2)", async () => {
		const socketPath = makeSocketPath("herd");
		const probe = vi.fn(async () => {
			await new Promise((r) => setTimeout(r, 50));
			return { call: 1 };
		});
		server = makeServer({
			socketPath,
			cacheTtlMs: 30_000,
			getFleetHealth: probe,
		});
		await server.start();

		const all = await Promise.all(
			Array.from({ length: 10 }, () =>
				sendRequest(socketPath, [{ method: "fleet-health" }]),
			),
		);
		expect(probe).toHaveBeenCalledTimes(1);
		for (const r of all) {
			expect(r.responses[0]).toEqual({ ok: true, data: { call: 1 } });
		}
	});

	it("buffers chunked TCP writes until newline (EC3)", async () => {
		const socketPath = makeSocketPath("chunk");
		server = makeServer({
			socketPath,
			getFleetHealth: async () => ({ ok: true }),
		});
		await server.start();

		const payload = `${JSON.stringify({ method: "fleet-health" })}\n`;
		const response = await readOneRaw(socketPath, (client) => {
			let i = 0;
			const writeNext = () => {
				if (i >= payload.length) return;
				client.write(payload[i]);
				i += 1;
				setTimeout(writeNext, 2);
			};
			writeNext();
		});
		expect(response).toEqual({ ok: true, data: { ok: true } });
	});

	it("list-agents and get-handle (with missing-params parse-error)", async () => {
		const socketPath = makeSocketPath("methods");
		const agents = [{ id: "a-1" }, { id: "a-2" }];
		const handle = { id: "h-1", status: "ready" };
		server = makeServer({
			socketPath,
			listAgents: async () => agents,
			getHandle: (id) => (id === "h-1" ? handle : null),
		});
		await server.start();

		const { responses } = await sendRequest(socketPath, [
			{ method: "list-agents" },
			{ method: "get-handle", params: { handleId: "h-1" } },
			{ method: "get-handle" },
		]);
		expect(responses[0]).toEqual({ ok: true, data: agents });
		expect(responses[1]).toEqual({ ok: true, data: handle });
		expect((responses[2] as { error: string }).error).toMatch(/parse-error/);
	});

	it("preserves response order on a single connection when the first handler is slow", async () => {
		const socketPath = makeSocketPath("order");
		// First fleet-health is slow (latency); second list-agents would
		// otherwise resolve synchronously and overtake it.
		server = makeServer({
			socketPath,
			getFleetHealth: async () => {
				await new Promise((r) => setTimeout(r, 80));
				return { kind: "fleet-health" };
			},
			listAgents: async () => ({ kind: "list-agents" }),
		});
		await server.start();

		const { responses } = await sendRequest(socketPath, [
			{ method: "fleet-health" },
			{ method: "list-agents" },
		]);
		expect(responses[0]).toEqual({ ok: true, data: { kind: "fleet-health" } });
		expect(responses[1]).toEqual({ ok: true, data: { kind: "list-agents" } });
	});

	it("double start() is a no-op and concurrent start() resolves to one listener", async () => {
		const socketPath = makeSocketPath("double");
		server = makeServer({ socketPath });
		// Race two start() calls; only one listen() should win.
		await Promise.all([server.start(), server.start()]);
		await expect(server.start()).resolves.toBeUndefined();
	});

	it("stop() before start() is a no-op", async () => {
		const socketPath = makeSocketPath("nostart");
		const s = makeServer({ socketPath });
		await expect(s.stop()).resolves.toBeUndefined();
	});

	it.skipIf(isWindows)("socket file uses owner-only mode (0o600)", async () => {
		const socketPath = makeSocketPath("perm");
		server = makeServer({ socketPath });
		await server.start();
		const stat = await fsp.stat(socketPath);
		expect(stat.mode & 0o777).toBe(0o600);
	});

	it("handleConnection drops a connection that exceeds MAX_LINE_BYTES without a newline (H1)", async () => {
		const socketPath = makeSocketPath("bufcap");
		const health = { ok: true, value: "post-overflow" };
		server = makeServer({ socketPath, getFleetHealth: async () => health });
		await server.start();

		const overflowResponse = await new Promise<{
			response: unknown;
			destroyed: boolean;
		}>((resolve, reject) => {
			const client = net.createConnection(socketPath);
			let buf = "";
			let response: unknown;
			client.setEncoding("utf8");
			client.on("connect", () => {
				// 100 KiB of 'x' with no newline — exceeds the 64 KiB default cap.
				client.write(Buffer.alloc(100 * 1024, "x"));
			});
			client.on("data", (chunk: string) => {
				buf += chunk;
				const nl = buf.indexOf("\n");
				if (nl !== -1 && response === undefined) {
					try {
						response = JSON.parse(buf.slice(0, nl));
					} catch (err) {
						reject(err);
					}
				}
			});
			client.on("close", () => {
				resolve({ response, destroyed: client.destroyed });
			});
			client.on("error", () => {
				/* connection reset after destroy is expected on some platforms */
			});
		});

		expect(overflowResponse.response).toMatchObject({ ok: false });
		expect((overflowResponse.response as { error: string }).error).toMatch(
			/line-too-long/,
		);
		expect(overflowResponse.destroyed).toBe(true);

		// A second fresh connection still works — the server is unaffected.
		const { responses } = await sendRequest(socketPath, [
			{ method: "fleet-health" },
		]);
		expect(responses[0]).toEqual({ ok: true, data: health });
	});

	it("respects a custom maxLineBytes override (stress C1)", async () => {
		const socketPath = makeSocketPath("bufcap-custom");
		server = makeServer({
			socketPath,
			maxLineBytes: 256,
			getFleetHealth: async () => ({ ok: true }),
		});
		await server.start();

		const overflowResponse = await new Promise<unknown>((resolve, reject) => {
			const client = net.createConnection(socketPath);
			let buf = "";
			client.setEncoding("utf8");
			client.on("connect", () => {
				// 512 bytes, no newline — exceeds the custom 256 B cap.
				client.write(Buffer.alloc(512, "y"));
			});
			client.on("data", (chunk: string) => {
				buf += chunk;
				const nl = buf.indexOf("\n");
				if (nl !== -1) {
					try {
						resolve(JSON.parse(buf.slice(0, nl)));
					} catch (err) {
						reject(err);
					}
				}
			});
			client.on("error", () => {
				/* expected */
			});
		});

		expect(overflowResponse).toMatchObject({ ok: false });
		expect((overflowResponse as { error: string }).error).toMatch(
			/line-too-long/,
		);
	});

	it("rejects an oversized line that arrives with a trailing newline in the same chunk (Codex M)", async () => {
		// Pre-fix bug: the chunk-level guard required `!buffer.includes("\n")`,
		// so a single data event carrying an oversized line followed by `\n`
		// skipped the cap and dispatched the line. The fix enforces the byte
		// cap on every extracted line BEFORE dispatch, regardless of where
		// the newline lands inside the data event.
		const socketPath = makeSocketPath("oversize-nl");
		server = makeServer({
			socketPath,
			maxLineBytes: 256,
			getFleetHealth: async () => ({ ok: true }),
		});
		await server.start();

		const overflowResponse = await new Promise<unknown>((resolve, reject) => {
			const client = net.createConnection(socketPath);
			let buf = "";
			client.setEncoding("utf8");
			client.on("connect", () => {
				// 512 bytes of `y` + trailing newline. The line is 512 bytes
				// (exceeds the 256 B cap) and arrives WITH the newline.
				client.write(`${"y".repeat(512)}\n`);
			});
			client.on("data", (chunk: string) => {
				buf += chunk;
				const nl = buf.indexOf("\n");
				if (nl !== -1) {
					try {
						resolve(JSON.parse(buf.slice(0, nl)));
					} catch (err) {
						reject(err);
					}
				}
			});
			client.on("error", () => {
				/* connection reset after destroy is expected */
			});
		});

		expect(overflowResponse).toMatchObject({ ok: false });
		expect((overflowResponse as { error: string }).error).toMatch(
			/line-too-long/,
		);
	});

	it("enforces maxLineBytes as a UTF-8 byte bound, not a UTF-16 length bound (Codex M)", async () => {
		// Pre-fix bug: the cap measured `string.length` (UTF-16 code units)
		// after `setEncoding("utf8")`, so multibyte input could exceed the
		// advertised byte budget while still passing the legacy check.
		// Five 😀 emojis = 20 UTF-8 bytes but only 10 UTF-16 code units;
		// at a 16-byte cap, the legacy check would pass them through. The
		// fix uses `Buffer.byteLength(..., "utf8")` so the byte cap is real.
		const socketPath = makeSocketPath("oversize-mb");
		server = makeServer({
			socketPath,
			maxLineBytes: 16,
			getFleetHealth: async () => ({ ok: true }),
		});
		await server.start();

		const payload = `${"😀".repeat(5)}\n`;
		const overflowResponse = await new Promise<unknown>((resolve, reject) => {
			const client = net.createConnection(socketPath);
			let buf = "";
			client.setEncoding("utf8");
			client.on("connect", () => {
				client.write(payload);
			});
			client.on("data", (chunk: string) => {
				buf += chunk;
				const nl = buf.indexOf("\n");
				if (nl !== -1) {
					try {
						resolve(JSON.parse(buf.slice(0, nl)));
					} catch (err) {
						reject(err);
					}
				}
			});
			client.on("error", () => {
				/* connection reset after destroy is expected */
			});
		});

		expect(overflowResponse).toMatchObject({ ok: false });
		expect((overflowResponse as { error: string }).error).toMatch(
			/line-too-long/,
		);
	});

	it("idle connections are destroyed after the timeout (H2)", async () => {
		const socketPath = makeSocketPath("idle");
		server = makeServer({
			socketPath,
			idleTimeoutMs: 50,
		});
		await server.start();

		const result = await new Promise<{
			closed: boolean;
			destroyed: boolean;
			elapsed: number;
		}>((resolve) => {
			const startMs = Date.now();
			const client = net.createConnection(socketPath);
			client.setEncoding("utf8");
			client.on("close", () => {
				resolve({
					closed: true,
					destroyed: client.destroyed,
					elapsed: Date.now() - startMs,
				});
			});
			client.on("error", () => {
				/* idle-timeout destroy may surface as ECONNRESET */
			});
		});

		expect(result.closed).toBe(true);
		expect(result.destroyed).toBe(true);
		// Allow generous slack: 50ms timeout + scheduler jitter under load.
		expect(result.elapsed).toBeLessThan(2_000);
	});

	it("response serialization failure emits a fallback error and preserves 1:1 ordering (H3 / Codex H)", async () => {
		const socketPath = makeSocketPath("tail-isolate");
		let call = 0;
		// Use list-agents (no caching / no EC2 in-flight sharing) so
		// the two back-to-back requests resolve to DIFFERENT payloads.
		// Request 1 returns a circular object whose JSON.stringify
		// throws in the response-write path. Pre-Codex-H the write was
		// dropped → request 2's response could be misread as request
		// 1's by a pipelined client (no request IDs in the protocol).
		// Post-fix: request 1 receives a guaranteed-serializable
		// `internal: response serialization failed` fallback so every
		// request gets exactly one response line in arrival order.
		const listAgents = async () => {
			call += 1;
			if (call === 1) {
				const circular: { self?: unknown } = {};
				circular.self = circular;
				return circular;
			}
			return { ok: "post" };
		};
		server = makeServer({ socketPath, listAgents });
		await server.start();

		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => {
			unhandled.push(reason);
		};
		process.on("unhandledRejection", onUnhandled);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			// Send two requests back-to-back on the SAME socket. Both
			// MUST produce a response line, in arrival order, so the
			// pipelined client cannot misalign request 2's response
			// onto request 1.
			const { responses } = await sendRequest(
				socketPath,
				[{ method: "list-agents" }, { method: "list-agents" }],
				2,
			);

			// Drain the event loop so any deferred unhandled-rejection
			// microtask has a chance to fire before we assert.
			await new Promise((r) => setTimeout(r, 50));

			// 1:1 ordering invariant: request 1 gets the serialization
			// fallback error; request 2 gets its success payload. Pre-fix
			// the response list would have been `[{ok:true, data:{ok:"post"}}]`
			// (only one line) — exactly the desync Codex flagged.
			expect(responses).toHaveLength(2);
			expect(responses[0]).toMatchObject({ ok: false });
			expect((responses[0] as { error: string }).error).toMatch(
				/response serialization failed/,
			);
			expect(responses[1]).toEqual({ ok: true, data: { ok: "post" } });
			expect(unhandled).toHaveLength(0);
			// Lock the stderr-trace contract: a future refactor that
			// drops the console.error from the serialization catch would
			// otherwise pass the assertions above silently.
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("response serialization failed"),
				expect.anything(),
			);
		} finally {
			process.removeListener("unhandledRejection", onUnhandled);
			errorSpy.mockRestore();
		}
	});

	it("rejection cooldown prevents thundering-herd on persistent upstream failure (H4)", async () => {
		const socketPath = makeSocketPath("cooldown");
		const probe = vi.fn(async () => {
			throw new Error("upstream-down");
		});
		server = makeServer({
			socketPath,
			cacheTtlMs: 30_000,
			getFleetHealth: probe,
		});
		let virtualNow = 1_000_000;
		server._setNowForTests(() => virtualNow);
		await server.start();

		// Fire 5 concurrent requests; only ONE probe invocation should
		// happen because they share the in-flight promise (EC2) or hit the
		// cooldown that the first rejection armed. All 5 callers receive an
		// error. Error format is either "handler-error" (direct rejection
		// joiners) or "fleet-health: temporarily unavailable" (cooldown path
		// for requests that arrive after the cooldown is armed) — both are
		// correct; the key invariant is that "upstream-down" never leaks.
		const burst = await Promise.all(
			Array.from({ length: 5 }, () =>
				sendRequest(socketPath, [{ method: "fleet-health" }]),
			),
		);
		expect(probe).toHaveBeenCalledTimes(1);
		for (const r of burst) {
			expect(r.responses[0]).toMatchObject({ ok: false });
			// Internal error detail must not leak regardless of which path fired.
			expect((r.responses[0] as { error: string }).error).not.toContain(
				"upstream-down",
			);
		}

		// 6th request within the 1s cooldown window: cooldown fires →
		// NO additional probe invocation.
		virtualNow += 500;
		const sixth = await sendRequest(socketPath, [{ method: "fleet-health" }]);
		expect(probe).toHaveBeenCalledTimes(1);
		expect((sixth.responses[0] as { error: string }).error).toMatch(
			/temporarily unavailable/,
		);
		expect((sixth.responses[0] as { error: string }).error).toMatch(
			/retry in \d+ms/,
		);

		// Advance past the cooldown + switch the probe to a resolving impl.
		virtualNow += 1_100;
		probe.mockReset();
		probe.mockImplementation(async () => ({ recovered: true }));
		const seventh = await sendRequest(socketPath, [{ method: "fleet-health" }]);
		expect(probe).toHaveBeenCalledTimes(1);
		expect(seventh.responses[0]).toEqual({
			ok: true,
			data: { recovered: true },
		});
	});

	it("successful fleet-health clears the rejection cooldown", async () => {
		const socketPath = makeSocketPath("cooldown-clear");
		let mode: "fail" | "ok" = "fail";
		const probe = vi.fn(async () => {
			if (mode === "fail") throw new Error("upstream-down");
			return { mode: "ok" };
		});
		server = makeServer({
			socketPath,
			cacheTtlMs: 30_000,
			getFleetHealth: probe,
		});
		let virtualNow = 2_000_000;
		server._setNowForTests(() => virtualNow);
		await server.start();

		// Trigger a failing call → arms the cooldown.
		const fail = await sendRequest(socketPath, [{ method: "fleet-health" }]);
		expect((fail.responses[0] as { error: string }).error).toMatch(
			/handler-error/,
		);
		expect(probe).toHaveBeenCalledTimes(1);

		// Advance past the cooldown so the upstream is re-sampled.
		virtualNow += 1_100;
		mode = "ok";
		const ok = await sendRequest(socketPath, [{ method: "fleet-health" }]);
		expect(ok.responses[0]).toEqual({ ok: true, data: { mode: "ok" } });
		expect(probe).toHaveBeenCalledTimes(2);

		// Immediately fire another request. With cooldown cleared on
		// success AND cache populated, this hits the 30s TTL cache: no
		// new probe invocation, no "temporarily unavailable" error.
		const cached = await sendRequest(socketPath, [{ method: "fleet-health" }]);
		expect(cached.responses[0]).toEqual({ ok: true, data: { mode: "ok" } });
		expect(probe).toHaveBeenCalledTimes(2);
	});

	it("rejection cooldown does not persist across stop/start (stress I3)", async () => {
		const socketPath = makeSocketPath("cooldown-restart");
		let mode: "fail" | "ok" = "fail";
		const probe = vi.fn(async () => {
			if (mode === "fail") throw new Error("upstream-down");
			return { restart: "ok" };
		});
		server = makeServer({
			socketPath,
			cacheTtlMs: 30_000,
			getFleetHealth: probe,
		});
		await server.start();

		// Arm the cooldown via a failing call.
		const fail = await sendRequest(socketPath, [{ method: "fleet-health" }]);
		expect((fail.responses[0] as { error: string }).error).toMatch(
			/handler-error/,
		);
		expect(probe).toHaveBeenCalledTimes(1);

		// Stop + restart the server; cooldown state MUST NOT carry over.
		await server.stop();
		mode = "ok";
		await server.start();

		const fresh = await sendRequest(socketPath, [{ method: "fleet-health" }]);
		expect(fresh.responses[0]).toEqual({
			ok: true,
			data: { restart: "ok" },
		});
		// New probe invocation must have happened — cooldown did NOT
		// short-circuit the fresh boot's call.
		expect(probe).toHaveBeenCalledTimes(2);
	});
});
