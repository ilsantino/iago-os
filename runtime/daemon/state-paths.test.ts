import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the telemetry module so that when state-paths.ts dynamically
// imports "./telemetry.js" (via `void import(...).then(...)`) Vitest's
// module mock registry resolves our vi.fn(). This lets us assert the
// fire-and-forget telemetry call shape without racing the filesystem appendFile.
vi.mock("./telemetry.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./telemetry.js")>();
	return {
		...actual,
		emit: vi.fn().mockResolvedValue(undefined),
	};
});

// Mock node:fs/promises with passthrough wrappers around `rename` and
// `unlink` so individual tests can flip them to fail via
// `mockImplementationOnce(...)`. All other fsp.* APIs spread through
// unchanged. Required because vi.spyOn cannot redefine ESM module exports
// — and we need to deterministically force the Windows EEXIST recovery
// branch (modern Node `fsp.rename` on Windows overwrites silently) and
// the `atomicRename` rollback branch.
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		link: vi.fn(actual.link),
		rename: vi.fn(actual.rename),
		unlink: vi.fn(actual.unlink),
	};
});

import {
	type StateKind,
	assertSafeIdentifier,
	atomicRename,
	atomicRenameStaleDest,
	ensureStateDirsSync,
	getErrnoCode,
	getStateRoot,
	pathFor,
	validateAgentId,
} from "./state-paths.js";
import { emit as mockedEmit } from "./telemetry.js";

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

	describe("atomicRename (strict) + atomicRenameStaleDest (destructive)", () => {
		const isWindows = process.platform === "win32";

		it("atomicRenameStaleDest renames over an existing destination (cross-platform parity)", async () => {
			const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-atom-"));
			tempDirs.push(tempDir);
			const src = path.join(tempDir, "src.txt");
			const dst = path.join(tempDir, "dst.txt");
			await fsp.writeFile(src, "new");
			await fsp.writeFile(dst, "old");

			await atomicRenameStaleDest(src, dst);

			const dstContent = await fsp.readFile(dst, "utf8");
			expect(dstContent).toBe("new");
			await expect(fsp.stat(src)).rejects.toThrow();
		});

		it("atomicRenameStaleDest renames when destination does NOT exist", async () => {
			const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-atom-"));
			tempDirs.push(tempDir);
			const src = path.join(tempDir, "src.txt");
			const dst = path.join(tempDir, "dst.txt");
			await fsp.writeFile(src, "payload");

			await atomicRenameStaleDest(src, dst);

			expect(await fsp.readFile(dst, "utf8")).toBe("payload");
			await expect(fsp.stat(src)).rejects.toThrow();
		});

		it("atomicRenameStaleDest re-throws non-EEXIST/EPERM errors (e.g. ENOENT on src)", async () => {
			const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-atom-"));
			tempDirs.push(tempDir);
			const src = path.join(tempDir, "missing.txt");
			const dst = path.join(tempDir, "dst.txt");

			let caughtCode: string | undefined;
			try {
				await atomicRenameStaleDest(src, dst);
				throw new Error("expected rename to reject");
			} catch (err) {
				caughtCode = getErrnoCode(err);
			}
			expect(caughtCode).toBe("ENOENT");
		});

		it("atomicRename succeeds when destination does NOT exist (cross-platform)", async () => {
			const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-atom-"));
			tempDirs.push(tempDir);
			const src = path.join(tempDir, "src.txt");
			const dst = path.join(tempDir, "dst.txt");
			await fsp.writeFile(src, "claim-payload");

			await atomicRename(src, dst);

			expect(await fsp.readFile(dst, "utf8")).toBe("claim-payload");
			await expect(fsp.stat(src)).rejects.toThrow();
		});

		it("atomicRename throws when destination exists (POSIX)", async () => {
			if (isWindows) {
				return;
			}
			const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-atom-"));
			tempDirs.push(tempDir);
			const src = path.join(tempDir, "src.txt");
			const dst = path.join(tempDir, "dst.txt");
			await fsp.writeFile(src, "new");
			await fsp.writeFile(dst, "old");

			let caughtCode: string | undefined;
			try {
				await atomicRename(src, dst);
				throw new Error("expected EEXIST");
			} catch (err) {
				caughtCode = getErrnoCode(err);
			}
			expect(caughtCode).toBe("EEXIST");
			// Strict semantics: dst MUST NOT be overwritten.
			expect(await fsp.readFile(dst, "utf8")).toBe("old");
			// And src must still exist (link failed before unlink).
			expect(await fsp.readFile(src, "utf8")).toBe("new");
		});

		it("atomicRename throws when destination exists (Windows EEXIST or EPERM)", async () => {
			if (!isWindows) {
				return;
			}
			const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-atom-"));
			tempDirs.push(tempDir);
			const src = path.join(tempDir, "src.txt");
			const dst = path.join(tempDir, "dst.txt");
			await fsp.writeFile(src, "new");
			await fsp.writeFile(dst, "old");

			let caughtCode: string | undefined;
			try {
				await atomicRename(src, dst);
				throw new Error("expected EEXIST/EPERM");
			} catch (err) {
				caughtCode = getErrnoCode(err);
			}
			expect(["EEXIST", "EPERM"]).toContain(caughtCode);
			// Strict semantics: dst MUST NOT be overwritten.
			expect(await fsp.readFile(dst, "utf8")).toBe("old");
		});

		it("atomicRenameStaleDest re-throws non-EEXIST/EPERM errors on Windows (skipped on POSIX)", async () => {
			if (!isWindows) {
				return;
			}
			const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-atom-"));
			tempDirs.push(tempDir);
			const src = path.join(tempDir, "missing.txt");
			const dst = path.join(tempDir, "dst.txt");

			let caughtCode: string | undefined;
			try {
				await atomicRenameStaleDest(src, dst);
				throw new Error("expected ENOENT");
			} catch (err) {
				caughtCode = getErrnoCode(err);
			}
			expect(caughtCode).toBe("ENOENT");
		});

		it("atomicRenameStaleDest emits atomic-rename-stale-dest-window on Windows EEXIST recovery (skipped on POSIX)", async () => {
			if (!isWindows) {
				return;
			}
			const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-atom-"));
			tempDirs.push(tempDir);
			const src = path.join(tempDir, "src.txt");
			const dst = path.join(tempDir, "dst.txt");
			await fsp.writeFile(src, "new");
			await fsp.writeFile(dst, "old");

			// Modern Node `fsp.rename` on Windows often overwrites silently,
			// so the EEXIST recovery branch is normally only reachable when
			// the dst is locked. Force the branch by making the first
			// `rename` throw EEXIST, then let subsequent calls pass through.
			vi.mocked(fsp.rename).mockImplementationOnce(() => {
				const err = new Error("synthetic EEXIST for test") as Error & {
					code?: string;
				};
				err.code = "EEXIST";
				return Promise.reject(err);
			});

			vi.mocked(mockedEmit).mockClear();
			await atomicRenameStaleDest(src, dst);
			// The emit call lives inside a `void import().then()` chain — flush
			// the microtask queue so the dynamic-import callback has settled
			// before asserting call count.
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(await fsp.readFile(dst, "utf8")).toBe("new");

			expect(vi.mocked(mockedEmit)).toHaveBeenCalledTimes(1);
			const [event] = vi.mocked(mockedEmit).mock.calls[0]!;
			expect(event.kind).toBe("atomic-rename-stale-dest-window");
			if (event.kind === "atomic-rename-stale-dest-window") {
				expect(event.dst).toBe("dst.txt");
				expect(typeof event.windowMs).toBe("number");
				expect(event.windowMs).toBeGreaterThanOrEqual(0);
				expect(event.platform).toBe("win32");
			}
		});

		it("atomicRenameStaleDest does NOT emit telemetry on the happy path (no EEXIST recovery)", async () => {
			const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-atom-"));
			tempDirs.push(tempDir);
			const src = path.join(tempDir, "src.txt");
			const dst = path.join(tempDir, "dst.txt");
			await fsp.writeFile(src, "payload");
			// dst absent — no EEXIST recovery on either platform.

			vi.mocked(mockedEmit).mockClear();
			await atomicRenameStaleDest(src, dst);
			expect(vi.mocked(mockedEmit)).not.toHaveBeenCalled();
		});

		it("atomicRename rolls back dst when link succeeds but unlink(src) fails (cross-platform)", async () => {
			const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-atom-"));
			tempDirs.push(tempDir);
			const src = path.join(tempDir, "src.txt");
			const dst = path.join(tempDir, "dst.txt");
			await fsp.writeFile(src, "payload");

			// Force the FIRST unlink (the src unlink inside atomicRename) to
			// fail with EACCES. The next unlink call — the rollback unlink of
			// dst — passes through to the real implementation so dst is
			// actually removed.
			vi.mocked(fsp.unlink).mockImplementationOnce(() => {
				const err = new Error("synthetic EACCES on src unlink") as Error & {
					code?: string;
				};
				err.code = "EACCES";
				return Promise.reject(err);
			});

			let caughtCode: string | undefined;
			try {
				await atomicRename(src, dst);
				throw new Error("expected unlink failure to propagate");
			} catch (err) {
				caughtCode = getErrnoCode(err);
			}
			expect(caughtCode).toBe("EACCES");

			// Rollback semantics: dst MUST be gone (rollback succeeded), src
			// MUST still exist (the failing unlink left it on disk).
			await expect(fsp.stat(dst)).rejects.toThrow();
			expect(await fsp.readFile(src, "utf8")).toBe("payload");
		});
	});
});
