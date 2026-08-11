---
name: Auto-tag Claude on PRs
description: After pushing a PR, automatically tag @claude for thorough review on GitHub
type: feedback
---

After every PR is created and pushed, automatically comment tagging @claude to review the PR thoroughly on GitHub.

**Why:** Santiago wants every PR to get a cross-model review directly on the PR itself (not just the local Codex adversarial pass). This catches issues visible in the GitHub diff context and leaves a review trail.

**How to apply:** After `gh pr create` (or after pushing fixes to an existing PR), run `gh pr comment {number} --body "@claude Review this PR thoroughly..."` with context-specific review instructions. This should be baked into `scripts/execute-pipeline.sh`'s CREATE PR stage as a standard step.
