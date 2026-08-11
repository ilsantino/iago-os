---
name: NEVER merge PRs — humans only (not just the workflow, ALL of Claude)
description: Claude must never run `gh pr merge`, never use --merge/--squash/--rebase flags, never accept ambiguous authorization as license to merge. Only Santiago (or Sebas) merges. Strengthened 2026-05-19 after Claude merged PR #66/#68 by misinterpreting "do what you must" as merge authorization.
type: feedback
originSessionId: ff1e4624-9a1c-4824-bf5e-72b9a82c761f
---
**Claude NEVER merges PRs.** Not via `gh pr merge`, not via the GitHub UI, not via any automation. Humans-only.

Originally this rule applied only to the `claude-review-fix.yml` workflow. **As of 2026-05-19, it applies to ALL Claude actions** — orchestrator sessions, pipeline scripts, helper agents, every form of Claude in the iaGO loop.

**Why (strengthened version):** Santiago called this out 2026-05-19 after Claude merged PR #66 and #68 by reading "do what you must, follow recommendation and gut" as merge authorization. That was wrong. Merging is a human-only act. There is NO phrasing of user authorization — "do what you must", "ship it", "go ahead", "we gucci", "hit it" — that authorizes Claude to merge. Merging requires an explicit user click on the GitHub merge button. The cost of one mistaken merge (rolling back a merged commit, force-push to main, broken CI for downstream branches) is far higher than the cost of waiting for the user.

**How to apply:**

- NEVER run `gh pr merge` for ANY reason
- NEVER pass `--merge`, `--squash`, `--rebase`, `--auto`, or `--admin` flags to gh
- When a PR is ready: report status ("CI green, reviews clean, mergeable") and STOP. Do not interpret silence or vague approval as authorization.
- When a PR review comes back clean: report it. Do not merge.
- If user says "merge it" directly, push back ONCE ("confirm — you want me to run `gh pr merge`? per repo rule humans merge, want me to do it anyway?") before acting. User usually means "I'll merge it" and wants Claude to prepare the state, not pull the trigger.
- Async review-fix loop in claude-review-fix.yml already enforces this on the GitHub Actions side; this memory enforces it on the orchestrator side.
- This rule OVERRIDES `feedback_explicit_authorization`. Phrases like "do what you must" authorize NON-merge actions but never merging.

**What Claude CAN do (safe set):**
- Create branches, commit, push, open PRs
- Tag @claude for review
- Apply fixes after review feedback
- Comment on PRs, add labels, edit descriptions
- Close PRs (e.g., supersede with new branch) — only on explicit request

**What Claude CANNOT do under any circumstance:**
- `gh pr merge` with any flag combination
- Any UI-equivalent merge action
- "Auto-merge" approval setup that would cause a merge without human click
- Suggesting `gh pr merge` in continuation prompts for future Claude sessions

**Violation log (so this doesn't repeat):**
- 2026-05-19 — Claude merged PR #66 (`c0fd713`) and #68 (`8df36e8`) after Santiago said "do what you must." Should have reported "ready to merge, your call" and stopped. Memory updated and rule strengthened in response.
