# Acme DevRel — Workspace Map

<!--
=======================================================================
TEACHING NOTE: This is LAYER 1 — THE MAP.

CLAUDE.md is auto-loaded into every conversation. It's always in context.
That makes it prime real estate. Use it for:

  1. Folder structure (so the agent always knows where things live)
  2. ID systems & naming conventions (so files land in the right place)
  3. File placement rules (so nothing gets lost)
  4. Quick navigation table (task → workspace)

Do NOT put:
  - Detailed instructions (those go in workspace CONTEXT.md files)
  - Voice/style guides (those go in docs/)
  - Pipeline details (those go in workflows/CONTEXT.md)

Keep it under 200 lines. Every line here costs tokens in EVERY conversation.
=======================================================================
-->

## What This Is

A workspace system for Acme's developer relations team. Writing, production, and community — each in its own silo. An agent drops into a workspace, reads its CONTEXT.md, does its work, and exits.

**CONTEXT.md** (top-level) routes you to the right workspace. This file is the map.

---

## Folder Structure

```
acme-devrel/
├── CLAUDE.md                       ← You are here (always loaded)
├── CONTEXT.md                      ← Task router
│
├── writing-room/                   ← Write blog posts, tutorials, docs
│   ├── CONTEXT.md
│   ├── docs/                       ← Voice guide, style rules, audience profiles
│   │   ├── voice.md
│   │   ├── style-guide.md
│   │   └── audience.md
│   ├── drafts/                     ← Work in progress
│   └── final/                      ← Ready for production or publishing
│
├── production/                     ← Build things: videos, demos, sample apps
│   ├── CONTEXT.md
│   ├── docs/                       ← Technical standards, component library, design system
│   │   ├── tech-standards.md
│   │   ├── component-library.md
│   │   └── design-system.md
│   ├── workflows/                  ← The 4-stage pipeline
│   │   ├── CONTEXT.md              ← Pipeline routing
│   │   ├── 01-briefs/              ← What to build (input)
│   │   ├── 02-specs/               ← How to build it (plan)
│   │   ├── 03-builds/              ← The actual work (execution)
│   │   └── 04-output/              ← Finished deliverables
│   └── src/                        ← Source code for demos/apps
│
├── community/                      ← Social posts, newsletters, event content
│   ├── CONTEXT.md
│   ├── docs/                       ← Platform specs, content calendar guidelines
│   │   ├── platforms.md
│   │   └── calendar-rules.md
│   └── content/
│       ├── newsletters/
│       ├── social/
│       ├── events/
│       └── templates/
│
└── _examples/                      ← Teaching examples (not part of real workflow)
```

---

## Quick Navigation

| Want to... | Go here |
|------------|---------|
| **Write a blog post or tutorial** | `writing-room/CONTEXT.md` |
| **Learn the voice/style** | `writing-room/docs/voice.md` |
| **Build a demo or video** | `production/CONTEXT.md` |
| **Generate a build spec** | `production/workflows/CONTEXT.md` |
| **Look up components** | `production/docs/component-library.md` |
| **Create social content** | `community/CONTEXT.md` |
| **Write a newsletter** | `community/CONTEXT.md` |
| **Understand the template** | `START-HERE.md` |

---

## Cross-Workspace Flow

```
writing-room (voice + style → polished drafts)
    ↓
production (draft → spec → build → deliverable)

community (repurposes content from writing-room and production)
    ↑ uses writing-room voice for all written content
    ↑ uses production deliverables as assets
```

<!--
TEACHING NOTE: Cross-workspace flow is ONE-WAY.
writing-room outputs feed into production inputs.
Both feed into community. But community never feeds back.

This is important because it means an agent in writing-room
never needs to know about production's pipeline stages.
-->

---

## ID & Naming Conventions

<!--
TEACHING NOTE: Naming conventions belong in CLAUDE.md because
they apply EVERYWHERE. Any agent creating a file needs these rules,
regardless of which workspace it's in.
-->

| Content Type | Pattern | Example |
|-------------|---------|---------|
| Blog drafts | `[slug]-[status].md` | `api-auth-guide-draft.md` |
| Tutorials | `[slug]-[status].md` | `getting-started-final.md` |
| Build specs | `[slug]-spec.md` | `auth-demo-spec.md` |
| Deliverables | `[slug]-v[n].[ext]` | `auth-demo-v2.mp4` |
| Newsletters | `[YYYY-MM-DD]-[slug].md` | `2026-03-10-launch-week.md` |
| Social posts | `[platform]-[slug].md` | `twitter-launch-announce.md` |

**Statuses:** `draft` → `review` → `final`

---

## File Placement Rules

### Writing
- **Drafts:** `writing-room/drafts/[slug]-[status].md`
- **Final:** `writing-room/final/[slug]-final.md`
- **Ready for production:** Copy to `production/workflows/01-briefs/`

### Production Pipeline
- **Briefs:** `production/workflows/01-briefs/[slug].md`
- **Specs:** `production/workflows/02-specs/[slug]-spec.md`
- **Active builds:** `production/workflows/03-builds/[slug]/`
- **Output:** `production/workflows/04-output/[slug]-v[n].[ext]`

### Community
- **Newsletters:** `community/content/newsletters/[YYYY-MM-DD]-[slug].md`
- **Social:** `community/content/social/[platform]-[slug].md`
- **Events:** `community/content/events/[event-name]/`
- **Templates:** `community/content/templates/[slug].md`

---

## Token Management

<!--
TEACHING NOTE: This section is the #1 thing people miss.
It tells agents what NOT to load. Without this, agents will
try to read everything and blow their context window.
-->

**Each workspace is siloed.** Don't load everything.

- Writing a blog post? → Load `writing-room/docs/voice.md` + `style-guide.md`. Skip production entirely.
- Building a demo? → Load `production/docs/`. Skip writing-room docs.
- Creating social content? → Load `community/docs/platforms.md`. Only pull from writing-room if you need voice reference.

The CONTEXT.md files tell you what to load for each task. Trust them.

---

## Skills & Tools Available

<!--
TEACHING NOTE: This section maps which skills and MCPs are
available at the SYSTEM level. Individual workspaces and pipeline
stages reference specific tools in their own CONTEXT.md files.

Think of this as the "installed tools" list. The workspace CONTEXT
files are the "when to use them" instructions.

You can wire up to 15 skills per workspace. They don't all live here —
workspace CONTEXT.md files reference them at the point of use.
-->

| Tool | Type | Used In |
|------|------|---------|
| `/humanizer` | Skill | writing-room (Stage: review), community (all posts) |
| `/doc-coauthoring` | Skill | writing-room (long-form drafts) |
| `/frontend-design` | Skill | production (Stage 03: builds) |
| `/pdf` | Skill | production (Stage 04: output) |
| `/pptx` | Skill | community (event decks) |
| `/webapp-testing` | Skill | production (Stage 03: builds) |
| Context7 | MCP | production (Stage 02: specs — fetch library docs) |
| Web Search | MCP | writing-room (research), community (trend checking) |

See each workspace's CONTEXT.md for when and how these tools get invoked.
