/**
 * Plan 01b Task 2: Unit tests for `loadSystemdCredentials()`.
 *
 * Covers all branches:
 *   1. CREDENTIALS_DIRECTORY undefined → no-op
 *   2. CREDENTIALS_DIRECTORY empty string → no-op
 *   3. file present + env unset → env loaded
 *   4. file with trailing newline → trimmed
 *   5. file empty (zero bytes) → env NOT set
 *   6. env already set non-empty → file NOT loaded (override path wins)
 *   7. env set to empty string → file IS loaded (empty ≡ not-set per spec)
 *   8. credential file missing → no-op for that entry, no throw
 *   9. iago-gh-token file present → GH_TOKEN env loaded
 *  10. MANDATORY sentinel-leak negative test (C2 carry-over):
 *      value bytes never appear in telemetry, stdout, or stderr
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	__resetCredstoreStateForTests,
	envVarToFileName,
	getCredentialEnvVars,
	getCredentialFileNames,
	loadSystemdCredentials,
} from "./cred-bootstrap.js";
import * as telemetry from "./telemetry.js";

const TARGET_ENV_VARS = ["IAGO_TELEGRAM_BOT_TOKEN", "GH_TOKEN"] as const;

describe("loadSystemdCredentials", () => {
	let tempDir: string;
	const tempDirs: string[] = [];

	beforeEach(async () => {
		tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-cred-bootstrap-"));
		tempDirs.push(tempDir);
		// Use vi.stubEnv so each test's env mutations auto-restore between
		// tests (I3 stress-test fix — avoids leaking values across cases).
		vi.stubEnv("CREDENTIALS_DIRECTORY", "");
		vi.stubEnv("IAGO_TELEGRAM_BOT_TOKEN", "");
		vi.stubEnv("GH_TOKEN", "");
		// Drop the empty stubs so `process.env.X` reads as undefined unless
		// a test explicitly stubs a non-empty value.
		delete process.env.CREDENTIALS_DIRECTORY;
		delete process.env.IAGO_TELEGRAM_BOT_TOKEN;
		delete process.env.GH_TOKEN;
		// Reset module-level credstore tracking so reload-semantics state
		// from a prior test does not leak into the next.
		__resetCredstoreStateForTests();
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop()!;
			await fsp.rm(dir, { recursive: true, force: true });
		}
	});

	function snapshotEnv(): Record<string, string | undefined> {
		const snap: Record<string, string | undefined> = {};
		for (const k of TARGET_ENV_VARS) snap[k] = process.env[k];
		return snap;
	}

	// 1. CREDENTIALS_DIRECTORY undefined → no-op
	it("returns no-op when CREDENTIALS_DIRECTORY is undefined", () => {
		const before = snapshotEnv();
		loadSystemdCredentials();
		expect(snapshotEnv()).toEqual(before);
	});

	// 2. CREDENTIALS_DIRECTORY empty string → no-op
	it("returns no-op when CREDENTIALS_DIRECTORY is the empty string", () => {
		vi.stubEnv("CREDENTIALS_DIRECTORY", "");
		const before = snapshotEnv();
		loadSystemdCredentials();
		expect(snapshotEnv()).toEqual(before);
	});

	// 3. file present + env unset → env loaded
	it("loads iago-telegram-token file value into IAGO_TELEGRAM_BOT_TOKEN", () => {
		fs.writeFileSync(
			path.join(tempDir, "iago-telegram-token"),
			"1234567890:ABCDEFG",
		);
		vi.stubEnv("CREDENTIALS_DIRECTORY", tempDir);
		loadSystemdCredentials();
		expect(process.env.IAGO_TELEGRAM_BOT_TOKEN).toBe("1234567890:ABCDEFG");
	});

	// 4. file with trailing newline → trimmed
	it("trims trailing whitespace and newlines from credential file", () => {
		fs.writeFileSync(
			path.join(tempDir, "iago-telegram-token"),
			"1234567890:ABCDEFG\n",
		);
		vi.stubEnv("CREDENTIALS_DIRECTORY", tempDir);
		loadSystemdCredentials();
		expect(process.env.IAGO_TELEGRAM_BOT_TOKEN).toBe("1234567890:ABCDEFG");
	});

	// 5. file empty (zero bytes) → env NOT set
	it("does NOT set env when credential file is zero bytes", () => {
		fs.writeFileSync(path.join(tempDir, "iago-telegram-token"), "");
		vi.stubEnv("CREDENTIALS_DIRECTORY", tempDir);
		loadSystemdCredentials();
		expect(process.env.IAGO_TELEGRAM_BOT_TOKEN).toBeUndefined();
	});

	// 6. env already set non-empty → file NOT loaded (override path wins)
	it("respects existing env-var override (non-empty env wins over file)", () => {
		fs.writeFileSync(
			path.join(tempDir, "iago-telegram-token"),
			"file-value-should-be-ignored",
		);
		vi.stubEnv("CREDENTIALS_DIRECTORY", tempDir);
		vi.stubEnv("IAGO_TELEGRAM_BOT_TOKEN", "override");
		loadSystemdCredentials();
		expect(process.env.IAGO_TELEGRAM_BOT_TOKEN).toBe("override");
	});

	// 7. env set to empty string → file IS loaded (empty ≡ not-set per spec)
	it("treats empty-string env-var as not-set and loads the file value", () => {
		fs.writeFileSync(
			path.join(tempDir, "iago-telegram-token"),
			"file-value-wins",
		);
		vi.stubEnv("CREDENTIALS_DIRECTORY", tempDir);
		vi.stubEnv("IAGO_TELEGRAM_BOT_TOKEN", "");
		loadSystemdCredentials();
		expect(process.env.IAGO_TELEGRAM_BOT_TOKEN).toBe("file-value-wins");
	});

	// 8. credential file missing → no-op for that entry, no throw
	it("no-ops (no throw) when credential file is missing", () => {
		// tempDir contains no files at all
		vi.stubEnv("CREDENTIALS_DIRECTORY", tempDir);
		expect(() => loadSystemdCredentials()).not.toThrow();
		expect(process.env.IAGO_TELEGRAM_BOT_TOKEN).toBeUndefined();
		expect(process.env.GH_TOKEN).toBeUndefined();
	});

	// 9. iago-gh-token file present → GH_TOKEN env loaded
	it("loads iago-gh-token file value into GH_TOKEN", () => {
		fs.writeFileSync(path.join(tempDir, "iago-gh-token"), "ghp_AAAtestBBB");
		vi.stubEnv("CREDENTIALS_DIRECTORY", tempDir);
		loadSystemdCredentials();
		expect(process.env.GH_TOKEN).toBe("ghp_AAAtestBBB");
	});

	// 10. MANDATORY sentinel-leak negative test (C2 carry-over).
	it("NEVER leaks the credential value to telemetry, stdout, or stderr", async () => {
		const sentinel = "sentinel_must_not_leak_AAA";
		fs.writeFileSync(path.join(tempDir, "iago-telegram-token"), sentinel);
		vi.stubEnv("CREDENTIALS_DIRECTORY", tempDir);

		// Buffers: capture every byte written by the function under test.
		const telemetryPayloads: unknown[] = [];
		const stdoutBuf: string[] = [];
		const stderrBuf: string[] = [];

		const emitSpy = vi
			.spyOn(telemetry, "emit")
			.mockImplementation(async (event, extra) => {
				telemetryPayloads.push({ event, extra });
			});
		const stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk: unknown): boolean => {
				stdoutBuf.push(typeof chunk === "string" ? chunk : String(chunk));
				return true;
			});
		const stderrSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation((chunk: unknown): boolean => {
				stderrBuf.push(typeof chunk === "string" ? chunk : String(chunk));
				return true;
			});

		loadSystemdCredentials();

		// Restore so test framework can report without our spies in the way.
		emitSpy.mockRestore();
		stdoutSpy.mockRestore();
		stderrSpy.mockRestore();

		// Confirm the function did its job (loaded the value into env).
		expect(process.env.IAGO_TELEGRAM_BOT_TOKEN).toBe(sentinel);

		// Now the negative assertion: the sentinel literal must NOT appear
		// anywhere the function wrote bytes.
		const telemetryDump = JSON.stringify(telemetryPayloads);
		const stdoutDump = stdoutBuf.join("");
		const stderrDump = stderrBuf.join("");

		expect(telemetryDump).not.toContain(sentinel);
		expect(stdoutDump).not.toContain(sentinel);
		expect(stderrDump).not.toContain(sentinel);
	});

	// 11. SIGHUP reload — credstore-sourced values ARE replaceable on reload
	//     so a rotated token takes effect without a daemon restart. Guards
	//     against the Codex-flagged regression where the helper would skip
	//     replacement because the env var was already populated from its own
	//     prior load.
	it("replaces a credstore-sourced env value when the file rotates and the helper is re-called", () => {
		const filePath = path.join(tempDir, "iago-telegram-token");
		fs.writeFileSync(filePath, "initial-token");
		vi.stubEnv("CREDENTIALS_DIRECTORY", tempDir);

		loadSystemdCredentials();
		expect(process.env.IAGO_TELEGRAM_BOT_TOKEN).toBe("initial-token");

		// Simulate credential rotation: file content changes, env still
		// holds the prior credstore-loaded value.
		fs.writeFileSync(filePath, "rotated-token");
		loadSystemdCredentials();
		expect(process.env.IAGO_TELEGRAM_BOT_TOKEN).toBe("rotated-token");
	});

	// 12. SIGHUP reload — external env-var overrides MUST survive a reload.
	//     Confirms the "external override beats credstore" contract still
	//     holds across repeat invocations, not just the first one.
	it("preserves an external env override across reloads (does NOT replace it)", () => {
		const filePath = path.join(tempDir, "iago-telegram-token");
		fs.writeFileSync(filePath, "file-A");
		vi.stubEnv("CREDENTIALS_DIRECTORY", tempDir);
		vi.stubEnv("IAGO_TELEGRAM_BOT_TOKEN", "external-override");

		loadSystemdCredentials();
		expect(process.env.IAGO_TELEGRAM_BOT_TOKEN).toBe("external-override");

		// File rotates; external override must still win on reload.
		fs.writeFileSync(filePath, "file-B");
		loadSystemdCredentials();
		expect(process.env.IAGO_TELEGRAM_BOT_TOKEN).toBe("external-override");
	});

	// 13. Reload — if an external actor mutates a credstore-loaded env var
	//     between calls (env no longer matches what the helper last wrote),
	//     the helper treats the new value as an external override and does
	//     NOT clobber it on subsequent reloads.
	it("treats a post-load external mutation as an override and stops replacing it", () => {
		const filePath = path.join(tempDir, "iago-telegram-token");
		fs.writeFileSync(filePath, "initial-token");
		vi.stubEnv("CREDENTIALS_DIRECTORY", tempDir);

		loadSystemdCredentials();
		expect(process.env.IAGO_TELEGRAM_BOT_TOKEN).toBe("initial-token");

		// External mutation diverges current env from our last-written value.
		vi.stubEnv("IAGO_TELEGRAM_BOT_TOKEN", "external-after-load");
		fs.writeFileSync(filePath, "rotated-token");
		loadSystemdCredentials();
		expect(process.env.IAGO_TELEGRAM_BOT_TOKEN).toBe("external-after-load");
	});

	// Helper-function coverage — these are consumed by main.ts to compute
	// the `cred-bootstrap-loaded` telemetry payload. Verifying the shape
	// here keeps cred-bootstrap.ts above the 80% line-coverage floor and
	// confirms the CREDENTIALS array's two active entries are present.
	describe("helper functions", () => {
		it("getCredentialFileNames returns iago-telegram-token and iago-gh-token", () => {
			const names = getCredentialFileNames();
			expect(names).toContain("iago-telegram-token");
			expect(names).toContain("iago-gh-token");
		});

		it("getCredentialEnvVars returns IAGO_TELEGRAM_BOT_TOKEN and GH_TOKEN", () => {
			const vars = getCredentialEnvVars();
			expect(vars).toContain("IAGO_TELEGRAM_BOT_TOKEN");
			expect(vars).toContain("GH_TOKEN");
		});

		it("envVarToFileName maps IAGO_TELEGRAM_BOT_TOKEN to iago-telegram-token", () => {
			expect(envVarToFileName("IAGO_TELEGRAM_BOT_TOKEN")).toBe(
				"iago-telegram-token",
			);
		});

		it("envVarToFileName maps GH_TOKEN to iago-gh-token", () => {
			expect(envVarToFileName("GH_TOKEN")).toBe("iago-gh-token");
		});

		it("envVarToFileName returns null for an unregistered env var", () => {
			expect(envVarToFileName("NOT_A_REAL_CREDENTIAL")).toBeNull();
		});
	});
});
