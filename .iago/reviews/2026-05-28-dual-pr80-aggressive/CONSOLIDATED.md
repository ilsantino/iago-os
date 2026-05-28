# PR #80 Dual Adversarial — Consolidated

**PR:** https://github.com/ilsantino/iago-os/pull/80
**Branch:** `feat/pr-triage-dispatch-handler`
**Plan:** `.iago/plans/feature-phase-2-vps-bootstrap/04d-pr-triage-dispatch-handler.md`
**Date:** 2026-05-28
**Reviewers:**
- Opus 4.7 subagent (review-full) — verdict PROCEED_WITH_FIXES — `opus-aggressive.md`
- Codex GPT-5.5 (codex-companion) — verdict needs-attention — `codex-aggressive.md`
- Async @claude bot (prior pass) — 1 Important + 3 Minor

**Overall verdict:** BLOCK on Critical-1 and Critical-2. Both are ship-stoppers.

**Update 2026-05-28 13:35** — Async @claude review-fix loop pushed 2 rounds (`378f974` + `fe2315f`) addressing async-bot findings + C-0 CI break. CI now green. **Codex C-1 + C-2 remain unaddressed** because the async bot never saw the dual-adversarial findings; the loop only fixes what its own pass flagged. Dispatch fix-session against C-1 + C-2 + Important set still required.

---

## Critical (ship-blockers, both reviewers concurrent or Codex-flagged data loss)

### C-0 — RESOLVED in `fe2315f` (async @claude fix-loop round 2)
**Original:** CI red: integration tests broken by boot-spawn side-effect (GitHub Actions run 26596096329)
**Where:** `runtime/integration/hello-world.test.ts:345` + `:610`
**Bug:** Plan 04d's boot-time `registerAgent` for cron agents (the I-C structural issue) shows up as a concrete test failure. Hello-world integration fixtures asserted empty / single-handle starting state; with pr-triage now pre-registered at daemon startup, the assertions see one extra handle.
- `:345` — expected handle count 1, received 2
- `:610` — expected `[]` of pr-triage-shaped handles, received `[{agentId: "pr-triage", runtime: "claude-pty", ...}]`
**Severity:** Critical because CI is red and blocks merge. The fix is either:
- (a) Update fixtures to exclude pr-triage (acknowledges the new world: cron agents always pre-register)
- (b) Filter assertions to ignore cron-class handles
- (c) Inject `enableCronAgents: false` for hello-world fixtures
**Fix:** (a) is most honest. The integration tests should reflect that cron agents are registered at boot. Update both assertions to slice/filter pr-triage out, or assert that pr-triage IS present.


### C-1 — Duplicate dispatch race (Codex-1; Opus cross-cutting "duplicate dispatch possible")
**Where:** `runtime/daemon/agent-manager.ts:1678-1690` + `runtime/daemon/main.ts:585-612`
**Bug:** `processPendingTask` emits `task-dispatch-needed` synchronously, but the handler is detached as `void taskDispatchHandler(evt)`. The polling loop returns immediately while the handler still awaits `runtime.send`. If a polling tick fires before the in-flight handler resolves (interval < send latency), the next tick rereads the same `pending/{filename}.json` and emits a second dispatch. Both handlers call `runtime.send` then `claimTask`. First `claimTask` moves the file to `resolved/`; second `claimTask` rename ENOENTs and emits `claim-task-failed`. Net effect: duplicate prompt sent to the PTY.
**Severity:** Opus rated negligible for daily cadence (Phase 2). Codex insists Critical. Codex is right — duplicate PR-triage actions are observable to humans and "daily cadence" is a Phase 2 assumption that does not carry forward.
**Fix:** Per-filename in-flight guard (Set<string> of filenames currently being dispatched, populated before emit, cleared in handler's finally). Cleaner: atomic move to `processing/` BEFORE the emit, with `claimTask` moving from `processing/` to `resolved/`. Plan stress-test C1's "listenerCount > 0" guard does not address re-entrancy on the same filename.

### C-2 — Shutdown listener-less fallback enables silent data loss (Codex-2)
**Where:** `runtime/daemon/main.ts:1303-1317`
**Bug:** Shutdown order is: `scheduler.stop()` → `removeAllListeners("task-dispatch-needed")` → `stopPollingLoop()`. Between #2 and #3, an in-flight polling tick that enters `processPendingTask` sees `listenerCount === 0` and takes the C1 backwards-compat fallback to `claimTask` — moving the pending file to `resolved/` WITHOUT EVER SENDING IT to the runtime. The cron slot is released, the task looks completed, and the work is lost.
**Severity:** Codex Critical. Opus M-A noted a related shutdown race but landed on "task stays in pending" — Opus missed that the C1 fallback actively resolves the task. This is a real data-loss path on every deploy/restart that happens to coincide with a pending task.
**Fix:** Two options.
- (a) Reorder shutdown: stop polling loop FIRST (drain in-flight ticks), THEN remove listeners. This means polling continues briefly after `scheduler.stop`, but no new cron writes are happening so `pending/` doesn't grow.
- (b) Remove the listener-less `claimTask` fallback entirely now that dispatch is wired unconditionally. The C1 backwards-compat switch was a stress-test artifact; once Phase 2 ships, there's no caller path without a listener. This is the cleaner fix and removes the foot-gun for Phase 3.
- Recommend (b) primary + (a) as belt-and-suspenders. Remove the dead code path; reorder anyway because draining is correct.

---

## Important

### I-A — DN-4 test does not actually validate the no-double-claim invariant (Opus I-A)
**Where:** `runtime/daemon/agent-manager.test.ts:2079-2121`
**Fix:** Spy on `mgr.claimTask`, assert never called. Remove `.catch(() => {})` wrapper. Assert `polling-loop-error` telemetry emitted.

### I-B — TASK_PAYLOAD_MAX_BYTES check fires after readFile allocation (Opus I-B)
**Where:** `runtime/daemon/agent-manager.ts:1644-1656`
**Bug:** `fsp.readFile(src, "utf8")` allocates the full string before the size check. Adversarial 10MB file = 10MB heap allocation per polling tick.
**Fix:** `fsp.stat` first, abort if `stats.size > TASK_PAYLOAD_MAX_BYTES`. Closes the actual threat the plan named.

### I-C — registerAgent boot-spawns live PTY couples runtime-handle with dispatch-wired (Opus I-C)
**Where:** `runtime/daemon/main.ts:1168-1181`
**Bug:** `registerAgent` for cron agents spawns a real PTY at daemon startup. If the PTY exits before first cron-fire (credential expiry, crash, heartbeat recycle), `isAgentRegistered` returns false and dispatch emits `unregistered`. The pre-registration is silently lost.
**Fix:** Phase 2 minimum — document the boot-time spawn explicitly + add heartbeat-driven re-registration on handle-exit for cron agents. Phase 3 should decouple via `preRegisterAgentId(agentId)` API (separate concern).

### I-D — Async bot I-1: missing startDaemon integration tests for wiring assertions (a) + (b)
**Where:** `runtime/daemon/main.test.ts`
**Fix:** Two tests with synthetic agentsDir + agent-config.json fixture. Assert `listenerCount('task-dispatch-needed') > 0` after `startDaemon` returns. Assert `isAgentRegistered("pr-triage") === true` before polling starts. Both call `daemon.shutdown()` in cleanup.

### I-E — Empty-prompt acknowledged after send = silent loss (Codex-3, Opus m-4 partial, async bot M-3)
**Where:** `runtime/daemon/main.ts:593-613`
**Bug:** Non-string `prompt` → `""` → `runtime.send("")` → `claimTask` → file resolved. Looks completed, never delivered. The async bot rated this Minor; Codex correctly rates it Medium-leaning-High because the resolved state misrepresents completion.
**Fix:** Validate `prompt` as non-empty string BEFORE dispatch. On failure, emit `pr-triage-dispatch-failed { reason: "malformed-task" }` AND leave file in `pending/` for human inspection OR poison to `tasks/poisoned/`. Update telemetry union to include `malformed-task`.

---

## Medium

### M-A — agentId length cap missing before isAgentRegistered (Opus M-B)
**Where:** `runtime/daemon/agent-manager.ts:1672-1677`
**Fix:** After type check, assert `agentId.length <= 255`, treat oversized as `missing-agent-id` poison.

### M-B — Shutdown race telemetry gap (Opus M-A)
**Where:** `runtime/daemon/main.ts:1283-1315`
**Note:** Largely superseded by C-2 fix. If C-2 fix removes the listener-less fallback (option b), this gap closes automatically.

---

## Minor (lowest priority)

- async bot M-2: targeted `removeListener(taskDispatchListener)` instead of `removeAllListeners` — confirmed by Opus
- async bot M-4: DN-4 comment mislabel
- Opus m-3: defensive JSDoc on `makeDaemonStartupSessionId` re: safe-identifier
- Opus m-2: `loadAgentConfig` `Object.entries` cast cosmetic only

---

## Recommended fix priority

1. **C-2 first** (data loss on deploy; option b removes the foot-gun + a reorders for safety)
2. **C-1** (duplicate dispatch; per-filename guard or `processing/` move)
3. **I-E** (silent-loss empty prompt — same code region as C-1; bundle the fix)
4. **I-B** (readFile allocation; `fsp.stat` swap is one-line)
5. **I-D** (startDaemon integration tests; addresses both async bot + provides regression coverage for C-1 + C-2)
6. **I-A** (DN-4 spy hardening)
7. **I-C** (registerAgent re-registration on handle-exit + doc)
8. **M-A / M-B / Minors** (sweep at the end of the fix session)

## Verdict

**BLOCK merge.** Dispatch fix-session with this consolidated report as input. After fix-session + rebuild + re-review pass, decision lands with Santiago for merge.
