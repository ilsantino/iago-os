---
name: feedback_workflow_journal_recovery
description: Recover a lost Workflow verdict from journal.jsonl when a 400 thinking-block error crashes the parent session
metadata: 
  node_type: memory
  type: feedback
  originSessionId: bdc01fff-f12d-4d8e-90bb-f3fe1dcd8de6
---

When a session dies on `API Error: 400 messages...thinking blocks cannot be modified` (a harness fault from a mutated cached thinking block), a Workflow it launched **keeps running and completing** — the crash kills only the parent's ability to render the result, not the background subagents.

**Why:** Workflow stages run as tracked background subagents. Every stage's structured output is appended to `…/projects/{slug}/{sessionId}/subagents/workflows/{wf_id}/journal.jsonl` (lines: `{"type":"result","agentId":...,"result":{...}}`, including the synthesizer's final verdict). It persists even when the parent can't surface it.

**How to apply:** Do NOT re-run the workflow to reproduce a lost verdict. Find the most recently modified `journal.jsonl` under the project's `subagents/workflows/` tree (`find . -path '*/workflows/*/journal.jsonl' -printf '%T@ %p\n' | sort -rn`), Read it, and synthesize from the `result` lines. Re-running burns the full wall-clock (a 6-lens PR review = ~21 min) to regenerate data already on disk. Confirmed 2026-05-30 recovering PR #84's GO verdict from `wf_fceb3226-a96`.

Related: the multi-lens+verify workflow structure also self-corrects under tool flake — lenses retract fabricated interim findings on retry and the synthesizer re-verifies each retraction. See [[project_pipeline_v2]].
