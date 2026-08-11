---
name: orchestrator-fable-workflows-opus
description: "Standing model routing — Fable orchestrator (ultracode), Opus agents inside dynamic workflows"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 673eeddf-0951-42fb-b4c2-e08503e9a9d7
---

Standing operating model (set 2026-07-03): the **orchestrator session runs Fable** (with ultracode on), and the **dynamic workflows Fable sets up use Opus** for their agents (impl / review / fix). Cheap coordinator, expensive workhorse exactly where code is written and adversarially reviewed.

**Why:** best quality-per-dollar. Fable is plenty for planning, routing, and workflow setup; Opus earns its cost on code generation and adversarial review. Strictly better than the inverse (Opus orchestrator + Fable agents), which is what we ran first and are now reversing.

**How to apply:** pin `model: 'opus'` on `agent()` calls in Workflow scripts; keep the orchestrator session on Fable (`/model fable`). This OVERRIDES the earlier "use Fable for code-gen/review/debug within workflows" instruction from the same MUNET session. The Codex cross-model leg is unchanged (still GPT-5.5 via codex-companion). Relates to [[reference_pipeline_model_pins]] and [[feedback_effort_model_routing]].
