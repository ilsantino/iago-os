---
phase: feature-phase-1-deferred-hardening
plan: 03b
wave: 3
depends_on: [03]
context: .iago/plans/feature-phase-1-deferred-hardening/CONTEXT.md
created: 2026-05-17
source: feature
split_from: 03-coverage-pass-main-and-bot
---

# Plan: feature-phase-1-deferred-hardening/03b-coverage-pass-bot

## Goal

Complete the coverage pass for `runtime/telegram/bot.ts` from 70.22% to ≥80% lines + 75% branches, and close out the Phase 1 evidence template. This plan picks up tasks 4–6 of the original 03 plan; tasks 1–3 (main.ts coverage) landed as `feat/b-03-main-coverage` (PR forthcoming on that branch). The split was forced by the original 03 hitting the 80-turn implementation budget; six tasks crossing two files was too dense for one fresh session.

Source of truth: original plan `03-coverage-pass-main-and-bot.md` tasks 4–6 + forward-list items 1, 3, 4, 5; `runtime/PHASE-1-EVIDENCE.md` block 2; PR #45 review I1/I3/I4/I5/I7/I8/I9/I10/I11/I12/I13 + C1/C2/C3.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| edit | `runtime/telegram/bot.test.ts` | Extend with ~17 tests covering previously-uncovered branches (PR #45 C1/C2/C3 + I1/I3/I4/I5/I7/I8/I9/I10/I11/I12/I13) |
| edit | `runtime/telegram/bot.ts` | Apply any PR #45 Important fix not already landed in source (per Task 1 audit findings) |
| edit | `runtime/telegram/approval-bus.ts` | Apply PR #45 I10 `assertSafeIdentifier(approvalId)` if not already landed |
| edit | `runtime/telegram/approval-bus.test.ts` | Regression test for I10 path-traversal approvalId rejection (if fix applied) |
| edit | `runtime/PHASE-1-EVIDENCE.md` | Block 2 coverage table refreshed; rationale rewritten to point at this feature folder instead of "PR #47 coverage pass" |

## Tasks

### Task 1: Audit uncovered branches in bot.ts + approval-bus.ts

- **files:** none (analysis-only — write findings into Task 2 design)
- **action:** Run `cd runtime && npx vitest run --coverage 2>&1 | tail -80` and parse the v8 coverage output for `telegram/bot.ts`. Identify uncovered branches and cross-reference against PR #45 review: (a) chat-type check (C1); (b) `/inject` control-byte filter + 2048-byte length cap (C2); (c) empty-allowlist constructor throw (C3); (d) `from === undefined` silent-drop (I1); (e) `stop()` removeAllListeners + stopPolling failure log (I3); (f) per-dispatch try/catch in `handleMessage` / `handleCallbackQuery` (I4); (g) `answerCallbackQuery` on rejection paths (I5); (h) bot token inspect-redactor (I7); (i) PII-redacted rejection log using hash-of-id, not raw id (I8); (j) `sendApprovalRequest` chat-allowlist validation (I9); (k) `approvalId` `assertSafeIdentifier` in command/callback paths (I10 — touches `approval-bus.ts`); (l) malformed pending file logging in `listPendingApprovals` (I11); (m) Telegram 4096-char reply chunking (I12); (n) `polling_error` handler (I13). For each item produce a one-line "landed in source: yes/no" classification. Items classified "no" become source edits in Task 2. CRITICALLY: if C1, C2, or C3 are classified "not landed", that contradicts the Phase 1 brief ("Criticals landed in-place") → escalate via NEEDS_CONTEXT before proceeding.
- **verify:** `cd runtime && npx vitest run --coverage 2>&1 | grep -E "bot\.ts.*[0-9]" | head -1`
- **expected:** Current `bot.ts` line coverage confirmed (~70.22% or close). Audit summary written into the implementation session log; every PR #45 item has a landed/not-landed verdict.

### Task 2: Apply non-landed source fixes + extend bot.test.ts

- **files:** `runtime/telegram/bot.test.ts`, `runtime/telegram/bot.ts` (only if Task 1 audit shows source missing a fix), `runtime/telegram/approval-bus.ts` (I10 if not landed), `runtime/telegram/approval-bus.test.ts` (I10 regression if fix applied)
- **action:** For each Task 1 item classified "not landed", apply the fix per the PR #45 review specification before writing the test. Then add ~17 new tests to `bot.test.ts`:
  1. `"non-private chat type rejects silently with stderr log"` (C1)
  2. `"/inject with control bytes returns parse-error reply"` (C2)
  3. `"/inject payload exceeding 4096 bytes (INJECT_TEXT_LIMIT) is rejected with explicit reply"` (C2)
  4. `"empty allowedUserIds in constructor throws RangeError"` (C3)
  5. `"message with from === undefined is silently dropped"` (I1)
  6. `"stop() calls removeAllListeners before nulling bot reference"` (I3)
  7. `"stop() with stopPolling throwing still nulls the reference + logs"` (I3)
  8. `"handleMessage parse exception surfaces stderr + telegram-handler-error telemetry"` (I4)
  9. `"callback query from non-allowed user calls answerCallbackQuery with Not authorized"` (I5)
  10. `"callback parse failure calls answerCallbackQuery with Invalid callback"` (I5)
  11. `"util.inspect(bot) redacts the token field"` (I7)
  12. `"rejection log emits hash of user id, not raw id"` (I8)
  13. `"sendApprovalRequest with chatId not in allowedUserIds throws"` (I9)
  14. `"resolveApproval/waitForApproval reject path-traversal approvalIds"` (I10 — goes in `approval-bus.test.ts`, not bot.test.ts)
  15. `"listPendingApprovals logs malformed pending file to stderr + emits approval-malformed telemetry"` (I11)
  16. `"sendMessage reply >4000 chars chunks into 2 messages"` (I12)
  17. `"polling_error handler logs to stderr + emits polling-error telemetry"` (I13)
  Apply forward-list item 3: add per-test `beforeEach` reset of any mock arrays/maps Task 2 introduces, to prevent cross-test pollution (PR #46 review FORWARD #2 pattern).
- **verify:** `cd runtime && npx vitest run telegram/ --coverage --reporter=verbose 2>&1 | tail -40`
- **expected:** ≥17 new tests pass across bot.test.ts + approval-bus.test.ts. `bot.ts` coverage ≥80% lines + ≥75% branches. `approval-bus.ts` coverage does not regress.

### Task 3: Update Phase 1 evidence template + verify the floor

- **files:** `runtime/PHASE-1-EVIDENCE.md`
- **action:** Edit block 2 — replace the coverage table with the new run's output (paste fresh `cd runtime && npx vitest run --coverage 2>&1 | tail -40` block). Update the rationale paragraph at the lines that currently say "flagged for PR #47 coverage pass" → "coverage pass landed in feature-phase-1-deferred-hardening/03 + 03b — main.ts and bot.ts now meet the ≥80% floor." Keep markdown table formatting consistent with surrounding blocks. The test-count line should reflect the new total (current ~321 + ~17 new from this plan + tests already added by plan 03 tasks 1-3 on `feat/b-03-main-coverage`).
- **verify:** `cd runtime && npx vitest run --coverage 2>&1 | tail -40 && grep -cE "PR #47 coverage pass|coverage pass landed in feature-phase-1-deferred-hardening" PHASE-1-EVIDENCE.md`
- **expected:** Coverage report shows `main.ts` ≥80% AND `bot.ts` ≥80% lines. grep count ≥1 for the new rationale text AND 0 for "PR #47 coverage pass".

## Verification

```bash
cd runtime \
  && npx tsc --noEmit \
  && npx vitest run --coverage 2>&1 | tail -40 \
  && grep -E "main\.ts|bot\.ts" coverage/coverage-summary.json 2>/dev/null \
  || (cd runtime && npx vitest run --coverage 2>&1 | grep -E "main\.ts|bot\.ts")
```

Expected:
- `tsc --noEmit` exits 0
- Vitest pass count ≥338 (321 prior + ≥17 new from this plan)
- `bot.ts` line coverage ≥80%
- `main.ts` line coverage ≥80% (carried in from plan 03 tasks 1-3 on `feat/b-03-main-coverage`)
- No regression on any other file's coverage

## Stress Test

**Verdict:** PROCEED
**Date:** 2026-05-17
**Reviewer:** orchestrator inline split-derived from parent 03 stress test

This plan inherits the stress-test analysis from the parent 03 plan (tasks 4–6). All forward-list items from the parent plan that apply to bot.ts coverage are folded into Task 1's audit + Task 2's source-fix gate:

- **Parent C1** (Important fixes not landed in source → apply in source as part of Task 5) → Task 1 audit + Task 2 source-edit branch.
- **Parent C2** (Critical fixes if not landed contradict brief) → Task 1 NEEDS_CONTEXT escalation rule.
- **Parent I3** (per-test `beforeEach` reset to prevent pollution) → Task 2 forward-list item.
- **Parent I4** (verify covers `telegram/` not just `telegram/bot.test.ts`) → Verification command uses `telegram/` glob.
- **Parent I1** (shutdownStageTimeoutMs) → N/A for this split; lives in `feat/b-03-main-coverage`.

No new risks introduced by the split. Plan 04 and 05 file surfaces remain undisturbed (parent's stress check confirmed Plan 05 does not touch `approval-bus.ts`; if Task 1 audit reveals a contradiction it escalates via NEEDS_CONTEXT).
