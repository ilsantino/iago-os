# Adversarial Review (Opus 4.7): PR #56

**Verdict:** APPROVE_WITH_NOTES
**Plan(s) reviewed against:** `.iago/plans/feature-phase-1-deferred-hardening/05-minor-and-forward-sweep.md`
**Diff size:** PR-scope commit `3b4598f`: 441 insertions / 12 deletions across 12 files (branch diff vs main is larger because it includes prior stacked commits e6ffc2c / c5707d7 / d7f7ab7 / 1dc6499 / 6ed4fcc whose changes already merged into main separately).

## Critical
- None. Landed code introduces no auth bypass, data-loss, or race regression.

## Important
- **I1 — PR body misrepresents Task 2/5/6 completion.** PR body says "Tasks 1, 2, 5, 6 of 8" landed; in reality the commit (`git show 3b4598f --stat`) touches **no** `ipc-server.ts`, **no** `telemetry.ts`, **no** `daemon/README.md`, **no** `claude-pty.md`, **no** `migration/phase-1-rollback.md`. Concretely the missing sub-items within "landed" tasks:
  - Task 2: adv-pr42 M3 (`trackHandle` onStatusChanged-throw JSDoc), adv-pr42 M5 (`cascadeShutdownChildren` sequential JSDoc), adv-pr44 M3 (`ipc-server` single-instance JSDoc), adv-pr44 M5 (ipc-server internal-error redaction + test).
  - Task 5: adv-pr44 M2 (telemetry header table), adv-pr44 M4 (UTC midnight test), adv-pr44 F4 (event size cap forward note), adv-pr42 F3 (cost-tap-after-teardown `console.warn` in `agent-manager.applyCostEvent` + test), adv-pr41 F3 (`state-paths.atomicRename` Windows-race comment).
  - Task 6: only `telegram/README.md` "Dependency audit" subsection landed; daemon/README "Phase 1 trust model" + "Windows process-tree cleanup", claude-pty.md "Known limitations" bullets, phase-1-rollback.md runtime-checks grep — all missing.
  - Task 1 M4: `flushTicks` helper got a docstring + default bump 5→10 but the plan-mandated migration of ~35 call sites to `waitForFile` / `waitForSendMessage` / `vi.waitFor` was not done. Only NEW tests use `waitForSendMessage`.

  **Recommendation:** Either land the missing items before merge, or rewrite the PR body to list each unlanded sub-item explicitly so the follow-up plan (`feat/b-05b-*`) doesn't re-do landed work or skip unlanded items. Per `.iago/learnings` and the Garry-impressed-standard, silent partial completion within a "landed" task is the failure mode this style of accounting is supposed to prevent.

- **I2 — adv-pr44 M5 ipc-server error redaction is a real (small) information leak the plan explicitly scoped to this PR.** The current `ipc-server.ts` returns the raw thrown error text to clients; an attacker on the local socket (or any code that becomes a tenant in Phase 7) can probe handler internals via crafted inputs. The plan landed it under "Defensive code patches", not "Forward". Not deferring this with the rest of Task 5 was the correct call; not landing it at all is not.

- **I3 — Two M5 truncation tests are vacuously asserted on the gate path.** `bot.test.ts:1530+` `/abort` and `/status` M5 tests use `expect((quoted?.[1] ?? "").length).toBeLessThanOrEqual(64)`. In the shape-gate rejection path the reply is `"Rejected: agent not registered: <slice>"` — no quotes — so `reply.match(/"([^"]+)"/)` returns `null`, the assertion evaluates `"".length <= 64` → trivially true regardless of whether M5 was applied. The single non-vacuous assertion is `expect(reply).not.toContain(longAgent)`. A future refactor regressing the slice in `commands.ts:206/235/241` (NOT the gate path used here, but the dispatchAbort/dispatchStatus `validateAgentId` failure path) would keep these tests green. **Recommendation:** mirror the `/inject` test pattern by giving the mock manager a registered handle matching `longAgent`'s ID prefix OR add `expect(quoted).not.toBeNull()` and route the test through the `dispatchAbort` validateAgentId branch (uppercase agent → gate sees "pty" → reaches dispatchAbort → validateAgentId fails → reply has quotes).

## Minor
- **M1 — M5 truncation location deviates from plan.** Plan said apply `slice(0, 64)` in `bot.ts dispatchInject`; impl applied it in `commands.ts:206/235/241` (`isCommandAvailableForShape` reason text) AND `bot.ts:542/576/629` (`validateAgentId` failure replies). Functionally equivalent for all current dispatch surfaces, but a future dispatcher that reflects `command.agent` without going through `isCommandAvailableForShape` or `validateAgentId` (e.g., a hypothetical `/send` for Phase 3 Shape 2+) would inherit the bug. Minor because Phase 1 has no such surface.

- **M2 — `dispatchStart` (`bot.ts:474`) echoes `command.agent` unsliced and pre-shape-gate.** `Phase 1 hello-world: agent "${command.agent}" must be pre-registered...` — for unregistered agents the gate rejects first (so `dispatchStart` is unreachable); for registered ones the ID is bounded by `^[a-z][a-z0-9-]{0,62}$`. Safe today. Note for Phase 3+ when `/start` becomes a real dynamic spawn: this echo needs the same `slice(0, 64)` treatment.

- **M3 — `/inject` tab-as-separator regressed.** Old `tokens.slice(2).join(" ")` worked when the user typed `/inject<TAB>agent<SPACE>text` because `tokenize` split on `\s+`. New `afterCmd.indexOf(" ")` only finds a literal space. `/inject claude-main\thello\tworld` (tab between agent and text) returns `missing argument: text`. Acceptable per plan wording but undocumented in tests; the new "preserves tabs in payload" test verifies tabs WITHIN the payload, not as agent/text separator.

- **M4 — `isAlive` `idle` → `true` is a defensible but undocumented choice.** PTY may sit `idle` for hours; reporting "Alive: true" via `/status` matches process-liveness but not work-liveness. JSDoc says "the runtime considers the process alive even when blocked on input" — acceptable. Phase 3+ Shape 2 (HTTP/SDK) may need a stricter mapping.

## Dimension verdicts
- **Auth/security:** PASS — `/inject` whitespace-preserving slice does not change the downstream sanitizer chain; `INJECT_TEXT_LIMIT` cap and control-byte stripping unchanged.
- **Data loss:** PASS — no on-disk write changes in the landed commit beyond JSDoc.
- **Concurrency:** PASS — `getLastStatus`/`isAlive` are synchronous reads of `this.handles.get(handleId)?.lastStatus`; tearing is impossible in single-threaded JS.
- **Rollback:** PASS — adding optional interface members + concrete impls is purely additive; old `AgentManagerInterface` consumers still satisfy the new interface.
- **Plan compliance:** FAIL — see I1; ~40% of plan scope is silently unlanded inside "landed" tasks.
- **Code quality:** PASS — JSDoc additions are accurate, switch on `StatusValue` is exhaustive over the union (`runtime/agent-runtime/types.ts:18`), no dead code introduced.
- **Test quality:** FAIL — see I3; two of the three M5 tests have a vacuous assertion that won't catch regressions in the path the plan was actually closing (`dispatchAbort`/`dispatchStatus` validateAgentId branch with quoted reply).

## Notes
- This branch is stacked on prior B-01..B-04 commits (`e6ffc2c`, `c5707d7`, `d7f7ab7`, `1dc6499`, `6ed4fcc`) that are independently merged via PRs #49/#50/#53; the patch file at `.iago/reviews/pr56-diff.patch` shows the full cumulative diff vs main but the actual PR-56 scope is the single commit `3b4598f`. Reviewer should not double-count those changes.
- Stress test C2 said "console.warn spy hygiene — per-test, not global" but the cost-tap-after-teardown warn + test are not landed at all, so C2 is moot for this PR — re-applies to the follow-up that lands Task 5.
- Stress test I4 (Task 7 exhaustiveness `default: never`) is deferred with Task 7. The landed `isAlive` switch in `agent-manager.ts:354-363` happens to be exhaustive today (all 5 `StatusValue` variants covered) but has no explicit `never` default — silently allows future StatusValue additions to fall through with implicit `undefined` return.
- The follow-up branch name in the PR body is `feat/b-05b-pty-and-type-tighten`; given the missing Task 5 (telemetry) + Task 6 (docs) + Task 2 (ipc-server redaction) + Task 1 M4 (flushTicks migration), the follow-up scope is substantially larger than "PTY and type tighten" — rename to reflect actual scope before opening that PR.
