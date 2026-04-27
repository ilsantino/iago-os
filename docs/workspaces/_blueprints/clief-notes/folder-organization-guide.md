# Folder Organization Guide
## How to Structure Folders for AI Workflows

This is a reference document. You can read it yourself, hand it to Claude, or print it and pin it next to your screen. It covers the three-layer system, how to decide what goes where, and file trees for common use cases.

---

## The Three Layers

Every folder setup follows three layers. The names change. The layers do not.

### Layer 1: The Map (CLAUDE.md)

Sits at the root of your project. Claude reads this first, every time. It contains:
- Who you are and what this project is (2-3 sentences)
- The folder structure (what exists and where)
- A routing table (for this task, go here, read this)
- Naming conventions (how files should be named so Claude can find them)

**Rule of thumb:** If your CLAUDE.md is longer than one screen, you have context files hiding inside it. Pull them out into Layer 2.

### Layer 2: The Rooms (Workspace Context Files)

Each workspace (subfolder for a type of work) has its own CONTEXT.md. This file describes what happens in this workspace, what the process is, what files are here, and what good output looks like.

Claude only reads a workspace context file when it is working in that workspace. This is how you keep the context window clean. Writing context does not load when Claude is building. Building context does not load when Claude is writing.

**Rule of thumb:** Each workspace should represent a different mental mode. If you shift how you think between two types of tasks, those are two workspaces.

### Layer 3: The Tools (Skills)

Skills are packaged instructions that teach Claude how to do something specific. A Remotion skill teaches it to build animations. A doc-authoring skill teaches it to write structured documents. A testing skill teaches it to run your test suite.

Skills plug into workspaces where they are needed. Your writing workspace does not need the testing skill. Your code workspace does. Wire them into the routing table.

**Rule of thumb:** If you find yourself explaining the same process to Claude in every conversation, that process is a skill waiting to be written.

---

## The Routing Table

This is the most important pattern in the system. It sits inside your CLAUDE.md and tells Claude exactly where to go for each type of task.

```
| Task | Go to | Read | Skills |
|------|-------|------|--------|
| Write content | /writing | CONTEXT.md | humanizer |
| Build something | /production | CONTEXT.md | remotion |
| Research | /research | CONTEXT.md | — |
| Client work for Alpha | /clients/alpha | CONTEXT.md | — |
```

Without this table, Claude either reads everything (wasting tokens on irrelevant context) or guesses which files matter (getting it wrong unpredictably). The table eliminates both problems.

---

## Naming Conventions

Add these to your CLAUDE.md so Claude knows how to name and find files without a database.

**Pattern:** `description_status.extension`

```
Examples:
  Blog drafts:     api-auth-guide_draft.md
  Final versions:  api-auth-guide_final.md
  Versioned:       demo-script_v2.md
  Date-stamped:    2026-03-14_launch-week-newsletter.md
  Client files:    alpha_proposal_v3.md
```

Choose a convention and stick with it. The specific format matters less than consistency. Claude learns your convention from the CLAUDE.md and applies it to every file it creates.

---

## File Trees by Use Case

### Content Creator

```
my-content-project/
├── CLAUDE.md
├── script-lab/
│   ├── CONTEXT.md
│   ├── ideas/
│   ├── drafts/
│   └── final/
├── production/
│   ├── CONTEXT.md
│   ├── briefs/
│   ├── specs/
│   ├── builds/
│   └── output/
└── distribution/
    ├── CONTEXT.md
    ├── platforms/
    ├── scheduling/
    └── analytics/
```

**Script Lab** — Where ideas become scripts. CONTEXT.md describes your voice, audience, content style, and writing process.

**Production** — Where content gets built. Animations, graphics, whatever your medium is. CONTEXT.md describes production tools, visual standards, and the build pipeline.

**Distribution** — Where finished content goes out. Platform-specific formatting, scheduling, repurposing. CONTEXT.md describes your platforms and posting rules.

### Freelancer / Consultant

```
my-practice/
├── CLAUDE.md
├── client-alpha/
│   ├── CONTEXT.md
│   ├── intake/
│   ├── deliverables/
│   └── communications/
├── client-beta/
│   ├── CONTEXT.md
│   ├── intake/
│   ├── deliverables/
│   └── communications/
├── templates/
│   ├── CONTEXT.md
│   ├── proposals/
│   ├── reports/
│   └── frameworks/
└── business-dev/
    ├── CONTEXT.md
    ├── pipeline/
    ├── outreach/
    └── case-studies/
```

**Client folders** — One per client. Each has its own CONTEXT.md describing the engagement, deliverables, and client-specific rules. Claude never bleeds context between clients.

**Templates** — Reusable proposal structures, report formats, analysis frameworks. Pull from here into client folders.

**Business Dev** — Pipeline, outreach drafts, case studies. CONTEXT.md describes your ideal client and positioning.

**Scaling:** When you onboard a new client, copy the folder structure, write a new CONTEXT.md, and add one row to the routing table. Done.

### Developer

```
my-app/
├── CLAUDE.md
├── planning/
│   ├── CONTEXT.md
│   ├── specs/
│   ├── architecture/
│   └── decisions/
├── src/
│   ├── CONTEXT.md
│   ├── components/
│   ├── services/
│   ├── utils/
│   └── tests/
├── docs/
│   ├── CONTEXT.md
│   ├── api/
│   ├── guides/
│   └── changelog/
└── ops/
    ├── CONTEXT.md
    ├── deploy/
    ├── monitoring/
    └── scripts/
```

**Planning** — Specs, architecture decisions, design docs. CONTEXT.md describes the app, tech stack, and architectural principles.

**Src** — The codebase. CONTEXT.md describes code structure, naming conventions, patterns, testing requirements.

**Docs** — Documentation. CONTEXT.md describes doc standards and audience per doc type.

**Ops** — Deployment, monitoring, scripts. CONTEXT.md describes infrastructure and deploy process.

### Researcher / Writer

```
my-research/
├── CLAUDE.md
├── sources/
│   ├── CONTEXT.md
│   ├── papers/
│   ├── notes/
│   └── interviews/
├── analysis/
│   ├── CONTEXT.md
│   ├── themes/
│   ├── outlines/
│   └── drafts/
└── output/
    ├── CONTEXT.md
    ├── manuscripts/
    ├── presentations/
    └── submissions/
```

**Sources** — Everything you are reading, collecting, annotating. CONTEXT.md describes the research question, key sources, and how notes should be formatted.

**Analysis** — Where thinking happens. Themes, outlines, early drafts. CONTEXT.md describes your analytical framework and writing conventions.

**Output** — Finished work. CONTEXT.md describes the target publication, format requirements, and submission details.

---

## Common Mistakes (Quick Reference)

1. **CLAUDE.md too long** — Keep it to one screen. Move everything else to workspace CONTEXT.md files.
2. **No routing table** — Without it, Claude guesses where to go. Add the table.
3. **Too many workspaces** — Start with 2-3. Add more only when a type of work proves it needs its own context.
4. **Context files describe Claude instead of the work** — Spend 80% describing the project, audience, and standards. 20% or less on behavioral instructions.
5. **Never updating context files** — They are living documents. Edit them when the project changes.
6. **One flat folder** — If you have more than 8-10 files at one level, you need subfolders.
7. **Building everything before using it** — Start with the minimum. Your first version should take 15 minutes.

---

## How to Use This Document

**For yourself:** Read it, pick the file tree closest to your work, and build your version. Edit the names and context files to match your situation.

**For Claude:** Upload this document into a Claude Project or drop it in your folder. Then say: "Read the Folder Organization Guide. I am a [your role]. Help me design my folder structure based on what I do." Claude will use the examples and principles to build something custom for you.
