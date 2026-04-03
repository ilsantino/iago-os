---
name: writing-plans
description: >-
  Use when you have an approved spec and need to plan implementation.
  Not when spec is still in discussion (use /brainstorming first) or when
  planning a ROADMAP phase (use /iago:plan instead).
---

<!-- Source: Superpowers writing-plans + GSD wave concept -->

## Purpose

Break an approved spec into small, verifiable implementation tasks (2-5 minutes
each) organized into parallel execution waves — ready for `/subagent-driven-development`.

## Arguments

`/writing-plans {spec-path}` — path to the spec file (e.g., `docs/specs/auth-flow.md`).

Optional flags:
- `--waves` — group tasks into dependency waves (default: sequential)

## Preconditions

- Spec file must exist at the given path. If not, redirect to `/brainstorming`.
- Spec must have no unresolved Open Questions. If it does, resolve them first.

## Steps

### 1. Read and analyze spec

Read the spec file. Identify:
- Components to build (React 19 functional components, ShadCN/UI primitives)
- API endpoints (API Gateway + Lambda handlers)
- Data layer (DynamoDB access patterns, single-table design)
- Auth requirements (Cognito flows)
- External integrations (SES, n8n, third-party APIs)

### 2. Break into tasks

Each task must have:
- **name:** Short imperative description
- **files:** Exact file paths (1-3 per task)
- **action:** Specific instruction, ≤3 sentences, no placeholders
- **verify:** Exact shell command to confirm completion
- **expected:** What the verify command produces when correct

Task sizing: if a task takes >5 minutes or touches >3 files, split it.

### 3. Assign waves (`--waves` flag or default)

Group tasks into execution waves:
- **Wave 1:** No dependencies — can run in parallel
- **Wave 2:** Depends on wave 1 outputs
- **Wave N:** Depends on wave N-1

Tasks within the same wave are independent and can be dispatched in parallel.
Without `--waves`, all tasks are sequential (wave 1).

### 4. Write plan

Save to `docs/plans/{spec-slug}-plan.md`:

```markdown
# Plan: {Title}

## Source
Spec: {spec-path}

## Wave 1

### Task 1: {name}
- **files:** `{path}`
- **action:** {instruction targeting our stack}
- **verify:** `{command}`
- **expected:** {output}

### Task 2: {name}
...

## Wave 2
(tasks that depend on Wave 1)

## Verification
{Aggregate verify command after all waves complete}
```

### 5. Self-review

Before finalizing, check:
- [ ] No placeholders (TBD, TODO, "similar to", "add appropriate")
- [ ] Every task has a verify command
- [ ] File paths are concrete, not patterns
- [ ] Tasks target our stack (React 19, Vite, TS strict, Tailwind 4, ShadCN, AWS)
- [ ] Wave dependencies are correct (no circular deps)
- [ ] Total tasks ≤ 15 — if more, split into multiple plans

### 6. Handoff

Display plan summary and suggest:
"Run `/subagent-driven-development docs/plans/{slug}-plan.md` to execute."

## Output

1. Plan file path
2. Task count per wave
3. Total estimated time (tasks x 2-5 min)
4. Files that will be created or modified

## Boundaries

- Does not implement anything — planning only
- Does not dispatch agents — that's `/subagent-driven-development`
- Plans must be self-contained — a fresh-context agent must be able to execute
  any task with only the plan, CLAUDE.md, and referenced files
- No architecture decisions — those belong in the spec
- If the spec is too vague to produce concrete tasks, redirect to `/brainstorming`
