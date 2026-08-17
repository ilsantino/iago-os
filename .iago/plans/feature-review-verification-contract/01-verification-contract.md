---
phase: feature-review-verification-contract
plan: 01
wave: 1
depends_on: []
context: inline
created: 2026-08-17
source: feature
---

# Plan: feature-review-verification-contract/01-verification-contract

## Goal

Convert every adversarial review leg from open-ended generation ("find problems") to bounded verification ("do these properties hold?"), so a clean result carries auditable proof-of-work and is distinguishable from a lazy or failed leg. Root cause and evidence: `.iago/research/2026-08-16-iago-os-full-audit.md` addendum SA1–SA4.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `.claude/workflows/dual-adversarial.js` | Schemas, PREAMBLE, review/lens/team prompts, Minor routing |
| modify | `.claude/workflows/dual-adversarial.test.mjs` | Cover new schemas + the empty-leg-is-INCOMPLETE invariant |

## Tasks

### Task 1: Require a failure scenario on every finding
- **files:** `.claude/workflows/dual-adversarial.js`
- **action:** In the `FINDING` schema (line ~85), add `failureScenario: { type: 'string' }` to `properties` and add `'failureScenario'` to `required`. Add a one-line comment stating that a finding without concrete inputs/state → wrong output is not a finding.
- **verify:** `grep -n "failureScenario" .claude/workflows/dual-adversarial.js`
- **expected:** At least 2 hits — one in `required`, one in `properties`.

### Task 2: Add the PROPERTY schema and thread it through the leg schemas
- **files:** `.claude/workflows/dual-adversarial.js`
- **action:** Define `const PROPERTY = { type: 'object', required: ['property','verdict'], properties: { property: {type:'string'}, verdict: {type:'string', enum:['HOLDS','VIOLATED']}, evidence: {type:'string'} } }` after `FINDING`. Add a required `propertiesChecked: { type: 'array', items: PROPERTY }` to `REVIEW_SCHEMA`, `CODEX_SCHEMA` and `LENS_SCHEMA`.
- **verify:** `grep -c "propertiesChecked" .claude/workflows/dual-adversarial.js`
- **expected:** `4` or more (definition plus the three schemas).

### Task 3: Replace the emission-pressure stance in PREAMBLE
- **files:** `.claude/workflows/dual-adversarial.js`
- **action:** In `PREAMBLE` (line ~146) delete the clause "Give NO credit for good intent, partial fixes, or likely follow-up work. Happy-path-only behavior is a real weakness — report it." Replace the operating stance with: verify each assigned property against the code and report its verdict; a property that holds is a real result, reported as HOLDS with evidence; every VIOLATED verdict must carry a concrete failure scenario; a finding not introduced by this diff is out of scope and belongs in the backlog, not the gate.
- **verify:** `grep -c "Give NO credit" .claude/workflows/dual-adversarial.js`
- **expected:** `0`

### Task 4: Restructure the review prompt around three fixed axes
- **files:** `.claude/workflows/dual-adversarial.js`
- **action:** Rewrite `reviewPrompt` (line ~169) so PASS 2 enumerates exactly three axes — INTENT (each plan acceptance criterion verified PASS/FAIL, plus any change the plan did not ask for), SECURITY (threat list bounded by the changed paths), EFFICIENCY (unreachable, duplicated, or superseded code) — and require `propertiesChecked` to carry one entry per axis property evaluated. Keep PASS 1 domain routing and the existing `reReviewBlock`/`stressBlock` interpolation unchanged.
- **verify:** `grep -nE "INTENT|SECURITY|EFFICIENCY" .claude/workflows/dual-adversarial.js | head`
- **expected:** All three axis names appear inside the `reviewPrompt` template literal.

### Task 5: Remove the presupposition from the completeness lens
- **files:** `.claude/workflows/dual-adversarial.js`
- **action:** In `LENS_DEFS.completeness.focus` (line ~213) delete "Assume the other legs missed something." and rewrite the lens as a falsifiable coverage question: list which changed files were read in full by no leg, and which plan claim is asserted without code or test proof — returning an empty findings array when coverage is complete.
- **verify:** `grep -c "Assume the other legs missed something" .claude/workflows/dual-adversarial.js`
- **expected:** `0`

### Task 6: Make the lens and team prompt tails demand proof-of-work
- **files:** `.claude/workflows/dual-adversarial.js`
- **action:** In `lensPrompt` (line ~424) and `teamPrompt` (line ~455), replace the trailing "Return an empty findings array if this lens/leg surfaces nothing." with a requirement to return `propertiesChecked` listing every property evaluated and its verdict, stating that an empty `findings` array is a valid result only when `propertiesChecked` is non-empty.
- **verify:** `grep -c "propertiesChecked" .claude/workflows/dual-adversarial.js`
- **expected:** `6` or more (Task 2's four plus both prompt tails).

### Task 7: Route Minor findings to a backlog instead of the fix loop
- **files:** `.claude/workflows/dual-adversarial.js`
- **action:** In the return object (line ~727), add a `backlog` array holding all Minor-severity findings and exclude them from `findings` so they never enter a fix round. Leave `blocking` (Critical/Important) and the `clean` computation byte-for-byte unchanged.
- **verify:** `grep -n "backlog" .claude/workflows/dual-adversarial.js`
- **expected:** `backlog` appears in the returned object and in the Minor-partition line.

### Task 8: Cover the new contract in tests
- **files:** `.claude/workflows/dual-adversarial.test.mjs`
- **action:** Update existing fixtures for the new required fields (`failureScenario`, `propertiesChecked`), then add a test asserting that a leg returning both an empty `findings` array and an empty `propertiesChecked` array yields `gateStatus === 'INCOMPLETE'` rather than `clean`. Add a test asserting Minor findings land in `backlog` and never in `blocking`.
- **verify:** `node .claude/workflows/dual-adversarial.test.mjs`
- **expected:** All tests pass, exit code 0.

## Verification

`node .claude/workflows/dual-adversarial.test.mjs && node --check .claude/workflows/dual-adversarial.js`

All tests pass and the workflow parses. `grep -c "Give NO credit\|Assume the other legs missed something" .claude/workflows/dual-adversarial.js` returns `0`.
