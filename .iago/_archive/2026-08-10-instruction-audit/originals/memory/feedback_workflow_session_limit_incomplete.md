---
name: feedback_workflow_session_limit_incomplete
description: "Long Workflow runs can fail INCOMPLETE on the Anthropic session/usage cap — re-run after reset, don't touch code"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 168d1d6c-6317-4639-a3c9-f77dc307fc05
---

A long harness Workflow (e.g. a dual-adversarial Team gate: ~90 min, ~2–3M subagent tokens) can hit the **Anthropic session/usage limit mid-run**. Every leg then fails with `"You've hit your session limit · resets <time> (<tz>)"`, and the gate returns `gateStatus: "INCOMPLETE"`, `verdict: "UNKNOWN"`, `codexSource: "unavailable"`, `findings: []`, `incompleteLegs: [all]`.

**Why:** this is an INFRA failure, not a code defect — no leg actually evaluated the diff.

**How to apply:** do NOT change code, do NOT tag @claude, do NOT treat it as "clean." Check the current time vs the stated reset (it's in the failure text, e.g. "resets 2:20pm America/Mexico_City"); once past it, **re-run the same Workflow**. The re-run does NOT consume a dual-adversarial fix cycle (the cap counts COMPLETE fix→re-gate cycles, not infra retries). If the window is tight the re-run can fail again — wait for the next reset. Confirms the gate's own contract: INCOMPLETE → re-run, never /iago-prfix. Seen on [[project_sentria_turnos_drop_prioridad]] (PR #240, 2026-06-24). Related: [[feedback_workflow_journal_recovery]], [[feedback_pipeline_hang_malformed_command]].

**2026-06-25 refinement — INCOMPLETE can be PARTIAL (PR #241 sentria reportes plan-02).** Not always all-legs-fail: the limit killed 6 legs (`opus-review` + 3 lenses + 2 team) but the **Codex** leg finished, so `codexSource:"codex"`, `crossModelDegraded:false`, and `findings` held **2 REAL Codex findings** (verdict still `UNKNOWN` because opus-review died). The workflow even auto-retried the throttled legs (new agent IDs) post-reset but re-exhausted. Apply: (1) the completed leg's findings are REAL and worth harvesting/fixing, but had **no Team adjudication** — so `filtered:[]` is meaningless (no skeptic drop ran), treat them as unverified. (2) Still INCOMPLETE → still must re-run for an authoritative verdict; do not tag on the partial. (3) A finding you DEFER (document, don't fix) makes "clean" unreachable by design — a later gate keeps flagging it, and the human merges accepting the documented finding (don't loop chasing green). Live-poll progress via `subagents/workflows/{wf}/journal.jsonl` (started-vs-result counts) + `agent-*.jsonl` last assistant text (legs show the "session limit" string when stalled).
