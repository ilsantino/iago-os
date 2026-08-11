---
name: sync-checkout-before-recon
description: "Always git fetch + sync a client repo checkout BEFORE any recon/SPEC/planning session — recon agents read the working tree, and a stale branch poisons everything downstream"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8f1325f3-c24f-4b8f-892a-ec981663e956
---

Before ANY recon, SPEC authoring, or planning on a client repo (clients/*), run `git fetch origin` and sync the checkout to the base branch head. Verify with `git status` showing "up to date with origin/{base}".

**Why:** On 2026-06-09 the sentria checkout sat on a merged feature branch (`feat/turnos-admin-tab`), 83 commits / ~29 PRs behind `origin/sentria-qc`. The feature-organigrama-editor SPEC + 5 plans were authored from Explore-agent recon on that stale tree — premises like "plan 10 unexecuted" were false (it had shipped 9 days earlier), the TurnoModal they described had been overhauled, and prod data assumptions ("no turno data") were wrong. All planning artifacts needed warnings + re-cuts.

**How to apply:** First action of any recon/planning session in a client subtree: `git fetch origin --prune && git checkout {base} && git pull --ff-only`. Also verify live-data assumptions against AWS (read-only scan) when a SPEC claims anything about deployed data — repo state ≠ deployed state (sentria prod WAS seeded despite docs saying cutover pending). Related: [[pull-main-first]], [[worktree-per-session]].
