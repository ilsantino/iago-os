# Workspace Blueprint — How to Read This Template

## What This Is

This is a teaching template for building **agent-native workspaces** — folder structures designed so AI agents (Claude Code, Cursor, Copilot, etc.) can drop in, understand the work, and produce high-quality output without you babysitting every prompt.

It's not a file organization system. It's a **context delivery system.**

---

## The Problem This Solves

When you give an agent a task, it needs three things:

1. **What am I doing?** (the task)
2. **How should I do it?** (reference docs, voice, standards, tools)
3. **What should I NOT load?** (everything else — context windows are finite)

Most people dump everything into one folder, write one massive prompt, and wonder why the agent loses the thread halfway through. Or they build 30 small files with no routing and the agent doesn't know which ones matter.

This system solves both problems with a **3-layer routing architecture.**

---

## The 3 Layers

```
CLAUDE.md          Layer 1: THE MAP
                   Always loaded. Shows every folder, every ID system,
                   every file placement rule. The agent's GPS.

CONTEXT.md         Layer 2: THE ROUTER
                   Top-level traffic cop. "What's your task? Go here."
                   Routes to the right workspace. Nothing more.

workspace/         Layer 3: THE WORKSPACE
CONTEXT.md         Self-contained scope. Tells the agent exactly what
                   to load for each task type within this workspace.
```

**Why 3 layers instead of 1?**

Token management. A single mega-doc wastes context on things the agent doesn't need. The 3-layer system means an agent writing a blog post never loads your deployment pipeline docs. An agent building code never loads your voice guidelines. Each layer narrows the funnel.

---

## How to Read This Template

### Step 1: Understand the architecture
Read `CLAUDE.md` and `CONTEXT.md` in this folder. Notice how they DON'T contain the actual work instructions — they just point to where those instructions live.

### Step 2: Walk one workspace
Pick `production/` (the most complex one). Read its `CONTEXT.md`. Notice how it tells you exactly what to load for each task type — and what NOT to load.

### Step 3: Follow a pipeline
Inside `production/workflows/`, read the `CONTEXT.md`. This is where sequential stages (01 → 02 → 03 → 04) hand off to each other. Each stage's output becomes the next stage's input.

### Step 4: See where tools plug in
Look for the `<!-- SKILL INTEGRATION POINT -->` and `<!-- MCP INTEGRATION POINT -->` comments throughout. These show where Claude Code skills, MCP servers, and external tools hook into the workflow — not as afterthoughts, but as first-class participants in specific stages.

### Step 5: Adapt it
Replace the example domain (a software product company) with your own work. The patterns are the same whether you're making videos, writing code, running a business, or building courses.

---

## Key Concepts

### CONTEXT.md = The Agent's Entry Point
Every workspace and sub-workspace has one. It answers: "You just landed here. Here's what this place is, what you can do, and what to load for each task." Think of it as the README that agents actually read.

### Workspaces Are Siloed
Each workspace is a self-contained context. An agent working in `writing-room/` never needs to know what's in `production/docs/`. Cross-workspace flow happens through **file handoffs** (output of workspace A → input of workspace B), not through shared context.

### Docs ≠ Workflow
Reference docs (`docs/`) are loaded on demand. They contain stable knowledge — style guides, component registries, design systems. Workflow folders (`workflows/`) contain the moving parts — stages, pipelines, active work. Separating these means an agent doing creative work loads the voice guide but not the deployment checklist.

### Skills Aren't Just .md Files
People think Claude Code skills are just markdown instructions. Some are. But skills work best when they're **wired into your CONTEXT.md routing** — the CONTEXT tells the agent WHEN to invoke a skill, not just that it exists. A skill for "review this draft" is 10x more useful when your pipeline's Stage 04 says "load the review skill here." You can wire up to 15 skills per workspace. They can be:

- **Stage-specific skills** — invoked at one pipeline step (e.g., a "build" skill at Stage 03)
- **Workspace-wide skills** — available for any task in the workspace (e.g., a "voice check" skill)
- **Cross-workspace skills** — referenced from multiple workspaces (e.g., a "humanizer" skill)
- **Tool-wrapping skills** — skills that configure how an MCP or external tool gets used

### MCPs Extend What Agents Can Do
MCP servers give agents new capabilities — web search, file conversion, API access, design tools. Like skills, they're most powerful when your CONTEXT.md tells agents WHEN and WHERE to use them, not just that they're installed.

### File Naming = State Tracking
Instead of a database or project management tool, file names track progress:
- `draft-v1.md` → `draft-v2.md` → `final.md`
- `M1-outline.md` exists? Module 1 is at outline stage.
- `M1-script.md` exists too? Module 1 is at script stage.

Glance at a folder, know the status. No dashboard required.

---

## Template Structure

```
workspace-blueprint/
├── START-HERE.md              ← You are here
├── CLAUDE.md                  ← Layer 1: The map (annotated)
├── CONTEXT.md                 ← Layer 2: The router (annotated)
│
├── writing-room/              ← Workspace A: ideas → polished drafts
│   ├── CONTEXT.md
│   ├── docs/
│   └── ...
│
├── production/                ← Workspace B: staged pipeline with tools
│   ├── CONTEXT.md
│   ├── docs/
│   ├── workflows/
│   └── ...
│
├── community/                 ← Workspace C: multi-format output hub
│   ├── CONTEXT.md
│   ├── docs/
│   └── ...
│
└── _examples/                 ← Concrete filled-in examples
```

---

## Who This Is For

- **Creators** building content systems (video, writing, courses, podcasts)
- **Developers** structuring repos for AI-assisted development
- **Teams** who want agents to work consistently across projects
- **Anyone** tired of re-explaining context to AI every single conversation

The domain in this template is fictional (a software product company). Replace it with yours. The architecture transfers.
