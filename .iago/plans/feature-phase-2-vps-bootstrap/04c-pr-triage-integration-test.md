---
phase: feature-phase-2-vps-bootstrap
plan: 04c
wave: 3
depends_on: [04a, 04b, 04d, 07a, 07b]
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-25
revised: 2026-05-25
source: feature
split_from: 04b-pr-triage-wiring-and-test
split_rationale: Carved out of 04b on 2026-05-25 after three dispatch failures (API ConnectionRefused at 2h, max-turns 80 at 17min, 1800s wall-clock kill at 30min). 04b's original Task 4 alone is a 280-480 line Vitest with 9 cases plus `node-pty` + `fetch` mocking — combined with 04b's README (160-280 lines) and main.ts wiring it exceeds both pipeline ceilings (80 turns AND 30 min). Splitting Task 4 into its own dispatch lets each session fit the budgets. 04c depends on 04b (main.ts must have CronScheduler wired before the integration test can exercise the full stack). 2026-05-25 update: PR #76 dual aggressive adversarial review carved the dispatch handler into new Plan 04d; 04c's `depends_on` adds 04d because the integration test cases 2, 4, 5 exercise the full cron-tick → claude-pty spawn → Telegram POST flow that 04d wires.
---

# Plan: feature-phase-2-vps-bootstrap/04c-pr-triage-integration-test

## Goal

Ship the pr-triage end-to-end integration test that proves Shape 1 PTY adapter can run the full workflow (cron-fired → wake-check → claude-pty → curl-to-Telegram → exit clean) with mocks for external dependencies. Single deliverable: `runtime/agents/pr-triage/pr-triage.test.ts` — Vitest integration test exercising the FULL flow (wake-check stubbed, claude-pty mocked via `vi.mock('node-pty')` per Phase 1 pattern, curl-to-Telegram intercepted via `fetch` mock). 9 test cases covering happy path, all known failure modes, and the end-to-end decrement chain that bridges 07a + 07b + 04a + 04b. Source of truth: `.iago/research/2026-05-16-v2-operational-migration-scope.md` § 1 + § 4. This plan is the closing brace for Phase 2's first-real-workflow.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/agents/pr-triage/pr-triage.test.ts` | Integration test: mock gh + telegram, assert end-to-end |

## Tasks

### Task 1: pr-triage integration test

- **files:** `runtime/agents/pr-triage/pr-triage.test.ts`
- **action:** Vitest test that exercises the FULL pr-triage flow with mocks. Setup: temp state-root, mock `child_process.spawnSync` for the wake-check bash script (returns exit 0 + count > 0), mock `node-pty` for claude-pty spawn (Phase 1 pattern — copy the `vi.mock('node-pty')` block from `runtime/agent-runtime/pty/claude-pty.test.ts` for consistency per I5 carry-over from original Plan 04), mock `fetch` (or `child_process` for the curl invocation depending on how the prompt-template's curl-direct pattern is exercised) to intercept the Telegram sendMessage POST and record calls. Test cases: (1) wake-check returns 1 (zero PRs) → cron-scheduler (07a) emits `cron-skipped { reason: 'wake-check-failed' }`; no claude-pty spawned; no curl-to-Telegram invoked; (2) wake-check returns 0 (PRs exist) + claude-pty receives the prompt + agent issues the direct curl POST to `https://api.telegram.org/bot<TOKEN>/sendMessage` → assert curl was invoked exactly once with: correct chat_id (first ID from `IAGO_TELEGRAM_ALLOWED_USER_IDS`), correct bot token in URL path, `parse_mode=MarkdownV2`, and the summary markdown in the `text` field; assert HTTP-200 simulated response causes the agent to exit cleanly with no fallback task file written; (3) wake-check fails (exit code 2) → cron-skipped emitted with `reason: "wake-check-failed"` and `exitCode: 2` (CronScheduler emits wake-check-failed for all non-zero non-signal exits — there is no rate-limited variant); (4) claude-pty mid-run crash (mock emits "error" event) → heartbeat-driven restart per Phase 1 (assert restart called); (5) Telegram sendMessage returns HTTP 429 → agent writes fallback task file at `tasks/pending/pr-triage__<unix>.json` with `ndjsonAlert: "pr-triage-telegram-send-failed"` and HTTP-status + truncated response body in details; daemon's polling loop (07b) picks up the task and emits a `pr-triage-telegram-send-failed` telemetry event; the fallback task file is moved to `tasks/resolved/` via 07b's claimTask after telemetry emission; (6) wake-check missing GH_TOKEN env → exits 1 with stderr message → cron-skipped with `reason: "wake-check-failed"`; (7) crons.json schedule never matches in the 60s test window → no spawns; (8) crons.json with `schedule: null` → cron NOT registered; (9) **end-to-end decrement chain** (bridges 07a + 07b + 04a + 04b): two consecutive ticks with `maxConcurrent: 1`; first tick fires cron-fired, second tick before claimTask completes → `cron-overlap-prevented` emitted; after polling-loop claims first task → `task-resolved` emitted → second matching tick fires successfully without overlap-prevented. Use `vi.useFakeTimers()` to manipulate clock past 14:00 UTC for the matching tests. File 280-480 lines.
- **verify:** `cd runtime && npx vitest run agents/pr-triage/pr-triage.test.ts --reporter=verbose 2>&1 | tail -30`
- **expected:** All 9 test cases pass.

## Verification

```bash
cd runtime && npx tsc --noEmit \
  && npx vitest run agents/pr-triage/pr-triage.test.ts --coverage 2>&1 | tail -40
```

Expected:
- `tsc --noEmit` exit 0
- pr-triage.test.ts ≥9 tests pass
- Coverage ≥80% on the integration-test surface

## Stress Test

**Verdict:** PROCEED (single-task carve-out from 04b — original 04 stress test carries through, scoped to Task 4 only)
**Date:** 2026-05-25 (carve-out)
**Reviewer:** orchestrator inline

### Critical (must fix in impl)

- **C1 — 04b must be merged before 04c dispatches.** 04c's Task 1 exercises the CronScheduler wiring that 04b lands in main.ts. If 04c dispatches before 04b merges, the integration test references a wiring path that doesn't exist on main yet. Dispatcher orders: 04b → merge → 04c.

### Important (forward to impl, don't block)

- **I1 — Integration test mock for `node-pty`.** Phase 1 has the canonical pattern in `runtime/agent-runtime/pty/claude-pty.test.ts`. Task 1 explicitly says "copy the `vi.mock('node-pty')` block from there for consistency" (I5 carry-over from original Plan 04).
- **I2 — Fake timer base date.** `vi.useFakeTimers()` defaults to 1970-01-01. `Date.UTC(1970, 0, 1, 14, 0)` matches the cron expression cleanly. Document the chosen base date in test file header.

### Minor

- M1 — The 9-case taxonomy is opinionated. Future agents may add cases for new failure modes (e.g., systemd restart loop, file-bus contention). Treat the 9 cases as the floor, not the ceiling.

### Dimension-by-dimension verdicts (04c scope)

- **Precision:** Single task with file path + action + verify + expected.
- **Edge cases:** All 9 failure modes from migration-scope are enumerated.
- **Contradictions:** None — 04c is purely additive; no edits to other plans' surfaces.
- **Simpler alternatives:** Could ship 5 cases instead of 9 (drop overlap-prevented + schedule-null tests). REJECTED — the decrement chain test (case 9) is the only place in the test pyramid where 07a + 07b + 04a + 04b cross-validate; dropping it leaves the whole stack untested end-to-end.
- **Missing acceptance criteria:** Same migration-scope § 1 criteria covered by 04b — 04c just adds the test runtime that validates them.

### Implementer forward-list

1. Copy `vi.mock('node-pty')` from `runtime/agent-runtime/pty/claude-pty.test.ts` (I1).
2. Document fake-timer base date in test file header (I2).
3. Test 9 is the integration anchor — do not skip even under time pressure.
