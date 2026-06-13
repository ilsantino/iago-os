import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureStateDirsSync, pathFor } from "./state-paths.js";
import {
	__resetTelemetryWarningFlagForTests,
	emit,
	getTelemetryPath,
} from "./telemetry.js";

let tempDir: string;

beforeEach(async () => {
	tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-telemetry-"));
	process.env.IAGO_DAEMON_STATE_ROOT = tempDir;
	ensureStateDirsSync();
	__resetTelemetryWarningFlagForTests();
});

afterEach(async () => {
	delete process.env.IAGO_DAEMON_STATE_ROOT;
	delete process.env.CLAUDE_CODE_SESSION_ID;
	vi.restoreAllMocks();
	await fsp.rm(tempDir, { recursive: true, force: true });
});

async function readLines(filePath: string): Promise<string[]> {
	const raw = await fsp.readFile(filePath, "utf8");
	return raw.split("\n").filter((line) => line.length > 0);
}

describe("telemetry.emit", () => {
	it("writes one valid NDJSON line with required keys", async () => {
		process.env.CLAUDE_CODE_SESSION_ID = "session-A";
		// emit() returns true when the line durably landed (the daemon's
		// ndjsonAlert durability gate depends on this contract).
		expect(
			await emit({ kind: "daemon-start", pid: 12345, nodeVersion: "v20.10.0" }),
		).toBe(true);

		const lines = await readLines(getTelemetryPath());
		expect(lines).toHaveLength(1);
		const parsed = JSON.parse(lines[0]);
		expect(parsed).toMatchObject({
			sessionId: "session-A",
			pid: 12345,
			kind: "daemon-start",
			nodeVersion: "v20.10.0",
		});
		expect(typeof parsed.at).toBe("string");
		expect(() => new Date(parsed.at).toISOString()).not.toThrow();
	});

	it("appends sequential emits to the same file", async () => {
		process.env.CLAUDE_CODE_SESSION_ID = "session-B";
		await emit({ kind: "daemon-start", pid: 1, nodeVersion: "v20.10.0" });
		await emit({
			kind: "agent-registered",
			agentId: "claude-main",
			runtimeId: "claude-pty",
		});

		const lines = await readLines(getTelemetryPath());
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[1]).kind).toBe("agent-registered");
	});

	it("captures CLAUDE_CODE_SESSION_ID in the sessionId field", async () => {
		process.env.CLAUDE_CODE_SESSION_ID = "abc-123";
		await emit({ kind: "daemon-start", pid: 1, nodeVersion: "v20.10.0" });

		const [line] = await readLines(getTelemetryPath());
		expect(JSON.parse(line).sessionId).toBe("abc-123");
	});

	it("missing CLAUDE_CODE_SESSION_ID yields no-session-id sentinel and warns once", async () => {
		delete process.env.CLAUDE_CODE_SESSION_ID;
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await emit({ kind: "daemon-start", pid: 1, nodeVersion: "v20.10.0" });
		await emit({ kind: "daemon-start", pid: 1, nodeVersion: "v20.10.0" });

		const lines = await readLines(getTelemetryPath());
		expect(lines).toHaveLength(2);
		for (const line of lines) {
			expect(JSON.parse(line).sessionId).toBe("no-session-id");
		}
		expect(errSpy).toHaveBeenCalledTimes(1);
	});

	it("write failure does not throw", async () => {
		// Force appendFile to fail by creating a directory at the target file path.
		const targetPath = getTelemetryPath();
		await fsp.mkdir(path.dirname(targetPath), { recursive: true });
		await fsp.mkdir(targetPath, { recursive: true });
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		// emit() resolves false (not undefined) on write failure — it must never
		// throw, but the boolean lets durability-sensitive callers react.
		await expect(
			emit({ kind: "daemon-start", pid: 1, nodeVersion: "v20.10.0" }),
		).resolves.toBe(false);
		expect(errSpy).toHaveBeenCalled();
	});

	it("telemetry path includes today's UTC date", () => {
		const fixed = new Date("2026-05-15T10:00:00.000Z");
		const result = getTelemetryPath(fixed);
		expect(result).toBe(path.join(pathFor("telemetry"), "2026-05-15.ndjson"));
	});

	it("merges extra fields into the emitted line", async () => {
		process.env.CLAUDE_CODE_SESSION_ID = "session-C";
		await emit(
			{ kind: "heartbeat", handleId: "h1", alive: true },
			{ customKey: "value" },
		);

		const [line] = await readLines(getTelemetryPath());
		expect(JSON.parse(line).customKey).toBe("value");
	});

	it("concurrent emits produce parseable JSON lines", async () => {
		process.env.CLAUDE_CODE_SESSION_ID = "session-D";
		await Promise.all(
			Array.from({ length: 20 }, (_, i) =>
				emit({
					kind: "task-claimed",
					taskId: `t-${i}`,
					ownerId: "o",
					attemptId: "a",
				}),
			),
		);

		const lines = await readLines(getTelemetryPath());
		expect(lines).toHaveLength(20);
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow();
		}
	});

	it("empty-string CLAUDE_CODE_SESSION_ID is treated as missing", async () => {
		process.env.CLAUDE_CODE_SESSION_ID = "";
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await emit({ kind: "daemon-start", pid: 1, nodeVersion: "v20.10.0" });

		const [line] = await readLines(getTelemetryPath());
		expect(JSON.parse(line).sessionId).toBe("no-session-id");
		expect(errSpy).toHaveBeenCalledTimes(1);
	});
});
