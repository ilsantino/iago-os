---
phase: feature-phase-1-deferred-hardening
plan: 03
wave: 3
depends_on: [02]
context: .iago/plans/feature-phase-1-deferred-hardening/CONTEXT.md
created: 2026-05-17
source: feature
---

# Plan: feature-phase-1-deferred-hardening/03-coverage-pass-main-and-bot

## Goal

Lift `runtime/daemon/main.ts` from 62.89% to ≥80% lines + 75% branches; lift `runtime/telegram/bot.ts` from 70.22% to ≥80% lines + 75% branches. Both files are entry-point / wire-up code dominated by branches that fire only under real-runtime conditions (daemon startup with real Claude binary, Telegram polling against real bot token). The hello-world integration test exercises the live paths but residual uncovered branches are error-handling around platform-specific edge cases. PR #46 review FORWARD #1 explicitly flagged this for a "PR #47 coverage pass" — this is that pass.

Source of truth: `runtime/PHASE-1-EVIDENCE.md` block 2 coverage table (note lines 105-111 explicitly flag main.ts 62.89% + bot.ts 70.22% as below floor with rationale "flagged for PR #47 coverage pass"); PR #46 review FORWARD #1 ("Acceptance criterion #2 (≥80% coverage) — unverifiable from PR diff alone").

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/daemon/main.test.ts` | Unit tests for `loadPersistedConfigs`, `withTimeout`, `buildFleetHealth`, `getShapeForAgent`, `injectIntoAgent`, `findHandleForAgent`, `resolveSessionId`, `isDirectlyExecuted`, plus startup error paths via mocked `loadConfig` + filesystem stubs |
| edit | `runtime/telegram/bot.test.ts` | Extend with tests for previously-uncovered branches: group-chat rejection (PR #45 C1), control-byte sanitization in /inject (PR #45 C2), empty-allowlist throw (PR #45 C3), inspect-redactor (PR #45 I7), per-dispatch unhandled-rejection guard (PR #45 I4), callback `answerCallbackQuery` on rejection paths (PR #45 I5), 4096-char reply chunking (PR #45 I12), polling_error handler (PR #45 I11), chat-validate on sendApprovalRequest (PR #45 I9) |
| edit | `runtime/integration/hello-world.test.ts` | Extend integration suite with one new test that drives `main()` once through `startDaemon` + `shutdownPromise` to cover the main()-orchestration path (the path Codex C1 fixed via direct-execution guard) |
| edit | `runtime/PHASE-1-EVIDENCE.md` | Block 2 coverage table updated with main.ts ≥80% + bot.ts ≥80%; the "flagged for PR #47 coverage pass" rationale paragraph rewritten to "coverage pass landed in feature-phase-1-deferred-hardening/03 — both files now meet the ≥80% floor" |

## Tasks

### Task 1: Audit uncovered branches in main.ts

- **files:** none (analysis-only — write findings into Task 2 + Task 3 design)
- **action:** Run `cd runtime && npx vitest run --coverage --reporter=verbose 2>&1 | tail -80` and parse the v8 coverage report for `daemon/main.ts`. Identify the uncovered branches by reading the HTML coverage report at `runtime/coverage/index.html` (or the json report at `runtime/coverage/coverage-final.json` if HTML is too slow to parse). Expected uncovered branches (from review notes): (a) `loadPersistedConfigs` ENOENT path + readdir error + read error + parse error + missing-field path + env field non-object guard; (b) `withTimeout` timeout firing branch; (c) `buildFleetHealth` + `getShapeForAgent` + `findHandleForAgent` + `injectIntoAgent` empty-handle path + throw path; (d) `resolveSessionId` env-set vs derived branch; (e) `isDirectlyExecuted` argv1 undefined + pathToFileURL throw branches; (f) shutdown error-swallow branches on each `withTimeout` wrapper (heartbeat.stop / bot.stop / ipcServer.stop / shutdownAgent failures); (g) auto-start loop's post-spawn `if (shuttingDown)` branch + the catch swallow; (h) `claude-pty` registration warning branch; (i) `main()` startup-error branch (writes `error:` to stderr). Document the list in this task's verify output but write NO code.
- **verify:** `cd runtime && npx vitest run --coverage 2>&1 | grep -E "main.ts.*[0-9]" | head -1`
- **expected:** Current main.ts coverage line confirms 62.89% (or close — if the merge train moved it slightly, document the current number).

### Task 2: Write `runtime/daemon/main.test.ts` for pure-function coverage

- **files:** `runtime/daemon/main.test.ts`
- **action:** Vitest test file targeting the 9 pure-helper exports + the wire branches. Tests by helper:
  - `loadPersistedConfigs`: (1) ENOENT on readdir → returns empty Map; (2) non-ENOENT errno on readdir → logs to stderr + returns empty; (3) entry without `.json` extension → skipped; (4) read error on a file → logged + continues to next file; (5) JSON parse error → logged + continues; (6) parsed non-object → skipped; (7) missing required field (agentId / runtimeId / cwd / sessionId) → logged + skipped; (8) valid record with env object (string values only) → included with env normalized; (9) env non-object → empty env in result.
  - `withTimeout`: (1) op resolves within timeout → returns op's value; (2) op exceeds timeout → returns `"timeout"` + writes stderr warning; (3) timer cleanup happens via finally.
  - `buildFleetHealth`: (1) empty handles → empty array; (2) two handles → returns 2 objects with all 5 mapped keys present.
  - `getShapeForAgent`: (1) match → returns shape; (2) no match → returns null.
  - `findHandleForAgent`: (1) match → handle; (2) no match → null.
  - `injectIntoAgent`: (1) no handle → throws `"no live handle for agent: <id>"`; (2) handle present → calls `runtime.send(handle, {kind:"inject", payload:{text}})`.
  - `resolveSessionId`: (1) env var set + non-empty → returns env; (2) env var unset → returns `${agentId}-session`; (3) env var empty string → returns derived (per `length > 0` guard).
  - `isDirectlyExecuted`: (1) `process.argv[1]` undefined → false; (2) argv[1] equals `import.meta.url` URL → true; (3) `pathToFileURL` throws → false.
  Use `vi.mock("node:fs/promises", ...)` for filesystem control. Use `vi.spyOn(process.stderr, "write")` to assert error-log emission. Use `vi.useFakeTimers()` for the `withTimeout` test ONLY (no `net` interaction). Avoid mocking `node:url` — use real `pathToFileURL`. Aim for ≥30 unit tests in this file.
- **verify:** `cd runtime && npx vitest run daemon/main.test.ts --coverage --reporter=verbose 2>&1 | tail -40`
- **expected:** All new tests pass (≥30 — pure-function path). Coverage of `daemon/main.ts` rises substantially (target: from 62.89% to ≥85% lines via this file alone; Task 3 covers the remainder via integration extension).

### Task 3: Extend integration suite for startDaemon wire-path coverage

- **files:** `runtime/integration/hello-world.test.ts`
- **action:** Add 3-4 new `it` blocks that exercise the remaining uncovered main.ts branches:
  - (i) `"startDaemon emits cleanShutdowns + crashes telemetry from bootRecovery"` — pre-populate `pathFor("agents")` with two `<handleId>.json` files; one corresponding marker present (clean), one absent (crash); call startDaemon; assert the two `agent-exited` telemetry events were emitted with correct reasons.
  - (ii) `"startDaemon shutdown swallows per-stage failures"` — inject a mock heartbeat whose `.stop()` throws; assert daemon.shutdown() still completes; assert the stderr stream received the heartbeat-stop error log; assert `daemon-stop` telemetry was still emitted.
  - (iii) `"startDaemon shutdown bounds each stage at SHUTDOWN_STAGE_TIMEOUT_MS"` — inject a mock heartbeat whose `.stop()` hangs (returns a Promise that never resolves); use real timers; expect `daemon.shutdown()` to complete within ~10s + small buffer; assert the timeout-warning stderr log includes "heartbeat.stop". Use a smaller timeout via a constructor option if exposing it is cheap (otherwise expect the 10s real-time wait — acceptable in CI).
  - (iv) `"daemon emits warning when claude-pty adapter is not registered"` — `vi.mock("../agent-runtime/registry.js")` to return an empty `listRuntimes()`; assert the stderr warning was emitted; assert daemon still starts successfully.
- **verify:** `cd runtime && npx vitest run integration/ --coverage --reporter=verbose 2>&1 | tail -40`
- **expected:** All new integration tests pass alongside existing 6. Combined with Task 2, main.ts coverage ≥80% lines + ≥75% branches per Vitest v2 threshold config.

### Task 4: Audit uncovered branches in bot.ts

- **files:** none (analysis-only — write findings into Task 5 design)
- **action:** Same coverage report parse as Task 1, scoped to `telegram/bot.ts`. Expected uncovered branches (cross-referenced against PR #45 review): (a) chat-type check (PR #45 C1 fix landed in-place — needs test); (b) `/inject` control-byte filter + length cap (PR #45 C2 fix landed — needs test); (c) empty-allowlist constructor throw (PR #45 C3 fix landed — needs test); (d) `from === undefined` silent-drop branch (PR #45 I1); (e) `stop()` removeAllListeners + stopPolling failure log (PR #45 I3); (f) per-dispatch try/catch in `handleMessage` / `handleCallbackQuery` (PR #45 I4); (g) `answerCallbackQuery` on rejection paths (PR #45 I5); (h) bot token inspect-redactor (PR #45 I7); (i) PII-redacted rejection log path (PR #45 I8 — uses hash-of-id, not raw id); (j) `sendApprovalRequest` chat-allowlist validation (PR #45 I9); (k) `approvalId` `assertSafeIdentifier` in command/callback paths (PR #45 I10); (l) malformed pending file logging in `listPendingApprovals` (PR #45 I11); (m) Telegram 4096-char reply chunking (PR #45 I12); (n) `polling_error` handler (PR #45 I13). The audit confirms which PR #45 Important fixes already landed in source vs which still need landing (the brief asserts Criticals were fixed; this audit verifies Important status per file).
- **verify:** `cd runtime && npx vitest run --coverage 2>&1 | grep -E "bot.ts.*[0-9]" | head -1`
- **expected:** Current bot.ts coverage line confirms 70.22% (or close).

### Task 5: Write tests in bot.test.ts for previously-uncovered branches

- **files:** `runtime/telegram/bot.test.ts`
- **action:** Extend with ~15 new tests covering the Task 4 audit list. For any fix that did NOT land in source (per Task 4 audit), apply the fix in `runtime/telegram/bot.ts` (or `runtime/telegram/approval-bus.ts` for approvalId guards) per the corresponding PR #45 review section, then add the regression test. Test names: (1) `"non-private chat type rejects silently with stderr log"`; (2) `"/inject with control bytes returns parse-error reply"`; (3) `"/inject payload exceeding 2048 bytes truncates with explicit reply"`; (4) `"empty allowedUserIds in constructor throws RangeError"`; (5) `"message with from === undefined is silently dropped"`; (6) `"stop() calls removeAllListeners before nulling bot reference"`; (7) `"stop() with stopPolling throwing still nulls the reference + logs"`; (8) `"handleMessage parse exception surfaces stderr + telegram-handler-error telemetry"`; (9) `"callback query from non-allowed user calls answerCallbackQuery with Not authorized"`; (10) `"callback parse failure calls answerCallbackQuery with Invalid callback"`; (11) `"util.inspect(bot) redacts the token field"`; (12) `"rejection log emits hash of user id, not raw id"`; (13) `"sendApprovalRequest with chatId not in allowedUserIds throws"`; (14) `"resolveApproval/waitForApproval reject path-traversal approvalIds"`; (15) `"listPendingApprovals logs malformed pending file to stderr + emits approval-malformed telemetry"`; (16) `"sendMessage reply >4000 chars chunks into 2 messages"`; (17) `"polling_error handler logs to stderr + emits polling-error telemetry"`.
- **verify:** `cd runtime && npx vitest run telegram/bot.test.ts --coverage --reporter=verbose 2>&1 | tail -40`
- **expected:** ≥17 new tests pass; bot.ts coverage ≥80% lines + ≥75% branches.

### Task 6: Update Phase 1 evidence template + verify the floor

- **files:** `runtime/PHASE-1-EVIDENCE.md`
- **action:** Edit block 2 — replace the coverage table with the new run's output (paste fresh `npx vitest run --coverage` table). Update the rationale paragraph at lines ~105-111: change from "flagged for PR #47 coverage pass" to "coverage pass landed in feature-phase-1-deferred-hardening/03 — both main.ts and bot.ts now meet the ≥80% floor." Keep the test-count line consistent with the new totals (will rise by ~50 tests across this plan + Plans 01/02/04/05).
- **verify:** `cd runtime && npx vitest run --coverage 2>&1 | tail -40 && grep -c "PR #47 coverage pass\|coverage pass landed in feature-phase-1-deferred-hardening" PHASE-1-EVIDENCE.md`
- **expected:** Coverage table at the bottom of vitest output shows main.ts ≥80% AND bot.ts ≥80%. The PHASE-1-EVIDENCE.md text references the new feature folder (1 hit) and NO longer references "PR #47 coverage pass" (0 hits).

## Verification

```bash
cd runtime \
  && npx tsc --noEmit \
  && npx vitest run --coverage 2>&1 | tail -40 \
  && grep -E "main.ts|bot.ts" coverage/coverage-summary.json 2>/dev/null \
  || (npx vitest run --coverage 2>&1 | grep -E "main\\.ts|bot\\.ts")
```

Expected:
- `tsc --noEmit` exits 0
- Vitest cumulative pass count ≥320 (was ~296 after Phase 1)
- `main.ts` line coverage ≥80%
- `bot.ts` line coverage ≥80%
- No regression on any other file's coverage

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-17
**Reviewer:** orchestrator inline (5-dimension rubric per `.claude/rules/skill-authoring.md` § 2)

### Critical (must fix in impl)

- **C1 — Test 17 (`polling_error`) AND Test 6 (`stop() removeAllListeners`) require source changes that PR #45 review classified as Important fixes that should have landed in the merge train but the brief explicitly states only Criticals landed.** Re-confirm in Task 4 audit: if these fixes did NOT land in source, applying them in Task 5 is in-scope (the plan explicitly says "For any fix that did NOT land in source ... apply the fix"). Make this explicit in the Task 5 action: "do NOT skip the source fix — apply it AND add the regression test, per PR #45 review." This avoids a half-state where the test asserts behavior not present in source and silently passes only because the test isn't truly exercising the path.
- **C2 — Test 4 (empty-allowlist constructor throw) depends on PR #45 C3 fix being in source.** If the merge train's "Criticals fixed in-place" claim is correct, this fix is already in bot.ts. If not, Task 5 must apply the fix. Use the Task 4 audit to confirm. If audit shows source NOT throwing on empty allowlist, that's a Critical not-yet-landed (contradicts the brief) → escalate to Santiago via NEEDS_CONTEXT during impl, do NOT silently re-classify.

### Important (forward to impl, don't block)

- **I1 — Integration test for shutdown-hang (Task 3 iii) takes ~10s real-time which slows the suite.** Mitigation: introduce a `shutdownStageTimeoutMs?` constructor option on `startDaemon` (similar to the `idleTimeoutMs` pattern in Plan 01) so the test can pass `50` and complete in <200ms. Default stays 10s for production. Add the option to `DaemonConfig` (extend the config schema) with a sane default; doc as test-affordance.
- **I2 — Coverage report parse in Task 1 + Task 4 may need `--coverage.reporter=json-summary` to make grepping cheap.** Default Vitest v8 reporter writes both text + html + json; `coverage-summary.json` is the easiest target. Add `"json-summary"` to `vitest.config.ts` reporter array IF not already there. (It's not — current reporter is `["text", "json", "html"]`. Add `"json-summary"`.) Mark this as a Task 0.5 mini-edit to vitest config — included under Plan 04 instead since that plan owns vitest config changes; Plan 03 can use `grep` on the text reporter output as Task 1/4 currently do.
- **I3 — bot.test.ts mocks share state across `it` blocks via module-level structures (per PR #46 review FORWARD #2 about hello-world.test.ts).** Task 5 should add per-test `beforeEach` reset of any mock arrays/maps it introduces so this expansion does not inherit the same cross-test pollution pattern.
- **I4 — Task 5 mentions adding fixes for I10 (`assertSafeIdentifier(approvalId)`) which touches `runtime/telegram/approval-bus.ts`, not bot.ts.** Acceptable — both files are in Plan 03's edit set per file-disjoint analysis (Plan 05 doesn't touch approval-bus.ts). But the verify should cover approval-bus.test.ts too: `npx vitest run telegram/`.

### Minor

- M1 — Task 6's evidence-doc edit uses paste-fresh output; ensure the pasted block keeps the existing markdown table formatting (column widths, separators). The vitest text reporter output is reasonably stable but minor formatting drift can break renderers. Re-verify by re-rendering the markdown after paste.
- M2 — Task 2's pure-function test count target (≥30) is aspirational. The actual number depends on how many sub-cases per helper land (e.g., the loadPersistedConfigs helper alone has 9 listed → 9 tests; resolveSessionId has 3; etc.). Target ≥25 is also acceptable if the coverage floor is met.

### Dimension-by-dimension verdicts

- **Precision:** Each helper has an explicit per-test list with input + expected output. The vitest reporter parsing strategy is named explicitly.
- **Edge cases:** C1 + C2 cover the audit-vs-fix dependency; I1 covers slow-suite hazard; I3 covers test-pollution hazard.
- **Contradictions:** Plan claims "Plan 03 wave 3 file-disjoint with Plan 05" but Task 5 touches approval-bus.ts (per I4 above). Confirm Plan 05 does NOT also touch approval-bus.ts — if it does, the wave grouping must change OR Plan 05's approval-bus edits move into Plan 03.
- **Simpler alternatives:** Could skip the helper unit tests entirely and rely on growing the integration suite. REJECTED — integration tests are slow + coarse-grained per `.claude/rules/tdd.md`; pure-helper coverage is the right tool for `loadPersistedConfigs` + `withTimeout` etc. Plus the helper coverage rises faster per test than integration suite extensions.
- **Missing acceptance criteria:** Task 6 updates the evidence template; the coverage floor is the gate. Both files explicitly named in the goal statement match the verify command's grep targets.

### Implementer forward-list

1. Task 4 audit MUST classify each PR #45 Important fix as "landed in source" vs "not landed"; apply non-landed fixes in source as part of Task 5 (C1 + C2 fix).
2. Add `shutdownStageTimeoutMs?` constructor option for Task 3 iii (I1 fix). Default 10s; tests pass 50ms.
3. Per-test `beforeEach` mock reset in expanded bot.test.ts (I3 fix).
4. Verify command in Task 5 covers `telegram/` not just `telegram/bot.test.ts` (I4 fix).
5. Confirm Plan 05 does NOT also edit `runtime/telegram/approval-bus.ts` — if it does, reshuffle Plan 03 vs Plan 05 wave grouping (cross-plan contradiction fix).
