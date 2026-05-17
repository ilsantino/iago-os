---
phase: feature-phase-2-vps-bootstrap
plan: 04
wave: 2
depends_on: [01]
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
- **action:** Write the AgentConfig JSON per the migration-scope § 1 "Concrete contract" + the schema from Plan 01 Task 6: `{ "agentId": "pr-triage", "runtimeId": "claude-pty", "org": "internal", "cwd": "/opt/iago-os", "env": { "GH_TOKEN": "${CRED:gh-token}" }, "autoStart": false, "authProfile": "default" }`. NOTE on `GH_TOKEN`: the `${CRED:gh-token}` placeholder is a NEW credential not yet provisioned (migration-scope mentions it). Plan 04 declares the placeholder; Plan 01 + the cutover runbook (Plan 03) handle the actual `gh-token` credential provisioning via `provision-credentials.sh gh-token` — Plan 01 Task 2 CRED_MAP only has telegram + 3 anthropic; this plan must add `gh-token` to that map IF Plan 01 hasn't already. Coordinate: add a one-liner to Plan 01 README (Plan 01 Task 8 / via Plan 04 Task 6) explaining the gh-token entry. Use `authProfile: "default"` (the only profile usable in Phase 2 per CONTEXT.md constraint "Anthropic profiles PROVISION at Phase 2, ACTIVATE at Phase 3" — `default` is the safe choice). `autoStart: false` because this agent is cron-driven, not always-on. `cwd: "/opt/iago-os"` lets `gh` operate on the iago-os repo from a working directory that has `.git`. File 15-30 lines.
- **verify:** `cat runtime/agents/pr-triage/agent-config.json | jq . > /dev/null && jq -r '.agentId, .runtimeId, .authProfile, .autoStart' runtime/agents/pr-triage/agent-config.json`
- **expected:** Valid JSON. Output lines: `pr-triage`, `claude-pty`, `default`, `false`.

### Task 2: Author crons.json

- **files:** `runtime/agents/pr-triage/crons.json`
- **action:** Cron entry per migration-scope § 1 contract: `{ "schedule": "0 14 * * *", "wakeCheck": "runtime/agents/pr-triage/wake-check.sh", "prompt": "runtime/agents/pr-triage/prompt-template.md", "outputTaskNamePrefix": "pr-triage" }`. Document the schedule reasoning in a top-of-file `_comment` field (JSON doesn't support comments natively, so use a `_comment` key the cron parser ignores): `"_comment": "14:00 UTC = 09:00 EST = 06:00 PST. Daily. Hermes wake-check runs first; if no open PRs, LLM call skipped (saves $0.10)."`. The `outputTaskNamePrefix` lets the daemon synthesize task IDs as `pr-triage__<unix_timestamp>.json`. File 10-20 lines.
- **verify:** `cat runtime/agents/pr-triage/crons.json | jq . > /dev/null && jq -r '.schedule, .wakeCheck, .prompt' runtime/agents/pr-triage/crons.json`
- **expected:** Valid JSON. Output: cron expression, wake-check path, prompt template path.

### Task 3: Author prompt-template.md

- **files:** `runtime/agents/pr-triage/prompt-template.md`
- **action:** The text the daemon pipes to claude-pty's stdin at trigger time. Plain markdown. Sections (no frontmatter — this is a prompt, not a doc): (1) Role — "You are the PR triage agent for the iago-os GitHub org. Your job: classify all open PRs across the org and produce a single Telegram-friendly summary."; (2) Tools available — `gh` CLI (with `$GH_TOKEN` env), file write to `tasks/pending/pr-triage__<unix>.json`; (3) Algorithm — step by step: (a) run `gh pr list --owner ilsantino --state open --json number,title,url,author,reviewDecision,statusCheckRollup,createdAt,updatedAt --limit 50` → list all org-open PRs; if jq returns empty array, write the empty-state task and exit. (b) For each PR: classify into one of 4 buckets: `merge_ready` (reviewDecision=APPROVED + all checks passing), `waiting_claude` (PR title or body mentions @claude OR has a `claude-review-requested` label AND review-decision != APPROVED), `waiting_santiago` (reviewDecision=APPROVED but author=ilsantino indicates Santiago should merge), `stuck` (no activity in 5+ days OR statusCheckRollup has failing checks); (c) Produce a markdown summary: `# PR Triage <YYYY-MM-DD HH:MM UTC>\n\nN open PRs across iago-os org\n\n## Merge Ready (n)\n- [#NN title](url) author\n\n## Waiting on Claude (n)\n- [#NN title](url) age:Xd\n\n## Waiting on Santiago (n)\n- ...\n\n## Stuck (n)\n- ...`; (d) Write a task file: `tasks/pending/pr-triage__<unix>.json` with body `{ "telegramMessage": "<the markdown above>", "needsApproval": false }` — the daemon's Telegram bot detects task files with `telegramMessage` field and posts to the allowed user as a single message. (4) Constraints — "Do NOT split into multiple Telegram messages. Single message only. Use Telegram-MarkdownV2 escaping for special chars (`_`, `*`, `[`, `]`, etc.) only if you detect them in PR titles." (5) Errors — "If `gh pr list` fails (auth or rate-limit), write a task with `telegramMessage: 'PR triage failed: <error>. Investigate.'` instead of silently exiting." (6) Termination — "After writing the task file, exit cleanly. Do not poll for follow-up."  File 80-150 lines.
- **verify:** `wc -l runtime/agents/pr-triage/prompt-template.md && grep -c "merge_ready\|waiting_claude\|waiting_santiago\|stuck" runtime/agents/pr-triage/prompt-template.md`
- **expected:** Line count 80-150. ≥4 classification-bucket references.

### Task 4: Author wake-check.sh (Hermes pattern)

- **files:** `runtime/agents/pr-triage/wake-check.sh`
- **action:** Bash script that the daemon runs BEFORE invoking the LLM (Hermes wake-check pattern per `.iago/research/2026-05-13-multi-agent-cohabitation.md`). Shebang + `set -euo pipefail`. Loads `GH_TOKEN` from env (fail if absent — wake-check NEEDS the token to query gh). Header comment: "Returns exit 0 if there is work for pr-triage (≥1 open PR org-wide), exit 1 if there is none. Saves ~$0.10 per skipped LLM invocation." Body: `gh api '/search/issues?q=org:ilsantino+is:pr+is:open&per_page=1' --jq '.total_count' 2>/dev/null` → capture as `COUNT`. If `COUNT=0` or empty, exit 1 with stdout `"No open PRs; skipping LLM invocation."`. Else exit 0 with stdout `"Found $COUNT open PR(s); proceeding."`. Total ≤30 lines. Idempotent (read-only API call). The daemon's cron-scheduler runs this script; on exit 1, the LLM dispatch is skipped + a telemetry event `cron-skipped { agentId: "pr-triage", reason: "wake-check-failed" }` is emitted; on exit 0, the daemon proceeds to spawn claude-pty with the prompt.
- **verify:** `bash -n runtime/agents/pr-triage/wake-check.sh && shellcheck runtime/agents/pr-triage/wake-check.sh && wc -l runtime/agents/pr-triage/wake-check.sh`
- **expected:** `bash -n` exit 0. `shellcheck` exit 0. Line count 15-35.

### Task 5: Author pr-triage README

- **files:** `runtime/agents/pr-triage/README.md`
- **action:** Per `.claude/rules/mcp-server-patterns.md` README convention. Sections: (1) Purpose — "First real workflow for v2 Phase 2 daemon. Proves the daemon can run a cron-fired agent that produces a daily Telegram artifact"; (2) Dependencies — claude-pty adapter (Phase 1), Telegram bot (Phase 1), cron-scheduler (Phase 2 — see Task 7), `gh` CLI on VPS (per Phase 0 audit), `GH_TOKEN` credential (provisioned via Plan 01 provision-credentials.sh + Task 6 catalog addition), node-cron OR equivalent in cron-scheduler.ts; (3) Configuration — pointer to agent-config.json + crons.json + prompt-template.md; (4) Operations — how to invoke manually (write a task to `tasks/pending/pr-triage__<unix>.json` with the prompt-template inline; daemon picks it up via claimTask; this is the test path), how to read recent invocations (`ls tasks/resolved/pr-triage__*.json | tail -7` shows last week), how to disable temporarily (`systemctl stop iago-os-v2-daemon` is a sledgehammer; better: edit agent-config.json `autoStart: false` (already is) AND set `crons.json` `schedule: null` to silence the cron); (5) Acceptance criteria — verbatim copy of migration-scope § 1 6-criterion gate (7 consecutive days, 1 Telegram message per day, wake-check correctly skips zero-PR days, crash recovery from session.jsonl HWM, cost ≤$0.50/week once Phase 8 ledger active, Santiago acts on ≥1 message); (6) Failure modes — table: GH_TOKEN expired (401 → wake-check stdout shows error → daemon emits cron-failed event); rate-limit (Hermes wake-check absorbs; LLM call won't happen); Telegram out (task written but message fails to send → daemon emits telegram-send-failed event; next day's run still proceeds); claude-pty crash mid-run (heartbeat detects + restart per Phase 1; session.jsonl replay resumes from HWM); 7-day no-Santiago-action (the migration-scope acceptance criterion #6 — surface in dashboard Phase 6, not a Phase 2 concern); (7) Cost — initial estimate $0.10/run × 7 runs/week = $0.70/week; wake-check skips drop this 30-50% on quiet days; updated when Phase 8 ledger has real numbers. File 150-280 lines.
- **verify:** `wc -l runtime/agents/pr-triage/README.md && grep -c "^## " runtime/agents/pr-triage/README.md && grep -c "wake-check\|cron-scheduler\|claude-pty" runtime/agents/pr-triage/README.md`
- **expected:** Line count 150-280. ≥7 top-level sections. ≥6 wake-check/cron-scheduler/claude-pty references.

### Task 6: Add gh-token to Plan 01 CRED_MAP

- **files:** `runtime/deploy/provision-credentials.sh` (edit), `runtime/deploy/README.md` (edit)
- **action:** Cross-plan edit. Add to the `CRED_MAP` associative array in `provision-credentials.sh`: `[gh-token]="op://iago-os/v2-gh-token/token::iago-gh-token"`. Add to `runtime/deploy/README.md` artifacts table: row for the `gh-token` credential noting it's used by `pr-triage` agent. Add to Plan 01 systemd unit file (`runtime/deploy/iago-os-v2-daemon.service`) a NEW commented-out line under the Phase 3 placeholders: `# LoadCredentialEncrypted=iago-gh-token:/etc/credstore.encrypted/iago-gh-token.cred` AND ACTIVATE it (uncomment — Phase 2 needs gh-token in scope). Update `runtime/daemon/cred-bootstrap.ts` `CREDENTIALS` array: ADD `{ fileName: "iago-gh-token", envVar: "GH_TOKEN" }` as an active entry. Add a test to `cred-bootstrap.test.ts`: case 9, file `iago-gh-token` present → `process.env.GH_TOKEN` set. 1Password vault item `v2-gh-token` (field: `token`) is created by Santiago at cutover-time; reference in `runtime/migration/02-cutover-runbook.md` pre-flight gate (Plan 03 Task 3 must add a checkbox: "[ ] 1Password vault item `v2-gh-token` exists with a GitHub PAT scoped to `repo:read + pull_request:read` for `ilsantino` org").
- **verify:** `grep -c "gh-token\|GH_TOKEN" runtime/deploy/provision-credentials.sh runtime/deploy/iago-os-v2-daemon.service runtime/daemon/cred-bootstrap.ts ; cd runtime && npx vitest run daemon/cred-bootstrap.test.ts --reporter=verbose 2>&1 | tail -15`
- **expected:** ≥1 grep hit in each of the 3 source files. Vitest reports 9 cred-bootstrap tests pass (was 8 from Plan 01).

### Task 7: Implement minimal cron-scheduler

- **files:** `runtime/daemon/cron-scheduler.ts`, `runtime/daemon/cron-scheduler.test.ts`, `runtime/daemon/main.ts` (edit)
- **action:** First, audit Phase 1 for cron-scheduler primitives — run `grep -rn "cron\|schedule\|every\|tick" runtime/daemon/ runtime/agent-runtime/` and read `runtime/daemon/README.md` to determine whether ANY cron-scheduler exists. Three outcomes: (a) cron stub exists with clean API → this task EXTENDS it; (b) cron stub exists with incompatible API → this task REFACTORS; (c) NO cron stub → this task CREATES from scratch (most likely per Phase 1 plan 01-07 readthrough). Record the outcome at the top of cron-scheduler.ts in a JSDoc block. Implementation: a minimal cron-scheduler that does NOT pull `node-cron` as a dep (avoid dep bloat for Phase 2) — instead, every 60 seconds (`setInterval`) it iterates all registered cron entries, checks if NOW matches the cron expression (5-field POSIX cron: minute hour day month weekday), and if so, runs the wake-check (if defined) then enqueues a task. Parser: small inline cron-match function handling `*`, integers, ranges (`1-5`), step (`*/15`), comma lists (`1,3,5`). Tests required: minute match, hour match, weekday match, `*/15` step, `1-5,Mon-Fri` ranges, NOT-matched cases. Public API: `class CronScheduler { constructor({ agentManager, fileBus }); registerCron(opts: { agentId, schedule, wakeCheck?, promptTemplatePath, outputTaskNamePrefix }); start(): void; stop(): Promise<void> }`. On tick + match: (a) if wakeCheck path defined, `spawnSync('bash', [wakeCheckPath], { env: { ...process.env, ...registeredEnvFor(agentId) }, encoding: "utf8" })`; if exit code != 0, emit `cron-skipped` telemetry, return; (b) read prompt-template file contents; (c) write to `<stateRoot>/tasks/pending/<outputTaskNamePrefix>__<unix_timestamp>.json` with body `{ "prompt": <template contents>, "agentId": <agentId>, "needsApproval": false }`; (d) emit `cron-fired` telemetry event. The daemon's agent-manager already handles polling `tasks/pending/` and routing to claimAgent. NOTE: per Plan 07 stress-test M3 in Phase 1, the production polling loop was DEFERRED to Phase 2 — this plan ALSO needs to add a simple polling loop in agent-manager.ts: `fs.readdir(tasks/pending/)` every 5s, claim any task whose `agentId` field matches a registered agent. Add corresponding tests in `agent-manager.test.ts`. Wire `CronScheduler` into `main.ts` `startDaemon`: after AgentManager construction, read `runtime/agents/*/crons.json` files via `fs.readdir`, register each, call `scheduler.start()`. Shutdown handler calls `scheduler.stop()`. File ranges: cron-scheduler.ts 200-350 lines; cron-scheduler.test.ts 200-300 lines (≥12 test cases covering parser + scheduler behavior).
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run daemon/cron-scheduler.test.ts daemon/agent-manager.test.ts --reporter=verbose 2>&1 | tail -30`
- **expected:** `tsc --noEmit` exit 0. cron-scheduler tests ≥12 pass. agent-manager.test.ts existing tests still pass + ≥2 new tests for the polling loop pass.

### Task 8: pr-triage integration test

- **files:** `runtime/agents/pr-triage/pr-triage.test.ts`
- **action:** Vitest test that exercises the FULL pr-triage flow with mocks. Setup: temp state-root, mock `child_process.spawnSync` for the wake-check bash script (returns exit 0 + count > 0), mock `node-pty` for claude-pty spawn (Phase 1 pattern — return controllable PTY that emits text on demand), mock `node-telegram-bot-api` for outbound message (record calls). Test cases: (1) wake-check returns 1 (zero PRs) → cron-scheduler emits `cron-skipped`; no claude-pty spawned; no Telegram message sent; (2) wake-check returns 0 (PRs exist) + claude-pty receives the prompt + writes a `tasks/pending/pr-triage__<unix>.json` file with `telegramMessage` field + agent exits cleanly → daemon picks up the resolved task, Telegram bot sends ONE message with the summary content; (3) wake-check fails (exit code 2) → cron-skipped emitted with reason; (4) claude-pty mid-run crash (mock emits "error" event) → heartbeat-driven restart per Phase 1 (assert restart called); (5) Telegram outbound API returns 429 → daemon emits `telegram-send-failed` + does NOT delete the resolved task file (so a subsequent retry can re-send) — confirm retry mechanism exists OR document this gap explicitly as a Phase 6 dashboard concern; (6) wake-check missing GH_TOKEN env → exits 1 with stderr message → cron-skipped with reason "wake-check-failed: missing GH_TOKEN"; (7) crons.json schedule never matches in the 60s test window → no spawns; (8) crons.json with `schedule: null` → cron NOT registered. Use `vi.useFakeTimers()` to manipulate clock past 14:00 UTC for the matching tests. File 250-450 lines.
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
