---
name: brainstorming
description: >-
  Use when starting a new feature, design decision, or architecture choice.
  Not when modifying existing code with clear requirements (just implement it)
  or when a spec already exists (use /writing-plans instead).
---


## Purpose

Explore a problem space through Socratic questioning, surface constraints and
trade-offs, and produce a written spec in `docs/specs/` — with a concrete
delivery path of 4 weeks or less.

## Arguments

`/brainstorming {topic}` — what we're exploring.

## Steps

### 1. Frame the problem

Ask 3-5 Socratic questions to understand:
1. **Who benefits?** — end user, client, internal team
2. **What's the smallest useful version?** — PoC scope
3. **What exists already?** — search codebase before assuming greenfield
4. **What are the constraints?** — timeline, budget, compliance, stack boundaries
5. **What could go wrong?** — risks, dependencies, unknowns

Adapt questions based on answers — skip what's obvious, probe what's vague.

### 2. Product lens

For each proposed feature or capability, evaluate:
- **Value:** Does this solve a real problem or is it nice-to-have?
- **Effort:** Can this be built in ≤4 weeks with our stack?
- **Risk:** What's the blast radius if it fails?

Cut anything that doesn't pass all three. Be ruthless.

### 3. Explore options

Present 2-3 approaches with trade-offs:

| Approach | Pros | Cons | Effort |
|----------|------|------|--------|
| A: {name} | ... | ... | {days} |
| B: {name} | ... | ... | {days} |

Include a recommendation with reasoning. Don't hedge with "it depends" — pick one.

### 4. Write spec

Save to `docs/specs/{slug}.md`:

```markdown
# Spec: {Title}

## Problem
{1-2 sentences}

## Solution
{Chosen approach with justification}

## Scope
### In Scope
{Bulleted deliverables}
### Out of Scope
{Explicit exclusions}

## Technical Approach
{Stack-specific: React 19 components, DynamoDB access patterns, Lambda functions,
API Gateway endpoints, Cognito requirements}

## Delivery Path
{2-5 phases, each ≤1 week, with concrete deliverable per phase}

## Open Questions
{Anything unresolved — address before planning}
```

Create `docs/specs/` if it doesn't exist.

### 5. Handoff

Display the spec summary and suggest:
"Run `/writing-plans docs/specs/{slug}.md` to break this into implementation tasks."

## Output

1. Spec file path
2. Chosen approach (one sentence)
3. Delivery timeline (total weeks, phase count)
4. Open questions count (0 = ready to plan)

## Boundaries

- Does not produce implementation plans — that's `/writing-plans`
- Does not write code — exploration only
- Does not dispatch agents — orchestrator runs the conversation directly
- Specs must target our stack (React 19 + Vite + TS + Tailwind + ShadCN + AWS)
- 4-week max delivery path — if it can't fit, the scope is too big, split it
