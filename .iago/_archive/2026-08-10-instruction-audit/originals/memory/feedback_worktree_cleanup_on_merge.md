---
name: feedback_worktree_cleanup_on_merge
description: "When Santiago says \"merge\"/\"merged\" for a PR, that is the worktree-cleanup trigger (Claude never merges)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 0641d2bd-cfb5-40b3-a4a1-e7e861545e14
---

When Santiago says "merge" or "merged" for a PR (e.g. "merge 184", "184 is merged"), that is NOT authorization for Claude to merge — Claude never runs `gh pr merge` (see [[feedback_no_auto_merge]]). It is the **cleanup trigger**: Claude removes that PR's worktree from `.worktrees/` (`git worktree remove`, `--force` only after preserving any uncommitted local-only artifacts) and prunes its local feature branch (`git branch -d`; use `-D` + PR-state confirmation since squash-merge makes `is-ancestor` return false — see [[feedback_iago_os_worktrees_dir]]).

**Why:** worktree lifecycle is tied to PR merge; leaving merged-PR worktrees around recreates the `clients/` sprawl that had to be cleaned up 2026-06-02. Santiago saying "merge" is his signal that the human-side merge happened (or is about to) and Claude should reclaim the worktree.

**How to apply:** never delete the permanent integration branches (`sentria-qc`, `main`) or their checkouts. Only ephemeral per-PR/per-session worktree branches. Confirm merged via PR state, not `git merge-base`. Applies in any repo using the `.worktrees/` convention (iago-os, sentria, and future clients).
