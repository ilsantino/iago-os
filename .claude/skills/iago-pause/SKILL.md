---
name: iago-pause
description: >-
  Use when pausing work mid-session to resume later (switching context, ending day,
  hitting a blocker). Not when work is complete (use /iago-verify instead) or when
  no .iago/ directory exists.
---

## Purpose

Capture the current workflow position, progress, and next action into a structured
handoff file so the next session can resume without re-discovery. Each pause writes
its own timestamped, slugged file — handoffs never overwrite each other.

## Preconditions

- `.iago/` directory must exist. If not, there's nothing to pause.
- Resolve the `.iago/` location by walking up from the current working directory to
  find the nearest ancestor containing `.iago/state/`. This prevents nested-path
  bugs when the orchestrator's cwd is inside a client subdir.

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

### 3. Write the handoff file

Write to `.iago/state/HANDOFF-{YYYYMMDD-HHMM}-{slug}.json`.

- `{YYYYMMDD-HHMM}` — current local date+time, e.g. `20260420-1530`. Provides
  chronological sort and human-readable recency.
- `{slug}` — content hint derived from current git branch
  (`git branch --show-current`), sanitized:
  - lowercase
  - non-alphanumerics collapsed to single hyphens
  - leading/trailing hyphens stripped
  - max 40 chars (truncate, then strip trailing hyphen)
  - if the branch is empty, detached HEAD, or all stripped away, use `adhoc`

Example: branch `feat/bug-bounty-promotion` paused at 2026-04-20 15:30 →
`HANDOFF-20260420-1530-feat-bug-bounty-promotion.json`.

Never overwrite an existing handoff file. If the exact filename already exists
(same minute, same slug — rare), append `-2`, `-3`, ... until unique.

### 4. Update STATE.md

If currently in a workflow phase, update the status line to reflect paused state.
Log a decision: "Session paused — {reason if given}".

## Output

Display:
1. Handoff filename written (so the user can find/inspect it)
2. Workflow position (phase / plan / task)
3. Completed vs remaining task count
4. Next action summary
5. Any blockers
6. Remind: "Resume is automatic — the most recent handoff will be loaded on next session start."

## Resume Behavior

Resume is NOT a separate skill. The `SessionStart` hook:
1. Globs `.iago/state/HANDOFF-*.json`
2. Picks the most recent by file mtime
3. Injects its contents via `hookSpecificOutput`
4. Moves the file to `.iago/state/handoffs/archive/` (preserves history; no overwrites)

Older handoffs in `.iago/state/` are ignored on the next resume — only the latest
loads. They sit alongside until the next pause; archive them manually if cluttered.

If the loaded handoff is >7 days old, the SessionStart hook logs an informational
warning that context may be stale.

## Boundaries

- Only writes to `.iago/state/HANDOFF-*.json` and updates STATE.md
- Does not commit code — if there are uncommitted changes, they stay uncommitted
- Does not modify plans, summaries, or context artifacts
- Does not trigger any agents
- Does not advance or revert workflow state — just snapshots it
- Does not delete or archive prior handoff files — that's the SessionStart hook's job
