---
name: project_daemon_registration_orphan_window
description: Deferred Critical on PR
metadata: 
  node_type: memory
  type: project
  originSessionId: 332cd441-3497-4083-8adc-67396530227a
---

iaGO v2 daemon (`runtime/daemon/agent-manager.ts`) has a **known, pre-existing durability gap** flagged Critical by the dual-adversarial gate on PR #87 (fix/recover-orphan-coverage-floor), **deliberately deferred** — NOT fixed in that PR.

The gap: `persistAgentConfig` swallows write errors (logs + resolves), so `registerAgent` does `spawn → trackHandle → persist`; if the persist write fails AFTER a successful spawn, the agent is live + tracked in-memory but has no `<handleId>.json`. A daemon crash before the next persist strands a live, untracked agent that `bootRecovery` cannot recover — violating the crash-recovery contract.

**Why deferred:** it predates PR #87 (that PR only added an honest docstring + a test documenting the window). Closing it is an architectural change to a core path — either (a) fail `registerAgent` + synchronously tear down the spawned handle on persist failure (inverts the daemon's deliberate resilient-registration posture), or (b) a durable pre-spawn intent record reconciled during boot recovery. That's a **design decision for Santiago**, out of scope for a test-recovery PR, and "ASK before architectural changes" applies.

**Status (2026-05-31):** flagged in the PR #87 @claude review comment; awaiting Santiago's call (resilient vs. durable registration) — likely a fast-follow hardening PR. The new test `agent-manager.test.ts` "persist-fail after spawn … (orphan window)" pins CURRENT behavior; closing the gap means revisiting that test's assertion.

**DECISION RESOLVED (2026-06-08):** Santiago chose **HARDEN** (durable over resilient). The #92 re-gate (real-Codex `wiq5lgdg0`) re-surfaced the specific manifestation as a confirmed Critical (C2): in `registerAgent`'s persist-rollback, the `finally { teardown(handle.id) }` runs UNCONDITIONALLY even when BOTH kill attempts throw → an unkilled live PTY is untracked = orphan. **Fix to execute next session:** do NOT teardown until termination is CONFIRMED — probe liveness after the shutdown errors, keep the handle in a QUARANTINED/tracked state that blocks same-agent re-registration, add retry/escalation + a durable recovery record/telemetry. Paired with #92 C1 (durability silent-drop in startResultTimer/dispatch). Full reconstruction in [[sessions/2026-06-08-multipr-rereview-hardening]] (§"HARDEN BOTH"). Execution deferred to a fresh session per Santiago. Related: [[project_iago_v2_vision]], [[agents-never-hold-secrets]], [[feedback_subagent_git_wander_and_structuredoutput]].

**CLOSED (2026-06-16):** DD-R1 / C2 / C1 are **SHIPPED and merged** in PR #92 "Harden daemon recovery, registration, and cron resilience" (commit `b3af16c`, merged to main 2026-06-13) — NOT pending. Verified against current main (`4d8a448`/#97): `agent-manager.ts:440` carries the fail-closed `DURABILITY CONTRACT (Task 1 Critical)` rollback; `pr-triage-fetch.ts:48` the `MAX_RESPONSE_BYTES` bound; `main.ts:637` the Task 6 durable run-correlated dead-letter; `commands.ts:177` the `search(/\s/)` /inject delimiter; `cron-scheduler.ts` the cron×heartbeat single-restart authority. No commit between `b3af16c` and HEAD touched these files (zero regression). The plan `.iago/plans/feature-daemon-recovery-hardening/01-recovery-hardening.md` was the **SPEC for #92, not pending work** — a 2026-06-16 /iago-execute STRESS stage correctly BLOCKED it as STALE (workflow threw; no branch/commit/PR created). Treat this Critical as CLOSED; do NOT re-execute the plan. Phase 2's last code-gating Critical is resolved. Plan should be archived to `.iago/plans/_archive/` with a #92 pointer + a `.iago/summaries/` entry recorded (only `01-ipc-server-hardening.md` / `05-ipc-server-and-telemetry.md` summaries exist).
