# Workflows — The Production Pipeline

<!--
=======================================================================
TEACHING NOTE: This is a SUB-WORKSPACE CONTEXT.

This pattern appears when a workspace has its own internal routing.
Production has 4 stages, each with different inputs, outputs, and tools.
This CONTEXT.md routes agents to the right stage.

THE KEY PATTERN: Each stage's output becomes the next stage's input.
The agent at Stage 03 reads from 02-specs/, not from 01-briefs/.
Forward flow. No backtracking without explicit re-trigger.

This is also where you see STAGE-SPECIFIC SKILL INTEGRATION.
A skill might only activate at one stage. The pipeline CONTEXT
is where you wire that up.
=======================================================================
-->

## What This Folder Is

Four stages, each in its own folder. An agent enters one stage, does its work, and outputs to the next.

```
01-briefs/  →  02-specs/  →  03-builds/  →  04-output/
  (what)        (plan)        (work)         (done)
```

---

## Agent Routing

<!--
TEACHING NOTE: This table is the core of the pipeline pattern.
It tells each agent type exactly what to read and produce.

The "Also Load" column prevents agents from loading everything.
A spec agent doesn't need the component library. A build agent does.

The "Skills at This Stage" column is where tools become contextual —
not "here are all our tools" but "HERE is the tool for THIS step."
-->

| Your Task | Input | Also Load | Output | Skills at This Stage |
|-----------|-------|-----------|--------|---------------------|
| Brief → Spec | Brief from `01-briefs/` | `../docs/tech-standards.md` | Spec in `02-specs/` | Context7 MCP (fetch library docs), Web Search MCP (research) |
| Spec → Build | Spec from `02-specs/` | `../docs/design-system.md`, `../docs/component-library.md`, `../docs/tech-standards.md` | Working build in `03-builds/` and/or `../src/` | `/frontend-design`, `/webapp-testing` |
| Build → Output | Completed build | The original spec (as acceptance criteria) | Final deliverable in `04-output/` | `/pdf` (if generating docs), `/webapp-testing` (final verification) |

<!--
TEACHING NOTE: Notice how skills ACCUMULATE as you move through stages.
Stage 02 uses research tools. Stage 03 uses build tools. Stage 04 uses
output formatting tools. The pipeline shapes WHICH tools are relevant.

This is fundamentally different from dumping all 15 skills into one
prompt. An agent at Stage 02 never sees /frontend-design because
it's not building yet — it's planning.
-->

---

## Stage Details

### 01-briefs/ — The Input

Finalized content from writing-room, copied here as the starting point. A brief says what to build and why, in plain language. It is NOT a technical spec.

**File pattern:** `[slug].md`

### 02-specs/ — The Plan

A technical plan that turns the brief into buildable requirements. The spec is a **contract** — it defines WHAT and WHEN, not HOW.

**What a spec includes:**
- Scope and acceptance criteria
- Technical approach (high-level, not line-by-line)
- Dependencies and prerequisites
- What "done" looks like

**What a spec does NOT include:**
- Exact implementation code
- Pixel-perfect layouts
- Specific library versions (unless critical)

**File pattern:** `[slug]-spec.md`

<!--
TEACHING NOTE: The spec-as-contract pattern is powerful because it
lets you swap agents between stages. The spec agent might be great
at planning. The build agent might be great at code. Neither needs
to understand the other's full context — just the spec.
-->

### 03-builds/ — The Work

Where code gets written, demos get assembled, and things get built. The builder reads the spec and the reference docs, then has full creative freedom for implementation.

**File pattern:** `[slug]/` (folder, since builds often have multiple files)

**Skills activate here:**
- `/frontend-design` — for web-based deliverables. The skill brings design intelligence (layouts, color, typography, responsive patterns).
- `/webapp-testing` — test what you build. Playwright-based browser automation to verify the demo actually works.
- Context7 MCP — if you need current docs for a library mid-build.

<!--
TEACHING NOTE: This is where MCPs shine. An agent building a React
demo can use Context7 to pull the latest React docs mid-build,
without you pre-loading them. The MCP extends what the agent can
reach without bloating the initial context.

Skills like /frontend-design aren't just "available" — the pipeline
CONTEXT tells the agent "you're at Stage 03, these tools are for
this stage." That's the difference between a skill existing and a
skill being used effectively.
-->

### 04-output/ — The Deliverable

Finished, verified work. Nothing lands here without passing the spec's acceptance criteria.

**File pattern:** `[slug]-v[n].[ext]`

The version number increments with each revision. `v1` is the first complete output. `v2` is after first round of feedback. And so on.

---

## Pipeline Rules

1. **Flow is forward.** Briefs → specs → builds → output. No skipping stages.
2. **Each agent loads only what it needs.** See the routing table above.
3. **Changes propagate forward.** Changed brief → regenerate spec. Changed spec → rebuild.
4. **The builder has creative freedom within standards.** The spec defines the contract. The builder decides how to implement it. Reference docs set the quality floor.
5. **Nothing ships untested.** Use `/webapp-testing` or manual verification before moving to `04-output/`.

---

## Where Skills Wire Into the Pipeline (Summary)

<!--
TEACHING NOTE: This is the "skill map" — a visual summary of which
tools activate at which pipeline stage. It's redundant with the
routing table above, but some people learn better from a visual layout.

This pattern scales. If you add a Stage 05 (deploy), you'd add
deployment skills here. If you add a review gate between 03 and 04,
you'd add review skills at that gate.
-->

```
01-briefs/          02-specs/           03-builds/          04-output/
                    ┌─────────────┐     ┌─────────────┐     ┌──────────┐
                    │ Context7    │     │ /frontend-  │     │ /pdf     │
                    │   MCP       │     │  design     │     │          │
                    │             │     │             │     │ /webapp- │
                    │ Web Search  │     │ /webapp-    │     │  testing │
                    │   MCP       │     │  testing    │     │  (final) │
                    │             │     │             │     │          │
                    │             │     │ Context7    │     │          │
                    │             │     │   MCP       │     │          │
                    └─────────────┘     └─────────────┘     └──────────┘
```
