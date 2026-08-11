---
name: feedback_subagent_git_wander_and_structuredoutput
description: Two infra failure modes when delegating heavy/self-modifying code edits to subagents — git-wander-to-main and StructuredOutput-emit failure
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 0f2b402b-b6bf-41ab-82a0-42ddee91bd3b
---

Delegating heavy multi-file edits (esp. self-modifying changes to `.claude/workflows/`) to subagents hit two reproducible failure modes across 4 attempts in one session (2026-05-30, the pipeline risk-tiering work):

1. **git-wander-to-main.** Subagents that load repo context obey the standing memory rule "always git pull main before starting work" ([[feedback_pull_main]]) and run `git checkout main` mid-task — wandering off the feature branch and stranding partial work on `main` (uncommitted). In-prompt "do NOT checkout/pull/merge" guardrails did NOT override it (happened twice, once with explicit guardrails). Recover via reflog (`git checkout <branch>` carries uncommitted changes back; nothing is lost).

2. **StructuredOutput-emit failure.** Workflow subagents given a forced `schema` fail after long editing sessions: "subagent completed without calling StructuredOutput (after 2 in-conversation nudges)" — the work (edits + commit) often DID happen; only the final structured emit failed. Happened 3×.

**Why:** both are harness/context behaviors, not bad task design. The pull-main reflex is load-bearing memory; the StructuredOutput failure is a known heavy-session emit bug (related to [[feedback_thinking_block_400]] / [[feedback_workflow_journal_recovery]]).

**How to apply:** for heavy multi-file or self-modifying workflow edits, do NOT rely on a schema-forced Workflow agent or a context-loading Agent that touches git. Options, best first: (a) do the edits directly in the orchestrator and verify deterministically via `node --test` + `validate-workflows.mjs` (what finally worked); (b) use `isolation: 'worktree'` so an agent physically cannot wander to main; (c) if using the plain Agent tool, it has no forced StructuredOutput but still git-wanders — forbid all git branch ops AND verify via git state afterward. Always check git state after any agent run that could touch git. See also [[feedback_worktree_per_session]].
