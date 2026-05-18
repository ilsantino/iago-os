---
phase: feature-phase-2-vps-bootstrap
plan: 05b
wave: 3
depends_on: [05a]
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-18
source: feature
split_from: 05-verification-and-acceptance-gate
split_rationale: Pre-emptive split per .iago/decisions/2026-05-18-phase-2-split-and-dispatch.md. 05b ships the check-evidence.mjs Node script + tests + opt-in Tailscale-SSH e2e test (Tasks 2, 3, 4 of original 05). Depends on 05a (consumes PHASE-2-EVIDENCE.md template + expected-events.json fixture + security-analyze-sample.txt fixture).
---

# Plan: feature-phase-2-vps-bootstrap/05b-evidence-checker-and-e2e

## Goal

Ship the automated acceptance-gate enforcement that turns 05a's template + fixtures into a machine-verifiable check. Three deliverables: (1) `runtime/scripts/check-evidence.mjs` — Node script that scans a rendered evidence file (Santiago fills the template, then runs this) and verifies every required block is present (sentinel REPLACED), every cited artifact path exists, the Garry 9-item checklist is fully ticked, and (in `--strict` mode) the `systemd-analyze security` score is ≤2.0; (2) `runtime/scripts/check-evidence.test.mjs` — Node `--test` style tests covering 8+ states (unfilled, fully-filled, partial, artifact-missing, --phase 1, --phase 2, --strict score thresholds, Garry 8/9 vs 9/9); (3) `runtime/integration/phase-2-vps.test.ts` — opt-in Vitest e2e that connects to the real Hostinger VPS via `tailscale ssh root@srv1456441 -- <command>` (gated by `IAGO_VPS_E2E=1` env var; default skips). 14 read-mostly assertions + the nondisruptive subset (`IAGO_VPS_E2E_NONDISRUPTIVE=1`) for routine health checks. Source of truth: `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` § 10 (acceptance criterion #7 = verification path). This plan IS the Phase 2 acceptance gate — without a passing local checker run + (post-cutover) an opt-in green e2e, Phase 2 is not done.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/scripts/check-evidence.mjs` | Node script: verify a filled-in evidence file passes all 8 criteria checks; `--strict` parses security-analyze score |
| create | `runtime/scripts/check-evidence.test.mjs` | Tests for the checker (8+ cases across unfilled, filled, partial, artifact-missing, strict modes) |
| create | `runtime/integration/phase-2-vps.test.ts` | Tailscale-SSH-based e2e test (opt-in via env var); 14 assertions + nondisruptive subset |

## Tasks

### Task 1: Author check-evidence.mjs

- **files:** `runtime/scripts/check-evidence.mjs`
- **action:** Node ESM script (no external deps; use `node:fs`, `node:path`, `node:process`). Purpose: scan a rendered evidence file (Santiago fills the template, then runs this script) and verify every required block is present + every cited artifact path exists. CLI usage: `node runtime/scripts/check-evidence.mjs <path-to-evidence.md>` — default `runtime/PHASE-2-EVIDENCE.md`. Algorithm: (1) parse the markdown; expect specific section headers (`## ` lines + `### ` sub-sections); (2) for each required block, check: (a) the section header exists; (b) the sentinel `<!-- TODO: paste evidence -->` (per 05a Task 1 C2 carry-over) is REPLACED (zero occurrences of the literal sentinel string after fill) — this is the canonical "block is filled" signal, no fragile placeholder-text-regex needed; (3) for cited artifact paths, restrict scan to fenced-code-blocks AND explicit link targets `[text](path)` (C3 carry-over — do NOT scan prose; outdated paths in prose would otherwise yield false positives). Patterns: `runtime/deploy/...`, `runtime/migration/...`, `runtime/agents/...`. For each match, verify the file exists via `fs.existsSync`; (4) for the Garry checklist section, verify ALL 9 boxes are ticked (`- [x]` not `- [ ]`); (5) print a verdict: `PASS` (exit 0) with checks-passed count, or `FAIL` (exit 1) with list of failing checks + suggestions. Supports `--strict` flag: also runs sanity checks on captured evidence. **Security-score regex (pre-merge adversarial review I8 carry-over)**: parse `systemd-analyze security` output with the EXACT regex `/Overall exposure level [^:]*:\s*(\d+\.\d+)\s+(UNSAFE|EXPOSED|MEDIUM|OK|SAFE)/m` (multiline flag because the relevant line may be preceded/followed by `→` glyph or color codes). Capture group 1 = numeric score (assert ≤ 2.0); capture group 2 = category word (assert ∈ {MEDIUM, OK, SAFE} — reject UNSAFE/EXPOSED). Test against the fixture captured in 05a Task 3 (`runtime/integration/phase-2-vps.fixtures/security-analyze-sample.txt`) — if the regex fails to match the fixture, fail with a diff showing what the regex saw vs expected. Provide `--phase 1|2` selector that uses different required-block lists per phase (so the same script works for both PHASE-1-EVIDENCE.md and PHASE-2-EVIDENCE.md). For `--phase 2`, the block list MUST include the SIGHUP-reload verification block (Plan 06 cross-ref) and pr-triage telemetry block (04b cross-ref). For `--phase 1`, the block list MUST match the actual PHASE-1-EVIDENCE.md sections (I4 carry-over — read the file first and verify alignment in Task 2 tests). File 220-360 lines.
- **verify:** `cd runtime && node scripts/check-evidence.mjs PHASE-2-EVIDENCE.md ; echo "exit=$?"`
- **expected:** Initial run (template not filled in — sentinels all present): exits 1 with FAIL + list of unfilled blocks (one entry per sentinel). After Santiago fills in (sentinels removed): exits 0 with PASS + count.

### Task 2: check-evidence.mjs tests

- **files:** `runtime/scripts/check-evidence.test.mjs`
- **action:** Node `--test` style test file. Fixtures: a `tmp/` dir with synthetic evidence files in 4 states: (a) unfilled-template (all sentinels present) — should FAIL all checks; (b) fully-filled (sentinels all removed, Garry boxes ticked, paths exist) — should PASS; (c) partially-filled (some sentinels removed, others present) — should FAIL the specific unfilled blocks; (d) filled-but-cited-artifact-missing — should FAIL with "missing file: <path>" for the bogus path. Test cases: (1) unfilled template FAILs with ≥10 sentinel-present reports; (2) fully-filled PASSes with count ≥10; (3) partial fill FAILs with exactly the expected unfilled blocks; (4) artifact-missing FAILs with the bogus path named; (5) `--phase 1` uses Phase 1 block list (currently 5 blocks per PHASE-1-EVIDENCE.md — verify against the actual file content per I4 carry-over), `--phase 2` uses Phase 2 list (≥10 blocks); (6) `--strict` rejects security-score >2.0 in a synthetic filled template (mutate fixture to `2.5 EXPOSED`); (7) `--strict` accepts security-score ≤2.0 (use 05a Task 3 fixture as-is with `2.0 OK`); (8) Garry checklist with 8/9 boxes ticked FAILs; with 9/9 PASSes; (9) `--strict` regex parse test — invoke against `runtime/integration/phase-2-vps.fixtures/security-analyze-sample.txt` and assert the regex matches AND extracts `2.0` + `OK`; (10) prose-vs-fenced-code path scan (C3 carry-over) — fixture with `outdated_path` in a markdown prose paragraph (NOT in a code fence) → checker does NOT flag it as missing artifact (only fenced + link-target paths are scanned). File 180-320 lines.
- **verify:** `cd runtime && node --test scripts/check-evidence.test.mjs 2>&1 | tail -25`
- **expected:** All 10 tests pass.

### Task 3: Author phase-2-vps.test.ts (Tailscale-SSH e2e, opt-in)

- **files:** `runtime/integration/phase-2-vps.test.ts`
- **action:** Vitest e2e that connects to the REAL Hostinger VPS via `tailscale ssh root@srv1456441 -- <command>`. Opt-in via env: `IAGO_VPS_E2E=1` must be set OR all tests `skip`. NEVER run by default in CI (would require Tailscale auth on CI runners). **Nondisruptive subset (C1 carry-over):** support `IAGO_VPS_E2E_NONDISRUPTIVE=1` mode that only runs tests 1, 3, 5, 6, 8, 9, 10, 11 (pure read-only file/process/journal checks, no `systemd-creds decrypt`, no `journalctl --since` write-amplifying queries). Document: "For routine health checks, use NONDISRUPTIVE=1. For pre-handoff verification or post-incident audits, use full mode." Use `child_process.execSync` with explicit timeouts (10s per command) + 3-retry × 5s backoff (I5 carry-over — worst case 30s per test × 14 tests = 7 min, still acceptable for opt-in). Add test 0 that emits a sentinel telemetry event marker so post-test it's easy to grep "where did the e2e poke start?" via `tailscale ssh root@srv1456441 -- 'echo "{\"kind\":\"e2e-test-start\",\"sentinel\":\"<unix>\"}" >> /var/log/iago-os/cutover.ndjson'`. Test cases: (1) `systemctl is-active iago-os-v2-daemon.service` returns "active"; (2) `systemd-analyze security iago-os-v2-daemon.service` exit code 0, parse exposure score from output via the same regex as check-evidence.mjs, assert ≤2.0 — NOT in nondisruptive (heavier query); (3) `test -S /var/lib/iago-os/daemon-state/ipc.sock` returns 0 (IPC socket file exists); (4) `journalctl -u iago-os-v2-daemon.service --since "10 minutes ago" --no-pager | grep -c daemon-start` returns ≥1 — NOT in nondisruptive (journalctl can be expensive); (5) `ls /var/lib/iago-os/daemon-state/agents/` returns 0 (dir exists, may be empty if no auto-start agents); (6) `cat /var/lib/iago-os/daemon-state/telemetry/$(date -u +%Y-%m-%d).ndjson | head -5` returns valid NDJSON (each line parses via `JSON.parse`); (7) telemetry contains expected event kinds per `phase-2-vps.fixtures/expected-events.json` (assert ≥5 of the ≥10 expected kinds present in last 24h; for high-frequency `heartbeat-tick` events, assert count ≥ 95% of the `expected_count_per_24h: 1440` floor, i.e., ≥1368 events) — NOT in nondisruptive; (8) `pgrep -u iago -fa iago-os-v2-daemon` returns exactly one process; (9) `pgrep -fa openclaw` returns empty (OpenClaw gone); (10) `getent passwd iago` returns the iago user line; (11) `stat -c "%U:%G %a" /var/lib/iago-os/daemon-state` returns "iago:iago 700"; (12) `systemctl list-timers iago-archive-prune.timer --no-pager` shows next run within 24h — NOT in nondisruptive; (13) `test -f /etc/credstore.encrypted/iago-telegram-token.cred` returns 0; (14) `systemd-creds decrypt /etc/credstore.encrypted/iago-telegram-token.cred - | wc -c` returns a positive integer (don't assert exact value — just that decryption works) — NOT in nondisruptive (decryption is a sensitive op). Document in test file header: "OPT-IN ONLY. Requires IAGO_VPS_E2E=1 env var, Tailscale up, VPS reachable. Runs against PRODUCTION VPS post-cutover; not a CI-safe test. For routine health checks, use IAGO_VPS_E2E_NONDISRUPTIVE=1." File 280-480 lines.
- **verify:** `cd runtime && IAGO_VPS_E2E=0 npx vitest run integration/phase-2-vps.test.ts 2>&1 | tail -15`
- **expected:** With `IAGO_VPS_E2E=0`: all 14 tests reported as `skipped`. With `IAGO_VPS_E2E=1` (post-cutover, Santiago triggers manually): all 14 tests pass. With `IAGO_VPS_E2E=1 IAGO_VPS_E2E_NONDISRUPTIVE=1`: 8 tests run, 6 skipped. The skip path is the CI default.

## Verification

```bash
cd runtime && node scripts/check-evidence.mjs PHASE-2-EVIDENCE.md ; echo "evidence-check exit=$? (1 expected — template unfilled)" \
  && node --test scripts/check-evidence.test.mjs 2>&1 | tail -15 \
  && IAGO_VPS_E2E=0 npx vitest run integration/phase-2-vps.test.ts 2>&1 | tail -15
```

Expected:
- check-evidence.mjs exits 1 (unfilled template — this is normal, becomes 0 after Santiago fills in)
- check-evidence.test.mjs all 10 tests pass
- phase-2-vps.test.ts all 14 tests skipped (CI default; Santiago runs with IAGO_VPS_E2E=1 post-cutover)

## Stress Test

**Verdict:** PROCEED (carried forward from original Plan 05 stress test, scoped to 05b tasks only)
**Date:** 2026-05-18 (pre-emptive split; original stress 2026-05-17)
**Reviewer:** orchestrator inline (carve-out)

### Critical (must fix in impl)

- **C1 — `phase-2-vps.test.ts` runs against PRODUCTION VPS and could disrupt Santiago's morning Telegram check.** Test 14 decrypts a credential (length-only assertion). Even read-only operations on the VPS during a real morning show up in journalctl + telemetry, potentially confusing post-incident reviews. **Fix:** `IAGO_VPS_E2E_NONDISRUPTIVE=1` mode runs tests 1, 3, 5, 6, 8, 9, 10, 11 only (pure read-only file/process/journal checks). Test 0 emits a sentinel telemetry event marker (`e2e-test-start { sentinel: <unix> }`) so post-test it's easy to grep "where did the e2e poke start?".
- **C2 — Placeholder-replacement check vs content-meaning check.** Original Plan 05 Task 2 had a brittle placeholder-text-regex. **Fix:** 05b checker uses the sentinel `<!-- TODO: paste evidence -->` from 05a Task 1. The sentinel is unique (HTML comment never produced by tools); checker greps for it and counts; ZERO occurrences = all blocks filled. Does NOT enforce content meaning — that's the human PR reviewer's job.
- **C3 — Cited-artifact-path extraction restricted to fenced blocks + link targets.** Original Plan 05 Task 2 noted that a regex over the whole markdown could match paths in prose (which may have outdated references). **Fix:** check-evidence.mjs scans only `\`\`\`...\`\`\`` fenced blocks and `[text](path)` link targets. Documented in the script's header comment. Task 2 test case 10 enforces (prose path NOT flagged).

### Important (forward to impl, don't block)

- **I1 — `systemd-analyze security` score regex.** Spec § 1 verification says "exposure level ≤2.0". The number is `0.0 ↔ 10.0` where LOWER is BETTER. Both check-evidence.mjs `--strict` mode AND phase-2-vps.test.ts test 2 use the same regex (`/Overall exposure level [^:]*:\s*(\d+\.\d+)\s+(UNSAFE|EXPOSED|MEDIUM|OK|SAFE)/m`). Drift between the two would mean a fixture parses but the live test doesn't (or vice versa). Both share a single helper function in check-evidence.mjs that phase-2-vps.test.ts imports — DRY mitigation.
- **I2 — `expected-events.json` heartbeat-tick frequency assertion.** 1440 events/day floor at 95% = 1368. Test 7 uses this floor. Document in test comment that brief downtime (e.g., a 30-min systemctl restart) leaves the floor satisfied (1440 - 30 = 1410 > 1368).
- **I4 — `check-evidence.mjs --phase 1` block list MUST match actual PHASE-1-EVIDENCE.md.** PHASE-1-EVIDENCE.md has ~5 evidence blocks per its 127 lines. Verify in Task 2 by reading the file first; if blocks diverge, --phase 1 throws false-positive failures. Tests in Task 2 cover --phase 1 against the actual PHASE-1-EVIDENCE.md file in addition to fixture content.
- **I5 — Tailscale-SSH timeout + retry.** Task 3 uses 10s per-command timeout + 3-retry × 5s backoff. Total worst-case per test: 30s. 14 tests × 30s = 7 min worst case — acceptable for opt-in e2e.

### Minor

- **M1 — check-evidence.mjs could grow into a richer pre-PR linter.** Out of scope for Phase 2; flagged for Phase 6 dashboard work where the dashboard could surface "PRs with missing evidence" as a UI card.
- **M2 — `--strict` fixture path is hardcoded.** check-evidence.mjs `--strict` parses `runtime/integration/phase-2-vps.fixtures/security-analyze-sample.txt` by default. If the fixture moves, both the checker and test 9 fail consistently — that's a feature, not a bug (catches accidental fixture relocation).

### Dimension-by-dimension verdicts (05b scope)

- **Precision:** Each task has line-count + behavioral verification. 10 checker tests cover unfilled/filled/partial/artifact-missing/--phase/--strict/Garry/prose-scan. 14 e2e tests cover liveness + journal + telemetry + process + permissions.
- **Edge cases:** C1 (nondisruptive subset) + C2 (sentinel replacement) + C3 (prose vs fenced) cover the brittle paths. I2 (1440 heartbeat floor) covers high-frequency event counting.
- **Contradictions:** check-evidence.mjs `--strict` regex AND phase-2-vps.test.ts test 2 share a helper function — no drift. PHASE-1-EVIDENCE.md `--phase 1` block list verified against the actual file in Task 2 test 5.
- **Simpler alternatives:** Could skip the checker and rely on human PR reviewer. REJECTED per Garry standard. Could skip e2e and rely on Santiago's manual cutover terminal log. REJECTED — 14 read-mostly assertions runnable anytime is the difference between "I think v2 is healthy" and "v2 IS healthy per these specific checks".
- **Missing acceptance criteria:** 05b is criterion 7 (verification path). All other criteria's evidence is captured by 05a's template; 05b verifies the template is filled + cited artifacts exist.

### Implementer forward-list

1. Sentinel-based fill check (C2 fix; coordinates with 05a Task 1).
2. Fenced-block + link-target scan only for paths (C3 fix; test 10 enforces).
3. `IAGO_VPS_E2E_NONDISRUPTIVE=1` subset + sentinel event marker (C1 fix).
4. Shared regex helper between check-evidence.mjs and phase-2-vps.test.ts (I1 DRY).
5. 95%-floor for high-frequency event count assertions (I2 fix).
6. `--phase 1` block list verified against actual PHASE-1-EVIDENCE.md (I4 fix).
7. 3-retry × 5s backoff in phase-2-vps.test.ts execSync calls (I5 fix).
