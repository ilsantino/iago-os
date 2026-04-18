---
name: iago-pause
description: >-
  Use when pausing work mid-session to resume later (switching context, ending day,
  hitting a blocker). Not when work is complete (use /iago-verify instead) or when
  no .iago/ directory exists.
---

## Purpose

Capture the current workflow position, progress, and next action into a structured
HANDOFF.json file so the next session can resume without re-discovery.

## Preconditions

- `.iago/` directory must exist. If not, there's nothing to pause.

## Steps

### 1. Gather current state

Read from the working environment:
- `.iago/STATE.md` — current phase and status
- `.iago/config.json` — project name and client
- `git branch --show-current` — active branch
- `git status --short` — uncommitted files
- `.iago/plans/` — identify current plan and task position
- `.iago/summaries/` — identify completed plans

### 2. Build HANDOFF.json

Construct the handoff object:

```json
{
  "paused_at": "{ISO-8601 timestamp}",
  "session_id": "{unique-id}",
  "client": "{client-slug}",
  "project": "{project-name}",
  "git_branch": "{current-branch}",
  "workflow_position": {
    "phase": "{NN-slug}",
    "plan": "{NN-slug-PP}",
    "task": "{current-task-number}"
  },
  "current_task": "{Task N: description}",
  "completed_tasks": [
    { "task": 1, "description": "{name}", "commit": "{hash}" }
  ],
  "remaining_tasks": [
    { "task": 3, "description": "{name}" }
  ],
  "blockers": [],
  "key_decisions": ["{decision-1}", "{decision-2}"],
  "uncommitted_files": ["{path}"],
  "next_action": "{Concrete next step — what to do first on resume}"
}
```

Rules:
- `workflow_position` is `null` for ad-hoc/quick work outside the full workflow
- `next_action` must be concrete and actionable, not "continue working"
- `key_decisions` captures decisions made this session that aren't in STATE.md yet
- `uncommitted_files` from `git status` — warns the next session about WIP

### 3. Write HANDOFF.json

Write to `.iago/state/HANDOFF.json`.

### 4. Update STATE.md

If currently in a workflow phase, update the status line to reflect paused state.
Log a decision: "Session paused — {reason if given}".

## Output

Display:
1. Workflow position (phase / plan / task)
2. Completed vs remaining task count
3. Next action summary
4. Any blockers
5. Remind: "Resume is automatic — HANDOFF.json will be loaded on next session start."

## Resume Behavior

Resume is NOT a separate skill. The `SessionStart` hook:
1. Detects `.iago/state/HANDOFF.json`
2. Injects its contents via `hookSpecificOutput`
3. Deletes the file after loading

If HANDOFF.json is >7 days old, the SessionStart hook logs an informational warning
that context may be stale.

## Boundaries

- Only writes to `.iago/state/HANDOFF.json` and updates STATE.md
- Does not commit code — if there are uncommitted changes, they stay uncommitted
- Does not modify plans, summaries, or context artifacts
- Does not trigger any agents
- Does not advance or revert workflow state — just snapshots it
