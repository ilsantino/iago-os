---
name: No chore PRs for plan-stack moves
description: Don't create chore PRs for moving plan-stack docs to main; dispatch the pipeline directly and let Plan 01's PR carry planning docs alongside its impl diff
type: feedback
originSessionId: ca3b6da5-2507-4f3b-a74c-053f233ceaa4
---
Don't create a chore PR just to commit plan stacks (`.iago/plans/feature-*/`) before dispatching `/iago-execute`. The pipeline's `git add -A` will pick up untracked plan files and roll them into Plan 01's PR — that's fine, not pollution. Planning artifacts are appropriate context for the impl PR.

**Why:** During PR #47-merge follow-up session (2026-05-16), I created PR #48 "Workstream B + C plan stacks (chore-only docs)" purely to avoid Plan 01 picking up untracked plan files. Santiago's reaction: "i feel like that pr was very unnecesary, why would you create a pr just for docs?" Correct — a chore PR for 10 plan files added an extra merge gate that delayed actual workstream dispatch. Plan 01's PR is the right home for B's planning context anyway.

**How to apply:** When about to dispatch `/iago-execute` with untracked `.iago/plans/feature-*/` files present, just dispatch. Don't pre-commit them via a separate chore PR. Each workstream's first pipeline run will commit its own planning docs alongside its first impl diff. Exception: if planning artifacts cross *multiple* workstreams (e.g., staging Workstream B's plans WHILE running C's pipeline), then those B plans WOULD pollute C's Plan 01 — in that case, commit them via a wip branch or stash, not a PR.
