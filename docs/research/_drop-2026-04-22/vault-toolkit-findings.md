# Vault Toolkit — Findings

Source: `docs/research/_drop-2026-04-22/files/vault-toolkit/vault-toolkit/`
Date: 2026-04-21

---

## 1. Constraint Files

### Common Skeleton

All 8 constraints follow this exact structure:

```
# Constraint NN: [Problem Statement as Frustration]

## The Problem        — one paragraph, names the failure mode precisely
## Layer 1: Principles That Predate AI   — classical framework (Parnas, Orwell, Deming, Brooks)
   Traditional tools that handle this   — deterministic/cheap tools to exhaust first
## Layer 2: Existing Skills and Tools   — community skills, MCP servers, purpose-built software
## Layer 3: The Architectural Fix       — ICM structural answer; this is the payload
## Tuning Questions                     — 3 questions, each targets a decision the reader must make
## Quick Reference                      — table: "If this is your situation → start here"
```

Length: 100–145 lines. Every constraint is self-contained — reads standalone, no dependency on the others.

### Three-Layer Structure (60/30/10)

README: "Roughly 60% of the problems people throw at AI are better solved by traditional tools... Another 30% are handled well by rule-based systems... Only about 10% genuinely benefit from the probabilistic reasoning that a language model provides."

Each constraint operationalizes this by presenting Layer 1 (traditional tools) and Layer 2 (rule-based / purpose-built) before Layer 3 (AI architecture). The reader is explicitly routed away from AI if a cheaper layer handles it. Constraint 06 (`06-layer-triage.md`) makes the 60/30/10 heuristic explicit with a 3-question diagnostic:

> 1. Is the answer deterministic? → spreadsheet/DB.
> 2. Can it be expressed as if/then? → Zapier/Make/n8n.
> 3. Does it require judgment across unstructured information? → AI.

### Tuning-Questions Interface

The 3 tuning questions are the constraint's configuration surface. They are not rhetorical. Each one forces a decision that changes how the constraint is implemented:

- Q1 always characterizes the reader's current state ("what does your natural writing sound like?", "how many files does your workflow load at once?")
- Q2 identifies the failure mode the reader is actually experiencing ("what would make you reject a result?", "at what point does quality degrade?")
- Q3 sets scope/priority ("at what point in your workflow does X actually matter?", "how many of your projects are repeatable vs one-off?")

The answers are meant to be written down and used to adapt the Layer 3 fix before implementing it. The README states: "A constraint that does not fit your specific workflow will either be ignored or will make your output worse. Answer them before you use the file."

### Per-File One-Liners

| # | File | Core fix |
|---|------|----------|
| 01 | `01-ai-writing-patterns.md` | Three-file voice architecture (voice/tone + format patterns + never-do constraints) instead of one voice file |
| 02 | `02-output-drift.md` | Explicit Inputs/Process/Output stage contract with "Done looks like" anchor line |
| 03 | `03-context-hygiene.md` | L0–L4 five-layer context loading; never load all layers at once |
| 04 | `04-session-consistency.md` | Workspace IS the memory; filesystem externalizes state; update discipline after each session |
| 05 | `05-voice-architecture.md` | Separate voice files by job (direction vs structure vs rules) because each has different update frequency |
| 06 | `06-layer-triage.md` | 60/30/10 diagnostic: run the 3-question filter before reaching for AI |
| 07 | `07-scaling-vs-automating.md` | Automate throughput tasks; scale judgment tasks by making context accessible (documentation), not by removing humans |
| 08 | `08-handoff-readiness.md` | Self-documenting structure: numbered stages + output/ handoff points + CLAUDE.md Key Decisions = workspace you can hand off without a meeting |

### Highest Relevance to iago-os: 4 Constraints That Apply Directly

**1. Constraint 06 — Layer Triage**
iago-os has 37 skills and an 842-line pipeline. Nothing in the system explicitly asks "should this be a Lambda, a spreadsheet formula, or an n8n workflow?" before routing to AI. The 60/30/10 diagnostic is missing from the planning phase. Constraint 06 provides that gate.

**2. Constraint 03 — Context Hygiene**
The five-layer L0–L4 model maps directly to iago-os files: CLAUDE.md = L0, CONTEXT.md = L1, plan files = L2, `.claude/rules/` = L3, working source files = L4. But iago-os rules files are organized by *domain* (react, amplify) not by *loading pattern* (always-loaded vs selectively loaded per task). Nothing in iago-os currently enforces which rules files load for which plan type. Constraint 03's loading discipline would reduce plan-session token bloat.

**3. Constraint 08 — Handoff Readiness**
Client workspace delivery is a core iago-os output. The existing `/iago-scaffold` skill produces directory structure, but there is no self-documenting architecture pattern — no "Key Decisions" section in CLAUDE.md, no numbered stage folders with explicit output/ handoff points, no `_config/` vs `_references/` separation that persists across client engagements. This constraint maps directly to what scaffolded client projects should look like.

**4. Constraint 04 — Session Consistency**
iago-os has STATE.md, but the update discipline (2-minute end-of-session update with done/decided/next) is not enforced. The constraint's pattern — "the workspace IS the memory" — is already the iago-os model, but the concrete habit (3-bullet session log per plan run) is missing. This is the `learnings/` loop that iago-os acknowledges as broken.

---

## 2. Reference Architectures

### Shape of a Reference Architecture

Each architecture is a pair: `CLAUDE.md` (L0: entry point + orientation) + `CONTEXT.md` (L1: workflow routing). Combined they are under 150 lines. The architecture is studied, not copied — the README says "these are reference pieces, not templates."

**CLAUDE.md structure (L0):**
```
# [Workspace Name]
## What This Is     — one paragraph, who it's for, what it produces
## Current State    — 3 lines: what's done, in progress, next (updated per engagement)
## Structure        — annotated folder tree, one-line per folder
## How to Use       — 5 numbered steps (imperative, action-first)
## Key Decisions    — bullet list of WHY choices were made (explicit ADRs)
## Layer Annotations — maps each file to L0-L4 (always loaded, selectively loaded, etc.)
```

**CONTEXT.md structure (L1):**
```
## Overview         — one paragraph, pipeline name and stage count
## Stage Map        — table: Stage | Purpose | Key Inputs | Output Location | [Client Checkpoint]
## How Stages Connect — prose on 01→02, 02→03, feedback loops
## Reference Material — what lives in _config/ and _references/
## When to Add Stages — explicit guidance on adding stages vs keeping lean
```

Each stage folder has its own `CONTEXT.md` (L2: stage contract) with Inputs / Process / Output / "Done looks like."

**Separator conventions:**
- Numbered prefix (`01_`, `02_`) = workflow stages, executed in order
- Underscore prefix (`_config/`, `_references/`, `_templates/`) = support/reference material, never a stage
- `output/` subdirectory inside each stage = the explicit handoff point between stages

### client-delivery vs iago-os Current State

| Dimension | client-delivery architecture | iago-os today |
|-----------|------------------------------|---------------|
| Workspace entry point | `CLAUDE.md` — what it is, current state, key decisions | `CLAUDE.md` — standards, stack, workflow (but no "current state" section, no key decisions) |
| Workflow routing | `CONTEXT.md` — stage map table, how stages connect | No equivalent — pipeline is in `scripts/execute-pipeline.sh`, not a navigable document |
| Stage contracts | `01_discovery/CONTEXT.md` through `04_handoff/CONTEXT.md` | Plan files (`.iago/plans/01.md`) — exist but not co-located with stages, no standard Inputs/Process/Output contract |
| Handoff points | `output/` dirs as explicit handoff between stages | No equivalent — pipeline steps chain via scripts, not filesystem artifacts |
| Config separation | `_config/` (engagement-specific) vs `_references/` (reusable across engagements) | `.iago/context/` for project-level, `.claude/rules/` for cross-project — separation exists but not per-engagement |
| Key decisions doc | `CLAUDE.md ## Key Decisions` section (ADRs inline) | Not present — rationale for architectural choices is undocumented |
| Layer annotations | Explicit L0–L4 label on every file | Not present — files load implicitly without declared layer |
| Scope for client engagements | One workspace copy per engagement | One `.iago/` per project — client context not isolated per engagement within a project |

Biggest gap: iago-os has no per-engagement workspace copy pattern. When iaGO delivers to a client, the client's context lives in `.iago/context/` mixed with all plans — there is no "copy this folder, rename to client-name-q2-2026" affordance.

### What iago-os's Own Architecture Doc Would Contain

If iago-os were described as a reference architecture in this format:

**CLAUDE.md would need:**
- `## What This Is` — Claude Code config layer for a 3-person AI consultancy; produces shipped client features via PR-based pipeline
- `## Current State` — replaced by STATE.md (already exists, but STATE.md is not CLAUDE.md)
- `## Structure` — annotated map of `.claude/`, `scripts/`, `.iago/`, `clients/`
- `## How to Use` — 5 steps: `/iago-scaffold` → `/iago-init` → `/iago-plan` → `/iago-execute` → `/iago-verify`
- `## Key Decisions` — WHY: pipeline over in-session execution (no context bleed, audit trail), WHY: opus for impl/sonnet for PR (cost vs quality routing), WHY: Amplify Gen 2 only (single CF manager), WHY: stack fixed (consistency across clients)
- `## Layer Annotations` — CLAUDE.md=L0, rules/=L3, plans/=L2, working source=L4

**CONTEXT.md would need:**
- Stage map: Scaffold → Init → Plan → Execute → Verify
- How stages connect (plan output is execute input; execute output is PR; verify closes phase)
- Where human review happens (PR merge is always human; async review-fix loop is never auto-merge)

This document does not currently exist. The 842-line CLAUDE.md mixes L0 (orientation) with L3 (rules) because there is no separation.

---

## 3. Skill Starters — Diagnostic Pattern

### What Makes Them "Diagnostic"

Regular skills receive a task and execute it. Diagnostic skills withhold execution until they have answers to questions that change what gets built. The content-production-builder has an explicit note: "Do not build anything before completing the diagnosis. The questions are the skill."

Three structural features distinguish diagnostic skills:

1. **Phase 1 is questions-only.** No files written, no code generated, no artifacts produced. The entire first phase is interrogation. Questions are asked one at a time; the skill waits for each answer before asking the next.
2. **Answers change the output structure.** The builder does not produce a generic template — it produces a workspace shaped to the answers. If the user describes 2 steps, it builds 2 stages. If they describe 6, it flags that as over-decomposition.
3. **Phase 3 orients, not just delivers.** After building, the skill walks the user through what it built and why, pointing to the highest-impact thing to do first. It does not stop at artifact creation.

### Question Pattern

Each diagnostic skill uses 6 questions across two axes:

**Axis 1 — Current reality (what exists now):**
- "What do you [deliver / produce / do repeatedly]?" — characterizes the core work
- "How does [work / content / engagement] start/come in?" — characterizes the intake
- "What happens between [receiving] and [delivering]?" — maps the actual process steps

**Axis 2 — Failure modes and constraints (what breaks):**
- "What kills [engagements / quality / handoffs]?" — explicitly names failure modes; these become the rationale for stage design decisions
- "What reference material stays the same?" — identifies L3 (stable config) vs L4 (per-run working material)
- "What does 'done' look like?" — defines the acceptance criteria for the output directory

The failure-mode question is the highest-signal question in every skill. The client-delivery builder's assembly phase says: "Write CLAUDE.md... Key decisions... citing their failure mode answers as rationale." The failure modes the user names become the documented WHY behind the workspace design.

### Which iago-os Skills Would Benefit from a Diagnostic Variant

Three candidates with clear fit:

**1. `/iago-scaffold` → `/iago-scaffold-diagnostic`**
Current: produces a directory structure from a client name. No questions asked.
Diagnostic upgrade: ask 6 questions (what does this client's core work involve, how do they receive work, what are the delivery stages, what reference material repeats across engagements, what are the common failure modes in this domain, how many people on the team) before writing any files. The answers shape the stage count, naming conventions, and `_config/` contents.

**2. `/iago-plan` → diagnostic pre-phase**
Current: runs from a prompt or file. Asks `--discuss` for clarification but this is optional and unstructured.
Diagnostic upgrade: a structured 5-question Phase 1 before any plan is written — what is the scope, where does this touch existing code, what are the acceptance criteria, what would make you reject this implementation, what are the dependencies. Maps directly to the tuning-questions interface from constraint 02 (output drift prevention).

**3. `/iago-init` → diagnostic first-time setup**
Current: bootstraps `.iago/` directory. Produces PROJECT.md and ROADMAP.md templates.
Diagnostic upgrade: ask about delivery model (project-based vs retainer), team composition (solo vs pair), client handoff expectations (repo access vs hosted vs documented), and known failure modes in the domain. These answers populate the `## Key Decisions` section in the generated CLAUDE.md — making the rationale behind the workspace setup self-documenting from day one.

---

## 4. iago-os Fit (Per Pattern)

| Pattern | Adopt / Adapt / Skip | iago-os mapping |
|---------|---------------------|-----------------|
| Constraint file format (8-section skeleton) | **Adapt** | `.claude/rules/` files already exist but use domain org (react, amplify) not problem org. New constraint files should follow the 8-section skeleton. Existing domain rules stay as-is; new cross-cutting rules use constraint format. |
| 60/30/10 three-layer structure | **Adopt** | Add as a planning gate in `/iago-plan`. Before writing plan tasks, the Layer 1/2 check should explicitly ask whether any step is better served by a spreadsheet, n8n workflow, or existing library rather than custom Lambda/AI logic. |
| Tuning-questions interface | **Adopt** | Add 3 tuning questions to each new `.claude/rules/` file and to skill starters. Currently iago-os skills have "When to use / When NOT to use" but no "answer these before using" config surface. |
| L0–L4 layer model + loading discipline | **Adopt** | Map iago-os files explicitly: CLAUDE.md=L0, plans=L2, rules/=L3 (selectively loaded), source=L4. Add layer annotations to `.claude/rules/available-skills.md` and CLAUDE.md. Document which rules files load per plan type vs always-loaded. |
| Reference architecture pair (CLAUDE.md + CONTEXT.md) | **Adopt for clients** | `/iago-scaffold` should produce a `CLAUDE.md` + `CONTEXT.md` pair at project root that follows this format — numbered stage folders, `_config/` vs `_references/` separation, layer annotations. Currently `/iago-scaffold` produces neither. |
| `## Key Decisions` ADR section in CLAUDE.md | **Adopt** | Add to both the iago-os root CLAUDE.md and to the generated CLAUDE.md that `/iago-scaffold` creates per client. This is the "learnings loop" fix — rationale is documented at creation time, not retroactively. |
| `output/` handoff directories | **Skip** | iago-os uses git + PRs as the handoff mechanism. Output directories would duplicate the PR artifact trail. Not appropriate for a code-focused pipeline. |
| Stage-by-stage CONTEXT.md contracts | **Adapt** | Plan files (`.iago/plans/01.md`) are already stage contracts. They should be reformatted to include an explicit `## Inputs / ## Process / ## Output / ## Done looks like` section. This is the drift-prevention fix from constraint 02. |
| Diagnostic skill pattern (Phase 1 = questions, no building) | **Adopt for 3 skills** | `/iago-scaffold`, `/iago-plan --feature`, and `/iago-init` are the candidates. Diagnostic phase should use the 6-question structure: core work, intake, steps, failure modes, stable reference material, definition of done. |
| `_config/` vs `_references/` separation | **Adopt for clients** | Currently `.iago/context/` is flat. Split into `_config/` (this-engagement-specific) and `_references/` (reusable across engagements for this client type). Separates volatile from stable reference material. |
| Session log discipline (3 bullets: done/decided/next) | **Adopt** | This is exactly what STATE.md should contain but currently drifts. Formalize the pattern: at pipeline completion, auto-append to STATE.md with done/decided/next format. The pipeline's step 6 (Summary) should enforce this. |
| Voice architecture (3 files: direction + structure + constraints) | **Skip** | iago-os is a code delivery system, not a content production system. Voice architecture applies to content skills (`/content-engine`, `/iago-proposal`) but not to the core delivery pipeline. |
| Scaling vs automating distinction | **Adopt as a review criterion** | Add to the adversarial review checklist (stage 3): "Does any step in this plan automate a judgment task that should remain human?" The constraint 07 scaling audit maps to iago-os's existing concern about pipeline quality degrading when human review checkpoints are removed. |

---

## 5. Biggest Integration Idea

**Reshape iago-os around the constraint layer as the missing third tier.**

iago-os currently has two organizational tiers: rules files (domain-scoped: react, amplify, tdd) and skills (action-scoped: iago-plan, iago-execute, iago-scaffold). What it lacks is a *problem-scoped* tier that sits above both — files that activate when a specific failure mode is detected, regardless of domain.

The Vault Toolkit's constraint format provides exactly this. Concretely: create a `.claude/constraints/` directory with 4–6 files structured around iago-os's known failure modes — context overload (maps to 03), plan drift (maps to 02), layer misrouting (maps to 06), handoff opacity (maps to 08), session state decay (maps to 04). Each file follows the 8-section skeleton: problem definition, L1 classical fix, L2 tool fix, L3 architectural fix, and 3 tuning questions. These constraints are not loaded every session — they are loaded selectively when the orchestrator detects the relevant failure mode, or referenced explicitly by skills (e.g., `/iago-plan` loads the plan-drift constraint at phase start). The tuning-question interface then becomes the configuration surface for each skill, replacing the current implicit "when to use / when not to use" table with explicit answers the operator provides before execution. Combined with the diagnostic skill pattern for `/iago-scaffold` and `/iago-init`, this transforms iago-os from a tool that executes workflows into a system that first asks whether the workflow is the right one.

---

*Sources: all files under `docs/research/_drop-2026-04-22/files/vault-toolkit/vault-toolkit/`*
