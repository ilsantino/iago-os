---
name: deep-research
description: >-
  Use when the user requests research, analysis, competitive audit, or market
  analysis on a topic beyond the codebase. Replaces the former /market-research
  skill (use --focus market). Not when the answer is in the codebase (use
  search-first) or when researching library docs (use context7 MCP directly).
---


## Purpose

Conduct multi-source research across codebase, documentation, and web sources,
then synthesize findings into an actionable recommendation — not just a summary
of what was found. Use `--focus market` for market sizing, competitive landscape,
and trend identification.

## Arguments

`/deep-research {question or topic}` — what to investigate.

Optional flags:
- `--sources {codebase|docs|web|all}` — limit source types (default: all)
- `--focus {technical|market|competitive}` — research lens (default: technical). `market` adds TAM/SAM/SOM, competitive landscape, and trend identification. `competitive` focuses on alternatives and differentiation.
- `--output {path}` — custom output path (default: `.iago/research/`)

## Steps

### 1. Scope the research

Break the question into 2-4 sub-questions:
- What do we need to know? (facts)
- What are the options? (alternatives)
- What do others do? (prior art / competition)
- What applies to our stack? (relevance filter)

### 2. Dispatch research agent

Dispatch `research` profile (Sonnet) with:
- The research question and sub-questions
- CLAUDE.md (for stack context)
- .iago/PROJECT.md (if exists, for project context)
- Source constraints (if `--sources` specified)

The research profile will:
- **Codebase:** Grep, Glob, Read for relevant patterns and prior implementations
- **Docs:** Use `context7` MCP to fetch current library/framework documentation
- **Web:** WebSearch + WebFetch for articles, comparisons, benchmarks, GitHub issues

### 3. Synthesize findings

Do NOT just concatenate source material. Synthesize:
- What's consistent across sources? (high confidence)
- What's contradictory? (flag as uncertain)
- What's missing? (gaps in available information)

### 4. Produce recommendation

Every research output MUST end with an actionable recommendation:

```markdown
## Recommendation

**Decision:** {Choose X over Y}
**Confidence:** {High | Medium | Low}
**Reasoning:** {2-3 sentences — why this, why not the alternatives}
**Next step:** {Concrete action to take}
**Risk if wrong:** {What happens if this recommendation is bad}
```

No "it depends" — pick a direction. State the conditions under which you'd change
your recommendation.

### 5. Write research artifact

Save to `.iago/research/{topic-slug}.md`:

```markdown
# Research: {Topic}

**Date:** {today}
**Question:** {original question}

## Findings

### {Sub-question 1}
{Findings with source citations}

### {Sub-question 2}
{Findings with source citations}

## Sources
- {source 1}: {what it contributed}
- {source 2}: {what it contributed}

## Recommendation
{As above}
```

Create `.iago/research/` if it doesn't exist.

## Output

Display:
1. Key findings (3-5 bullet points)
2. Recommendation with confidence level
3. Research file path
4. Source count and types used

## Examples

**Technology evaluation:**
```
/deep-research Should we use TanStack Router or React Router for this project?
```

**Architecture decision:**
```
/deep-research DynamoDB single-table vs multi-table for multi-tenant SaaS --sources codebase,docs
```

## Boundaries

- Research only — does not implement, modify code, or create plans
- Must produce a written artifact — no "I found that..." without saving it
- Must include actionable recommendation — no open-ended summaries
- If research profile returns BLOCKED (e.g., no web access), continue with available sources
- Time-box: if research exceeds 10 sub-queries without convergence, synthesize what you have
