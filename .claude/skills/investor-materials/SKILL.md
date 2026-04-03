---
name: investor-materials
description: >-
  Use when creating pitch decks, one-pagers, or investor-facing documents.
  Not when doing market research (use /market-research) or drafting outreach
  emails (use /investor-outreach).
---

<!-- Source: ECC investor-materials -->

## Purpose

Produce investor-facing documents — pitch deck outlines, one-pagers, executive
summaries — with data-driven narratives and clear value propositions.

## Arguments

`/investor-materials {type}` — one of: `pitch-deck`, `one-pager`, `exec-summary`.

Optional flags:
- `--company {name}` — company name (default: from PROJECT.md or ask)
- `--stage {pre-seed|seed|series-a|series-b}` — funding stage
- `--ask {amount}` — funding amount being raised

## Steps

### 1. Gather inputs

Collect or confirm:
- Company name, stage, and sector
- Problem statement and solution
- Market size (TAM/SAM/SOM)
- Business model and revenue
- Traction metrics (users, revenue, growth rate)
- Team highlights
- Funding ask and use of funds

### 2. Dispatch content-writer

Dispatch `content-writer` agent with:
- Gathered inputs
- Document type and structure template
- Instruction: "Investor-grade prose — quantify everything, no superlatives without data"

### 3. Generate document

**Pitch deck outline:**
1. Title slide (company + one-line value prop)
2. Problem (quantified pain)
3. Solution (how it works)
4. Market (TAM/SAM/SOM with sources)
5. Business model (revenue mechanics)
6. Traction (metrics + trajectory)
7. Team (relevant experience only)
8. Ask (amount + use of funds)
9. Contact

**One-pager:** Single page with all above compressed.
**Executive summary:** 1-2 pages, narrative form.

### 4. Save

Write to `docs/investor/{type}-{date}.md`. Create directory if needed.
For pitch decks, suggest `/frontend-slides` for visual presentation layer.

## Output

1. Document file path
2. Document type and section count
3. Key metrics included
4. Suggest next step (outreach, slides, or review)

## Boundaries

- Produces text documents, not visual slides — use `/frontend-slides` for that
- Does not send materials to investors — local files only
- Does not fabricate metrics — if data is missing, flag it as "[NEEDED]"
- If content-writer returns BLOCKED, generate inline
