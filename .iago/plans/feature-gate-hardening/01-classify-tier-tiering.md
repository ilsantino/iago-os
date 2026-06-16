---
phase: feature-gate-hardening
plan: 01
wave: 1
depends_on: []
context: .iago/research/2026-06-13-gate-hardening-backlog.md
created: 2026-06-15
source: feature
---

# Plan: feature-gate-hardening/01-classify-tier-tiering

## Goal
Harden tiering correctness in `classify-tier.mjs` (and its byte-identical inline twin in `execute-pipeline.js`): broaden the security keyword set, add a `tier_override` frontmatter escape valve, fix the dead `fileCount` regex, close the EOF-sentinel Tier-2 gap, and self-document the Tier-0 collapse. All keyword/function-body changes mirror across both copies under the SYNC CONTRACT drift guard.

## Files
| Action | Path | Purpose |
|---|---|---|
| modify | `.claude/workflows/classify-tier.mjs` | Unit-tested twin: broaden TIER3 keywords, add `tier_override` seam, fix fileCount regex, document Tier-0 collapse |
| modify | `.claude/workflows/execute-pipeline.js` | Inline running copy (byte-identical twin) + pipeline orchestration block: mirror keyword/regex changes, wire frontmatter `tier_override` parsing, raise sentinel guard to `tier < 3`, document Tier-0 collapse |
| modify | `.claude/workflows/classifyTier.test.mjs` | Add regression tests for keyword breadth, tier_override, fileCount formats, and (where applicable) word-boundary 'auth'; drift guard must stay green |

## Tasks

### Task 1: Broaden TIER3 security keywords (both copies, byte-identical)
- **files:** `.claude/workflows/classify-tier.mjs`, `.claude/workflows/execute-pipeline.js`
- **action:** In `classify-tier.mjs:L25` and `execute-pipeline.js:L288`, add these tokens to the `TIER3_KEYWORDS` array in BOTH files identically: `'rbac'`, `'tenant'`, `'sql'`, `'xss'`, `'csrf'`, `'injection'`, `'stripe'`, `'billing'`, `'authz'`, `'role'`, `'permission'`, `'idor'`, `'secret'`, `'credential'`. Do NOT add `'author'` to either list. Keep the existing `lower.includes(k)` substring scan for all tokens — do NOT switch to a word-boundary regex in this task (keyword broadening alone closes the under-match gap; `'auth'` matching `'author'` is an accepted safe over-tier). HARD CONSTRAINT: the `TIER3_KEYWORDS` const must be character-for-character identical in both files after the drift guard's comment-strip + whitespace-normalize.
- **verify:** `node .claude/workflows/classifyTier.test.mjs`
- **expected:** All existing tests still PASS; drift guard 'inline classifyTier in execute-pipeline.js has not drifted from the twin' PASSES. All N passed, 0 failed.

### Task 2: Add tier_override seam to classifyTier + wire frontmatter parsing
- **files:** `.claude/workflows/classify-tier.mjs`, `.claude/workflows/execute-pipeline.js`
- **action:** In BOTH `classify-tier.mjs:L27` and `execute-pipeline.js:L290`, change the function signature from `classifyTier(planText)` to `classifyTier(planText, overrides = {})` and, immediately after the step (4) classify block computes `tier`, add before the final `return`: `if (typeof overrides.tier_override === 'number' && overrides.tier_override >= 0 && overrides.tier_override <= 3) { return overrides.tier_override }`. This function-body + signature change MUST be mirrored byte-identically into the `execute-pipeline.js` inline copy (note: the drift guard regex in `classifyTier.test.mjs:L127` matches `function classifyTier\(planText\)` literally — if the new `, overrides = {}` parameter causes the guard to stop locating the function, update that extract regex in Task 6 to match the new signature in BOTH files identically). In `execute-pipeline.js` ONLY (orchestration block, NOT mirrored to the twin): after `planText` is derived from the sentinel check (after L854) and BEFORE the `classifyTier` call at L855, add `const overrideMatch = planText.match(/^tier_override:\s*(\d)/im); const tierOverride = overrideMatch ? parseInt(overrideMatch[1], 10) : undefined`, change the L855 call to `classifyTier(planText, { tier_override: tierOverride })`, and add `if (tierOverride !== undefined) log('tier_override frontmatter found: forcing Tier ' + tierOverride)`. The override must apply BEFORE the sentinel-missing escalation (L856) and the headings-missing escalation (L870) — gate both escalations so a valid `tierOverride` skips them (e.g. wrap their conditions with `tierOverride === undefined &&`), because an explicit operator declaration overrides the fail-safe.
- **verify:** `node .claude/workflows/classifyTier.test.mjs`
- **expected:** New tests PASS: plan with frontmatter `tier_override: 1` and an `auth` keyword classifies Tier 1 (override wins over the Tier-3 keyword). Drift guard PASSES (function-body twin in sync). All N passed, 0 failed.

### Task 3: Fix fileCount regex to accept all attested file-bullet formats (both copies)
- **files:** `.claude/workflows/classify-tier.mjs`, `.claude/workflows/execute-pipeline.js`
- **action:** Replace the fileBullets MATCH regex at `classify-tier.mjs:L39` and `execute-pipeline.js:L302` with `/^\s*(?:-\s*)?\*\*[Ff]iles?:\*\*\s*(.+)$/gim`, and the STRIP regex inside the `.replace(...)` call at `classify-tier.mjs:L41` and `execute-pipeline.js:L304` with `/^\s*(?:-\s*)?\*\*[Ff]iles?:\*\*\s*/i`. The `(?:-\s*)?` makes the leading dash optional, `[Ff]` handles case, `s?` handles singular/plural — covering `- **files:** paths`, `**File:** path`, and `**files:** paths`. Apply all four edits (match + strip in each file) byte-identically. HARD CONSTRAINT: both regex literals must be character-for-character identical across the two files after the drift guard's comment-strip + whitespace-normalize.
- **verify:** `node .claude/workflows/classifyTier.test.mjs`
- **expected:** New tests PASS: a 2-task plan with two `**File:** a.ts` / `**File:** b.ts` entries (canonical format, 2 files) classifies Tier 0; a 2-task plan with four `**File:**` entries classifies Tier 1 (file ceiling blocks Tier 0); existing '2 tasks but 4 files' test still passes. Drift guard PASSES. All N passed, 0 failed.

### Task 4: Raise EOF-sentinel escalation threshold from tier < 2 to tier < 3 (execute-pipeline.js only)
- **files:** `.claude/workflows/execute-pipeline.js`
- **action:** At `execute-pipeline.js:L856`, change the sentinel escalation condition from `if (tier < 2 && !sawPlanEof)` to `if (tier < 3 && !sawPlanEof)` (preserving the `tierOverride === undefined &&` guard added in Task 2), and update the L858 log message to read `FAILING SAFE to Tier 3 (security gate + maxFixRounds=3)` and set `tier = 3` instead of `tier = 2` in the block. Evaluate applying the same `tier < 3` upgrade to the headings-missing escalation at L870 for consistency (a headings-missing read is equally likely to have lost a Tier-3 keyword); if applied, set `tier = 3` and update that log message identically. This change is in the orchestration block only — it is NOT inside the inlined `classifyTier` function body, so it MUST NOT be mirrored to `classify-tier.mjs` and does NOT affect the drift guard.
- **verify:** `node -e "const src = require('fs').readFileSync('.claude/workflows/execute-pipeline.js','utf8'); const m = src.match(/if \(tier < (\d) && !sawPlanEof/); if (!m) throw new Error('pattern not found'); if (m[1] !== '3') throw new Error('expected 3 got ' + m[1]); console.log('PASS sentinel guard is tier < 3')"`
- **expected:** `PASS sentinel guard is tier < 3`

### Task 5: Document the Tier-0 === Tier-1 collapse (both files, comment-only)
- **files:** `.claude/workflows/execute-pipeline.js`, `.claude/workflows/classify-tier.mjs`
- **action:** At `execute-pipeline.js:L885-L886`, add an inline comment: `// Tier 0 === Tier 1 intentionally: no lighter path wired yet (deferred — see quick-260530 §Cut from this pass). When a Tier-0 fast path ships, branch here on tier === 0.` At `classify-tier.mjs:L54` (beside the `return 0` line), add: `// Tier 0 — no lighter pipeline path yet; execute-pipeline.js treats it as Tier 1`. Comment-only, zero behavioral change. The drift guard at `classifyTier.test.mjs:L132` strips line comments before comparing, so this comment does NOT require byte-identical mirroring between the two files.
- **verify:** `node -e "const src = require('fs').readFileSync('.claude/workflows/execute-pipeline.js','utf8'); if (!src.includes('Tier 0 === Tier 1')) throw new Error('documentation comment missing'); console.log('PASS tier-0 collapse documented')"`
- **expected:** `PASS tier-0 collapse documented`

### Task 6: Add regression tests and keep the drift guard green
- **files:** `.claude/workflows/classifyTier.test.mjs`
- **action:** Add test cases asserting: (a) a plan containing `rbac permission` classifies Tier 3; (b) a plan containing `credential` classifies Tier 3; (c) a plan containing `tenant isolation` classifies Tier 3; (d) a plan with frontmatter `tier_override: 1` and an `auth` keyword classifies Tier 1 via `classifyTier(planText, { tier_override: 1 })` (override wins); (e) a 2-task plan with two `**File:** a.ts` / `**File:** b.ts` entries classifies Tier 0, and a 2-task plan with four `**File:**` entries classifies Tier 1. Since `'author'` remains a substring over-tier under the Task 1 keyword-only approach (no word-boundary regex applied), document this in a test comment as an accepted safe over-tier rather than asserting Tier 1 for it. If the Task 2 signature change (`classifyTier(planText, overrides = {})`) causes the drift-guard extract regex at `classifyTier.test.mjs:L127` (`/function classifyTier\(planText\) \{[\s\S]*?\n\}/`) to fail to locate the function in either file, update that regex to `/function classifyTier\(planText[^)]*\) \{[\s\S]*?\n\}/` so it matches the new signature in BOTH copies identically and the drift assertion still compares the full normalized bodies.
- **verify:** `node .claude/workflows/classifyTier.test.mjs`
- **expected:** All existing tests plus the new cases PASS, drift guard 'inline classifyTier in execute-pipeline.js has not drifted from the twin' PASSES. All N passed, 0 failed.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-06-15

### PRECISION

**[Important] Task 4 delegates a binary behavior decision to the implementer with no acceptance criteria.** "Evaluate applying the same `tier < 3` upgrade to the headings-missing escalation at L870 for consistency... if applied, set `tier = 3`" leaves whether to apply the change unresolved. The current headings-missing path sets `tier = 2`; upgrading to Tier 3 means every garbage/empty plan read gets `maxFixRounds=3`, a meaningful operational change. The plan must either commit to the upgrade or explicitly defer it — not leave it as an in-session implementer judgment. No regression test is specified for either branch of that decision.

**[Minor] `tier_override` out-of-range values produce a silent no-op.** `parseInt(overrideMatch[1], 10)` captures a single digit (0–9); values 4–9 satisfy `typeof === 'number'` in the function but fail `<= 3`, so the override is silently ignored. The orchestration block should `log('WARNING: tier_override: N is out of range [0-3]; ignoring')` for values 4-9 so the operator knows their frontmatter was discarded.

**[Minor] `'role'` over-tier surface not documented.** Task 1 explicitly accepts `auth`→`author` as a known safe over-tier and asks for a test comment. `'role'` has similar exposure: any plan prose mentioning "the team's role", "role-based UI", or even the word in a variable name (`reviewRole`) triggers Tier 3. The plan should add a test comment for `role` analogous to the `author` comment.

### EDGE CASES

**[Critical] `tier_override: 0` voids both fail-safes.** Task 2 allows `overrides.tier_override >= 0`, making `tier_override: 0` a valid override. The plan then requires wrapping the sentinel guard (`L856`) and headings guard (`L870`) with `tierOverride === undefined &&`. This means a truncated plan with no EOF sentinel — one that lost its tail and with it any late security keywords — can be declared Tier 0 by a `tier_override: 0` frontmatter value, bypassing both the sentinel fail-safe and the headings fail-safe entirely. The minimum valid `tier_override` should be `1` (downgrade to normal; not to the unimplemented fast-path). Change the validation to `>= 1 && <= 3` and update the `parseInt` parsing accordingly. Alternatively, if `tier_override: 0` must be supported, the sentinel and headings guards must NOT be skipped for Tier 0 — only the automatic escalation result is overridden, not the read-integrity checks.

**[Important] Task 2 verify step will fail the drift guard until Task 6 is applied.** Task 2 changes the function signature to `classifyTier(planText, overrides = {})` and instructs the implementer to run `node .claude/workflows/classifyTier.test.mjs` as its verification step. But the drift-guard regex at `classifyTier.test.mjs:L127` is `/function classifyTier\(planText\) \{[\s\S]*?\n\}/` — it will fail to match the new signature and throw `'could not locate classifyTier + keyword consts'`. Task 6 fixes this regex, but Task 6 is a separate task with its own verify step. The plan must either: (a) declare Tasks 2 and 6 as an atomic pair (apply Task 6's regex update before running Task 2's verify), or (b) suppress the drift-guard run after Task 2 and run it only after Task 6 completes. As written, the verify step for Task 2 will always fail, potentially causing the implementer to diagnose a spurious failure.

**[Important] Task 3 new regex strips the `$` anchor from the match pattern.** The current regex `/^\s*-\s*\*\*files:\*\*\s*(.+)$/gim` uses `$` to anchor the end. The plan's replacement `/^\s*(?:-\s*)?\*\*[Ff]iles?:\*\*\s*(.+)$/gim` preserves the `$`. This is correct. However, the strip regex `/^\s*(?:-\s*)?\*\*[Ff]iles?:\*\*\s*/i` used in the `.replace()` call does not have a `$` (it only strips the prefix, not the suffix) — this is also correct. No issue here, noted for implementer clarity.

**[Minor] Test (e) in Task 6 uses two `**File:** a.ts` bullets but the new match regex captures only `- **files:**` (dash-prefixed) and `**File:**` (no dash) formats.** The test plan `**File:** a.ts` uses the no-dash singular format. After Task 3's regex fix, this will be correctly matched. However, the test plan must contain zero TIER3 or TIER2 keywords in any prose — the plan's description does not explicitly call this out. If the test helper string contains "auth", "schema", or any other keyword incidentally, the Tier 0 expectation will fail silently. Implementer must ensure the test plans for Task 6(e) are keyword-clean.

### CONTRADICTIONS

**[Important] `tier_override` in `classifyTier` function body violates the SYNC CONTRACT scope boundary.** The SYNC CONTRACT requires the `classifyTier` function body to be byte-identical in both files. Adding `if (typeof overrides.tier_override === 'number' && overrides.tier_override >= 0 && overrides.tier_override <= 3) { return overrides.tier_override }` to the function body IS correctly mirrored (Task 2 requires it in both). However, the plan adds `const overrideMatch` / `const tierOverride` parsing and the `log(...)` call in the orchestration block of `execute-pipeline.js` ONLY — the plan correctly marks these as "NOT mirrored." The boundary is correctly drawn. No violation. (Noted as clean confirmation of the invariant.)

**[Minor] Task 4 headings-missing escalation upgrade (if applied) contradicts `classifyTier`'s own parse-failure default.** `classifyTier` returns Tier 1 for zero task headings. The orchestration block currently escalates Tier 1 (no headings) to Tier 2. If Task 4 upgrades this to Tier 3, the behavior is: `classifyTier` says Tier 1, orchestration overrides to Tier 3. This is not a bug (orchestration is allowed to be more conservative), but the asymmetry means the unit-tested twin (`classify-tier.mjs`) and the running pipeline have meaningfully different semantics for the no-headings case. The plan should either document this divergence explicitly or keep the headings-missing escalation at Tier 2 for consistency with `classifyTier`'s Tier-1 intent.

### SIMPLER ALTERNATIVES

**[Minor] `tier_override` parsing regex `/^tier_override:\s*(\d)/im`** captures only a single digit. `parseInt` of a single captured digit is always in [0–9] and always an integer — `Number.isInteger()` check in the function body is not needed. However, the plan's function-body check uses `typeof === 'number'` which allows floats if called directly (not via the parsing path). For the calling path in the orchestration block this is fine; for the function API, `Number.isInteger()` is a stricter and clearer guard. No behavior change, but noting the float-permissive check as a minor API inconsistency.

### MISSING ACCEPTANCE CRITERIA

**[Important] No regression test specified for Task 4 (sentinel escalation threshold upgrade).** The verify step for Task 4 is a single inline `node -e` grep checking that `tier < 3` is present in the source. There is no behavioral test asserting: "a plan that classifies Tier 2 via keywords but has no EOF sentinel does NOT get further escalated to Tier 3 under the new `tier < 3` guard." The grep verify confirms the text was changed but not that the logic is correct. A test case in `classifyTier.test.mjs` cannot cover orchestration-block logic, but the missing-sentinel behavior should have at least a documented manual verification step.

**[Important] No acceptance criterion for the headings-missing-to-Tier-3 path if Task 4's "if applied" branch is taken.** If the implementer applies the headings-missing upgrade, the plan provides no test for it — neither in `classifyTier.test.mjs` (which tests `classifyTier()` only, not orchestration) nor as an inline grep. This is a behavior change with zero test coverage.

**[Minor] Task 6 test comment for `'author'` over-tier is specified but no analogous comment for other new broad keywords** (`'role'`, `'sql'`, `'secret'`). The accepted-over-tier documentation is incomplete for the full new keyword set.

## Verification
Run the full classify-tier unit + drift harness and the two inline-grep checks together:

```
node --check .claude/workflows/classify-tier.mjs && \
node --check .claude/workflows/execute-pipeline.js && \
node .claude/workflows/classifyTier.test.mjs && \
node -e "const src = require('fs').readFileSync('.claude/workflows/execute-pipeline.js','utf8'); const m = src.match(/if \(tier < (\d) && !sawPlanEof/); if (!m || m[1] !== '3') throw new Error('sentinel guard not tier < 3'); if (!src.includes('Tier 0 === Tier 1')) throw new Error('tier-0 doc comment missing'); console.log('PASS pipeline guards + docs')"
```

Expected: both `node --check` pass with no output (exit 0); `classifyTier.test.mjs` prints `N passed, 0 failed` with the drift guard green; the final `node -e` prints `PASS pipeline guards + docs`. All commands exit 0.
