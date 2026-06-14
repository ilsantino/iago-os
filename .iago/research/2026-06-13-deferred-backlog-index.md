# Deferred backlog index — consolidated map of every open deferred item

**Date:** 2026-06-13
**Owner:** iaGO-OS review/daemon workstreams
**Status:** living index — the single map over the 4 canonical deferral trackers.

## Purpose & how to use

Four separate dual-adversarial re-gates (PRs #84, #89, #90, #92) plus one
efficiency teardown each produced their own deferral list. This index is the
**one place** that enumerates every distinct still-open item, so nothing is
double-counted, silently dropped, or mistaken for an untracked Critical. Each
row carries: **id · one-line · severity · owning workstream · source-note + line
range · re-scope trigger**. Read a row, then open the cited source for the full
rationale. When an item is fixed, strike it here AND in its source tracker.

**Bottom line:** ~38 distinct OPEN items across 3 workstreams + 1 standalone.
**Exactly 2 are Critical-severity, and both are TRACKED** (GH-15, DD-R1). No
untracked Criticals exist. The audit's one historical "Critical crack"
(PC-02 cron-restart-pins-dead-handle) was **FIXED in #92** — see *Recently closed*.

## Source trackers (canonical — this index derives from them)

| Tracker | Workstream | Items |
|---|---|---|
| `.iago/research/2026-06-13-gate-hardening-backlog.md` | A — gate-hardening PR (unblocked: #89 merged) | 16 |
| `.iago/research/2026-06-13-daemon-durability-deferrals.md` | B — durability-hardening PR (unblocked: #92 merged) | 14 (+4 adjacent) |
| `.iago/research/2026-05-30-pr84-gate-findings-and-cutover-gates.md` + `.iago/research/2026-05-28-pr84-gap-closure.md` | C — daemon cutover-gate checklist (runs at VPS deploy, NOT a code PR) | 7 |
| `.iago/research/2026-06-02-pipeline-efficiency-teardown.md` | standalone | 1 |

Related MEMORY pointers: `project_daemon_registration_orphan_window` (DD-R1),
`feedback_async_claude_loop_stale_ref`, `project_pipeline_v2`.

## Summary counts

| Workstream | Critical | Important | Minor | Total |
|---|---|---|---|---|
| A — gate-hardening | 1 (GH-15) | 5 | 10 | 16 |
| B — daemon-durability (core) | 0 | 3 | 11 | 14 |
| B — adjacent (test-infra + related-prior) | 1 (DD-R1) | 1 | 2 | 4 |
| C — cutover-gate (pr84 Phase-2) | — (deploy blockers) | 3 | 4 | 7 |
| standalone | 0 | 0 | 1 (design) | 1 |
| **distinct OPEN total** | **2** | — | — | **~38 core + 4 adjacent** |

## The 2 open Criticals (both tracked — no cracks)

- **GH-15 · probe-transcription-trust** — the dual-adversarial gate feeds the
  reviewer an LLM-transcribed changed-files list instead of a deterministic
  `git diff --name-only`; a hallucinated/omitted path mis-scopes review.
  Gate-calibrated **Critical**. Source: gate-hardening-backlog L81-83.
  Trigger: dedicated gate-hardening PR. (Re-confirmed by #90's reconcile re-gate
  as the "valid-but-incomplete probe" codex finding.)
- **DD-R1 · registration-orphan window** — PR #87 deferred Critical; the
  daemon registration durability gap that D1/D2 extend. Source:
  daemon-durability-deferrals L144-145 + MEMORY `project_daemon_registration_orphan_window`.
  Trigger: resilient-vs-durable design decision → durability-hardening PR.

---

## Workstream A — Gate-hardening PR (16)

Unblocked now #89 merged (`a5900b5`). The #89 final re-gate's 7 Importants + #90's
reconcile re-gate's GH-16 ARE the top of this backlog. Trigger for all: **dedicated
gate-hardening PR**.

| id | one-line | severity | source (L#) |
|---|---|---|---|
| GH-01 | Tier-keyword breadth — security plans without a literal keyword classify Tier 0/1 (baseline 2-leg, not deep team gate); also over-tiers "author"→Tier 3. Fix: broaden lists + ship `tier_override N` frontmatter seam | Important (security) | L20-27 |
| GH-02 | T06 durable-artifact honesty write untested — summary agent prompt not asserted; a regression dropping `verificationSameFamily`/`verificationDegraded` from the durable write would pass all tests | Important (tests) | L30-35 |
| GH-03 | Inline-path `crossModelDegraded` untested — sole inline test mocks `{source:'codex'}` (false branch only); add a `claude-fallback` Tier-1 test asserting `true` | Important (tests) | L36-39 |
| GH-04 | Plan-compliance leg lacks a read-only guard — runs after commit/before PR with no HEAD/porcelain snapshot; mark read-only + fail-closed on change | Important (codex high) | L41-48 |
| GH-05 | Drift-guard + 3 `.test.mjs` harnesses not wired into CI (`validate-workflows` is compile-only, globs `*.js`); wire classifyTier/execute-pipeline/dual-adversarial into `validate.yml`. (Re-confirmed by #90 re-gate's lens:tests finding — "inherits not introduces".) | Minor | L51-56, L84 |
| GH-06 | Drift-guard extraction regex non-greedy to first column-0 `}` — anchor to function end (brace-depth/sentinel) | Minor | L57-59 |
| GH-07 | Tier 0 operationally dead — `tier>=2?'team':'standard'` collapses Tier 0 into Tier 1; implement a lighter Tier-0 path or document Tier 0 ≡ Tier 1 | Minor | L60-62 |
| GH-08 | `fileCount` regex matches only `- **files:**`; repo plans use `**File:**` → fileCount always 0 (latent; real if Tier 0 ever thins review) | Minor | L63-65 |
| GH-09 | EOF-sentinel residuals — hallucinated sentinel on truncated transcription can under-tier; missing-sentinel escalation only fires when `tier<2` | Minor | L66-68 |
| GH-10 | Stale topology note in `2026-05-30-pipeline-dynamic-upgrade.md` ("team mode unmerged") — team mode IS on main; correct it | Minor | L69-70 |
| GH-11 | Diff-expr inconsistency — execute-pipeline uses two-dot `preImplSha..HEAD`; delegated team gate uses three-dot `base...HEAD`; align or document the invariant | Minor | L71-73 |
| GH-12 | `filtered` overwritten each fix round — final `out.filtered` reflects only the last re-review; accumulate across rounds | Minor | L74-75 |
| GH-13 | `refuteHasEvidence` weak-evidence bar (the original #90 I1) | Minor→Important | L78 |
| GH-14 | Team-leg failures should be non-blocking in `gateStatus` routing — confirm the orchestrator never mis-routes an incomplete gate to `/iago-prfix` | Minor | L79-80 |
| GH-15 | **Deterministic changed-files probe** (probe-transcription-trust) — feed a real `git diff --name-only` instead of an LLM transcription | **Critical (gate-calibrated)** | L81-83 |
| GH-16 | **deriveLenses dir-checks case-SENSITIVE** while `.tsx`/security checks are case-INSENSITIVE — PascalCase `Amplify/`/`Src/` dir silently drops the amplify/frontend lens (violates the fn's own "coverage must never shrink on case variation"). NOT a merge regression (pre-exists 51c3a0a; reconcile touched only SKILL.md). Fix: compare dir prefixes against `lower` + mixed-case tests | Important (arch ∥ codex ∥ data) | `## From #90's reconcile re-gate` |

## Workstream B — Daemon-durability PR (14 core + 4 adjacent)

Unblocked now #92 merged (`b3af16c`). Trigger for all core: **dedicated
durability-hardening PR**. Every core edge is bounded to **one missed daily
pr-triage notification under a rare multi-fault, self-healing on the next daily
cron**; the daemon is **not yet deployed**.

| id | one-line | severity | source (L#) |
|---|---|---|---|
| DD-01 | D1 — pre-send marker conflates "prepared" with "delivered" across a crash boundary; crash between marker write and `runtime.send` → RESUME re-claims without re-sending → lost summary. Fix: idempotent delivery (ack/runId dedup), not a two-phase marker | Important (Codex rated Critical) | L20-51 |
| DD-02 | D2 — result completion destroys the dedup marker while the source cron task stays pending (persistent rename fault) → fresh re-dispatch + possible 2nd Telegram push. Fix: durable tombstone keyed by source filename | Important | L53-74 |
| DD-03 | D3 — daily-summary delivery depends on the LLM echoing the UUID runId (I3 seam); forgotten substitution → silent drop. Fix: daemon stamps/correlates runId out-of-band | Important | L76-95 |
| DD-04 | `isActiveRun` fail-closed drops a live summary on a transient non-ENOENT marker read fault (documented symmetric tradeoff) | Minor | L101-103 |
| DD-05 | `malformed-task` early-return doesn't release the held cron slot (not reachable today; guard for symmetry) | Minor | L104-106 |
| DD-06 | `recoverResultTimers` malformed-marker branch emits no telemetry before unlinking; add `pr-triage-result-marker-corrupt` | Minor | L107-108 |
| DD-07 | `fireTimeout` dead-letter slot-leak-until-restart on a telemetry-write failure (self-heals on restart only) | Minor | L109-111 |
| DD-08 | `deferredNotified` Set pruned only on RESUME/successful-send — unbounded in principle; prune on quarantine/claim-out too | Minor | L112-113 |
| DD-09 | Quarantine guard bypassed by `attemptCrashReplay` (defense-in-depth; largely unreachable) | Minor | L114-116 |
| DD-10 | Retained zombie handle never reaped (option-a retain path, triple-compound disk fault) | Minor | L117-119 |
| DD-11 | `CronScheduler.restoreOutstanding` increments runningCount with no maxConcurrent clamp (safe today; defensive cap if maxConcurrent>1) | Minor | L120-122 |
| DD-12 | Per-tick polling re-reads stuck files (no mtime/hash skip-cache) — negligible at daily cadence | Minor | L123-125 |
| DD-13 | `main.ts` ~3.6k lines — extract result-timer/dead-letter state machine into `result-timers.ts` with explicit slot-release contract | Minor | L126-128 |
| DD-14 | `session-log.ts` unbounded growth — no size-threshold warning on the recovery-critical read path | Minor (Phase 6+) | L129-130 |

**Adjacent (tracked, ride the same PR or its own test-infra follow-up):**

| id | one-line | severity | source (L#) |
|---|---|---|---|
| DD-T1 | `cred-bootstrap.test.ts` + `approval-bus.test.ts` `chmod 0o000` no-ops for owner on Windows/NTFS → error paths uncovered on Windows; portable fault-injection rewrite | Minor (test-infra) | L134-137 |
| DD-T2 | `session-log.test.ts` "100 sequential appends" can time out under full-suite parallel real-FS I/O on Windows; raise testTimeout/de-parallelize | Minor (test-infra) | L138-140 |
| DD-R1 | **registration-orphan window** (PR #87 deferred Critical) — the resilient-vs-durable design surface D1/D2 extend | **Critical (open, tracked)** | L144-145 |
| DD-R2 | #92 quarantine boot-surfacing gap — a quarantined agent is silently disabled across restarts; boot does not scan the quarantine dir | Important | L146-147 |

## Workstream C — Daemon cutover-gate checklist (pr84 Phase-2) — 7

These gate the **VPS daemon DEPLOY off OpenClaw**, NOT a code PR. Run when
cutting over. Sources: `2026-05-30-pr84-gate-findings-and-cutover-gates.md` (CG)
and `2026-05-28-pr84-gap-closure.md` Phase-2 deferrals (CG-06/07).

| id | one-line | severity | source (L#) |
|---|---|---|---|
| CG-01 | **R1 — secret-in-LLM-shell prompt-injection exfil** — pr-triage agent's PTY shell holds `GH_TOKEN`+`IAGO_TELEGRAM_BOT_TOKEN` while the prompt ingests third-party-writable PR comments; "Never echo" is not a trust boundary. Architectural fix: daemon-owned GH/Telegram calls (sanitized results into prompt) OR short-lived narrowly-scoped creds | Important (deploy gate) | gate-findings L12-16 |
| CG-02 | **G3 — at-rest encryption** for persisted daemon secrets — the hard cutover gate paired with R1 | Deploy gate | gate-findings L16, L32 |
| CG-03 | `umask 0077` set mid-script + unrestored, and (agent-first-run) AFTER `mkdir -p pending/` — move before mkdir / scope in subshell | Minor | gate-findings L24 |
| CG-04 | Secret redaction interpolates the token UNESCAPED into the `sed` BRE pattern — safe for current charsets, latent if a future credential type carries BRE metachars; escape or use fixed-string match | Minor | gate-findings L25 |
| CG-05 | `PR1 lastStatusChangeMs` heartbeat test flaky under concurrent Windows suite (passes isolated 72ms; times out under CPU starvation); re-run on Linux CI or `--no-file-parallelism` | Minor (test-infra) | gate-findings L26 |
| CG-06 | fsync-backed durable telemetry for gated alerts — `emit()` returns true after `appendFile` (OS buffer, not stable storage); host power-loss in the flush window could lose one `pr-triage-telegram-send-failed` record. Phase-2 open+append+datasync+dir-fsync | Important (deploy gate) | gap-closure L138 |
| CG-07 | Recompose daemon secrets from `process.env` on boot recovery (don't persist raw) + enforce one-live-handle-per-cron-agentId — credstore recompose-on-spawn via systemd `LoadCredential=` | Important (deploy gate) | gap-closure L139 |

## Standalone — 1

| id | one-line | severity | source (L#) | trigger |
|---|---|---|---|---|
| SA-01 | Build-gate split — Sonnet routing/run agent + Opus fix-only agent dispatched only on failure (cleaner structural design needing a new intermediate schema + conditional dispatch) | Minor (design) | pipeline-efficiency-teardown L113-117 | after `feature-pipeline-efficiency/01` lands, if build-gate latency still warrants a structural split — warrants its own plan |

---

## Recently CLOSED — verified in #92's merged code (do NOT re-defer)

- **PC-02 / R2 · cron-restart-pins-dead-handle** — the audit's only historical
  "Critical crack." FIXED at `runtime/daemon/main.ts:2400-2419` (tears the dead
  handle down; `restartAgent` re-spawns) + regression tests
  `agent-manager.test.ts:2920` and the `deadHandle===null` fallback
  `main.test.ts:3717`. (Was pr84 gate-findings R2, L18-21.)
- **Task-8 re-arm test (CR-3)** — `main.test.ts:3782`.
- **listener-leak `off('agent-restarted')` (CR-4)** — closed in #92 round-2.
- **`pr-triage.test.ts` state-dir-leak deflake** — `df52828` (#92 round-2).

## After #90 / #94 merge — what the deferred surface collapses to

#94 is a clean 2-line-ADR merge; #90 is this index's home PR (single-SKILL.md
keep-both reconcile + re-gate). Once both merge, the surface is exactly:

1. **Gate-hardening PR** (Workstream A, 16) — unblocked; the 7 Importants the
   #89 re-gate re-confirmed + GH-16 from #90's re-gate sit at the top.
2. **Durability-hardening PR** (Workstream B, 14 core + 4 adjacent) — unblocked.
3. **Cutover-gate checklist** (Workstream C, 7) — run only when deploying the
   daemon off OpenClaw, NOT before.
4. **SA-01** — its own pipeline-efficiency follow-on plan.

This index is the map; the 4 trackers are the territory.

## #90 reconcile re-gate (wf_6b7d7153-1d6, 2026-06-13) — verdict

Team mode + 4 explicit lenses (security/codeQuality/tests/completeness), **real
cross-model** (`codexSource: codex`, `crossModelDegraded: false`),
`verificationSameFamily: true`, `verificationDegraded: false`, `filtered: []`,
**0 Critical**, verdict `PASS_WITH_CONCERNS`, 4 blocking (Important). **Zero
findings on the SKILL.md reconcile itself.** All 4 blocking are pre-existing #90
code / already-tracked: 2× deriveLenses case-sensitivity (→ GH-16), 1× probe
incomplete-but-valid (= GH-15), 1× tests-not-in-CI (= GH-05). No fixes applied
per "don't iterate review-infra to clean"; #90 is merge-ready.
