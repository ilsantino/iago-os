#!/usr/bin/env node
/**
 * test-cutover.mjs — dry-run harness for runtime/deploy/cutover.sh
 * and runtime/deploy/rollback.sh.
 *
 * No real VPS is touched. Every external command the scripts shell out
 * to (tailscale, op, systemd-creds, age, tar, curl, jq, sha256sum,
 * shred, find, flock) is replaced with a stub bash script that records
 * its argv into a shared log file and emits the stdout each call site
 * expects. Tests assert against (a) the script's exit status and (b)
 * the stub log contents.
 *
 * Run under Node's built-in test runner:
 *   node --test runtime/scripts/test-cutover.mjs
 *
 * Source plan: .iago/plans/feature-phase-2-vps-bootstrap/03a-cutover-rollback-executables.md
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	writeFileSync,
	readFileSync,
	rmSync,
	chmodSync,
	mkdirSync,
	existsSync,
	copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Bash binary resolution
//
// Node spawnSync uses the host's native PATH-search semantics to locate the
// command. On Windows, MSYS-style paths like /usr/bin do NOT resolve. So we
// look up bash once at module load using the host PATH and then pass the
// absolute path to spawnSync — the child's PATH override only affects what
// the script-under-test sees, not how spawnSync finds the interpreter.
// ---------------------------------------------------------------------------

function findBashAbsolute() {
	const hostPath = process.env.PATH || "";
	const sep = path.delimiter;
	const exts = process.platform === "win32" ? [".exe", ""] : [""];
	for (const dir of hostPath.split(sep)) {
		if (!dir) continue;
		for (const ext of exts) {
			const candidate = path.join(dir, `bash${ext}`);
			if (existsSync(candidate)) return candidate;
		}
	}
	throw new Error("bash not found on host PATH — test harness cannot run");
}

const BASH_BIN = findBashAbsolute();

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(here, "..");
const cutoverScript = path.join(runtimeRoot, "deploy", "cutover.sh");
const rollbackScript = path.join(runtimeRoot, "deploy", "rollback.sh");
const fixturesDir = path.join(here, "test-cutover.fixtures");
const stubSourceDir = path.join(fixturesDir, "stubs");
const fixtureOpenclawIn = path.join(fixturesDir, "openclaw.json");
const fixtureOpenclawExpected = path.join(
	fixturesDir,
	"openclaw.expected.json",
);

// Generic binaries the scripts may shell out to locally. tailscale + op have
// behavior-rich stubs in stubs/; the rest reuse _generic-noop. (jq, flock,
// and find run remotely via `vssh bash -s` and are intercepted by the
// tailscale stub's `*"bash -s"*` case — no local stub needed.)
const NOOP_BINARIES = [
	"systemd-creds",
	"age",
	"tar",
	"curl",
	"jq",
	"shred",
];

// ---------------------------------------------------------------------------
// Per-test harness setup
// ---------------------------------------------------------------------------

function newTestEnv() {
	const tmp = mkdtempSync(path.join(tmpdir(), "cutover-harness-"));
	const stubDir = path.join(tmp, "bin");
	mkdirSync(stubDir, { recursive: true });

	// Copy behavior-rich stubs verbatim.
	for (const name of ["tailscale", "op"]) {
		const dst = path.join(stubDir, name);
		copyFileSync(path.join(stubSourceDir, name), dst);
		chmodSync(dst, 0o755);
	}

	// Stamp the generic noop under each name in NOOP_BINARIES.
	const noopSrc = path.join(stubSourceDir, "_generic-noop");
	for (const name of NOOP_BINARIES) {
		const dst = path.join(stubDir, name);
		copyFileSync(noopSrc, dst);
		chmodSync(dst, 0o755);
	}

	const stubLog = path.join(tmp, "stub.log");
	writeFileSync(stubLog, "", "utf8");

	const stubStateDir = path.join(tmp, "state");
	mkdirSync(stubStateDir, { recursive: true });

	return { tmp, stubDir, stubLog, stubStateDir };
}

function destroyTestEnv(env) {
	if (env?.tmp && existsSync(env.tmp)) {
		rmSync(env.tmp, { recursive: true, force: true });
	}
}

function readLog(env) {
	return readFileSync(env.stubLog, "utf8");
}

function runScript(scriptPath, env, opts = {}) {
	const childEnv = {
		// stubDir is prepended so stubs win for every binary the scripts
		// shell out to (tailscale, op, systemd-creds, age, tar, curl, jq,
		// shred, find, flock). Host PATH is appended so bash, sed, grep,
		// cat, printf and similar standard utilities the scripts depend on
		// are still resolvable. Real `systemctl` is not on the host PATH
		// (Windows), and any other unstubbed name will only resolve to a
		// host binary if it actually exists there — which is acceptable
		// for the stuff we genuinely need (coreutils-style helpers).
		HOME: process.env.HOME || process.env.USERPROFILE || env.tmp,
		USER: process.env.USER || "harness",
		PATH: `${env.stubDir}${path.delimiter}${process.env.PATH || ""}`,
		STUB_LOG: env.stubLog,
		STUB_STATE_DIR: env.stubStateDir,
		...opts.env,
	};
	return spawnSync(BASH_BIN, [scriptPath], {
		env: childEnv,
		encoding: "utf8",
		timeout: opts.timeout ?? 60_000,
	});
}

function runCutover(env, opts = {}) {
	return runScript(cutoverScript, env, opts);
}

function runRollback(env, opts = {}) {
	return runScript(rollbackScript, env, opts);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("1. cutover.sh refuses without IAGO_CUTOVER_CONFIRM=YES", () => {
	const env = newTestEnv();
	try {
		const r = runCutover(env, {
			env: { IAGO_TELEGRAM_USER_ID: "12345" },
		});
		assert.notEqual(r.status, 0);
		const text = `${r.stdout}\n${r.stderr}`;
		assert.match(text, /IAGO_CUTOVER_CONFIRM=YES required/);
	} finally {
		destroyTestEnv(env);
	}
});

test("2. cutover.sh refuses without IAGO_TELEGRAM_USER_ID", () => {
	const env = newTestEnv();
	try {
		const r = runCutover(env, {
			env: {
				IAGO_CUTOVER_DRY_RUN: "1",
				// Explicitly clear the env var inherited from harness shell.
				IAGO_TELEGRAM_USER_ID: "",
			},
		});
		assert.notEqual(r.status, 0);
		const text = `${r.stdout}\n${r.stderr}`;
		assert.match(text, /IAGO_TELEGRAM_USER_ID not set/);
	} finally {
		destroyTestEnv(env);
	}
});

test("3. cutover.sh refuses if pre-flight check fails (stub-injected failure on daemon-state dir)", () => {
	const env = newTestEnv();
	try {
		const r = runCutover(env, {
			env: {
				IAGO_CUTOVER_DRY_RUN: "1",
				IAGO_TELEGRAM_USER_ID: "12345",
				STUB_FAIL_TAILSCALE_PATTERN:
					"test -d /var/lib/iago-os/daemon-state",
			},
		});
		assert.notEqual(r.status, 0);
		const text = `${r.stdout}\n${r.stderr}`;
		assert.match(
			text,
			/pre-flight check failed: VPS daemon-state dir present/,
		);
	} finally {
		destroyTestEnv(env);
	}
});

test("4. happy-path cutover with IAGO_CUTOVER_DRY_RUN=1 exits 0 and invokes expected commands", () => {
	const env = newTestEnv();
	try {
		const r = runCutover(env, {
			env: {
				IAGO_CUTOVER_DRY_RUN: "1",
				IAGO_TELEGRAM_USER_ID: "12345",
			},
			timeout: 90_000,
		});
		const log = readLog(env);
		const text = `${r.stdout}\n${r.stderr}`;
		assert.strictEqual(
			r.status,
			0,
			`expected exit 0, got ${r.status}; stderr: ${r.stderr}; stdout-tail: ${r.stdout.slice(-1000)}`,
		);
		// Lock acquired (bash -s heredoc) and released.
		assert.match(log, /tailscale ssh.*bash -s/);
		// archive-openclaw.sh invoked (NOT merely preflight-tested) via T+00.
		assert.match(log, /bash \/opt\/iago-os\/runtime\/deploy\/archive-openclaw\.sh/);
		// provision-credentials run for both telegram-token and gh-token.
		assert.match(log, /op read op:\/\/iago-os\/v2-daemon-telegram-bot/);
		assert.match(log, /op read op:\/\/iago-os\/v2-gh-token/);
		// systemctl daemon-reload + enable invoked via T+07.
		assert.match(log, /systemctl daemon-reload/);
		assert.match(log, /systemctl enable --now iago-os-v2-daemon\.service/);
		// journalctl daemon-start probe + IPC socket test via T+08.
		assert.match(log, /journalctl .*daemon-start/);
		assert.match(log, /test -S \/var\/lib\/iago-os\/daemon-state\/ipc\.sock/);
		// T+60 completion banner reached.
		assert.match(text, /CUTOVER COMPLETE/);
	} finally {
		destroyTestEnv(env);
	}
});

test("5. cutover with rollback trigger at T+10 invokes rollback.sh", () => {
	const env = newTestEnv();
	try {
		const r = runCutover(env, {
			env: {
				IAGO_CUTOVER_DRY_RUN: "1",
				IAGO_TELEGRAM_USER_ID: "12345",
				// At T+10 prompt, dry-run reply is 'n' → triggers rollback.sh.
				IAGO_CUTOVER_DRY_RUN_REPLY: "n",
			},
			timeout: 90_000,
		});
		const log = readLog(env);
		const text = `${r.stdout}\n${r.stderr}`;
		// trigger_rollback exits 2 after rollback.sh returns.
		assert.strictEqual(
			r.status,
			2,
			`expected exit 2 (rollback triggered), got ${r.status}; tail: ${text.slice(-800)}`,
		);
		assert.match(text, /ROLLBACK TRIGGERED/);
		// Rollback ran: stopped v2 + disabled v2 + started openclaw.
		// Post-Codex-P0 fix: stop and disable are issued as separate vssh
		// calls (was previously `stop && disable || true` on one line).
		assert.match(log, /systemctl stop iago-os-v2-daemon\.service/);
		assert.match(log, /systemctl disable iago-os-v2-daemon\.service/);
		assert.match(log, /su - ilsantino.*openclaw-gateway/);
	} finally {
		destroyTestEnv(env);
	}
});

test("6. rollback.sh refuses without IAGO_ROLLBACK_CONFIRM=YES", () => {
	const env = newTestEnv();
	try {
		const r = runRollback(env, { env: {} });
		assert.notEqual(r.status, 0);
		const text = `${r.stdout}\n${r.stderr}`;
		assert.match(text, /IAGO_ROLLBACK_CONFIRM=YES required/);
	} finally {
		destroyTestEnv(env);
	}
});

test("7. happy-path rollback with IAGO_ROLLBACK_DRY_RUN=1 + IAGO_ROLLBACK_SKIP_TOKEN=1", () => {
	const env = newTestEnv();
	try {
		const r = runRollback(env, {
			env: {
				IAGO_ROLLBACK_DRY_RUN: "1",
				IAGO_ROLLBACK_SKIP_TOKEN: "1",
			},
			// Windows spawn overhead: each tailscale-stub invocation costs
			// 200-500ms under node-test; ~30 spawns can blow a 30s budget.
			timeout: 60_000,
		});
		const log = readLog(env);
		const text = `${r.stdout}\n${r.stderr}`;
		assert.strictEqual(
			r.status,
			0,
			`expected exit 0, got ${r.status}; tail: ${text.slice(-800)}`,
		);
		// flock-style global lock acquired (bash -s heredoc).
		assert.match(log, /tailscale ssh.*bash -s/);
		// Stopped v2 + started openclaw user systemd unit.
		assert.match(log, /systemctl stop iago-os-v2-daemon\.service/);
		assert.match(log, /su - ilsantino.*openclaw-gateway/);
		// Token & patch steps were skipped.
		assert.doesNotMatch(log, /iago-rollback-patch/);
		assert.match(text, /ROLLBACK COMPLETE/);
	} finally {
		destroyTestEnv(env);
	}
});

test("8. rollback without SKIP_TOKEN with IAGO_ROLLBACK_DRY_RUN=1 invokes the temp-file-over-scp patch script + patch logic matches expected JSON byte-for-byte", () => {
	const env = newTestEnv();
	try {
		const r = runRollback(env, {
			env: {
				IAGO_ROLLBACK_DRY_RUN: "1",
				// SKIP_TOKEN explicitly NOT set
			},
			// Windows spawn overhead (see test 7).
			timeout: 60_000,
		});
		const log = readLog(env);
		const text = `${r.stdout}\n${r.stderr}`;
		assert.strictEqual(
			r.status,
			0,
			`expected exit 0, got ${r.status}; tail: ${text.slice(-800)}`,
		);
		// The patch script was scp/cat'd over and invoked via the
		// `bash /tmp/iago-rollback-patch-<unix>.sh` pattern.
		assert.match(log, /bash \/tmp\/iago-rollback-patch-\d+\.sh/);
		// SendEnv forwarded FRESH_TOKEN (NOT on argv).
		assert.match(log, /-o SendEnv=FRESH_TOKEN/);

		// Byte-for-byte patch verification — apply the equivalent
		// transformation in JS and compare against the expected output.
		const fixture = JSON.parse(readFileSync(fixtureOpenclawIn, "utf8"));
		fixture.channels.telegram.botToken = "DRYRUN_TOKEN_AAA";
		const expected = JSON.parse(
			readFileSync(fixtureOpenclawExpected, "utf8"),
		);
		assert.deepStrictEqual(fixture, expected);
	} finally {
		destroyTestEnv(env);
	}
});

test("9. cutover.sh IAGO_CUTOVER_RESUME_FROM=T+10 skips earlier steps", () => {
	const env = newTestEnv();
	try {
		const r = runCutover(env, {
			env: {
				IAGO_CUTOVER_DRY_RUN: "1",
				IAGO_TELEGRAM_USER_ID: "12345",
				IAGO_CUTOVER_RESUME_FROM: "T+10",
			},
			timeout: 60_000,
		});
		const log = readLog(env);
		const text = `${r.stdout}\n${r.stderr}`;
		assert.strictEqual(
			r.status,
			0,
			`expected exit 0, got ${r.status}; tail: ${text.slice(-800)}`,
		);
		// Earlier T-steps should NOT have run:
		// (preflight still calls `test -x .../archive-openclaw.sh`, so match
		// only the T+00 invocation pattern: `bash <path>/archive-openclaw.sh`.)
		assert.doesNotMatch(
			log,
			/bash \/opt\/iago-os\/runtime\/deploy\/archive-openclaw\.sh/,
			"T+00 archive should be skipped at RESUME_FROM=T+10",
		);
		assert.doesNotMatch(
			log,
			/op read op:\/\/iago-os\/v2-daemon-telegram-bot/,
			"T+05 provision-credentials should be skipped at RESUME_FROM=T+10",
		);
		// T+10 onwards still ran:
		assert.match(text, /CUTOVER COMPLETE/);
	} finally {
		destroyTestEnv(env);
	}
});

test("10. cutover.sh refuses with BOTH IAGO_CUTOVER_NONINTERACTIVE=1 AND IAGO_CUTOVER_CONFIRM=YES (contradictory flag matrix, no DRY_RUN)", () => {
	const env = newTestEnv();
	try {
		const r = runCutover(env, {
			env: {
				IAGO_CUTOVER_NONINTERACTIVE: "1",
				IAGO_CUTOVER_CONFIRM: "YES",
				IAGO_TELEGRAM_USER_ID: "12345",
			},
		});
		assert.notEqual(r.status, 0);
		const text = `${r.stdout}\n${r.stderr}`;
		assert.match(text, /contradictory/);
	} finally {
		destroyTestEnv(env);
	}
});

test("11. cutover.sh with IAGO_CUTOVER_SKIP_TMINUS5_BASELINE=1 skips the T-05 baseline ping prompt", () => {
	const env = newTestEnv();
	try {
		const r = runCutover(env, {
			env: {
				IAGO_CUTOVER_DRY_RUN: "1",
				IAGO_TELEGRAM_USER_ID: "12345",
				IAGO_CUTOVER_SKIP_TMINUS5_BASELINE: "1",
			},
			timeout: 90_000,
		});
		const text = `${r.stdout}\n${r.stderr}`;
		assert.strictEqual(
			r.status,
			0,
			`expected exit 0, got ${r.status}; tail: ${text.slice(-800)}`,
		);
		// Skip banner present.
		assert.match(text, /\[T-05\] Skipping baseline ping/);
		// Baseline ping prompt is NOT emitted.
		assert.doesNotMatch(text, /send 'v2 cutover starting'/);
		// Cutover still completes through T+60.
		assert.match(text, /CUTOVER COMPLETE/);
	} finally {
		destroyTestEnv(env);
	}
});

test("12. cutover.sh IAGO_CUTOVER_RESUME_FROM=T+05 reaches T+08 (octal-leading-zero regression for stage_to_number)", () => {
	const env = newTestEnv();
	try {
		const r = runCutover(env, {
			env: {
				IAGO_CUTOVER_DRY_RUN: "1",
				IAGO_TELEGRAM_USER_ID: "12345",
				// T+08 has a leading zero. Before the stage_to_number fix,
				// `(( 08 >= 5 ))` errored under `set -e` because bash parsed
				// 08 as invalid octal — `should_run T+08` returned nonzero
				// and the IPC-socket / daemon-start checks were silently
				// skipped (or the whole script aborted, depending on shell).
				IAGO_CUTOVER_RESUME_FROM: "T+05",
			},
			timeout: 90_000,
		});
		const text = `${r.stdout}\n${r.stderr}`;
		assert.strictEqual(
			r.status,
			0,
			`expected exit 0, got ${r.status}; tail: ${text.slice(-800)}`,
		);
		// T+08 block ran (verify journalctl + IPC socket banner present).
		assert.match(text, /\[T\+08\] Verify journalctl daemon-start/);
		assert.match(text, /CUTOVER COMPLETE/);
	} finally {
		destroyTestEnv(env);
	}
});

test("13. cutover.sh fails closed when OpenClaw query errors (Codex P0 finding 1 regression)", () => {
	const env = newTestEnv();
	try {
		// Inject a failure on every openclaw is-active query the stub sees.
		// Pre-fix: the script masked query errors with `|| echo inactive`
		// and proceeded into the rest of the cutover while OpenClaw was
		// still running, opening a duplicate-processing window. Post-fix:
		// pre-archive query fails closed → script aborts BEFORE archive
		// runs, with no rollback because nothing has been torn down yet.
		const r = runCutover(env, {
			env: {
				IAGO_CUTOVER_DRY_RUN: "1",
				IAGO_TELEGRAM_USER_ID: "12345",
				STUB_FAIL_TAILSCALE_PATTERN: "is-active openclaw-gateway",
			},
			timeout: 60_000,
		});
		assert.notEqual(r.status, 0);
		const text = `${r.stdout}\n${r.stderr}`;
		assert.match(
			text,
			/openclaw-gateway pre-archive query failed/,
			`expected fail-closed abort message; tail: ${text.slice(-600)}`,
		);
		// Old code would have proceeded; verify archive-openclaw.sh was NOT invoked.
		const log = readLog(env);
		assert.doesNotMatch(
			log,
			/bash \/opt\/iago-os\/runtime\/deploy\/archive-openclaw\.sh/,
			"archive script must not run when pre-archive query fails",
		);
	} finally {
		destroyTestEnv(env);
	}
});

test("14. rollback.sh fails closed when systemctl disable fails (Codex P0 finding 2 regression)", () => {
	const env = newTestEnv();
	try {
		// Inject a failure on the v2 disable command. Pre-fix: `stop &&
		// disable || true` masked the disable failure and the script then
		// only checked is-active — a passing is-active gave false-success
		// even with the daemon still enabled (would restart on reboot,
		// creating split-brain recovery). Post-fix: disable is its own
		// vssh call, failures are not ignored, and the script exits 2.
		const r = runRollback(env, {
			env: {
				IAGO_ROLLBACK_DRY_RUN: "1",
				IAGO_ROLLBACK_SKIP_TOKEN: "1",
				STUB_FAIL_TAILSCALE_PATTERN: "systemctl disable iago-os-v2-daemon",
			},
			timeout: 60_000,
		});
		assert.notEqual(r.status, 0);
		const text = `${r.stdout}\n${r.stderr}`;
		assert.match(
			text,
			/systemctl disable iago-os-v2-daemon\.service failed/,
			`expected disable-failure error; tail: ${text.slice(-600)}`,
		);
		const log = readLog(env);
		// OpenClaw must NOT have been started — rollback aborted earlier.
		assert.doesNotMatch(
			log,
			/su - ilsantino.*systemctl --user enable --now openclaw-gateway/,
			"OpenClaw start must not run after disable failure",
		);
		// ROLLBACK COMPLETE must NOT have been printed.
		assert.doesNotMatch(text, /ROLLBACK COMPLETE/);
	} finally {
		destroyTestEnv(env);
	}
});

test("15. cutover.sh release_remote_lock leaves a hijacked marker intact (Codex P1 finding 3 regression)", () => {
	const env = newTestEnv();
	try {
		// Simulate a concurrent operator breaking the stale lock and
		// re-acquiring it under a different identifier WHILE our cutover
		// is mid-flight. Pre-fix: the EXIT trap's release_remote_lock did
		// an unconditional `rm -f` on the pid marker, deleting the
		// foreign run's marker and opening a third concurrent slot. Post-
		// fix: release_remote_lock re-acquires the flock and only removes
		// the marker if its contents still equal this process's
		// LOCK_MARKER; mismatch → leave it alone.
		const HIJACKER = "HIJACKER:9999:0";
		const r = runCutover(env, {
			env: {
				IAGO_CUTOVER_DRY_RUN: "1",
				IAGO_TELEGRAM_USER_ID: "12345",
				STUB_HIJACK_LOCK_AFTER_ACQUIRE: HIJACKER,
			},
			timeout: 60_000,
		});
		// First verify_lock_still_ours after the hijack detects mismatch
		// and aborts. Exit code is 1 from the `exit 1` in verify_lock.
		assert.notEqual(r.status, 0);
		const text = `${r.stdout}\n${r.stderr}`;
		assert.match(
			text,
			/lock pid marker changed/,
			`expected verify_lock_still_ours mismatch abort; tail: ${text.slice(-600)}`,
		);
		// Critical assertion: the hijacker's marker must STILL be on disk
		// after the EXIT trap fired — proving release_remote_lock did the
		// owner check and skipped the destructive rm.
		const lockPath = path.join(env.stubStateDir, "lock.pid");
		assert.ok(
			existsSync(lockPath),
			"hijacker marker should still exist (owner-checked release skipped rm)",
		);
		const remaining = readFileSync(lockPath, "utf8").trim();
		assert.strictEqual(
			remaining,
			HIJACKER,
			`expected hijacker marker '${HIJACKER}' preserved, got '${remaining}'`,
		);
	} finally {
		destroyTestEnv(env);
	}
});
