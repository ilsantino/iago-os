---
phase: quick
plan: quick-260408-fix-review-fix-prompt
wave: 1
depends_on: []
created: 2026-04-08
branch: fix/review-fix-prompt-input
base: main
---

# Quick: Fix claude-review-fix.yml silent no-op — custom_instructions → prompt

## Goal

The review-fix workflow uses `custom_instructions:` as input to `anthropics/claude-code-action@v1`,
but that input doesn't exist — the correct input is `prompt:`. This causes the fix agent to
silently skip all work (no trigger detected, exits green, no code changed). Fix all three copies
and sync the stale munet-web client copy with the full canonical workflow.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Edit | `.github/workflows/claude-review-fix.yml` | Fix `custom_instructions` → `prompt` on both action steps (lines 144, 220) |
| Edit | `templates/client-project/.github/workflows/claude-review-fix.yml` | Same fix on template copy (lines 144, 220) |
| Sync | `clients/munet-web/.github/workflows/claude-review-fix.yml` | Replace stale copy with full canonical (includes open-state guard, git config, push fallback, enhanced isClean, summary step) |

## Tasks

### Task 1: Fix canonical and template workflows
- **files:** `.github/workflows/claude-review-fix.yml`, `templates/client-project/.github/workflows/claude-review-fix.yml`
- **action:** In both files, replace `custom_instructions:` with `prompt:` on the "Fix review findings" step and the "Post review summary" step. No other changes.
- **verify:** `grep -n "custom_instructions" .github/workflows/claude-review-fix.yml templates/client-project/.github/workflows/claude-review-fix.yml`
- **expected:** No matches (zero occurrences of custom_instructions in either file)

### Task 2: Sync munet-web client workflow from canonical
- **files:** `clients/munet-web/.github/workflows/claude-review-fix.yml`
- **action:** Replace the entire file contents with the canonical `.github/workflows/claude-review-fix.yml` (which already has the `prompt:` fix from Task 1). This brings in all improvements: `state == 'open'` guard, Configure git step, Push remaining changes fallback, enhanced clean signals, PASS verdict detection, and the clean PR summary step.
- **verify:** `diff .github/workflows/claude-review-fix.yml clients/munet-web/.github/workflows/claude-review-fix.yml`
- **expected:** No differences (files are identical)

### Task 3: Verify no stale custom_instructions remain anywhere
- **files:** all workflow files
- **verify:** `grep -rn "custom_instructions" .github/workflows/ templates/ clients/`
- **expected:** No matches across the entire repo
