---
phase: feature-phase-2-vps-bootstrap
plan: 04b
wave: 3
depends_on: [04a, 03b, 07a, 07b]
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-18
source: feature
split_from: 04-pr-triage-agent
split_rationale: Pre-emptive split per .iago/decisions/2026-05-18-phase-2-split-and-dispatch.md. 04b ships the README + cross-plan gh-token verification + CronScheduler wiring into startDaemon + integration test (Tasks 5, 6, 7, 8 of original 04). Depends on 04a (agent artifacts to wire), 07a (CronScheduler class to import), and 07b (AgentManager EventEmitter + claimTask emit side for the decrement chain).
---

# Plan: feature-phase-2-vps-bootstrap/04b-pr-triage-wiring-and-test

## Goal

Wire the PR-triage agent artifacts (04a) into the daemon and prove the whole stack works end-to-end. Four deliverables: (1) `runtime/agents/pr-triage/README.md` — purpose, dependencies, configuration, operations, acceptance criteria, cost; (2) cross-plan verification that `gh-token` shipped correctly across 01a CRED_MAP + 01a systemd unit + 01b cred-bootstrap + 03b cutover-runbook (read-only — fails build if any surface missing); (3) `runtime/daemon/main.ts` edit — readdir `runtime/agents/*/crons.json`, register each entry with CronScheduler (07a), start scheduler, wire shutdown; (4) `pr-triage.test.ts` — Vitest integration test exercising the FULL flow with mocks (wake-check stubbed, claude-pty mocked, curl-to-Telegram intercepted). Source of truth: `.iago/research/2026-05-16-v2-operational-migration-scope.md` § 1 + § 4. This plan is the closing brace for Phase 2's first-real-workflow.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/agents/pr-triage/README.md` | Purpose / deps / config / ops / acceptance criteria / failure modes / cost |
| create | `runtime/agents/pr-triage/pr-triage.test.ts` | Integration test: mock gh + telegram, assert end-to-end |
| edit | `runtime/daemon/main.ts` | Wire CronScheduler (07a) into startDaemon; readdir agents/*/crons.json; register + start; shutdown hook |
| read-only verify | `runtime/deploy/provision-credentials.sh` (01a) + `runtime/deploy/iago-os-v2-daemon.service` (01a) + `runtime/daemon/cred-bootstrap.ts` (01b) + `runtime/migration/02-cutover-runbook.md` (03b) | Cross-plan grep verification that gh-token shipped on all 4 surfaces |

## Tasks

### Task 1: Author pr-triage README

- **files:** `runtime/agents/pr-triage/README.md`
- **action:** Per `.claude/rules/mcp-server-patterns.md` README convention. Sections: (1) Purpose — "First real workflow that proves Shape 1 PTY adapter can run end-to-end (cron-fired → wake-check → claude-pty → curl-to-Telegram → exit clean). No daemon-side outbound message broadcasting contract — agent POSTs directly to Telegram sendMessage endpoint via curl, inheriting `IAGO_TELEGRAM_BOT_TOKEN` from daemon process.env (01b cred-bootstrap) and `IAGO_TELEGRAM_ALLOWED_USER_IDS` from systemd Environment (01a Task 1)."; (2) Dependencies — claude-pty adapter (Phase 1), Telegram bot (Phase 1), CronScheduler (07a) + AgentManager polling loop (07b), `gh` CLI on VPS (per Phase 0 audit), `GH_TOKEN` credential (provisioned via 01a `provision-credentials.sh gh-token` — classic PAT with `repo` + `read:org` scopes, 90-day expiry); (3) Configuration — pointer to agent-config.json (04a Task 1) + crons.json (04a Task 2) + prompt-template.md (04a Task 3); (4) Operations — how to invoke manually (write a task to `tasks/pending/pr-triage__<unix>.json` with the prompt-template inline; daemon picks it up via claimTask from 07b; this is the test path), how to read recent invocations (`ls tasks/resolved/pr-triage__*.json | tail -7` shows last week), how to disable temporarily (`systemctl stop iago-os-v2-daemon` is a sledgehammer; better: edit agent-config.json `autoStart: false` (already is) AND set `crons.json` `schedule: null` to silence the cron); (5) Acceptance criteria — verbatim copy of migration-scope § 1 6-criterion gate (7 consecutive days, 1 Telegram message per day, wake-check correctly skips zero-PR days, crash recovery from session.jsonl HWM, cost ≤$0.50/week once Phase 8 ledger active, Santiago acts on ≥1 message); (6) Failure modes — table: GH_TOKEN expired (401 → wake-check stdout shows error → daemon emits cron-failed event); rate-limit (Hermes wake-check absorbs via exit-code 2 → cron-skipped with `reason: "wake-check-rate-limited"`); Telegram out (task written but message fails to send → daemon emits telegram-send-failed event; next day's run still proceeds); claude-pty crash mid-run (heartbeat detects + restart per Phase 1; session.jsonl replay resumes from HWM); 7-day no-Santiago-action (the migration-scope acceptance criterion #6 — surface in dashboard Phase 6, not a Phase 2 concern); (7) Cost — initial estimate $0.10/run × 7 runs/week = $0.70/week; wake-check skips drop this 30-50% on quiet days; updated when Phase 8 ledger has real numbers; (8) cwd-agnostic note (I3 carry-over): "pr-triage doesn't require git in cwd; uses `gh pr list --owner ilsantino` which queries the API directly. Other agents that DO require git in cwd should declare their own cwd in agent-config.json." File 160-280 lines.
- **verify:** `wc -l runtime/agents/pr-triage/README.md && grep -c "^## " runtime/agents/pr-triage/README.md && grep -c "wake-check\|cron-scheduler\|claude-pty\|gh-token" runtime/agents/pr-triage/README.md`
- **expected:** Line count 160-280. ≥8 top-level sections. ≥6 wake-check/cron-scheduler/claude-pty/gh-token references.

### Task 2: VERIFY gh-token is in Plan 01a CRED_MAP + 01a unit + 01b cred-bootstrap + 03b cutover-runbook (verify-not-edit)

- **files:** read-only verification — no edits to other-plan artifacts (01a/01b/03b own the surfaces authoritatively per stress-test C2 fix applied 2026-05-17 carried into split rationale).
- **action:** Cross-plan VERIFY. Assert that 01a + 01b + 03b implementations have shipped `gh-token` correctly across all 5 surfaces. Run these 5 greps in sequence; ANY zero-hit → fail the build with the specific surface named: (1) `grep -E '^\[gh-token\]=' runtime/deploy/provision-credentials.sh` must return exactly 1 line (CRED_MAP entry — 01a Task 2); (2) `grep -E '^LoadCredentialEncrypted=iago-gh-token:' runtime/deploy/iago-os-v2-daemon.service` must return exactly 1 line (active LoadCredentialEncrypted — 01a Task 1); (3) `grep -E 'fileName:\s*"iago-gh-token"' runtime/daemon/cred-bootstrap.ts` must return exactly 1 line (CREDENTIALS array active entry — 01b Task 1); (4) `cd runtime && npx vitest run daemon/cred-bootstrap.test.ts --reporter=verbose 2>&1 | grep -c "iago-gh-token\|GH_TOKEN"` must return ≥1 (test case 9 — 01b Task 2); (5) `grep -F 'v2-gh-token' runtime/migration/02-cutover-runbook.md` must return ≥1 (Day -1 prep checklist — 03b Task 1). The 1Password vault item `v2-gh-token` (field: `token`) is created by Santiago at cutover-time per 03b Day -1 prep; this task only verifies the on-disk artifacts that consume + provision it.
- **verify:** `for surface in 'provision-credentials.sh' 'iago-os-v2-daemon.service' 'cred-bootstrap.ts'; do path=$(find runtime/deploy runtime/daemon -name "$surface" 2>/dev/null | head -1); [ -n "$path" ] || { echo "FAIL: $surface not found"; exit 1; }; c=$(grep -c "iago-gh-token\|gh-token\|GH_TOKEN" "$path" 2>/dev/null); [ "$c" -gt 0 ] || { echo "FAIL: gh-token missing from $path"; exit 1; }; done && cd runtime && npx vitest run daemon/cred-bootstrap.test.ts --reporter=verbose 2>&1 | tail -15 && cd .. && grep -F 'v2-gh-token' runtime/migration/02-cutover-runbook.md`
- **expected:** All 5 surfaces have ≥1 gh-token reference. Vitest reports ≥10 cred-bootstrap tests pass (10 from 01b Task 2 per the sentinel-leak test addition). cutover-runbook Day -1 prep contains `v2-gh-token` line.

### Task 3: Wire CronScheduler (07a) into startDaemon

- **files:** `runtime/daemon/main.ts` (edit only)
- **action:** Wire existing `CronScheduler` from 07a (wave-1 dependency) + `AgentManager.startPollingLoop` from 07b into `startDaemon`. Import `CronScheduler` from `./cron-scheduler.js`. Construct it AFTER `AgentManager` (so 07b's EventEmitter + claimTask are alive for the constructor's `agentManager.on('task-resolved', ...)` subscription): `const scheduler = new CronScheduler({ agentManager, fileBus, stateRoot, logger });`. Read `runtime/agents/*/crons.json` via `fs.readdir(path.join(__dirname, "../agents"))` + iterate; for each agent folder, attempt to parse a `crons.json` (skip missing); call `scheduler.registerCron(opts)` for each entry (agentId derived from folder name OR from agent-config.json `agentId`). After all registers: `scheduler.start();` AND `agentManager.startPollingLoop({ intervalMs: 5000 });`. Shutdown handler (existing SIGTERM/SIGINT block) calls `await scheduler.stop(); await agentManager.stopPollingLoop();` before existing close logic. Expected change: ≤80 LOC TS in `main.ts` (import + readdir loop + start/stop wiring for both scheduler and polling loop). If 07a or 07b have not shipped by the time this task runs, fail loudly with `Error("Plan 07a or 07b not landed: CronScheduler or AgentManager polling loop missing")` so the dispatcher catches the dependency violation immediately.
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run daemon/main.test.ts daemon/agent-manager.test.ts --reporter=verbose 2>&1 | tail -20`
- **expected:** `tsc --noEmit` exit 0. main.test.ts continues to pass with the additional wiring; agent-manager tests untouched (07b's polling-loop tests live in agent-manager.test.ts and run as part of this verification).

### Task 4: pr-triage integration test

- **files:** `runtime/agents/pr-triage/pr-triage.test.ts`
- **action:** Vitest test that exercises the FULL pr-triage flow with mocks. Setup: temp state-root, mock `child_process.spawnSync` for the wake-check bash script (returns exit 0 + count > 0), mock `node-pty` for claude-pty spawn (Phase 1 pattern — copy the `vi.mock('node-pty')` block from `runtime/agent-runtime/pty/claude-pty.test.ts` for consistency per I5 carry-over from original Plan 04), mock `fetch` (or `child_process` for the curl invocation depending on how the prompt-template's curl-direct pattern is exercised) to intercept the Telegram sendMessage POST and record calls. Test cases: (1) wake-check returns 1 (zero PRs) → cron-scheduler (07a) emits `cron-skipped { reason: 'wake-check-failed' }`; no claude-pty spawned; no curl-to-Telegram invoked; (2) wake-check returns 0 (PRs exist) + claude-pty receives the prompt + agent issues the direct curl POST to `https://api.telegram.org/bot<TOKEN>/sendMessage` → assert curl was invoked exactly once with: correct chat_id (first ID from `IAGO_TELEGRAM_ALLOWED_USER_IDS`), correct bot token in URL path, `parse_mode=MarkdownV2`, and the summary markdown in the `text` field; assert HTTP-200 simulated response causes the agent to exit cleanly with no fallback task file written; (3) wake-check fails (exit code 2 — rate-limit) → cron-skipped emitted with `reason: 'wake-check-rate-limited'`; (4) claude-pty mid-run crash (mock emits "error" event) → heartbeat-driven restart per Phase 1 (assert restart called); (5) Telegram sendMessage returns HTTP 429 → agent writes fallback task file at `tasks/pending/pr-triage__<unix>.json` with `ndjsonAlert: "pr-triage-telegram-send-failed"` and HTTP-status + truncated response body in details; daemon's polling loop (07b) picks up the task and emits a `pr-triage-telegram-send-failed` telemetry event; the fallback task file is moved to `tasks/resolved/` via 07b's claimTask after telemetry emission; (6) wake-check missing GH_TOKEN env → exits 1 with stderr message → cron-skipped with `reason: "wake-check-failed"`; (7) crons.json schedule never matches in the 60s test window → no spawns; (8) crons.json with `schedule: null` → cron NOT registered; (9) **end-to-end decrement chain** (bridges 07a + 07b + 04a + 04b): two consecutive ticks with `maxConcurrent: 1`; first tick fires cron-fired, second tick before claimTask completes → `cron-overlap-prevented` emitted; after polling-loop claims first task → `task-resolved` emitted → second matching tick fires successfully without overlap-prevented. Use `vi.useFakeTimers()` to manipulate clock past 14:00 UTC for the matching tests. File 280-480 lines.
- **verify:** `cd runtime && npx vitest run agents/pr-triage/pr-triage.test.ts --reporter=verbose 2>&1 | tail -30`
- **expected:** All 9 test cases pass.

## Verification

```bash
cd runtime && npx tsc --noEmit \
  && npx vitest run daemon/cron-scheduler.test.ts daemon/cred-bootstrap.test.ts daemon/agent-manager.test.ts daemon/main.test.ts agents/pr-triage/pr-triage.test.ts --coverage 2>&1 | tail -40 \
  && cd .. \
  && wc -l runtime/agents/pr-triage/README.md \
  && grep -E '^\[gh-token\]=' runtime/deploy/provision-credentials.sh \
  && grep -E '^LoadCredentialEncrypted=iago-gh-token:' runtime/deploy/iago-os-v2-daemon.service \
  && grep -E 'fileName:\s*"iago-gh-token"' runtime/daemon/cred-bootstrap.ts \
  && grep -F 'v2-gh-token' runtime/migration/02-cutover-runbook.md
```

Expected:
- `tsc --noEmit` exit 0
- All listed test files pass; pr-triage.test.ts ≥9 tests
- Coverage ≥80% on new TS surface (main.ts wiring delta + pr-triage test paths)
- README 160-280 lines
- All 4 gh-token cross-plan surfaces verified present

## Stress Test

**Verdict:** PROCEED (carried forward from original Plan 04 stress test, scoped to 04b tasks only)
**Date:** 2026-05-18 (pre-emptive split; original stress 2026-05-17)
**Reviewer:** orchestrator inline (carve-out)

### Critical (must fix in impl)

- **C1 — gh-token cross-plan surfaces must align.** 04b Task 2 verifies 5 surfaces have gh-token correctly placed. If 01a ships first and Task 2 fails on 03b's cutover-runbook (because 03b hasn't landed yet), this plan blocks. depends_on chain [01a, 01b, 03b is NOT in depends_on for 04b!] — wait, this is a real dependency issue. 04b dispatches in Wave 3 after 03b is merged (03b is in Wave 2). So by the time 04b runs the verify, 03b's cutover-runbook is on main. depends_on chain is conservative: 04b depends_on [04a, 07a, 07b] — but Task 2 also reads from 03b's cutover-runbook. **Fix:** Update 04b depends_on to include 03b. Or: relax Task 2 to skip the cutover-runbook grep with a warning if the runbook doesn't exist yet (degraded verification). Choose the depends_on update — it's the cleaner contract. UPDATED: depends_on = [04a, 03b, 07a, 07b].
- **C2 — Wave-3 dispatch ordering.** 04b dispatches after 04a + 07a + 07b + 03b ALL merge. That means 04b is one of the last plans in Wave 3. The pipeline + Santiago merge cadence must respect this — dispatcher (orchestrator) sequences Wave 3 plans against the merge state, not just dependency order on paper.

### Important (forward to impl, don't block)

- **I1 — CronScheduler + AgentManager polling-loop both start in Task 3 wire-up.** Both subsystems are co-dependent: scheduler subscribes to AgentManager's `task-resolved` event (07a Task 1) on construction; AgentManager's polling loop emits that event (07b Task 1) on claimTask. Construction order in main.ts: AgentManager first (07b ensures EventEmitter contract), THEN CronScheduler (subscribes), THEN `agentManager.startPollingLoop()` + `scheduler.start()` in either order (idempotent).
- **I2 — Integration test mock for `node-pty`.** Phase 1 has the canonical pattern in `runtime/agent-runtime/pty/claude-pty.test.ts`. Task 4 explicitly says "copy the `vi.mock('node-pty')` block from there for consistency" (I5 carry-over).
- **I3 — `runtime/agents/README.md` deferral.** Original Plan 04 M1 noted this; pr-triage is the first agent, so a one-liner runtime/agents/README.md could exist. Deferred — Phase 3 introduces more agents.

### Minor

- M1 — README cost estimate ($0.70/week pre-skip, ~$0.40/week post-skip) is a guess until Phase 8 cost ledger lands.
- M2 — pr-triage.test.ts uses `vi.useFakeTimers()` to advance past 14:00 UTC. Be careful: if the test framework's default fake-timer date is 1970-01-01, `Date.UTC(1970, 0, 1, 14, 0)` matches the cron expression cleanly. Document the chosen base date in test file header.

### Dimension-by-dimension verdicts (04b scope)

- **Precision:** All 4 tasks have file paths + actions + verify + expected. Cross-plan grep verifications (Task 2) are exact and fail-loud.
- **Edge cases:** C1 (gh-token cross-plan) covered by depends_on update + Task 2 grep. PL-4 / pr-triage test 9 closes the decrement chain end-to-end.
- **Contradictions:** 04b ships the cross-plan wire-up + verification; 04a ships the artifacts; 07a/07b ship the scheduler+polling primitives; 01a/01b ship the deploy + cred bridge. Each plan owns one slice.
- **Simpler alternatives:** Could integrate the cron-scheduler wire-up inside 04a. REJECTED — wiring touches daemon code (main.ts), not agent artifacts. Clean separation matches the 04a/04b split's reason for being.
- **Missing acceptance criteria:** 04b satisfies migration-scope § 1 criteria 1, 2, 3 directly. Criterion 4 (crash recovery) is tested via Task 4 case 4 + relies on Phase 1 heartbeat-driven restart. Criterion 5 (cost ≤$0.50/week via Phase 8 ledger) is OUT of Phase 2 scope (Phase 8 work); README Task 1 § 7 documents the deferral. Criterion 6 (Santiago acts on ≥1 message in 7 days) is a behavioral signal, observed-not-tested — surface in Phase 6 dashboard.

### Implementer forward-list

1. Update depends_on to include 03b (C1 fix — already reflected in frontmatter above).
2. Verify gh-token across 5 surfaces via Task 2 grep set (C1 enforcement).
3. Construction order in main.ts: AgentManager → CronScheduler → both `start()` methods (I1 wiring).
4. Test 9 closes the decrement chain end-to-end (PL-4 from 07b + cron-overlap-prevented from 07a + claimTask emit from 07b).
