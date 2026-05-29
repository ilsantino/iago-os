---
phase: feature-pr84-gap-closure
plan: 01
wave: 1
depends_on: []
context: .iago/research/2026-05-28-pr84-gap-closure.md
created: 2026-05-28
source: feature
---

# Plan: feature-pr84-gap-closure/01-close-green-locked-gaps

## Goal

Close the two green-locked production gaps PR #84's integration test encoded as passing assertions / `it.todo` (Codex H1 ndjsonAlert branch, H2 env-forwarding), implement the real daemon behavior, flip the test to assert the correct contract, and clear the Opus Important notes (I2/I3/I4/I5). Update PR #84 in place on `feat/pr-triage-integration-test` — no new branch, no new PR.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `runtime/daemon/telemetry.ts` | Add `pr-triage-telegram-send-failed` to the `DaemonEvent` union |
| modify | `runtime/daemon/agent-manager.ts` | ndjsonAlert branch in `processPendingTask` before the registration check |
| modify | `runtime/daemon/main.ts` | ndjsonAlert mirror in `makeTaskDispatchHandler`; org-gated env allowlist in `registerCronAgentWithRestart`; injectable `backoffMs` param |
| modify | `runtime/agents/pr-triage/pr-triage.test.ts` | Flip Case 2 assertions; rewrite Case 5 + delete Case 5b; thread `backoffMs` through `buildSystem.register` for Case 4; comment + mock-reset fixes |
| modify | `runtime/daemon/main.test.ts` | Direct-handler test case for the `makeTaskDispatchHandler` ndjsonAlert branch (Task 3 coverage — the polling path short-circuits in Task 2 and never exercises the mirror) |

`runtime/agent-runtime/pty/claude-pty.ts` is deliberately NOT modified — its CRITICAL #1 invariant (no `process.env` substitution) is preserved; all credential composition is daemon-layer (brief D2).

## Tasks

### Task 1: Add `pr-triage-telegram-send-failed` telemetry kind
- **files:** `runtime/daemon/telemetry.ts`
- **action:** Add a new member to the `DaemonEvent` union near the existing `pr-triage-dispatch-failed` member (~line 368): `{ readonly kind: "pr-triage-telegram-send-failed"; readonly agentId: string; readonly filename: string; readonly alertKind: string; readonly details: string }`. Add a JSDoc noting it carries the verbatim `ndjsonAlert` value as `alertKind` (handles both `pr-triage-telegram-send-failed` and `pr-triage-double-failure` producer envelopes per `prompt-template.md:145-148,180`) and the already-token-redacted `details` string. Do not invent `curlExitCode`/`telegramResponseBody` fields (brief D1).
- **verify:** `cd runtime && npx tsc --noEmit && grep -c 'pr-triage-telegram-send-failed' daemon/telemetry.ts`
- **expected:** tsc exits 0; grep prints `1` (one occurrence — the kind literal).

### Task 2: ndjsonAlert branch in `processPendingTask`
- **files:** `runtime/daemon/agent-manager.ts`
- **action:** In `processPendingTask` (~line 1666), after `agentId` is extracted and length-capped (~line 1722) but BEFORE the `isAgentRegistered(agentId)` check (~line 1723), add a branch: if `(parsed as {ndjsonAlert?: unknown}).ndjsonAlert` is a non-empty string, `await emitTelemetry({ kind: "pr-triage-telegram-send-failed", agentId, filename, alertKind, details })` where `details = typeof (parsed as {details?: unknown}).details === "string" ? that : ""`, then `await this.claimTask(filename, agentId)` and `return` (do not fall through to dispatch). Emit telemetry before `claimTask` so a rename failure re-trips next tick rather than losing the alert.
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run agents/pr-triage/pr-triage.test.ts -t "Case 5"`
- **expected:** tsc exits 0; Case 5 (after Task 6 rewrite) passes. Pre-Task-6, Case 5 will fail on the old malformed-task assertion — that is the RED state proving the branch changed behavior.

### Task 3: ndjsonAlert mirror in `makeTaskDispatchHandler` + direct-handler test
- **files:** `runtime/daemon/main.ts`, `runtime/daemon/main.test.ts`
- **action:** In `main.ts` `makeTaskDispatchHandler` (~line 575), after the `findHandleForAgent` null-check (~line 592) and BEFORE the `prompt` validation (~line 600), add: if `(evt.taskContent as {ndjsonAlert?: unknown}).ndjsonAlert` is a non-empty string, `await emit({ kind: "pr-triage-telegram-send-failed", agentId: evt.agentId, filename: evt.filename, alertKind, details })` then `await agentManager.claimTask(evt.filename, evt.agentId)` and `return`. The existing `finally`→`releaseDispatchSlot(evt.filename)` block must still run. This is defense-in-depth — Task 2 short-circuits before dispatch in the normal polling path, so add a NEW case to the `describe("makeTaskDispatchHandler (Plan 04d)")` block in `main.test.ts` (~line 824) that invokes the handler directly with a `taskContent` carrying `ndjsonAlert` (no `prompt`) and asserts it emits `pr-triage-telegram-send-failed` (with `alertKind`/`details`) + calls `claimTask` — NOT `pr-triage-dispatch-failed { reason: "malformed-task" }`. Follow the existing fixture/mock shape used by the sibling cases in that block.
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run daemon/main.test.ts -t "makeTaskDispatchHandler"`
- **expected:** tsc exits 0; the `makeTaskDispatchHandler` describe block passes including the new ndjsonAlert case; `grep -c 'pr-triage-telegram-send-failed' daemon/main.ts` prints `1`.

### Task 4: Org-gated env allowlist in `registerCronAgentWithRestart`
- **files:** `runtime/daemon/main.ts`
- **action:** Add an exported `CRON_AGENT_ENV_ALLOWLIST: readonly string[] = ["IAGO_TELEGRAM_BOT_TOKEN", "IAGO_TELEGRAM_ALLOWED_USER_IDS", "GH_TOKEN"]`. In `registerCronAgentWithRestart` (~line 736), build a helper that returns `agentConfig.env` merged with allowlisted vars from `process.env` ONLY when `agentConfig.org === "internal"` and the var is actually present (skip `undefined` — no empty-string entries). Use this merged env for BOTH `registerAgent` calls — the initial registration (~line 803-809) and the restart re-registration (~line 780-786). Do NOT touch `claude-pty.ts` (brief D2).
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run agents/pr-triage/pr-triage.test.ts -t "Case 2"`
- **expected:** tsc exits 0; Case 2 passes after Task 5's assertion flip (startup spawn env carries the three creds).

### Task 5: Flip Case 2 assertions to the correct contract
- **files:** `runtime/agents/pr-triage/pr-triage.test.ts`
- **action:** At lines 433-435 replace the three `toBeUndefined()` assertions with `toBe("test-bot-token")`, `toBe("123456,789012")`, `toBe("test-gh-token")` respectively (the `beforeEach` fixture values; the fixture `agent-config.json` already sets `org: "internal"` so Task 4's injection fires). Rewrite the GAP comment block (lines 414-422 and 429-432) to describe the now-correct forwarded-via-org-gated-allowlist contract instead of a pending gap.
- **verify:** `cd runtime && npx vitest run agents/pr-triage/pr-triage.test.ts -t "Case 2"`
- **expected:** Case 2 passes; no `toBeUndefined` remains in Case 2's env block.

### Task 6: Rewrite Case 5, delete Case 5b, add dispatchInFlight second tick (Opus I3)
- **files:** `runtime/agents/pr-triage/pr-triage.test.ts`
- **action:** Rewrite Case 5 (lines 607-665) to assert the CORRECT ndjsonAlert behavior: after `await mgr._pollingTickForTests(); await dispatch.flush();` assert (a) exactly one `pr-triage-telegram-send-failed` event with `{ agentId: "pr-triage", filename, alertKind: "pr-triage-telegram-send-failed", details: <the fixture details string> }`, (b) file moved to `tasks/resolved/` (`fsp.access(resolved/filename)` resolves; `pending/filename` rejects), (c) zero `pr-triage-dispatch-failed` events, AND (d) the existing `dispatchEvents` listener (lines 637-649) now captures `toHaveLength(0)` — Task 2 short-circuits the ndjsonAlert in `processPendingTask` BEFORE the `task-dispatch-needed` emit, so the alert MUST NOT reach the dispatch path (this flip from the old `toHaveLength(1)` is positive proof the short-circuit fires). Then add a SECOND `await mgr._pollingTickForTests(); await dispatch.flush();` and assert the count of `pr-triage-telegram-send-failed` is STILL exactly one (idempotency / no double-resolve — covers Opus I3). Delete the Case 5b `it.todo` (lines 667-681).
- **verify:** `cd runtime && npx vitest run agents/pr-triage/pr-triage.test.ts -t "Case 5"`
- **expected:** Case 5 passes; `grep -c 'it.todo' agents/pr-triage/pr-triage.test.ts` prints `0`.

### Task 7: Case 4 injectable backoff (brief D3)
- **files:** `runtime/daemon/main.ts`, `runtime/agents/pr-triage/pr-triage.test.ts`
- **action:** In `main.ts`, add optional `backoffMs?: readonly number[]` to `registerCronAgentWithRestart`'s deps, default `CRON_AGENT_RESTART_BACKOFF_MS`; use it in `scheduleRestart`'s delay lookup and budget-length check (replace the two `CRON_AGENT_RESTART_BACKOFF_MS` references inside the closure with the param). Case 4 registers via `buildSystem.register` (test:549-550 → helper:252-269 → `registerCronAgentWithRestart` at test:263), NOT an inline call — so thread the param through: add an optional second arg to the `register` helper (`register: (agentId: string, opts?: { backoffMs?: readonly number[] }) => Promise<void>`, updating `buildSystem`'s return type) that forwards `backoffMs` to `registerCronAgentWithRestart`. Case 4 calls `await register("pr-triage", { backoffMs: [10] })`. Replace the `CRON_AGENT_RESTART_BACKOFF_MS[0] + 1_500` real wait (line 595) with a short real wait (e.g. `100`) keyed to the injected `10ms`. Keep real timers throughout; Phase B unchanged. Assertions on `cron-agent-restarted { attempt: 1 }` + `initialSpawns + 1` stay. Other `buildSystem.register` callers (Cases 1,2,3,6,7) omit the arg and get the default backoff — unaffected.
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run agents/pr-triage/pr-triage.test.ts -t "Case 4"`
- **expected:** tsc exits 0; Case 4 passes in well under its 15s budget (no real 5s wait); no `vi.useFakeTimers` in Case 4.

### Task 8: Test-hygiene fixes — Opus I2, I4, I5
- **files:** `runtime/agents/pr-triage/pr-triage.test.ts`
- **action:** (I2) Fix the Phase B ceiling rationale comment (~lines 565-567) so the math is correct (200 iterations × 10ms = 2000ms = 2s ceiling). (I4) Fix the Case 9 internals-contract comment (~lines 822-836) so it accurately describes the per-filename outstanding-set assertions vs. the claim-on-send model. (I5) Harden the `emit` mock so a `mockReset` can never leave a window where `emit` has no implementation delegating to `emitState.real`: either install the delegating implementation inside the `vi.mock("../../daemon/telemetry.js", ...)` factory (lines 152-161) at module load, or make the `mockReset()`+`mockImplementation()` pair (lines 353-357) atomic so no test observes a bare reset mock.
- **verify:** `cd runtime && npx vitest run agents/pr-triage/pr-triage.test.ts`
- **expected:** All cases pass (9 it() blocks; 0 todo). Suite green.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-28
**Reviewer:** analyst (Opus 4.8), read-only, against plan + brief + live source.

### Precision / Missing acceptance criteria (all resolved in this plan revision)
- **Case 5 dispatch listener (Task 6):** original plan was silent on the existing `dispatchEvents.toHaveLength(1)` assertion (test:637-649). Because Task 2 short-circuits the ndjsonAlert in `processPendingTask` *before* the `task-dispatch-needed` emit, that event no longer fires for an alert envelope. Task 6 now flips it to `toHaveLength(0)` as positive proof of the short-circuit.
- **Case 4 backoff threading (Task 7):** Case 4 registers via `buildSystem.register` (test:549-550 → helper:252-269 → `registerCronAgentWithRestart` at test:263), not an inline call. Task 7 now threads the optional `backoffMs` through the `register` helper signature; other callers (Cases 1/2/3/6/7) omit it and get the default.
- **Task 3 mirror coverage:** the polling path never reaches `makeTaskDispatchHandler`'s ndjsonAlert branch (Task 2 short-circuits upstream). Task 3 now adds a direct-handler case to the existing `describe("makeTaskDispatchHandler (Plan 04d)")` block in `main.test.ts:824` so the mirror branch is actually exercised.

### Contradictions — none
- Plan does NOT edit `claude-pty.ts`; D2's registration-layer allowlist genuinely makes Case 2's flipped assertions pass (traced: fixture `agent-config` `org:"internal"` → `register` → `registerCronAgentWithRestart` merges allowlist from `process.env` → `registerAgent` env → claude-pty `ptyEnv` → `mockSpawn` call[2].env). CRITICAL #1 invariant preserved.
- New `DaemonEvent` union member is safe: no `assertNever` / `: never` exhaustiveness check or `switch…kind` on `DaemonEvent` exists in `daemon/` (verified), so adding a member won't break tsc.

### Confirmed premises
- `claimTask` is decrement-only and registration-agnostic (`agent-manager.ts:1469-1495`) — safe for the alert-resolve path. The per-filename outstanding-set filter (cron-scheduler) makes the resulting `task-resolved` a slot-accounting no-op for non-cron-fired alert files.
- Baseline before changes: 9 passing `it()` + 1 `it.todo`; Case 4 ~6.5s on the real backoff — validates D3's speed motivation.

### Minor / out-of-scope note
- A pre-existing test smell: some `session-log appendEvent` path writes to the default state root (`~/.iago-os/daemon-state/session-logs`) rather than the env-overridden `tempDir`, producing a non-fatal stderr `ENOENT` during the suite. Pre-existing, not introduced here, out of scope — flag for a future test-isolation cleanup, do not fix in this PR.

## Verification

```bash
cd runtime && npx tsc --noEmit \
  && npx vitest run agents/pr-triage/pr-triage.test.ts \
  && npx vitest run daemon/agent-manager.test.ts daemon/main.test.ts daemon/telemetry.test.ts \
  && npx biome check daemon/telemetry.ts daemon/agent-manager.ts daemon/main.ts agents/pr-triage/pr-triage.test.ts
```

Expected: tsc exits 0; pr-triage integration suite green with 9 passing `it()` and 0 `it.todo`; the three affected daemon unit suites stay green (the new telemetry kind + `registerCronAgentWithRestart` signature change must not break them); Biome clean. No edits to `runtime/agent-runtime/pty/claude-pty.ts`.
