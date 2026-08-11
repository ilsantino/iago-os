---
name: Workflow bootstrap problem
description: GitHub Actions issue_comment workflows run from main — CI workflow fixes can't fix themselves via PR
type: feedback
---

GitHub Actions `issue_comment` event workflows ALWAYS run from the default branch (main), not the PR branch. This means a PR that fixes a workflow file cannot test or use the fixed version — the old broken version from main runs instead.

**Why:** Discovered 2026-04-08 when the `custom_instructions` → `prompt` fix in PR #19 couldn't take effect because the old broken workflow kept running from main. 5 rounds of the fix loop ran doing nothing.

**How to apply:** When fixing CI workflow files, skip the review-fix loop and merge directly to main. The fix takes effect only after merge. Don't waste time waiting for a loop that's running the old broken code.
