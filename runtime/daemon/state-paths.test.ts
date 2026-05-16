import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type StateKind,
	assertSafeIdentifier,
	atomicRename,
	ensureStateDirsSync,
	getStateRoot,
	pathFor,
	validateAgentId,
} from "./state-paths.js";

const ALL_KINDS: ReadonlyArray<StateKind> = [
	"tasks/pending",
	"tasks/claimed",
	"tasks/resolved",
	"approvals/pending",
	"approvals/resolved",
	"agents",
	"telemetry",
	"session-logs",
	"markers",
];

describe("state-paths", () => {
	let originalEnv: string | undefined;
	let tempDirs: string[] = [];

	beforeEach(() => {
		originalEnv = process.env.IAGO_DAEMON_STATE_ROOT;
		delete process.env.IAGO_DAEMON_STATE_ROOT;
		tempDirs = [];
	});

	afterEach(async () => {
		if (originalEnv !== undefined) {
			process.env.IAGO_DAEMON_STATE_ROOT = originalEnv;
		} else {
			delete process.env.IAGO_DAEMON_STATE_ROOT;
		}
		vi.restoreAllMocks();
		for (const dir of tempDirs) {
			await fsp.rm(dir, { recursive: true, force: true });
		}
	});

	describe("getStateRoot", () => {
		it("env override wins over cwd and homedir", () => {
			const fakeRoot = path.join(os.tmpdir(), "iago-env-override-fixture");
			process.env.IAGO_DAEMON_STATE_ROOT = fakeRoot;
			expect(getStateRoot()).toBe(fakeRoot);
		});

		it("falls back to <cwd>/runtime/state when cwd basename is iago-os", () => {
			const fakeCwd = path.join(os.tmpdir(), "fake", "iago-os");
			vi.spyOn(process, "cwd").mockReturnValue(fakeCwd);
			expect(getStateRoot()).toBe(path.join(fakeCwd, "runtime", "state"));
		});

		it("falls back to <homedir>/.iago-os/daemon-state otherwise", () => {
			const fakeCwd = path.join(os.tmpdir(), "fake", "elsewhere");
			vi.spyOn(process, "cwd").mockReturnValue(fakeCwd);
			expect(getStateRoot()).toBe(
				path.join(os.homedir(), ".iago-os", "daemon-state"),
			);
		});

		it("normalizes a relative env override to an absolute path", () => {
			// Relative env values would otherwise resolve against process.cwd()
			// at every call — subprocesses with different cwds would partition
			// silently. path.resolve normalizes at the trust boundary.
			process.env.IAGO_DAEMON_STATE_ROOT = "./relative-root";
			const fakeCwd = path.resolve(os.tmpdir(), "fake-cwd");
			vi.spyOn(process, "cwd").mockReturnValue(fakeCwd);
			const root = getStateRoot();
			expect(path.isAbsolute(root)).toBe(true);
			expect(root).toBe(path.resolve(fakeCwd, "relative-root"));
		});

		it("preserves an already-absolute env override unchanged", () => {
			const abs = path.resolve(os.tmpdir(), "iago-abs-root");
			process.env.IAGO_DAEMON_STATE_ROOT = abs;
			expect(getStateRoot()).toBe(abs);
		});
	});

	describe("ensureStateDirsSync", () => {
		it("creates every listed kind under the state root", async () => {
			const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-dirs-"));
			tempDirs.push(tempDir);
			process.env.IAGO_DAEMON_STATE_ROOT = tempDir;

			ensureStateDirsSync();

			for (const kind of ALL_KINDS) {
				const dir = path.join(tempDir, kind);
				expect(fs.statSync(dir).isDirectory()).toBe(true);
			}
		});
	});

	describe("pathFor", () => {
		it("returns absolute paths for every kind", () => {
			const tempRoot = path.resolve(path.join(os.tmpdir(), "iago-abs-fixture"));
			process.env.IAGO_DAEMON_STATE_ROOT = tempRoot;
			for (const kind of ALL_KINDS) {
				expect(path.isAbsolute(pathFor(kind))).toBe(true);
			}
		});
	});

	describe("validateAgentId", () => {
		it("accepts a valid id (alpha-bot-1)", () => {
			expect(validateAgentId("alpha-bot-1")).toEqual({ valid: true });
		});

		it("rejects ids containing __", () => {
			const result = validateAgentId("alpha__bot");
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.reason).toBe("double-underscore");
			}
		});

		it("rejects 'nul' (Windows reserved, case-insensitive)", () => {
			const result = validateAgentId("nul");
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.reason).toBe("windows-reserved");
			}
		});

		it("rejects the empty string", () => {
			expect(validateAgentId("")).toEqual({ valid: false, reason: "empty" });
		});

		it("rejects an id of length 64", () => {
			const id = `a${"b".repeat(63)}`;
			expect(id.length).toBe(64);
			expect(validateAgentId(id)).toEqual({
				valid: false,
				reason: "too-long",
			});
		});
	});

	describe("assertSafeIdentifier", () => {
		it("accepts an opaque random-style taskId", () => {
			expect(() =>
				assertSafeIdentifier("alpha__abc-123", "taskId"),
			).not.toThrow();
		});

		it("rejects empty string", () => {
			expect(() => assertSafeIdentifier("", "taskId")).toThrow(TypeError);
		});

		it("rejects forward slash", () => {
			expect(() => assertSafeIdentifier("../etc/passwd", "taskId")).toThrow(
				TypeError,
			);
			expect(() => assertSafeIdentifier("a/b", "taskId")).toThrow(TypeError);
		});

		it("rejects backslash (Windows path separator)", () => {
			expect(() => assertSafeIdentifier("..\\windows", "taskId")).toThrow(
				TypeError,
			);
			expect(() => assertSafeIdentifier("a\\b", "taskId")).toThrow(TypeError);
		});

		it("rejects '..' substring", () => {
			expect(() => assertSafeIdentifier("foo..bar", "taskId")).toThrow(
				TypeError,
			);
		});

		it("rejects NUL byte", () => {
			expect(() => assertSafeIdentifier("foo\0bar", "taskId")).toThrow(
				TypeError,
			);
		});

		it("rejects identifier longer than 200 chars", () => {
			expect(() => assertSafeIdentifier("a".repeat(201), "taskId")).toThrow(
				TypeError,
			);
		});
	});

	describe("atomicRename", () => {
		it("renames over an existing destination (cross-platform parity)", async () => {
			const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-atom-"));
			tempDirs.push(tempDir);
			const src = path.join(tempDir, "src.txt");
			const dst = path.join(tempDir, "dst.txt");
			await fsp.writeFile(src, "new");
			await fsp.writeFile(dst, "old");

			await atomicRename(src, dst);

			const dstContent = await fsp.readFile(dst, "utf8");
			expect(dstContent).toBe("new");
			await expect(fsp.stat(src)).rejects.toThrow();
		});
	});
});
