---
name: continuous-agent-loop
description: >-
  Use when maintaining a persistent agent that watches and reacts over time
  (monitoring, polling, continuous integration). Not when running a one-shot
  task (use /autonomous-loops) or a bounded implementation (use /subagent-driven-development).
---

<!-- Source: ECC continuous-agent-loop -->

## Purpose

Run a persistent agent loop that watches for changes, reacts to events, and
maintains state across iterations — with compaction-aware checkpointing to
survive context window limits.

## Arguments

`/continuous-agent-loop {task-description}` — what to watch and react to.

Optional flags:
- `--interval {minutes}` — polling interval (default: 10, min: 1)
- `--max-duration {hours}` — total runtime limit (default: 2, max: 8)
- `--checkpoint-every {iterations}` — save state interval (default: 5)

## Steps

### 1. Define loop contract

Establish:
- **Watch condition:** What triggers a reaction (file change, API response, time)
- **Reaction:** What to do when triggered
- **State schema:** What to persist between iterations
- **Completion condition:** When to stop (or "run until stopped")

### 2. Initialize state

Create or load checkpoint from `.iago/state/loop-{slug}.json`:

```json
{
  "started_at": "{ISO-8601}",
  "iteration": 0,
  "state": {},
  "last_checkpoint": null,
  "events_processed": 0
}
```

### 3. Execute loop

```
while not (max_duration exceeded or completion condition met):
  1. Wait for interval
  2. Check watch condition
  3. If triggered: execute reaction
  4. Update state
  5. If checkpoint interval: save to loop-{slug}.json
  6. Check context usage — if >80%, compact and checkpoint
```

### 4. Compaction-aware checkpointing

When context approaches limits:
1. Save full state to checkpoint file
2. Summarize recent iterations into a compact log
3. Clear iteration details from context
4. Continue with checkpoint as the new baseline

This allows the loop to run beyond a single context window.

### 5. Report on exit

```markdown
## Continuous Loop Report: {task}

- **Duration:** {hours}:{minutes}
- **Iterations:** {count}
- **Events processed:** {count}
- **Exit reason:** {completed | timeout | stopped | error}
- **Final state:** {summary}

### Event Log (last 10)
| Time | Event | Action | Result |
|------|-------|--------|--------|
```

## Output

1. Exit reason and duration
2. Events processed count
3. Final state summary
4. Checkpoint file path (for potential resume)

## Examples

**Watch for build failures:**
```
/continuous-agent-loop Monitor CI pipeline, auto-fix lint errors on failure --interval 5
```

**Poll external API:**
```
/continuous-agent-loop Check deployment status every 2 minutes, report when complete --interval 2 --max-duration 1
```

## Boundaries

- Max duration: 8 hours — for longer monitoring, use external tools (n8n, cron)
- Checkpoint files are in `.iago/state/` — cleaned up manually
- Does not dispatch external agents — reacts inline
- Does not modify critical infrastructure without confirmation
- If reaction fails 3 consecutive times, pause and alert user
- Context compaction is automatic — do not disable
