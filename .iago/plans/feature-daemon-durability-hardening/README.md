# feature-daemon-durability-hardening

**Status:** planned 2026-07-01 (awaiting `/iago-execute`)
**Source:** Workstream B of `.iago/research/2026-06-13-deferred-backlog-index.md` →
`.iago/research/2026-06-13-daemon-durability-deferrals.md` (PR #92 final re-gate deferrals).
**Scope:** the daily pr-triage summary delivery + recovery state machine in `runtime/daemon/`.
4 Important + 5 Minor findings. Excludes Workstream C cutover-gate items (deploy-time) and the
structural Minors DD-13 (`main.ts` extraction) / DD-14 (session-log growth).

These Importants should land **before** the Phase 7 VPS cutover — the daemon is not yet deployed,
so risk is bounded, but each edge is a lost or duplicated daily notification under a rare multi-fault.

| Plan | Wave | Depends | What it does | Findings |
|------|------|---------|--------------|----------|
| 01 | 1 | — | Deterministic out-of-band delivery correlation + durable tombstone (stop LLM-echo dependence; stop marker-cleared-by-completion causing fresh re-dispatch) | DD-03, DD-02 |
| 02 | 2 | 01 | Idempotent resume delivery (delivered-state; RESUME re-sends when unconfirmed) + result-machine recovery Minors | DD-01, DD-04, DD-05, DD-06 |
| 03 | 1 | — | Quarantine boot-surfacing — boot scans the quarantine dir so a quarantined agent isn't silently disabled across restarts | DD-R2 |
| 04 | 1 | — | Windows test portability — `skipIf(win32)` the two POSIX-perm error-path tests (real coverage stays on Linux CI) + `testTimeout` bump on the fsync-heavy append test; **no production code** (fs-hooks seam BLOCKED by stress, descoped) | DD-T1, DD-T2 |

**Execution note:** all of 01/02/03 touch `runtime/daemon/main.ts`; `/iago-execute` stacks plans
sequentially on one branch chain, so wave numbers order dispatch and the stack avoids parallel
conflicts. 02 depends on 01's durable-record primitive. 03 and 04 are independent and may lead.
