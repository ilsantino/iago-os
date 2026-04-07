---
name: iago-schedule
description: >-
  Use when setting up automated triggers for a project — nightly reviews, usage
  digests, build health monitors. Not when running one-off commands (just run them)
  or when designing n8n workflows (use /iago:n8n).
---

## Purpose

Install trigger templates or create custom scheduled automations using Claude Code's trigger system. Bridges `/schedule` (built-in, session-scoped) with RemoteTrigger (persistent, survives session end).

---

## Arguments

- `/iago:schedule {template-name}` — install from template library
- `/iago:schedule list` — show active triggers
- `/iago:schedule create "{cron}" "{prompt}"` — create a custom trigger
- `/iago:schedule remove {trigger-id}` — remove a trigger

**Available template names:** `nightly-review`, `usage-digest`, `stale-handoff`, `dependency-audit`, `learnings-promotion`, `build-health`

---

## Steps

### `list`

Call RemoteTrigger list action. Display results as a table: trigger ID, schedule, first 60 chars of prompt, status.

If RemoteTrigger auth fails, fall back to listing session cron jobs via `/schedule` built-in.

### `{template-name}`

1. Read `docs/automations/trigger-templates.md` — find the matching template by name
2. Resolve `$PROJECT_DIR` to the current working directory (absolute path)
3. Adapt any relative paths in the prompt to absolute paths for the project
4. Call RemoteTrigger create with the template's cron expression, prompt, and resolved project directory
5. If RemoteTrigger auth fails, fall back to `/schedule` built-in (CronCreate with `durable: true`) and warn about 7-day session expiry
6. Report the trigger ID and confirm the schedule

### `create "{cron}" "{prompt}"`

1. Validate the cron expression format (5 fields: minute hour day month weekday)
2. Call RemoteTrigger create with the provided cron, prompt, and current working directory as `project_directory`
3. If RemoteTrigger auth fails, fall back to `/schedule` with `durable: true` and warn about 7-day auto-expiry
4. Report the created trigger ID

### `remove {trigger-id}`

Call RemoteTrigger delete with the trigger ID. For session cron jobs, call CronDelete instead.

Confirm deletion. If the ID is not found, list active triggers to help the user identify the correct ID.

---

## Boundaries

- Does **not** design automation workflows (that is `/iago:n8n`)
- Does **not** execute prompts directly (triggers execute on schedule, not immediately)
- Does **not** manage n8n, Lambda, or EventBridge schedules — this skill is Claude Code trigger system only

---

## Warnings

- **7-day expiry:** Session cron jobs (built-in `/schedule`) auto-expire after 7 days. Warn the user when falling back to session cron and recommend RemoteTrigger for persistent automations
- **RemoteTrigger auth:** If the user has not authenticated RemoteTrigger, direct them to run `/schedule` setup or authenticate via Claude Code settings before retrying
- **Project directory:** Always use absolute paths for `project_directory`. Relative paths will fail when the trigger fires in a new session

---

## RemoteTrigger API Reference

**Create:**
```json
{
  "schedule": "{cron expression}",
  "prompt": "{prompt text}",
  "project_directory": "/absolute/path/to/project"
}
```

**List:** RemoteTrigger list action — returns array of active triggers with IDs, schedules, and status.

**Delete:** RemoteTrigger delete action with `trigger_id` — removes the trigger permanently.

**CronCreate fallback (session cron):**
```json
{
  "schedule": "{cron expression}",
  "prompt": "{prompt text}",
  "durable": true
}
```
