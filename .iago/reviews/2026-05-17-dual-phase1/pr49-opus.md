I've finished the analysis. Writing the review now.

```
# Adversarial Review (Opus 4.7): PR #49

**Verdict:** APPROVE_WITH_NOTES
**Plan(s) reviewed against:** `.iago/plans/feature-phase-1-deferred-hardening/01-ipc-server-hardening.md`
**Diff size:** 808 insertions / 12 deletions across 4 files (`ipc-server.ts`, `ipc-server.test.ts`, `README.md`, plus `_dispatch-b-01.log` artifact)

## Critical
- None.

## Important
- **I1 — Residual closure buffer not cleared after `rejectOversizedLine`.** `runtime/daemon/ipc-server.ts:285-318`: when the residual-buffer path fires `rejectOversizedLine(socket)` and `return`s, the closure-local `buffer` variable still holds the oversized contents and is NOT zeroed. Node's stream contract is that no further `data` events should fire after `socket.destroy()`, but Node's source has historically allowed already-queued microtask events to drain. Defensive bound from the plan ("drop the connection now to bound memory") is one-shot — if any additional `data` event slips through, the loop re-enters, walks an unbounded buffer, and may invoke `processLine` on a destroyed socket (the writes are guarded by `!socket.destroyed && socket.writable`, but the dispatch + `inflight.add(work)` side effects still run). Same applies to the per-line path. **Recommendation:** after `rejectOversizedLine`, set `buffer = ""` AND either `socket.removeAllListeners("data")` or set a closure-scoped `rejected = true` flag that early-returns subsequent `data` callbacks. One-line fix; matches the plan's stated memory-bounding intent.

## Minor
- **M1 — Plan expected ≥25 tests; actual count is 21.** Plan §Verification (line 95) states "≥25 tests pass (was 21)" and dispatch log T2 (line 25) repeats "alongside the prior 21 (now 22)". The actual baseline was 12 tests, +9 added = 21 total (verified by counting `^\tit("` matches in `runtime/daemon/ipc-server.test.ts`). All required coverage is present (each H/C/I finding has a regression test, plus Codex H and Codex M), so this is a plan-authoring miscount, not a coverage gap. Update the plan's expected count or note the discrepancy in the PR summary so a future audit doesn't re-flag it.
- **M2 — Double-logging on tail rejection.** `runtime/daemon/ipc-server.ts:372-417`: every `work` promise has `work.catch(...)` attached (line 411) that logs `"[ipc-server] work rejected: ..."`. The NEXT request's `safePrevious` (line 375) also catches the same rejection and logs `"[ipc-server] previous tail rejected: ..."`. If a `work` rejects (very narrow path post-H3 — only an unguarded throw in the inner `then`), stderr gets two log lines for one failure. Defensive belt-and-suspenders; harmless but noisy if it ever fires. Acceptable as-is; document or de-dup in Phase 6 hardening if it becomes a signal-to-noise problem.
- **M3 — `socket.write(err) + socket.destroy()` may drop the error line on POSIX.** `runtime/daemon/ipc-server.ts:336-345`: the H1 reject path writes the JSON error line then immediately calls `socket.destroy()`. Node's Unix-socket behavior on `destroy()` after `write()` is "best-effort flush, may abort on the unwritten kernel buffer." For a 50-byte error response this almost always flushes (kernel SO_SNDBUF is multiple KiB and the response fits inline), and the H1 test passes on Windows where named-pipe semantics differ. Strictly safer pattern is `socket.end(JSON.stringify(errResponse) + "\n")` which guarantees a graceful FIN after the data is acked. Test coverage doesn't probe the worst-case (saturated send buffer). Mark as "documented hygiene posture, not strictly guaranteed delivery."

## Dimension verdicts
- Auth/security: PASS (0o600 perimeter unchanged; H1 byte cap is defense-in-depth on top of it; no new attack surface).
- Data loss: PASS (no durable writes touched; `stop()` resets all three cache fields including the new cooldown).
- Concurrency: PASS (cooldown armed synchronously in catch BEFORE rethrow; `cachedFleetHealthPromise` cleared in finally; concurrent joiners observe armed cooldown correctly; H3 fix closes the previously-flagged response-desync hole).
- Rollback: PASS (no on-disk state migration; cooldown explicitly reset in `stop()` per I3; failed `doStart()` already leaves `this.server` null for retry).
- Plan compliance: PASS (all 8 tasks landed; C1+C2+I1+I2+I3 stress fixes addressed; Codex H + Codex M findings addressed in the same PR with dedicated tests at lines 445/490).
- Code quality: PASS (constants promoted: `DEFAULT_MAX_LINE_BYTES`, `DEFAULT_IDLE_TIMEOUT_MS`, `FLEET_HEALTH_REJECTION_COOLDOWN_MS`; `rejectOversizedLine` centralized; JSDoc explains intent on every new construct).
- Test quality: PASS (each fix has an isolated regression test; H3 test asserts the unhandledRejection listener never fired AND locks the stderr-log contract via `errorSpy.toHaveBeenCalledWith`; multibyte test specifically exercises Codex M's UTF-16-vs-UTF-8 trap; cooldown test uses `_setNowForTests` virtual clock instead of `vi.useFakeTimers` per I1).

## Notes
- This PR is the merge-train-deferred sweep against PR #44's 4 Important + 1 Minor findings. The stress test in the plan already pre-flagged 2 Critical + 3 Important wedges (C1/C2/I1/I2/I3); the implementer rolled them into the same PR. Codex's adversarial review caught two additional real bugs (response-desync via dropped serialization, UTF-16-vs-UTF-8 cap bypass) which were also fixed in-PR.
- The `_dispatch-b-01.log` artifact (174 lines, committed under `.iago/summaries/`) captures the full pipeline trace. No issue with the commit itself, but consider whether dispatch logs belong in `git` or in `.gitignore` going forward — they grow per PR.
- I1 above is the only finding worth a follow-up commit before merge; M1-M3 are documented for the next sweep.
```
