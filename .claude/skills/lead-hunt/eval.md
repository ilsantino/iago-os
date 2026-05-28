# Eval: lead-hunt

Rubric-based skill-selection eval per `.claude/rules/skill-authoring.md`.
`/lead-hunt` overlaps `/deep-research` (research / prospecting) and `/iago-quick`
(small-scope task), so this eval verifies the orchestrator routes intent -> skill
correctly.

## Test cases

| Intent | Expected skill | Notes |
|--------|----------------|-------|
| "I need contact info for 20 logistics CTOs in Mexico." | /lead-hunt | Lead discovery, public sources, <=50 leads |
| "I want background on the carbon-credit market for an investor pitch." | /deep-research | Topic research, not contact extraction |
| "Fix the typo in the lead-hunt readme." | /iago-fast | Trivial single-file edit |
| "Build a 3-task feature for CSV export tooling outside ROADMAP." | /iago-quick | Small standalone build, 1-3 tasks |

## Rubric scoring

Each test case scores every candidate skill across 5 dimensions (Intent, Scope,
Reversibility, Stack, Workflow phase), 0-2 each. The expected skill must score
**>=7** AND be the **unique top scorer**.

### Intent 1 - "contact info for 20 logistics CTOs in Mexico"

| Skill | Intent | Scope | Reversibility | Stack | Phase | Total |
|-------|:------:|:-----:|:-------------:|:-----:|:-----:|:-----:|
| **/lead-hunt** | 2 | 2 | 2 | 2 | 2 | **10** |
| /deep-research | 1 | 1 | 2 | 1 | 1 | 6 |
| /iago-quick | 0 | 1 | 1 | 1 | 1 | 4 |

Top scorer: **/lead-hunt** (10, unique). PASS

### Intent 2 - "background on the carbon-credit market for an investor pitch"

| Skill | Intent | Scope | Reversibility | Stack | Phase | Total |
|-------|:------:|:-----:|:-------------:|:-----:|:-----:|:-----:|
| **/deep-research** | 2 | 2 | 2 | 2 | 2 | **10** |
| /lead-hunt | 0 | 1 | 2 | 1 | 1 | 5 |
| /iago-quick | 0 | 1 | 1 | 1 | 1 | 4 |

Top scorer: **/deep-research** (10, unique). PASS

### Intent 3 - "fix the typo in the lead-hunt readme"

| Skill | Intent | Scope | Reversibility | Stack | Phase | Total |
|-------|:------:|:-----:|:-------------:|:-----:|:-----:|:-----:|
| **/iago-fast** | 2 | 2 | 2 | 2 | 2 | **10** |
| /iago-quick | 1 | 1 | 1 | 2 | 1 | 6 |
| /lead-hunt | 0 | 0 | 2 | 1 | 1 | 4 |

Top scorer: **/iago-fast** (10, unique). PASS

### Intent 4 - "build a 3-task feature for CSV export tooling outside ROADMAP"

| Skill | Intent | Scope | Reversibility | Stack | Phase | Total |
|-------|:------:|:-----:|:-------------:|:-----:|:-----:|:-----:|
| **/iago-quick** | 2 | 2 | 2 | 2 | 2 | **10** |
| /iago-fast | 1 | 1 | 1 | 2 | 1 | 6 |
| /lead-hunt | 0 | 1 | 1 | 1 | 1 | 4 |

Top scorer: **/iago-quick** (10, unique). PASS

## Pass criteria

- Every test case routes to the expected skill (no ties at the top).
- No skill scores >=7 on a test case where it is not the expected skill.

All four intents above route to their expected skill as the unique top scorer.
