---
name: content-engine
description: >-
  Use when producing multi-format content from a single source (blog + social +
  newsletter). Not when writing a single article (use /article-writing) or when
  creating investor materials (use /investor-materials).
---

<!-- Source: ECC content-engine -->

## Purpose

Transform a single content source into multiple output formats — blog post,
social media posts, newsletter excerpt, and summary — maintaining consistent
messaging across channels.

## Arguments

`/content-engine {source}` — path to source content, or a topic description.

Optional flags:
- `--formats {blog,social,newsletter,summary}` — comma-separated (default: all)
- `--platforms {twitter,linkedin,threads}` — social platform targets

## Steps

### 1. Identify source material

If source is a file path, read it. If it's a topic, draft the core content first
(or redirect to `/article-writing` for a full article).

### 2. Extract key messages

From the source, identify:
- **Primary message:** The one thing every format must convey
- **Supporting points:** 2-3 points that reinforce the primary message
- **Call to action:** What the reader should do next

### 3. Dispatch content-writer

Dispatch `content-writer` agent with:
- The source content and extracted messages
- Target formats and platforms
- Instruction: adapt voice per channel (professional for LinkedIn, concise for Twitter/X, conversational for newsletter)

### 4. Generate each format

**Blog post:** (~1000-1500 words) Full article with structured sections.
**Social posts:** Platform-specific:
- Twitter/X: ≤280 chars, hook + insight + CTA
- LinkedIn: 1-3 paragraphs, professional tone, hashtags
- Threads: 3-5 connected posts, storytelling arc
**Newsletter:** 2-3 paragraph excerpt with link to full article.
**Summary:** 2-3 sentence executive summary.

### 5. Save outputs

Write all formats to `docs/content/{slug}/`:
- `blog.md`
- `social-{platform}.md`
- `newsletter.md`
- `summary.md`

## Output

1. File paths for each generated format
2. Primary message (one sentence)
3. Format count and platforms covered
4. Word/character counts per format

## Boundaries

- Does not publish to any platform — local files only
- Does not create images or graphics — text content only
- Does not create investor materials — use `/investor-materials`
- If content-writer returns BLOCKED, generate formats inline
- Each format must stand alone — no "see the full article" dependencies
