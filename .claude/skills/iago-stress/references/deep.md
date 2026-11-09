# iago-stress — `--deep` council mode

Sub-procedure of the `iago-stress` skill (`../SKILL.md`), used only when the user passes `--deep`.

If `--deep` IS set, run a council-style multi-lens stress test per plan.
This is the heavy-duty path — 5 independent reviewers + anonymous peer review +
chairman synthesis, 11 agents over the same plan. Run it only when the user passes
`--deep`; never choose it yourself. The standard pass is the default for every plan,
including schema and lifecycle plans.

**Phase A — Convene 5 reviewers (parallel)**

Spawn 5 `analyst` agents simultaneously, each with `model: "opus"`. Each gets the
plan file, CLAUDE.md, and relevant source files. Each owns ONE lens:

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
Spawn 5 new `analyst` agents with `model: "sonnet"`. Each sees all 5 anonymized
reviews and answers:

1. Which review caught the most critical issue? Why?
2. Which review has a blind spot — what did it miss within its own lens?
3. What did ALL reviews miss that could bite the implementation?

Keep under 150 words per peer review.

**Phase C — Chairman synthesis**

One `analyst` agent with `model: "opus"` gets: plan, all 5 de-anonymized reviews,
all 5 peer reviews. Produces:

The heading stays `## Stress Test`, so the skill's own skip check and the
`grep '^## Stress Test'` in `/iago-execute` and `/iago-quick` recognize it; the
`Mode` line marks it as a council run.

```
## Stress Test

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
