---
name: feedback-subagent-model-routing
description: Orchestrator MUST pick the cheapest-capable model per subagent/workflow-agent task; never let everything inherit Fable
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 871fae3a-c4ff-45bf-9d09-c20d002a54b3
---

Santiago (2026-07-05, during munet r2 lane runs): "When creating subagents, dynamic workflows, etc. YOU (fable orchestrator) NEED TO DETERMINE THE ADEQUATE MODEL FOR ITS CORRESPONDING TASK to optimize usage WITHOUT sacrificing quality."

**Why:** 4 parallel lane workflows burned ~1.5–2.4M subagent tokens each and hit the session cap mid-run, partly because every agent (including trivial git-state captures) inherited Fable.

**How to apply — tier every `agent()` / Agent dispatch by task class:**
- **Fable/Opus (inherit):** implementation, build-gate fixing, debugging, adversarial review legs, team legs, skeptic verification, fix agents — anything judgment/code-writing.
- **Sonnet:** PR creation, commit/staging with scope checks, @claude tag comments, Codex CLI wrapper (its fallback reviewer tier per CLAUDE.md Model Routing), mechanical analysis/reports.
- **Haiku:** pure state capture + assertion agents — side-effect snapshots, changed-files listing, pre-state/safety-verify git checks, rollback-to-checkpoint helpers.

Applied 2026-07-05 to the munet-r2 variants at `~/.claude/tmp/munet-r2/` (generator: `make-fable-variants.mjs` — count-verified string patches over the canonical `.claude/workflows/dual-adversarial*.js`). Related: [[feedback_effort_model_routing]], [[reference_pipeline_model_pins]].
