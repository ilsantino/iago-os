---
phase: feature-gate-hardening
plan: 02
wave: 1
depends_on: []
context: .iago/research/2026-06-13-gate-hardening-backlog.md
created: 2026-06-15
source: feature
---

# Plan: feature-gate-hardening/02-reviewer-input-integrity

## Goal
Harden reviewer input integrity and lens coverage in the dual-adversarial pre-merge gate so an LLM-transcribed file list, a case-variant path, a fluent uncited refute, a lost skeptic-filtered audit trail, or a silently-failed team leg can no longer narrow the gate or report clean over an incomplete review.

## Files

| Action | Path | Purpose |
|---|---|---|
| modify | `.claude/workflows/dual-adversarial.js` | Add EOF-sentinel trust check to the changed-files probe; case-insensitive amplify/src lens predicates; tighten refuteHasEvidence; treat team-leg failure as INCOMPLETE; document the three-dot diff invariant |
| modify | `.claude/workflows/dual-adversarial.test.mjs` | Regression tests for the probe sentinel, case-variant lens derivation, the filename-only refute, and team-leg INCOMPLETE |
| modify | `.claude/workflows/execute-pipeline.js` | Accumulate `filtered` across all fix rounds so the round-0 skeptic-filtered audit trail is not discarded |

## Tasks

### Task 1: EOF-sentinel trust check on the changed-files probe
- **files:** `.claude/workflows/dual-adversarial.js`, `.claude/workflows/dual-adversarial.test.mjs`
- **action:** In `dual-adversarial.js`, change the `changed-files` probe agent prompt (the `agent(...)` call at ~L344-L347 inside the AUTO block) so the agent runs `git diff --name-only ${base}...HEAD && echo '===IAGO_FILES_EOF==='` and returns `files` (the path array) PLUS `eofSeen` (boolean, true iff the `===IAGO_FILES_EOF===` sentinel line appeared in the git output) — mirroring the `===IAGO_PLAN_EOF===` sentinel technique in `execute-pipeline.js` PLANREAD_PROMPT. Extend `CHANGED_FILES_SCHEMA` (~L134-L138) by adding `eofSeen: { type: 'boolean' }` to `properties` and do NOT add it to `required` and do NOT default it to true. Change the `probeOk` definition (~L368) to `const probeOk = probeWellFormed && !allInvalidArray && !!filesResult.eofSeen` so a missing/false sentinel takes the DEGRADED path (full `AUTO_SELECTABLE_LENSES`), and update the DEGRADED `log` message (~L383-L385) to distinguish a missing-sentinel degradation from a malformed-shape degradation. In `dual-adversarial.test.mjs` add a test: a well-formed `files` array with `eofSeen=false` → full auto-selectable lens set and `probeDegraded=true`.
- **verify:** `node .claude/workflows/dual-adversarial.test.mjs`
- **expected:** All existing tests pass (absent `eofSeen` → `!!filesResult.eofSeen` is false → degraded, same as today's null probe). New test `eofSeen=false with well-formed files array → FULL set + probeDegraded` PASSES.

### Task 2: Case-insensitive amplify/ and src/ lens predicates in deriveLenses
- **files:** `.claude/workflows/dual-adversarial.js`, `.claude/workflows/dual-adversarial.test.mjs`
- **action:** In `deriveLenses()` change the amplify predicate at ~L250 from `p.startsWith('amplify/') || p.includes('/amplify/')` to `lower.startsWith('amplify/') || lower.includes('/amplify/')`, and the src predicate at ~L255 from `p.startsWith('src/') || p.includes('/src/')` to `lower.startsWith('src/') || lower.includes('/src/')` — leaving the existing `lower.endsWith('.tsx')` clause unchanged. Update the in-function invariant comment at ~L251-L255 to state the coverage-must-never-shrink-on-case-variation invariant applies to ALL three predicates (amplify directory-prefix, src directory-prefix, and `.tsx` extension), not only the extension. In `dual-adversarial.test.mjs` add two regression tests: `Amplify/data/resource.ts` → amplify + base lenses; `Src/api/client.ts` → frontend + base lenses.
- **verify:** `node .claude/workflows/dual-adversarial.test.mjs`
- **expected:** All existing tests pass, including the existing `amplify/data/resource.ts → amplify + base` test. New tests `Amplify/ path → amplify lens` and `Src/ path → frontend lens` PASS.

### Task 3: Tighten refuteHasEvidence to require a code construct, not just a filename
- **files:** `.claude/workflows/dual-adversarial.js`, `.claude/workflows/dual-adversarial.test.mjs`
- **action:** In `refuteHasEvidence()` (~L469-L477) replace the single `citesCode` regex at ~L475 with: `hasFileLine = /[\w/.-]+\.\w+:\d+/.test(r)`; `hasFileExt = /[\w/.-]+\.(ts|tsx|js|jsx|mjs|cjs|py|sh|json|md)\b/i.test(r)`; `hasCodeConstruct = /\b(function|const|let|var|class|return|if|guard|check|throws?|assert|validate|sanitize|escape|encode|allow\.owner|attribute_not_exists)\b/i.test(r) || /\b(line|L)\s*\d+|:\d+\b/i.test(r)`; and `const citesCode = hasFileLine || (hasFileExt && hasCodeConstruct)`. Update the comment at ~L462-L468 to document that a bare filename is no longer sufficient — a refute now needs a `file:line` pair OR a filename PLUS a code construct. In `dual-adversarial.test.mjs` add a test: a skeptic refute with reason `The sanitize.ts module ensures this` (filename only, no code construct) → `refuteHasEvidence` returns false → finding is kept (counted as confirm).
- **verify:** `node .claude/workflows/dual-adversarial.test.mjs`
- **expected:** All existing tests pass, including the existing `bare refute (no evidence)` test. New test `filename-only reason (no code construct) → counted as confirm, finding kept` PASSES.

### Task 4: Treat team-leg failure as an INCOMPLETE gate in team mode
- **files:** `.claude/workflows/dual-adversarial.js`, `.claude/workflows/dual-adversarial.test.mjs`
- **action:** In `dual-adversarial.js`, just before `gateStatus` is computed (~L636-L637), add `const teamIncomplete = mode === 'team' && teamDefs.some((def, i) => !teamResults[i])`, and change `const coreIncomplete = !review || !codex` to `const coreIncomplete = !review || !codex || teamIncomplete`, so a null `team:data` or `team:arch` leg in team mode yields `gateStatus='INCOMPLETE'` and `clean=false`. Update the INCOMPLETE branch of the result `log` (~L645-L646) to include the `teamIncomplete` condition in its message. No code change is required in `execute-pipeline.js`: the existing `if (da.gateStatus !== 'COMPLETE') throw ...` guard at L646-L648 of `execute-pipeline.js` already converts the new INCOMPLETE signal into a re-run, but you MAY add, as belt-and-suspenders only, a `const teamLegsFailed = (da.incompleteLegs || []).filter((l) => l.startsWith('team:')); if (teamLegsFailed.length > 0 && mode === 'team') throw ...` after that guard inside the `if (mode === 'team')` branch (the `mode` param is in scope there). In `dual-adversarial.test.mjs` add a test: team mode where `team:data` returns null → `gateStatus='INCOMPLETE'` and `clean=false`.
- **verify:** `node .claude/workflows/dual-adversarial.test.mjs`
- **expected:** New test `team:data leg fails (null) in team mode → gateStatus=INCOMPLETE, clean=false` PASSES. Existing `team mode appends team:data and team:arch legs` (both legs succeed → COMPLETE) still passes. Standard-mode tests unaffected (`teamIncomplete` is false when `mode !== 'team'`).

### Task 5: Accumulate filtered findings across all fix rounds
- **files:** `.claude/workflows/execute-pipeline.js`
- **action:** In `execute-pipeline.js`, after the round-0 `runDualAdversarial('r0', ...)` destructuring at L954 add `let allFiltered = [...(filtered || [])]`. After the re-review destructuring at L1001 (where `filtered` is reassigned from `reReview`) append `allFiltered = [...allFiltered, ...(filtered || [])]` so each fix round's skeptic-filtered findings accumulate rather than overwrite. Change the pipeline return field at L1116 from `filtered,` to `filtered: allFiltered,` so the orchestrator's merge-decision audit trail contains every round's filtered findings, not only the last. Do NOT touch `dual-adversarial.js` here — it correctly initializes `const filtered = []` fresh per invocation; accumulation belongs in the pipeline.
- **verify:** `node --check .claude/workflows/execute-pipeline.js`
- **expected:** File parses without syntax errors (exit 0). No execute-pipeline test harness covers this path; the change is structural — the pipeline return field `filtered` now references `allFiltered`, which concatenates every round's filtered array.

### Task 6: Document the three-dot diff invariant in dual-adversarial.js
- **files:** `.claude/workflows/dual-adversarial.js`
- **action:** At `const diffExpr = \`git diff ${base}...HEAD\`` (~L148) add a comment documenting the invariant: when invoked from `execute-pipeline.js` with `base=preImplSha`, `preImplSha` is always a direct ancestor of HEAD (captured at PREP before implementation), so three-dot and two-dot produce identical output; three-dot is used here because in standalone pre-merge runs `base=origin/main` may have diverged and three-dot correctly shows only the feature-branch delta. Keep the three-dot expression (do NOT change to two-dot — two-dot is incorrect for the standalone `base=origin/main` case). Make no change to `execute-pipeline.js` (its inline 2-leg prompts at L359/L375 already use two-dot `${preImplSha}..HEAD` and are correct for that ancestry).
- **verify:** `node --check .claude/workflows/dual-adversarial.js`
- **expected:** File parses without syntax errors (exit 0). `diffExpr` still uses the three-dot `git diff ${base}...HEAD` expression, now preceded by the invariant comment.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-06-15

### PRECISION — wrong/stale line references and under-specified behavior

**P1 [Important] Task 1 line references are off-by-~6.** The plan says "the `agent(...)` call at ~L344-L347 inside the AUTO block." The actual `agent(...)` call dispatching the `changed-files` probe is at L344-L347 (the prompt string at L345, schema at L346) — this part is close. But the plan also says to change the `probeOk` definition "at ~L368" — the actual `probeOk` line is L368, which is correct. However, the plan says `CHANGED_FILES_SCHEMA` is at "~L134-L138"; it is at L134-L138 (correct). And the plan says to add the DEGRADED log "message (~L383-L385)"; the actual log call is at L383-L385 (close but the log spans L383-L385, not L384 alone). These refs are close enough to not be blocking, but the implementer should verify rather than rely on them blindly.

**P2 [Important] Task 4 execute-pipeline.js belt-and-suspenders ref is wrong.** The plan says "the existing `if (da.gateStatus !== 'COMPLETE') throw ...` guard at L646-L648 of `execute-pipeline.js`". That guard is actually inside `runDualAdversarial()` at L646-L649 in the Tier 2/3 delegation branch (the team-gate path), NOT at a flat top-level line. The plan also says "the `mode` param is in scope there" — `mode` is NOT a variable in `execute-pipeline.js` at all; the tier-gate mode is threaded through `reviewOpts.mode` and local to the call site. The belt-and-suspenders guard as described would reference undefined `mode`. Mark this code path as optional ("you MAY add") so the main task is unaffected, but the optional code as written is broken.

**P3 [Minor] Task 3 "code construct" keyword list may over-match.** The proposed `hasCodeConstruct` regex includes common words like `\b(return|if|check|throws?)\b` which appear in natural-language refute text ("check the sanitize module") without citing any code. A refute saying "I think the return value is checked" now satisfies `hasCodeConstruct` even without a filename — defeating the purpose of the tightening. The intended guard is: filename + code construct OR file:line. The regex as written does not enforce the "filename ALSO present" half correctly for generic words like `check`.

**P4 [Minor] Task 5 missing line number for `allFiltered` insertion point.** The plan says "after the round-0 `runDualAdversarial('r0', ...)` destructuring at L954 add `let allFiltered = [...(filtered || [])]`." The actual destructuring is at L954. The plan also says "After the re-review destructuring at L1001" — confirmed at L1001. These are correct. However the plan says "Change the pipeline return field at L1116 from `filtered,` to `filtered: allFiltered,`" — the actual return field is at L1116 and currently reads `filtered,`. This is accurate. No issue here beyond noting that the Tier 2/3 delegation path in `runDualAdversarial` at L702 already returns `filtered: Array.isArray(da.filtered) ? da.filtered : []` (a fresh array per invocation) — so `allFiltered` accumulates correctly across rounds because each `runDualAdversarial` call returns that round's filtered set, not a cumulative one. The plan's logic is correct.

### EDGE CASES — inputs and states that break the approach

**E1 [Important] Task 3: existing `bare refute (no evidence)` test passes an empty string (`reason: ''`) which fails the `r.length < 12` guard and returns false. The new test case uses `reason: 'The sanitize.ts module ensures this'` (29 chars, has a `.ts` extension match) — but with the NEW regex as written, `hasFileExt` matches `.ts` and `hasCodeConstruct` matches... nothing in that exact string unless "ensures" or "sanitize" triggers one of the keywords. Actually it does NOT match any keyword in the proposed list. So `citesCode = hasFileLine || (hasFileExt && hasCodeConstruct)` = `false || (true && false)` = false. The test passes. BUT: a refute like `"The sanitize.ts module's check throws on invalid input"` has `.ts` (hasFileExt=true) AND `throws` (hasCodeConstruct=true) → citesCode=true → refuteHasEvidence returns true → the finding is DROPPED. The word `throws` in natural-language text ("it throws an error") is a false positive that lets a filename-only refute pass the guard with no actual line number. The plan should either tighten `hasCodeConstruct` to require `throws?` only in contexts like `throw new` or remove `throws?` from the generic list.

**E2 [Minor] Task 1: the `eofSeen` sentinel approach relies on the agent correctly echoing the exact sentinel string `===IAGO_FILES_EOF===` after the git command. If the agent reformats output (adds a newline prefix, wraps in backticks, or omits the echo because it considers the command list complete), `eofSeen` is false — the plan says this triggers DEGRADED → full AUTO_SELECTABLE_LENSES. This is correct and safe by design (DEGRADED widens coverage). The edge case to note: a real empty diff where `git diff --name-only` returns nothing AND the agent echoes the sentinel → `files=[]` + `eofSeen=true` → `probeOk=true` → derives base lenses. But with the new logic, `probeOk = probeWellFormed && !allInvalidArray && !!filesResult.eofSeen`. An empty array is `rawFiles.length === 0`, so `allInvalidArray = 0 > 0 && ...` = false. `probeOk = true && !false && true = true`. `deriveLenses([])` returns the two base lenses. That is correct and intentional. No issue.

**E3 [Minor] Task 2: the plan says to change the `amplify` predicate from `p.startsWith('amplify/')` to `lower.startsWith('amplify/')` — but `lower` is already defined in the current code at L248 as `p.toLowerCase()`. So the variable exists. The plan is correct. What the plan does NOT address is the Windows path separator normalization: `p` is already normalized via `.replace(/\\/g, '/')` at L247, so `Amplify\data\resource.ts` on Windows becomes `Amplify/data/resource.ts` before the lowercase check. This works correctly.

### CONTRADICTIONS — conflicts with codebase

**C1 [Important] Task 4 description contradicts the actual team-leg handling in `dual-adversarial.js`.** The plan says to add `teamIncomplete` and change `coreIncomplete` so a null team leg → `gateStatus='INCOMPLETE'`. BUT the current code at L546-L554 already handles null team legs as NON-BLOCKING: `log('WARNING: ${def.key} team leg failed (non-blocking)')` and appends to `incompleteLegs`. The comment at L546 explicitly says "non-blocking like the lenses." Changing team-leg failure to INCOMPLETE changes the contract from "non-blocking" (matching the existing lens-leg posture) to "gate fails." This is architecturally intentional (the plan's goal), but it IS a deliberate behavioral change that the plan describes correctly. The contradiction is that the current in-code comment says "non-blocking" — the implementer must update that comment too, or it becomes stale immediately after the edit. The plan does not mention updating L546's "non-blocking" comment.

**C2 [Minor] Task 1 adds `eofSeen` to `CHANGED_FILES_SCHEMA.properties` but does NOT add it to `required`. The plan explicitly states this. However, the schema is also used as a structured output schema for the agent call. If the agent never emits `eofSeen` (because it is not in `required`), the schema validator passes the output, `filesResult.eofSeen` is `undefined`, and `!!filesResult.eofSeen` is false → DEGRADED. This is the intended behavior per the plan ("a missing/false sentinel takes the DEGRADED path"). Correct and consistent. No contradiction.

**C3 [Minor] No drift-guard invariant violation.** The plan modifies `dual-adversarial.js` and `execute-pipeline.js` separately. Neither file contains a byte-identical copy of the other's logic (they share a conceptual dual-adversarial pattern but not copy-pasted source). The classify-tier.mjs drift-guard constraint (from the task dispatch prompt) does not apply here — classifyTier is not touched by this plan. No contradiction on that axis.

### MISSING ACCEPTANCE CRITERIA — tests absent for changed behavior

**M1 [Important] Task 4 has NO regression test for the new `teamIncomplete` path.** The plan adds a test "team:data leg fails (null) in team mode → gateStatus=INCOMPLETE, clean=false" to `dual-adversarial.test.mjs`. But Task 4 also says "No code change is required in `execute-pipeline.js`" and then describes an OPTIONAL belt-and-suspenders guard. There is no test that verifies the pipeline-level consequence: when `dual-adversarial.js` returns `gateStatus='INCOMPLETE'` from a team-leg failure, `execute-pipeline.js`'s `if (da.gateStatus !== 'COMPLETE') throw` guard (L646-L649 in the Tier 2/3 branch) fires. This is an untested integration path — the new behavior in `dual-adversarial.js` is tested, but whether `execute-pipeline.js` correctly handles the new INCOMPLETE signal from a team-leg failure is not. This is partially mitigated by the existing guard at L646 already covering any INCOMPLETE status, but the test harness never exercises team-leg null → INCOMPLETE → pipeline throw.

**M2 [Minor] Task 5 acceptance criteria says "No execute-pipeline test harness covers this path; the change is structural." This is acknowledged. The only verification is `node --check` (syntax only). A structural change to the pipeline return that affects the audit trail (`filtered: allFiltered` vs `filtered`) should have at least a comment-level note in the code explaining that `allFiltered` is intentionally cumulative across rounds, so a future reader does not revert it thinking `filtered` was accidentally replaced.

## Verification
Run both harnesses and both syntax checks:

```
node .claude/workflows/dual-adversarial.test.mjs && node --check .claude/workflows/dual-adversarial.js && node --check .claude/workflows/execute-pipeline.js
```

Expected: the test harness reports all existing tests plus the four new tests (probe `eofSeen=false` → full set + probeDegraded; `Amplify/` → amplify lens; `Src/` → frontend lens; filename-only refute kept; team-leg null → INCOMPLETE) passing with zero failures, and both `node --check` invocations exit 0 with no syntax errors.
