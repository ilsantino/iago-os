# CronScheduler

## 1. Purpose

`CronScheduler` is a 60s-tick scheduler that fires registered cron entries into the file-bus `tasks/pending/` directory. Each tick: match the registered schedules against the current UTC time, run an optional bash wake-check, then atomically emit a task file the agent-manager polling loop will pick up. It exists so Phase 2+ agents can declare cron-driven dispatch (e.g., `pr-triage` daily at 14:00 UTC) without depending on host cron or a third-party `node-cron` package — Phase 2 dep-bloat constraint forbids adding a parser dep for ~80 LOC of logic.

The decrement side of the overlap-prevention counter is split across Plan 07a (this file — subscribes to `task-resolved`) and Plan 07b (extends `AgentManager` to emit `task-resolved` when a task moves from `pending/` to `resolved/`). Until 07b ships, the subscription is a defensive no-op and `maxConcurrent > 1` is the safe registration default for any consumer wiring CronScheduler ahead of 07b.

## 2. Public API

```ts
class CronScheduler {
  constructor(opts: {
    agentManager: CronAgentManager;   // EventEmitter; subscribes to 'task-resolved'
    stateRoot?: string;               // overrides pathFor('tasks/pending'); test-only in practice
    logger?: Logger;
    nowFn?: () => Date;               // @internal — test override only
  });

  registerCron(opts: {
    agentId: string;                  // validated via assertSafeIdentifier
    schedule: string;                 // 5-field POSIX cron expression; eagerly parsed
    wakeCheck?: string;               // path to a bash script run via spawnSync
    promptTemplatePath: string;       // read on each fire; missing → cron-fired-prompt-missing
    outputTaskNamePrefix: string;     // task filename = <prefix>__<unix>.json
    maxConcurrent?: number;           // default 1 (Codex P1-8 fix carrier)
  }): void;

  start(): void;                      // idempotent; second call is no-op
  stop(): Promise<void>;              // clears interval AND awaits any in-flight tick
}

// @internal — exported for test access only.
function matchesCron(expr: string, now: Date): boolean;
```

`registerCron` validates eagerly: a bad `agentId` (path separators, NUL bytes, > 200 chars) throws `TypeError`; a malformed `schedule` throws `RangeError` with the offending field named. `start()` after `stop()` throws — instances are single-use.

## 3. Cron expression syntax

5-field POSIX format: `minute hour day-of-month month day-of-week`. Non-standard second and year fields are NOT supported.

| Token | Example | Notes |
|-------|---------|-------|
| `*` | `* * * * *` | Any value in range |
| Integer literal | `0 14 * * *` | 14:00 UTC daily |
| Range | `1-5` | Inclusive; `lo` must be ≤ `hi` |
| Step | `*/15`, `1-30/5` | Stride within range or `*` |
| Comma list | `1,3,5` | Union of values |

Time is interpreted as **UTC**. The pr-triage convention is `0 14 * * *` → 14:00 UTC.

**POSIX day-OR-weekday semantics (C1 from stress test).** When BOTH `day-of-month` AND `day-of-week` are non-wildcard, the match is `dayOfMonth OR dayOfWeek` — not AND. Example: `0 0 1-7 * 1` matches the 1st-7th of every month OR every Monday. This is the POSIX standard and what `cron(8)` does on Linux. If you need "first Monday of the month only," register `0 0 1-7 * *` and add a `wakeCheck` that exits 1 when `date +%u` is not 1.

**Drift tolerance.** `setInterval` is best-effort; long ticks can shift the next fire by sub-seconds. Because the scheduler matches by minute, up to ~59s of cumulative drift is fine — a tick that fires at 13:59:58 vs 14:00:02 both produce the same UTC-minute match against `0 14 * * *`.

## 4. Lifecycle

1. **Instantiate** with an `agentManager` (any `EventEmitter`-compatible object). The constructor subscribes to `'task-resolved'` immediately — defensive listener that no-ops on malformed payloads.
2. **`registerCron(...)`** per agent. Validation is eager: malformed schedules and unsafe identifiers fail here, not at the first tick.
3. **`start()`** opens the 60s interval. The interval handle is `unref`'d so a forgotten `stop()` in tests does not pin the Node event loop.
4. **On each tick**: iterate registered crons; for each match, check `runningCount[agentId] >= maxConcurrent` (skip + emit `cron-overlap-prevented`); else run `wakeCheck` if defined; else read the prompt template and write the task file via tmp → rename.
5. **`stop()`** clears the interval and awaits any in-flight tick. After `await stop()` returns, no more `cron-fired` events will surface. The `'task-resolved'` listener is removed so the instance can be GC'd.

The `task-resolved` decrement chain closes the overlap loop. Plan 07b extends `AgentManager` to emit `{ agentId, filename }` when a task moves from `pending/` to `resolved/`; the listener here decrements `runningCount[agentId]` (clamped at 0). Until 07b ships, increments accumulate and `maxConcurrent` permanently blocks after the Nth fire — register with high `maxConcurrent` if wiring early.

## 5. Telemetry kinds emitted

All events flow through `runtime/daemon/telemetry.ts` (`emit(event)`) and land in `pathFor('telemetry')/<yyyy-mm-dd>.ndjson`. The 5 cron-specific kinds:

| Kind | Extras | When |
|------|--------|------|
| `cron-fired` | `agentId, schedule, taskFile, runningCount` | Task file successfully written; `runningCount` is post-increment |
| `cron-skipped` | `agentId, schedule, reason, exitCode` | `reason ∈ 'wake-check-failed' \| 'wake-check-timeout'`; `exitCode` is `null` for the SIGKILL timeout branch |
| `cron-overlap-prevented` | `agentId, schedule, runningCount, maxConcurrent` | `runningCount >= maxConcurrent` at tick time; spawn skipped |
| `cron-fired-prompt-missing` | `agentId, schedule, promptTemplatePath, errno` | `fs.readFileSync(promptTemplatePath)` threw (ENOENT, EACCES, etc.); `runningCount` NOT incremented |
| `cron-fired-write-failed` | `agentId, schedule, taskFile, errno` | tmp-write or atomic-rename failed (ENOSPC, EBUSY, etc.); `runningCount` NOT incremented |

Plan 07b adds matching agent-manager kinds the cron loop is paired with: `task-resolved`, `task-poisoned`, `task-unrouted`, `polling-loop-error`. Cross-reference the README that ships with 07b for those payloads.

## 6. Failure modes

| Failure | Manifestation | Telemetry |
|---------|---------------|-----------|
| Wake-check script missing executable bit | `spawnSync` returns exit 126 | `cron-skipped { reason: 'wake-check-failed', exitCode: 126 }` |
| Wake-check exceeds 30s | `spawnSync` returns `signal: 'SIGKILL'`, `status: null` (C2 fix) | `cron-skipped { reason: 'wake-check-timeout', exitCode: null }` |
| `bash` not on PATH | `spawnSync` returns `error: { code: 'ENOENT' }` | `cron-skipped { reason: 'wake-check-failed', exitCode: null }` |
| Prompt template missing | `fs.readFileSync` throws ENOENT | `cron-fired-prompt-missing` — fire aborted |
| `tasks/pending/` not writable | tmp-write or rename throws | `cron-fired-write-failed` — fire aborted |
| Malformed cron expression at tick | `matchesCron` throws inside try/catch | Logged via `logger.error`; tick continues with next registered cron |
| Malformed `task-resolved` payload | Defensive listener short-circuits | None (silently ignored) |

The fire path is "fail-aborted, not fail-loud" by design: a single broken cron must not stop the tick loop or crash the daemon.

## 7. Wiring example

Plan 04b's daemon-boot wiring (matching `AgentManager.startPollingLoop` from 07b):

```ts
import { CronScheduler } from "./cron-scheduler.js";

const scheduler = new CronScheduler({ agentManager });

scheduler.registerCron({
  agentId: "pr-triage",
  schedule: "0 14 * * *",                      // 14:00 UTC daily
  wakeCheck: "/opt/iago/bin/pr-triage-gate.sh",
  promptTemplatePath: "/opt/iago/prompts/pr-triage.md",
  outputTaskNamePrefix: "pr-triage",
  maxConcurrent: 1,
});

scheduler.start();

process.on("SIGTERM", async () => {
  await scheduler.stop();
});
```

`maxConcurrent: 1` is the daily-cron default — second fire while the first is still in-flight emits `cron-overlap-prevented` and skips. Raise it for crons that legitimately fan out (e.g., per-customer batch fires triggered by the same minute). The eager `registerCron` parse will reject the schedule at boot if it is malformed, so deploy-time misconfiguration surfaces in the daemon-start log rather than at the first scheduled minute.
