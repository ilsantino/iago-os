# Workflow Starter: Content Pipeline

Download this folder structure, edit the context files to match your work, and start building. Everything is pre-written with placeholder text in brackets. Replace the brackets with your information.

---

## Folder Structure

Create these folders and files on your computer:

```
content-pipeline/
├── CLAUDE.md
├── script-lab/
│   ├── CONTEXT.md
│   ├── ideas/
│   ├── drafts/
│   └── final/
├── production/
│   ├── CONTEXT.md
│   ├── specs/
│   ├── builds/
│   └── output/
└── distribution/
    ├── CONTEXT.md
    └── ready-to-post/
```

---

## CLAUDE.md

Save this as `CLAUDE.md` in the root of `/content-pipeline/`:

```markdown
# Content Pipeline — [Your Name]

I create [CONTENT TYPE] about [TOPIC] for [AUDIENCE] on [PLATFORMS].

## Workspaces

- /script-lab — Ideation, writing, editing. Ideas in, finished scripts out.
- /production — Building visual and audio assets. Specs, animations, graphics.
- /distribution — Final formatting per platform and scheduling.

## Routing

| Task | Go to | Read |
|------|-------|------|
| Brainstorm or write | /script-lab | CONTEXT.md |
| Build assets | /production | CONTEXT.md |
| Format for publishing | /distribution | CONTEXT.md |
| Edit existing draft | /script-lab | CONTEXT.md + specific draft file |

## Naming Conventions

- Ideas: idea_short-description.md
- Drafts: topic-name_draft.md
- Final scripts: topic-name_final.md
- Specs: topic-name_spec.md
- Published: YYYY-MM-DD_platform_topic.md

## Rules

- Read this file at the start of every new task.
- Do not create files outside the current workspace unless asked.
- When a draft is approved, move it from /drafts/ to /final/.
- Ask before overwriting any existing file.
```

---

## script-lab/CONTEXT.md

Save this as `CONTEXT.md` in `/content-pipeline/script-lab/`:

```markdown
# Script Lab

This is where content gets written.

## What I make
[Describe your content: YouTube videos, blog posts, newsletter issues, podcast scripts, etc.]

## My audience
[Who are they? What do they already know? What are they trying to do?]

## My voice
- Tone: [Direct and clear / warm and conversational / technical but accessible / etc.]
- I say: [Phrases or patterns that sound like you]
- I avoid: [Phrases, cliches, or patterns you do not want]
- Length: [Typical content length per format]

## My process
1. Ideas go in /ideas/ as short notes
2. Promising ideas become drafts in /drafts/
3. Drafts get revised until they work
4. Final versions move to /final/ and are ready for production

## What good looks like
[Describe or link to an example of your best work. What makes it good? What should Claude aim for?]

## What bad looks like
[Common mistakes in your content. Things that sound off. Patterns to avoid.]
```

---

## production/CONTEXT.md

Save this as `CONTEXT.md` in `/content-pipeline/production/`:

```markdown
# Production

This is where content gets built into its final form.

## What gets produced here
[Animations, graphics, thumbnails, audio edits, slide decks, etc.]

## Tools
[Remotion, CapCut, Canva, Illustrator, etc. List what you use.]

## Process
1. A finished script from /script-lab/final/ enters as input
2. A spec is generated in /specs/ mapping the script to visual beats
3. Assets are built in /builds/
4. Final output goes to /output/ for handoff to distribution

## Visual standards
- Colors: [Your palette]
- Typography: [Your font choices]
- Style: [Minimal, bold, technical, playful, etc.]

## Quality rules
[What must every piece of production output have? What is the minimum bar?]
```

---

## distribution/CONTEXT.md

Save this as `CONTEXT.md` in `/content-pipeline/distribution/`:

```markdown
# Distribution

Finished content gets formatted for each platform and prepared for publishing.

## Platforms
[List each platform you publish on]

## Platform-specific rules

### [Platform 1, e.g., YouTube]
- Format: [Length, aspect ratio, title conventions]
- Description template: [Your standard description structure]
- Tags/keywords: [Standard tags you always include]

### [Platform 2, e.g., Instagram]
- Format: [Reel length, aspect ratio, caption conventions]
- Hashtags: [Standard hashtags]
- Hook: [First line must grab attention within 1 second]

### [Platform 3, e.g., Newsletter]
- Format: [Length, structure, subject line conventions]
- CTA: [Standard call to action]

## Posting cadence
[How often you post on each platform]

## Rules
- Every piece of content in /ready-to-post/ must be formatted for its specific platform.
- Do not publish. Only prepare. Publishing is manual.
```
