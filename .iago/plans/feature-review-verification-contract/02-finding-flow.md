---
phase: feature-review-verification-contract
plan: 02
wave: 2
depends_on: [01]
context: inline
created: 2026-08-17
source: feature
---

# Plan: feature-review-verification-contract/02-finding-flow

## Goal

Stop the local dual-adversarial gate and the async GitHub review-fix loop from being blind to each other, and make a review leg that produces nothing fail loudly instead of reporting success. Evidence: PR #80 lost two Criticals (including a silent data-loss path) because "the async bot never saw the dual-adversarial findings"; PR #78's Codex leg wrote no findings at all and the gate reported fine. See `.iago/research/2026-08-16-iago-os-full-audit.md` SA1–SA2.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `.claude/workflows/execute-pipeline.js` | Carry unresolved gate findings into the @claude tag comment |
| modify | `.claude/workflows/dual-adversarial.js` | Fail loudly when a leg returns no findings and no properties |
| modify | `.github/workflows/claude-review-fix.yml` | Consume the forwarded findings block |
| modify | `templates/client-project/.github/workflows/claude-review-fix.yml` | Keep the client twin in sync |
| modify | `.claude/rules/execution-pipeline.md` | Document the hand-off contract and the Minor backlog |

## Tasks

### Task 1: Fail loudly on a leg that produced nothing
- **files:** `.claude/workflows/dual-adversarial.js`
- **action:** Treat any core leg (review or codex) returning both an empty `findings` array and an empty/absent `propertiesChecked` as a failed leg — push its key onto `incompleteLegs` so `gateStatus` becomes `INCOMPLETE` and `clean` cannot be true. Add a comment citing PR #78, where the Codex leg was logged as "context-read only, no structured findings written" and the gate still reported fine.
- **verify:** `node .claude/workflows/dual-adversarial.test.mjs`
- **expected:** All tests pass, including the Task 1 case added in Plan 01 Task 8.

### Task 2: Collect the findings the fix loop did not close
- **files:** `.claude/workflows/execute-pipeline.js`
- **action:** After the final fix round, build an `unresolvedFindings` array from the last gate result — the `backlog` (Minor) entries plus any blocking findings left un-verified by the skeptic cap. Pass it into the merged create-PR + tag stage alongside the existing plan context.
- **verify:** `grep -n "unresolvedFindings" .claude/workflows/execute-pipeline.js`
- **expected:** Defined after the fix rounds and referenced in the PR/tag stage prompt.

### Task 3: Embed the findings block in the @claude tag comment
- **files:** `.claude/workflows/execute-pipeline.js`
- **action:** Extend the create-PR + tag stage prompt so the tag comment ends with a machine-readable block delimited by `<!-- iago:gate-findings -->` and `<!-- /iago:gate-findings -->`, containing one line per unresolved finding as `[severity] file:line — summary`. When `unresolvedFindings` is empty, emit the delimiters with an explicit `none` line so the async loop can distinguish "nothing open" from "block absent".
- **verify:** `grep -c "iago:gate-findings" .claude/workflows/execute-pipeline.js`
- **expected:** `2` or more (opening and closing delimiters in the stage prompt).

### Task 4: Make the async loop read the forwarded findings
- **files:** `.github/workflows/claude-review-fix.yml`
- **action:** In the review step's prompt, instruct the reviewer to locate the `<!-- iago:gate-findings -->` block in the PR's comments and verify each listed finding is resolved in the current diff before hunting for new ones, raising any still-open entry as a finding of its stated severity. Preserve the uncommitted bilingual severity detection (`SEVERIDAD` / `SECCION_HALLAZGOS`) and the `--max-turns 25` change already in the working tree — do not revert them.
- **verify:** `grep -c "iago:gate-findings" .github/workflows/claude-review-fix.yml`
- **expected:** `1` or more, with `SEVERIDAD` and `--max-turns 25` still present.

### Task 5: Mirror the change into the client template
- **files:** `templates/client-project/.github/workflows/claude-review-fix.yml`
- **action:** Apply the same prompt change as Task 4 so scaffolded client repos get the identical loop behavior. Preserve that file's own uncommitted working-tree changes.
- **verify:** `diff <(grep -c "iago:gate-findings" .github/workflows/claude-review-fix.yml) <(grep -c "iago:gate-findings" templates/client-project/.github/workflows/claude-review-fix.yml)`
- **expected:** No output — both files carry the same number of occurrences.

### Task 6: Document the hand-off contract
- **files:** `.claude/rules/execution-pipeline.md`
- **action:** In the "Async review-fix loop" section, document that the @claude tag comment carries the `iago:gate-findings` block and that the async reviewer must verify those entries before raising new ones. In the "Stages" section, note that Minor findings route to the gate's `backlog` and never enter a fix round.
- **verify:** `grep -c "iago:gate-findings\|backlog" .claude/rules/execution-pipeline.md`
- **expected:** `2` or more.

## Verification

`node .claude/workflows/dual-adversarial.test.mjs && node .claude/workflows/execute-pipeline.test.mjs && node --check .claude/workflows/execute-pipeline.js`

All tests pass. Both `claude-review-fix.yml` files contain the `iago:gate-findings` instruction, and `git diff` shows the pre-existing bilingual-detection and `--max-turns 25` changes are still intact.
