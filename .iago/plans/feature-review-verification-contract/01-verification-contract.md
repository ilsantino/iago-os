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

Convert every adversarial review leg from open-ended generation ("find problems") to bounded verification ("do these properties hold?"), so a clean result carries auditable proof-of-work and is distinguishable from a lazy or failed leg.

**Scope — EVERY leg means both files.** `.claude/workflows/dual-adversarial.js` (Tier 2/3 team gate) and `.claude/workflows/execute-pipeline.js` (the INLINE Tier-0/1 2-leg path most plans actually run) each carry their own `FINDING`/`REVIEW_SCHEMA`/`CODEX_SCHEMA` and their own review prompt. Landing the contract in only one leaves the most-used path on the old behavior — the `classifyTier` twin-drift failure from PR #96. Both are in the Files table.

**Evidence provenance — read this before citing the audit.** `.iago/research/2026-08-16-iago-os-full-audit.md` SA1–SA2 support the proof-of-work / empty-leg work directly: SA2 documents PR #78's Codex leg producing nothing while the gate reported fine ("a gate that silently produces nothing is worse than no gate, because it reports success"). SA3 and SA4 do NOT support Tasks 4 and 7: SA3 concludes the fix-round tail is a fix-COMPLETENESS problem, not a review-volume problem ("Round 1 fixed 2 findings and left 8 OPEN"), and SA4 states pass-structure changes have "no evidence behind it either way — instrument the passes before cutting". Task 4 (restructure PASS 2) and Task 7 (drop Minor from the fix loop) are deliberate DESIGN CHOICES kept on their own merits; do not present them as audit-derived.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `.claude/workflows/dual-adversarial.js` | Schemas, PREAMBLE, review/lens/team prompts, Minor routing |
| modify | `.claude/workflows/dual-adversarial.test.mjs` | Cover new schemas + the empty-leg-is-INCOMPLETE invariant |
| modify | `.claude/workflows/execute-pipeline.js` | TWIN schemas + prompts for the inline Tier-0/1 legs; same Minor→backlog policy (stress note 13/14) |
| modify | `.claude/skills/dual-adversarial/SKILL.md` | Document `backlog` in the return shape and REQUIRE the Report step surface it (stress note 5) |
| modify | `.claude/rules/execution-pipeline.md` | Land the Minor-backlog rule with the behavior, or code and standing rule contradict (stress note 4) |

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
- **expected:** at least `3` — one line per schema (REVIEW/CODEX/LENS). The `PROPERTY` const does not contain the string, and `grep -c` counts LINES, so the original "4 or more" was arithmetically unreachable. Do NOT pad code to hit a count.

### Task 3: Replace the emission-pressure stance in PREAMBLE
- **files:** `.claude/workflows/dual-adversarial.js`
- **action:** In `PREAMBLE` (line ~146) delete the clause "Give NO credit for good intent, partial fixes, or likely follow-up work. Happy-path-only behavior is a real weakness — report it." Replace the operating stance with: verify each assigned property against the code and report its verdict; a property that holds is a real result, reported as HOLDS with evidence; every VIOLATED verdict must carry a concrete failure scenario; a finding not introduced by this diff is out of scope and belongs in the backlog, not the gate.
- **verify:** `! grep -q "Give NO credit" .claude/workflows/dual-adversarial.js`
- **expected:** exit 0 (the clause is absent). `grep -c ... = 0` cannot be used inside an `&&` chain — grep exits 1 on no match, so a PASSING check would read as a failed verification.

### Task 4: Restructure the review prompt around three fixed axes
- **files:** `.claude/workflows/dual-adversarial.js`
- **action:** Rewrite `reviewPrompt` (line ~169) so PASS 2 enumerates exactly three axes — INTENT (each plan acceptance criterion verified PASS/FAIL, plus any change the plan did not ask for), SECURITY (threat list bounded by the changed paths), EFFICIENCY (unreachable, duplicated, or superseded code) — and require `propertiesChecked` to carry one entry per axis property evaluated. Keep PASS 1 domain routing and the existing `reReviewBlock`/`stressBlock` interpolation unchanged.
- **verify:** `grep -nE "INTENT|SECURITY|EFFICIENCY" .claude/workflows/dual-adversarial.js | head`
- **expected:** All three axis names appear inside the `reviewPrompt` template literal.

### Task 5: Remove the presupposition from the completeness lens
- **files:** `.claude/workflows/dual-adversarial.js`
- **action:** In `LENS_DEFS.completeness.focus` (line ~213) delete "Assume the other legs missed something." and rewrite the lens as a falsifiable coverage question: list which changed files were read in full by no leg, and which plan claim is asserted without code or test proof — returning an empty findings array when coverage is complete.
- **verify:** `! grep -q "Assume the other legs missed something" .claude/workflows/dual-adversarial.js`
- **expected:** exit 0 (the presupposition is absent). Same grep-exit-code reason as Task 3.

### Task 6: Make the lens and team prompt tails demand proof-of-work
- **files:** `.claude/workflows/dual-adversarial.js`
- **action:** In `lensPrompt` (line ~424) and `teamPrompt` (line ~455), replace the trailing sentence with a requirement to return `propertiesChecked` listing every property evaluated and its verdict, stating that an empty `findings` array is a valid result only when `propertiesChecked` is non-empty. The two literals DIFFER — `lensPrompt` ends "Return an empty findings array if this lens surfaces nothing." and `teamPrompt` ends "...if this leg surfaces nothing." — so an exact-match edit must target each separately (a merged "this lens/leg" form matches neither).
- **verify:** `! grep -q "Return an empty findings array if this le" .claude/workflows/dual-adversarial.js`
- **expected:** exit 0 — both silence-is-clean tails are gone. (A `grep -c "propertiesChecked"` line count is not a meaningful acceptance signal: it invites padding.)

### Task 7: Route Minor findings to a backlog instead of the fix loop
- **files:** `.claude/workflows/dual-adversarial.js`
- **action:** In the return object (line ~727), add a `backlog` array holding all Minor-severity findings and exclude them from `findings` so they never enter a fix round. Leave `blocking` (Critical/Important) and the `clean` computation byte-for-byte unchanged.
- **`backlog` must be SURFACED, or this silently deletes Minors.** `.claude/skills/dual-adversarial/SKILL.md` documents the exact return shape and its Report step groups `findings` by severity — a standalone gate run would otherwise report `clean` and the Minors would vanish from the human's view entirely. Add `backlog` to the documented shape and REQUIRE the Report step list it.
- **Land the doc line in the SAME PR.** `.claude/rules/execution-pipeline.md` currently states "FIX — ≤2 rounds, Critical→Important→Minor" and "Reviews never dismiss findings as acceptable/carry-over". Plan 02 Task 6 updates that doc, but plan 01 lands the behavior — if plan 01 merges alone, code and standing rule contradict. Update both lines here: Minor routes to `backlog`, and out-of-scope findings are still REPORTED with severity (routed, never suppressed at emission).
- **Apply the same policy to the inline path** (`execute-pipeline.js`) so the two tiers do not run two different Minor policies, and change `minorRemaining` to count the backlog — after the partition it would otherwise always log 0 while the backlog holds entries.
- **verify:** `grep -n "backlog" .claude/workflows/dual-adversarial.js`
- **expected:** `backlog` appears in the returned object and in the Minor-partition line.

### Task 7b: Fail loudly on a core leg that produced nothing (moved forward from Plan 02 Task 1)
- **files:** `.claude/workflows/dual-adversarial.js`
- **why here:** Task 8 asserts `gateStatus === 'INCOMPLETE'` for an empty, unproven leg — behavior no other task in this plan implements. Left in Plan 02, plan 01's own Verification would FAIL. Plan 02 Task 1 becomes a no-op confirmation.
- **action:** Treat a CORE leg (review or codex) returning both an empty `findings` array and no proof-of-work as a failed leg — push `opus-review:no-proof` / `codex:no-proof` onto `incompleteLegs` so `gateStatus` becomes `INCOMPLETE` and `clean` cannot be true. Comment citing PR #78 ("context-read only, no structured findings written" — gate still reported fine). Proof-of-work differs by author: a `source: 'codex'` leg only MAPS codex-companion free text, so a non-empty `evidence` string counts in place of `propertiesChecked`; a CLAUDE-authored leg (the review leg, or `source: 'claude-fallback'`) must enumerate `propertiesChecked`. Lens/team legs are OUT of scope for this rule — a lens is already non-blocking by design.
- **verify:** `node .claude/workflows/dual-adversarial.test.mjs`
- **expected:** All tests pass, including the empty-leg case.

### Task 8: Cover the new contract in tests
- **files:** `.claude/workflows/dual-adversarial.test.mjs`
- **action:** Update existing fixtures for the new required fields (`failureScenario`, `propertiesChecked`, codex `evidence`), then add a test asserting that a leg returning both an empty `findings` array and an empty `propertiesChecked` array yields `gateStatus === 'INCOMPLETE'` rather than `clean`. Add a test asserting Minor findings land in `backlog` and never in `blocking`.
- **also RE-POINT four existing assertions that Task 7 breaks** (they read Minor findings out of `out.findings`): `standard mode lens indexing intact` (`by === 'lens:security'`), `team mode appends team:data and team:arch legs` (`by === 'team:data'`/`'team:arch'`), `Minor findings are kept un-verified` (`f.severity === 'Minor'`), and the leg-slice attribution test (`SEC-LENS-MARK` / `TEAM-DATA-MARK`). Each must read `out.backlog` while PRESERVING its `by:` attribution check — that attribution is the slicing invariant the tests exist to pin.
- **harness limit to state in the file (not fixable here):** `makeHarness`'s mock `agent()` IGNORES the `schema` option, so nothing behavioral proves the schemas are wired, and one trivial `HOLDS` entry satisfies "propertiesChecked non-empty" exactly like a thorough one. Add a STRUCTURAL test that evaluates the schema literals out of the wrapped source and asserts `required` lists the new keys, plus a twin-sync test over `execute-pipeline.js`.
- **verify:** `node .claude/workflows/dual-adversarial.test.mjs`
- **expected:** All tests pass, exit code 0.

## Verification

```
node .claude/workflows/dual-adversarial.test.mjs
node .claude/workflows/execute-pipeline.test.mjs
node scripts/validate-workflows.mjs
! grep -qE "Give NO credit|Assume the other legs missed something" .claude/workflows/dual-adversarial.js
```

All tests pass, both workflows parse, and neither removed clause survives.

`node --check .claude/workflows/dual-adversarial.js` CANNOT be used here (it fails today, before any change: `SyntaxError: Illegal return statement`). Workflow bodies use top-level `return` and `export const meta` and only parse inside the harness wrapper — `scripts/validate-workflows.mjs` wraps them the same way CI's `validate.yml` does, and is the correct parse check.
