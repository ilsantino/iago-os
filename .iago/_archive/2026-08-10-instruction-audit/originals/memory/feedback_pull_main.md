---
name: Always pull from main before starting work
description: Before creating branches or making changes, always pull latest from main to avoid drift and merge conflicts
type: feedback
---

Always pull from main before starting any new work — before creating a new branch or making changes on an existing one.

**Why:** Prevents merge conflicts and ensures we're building on the latest deployed code. Stacking branches without syncing main causes drift.

**How to apply:** At the start of every plan execution: `git checkout main && git pull`, then create the new branch from the appropriate base (main or previous plan branch that's been rebased).
