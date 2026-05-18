---
phase: feature-phase-2-vps-bootstrap
plan: 05a
wave: 3
depends_on: [03b, 04b]
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-18
source: feature
split_from: 05-verification-and-acceptance-gate
split_rationale: Pre-emptive split per .iago/decisions/2026-05-18-phase-2-split-and-dispatch.md. 05a ships PHASE-2-EVIDENCE.md template + the expected-events fixture + the Phase 1 forward-link (Tasks 1, 5, 6 of original 05). 05b ships the check-evidence.mjs Node script + tests + opt-in Tailscale-SSH e2e test (Tasks 2, 3, 4). Depends on 03b (cutover-runbook reference) + 04b (pr-triage README + telemetry kinds).
---

# Plan: feature-phase-2-vps-bootstrap/05a-evidence-template-and-fixtures

## Goal

Ship the operator-facing acceptance evidence template + the test fixture that codifies the expected telemetry shape of a healthy post-cutover daemon. Three deliverables: (1) `runtime/PHASE-2-EVIDENCE.md` — the template Santiago fills in inside the Phase 2 PR description (terminal log + Telegram screenshot + journalctl excerpt + `systemd-analyze security` score + telemetry NDJSON excerpt + Garry 9-item checklist + sign-off); (2) `runtime/integration/phase-2-vps.fixtures/expected-events.json` — JSON array enumerating the NDJSON event kinds a healthy daemon emits in the first 24h, used by 05b's e2e test for assertions; (3) `runtime/integration/phase-2-vps.fixtures/security-analyze-sample.txt` — anonymized `systemd-analyze security` output sample used by 05b's `--strict` mode regex parsing; (4) `runtime/PHASE-1-EVIDENCE.md` — append cross-reference to PHASE-2-EVIDENCE.md (forward link only; do NOT modify existing Phase 1 content). Source of truth: `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` § 10 (acceptance criteria 1–8). The 05b checker + tests + e2e consume the template + fixtures produced here.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/PHASE-2-EVIDENCE.md` | PR evidence template for Phase 2 acceptance gate |
| create | `runtime/integration/phase-2-vps.fixtures/expected-events.json` | Expected NDJSON event kinds for a healthy post-cutover daemon |
| create | `runtime/integration/phase-2-vps.fixtures/security-analyze-sample.txt` | Anonymized `systemd-analyze security` output sample |
| edit | `runtime/PHASE-1-EVIDENCE.md` | Append cross-reference to PHASE-2-EVIDENCE.md (forward link only) |

## Tasks

### Task 1: Author PHASE-2-EVIDENCE.md template

- **files:** `runtime/PHASE-2-EVIDENCE.md`
- **action:** Match the structure of `runtime/PHASE-1-EVIDENCE.md` (127 lines) and extend for Phase 2 VPS-side evidence. Sections (one per spec § 10 criterion, plus master): (1) Purpose — "This file is the template the Phase 2 PR description must include. Phase 2 ships the v2 daemon to the Hostinger VPS via FAST cutover. Acceptance criterion #8 (master prompt): PR description includes terminal log + screenshot proving the cutover works end-to-end."; (2) Required evidence blocks — each block carries a SENTINEL placeholder per C2 carry-over: `<!-- TODO: paste evidence -->`. Blocks: (a) build gate — `cd runtime && npx tsc --noEmit` + `shellcheck runtime/deploy/*.sh runtime/agents/pr-triage/*.sh` exits 0 (sentinel); (b) Vitest with coverage — `npx vitest run --coverage` includes new files (cred-bootstrap.ts, cron-scheduler.ts, pr-triage tests) at ≥80% (sentinel); (c) test-cutover.mjs dry-run output — full log of `node --test runtime/scripts/test-cutover.mjs` showing all 10 cases pass (sentinel); (d) **REAL CUTOVER TERMINAL LOG** — Santiago captures the full terminal output of `bash runtime/deploy/cutover.sh` from T-15 to T+60 (sentinel; redact any token/credential bytes); (e) **REAL ROLLBACK TERMINAL LOG (dry-run via test-cutover.mjs OR real rollback if cutover failed)** — output showing ≤4 min wall clock (sentinel); (f) **TELEGRAM SCREENSHOT** — phone screenshot of the v2 bot replying to `/agents` AND the canonical approval handshake from T+15 of cutover (sentinel + uploadable image link); (g) `journalctl -u iago-os-v2-daemon.service --since "1 hour ago" | head -50` excerpt showing clean startup events (sentinel); (h) `systemd-analyze security iago-os-v2-daemon.service` output — MUST show exposure score ≤2.0 ("MEDIUM" or better) per spec § 1 verification (sentinel; 05b's `--strict` mode parses this); (i) `systemd-creds decrypt /etc/credstore.encrypted/iago-telegram-token.cred - | wc -c` output (length only, NEVER the value) (sentinel); (j) NDJSON telemetry excerpt — `tail -30 /var/lib/iago-os/daemon-state/telemetry/<date>.ndjson` showing kinds: daemon-start (with `runUnder: "systemd"`), cred-bootstrap-loaded (with `credentialsLoaded` array), agent-registered, agent-spawned, cron-fired OR cron-skipped (pr-triage), task-claimed (if a real 14:00 UTC tick happened), telegram-message-sent (sentinel); (k) `pgrep -fa iago-os-v2-daemon` from VPS — single Node process owned by iago user (sentinel); (l) `pgrep -fa openclaw` from VPS — empty output (OpenClaw is gone) (sentinel); (m) SIGHUP reload verification (Plan 06 cross-ref): `journalctl ... | grep cred-reload-fired` shows one event with `credentialsReloaded` populated (sentinel); (3) Failure-path evidence — each Phase 2 acceptance criterion failure path has a test row: cred-bootstrap NODE_ENV=test override (cred-bootstrap.test.ts), provision-credentials length-mismatch (provision-credentials.test.sh), archive script age-header missing + ephemeral keypair round-trip (archive-openclaw.test.sh), cutover refuses without CONFIRM=YES (test-cutover.mjs), rollback wall-clock ≤4 min (target met per spec § 9 table); (4) Cutover decisions cross-reference — paste link to `runtime/migration/02-cutover-decisions.md` (03b artifact); (5) Garry checklist — 9-item copy from master prompt with `- [ ]` checkboxes; (6) Sign-off — "Santiago has stayed at keyboard 30 min post-cutover monitoring journal + Telegram with no regressions. Sebas notified pre-cutover (T-15)." (7) **Size guidance (I3 carry-over)** — footer: "If total evidence exceeds 50 KB, attach the cutover + rollback logs as files via PR file-attachment OR upload as gists + link from the PR description. Embed only the key excerpts inline." (8) **No staging VPS footer (M1 carry-over)** — "Why no staging VPS? See `runtime/migration/02-cutover-decisions.md` § 6 (Santiago override + test-cutover.mjs substitute rationale)." File 180-300 lines.
- **verify:** `wc -l runtime/PHASE-2-EVIDENCE.md && grep -c "^## \|^### " runtime/PHASE-2-EVIDENCE.md && grep -c "\\[ \\]" runtime/PHASE-2-EVIDENCE.md && grep -c -i "criterion\|evidence" runtime/PHASE-2-EVIDENCE.md && grep -c -F "<!-- TODO: paste evidence -->" runtime/PHASE-2-EVIDENCE.md`
- **expected:** Line count 180-300. ≥10 section/sub-section headings. ≥9 checkbox items (Garry checklist). ≥15 criterion/evidence references. ≥10 sentinel placeholders (one per evidence block; 05b's checker greps for this exact sentinel string).

### Task 2: Author expected-events.json fixture

- **files:** `runtime/integration/phase-2-vps.fixtures/expected-events.json`
- **action:** JSON array listing the NDJSON event `kind` values a healthy post-cutover daemon should emit in the first 24h. Format: `[{ "kind": "<name>", "expected_count_per_24h": <number>, "criticality": "required|expected|optional", "extras_keys": [<expected payload keys>] }, ...]` (I2 carry-over from original Plan 05 — use `expected_count_per_24h` not the loose `frequency: "hourly|daily"` form; 05b test assertions use a 95%-floor for high-frequency events). Entries: `daemon-start` (count_per_24h: 1, required, extras: [`runUnder`]); `cred-bootstrap-loaded` (1, required, extras: [`credentialsLoaded`]); `agent-registered` (count_per_24h: 1 per agent (≥1 in Phase 2 = pr-triage), expected, extras: [`agentId`]); `cron-fired` (count_per_24h: 1, expected — required only if any open PR in iago-os org on the day, extras: [`agentId`, `schedule`, `taskFile`, `runningCount`]); `cron-skipped` (count_per_24h: 0 or 1 — expected, extras: [`agentId`, `reason`, `exitCode`]); `agent-spawned` (count_per_24h: 1 (per cron-fired), expected, extras: [`agentId`, `pid`]); `task-claimed` OR `task-resolved` (count_per_24h: 1 per cron-fired, expected, extras: [`agentId`, `filename`]); `telegram-message-sent` (count_per_24h: 1 (per pr-triage successful run), expected, extras: [`agentId`, `chatId`, `responseCode`]); `heartbeat-tick` (count_per_24h: 1440 — every 60s, required, extras: []); `agent-exited` (count_per_24h: 1 per cron-fired completion, expected, extras: [`agentId`, `exitCode`]). File 60-100 lines (small JSON). Total ≥10 entries.
- **verify:** `cat runtime/integration/phase-2-vps.fixtures/expected-events.json | jq . > /dev/null && jq 'length' runtime/integration/phase-2-vps.fixtures/expected-events.json && jq -r '.[].kind' runtime/integration/phase-2-vps.fixtures/expected-events.json | wc -l`
- **expected:** Valid JSON. Array length ≥10 entries; all entries have a `kind` field.

### Task 3: Author security-analyze-sample.txt fixture

- **files:** `runtime/integration/phase-2-vps.fixtures/security-analyze-sample.txt`
- **action:** Capture an anonymized `systemd-analyze security iago-os-v2-daemon.service` output sample. Format (one line containing the score is mandatory; surrounding context up to ~12 lines is included for realism): the exact regex 05b's `--strict` mode greps is `/Overall exposure level [^:]*:\s*(\d+\.\d+)\s+(UNSAFE|EXPOSED|MEDIUM|OK|SAFE)/m`. Sample content (anonymized — no host-specific data like hostname or IP):
```
  ✓ ProtectKernelTunables=             yes
  ✓ ProtectKernelModules=              yes
  ✓ ProtectControlGroups=              yes
  ✓ RestrictNamespaces=                yes
  ✓ RestrictSUIDSGID=                  yes
  ✓ MemoryDenyWriteExecute=            yes
  ✓ RestrictRealtime=                  yes
  ✓ RestrictSUIDSGID=                  yes
  ✓ LockPersonality=                   yes

→ Overall exposure level for iago-os-v2-daemon.service: 2.0 OK 😀
```
Pre-cutover, this file ships with the sample content above (derived from spec § 1 verification posture). Post-cutover, Santiago captures the REAL `systemd-analyze security iago-os-v2-daemon.service` output, anonymizes (strip any host-identifying lines), and replaces the file with the live capture. 05b's test 2 parses against this file regardless of which content it holds (sample or live). File 8-20 lines.
- **verify:** `wc -l runtime/integration/phase-2-vps.fixtures/security-analyze-sample.txt && grep -E 'Overall exposure level' runtime/integration/phase-2-vps.fixtures/security-analyze-sample.txt`
- **expected:** Line count 8-20. Exactly 1 match for the `Overall exposure level` line (the score-bearing line 05b's regex captures).

### Task 4: Cross-reference PHASE-1-EVIDENCE.md

- **files:** `runtime/PHASE-1-EVIDENCE.md`
- **action:** Append a short section at the END of PHASE-1-EVIDENCE.md (after the existing 127 lines): `## Phase 2 forward link\n\nPhase 2 extends this evidence pattern with VPS-side blocks (systemd-analyze security, journalctl, Telegram-screenshot-from-phone, cutover terminal log, SIGHUP reload verification). See [PHASE-2-EVIDENCE.md](./PHASE-2-EVIDENCE.md). The check-evidence.mjs script (05b) supports both phases via --phase flag.` Total addition: 5-12 lines. Do NOT modify any existing Phase 1 content.
- **verify:** `wc -l runtime/PHASE-1-EVIDENCE.md && grep -c "PHASE-2-EVIDENCE\.md\|check-evidence" runtime/PHASE-1-EVIDENCE.md`
- **expected:** Line count 132-145 (was 127, added 5-15). ≥2 references to PHASE-2-EVIDENCE.md or check-evidence.

## Verification

```bash
wc -l runtime/PHASE-2-EVIDENCE.md \
  && grep -c -F "<!-- TODO: paste evidence -->" runtime/PHASE-2-EVIDENCE.md \
  && jq . runtime/integration/phase-2-vps.fixtures/expected-events.json > /dev/null \
  && grep -E 'Overall exposure level' runtime/integration/phase-2-vps.fixtures/security-analyze-sample.txt \
  && grep -c "PHASE-2-EVIDENCE\.md" runtime/PHASE-1-EVIDENCE.md
```

Expected:
- PHASE-2-EVIDENCE.md 180-300 lines; ≥10 sentinel placeholders
- expected-events.json parses; ≥10 entries
- security-analyze-sample.txt has the `Overall exposure level` line
- PHASE-1-EVIDENCE.md has ≥1 forward link to PHASE-2-EVIDENCE.md

## Stress Test

**Verdict:** PROCEED (carried forward from original Plan 05 stress test, scoped to 05a tasks only)
**Date:** 2026-05-18 (pre-emptive split; original stress 2026-05-17)
**Reviewer:** orchestrator inline (carve-out)

### Critical (must fix in impl)

- **C1 — Placeholder sentinel must be UNIQUE.** Original Plan 05 Task 2 had checker logic that grepped for literal "paste the terminal log here" strings. If Santiago fills in a real log that happens to mention "paste" in a path or command output, the checker would (incorrectly) reject it. **Fix:** Use `<!-- TODO: paste evidence -->` HTML comment which is never produced by tools. Task 1 uses this exact sentinel in every evidence block; 05b's checker greps for this exact string. Task 1 verify command counts ≥10 sentinel occurrences (one per block).
- **C2 — security-analyze-sample.txt regex precision.** 05b's `--strict` mode parses `/Overall exposure level [^:]*:\s*(\d+\.\d+)\s+(UNSAFE|EXPOSED|MEDIUM|OK|SAFE)/m`. The multiline flag matters: the line may be preceded by a `→` glyph. Task 3 fixture preserves the `→` prefix as in real `systemd-analyze` output. If the regex fails to match the fixture, 05b's test 3 fails (signals regex drift before production capture).

### Important (forward to impl, don't block)

- **I1 — `systemd-analyze security` exposure-score semantics.** Spec § 1 verification says "exposure level ≤2.0". The score is `0.0 ↔ 10.0` where LOWER is BETTER. The line format: `→ Overall exposure level for iago-os-v2-daemon.service: 2.0 OK 😀`. Task 3 fixture matches this exactly; Task 1 PHASE-2-EVIDENCE.md block (h) documents the ≤2.0 threshold.
- **I2 — Fixture `expected-events.json` heartbeat-tick frequency.** 1440 events/day is too many to enumerate. Task 2 uses `expected_count_per_24h: 1440` field; 05b's test assertion uses a 95%-floor (1368 events) so brief downtime doesn't fail the check.
- **I3 — Filled evidence may exceed GitHub PR description char limit.** GitHub PR description cap is 65536 chars. Real terminal logs can be 10KB+ each; Phase 2 needs 2 such logs + a screenshot URL + various excerpts. Likely fine but worth checking. Task 1 § 7 (size guidance) instructs Santiago to attach large logs as files or gists if total exceeds 50 KB.
- **I4 — Sentinel-only check vs content-check.** 05b's checker confirms sentinels are REPLACED (count = 0 after fill). It does NOT confirm the replacement content is meaningful. That's intentional — content review is the human PR reviewer's job; the checker enforces the structural template.

### Minor

- **M1 — Why no staging VPS? footer (Task 1 § 8)** — links to 02-cutover-decisions.md § 6. Helps a future reviewer understand the test path without re-asking.
- **M2 — fixtures/ directory creation.** New top-level subdir under `runtime/integration/`. No conflict; matches existing pattern (`runtime/integration/hello-world.test.ts` etc.).

### Dimension-by-dimension verdicts (05a scope)

- **Precision:** Each task has line-count + content-keyword greps + JSON parse validation where applicable. Sentinel count is exact (≥10 in template).
- **Edge cases:** C1 (sentinel uniqueness) + C2 (regex precision) cover the checker-template coupling failures.
- **Contradictions:** Cross-references to 03b (cutover-decisions.md), 04b (pr-triage README + telemetry), 06 (SIGHUP) all anchored in template. depends_on chain ensures those plans land first.
- **Simpler alternatives:** Could skip the security-analyze fixture and have 05b's test capture against real VPS output. REJECTED — pipeline can't reach VPS; fixture-based regex test is the only path that runs in CI/local-dev.
- **Missing acceptance criteria:** Task 1 template carries all 8 spec § 10 criteria as evidence blocks; Task 2 fixture enumerates the telemetry shape (criterion 5).

### Implementer forward-list

1. Sentinel `<!-- TODO: paste evidence -->` in every evidence block of PHASE-2-EVIDENCE.md (C1 fix).
2. security-analyze-sample.txt preserves `→` prefix on the exposure-level line (C2 fix).
3. expected-events.json uses `expected_count_per_24h` field (I2 fix; 05b uses 95% floor).
4. PHASE-2-EVIDENCE.md § 7 documents the 50 KB attach-as-file guidance (I3 fix).
5. PHASE-2-EVIDENCE.md § 8 links to 02-cutover-decisions.md § 6 (M1).
