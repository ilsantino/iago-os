# Skill & MCP Integration — Deep Dive

<!--
This file exists because "skills are just .md files" is the most
common misconception. Skills are CAPABILITIES. How and where you
wire them determines whether they're useful or just installed.
-->

## The Misconception

People think Claude Code skills = markdown files with instructions.

Some skills ARE markdown files. But that's like saying a recipe is "just text." The recipe matters because of WHEN you follow it, with WHAT ingredients, in WHAT order. A skill matters because of where it sits in your workflow.

## The 5 Ways Skills Show Up in a Workspace

### 1. The Pipeline Gate

A skill that MUST run before work moves to the next stage.

```markdown
<!-- In production/workflows/CONTEXT.md -->

| Stage | Gate Skill | Rule |
|-------|-----------|------|
| 03 → 04 | `/webapp-testing` | Build must pass all tests before moving to output |
| review → final | `/humanizer` | All drafts get de-AI'd before publishing |
```

**Why it works:** The CONTEXT.md makes it a non-negotiable step, not a suggestion. The agent treats it as a requirement because the routing table says so.

### 2. The Stage Specialist

A skill that only activates during one specific stage.

```markdown
<!-- In production/workflows/CONTEXT.md routing table -->

| Your Task | Skills at This Stage |
|-----------|---------------------|
| Brief → Spec | Context7 MCP, Web Search MCP |
| Spec → Build | /frontend-design, /webapp-testing |
| Build → Output | /pdf |
```

**Why it works:** The agent at Stage 02 never sees `/frontend-design` because it's not relevant yet. Skills are contextual, not global.

### 3. The Format Trigger

A skill that activates based on WHAT you're creating, not which stage you're at.

```markdown
<!-- In community/CONTEXT.md -->

| Skill | Format | Purpose |
|-------|--------|---------|
| /pptx | Event decks | Generate PowerPoint presentations |
| /frontend-slides | Web decks | Animated HTML slide decks |
| /pdf | Downloadable guides | PDF generation |
```

**Why it works:** Community workspace has no pipeline. Instead, the output FORMAT determines which skill loads. Creating a newsletter? No skills needed. Creating a slide deck? Load `/frontend-slides`.

### 4. The Always-On Reference

Not a skill you "invoke" — a doc that's always loaded for a workspace.

```markdown
<!-- In writing-room/CONTEXT.md -->

## What to Load
| Task | Load These |
|------|-----------|
| Write a blog post | `docs/voice.md`, `docs/style-guide.md` |
| Write a tutorial | `docs/voice.md`, `docs/audience.md`, `docs/style-guide.md` |
| Edit/review | `docs/voice.md`, the draft |
```

**Why it works:** `voice.md` appears in EVERY row. It's effectively "always on" for this workspace. The agent always loads it because the routing table always includes it.

### 5. The Cross-Workspace Skill

A skill referenced from multiple workspaces, wired differently in each.

```markdown
<!-- In CLAUDE.md (the map) -->

| Tool | Used In |
|------|---------|
| /humanizer | writing-room (before final), community (before publish) |

<!-- In writing-room/CONTEXT.md -->
| /humanizer | Before any draft moves to final/ |

<!-- In community/CONTEXT.md -->
| /humanizer | Before publishing any content |
```

**Why it works:** The skill is the same, but the TRIGGER is different. Writing-room uses it at the draft→final transition. Community uses it before any publish. CLAUDE.md maps the overview. Workspace CONTEXTs wire the specifics.

---

## MCP Servers — When Skills Aren't Enough

Skills give agents instructions. MCPs give agents **new capabilities** — tools they couldn't otherwise use.

### When to Use an MCP vs. a Skill

| Need | Use |
|------|-----|
| Agent needs to follow a specific process | Skill (instructions) |
| Agent needs to access an external service | MCP (capability) |
| Agent needs to write in a specific voice | Skill (reference doc) |
| Agent needs to fetch live documentation | MCP (Context7) |
| Agent needs to search the web | MCP (Web Search) |
| Agent needs to generate images | MCP (image generation) |
| Agent needs to test a web app | Skill wrapping Playwright |
| Agent needs to post to Slack | MCP (Slack) |

### Wiring MCPs Into Your Pipeline

MCPs wire in exactly like skills — through the CONTEXT.md routing tables:

```markdown
<!-- In workflows/CONTEXT.md -->

| Stage | MCP | Purpose |
|-------|-----|---------|
| 02-specs | Context7 | Fetch current docs for libraries being specced |
| 02-specs | Web Search | Research current best practices |
| 03-builds | Context7 | Look up API details mid-build |
```

The key insight: **MCPs are most useful when the CONTEXT tells the agent WHEN to reach for them.** An agent with Web Search available but no guidance about when to use it will either over-search or never search. The routing table fixes that.

---

## How Many Skills Per Workspace?

You can wire up to 15 skills per workspace. But don't fill all 15 on day one.

**Start with:**
- 1-2 always-on references (voice, standards)
- 1-2 stage/format-specific skills
- 1 MCP for the capability you need most

**Add more when:**
- You notice agents repeatedly making the same mistake (add a reference doc)
- A manual step could be automated (add a skill for it)
- Agents need data they can't get from local files (add an MCP)

**The skill slots are infrastructure.** They exist so you can progressively build capability into your workspace over time, not so you can front-load everything at once.
