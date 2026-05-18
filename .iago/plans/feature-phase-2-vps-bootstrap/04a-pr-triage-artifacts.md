---
phase: feature-phase-2-vps-bootstrap
plan: 04a
wave: 2
depends_on: [01a, 01b]
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-18
source: feature
split_from: 04-pr-triage-agent
split_rationale: Pre-emptive split per .iago/decisions/2026-05-18-phase-2-split-and-dispatch.md. 04a ships the PR-triage agent's configuration artifacts (Tasks 1, 2, 3, 4 of original 04) — agent-config + crons + prompt template + wake-check script. 04b ships the README, cross-plan verifications, daemon wiring, and integration test (Tasks 5, 6, 7, 8). Depends on 01a (systemd unit envs) + 01b (cred-bootstrap GH_TOKEN load).
---

# Plan: feature-phase-2-vps-bootstrap/04a-pr-triage-artifacts

## Goal

Ship the first-real-workflow agent artifacts that prove Phase 2 daemon is more than science-fair scaffolding: the PR-triage agent's configuration files, prompt template, and Hermes wake-check script. The agent runs on the VPS daily at 14:00 UTC (09:00 EST), uses Shape 1 PTY adapter (claude-pty from Phase 1), queries `gh pr list` across iago-os org repos, classifies each PR as `waiting_claude` / `waiting_santiago` / `merge_ready` / `stuck`, and POSTs a single Telegram summary message to Santiago via direct curl to the Telegram sendMessage endpoint. Four deliverables: (1) `agent-config.json` (AgentConfig with `agentId: "pr-triage"`, `runtimeId: "claude-pty"`, `authProfile: "default"`, `autoStart: false`); (2) `crons.json` (cron schedule + wake-check path + prompt template path + `maxConcurrent: 1`); (3) `prompt-template.md` (the markdown the daemon pipes to claude-pty stdin); (4) `wake-check.sh` (Hermes pattern: count open PRs via `gh api /search/issues`; exit 0 if work exists, 1 if none). Source of truth: `.iago/research/2026-05-16-v2-operational-migration-scope.md` § 1. The README, verifications, daemon wire-up, and integration test ship in 04b.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/agents/pr-triage/agent-config.json` | AgentConfig JSON (agentId, runtime=claude-pty, shape=pty, authProfile=default) |
| create | `runtime/agents/pr-triage/crons.json` | Cron schedule + wake-check + prompt template path + maxConcurrent |
| create | `runtime/agents/pr-triage/prompt-template.md` | Template for the daemon to pass to claude-pty stdin |
| create | `runtime/agents/pr-triage/wake-check.sh` | Hermes wake-check: `gh pr list` count; exit 0 if PRs exist, 1 if zero |

## Tasks

### Task 1: Author agent-config.json

- **files:** `runtime/agents/pr-triage/agent-config.json`
- **action:** Write the AgentConfig JSON per the migration-scope § 1 "Concrete contract" + the schema from Plan 01b Task 3: `{ "agentId": "pr-triage", "runtimeId": "claude-pty", "org": "internal", "cwd": "/opt/iago-os", "env": {}, "autoStart": false, "authProfile": "default" }`. NOTE on `GH_TOKEN`: GH_TOKEN is inherited from daemon's `process.env` (cred-bootstrap from 01b Task 1 loads it per CREDENTIALS array entry `{ fileName: "iago-gh-token", envVar: "GH_TOKEN" }`; the spawned child inherits parent env by default). The `${CRED:<name>}` placeholder syntax is NOT implemented in Phase 1's config loader; using process-env inheritance instead avoids inventing new config substitution semantics. 04b Task 1 verifies (read-only) that `iago-gh-token` is in 01a CRED_MAP + 01b cred-bootstrap CREDENTIALS array. Use `authProfile: "default"` (the only profile usable in Phase 2 per CONTEXT.md constraint "Anthropic profiles PROVISION at Phase 2, ACTIVATE at Phase 3" — `default` is the safe choice; 01b Task 3 documents the `undefined` ≡ `"default"` equivalence). `autoStart: false` because this agent is cron-driven, not always-on. `cwd: "/opt/iago-os"` lets `gh` operate on the iago-os repo from a working directory that has `.git` (Plan 03b Day -1 prep verifies this). File 15-30 lines.
- **verify:** `cat runtime/agents/pr-triage/agent-config.json | jq . > /dev/null && jq -r '.agentId, .runtimeId, .authProfile, .autoStart' runtime/agents/pr-triage/agent-config.json`
- **expected:** Valid JSON. Output lines: `pr-triage`, `claude-pty`, `default`, `false`.

### Task 2: Author crons.json

- **files:** `runtime/agents/pr-triage/crons.json`
- **action:** Cron entry per migration-scope § 1 contract + § 4 schema: `{ "schedule": "0 14 * * *", "wakeCheck": "runtime/agents/pr-triage/wake-check.sh", "prompt": "runtime/agents/pr-triage/prompt-template.md", "outputTaskNamePrefix": "pr-triage", "maxConcurrent": 1 }`. The `maxConcurrent: 1` field (Codex P1-8 fix — carried from migration-scope § 4 schema at line 533-537) prevents overlapping runs: if a previous pr-triage invocation is still mid-flight when the next 14:00 UTC tick fires, scheduler emits `cron-overlap-prevented` telemetry and SKIPS the spawn (per 07a Task 1 overlap check). Document the schedule reasoning in a top-of-file `_comment` field (JSON doesn't support comments natively, so use a `_comment` key the cron parser ignores): `"_comment": "14:00 UTC = 09:00 EST = 06:00 PST. Daily. Hermes wake-check runs first; if no open PRs, LLM call skipped (saves $0.10). maxConcurrent=1 prevents overlap if a slow run wedges past the next tick. systemd unit Environment=TZ=UTC (Plan 01a) locks tick interpretation regardless of VPS host timezone."`. The `outputTaskNamePrefix` lets the daemon synthesize task IDs as `pr-triage__<unix_timestamp>.json`. File 12-22 lines.
- **verify:** `cat runtime/agents/pr-triage/crons.json | jq . > /dev/null && jq -r '.schedule, .wakeCheck, .prompt, .maxConcurrent' runtime/agents/pr-triage/crons.json`
- **expected:** Valid JSON. Output: cron expression `0 14 * * *`, wake-check path, prompt template path, maxConcurrent integer `1`.

### Task 3: Author prompt-template.md

- **files:** `runtime/agents/pr-triage/prompt-template.md`
- **action:** The text the daemon pipes to claude-pty's stdin at trigger time. Plain markdown. Sections (no frontmatter — this is a prompt, not a doc): (1) Role — "You are the PR triage agent for the iago-os GitHub org. Your job: classify all open PRs across the org and produce a single Telegram-friendly summary."; (2) Tools available — `gh` CLI (with `$GH_TOKEN` env), `curl` for direct Telegram API calls, file write for fallback alerts only; (3) Algorithm — step by step: (a) run `gh pr list --owner ilsantino --state open --json number,title,url,author,reviewDecision,statusCheckRollup,createdAt,updatedAt --limit 50` → list all org-open PRs; if jq returns empty array, produce a one-line "No open PRs today" message and proceed to step (d). (b) For each PR: classify into one of 4 buckets: `merge_ready` (reviewDecision=APPROVED + all checks passing), `waiting_claude` (PR title or body mentions @claude OR has a `claude-review-requested` label AND review-decision != APPROVED), `waiting_santiago` (reviewDecision=APPROVED but author=ilsantino indicates Santiago should merge), `stuck` (no activity in 5+ days OR statusCheckRollup has failing checks); (c) Produce a markdown summary: `# PR Triage <YYYY-MM-DD HH:MM UTC>\n\nN open PRs across iago-os org\n\n## Merge Ready (n)\n- [#NN title](url) author\n\n## Waiting on Claude (n)\n- [#NN title](url) age:Xd\n\n## Waiting on Santiago (n)\n- ...\n\n## Stuck (n)\n- ...`; (d) POST the summary directly via curl to Telegram sendMessage endpoint. Use `$IAGO_TELEGRAM_BOT_TOKEN` (inherited from daemon process.env — cred-bootstrap loads it per 01b Task 1) + first ID from `$IAGO_TELEGRAM_ALLOWED_USER_IDS` (comma-separated; systemd Environment per 01a Task 1). Concrete invocation pattern: `FIRST_ID=$(echo "$IAGO_TELEGRAM_ALLOWED_USER_IDS" | cut -d, -f1); curl -sS -w "%{http_code}" -o /tmp/tg-resp.json --data-urlencode "chat_id=$FIRST_ID" --data-urlencode "text=$SUMMARY_MD" --data-urlencode "parse_mode=MarkdownV2" "https://api.telegram.org/bot${IAGO_TELEGRAM_BOT_TOKEN}/sendMessage"`. Capture HTTP status code; if non-200, write a fallback task file `tasks/pending/pr-triage__<unix>.json` with body `{ "ndjsonAlert": "pr-triage-telegram-send-failed", "details": "<http-status> <truncated-response-body>" }` so the daemon's polling loop (07b Task 1) emits a `pr-triage-telegram-send-failed` telemetry event for post-mortem; (4) Constraints — "Do NOT split into multiple Telegram messages. Single message only. Use Telegram-MarkdownV2 escaping for special chars (`_`, `*`, `[`, `]`, etc.) only if you detect them in PR titles. **Length cap (I4 carry-over from original Plan 04):** If the message exceeds 3800 chars, truncate the `stuck` section first (oldest PRs least likely actionable), then `merge_ready`, keeping `waiting_claude` + `waiting_santiago` intact. Append `\n_(N PRs truncated for length; see dashboard)_` to flag the truncation. NEVER echo `$IAGO_TELEGRAM_BOT_TOKEN` to stdout or to any file." (5) Errors — "If `gh pr list` fails (auth or rate-limit), POST a brief failure summary via the same curl pattern: `text=PR triage failed: <error>. Investigate.` instead of silently exiting. If THAT curl ALSO fails non-200, write the fallback task file with `ndjsonAlert: 'pr-triage-double-failure'`." (6) Termination — "After successful POST (or fallback task file write), exit cleanly. Do not poll for follow-up."  File 90-160 lines.
- **verify:** `wc -l runtime/agents/pr-triage/prompt-template.md && grep -c "merge_ready\|waiting_claude\|waiting_santiago\|stuck" runtime/agents/pr-triage/prompt-template.md`
- **expected:** Line count 90-160. ≥4 classification-bucket references (one per bucket).

### Task 4: Author wake-check.sh (Hermes pattern)

- **files:** `runtime/agents/pr-triage/wake-check.sh`
- **action:** Bash script that the daemon runs BEFORE invoking the LLM (Hermes wake-check pattern per `.iago/research/2026-05-13-multi-agent-cohabitation.md`). Shebang + `set -euo pipefail`. Loads `GH_TOKEN` from env (fail if absent — wake-check NEEDS the token to query gh). Header comment: "Returns exit 0 if there is work for pr-triage (≥1 open PR org-wide), exit 1 if there is none. Saves ~$0.10 per skipped LLM invocation. Exit 2 if rate-limited (distinct signal so cron-scheduler can emit a richer telemetry event — I2 carry-over from original Plan 04)." First line records the timezone for telemetry forensics (I1 carry-over): `echo "wake-check-tz $(date -u +%Z)" >&2`. Body: explicit HTTP status check (I2 carry-over — plain `--jq '.total_count'` on a non-200 response silently produces null + exit 0; defensive guard): `RESPONSE=$(gh api -i '/search/issues?q=org:ilsantino+is:pr+is:open&per_page=1' 2>&1); STATUS=$(echo "$RESPONSE" | head -1); if echo "$STATUS" | grep -qE 'HTTP/[12](\.[0-9])? 200'; then COUNT=$(echo "$RESPONSE" | tail -n +1 | grep -A 999 '^{' | jq -r '.total_count // 0'); else if echo "$RESPONSE" | grep -qiE 'rate.?limit'; then echo "Rate-limited: $STATUS" >&2; exit 2; fi; echo "ERROR: gh api returned non-200: $STATUS" >&2; exit 2; fi`. If `COUNT=0` or empty, exit 1 with stdout `"No open PRs; skipping LLM invocation."`. Else exit 0 with stdout `"Found $COUNT open PR(s); proceeding."`. Total ≤45 lines. Idempotent (read-only API call). The daemon's cron-scheduler runs this script; on exit 1, the LLM dispatch is skipped + a telemetry event `cron-skipped { agentId: "pr-triage", reason: "wake-check-failed", exitCode: 1 }` is emitted; on exit 2, telemetry kind is the same but `reason` is `"wake-check-rate-limited"`; on exit 0, the daemon proceeds to spawn claude-pty with the prompt.
- **verify:** `bash -n runtime/agents/pr-triage/wake-check.sh && shellcheck runtime/agents/pr-triage/wake-check.sh && wc -l runtime/agents/pr-triage/wake-check.sh && grep -E '(exit 2|rate.?limit)' runtime/agents/pr-triage/wake-check.sh`
- **expected:** `bash -n` exit 0. `shellcheck` exit 0. Line count 25-50. Rate-limit branch present (exit 2 + rate-limit string match).

## Verification

```bash
bash -n runtime/agents/pr-triage/wake-check.sh \
  && shellcheck runtime/agents/pr-triage/wake-check.sh \
  && jq . runtime/agents/pr-triage/agent-config.json > /dev/null \
  && jq . runtime/agents/pr-triage/crons.json > /dev/null \
  && wc -l runtime/agents/pr-triage/prompt-template.md
```

Expected:
- wake-check.sh syntax + shellcheck clean
- Both JSON config files parse
- prompt-template.md 90-160 lines

## Stress Test

**Verdict:** PROCEED (carried forward from original Plan 04 stress test, scoped to 04a tasks only)
**Date:** 2026-05-18 (pre-emptive split; original stress 2026-05-17)
**Reviewer:** orchestrator inline (carve-out)

### Critical (must fix in impl)

- **C1 — `gh` CLI auth scope.** `gh pr list --owner ilsantino --state open` works with a fine-grained PAT scoped to specific repos under ilsantino; or a classic PAT with `repo` scope (broader than needed). Task 3 prompt-template uses `gh api /search/issues?q=org:ilsantino...` (wake-check.sh same) which requires `read:org` if the org has SSO + private repos. **Fix:** EXACT scope set is "classic PAT with `repo` + `read:org` scopes" (simpler than fine-grained). Plan 01a CRED_MAP comment + Plan 04b README + Plan 03b Day -1 prep all document this. 04a artifacts inherit the contract — no edits needed here, but the dependency is real.
- **C2 — Hermes wake-check must NOT silently fall through on rate-limit.** If `gh api /search/issues` hits rate-limit (60/hr for unauthenticated, 5000/hr for authenticated — token presence should be fine), the call returns 403 with `X-RateLimit-Remaining: 0` header. Plain `--jq '.total_count'` on a non-200 response writes "null" to stdout AND exits 0 (jq silently produces null). **Fix:** Task 4 wake-check.sh checks the HTTP status code explicitly via `gh api -i` (response header included), greps for `HTTP/2 200`, and on non-200 either exits 2 (rate-limit detected) or fails loud. cron-scheduler (07a) emits richer telemetry distinguishing the two cases.

### Important (forward to impl, don't block)

- **I1 — Cron expression timezone.** Task 2 says `0 14 * * *` = 14:00 UTC. The VPS timezone is whatever Debian default is (likely UTC). Spec § 8 + Phase 0 audit don't explicitly state. **Fix:** Plan 01a Task 1 systemd unit sets `Environment=TZ=UTC` (Codex P2-2 fix). 04a wake-check.sh first line records `date -u +%Z` echo to stderr for forensics. Eliminates ambiguity; cost is one line.
- **I3 — `cwd: "/opt/iago-os"` may not have `.git`.** The deploy path on VPS is `/opt/iago-os` per Plan 01a systemd unit. But this is a fresh checkout via `git clone`; it DOES have `.git` after a clone. Plan 03b Day -1 prep verifies. pr-triage's `gh pr list --owner ilsantino` doesn't actually require git in cwd (queries the API directly), so this is a non-issue for pr-triage but worth confirming. 04b README documents the cwd-agnostic behavior.
- **I4 — Telegram message length cap.** Telegram messages are capped at 4096 chars. A summary of 50 PRs × ~80 chars/PR = 4000 chars — close to the cap. **Fix:** Task 3 prompt-template explicit length guidance: truncate `stuck` first, then `merge_ready`, keep `waiting_claude` + `waiting_santiago` intact. Append truncation flag.

### Minor

- M1 — `runtime/agents/pr-triage/` is a new top-level folder under runtime. Confirm pattern matches what other agent folders will look like (none exist yet — pr-triage is the first). Document in 04b README; future plans can `runtime/agents/README.md` if more agents land.
- M2 — Telegram message format MarkdownV2 vs HTML. Phase 1 bot.ts already picked one (Plan 06 in feature-v2-phase-1-daemon). Prompt-template should reference the actual choice — confirm in implementation by reading the existing bot.ts code.

### Dimension-by-dimension verdicts (04a scope)

- **Precision:** All 4 tasks have file paths + actions + verify + expected. JSON files validated via `jq .`; bash script via `bash -n` + `shellcheck`; markdown via wc + grep.
- **Edge cases:** C2 (rate-limit silent-fallthrough) + I4 (Telegram cap) covered. C1 (GH PAT scope) anchored cross-plan.
- **Contradictions:** 04a artifacts vs 04b daemon-wiring/test — clean split. crons.json references wake-check.sh + prompt-template.md by path (both 04a artifacts). agent-config.json references `claude-pty` runtime (Phase 1 artifact).
- **Simpler alternatives:** Could classify in plain bash without an LLM. REJECTED for now — classification quality is the AI surface; bash regex can't reliably parse `reviewDecision` correlations. Future optimization: when classification is well-understood, drop to deterministic + only invoke LLM for the SUMMARY phrasing (per layer-triage 60/30/10).
- **Missing acceptance criteria:** 04a satisfies migration-scope § 1 contract for the AGENT artifacts (config, schedule, wake-check, prompt). Cross-plan acceptance (cost ≤$0.50/week, 7-day Santiago-acts behavior) covered by 04b README + Phase 6 dashboard.

### Implementer forward-list

1. `gh-token` PAT scope (`repo` + `read:org`) documented across 01a CRED_MAP + 04b README + 03b Day -1 prep (C1 fix anchor).
2. wake-check.sh handles rate-limit with distinct exit code 2 + status check via `gh api -i` (C2 fix).
3. `Environment=TZ=UTC` in 01a systemd unit + `date -u +%Z` echo to wake-check.sh stderr (I1 fix).
4. Prompt-template 3800-char truncation rule (I4 fix).
