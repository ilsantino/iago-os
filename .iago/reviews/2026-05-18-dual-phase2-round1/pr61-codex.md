> Note: PowerShell command-trace prefix from codex-companion stripped at archive time. Verdict and findings below are verbatim from the run.

# Codex Adversarial Review

Target: branch diff against a63b2bb84240cd0c9602fcc865a252189e5a2683
Verdict: needs-attention

No-ship: the scheduler is not safely wireable to the current daemon and has correctness holes that can either suppress scheduled work or defeat overlap limits.

Findings:
- [high] CronScheduler cannot be constructed with the real AgentManager (runtime/daemon/cron-scheduler.ts:343)
  The scheduler defines its dependency as an EventEmitter and unconditionally calls agentManager.on("task-resolved", ...). The current AgentManager is just `export class AgentManager` and does not extend or implement EventEmitter, so the README wiring (`new CronScheduler({ agentManager })`) will either fail TypeScript or throw at runtime. The tests only pass a bare EventEmitter, so they do not exercise the production integration path.
  Recommendation: Either make AgentManager expose the required EventEmitter API as part of this change, or inject a dedicated task lifecycle emitter/callback interface and add a compile/runtime integration test that constructs CronScheduler with the real AgentManager.
- [high] Schedule validation skips malformed fields until the matching minute (runtime/daemon/cron-scheduler.ts:204-210)
  registerCron claims to eagerly validate schedules, but it calls matchesCron(opts.schedule, this.nowFn()). matchesCron short-circuits after the first non-matching field, so later fields are not parsed. For example, if the daemon starts at any minute other than 28, `28 99 * * *` registers successfully; when minute 28 arrives, the hour parse throws, the tick logs and skips, and the cron never fires. This hides deploy-time misconfiguration until runtime and can silently suppress scheduled work.
  Recommendation: Separate parsing/validation from matching: parse all five fields unconditionally at registration, store a compiled schedule, and have matching consume the compiled representation without reparsing.
- [medium] Unrelated task completions can reopen cron concurrency slots (runtime/daemon/cron-scheduler.ts:332-341)
  The task-resolved listener decrements runningCount solely by event.agentId and ignores the event filename. If the same agent resolves a manual or non-cron task while a cron-launched task is still running, this listener lowers the cron running count and allows the next matching tick to fire even with maxConcurrent already reached. That defeats the overlap prevention for agents that process mixed task sources.
  Recommendation: Track the specific cron task filenames emitted by fire(), decrement only when the resolved filename matches an outstanding cron task for that entry, and decide how other terminal outcomes such as poison/unrouted release the slot.

Next steps:
- Fix the AgentManager integration contract before wiring this into daemon boot.
- Replace validation-via-matching with an unconditional parser/compiled schedule.
- Key cron concurrency accounting to emitted task filenames rather than only agentId.
