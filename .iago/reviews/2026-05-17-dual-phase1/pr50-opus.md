# PR #50 Adversarial Review — `feat/atomic-rename-audit`

## Verdict: APPROVE_WITH_NOTES

Plan 02 lands cleanly: the `atomicRename` / `atomicRenameStaleDest` split is correctly named, the link+unlink strict variant is real (not a rename hedge), and the PR48 Codex HIGH (dual-presence stranding) is addressed via `recoverStrandedApprovals` + runtime roll-forward — not papered over. Tests assert real contracts (telemetry shape, rollback, inflight-only recovery). No Critical findings. Two Important doc/classification concerns and three Minor items below.

---

## Critical

_None._

---

## Important

### I1 — Outdated Windows `rename` JSDoc on `atomicRenameStaleDest`
**File:** `runtime/daemon/state-paths.ts` (`atomicRenameStaleDest` JSDoc block)

The JSDoc asserts Node's Windows `fs.promises.rename` does not pass `MOVEFILE_REPLACE_EXISTING`, justifying the EEXIST/EPERM unlink-then-rename recovery path. Modern libuv (Node ≥ 14, definitely Node 20 which the runtime targets) does pass `MOVEFILE_REPLACE_EXISTING | MOVEFILE_COPY_ALLOWED`. The recovery branch is therefore mostly dead on modern Node — it will fire only when the destination is locked by another handle (sharing-violation EPERM), not for ordinary overwrites.

This is a **doc/justification drift**, not a behavioral bug — the catch is still correct defense-in-depth. But the doc misleads future readers about *why* the branch exists, and the telemetry counter (`atomic-rename-stale-dest-window`) will read as "Windows is broken, look how often we hit it" when in fact it's measuring sharing-violation contention. Fix the JSDoc to cite the actual modern reason (handle-held EPERM) and reframe the telemetry as a contention signal.

### I2 — `link(2)` EPERM silently classified as "race lost" in CLAIM
**File:** `runtime/telegram/approval-bus.ts` (CLAIM error classification near the `atomicRename(claimSrc, claimDst)` call site)

The CLAIM path catches errors from `atomicRename` and treats EEXIST/EPERM as "another resolver won the race" → returns `not-found` or `already-resolved`. On Linux with `fs.protected_hardlinks=1` (the kernel default on every modern distro), `link(2)` returns **EPERM** when src and dst owners differ or the caller doesn't own src and lacks write permission. In that case the daemon will silently report `not-found` for every approval forever — no error log, no telemetry, no observable signal of the misconfiguration.

Single-user daemon makes this low-likelihood (daemon runs as one uid, state-dir is owned by that uid), but the failure mode is **silent + permanent + indistinguishable from legitimate race**. At minimum: emit a telemetry event when EPERM is observed AND no winning resolver state exists on disk after re-scan; ideally distinguish `link`-EPERM from `rename`-EEXIST at the catch site so the classifier doesn't conflate "lost race" with "kernel refused the link."

---

## Minor

### M1 — `file-bus.ts:252` raw `fsp.rename` is documented as deferred but not tracked
**File:** `runtime/daemon/state-paths.md` (Notes section) + `runtime/daemon/file-bus.ts:252`

Audit doc explicitly carves out this call site as out-of-scope for Plan 02. Same cross-platform asymmetry as the original approval-bus bug. No follow-on issue / plan reference in the doc — should at minimum cite "tracked as Plan 0X in feature-Y" or open an issue link, otherwise it will drift.

### M2 — No test for `atomicRename` both-unlinks-fail (permanent dual-presence)
**File:** `runtime/daemon/state-paths.test.ts`

Tests cover the rollback path when `unlink(src)` fails and `unlink(dst)` rollback succeeds. No test asserts behavior when both unlinks fail — i.e. permanent dual-presence requiring boot recovery. Acceptable because `recoverStrandedApprovals` handles it, but the contract that `atomicRename` propagates the original `unlink(src)` error (not the rollback error) is untested.

### M3 — `vi.mocked(fsp.rename).mockImplementationOnce(...)` reset hygiene
**File:** `runtime/daemon/state-paths.test.ts` (telemetry test block, ~line 1671)

Tests rely on one-shot `mockImplementationOnce` consumption with no explicit `vi.restoreAllMocks()` / `mockReset` in `beforeEach`. If a future test forgets to consume its one-shot, the next test in run order inherits stale behavior. Add a `beforeEach(() => vi.restoreAllMocks())` or document the convention at the top of the file.

---

## Dimension verdicts

- **Auth/security: PASS** — `isValidApprovalId` strict UUID regex `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/` rejects path-traversal in `recoverStrandedApprovals` directory scan; no shell exec or unvalidated paths.
- **Data loss: PASS** — Codex HIGH (CLAIM-crash dual-presence stranding) addressed via `recoverStrandedApprovals` boot-time three-way reconciliation (republish / cleanup / resolvedSurvived) running before `TelegramBot.start()`.
- **Concurrency: PASS** — In-process `inProcessResolveLocks` Map serializes per-approvalId resolution; single-process assumption documented in `state-paths.md`; cross-process hazards explicitly out of scope.
- **Rollback safety: PASS** — `atomicRename` best-effort `unlink(dst).catch(() => undefined)` on src-unlink failure; original error rethrown; dual-presence is recoverable via boot reconciliation.
- **Plan compliance: PASS** — All 7 plan tasks landed (inventory, classification matrix, API split into named variants, all callers migrated, tests added, telemetry counter mandatory not optional, audit doc + Failure Modes README entry). Implementer forward-list honored (link+unlink, mandatory telemetry).
- **Code quality: PASS** — JSDoc on both variants explains contract + platform behavior + when to choose which; named-export discipline; no `any` / `as` casts in new code.
- **Test quality: PASS** — 10 new tests in `state-paths.test.ts` (telemetry emission shape, non-emission on happy path, rollback), 7 new in `approval-bus.test.ts` (dual-presence + inflight-only recovery covering Codex HIGH). Assertions check real contracts, not implementation incidentals.

---

## Notes

- PR scope is Plan 02 only; the diff also contains Plan 01 dispatch logs and summary files committed alongside but already shipped via PR #49 — these are inert artifacts, not behavioral changes, and don't affect this review.
- The `atomic-rename-stale-dest-window` telemetry should be reframed in I1 as a Windows-handle-contention signal rather than a "Node bug" signal, which will make the metric actionable in production (high counter → identify which process holds the conflicting handle).
- `recoverStrandedApprovals` runs after `agentManager.bootRecovery()` and before `IpcServer` + `TelegramBot` start — correct ordering verified in `runtime/daemon/main.ts` steps 6 → 6b → 7 → 8. No window where new approvals can arrive before stranded ones are reconciled.
SessionEnd hook [node "${CLAUDE_PLUGIN_ROOT}/scripts/session-lifecycle-hook.mjs" SessionEnd] failed: Hook cancelled
