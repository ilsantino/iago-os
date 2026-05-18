Now I have full picture. Writing the review.

# Adversarial Review (Opus 4.7): PR #51

**Verdict:** APPROVE_WITH_NOTES
**Plan(s) reviewed against:** `.iago/plans/feature-phase-1-deferred-hardening/03-coverage-pass-main-and-bot.md`
**Diff size (PR commit `d7f7ab7` only):** 816 insertions / 52 deletions across 4 files
*(Note: `pr51-diff.patch` against `origin/main` also contains stacked commits c5707d7 / e6ffc2c from PRs #49 + #50 — those were reviewed separately; this review is scoped to `d7f7ab7`.)*

## Critical
- *None.* Diff is pure test/wiring; no auth surface, no data persistence path, no concurrency primitive added.

## Important
- **I1 — `shutdownStageTimeoutMs` added to `DaemonConfig` but `loadConfig()` does not parse it from file.** `runtime/daemon/config.ts:61-68` declares the optional field, but `loadConfig()` (lines 310-383) constructs the returned object from `{telegram, agents, heartbeat, ipc}` only — `shutdownStageTimeoutMs` is never read from `file.payload`. Effect: an operator who writes `"shutdownStageTimeoutMs": 5000` into `runtime/daemon-config.json` gets a silent no-op (the field is stripped at parse time, default 10s applies). The plan's stress note I1 explicitly said "extend the config schema". The docstring at config.ts:62-67 calls it "test-affordance" so the omission is *intentional* but the operator-facing footgun is real. **Recommendation:** either (a) extend `FilePayload` + `loadConfig()` to round-trip the value, or (b) tighten the docstring to "ignored if set in JSON; programmatic injection only." Marking Important rather than Critical because the production default still works correctly.

## Minor
- **M1 — Plan scope partial vs claimed.** Plan 03 has 6 tasks; PR delivers tasks 1-3 (main.ts coverage half + I1 fix). Tasks 4-5 (bot.ts coverage) and task 6 (PHASE-1-EVIDENCE.md update) are explicitly deferred per the commit subject "B-03 partial — main.ts coverage tasks 1-3 of 6". The plan's stated Verification clause (`main.ts ≥80% AND bot.ts ≥80%`) and the goal sentence are NOT met by this PR alone. Acceptable under Santiago's stacked-PR norm for distinct deliverables, but reviewer of any *merge* of this PR must ensure follow-up PRs for tasks 4-6 are queued — otherwise Phase 1 evidence-doc rationale ("flagged for PR #47 coverage pass") stays stale.
- **M2 — Internal helpers exported solely for testing widen the module's public API.** `withTimeout`, `SHUTDOWN_STAGE_TIMEOUT_MS`, `buildFleetHealth`, `getShapeForAgent`, `findHandleForAgent`, `injectIntoAgent`, `resolveSessionId`, `isDirectlyExecuted`, `loadPersistedConfigs` are now exported from `runtime/daemon/main.ts`. Acceptable for test-coverage strategy (alternative is `vi.mocked` of internal symbols, which is messier), but no `@internal` JSDoc tag or `__` prefix signals these aren't part of the daemon's caller-facing contract. Cheap mitigation: add `/** @internal */` to each newly-exported helper.
- **M3 — `isDirectlyExecuted` empty-argv-string test is platform-conditional and the assertion accepts both arms** (`main.test.ts:576-588`). Comment acknowledges Windows vs POSIX divergence on `pathToFileURL("")`. The assertion `expect(result).toBe(false)` happens to hold on both arms (POSIX throws → caught → false; Windows might return cwd URL → string mismatch → false). Fine as-is, but if Node ever changes the Windows behavior to return main's URL the test silently flips meaning. Cheap mitigation: split into POSIX-skip + Windows-skip variants with explicit asserts.
- **M4 — Integration test for shutdown-hang leaks the heartbeat interval.** `hello-world.test.ts:744-746` mocks `heartbeat.stop` to return `new Promise<void>(() => undefined)` (never resolves). The withTimeout wrapper correctly bounds the wait, but the underlying `setInterval` inside the `HeartbeatController` is never `clearInterval`'d because `.stop()` was the only path that did so. With `intervalMs: 60_000` and a per-test runtime well under 60s, the interval doesn't actually fire during the suite — but the timer ref keeps the worker alive at process exit. Not a correctness bug, but on CI with `--forceExit=false` it could lengthen worker teardown. Cheap mitigation: in `afterEach`, restore the mock via `vi.restoreAllMocks()` (already called implicitly when daemon goes out of scope, but explicit is clearer) or use `vi.useFakeTimers()` for this test only.

## Dimension verdicts
- Auth/security: PASS — no auth surface touched; the 8 newly-exported helpers are pure or thin wrappers (`injectIntoAgent` forwards `text` through `runtime.send` with no string concat into shell/path/sql; `isDirectlyExecuted` catches `pathToFileURL` throws including NUL-byte input verified by test).
- Data loss: PASS — no persistence path changed; `loadPersistedConfigs` behavior identical to pre-PR (just newly exported).
- Concurrency: PASS — `withTimeout` finally-block timer cleanup verified by new test 313-319; `Promise.race` semantics for op-reject vs timer-win covered by tests 297-311 + 321-331; per-stage timeout option threaded correctly via `stageTimeoutMs` local at main.ts:335-336.
- Rollback: PASS — `shutdownStageTimeoutMs?` is optional with 10s default; no on-disk state shape change; no migration; old config files load unchanged.
- Plan compliance: PARTIAL — tasks 1-3 of 6 land here; tasks 4-6 deferred per commit subject. Plan's full Verification clause requires bot.ts ≥80% which this PR alone cannot satisfy.
- Code quality: PASS_WITH_NOTES — I1 (config parser gap) + M2 (`@internal` markers) are the only quality dings; no dead code, no magic numbers added, no error swallowing introduced.
- Test quality: PASS — 30 new pure-function tests have concrete assertions on returned values AND on stderr log content; integration tests assert telemetry events by `kind + handleId + reason`, not just presence; per-test `tempDir + ensureStateDirsSync()` isolates filesystem state; `_resetRegistryForTests()` paired with `registerRuntime(claudePty)` in beforeEach prevents cross-test pollution.

## Notes
- This PR is the head of a 3-commit stack: `e6ffc2c` (PR #49, IPC hardening), `c5707d7` (PR #50, atomic-rename audit), `d7f7ab7` (this PR). The pr51-diff.patch artifact shows all three; review-against-base must subtract the prior two. Merging order must be #49 → #50 → #51 to avoid carrying the stacked diffs through to a chore PR.
- Plan stress note C1 ("apply non-landed PR #45 Important fixes in source") is out of scope here — that work belongs to tasks 4-5 (bot.ts half) which this PR defers.
- The PHASE-1-EVIDENCE.md line in pr51-diff.patch stat (`runtime/PHASE-1-EVIDENCE.md | 2 +-`) is from a stacked commit, NOT from `d7f7ab7`. Task 6 (evidence-doc update) is still outstanding.
- Recommendation for the next PR in stack: combine tasks 4-5 + 6 in a single follow-up (`feat/b-03-bot-coverage`) so the plan closes cleanly and PHASE-1-EVIDENCE.md updates land with the bot.ts numbers, not separately.
