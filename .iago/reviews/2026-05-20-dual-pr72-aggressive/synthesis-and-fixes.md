# Dual Adversarial Review Synthesis — PR #72 (Plan 03b cutover/rollback runbooks)

**Date:** 2026-05-20
**Cutover target:** Sunday 2026-05-25 20:00 US/Mexico (5 days out)
**Two independent reviewers, neither saw the other's output:**

| Reviewer | Model | Findings | Verdict |
|---|---|---|---|
| Codex | GPT-5.5 via codex-companion adversarial-review --background | 3 high + 1 medium | needs-attention |
| Opus subagent | Claude Opus 4.7 via Agent tool, skeleton-first persistence pattern | 3 Critical + 5 High + 8 Important + 5 Medium + 1 Minor (24 total) | **BLOCK** |

**Consolidated verdict: BLOCK until at minimum the 3 Critical and 5 High are resolved.**

The async @claude loop has run 2 fix rounds (commits `a287ea9` + `3a475e5`). It caught the Codex-and-Opus-overlap findings (token-leak heredoc rewrite, T+05 path, Day -1 reorder, WhatsApp gate warning, watchdog ssh-error fallback). It missed every Opus-specific structural finding.

## Findings status (post Round 1 + Round 2 fix pushes)

### CRITICAL

| ID | Title | Status | Source |
|---|---|---|---|
| C1a | Rollback heredoc token leak via unquoted local expansion | ✅ ADDRESSED Round 1 (SendEnv + read -rs) | Codex#1 + Opus C1 |
| C1b | Rollback jq filter `\$t` is broken jq syntax (parses as invalid expression) | ❌ **OPEN** — Round 1 fixed leak but kept the broken `\\\$t` escape | Opus C1 |
| C2 | T+05 provisions only `telegram-token`, shipped `cutover.sh:461` provisions `telegram-token gh-token` | ❌ **OPEN** — Round 1 fixed the path (`/opt/...` → repo-relative) but did NOT add gh-token. Line 273. | Opus C2 |
| C3 | T+15 canonical workflow test uses raw JSON file-drop with unverified schema; shipped script uses 5-step IPC | ❌ **OPEN** — not touched by R1/R2. Lines 305-316. | Opus C3 |

### HIGH

| ID | Title | Status | Source |
|---|---|---|---|
| H1 | WhatsApp deauth at T+30 has no rollback path — irreversible mid-cutover | ⚠️ PARTIAL — Round 1 added a "one-way gate" warning at T+30 but did NOT move the deauth out of the rollback-covered window per Codex recommendation | Codex#2 |
| H2 | Rollback runbook says "rollback before T+05 skip token re-rotate" but cutover revokes at T+02 — internal contradiction; "before T+05" case is unreachable | ❌ **OPEN** — boundaries still wrong. Lines 84-91. | Opus H1 |
| H3 | Day -1 step (i)/(ii) missing creation of `tasks/pending/`, `tasks/resolved/`, `markers/`, `telemetry/`, `agents/` subdirs that T+15 + telemetry writes to | ❌ **OPEN** — only top-level dirs created | Opus H2 |
| H4 | Day -1 git clone/checkout/build sequence unspecified — pre-flight gate asserts code exists at `/opt/iago-os` but no Day -1 command creates it | ❌ **OPEN** — no SHA pin, no `git clone + npm ci + build` step | Opus H3 |
| H5 | Telegram approval gate timeout/distraction state undocumented — operator doesn't know what to do if approval arrives but isn't tapped within 5 min | ❌ **OPEN** — no mental-timer guidance | Opus H4 |
| H6 | Day -1 step (viii) SIGHUP verification greps the systemd unit for KillSignal=SIGTERM — does NOT verify the SIGHUP handler is wired in daemon binary | ❌ **OPEN** — Plan 06 dependency unverified | Opus H5 |
| H7 | T+05 verification command prints first 10 chars of decrypted Telegram token — partial-token disclosure even if bot-ID prefix is public | ✅ ADDRESSED Round 1 (`head -c 10` → `wc -c` with pipefail) | Codex#3 + Opus I-token-print |

### IMPORTANT

| ID | Title | Status | Source |
|---|---|---|---|
| I1 | Telegram approval message format/buttons/recognition undocumented | ❌ **OPEN** | Opus |
| I2 | Watchdog `2>/dev/null` swallows ssh errors → false-positive rollback trigger when Tailscale blips | ⚠️ PARTIAL — Round 1 changed `2>/dev/null` → `2>&1` with ssh-error fallback per Min-1; verify still distinguishes "ssh failed" from "daemon down" | Opus |
| I3 | Day -1 log dir comment "matches cutover.sh pre-flight gate" — cutover.sh actually doesn't verify the dir mode | ❌ **OPEN** — misleading comment-as-claim | Opus |
| I4 | T+45 inspects `daemon-state/telemetry/<date>.ndjson` — should ALSO inspect `/var/log/iago-os/cutover.ndjson` (the cutover.sh progress log) | ❌ **OPEN** | Opus |
| I5 | Decisions log § 7 claims "TPM/host-key combo" — Hostinger KVM 2 typically has no vTPM; systemd-creds will fall back to host-key only | ❌ **OPEN** | Opus |
| I6 | Race window during rollback stop — no `lsof`/`fuser` check that daemon has flushed before declaring inactive | ❌ **OPEN** | Opus |
| I7 | Rollback runbook never names the `IAGO_ROLLBACK_SKIP_TOKEN=1` flag operators need under pre-T+02 rollback (drift from `rollback.sh:290-302`) | ❌ **OPEN** | Opus |

### MEDIUM

| ID | Title | Status |
|---|---|---|
| M1 | Day -1 tasks/markers/telemetry/agents subdir contract unclear (related to H3) | ❌ OPEN |
| M2 | T+15 heredoc uses `<<EOF` not `<<'EOF'` — accidental $-expansion if JSON ever contains `$` | ❌ OPEN |
| M3 | Rollback wall-clock budget table sums to 4:00 with no operator-dwell budget — realistic ceiling is 4:30-5:00 | ❌ OPEN |
| M4 | Decisions log § 5 framing about spec amendment is ambiguous (vision-spec vs phase-2-bootstrap-spec) | ❌ OPEN |
| M-codex | Day -1 chowns to iago user before iago user is created | ✅ ADDRESSED Round 1 (reordered i → user creation, ii → dirs) |

### MINOR

| ID | Title | Status |
|---|---|---|
| Min1 | "Plan 04 wake-check" terminology undefined in runbook | ❌ OPEN |

## Recommended fix priority for Round 3+

**Tier 1 (blocks merge — must fix):**

1. **C2** — Add `gh-token` to T+05 provision command line 273: `bash runtime/deploy/provision-credentials.sh telegram-token gh-token` + extend verify to decrypt both creds.
2. **C3** — Replace T+15 lines 305-316 raw JSON file-drop with the shipped script's 5-step IPC sequence (`/agents`, `/start hello-world`, `/sessions`, send text, `/stop <session-id>` per `cutover.sh:619-626`).
3. **C1b** — Fix jq filter syntax on rollback-runbook line 106. Either use single-quoted heredoc `<<'EOF'` with no escaping, OR keep the SendEnv pattern but write the jq filter inside a real script file (mirror `rollback.sh:319-357`'s `remote_patch` pattern) so quoting layers don't compound. The current `\\\$t` does NOT parse correctly under jq.
4. **H2** — Change "rollback before T+05" → "rollback before T+02" everywhere in rollback-runbook lines 84-91. Better: delete the conditional entirely and instruct "always re-rotate" per Opus's suggestion.
5. **H1** — Either move WhatsApp deauth out of rollback-covered cutover (do it Day +1), OR explicitly mark T+30 as a separate irreversible migration with its own acceptance gate (not part of the 4-min-rollback-covered window).

**Tier 2 (must fix — high but not blocking):**

6. **H3** — Day -1 step (i) explicit `mkdir -p /var/lib/iago-os/daemon-state/{tasks/pending,tasks/resolved,markers,telemetry,agents}`.
7. **H4** — Day -1 add explicit `git clone + checkout <SHA> + npm ci + npm run build` step with pinned SHA.
8. **H5** — Add T+15 mental-timer guidance for approval gate (60s arrival, 5-min tap window).
9. **H6** — Replace SIGHUP cat-config grep with direct daemon-binary grep: `grep -lE "process\\.on\\(.SIGHUP" /opt/iago-os/runtime/daemon/main.ts` or against the dist build.

**Tier 3 (should fix — important):**

10. I1, I3, I4, I5, I6, I7 — see table above.

**Tier 4 (nice-to-have):** M1-M4, Min1.

## Audit trail

- `pr72-diff.patch` — diff snapshot at review-time (49 KB)
- `codex-aggressive.md` — Codex GPT-5.5 full review (3 high + 1 medium)
- `opus-aggressive.md` — Opus 4.7 full review (24 findings, 507 lines)
- `synthesis-and-fixes.md` — this file
- Round 1 fix commit: `a287ea9` (claude[bot] sonnet, 72 insertions / 46 deletions)
- Round 2 fix commit: `3a475e5` (claude[bot] sonnet, 3 insertions / 3 deletions — stale ref cleanup)
- Round 3 review: started 17:08:28 UTC

## Independence verification

- Opus subagent did NOT read codex-aggressive.md, the pipeline log session file, or any PR comments
- Codex review ran via codex-companion against branch diff before any Opus dispatch
- Each reviewer independently identified the rollback heredoc + T+05 path issues — convergent validation
- 20+ Opus-specific findings did NOT appear in Codex output — true independence
- 1 Codex-specific finding (WhatsApp irreversibility structure) did NOT appear in Opus output — true independence
