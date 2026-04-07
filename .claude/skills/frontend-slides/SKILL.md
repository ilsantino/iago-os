---
name: frontend-slides
description: >-
  Use when generating presentation slides from code, data, or content.
  Not when writing static documents or articles (use /content-engine --formats blog).
---


## Purpose

Generate presentation slide content structured for rendering with React 19 +
TailwindCSS 4 — or as markdown slide decks for tools like reveal.js or Marp.

## Arguments

`/frontend-slides {topic or source-path}` — what to present.

Optional flags:
- `--format {react|markdown|both}` — output format (default: markdown)
- `--slides {count}` — target slide count (default: 10-15)
- `--style {minimal|corporate|technical}` — visual style

## Steps

### 1. Gather content

If source is a file, extract key points. If topic, outline the narrative:
- Opening hook
- 3-5 key points with supporting data
- Call to action / next steps

### 2. Structure slides

Each slide must have:
- **Title:** ≤6 words
- **Content:** ≤3 bullet points or 1 visual element description
- **Speaker notes:** What to say (not what's on the slide)

Slide flow:
1. Title slide
2. Problem/context
3-N. Key points (one per slide)
N+1. Summary/CTA
N+2. Q&A / contact

### 3. Generate output

**Markdown format (Marp-compatible):**
```markdown
---
marp: true
theme: default
---

# {Title}
{subtitle}

---

## {Slide Title}
- Point 1
- Point 2

<!-- speaker notes -->
```

**React format:**
```tsx
// slides/{slug}/slide-{N}.tsx
export const Slide1 = () => (
  <div className="flex flex-col items-center justify-center h-screen p-12">
    <h1 className="text-5xl font-bold">{title}</h1>
    <p className="text-xl text-muted-foreground mt-4">{subtitle}</p>
  </div>
)
```

React slides use TailwindCSS 4 classes and ShadCN/UI components where appropriate.

### 4. Save

Write to `docs/slides/{slug}/`:
- `slides.md` (markdown format)
- `slides/` directory with per-slide React components (react format)

## Output

1. File path(s)
2. Slide count
3. Format generated
4. Estimated presentation duration (2 min/slide)

## Boundaries

- Does not render or deploy slides — produces source files only
- React slides use our stack (React 19 + Vite + TailwindCSS 4 + ShadCN/UI)
- Does not create images or diagrams — text and layout only
- Does not dispatch agents — orchestrator generates inline
- If content source is insufficient, ask for more context before generating
