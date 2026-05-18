---
phase: feature-phase-2-vps-bootstrap
plan: 03b
wave: 2
depends_on: [03a]
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-18
source: feature
split_from: 03-cutover-rollback-orchestration
split_rationale: Pre-emptive split per .iago/decisions/2026-05-18-phase-2-split-and-dispatch.md. 03b ships the human-readable runbooks and locked-decisions log (Tasks 3, 4, 5 of original 03) — the operator-facing documents that wrap 03a's executables. Depends on 03a (runbooks reference cutover.sh + rollback.sh by name).
---

# Plan: feature-phase-2-vps-bootstrap/03b-cutover-rollback-runbooks

## Goal

Ship the operator-facing documentation that turns 03a's executable scripts into a runnable cutover for Santiago. Three deliverables: (1) `02-cutover-runbook.md` — verbatim copy of spec § 8 T-15 → T+60 sequence with formatting preserved AND the Day -1 prep checklist that creates every condition the cutover.sh pre-flight gate checks; (2) `02-rollback-runbook.md` — verbatim copy of spec § 9 ≤4-min rollback (detection triggers, automated watchdog snippet, state preservation, post-rollback actions); (3) `02-cutover-decisions.md` — locked-decisions log capturing LanceDB drop, User=iago, Telegram Option A, FAST cutover, no staging VPS, Anthropic provisioned-not-activated, WhatsApp deauth at cutover — each section with a "Reversibility" line stating what would need to be true to revisit. Source of truth: `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` §§ 8, 9, and § 6 (LanceDB) / § 1 (User=iago) / § 3 (Telegram) / § 7 (WhatsApp).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/migration/02-cutover-runbook.md` | Human-readable runbook (copy of spec § 8) + Day -1 prep checklist |
| create | `runtime/migration/02-rollback-runbook.md` | Human-readable runbook (copy of spec § 9) |
| create | `runtime/migration/02-cutover-decisions.md` | Decision log: LanceDB drop / User=iago / Telegram Option A / FAST cutover / no staging VPS / Anthropic provisioned-not-activated / WhatsApp deauth |

## Tasks

### Task 1: Author 02-cutover-runbook.md

- **files:** `runtime/migration/02-cutover-runbook.md`
- **action:** **PATH TRANSLATION (Codex P0-2 fix):** All `bash /opt/iago-os/scripts/vps-bootstrap/<name>.sh` commands in spec § 8 translate to `bash /opt/iago-os/runtime/deploy/<name>.sh` per CONTEXT.md path-translation constraint. The runbook ships the TRANSLATED commands verbatim, NOT the spec's original commands. Specifically: spec line 1095-1096 `bash /opt/iago-os/scripts/vps-bootstrap/archive-openclaw.sh` becomes `bash /opt/iago-os/runtime/deploy/archive-openclaw.sh`; same applies to every `scripts/vps-bootstrap/` reference in spec § 8. Human-readable runbook copying spec § 8 verbatim (with path translation applied throughout). Sections: (1) Owner — "Santiago"; (2) Wall-clock target — 60 minutes; **(3a) Day -1: Pre-cutover prep (T-24h)** — pre-merge adversarial review I6 fix; lists exact commands to create every condition the cutover.sh pre-flight gate checks. Items, each its own `- [ ]` checkbox with the exact command + verify command: (i) Create state + log directories on VPS: `tailscale ssh root@srv1456441 -- 'mkdir -p /var/lib/iago-os/daemon-state /var/log/iago-os && chown iago:iago /var/lib/iago-os/daemon-state /var/log/iago-os && chmod 0700 /var/lib/iago-os/daemon-state'` ; verify: `tailscale ssh root@srv1456441 -- 'stat -c "%U:%G %a" /var/lib/iago-os/daemon-state'` → expect `iago:iago 700`. (ii) Create `iago` system user (skip if already exists): `if ! tailscale ssh root@srv1456441 -- 'getent passwd iago > /dev/null 2>&1'; then tailscale ssh root@srv1456441 -- 'useradd --system --no-create-home --shell /usr/sbin/nologin iago'; fi` ; verify: `tailscale ssh root@srv1456441 -- 'getent passwd iago'` → returns iago line. (iii) Upload age pubkey: `scp ~/.age/santiago.pub root@srv1456441:/etc/iago-os/santiago-age.pub && tailscale ssh root@srv1456441 -- 'chmod 0644 /etc/iago-os/santiago-age.pub'` ; verify: `tailscale ssh root@srv1456441 -- 'test -f /etc/iago-os/santiago-age.pub && wc -c /etc/iago-os/santiago-age.pub'` → returns positive byte count. (iv) Confirm 1Password items exist for ALL Phase 2 credentials: `op item list --vault iago-os | grep -E 'v2-'` → expect `v2-daemon-telegram-bot`, `v2-gh-token`, `v2-anthropic-default`, `v2-anthropic-ilsantino`, `v2-anthropic-iaguito` (5 items). The `v2-gh-token` item MUST be a GitHub classic PAT scoped to `repo + read:org` (Plan 04 wake-check requires `read:org`) with 90-day expiry (regenerate quarterly via `provision-credentials.sh gh-token`). If any missing, create + paste value before proceeding. (v) Provision Phase 2 active credentials onto VPS: `runtime/deploy/provision-credentials.sh telegram-token gh-token` (01a artifact) ; verify: `tailscale ssh root@srv1456441 -- 'ls -la /etc/credstore.encrypted/'` → shows `iago-telegram-token.cred` + `iago-gh-token.cred` with `0600 root:root`. (vi) Re-verify OpenClaw cron inventory (07b artifact): `tailscale ssh ilsantino@srv1456441 -- 'crontab -l 2>&1 | grep -v "no crontab" | head'` + `tailscale ssh root@srv1456441 -- 'systemctl --user --machine=ilsantino@.host list-timers --all --no-pager | grep -iE "openclaw|claw" | head'` → expect empty output (matches `runtime/migration/openclaw-cron-inventory.json`). If non-empty, UPDATE the inventory file with the entries + commit BEFORE proceeding. (vii) Confirm git checkout has `.git`: `tailscale ssh root@srv1456441 -- 'test -d /opt/iago-os/.git'`. (viii) **SIGHUP reload verification (Plan 06 cross-ref):** confirm SIGHUP handler ships in daemon by `tailscale ssh root@srv1456441 -- 'systemd-analyze cat-config iago-os-v2-daemon.service | grep -E "KillSignal=SIGTERM"'` (cat-config validates final unit; KillSignal=SIGTERM is unchanged from Plan 01a; SIGHUP handler is in the Node process, not the systemd unit). (ix) Export Santiago's Telegram user ID in the cutover shell before running cutover.sh: `export IAGO_TELEGRAM_USER_ID=<your numeric Telegram user ID>` ; verify: `echo $IAGO_TELEGRAM_USER_ID` → numeric (e.g., `123456789`); if forgotten, send any message to @userinfobot in Telegram to retrieve. Each step has its own checkbox + verify command; together they create every condition the cutover.sh pre-flight gate checks. **(3) Pre-cutover gate** — exact 12-checkbox list from spec § 8 with checkboxes `- [ ]` ready for Santiago to tick (these are the GATE checks; § 3a above is the PREP that creates the conditions the gate checks); (4) Cutover sequence — copy the T-15 → T+60 block from spec § 8 verbatim with formatting preserved (code blocks for verify commands, ROLLBACK TRIGGER warnings inline); (5) Verification command summary — spec § 8 final block (the `tailscale ssh ... -- 'systemctl is-active + ls agents + tail telemetry + journalctl heartbeat'` block); (6) Post-cutover required actions — Obsidian session digest path + STATE.md update + 30-min stay-at-keyboard monitoring; INCLUDE the SIGHUP-reload-path checkbox per Plan 06 Task 4: `- [ ] Confirm SIGHUP reload path works: rotate a benign credential (or simulate by re-running provision-credentials.sh) + tailscale ssh root@srv1456441 -- 'systemctl kill -s SIGHUP iago-os-v2-daemon.service' + journalctl ... | grep cred-reload-fired. Documented in runtime/daemon/README.md § Reloading credentials without restart (SIGHUP).`; (7) Failure escalation — when in doubt, invoke rollback.sh (see 02-rollback-runbook.md); when rollback also fails, escalate to Sebas via Signal/phone call; (8) Reference to `cutover.sh` — "The executable in runtime/deploy/cutover.sh (03a artifact) automates the deterministic parts. Manual steps (BotFather UI, Telegram phone testing, WhatsApp deauth click-path) remain operator-driven and are clearly marked in the script with MANUAL prompts." (9) Coupling note (M2 carry-over) — "This runbook and `runtime/deploy/cutover.sh` (03a) both derive from spec § 8. Any future spec amendment MUST update both files together; drift between runbook commands and script behavior is a deployment hazard." File 400-600 lines (was 350-550; the Day -1 prep section + SIGHUP cross-ref + cron inventory re-verify + coupling note add 50-100 lines).
- **verify:** `wc -l runtime/migration/02-cutover-runbook.md && grep -c "^## \|^### " runtime/migration/02-cutover-runbook.md && grep -c "T+\|T-\|T-24h" runtime/migration/02-cutover-runbook.md && grep -c "Day -1" runtime/migration/02-cutover-runbook.md && grep -F 'v2-gh-token' runtime/migration/02-cutover-runbook.md && grep -F 'cred-reload-fired' runtime/migration/02-cutover-runbook.md && grep -F 'openclaw-cron-inventory.json' runtime/migration/02-cutover-runbook.md`
- **expected:** Line count 400-600. ≥10 section/sub-section headings. ≥18 T-time references. ≥1 "Day -1" reference. The `v2-gh-token`, `cred-reload-fired`, and `openclaw-cron-inventory.json` cross-references all present (each one match minimum — Plan 04b, Plan 06, Plan 07b respectively).

### Task 2: Author 02-rollback-runbook.md

- **files:** `runtime/migration/02-rollback-runbook.md`
- **action:** Human-readable runbook copying spec § 9 verbatim. Sections: (1) Detection — the 6-row trigger table from spec § 9; (2) Automated watchdog snippet — spec § 9 `while true` loop; (3) Rollback steps — the T+R+0:00 → T+R+5:00 block verbatim; (4) State preservation — spec § 9 "Keep /var/lib/iago-os/daemon-state intact" justification; (5) Target wall clock table — spec § 9 5-row table; (6) Post-rollback required actions — incident note path, STATE.md update, Sebas notification, do-NOT-retry-today guidance; (7) Reference to `rollback.sh` (03a artifact) — automation note; emphasize: `rollback.sh` automates the deterministic steps but the BotFather re-revoke (step T+R+1:30) is manual + interactive; operator MUST have BotFather UI open before triggering rollback to compress that step. File 150-280 lines.
- **verify:** `wc -l runtime/migration/02-rollback-runbook.md && grep -c "T+R\|trigger" runtime/migration/02-rollback-runbook.md`
- **expected:** Line count 150-280. ≥10 T+R references + trigger keyword.

### Task 3: Author 02-cutover-decisions.md

- **files:** `runtime/migration/02-cutover-decisions.md`
- **action:** Decision log per spec § 6 final paragraph ("Phase 2 PR contains a section documenting this verdict + the 72 KiB fact about archive contents"). Sections: (1) Purpose — "Locked decisions made for Phase 2 cutover. Re-litigating these without new evidence wastes cycles. New evidence = explicit ADR overriding."; (2) LanceDB drop — copy spec § 6 verdict table (a/b/c) + the action sentence ("the 72 KiB of LanceDB data is preserved inside the encrypted OpenClaw archive; no active migration") + the "post-Phase 2 housekeeping" path; (3) User=iago system user — copy spec § 1 verdict table + provisioning command (`useradd --system ...`); (4) Telegram Option A (rotate, don't replace) — copy spec § 3 verdict table; (5) FAST cutover (not "alongside OpenClaw" parallel-run) — Santiago override 2026-05-16 paragraph; (6) **No staging VPS — Santiago override** (I3 carry-over) — Santiago override of spec § 10 criterion 3 staging recommendation. Rationale: spec proposed $9/mo staging KVM; Santiago opted for local dry-run via test-cutover.mjs (03a Task 3). Trade-off: $9/mo + ~1-week-of-spinup-overhead for a real staging KVM vs ~5 min CI for the harness that stubs every external command + tests exact invocation order + failure paths. Risk: the harness can't catch a production-only issue (e.g., a Tailscale ACL difference between Santiago's home network and the VPS). Mitigation: cutover.sh pre-flight gate (Plan 03a Task 1) has 12 real-VPS checks AND the 30-min stay-at-keyboard monitoring window catches most surprises in flight; (7) Anthropic profiles provisioned-not-activated — spec § 5 paragraph (the `authProfile` schema slot from 01b Task 3 is Phase 2; the claude-pty adapter wiring is Phase 3); (8) WhatsApp deauth at cutover — Santiago decision 2026-05-13 paragraph (WhatsApp inbound stops at T+30; not undone on rollback per 02b runbook section 7). Each section ends with a "Reversibility" line stating what would need to be true to revisit. File 220-360 lines.
- **verify:** `wc -l runtime/migration/02-cutover-decisions.md && grep -c "^## \|^### " runtime/migration/02-cutover-decisions.md && grep -c -i "verdict\|locked\|reversibility" runtime/migration/02-cutover-decisions.md && grep -F 'test-cutover.mjs' runtime/migration/02-cutover-decisions.md`
- **expected:** Line count 220-360. ≥8 sections. ≥10 verdict/locked/reversibility references. `test-cutover.mjs` named in the "no staging VPS" section (I3 closure).

## Verification

```bash
wc -l runtime/migration/02-cutover-runbook.md \
       runtime/migration/02-rollback-runbook.md \
       runtime/migration/02-cutover-decisions.md
grep -F 'v2-gh-token\|cred-reload-fired\|openclaw-cron-inventory.json' runtime/migration/02-cutover-runbook.md
grep -F 'test-cutover.mjs' runtime/migration/02-cutover-decisions.md
```

Expected:
- Cutover runbook 400-600 lines; rollback runbook 150-280; decisions 220-360
- All three cross-references present in cutover-runbook (Plan 04b gh-token + Plan 06 SIGHUP + Plan 07b inventory)
- `test-cutover.mjs` named in decisions doc (no-staging-VPS section)

## Stress Test

**Verdict:** PROCEED (carried forward from original Plan 03 stress test, scoped to 03b tasks only)
**Date:** 2026-05-18 (pre-emptive split)
**Reviewer:** orchestrator inline (carve-out)

### Critical (must fix in impl)

- **C1 — Path translation discipline.** Spec § 8 uses historical `/opt/iago-os/scripts/vps-bootstrap/` path; 03b runbook MUST translate to `/opt/iago-os/runtime/deploy/` (canonical Gen 2 layout). Cross-reference: Plan 03a Task 1 cutover.sh uses the translated path. If runbook and script disagree, the operator copy-pastes the wrong path and the cutover fails. Task 1 verify command checks for translated path presence; orchestrator should grep for the spec's historical path AND fail the build if found in the runbook.
- **C2 — Cross-references to 04b (gh-token), 06 (SIGHUP), 07b (cron inventory) MUST be present.** Plan 04b Task 2 + Plan 06 Task 4 + Plan 07b verify command all assume the cutover-runbook contains specific strings (`v2-gh-token`, `cred-reload-fired`, `openclaw-cron-inventory.json`). If 03b lands first and ships without these, subsequent plans' verify commands fail at the build gate. Task 1 verify command checks all three.

### Important (forward to impl, don't block)

- **I1 — Coupling between runbook + cutover.sh.** Runbook commands and cutover.sh behavior must agree. Task 1 § 9 (coupling note) documents this. Pre-PR review on any plan touching spec § 8 should grep both files and assert content alignment.
- **I2 — Decisions doc reversibility lines.** Task 3 every section ends with a "Reversibility" line. Pre-PR review can grep for `## ` + `Reversibility` pairs to ensure 1:1.
- **I3 — Day -1 prep checklist scope creep.** Section 3a in Task 1 is 100-150 lines. Each item must be a real, executed-by-Santiago step at T-24h. Items that are infrastructure-once (e.g., create iago user) are gated by `if ! getent passwd iago` so re-runs are idempotent.

### Minor

- M1 — Decisions doc could grow into a Phase 2 changelog. Out of scope; this is the spec-§-6 + Santiago-override capture, not a running log. Phase 3 may introduce a separate Phase 3 decisions doc.
- M2 — Rollback runbook is mostly verbatim spec § 9. Resist the urge to summarize — spec is the canonical source; runbook is the operator-facing copy.

### Dimension-by-dimension verdicts (03b scope)

- **Precision:** Each runbook has line-count + heading-count + content-keyword greps. Cross-references to 04b/06/07b checked explicitly.
- **Edge cases:** C1 (path translation) + C2 (cross-ref strings) cover the inter-plan coupling failures.
- **Contradictions:** 03b runbooks reference 03a scripts by name. depends_on chain enforces 03a lands first. No code duplication; runbooks are docs.
- **Simpler alternatives:** Could collapse runbooks into a single "phase-2-cutover.md" file. REJECTED — spec § 8 + § 9 are distinct concerns (forward operation vs reverse); separate files match operator mental model (open the right one in a crisis).
- **Missing acceptance criteria:** Spec § 4 (documentation criterion) covered. PR description block (d) in PHASE-2-EVIDENCE.md (05a) cites these runbooks.

### Implementer forward-list

1. Path translation: spec `scripts/vps-bootstrap/` → `runtime/deploy/` everywhere in runbook (C1 fix).
2. Cross-references to 04b (gh-token), 06 (cred-reload-fired), 07b (openclaw-cron-inventory.json) present in cutover-runbook (C2 fix).
3. `test-cutover.mjs` named in decisions doc § 6 (I3 carry-over from original Plan 03).
4. Coupling note in cutover-runbook § 9 (M2 carry-over).
