# Workflows + workspace blueprint findings

---

## 1. Production CLAUDE.md patterns

### Shape of a great CLAUDE.md

All five production examples follow the same skeleton:

1. **One-sentence identity** — what the workspace/project is and who it serves. No preamble.
2. **Workspaces / Active clients** — named folders, one-liner per folder, current phase/status.
3. **Routing table** — `| Task | Go to | Read | Skills |`. This is the centrepiece. Every example has it.
4. **Naming conventions** — explicit file-name patterns per artifact type.
5. **Rules / Avoid / Critical rules** — hard constraints, usually 4-6 bullets. Many use NEVER in caps.
6. **Domain-specific section** — Voice/Style (content), Commands (dev), Process steps (consulting), Key sources (research), Positioning (business).

**Lengths:** All examples run 40-80 lines of actual content. None exceed ~120 lines total with fences.

**Difference from iago-os CLAUDE.md:**

- iago-os CLAUDE.md is 199 lines and contains operational detail (review pipeline stages, memory routing, model routing, execution discipline rules) that production examples keep in separate rule files.
- Production examples keep CLAUDE.md as a **navigation layer only** — routing table + conventions + hard rules. Operational depth lives in workspace CONTEXT.md files or docs.
- Production examples always have a **Commands table** (dev example, `workflow-starter-code-project.md` lines 69-80) — iago-os CLAUDE.md has no quick command reference.
- Production examples include a **Current State / Current Status section** (`workflow-starter-code-project.md` lines 98-102) so the agent knows what's in progress vs. complete without reading STATE.md.

---

## 2. Workflow starter skeleton (common + variant)

### Common skeleton across all three starters

Every starter defines exactly the same four elements:

| Element | Purpose |
|---------|---------|
| Folder structure ASCII tree | Physical layout; agent knows where to create files |
| CLAUDE.md (root) | Identity + Routing table + Naming conventions + Rules |
| Per-workspace CONTEXT.md | Self-contained operating instructions for that silo |
| `client-template/` or equivalent | Copy-paste onboarding for new items |

The routing table appears in BOTH CLAUDE.md (global map) and each workspace CONTEXT.md (local refinement). This intentional duplication is small (one table) and serves different readers.

### What varies by domain

| Domain | Variant section |
|--------|----------------|
| Client management (`workflow-starter-client-management.md` lines 93-131) | `CONTEXT.md` per client with: engagement type, what good looks like, client-specific tone/sensitivities, review process |
| Code project (`workflow-starter-code-project.md` lines 107-149) | `planning/CONTEXT.md` includes a **spec template** (Problem / Proposal / Scope / Dependencies / Open questions) and a **decision record template** (Decision / Context / Options / Rationale / Consequences) |
| Content pipeline (`workflow-starter-content-pipeline.md` lines 79-104) | `script-lab/CONTEXT.md` includes "What good looks like" and "What bad looks like" examples — a quality benchmark pattern |

### How they compose with CLAUDE.md

CLAUDE.md = the GPS. It never changes per task. It routes to workspace. CONTEXT.md = the cockpit for that workspace. It tells the agent exactly what to load and skip for each task type within the workspace. CLAUDE.md delegates to CONTEXT.md; CONTEXT.md never duplicates CLAUDE.md.

---

## 3. Workspace blueprint

### START-HERE pattern

`START-HERE.md` (`workspace-blueprint/START-HERE.md` lines 1-135) is a **meta-entry point** — it explains the architecture of the workspace before the agent touches any real work. Key insight from line 14: "It's not a file organization system. It's a context delivery system."

The START-HERE convention solves iago-os's "no Day 1 start here" pain directly. It is distinct from CLAUDE.md (the always-loaded map) — START-HERE is a one-time orientation document that humans and agents read to understand the system before using it.

### CONTEXT.md vs CLAUDE.md split

The blueprint formalises a 3-layer architecture (`START-HERE.md` lines 27-43):

```
CLAUDE.md     Layer 1: THE MAP      — always loaded, folder structure, naming, cross-workspace flow
CONTEXT.md    Layer 2: THE ROUTER   — top-level traffic cop, 30-50 lines, routes to workspaces
workspace/
  CONTEXT.md  Layer 3: THE WORKSPACE — self-contained, 25-80 lines, task-specific load/skip table
```

The root CONTEXT.md (`workspace-blueprint/CONTEXT.md` lines 1-75) is intentionally thin — its sole job is "what's your task → go here." It contains no operational detail. That detail lives in Layer 3.

The `_examples/03-context-md-anatomy.md` formalises the CONTEXT.md template:

```
1. What This Workspace Is (1-2 sentences)
2. What to Load (table with SKIP column — "Skip column matters more than Load column")
3. Folder Structure (this workspace only, not whole project)
4. The Process
5. Skills & Tools (with When trigger column)
6. What NOT to Do (earned anti-patterns, not imagined ones)
```

The SKIP column is called out explicitly as the most important element (`_examples/03-context-md-anatomy.md` lines 63-66): "NOT loading the wrong thing is critical — it saves tokens and prevents confusion."

### Multi-room organization

Three workspaces model two distinct patterns (`community/CONTEXT.md` teaching note, lines 1-18):

- **Pipeline pattern** (`production/`): sequential stages 01→02→03→04 where each stage's output is the next stage's input. Skills are stage-specific.
- **Hub pattern** (`community/`): same input repurposed into multiple output formats. Skills are format-specific, not stage-specific. No pipeline ordering required.

Cross-workspace handoff is explicit and documented in BOTH directions (`_examples/04-common-mistakes.md` lines 56-62): writing's CONTEXT says "Final drafts go to `../production/workflows/01-briefs/`" AND production's CONTEXT says "Briefs come from `../writing-room/final/`". Bi-directional documentation prevents the "agent in production writes its own brief" failure mode.

### _examples adapter pattern

The `_examples/` folder is a **teaching layer separate from the working system**. It contains:

- `01-how-to-adapt-this.md` — workspace identification exercise (phases of work, not file categories) + 3-layer build steps
- `02-skill-integration-patterns.md` — 5 wiring patterns: Pipeline Gate, Stage Specialist, Format Trigger, Always-On Reference, Cross-Workspace Skill
- `03-context-md-anatomy.md` — canonical CONTEXT.md template + size guidelines (25-80 lines target, 120+ = split)
- `04-common-mistakes.md` — 8 failure modes with fixes

Key from `_examples/01-how-to-adapt-this.md` lines 5-6: "Your workspaces should map to **phases of work**, not categories of files." This is the single most clarifying design principle in the entire blueprint.

### claude-office-skills-ref lessons

This is a **reference implementation** of a skills-based CLAUDE.md, not a workflow template. What it demonstrates:

1. **Mandatory skills-check pattern** (`skills-system.md` lines 3-13): Before writing ANY code, check if a skill exists → if YES, read SKILL.md and follow exactly → only then proceed with custom code. This is a stronger version of iago-os's skill invocation rule.
2. **SKILL.md as a contract** — each format has a SKILL.md that the agent reads completely before starting. No partial reads. This maps to iago-os's plan files but the "read completely before starting" constraint is more explicit.
3. **Output directory convention** (`claude-office-skills-ref/CLAUDE.md` lines 63-70): all skill-generated files go to `outputs/<document-name>/`. Clean separation of working files from source.
4. **Two-phase OOXML pattern**: unpack → edit → validate → pack. The validate step is mandatory before pack. This is structurally identical to iago-os's build-gate-before-PR rule.
5. **Commands table in CLAUDE.md** (`claude-office-skills-ref/CLAUDE.md` lines 113-200): comprehensive quick-reference for every common operation. Developers open CLAUDE.md to find the exact command, not to re-derive it.

The skills-system prompt verbatim (`skills-system.md` lines 1-105) reveals that this repo ports Anthropic's internal desktop-Claude skill injection mechanism to CLI. The `<available_skills>` block with skill names, trigger conditions, and SKILL.md paths is exactly how iago-os's skill catalog should be structured.

---

## 4. Animation spec templates — relevance

`animation-spec-templates.md` contains two spec templates (long-form 5+ min, short-form under 60s) for driving Remotion animation builds. The templates are structured around:

- **Beat map** — timestamp-aligned script excerpts with visual description, emphasis, mood, and transition per beat
- **Visual philosophy** — colour palette, typography, motion principles as a reference header
- **Key moments** — 3-5 beats that must land; prioritisation signal for the builder
- **Audio sync points** — exact word/timestamp triggers for animation events
- **Spec generation prompt** — a meta-prompt for Claude to produce the first spec draft from a raw script

Relevance to iago-os: **limited but non-zero.** iago-os already has a `/remotion-animation` skill. This template is the missing **input spec format** for that skill — the contract between creative direction and animation build. Without a spec template, the remotion skill receives unstructured prompts and makes arbitrary visual decisions.

The broader pattern — a **domain-specific spec template that acts as a contract between requester and builder** — is highly relevant. The code project starter's planning CONTEXT.md already uses this (Problem/Proposal/Scope/Dependencies template). The same pattern could be applied to iago-os plan files: a canonical spec structure that both `/iago-plan` and `/iago-execute` treat as a contract.

---

## 5. iago-os fit

### Adopt

| Pattern | Source | iago-os mapping |
|---------|--------|----------------|
| **CONTEXT.md per workspace (25-80 lines, with Skip column)** | `_examples/03-context-md-anatomy.md` lines 10-51 | Add `clients/{name}/CONTEXT.md` per client project. `.iago/context/` already exists but has no standardised structure. |
| **Routing table in CLAUDE.md with Skills column** | `production-claude-md-examples.md` lines 27-36 | CLAUDE.md already has a routing table but no Skills column showing which skill to invoke per task. Adding that column would make the "Execution Path" table and the "Skills" section redundant. |
| **Mandatory skip column on every load table** | `_examples/03-context-md-anatomy.md` lines 63-66; `_examples/04-common-mistakes.md` lines 14-19 | `.claude/rules/` files list what to do but never say what NOT to load. Every rules file gains a "Skip when" note. |
| **Commands quick-reference table in CLAUDE.md** | `workflow-starter-code-project.md` lines 69-80; `claude-office-skills-ref/CLAUDE.md` lines 113-200 | CLAUDE.md has no command reference. Add a Commands table: `tsc --noEmit`, `vite build`, `npx biome check`, `amplify sandbox`, `npx vitest run`, `npx playwright test`. Reduces friction for new context windows. |
| **Current State section in CLAUDE.md** | `workflow-starter-code-project.md` lines 98-102 | Add a lightweight "Current State" section (or pointer to STATE.md) so agents know project phase without loading STATE.md first. |

### Adapt

| Pattern | Source | iago-os mapping |
|---------|--------|----------------|
| **3-layer architecture (CLAUDE.md / root CONTEXT.md / workspace CONTEXT.md)** | `START-HERE.md` lines 27-43; `_examples/01-how-to-adapt-this.md` | iago-os already has CLAUDE.md (Layer 1) and `.claude/rules/` (partial Layer 3). Missing: a **root CONTEXT.md** (Layer 2) that is a thin task router. Today CLAUDE.md does Layer 1 + 2 + much of 3, causing the 199-line bloat. Solution: extract the routing section from CLAUDE.md into `CONTEXT.md`, keep CLAUDE.md to map + conventions only. |
| **START-HERE.md as orientation document** | `START-HERE.md` lines 1-60 | iago-os has no Day 1 orientation. A `docs/START-HERE.md` (or `.iago/START-HERE.md`) that explains the three-layer architecture, points to skills catalog, and walks through a first task would fix the "doc drift" pain. Narrower than the blueprint's START-HERE — no need to explain the architecture to users, only to new Claude sessions and new collaborators. |
| **_examples/ adapter for templates/** | `_examples/` folder (4 files) | iago-os's `templates/` folder has client-project, internal-project, memory. Add a `templates/_examples/` or `templates/_how-to-adapt.md` that gives the "phases of work not file categories" framing and shows a filled-in example per template type. Resolves the "copy-paste but don't know what to keep" problem on onboarding. |
| **Skill wiring in CONTEXT.md (Stage Specialist + Pipeline Gate patterns)** | `_examples/02-skill-integration-patterns.md` lines 17-46 | iago-os skills are listed in CLAUDE.md's Skills section and in `.claude/rules/available-skills.md` but are not wired into per-workspace CONTEXT.md files with trigger conditions. The `execute-pipeline.sh` does this implicitly via stage numbers. Making it explicit in a client project's CONTEXT.md would help: "Stage 02 spec → invoke `/iago-plan --feature`; Stage 03 build → invoke `/iago-execute`." |
| **Animation spec template** | `animation-spec-templates.md` full file | Adapt as input spec format for `/remotion-animation`. Create `templates/remotion-spec.md` (beat map + visual philosophy + key moments). Wire into `/remotion-animation` skill preamble: "If no spec provided, generate one using `templates/remotion-spec.md` before building." |
| **Quality benchmark ("what good looks like / what bad looks like")** | `workflow-starter-content-pipeline.md` lines 100-105 | Adapt for iago-os plan files: add a "Definition of done" and "Known failure modes" section to plan templates in `templates/`. Currently plans have acceptance criteria but no "what bad looks like" anti-pattern guidance for reviewers. |

### Skip

| Pattern | Source | Reason |
|---------|--------|--------|
| **Multi-room workspace splitting (writing-room / production / community)** | `workspace-blueprint/CLAUDE.md` | iago-os is an agentic dev platform, not a content studio. The writing/production/community split doesn't map. iago-os's equivalent (clients / internal / business-dev) is already present in `templates/`. |
| **Pipeline-per-client folder (intake / deliverables / communications)** | `workflow-starter-client-management.md` lines 10-37 | iago-os uses `clients/{name}/` but the internal folder structure follows Amplify Gen 2 project layout, not a consulting deliverables model. The CONTEXT.md per client is worth adopting (see above) but the folder taxonomy differs. |
| **Voice/style guide docs as always-on reference** | `writing-room/CONTEXT.md` lines 39-44 | Not applicable to dev work. iago-os already has brand/tone in CLAUDE.md's output style section. |
| **Office document skills (PPTX/DOCX/XLSX/PDF)** | `claude-office-skills-ref/` | Already handled by MarkItDown MCP for ingestion. `/iago-proposal` and `/investor-materials` cover output. The office skills repo is for projects where document manipulation is a first-class workflow — not iago-os's case. |

---

*Sources: all files read from `C:\Users\sanal\Downloads\` and `C:\Users\sanal\dev\iago-os\docs\research\_drop-2026-04-22\workspace-blueprint\workspace-blueprint\`. Line numbers cited inline per finding.*
