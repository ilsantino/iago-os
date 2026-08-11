---
name: Single @claude tag per PR
description: Never tag @claude twice on the same PR — parallel review-fix loops race and cause chaos
type: feedback
---

Only tag @claude ONCE per PR review cycle. Tagging twice spawns two parallel review-fix loops that race against each other — duplicate signals, merge conflicts, and 5+ rounds of cycling.

**Why:** PR #15 was tagged twice (once for audit-05, again for audit-05+06). Two loops ran concurrently, each pushing fixes and re-tagging, causing the fix agent to regress working code (removed $STRESS_FILE fallbacks, changed severity floors).

**How to apply:** When updating a PR after the first @claude tag, let the existing loop finish before re-tagging. If the PR body/scope changed, wait for `[claude-review-complete]` signal before posting a new @claude comment. Use `/iago:prfix` for manual re-triggers only after the previous cycle completes.
