/**
 * Daemon configuration loader.
 *
 * Resolution order (Plan 07 Task 1):
 *   1. `IAGO_DAEMON_CONFIG_PATH` env var → JSON file path.
 *   2. `runtime/daemon-config.json` (repo-root convention) if it exists.
 *   3. Built-in defaults (no agents auto-started, Telegram disabled).
 *
 * Env vars override file values:
 *   - `IAGO_TELEGRAM_BOT_TOKEN`
 *   - `IAGO_TELEGRAM_ALLOWED_USER_IDS` (comma-separated decimal ids)
 *   - `IAGO_DAEMON_HEARTBEAT_INTERVAL_MS`
 *   - `IAGO_DAEMON_RSS_LIMIT_BYTES`
 *   - `IAGO_DAEMON_STALL_THRESHOLD_MS`
 *   - `IAGO_DAEMON_IPC_SOCKET_PATH`
 *   - `IAGO_DAEMON_IPC_CACHE_TTL_MS`
 *
 * Telegram is OFF unless a non-empty token is resolved from either
 * source — the daemon must boot for the unit-test path without a real
 * Telegram bot.
 *
 * Malformed JSON in the resolved config file throws a `RangeError`
 * whose message names the offending path so the operator can fix it.
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";

import { getErrnoCode } from "./state-paths.js";

export interface AgentConfig {
	readonly agentId: string;
	readonly runtimeId: string;
	readonly org?: string;
	readonly cwd: string;
	readonly env: Record<string, string>;
	readonly autoStart: boolean;
	/**
	 * Phase 2 schema slot; Phase 3 wires this through to the claude-pty
	 * adapter's per-spawn ANTHROPIC_API_KEY env override. `undefined`
	 * and `"default"` are semantically equivalent in Phase 3 (both
	 * resolve to the default profile); document this equivalence to
	 * prevent a future divergence bug. Allowed values are the three
	 * profile names provisioned by 01a's
	 * `provision-credentials.sh` (iago-anthropic-default,
	 * iago-anthropic-ilsantino, iago-anthropic-iaguito).
	 */
	readonly authProfile?: "default" | "ilsantino" | "iaguito";
}

const ALLOWED_AUTH_PROFILES = ["default", "ilsantino", "iaguito"] as const;
type AuthProfile = (typeof ALLOWED_AUTH_PROFILES)[number];

function isAuthProfile(value: unknown): value is AuthProfile {
	return (
		typeof value === "string" &&
		(ALLOWED_AUTH_PROFILES as readonly string[]).includes(value)
	);
}

export interface DaemonTelegramConfig {
	readonly token: string;
	readonly allowedUserIds: number[];
}

export interface DaemonHeartbeatConfig {
	readonly intervalMs: number;
	readonly rssLimitBytes: number;
	readonly stallThresholdMs: number;
}

export interface DaemonIpcConfig {
	readonly socketPath: string;
	readonly cacheTtlMs: number;
}

export interface DaemonConfig {
	readonly telegram: DaemonTelegramConfig | null;
	readonly agents: AgentConfig[];
	readonly heartbeat: DaemonHeartbeatConfig;
	readonly ipc: DaemonIpcConfig;
	/**
	 * Per-stage shutdown timeout (ms). Stress note I1 (plan
	 * feature-phase-1-deferred-hardening/03): exposed as a test-affordance
	 * so the shutdown-hang integration test can pass 50ms instead of
	 * blocking on the 10s production default. Optional; omit to inherit
	 * `SHUTDOWN_STAGE_TIMEOUT_MS` in `daemon/main.ts`.
	 */
	readonly shutdownStageTimeoutMs?: number;
}

const DEFAULT_HEARTBEAT: DaemonHeartbeatConfig = {
	intervalMs: 60_000,
	rssLimitBytes: 512 * 1024 * 1024,
	stallThresholdMs: 5 * 60_000,
};

function defaultIpcSocketPath(): string {
	if (process.platform === "win32") {
		return "\\\\.\\pipe\\iago-os-v2-daemon";
	}
	return "/tmp/iago-os-v2-daemon.sock";
}

function defaultIpc(): DaemonIpcConfig {
	return {
		socketPath: defaultIpcSocketPath(),
		cacheTtlMs: 30_000,
	};
}

function parseIntStrict(raw: string, field: string): number {
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		throw new RangeError(`${field}: empty value`);
	}
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
		throw new RangeError(`${field}: not an integer (got "${raw}")`);
	}
	return parsed;
}

function parseAllowedUserIds(raw: string, field: string): number[] {
	const out: number[] = [];
	for (const piece of raw.split(",")) {
		const trimmed = piece.trim();
		if (trimmed.length === 0) continue;
		out.push(parseIntStrict(trimmed, field));
	}
	return out;
}

interface FilePayload {
	readonly telegram?: {
		readonly token?: unknown;
		readonly allowedUserIds?: unknown;
	};
	readonly agents?: unknown;
	readonly heartbeat?: {
		readonly intervalMs?: unknown;
		readonly rssLimitBytes?: unknown;
		readonly stallThresholdMs?: unknown;
	};
	readonly ipc?: {
		readonly socketPath?: unknown;
		readonly cacheTtlMs?: unknown;
	};
	readonly shutdownStageTimeoutMs?: unknown;
}

function ensureRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new RangeError(`${label}: expected object`);
	}
	return value as Record<string, unknown>;
}

function parseAgents(value: unknown, sourcePath: string): AgentConfig[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new RangeError(`${sourcePath}: agents must be an array`);
	}
	const out: AgentConfig[] = [];
	for (let i = 0; i < value.length; i++) {
		const entry = ensureRecord(value[i], `${sourcePath}: agents[${i}]`);
		const agentId = entry.agentId;
		const runtimeId = entry.runtimeId;
		const cwd = entry.cwd;
		if (typeof agentId !== "string" || agentId.length === 0) {
			throw new RangeError(`${sourcePath}: agents[${i}].agentId required`);
		}
		if (typeof runtimeId !== "string" || runtimeId.length === 0) {
			throw new RangeError(`${sourcePath}: agents[${i}].runtimeId required`);
		}
		if (typeof cwd !== "string" || cwd.length === 0) {
			throw new RangeError(`${sourcePath}: agents[${i}].cwd required`);
		}
		const orgVal = entry.org;
		const org = typeof orgVal === "string" ? orgVal : undefined;
		const envRaw = entry.env;
		const env: Record<string, string> = {};
		if (envRaw !== undefined) {
			const envRec = ensureRecord(envRaw, `${sourcePath}: agents[${i}].env`);
			for (const [k, v] of Object.entries(envRec)) {
				if (typeof v !== "string") {
					throw new RangeError(
						`${sourcePath}: agents[${i}].env.${k} must be a string`,
					);
				}
				env[k] = v;
			}
		}
		const autoStartRaw = entry.autoStart;
		const autoStart = typeof autoStartRaw === "boolean" ? autoStartRaw : false;
		const authProfileRaw = entry.authProfile;
		let authProfile: AuthProfile | undefined;
		if (authProfileRaw !== undefined) {
			if (!isAuthProfile(authProfileRaw)) {
				throw new RangeError(
					`${sourcePath}: agents[${i}].authProfile: unknown authProfile: ${String(authProfileRaw)}; expected default|ilsantino|iaguito`,
				);
			}
			authProfile = authProfileRaw;
		}
		out.push({
			agentId,
			runtimeId,
			org,
			cwd,
			env,
			autoStart,
			...(authProfile !== undefined ? { authProfile } : {}),
		});
	}
	return out;
}

function parseHeartbeat(
	value: unknown,
	sourcePath: string,
): DaemonHeartbeatConfig {
	if (value === undefined) return DEFAULT_HEARTBEAT;
	const rec = ensureRecord(value, `${sourcePath}: heartbeat`);
	const intervalMs =
		rec.intervalMs === undefined
			? DEFAULT_HEARTBEAT.intervalMs
			: requireFiniteNumber(rec.intervalMs, `${sourcePath}: heartbeat.intervalMs`);
	const rssLimitBytes =
		rec.rssLimitBytes === undefined
			? DEFAULT_HEARTBEAT.rssLimitBytes
			: requireFiniteNumber(
					rec.rssLimitBytes,
					`${sourcePath}: heartbeat.rssLimitBytes`,
				);
	const stallThresholdMs =
		rec.stallThresholdMs === undefined
			? DEFAULT_HEARTBEAT.stallThresholdMs
			: requireFiniteNumber(
					rec.stallThresholdMs,
					`${sourcePath}: heartbeat.stallThresholdMs`,
				);
	return { intervalMs, rssLimitBytes, stallThresholdMs };
}

function parseIpc(value: unknown, sourcePath: string): DaemonIpcConfig {
	const fallback = defaultIpc();
	if (value === undefined) return fallback;
	const rec = ensureRecord(value, `${sourcePath}: ipc`);
	const socketPath =
		typeof rec.socketPath === "string" && rec.socketPath.length > 0
			? rec.socketPath
			: fallback.socketPath;
	const cacheTtlMs =
		rec.cacheTtlMs === undefined
			? fallback.cacheTtlMs
			: requireFiniteNumber(rec.cacheTtlMs, `${sourcePath}: ipc.cacheTtlMs`);
	return { socketPath, cacheTtlMs };
}

function requireFiniteNumber(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new RangeError(`${label}: must be a finite number`);
	}
	return value;
}

function parseTelegramFile(
	value: unknown,
	sourcePath: string,
): DaemonTelegramConfig | null {
	if (value === undefined) return null;
	const rec = ensureRecord(value, `${sourcePath}: telegram`);
	const token = rec.token;
	if (typeof token !== "string" || token.length === 0) {
		return null;
	}
	const rawIds = rec.allowedUserIds;
	const ids: number[] = [];
	if (Array.isArray(rawIds)) {
		for (let i = 0; i < rawIds.length; i++) {
			const id = rawIds[i];
			if (typeof id !== "number" || !Number.isInteger(id)) {
				throw new RangeError(
					`${sourcePath}: telegram.allowedUserIds[${i}] must be an integer`,
				);
			}
			ids.push(id);
		}
	} else if (rawIds !== undefined) {
		throw new RangeError(
			`${sourcePath}: telegram.allowedUserIds must be an array`,
		);
	}
	return { token, allowedUserIds: ids };
}

async function readJsonFile(
	filePath: string,
): Promise<{ payload: FilePayload; sourcePath: string } | null> {
	let raw: string;
	try {
		raw = await fsp.readFile(filePath, "utf8");
	} catch (err) {
		if (getErrnoCode(err) === "ENOENT") return null;
		throw err;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new RangeError(
			`daemon config: malformed JSON at ${filePath}: ${detail}`,
		);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new RangeError(
			`daemon config: ${filePath} must be a JSON object at the top level`,
		);
	}
	return { payload: parsed as FilePayload, sourcePath: filePath };
}

async function resolveConfigFile(): Promise<{
	payload: FilePayload;
	sourcePath: string;
} | null> {
	const envPath = process.env.IAGO_DAEMON_CONFIG_PATH;
	if (envPath !== undefined && envPath.length > 0) {
		const loaded = await readJsonFile(envPath);
		if (loaded === null) {
			throw new RangeError(
				`daemon config: IAGO_DAEMON_CONFIG_PATH points to ${envPath} but the file does not exist`,
			);
		}
		return loaded;
	}
	const defaultRepoPath = path.resolve(
		process.cwd(),
		"runtime",
		"daemon-config.json",
	);
	return readJsonFile(defaultRepoPath);
}

export async function loadConfig(): Promise<DaemonConfig> {
	const file = await resolveConfigFile();

	const sourcePath = file === null ? "<defaults>" : file.sourcePath;
	const fileTelegram =
		file === null ? null : parseTelegramFile(file.payload.telegram, sourcePath);
	const fileAgents =
		file === null ? [] : parseAgents(file.payload.agents, sourcePath);
	const fileHeartbeat =
		file === null
			? DEFAULT_HEARTBEAT
			: parseHeartbeat(file.payload.heartbeat, sourcePath);
	const fileIpc =
		file === null ? defaultIpc() : parseIpc(file.payload.ipc, sourcePath);

	const envToken = process.env.IAGO_TELEGRAM_BOT_TOKEN;
	const envAllowedIdsRaw = process.env.IAGO_TELEGRAM_ALLOWED_USER_IDS;

	let telegram: DaemonTelegramConfig | null = fileTelegram;
	if (envToken !== undefined && envToken.length > 0) {
		const allowedFromEnv =
			envAllowedIdsRaw !== undefined && envAllowedIdsRaw.length > 0
				? parseAllowedUserIds(envAllowedIdsRaw, "IAGO_TELEGRAM_ALLOWED_USER_IDS")
				: (fileTelegram?.allowedUserIds ?? []);
		telegram = { token: envToken, allowedUserIds: allowedFromEnv };
	} else if (envAllowedIdsRaw !== undefined && envAllowedIdsRaw.length > 0) {
		if (telegram !== null) {
			telegram = {
				token: telegram.token,
				allowedUserIds: parseAllowedUserIds(
					envAllowedIdsRaw,
					"IAGO_TELEGRAM_ALLOWED_USER_IDS",
				),
			};
		}
	}

	const heartbeat: DaemonHeartbeatConfig = {
		intervalMs: envOverrideInt(
			"IAGO_DAEMON_HEARTBEAT_INTERVAL_MS",
			fileHeartbeat.intervalMs,
		),
		rssLimitBytes: envOverrideInt(
			"IAGO_DAEMON_RSS_LIMIT_BYTES",
			fileHeartbeat.rssLimitBytes,
		),
		stallThresholdMs: envOverrideInt(
			"IAGO_DAEMON_STALL_THRESHOLD_MS",
			fileHeartbeat.stallThresholdMs,
		),
	};

	const ipcSocketEnv = process.env.IAGO_DAEMON_IPC_SOCKET_PATH;
	const ipc: DaemonIpcConfig = {
		socketPath:
			ipcSocketEnv !== undefined && ipcSocketEnv.length > 0
				? ipcSocketEnv
				: fileIpc.socketPath,
		cacheTtlMs: envOverrideInt(
			"IAGO_DAEMON_IPC_CACHE_TTL_MS",
			fileIpc.cacheTtlMs,
		),
	};

	// Opus PR #51 dual-review I1: round-trip shutdownStageTimeoutMs from
	// the JSON file. The prior version declared the field on DaemonConfig
	// but stripped it at parse time, so writing
	// `"shutdownStageTimeoutMs": 5000` in `runtime/daemon-config.json` was
	// a silent no-op. main.ts validates the value (rejects 0/NaN/negative/
	// non-integer/non-finite) and falls back to SHUTDOWN_STAGE_TIMEOUT_MS
	// with a stderr warning, so unsafe operator input is bounded.
	let shutdownStageTimeoutMs: number | undefined;
	if (file !== null && file.payload.shutdownStageTimeoutMs !== undefined) {
		const raw = file.payload.shutdownStageTimeoutMs;
		if (typeof raw !== "number") {
			throw new RangeError(
				`${sourcePath}: shutdownStageTimeoutMs must be a number`,
			);
		}
		shutdownStageTimeoutMs = raw;
	}

	return {
		telegram,
		agents: fileAgents,
		heartbeat,
		ipc,
		...(shutdownStageTimeoutMs !== undefined ? { shutdownStageTimeoutMs } : {}),
	};
}

function envOverrideInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw.length === 0) return fallback;
	return parseIntStrict(raw, name);
}
