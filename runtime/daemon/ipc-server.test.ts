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
	readonly getFleetHealth?: () => Promise<unknown>;
	readonly listAgents?: () => Promise<unknown>;
	readonly getHandle?: (id: string) => unknown;
}

function makeServer(opts: ServerOverrides): IpcServer {
	return new IpcServer({
		socketPath: opts.socketPath,
		cacheTtlMs: opts.cacheTtlMs,
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
});
