---
phase: feature-daemon-durability-hardening
plan: 02
wave: 2
depends_on: [01]
context: .iago/research/2026-06-13-daemon-durability-deferrals.md
created: 2026-07-01
updated: 2026-07-01
source: feature
---

# Plan: feature-daemon-durability-hardening/02-idempotent-resume-and-recovery-minors

## Goal

Close the crash-before-delivery loss window (DD-01) by making resume delivery idempotent, and harden
three low-risk recovery-path edges in the same result-timer state machine (DD-04 transient-fault
telemetry, DD-05 cron-slot release on malformed task, DD-06 corrupt-marker telemetry).

## Design decision (from stress test — resolves "what does re-send mean")

Per source-doc § D1, the irreversible delivery in the DD-01 window is the **`runtime.send` that
delivers the prompt to the agent at dispatch** (`main.ts` dispatch handler, ~`runtime.send`), NOT the
Telegram send. The pre-claim marker (`persistResultMarker`) is written BEFORE that `runtime.send`; a
crash in between leaves a marker with the prompt never delivered, and today's RESUME branch
(`main.ts:1752-1785`) re-claims **without re-delivering**, so the agent never runs → dead-letter →
lost summary. So "re-send" = **re-invoke `runtime.send` (re-deliver the prompt) in the dispatch
RESUME branch when delivery is unconfirmed** — a seam the dispatch handler already owns (it has the
runtime). The delivered-state field for DD-01 is therefore stamped on the marker **immediately after
`runtime.send` returns at dispatch** (`promptDeliveredAt`), distinct from plan 01's completion-time
tombstone `deliveredAt`. Residual: a crash between `runtime.send` returning and the `promptDeliveredAt`
write re-delivers on resume → the agent runs twice → a possible duplicate summary. This is bounded,
strictly better than the current silent loss, and NOT exactly-once (impossible without agent-side
dedup). Agent-side runId dedup (making re-delivery a true no-op) is the *complete* fix and is called
out below as an explicit follow-up, not smuggled in.

## Background anchors (main @ `2ec6c07`)

- Dispatch pre-claim marker write `main.ts:1821`; `runtime.send` (prompt delivery) in the dispatch handler; RESUME branch `main.ts:1752-1785` (`// re-attempt ONLY the claim; never re-send`).
- `isActiveRun` `main.ts:863-904`, non-ENOENT fail-closed catch `main.ts:877-890` (no telemetry today).
- Malformed-task early-return `main.ts:1690-1706` (emits neither `task-resolved` nor `cron-result-complete`); `isSendContract` def `main.ts:1714` (AFTER the branch; hoist is dependency-safe — nothing between 1690-1714 mutates `startResultTimer`/`evt.agentId`).
- `recoverResultTimers` malformed branches `main.ts:1109`, `main.ts:1117` (unlink, no telemetry); expired branch DOES emit `main.ts:1151-1157`.
- Cron slot release only on `cron-result-complete` (`cron-scheduler.ts:542-544, 588-589`); `deferReleaseAgents` `main.ts:2984`. `pr-triage-dispatch-failed` is NOT a `TERMINAL_EVENTS` member, so the malformed branch cannot double-release.
- `emit` `telemetry.ts:712-734`; send-handler `emit` dep is single-arg `(event) => Promise<unknown>` (no `extra`). Plan 01 exposes `writeTombstone`/`readTombstone` on `makeResultTimers`.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `runtime/daemon/main.ts` | `promptDeliveredAt` stamp after dispatch `runtime.send`; idempotent RESUME re-deliver; DD-04/05/06 edges |
| modify | `runtime/daemon/telemetry.ts` | New kinds `pr-triage-result-marker-corrupt`, `pr-triage-marker-read-faulted`, `pr-triage-delivered-stamp-faulted` |
| modify | `runtime/daemon/main.test.ts` | RED-first regression: DD-01 crash-before-delivery, DD-04/05/06 |

## Tasks

### Task 1: RED regression tests (author + see fail BEFORE impl)
- **files:** `runtime/daemon/main.test.ts`
- **action:** Write failing tests, driving the handlers directly (as the DH-* tests do): (a) **DD-01** — marker persisted, `promptDeliveredAt` absent, then RESUME → assert the prompt IS re-delivered via `runtime.send` (fails today: RESUME never re-sends); (b) **DD-01 no-double** — `promptDeliveredAt` present + claim fault → RESUME re-claims but does NOT re-deliver; (c) **DD-05** — synthetic malformed pr-triage task → assert `cron-result-complete` fired + slot released + next fire dispatches; (d) **DD-06** — corrupt marker on boot → assert `pr-triage-result-marker-corrupt` emitted before unlink; (e) **DD-04** — non-ENOENT marker read fault → assert `pr-triage-marker-read-faulted` emitted and `isActiveRun` still returns false. Confirm all fail against current behavior.
- **verify:** `npm --prefix runtime test -- --run daemon/main.test.ts`
- **expected:** the 5 new tests FAIL (RED); pre-existing pass

### Task 2: Stamp `promptDeliveredAt` after dispatch delivery (DD-01)
- **files:** `runtime/daemon/main.ts`, `runtime/daemon/telemetry.ts`
- **action:** Immediately after the dispatch-time `runtime.send` returns success (before any other awaited work), durably stamp `promptDeliveredAt` on the `result-pending` marker (rewrite the marker atomically, or write it into plan 01's tombstone keyed by the source filename — pick one authoritative record and document it). No other `await` may sit between the successful `runtime.send` and this stamp (minimizes the duplicate window). A failed stamp emits `pr-triage-delivered-stamp-faulted` (new kind) and must not crash dispatch.
- **verify:** `npm --prefix runtime test -- --run daemon/main.test.ts`
- **expected:** suite green; marker carries `promptDeliveredAt` after a successful dispatch

### Task 3: Idempotent RESUME re-deliver when unconfirmed (DD-01)
- **files:** `runtime/daemon/main.ts`
- **action:** In the RESUME branch (`main.ts:1752-1785`), when the recovered marker has **no** `promptDeliveredAt` (crash-before-delivery), RE-INVOKE `runtime.send` to re-deliver the prompt (then proceed as a normal dispatch); when `promptDeliveredAt` IS set (delivery confirmed, only the claim faulted), keep the current re-claim-only, no-re-deliver behavior. Bound it: the resumed claim must resolve the source file out of `pending/` regardless of the stamp outcome so a persistently-faulting stamp cannot re-trip re-delivery every tick (no unbounded duplicates). Add an in-code note: trades a rare bounded duplicate for eliminating the rare loss; exactly-once needs agent-side dedup (follow-up).
- **verify:** `npm --prefix runtime test -- --run daemon/main.test.ts` (tests (a),(b) GREEN)
- **expected:** re-deliver iff unconfirmed; no re-deliver when confirmed; no unbounded re-trip

### Task 4: DD-05 — release the cron slot on a malformed task
- **files:** `runtime/daemon/main.ts`
- **action:** In the malformed-task early-return (`main.ts:1690-1706`), before `return`, emit `cron-result-complete` for send-contract cron agents — hoist `isSendContract` above this branch (dependency-safe) or inline `evt.agentId === "pr-triage"` — mirroring the other abort branches (`main.ts:1837-1842`). This is the sole release on this path and cannot double-fire (`return`s immediately; `pr-triage-dispatch-failed` is not terminal).
- **verify:** `npm --prefix runtime test -- --run daemon/main.test.ts` (test (c) GREEN)
- **expected:** malformed task → slot released → next fire dispatches

### Task 5: DD-06 + DD-04 — audit telemetry on silent recovery branches
- **files:** `runtime/daemon/main.ts`, `runtime/daemon/telemetry.ts`
- **action:** (DD-06) add `pr-triage-result-marker-corrupt` to the `DaemonEvent` union and `await emit(...)` it in both `recoverResultTimers` malformed branches (`main.ts:1109`, `main.ts:1117`) BEFORE the `fsp.unlink`, with the marker filename + fault reason. (DD-04) add `pr-triage-marker-read-faulted` and `await emit(...)` it in the `isActiveRun` non-ENOENT catch (`main.ts:877-890`) before returning `false`; keep the fail-closed semantics unchanged. Both emits are safe (they write the telemetry NDJSON, a different file — no recursion into the faulting read).
- **verify:** `npm --prefix runtime test -- --run daemon/main.test.ts` (tests (d),(e) GREEN)
- **expected:** corrupt-marker + read-fault paths emit audit events

## Stress Test

**Verdict:** PROCEED_WITH_NOTES → revised
**Date:** 2026-07-01 (analyst/opus, anchors verified against `2ec6c07`)

- **MISSING AC (fixed, central):** "re-send" was ambiguous — the RESUME seam is the *dispatch*
  handler (no Telegram path). Resolved: re-send = re-invoke `runtime.send` (re-deliver the prompt),
  which the dispatch handler owns; delivered-state is `promptDeliveredAt` stamped right after that
  send, NOT after Telegram. Duplicate window bounded; unbounded-re-trip closed (Task 3 resolves the
  file out of pending regardless of stamp outcome).
- **CONTRADICTION (fixed):** the original "stamp `deliveredAt` after `sendAgentNotification`" put the
  DD-01 stamp on the wrong send (Telegram) and at the wrong lifecycle point, and collided with plan
  01's completion-time tombstone. Now two distinct fields: `promptDeliveredAt` (dispatch, this plan)
  vs completion `deliveredAt` (plan 01). Task 2 references plan 01's exported tombstone seam.
- **PRECISION (fixed):** the send/dispatch handler `emit` deps are single-arg; a delivered-stamp
  outcome needs its own kind (`pr-triage-delivered-stamp-faulted`) — added.
- **CLEARED by stress (no change):** DD-05 `isSendContract` hoist is dependency-safe; the malformed
  branch cannot double-release (`pr-triage-dispatch-failed` ∉ `TERMINAL_EVENTS`); DD-04 emit has no
  recursion risk. All three minors are RED-first testable against verified current behavior.
- **TDD (fixed):** regression tests moved to Task 1 (RED before impl).
- **FOLLOW-UP (tracked, not this plan):** agent-side runId dedup to make prompt re-delivery a true
  no-op (true idempotent delivery) — the complete DD-01 fix; deferred to keep this plan bounded to the
  daemon-side recovery. Note in the summary for the durability backlog.

## Verification

- `npm --prefix runtime run typecheck` → exit 0
- `npm --prefix runtime test -- --run daemon/main.test.ts` → green; ≥5 net-new regression tests (RED before impl)
- Manual trace: RESUME re-delivers iff `promptDeliveredAt` absent and never loops unbounded; every recovery/abort branch releases the cron slot and emits an audit event before destroying a marker; no exactly-once claim anywhere.
