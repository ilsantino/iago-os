---
phase: feature-phase-2-vps-bootstrap
plan: 04
wave: 2
depends_on: [01, 07]
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-17
source: feature
---

# Plan: feature-phase-2-vps-bootstrap/04-pr-triage-agent

## Goal

Ship the first-real-workflow that proves Phase 2 daemon is more than science-fair scaffolding: a cron-fired PR-triage agent running on the VPS daily at 14:00 UTC (09:00 EST). It uses Shape 1 PTY adapter (claude-pty), queries `gh pr list` across iago-os org repos via `gh` CLI, classifies each PR as `waiting_claude` / `waiting_santiago` / `merge_ready` / `stuck`, and posts a single Telegram summary message to Santiago. Exercises the full Phase 2 stack: cron-scheduler + claude-pty + file-bus task creation + Telegram outbound + multi-org agent resolution + Hermes wake-check (skip LLM if 0 open PRs). Deliverables: agent config + prompt template + cron entry + README + Vitest integration test with mocked GH API + Telegram. Source of truth: `.iago/research/2026-05-16-v2-operational-migration-scope.md` § 1 (full concrete contract + 6-criterion acceptance gate).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/agents/pr-triage/agent-config.json` | AgentConfig JSON (agentId, runtime=claude-pty, shape=pty, authProfile=default) |
| create | `runtime/agents/pr-triage/crons.json` | Cron schedule + wake-check script + prompt template path |
| create | `runtime/agents/pr-triage/prompt-template.md` | Template for the daemon to pass to claude-pty stdin |
| create | `runtime/agents/pr-triage/wake-check.sh` | Hermes wake-check: `gh pr list` count; exit 0 if PRs exist, 1 if zero |
| create | `runtime/agents/pr-triage/README.md` | Purpose / deps / config / ops / failure modes |
| create | `runtime/agents/pr-triage/pr-triage.test.ts` | Integration test: mock gh + telegram, assert end-to-end |
| edit | `runtime/daemon/main.ts` | Wire the optional `cronScheduler` start (if absent in Phase 1, add minimal stub) |
| create OR edit | `runtime/daemon/cron-scheduler.ts` (+ .test.ts) | Minimal cron tick using node-cron OR pure setInterval+match; fires task-creation per crons.json |

## Tasks

### Task 1: Author agent-config.json

- **files:** `runtime/agents/pr-triage/agent-config.json`
- **action:** Write the AgentConfig JSON per the migration-scope § 1 "Concrete contract" + the schema from Plan 01 Task 6: `{ "agentId": "pr-triage", "runtimeId": "claude-pty", "org": "internal", "cwd": "/opt/iago-os", "env": {}, "autoStart": false, "authProfile": "default" }`. NOTE on `GH_TOKEN`: GH_TOKEN is inherited from daemon's `process.env` (cred-bootstrap loads it per Plan 01 Task 4 CREDENTIALS array entry `{ fileName: "iago-gh-token", envVar: "GH_TOKEN" }`; the spawned child inherits parent env by default). The `${CRED:<name>}` placeholder syntax is NOT implemented in Phase 1's config loader; using process-env inheritance instead avoids inventing new config substitution semantics. Plan 04 Task 6 verifies (read-only) that `iago-gh-token` is in Plan 01 CRED_MAP + cred-bootstrap CREDENTIALS array. Use `authProfile: "default"` (the only profile usable in Phase 2 per CONTEXT.md constraint "Anthropic profiles PROVISION at Phase 2, ACTIVATE at Phase 3" — `default` is the safe choice). `autoStart: false` because this agent is cron-driven, not always-on. `cwd: "/opt/iago-os"` lets `gh` operate on the iago-os repo from a working directory that has `.git`. File 15-30 lines.
- **verify:** `cat runtime/agents/pr-triage/agent-config.json | jq . > /dev/null && jq -r '.agentId, .runtimeId, .authProfile, .autoStart' runtime/agents/pr-triage/agent-config.json`
- **expected:** Valid JSON. Output lines: `pr-triage`, `claude-pty`, `default`, `false`.

### Task 2: Author crons.json

- **files:** `runtime/agents/pr-triage/crons.json`
- **action:** Cron entry per migration-scope § 1 contract + § 4 schema: `{ "schedule": "0 14 * * *", "wakeCheck": "runtime/agents/pr-triage/wake-check.sh", "prompt": "runtime/agents/pr-triage/prompt-template.md", "outputTaskNamePrefix": "pr-triage", "maxConcurrent": 1 }`. The `maxConcurrent: 1` field (Codex P1-8 fix — carried from migration-scope § 4 schema at line 533-537) prevents overlapping runs: if a previous pr-triage invocation is still mid-flight when the next 14:00 UTC tick fires, scheduler emits `cron-overlap-prevented` telemetry and SKIPS the spawn. Document the schedule reasoning in a top-of-file `_comment` field (JSON doesn't support comments natively, so use a `_comment` key the cron parser ignores): `"_comment": "14:00 UTC = 09:00 EST = 06:00 PST. Daily. Hermes wake-check runs first; if no open PRs, LLM call skipped (saves $0.10). maxConcurrent=1 prevents overlap if a slow run wedges past the next tick."`. The `outputTaskNamePrefix` lets the daemon synthesize task IDs as `pr-triage__<unix_timestamp>.json`. File 12-22 lines.
- **verify:** `cat runtime/agents/pr-triage/crons.json | jq . > /dev/null && jq -r '.schedule, .wakeCheck, .prompt, .maxConcurrent' runtime/agents/pr-triage/crons.json`
- **expected:** Valid JSON. Output: cron expression, wake-check path, prompt template path.

### Task 3: Author prompt-template.md

- **files:** `runtime/agents/pr-triage/prompt-template.md`
- **action:** The text the daemon pipes to claude-pty's stdin at trigger time. Plain markdown. Sections (no frontmatter — this is a prompt, not a doc): (1) Role — "You are the PR triage agent for the iago-os GitHub org. Your job: classify all open PRs across the org and produce a single Telegram-friendly summary."; (2) Tools available — `gh` CLI (with `$GH_TOKEN` env), `curl` for direct Telegram API calls, file write for fallback alerts only; (3) Algorithm — step by step: (a) run `gh pr list --owner ilsantino --state open --json number,title,url,author,reviewDecision,statusCheckRollup,createdAt,updatedAt --limit 50` → list all org-open PRs; if jq returns empty array, produce a one-line "No open PRs today" message and proceed to step (d). (b) For each PR: classify into one of 4 buckets: `merge_ready` (reviewDecision=APPROVED + all checks passing), `waiting_claude` (PR title or body mentions @claude OR has a `claude-review-requested` label AND review-decision != APPROVED), `waiting_santiago` (reviewDecision=APPROVED but author=ilsantino indicates Santiago should merge), `stuck` (no activity in 5+ days OR statusCheckRollup has failing checks); (c) Produce a markdown summary: `# PR Triage <YYYY-MM-DD HH:MM UTC>\n\nN open PRs across iago-os org\n\n## Merge Ready (n)\n- [#NN title](url) author\n\n## Waiting on Claude (n)\n- [#NN title](url) age:Xd\n\n## Waiting on Santiago (n)\n- ...\n\n## Stuck (n)\n- ...`; (d) POST the summary directly via curl to Telegram sendMessage endpoint. Use `$IAGO_TELEGRAM_BOT_TOKEN` (inherited from daemon process.env — cred-bootstrap loads it per Plan 01 Task 4) + first ID from `$IAGO_TELEGRAM_ALLOWED_USER_IDS` (comma-separated; systemd Environment per Plan 01 Task 1). Concrete invocation pattern: `FIRST_ID=$(echo "$IAGO_TELEGRAM_ALLOWED_USER_IDS" | cut -d, -f1); curl -sS -w "%{http_code}" -o /tmp/tg-resp.json --data-urlencode "chat_id=$FIRST_ID" --data-urlencode "text=$SUMMARY_MD" --data-urlencode "parse_mode=MarkdownV2" "https://api.telegram.org/bot${IAGO_TELEGRAM_BOT_TOKEN}/sendMessage"`. Capture HTTP status code; if non-200, write a fallback task file `tasks/pending/pr-triage__<unix>.json` with body `{ "ndjsonAlert": "pr-triage-telegram-send-failed", "details": "<http-status> <truncated-response-body>" }` so the daemon's polling loop emits a `pr-triage-telegram-send-failed` telemetry event for post-mortem; (4) Constraints — "Do NOT split into multiple Telegram messages. Single message only. Use Telegram-MarkdownV2 escaping for special chars (`_`, `*`, `[`, `]`, etc.) only if you detect them in PR titles. NEVER echo `$IAGO_TELEGRAM_BOT_TOKEN` to stdout or to any file." (5) Errors — "If `gh pr list` fails (auth or rate-limit), POST a brief failure summary via the same curl pattern: `text=PR triage failed: <error>. Investigate.` instead of silently exiting. If THAT curl ALSO fails non-200, write the fallback task file with `ndjsonAlert: 'pr-triage-double-failure'`." (6) Termination — "After successful POST (or fallback task file write), exit cleanly. Do not poll for follow-up."  File 80-150 lines.
- **verify:** `wc -l runtime/agents/pr-triage/prompt-template.md && grep -c "merge_ready\|waiting_claude\|waiting_santiago\|stuck" runtime/agents/pr-triage/prompt-template.md`
- **expected:** Line count 80-150. ≥4 classification-bucket references.

### Task 4: Author wake-check.sh (Hermes pattern)

- **files:** `runtime/agents/pr-triage/wake-check.sh`
- **action:** Bash script that the daemon runs BEFORE invoking the LLM (Hermes wake-check pattern per `.iago/research/2026-05-13-multi-agent-cohabitation.md`). Shebang + `set -euo pipefail`. Loads `GH_TOKEN` from env (fail if absent — wake-check NEEDS the token to query gh). Header comment: "Returns exit 0 if there is work for pr-triage (≥1 open PR org-wide), exit 1 if there is none. Saves ~$0.10 per skipped LLM invocation." Body: `gh api '/search/issues?q=org:ilsantino+is:pr+is:open&per_page=1' --jq '.total_count' 2>/dev/null` → capture as `COUNT`. If `COUNT=0` or empty, exit 1 with stdout `"No open PRs; skipping LLM invocation."`. Else exit 0 with stdout `"Found $COUNT open PR(s); proceeding."`. Total ≤30 lines. Idempotent (read-only API call). The daemon's cron-scheduler runs this script; on exit 1, the LLM dispatch is skipped + a telemetry event `cron-skipped { agentId: "pr-triage", reason: "wake-check-failed" }` is emitted; on exit 0, the daemon proceeds to spawn claude-pty with the prompt.
- **verify:** `bash -n runtime/agents/pr-triage/wake-check.sh && shellcheck runtime/agents/pr-triage/wake-check.sh && wc -l runtime/agents/pr-triage/wake-check.sh`
- **expected:** `bash -n` exit 0. `shellcheck` exit 0. Line count 15-35.

### Task 5: Author pr-triage README

- **files:** `runtime/agents/pr-triage/README.md`
- **action:** Per `.claude/rules/mcp-server-patterns.md` README convention. Sections: (1) Purpose — "First real workflow that proves Shape 1 PTY adapter can run end-to-end (cron-fired → wake-check → claude-pty → curl-to-Telegram → exit clean). No daemon-side outbound message broadcasting contract — agent POSTs directly to Telegram sendMessage endpoint via curl, inheriting `IAGO_TELEGRAM_BOT_TOKEN` from daemon process.env (Plan 01 cred-bootstrap) and `IAGO_TELEGRAM_ALLOWED_USER_IDS` from systemd Environment (Plan 01 Task 1)."; (2) Dependencies — claude-pty adapter (Phase 1), Telegram bot (Phase 1), cron-scheduler (Phase 2 — see Task 7), `gh` CLI on VPS (per Phase 0 audit), `GH_TOKEN` credential (provisioned via Plan 01 provision-credentials.sh + Task 6 catalog addition), node-cron OR equivalent in cron-scheduler.ts; (3) Configuration — pointer to agent-config.json + crons.json + prompt-template.md; (4) Operations — how to invoke manually (write a task to `tasks/pending/pr-triage__<unix>.json` with the prompt-template inline; daemon picks it up via claimTask; this is the test path), how to read recent invocations (`ls tasks/resolved/pr-triage__*.json | tail -7` shows last week), how to disable temporarily (`systemctl stop iago-os-v2-daemon` is a sledgehammer; better: edit agent-config.json `autoStart: false` (already is) AND set `crons.json` `schedule: null` to silence the cron); (5) Acceptance criteria — verbatim copy of migration-scope § 1 6-criterion gate (7 consecutive days, 1 Telegram message per day, wake-check correctly skips zero-PR days, crash recovery from session.jsonl HWM, cost ≤$0.50/week once Phase 8 ledger active, Santiago acts on ≥1 message); (6) Failure modes — table: GH_TOKEN expired (401 → wake-check stdout shows error → daemon emits cron-failed event); rate-limit (Hermes wake-check absorbs; LLM call won't happen); Telegram out (task written but message fails to send → daemon emits telegram-send-failed event; next day's run still proceeds); claude-pty crash mid-run (heartbeat detects + restart per Phase 1; session.jsonl replay resumes from HWM); 7-day no-Santiago-action (the migration-scope acceptance criterion #6 — surface in dashboard Phase 6, not a Phase 2 concern); (7) Cost — initial estimate $0.10/run × 7 runs/week = $0.70/week; wake-check skips drop this 30-50% on quiet days; updated when Phase 8 ledger has real numbers. File 150-280 lines.
- **verify:** `wc -l runtime/agents/pr-triage/README.md && grep -c "^## " runtime/agents/pr-triage/README.md && grep -c "wake-check\|cron-scheduler\|claude-pty" runtime/agents/pr-triage/README.md`
- **expected:** Line count 150-280. ≥7 top-level sections. ≥6 wake-check/cron-scheduler/claude-pty references.

### Task 6: VERIFY gh-token is in Plan 01 CRED_MAP + cred-bootstrap (verify-not-edit)

- **files:** read-only verification — no edits to Plan 01 artifacts in this plan (Plan 01 owns the CRED_MAP authoritatively per stress-test C2 fix applied 2026-05-17).
- **action:** Cross-plan VERIFY. Assert that Plan 01 implementation has shipped `gh-token` correctly across all 4 surfaces. Run these 4 greps in sequence; ANY zero-hit → fail the build with the specific surface named: (1) `grep -E '^\[gh-token\]=' runtime/deploy/provision-credentials.sh` must return exactly 1 line (CRED_MAP entry — Plan 01 Task 2); (2) `grep -E '^LoadCredentialEncrypted=iago-gh-token:' runtime/deploy/iago-os-v2-daemon.service` must return exactly 1 line (active LoadCredentialEncrypted — Plan 01 Task 1); (3) `grep -E 'fileName:\s*"iago-gh-token"' runtime/daemon/cred-bootstrap.ts` must return exactly 1 line (CREDENTIALS array active entry — Plan 01 Task 4); (4) `cd runtime && npx vitest run daemon/cred-bootstrap.test.ts --reporter=verbose 2>&1 | grep -c "iago-gh-token\|GH_TOKEN"` must return ≥1 (test case 9 — Plan 01 Task 5). Additionally: 1Password vault item `v2-gh-token` (field: `token`) is created by Santiago at cutover-time; pre-flight gate verification — Plan 03 Task 3 02-cutover-runbook.md MUST include the checkbox "[ ] 1Password vault item `v2-gh-token` exists with a GitHub PAT scoped to `repo + read:org` (classic PAT, expire-in 90d, regenerate quarterly via `provision-credentials.sh gh-token`)". Verify Plan 03 has this checkbox by `grep -F 'v2-gh-token' runtime/migration/02-cutover-runbook.md` returning ≥1 hit.
- **verify:** `for surface in 'provision-credentials.sh' 'iago-os-v2-daemon.service' 'cred-bootstrap.ts'; do c=$(grep -c "iago-gh-token\|gh-token\|GH_TOKEN" "runtime/deploy/$surface" 2>/dev/null || grep -c "iago-gh-token\|gh-token\|GH_TOKEN" "runtime/daemon/$surface" 2>/dev/null); [ "$c" -gt 0 ] || { echo "FAIL: gh-token missing from $surface"; exit 1; }; done && cd runtime && npx vitest run daemon/cred-bootstrap.test.ts --reporter=verbose 2>&1 | tail -15 && grep -F 'v2-gh-token' runtime/migration/02-cutover-runbook.md`
- **expected:** All 4 surfaces have ≥1 gh-token reference. Vitest reports 9 cred-bootstrap tests pass (8 from Plan 01 originally + 1 added by Plan 01 Task 5 case 9 per stress-test C2 fix). cutover-runbook checkbox present.

### Task 7: Wire existing CronScheduler from Plan 07 into startDaemon

- **files:** `runtime/daemon/main.ts` (edit only)
- **action:** Wire existing `CronScheduler` from Plan 07 (wave-1 dependency) into `startDaemon`. Read `runtime/agents/*/crons.json` via `fs.readdir(path.join(__dirname, "../agents"))` + iterate; for each agent folder, attempt to parse a `crons.json` (skip missing); call `scheduler.registerCron(opts)` for each entry (agentId derived from folder name OR from agent-config.json `agentId`); after AgentManager construction completes, call `scheduler.start()`. Shutdown handler (existing SIGTERM/SIGINT block) calls `await scheduler.stop()` before existing close logic. NO new `cron-scheduler.ts` or parser implementation here — those land in Plan 07 (wave 1). NO new agent-manager polling-loop work here — Plan 07 owns that too. Expected change: ≤50 LOC TS in `main.ts` (import + readdir loop + start/stop wiring). If Plan 07 has not shipped its `CronScheduler` export by the time this task runs, fail loudly with `Error("Plan 07 not landed: CronScheduler missing from runtime/daemon/cron-scheduler.ts")` so the dispatcher catches the dependency violation immediately.
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run daemon/main.test.ts daemon/agent-manager.test.ts --reporter=verbose 2>&1 | tail -20`
- **expected:** `tsc --noEmit` exit 0. main.test.ts continues to pass with the additional wiring; agent-manager tests untouched.

### Task 8: pr-triage integration test

- **files:** `runtime/agents/pr-triage/pr-triage.test.ts`
- **action:** Vitest test that exercises the FULL pr-triage flow with mocks. Setup: temp state-root, mock `child_process.spawnSync` for the wake-check bash script (returns exit 0 + count > 0), mock `node-pty` for claude-pty spawn (Phase 1 pattern — return controllable PTY that emits text on demand), mock `fetch` (or `child_process` for the curl invocation depending on how the prompt-template's curl-direct pattern is exercised) to intercept the Telegram sendMessage POST and record calls. Test cases: (1) wake-check returns 1 (zero PRs) → cron-scheduler emits `cron-skipped`; no claude-pty spawned; no curl-to-Telegram invoked; (2) wake-check returns 0 (PRs exist) + claude-pty receives the prompt + agent issues the direct curl POST to `https://api.telegram.org/bot<TOKEN>/sendMessage` → assert curl was invoked exactly once with: correct chat_id (first ID from `IAGO_TELEGRAM_ALLOWED_USER_IDS`), correct bot token in URL path, `parse_mode=MarkdownV2`, and the summary markdown in the `text` field; assert HTTP-200 simulated response causes the agent to exit cleanly with no fallback task file written; (3) wake-check fails (exit code 2) → cron-skipped emitted with reason; (4) claude-pty mid-run crash (mock emits "error" event) → heartbeat-driven restart per Phase 1 (assert restart called); (5) Telegram sendMessage returns HTTP 429 → agent writes fallback task file at `tasks/pending/pr-triage__<unix>.json` with `ndjsonAlert: "pr-triage-telegram-send-failed"` and HTTP-status + truncated response body in details; daemon's polling loop picks up the task and emits a `pr-triage-telegram-send-failed` telemetry event; the fallback task file is moved to `tasks/resolved/` after telemetry emission; (6) wake-check missing GH_TOKEN env → exits 1 with stderr message → cron-skipped with reason "wake-check-failed: missing GH_TOKEN"; (7) crons.json schedule never matches in the 60s test window → no spawns; (8) crons.json with `schedule: null` → cron NOT registered. Use `vi.useFakeTimers()` to manipulate clock past 14:00 UTC for the matching tests. File 250-450 lines.
- **verify:** `cd runtime && npx vitest run agents/pr-triage/pr-triage.test.ts --reporter=verbose 2>&1 | tail -30`
- **expected:** All 8 test cases pass.

## Verification

```bash
cd runtime && npx tsc --noEmit \
  && npx vitest run daemon/cron-scheduler.test.ts daemon/cred-bootstrap.test.ts agents/pr-triage/pr-triage.test.ts --coverage 2>&1 | tail -40 \
  && cd .. \
  && bash -n runtime/agents/pr-triage/wake-check.sh \
  && shellcheck runtime/agents/pr-triage/wake-check.sh \
  && jq . runtime/agents/pr-triage/agent-config.json > /dev/null \
  && jq . runtime/agents/pr-triage/crons.json > /dev/null
```

Expected:
- `tsc --noEmit` exit 0
- All listed test files pass; cron-scheduler ≥12 tests, cred-bootstrap 9 tests, pr-triage 8 tests
- Coverage ≥80% on new TS files
- wake-check.sh syntax + shellcheck clean
- Both JSON config files parse

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-17
**Reviewer:** orchestrator inline

### Critical (must fix in impl)

- **C1 — Task 7 has unknown scope until Phase 1 audit runs at impl-time.** Task 7 first audits Phase 1 for cron-scheduler primitives and then either extends/refactors/creates. If "no cron stub exists" (most likely outcome per Phase 1 plan 01-07 readthrough), Task 7 absorbs cron-scheduler authorship — that's an 8-task plan ceiling with Task 7 alone large enough to be its own plan. **Fix:** If impl discovers Task 7 has grown beyond reasonable single-task scope (>500 lines TS source + tests), split into Plan 04a (cron-scheduler standalone) + Plan 04b (pr-triage wiring). The pipeline can handle a runtime split — flag it in the impl session's final report rather than spec-time. Task 7's action already records the audit outcome at the top of cron-scheduler.ts JSDoc.
- **C2 — `GH_TOKEN` provisioning gap if Plan 01 ships before Plan 04.** Wave 1 ships Plan 01 + Plan 02 in parallel. Plan 04 (wave 2) adds `gh-token` to CRED_MAP. If Plan 01 is merged first and Plan 04 has a pipeline failure, the deploy README + provision-credentials.sh ship without gh-token. **Fix:** Add `gh-token` to Plan 01 Task 2 CRED_MAP directly (Plan 01 owns the CRED_MAP authoritatively). Plan 04 Task 6 then becomes: VERIFY gh-token is in Plan 01 CRED_MAP; if absent, fail the build with a clear message. Update Plan 01 Task 2 action paragraph (Plan 04 stress test forwards this requirement to Plan 01 implementer).
- **C3 — `gh` CLI auth scope.** Task 6 hand-waves "GitHub PAT scoped to repo:read + pull_request:read". `gh pr list --owner ilsantino --state open` works with a fine-grained PAT scoped to specific repos under ilsantino; or a classic PAT with `repo` scope (broader than needed). Task 3 prompt-template uses `gh api /search/issues?q=org:ilsantino...` (wake-check.sh same) which requires `read:org` if the org has SSO + private repos. **Fix:** Document the EXACT scope set in Task 6 + Task 5 README + Plan 03 pre-flight gate: "classic PAT with `repo` + `read:org` scopes" (simpler than fine-grained). Add to the README a sentence: "Generate at github.com/settings/tokens → 'Tokens (classic)' → expire-in 90d (regenerate quarterly via `provision-credentials.sh gh-token`)."

### Important (forward to impl, don't block)

- **I1 — Cron expression timezone.** Task 2 says `0 14 * * *` = 14:00 UTC. The VPS timezone is whatever Debian default is (likely UTC). Confirm: spec § 8 + Phase 0 audit don't explicitly state. **Fix:** Add to wake-check.sh a `date -u +%Z` echo at start (recorded in telemetry) AND set `Environment=TZ=UTC` in the systemd unit (Plan 01 Task 1 — coordinate via Plan 04 Task 6). Eliminates ambiguity; cost is one line.
- **I2 — Hermes wake-check should NOT count rate-limit as "no work".** If `gh api /search/issues` hits rate-limit (60/hr for unauthenticated, 5000/hr for authenticated — token presence should be fine), the call returns 403 with a `X-RateLimit-Remaining: 0` header. Plain `--jq '.total_count'` on a non-200 response will write "null" to stdout AND exit 0 (jq silently produces null). **Fix:** wake-check.sh checks the HTTP status code explicitly: `gh api -i ... | head -1 | grep -q "^HTTP/2 200"` OR use `gh api ... 2>&1 | tee /tmp/wakecheck.log` and grep for the typical rate-limit error string. On rate-limit, exit 2 (distinct from "no work" exit 1) so cron-scheduler can emit a richer telemetry event distinguishing the two cases.
- **I3 — `cwd: "/opt/iago-os"` may not have `.git`.** The deploy path on VPS is `/opt/iago-os` per Plan 01 systemd unit. But this is a fresh checkout via `git clone`; it DOES have `.git` after a clone. Pre-flight checkable; add to Plan 03 pre-flight gate: `tailscale ssh root@$VPS_HOST -- 'test -d /opt/iago-os/.git'`. If the path is a npm-prepared artifact (no .git), pr-triage's `gh pr list` won't run from a non-git cwd — actually, `gh pr list --owner ilsantino` doesn't require git; it queries the API directly. So this is a non-issue for pr-triage but worth confirming. Plan 04 Task 5 README can note: "pr-triage doesn't require git in cwd; uses `gh pr list --owner ilsantino` which queries the API directly. Other agents that DO require git in cwd should declare their own cwd in agent-config.json."
- **I4 — Telegram message length cap.** Telegram messages are capped at 4096 chars. A summary of 50 PRs × ~80 chars/PR = 4000 chars — close to the cap. **Fix:** Task 3 prompt-template adds explicit length guidance: "If the message exceeds 3800 chars, truncate the `stuck` section first (oldest PRs least likely actionable), then `merge_ready`, keeping `waiting_claude` + `waiting_santiago` intact. Append `\n_(N PRs truncated for length; see dashboard)_` to flag the truncation."
- **I5 — `pr-triage.test.ts` mocking `node-pty` correctly.** Phase 1 Plan 04 (Shape 1 PTY adapter) has the canonical mock pattern in its tests. Reference it directly: "Mock pattern matches `runtime/agent-runtime/pty/claude-pty.test.ts` setup — copy the `vi.mock('node-pty')` block from there for consistency."

### Minor

- M1 — `runtime/agents/pr-triage/` is a new top-level folder under runtime. Confirm pattern matches what other agent folders will look like (none exist yet — pr-triage is the first). Document in `runtime/agents/README.md` (a separate one-liner this plan can either create OR defer to Phase 3 when more agents land). Defer — Phase 2 PR is already large.
- M2 — Telegram message format MarkdownV2 vs HTML. Phase 1 bot.ts already picked one (Plan 06 in feature-v2-phase-1-daemon). Plan 04 Task 3 prompt-template should reference the actual choice — confirm in implementation.

### Dimension-by-dimension verdicts

- **Precision:** All 8 tasks have file paths + actions + verify + expected. C1 fork is documented.
- **Edge cases:** C2 + C3 cover credential setup mistakes. I2 covers the "AI vs rule-based" boundary (wake-check is rule-based, must NOT silently fall through to AI). I4 covers Telegram cap.
- **Contradictions:** Plan 04 Task 6 EDITS Plan 01 artifacts. This creates a wave-1 vs wave-2 dependency conflict — Plan 01 must merge before Plan 04 can run. C2 fix moves the gh-token CRED_MAP entry to Plan 01 directly, eliminating the conflict. Plan 04 Task 6 becomes a verify-not-edit task.
- **Simpler alternatives:** Could use n8n cron + webhook → daemon HTTP endpoint, instead of in-daemon cron-scheduler. REJECTED — Phase 2 has no webhook surface yet (lands Phase 9). In-daemon cron is the minimum-viable path. Could skip wake-check and always invoke LLM. REJECTED per layer-triage 60/30/10 — wake-check is the rule-based filter that saves $0.10/run. Could classify in plain bash without an LLM. REJECTED for now — classification quality is the AI surface; bash regex can't reliably parse `reviewDecision` correlations. Future optimization: when classification is well-understood, drop to deterministic + only invoke LLM for the SUMMARY phrasing.
- **Missing acceptance criteria:** Plan 04 satisfies migration-scope § 1 criteria 1, 2, 3 directly. Criteria 4 (crash recovery from session.jsonl HWM) is tested in Task 8 case 4 + relies on Phase 1 heartbeat-driven restart. Criterion 5 (cost ≤$0.50/week via Phase 8 ledger) is OUT of Phase 2 scope (Phase 8 work); document the deferral in README Task 5 § 7 (Cost section). Criterion 6 (Santiago acts on ≥1 message in 7 days) is a behavioral signal, observed-not-tested — surface in Phase 6 dashboard.

### Implementer forward-list

1. Task 7 absorbs Phase 1 cron-scheduler audit at impl-time; flag mid-impl split-into-2-plans if Task 7 grows >500 lines (C1 fix).
2. Move `gh-token` CRED_MAP entry to Plan 01 Task 2; Plan 04 Task 6 verifies-not-edits (C2 fix).
3. Document exact `gh` PAT scope (`repo` + `read:org`) in README + provision-credentials.sh CRED_MAP comment + Plan 03 pre-flight gate (C3 fix).
4. Add `Environment=TZ=UTC` to systemd unit + `date -u +%Z` echo to wake-check.sh (I1 fix).
5. wake-check.sh handles rate-limit with distinct exit code 2 + richer telemetry (I2 fix).
6. README Task 5 notes `cwd` agnostic behavior (I3 closure).
7. Prompt-template adds 3800-char truncation rule (I4 fix).
8. Test file copies the `vi.mock('node-pty')` block from Phase 1 Plan 04 tests (I5 fix).
