---
name: santa-method
description: >-
  Use when decomposing a complex, ambiguous problem into structured sub-problems
  before exploring solutions. Not when requirements are already clear (use
  /writing-plans) or when exploring solutions (use /brainstorming).
---

<!-- Source: ECC santa-method -->

## Purpose

Decompose a complex, ambiguous problem into structured sub-problems using the
SANTA method — making the problem tractable before jumping to solutions. This
is the pre-brainstorming step for especially messy problems.

## Arguments

`/santa-method {problem-description}` — the ambiguous problem to decompose.

## Steps

### 1. **S**ituation — Define what's actually happening

Document the current state without judgment:
- What exists today? (systems, processes, constraints)
- What's working? (don't throw away what's good)
- What evidence do we have? (data, user feedback, incidents)

### 2. **A**ctors — Identify who's involved

Map all stakeholders:
- Who is affected by this problem?
- Who has decision-making power?
- Who has context that we don't?
- What are their competing priorities?

### 3. **N**eeds — Extract the real requirements

For each actor, identify:
- What do they actually need? (not what they asked for)
- What are the hard constraints? (compliance, timeline, budget)
- What's negotiable? (scope, timeline, approach)

Separate needs from wants. Prioritize: must-have → should-have → nice-to-have.

### 4. **T**ensions — Surface the conflicts

Identify where needs contradict:
- Speed vs. quality
- Cost vs. features
- Security vs. usability
- Short-term vs. long-term

For each tension, determine:
- Can it be resolved? (both needs satisfied)
- Must it be traded off? (one wins, one loses)
- Can it be sequenced? (one now, one later)

### 5. **A**ctions — Define the sub-problems

Break the original problem into 2-5 concrete sub-problems:

```markdown
## Sub-Problems

### SP1: {name}
- **Scope:** {what this sub-problem covers}
- **Depends on:** {other sub-problems or external factors}
- **Resolved when:** {measurable condition}

### SP2: {name}
...
```

Each sub-problem should be:
- Small enough to brainstorm in one session
- Independent enough to solve without solving everything else first
- Concrete enough to have a verifiable "done" condition

### 6. Save analysis

Write to `docs/analysis/{slug}-santa.md`:

```markdown
# SANTA Analysis: {Problem}

## Situation
{Current state}

## Actors
{Stakeholder map}

## Needs
| Actor | Must-Have | Should-Have | Nice-to-Have |
|-------|-----------|-------------|-------------|

## Tensions
| Tension | Resolution Strategy |
|---------|-------------------|

## Sub-Problems
{SP1..SP-N with scope, deps, and done conditions}

## Recommended Order
{Which sub-problem to tackle first and why}
```

## Output

1. Analysis file path
2. Sub-problem count
3. Key tensions identified
4. Recommended starting point
5. Suggest: "Run `/brainstorming {SP1}` to explore the first sub-problem."

## Examples

**Ambiguous client request:**
```
/santa-method Client wants to "modernize their platform" but hasn't defined what that means
```

**Competing priorities:**
```
/santa-method Need to ship auth system in 2 weeks but security team wants a full audit first
```

## Boundaries

- Analysis only — does not propose solutions (that's `/brainstorming`)
- Does not write code or create plans
- Does not dispatch agents — orchestrator facilitates inline
- If the problem isn't actually ambiguous, redirect to `/brainstorming` directly
- Max 5 sub-problems — if more emerge, group them
