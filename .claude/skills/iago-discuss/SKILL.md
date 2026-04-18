---
name: iago-discuss
description: >-
  Use when clarifying gray areas for a specific ROADMAP phase before planning.
  Not when PROJECT.md doesn't exist (run /iago-init first) or when planning has already started for the phase.
---

## Purpose

Clarify implementation details and surface decisions for a specific phase from
ROADMAP.md. The user is the visionary; Claude is the builder. The output is a
context artifact that feeds into `/iago-plan`.

## Preconditions

- `.iago/PROJECT.md` must exist. If not, STOP: "Run `/iago-init` first."
- `.iago/ROADMAP.md` must exist and contain the target phase.
- If `.iago/context/{NN}-{slug}.md` already exists for this phase, warn the user
  and ask whether to append or replace.

## Arguments

`/iago-discuss {phase-slug}`

If no phase-slug is provided, read ROADMAP.md and suggest the next `pending` phase.

## Steps

### 1. Load context

Read these files to understand the project and avoid re-asking settled questions:
- `.iago/PROJECT.md` — vision, constraints, stack
- `.iago/ROADMAP.md` — phase goals and success criteria
- `.iago/STATE.md` — current position, recent decisions, blockers
- Any existing `.iago/context/*.md` files — prior phase discussions

### 2. Surface gray areas (interactive)

Present 3-5 decisions the user must make for this phase. Focus on:

- **Domain specifics** — what does this feature actually do?
- **Data model** — what entities, what access patterns?
- **API design** — what endpoints, what auth model?
- **UI behavior** — what does the user see, what interactions?
- **Edge cases** — what happens when things go wrong?

Scope is FIXED from ROADMAP.md. Discuss clarifies HOW, never adds capabilities.
If the user proposes new scope, log it under Deferred in the context artifact.

### 3. Capture decisions

For each decision surfaced, record:
- The question
- The decision (user's verdict)
- The reasoning (why this choice)

### 4. Capture references

Note any files, APIs, docs, or external resources referenced during discussion.

### 5. Write context artifact

Write `.iago/context/{NN}-{slug}.md` using this format:

```markdown
---
phase: {NN}-{slug}
discussed: {YYYY-MM-DD}
---

# Context: {NN}-{slug} — {phase name}

## Domain

{Domain-specific background. What does this phase deal with?}

## Decisions

| # | Question | Decision | Reasoning |
|---|----------|----------|-----------|

## References

{Key files, APIs, docs referenced during discussion.}

## Specifics

{Implementation details clarified. Concrete answers to gray areas.}

## Deferred

{Ideas explicitly NOT in scope for this phase.}
```

### 6. Update STATE.md

Update via state engine:
- Phase: `{NN}-{slug}` | Status: `discussing`
- Log decision count as a decision entry

## Output

After completion, display:
1. Summary of decisions made
2. Any deferred items
3. Suggest: "Run `/iago-plan {phase-slug}` to create implementation plans."

## Boundaries

- No agent dispatch — discuss is orchestrator-direct, human-interactive only
- Never modify ROADMAP.md scope — discuss clarifies, it doesn't expand
- Never start implementation or create plan files
- If the user's answers reveal the phase is too large, recommend splitting it
  in ROADMAP.md before proceeding to plan
