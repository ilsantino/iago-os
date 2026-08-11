---
name: iago-os-worktrees-live-in-worktrees
description: "iago-os session/PR worktrees belong in iago-os/.worktrees/ (git-ignored), removed when their PR merges — never as dev/ siblings; Windows cleanup recipe"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8adc31b8-a86a-4a42-b052-d53fe90144ad
---

For the **iago-os repo specifically**, all session/PR git worktrees go in `iago-os/.worktrees/<name>` and MUST be `git worktree remove`d when their PR merges. The folder is git-ignored via `.git/info/exclude` (line: `.worktrees/`) — NOT committed `.gitignore`, so `grep worktree .gitignore` misses it and `git status` stays clean even with dirs inside.

**Why:** On 2026-06-02 Santiago found ~12 stray worktrees as `dev/` siblings (`iago-os-pr83`, `iago-os-a3-patterns`, broken 198M `iago-os-p04b`, empty `iago-wf-smoke{,2,3}`, etc.) PLUS ~12 stale broken ones inside `.worktrees/` (`chain-rebase` 133M, `pr40-fix`…`pr46-fix`). ~735M of cruft. His point: "this is why iago-os has a `.worktrees` folder — they need to be in there and deleted when no longer necessary." The recent batch violated the convention by landing in `dev/` instead of `.worktrees/`.

**Merge-status gotcha:** main squash-merges, so `git merge-base --is-ancestor <branch> origin/main` reports NO even for merged branches. Determine merged-ness from **PR state** (`gh pr list --state all --json state,headRefName`), not commit ancestry.

**How to apply:**
1. Create iago-os worktrees inside `.worktrees/`, not at `dev/` level. Remove with `git worktree remove` the moment the PR merges.
2. Safe-to-delete test per worktree: PR MERGED (by state) + clean tree (`git status --porcelain` empty) + 0 unpushed (`git rev-list --count origin/<br>..<br>` == 0). All three → zero data loss; the branch ref survives removal and is on origin anyway.
3. **Windows cleanup recipe** (the key gotcha): `git worktree remove`/`git worktree prune` fail with `Permission denied` on read-only files inside the tree. Fix: PowerShell `Remove-Item -LiteralPath <dir> -Recurse -Force` (clears read-only attrs), THEN `git worktree prune` to drop the now-orphaned `.git/worktrees/<name>` admin entries. If `prune` still hits Permission denied on admin dirs, `Remove-Item -Force` those directly.
4. Empty dirs / dirs with no `.git` (leftover smoke/codex shells) are trivially safe to `rmdir`/`Remove-Item`.

Related: [[Worktree and vite process hygiene]], [[Worktree per session]].
