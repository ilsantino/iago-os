---
name: article-writing
description: >-
  Use when writing blog posts, articles, or long-form content for clients or
  iaGO's own marketing. Not when writing documentation, READMEs, or specs
  (those follow their own conventions).
---

<!-- Source: ECC article-writing -->

## Purpose

Produce polished long-form content (blog posts, thought leadership, tutorials)
with a consulting-appropriate voice — authoritative, concise, no filler.

## Arguments

`/article-writing {topic}` — the subject to write about.

Optional flags:
- `--tone {technical|executive|casual}` — voice (default: technical)
- `--length {short|medium|long}` — ~800 / ~1500 / ~2500 words (default: medium)
- `--audience {developers|executives|general}` — target reader

## Steps

### 1. Research the topic

Gather key points:
- What does the audience already know?
- What's the one insight they should walk away with?
- What supporting evidence exists? (data, examples, case studies)

### 2. Outline

```markdown
# {Title}

## Hook (1-2 sentences — why this matters now)
## Context (background the reader needs)
## Core Argument (the main insight, with evidence)
## Practical Application (what to do with this knowledge)
## Conclusion (restate insight, call to action)
```

### 3. Dispatch content-writer

Dispatch `content-writer` agent with:
- The outline
- Tone and audience parameters
- Length target
- Instruction: "iaGO consulting voice — authoritative, no hedging, concrete examples"

### 4. Edit and polish

Review the draft for:
- [ ] No filler phrases ("in today's fast-paced world", "it goes without saying")
- [ ] Every paragraph earns its place — cut ruthlessly
- [ ] Technical claims are accurate and current
- [ ] Clear structure with scannable headings

### 5. Save

Write to `docs/content/{slug}.md`. Create directory if needed.

## Output

1. Article file path
2. Word count
3. Title and hook sentence
4. Suggested distribution channels

## Boundaries

- Does not publish or distribute — produces the document only
- Does not create social media posts — use `/content-engine` for multi-format
- If content-writer returns BLOCKED, write inline
