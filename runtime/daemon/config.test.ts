import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "./config.js";

const ENV_KEYS = [
	"IAGO_DAEMON_CONFIG_PATH",
	"IAGO_TELEGRAM_BOT_TOKEN",
	"IAGO_TELEGRAM_ALLOWED_USER_IDS",
	"IAGO_DAEMON_HEARTBEAT_INTERVAL_MS",
	"IAGO_DAEMON_RSS_LIMIT_BYTES",
	"IAGO_DAEMON_STALL_THRESHOLD_MS",
	"IAGO_DAEMON_IPC_SOCKET_PATH",
	"IAGO_DAEMON_IPC_CACHE_TTL_MS",
] as const;

describe("daemon/config loadConfig", () => {
	let savedEnv: Record<string, string | undefined>;
	let tempDirs: string[] = [];
	let isolatedCwd: string;

	beforeEach(async () => {
		savedEnv = {};
		for (const key of ENV_KEYS) {
			savedEnv[key] = process.env[key];
			delete process.env[key];
		}
		isolatedCwd = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-config-cwd-"));
		tempDirs.push(isolatedCwd);
		// Point cwd at an empty dir so the default runtime/daemon-config.json
		// lookup misses and we hit the built-in defaults branch by default.
		vi.spyOn(process, "cwd").mockReturnValue(isolatedCwd);
	});

	afterEach(async () => {
		for (const key of ENV_KEYS) {
			const prev = savedEnv[key];
			if (prev === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = prev;
			}
		}
		vi.restoreAllMocks();
		for (const dir of tempDirs) {
			await fsp.rm(dir, { recursive: true, force: true });
		}
		tempDirs = [];
	});

	it("applies built-in defaults when env and config file are absent", async () => {
		const cfg = await loadConfig();
		expect(cfg.telegram).toBeNull();
		expect(cfg.agents).toEqual([]);
		expect(cfg.heartbeat.intervalMs).toBe(60_000);
		expect(cfg.heartbeat.rssLimitBytes).toBe(512 * 1024 * 1024);
		expect(cfg.heartbeat.stallThresholdMs).toBe(5 * 60_000);
		expect(typeof cfg.ipc.socketPath).toBe("string");
		expect(cfg.ipc.socketPath.length).toBeGreaterThan(0);
		expect(cfg.ipc.cacheTtlMs).toBe(30_000);
	});

	it("IAGO_TELEGRAM_BOT_TOKEN populates telegram.token", async () => {
		process.env.IAGO_TELEGRAM_BOT_TOKEN = "fake-token-xyz";
		const cfg = await loadConfig();
		expect(cfg.telegram).not.toBeNull();
		expect(cfg.telegram?.token).toBe("fake-token-xyz");
		expect(cfg.telegram?.allowedUserIds).toEqual([]);
	});

	it('IAGO_TELEGRAM_ALLOWED_USER_IDS="111,222" parses to [111, 222]', async () => {
		process.env.IAGO_TELEGRAM_BOT_TOKEN = "fake-token";
		process.env.IAGO_TELEGRAM_ALLOWED_USER_IDS = "111,222";
		const cfg = await loadConfig();
		expect(cfg.telegram?.allowedUserIds).toEqual([111, 222]);
	});

	it("loads a JSON config file referenced by IAGO_DAEMON_CONFIG_PATH", async () => {
		const tempDir = await fsp.mkdtemp(
			path.join(os.tmpdir(), "iago-config-file-"),
		);
		tempDirs.push(tempDir);
		const cfgPath = path.join(tempDir, "daemon-config.json");
		const payload = {
			telegram: {
				token: "file-token",
				allowedUserIds: [42, 99],
			},
			agents: [
				{
					agentId: "agent-alpha",
					runtimeId: "claude-pty",
					org: "iago",
					cwd: "/tmp/agent",
					env: { CLAUDE_CODE_SESSION_ID: "abc" },
					autoStart: true,
				},
			],
			heartbeat: {
				intervalMs: 1_000,
				rssLimitBytes: 1_048_576,
				stallThresholdMs: 30_000,
			},
			ipc: {
				socketPath: "/tmp/iago-custom.sock",
				cacheTtlMs: 5_000,
			},
		};
		await fsp.writeFile(cfgPath, JSON.stringify(payload), "utf8");
		process.env.IAGO_DAEMON_CONFIG_PATH = cfgPath;

		const cfg = await loadConfig();

		expect(cfg.telegram?.token).toBe("file-token");
		expect(cfg.telegram?.allowedUserIds).toEqual([42, 99]);
		expect(cfg.agents).toHaveLength(1);
		expect(cfg.agents[0]?.agentId).toBe("agent-alpha");
		expect(cfg.agents[0]?.runtimeId).toBe("claude-pty");
		expect(cfg.agents[0]?.org).toBe("iago");
		expect(cfg.agents[0]?.cwd).toBe("/tmp/agent");
		expect(cfg.agents[0]?.env).toEqual({ CLAUDE_CODE_SESSION_ID: "abc" });
		expect(cfg.agents[0]?.autoStart).toBe(true);
		expect(cfg.heartbeat.intervalMs).toBe(1_000);
		expect(cfg.heartbeat.rssLimitBytes).toBe(1_048_576);
		expect(cfg.heartbeat.stallThresholdMs).toBe(30_000);
		expect(cfg.ipc.socketPath).toBe("/tmp/iago-custom.sock");
		expect(cfg.ipc.cacheTtlMs).toBe(5_000);
	});

	it("env overrides file when both are present", async () => {
		const tempDir = await fsp.mkdtemp(
			path.join(os.tmpdir(), "iago-config-ovr-"),
		);
		tempDirs.push(tempDir);
		const cfgPath = path.join(tempDir, "daemon-config.json");
		const payload = {
			telegram: { token: "file-token", allowedUserIds: [1, 2] },
			heartbeat: {
				intervalMs: 1_000,
				rssLimitBytes: 1_048_576,
				stallThresholdMs: 30_000,
			},
		};
		await fsp.writeFile(cfgPath, JSON.stringify(payload), "utf8");
		process.env.IAGO_DAEMON_CONFIG_PATH = cfgPath;
		process.env.IAGO_TELEGRAM_BOT_TOKEN = "env-token-wins";
		process.env.IAGO_TELEGRAM_ALLOWED_USER_IDS = "777";
		process.env.IAGO_DAEMON_HEARTBEAT_INTERVAL_MS = "250";

		const cfg = await loadConfig();

		expect(cfg.telegram?.token).toBe("env-token-wins");
		expect(cfg.telegram?.allowedUserIds).toEqual([777]);
		expect(cfg.heartbeat.intervalMs).toBe(250);
		// Non-overridden fields stay from the file.
		expect(cfg.heartbeat.rssLimitBytes).toBe(1_048_576);
		expect(cfg.heartbeat.stallThresholdMs).toBe(30_000);
	});

	it("malformed JSON in config file throws an error mentioning the path", async () => {
		const tempDir = await fsp.mkdtemp(
			path.join(os.tmpdir(), "iago-config-bad-"),
		);
		tempDirs.push(tempDir);
		const cfgPath = path.join(tempDir, "daemon-config.json");
		await fsp.writeFile(cfgPath, "{this is not json", "utf8");
		process.env.IAGO_DAEMON_CONFIG_PATH = cfgPath;

		await expect(loadConfig()).rejects.toThrow(
			new RegExp(cfgPath.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")),
		);
	});

	it("telegram is null when there is no env token and no file telegram entry", async () => {
		const tempDir = await fsp.mkdtemp(
			path.join(os.tmpdir(), "iago-config-notg-"),
		);
		tempDirs.push(tempDir);
		const cfgPath = path.join(tempDir, "daemon-config.json");
		await fsp.writeFile(cfgPath, JSON.stringify({ agents: [] }), "utf8");
		process.env.IAGO_DAEMON_CONFIG_PATH = cfgPath;

		const cfg = await loadConfig();
		expect(cfg.telegram).toBeNull();
	});

	it("heartbeat env overrides apply individually", async () => {
		process.env.IAGO_DAEMON_HEARTBEAT_INTERVAL_MS = "111";
		process.env.IAGO_DAEMON_RSS_LIMIT_BYTES = "2048";
		process.env.IAGO_DAEMON_STALL_THRESHOLD_MS = "3333";
		const cfg = await loadConfig();
		expect(cfg.heartbeat.intervalMs).toBe(111);
		expect(cfg.heartbeat.rssLimitBytes).toBe(2048);
		expect(cfg.heartbeat.stallThresholdMs).toBe(3333);
	});

	// --------------------------------------------------------------------
	// Plan 01b Task 3 — AgentConfig.authProfile schema slot tests.
	// Phase 2 PROVISIONS the credentials and adds the schema field;
	// Phase 3 wires it through to the claude-pty adapter. Phase 2 tests
	// only assert round-trip through the config loader.
	// --------------------------------------------------------------------

	async function writeAgentsConfig(agents: unknown[]): Promise<string> {
		const tempDir = await fsp.mkdtemp(
			path.join(os.tmpdir(), "iago-config-auth-"),
		);
		tempDirs.push(tempDir);
		const cfgPath = path.join(tempDir, "daemon-config.json");
		await fsp.writeFile(cfgPath, JSON.stringify({ agents }), "utf8");
		return cfgPath;
	}

	it("(authProfile) AgentConfig without authProfile parses and field is undefined", async () => {
		const cfgPath = await writeAgentsConfig([
			{
				agentId: "agent-a",
				runtimeId: "claude-pty",
				cwd: "/tmp/a",
				env: {},
				autoStart: false,
			},
		]);
		process.env.IAGO_DAEMON_CONFIG_PATH = cfgPath;
		const cfg = await loadConfig();
		expect(cfg.agents).toHaveLength(1);
		expect(cfg.agents[0]?.authProfile).toBeUndefined();
	});

	it('(authProfile) accepts "default"', async () => {
		const cfgPath = await writeAgentsConfig([
			{
				agentId: "agent-a",
				runtimeId: "claude-pty",
				cwd: "/tmp/a",
				env: {},
				autoStart: false,
				authProfile: "default",
			},
		]);
		process.env.IAGO_DAEMON_CONFIG_PATH = cfgPath;
		const cfg = await loadConfig();
		expect(cfg.agents[0]?.authProfile).toBe("default");
	});

	it('(authProfile) accepts "ilsantino"', async () => {
		const cfgPath = await writeAgentsConfig([
			{
				agentId: "agent-a",
				runtimeId: "claude-pty",
				cwd: "/tmp/a",
				env: {},
				autoStart: false,
				authProfile: "ilsantino",
			},
		]);
		process.env.IAGO_DAEMON_CONFIG_PATH = cfgPath;
		const cfg = await loadConfig();
		expect(cfg.agents[0]?.authProfile).toBe("ilsantino");
	});

	it('(authProfile) accepts "iaguito"', async () => {
		const cfgPath = await writeAgentsConfig([
			{
				agentId: "agent-a",
				runtimeId: "claude-pty",
				cwd: "/tmp/a",
				env: {},
				autoStart: false,
				authProfile: "iaguito",
			},
		]);
		process.env.IAGO_DAEMON_CONFIG_PATH = cfgPath;
		const cfg = await loadConfig();
		expect(cfg.agents[0]?.authProfile).toBe("iaguito");
	});

	it("(authProfile) rejects unknown value with RangeError naming value + allowed set", async () => {
		const cfgPath = await writeAgentsConfig([
			{
				agentId: "agent-a",
				runtimeId: "claude-pty",
				cwd: "/tmp/a",
				env: {},
				autoStart: false,
				authProfile: "unknown",
			},
		]);
		process.env.IAGO_DAEMON_CONFIG_PATH = cfgPath;
		await expect(loadConfig()).rejects.toThrow(/unknown/);
		await expect(loadConfig()).rejects.toThrow(/default\|ilsantino\|iaguito/);
	});
});
