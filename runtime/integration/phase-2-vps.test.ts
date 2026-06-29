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
import { parseSecurityScore } from "../scripts/check-evidence.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const VPS_HOST = "root@srv1456441";

const E2E = process.env.IAGO_VPS_E2E === "1";
const NONDISRUPTIVE = process.env.IAGO_VPS_E2E_NONDISRUPTIVE === "1";
// Read-only subset (tests 1,3,5,6,8,9,10,11) runs whenever opted in.
const skipNondisruptive = !E2E;
// Heavier/sensitive tests (0,2,4,7,12,13,14) skip in nondisruptive mode.
const skipDisruptive = !E2E || NONDISRUPTIVE;

type ExpectedEvent = { kind: string; criticality: string };
const expectedEvents = JSON.parse(
	readFileSync(
		resolve(here, "phase-2-vps.fixtures/expected-events.json"),
		"utf8",
	),
) as ExpectedEvent[];

interface VpsResult {
	code: number;
	stdout: string;
	stderr: string;
}

/** Synchronous sleep without a busy loop (for retry backoff). */
function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
		const r = spawnSync("tailscale", ["ssh", VPS_HOST, "--", remoteCmd], {
			encoding: "utf8",
			timeout: timeoutMs,
		});
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
	it.skipIf(skipDisruptive)("0. emits an e2e-test-start sentinel marker", () => {
		const sentinel = Date.now();
		const r = vps(
			`echo '{"kind":"e2e-test-start","sentinel":"${sentinel}"}' >> /var/log/iago-os/cutover.ndjson`,
		);
		expect(r.code).toBe(0);
	});

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
			const r = vps(
				"cat /var/lib/iago-os/daemon-state/telemetry/$(date -u +%Y-%m-%d).ndjson | head -5",
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
		"2. systemd-analyze security exposure score <= 2.0",
		() => {
			const r = vps("systemd-analyze security iago-os-v2-daemon.service", {
				timeoutMs: 15_000,
			});
			expect(r.code).toBe(0);
			const parsed = parseSecurityScore(r.stdout);
			expect(
				parsed,
				`could not parse exposure score from:\n${r.stdout}`,
			).not.toBeNull();
			// Spec §1 TARGET. The shipped unit ships no SystemCallFilter, so a real
			// capture may land MEDIUM (~3–5); if it exceeds the target the cutover PR
			// hardens the unit or documents the accepted band (see block (h)).
			expect(parsed.score).toBeLessThanOrEqual(2.0);
		},
	);

	it.skipIf(skipDisruptive)("4. journalctl shows a recent daemon-start", () => {
		// Window is "last 10 min" — run shortly post-cutover/restart.
		const r = vps(
			'journalctl -u iago-os-v2-daemon.service --since "10 minutes ago" --no-pager | grep -c daemon-start',
		);
		expect(Number.parseInt(r.stdout, 10)).toBeGreaterThanOrEqual(1);
	});

	it.skipIf(skipDisruptive)(
		"7. telemetry contains the required startup kinds (presence-only)",
		() => {
			// PRESENCE-based, NO count floor. Only `criticality: required` kinds are
			// asserted (daemon-start + cred-bootstrap-loaded). agent-*/cron-*/task-*
			// are legitimately absent on a quiet / zero-PR window (I2).
			const required = expectedEvents
				.filter((e) => e.criticality === "required")
				.map((e) => e.kind);
			expect(required.length).toBeGreaterThan(0);
			const r = vps(
				"cat /var/lib/iago-os/daemon-state/telemetry/$(date -u +%F).ndjson",
			);
			const kinds = new Set(
				nonEmptyLines(r.stdout).map((line) => JSON.parse(line).kind),
			);
			for (const kind of required) {
				expect(kinds.has(kind), `required telemetry kind missing: ${kind}`).toBe(
					true,
				);
			}
		},
	);

	it.skipIf(skipDisruptive)(
		"12. archive-prune timer is scheduled within 24h",
		() => {
			const r = vps("systemctl list-timers iago-archive-prune.timer --no-pager");
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
			// Length-only — NEVER assert the decrypted value.
			const r = vps(
				"systemd-creds decrypt /etc/credstore.encrypted/iago-telegram-token.cred - | wc -c",
			);
			expect(Number.parseInt(r.stdout, 10)).toBeGreaterThan(0);
		},
	);
});
