---
name: iago-init
description: >-
  Use when starting a new client project or bootstrapping .iago/ for an existing codebase.
  Not when .iago/PROJECT.md already exists (blocks to prevent overwrite).
---

## Purpose

Bootstrap the `.iago/` directory, gather project vision and requirements through
interactive discovery, and produce the four foundation artifacts: PROJECT.md,
ROADMAP.md, STATE.md, and config.json.

## Preconditions

- `.iago/PROJECT.md` must NOT exist. If it does, STOP and inform the user:
  "Project already initialized. Use /iago:discuss to clarify a phase."

## Steps

### 1. Scaffold directories

Call the state engine `init()` function from `.iago/hooks/lib/state-manager.mjs`.
This creates all `.iago/` subdirectories and default files. Skip any that already exist.
Directories created include: `plans/`, `context/`, `summaries/`, `reviews/`, `state/`, `learnings/`.

### 1b. Seed learnings directory

Create `.iago/learnings/` if it doesn't exist (the `init()` call above should handle this).

Create `.iago/learnings/patterns.md` with the review patterns table header (no rows — patterns
accumulate during execution):

```
| # | Pattern | Occurrences | Last Seen | Source |
|---|---------|-------------|-----------|--------|
```

Create `.iago/learnings/project-conventions.md` with a starter template:

```
## Project Conventions

Project-specific conventions that are NOT already covered by CLAUDE.md.
Add entries here as they emerge during execution (code review findings,
team preferences, client constraints, etc.).

<!-- Examples: date format (ISO 8601), API versioning strategy, naming rules -->
```

If the user mentioned any conventions during the discovery questions (step 2) — date formats,
API patterns, language preferences, naming rules — capture them as initial entries here.

### 2. Gather project vision (interactive)

Ask the user 3-5 discovery questions. Adapt based on answers — skip what's obvious,
probe what's vague:

1. **What are we building?** — one-sentence vision
2. **Who is the client?** — name, engagement type (PoC, MVP, production, internal)
3. **What are the constraints?** — timeline, budget, compliance (HIPAA/SOC2/GDPR/none)
4. **Does the stack deviate from the default?** — React 19 + Vite + TS + Tailwind + ShadCN + AWS
5. **What are the first 2-5 phases?** — high-level breakdown of the work

If working on an existing codebase, optionally dispatch the `research` agent to
scan the repo structure and infer context before asking questions.

### 3. Write config.json

Update `.iago/config.json` using the state engine `getConfig()` defaults, overriding:
- `project.name` — from user's answer
- `project.client` — from user's answer
- `project.type` — inferred from engagement type

### 4. Write PROJECT.md

Populate `.iago/PROJECT.md` using the template from §11 of the workflow spec:
- Vision, Client, Constraints, Stack table
- Architecture Decisions table (empty — filled during later phases)

### 5. Write ROADMAP.md

Populate `.iago/ROADMAP.md`:
- One row per phase from the user's breakdown
- Columns: #, Phase (slug), Goal, Success Criteria, Status, Started, Completed
- All phases start as `pending`
- Add phase dependencies section

### 6. Write STATE.md

Populate `.iago/STATE.md`:
- Phase: `01-{first-phase-slug}` | Status: `idle`
- Empty tables for Recent Decisions, Blockers, Quick Tasks
- Must be under 80 lines

The `.iago/learnings/` directory accumulates review patterns during execution
(via review profiles) and feeds them back into future agent dispatches.

### 7. Write active-client.json

Write `.iago/state/active-client.json`:
```json
{ "client": "{client-slug}", "project": "{project-name}" }
```
This feeds the statusline hook and cost tracking.

### 8. Update STATE.md

Log initialization as a decision:
- Date: today
- Decision: "Project initialized with {N} phases"
- Phase: 00-init

## Output

After completion, display:
1. Summary of what was created
2. Phase list from ROADMAP.md
3. Suggest: "Run `/iago:discuss {first-phase-slug}` to clarify the first phase."

## Boundaries

- Never modify files outside `.iago/`
- Never overwrite an existing PROJECT.md — this is a one-time bootstrap
- If the user provides partial answers, use sensible defaults and note assumptions
- Do not start planning or implementation — init only produces foundation artifacts
