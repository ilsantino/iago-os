# Daemon Recovery Hardening — Plan 01

_Created 2026-05-30. Spec source: the dual-adversarial gate (Opus 4.8 ∥ Codex GPT-5.5 + completeness/tests/code-quality lenses) run on PR #87 (orphan-coverage recovery). Every task below is a finding that gate raised, with provenance verified against `origin/main`. The findings are already adversarially validated — the pipeline STRESS stage may treat this as PROCEED._

## Why this plan exists

PR #87 faithfully restores daemon content lost to the 2026-05-18 wrong-base merges (b-05, c-03). A fresh, stronger cross-model gate on that recovery diff surfaced one pre-existing Critical and three recovery-introduced Important defects in the restored content (the original 2026-05-18 review was weaker and missed them). Per the recovery's design, #87 stays a **pure, auditable restore** — all remediation is consolidated here and run through the full pipeline. Execute **after #87 merges** (these tasks edit files #87 restores).

## Provenance legend
- **pre-existing** — bug is on `origin/main` today; #87 does not worsen it.
- **introduced** — bug rides in with the recovered b-05/c-03 content.

---

## Task 1 — registerAgent durability hole (Critical) + JSDoc correction

**File:** `runtime/daemon/agent-manager.ts` (`registerAgent` ~L342–360, `persistAgentConfig` ~L1235–1317). **Provenance:** CODE **pre-existing**; the misleading JSDoc is **introduced** (b-04/Plan 04).

**Defect (Codex):** `registerAgent` sequences `runtime.spawn` → `trackHandle` → `persistAgentConfig`. `persistAgentConfig` catches its `writeFile` error and only `console.error`s it — no throw, no rollback. A disk/permission/ENOSPC failure therefore returns a **successfully-tracked LIVE agent with no `agents/<id>.json` on disk** → after a daemon crash/restart, boot recovery and the on-disk uniqueness scan (`assertAgentIdAvailable`) cannot see it → the agent is **unrecoverable** and a later `registerAgent` of the same id can **duplicate** it. Compounding: the method JSDoc (L318-324) falsely claims `persistAgentConfig` runs **BEFORE** `runtime.spawn` ("Plan 04 hardening"), so a maintainer believes the hole is closed. The 48 agent-manager tests pass because none injects a persist failure.

**Fix:**
- Make persistence load-bearing: either (a) persist a **pre-spawn reservation** record then finalize after spawn, or (b) on any `persistAgentConfig` failure, **shut down + untrack** the spawned handle and **reject** `registerAgent` (fail-closed). Pick (b) unless (a) is cheaper to reason about; keep the in-process registration lock intact.
- Correct the JSDoc to describe the **implemented** ordering and durability contract — no false "persist-before-spawn" claim.
- **Regression test (required):** inject a `persistAgentConfig` write failure; assert `registerAgent` rejects AND no live/tracked handle leaks (fails without the fix, passes with it).

## Task 2 — /inject whitespace delimiter (Important)

**File:** `runtime/telegram/commands.ts` (~L160-170). **Provenance:** **introduced** (b-05; `indexOf(" ")` absent on `origin/main`).

**Defect (Codex):** the agent/text boundary is found via `afterCmd.indexOf(" ")` (literal space) despite the code's stated intent to "preserve whitespace (newlines, repeated spaces, tabs)". `/inject claude-main\nhello` or `/inject claude-main\thello` returns `-1` → rejected as "missing argument: text" though a valid agent+payload is present; and a later literal space folds a leading newline/tab into the agent name. All 31 command tests use a space, so the case is untested.

**Fix:** split on the first whitespace **run** (`/\s+/` or first `/\s/` index), preserving everything after the delimiter verbatim. **Regression tests (required):** `/inject agent\ntext` and `/inject agent\ttext`.

## Task 3 — getLastStatus / isAlive untested + type/naming (Important + Minors)

**File:** `runtime/daemon/agent-manager.ts` (~L393-417). **Provenance:** **introduced** (b-05; both methods net-new, absent on `origin/main`).

**Defect (tests lens):** `getLastStatus` and the AgentManager-level `isAlive` have **no test against the real class** (only mocked via `bot.test.ts`). `isAlive` maps `lastStatus` → liveness (running/idle→true, exited/crashed→false, unknown→undefined, unknown-handle→undefined) and feeds the Telegram `/status` reply; a mapping bug (e.g. idle→false) is uncaught.

**Fix:**
- Unit tests on a **real** `AgentManager` instance covering every `StatusValue` branch + the unknown-handle guard.
- Minor: tighten `getLastStatus` return from `string | undefined` to `StatusValue | undefined` (keep callers narrowable).
- Minor: `isAlive` collides by name with the adapter's async `AgentRuntime.isAlive(handle)` (cached-sync vs probe-async). Rename to e.g. `deriveLivenessFromStatus` / `cachedIsAlive`, or keep + strengthen the JSDoc distinction.

## Task 4 — metrics by_session bucket split (Important, lower-impact) + input-sink reconciliation

**File:** `scripts/metrics-aggregate.mjs` (`sessionKey` ~L105, by_session ~L187-221). **Provenance:** **introduced** (c-03 sessionId projection).

**Defect (code-quality lens):** when `CLAUDE_CODE_SESSION_ID` is unset (the normal cron/CI shape), `pipeline_init` emits `outer_session_id:""` while downstream records emit the synthesized `sessionId:"claude-{RUN_ID}-..."`. `sessionKey()` buckets init under `outer_session_id` but stage/finalize under `sessionId` → one run splits: phantom init in `_unsessioned`, stages under the synthesized id (`inits=0` for the real row). Only the aligned case is tested.

**IMPORTANT context (verified 2026-05-30):** this aggregator reads `.iago/state/pipeline-runs/` (a **directory**, old bash-pipeline convention) but the **live JS workflow** (`execute-pipeline.js:419`) appends to `.iago/state/pipeline-runs.ndjson` (a single **file**). The aggregator is therefore currently **mismatched with the live telemetry sink** — the bucket-split has low real-world impact today. **Fold the bucket-split fix into a reconciliation** of the aggregator's input convention with the JS pipeline's actual sink (read both the legacy dir AND the new file, or migrate). Add a regression test for the unaligned (orchestrator-less) case.

## Task 5 — Minor cleanups (batch)

- `runtime/integration/fixtures/fake-broken-adapter.ts:42` — remove the dead `// eslint-disable-next-line @typescript-eslint/no-explicit-any` (repo is Biome, not ESLint) or convert to `// biome-ignore`. **Provenance: introduced.**
- `runtime/daemon/session-log.ts:70-72` — comment falsely claims a "50MB telemetry warning" exists at boot recovery; no such telemetry kind / `fs.stat` check exists. Either wire the warning or correct the comment to say it is NOT yet implemented (don't mask the unbounded-growth risk). **Provenance: introduced.**
- `runtime/integration/hello-world.test.ts:332` — rename the stale test title ("registers via side-effect import") to reflect the new `loadAdapterFailIsolated` dynamic-import boot path the PR actually exercises. **Provenance: introduced.**
- `scripts/metrics-aggregate.mjs:191-195` — "I5 note" comment claims `stage_end` records have `sessionId` mutated to null on the parsed record; line 110 assigns a new local, not a mutation. Correct the comment (code is correct; comment misleads). **Provenance: introduced.**
- `scripts/metrics-aggregate.mjs:47-87` — exit-code contract is inconsistent (absent/empty runs dir → exit 0; populated-but-incomplete → exit 1). Pick one no-data policy and add tests for the missing-dir / empty-dir exit-0 path. **Provenance: introduced.**

---

## Tasks 6–8 — deferred from the PR #84 dual-adversarial gate (R1 daemon-creds)

_Added 2026-06-01. Provenance: the `dual-adversarial` gate (Opus 4.8 ∥ Codex GPT-5.5, pass#2/#3) on PR #84 (`feature-pr84-r1-daemon-creds`, "agents never hold secrets"). PR #84's R1 security goal shipped and was confirmed by the gate's security lens; these three operational-robustness findings were deferred here because every one is bounded to a **missed or duplicated daily notification on the undeployed daemon** (OpenClaw still runs) — none is a merge-blocker. They edit the same daemon files this plan already owns; run them in the same pipeline pass as Tasks 1–5._

## Task 6 — result-envelope run-correlation + dead-letter durability (Important)

**File:** `runtime/daemon/main.ts` (`makeResultTimers` ~L617-657; the envelope claim/send in `makeTaskSendHandler` ~L659-720). **Provenance:** PR #84 gate (#1), **introduced** by the R1 result-envelope mechanism. **Distinct from Task 1** (that is the `persistAgentConfig` *persist* hole = finding #5; this is the *result-envelope correlation* hole = finding #1 — do not conflate).

**Defect (dual-adversarial #1):** the dead-letter timer is keyed by a **single bare `agentId`** (`timers = new Map<string, NodeJS.Timeout>()`, L634) and the send handler **claims the envelope by `agentId` alone** — there is no per-dispatch run/correlation id. The code asserts `maxConcurrent: 1` makes a single-key map "sufficient" (JSDoc L619-621), but that invariant is (a) **not durable across a daemon restart** — the timer is in-memory and `.unref()`'d (L653; JSDoc L622-623 explicitly "does NOT survive a daemon restart"), so a dispatch in flight when the daemon restarts loses its dead-letter timer and `pr-triage-result-timeout` never fires → a silently missing daily summary; and (b) **fragile to re-fire / a future `maxConcurrent > 1`** — a late envelope from a prior run can be claimed against the current run's key (wrong-run attribution), or a stale envelope mistaken for the live one.

**Fix:**
- Correlate the result envelope and its dead-letter timer by a **per-dispatch run id** (e.g. a correlation id stamped into the dispatch event and echoed back in the envelope), not by bare `agentId`. Ignore/reject an envelope whose run id does not match the in-flight dispatch.
- Make the dead-letter **durable across restart**: persist the in-flight dispatch deadline (a `pending/`-style marker the boot path scans) so a daemon restart re-arms or immediately dead-letters an orphaned dispatch instead of silently dropping it.
- **Regression tests (required):** (1) daemon "restart" mid-dispatch → the orphaned dispatch is dead-lettered (`pr-triage-result-timeout`) rather than lost; (2) a stale/wrong-run envelope is NOT claimed against the current run.

## Task 7 — bound the GraphQL PR-fetch response body (Important)

**File:** `runtime/daemon/pr-triage-fetch.ts:299` (`json = await res.json()`; `DEFAULT_FETCH_TIMEOUT_MS = 15_000` L34, `AbortController` L264-265). **Provenance:** PR #84 gate (#2), **introduced** by the daemon-owned fetch.

**Defect (dual-adversarial #2):** the fetch is bounded only in **time** (the 15s `AbortController`), never in **size**. `await res.json()` buffers the **entire** response body into memory. A large or hostile GitHub GraphQL response (the query can return on the order of thousands of PR bodies) can exhaust the daemon's heap before the timeout trips — an availability/OOM risk on the long-lived daemon process, and one the time limit does not cover.

**Fix:**
- Enforce a **byte cap** before/while reading the body: reject when `Content-Length` exceeds a sane limit AND stream-read with a running byte counter that aborts past the cap (`Content-Length` can be absent or lie). Throw `FetchPrsError` (→ `pr-fetch-failed` telemetry) on overflow, mirroring the existing non-200 / invalid-JSON handling.
- Derive the cap from the realistic max (open-PR count × the max body the query selects) plus headroom; make it a named constant beside `DEFAULT_FETCH_TIMEOUT_MS`.
- **Regression test (required):** a response exceeding the cap throws `FetchPrsError` (and emits `pr-fetch-failed`) rather than buffering unbounded.

## Task 8 — cron-restart × heartbeat-recycle double-restart race (Important)

**File:** `runtime/daemon/main.ts:1354-1363` (the existing `DEFERRED (F2…)` pointer that already names this plan) + the cron `scheduleRestart` loop (~L1364+) and `AgentManager.restartAgent` / `doRestart`. **Provenance:** PR #84 gate (F2), **pre-existing** coupling surfaced by pass#3.

**Defect (dual-adversarial F2):** two independent restart subsystems can act on the same `agentId` — this cron-restart loop's exit-listener path and the heartbeat-driven recycle (`AgentManager.restartAgent`/`doRestart`). They can **race or double-restart** the same agent; and a heartbeat-initiated recycle does **NOT re-arm THIS loop's exit listener**, so after a recycle the cron agent can exit again with **no cron-side restart** (silent death of the daily job). `main.ts:1354-1363` already documents this and points here; do **not** patch it inline — a partial fix interleaves with the heartbeat recycle (the foot-gun this plan resolves holistically).

**Fix:**
- Establish a **single restart authority** for an `agentId` (one owner, or a shared per-`agentId` restart lock / generation counter both paths consult) so a heartbeat recycle and a cron-exit restart cannot both fire, and a recycle re-establishes (or hands back) the cron-side exit listener.
- **Regression test (required):** simulate a heartbeat recycle followed by an agent exit → exactly one restart occurs AND the cron-side exit listener is still armed (a subsequent exit restarts).

## Out of scope (separate diagnosis, NOT this plan)
- The 2 Windows-only vitest failures (`cred-bootstrap` chmod-0o000, `approval-bus` ENOTDIR) — **pre-existing, environmental**; pass on Linux CI. Independently confirmed by the gate's code-quality lens. Track as a "make Windows-incompatible fs-permission tests skip-on-win32" chore if Windows CI is ever added.

## Acceptance criteria
- Re-run the `dual-adversarial` workflow on this plan's PR diff → `clean: true` (no Critical/Important).
- `cd runtime && npx tsc --noEmit` exit 0; `npm run test:coverage` green on Linux CI.
- Each Critical/Important fix ships a regression test that fails without the fix and passes with it (TDD RED→GREEN).
