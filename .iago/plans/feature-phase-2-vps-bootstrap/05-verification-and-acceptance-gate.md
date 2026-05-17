---
phase: feature-phase-2-vps-bootstrap
plan: 05
wave: 3
depends_on: [03, 04]
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-17
source: feature
---

# Plan: feature-phase-2-vps-bootstrap/05-verification-and-acceptance-gate

## Goal

Acceptance gate for Phase 2: every spec § 10 criterion (1–8) has a machine-verifiable hook or a clearly-labeled manual-evidence slot. Three deliverables: (1) `PHASE-2-EVIDENCE.md` template (matches Phase 1 evidence pattern; extends with VPS-side evidence — `systemd-analyze security` score, `systemctl status` output, journalctl excerpt, Telegram screenshot from phone during cutover); (2) `check-evidence.mjs` — Node script that scans the rendered evidence file against the template + verifies cited artifacts exist (e.g., `runtime/deploy/iago-os-v2-daemon.service`, `runtime/migration/02-cutover-runbook.md`, etc.); (3) `phase-2-vps.test.ts` — Vitest e2e test that connects to VPS via Tailscale SSH (only runs when `IAGO_VPS_E2E=1` env var set — opt-in, real connection), verifies systemd unit is active, IPC socket exists, journalctl shows expected events, pr-triage agent is registered, telemetry NDJSON shape is correct. This plan IS the Phase 2 acceptance gate — without a passing run, Phase 2 is not done. Source of truth: `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` § 10 (all 8 acceptance criteria).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/PHASE-2-EVIDENCE.md` | PR evidence template for Phase 2 acceptance gate |
| create | `runtime/scripts/check-evidence.mjs` | Node script: verify a filled-in evidence file passes all 8 criteria checks |
| create | `runtime/scripts/check-evidence.test.mjs` | Tests for the checker |
| create | `runtime/integration/phase-2-vps.test.ts` | Tailscale-SSH-based e2e test (opt-in via env var) |
| create | `runtime/integration/phase-2-vps.fixtures/expected-events.json` | Expected NDJSON event kinds for a healthy post-cutover daemon |
| edit | `runtime/PHASE-1-EVIDENCE.md` | Append cross-reference to PHASE-2-EVIDENCE.md (forward link only) |

## Tasks

### Task 1: Author PHASE-2-EVIDENCE.md template

- **files:** `runtime/PHASE-2-EVIDENCE.md`
- **action:** Match the structure of `runtime/PHASE-1-EVIDENCE.md` (127 lines) and extend for Phase 2 VPS-side evidence. Sections (one per spec § 10 criterion, plus master): (1) Purpose — "This file is the template the Phase 2 PR description must include. Phase 2 ships the v2 daemon to the Hostinger VPS via FAST cutover. Acceptance criterion #8 (master prompt): PR description includes terminal log + screenshot proving the cutover works end-to-end."; (2) Required evidence blocks: (a) build gate — `cd runtime && npx tsc --noEmit` + `shellcheck runtime/deploy/*.sh runtime/agents/pr-triage/*.sh` exits 0; (b) Vitest with coverage — `npx vitest run --coverage` includes new files (cred-bootstrap.ts, cron-scheduler.ts, pr-triage tests) at ≥80%; (c) test-cutover.mjs dry-run output — full log of `node --test runtime/scripts/test-cutover.mjs` showing all 8 cases pass; (d) **REAL CUTOVER TERMINAL LOG** — Santiago captures the full terminal output of `bash runtime/deploy/cutover.sh` from T-15 to T+60, paste here (redact any token/credential bytes); (e) **REAL ROLLBACK TERMINAL LOG (dry-run on staging-equivalent OR real rollback if cutover failed)** — output of `bash runtime/deploy/rollback.sh` showing ≤4 min wall clock; (f) **TELEGRAM SCREENSHOT** — phone screenshot of the v2 bot replying to `/agents` AND the canonical approval handshake from T+15 of cutover; (g) `journalctl -u iago-os-v2-daemon.service --since "1 hour ago" | head -50` excerpt showing clean startup events; (h) `systemd-analyze security iago-os-v2-daemon.service` output — MUST show exposure score ≤2.0 ("MEDIUM" or better) per spec § 1 verification; (i) `systemd-creds decrypt /etc/credstore.encrypted/iago-telegram-token.cred - | wc -c` output (length only, NEVER the value); (j) NDJSON telemetry excerpt — `tail -30 /var/lib/iago-os/daemon-state/telemetry/<date>.ndjson` showing kinds: daemon-start (with `runUnder: "systemd"`), cred-bootstrap-loaded (with `credentialsLoaded` array), agent-registered, agent-spawned, cron-fired OR cron-skipped (pr-triage), task-claimed (if a real 14:00 UTC tick happened), telegram-message-sent; (k) `pgrep -fa iago-os-v2-daemon` from VPS — single Node process owned by iago user; (l) `pgrep -fa openclaw` from VPS — empty output (OpenClaw is gone); (3) Failure-path evidence — each Phase 2 acceptance criterion failure path has a test row: cred-bootstrap NODE_ENV=test override (cred-bootstrap.test.ts), provision-credentials length-mismatch (provision-credentials.test.sh), archive script age-header missing (archive-openclaw.test.sh), cutover refuses without CONFIRM=YES (test-cutover.mjs), rollback wall-clock ≤4 min (target met per spec § 9 table); (4) Cutover decisions cross-reference — paste link to `runtime/migration/02-cutover-decisions.md`; (5) Garry checklist — 9-item copy from master prompt with `- [ ]` checkboxes; (6) Sign-off — "Santiago has stayed at keyboard 30 min post-cutover monitoring journal + Telegram with no regressions. Sebas notified pre-cutover (T-15)." File 150-280 lines.
- **verify:** `wc -l runtime/PHASE-2-EVIDENCE.md && grep -c "^## \|^### " runtime/PHASE-2-EVIDENCE.md && grep -c "\\[ \\]" runtime/PHASE-2-EVIDENCE.md && grep -c -i "criterion\|evidence" runtime/PHASE-2-EVIDENCE.md`
- **expected:** Line count 150-280. ≥10 section/sub-section headings. ≥9 checkbox items (Garry checklist). ≥15 criterion/evidence references.

### Task 2: Author check-evidence.mjs

- **files:** `runtime/scripts/check-evidence.mjs`
- **action:** Node ESM script (no external deps; use `node:fs`, `node:path`, `node:process`). Purpose: scan a rendered evidence file (Santiago fills the template, then runs this script) and verify every required block is present + every cited artifact path exists. CLI usage: `node runtime/scripts/check-evidence.mjs <path-to-evidence.md>` — default `runtime/PHASE-2-EVIDENCE.md`. Algorithm: (1) parse the markdown; expect specific section headers (`## ` lines + `### ` sub-sections); (2) for each required block, check: (a) the section header exists; (b) the content under it is NOT the literal placeholder text from the template (`paste the terminal log here`, `paste screenshot URL here`, `__TODO__`, etc.); (3) for cited artifact paths (any `runtime/deploy/...`, `runtime/migration/...`, `runtime/agents/...`), verify the file exists in the repo via `fs.existsSync`; (4) for the Garry checklist section, verify ALL 9 boxes are ticked (`- [x]` not `- [ ]`); (5) print a verdict: `PASS` (exit 0) with checks-passed count, or `FAIL` (exit 1) with list of failing checks + suggestions. Supports `--strict` flag: also runs sanity checks on captured evidence. **Security-score regex (pre-merge adversarial review I8 fix)**: parse `systemd-analyze security` output with the EXACT regex `/Overall exposure level [^:]*:\s*(\d+\.\d+)\s+(UNSAFE|EXPOSED|MEDIUM|OK|SAFE)/m` (multiline flag because the relevant line may be preceded/followed by `→` glyph or color codes). Capture group 1 = numeric score (assert ≤ 2.0); capture group 2 = category word (assert ∈ {MEDIUM, OK, SAFE} — reject UNSAFE/EXPOSED). Test against the fixture captured in Task 5 (`runtime/integration/phase-2-vps.fixtures/security-analyze-sample.txt`) — if the regex fails to match the fixture, fail the test with a diff showing what the regex saw vs expected. Provide `--phase 1|2` selector that uses different required-block lists per phase (so the same script works for both PHASE-1-EVIDENCE.md and PHASE-2-EVIDENCE.md). File 200-350 lines.
- **verify:** `cd runtime && node scripts/check-evidence.mjs PHASE-2-EVIDENCE.md ; echo "exit=$?"`
- **expected:** Initial run (template not filled in): exits 1 with FAIL + list of unfilled-template placeholders. After Santiago fills in (or for a partial automated fill via the impl session for testing the checker): exits 0 with PASS + count.

### Task 3: check-evidence.mjs tests

- **files:** `runtime/scripts/check-evidence.test.mjs`
- **action:** Node `--test` style test file. Fixtures: a `tmp/` dir with synthetic evidence files in 4 states: (a) unfilled-template — should FAIL all checks; (b) fully-filled — should PASS; (c) partially-filled — should FAIL the specific unfilled blocks; (d) filled-but-cited-artifact-missing — should FAIL with "missing file: <path>" for the bogus path. Test cases: (1) unfilled template FAILs with ≥8 missing-block reports; (2) fully-filled PASSes with count ≥10; (3) partial fill FAILs with exactly the expected unfilled blocks; (4) artifact-missing FAILs with the bogus path named; (5) `--phase 1` uses Phase 1 block list (currently 5 blocks per PHASE-1-EVIDENCE.md), `--phase 2` uses Phase 2 list (≥10 blocks); (6) `--strict` rejects security-score >2.0 in a filled template; (7) `--strict` accepts security-score ≤2.0; (8) Garry checklist with 8/9 boxes ticked FAILs; with 9/9 PASSes. File 150-300 lines.
- **verify:** `cd runtime && node --test scripts/check-evidence.test.mjs 2>&1 | tail -20`
- **expected:** All 8 tests pass.

### Task 4: Author phase-2-vps.test.ts (Tailscale-SSH e2e, opt-in)

- **files:** `runtime/integration/phase-2-vps.test.ts`
- **action:** Vitest e2e that connects to the REAL Hostinger VPS via `tailscale ssh root@srv1456441 -- <command>`. Opt-in via env: `IAGO_VPS_E2E=1` must be set OR all tests `skip`. NEVER run by default in CI (would require Tailscale auth on CI runners). Use `child_process.execSync` with explicit timeouts (10s per command). Test cases: (1) `systemctl is-active iago-os-v2-daemon.service` returns "active"; (2) `systemd-analyze security iago-os-v2-daemon.service` exit code 0, parse exposure score from output, assert ≤2.0; (3) `test -S /var/lib/iago-os/daemon-state/ipc.sock` returns 0 (IPC socket file exists); (4) `journalctl -u iago-os-v2-daemon.service --since "10 minutes ago" --no-pager | grep -c daemon-start` returns ≥1; (5) `ls /var/lib/iago-os/daemon-state/agents/` returns 0 (dir exists, may be empty if no auto-start agents); (6) `cat /var/lib/iago-os/daemon-state/telemetry/$(date -u +%Y-%m-%d).ndjson | head -5` returns valid NDJSON (each line parses via `JSON.parse`); (7) telemetry contains expected event kinds per `phase-2-vps.fixtures/expected-events.json` (assert ≥5 of the ≥7 expected kinds present in last 24h); (8) `pgrep -u iago -fa iago-os-v2-daemon` returns exactly one process; (9) `pgrep -fa openclaw` returns empty (OpenClaw gone); (10) `getent passwd iago` returns the iago user line; (11) `stat -c "%U:%G %a" /var/lib/iago-os/daemon-state` returns "iago:iago 700"; (12) `systemctl list-timers iago-archive-prune.timer --no-pager` shows next run within 24h; (13) `test -f /etc/credstore.encrypted/iago-telegram-token.cred` returns 0; (14) `systemd-creds decrypt /etc/credstore.encrypted/iago-telegram-token.cred - | wc -c` returns a positive integer (don't assert exact value — just that decryption works). Document in test file header: "OPT-IN ONLY. Requires IAGO_VPS_E2E=1 env var, Tailscale up, VPS reachable. Runs against PRODUCTION VPS post-cutover; not a CI-safe test." File 250-450 lines.
- **verify:** `cd runtime && IAGO_VPS_E2E=0 npx vitest run integration/phase-2-vps.test.ts 2>&1 | tail -15`
- **expected:** With `IAGO_VPS_E2E=0`: all 14 tests reported as `skipped`. With `IAGO_VPS_E2E=1` (post-cutover, Santiago triggers manually): all 14 tests pass. The skip path is the CI default.

### Task 5: Author expected-events.json fixture

- **files:** `runtime/integration/phase-2-vps.fixtures/expected-events.json`
- **action:** JSON array listing the NDJSON event `kind` values a healthy post-cutover daemon should emit in the first 24h. Format: `[{ "kind": "<name>", "frequency": "once|hourly|daily|on-demand", "criticality": "required|expected|optional" }, ...]`. Entries: `daemon-start` (once, required); `cred-bootstrap-loaded` (once, required); `agent-registered` (once per registered agent, expected — required for pr-triage if autoStart but pr-triage is autoStart=false so this fires only on cron-fired claim — mark expected); `cron-fired` (daily at 14:00 UTC, expected — required if any open PR in iago-os org); `cron-skipped` (daily, expected — fires if no PRs); `agent-spawned` (per PTY adapter spawn, expected); `task-claimed` (per cron-fired task, expected); `telegram-message-sent` (per pr-triage successful run, expected); `heartbeat-tick` (every 60s, required); `agent-exited` (per cron run completion, expected). Test 7 in Task 4 uses this fixture. File 30-60 lines (small JSON). **Also capture a real `systemd-analyze security iago-os-v2-daemon.service` output** as fixture at `runtime/integration/phase-2-vps.fixtures/security-analyze-sample.txt` (anonymized — only the score line `Overall exposure level for iago-os-v2-daemon.service: 2.0 OK` + 5-10 lines of surrounding output context, no host-specific data like hostname or IP). Plan 05 Task 4 e2e test 2 + Plan 05 Task 2 `--strict` regex parse against this fixture format. Capture during the cutover dry-run (test-cutover.mjs harness can echo a stubbed sample) OR capture the real one post-cutover and back-fill the fixture during Plan 05 acceptance gate run. Both files (expected-events.json + security-analyze-sample.txt) live under the same fixtures dir.
- **verify:** `cat runtime/integration/phase-2-vps.fixtures/expected-events.json | jq . > /dev/null && jq 'length' runtime/integration/phase-2-vps.fixtures/expected-events.json`
- **expected:** Valid JSON. Array length ≥8 entries.

### Task 6: Cross-reference PHASE-1-EVIDENCE.md

- **files:** `runtime/PHASE-1-EVIDENCE.md`
- **action:** Append a short section at the END of PHASE-1-EVIDENCE.md (after the existing 127 lines): `## Phase 2 forward link\n\nPhase 2 extends this evidence pattern with VPS-side blocks (systemd-analyze security, journalctl, Telegram-screenshot-from-phone, cutover terminal log). See [PHASE-2-EVIDENCE.md](./PHASE-2-EVIDENCE.md). The check-evidence.mjs script supports both phases via --phase flag.` Total addition: 5-10 lines. Do NOT modify any existing Phase 1 content.
- **verify:** `wc -l runtime/PHASE-1-EVIDENCE.md && grep -c "PHASE-2-EVIDENCE\.md\|check-evidence" runtime/PHASE-1-EVIDENCE.md`
- **expected:** Line count 132-145 (was 127, added 5-15). ≥2 references to PHASE-2-EVIDENCE.md or check-evidence.

## Verification

```bash
cd runtime && npx tsc --noEmit \
  && node scripts/check-evidence.mjs PHASE-2-EVIDENCE.md ; echo "evidence-check exit=$?" \
  && node --test scripts/check-evidence.test.mjs 2>&1 | tail -15 \
  && IAGO_VPS_E2E=0 npx vitest run integration/phase-2-vps.test.ts 2>&1 | tail -15
```

Expected:
- `tsc --noEmit` exit 0
- check-evidence.mjs exit 1 (unfilled template — this is normal, becomes 0 after Santiago fills in)
- check-evidence.test.mjs all 8 tests pass
- phase-2-vps.test.ts all 14 tests skipped (CI default; Santiago runs with IAGO_VPS_E2E=1 post-cutover)

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-17
**Reviewer:** orchestrator inline

### Critical (must fix in impl)

- **C1 — `phase-2-vps.test.ts` runs against PRODUCTION VPS and could disrupt Santiago's morning Telegram check.** Test 14 decrypts a credential (length-only assertion). Even read-only operations on the VPS during a real morning will show up in journalctl + telemetry, potentially confusing post-incident reviews. **Fix:** Add an `IAGO_VPS_E2E_NONDISRUPTIVE=1` mode that only runs tests 1, 3, 5, 6, 8, 9, 10, 11 (pure read-only file/process/journal checks, no `systemd-creds decrypt`, no `journalctl --since` write-amplifying queries). Document: "For routine health checks, use NONDISRUPTIVE=1. For pre-handoff verification or post-incident audits, use full mode." Add an additional test 0 that emits a sentinel telemetry event marker so post-test it's easy to grep "where did the e2e poke start?".
- **C2 — `check-evidence.mjs` placeholder regex is brittle.** Task 2 says "verify content is NOT the literal placeholder text from the template (`paste the terminal log here`, etc.)". If Santiago fills in a real terminal log that happens to mention the word "paste" in a path or command output, the checker would (incorrectly) reject it. **Fix:** Use a UNIQUE sentinel string the template definitely contains and a real log definitely doesn't: e.g., template uses `<!-- TODO: paste evidence -->` HTML comment which is never produced by tools. check-evidence.mjs greps for that exact sentinel. Each block in PHASE-2-EVIDENCE.md template uses the sentinel verbatim. Task 1 must update the template to use this sentinel.
- **C3 — `check-evidence.mjs` "cited artifact path" extraction is fragile.** Task 2 says "for any `runtime/deploy/...`, `runtime/migration/...`, `runtime/agents/...`, verify exists". A regex over the markdown could match paths inside code-fence backticks (real paths) AND inside prose (which may have outdated paths). **Fix:** Only scan code-fenced blocks and explicit link targets `[text](path)`, NOT prose. Use a regex matched against the fenced-block bodies. Document the matching rule in the script's header comment.

### Important (forward to impl, don't block)

- **I1 — `systemd-analyze security` score threshold.** Spec § 1 verification says "exposure level ≤2.0" but `systemd-analyze security` actually outputs both a numeric score AND a category ("UNSAFE", "EXPOSED", "MEDIUM", "OK", "SAFE"). The number is `0.0 ↔ 10.0` where LOWER is BETTER. Confirm: Task 4 test 2 + Task 2 `--strict` mode parse the number correctly (regex `Exposure level: (\d+\.\d+)` or similar). Document the expected output format: the score is on a line like `→ Overall exposure level for iago-os-v2-daemon.service: 2.0 OK 😀`. Parse accordingly.
- **I2 — Fixture `expected-events.json` heartbeat-tick frequency.** "Every 60s, required" — that's 1440 events/day. Tests should assert frequency PRESENCE not count (1440 is too many to enumerate). Test 7 assertion: "at least 1 heartbeat-tick in the last 5 min" — narrow window. Updates expected-events.json `frequency` to a more usable form: `expected_count_per_24h: 1440` and tests assert >= 24h * 0.95 / 60s = 1368 events as floor (allows brief downtime).
- **I3 — Filled evidence file may exceed GitHub PR description char limit.** Real terminal logs can be 10KB+ each; Phase 2 needs 2 such logs + a screenshot URL + various excerpts. GitHub PR description cap is 65536 chars. Likely fine but worth checking. **Fix:** PHASE-2-EVIDENCE.md Task 1 final section adds guidance: "If total evidence exceeds 50 KB, attach the cutover + rollback logs as files via PR file-attachment OR upload as gists + link from the PR description. Embed only the key excerpts inline."
- **I4 — `check-evidence.mjs --phase 1` blocks list must match actual PHASE-1-EVIDENCE.md.** PHASE-1-EVIDENCE.md has 5 evidence blocks per its current 127 lines. Verify Task 2 Phase 1 block list matches by reading the file first. If they diverge, --phase 1 throws false-positive failures. Tests in Task 3 should cover --phase 1 against the actual PHASE-1-EVIDENCE.md file in addition to fixture content.
- **I5 — Tailscale-SSH timeout.** Task 4 uses 10s per-command timeout. If the VPS is briefly unreachable (Tailscale node sleeping, etc.) a single test will fail. **Fix:** Add 3-retry with 5s backoff to each `execSync` call. Total worst-case per test: 30s. 14 tests × 30s = 7 min worst case — still acceptable for opt-in e2e.

### Minor

- M1 — Add to PHASE-2-EVIDENCE.md a "Why no staging VPS?" footer linking to `02-cutover-decisions.md` § 6 (no-staging-VPS decision). Helps a future reviewer understand the test path.
- M2 — `check-evidence.mjs` could grow into a richer pre-PR linter. Out of scope for Phase 2; flagged for Phase 6 dashboard work.

### Dimension-by-dimension verdicts

- **Precision:** Every required block has a check rule + the script that enforces it. Manual evidence (Telegram screenshot) is explicitly marked manual + carries a sentinel for the checker to detect "filled vs unfilled".
- **Edge cases:** C1 + C2 + C3 cover the most likely false-positives (production-VPS interference, placeholder-text-collisions, prose-path-matches).
- **Contradictions:** Plan 05 cross-references Plans 01–04. No contradiction; the dependency chain is clean (Plan 05 wave 3, depends on 03 + 04, which depend on 01 + 02).
- **Simpler alternatives:** Could skip check-evidence.mjs and rely on human PR reviewer to verify the template is filled. REJECTED — Garry standard says "every check the script can do, it should". The 350 lines of checker + tests buy reproducible verification. Could skip phase-2-vps.test.ts and rely on Santiago's manual cutover terminal log. REJECTED — even with NONDISRUPTIVE mode, having 8 read-only assertions runnable anytime is the difference between "I think v2 is healthy" and "v2 IS healthy per assertions 1-11".
- **Missing acceptance criteria:** All 8 spec § 10 criteria have a check or evidence-block: #1 (build gate) — Task 1 block (a) + Task 2 checker; #2 (≥80% coverage) — Task 1 block (b); #3 (integration test) — Task 1 block (c) test-cutover.mjs + Task 4 phase-2-vps.test.ts; #4 (documentation) — Plans 02 + 03 ship runbooks; PR description block (d) cites; #5 (telemetry NDJSON) — Task 1 block (j) + Task 4 test 6; #6 (rollback) — Task 1 block (e); #7 (verification path) — this plan IS criterion 7; #8 (self-evidence) — every block carries terminal-log/screenshot/journal-excerpt evidence.

### Implementer forward-list

1. Add `IAGO_VPS_E2E_NONDISRUPTIVE=1` test subset + sentinel-event marker (C1 fix).
2. Use `<!-- TODO: paste evidence -->` HTML-comment sentinel in template + checker grep (C2 fix).
3. Restrict path-existence checks to fenced-block + link-target content only (C3 fix).
4. Parse `systemd-analyze security` exposure score with the documented regex (I1 fix).
5. expected-events.json uses `expected_count_per_24h` field; test assertions use a 95%-floor for high-frequency events (I2 fix).
6. PHASE-2-EVIDENCE.md adds GitHub PR description size guidance (I3 fix).
7. Verify --phase 1 block list against actual PHASE-1-EVIDENCE.md content (I4 fix).
8. 3-retry with 5s backoff in phase-2-vps.test.ts execSync calls (I5 fix).
