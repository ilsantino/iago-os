---
name: effort-and-model-routing-protocol
description: Santiago delegates effort recommendations AND orchestration-method choice to me (2026-07-03)
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 28bafbe0-c67b-4788-9a07-c8d4b1837a5c
---

Santiago (2026-07-03): "I want you to know when to change effort (im on xhigh rn) — sometimes we need max, others xhigh + workflows. Same with which model you use for tasks." Later same day: "idk if we always need the full pipeline... i need YOU to determine when to use agent teams, subagents, dynamic workflows or whatever. because im not sure if pipeline effectively uses fable 5."

**Why:** effort, model, and orchestration method are cost/quality levers he wants managed actively — by me, per task, stated not asked.

**How to apply:**
- `/effort` is user-side — RECOMMEND the switch at the moment it matters ("bump to max for this synthesis, back after"). max = dense in-session artifact writing (master specs, architecture arbitration); xhigh = orchestration default. Session effort does NOT propagate to pipeline/Workflow subagents.
- **Pipeline model reality:** execute-pipeline impl/build/fix stages INHERIT the session model; review legs pin Opus 4.8 ∥ Codex GPT-5.5. **Santiago wants CODE GEN on Fable 5 always (2026-07-03).** So when the SESSION model is Opus (he sets his own /model independently of what code-gen should use), I must NOT rely on inheritance — pin `model: 'fable'` explicitly on impl/fix agents (dynamic Workflow) or ensure the dispatch uses Fable. Session-model ≠ code-gen model; keep code-gen Fable regardless of my session model.
- **Method doctrine (mine to choose, state the choice):** trivial ≤3 files → direct//iago-fast; docs/research → direct agents; feature-sized shipping client code with plans on disk → full pipeline (/iago-execute); special cases (non-main base branch, parallel impl teams, custom gates) → dynamic Workflow with Team-depth dual-adversarial (turnos-hard-delete pattern); decisions/research → council/deep-research. Don't run the full pipeline ceremonially when a lighter shape fits — but never skip adversarial review on shipping code.
- Model per agent: inherit (Fable) for impl; Santiago (2026-07-03) wants REVIEWS on Fable too — when running dual-adversarial, strip the Opus pin (temp variant per [[reference_pipeline_model_pins]]); the Codex GPT-5.5 leg stays, so cross-model is preserved.
- **Fast path for speed (Santiago 2026-07-03, munet waves+):** don't ceremonially run the full execute-pipeline per plan. Default: implement via dynamic Workflow (parallel Fable subagents per plan) → build gate → commit → `/dual-adversarial-fix` with Fable instead of Opus 4.8 → PR → `/iago-prfix` as the single @claude tag. Full pipeline reserved for when its extra stages earn their time.
