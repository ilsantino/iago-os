---
plan: feature-daemon-recovery-hardening/01-recovery-hardening
status: shipped-elsewhere
verified: 2026-06-16
pr: https://github.com/ilsantino/iago-os/pull/92
---

# Summary: feature-daemon-recovery-hardening

## Outcome

**Not executed — the work was already shipped.** This plan (`01-recovery-hardening.md`,
created 2026-05-30) was the **spec for PR #92** "Harden daemon recovery, registration, and
cron resilience" (commit `b3af16c`, merged to main 2026-06-13). A 2026-06-16 `/iago-execute`
run hit the pipeline **STRESS** stage, which correctly BLOCKED the plan as STALE and threw —
**no branch, commit, or PR was created.**

The plan closed Phase 2's last code-gating Critical (**DD-R1 / C2** registerAgent durability
hole + **C1** dispatch durability silent-drop) plus 6 Importants and a Minor batch — all of
which #92 delivered.

## Verification (against main `4d8a448` / #97)

| Task | Claim | Confirmed at HEAD |
|------|-------|-------------------|
| 1 (Critical) | registerAgent fail-closed rollback + JSDoc | `runtime/daemon/agent-manager.ts:440` — `DURABILITY CONTRACT (Task 1 Critical — fail-closed)` |
| 2 (Important) | /inject whitespace delimiter | `runtime/telegram/commands.ts:177` — `afterCmd.search(/\s/)` |
| 3 (Important+Minor) | getLastStatus type / isAlive naming | `agent-manager.ts` — `StatusValue \| undefined` + JSDoc distinction |
| 4 (Important) | metrics by_session split + input-sink reconciliation | `scripts/metrics-aggregate.mjs` — dual-sink (dir + ndjson) |
| 5 (Minor batch) | cleanups + fail-closed exit codes | `metrics-aggregate.mjs` / `fake-broken-adapter.ts` |
| 6 (Critical) | result-envelope run-correlation + durable dead-letter | `runtime/daemon/main.ts:637` — Task 6 durable run-correlated marker |
| 7 (Important) | bound GraphQL PR-fetch body | `runtime/daemon/pr-triage-fetch.ts:48` — `MAX_RESPONSE_BYTES` |
| 8 (Important) | cron-restart × heartbeat single-restart authority | `runtime/daemon/cron-scheduler.ts` (PR #92 +195, single-restart) |

**Regression check:** no commit between `b3af16c` and HEAD touched any of these files — the
fixes are present unchanged.

## Why this happened

The execution was authorized from an 8-day-old memory snapshot
(`project_daemon_registration_orphan_window`, written 2026-06-08) that recorded the fix as
"deferred to a fresh session." PR #92 merged 2026-06-13 — after the snapshot — so the memory
was stale. Memory corrected 2026-06-16 to mark DD-R1 CLOSED.

## Disposition

- Plan archived to `.iago/plans/_archive/2026-06-daemon-recovery-hardening/` with a #92 pointer header.
- DD-R1 / C2 / C1 treated as **CLOSED**. Phase 2's last code-gating Critical is resolved.
- No follow-up code work from this plan. Re-derive a fresh plan only if genuinely new daemon
  defects surface against current main.
