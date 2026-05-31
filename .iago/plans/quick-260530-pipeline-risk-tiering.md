# Plan — Auto-tiered review depth + agent-team wiring for the pipeline

**Slug:** quick-260530-pipeline-risk-tiering
**Created:** 2026-05-30
**Base branch:** `feat/pipeline-risk-tiering` (off `chore/cc-config-optimization` HEAD — team-mode code lives there, NOT yet in `origin/main`; PR will be cumulative)
**Status:** ready (stress-tested pre-implementation — see `## Stress Test`)

## What this does (plain English)

Stops the pipeline giving a CSS tweak and a Cognito-auth change the *identical* 2-leg
review. A deterministic (zero-LLM) classifier reads each plan and assigns a risk TIER;
Tier 2/3 plans auto-activate the diverse-persona **team legs** + per-finding **skeptic
panel** that already exist in `dual-adversarial.js` but were unreachable from
`execute-pipeline.js`. Also fixes 5 correctness gaps the stress test surfaced (fix-loop
mode drop, cap bleed across stacked plans, double lock-release, unbounded skeptic
fan-out, a misleading always-on degraded flag).

## ⚠️ Self-modification constraint (READ FIRST)

This plan edits `execute-pipeline.js` and `dual-adversarial.js` — the pipeline's own
orchestration. It MUST NOT be run through `/iago-execute`:

- The running pipeline executes its own **stale in-memory closure** — the new code is
  never exercised by the self-modifying run (round-2 re-review, fix agent, PR all run
  OLD code).
- The workflow-JS build gate (`validate-workflows.mjs`) is **compile-only** — a semantic
  break passes the gate and bricks the *next* `/iago-execute` run.

**Ship path:** implement on this feature branch with real unit tests → run
`node --test` green + `validate-workflows.mjs` → review with an **independent**
adversarial gate (NOT the file being edited) → PR + `@claude` → **mandatory post-merge
canary `/iago-fast` on a trivial plan** as the first real exercise of the new code.

> Line numbers below are from the stress-test ground pass and are **approximate** —
> the implementer MUST read the current file and locate by symbol, not by line.

## Tier model

| Tier | Trigger (deterministic, plan-text + counts) | Review depth |
|------|---------------------------------------------|--------------|
| 0 Fast | ≤2 `### Task` headings AND ≤3 unique `**files:**` paths AND no risk keywords | (informational; today's `/iago-fast` territory) |
| 1 Normal | default | 2-leg Opus + Codex (today's behavior) |
| 2 Complex | >8 tasks OR any of: `amplify`, `functions/`, `schema`, `GSI`, `TTL`, `migration`, `rollback` | + team mode (team:data + team:arch + skeptic panel) |
| 3 Security | any of: `auth`, `cognito`, `payment`, `IAM`, `JWT`, `allow.owner`, `webhook` | Tier 2 + `maxFixRounds=3` |

Keywords are matched **case-insensitive substring across the full plan text** (plans use
prose, not structured path fields). Any parse failure errs to **Tier 1** (never Tier 0).

## Tasks

### T01 — Deterministic tier classifier
**File:** `.claude/workflows/execute-pipeline.js`
**Depends on:** —
**Change:** Add a pure-JS `classifyTier(planText)` (~25 lines, **zero LLM calls** — this
is the rule-based layer per 60/30/10): (1) count `### Task` headings → taskCount;
(2) count unique paths in `- **files:**` bullets → fileCount; (3) case-insensitive
substring match the full text for tier-3 keywords `[auth, cognito, payment, iam, jwt,
allow.owner, webhook]` and tier-2 keywords `[amplify, functions/, schema, gsi, ttl,
migration, rollback]`; (4) return `3` if any tier-3 kw, else `2` if any tier-2 kw or
taskCount>8, else `0` if (taskCount≤2 AND fileCount≤3 AND no kw), else `1`. Any parse
failure (zero headings found) → `1`. Call it right after the Stress stage returns
PROCEED/PROCEED_WITH_NOTES; store `const tier`. Initialize, as per-plan locals **before
the fix while-loop**: `const maxFixRounds = tier >= 3 ? 3 : 2`,
`let reviewMode = tier >= 2 ? 'team' : 'standard'`, `let reviewLenses = []`.
**Regression test:** `classifyTier.test.mjs` colocated, `node --test`. Cases: empty→1;
1 task+2 files+no kw→0; 'auth' in prose→3; 9 `### Task`→2; 'rollback' + 2 tasks→2;
parse-fail (no headings)→1; 2 tasks + 4 files (no kw)→1 (file ceiling blocks Tier 0).

### T02 — Refactor `runDualAdversarial` to options-object + thread tier through fix loop
**File:** `.claude/workflows/execute-pipeline.js`
**Depends on:** T01
**Change:** Change signature `(label, isReReview, stressBlock, preImplSha)` →
`(label, isReReview, stressBlock, preImplSha, opts = {})`. Inside:
`const { mode = 'standard', lenses = [], skepticCap = 8 } = opts`. Pass `mode`, `lenses`,
`skepticCap` into the args object handed to the dual-adversarial review call. **Update
BOTH call sites in the same commit** — the initial review AND the fix-loop re-review (the
one inside the `while`, ~line 617) — each passing
`{ mode: reviewMode, lenses: reviewLenses, skepticCap: 8 }`. Runtime assertion at top of
function: `if (tier >= 2 && opts.mode !== 'team') throw new Error('tier ' + tier + '
requires mode=team')` (convert silent fallback → hard stop). Extend the return shape to
`{ findings, verdict, codexSource, verificationSameFamily, verificationDegraded }` by
reading those from the dual-adversarial output. JSDoc: document `opts.mode` defaults to
`'standard'`.
**Regression test:** spy/integration assert: tier=2 → re-review call receives
`opts.mode==='team'`; tier=1 → `'standard'`; assertion throws when tier≥2 and mode≠team.

### T03 — Per-plan `maxFixRounds` local (remove module const)
**File:** `.claude/workflows/execute-pipeline.js`
**Depends on:** T01
**Change:** Remove `const MAX_FIX_ROUNDS = 2`. Replace all references with the per-plan
`maxFixRounds` from T01 (while-condition + the post-loop error message). Because it lives
inside the per-plan execution block, stacked multi-plan runs re-initialize it per plan —
no cross-plan bleed.
**Regression test:** tier 3 → maxFixRounds===3; tiers 0/1/2 → 2; error message references
the correct cap.

### T04 — `try/finally` lock release with owner-check (remove double-release)
**File:** `.claude/workflows/execute-pipeline.js`
**Depends on:** —
**Change:** (1) **Remove** the existing success-path agent lock-release (~line 690-693).
(2) Add `let lockAcquired = false`; set `true` only after `lock.status === 'ACQUIRED'`.
(3) Wrap all stages from Lock-Acquire through Summary in `try { … } finally { … }`. The
`finally`: if `lockAcquired`, read `.iago/state/.pipeline.lock.d/owner` synchronously
(`fs.readFileSync`, catch errors), and **only if owner content matches this plan/run id**
call `execSync('rm -rf .iago/state/.pipeline.lock.d', { cwd: projectDir, stdio: 'ignore' })`
(NOT an `agent()` call — agents must never appear in `finally`). Wrap the `finally` body
in its own `try/catch` that logs+swallows so it can never mask the original error. Import
`execSync` from `node:child_process`. Log `lock released` / `lock skipped (not owner)` /
`lock release failed: <msg>`.
**Regression test:** throw mid-stage after acquire → finally fires, rm-rf called; finally
execSync throws → original error still re-thrown (not replaced); lockAcquired=false →
rm-rf NOT called; owner mismatch → release skipped.

### T05 — `SKEPTIC_CAP` on team-mode verification
**File:** `.claude/workflows/dual-adversarial.js`
**Depends on:** —
**Change:** In the team-mode verification block, `const skepticCap = A.skepticCap ?? 8`.
Slice `toVerify` to the top `skepticCap` Critical+Important findings (Critical first, then
summary.length desc); findings beyond the cap stay in output as **unverified**
Critical/Important. Log when truncated (`skeptic verification capped at N of M …`). Add a
named `const SKEPTIC_CAP_DEFAULT = 8` at top of file for documentation.
**Regression test:** 10 Criticals → only 8 skeptic pairs (16 agent calls); truncation log
present; findings 9–10 remain in output.

### T06 — Rename `verificationDegraded` → `verificationSameFamily`; surface in summary
**File:** `.claude/workflows/dual-adversarial.js` (+ wrapper read in `execute-pipeline.js`)
**Depends on:** T02
**Change:** Rename the always-true team-mode flag to `verificationSameFamily` (structural
fact: both skeptics are Opus). Reserve a NEW `let verificationDegraded = false`, set
`true` only if any skeptic returns `null` (failed to run). Return both. In
`execute-pipeline.js`'s wrapper read both (per T02 return-shape). In the summary prompt:
if `verificationSameFamily` → "NOTE: team-mode skeptics are same-family (Opus); cross-model
diversity not achieved for the skeptic pass."; if `verificationDegraded` → "WARNING: one
or more skeptic agents failed to run — verification incomplete." Do not block on either.
**Regression test:** team mode → `verificationSameFamily===true` always;
`verificationDegraded===true` only on a null skeptic; summary strings conditional-correct.

### T07 — Harden BUILD_PROMPT workflow-JS gate (string edit)
**File:** `.claude/workflows/execute-pipeline.js`
**Depends on:** —
**Change:** In the BUILD_PROMPT string, upgrade the `.claude/workflows/*.js` check from
guidance to **MANDATORY**: if any workflow-JS file is in the changed set, the agent MUST
run `node "${iagoRoot}/scripts/validate-workflows.mjs"`, include its verbatim stdout, and
state in the summary: "Canary /iago-fast run required post-merge before any subsequent
/iago-execute." A workflow-JS change omitting this → report `passed=false`. String edit
only.
**Regression test:** assert BUILD_PROMPT contains `MANDATORY` and the canary-notice text
(simple `node -e` grep check).

### T08 — `agentType: 'executor'` on the fix agent (verify wrapper first)
**File:** `.claude/workflows/execute-pipeline.js`
**Depends on:** T04
**Change:** First confirm `agent()` in `execute-pipeline.js` forwards `agentType` the same
way `dual-adversarial-fix.js` does (grep both). If identical: add `agentType: 'executor'`
to the Stage-5 fix agent options + a comment noting it takes effect on the run AFTER this
PR merges (in-memory-closure caveat), not within the self-modifying run. If the wrappers
differ: do NOT add it blindly — document the discrepancy in a comment and leave T08 as a
no-op (note in summary).
**Regression test:** structural — grep both files confirm same `agentType` field usage
(no behavioral test possible; harness-internal).

## Cut from this pass (follow-up plan)

- **P1-3 path-lens auto-injection** — timing-broken: no committed diff exists at classify
  time. Correct wire point is *between Commit (2b) and the first review call*, reading
  `git diff ${preImplSha}..HEAD --name-only`. The `reviewLenses` variable from T01 is the
  seam it will fill. Defer.
- **`--tier-override N` escape hatch** — for false-positive Tier-3 (e.g. "rollback" in a
  CSS task). Implement as plan frontmatter `tier_override: N`. Defer with P1-3.
- **`KNOWN_LENS_KEYS` startup drift-detection** (promote lens-key drift WARNING→throw) —
  ships with P1-3 when auto-injection lands.

## Stress Test

Adversarial review completed **pre-implementation** (4 skeptic dimensions + synthesis).
Verdict: **GO_WITH_ADJUSTMENTS** — concept sound, 7 Criticals in implementation precision,
all resolved in the tasks above. Implementation may skip a redundant Stage-0 stress.

- **[Critical] P1-3 lens injection wired before a committed diff exists** → P1-3 cut; T01
  ships only the plan-text classifier. Resolved.
- **[Critical] Plans are prose, not structured paths — keyword match would miss** → T01
  matches keywords across full plan text. Resolved.
- **[Critical] Fix-loop re-review drops team-mode on rounds 1-2** → T02 options-object,
  `reviewMode`/`reviewLenses` threaded into BOTH call sites. Resolved.
- **[Critical] `MAX_FIX_ROUNDS` module const bleeds across stacked plans** → T03 per-plan
  local. Resolved.
- **[Critical] Double lock-release race + `finally` agent-call can mask the real error** →
  T04 removes success-path release, single owner-checked `execSync` in `finally`,
  self-swallowing. Resolved.
- **[Critical] Self-modification: running pipeline uses stale closure; compile-only gate**
  → ship as standalone branch+PR (not `/iago-execute`); unit tests + post-merge canary;
  T07 hardens the gate. Resolved by ship-path.
- **[Critical] `validate-workflows.mjs` is compile-only** → T07 mandates it + canary
  notice; unit tests catch semantics. Resolved.
- **[Important] Silent `undefined` mode fallback** → T02 options-object default +
  tier≥2 assertion → hard stop. Resolved.
- **[Important] `verificationDegraded` always true → trains user to ignore** → T06 rename +
  reserve real degraded flag. Resolved.
- **[Important] Unbounded skeptic fan-out** → T05 `SKEPTIC_CAP=8`. Resolved.
- **[Important] `finally` could release a concurrent session's lock** → T04 owner-check.
  Resolved.
- **[Minor] Tier-0 ceiling ambiguity / undocumented default mode** → T01 requires both
  counts under ceiling; T02 JSDoc. Resolved.
