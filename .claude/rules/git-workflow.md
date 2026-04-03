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
