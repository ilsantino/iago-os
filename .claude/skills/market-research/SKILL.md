---
name: market-research
description: >-
  Use when analyzing markets, competitors, or industry trends for client
  engagements. Not when doing technical research (use /deep-research) or
  writing content (use /article-writing).
---

<!-- Source: ECC market-research -->

## Purpose

Produce structured market analysis — market sizing, competitive landscape,
trend identification — for client proposals, investor materials, or strategic
planning.

## Arguments

`/market-research {market or question}` — the market or competitive question.

Optional flags:
- `--focus {sizing|competitors|trends|all}` — analysis scope (default: all)
- `--depth {quick|thorough}` — quick = 1 page, thorough = full report

## Steps

### 1. Define scope

Clarify:
- What market segment? (geographic, vertical, customer type)
- Who are the key players to analyze?
- What decisions will this research inform? (pricing, positioning, go/no-go)

### 2. Research

Use available sources:
- **Web:** Market reports, industry publications, company announcements
- **context7:** Framework/technology adoption data where relevant
- **Codebase:** Existing research artifacts in `docs/research/`

### 3. Analyze

**Market sizing (TAM/SAM/SOM):**
- Top-down: industry reports → segment → addressable portion
- Bottom-up: customer count x average revenue
- Cross-validate both approaches

**Competitive landscape:**
| Competitor | Positioning | Strengths | Weaknesses | Pricing |
|-----------|------------|-----------|------------|---------|

**Trends:**
- 3-5 trends with evidence and timeline
- Impact on client's positioning

### 4. Produce recommendation

Every market research output must end with:
- **Opportunity assessment:** attractive / cautious / avoid
- **Positioning recommendation:** where to compete and how to differentiate
- **Key risk:** the one thing that could invalidate this analysis

### 5. Save

Write to `docs/research/market-{slug}.md`. Create directory if needed.

## Output

1. Research file path
2. Market size (TAM/SAM/SOM one-line)
3. Competitor count analyzed
4. Opportunity assessment (one word + one sentence)

## Boundaries

- Research and analysis only — does not create proposals or pitch materials
- Does not dispatch agents — orchestrator researches inline
- Must include sources — no unsourced claims
- Must end with actionable recommendation — no open-ended summaries
- Quick mode: ≤1 page. Thorough mode: ≤5 pages.
