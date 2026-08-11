---
name: feedback-orchestrator-fable-opus-workflows
description: Model routing — run the orchestrator on Fable + ultracode; Opus for the dynamic Workflows Fable spawns
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 14009dd7-3841-4784-8260-0ce163212edc
---

From 2026-07-03: run the **orchestrator (main session) on Fable** with **ultracode on**, and have Fable spawn **Opus** for the dynamic Workflows it sets up (implementation/review/fix legs, dual-adversarial gates, execute-pipeline, etc.).

**Why:** Fable is fast/cheap enough to drive orchestration at ultracode breadth; Opus is reserved for the heavy judgment inside the workflows Fable dispatches (code-writing, cross-model adversarial review, fixes) where correctness matters most.

**How to apply:** Set session model to Fable (`/model`) with `/effort` + ultracode on. When authoring Workflow scripts, pin `model: 'opus'` on `agent()` legs that implement/review/fix; the dual-adversarial and execute-pipeline workflows already pin Opus for those legs. See [[reference_pipeline_model_pins]] and [[feedback_effort_model_routing]].
