# Daemon durability deferrals — backlog for the durability-hardening PR

**Date:** 2026-06-13
**Source:** PR #92 (`fix/daemon-recovery-hardening`) final dual-adversarial re-gate
(`wf_28759010-e6e`, team mode + 5 lenses, **real Codex, no degradation, every
blocking finding skeptic-confirmed**). Verdict `PASS_WITH_CONCERNS`, 4 Important,
0 Critical, 0 skeptic-dropped.

**Decision (Santiago, 2026-06-13):** ship #92 with the in-scope flaky-test fix only;
DEFER the 3 bounded durability edges below to a dedicated durability-hardening PR.
Rationale: every one is bounded to **one missed daily pr-triage notification under a
rare multi-fault, self-healing on the next daily cron**; the daemon is **not yet
deployed**; and the correct fixes are *delivery-idempotency design additions*, not
reactive patches (a quick patch on D1 just moves the crash window — see below). This
is the "don't iterate infra to clean" call applied to genuinely-bounded durability
edges, not a dismissal — they are tracked here for the hardening PR.

---

## D1 — Pre-send marker conflates "prepared" with "delivered" across a crash boundary

**Severity:** Codex rated Critical; gate calibrated **Important** (bounded, self-healing).
**Where:** `runtime/daemon/main.ts` — `persistResultMarker` (pre-claim, ~L1741) runs
BEFORE the irreversible `runtime.send` (~L1767); RESUME branch (~L1694) re-claims and
"never re-sends".

**The gap.** A daemon crash in the (ms-wide) window between the marker write and
`runtime.send` leaves the marker on disk with the prompt NEVER delivered. On reboot
`recoverResultTimers()` re-arms a live timer; the next tick takes RESUME
(`marker.filename === evt.filename`) which re-claims WITHOUT re-sending → the agent
never runs → dead-letter `pr-triage-result-timeout` (~120s) → that day's summary lost.
RESUME cannot distinguish "delivered, claim faulted" (the common case it correctly
handles) from "marker persisted, crash before send" — both present as
marker-for-this-file + file-still-pending.

**Interaction with the #92 round-2 fix.** The RESUME-before-DEFER fix (DH-R11)
correctly eliminated the frequent claim-fault DOUBLE-send. The trade is that the rare
crash-before-send case, which the *old* DEFER→dead-letter→fresh-dispatch path used to
eventually re-send (late, possibly duplicate), now resolves to a lost summary. Net is
still positive (frequent worse bug fixed; rare bounded edge introduced).

**Why not a quick patch.** A two-phase marker (`{delivered:false}` before send →
`{delivered:true}` after) only MOVES the window: a crash between `send` returning and
the `delivered:true` write yields marker-`false` + prompt-actually-sent → RESUME
re-sends → DUPLICATE. Exactly-once is impossible without idempotent delivery.

**Fix direction (hardening PR).** Idempotent delivery: a runtime/agent ack, or
runId-based agent-side dedup so a re-send on resume is a no-op. Then RESUME can safely
re-send when delivery is unconfirmed. Add a crash-boundary regression test
(marker-persisted-then-crash-before-send) — DH-R6 only covers `persistResultMarker`
returning false.

## D2 — Result completion destroys the dedup marker while the source cron task stays pending

**Severity:** Codex rated high; gate calibrated **Important** (narrow compound fault).
**Where:** `runtime/daemon/main.ts` dispatch claim-fault path (~L1810) keeps the marker;
`makeTaskSendHandler` finally → `clearResultTimer` (~L1410) removes it on result consumption.

**The gap.** On a PERSISTENT pending→resolved rename fault (degraded state root:
EACCES/ENOSPC/EBUSY) that outlives the agent runtime: send succeeds, claim faults, the
marker is kept as the live run's record, and every resume tick's re-claim ALSO faults.
When the agent eventually writes its result envelope, the send handler consumes it
(`isActiveRun` true → not quarantined → `consumed=true` → `clearResultTimer` removes
the marker + clears the timer). Now the SOURCE cron task is still in `tasks/pending/`
with no marker and no timer → the next dispatch tick FRESH-dispatches under a new runId
→ duplicate agent work + possibly a second Telegram push. DH-R7/DH-R8 cover
claim-fault-keeps-marker and resume-on-match, but NOT marker-cleared-by-result-completion-
while-source-pending.

**Fix direction (hardening PR).** Keep a durable completed/delivered tombstone keyed by
the SOURCE filename until that source task is successfully claimed, OR have result
processing claim the referenced source task before deleting the marker. Add a test:
send-success + persistent claim fault + result consumption + source retry → assert no
fresh re-dispatch.

## D3 — Daily-summary delivery depends on the LLM echoing the UUID runId (the I3 seam)

**Severity:** **Important** (deliberate correctness-over-delivery trade-off; the
single most fragile seam, flagged across multiple rounds).
**Where:** `runtime/agents/pr-triage/prompt-template.md` ships `RUN_ID=""` for the LLM
to substitute; `makeTaskSendHandler`/`isActiveRun` quarantine+drop any envelope whose
runId is missing/empty/non-UUID *while a run is active* (and a daemon-dispatched run is
always active at envelope time).

**The gap.** If the agent forgets to substitute the runId (a probabilistic LLM step the
code comments themselves call a "NORMAL agent failure mode"), the summary is silently
dropped, surfacing only as a `pr-triage-result-timeout` ~120s later — no Telegram
delivery. This is the deliberate at-most-once-with-correlation tradeoff from earlier
rounds (avoid misattributing a stale summary), NOT a logic bug — but it converts a
deterministic delivery into one gated on non-deterministic LLM compliance.

**Fix direction (hardening PR).** Either (a) the daemon stamps/correlates the runId
out-of-band (e.g. derive it from the source filename) rather than via LLM echo, or
(b) treat a missing-runId active-run envelope as deliverable-but-flagged rather than
dropped. (a) is the durable fix; it also subsumes the D1 dedup story.

---

## Deferred Minors (same hardening PR, lower priority)

- **`isActiveRun` fail-closed drops a live summary on a transient non-ENOENT marker read
  fault** — the intentional symmetric fail-closed (matches the write side) trades a
  rare-fault summary-drop for stale-run safety. Documented tradeoff; acceptable.
- **`malformed-task` early-return doesn't release the held cron slot** for a
  deferReleaseAgent — not reachable for cron pr-triage today (daemon always renders a
  non-empty prompt), guard for symmetry/future per-task spawn.
- **`recoverResultTimers` malformed-marker branch emits no telemetry** before unlinking
  (the expired-but-valid branch does) — add a `pr-triage-result-marker-corrupt` event.
- **`fireTimeout` dead-letter slot-leak-until-restart on a telemetry-write failure** —
  on a long-lived daemon that never restarts, a failed timeout-emit wedges the held slot
  (boot recovery re-scans the retained marker, so it self-heals on restart only).
- **`deferredNotified` Set pruned only on RESUME/successful-send** — unbounded in
  principle; prune on quarantine/claim-out paths too, or document the bound.
- **Quarantine guard bypassed by `attemptCrashReplay`** — boot replay re-tracks a handle
  without consulting the quarantine map (defense-in-depth; largely unreachable in the
  precise fault that creates a quarantine).
- **Retained zombie handle never reaped** (option-a retain path, triple-compound disk
  fault) — `releaseQuarantinedAgent` clears the block but does not teardown the retained
  handle; handle-lifecycle loose end.
- **`CronScheduler.restoreOutstanding` increments runningCount with no maxConcurrent
  clamp** — safe today (single marker per agentId); add a defensive cap if
  maxConcurrent > 1 ever ships.
- **Per-tick polling re-reads stuck files** (no mtime/hash skip-cache) and the RESUME/
  DEFER gate reads the marker each in-flight tick — negligible at daily cadence; bound
  it if the file-bus scales.
- **`main.ts` is ~3.6k lines** — extract the result-timer/dead-letter state machine into
  `runtime/daemon/result-timers.ts` with the CronScheduler slot-release contract made
  explicit (it currently lives only in comments).
- **`session-log.ts` unbounded growth** — no size-threshold warning on the recovery-
  critical read path (deferred to Phase 6+ observability).

## Pre-existing, NOT this PR (separate)

- `cred-bootstrap.test.ts` + `telegram/approval-bus.test.ts` EACCES-simulation tests
  `chmod 0o000` which no-ops for the owner on Windows/NTFS → those error paths have no
  effective coverage on Windows (pass on Linux CI). Portable fault-injection rewrite
  (DI'd fs / win32 skip-guard) is a test-infra follow-up.
- `session-log.test.ts` "100 sequential appends" can time out under full-suite parallel
  real-FS I/O on Windows (passes in isolation; comment-only file in #92). Raise its
  `testTimeout` or de-parallelize the real-FS append test.

## Related prior deferrals

- [[project_daemon_registration_orphan_window]] — PR #87 deferred Critical; the
  resilient-vs-durable design surface D1/D2 extend.
- #92 quarantine boot-surfacing gap (a quarantined agent is silently disabled across
  restarts; boot does not scan the quarantine dir) — rides this hardening PR.
