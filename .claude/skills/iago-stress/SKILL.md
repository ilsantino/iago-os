---
name: iago-stress
description: >-
  Adversarially stress-test a plan before execution. Finds precision gaps, edge
  cases, contradictions, simpler alternatives, and missing acceptance criteria.
  Use on any plan file or all plans in a phase or feature folder, in the plan's
  own conversation, before executing it. Not when the plan already has a
  ## Stress Test section (unless --force).
---

## Purpose

Run a 5-dimension adversarial review on a plan BEFORE execution. Catches flaws
that would waste implementation time. Embeds findings as a `## Stress Test`
section in the plan file, so the record travels with the plan (and `/iago-execute`'s
step 0, where that pipeline is used, skips a plan that already has one).

The skill is a convenience, not a dependency: the five dimensions below are the
whole method. If the skill is unavailable, the session that owns the plan runs the
same five questions itself, reading the plan against the code.

## Arguments

```
/iago-stress {plan-path}           — stress-test a single plan
/iago-stress {folder-or-slug}      — stress-test every plan in a feature or phase folder
/iago-stress {plan-path} --force   — re-stress-test even if section exists
/iago-stress {plan-path} --deep    — council-style multi-lens stress test (5 reviewers + peer review + synthesis)
```

If the argument ends in `.md`, treat it as a single plan. Otherwise it names a plan
folder: the argument itself if it is a directory (e.g. `.iago/plans/feature-x/`), then
`.iago/plans/{arg}/` (e.g. `feature-mantenimiento-catalogo`, `01-auth`), then
`.iago/plans/feature-{arg}/`, then the legacy flat files `.iago/plans/{arg}-*.md`.

`--deep` and `--force` are composable.

## Steps

### 1. Resolve targets

- **Single plan:** Verify the file exists. If not, STOP: "Plan not found: {path}"
- **Folder or slug:** Glob `*.md` in the first folder above that exists, excluding
  `README.md`; otherwise the legacy flat glob. If no matches, STOP: "No plans found for {arg}"
- For each plan, check if `## Stress Test` section already exists. Skip unless `--force`.

### 2. Stress-test each plan (standard mode — default)

If `--deep` is NOT set, use the standard single-pass approach:

For each plan file, dispatch an `analyst` agent with `model: "opus"` set on the
call (the `analyst` definition defaults to sonnet) and read-only tools (`Read`,
`Glob`, `Grep`). The agent reviews the PLAN, reading the code it names to check it.

Review against the code the plan will actually land on: when the plan depends on
other plans, run it after they have merged into the integration branch, from a
checkout of that branch, not against an older base.

Prompt the agent with these 5 dimensions:

**1. PRECISION** — Could two developers read this plan and write meaningfully
different code? Flag vague requirements, ambiguous scope, unspecified behavior.
Quote the vague line and state what's missing.

**2. EDGE CASES** — What inputs, states, or sequences would break the proposed
approach? Check: empty/null data, concurrent access, error paths, boundary
values, first-use vs returning-user, network failures.

**3. CONTRADICTIONS** — Does the plan conflict with patterns in the codebase,
rules in CLAUDE.md, or architectural decisions? Read relevant source files to
verify. Check that every file, function, field and line the plan cites exists as
described on the current base; a plan written before its dependencies were built
names things that may have moved, been renamed or been built differently.

**4. SIMPLER ALTERNATIVES** — Is there a fundamentally different approach with
less complexity, fewer files, or better alignment with existing patterns? Only
flag if clearly better, not just different.

**5. MISSING ACCEPTANCE CRITERIA** — How would you verify the implementation
works? If the plan doesn't specify, the implementer will guess. Flag gaps.

Tag each finding **BLOCK** (implementation would be fundamentally wrong),
**IMPORTANT** (fix before execution) or **NOTE** (worth knowing). The fold in
step 4 works on these tags.

Agent must end with exactly one verdict:

```
VERDICT: PROCEED — no significant issues found
VERDICT: PROCEED_WITH_NOTES — issues found but implementation can proceed with awareness
VERDICT: BLOCK — critical flaw that would make implementation fundamentally wrong
```

### 2b. Council-style stress test (`--deep` flag)

Only when the user passes `--deep`: five lens reviewers, anonymous peer review and a
chairman synthesis, 11 agents over the same plan. Follow `references/deep.md`. Never
choose it yourself; the standard pass is the default for every plan.

### 3. Embed results in plan

After each stress test completes (standard or deep), append a `## Stress Test`
section to the plan file (before `## Verification` if it exists, otherwise at end).

**Standard mode:**
```markdown
## Stress Test

**Verdict:** {PROCEED | PROCEED_WITH_NOTES | BLOCK}
**Date:** {YYYY-MM-DD}

{Agent findings, grouped by dimension. Skip dimensions with no findings.}
```

**Deep mode:**
Use the chairman's full output (Consensus, Contested, Blind Spots, Consolidated).
The pipeline's step 0 recognizes `## Stress Test` regardless of mode — no double work.

### 4. Report

Display a summary table:

```
| Plan | Verdict | Findings |
|------|---------|----------|
| {name} | PROCEED | 0 |
| {name} | PROCEED_WITH_NOTES | 3 |
```

For BLOCK verdicts, quote the critical finding and say the plan needs revising
before it is executed.

For BLOCK and PROCEED_WITH_NOTES, the findings are the reviewer's, not yet facts.
Fold them before executing: verify each BLOCK and IMPORTANT finding against the
code, rewrite the plan text where it holds, add a dated `> **Amended YYYY-MM-DD
(stress)**` note at the top of the plan, and put a `**Disposition (YYYY-MM-DD):**`
line under the verdict saying what was folded and what was rejected and why. When
several plans were stressed together, check the folded plans against each other.

For all PROCEED, say the plans are clean and can be executed.

## Boundaries

- Read-only analysis — never modify code, only the plan file (to embed findings)
- BLOCK is advisory — the user decides whether to revise. The pipeline's step 0
  would hard-block, but standalone stress testing lets the user override.
- Where `/iago-execute` is used, this pre-empts its step 0: if the section exists,
  step 0 skips; if not, step 0 runs its own stress test.
