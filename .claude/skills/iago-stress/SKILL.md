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
/iago-stress {plan-path}           — stress-test a single plan
/iago-stress {phase-slug}          — stress-test all plans in a phase
/iago-stress {plan-path} --force   — re-stress-test even if section exists
/iago-stress {plan-path} --deep    — council-style multi-lens stress test (5 reviewers + peer review + synthesis)
```

If argument looks like a file path (contains `/` or `.md`), treat as single plan.
Otherwise, treat as phase slug and glob `.iago/plans/{slug}-*.md`.

`--deep` and `--force` are composable.

## Steps

### 1. Resolve targets

- **Single plan:** Verify the file exists. If not, STOP: "Plan not found: {path}"
- **Phase slug:** Glob `.iago/plans/{NN}-{slug}-*.md`. If no matches, STOP: "No plans found for phase {slug}"
- For each plan, check if `## Stress Test` section already exists. Skip unless `--force`.

### 2. Stress-test each plan (standard mode — default)

If `--deep` is NOT set, use the standard single-pass approach:

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

### 2b. Council-style stress test (`--deep` flag)

If `--deep` IS set, run a council-style multi-lens stress test per plan.
This is the heavy-duty path — 5 independent reviewers + anonymous peer review +
chairman synthesis. Use for high-stakes plans where being wrong is expensive.

**Phase A — Convene 5 reviewers (parallel)**

Spawn 5 `analyst` agents simultaneously. Each gets the plan file, CLAUDE.md,
and relevant source files. Each owns ONE lens:

| # | Reviewer | Lens |
|---|----------|------|
| 1 | **Security/Auth** | Auth bypass, data exposure, injection, token handling, permission gaps. Assumes attacker perspective. |
| 2 | **Failure Modes** | Edge cases, race conditions, rollback safety, error paths, cascading failures. What breaks under stress? |
| 3 | **Simplicity** | YAGNI, over-engineering, unnecessary abstractions, simpler alternatives. Is the plan doing too much? |
| 4 | **Consumer** | API ergonomics, DX, caller assumptions, unclear interfaces. How would someone consuming this code feel? |
| 5 | **Feasibility** | Ambiguous instructions, missing details, contradictions with codebase. Can this be built exactly as written? |

Each reviewer prompt:

```
You are the {Reviewer Name} on a plan stress-test council.

Your lens: {reviewer description}

Review this plan:
---
{plan content}
---

Project context:
{CLAUDE.md relevant sections}

Source files referenced by the plan:
{read and include relevant source files}

Analyze the plan ONLY through your assigned lens. Be direct and specific.
Don't hedge. Quote specific lines from the plan when flagging issues.
Other reviewers cover the angles you're not covering.

For each finding, assign severity:
- **BLOCK** — implementation would be fundamentally wrong
- **IMPORTANT** — significant issue that should be fixed before execution
- **NOTE** — worth knowing but won't derail implementation

Keep your response between 200-400 words. Findings only, no filler.
End with: FINDINGS: {count} (B:{blocks} I:{important} N:{notes})
```

**Phase B — Anonymous peer review (parallel)**

Collect all 5 reviewer responses. Anonymize as Review A-E (randomize mapping).
Spawn 5 new `analyst` agents. Each sees all 5 anonymized reviews and answers:

1. Which review caught the most critical issue? Why?
2. Which review has a blind spot — what did it miss within its own lens?
3. What did ALL reviews miss that could bite the implementation?

Keep under 150 words per peer review.

**Phase C — Chairman synthesis**

One `analyst` agent (opus) gets: plan, all 5 de-anonymized reviews, all 5 peer
reviews. Produces:

```
## Deep Stress Test

**Verdict:** {PROCEED | PROCEED_WITH_NOTES | BLOCK}
**Date:** {YYYY-MM-DD}
**Mode:** council (5 reviewers + peer review)

### Consensus Findings
{Issues multiple reviewers flagged independently — highest confidence}

### Contested Findings
{Disagreements between reviewers — present both sides}

### Blind Spots Caught
{Issues only surfaced through peer review}

### Consolidated Findings
{All unique findings, deduplicated, ordered by severity: BLOCK → IMPORTANT → NOTE}
{For each: severity, source reviewer, description}
```

The chairman ends with the same verdict format:
```
VERDICT: PROCEED | PROCEED_WITH_NOTES | BLOCK
```

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

For BLOCK verdicts, quote the critical finding and suggest: "Revise the plan
before running `/iago-execute`."

For PROCEED_WITH_NOTES, note: "Findings embedded in plan — implementation
session will see them."

For all PROCEED, suggest: "Plans are clean. Run `/iago-execute {slug}` when ready."

## Boundaries

- Read-only analysis — never modify code, only the plan file (to embed findings)
- BLOCK is advisory — the user decides whether to revise. The pipeline's step 0
  would hard-block, but standalone stress testing lets the user override.
- Does not replace the pipeline's step 0 — it pre-empts it. If the section exists,
  step 0 skips. If not, step 0 runs its own stress test.
