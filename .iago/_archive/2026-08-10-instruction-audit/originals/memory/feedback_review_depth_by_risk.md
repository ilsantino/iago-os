---
name: feedback-review-depth-by-risk
description: Frontend/visual diffs get the STANDARD 2-leg dual-adversarial gate; team mode reserved for auth/payment/data/admin surfaces; re-gates after fixes always standard
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 871fae3a-c4ff-45bf-9d09-c20d002a54b3
---

Santiago (2026-07-05, munet r2 lanes): "For all these frontend changes, are that many reviews and adversarials really necessary? can we not speed/optimize this?"

**Why:** team-mode gates on 4 pure-UI lanes ran 44–74 agents / 1.5–4M tokens each (security+amplify lenses on zero-backend diffs, panel legs re-finding the same bugs, 2 skeptics per finding, full team re-gates per fix round) and hit the Anthropic session cap twice. Every real catch that day came from the core Fable∥Codex legs + skeptic confirmation.

**How to apply:**
- Frontend/visual/content lanes → STANDARD dual-adversarial (2 legs + frontend/codeQuality lenses). Never `mode:'team'`.
- Team mode ONLY for: auth, payments/Stripe path, data-access/multi-tenancy, admin handlers, daemon/infra safety code.
- Re-gate after a fix round → always STANDARD, regardless of the first gate's depth.
- Reviews themselves stay mandatory ([[feedback_never_skip_reviews]] unchanged) — depth scales with risk, existence doesn't.
- Ultracode ≠ team-mode-everywhere: exhaustiveness belongs on risk surfaces, not on every diff.

Related: [[feedback_subagent_model_routing]], [[reference_pipeline_model_pins]].
