---
phase: feature-phase-2-vps-bootstrap
plan: 07a
wave: 1
depends_on: []
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-18
source: feature
split_from: 07-cron-scheduler-subsystem
split_rationale: Pre-emptive split per .iago/decisions/2026-05-18-phase-2-split-and-dispatch.md to stay within 80-turn pipeline ceiling. 07a ships the CronScheduler class + tests + README (Tasks 1, 2, 5 of original 07); 07b ships the AgentManager polling extension + tests + OpenClaw cron inventory (Tasks 3, 4, 6).
---

# Plan: feature-phase-2-vps-bootstrap/07a-cron-scheduler

## Goal

Ship the cron-scheduler subsystem that fires registered cron entries on a 60s tick, runs optional wake-check scripts, and emits task files atomically into `tasks/pending/`. Three deliverables: (1) `cron-scheduler.ts` — `CronScheduler` class with an inline 5-field POSIX cron parser (no `node-cron` dep — avoids dep bloat for Phase 2), overlap prevention via `runningCount` map + `task-resolved` event subscription on `AgentManager`, atomic tmp-rename task file emission, full telemetry; (2) `cron-scheduler.test.ts` — ≥12 Vitest cases covering parser branches (8 cases) + scheduler lifecycle (4+ cases) + overlap prevention + decrement chain; (3) `cron-scheduler.README.md` documenting the public API, cron syntax, lifecycle, and the 5+ telemetry kinds emitted. The `task-resolved` decrement chain that closes the runningCount loop is split across 07a (subscribe) and 07b (emit); 07b's `AgentManager.claimTask` extension provides the emit side — without 07b, `runningCount` never decrements and `maxConcurrent` permanently blocks after the first cron-fire. The 07a+07b pair must both ship before Plan 04 can wire the scheduler into `startDaemon`. Source of truth: `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` § 1 (PR-triage cron contract) + `.iago/research/2026-05-16-v2-operational-migration-scope.md` § 4 (cron schema including `maxConcurrent`).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/daemon/cron-scheduler.ts` | `CronScheduler` class + inline 5-field cron parser + wake-check + task emission |
| create | `runtime/daemon/cron-scheduler.test.ts` | ≥12 Vitest cases covering parser branches + scheduler lifecycle + overlap + decrement |
| create | `runtime/daemon/cron-scheduler.README.md` | Public API + cron syntax + lifecycle + telemetry kinds reference |

## Tasks

### Task 1: Author cron-scheduler.ts (parser + scheduler core)

- **files:** `runtime/daemon/cron-scheduler.ts`
- **action:** Strict TS, named export `class CronScheduler`. Constructor signature: `constructor(opts: { agentManager: AgentManager; fileBus: FileBus; stateRoot: string; logger?: Logger })`. Public API: `registerCron(opts: { agentId: string; schedule: string; wakeCheck?: string; promptTemplatePath: string; outputTaskNamePrefix: string; maxConcurrent?: number }): void` (maxConcurrent defaults to 1 if omitted — Codex P1-8 fix carrying migration-scope § 4 schema); `start(): void` (idempotent — second call is no-op); `stop(): Promise<void>` (awaits in-flight tick). Implementation: inline 5-field POSIX cron parser as a pure function `matchesCron(expr: string, now: Date): boolean` handling `*` (any), integer literals, ranges `1-5`, step `*/15` AND `1-30/5` (step with range), comma lists `1,3,5`, and combinations. NO third-party cron parser dep. Internal state: private `runningCount: Map<agentId, number>` (incremented on cron-fired, **decremented via the `task-resolved` EventEmitter event on `AgentManager`** — see 07b Task 1: 07b adds `claimTask(filename, agentId)` to `AgentManager` which emits `'task-resolved'` with `{ agentId, filename }` when a task file is moved from `pending/` to `resolved/`; the `CronScheduler` constructor subscribes: `agentManager.on('task-resolved', ({ agentId }) => { runningCount.set(agentId, Math.max(0, (runningCount.get(agentId) ?? 0) - 1)); })`. **Phase 1 `AgentManager` does NOT have this hook — 07b creates it.** Without this subscription, `runningCount` only increments and `maxConcurrent` permanently blocks after the first cron-fire; this is the production-breaking failure the review flagged). The scheduler uses `setInterval` with 60s tick; on each tick it iterates registered crons, runs `matchesCron` against `new Date()`; if match → **(0) OVERLAP CHECK (Codex P1-8 fix):** if `runningCount.get(agentId) ?? 0 >= maxConcurrent`, emit `cron-overlap-prevented { agentId, schedule, runningCount, maxConcurrent }` telemetry and SKIP the spawn (return early); → (a) if `wakeCheck` defined, `spawnSync('bash', [wakeCheck], { env: process.env, encoding: 'utf8', timeout: 30000 })`; emit `cron-skipped { agentId, reason: 'wake-check-failed', exitCode }` telemetry on exit ≠ 0 and return; (b) read `promptTemplatePath` via `fs.readFileSync(...)`; (c) write `<stateRoot>/tasks/pending/<outputTaskNamePrefix>__<unix>.json` with body `{ prompt, agentId, needsApproval: false }` using `fs.writeFileSync` + tmp-rename for atomicity (Windows-safe pattern from Phase 1 file-bus); (d) increment runningCount + emit `cron-fired { agentId, schedule, taskFile, runningCount }`. Stop semantics: clear the interval, await any in-flight `spawnSync` (use a private boolean flag — refuse new ticks while a tick is mid-flight; if `stop` called mid-tick, await its completion). NO `any`, NO `as` casts (use Zod-or-handwritten type guards for the JSON parse). NO `setInterval` leak (clear the handle in `stop`). Also export `matchesCron` directly so Task 2 parser tests can import it without spinning up a full scheduler; JSDoc the export as `@internal — exported for test access only; do not use from outside the daemon module.` File 220-380 lines.
- **verify:** `cd runtime && npx tsc --noEmit && grep -E "^export (class|function|const)" daemon/cron-scheduler.ts`
- **expected:** `tsc --noEmit` exit 0. `CronScheduler` exported. `matchesCron` exported (so test file can import directly).

### Task 2: Author cron-scheduler.test.ts (≥12 cases)

- **files:** `runtime/daemon/cron-scheduler.test.ts`
- **action:** Vitest test file. Use `vi.useFakeTimers()` for scheduler-tick tests. Test cases (≥12 mandatory): PARSER (8 cases): (1) `* * * * *` matches every minute; (2) `0 14 * * *` matches at 14:00 UTC and not at 14:01 or 13:00; (3) `*/15 * * * *` matches at :00 :15 :30 :45 and not at :07; (4) `0 0 * * 1-5` matches Mon-Fri midnight, NOT Sat/Sun; (5) `1,3,5 * * * *` matches at minutes 1, 3, 5 only; (6) `0 0 1-7 * 1` POSIX day-OR-weekday semantics: matches when EITHER `1-7` day-of-month OR `Mon` weekday matches (document the chosen semantics in cron-scheduler.ts JSDoc); (7) `0 9-17/2 * * *` matches at 9, 11, 13, 15, 17 UTC; (8) malformed `bogus expression` throws `RangeError` with the offending field named. SCHEDULER LIFECYCLE (4+ cases): (9) `start()` called twice is no-op (interval not duplicated — assert `setInterval` invocation count via `vi.spyOn`); (10) `stop()` clears the interval AND awaits an in-flight tick (spy on `clearInterval`); (11) tick fires `wakeCheck` via mocked `child_process.spawnSync`; exit 0 → task file written, `cron-fired` event emitted; exit 1 → no task file, `cron-skipped` event emitted with reason; (11b) wake-check that sleeps 35s (mock `spawnSync` returns with `signal: 'SIGKILL'`) → `cron-skipped { reason: 'wake-check-timeout', exitCode: null }` emitted (Task 1 C2 fix carrier); (12) tick fires WITHOUT wakeCheck → task file written unconditionally; `cron-fired` emitted; OVERLAP + DECREMENT (2 cases): (13) overlap path — register a cron with `maxConcurrent: 1`, manually set `runningCount.set('pr-triage', 1)` (via test access or pre-fire one tick), advance timer to next matching tick → assert NO `spawnSync` call AND `cron-overlap-prevented { agentId: 'pr-triage', runningCount: 1, maxConcurrent: 1 }` telemetry emitted; (14) decrement path — instantiate `CronScheduler` with a mock `AgentManager` that extends `EventEmitter`; after a cron-fire pushes `runningCount` to 1, emit `agentManager.emit('task-resolved', { agentId: 'pr-triage', filename: 'pr-triage__1700000000.json' })` → assert `runningCount.get('pr-triage') === 0` AND next matching tick fires successfully (no `cron-overlap-prevented` event for that tick). File 220-340 lines.
- **verify:** `cd runtime && npx vitest run daemon/cron-scheduler.test.ts --coverage --reporter=verbose 2>&1 | tail -25`
- **expected:** All ≥12 tests pass (parser 8 + lifecycle 4 + overlap/decrement 2 = 14). Coverage on `cron-scheduler.ts` ≥80% lines, ≥80% branches.

### Task 3: Author cron-scheduler.README.md

- **files:** `runtime/daemon/cron-scheduler.README.md`
- **action:** Public API + lifecycle + telemetry kinds reference. Sections: (1) Purpose — "60s-tick scheduler that fires registered cron entries → optional bash wake-check → atomic task-file write → telemetry. Used by Phase 2+ agents that want cron-driven dispatch (e.g., pr-triage daily 14:00 UTC)."; (2) Public API — copy the TS signatures from cron-scheduler.ts (3 methods); explicitly note `maxConcurrent` defaults to 1; (3) Cron expression syntax — 5-field POSIX, supported features (`*`, integers, ranges `1-5`, step `*/15` and `1-30/5`, comma lists `1,3,5`); document the day-vs-weekday POSIX-OR semantics decision (whatever Task 1 picked); document setInterval drift acceptable to ±59s (matches by minute); (4) Lifecycle — instantiate → registerCron(...) per agent → start() → ... → stop() (idempotent + awaits in-flight). Wire to `AgentManager` via constructor injection; scheduler subscribes to `agentManager.on('task-resolved', ...)` for runningCount decrement; the emit side ships in 07b; (5) Telemetry kinds emitted — table: `cron-fired { agentId, schedule, taskFile, runningCount }`, `cron-skipped { agentId, reason, exitCode? }` (reason ∈ `wake-check-failed | wake-check-timeout`), `cron-overlap-prevented { agentId, schedule, runningCount, maxConcurrent }`. Cross-link to the agent-manager polling-loop kinds that ship in 07b: `task-resolved`, `task-poisoned`, `task-unrouted`, `polling-loop-error`; (6) Failure modes — table: wake-check script missing executable bit → spawnSync returns exit 126 → cron-skipped emitted; wake-check exceeds 30s → SIGKILL'd → cron-skipped with `reason: 'wake-check-timeout'`; prompt-template missing → caught + emitted as `cron-fired-prompt-missing`; stateRoot `tasks/pending/` not writable → caught + emitted as `cron-fired-write-failed`; (7) Wiring example (the snippet Plan 04b Task 3 reuses verbatim — see 07b for matching `AgentManager.startPollingLoop` call site). File 120-200 lines.
- **verify:** `wc -l runtime/daemon/cron-scheduler.README.md && grep -c "^## " runtime/daemon/cron-scheduler.README.md && grep -c "cron-fired\|cron-skipped\|cron-overlap-prevented\|registerCron" runtime/daemon/cron-scheduler.README.md`
- **expected:** Line count 120-200. ≥6 top-level sections. ≥6 references to public API/telemetry symbols.

## Verification

```bash
cd runtime && npx tsc --noEmit \
  && npx vitest run daemon/cron-scheduler.test.ts --coverage --reporter=verbose 2>&1 | tail -30 \
  && cd .. \
  && wc -l runtime/daemon/cron-scheduler.README.md
```

Expected:
- `tsc --noEmit` exit 0
- `cron-scheduler.test.ts` ≥12 tests pass (parser 8 + lifecycle 4 + overlap/decrement 2); ≥80% line + branch coverage on `cron-scheduler.ts`
- `cron-scheduler.README.md` 120-200 lines

## Stress Test

**Verdict:** PROCEED (carried forward from original Plan 07 stress test, scoped to 07a tasks only)
**Date:** 2026-05-18 (pre-emptive split; original stress 2026-05-17)
**Reviewer:** orchestrator inline (carve-out)

### Critical (must fix in impl)

- **C1 — POSIX day-vs-weekday OR semantics undefined.** Task 1 picks "day OR weekday" (POSIX standard) but spec § 1 only specifies `0 14 * * *` which collapses both to `*`. The first agent that registers `0 0 1-7 * 1` (first Monday of month) will hit the OR semantics — `1-7` matches 1st-7th of every month AND `Mon` matches every Monday — combined yields "1st-7th of any month OR any Monday", NOT "the first Monday only". **Fix:** Document the POSIX-OR semantics explicitly in the JSDoc of `matchesCron` AND in cron-scheduler.README.md § 3. If an agent author wants "first Monday only", they must use the workaround pattern documented in the README (e.g., wakeCheck script that exits 1 unless day-of-month is 1-7 AND day-of-week is Monday). Test case (6) in Task 2 enforces the documented behavior with a fixture assertion.
- **C2 — `spawnSync` blocks the 60s tick.** If a wake-check script takes >60s, the next tick fires before this one finishes, AND `spawnSync` blocks the Node event loop — telemetry emit + task-file writes queued after it stall. **Fix:** Set a hard `timeout: 30000` on the `spawnSync` call (Task 1 already specifies this); document in README § 6 that wake-checks MUST complete in <30s or they're SIGKILL'd. If a kill occurs, emit `cron-skipped { agentId, reason: 'wake-check-timeout', exitCode: null }`. Test case (11b) in Task 2 enforces.
- **C3 — `task-resolved` decrement hook is split across 07a + 07b.** 07a subscribes; 07b emits. If 07b ships AFTER 07a but Plan 04 wires CronScheduler before 07b lands, `runningCount` permanently blocks. **Fix:** Plan 04b `depends_on: [04a, 07a, 07b]` enforces ordering. The chore PR's wave document also notes 07b must land before any consumer of CronScheduler wires its registerCron call.

### Important (forward to impl, don't block)

- **I1 — `setInterval` drift on long-running daemon.** Node `setInterval` is best-effort; long ticks shift the next call. For a 60s tick this is negligible (sub-second drift). For pr-triage's `0 14 * * *` schedule, drift can push a tick from 13:59:58 to 14:00:02 (still matches the 14:00 minute) — acceptable. Document in README § 3 that the scheduler matches by minute, so up to 59s of drift is fine.
- **I2 — Telemetry event schema not formally defined.** Phase 1 has a loose NDJSON shape (`{ ts, kind, ...extras }`). Cron-scheduler emits 4+ new kinds in 07a (cron-fired, cron-skipped, cron-overlap-prevented). **Fix:** Task 3 README § 5 enumerates each kind with its `extras` keys. No schema-enforcement library added (matches Phase 1 telemetry posture). Phase 3+ may introduce Zod schema; out of scope here.
- **I3 — Test file imports `matchesCron` directly — leaks internal API.** Task 1 says export `matchesCron` so tests can import it. This is a sin against encapsulation but the alternative (testing only through `start/stop` + clock advancement) makes parser unit tests intractable. **Fix:** JSDoc `matchesCron` as `/** @internal — exported for test access only; do not use from outside the daemon module. */`.

### Minor

- M1 — `runtime/daemon/cron-scheduler.README.md` is a new doc file co-located with the source — matches `.claude/rules/mcp-server-patterns.md` README convention. Consistent with Phase 1 patterns.
- M2 — Inline cron parser at ~80 LOC is large enough to consider a separate file (`cron-parser.ts`). REJECTED for Phase 2 — keeping inline avoids over-modularization. Phase 3+ may split if parser grows past 200 LOC with timezone support.

### Dimension-by-dimension verdicts (07a scope)

- **Precision:** All 3 tasks have file paths + actions + verify commands + expected output. No "TBD".
- **Edge cases:** C1 (POSIX OR semantics), C2 (wake-check timeout) cover the non-obvious parser/runtime failures. C3 documents the cross-plan emit/subscribe coupling.
- **Contradictions:** 07a owns CronScheduler authoring; 07b extends AgentManager. No code duplication. Plan 04b consumer waits on `depends_on: [04a, 07a, 07b]`.
- **Simpler alternatives:** Could pull `node-cron` as a dep — REJECTED per Phase 2 dep-bloat constraint. Could keep CronScheduler + AgentManager extension in one plan — REJECTED per pre-emptive split (original Plan 07 was 6 tasks, hit Phase 1 ceiling pattern).
- **Missing acceptance criteria:** 07a has no direct spec § 10 criterion link (those owned by Plans 01a–05b). 07a is implementation infrastructure that 07b extends and Plan 04b consumes. Acceptance is "07b lands, then Plan 04b Task 3 wire-up compiles + integration test passes" + "this plan's own Vitest suite passes."

### Implementer forward-list

1. Document POSIX day-vs-weekday OR semantics in `matchesCron` JSDoc + README § 3 (C1 fix).
2. Add `spawnSync` 30s timeout + `cron-skipped { reason: 'wake-check-timeout' }` event + test case (C2 fix).
3. JSDoc `matchesCron` as `@internal` (I3 fix).
4. README § 5 enumerates all 4+ telemetry kinds with `extras` keys (I2 partial).
5. `task-resolved` subscription in CronScheduler constructor MUST tolerate the `agentManager` not yet having the emit side (defensive: subscription is no-op until 07b's emit happens). Without 07b shipped, integration tests will block in Plan 04b — that's by design; the dependency chain enforces order.
