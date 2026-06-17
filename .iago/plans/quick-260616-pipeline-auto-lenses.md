---
plan: quick-260616-pipeline-auto-lenses
status: done
created: 2026-06-16
pr: (follow-up to #96)
---

# Quick fix — wire the production pipeline onto the dual-adversarial AUTO lens path

## Context

Follow-up to PR #96 (gate-hardening, merged → `3bb7f68`). The post-merge dual-adversarial
Team gate on #96 surfaced one blocking Important (by Codex), verified pre-existing and
out of #96's scope:

> Production `/iago-execute` Tier 2/3 delegation passes `const reviewLenses = []`
> (`execute-pipeline.js:980`) → `lenses: reviewLenses` into `runDualAdversarial` →
> `dual-adversarial.js`. There an explicit Array (including `[]`) takes the EXPLICIT path
> (`lensSource='explicit'`), so the auto-derived load-bearing lenses (security/amplify/
> frontend) **never run**, and the `lensIncomplete`-on-failed-load-bearing-lens guard
> (gated on `lensSource === 'auto'`) is **unreachable** from the production pipeline.

`reviewLenses=[]` predates #96 (introduced by PR #89, `a5900b5`, already on main) — so it's a
coverage gap, not a #96 regression. #96 built the auto-lens hardening machinery in
`dual-adversarial.js`; this plan wires the production caller onto it so the hardening
actually reaches `/iago-execute` Tier 2/3 runs.

## The gap

- `dual-adversarial.js` correctly handles `lenses: 'auto'` / absent → AUTO path → derives
  load-bearing lenses from changed-file paths + arms the INCOMPLETE guard (47 tests already
  cover this side).
- `execute-pipeline.js` passes an explicit `[]` → EXPLICIT path → none of that fires.
- No `execute-pipeline` test asserted lens behavior, so the AUTO path was never exercised
  from this leg.

## Task — single, self-modifying-workflow (implemented directly, gated by dual-adversarial)

Edits, all in `.claude/workflows/execute-pipeline.js`:

1. `const reviewLenses = []` → `const reviewLenses = 'auto'` (line ~980). Tier 2/3 delegation
   now takes the AUTO path; inert for `standard`/Tier 1 (inline 2-leg never forwards lenses).
2. `runDualAdversarial` destructure default `lenses = []` → `lenses = 'auto'` (line ~632) so an
   omitting caller is safe-by-default (AUTO), never the EXPLICIT-empty trap.
3. JSDoc for `opts.lenses` updated: `'auto'` (default) auto-derives; an explicit array (incl.
   `[]`) is the operator opt-out (EXPLICIT seam preserved downstream).

`dual-adversarial.js` is **not** touched (its AUTO-path handling is already correct), which also
keeps the byte-identical `classifyTier` twin untouched.

## Regression tests — `.claude/workflows/execute-pipeline.test.mjs`

- New dedicated test: Tier 2/3 delegation forwards `wargs.lenses === 'auto'` (AUTO trigger),
  asserts `!Array.isArray(lenses)`. RED before the fix (`[]` is an array), GREEN after.
- Strengthened the two existing multi-delegation loop tests (Tier 2 initial+re-review; Tier 3
  ×4) to assert `c.wargs.lenses === 'auto'` on **every** delegation (covers the re-review path).

## Acceptance

- [x] `node execute-pipeline.test.mjs` → 29 passed (was 28). RED→GREEN proven (3 fail when
      `reviewLenses` reverted to `[]`).
- [x] `node classifyTier.test.mjs` → 22; `node dual-adversarial.test.mjs` → 47 (untouched).
- [x] `node scripts/validate-workflows.mjs` → OK (all 5 workflow bodies compile).
- [x] classifyTier byte-identical twin untouched (no drift-guard concern).

## Residual / not in scope

- No operator-facing opt-out flag is added (YAGNI) — the EXPLICIT-array seam in
  `dual-adversarial.js` remains available if one is ever needed.
- The #96 residual Minors (broadened-keyword over-tiering; haiku sha-snapshot transcription
  jitter — GH-15) are unrelated and untouched here.
