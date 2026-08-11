---
description: >-
  Skill routing notes NOT covered by the injected skill list. The harness
  injects every skill's name + use/not-use description each session — that
  list is canonical; this file holds only what it doesn't say.
---

## Size your task

```
Trivial (≤3 files, obvious)      → /iago-fast (build gate only)
Small (1-3 tasks, clear scope)   → /iago-quick (full pipeline)
Medium (4-8 tasks, one feature)  → /iago-plan --feature → /iago-execute
Large (multi-feature, phased)    → /iago-init → /iago-plan → /iago-execute
```

## Bug-bounty skills are periodic, not per-plan

The pipeline already runs the critical rules from `/amplify-bug-bounty` and `/frontend-bug-bounty` on every plan via `scripts/review-checks/` (data-integrity, amplify, shell-deploy — the last auto-triggers on diffs touching `**/deploy/**`, `**/*.sh`, or systemd units). Run the full skills only for new-client onboarding, pre-launch hardening, post-incident audits, or monthly sweeps — never as a per-plan gate.
