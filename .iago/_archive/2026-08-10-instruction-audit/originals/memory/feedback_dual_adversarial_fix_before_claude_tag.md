---
name: feedback_dual_adversarial_fix_before_claude_tag
description: Post-PR sequence — run dual-adversarial-fix BEFORE tagging @claude via /iago-prfix; never tag first
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1562d58a-62c3-4334-947c-6f2d1d6cc5d5
---

After a PR is up (pipeline-built OR manually recovered from a thrown pipeline), the post-PR sequence Santiago wants is: **(1) automatically run the cross-model dual-adversarial-FIX pass** (gate + fix verified findings + commit to the branch + re-gate) → **(2) then tag @claude via `/iago-prfix`** as the SINGLE review tag on the now-hardened branch. Do NOT tag @claude before the dual-adversarial-fix.

**Why:** he wants the cross-model gate to harden the branch first, so the async @claude loop reviews already-hardened code — and a single clean loop, not two racing ones.

**How to apply:** the execute-pipeline auto-tags @claude at stage 6b unless `noTag` — that auto-tag races a later `/iago-prfix`. To honor this sequence cleanly, pass `noTag: true` to execute-pipeline (or, if it already tagged, cancel that triggered claude.yml run) so the ONLY @claude tag is the `/iago-prfix` you post AFTER dual-adversarial-fix. dual-adversarial-fix never pushes — push the fix commits before `/iago-prfix`. Stated 2026-06-02 during PR #92 (daemon-recovery-hardening), after the pipeline threw a false-negative build gate and the PR was recovered manually.

Links: [[feedback_single_claude_tag]], [[feedback_auto_tag_claude_pr]], [[feedback_workflow_pipeline]], [[feedback_never_skip_reviews]].
