> Note: PowerShell command-trace prefix from codex-companion stripped at archive time. Verdict and findings below are verbatim from the run.

# Codex Adversarial Review

Target: branch diff against 20c8348
Verdict: needs-attention

No ship: the polling loop can mark real work as complete without executing it, and one documented terminal path still leaks cron concurrency.

Findings:
- [critical] Pending tasks are resolved without being delivered to the agent (runtime/daemon/agent-manager.ts:1608-1613)
  For a registered agent, `processPendingTask` only extracts `agentId` and calls `claimTask`; `claimTask` then renames the pending JSON directly into `tasks/resolved/` and emits `task-resolved`. There is no validation or use of the task `prompt`, no `runtime.send(...)`, no transition through the existing claimed-task protocol, and no resolved output envelope. A cron task can therefore release `maxConcurrent` and look terminal while the agent never receives the work.
  Recommendation: Change the registered-agent path to actually dispatch the task to the resolved handle/runtime, or integrate with the existing file-bus `pending -> claimed -> resolved output` lifecycle. Emit `task-resolved` only after the task has genuinely reached a terminal state.
- [high] Poisoned cron tasks do not release their cron concurrency slot (runtime/daemon/agent-manager.ts:1641-1649)
  `poisonTask` emits `task-poisoned` with `agentId: "(unknown)"`. `CronScheduler` decrements only when the terminal event's `agentId` maps to an outstanding filename, so a malformed or missing-agent-id cron file is moved to `tasks/poisoned/` but the scheduler keeps `runningCount` elevated. With `maxConcurrent: 1`, that cron becomes permanently overlap-prevented after one corrupted task.
  Recommendation: Derive the owning agent for poisoned files from the filename/outstanding cron metadata, or include enough scheduler-owned task metadata in the file to emit `task-poisoned` with the original cron `agentId`. Add an AgentManager/CronScheduler integration test for malformed cron JSON releasing `runningCount`.

Next steps:
- Fix task dispatch semantics before using this loop in production.
- Add failure-path tests covering malformed cron task files against CronScheduler runningCount.
