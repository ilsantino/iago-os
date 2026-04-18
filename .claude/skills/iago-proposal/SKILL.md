---
name: iago-proposal
description: >-
  Use when generating a client proposal (scope, timeline, cost, tech approach).
  Not when the project is already initiated (use /iago-plan for phase planning)
  or when writing internal documentation.
---

## Purpose

Generate a structured client proposal document covering scope, timeline, cost
estimate, technical approach, and deliverables. Dispatches the `content`
profile for prose quality.

## Arguments

`/iago-proposal {client-name}` — the client or project this proposal targets.

Optional flags:
- `--type {poc|mvp|production}` — engagement type (default: `mvp`)
- `--budget {range}` — budget constraint (e.g., `20k-50k`)
- `--timeline {weeks}` — target timeline in weeks

## Preconditions

- User must provide enough context to scope the project (at minimum: what we're
  building, who it's for, and rough constraints). If insufficient, ask 2-3
  clarifying questions before proceeding.

## Steps

### 1. Gather requirements

If not already provided, ask:
1. What problem does this solve for the client?
2. What are the must-have features for the first delivery?
3. Are there compliance requirements (HIPAA, SOC2, GDPR)?
4. Does the client have existing infrastructure or is this greenfield?

### 2. Draft proposal structure

Build the proposal skeleton:

```markdown
# Proposal: {Project Name}
**Client:** {name}
**Date:** {today}
**Prepared by:** iaGO

## Executive Summary
{2-3 sentences: problem, solution, value prop}

## Scope
### In Scope
{Bulleted list of deliverables}
### Out of Scope
{Explicit exclusions to prevent scope creep}

## Technical Approach
**Stack:** React 19 + Vite + TypeScript + TailwindCSS 4 + ShadCN/UI
**Infrastructure:** AWS Amplify Gen 2 + Lambda + API Gateway + DynamoDB + Cognito
{Architecture overview tailored to this project}

## Phases & Timeline
| Phase | Description | Duration | Deliverable |
|-------|-------------|----------|-------------|
{2-5 phases with concrete deliverables per phase}

## Cost Estimate
| Phase | Effort | Cost |
|-------|--------|------|
{Per-phase breakdown}
**Total:** {range}

## Assumptions & Risks
{Numbered list}

## Next Steps
{Clear call to action}
```

### 3. Dispatch content profile

Dispatch `content` profile with:
- The proposal skeleton
- Client context and requirements
- Engagement type and constraints
- Instruction: professional tone, concise, no filler, quantify where possible

### 4. Review output

Review the content profile's output for:
- Technical accuracy (stack references match CLAUDE.md)
- Realistic timeline estimates
- Cost alignment with budget constraints
- No placeholder text or TBD items

### 5. Write proposal

Save to `docs/proposals/{client-slug}-{YYMMDD}.md`.
Create `docs/proposals/` directory if it doesn't exist.

### 6. Update STATE.md

Log to Recent Decisions:
- Date: today
- Decision: "Proposal generated for {client-name} ({engagement-type})"
- Phase: pre-engagement

## Output

Display:
1. Proposal file path
2. Scope summary (in-scope count, out-of-scope count)
3. Timeline summary (total weeks, phase count)
4. Cost range
5. Suggest: "Review and customize before sending. Run `/iago-scaffold` to start the project."

## Boundaries

- Does not create project directories or initialize `.iago/` — that's `/iago-scaffold` + `/iago-init`
- Does not commit proposals to git automatically — user decides when to commit
- Does not send proposals to clients — local document only
- Cost estimates are rough order-of-magnitude — always label as estimates
- If content profile returns BLOCKED, write the proposal inline without agent dispatch
