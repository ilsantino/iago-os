---
name: feedback_pipeline_hang_malformed_command
description: execute-pipeline can hang forever on a malformed shell command; withRetry catches throws not hangs; how to detect + recover
metadata: 
  node_type: memory
  type: feedback
  originSessionId: bdcc3b6f-c4dc-4131-a8e9-1d40f107f582
---

The execute-pipeline Workflow can hang indefinitely when a stage agent emits a malformed shell command (observed: an unterminated `echo "` — bash blocks on stdin waiting for the closing quote). `withRetry` re-runs THROWN errors but NOT a blocked/hung shell, so the run stalls silently with no `<task-notification>`.

**Why:** no per-command timeout on stage agents' Bash calls; a blocked shell = unbounded stall (seen at round-2 build-verify, frozen 28 min).

**How to apply:**
- **Detect:** the workflow transcript dir AND the worktree commits are frozen for >10 min with no completion notification. The stuck agent's transcript ends on a `tool_use` Bash whose `command` has an unterminated quote/heredoc.
- **Recover:** `TaskStop` the run → verify the committed state is green yourself (run the plan's verify cmds with a `timeout`, e.g. `timeout 30 node ...`). If the impl + fix commits already exist and tests pass, finish push + PR + tag MANUALLY rather than re-running the whole ~25-min pipeline. Do NOT re-run the hung stage blind.
- **Fix-forward:** add a per-command timeout to build-verify (and all agent shell commands).

Related: [[feedback_workflow_journal_recovery]] [[feedback_thinking_block_400]] [[feedback_worktree_per_session]].
