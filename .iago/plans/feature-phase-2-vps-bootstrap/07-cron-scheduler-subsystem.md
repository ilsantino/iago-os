---
phase: feature-phase-2-vps-bootstrap
plan: 07
wave: 1
depends_on: []
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-17
source: feature
---

# Plan: feature-phase-2-vps-bootstrap/07-cron-scheduler-subsystem

## Goal

Author the cron-scheduler subsystem that Plan 04 (pr-triage agent) wires into the daemon. Carved out of Plan 04 Task 7 per pre-merge adversarial review C4 (split scope creep — cron-scheduler authorship + tests + agent-manager polling-loop are too large to live inside a pr-triage plan). Six deliverables: (1) `cron-scheduler.ts` — `CronScheduler` class with inline 5-field POSIX cron parser (no `node-cron` dep — avoids dep bloat for Phase 2), wake-check invocation, task-file emission, telemetry; (2) `cron-scheduler.test.ts` — ≥12 Vitest cases covering parser + scheduler behavior; (3) extend `agent-manager.ts` with the `tasks/pending/` polling loop deferred from Phase 1 Plan 07 stress M3; (4) extend `agent-manager.test.ts` with polling-loop cases; (5) `runtime/daemon/cron-scheduler.README.md` documenting the public API + lifecycle + telemetry kinds; (6) coordination note (Plan 04 Task 7 imports + wires; Plan 04 frontmatter sets `depends_on: [01, 07]`). Source of truth: `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` § 1 (PR-triage cron contract) + Phase 1 Plan 07 stress-test M3 polling-loop deferral.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/daemon/cron-scheduler.ts` | `CronScheduler` class + inline 5-field cron parser + wake-check + task emission |
| create | `runtime/daemon/cron-scheduler.test.ts` | ≥12 Vitest cases covering parser branches + scheduler lifecycle |
| edit | `runtime/daemon/agent-manager.ts` | Add `tasks/pending/` polling loop (5s tick) — Phase 1 Plan 07 stress M3 carry-over |
| edit | `runtime/daemon/agent-manager.test.ts` | Add ≥3 polling-loop cases (claim happy path, malformed task file, no-op-when-no-tasks) |
| create | `runtime/daemon/cron-scheduler.README.md` | Public API + lifecycle + telemetry kinds reference |

## Tasks

### Task 1: Author cron-scheduler.ts (parser + scheduler core)

- **files:** `runtime/daemon/cron-scheduler.ts`
- **action:** Strict TS, named export `class CronScheduler`. Constructor signature: `constructor(opts: { agentManager: AgentManager; fileBus: FileBus; stateRoot: string; logger?: Logger })`. Public API: `registerCron(opts: { agentId: string; schedule: string; wakeCheck?: string; promptTemplatePath: string; outputTaskNamePrefix: string; maxConcurrent?: number }): void` (maxConcurrent defaults to 1 if omitted — Codex P1-8 fix carrying migration-scope § 4 schema); `start(): void` (idempotent — second call is no-op); `stop(): Promise<void>` (awaits in-flight tick). Implementation: inline 5-field POSIX cron parser as a pure function `matchesCron(expr: string, now: Date): boolean` handling `*` (any), integer literals, ranges `1-5`, step `*/15` AND `1-30/5` (step with range), comma lists `1,3,5`, and combinations. NO third-party cron parser dep. Internal state: private `runningCount: Map<agentId, number>` (incremented on cron-fired, decremented when the agent-manager observes the corresponding task moved out of tasks/pending/ — wire via AgentManager's existing task-resolved event hook). The scheduler uses `setInterval` with 60s tick; on each tick it iterates registered crons, runs `matchesCron` against `new Date()`; if match → **(0) OVERLAP CHECK (Codex P1-8 fix):** if `runningCount.get(agentId) ?? 0 >= maxConcurrent`, emit `cron-overlap-prevented { agentId, schedule, runningCount, maxConcurrent }` telemetry and SKIP the spawn (return early); → (a) if `wakeCheck` defined, `spawnSync('bash', [wakeCheck], { env: process.env, encoding: 'utf8', timeout: 30000 })`; emit `cron-skipped { agentId, reason: 'wake-check-failed', exitCode }` telemetry on exit ≠ 0 and return; (b) read `promptTemplatePath` via `fs.readFileSync(...)`; (c) write `<stateRoot>/tasks/pending/<outputTaskNamePrefix>__<unix>.json` with body `{ prompt, agentId, needsApproval: false }` using `fs.writeFileSync` + tmp-rename for atomicity (Windows-safe pattern from Phase 1 file-bus); (d) increment runningCount + emit `cron-fired { agentId, schedule, taskFile, runningCount }`. Stop semantics: clear the interval, await any in-flight `spawnSync` (use a private boolean flag — refuse new ticks while a tick is mid-flight; if `stop` called mid-tick, await its completion). NO `any`, NO `as` casts (use Zod-or-handwritten type guards for the JSON parse). NO `setInterval` leak (clear the handle in `stop`). Add a Vitest test for the overlap path: fake-timers, register a cron with maxConcurrent=1, mock runningCount.set(agentId, 1) → trigger next tick that matches schedule → assert no spawnSync call + assert cron-overlap-prevented telemetry emitted. File 220-380 lines (was 200-350; +20-30 for overlap-check + runningCount plumbing).
- **verify:** `cd runtime && npx tsc --noEmit && grep -E "^export (class|function|const)" daemon/cron-scheduler.ts`
- **expected:** `tsc --noEmit` exit 0. `CronScheduler` exported. `matchesCron` exported (so test file can import directly).

### Task 2: Author cron-scheduler.test.ts (≥12 cases)

- **files:** `runtime/daemon/cron-scheduler.test.ts`
- **action:** Vitest test file. Use `vi.useFakeTimers()` for scheduler-tick tests. Test cases (≥12 mandatory): PARSER (8 cases): (1) `* * * * *` matches every minute; (2) `0 14 * * *` matches at 14:00 UTC and not at 14:01 or 13:00; (3) `*/15 * * * *` matches at :00 :15 :30 :45 and not at :07; (4) `0 0 * * 1-5` matches Mon-Fri midnight, NOT Sat/Sun; (5) `1,3,5 * * * *` matches at minutes 1, 3, 5 only; (6) `0 0 1-7 * 1` matches the first Monday-of-month-or-day-1-7 OR matches when EITHER day OR weekday matches per POSIX semantics (document the chosen semantics in cron-scheduler.ts JSDoc); (7) `0 9-17/2 * * *` matches at 9, 11, 13, 15, 17 UTC; (8) malformed `bogus expression` throws `RangeError` with the offending field named. SCHEDULER LIFECYCLE (4+ cases): (9) `start()` called twice is no-op (interval not duplicated — assert `setInterval` invocation count via `vi.spyOn`); (10) `stop()` clears the interval AND awaits an in-flight tick (spy on `clearInterval`); (11) tick fires `wakeCheck` via mocked `child_process.spawnSync`; exit 0 → task file written, `cron-fired` event emitted; exit 1 → no task file, `cron-skipped` event emitted with reason; (12) tick fires WITHOUT wakeCheck → task file written unconditionally; `cron-fired` emitted. File 200-300 lines.
- **verify:** `cd runtime && npx vitest run daemon/cron-scheduler.test.ts --coverage --reporter=verbose 2>&1 | tail -25`
- **expected:** All ≥12 tests pass. Coverage on `cron-scheduler.ts` ≥80% lines, ≥80% branches.

### Task 3: Extend agent-manager.ts with polling loop (Phase 1 Plan 07 stress M3 carry-over)

- **files:** `runtime/daemon/agent-manager.ts`
- **action:** Add a `startPollingLoop(opts?: { intervalMs?: number }): void` method (default 5000ms) and matching `stopPollingLoop(): Promise<void>`. Behavior: every `intervalMs` the loop calls `fs.readdir(<stateRoot>/tasks/pending/)`; for each `.json` file (sorted ascending by name, which embeds unix timestamp): (a) parse via `JSON.parse`; if malformed → move to `tasks/poisoned/` and emit `task-poisoned` telemetry, skip; (b) inspect `agentId` field; if no registered agent matches → leave the file in pending and emit `task-unrouted` telemetry once per filename (use an in-memory Set to suppress repeat); (c) if registered agent exists, call existing `claimTask(filename, agentId)` API (Phase 1 contract). The loop refuses overlapping ticks (boolean re-entrancy guard). Tick exceptions are caught + logged via telemetry `polling-loop-error`. `stop` clears the interval and awaits any in-flight tick. JSDoc explains: this is the production polling loop deferred from Phase 1 Plan 07 stress-test M3 (file-bus polling cadence). The wire-up (calling `startPollingLoop()` from `startDaemon`) is Plan 04 Task 7's responsibility. NO `any`, NO `as` casts.
- **verify:** `cd runtime && npx tsc --noEmit && grep -E "startPollingLoop|stopPollingLoop" daemon/agent-manager.ts`
- **expected:** `tsc --noEmit` exit 0. Both methods present.

### Task 4: Extend agent-manager.test.ts with polling-loop cases

- **files:** `runtime/daemon/agent-manager.test.ts`
- **action:** Add ≥3 new test cases preserving the Phase 1 baseline (whatever count exists today — do NOT remove or rewrite passing tests). New cases: (PL-1) happy path — manager has a registered agent `pr-triage`; a task file `pr-triage__1700000000.json` lands in `tasks/pending/` with a valid `agentId: "pr-triage"` body; one tick later `claimTask` was called exactly once with `(filename, "pr-triage")`; (PL-2) malformed JSON in `tasks/pending/` → file is moved to `tasks/poisoned/` and `task-poisoned` telemetry event emitted; pending dir no longer contains the file; (PL-3) `agentId` references unregistered agent → file stays in pending; `task-unrouted` telemetry emitted once even across multiple ticks (assert exactly 1 telemetry event for the same filename); (PL-4 optional but recommended) `stopPollingLoop` called mid-tick → awaits the in-flight tick before resolving. Use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(5000)` to drive the loop deterministically.
- **verify:** `cd runtime && npx vitest run daemon/agent-manager.test.ts --reporter=verbose 2>&1 | tail -25`
- **expected:** All Phase 1 baseline tests still pass + ≥3 new polling-loop tests pass.

### Task 5: Author cron-scheduler.README.md

- **files:** `runtime/daemon/cron-scheduler.README.md`
- **action:** Public API + lifecycle + telemetry kinds reference. Sections: (1) Purpose — "60s-tick scheduler that fires registered cron entries → optional bash wake-check → atomic task-file write → telemetry. Used by Phase 2+ agents that want cron-driven dispatch (e.g., pr-triage daily 14:00 UTC)."; (2) Public API — copy the TS signatures from cron-scheduler.ts (3 methods); (3) Cron expression syntax — 5-field POSIX, supported features (`*`, integers, ranges `1-5`, step `*/15` and `1-30/5`, comma lists `1,3,5`); document the day-vs-weekday POSIX-OR semantics decision (whatever Task 1 picked); (4) Lifecycle — instantiate → registerCron(...) per agent → start() → ... → stop() (idempotent + awaits in-flight); (5) Telemetry kinds emitted — table: `cron-fired { agentId, schedule, taskFile }`, `cron-skipped { agentId, reason, exitCode? }`, plus the agent-manager polling-loop kinds added in Tasks 3+4 (`task-poisoned`, `task-unrouted`, `polling-loop-error`); (6) Failure modes — table: wake-check script missing executable bit → spawnSync returns exit 126 → cron-skipped emitted; prompt-template missing → caught + emitted as `cron-fired-prompt-missing`; stateRoot tasks/pending/ not writable → caught + emitted as `cron-fired-write-failed`; (7) Wiring example (the snippet Plan 04 Task 7 reuses verbatim). File 120-200 lines.
- **verify:** `wc -l runtime/daemon/cron-scheduler.README.md && grep -c "^## " runtime/daemon/cron-scheduler.README.md && grep -c "cron-fired\|cron-skipped\|registerCron" runtime/daemon/cron-scheduler.README.md`
- **expected:** Line count 120-200. ≥6 top-level sections. ≥5 references to public API/telemetry symbols.

### Task 6: Generate openclaw-cron-inventory.json (Codex P1-7 fix)

- **files:** `runtime/migration/openclaw-cron-inventory.json`
- **action:** Per migration-scope § 4 acceptance gate. Per Phase 0 audit (`runtime/migration/00-vps-audit.md`), VPS has no crontab and no OpenClaw-owned systemd timers. This task creates `runtime/migration/openclaw-cron-inventory.json` with content: `{ "scanned_at": "<ISO-8601 timestamp at file authorship time>", "user": "ilsantino", "crontab_entries": [], "systemd_user_timers": [], "systemd_system_timers_owned_by_openclaw": [], "notes": "Per Phase 0 audit (runtime/migration/00-vps-audit.md), VPS has no crontab; no OpenClaw-owned timers. Inventory empty by audit confirmation; satisfies migration-scope § 4 acceptance gate. Re-verified at cutover-time via the verify command below." }`. The inventory file is a static artifact that documents the absence of OpenClaw scheduled work — the explicit "we checked, there's nothing" record that migration-scope § 4 demands. If cutover-time re-verification surfaces a forgotten cron or timer, this file must be updated with the entries BEFORE proceeding (cutover.sh Day -1 prep includes a re-verify checkbox).
- **verify:** `cat runtime/migration/openclaw-cron-inventory.json | jq . > /dev/null && jq -r '.crontab_entries | length, .systemd_user_timers | length, .systemd_system_timers_owned_by_openclaw | length' runtime/migration/openclaw-cron-inventory.json && (tailscale ssh ilsantino@srv1456441 -- 'crontab -l 2>&1 | grep -v "no crontab" | head' 2>/dev/null ; tailscale ssh root@srv1456441 -- 'systemctl --user --machine=ilsantino@.host list-timers --all --no-pager | grep -iE "openclaw|claw" | head' 2>/dev/null) || echo "(VPS re-verify skipped: requires Tailscale connectivity — re-run at Day -1 prep)"`
- **expected:** JSON parses cleanly. All three array length fields output `0` (per Phase 0 audit). Re-verify commands return empty output (no crontab entries; no openclaw-named timers in the user systemd timer list) when Tailscale is available; skipped otherwise with explicit note.

## Verification

```bash
cd runtime && npx tsc --noEmit \
  && npx vitest run daemon/cron-scheduler.test.ts daemon/agent-manager.test.ts --coverage --reporter=verbose 2>&1 | tail -30 \
  && cd .. \
  && wc -l runtime/daemon/cron-scheduler.README.md
```

Expected:
- `tsc --noEmit` exit 0
- `cron-scheduler.test.ts` ≥12 tests pass; ≥80% line + branch coverage on `cron-scheduler.ts`
- `agent-manager.test.ts` Phase 1 baseline tests still pass + ≥3 new polling-loop tests pass
- `cron-scheduler.README.md` 120-200 lines

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-17
**Reviewer:** orchestrator inline (carve-out from Plan 04 per pre-merge adversarial review C4 fix)

### Critical (must fix in impl)

- **C1 — POSIX day-vs-weekday OR semantics undefined.** Task 1 picks "day OR weekday" (POSIX standard) but spec § 1 only specifies `0 14 * * *` which collapses both to `*`. The first agent that registers `0 0 1-7 * 1` (first Monday of month) will hit the OR semantics — `1-7` matches 1st-7th of every month AND `Mon` matches every Monday — combined yields "1st-7th of any month OR any Monday", NOT "the first Monday only". **Fix:** Document the POSIX-OR semantics explicitly in the JSDoc of `matchesCron` AND in cron-scheduler.README.md § 3. If an agent author wants "first Monday only", they must use the workaround pattern documented in the README (e.g., wakeCheck script that exits 1 unless day-of-month is 1-7 AND day-of-week is Monday). Test case (6) in Task 2 enforces the documented behavior with a fixture assertion.
- **C2 — `spawnSync` blocks the 60s tick.** If a wake-check script takes >60s, the next tick fires before this one finishes, AND `spawnSync` blocks the Node event loop — telemetry emit + task-file writes queued after it stall. **Fix:** Set a hard `timeout: 30000` on the `spawnSync` call (Task 1 already has this); document in README § 6 that wake-checks MUST complete in <30s or they're SIGKILL'd. If a kill occurs, emit `cron-skipped { agentId, reason: 'wake-check-timeout', exitCode: null }`. Add test case (11b) — wake-check that sleeps 35s → spawnSync returns with signal=SIGKILL → cron-skipped emitted with the timeout reason.
- **C3 — Polling loop race with cron-fired task writes.** Task 3 polls `tasks/pending/` every 5s; Task 1 writes to `tasks/pending/` from the scheduler tick. Two writers (different intervals) → eventually the polling loop reads a half-written file and JSON.parse throws. **Fix:** Task 1 already uses tmp-rename pattern for atomicity (Windows-safe). Task 3 polling loop MUST ignore any file whose name doesn't end in `.json` (during the tmp-rename window the file is named `.tmp` and only renames to `.json` atomically). Add explicit `filename.endsWith('.json')` filter in Task 3 readdir loop. Test case PL-5 — write a `.tmp` file in pending → polling loop skips it; rename to `.json` → next tick picks it up.

### Important (forward to impl, don't block)

- **I1 — `setInterval` drift on long-running daemon.** Node `setInterval` is best-effort; long ticks shift the next call. For a 60s tick this is negligible (sub-second drift). For pr-triage's `0 14 * * *` schedule, drift can push a tick from 13:59:58 to 14:00:02 (still matches the 14:00 minute) — acceptable. Document in README § 4 that the scheduler matches by minute, so up to 59s of drift is fine.
- **I2 — agent-manager polling-loop interval is hardcoded 5s.** Some agents may want faster (1s) or slower (30s) polling. **Fix:** Accept `intervalMs` in `startPollingLoop(opts?: { intervalMs?: number })` (Task 3 already does this). Document in cron-scheduler.README.md § 5 that the default is 5s but tunable.
- **I3 — Telemetry event schema not formally defined.** Phase 1 has a loose NDJSON shape (`{ ts, kind, ...extras }`). Cron-scheduler emits 5+ new kinds. **Fix:** Task 5 README § 5 enumerates each kind with its `extras` keys. No schema-enforcement library added (matches Phase 1 telemetry posture). Phase 3+ may introduce Zod schema; out of scope here.
- **I4 — Test file imports `matchesCron` directly — leaks internal API.** Task 1 says export `matchesCron` so tests can import it. This is a sin against encapsulation but the alternative (testing only through `start/stop` + clock advancement) makes parser unit tests intractable. **Fix:** Document in cron-scheduler.ts JSDoc that `matchesCron` is `/** @internal — exported for test access only; do not use from outside the daemon module. */`.

### Minor

- M1 — `runtime/daemon/cron-scheduler.README.md` is a new doc file co-located with the source — matches `.claude/rules/mcp-server-patterns.md` README convention. Consistent with Phase 1 patterns.
- M2 — Inline cron parser at ~80 LOC is large enough to consider a separate file (`cron-parser.ts`). REJECTED for Phase 2 — keeping inline avoids over-modularization. Phase 3+ may split if parser grows past 200 LOC with timezone support.

### Dimension-by-dimension verdicts

- **Precision:** All 5 tasks have file paths + actions + verify commands + expected output. No "TBD".
- **Edge cases:** C1 (POSIX OR semantics), C2 (wake-check timeout), C3 (polling race) cover the non-obvious failures. I3 (telemetry schema) flagged for Phase 3.
- **Contradictions:** Plan 07 owns cron-scheduler + polling loop authoring; Plan 04 Task 7 imports + wires. No cross-plan code duplication. Plan 04 frontmatter updated to `depends_on: [01, 07]` per pre-merge adversarial review C4 fix.
- **Simpler alternatives:** Could pull `node-cron` as a dep — REJECTED per Phase 2 dep-bloat constraint. Could keep cron-scheduler authoring inside Plan 04 — REJECTED per C4 split (Plan 04 Task 7 was absorbing 4+ task-equivalents of work).
- **Missing acceptance criteria:** Plan 07 has no direct spec § 10 criterion link (those are owned by Plans 01-05). Plan 07 is the implementation infrastructure that Plan 04 depends on. Acceptance is "Plan 04 Task 7 wire-up compiles + tests pass" + "this plan's own Vitest suite passes."

### Implementer forward-list

1. Document POSIX day-vs-weekday OR semantics in `matchesCron` JSDoc + README § 3 (C1 fix).
2. Add `spawnSync` 30s timeout + `cron-skipped { reason: 'wake-check-timeout' }` event + test case (C2 fix).
3. Polling loop filters `.json` files only (skip `.tmp` mid-rename) + test case PL-5 (C3 fix).
4. Tunable `intervalMs` on `startPollingLoop` (I2 fix; Task 3 already specifies signature).
5. JSDoc `matchesCron` as `@internal` (I4 fix).
6. README § 5 enumerates all 5+ telemetry kinds with `extras` keys (I3 partial).
