---
name: feedback_accepted_residual_stopping_rule
description: "When a finding is owner-accepted, the dual-adversarial gate never reports \"clean\" — use a non-green stopping rule, and fence the async @claude loop"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 41a1223f-42b7-4c9f-a4c2-9106a6aeec73
---

When the orchestrator runs the dual-adversarial gate (Opus ∥ Codex) in a fix loop and one finding is **owner-accepted** (a documented, signed-off tradeoff), the gate will **re-flag it every round forever** — "fix until the gate is clean" has NO terminating state.

**Why:** the adversarial reviewers don't treat "documented acceptance" as closing a finding; they re-raise it (often the research doc itself predicts this). Repeatedly re-gating just re-reports the accepted item + burns ~2.4M tokens / ~45 min per gate.

**How to apply:**
- The terminal condition is "**all NON-accepted Critical/Important fixed; residual = the accepted finding + Minors**," verified by tests + judgment — NOT a green gate. Stop there; surface the accepted residual to the user as the known, permanent item.
- Don't run "one more gate" to confirm the accepted item is gone — it won't be. After the last fix round, hand to the async `@claude` loop (the documented next reviewer) instead of another in-session gate.
- **Fence the async loop:** the `@claude` tag comment must explicitly say "X is ACCEPTED per <doc> — do NOT re-architect/fix it; review only for genuinely new issues." This worked on PR #98 — the loop fixed 2 real new Minors and declared merge-ready without churning on the accepted I5.
- Each fix round can reveal adjacent real bugs (the gate earns its cost); converge by finishing propagation of a fix to EVERY copy (e.g. the same contradiction lived at T+10/T+15/T+30 + runbook + evidence template — fix all, not one). Context: [[project_pr98_phase2_evidence]], [[feedback_dual_adversarial_fix_before_dual_claude_tag]].
