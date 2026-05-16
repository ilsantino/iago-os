/**
 * Version pinning for the Shape 1 PTY Claude Code adapter.
 *
 * Plan 04 stress-test PR1 (Critical): the supported range MUST match the
 * Claude Code generation Santiago is running. As of 2026-05-15 the box has
 * `claude --version` → `2.1.113`, so the default range is `>=2.0.0 <3.0.0`.
 * Bumping to a new major requires:
 *   1. Recapture every transcript under `golden-transcripts/` (see
 *      `golden-transcripts/README.md`).
 *   2. Update `SUPPORTED_CLAUDE_CODE_VERSION_RANGE` here.
 *   3. Re-run the conformance tests in `prompt-parser.test.ts` and
 *      `claude-pty.test.ts`.
 *
 * `getClaudeCodeVersion` shells out to `claude --version` via
 * `child_process.spawn` (NOT through the PTY — version probing must work
 * before the adapter is ready to spawn a PTY). The first semver-shaped
 * substring in the binary's stdout/stderr is returned.
 *
 * `assertSupportedVersion` returns a discriminated union so callers can
 * differentiate "binary missing" from "wrong version" from "parse failure"
 * without exception unwrapping. The PTY adapter throws a clear error on
 * `ok: false`; downstream telemetry tags the failure reason.
 */

import { spawn } from "node:child_process";

import semver from "semver";

export const SUPPORTED_CLAUDE_CODE_VERSION_RANGE = ">=2.0.0 <3.0.0";

const SEMVER_RE = /(\d+\.\d+\.\d+)/;

const VERSION_PROBE_TIMEOUT_MS = 5_000;

export type SupportedVersionResult =
	| { readonly ok: true; readonly version: string }
	| {
			readonly ok: false;
			readonly reason: "unsupported" | "not-installed" | "parse-failure";
			readonly detail: string;
	  };

export async function getClaudeCodeVersion(): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const child = spawn("claude", ["--version"], {
			windowsHide: true,
			shell: false,
		});
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			try {
				child.kill();
			} catch {
				// best-effort kill on probe timeout
			}
			reject(new Error("claude --version timed out"));
		}, VERSION_PROBE_TIMEOUT_MS);

		child.stdout.on("data", (chunk: Buffer) => {
			stdoutChunks.push(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
		});
		child.on("error", (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(err);
		});
		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			const stdout = Buffer.concat(stdoutChunks).toString("utf8");
			const stderr = Buffer.concat(stderrChunks).toString("utf8");
			const combined = `${stdout}\n${stderr}`;
			const match = SEMVER_RE.exec(combined);
			if (match === null) {
				reject(
					new Error(
						`claude --version exited ${code ?? "?"} with no semver in output: ${combined.trim().slice(0, 200)}`,
					),
				);
				return;
			}
			resolve(match[1] as string);
		});
	});
}

export async function assertSupportedVersion(): Promise<SupportedVersionResult> {
	let version: string;
	try {
		version = await getClaudeCodeVersion();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const errnoCode =
			err instanceof Error && "code" in err
				? (err as { code?: unknown }).code
				: undefined;
		if (errnoCode === "ENOENT") {
			return {
				ok: false,
				reason: "not-installed",
				detail: `claude binary not found on PATH: ${message}`,
			};
		}
		if (message.includes("no semver")) {
			return { ok: false, reason: "parse-failure", detail: message };
		}
		return { ok: false, reason: "parse-failure", detail: message };
	}

	const cleaned = semver.valid(semver.coerce(version));
	if (cleaned === null) {
		return {
			ok: false,
			reason: "parse-failure",
			detail: `unparseable semver: ${version}`,
		};
	}
	if (!semver.satisfies(cleaned, SUPPORTED_CLAUDE_CODE_VERSION_RANGE)) {
		return {
			ok: false,
			reason: "unsupported",
			detail: `installed claude ${cleaned} does not satisfy ${SUPPORTED_CLAUDE_CODE_VERSION_RANGE}`,
		};
	}
	return { ok: true, version: cleaned };
}
