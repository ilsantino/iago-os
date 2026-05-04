---
description: >-
  Branch naming, PR process, merge strategy, and conventional commits.
  Always active for all git operations.
---

## Branch Naming

Format: `type/short-description`

Types: `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`, `test/`, `ci/`

Examples: `feat/auth-flow`, `fix/dynamo-ttl`, `refactor/api-layer`

## Commits

Conventional commits enforced by `commit-quality` hook:

`type(scope): description` — scope optional, description lowercase, max 72 chars.

Types: feat, fix, refactor, docs, chore, research, build, test, ci, perf, style, revert.

No WIP commits on main/master.

## Pull Requests

- One PR per feature or fix — do not bundle unrelated changes
- PR title matches conventional commit format
- Description includes: what changed, why, how to test
- Squash merge to main — clean linear history
- Delete branch after merge

## Tags

Semver tags on main: `v0.1.0`, `v0.2.0`, etc.

Tag after a milestone, not after every merge.

## STATE.md discipline

Every PR merge bumps `Updated:` in `.iago/STATE.md` to the merge date and appends one row to the Active table describing the merged change. The implementer of the merge does both edits — STATE.md is a digest of recent activity, and stale `Updated:` dates or missing rows mask drift between recorded and actual project state.

## Post-merge branch prune

After merging PRs, prune local branches whose remote tracking branch is gone. Run from the repo root on bash or zsh:

```bash
git fetch --prune
git branch -vv | awk '/: gone\]/ {print $1}' | while read -r b; do
  # add any current branches to preserve (pr-26 is a placeholder, not a permanent exclusion)
  case "$b" in wip/*|pr-26) continue ;; esac
  git branch -d "$b"
done
```

Uses `git branch -d` (lowercase) — refuses on unmerged commits. Skips `wip/*` and `pr-26` explicitly. Run on bash or zsh.
