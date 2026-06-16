---
phase: feature-gate-hardening
plan: 04
wave: 2
depends_on: [01, 02, 03]
context: .iago/research/2026-06-13-gate-hardening-backlog.md
created: 2026-06-15
source: feature
---

# Plan: feature-gate-hardening/04-drift-guard-ci-wiring

## Goal
Drift-guard hardening + CI wiring + stale-doc fix: wire all three workflow `.test.mjs` harnesses into `validate.yml` so the drift guard and behavioral assertions run on every push/PR, anchor the drift-guard function-extraction regex against silent truncation false-negatives, and correct the now-stale "team mode unmerged" topology note in the pipeline-dynamic-upgrade research doc.

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `.github/workflows/validate.yml` | Add additive `test-workflows` CI job that runs the three harnesses as named steps |
| modify | `.claude/workflows/classify-tier.mjs` | Add `// END classifyTier` sentinel after the function's closing brace (line 56) |
| modify | `.claude/workflows/execute-pipeline.js` | Add byte-identical `// END classifyTier` sentinel after the inline copy's closing brace (line 319) |
| modify | `.claude/workflows/classifyTier.test.mjs` | Anchor the `extract()` regex (L127) to the sentinel so mid-function truncation is caught |
| modify | `.iago/research/2026-05-30-pipeline-dynamic-upgrade.md` | Replace stale `## Git topology note` (L67-L72) with corrected merged-state topology |

## Tasks

### Task 1: Wire the three workflow test harnesses into validate.yml CI
- **files:** `.github/workflows/validate.yml`
- **action:** Add a new job `test-workflows` (name `Test Workflows`, `runs-on: ubuntu-latest`) immediately after the existing `validate-workflows` job; do NOT modify or remove `validate-workflows`, which stays compile-only. The job steps are: `actions/checkout@v4`, `actions/setup-node@v4` with `node-version: "20"`, `npm install`, then three separate named steps running `node .claude/workflows/classifyTier.test.mjs` (name `classifyTier unit tests`), `node .claude/workflows/execute-pipeline.test.mjs` (name `execute-pipeline behavioral tests`), and `node .claude/workflows/dual-adversarial.test.mjs` (name `dual-adversarial behavioral tests`). Do NOT add a `permissions:` block (the job only reads checked-out files and runs node — no GitHub API, secrets, or elevated `GITHUB_OUTPUT` writes), and do NOT add the `.test.mjs` harnesses to the `readdirSync(...).filter((f) => f.endsWith('.js'))` glob in `scripts/validate-workflows.mjs` (that script uses a `vm.Script` async wrapper that rejects the harnesses' top-level `await`/`import`; they must run directly with `node`).
- **verify:** `node .claude/workflows/classifyTier.test.mjs && node .claude/workflows/execute-pipeline.test.mjs && node .claude/workflows/dual-adversarial.test.mjs && node -e "const y=require('fs').readFileSync('.github/workflows/validate.yml','utf8'); if(!/test-workflows:/.test(y)) throw new Error('test-workflows job missing'); if(!/dual-adversarial.test.mjs/.test(y)) throw new Error('harness step missing'); console.log('test-workflows job wired')"`
- **expected:** Each harness prints its PASS/FAIL lines, prints `N passed, 0 failed`, and exits 0; the final node check prints `test-workflows job wired`. In CI, the Actions UI shows a green `Test Workflows` job with three named steps, and any future drift between `classify-tier.mjs` and the `execute-pipeline.js` inline copy produces a red step with the exact failing assertion name.

### Task 2: Anchor the drift-guard regex to a sentinel in BOTH classifyTier copies
- **files:** `.claude/workflows/classify-tier.mjs`, `.claude/workflows/execute-pipeline.js`, `.claude/workflows/classifyTier.test.mjs`
- **action:** Per the SYNC CONTRACT comment at `classify-tier.mjs:L14-L24`, edit BOTH copies identically: add the line `// END classifyTier` immediately after the closing `}` of the exported `classifyTier` function in `classify-tier.mjs` (the brace at line 56) AND after the closing `}` of the inlined `classifyTier` function in `execute-pipeline.js` (the brace at line 319) — these two additions must be byte-identical. Then in `classifyTier.test.mjs` change the `fn` regex on L127 from `/function classifyTier\(planText\) \{[\s\S]*?\n\}/` to `/function classifyTier\(planText\) \{[\s\S]*?\n\}\s*\/\/ END classifyTier/` so the non-greedy extraction is anchored to the sentinel rather than the first column-0 `}` (a mid-function column-0 brace would otherwise truncate both extractions equally and silently pass the `assert.strictEqual(inline, twin, ...)` drift check). Leave the existing `assert.ok(fn && t3 && t2, 'could not locate classifyTier + keyword consts')` guard at L130 in place — it now fires loudly if either file loses the sentinel.
- **verify:** `node .claude/workflows/classifyTier.test.mjs`
- **expected:** All tests pass (`N passed, 0 failed`, exit 0), including the drift-guard test. To confirm the guard now catches truncation: temporarily insert a bare column-0 `}` mid-function in `classify-tier.mjs` and re-run — with the sentinel regex it must FAIL (the old regex would have falsely PASSED), then revert.

### Task 3: Correct the stale "team mode unmerged" topology note
- **files:** `.iago/research/2026-05-30-pipeline-dynamic-upgrade.md`
- **action:** Replace the entire `## Git topology note` section (lines 67-72) with the corrected topology stating that team mode and auto-lens derive are now merged — PR #89 (`a5900b5`) shipped the risk-tier classifier + team-gate delegation into `origin/main`, PR #90 (`068c93e`) shipped auto-lens configuration from the diff, and both are in `origin/main` as of 2026-06-14 — and noting the prior cumulative-PR note is superseded. Do NOT alter any other section of the file; the replacement must remove every stale phrase (`unmerged`, `NOT in ... origin/main`, `cumulative`).
- **verify:** `grep -n 'unmerged\|NOT in.*origin/main\|cumulative' .iago/research/2026-05-30-pipeline-dynamic-upgrade.md`
- **expected:** No output — none of the stale phrases remain in the file.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-06-15

### PRECISION

**P1 (Minor) — `npm install` step is superfluous and misleading.** All three harnesses (`classifyTier.test.mjs`, `execute-pipeline.test.mjs`, `dual-adversarial.test.mjs`) import only Node built-ins (`node:assert`, `node:fs`, `node:path`, `node:url`) plus a local sibling file (`./classify-tier.mjs`). Root `package.json` only ships `@biomejs/biome` and `typescript` — neither is used by the harnesses. An implementer following the plan literally will add an `npm install` step that installs nothing relevant and will cause confusion when reading the CI log. The step should be omitted or replaced with a comment explaining it is not needed.

**P2 (Minor) — `needs:` dependency unspecified.** The plan says add `test-workflows` "immediately after the existing `validate-workflows` job" but all current jobs in `validate.yml` run in parallel (no `needs:` keys). The plan does not state whether `test-workflows` should be sequenced after `validate-workflows` or run independently. If the intent is "workflows must compile before they are behavior-tested," a `needs: [validate-workflows]` is required; if parallel is acceptable the plan should say so explicitly. An implementer will guess.

**P3 (Minor) — `no permissions:` rationale is correct but incomplete.** The plan correctly notes no `permissions:` block is needed, but `runtime-checks` in `validate.yml` writes to `$GITHUB_OUTPUT`. The new job does not, so the existing default `contents: read` is fine. The rationale should explicitly note this rather than just "no GitHub API" — the implementer may over-apply `permissions: read-all` from habit.

### EDGE CASES

**E1 (Important) — YAML `!` negation in the final verify block is shell-dependent.** Task 3's verify command and the overall `## Verification` block use `! grep -q ...` (the `!` negation). In a GitHub Actions step's `run:` field the default shell is `bash` on ubuntu-latest, so `!` works — but only because GitHub Actions sets `shell: bash` implicitly. If a future CI runner change or a Windows-hosted runner is ever used, `!` in a bare `run:` is undefined. The plan should either annotate `shell: bash` explicitly on that step or rewrite the check as `grep -c ... && exit 1 || exit 0`. This is low-risk today but is a latent fragility.

**E2 (Minor) — Sentinel regex `\s*` between `}` and `// END classifyTier` can span newlines.** The updated extract regex in Task 2 is `/function classifyTier\(planText\) \{[\s\S]*?\n\}\s*\/\/ END classifyTier/`. `\s*` matches any whitespace including newlines, so `}\n\n// END classifyTier` still matches. This is almost certainly fine in practice (the sentinel is one line after the brace), but `\s*` is looser than the plan's prose implies ("immediately after the closing brace"). Using `[ \t]*` instead of `\s*` would express the intent precisely and reject a misplaced sentinel.

**E3 (Minor) — The plan's own text would classify as Tier 3.** The plan body contains the literal string `webhook` and `auth` (both TIER3_KEYWORDS) inside code snippets and prose. `classifyTier` scans the WHOLE plan text case-insensitively, so this plan will receive Tier 3 treatment when it runs through the pipeline. This is correct behavior, not a bug, but the implementer should be aware the pipeline will invoke the team gate with `maxFixRounds=3` for a plan whose actual security surface is limited to two comment insertions and a doc edit.

### CONTRADICTIONS

**C1 (Important) — SYNC CONTRACT invariant: sentinel must be added to BOTH copies byte-identically, but the plan's sentinel strings are not syntactically identical in context.** Task 2 specifies adding `// END classifyTier` after the closing `}` in `classify-tier.mjs` (which has `export function classifyTier`) and after the `}` in `execute-pipeline.js` (which has `function classifyTier` — no `export`). The sentinel line itself (`// END classifyTier`) is identical, but the SYNC CONTRACT at `classify-tier.mjs:L14-L24` says "BYTE-IDENTICAL copy of `classifyTier` + the two keyword consts." The keyword consts differ too (`export const` vs `const`). The plan is internally consistent — it only requires the sentinel LINE to be byte-identical, not the full block — but the word "byte-identical" in the plan's own action description ("these two additions must be byte-identical") could mislead the implementer into thinking the entire surrounding context must also match. The plan should clarify it means the sentinel comment line is identical, while the known `export` difference for the function and consts is already accounted for by the test's logic-only comparison (stripping comments and normalizing whitespace).

**C2 (Minor) — The `NOTE: CI wiring ... is still PENDING` comment at `classify-tier.mjs:L22-L24` will become stale after Task 1 ships but the plan does not instruct updating it.** After the CI job is wired, that NOTE is no longer accurate. The plan edits `classify-tier.mjs` for the sentinel (Task 2) but does not mention updating the stale PENDING comment in the file header. An implementer implementing Task 2 exactly as specified will leave a now-false comment in the file.

### SIMPLER ALTERNATIVES

**S1 (Minor) — The sentinel regex in the test could be simplified.** Rather than modifying the extract regex to match `// END classifyTier`, a simpler guard would be to assert `src.includes('// END classifyTier')` on both files before calling extract, and fail with "sentinel missing" if absent. This makes the intent explicit ("sentinel must exist") rather than relying on the regex change to implicitly test for it. The plan's approach works, but the two-step "assert sentinel exists + anchor regex to it" is cleaner than the one-step "regex that implicitly requires the sentinel."

### MISSING ACCEPTANCE CRITERIA

**M1 (Important) — No regression test for the "sentinel missing → loud failure" path.** Task 2's verify says "temporarily insert a bare column-0 `}` mid-function ... and re-run — with the sentinel regex it must FAIL." This is manual verification prose, not a test. The plan does not require the implementer to add a `test()` case in `classifyTier.test.mjs` that automates this check (e.g., a test that calls extract on a mutated source string with a mid-function `}` inserted and asserts the drift check fires). Without this, the "now catches truncation" claim is only spot-checked during implementation and never re-verified on future edits.

**M2 (Minor) — No acceptance criterion for the CI job being green on the CURRENT codebase before the PR merges.** The plan's verify for Task 1 checks that the job is syntactically wired (`test-workflows:` present, `dual-adversarial.test.mjs` present) but does not explicitly require that all three harnesses currently pass on the base branch. If a harness has a latent failure today, the CI job will go red on merge and block the next pipeline run. A simple "run all three harnesses locally and confirm 0 failed before committing" baseline check is missing from the acceptance criteria.

## Verification
Run all three harnesses, syntax-check the edited workflow files, and confirm the stale phrases are gone:

```bash
node .claude/workflows/classifyTier.test.mjs \
  && node .claude/workflows/execute-pipeline.test.mjs \
  && node .claude/workflows/dual-adversarial.test.mjs \
  && node --check .claude/workflows/execute-pipeline.js \
  && node --check .claude/workflows/classify-tier.mjs \
  && node -e "const y=require('fs').readFileSync('.github/workflows/validate.yml','utf8'); if(!/test-workflows:/.test(y)||!/dual-adversarial.test.mjs/.test(y)) throw new Error('test-workflows job not fully wired'); console.log('CI job wired')" \
  && ! grep -q 'unmerged\|NOT in.*origin/main\|cumulative' .iago/research/2026-05-30-pipeline-dynamic-upgrade.md \
  && echo "ALL GREEN"
```

Expected: each harness prints `N passed, 0 failed` and exits 0; both `node --check` calls produce no output (valid syntax); the node check prints `CI job wired`; the negated grep succeeds (no stale phrases); final line prints `ALL GREEN`.
