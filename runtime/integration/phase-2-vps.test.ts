/**
 * Phase 2 VPS cutover e2e (Plan 05b Task 3) — OPT-IN ONLY.
 *
 * Connects to the REAL Hostinger VPS over Tailscale SSH
 * (`tailscale ssh root@srv1456441 -- <command>`) and runs 14 read-mostly
 * acceptance assertions proving the v2 daemon is live, isolated, and healthy
 * post-cutover. This is NOT a CI-safe test — it requires Tailscale auth on the
 * runner and pokes PRODUCTION — so EVERY test skips unless `IAGO_VPS_E2E=1`.
 *
 *   OPT-IN ONLY. Requires IAGO_VPS_E2E=1 env var, Tailscale up, VPS reachable.
 *   Runs against the PRODUCTION VPS post-cutover; not a CI-safe test.
 *   For routine health checks, use IAGO_VPS_E2E_NONDISRUPTIVE=1.
 *
 * Modes:
 *   (default, IAGO_VPS_E2E unset)  → all tests skipped (the CI default).
 *   IAGO_VPS_E2E=1                 → full suite (test 0 marker + tests 1–14).
 *   IAGO_VPS_E2E=1 + IAGO_VPS_E2E_NONDISRUPTIVE=1
 *                                  → only the pure read-only subset
 *                                    (tests 1, 3, 5, 6, 8, 9, 10, 11) runs;
 *                                    the heavier/sensitive tests (0, 2, 4, 7, 12,
 *                                    13, 14 — journalctl/--since scans,
 *                                    systemd-analyze, systemd-creds decrypt,
 *                                    the marker write) skip (C1).
 *
 * Guidance: For routine health checks, use NONDISRUPTIVE=1. For pre-handoff
 * verification or post-incident audits, use full mode.
 *
 * Timing (I5): each remote command has a 10s timeout + up to 3 attempts with a
 * 5s backoff (worst case ~30s/test × 14 = ~7 min — acceptable for an opt-in e2e).
 *
 * The exposure-score regex (test 2) is imported from check-evidence.mjs so the
 * live parse and the `--strict` fixture parse can never drift (I1 DRY).
 *
 * Run (post-cutover, from `runtime/`):
 *   IAGO_VPS_E2E=1 npx vitest run integration/phase-2-vps.test.ts
 *   IAGO_VPS_E2E=1 IAGO_VPS_E2E_NONDISRUPTIVE=1 npx vitest run integration/phase-2-vps.test.ts
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// Shared with check-evidence.mjs --strict so the live and fixture parses agree.
import {
	SECURITY_LIVE_ACCEPTED_MAX,
	isAcceptedLiveScore,
	parseSecurityScore,
} from "../scripts/check-evidence.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const VPS_HOST = "root@srv1456441";

const E2E = process.env.IAGO_VPS_E2E === "1";
const NONDISRUPTIVE = process.env.IAGO_VPS_E2E_NONDISRUPTIVE === "1";
// Read-only subset (tests 1,3,5,6,8,9,10,11) runs whenever opted in.
const skipNondisruptive = !E2E;
// Heavier/sensitive tests (0,2,4,7,12,13,14) skip in nondisruptive mode.
const skipDisruptive = !E2E || NONDISRUPTIVE;

type ExpectedEvent = { kind: string; criticality: string };
// LAZY — only test 7 consumes this. A top-level read would couple vitest
// COLLECTION (every test in this file skips by default in CI) to the fixture's
// presence: a renamed/removed fixture would throw at import and red-fail the
// whole suite instead of cleanly skipping. Load it inside the one test that uses it.
function loadExpectedEvents(): ExpectedEvent[] {
	return JSON.parse(
		readFileSync(
			resolve(here, "phase-2-vps.fixtures/expected-events.json"),
			"utf8",
		),
	) as ExpectedEvent[];
}

interface VpsResult {
	code: number;
	stdout: string;
	stderr: string;
}

/** Synchronous sleep without a busy loop (for retry backoff). */
function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

interface VpsSpawn {
	cmd: string;
	args: string[];
	options: { input: string; encoding: BufferEncoding; timeout: number };
}

/**
 * Build the spawnSync arguments for ONE remote command over Tailscale SSH.
 *
 * The remote command is delivered on STDIN to `bash -o pipefail -s`, NEVER as a
 * trailing argv word. This is load-bearing: `tailscale ssh … -- bash -o pipefail
 * -c <cmd>` space-JOINS its argv into ONE remote SSH exec string that the remote
 * login shell RE-TOKENIZES, so `bash -c` would consume only the FIRST word of
 * `remoteCmd` and the rest (pipes, `-u <unit>` filters, quoted args) would leak
 * out as separate tokens — silently dropping the per-command `-o pipefail`
 * wrapper AND the pipe filters. e.g. `journalctl -u <unit> | grep -c daemon-start`
 * would lose its `-u` filter and count daemon-start across the WHOLE journal: a
 * false-green on a production acceptance check. With `bash -s` the script is read
 * verbatim from stdin, so spaces / pipes / quotes survive with ZERO remote
 * re-tokenization and `-o pipefail` stays effective. Mirrors the proven
 * `vssh bash -s <<EOF` stdin-delivery pattern in runtime/deploy/rollback.sh.
 */
function buildVpsSpawn(remoteCmd: string, timeoutMs: number): VpsSpawn {
	return {
		cmd: "tailscale",
		args: ["ssh", VPS_HOST, "--", "bash", "-o", "pipefail", "-s"],
		options: { input: remoteCmd, encoding: "utf8", timeout: timeoutMs },
	};
}

/**
 * Run a command on the VPS over Tailscale SSH. Retries ONLY on transport
 * failure (spawn error or a 10s timeout-kill) — a command that runs and returns
 * a non-zero status is a real result the caller asserts on, never retried.
 */
function vps(
	remoteCmd: string,
	opts: { timeoutMs?: number; retries?: number; backoffMs?: number } = {},
): VpsResult {
	const { timeoutMs = 10_000, retries = 3, backoffMs = 5_000 } = opts;
	let lastErr: unknown;
	for (let attempt = 1; attempt <= retries; attempt++) {
		// Deliver the remote command on STDIN to `bash -o pipefail -s` (see
		// buildVpsSpawn): `-o pipefail` so a failure in the FIRST stage of a remote
		// pipe (journalctl|grep, cat|head) propagates to the exit code instead of
		// being masked by the last stage's success (shell-deploy pipefail rule),
		// and `-s` (stdin) so the command is NOT a trailing argv word the remote
		// login shell would re-tokenize (which drops pipes / `-u` filters = false
		// green). Embedded quotes, spaces and pipes survive intact.
		const call = buildVpsSpawn(remoteCmd, timeoutMs);
		const r = spawnSync(call.cmd, call.args, call.options);
		if (r.error || r.signal) {
			lastErr =
				r.error ??
				new Error(`vps command timed out after ${timeoutMs}ms: ${remoteCmd}`);
			if (attempt < retries) {
				sleepSync(backoffMs);
				continue;
			}
			throw lastErr;
		}
		return {
			code: r.status ?? -1,
			stdout: (r.stdout ?? "").trim(),
			stderr: (r.stderr ?? "").trim(),
		};
	}
	throw lastErr;
}

function nonEmptyLines(text: string): string[] {
	return text.split("\n").filter((line) => line.trim() !== "");
}

describe("Phase 2 VPS cutover e2e (opt-in: IAGO_VPS_E2E=1)", () => {
	// Test 0 — telemetry sentinel marker. Makes it trivial to grep "where did
	// the e2e poke start?" in post-test review. Skipped in nondisruptive mode
	// (it WRITES to the cutover log).
	it.skipIf(skipDisruptive)(
		"0. emits an e2e-test-start sentinel marker",
		() => {
			const sentinel = Date.now();
			// retries: 1 — this is the ONLY write. A 10s timeout-kill does NOT prove
			// the remote append did not run server-side, so retrying could append a
			// SECOND identical line (the sentinel is fixed before the call). One
			// attempt keeps the diagnostic marker idempotent; a transport failure
			// surfaces as a throw.
			const r = vps(
				`echo '{"kind":"e2e-test-start","sentinel":"${sentinel}"}' >> /var/log/iago-os/cutover.ndjson`,
				{ retries: 1 },
			);
			expect(r.code).toBe(0);
		},
	);

	// --- Nondisruptive subset (pure read-only) ------------------------------

	it.skipIf(skipNondisruptive)("1. daemon service is active", () => {
		const r = vps("systemctl is-active iago-os-v2-daemon.service");
		expect(r.stdout).toBe("active");
	});

	it.skipIf(skipNondisruptive)("3. IPC socket file exists", () => {
		const r = vps("test -S /var/lib/iago-os/daemon-state/ipc.sock");
		expect(r.code).toBe(0);
	});

	it.skipIf(skipNondisruptive)(
		"5. daemon-state agents dir exists (may be empty)",
		() => {
			const r = vps("ls /var/lib/iago-os/daemon-state/agents/");
			expect(r.code).toBe(0);
		},
	);

	it.skipIf(skipNondisruptive)(
		"6. telemetry NDJSON head is valid JSON per line",
		() => {
			// UTC day-roll safety: the daemon writes UTC-dated NDJSON, so a capture
			// taken just after UTC midnight (or a cutover finishing just before it)
			// may find $(date -u +%F).ndjson absent/empty while the live events sit
			// in yesterday's file — a false-FAIL on a healthy daemon. Read the
			// FRESHEST telemetry NDJSON present instead of pinning to today's date.
			const r = vps(
				'cat "$(ls -1t /var/lib/iago-os/daemon-state/telemetry/*.ndjson 2>/dev/null | head -1)" 2>/dev/null | head -5',
			);
			const lines = nonEmptyLines(r.stdout);
			expect(lines.length).toBeGreaterThan(0);
			for (const line of lines) {
				expect(() => JSON.parse(line)).not.toThrow();
			}
		},
	);

	it.skipIf(skipNondisruptive)(
		"8. exactly one daemon process owned by iago",
		() => {
			// Grep the entry-point path: the systemd UNIT name iago-os-v2-daemon
			// never appears in the process command line.
			const r = vps("pgrep -u iago -fa dist/daemon/main.js");
			expect(nonEmptyLines(r.stdout).length).toBe(1);
		},
	);

	it.skipIf(skipNondisruptive)("9. OpenClaw is gone", () => {
		const r = vps("pgrep -fa openclaw");
		expect(r.stdout).toBe("");
	});

	it.skipIf(skipNondisruptive)("10. iago user exists", () => {
		const r = vps("getent passwd iago");
		expect(r.stdout).toMatch(/^iago:/);
	});

	it.skipIf(skipNondisruptive)(
		"11. daemon-state owned by iago:iago, mode 700",
		() => {
			const r = vps('stat -c "%U:%G %a" /var/lib/iago-os/daemon-state');
			expect(r.stdout).toBe("iago:iago 700");
		},
	);

	// --- Disruptive / heavier subset ----------------------------------------

	it.skipIf(skipDisruptive)(
		"2. systemd-analyze security exposure score within the accepted Phase-2 band",
		() => {
			const r = vps("systemd-analyze security iago-os-v2-daemon.service", {
				timeoutMs: 15_000,
			});
			expect(r.code).toBe(0);
			const parsed = parseSecurityScore(r.stdout);
			// Null-guard — also narrows `parsed` for the type-checked e2e tsconfig
			// (a plain expect().not.toBeNull() asserts at runtime but not for TS).
			if (parsed === null) {
				throw new Error(`could not parse exposure score from:\n${r.stdout}`);
			}
			// LIVE post-cutover acceptance is the looser accepted-for-Phase-2 band
			// (isAcceptedLiveScore: score ≤ SECURITY_LIVE_ACCEPTED_MAX, and
			// EXPOSED/UNSAFE/DANGEROUS rejected), NOT the hard ≤2.0 TARGET. The
			// shipped unit ships no SystemCallFilter, so a real capture realistically
			// lands in the OK band (~3–5), documented + accepted in block (h);
			// asserting the hard 2.0 target here would false-FAIL the
			// un-hardened-but-accepted unit. The hard ≤2.0 score is the FUTURE
			// hardening TARGET, checked only by the OPT-IN `check-evidence --strict`
			// against block (h) — NOT the per-PR acceptance command. The per-PR gate
			// is the DEFAULT (no --strict) `check-evidence --phase 2` run, which
			// band-checks block (h) with this SAME isAcceptedLiveScore predicate —
			// REJECTING the EXPOSED/UNSAFE/DANGEROUS class (and any score above the
			// ≤5.0 cap) while accepting the documented OK band — and does not enforce
			// the ≤2.0 floor.
			expect(
				isAcceptedLiveScore(parsed),
				`live exposure score ${parsed.score} ${parsed.band} exceeds the accepted-for-Phase-2 band (≤ ${SECURITY_LIVE_ACCEPTED_MAX}, EXPOSED/UNSAFE/DANGEROUS rejected)`,
			).toBe(true);
		},
	);

	it.skipIf(skipDisruptive)(
		"4. journalctl shows a recent systemd unit start",
		() => {
			// Liveness signal = the systemd "Started <Description>." line journald logs
			// when the unit reaches active. It is DISTINCT from test 7 (telemetry
			// daemon-start via NDJSON): the `daemon-start` telemetry kind reaches
			// journald ONLY on the emit() write-FAILURE path (telemetry.ts appendFile's
			// to the NDJSON and console.error's to stderr only when the append throws),
			// so a HEALTHY daemon logs ZERO `daemon-start` lines to journald — grepping
			// journald for `daemon-start` is an INVERTED signal that false-FAILs a
			// healthy daemon. Grep the systemd unit-start line instead. The `Started
			// .*iaGO-OS v2 daemon` regex matches BOTH the pre-v250 `Started <Description>.`
			// and the newer `Started <unit>.service - <Description>.` formats (Description
			// = "iaGO-OS v2 daemon — multi-agent runtime" per deploy/iago-os-v2-daemon.service);
			// it stops before the em-dash so the pattern stays ASCII, and "Started" is not
			// a substring of "Starting" so the pending-start line is not miscounted.
			// Window is "last 10 min" — run shortly post-cutover/restart.
			const r = vps(
				'journalctl -u iago-os-v2-daemon.service --since "10 minutes ago" --no-pager | grep -cE "Started .*iaGO-OS v2 daemon"',
			);
			expect(Number.parseInt(r.stdout, 10)).toBeGreaterThanOrEqual(1);
		},
	);

	it.skipIf(skipDisruptive)(
		"7. telemetry contains the required startup kinds (presence-only)",
		() => {
			// PRESENCE-based, NO count floor. Only `criticality: required` kinds are
			// asserted (daemon-start + cred-bootstrap-loaded). agent-*/cron-*/task-*
			// are legitimately absent on a quiet / zero-PR window (I2).
			// Load the fixture HERE (the lazy loader exists so the file's import
			// does not couple vitest collection to the fixture's presence).
			const expectedEvents = loadExpectedEvents();
			const required = expectedEvents
				.filter((e) => e.criticality === "required")
				.map((e) => e.kind);
			expect(required.length).toBeGreaterThan(0);
			// UTC day-roll safety: the required startup kinds land in the NDJSON of
			// the UTC day the daemon BOOTED. A cutover finishing just before UTC
			// midnight writes them to YESTERDAY's file, so reading only today's file
			// would false-FAIL a healthy daemon. Read today's AND yesterday's UTC
			// files (2>/dev/null tolerates whichever does not exist yet).
			const r = vps(
				"cat /var/lib/iago-os/daemon-state/telemetry/$(date -u +%F).ndjson " +
					"/var/lib/iago-os/daemon-state/telemetry/$(date -u -d yesterday +%F).ndjson " +
					"2>/dev/null",
			);
			const kinds = new Set(
				nonEmptyLines(r.stdout).map((line) => JSON.parse(line).kind),
			);
			for (const kind of required) {
				expect(
					kinds.has(kind),
					`required telemetry kind missing: ${kind}`,
				).toBe(true);
			}
		},
	);

	it.skipIf(skipDisruptive)(
		"12. archive-prune timer is scheduled within 24h",
		() => {
			const r = vps(
				"systemctl list-timers iago-archive-prune.timer --no-pager",
			);
			expect(r.code).toBe(0);
			expect(r.stdout).toContain("iago-archive-prune.timer");
			// A scheduled next run shows hours/min/sec "left", never n/a or >=2 days.
			expect(r.stdout).not.toMatch(/\bn\/a\b/);
			expect(r.stdout).not.toMatch(
				/\b([2-9]|\d{2,})\s*(?:days?|weeks?|months?)\s+left/i,
			);
		},
	);

	it.skipIf(skipDisruptive)("13. telegram-token credstore file exists", () => {
		const r = vps("test -f /etc/credstore.encrypted/iago-telegram-token.cred");
		expect(r.code).toBe(0);
	});

	it.skipIf(skipDisruptive)(
		"14. telegram-token decrypts to a positive byte count",
		() => {
			// Length-only — NEVER assert the decrypted value. A Telegram bot token is
			// `<8-10 digit id>:<35-char secret>` ≈ 44–46 bytes; assert ≥ 40 (a
			// shape-based floor): it still rejects a corrupted/partial decrypt (a few
			// garbage bytes — the `len > 0` anti-pattern the shell-deploy floor flags)
			// without false-FAILing a legitimate 44–45-byte token (short bot id, no
			// trailing newline). Length-only still keeps the secret value hidden.
			const r = vps(
				"systemd-creds decrypt /etc/credstore.encrypted/iago-telegram-token.cred - | wc -c",
			);
			expect(Number.parseInt(r.stdout, 10)).toBeGreaterThanOrEqual(40);
		},
	);
});

// Runs in CI (NOT opt-in / NOT skipIf-gated): a pure unit test of the spawn-arg
// construction so the SSH argv-flattening false-green can never silently return.
describe("vps() spawn construction", () => {
	it("delivers remoteCmd on stdin to `bash -o pipefail -s`, never as a trailing argv word", () => {
		// Regression guard: the pre-fix form passed remoteCmd as a trailing
		// `-c <cmd>` argv word, which tailscale ssh space-joins and the remote login
		// shell re-tokenizes — dropping pipe filters and the -o pipefail wrapper
		// (e.g. `journalctl -u <unit> | grep -c …` loses its -u filter = false
		// green). The fix delivers the command verbatim on stdin to `bash -s`.
		const remoteCmd =
			'journalctl -u iago-os-v2-daemon.service --since "10 minutes ago" --no-pager | grep -c daemon-start';
		const call = buildVpsSpawn(remoteCmd, 10_000);
		expect(call.cmd).toBe("tailscale");
		expect(call.args).toEqual([
			"ssh",
			VPS_HOST,
			"--",
			"bash",
			"-o",
			"pipefail",
			"-s",
		]);
		// The command MUST NOT appear as an argv word (it would be re-tokenized).
		expect(call.args).not.toContain(remoteCmd);
		expect(call.args.at(-1)).toBe("-s");
		// It travels verbatim on stdin so pipes / quotes / `-u` filters survive.
		expect(call.options.input).toBe(remoteCmd);
		expect(call.options.timeout).toBe(10_000);
	});
});
