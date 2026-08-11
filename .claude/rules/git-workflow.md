---
description: >-
  Branch/commit/PR/tag conventions + STATE.md discipline. Always active.
---

## Branches & Commits

Branches: `type/short-description` (feat|fix|refactor|chore|docs|test|ci).

Commits: commit-quality hook enforces conventional format (`type(scope): desc` — types feat|fix|refactor|docs|chore|research|build|test|ci|perf|style|revert, lowercase, ≤72 chars; no WIP on main).

## Pull Requests

- One PR per feature/fix/deliverable — never bundle unrelated changes
- Title: plain English, <60 chars, no conventional prefix
- Body opens `## What this does` (plain summary), then why + how to test
- Squash merge to main; delete branch after merge. Claude NEVER merges.

## Tags

Semver on main (`v0.1.0`…). Tag milestones, not every merge.

## STATE.md discipline

Every PR merge: bump `Updated:` in `.iago/STATE.md` to the merge date and append one Active-table row. The merge implementer does both.

## Post-merge branch prune

After merging PRs, prune local branches whose remote tracking branch is gone: `git fetch --prune`, then `git branch -d` (never `-D` — refuses on unmerged commits) each branch marked `: gone]` in `git branch -vv`, skipping `wip/*`.
