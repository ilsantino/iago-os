import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockChild extends EventEmitter {
	stdout: EventEmitter;
	stderr: EventEmitter;
	kill: () => void;
}

function makeMockChild(): MockChild {
	const child = new EventEmitter() as MockChild;
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.kill = () => {};
	return child;
}

const spawnMock = vi.fn<(...args: unknown[]) => MockChild>();

vi.mock("node:child_process", () => ({
	spawn: (...args: unknown[]) => spawnMock(...args),
}));

async function importVersionPinFresh(): Promise<
	typeof import("./version-pin.js")
> {
	vi.resetModules();
	return import("./version-pin.js");
}

beforeEach(() => {
	spawnMock.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("version-pin", () => {
	it("exports the expected supported range constant", async () => {
		const mod = await importVersionPinFresh();
		expect(mod.SUPPORTED_CLAUDE_CODE_VERSION_RANGE).toBe(">=2.0.0 <3.0.0");
	});

	it("getClaudeCodeVersion resolves with the semver substring from stdout", async () => {
		const child = makeMockChild();
		spawnMock.mockReturnValueOnce(child);
		const { getClaudeCodeVersion } = await importVersionPinFresh();
		const pending = getClaudeCodeVersion();
		child.stdout.emit("data", Buffer.from("claude 2.1.113 (build x)\n"));
		child.emit("close", 0);
		await expect(pending).resolves.toBe("2.1.113");
	});

	it("getClaudeCodeVersion reads semver from stderr when stdout is empty", async () => {
		const child = makeMockChild();
		spawnMock.mockReturnValueOnce(child);
		const { getClaudeCodeVersion } = await importVersionPinFresh();
		const pending = getClaudeCodeVersion();
		child.stderr.emit("data", Buffer.from("v2.5.0"));
		child.emit("close", 0);
		await expect(pending).resolves.toBe("2.5.0");
	});

	it("getClaudeCodeVersion rejects when no semver appears in output", async () => {
		const child = makeMockChild();
		spawnMock.mockReturnValueOnce(child);
		const { getClaudeCodeVersion } = await importVersionPinFresh();
		const pending = getClaudeCodeVersion();
		child.stdout.emit("data", Buffer.from("not a version string"));
		child.emit("close", 0);
		await expect(pending).rejects.toThrow(/no semver/);
	});

	it("getClaudeCodeVersion rejects on child error event", async () => {
		const child = makeMockChild();
		spawnMock.mockReturnValueOnce(child);
		const { getClaudeCodeVersion } = await importVersionPinFresh();
		const pending = getClaudeCodeVersion();
		const errnoErr = Object.assign(new Error("spawn ENOENT"), {
			code: "ENOENT",
		});
		child.emit("error", errnoErr);
		await expect(pending).rejects.toThrow(/ENOENT/);
	});

	it("getClaudeCodeVersion times out after the probe window", async () => {
		vi.useFakeTimers();
		const child = makeMockChild();
		spawnMock.mockReturnValueOnce(child);
		const { getClaudeCodeVersion } = await importVersionPinFresh();
		const pending = getClaudeCodeVersion();
		// Capture rejection synchronously so the unhandled-rejection guard
		// stays quiet — the assertion below still runs after we advance.
		const tracked = pending.catch((err: unknown) => err);
		vi.advanceTimersByTime(5_000);
		const resolved = (await tracked) as Error;
		expect(resolved.message).toMatch(/timed out/);
	});

	it("assertSupportedVersion returns ok for an in-range version", async () => {
		const child = makeMockChild();
		spawnMock.mockReturnValueOnce(child);
		const { assertSupportedVersion } = await importVersionPinFresh();
		const pending = assertSupportedVersion();
		child.stdout.emit("data", Buffer.from("2.1.113"));
		child.emit("close", 0);
		const res = await pending;
		expect(res).toEqual({ ok: true, version: "2.1.113" });
	});

	it("assertSupportedVersion returns unsupported for an out-of-range version", async () => {
		const child = makeMockChild();
		spawnMock.mockReturnValueOnce(child);
		const { assertSupportedVersion } = await importVersionPinFresh();
		const pending = assertSupportedVersion();
		child.stdout.emit("data", Buffer.from("1.5.0"));
		child.emit("close", 0);
		const res = await pending;
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.reason).toBe("unsupported");
			expect(res.detail).toMatch(/does not satisfy/);
		}
	});

	it("assertSupportedVersion returns not-installed when the binary is missing", async () => {
		const child = makeMockChild();
		spawnMock.mockReturnValueOnce(child);
		const { assertSupportedVersion } = await importVersionPinFresh();
		const pending = assertSupportedVersion();
		const errnoErr = Object.assign(new Error("spawn ENOENT"), {
			code: "ENOENT",
		});
		child.emit("error", errnoErr);
		const res = await pending;
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.reason).toBe("not-installed");
		}
	});

	it("assertSupportedVersion returns parse-failure for unparseable output", async () => {
		const child = makeMockChild();
		spawnMock.mockReturnValueOnce(child);
		const { assertSupportedVersion } = await importVersionPinFresh();
		const pending = assertSupportedVersion();
		child.stdout.emit("data", Buffer.from("garbage with no version"));
		child.emit("close", 0);
		const res = await pending;
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.reason).toBe("parse-failure");
		}
	});
});
