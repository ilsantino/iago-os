---
phase: feature-pipeline-efficiency
plan: 01
wave: 1
depends_on: []
context: .iago/research/2026-06-02-pipeline-efficiency-teardown.md
created: 2026-06-02
source: feature
---

# Plan 01 — Pipeline efficiency hardening

## Goal

Cut latency + token cost of the harness-native execution pipeline
(`.claude/workflows/execute-pipeline.js`) by routing its deterministic/mechanical
subagents off Opus, batching two adjacent agent pairs into one, and removing two
genuinely redundant recomputations — **without weakening the dual-adversarial
Opus ∥ Codex review**, which is the pipeline's entire value.

Every change below was derived by a 44-agent adversarial teardown with per-finding
verification and a holistic gate audit (verdict: **`NO_WEAKENING`**). Audit record:
`context:` above. The two highest-risk candidates (scoping the fix-round re-review
diff / dropping the full Codex re-invocation; selective module loading) were
**rejected** and are listed in **Do NOT touch** below — they are load-bearing, not
waste.

**Constraint (why "delete the agent" is never the fix):** the Workflow JS has no
filesystem/shell access. Every `git`/`mkdir`/`rm`/build runs inside a subagent. So
each fix is a per-agent `model:` override or a batch-merge of adjacent agents —
never removal of the shell work.

## Files

- `.claude/workflows/execute-pipeline.js` (modified — all of Tasks 1, 3, 4, 5, 6
  and the Workflow side of Task 2)
- `.claude/skills/iago-execute/SKILL.md` (modified — Task 2: grep `^## Stress Test`,
  pass `skipStress`)
- `.claude/skills/iago-quick/SKILL.md` (modified — Task 2: pass `skipStress` per the
  same rule; quick plans are written without a stress section, so it resolves to
  `false` and stress still runs)
- `.claude/skills/subagent-driven-development/SKILL.md` (modified — Task 2: same
  `skipStress` rule)

No new files. No new dependencies.

> **Test-infra reality (read before reviewing).** `execute-pipeline.js` has no unit
> harness — `scripts/validate-workflows.mjs` is a **compile-only** check (it does
> NOT run the workflow or inject the `agent()` runtime; see its own header comment).
> There is no `execute-pipeline.test.mjs`. So the regression path for every task is
> **(a) `node scripts/validate-workflows.mjs` exits 0** + **(b) a dry-run of a tiny
> 1-task plan** exercising the changed stages. This is a genuine infra gap, not a
> dodge — do not fabricate a unit test that would require executing the harness.

## Tasks

### Task 1: Route mechanical stages off Opus (5 `model:` overrides)

**What.** Add one `model:` key to each of five agent calls whose work is
deterministic/mechanical (layer-triage: shell passthrough with a binary branch).
All five inherit Opus today; only `create-pr`/`tag-claude` are currently routed.

| Stage | Agent call | Tier | Why this tier (not lower) |
|---|---|---|---|
| `prep` | L526 `agent(PREP_PROMPT, {... })` | **haiku** | 3 git reads (`status --porcelain`, `rev-parse HEAD`, `branch --show-current`) + empty-string check. Pure passthrough. |
| `rollback` (in `withRetryMutating`) | L192 `agent(..., {label:`${label}-rollback`, ...})` | **haiku** | Runs the caller's pre-built `restoreCmd` verbatim + verifies `git status --porcelain` empty. Fires only on an impl retry (rare). |
| `lock-acquire` | L496-500 opts object | **sonnet** | mkdir-lock is trivial, but the 3h-stale **reclaim runs a destructive `rm -rf`** on a date comparison — asymmetric cost if mis-timed (two runs collide). Sonnet floor for the destructive branch. |
| `commit` | L575 `agent(commitPrompt(), {... })` | **sonnet** | Must apply the `SECRET_EXCLUDES` pathspec (L216-217) reliably + pick a conventional-commit type. Matches the create-pr/tag sonnet precedent. |
| `buildVerify` (post-fix re-gate) | L612 opts (`rebuild:${rounds}`) | **sonnet** | Read-only re-gate: run checks, read exit codes, path-route by extension. Must still correctly *diagnose* a failing build. |

**Change.** For each row, add the `model:` key to the existing opts object — no
prompt, schema, or control-flow change.

**Gate flag (buildVerify only — low).** `buildVerify` (L341-348) is upstream of the
re-review but is **read-only** (`Do NOT edit any files and do NOT commit`). Worst
case for Sonnet is a misread pass/fail. Failure mode is **conservative**: a
false-FAIL stops the pipeline (`throw` at L615); a false-PASS hands off to the
re-review where Opus + Codex re-evaluate the committed code. The fix agent already
confirmed green before committing, so this is a belt-and-suspenders confirmation.
**Do NOT** touch the primary `BUILD_PROMPT` agents at L561-564 — those edit source
to fix breaks (code-writing) and stay on inherited Opus. The other four stages have
**no** path into any review/codex/build-correctness leg → gate impact none.

**Regression.** `node scripts/validate-workflows.mjs` exits 0. Dry-run a 1-task
plan: confirm `prep` returns a valid 40-char `preImplSha` + branch; `lock-acquire`
returns `ACQUIRED`; `commit` returns `DONE` with non-empty branch/headSha and no
`.env` in the staged diff. Dirty-tree case: stage a file pre-run → pipeline throws
at prep `BLOCKED`. Stale-lock case: write a `>3h` timestamp to
`.iago/state/.pipeline.lock.d/acquired` → sonnet `lock-acquire` reclaims and returns
`ACQUIRED`. buildVerify is exercised only on a fix round (Task 6 dry-run covers it).

### Task 2: Skip the Opus stress *spawn* for pre-stressed plans

**What.** A plan that already carries a `## Stress Test` section (from `/iago-plan`
or `/iago-stress`) still pays a full Opus `stress` agent spawn just to hit the
in-agent early-return (`STRESS_PROMPT` L288). Most `/iago-execute` plans are
pre-stressed → this Opus spawn is pure waste on the common path. Move the decision
up to the skill (which already globs the plan files) so the spawn is skipped
entirely.

**Change (two sides).**
- **Workflow** (`execute-pipeline.js`): accept `A.skipStress` from args (document it
  in the `Inputs` comment block L20-27). Guard the stress spawn at L510-514:
  ```js
  let stress
  if (A.skipStress === true) {
    log('stress skipped — plan already stress-tested (## Stress Test present)')
    stress = { verdict: 'PROCEED', notes: [] }
  } else {
    stress = await withRetry(() => agent(STRESS_PROMPT, { label: 'stress', phase: 'Stress', schema: STRESS_SCHEMA }), 'stress')
  }
  ```
  Strict `=== true` so any missing/false/ambiguous value falls through to the full
  Opus stress agent (fail-safe toward more review, never less). `stress.notes` /
  `stressBlock` plumbing downstream is unchanged.
- **Skills** (`iago-execute`, `iago-quick`, `subagent-driven-development`): before
  the `Workflow({...})` call, grep each plan for a line-anchored `^## Stress Test`
  and add `skipStress: true` to `args` when present (omit otherwise). `iago-quick`
  writes its inline plan **without** a stress section → resolves to `false` → stress
  runs (correct).

**Gate flag — none.** This removes only a *spawn that early-returns PROCEED*; it
never skips a needed stress review. Fail-safe direction (a skill that forgets the
flag → stress still runs, identical to today). `BLOCK`/`PROCEED_WITH_NOTES`
plans are unaffected: they would not carry a `## Stress Test` PROCEED section. The
in-agent skip (L288) remains as a second-layer fallback.

**Regression.** `validate-workflows.mjs` exits 0. Dry-run a plan **with**
`## Stress Test`: journal shows no `stress` agent; `log` shows "stress skipped".
Dry-run a plan **without** it: full Opus `stress` agent fires. Confirm `lock-acquire`
still precedes the stress decision. (This very plan carries a `## Stress Test`
section, so it exercises the skip on its own execution.)

### Task 3: Merge `summary` + `lock-release` into one haiku agent

**What.** Two trailing deterministic agents run back-to-back: `summary` (L681-685,
templated `.md` + NDJSON + commit) then `lock-release` (L690-693, one `rm -rf`).
Collapse into one spawn.

**Change.** Extend `summaryPrompt` (L413-422) with a final step: "Release the
pipeline lock: run `rm -rf ${LOCK_DIR}` in `${projectDir}`. Return `status=DONE`
only when **all** steps succeed." Replace the two agent calls (L681-693) with one
`agent(...)` carrying `model: 'haiku'`. Keep the existing null/`status!=='DONE'`
throw (L686) — it now covers the merged result. Keep `log('released pipeline
lock')` after it returns. Preserve the existing note that `.iago/state/*` is
gitignored and must **not** be staged.

**Gate flag — none.** Post-gate telemetry + bookkeeping only. Failure semantics
unchanged: today if `summary` throws, `lock-release` never runs anyway (the throw
propagates), so merging changes nothing — and a failed `rm -rf` now surfaces as
`BLOCKED` instead of being silently best-effort (a small improvement).

**Regression.** `validate-workflows.mjs` exits 0. End-to-end dry-run:
`.iago/summaries/{planName}.md` written + committed; `.iago/state/pipeline-runs.ndjson`
appended but **not** committed; lock dir absent after the run; a second run can
re-acquire the lock immediately.

### Task 4: Merge `create-pr` + `tag-claude` into one sonnet agent (!noTag path)

**What.** On the default (`!noTag`) path, two sequential sonnet agents act on the
same PR: `create-pr` (L646-651) then `tag-claude` (L664-669). Collapse into one.

**Change.** Keep the existing `if (noPr)` / `if (!noTag)` JS branching. On
`noTag === true`: spawn only the PR agent (unchanged). On the `!noTag` path: spawn
**one** sonnet agent whose prompt (a) pushes the branch, (b) idempotently
creates-or-reuses the PR, (c) extracts `prUrl`+`prNumber`, (d) if `prNumber` is
empty returns `tagStatus: 'SKIPPED_NO_PR_NUMBER'` and does **not** post a comment,
(e) otherwise idempotently posts the `@claude` review comment exactly once.
Combined schema `{ prUrl, prNumber, branch, tagStatus }`. Keep the workflow-level
PR-number assertion (port L655-661 to the merged result). No `withRetry` (preserve
the no-duplicate-PR / no-double-tag posture).

**Gate flag — none.** PR/CI plumbing only. **Must preserve** the two idempotency
guards (reuse existing PR; skip an already-posted `@claude` tag — a duplicate tag
races parallel review-fix loops; MEMORY: single-@claude-tag) and the PR-number
assertion (a missing number must still abort so the async loop can't silently fail
to start).

**Regression.** `validate-workflows.mjs` exits 0. Dry-run `noTag=false`: exactly
one PR + exactly one `@claude` comment; journal shows one merged agent (e.g. label
`create-pr-tag`), not two. Dry-run `noTag=true`: PR, no comment. Assertion still
throws when `prUrl`+`prNumber` are absent.

### Task 5: Thread `domainsSelected` hint to re-review + drop its redundant PASS-2 output

**What.** `REVIEW_SCHEMA` already returns `domainsSelected` (L129) but
`runDualAdversarial` drops it (L466-470). So every **re-review** re-runs PASS 2
(domain-routing *output*) from scratch even though round 0 already decided the
domains. Capture round-0 selection and pass it as a hint; stop regenerating PASS-2
output on re-review. **Module loading is unchanged — all 11 modules still loaded.**

**Change.**
- `runDualAdversarial` (L425-471): change the return (L470) to include
  `domainsSelected: review.domainsSelected || []`.
- Fix loop (L617-622): capture `domainsSelected` from the re-review return.
- `reviewPrompt` (L233-264): add a `domainsSelected` param; when `isReReview`, add
  to the head: "Domains identified in round 0: [list]. Use as a starting hint for
  PASS 3 focus." and **remove the PASS-2 (domain-routing output) step from the
  re-review head only** — the selection is already known. Leave the round-0 head's
  PASS 2 intact.
- **CRITICAL — do not change L261** ("Read EVERY review-checks module"): all 11
  modules stay loaded on every pass. The unconditional cross-cutting block
  (L250-255) and severity floors stay unconditional.

**Gate flag — low.** The only behavior change is the re-reviewer not re-deriving
domain selection — a redundant *output*, since round-0 selection is supplied and
all modules are loaded regardless. A fix that introduces a brand-new domain is
still fully covered: every module is in context and the reviewer may apply any of
them irrespective of the hint. **No coverage can be lost** because nothing is
filtered. (Savings are modest — a few hundred tokens of skipped PASS-2 output per
re-review — but it removes a real recomputation with zero risk.)

**Regression.** `validate-workflows.mjs` exits 0. Dry-run: round-0 review output
includes `domainsSelected` (check journal). On a fix round: the re-review head
contains the domain hint and omits PASS-2 output steps; findings still populate.
Sanity case — a plan touching 2 domains where the fix touches a 3rd: confirm the
re-review still has the 3rd domain's module loaded (all modules load — coverage not
reduced).

### Task 6: Skip the redundant `vite build` in the fix agent's self-check

**What.** Per fix round the build runs **twice**: the fix agent builds internally
before committing (`fixPrompt` L377) **and** `buildVerify` re-builds after
(L611-614). `vite build` is the slow part (30 s–2 min). Keep the fast self-checks
in the fix agent; let `buildVerify` be the single authoritative full gate.

**Change.** In `fixPrompt` (L364-380), replace the L377 build instruction ("run the
build gate (`npx tsc --noEmit` / `npx vite build` …)") with a **fast self-check**:
`npx tsc --noEmit` for TS paths; `bash -n` + `shellcheck -x` for changed `.sh`;
`node "${iagoRoot}/scripts/validate-workflows.mjs"` for changed workflow JS;
**skip `npx vite build`** — buildVerify runs the full gate post-commit. Do **not**
change `buildVerifyPrompt` (L341-348): it keeps the full `tsc`+`vite`+console gate
and remains authoritative.

**Gate flag — low.** A vite-only bundler error introduced *while fixing a finding*
will no longer be self-healed by the fix agent — but it is still **caught by
buildVerify before PR** (pipeline halts at L615). This is reduced fix-agent
autonomy, not a gate hole; the broken build never reaches the PR. Vite-only errors
from fix-session edits are rare in this stack (`tsc` catches most at compile time).

**Regression.** `validate-workflows.mjs` exits 0 after editing the `fixPrompt`
string. Dry-run a plan that triggers a fix round and touches a `.ts` + a `.sh`:
fix agent runs `tsc` + `shellcheck` but **not** `vite build`; buildVerify still runs
the full gate incl. `vite`. Confirm the pipeline halts (L615) when buildVerify
returns `passed=false` (logic unchanged).

## Do NOT touch (gate boundary — rejected by the audit)

A future efficiency pass must not "optimize" these without re-running the gate
audit. Each was a candidate saving and was **rejected** because any form weakens
the dual-adversarial gate or breaks failure semantics (full rationale in the audit
doc):

1. **Codex-leg model** (L437-446) — stays Opus; its prompt has a full fallback
   adversarial review whose quality floors on this agent's model.
2. **Stress agent when it runs** (L511-514) — stays Opus (adversarial judgment).
   Task 2 only skips the *spawn* for already-stressed plans.
3. **Primary build gate `BUILD_PROMPT`** (L561-564) — stays Opus (edits source).
4. **Fix-round re-review diff = full `preImplSha..HEAD`, full Codex re-invocation**
   (L617-622) — the costliest repeat, but **load-bearing**: required for cross-file
   regression detection + codex file enumeration + the fallback's context.
5. **Read-all-modules** (L261) — fail-safe; selective loading would silently drop
   ALWAYS-Critical severity floors that live inside module text.
6. **stressBlock on every review pass** (L518-521, L620) — removing it on
   re-reviews creates an escape path for an r0 miss on a stress-critical note.
7. **Build-gate retry layers** (L559-568) — inner `withRetry` (API transient) and
   outer for-loop (genuine build failure, fresh agent) are orthogonal, not
   redundant.

## Stress Test

**Verdict: PROCEED_WITH_NOTES** — this plan was produced by a 44-agent adversarial
teardown: 4 parallel lenses → independent skeptical verification of all 39 candidate
findings (line-refs re-checked against the file; 8 rejected) → a holistic gate audit
returning **`NO_WEAKENING`**. The notes below are enforced requirements for the impl
session (treat like any forwarded stress note: implement or justify in a comment).

### Notes for the implementation session (must honor)

1. **Gate boundary is non-negotiable.** Apply Tasks 1–6 exactly; do **not** touch
   any item in **Do NOT touch**. The buildVerify (Task 1), re-review-hint (Task 5),
   and fix-build-skip (Task 6) changes carry gate flags — keep them in their
   audited *conservative* form (read-only re-gate; all modules still loaded;
   buildVerify still runs full vite).
2. **`=== true` on `skipStress`** (Task 2) — fail-safe toward running stress. Never
   default-skip.
3. **Idempotency must survive the merge** (Task 4) — reuse existing PR + skip an
   already-posted `@claude` tag + keep the PR-number assertion. A regression here
   races the async review loop.
4. **Edit `execute-pipeline.js` directly** (the file is the deliverable target).
   After every edit, `node scripts/validate-workflows.mjs` must stay green — it is
   the build gate's own check for changed workflow JS.
5. **No fabricated unit tests.** There is no harness that executes the Workflow
   (validate-workflows is compile-only). Verify via compile-check + 1-task dry-run
   per each task's regression note. State this honestly in the fix/review report
   (it is a real infra gap, not a skipped test).

### Cross-cutting checks

- **Auth / data-loss / race / rollback:** the only race-relevant change is the
  lock (Task 1 `lock-acquire`→sonnet; Task 3 merges the release). The atomic
  `mkdir` lock + the stale-reclaim logic are **unchanged** — only the model tier
  moves. Concurrent-run protection is preserved (Task 1 regression covers it).
- **Secret handling:** `commit`→sonnet (Task 1) must still apply `SECRET_EXCLUDES`
  (L216-217) — verified in the Task 1 regression (no `.env` in staged diff).
- **Backwards compatibility:** default behavior is identical when a skill omits
  `skipStress`; `noPr`/`noTag` paths are unchanged.

## Verification

Whole-plan acceptance (run after all tasks):

1. `node scripts/validate-workflows.mjs` exits 0 (all workflow JS compiles).
2. Dry-run a tiny 1-task plan through `/iago-execute` (or `/iago-quick`) on a
   throwaway branch and confirm from the workflow journal:
   - `prep`, `rollback`(if hit), `lock-acquire`, `commit`, `buildVerify`(if a fix
     round runs) carry the new model tiers; `stress`/`review`/`codex`/`fix`/
     `BUILD_PROMPT` remain Opus.
   - On a pre-stressed plan: no `stress` agent spawns; "stress skipped" logged.
   - `summary`+`lock-release` appear as **one** agent; lock dir gone after the run.
   - `create-pr`+`tag-claude` appear as **one** agent on `!noTag`; exactly one PR
     and one `@claude` comment.
   - A forced fix round: re-review head carries the domain hint and omits PASS-2
     output; fix agent runs `tsc`/`shellcheck` but not `vite build`; buildVerify
     runs the full gate.
3. The dual-adversarial gate still fires fully: round-0 `review` (Opus) ∥ `codex`
   (GPT-5.5) both run; a `FAIL` still drives the fix loop; persisting
   Critical/Important still throws after 2 rounds.
4. No regression to PR output, `.iago/summaries/` output, or lock behavior vs. the
   pre-change pipeline.

## Out of Scope

- **Build-gate split** (Sonnet routing/run agent + Opus fix-only agent dispatched
  only on failure) — deferred follow-on plan; needs a new intermediate schema +
  conditional dispatch + re-run path. Trigger: after this plan merges.
- **`feature-pipeline-speed-wedges`** (bash-script parallelism/timeout axis,
  `docs/specs/parallel-execution-wedges.md`) — different lever, different (deprecated)
  file. Its "Wedge D: Review ∥ Codex" is already free in this Workflow.
- **`dual-adversarial.js` / `dual-adversarial-fix.js`** — correctly all-Opus
  (pure judgment); no model-routing waste to harvest.
- Any change to the **Codex companion**, review-checks modules, or the async
  GitHub review-fix CI loop.
