---
name: iago-stress
description: >-
  Adversarially stress-test a plan before execution. Finds precision gaps, edge
  cases, contradictions, simpler alternatives, and missing acceptance criteria.
  Use on any plan file or all plans in a phase. Not when executing (pipeline
  step 0 handles it) or when plan already has a ## Stress Test section.
---

## Purpose

Run a 5-dimension adversarial review on a plan BEFORE execution. Catches flaws
that would waste implementation time. Embeds findings as a `## Stress Test`
section in the plan file, so the pipeline's step 0 auto-skips — no double work.

## Arguments

```
/iago:stress {plan-path}           — stress-test a single plan
/iago:stress {phase-slug}          — stress-test all plans in a phase
/iago:stress {plan-path} --force   — re-stress-test even if section exists
```

If argument looks like a file path (contains `/` or `.md`), treat as single plan.
Otherwise, treat as phase slug and glob `.iago/plans/{slug}-*.md`.

## Steps

### 1. Resolve targets

- **Single plan:** Verify the file exists. If not, STOP: "Plan not found: {path}"
- **Phase slug:** Glob `.iago/plans/{NN}-{slug}-*.md`. If no matches, STOP: "No plans found for phase {slug}"
- For each plan, check if `## Stress Test` section already exists. Skip unless `--force`.

### 2. Stress-test each plan

For each plan file, dispatch an `analyst` agent (opus) with read-only tools
(`Read`, `Glob`, `Grep`). The agent reviews the PLAN — not code.

Prompt the agent with these 5 dimensions:

**1. PRECISION** — Could two developers read this plan and write meaningfully
different code? Flag vague requirements, ambiguous scope, unspecified behavior.
Quote the vague line and state what's missing.

**2. EDGE CASES** — What inputs, states, or sequences would break the proposed
approach? Check: empty/null data, concurrent access, error paths, boundary
values, first-use vs returning-user, network failures.

**3. CONTRADICTIONS** — Does the plan conflict with patterns in the codebase,
rules in CLAUDE.md, or architectural decisions? Read relevant source files to
verify.

**4. SIMPLER ALTERNATIVES** — Is there a fundamentally different approach with
less complexity, fewer files, or better alignment with existing patterns? Only
flag if clearly better, not just different.

**5. MISSING ACCEPTANCE CRITERIA** — How would you verify the implementation
works? If the plan doesn't specify, the implementer will guess. Flag gaps.

Agent must end with exactly one verdict:

```
VERDICT: PROCEED — no significant issues found
VERDICT: PROCEED_WITH_NOTES — issues found but implementation can proceed with awareness
VERDICT: BLOCK — critical flaw that would make implementation fundamentally wrong
```

### 3. Embed results in plan

After each stress test completes, append a `## Stress Test` section to the
plan file (before `## Verification` if it exists, otherwise at the end):

```markdown
## Stress Test

**Verdict:** {PROCEED | PROCEED_WITH_NOTES | BLOCK}
**Date:** {YYYY-MM-DD}

{Agent findings, grouped by dimension. Skip dimensions with no findings.}
```

### 4. Report

Display a summary table:

```
| Plan | Verdict | Findings |
|------|---------|----------|
| {name} | PROCEED | 0 |
| {name} | PROCEED_WITH_NOTES | 3 |
```

For BLOCK verdicts, quote the critical finding and suggest: "Revise the plan
before running `/iago:execute`."

For PROCEED_WITH_NOTES, note: "Findings embedded in plan — implementation
session will see them."

For all PROCEED, suggest: "Plans are clean. Run `/iago:execute {slug}` when ready."

## Boundaries

- Read-only analysis — never modify code, only the plan file (to embed findings)
- BLOCK is advisory — the user decides whether to revise. The pipeline's step 0
  would hard-block, but standalone stress testing lets the user override.
- Does not replace the pipeline's step 0 — it pre-empts it. If the section exists,
  step 0 skips. If not, step 0 runs its own stress test.
