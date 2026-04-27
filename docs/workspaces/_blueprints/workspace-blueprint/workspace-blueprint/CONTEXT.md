# Acme DevRel — Task Router

<!--
=======================================================================
TEACHING NOTE: This is LAYER 2 — THE ROUTER.

This file does ONE job: route agents to the right workspace.
It should be SHORT. 30-50 lines of actual content.

Rules for this file:
  - No detailed instructions (workspace CONTEXT.md handles that)
  - No file placement rules (CLAUDE.md handles that)
  - Just: "What's your task? → Go here. You'll also need X."

The "You'll Also Need" column is critical. It tells agents what
CROSS-WORKSPACE resources to pull. Without it, an agent building
a community post won't know to load the writing-room voice guide.
=======================================================================
-->

## What This Is

Acme's developer relations workspace. Three siloed workspaces, each handling one part of the content lifecycle.

**CLAUDE.md** (always loaded) has the full folder map and naming rules. This file routes you to work.

---

## Task Routing

| Your Task | Go Here | You'll Also Need |
|-----------|---------|-----------------|
| **Write a blog post** | `writing-room/CONTEXT.md` | Load `docs/voice.md` + `docs/style-guide.md` |
| **Write a tutorial** | `writing-room/CONTEXT.md` | Load `docs/voice.md` + `docs/audience.md` |
| **Understand the voice** | `writing-room/docs/voice.md` | — |
| **Build a demo app** | `production/CONTEXT.md` | `production/docs/` for standards |
| **Create a video** | `production/CONTEXT.md` | `production/docs/` for design system |
| **Generate a build spec** | `production/workflows/CONTEXT.md` | Brief from `01-briefs/` |
| **Look up components** | `production/docs/component-library.md` | — |
| **Write a newsletter** | `community/CONTEXT.md` | `writing-room/docs/voice.md` for tone |
| **Create social posts** | `community/CONTEXT.md` | `community/docs/platforms.md` for specs |
| **Plan an event** | `community/CONTEXT.md` | — |

---

## Workspace Summary

| Workspace | Purpose | Skills & Tools |
|-----------|---------|---------------|
| `writing-room/` | Ideas → polished drafts. Voice, research, editing. | `/humanizer`, `/doc-coauthoring`, Web Search MCP |
| `production/` | Drafts → built deliverables. 4-stage pipeline. | `/frontend-design`, `/webapp-testing`, Context7 MCP |
| `community/` | Content → distributed across platforms. | `/pptx`, `/humanizer`, platform-specific skills |

Each workspace has its own CONTEXT.md with full details. Read that when working in a workspace, not this file.

---

## Cross-Workspace Flow

```
writing-room (voice + research → drafts)
    ↓ final drafts copy to production/workflows/01-briefs/
production (brief → spec → build → deliverable)
    ↓ deliverables referenced by community/
community (repurposes into newsletters, social, events)
```

<!--
TEACHING NOTE: This diagram appears in both CLAUDE.md and CONTEXT.md.
That's intentional — CLAUDE.md shows it as part of the permanent map,
CONTEXT.md shows it as part of routing context. The duplication is
small (4 lines) and serves different readers (the always-loaded map
vs. the task-specific router).
-->
