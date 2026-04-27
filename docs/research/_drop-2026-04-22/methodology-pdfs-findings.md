# Methodology PDFs — Findings

Sources: Interpretable Context Methodology (ICM) paper (Van Clief & McDermott, Eduba/Edinburgh),
Working Layer Blueprint (3.1 + 3.2 + 3.3), Clief Notes Skills Field Manual v1.0,
Clief Notes Resource Index v1.0.

---

## 1. Interpretable Context Methodology (ICM)

### Core thesis

The ICM paper formally names the protocol **Model Workspace Protocol (MWP)**. Central claim
(p. 1): "If the prompts and context for each stage of a workflow already exist as files in a
well-organized folder hierarchy, you do not need a coordination framework to manage multiple
specialized agents. You need one orchestrating agent that reads the right files at the right
moment." The framework is grounded in Unix pipeline design, modular decomposition, multi-pass
compilation, and literate programming.

### Named principles (with quotes and page refs)

**P1 — One stage, one job** (p. 6):
> "Each stage in a workspace handles a single step of the workflow and writes its output to its
> own folder. A stage that fetches data does not also filter it. A stage that filters does not also
> format the final output."

**P2 — Plain text as the interface** (p. 6):
> "Stages communicate through markdown and JSON files. No binary formats, no database
> connections, no proprietary serialization. Any tool that can read a text file can participate
> in the workflow. Any human who can open a text editor can inspect or modify any artifact."

**P3 — Layered context loading** (p. 6):
> "Agents load only the context they need for the current stage, following the principle that less
> irrelevant context means better model performance. This is prevention rather than compression."

**P4 — Every output is an edit surface** (p. 6):
> "The intermediate output of each stage is a file a human can open, read, edit, and save before
> the next stage runs. The human works with visible, manipulable objects, and the system picks up
> whatever the human left there."

**P5 — Configure the factory, not the product** (p. 7):
> "A workspace is set up once with the user's preferences, brand, style, and structural decisions.
> After that, each run of the pipeline produces a new deliverable using the same configuration."

**Context engineering definition** (p. 4, citing Karpathy 2025):
> "The broader discipline of filling the context window with the right information: instructions,
> retrieved knowledge, memory, tool descriptions, and prior outputs, all structured so the model
> can use them effectively."

**Inherent interpretability principle** (p. 15, citing Rudin):
> "A production pipeline where every intermediate output is a readable file is inherently
> interpretable. There is nothing to explain because nothing was hidden."

**Edit-source principle** (p. 18, future directions):
> "Editing the output fixes this run. Editing the source fixes every future run." Recurring
> output edits are diagnostic — they point to fixable source-level problems in the stage contract
> or reference material.

### Mechanisms

**Five-layer context hierarchy** (Fig. 1, p. 6):

| Layer | Token budget | Job |
|-------|-------------|-----|
| 0 — CLAUDE.md | ~800 tok | "Where am I?" — workspace identity, folder map |
| 1 — Workspace CONTEXT.md | ~300 tok | "Where do I go?" — routing table |
| 2 — Stage CONTEXT.md | 200–500 tok | "What do I do?" — stage contract |
| 3 — Reference material | 500–2k tok | "What rules apply?" — voice guides, conventions (stable across runs) |
| 4 — Working artifacts | varies | "What am I working with?" — per-run content |

Layers 3 and 4 are structurally distinct: Layer 3 is "the recipe" (internalize as constraints),
Layer 4 is "the ingredients" (process as input). Mixing them in an undifferentiated prompt forces
the model to sort them itself.

**Stage contracts** (p. 9). Each stage CONTEXT.md has three sections: Inputs (explicit list of
files by layer), Process (instructions), Outputs (named files to write). The Inputs table is the
filesystem doing what a framework does in code.

**Token efficiency** (Fig. 3, p. 9): MWP delivers 2,000–8,000 tokens per stage. Monolithic
approach loading all stages reaches 40,000+ tokens; most is irrelevant to the current task.
Cites Liu et al. (2024): models perform significantly worse when relevant information is buried in
long contexts.

**Review gates** (Fig. 4, p. 10): Human can edit any stage output before next stage reads it.
Practitioners show U-shaped intervention: heavy edits at stage 1 (direction-setting) and final
stage (alignment debugging), light in middle stages (constrained by anchors).

**Where MWP does NOT work** (p. 11):
- Real-time multi-agent collaboration (tight loops) — use AutoGen/LangGraph
- High-concurrency systems (many simultaneous users)
- Complex automated branching mid-pipeline

---

## 2. Working Layer

### What it is

The Working Layer is the practitioner-facing implementation of MWP. It is a **folder-based
workspace** with three layers that Claude reads on entry:

- **Layer 1 — The Map (CLAUDE.md)**: routing file at the project root. Tells the agent where
  everything is. Concise: routing table + naming conventions + folder map. Must fit one screen
  (40–50 lines max per Mistake 1 analysis).

- **Layer 2 — The Rooms (Workspace CONTEXT.md)**: one file per workspace area. Describes what
  happens there, the process, what files live there, what good output looks like.

- **Layer 3 — The Tools (Skills/MCP)**: skills and MCP servers plugged into workspaces where
  needed, not globally loaded.

### Mental model

A building: CLAUDE.md is the floor plan on the wall. Rooms are the workspaces. Tools are the
specialized equipment in each room. You walk in, read the floor plan, go to the right room, use
the tools for that room. Nothing from another room is visible.

### Difference vs project/context/workspace

| Concept | What it is |
|---------|------------|
| Project (Claude.ai) | Persistent knowledge base + custom instructions; 200K token knowledge base |
| Context file | The room-level instruction set for one workspace within the Working Layer |
| Workspace | A mode of work with its own folder, CONTEXT.md, and optionally its own skills |
| Working Layer | The entire folder architecture: CLAUDE.md + all workspace rooms + all wired-in tools |

A "workspace" is a room. The "Working Layer" is the whole building. A Claude.ai "Project" is
the foundation under the building (persistent, cross-conversation). The Working Layer is the
floor plan on top.

---

## 3. Customization (working-layer-customize)

### Tuning interface

Three concrete examples are given — content creator, freelancer/consultant, developer — each with
identical structural primitives but different labels:

**Step 1:** Identify 2–4 workspaces ("modes you shift between"). Writing and building are
different modes. Drafting and editing are the same mode at different stages — one workspace,
not two.

**Step 2:** Write a CONTEXT.md per workspace. Describe: what happens here, the process,
what files live here, what good output looks like. Keep it under one page.

**Step 3:** Write CLAUDE.md with routing table (task → workspace → files to read) and naming
conventions.

**Step 4:** Start working, adjust CONTEXT.md files based on what Claude gets right vs wrong.

### Decision points

From the seven common mistakes (Section 3.3):

| Decision | Rule |
|----------|------|
| CLAUDE.md length | Hard limit: 40–50 lines. Routing file only. Everything else in workspace CONTEXT.md |
| Number of workspaces | Start with 2–3. If unsure whether something needs its own workspace, it doesn't |
| Context file content ratio | 80% describing the work (project, audience, done, good output, avoid). 20% behavioral |
| When to update CONTEXT.md | "Treat context files like working notes." When project changes, edit immediately |
| First-version scope | "Your first version should take 15 minutes. If it took longer, you over-built." |
| Flat vs nested | >8–10 files at same level → add subfolders. Folder structure is the architecture |

Key quote on context file content (Mistake 4):
> "Telling Claude 'you are a senior copywriter' gives it a role. Telling Claude 'the audience is
> mid-market HR directors who have tried three other tools and are skeptical of AI claims' gives
> it something to actually work with."

---

## 4. Clief Notes — Skills Field Manual

### Core principle

> "The biggest lever in AI output quality is not the prompt. It is what information the model
> can see when it processes that prompt. Context architecture beats prompt wordsmithing every time."

Ten capabilities divided into two groups:

- **Context architecture skills** (highest leverage): Projects, Custom Skills, Claude Code + CLAUDE.md,
  MCP Connectors, Memory
- **Output mode skills**: Code Execution, Artifacts, File Creation, Web Search + Deep Research,
  Extended Thinking

### Quality bar for production-ready skills

A skill is ready to package when:
1. You find yourself copy-pasting the same instructions across 3+ conversations — that's the
   packaging signal
2. Structure: `SKILL.md` (required, YAML frontmatter with `name:` and `description:`),
   `REFERENCE.md` (supplemental), `templates/`, `examples/`, `scripts/`
3. The `description` field triggers activation. Must be written as a condition, not a label:
   "Apply Acme brand guidelines to presentations and documents, including official colors, fonts,
   and logo usage."
4. Skills encode the 30% layer (rules, templates, repeatable processes). The model fills in the
   10% (judgment where template requires it).

### Anti-patterns

From the "skip it when" clauses across all ten skills:

- Building a skill for a one-off task
- Packaging a skill before the manual process is working
- Using MCP connectors when data fits in the conversation ("the data is small enough to paste")
- Using Extended Thinking on a straightforward answer (paying for processing you don't need)
- Using Projects for one-off research that doesn't reference specific documents
- Using Memory for project-specific context (that belongs in Projects)

From the decision sequence (Section 4.1):
> "1. Do I need persistent context? Yes → Project. No → regular chat.
> 2. Do I need external data? Yes → MCP or upload. No → proceed.
> 3. Is this a repeatable process? Yes → build or use a Skill. No → prompt directly.
> 4. What output format? File → file creation. Interactive → artifact. Data → code execution. Text → talk.
> 5. Does this need deep reasoning? Yes → extended thinking. No → standard response."

### 60/30/10 framework

Referenced throughout as the layer model for AI work:

| Layer | What | Example |
|-------|------|---------|
| 60% | Deterministic code/database — runs without AI | Scripts, data processing, file handling |
| 30% | Rules and templates — repeatably structured | Skills, context files, routing tables |
| 10% | AI judgment — where genuine reasoning needed | Novel synthesis, multi-constraint decisions |

Most skills operate at the 30% layer. Skills wrap 60% execution with 30% rules, leaving 10%
for the model's judgment. The resource index applies the lens: "A mediocre prompt aimed at the
right skill outperforms a brilliant prompt aimed at nothing."

---

## 5. Clief Notes — Resource Index

### Catalog structure

Nine sections, purpose-organized ("by what you would actually use them for, not by what the
tool calls itself"):

1. How this list works (trust policy: community skills can execute code; read source before running)
2. Official Anthropic repos (authoritative; start here before building your own)
3. Community skill collections (awesome-claude-skills, superpowers, everything-claude-code, SkillsMP, AgentSkills.io)
4. MCP servers and directories (official reference, GitHub MCP, Stripe, punkpeye/awesome list, quality-ranked list)
5. Programmatic video (Remotion)
6. Frontend/UI/Design (shadcn/ui, Tailwind, Aceternity, Lucide, Recharts, v0)
7. Learning and reference (Anthropic docs, skills-explained blog post, quickstarts)
8. 60/30/10 lens (maps each category to a layer)

### Naming conventions in the index

Each entry format: repo name → one-line description → direct link → "Who it is for" note.
Quality signal used: GitHub stars + contributor count + commit frequency (via tolkonepiu
best-of-mcp-servers ranking at 410+ servers in 34 categories, updated weekly).

### Key call-out: AgentSkills.io

Open specification for skills intended to work across Claude Code, Codex CLI, and other agents.
Includes validation checklists and authoring guides. Relevant for iago-os if skills should be
portable across contexts.

---

## 6. iago-os Fit

| Principle | Source | Verdict | Reasoning |
|-----------|--------|---------|-----------|
| **One stage, one job** (P1) | ICM p. 6 | **Already adopted** | `scripts/execute-pipeline.sh` stages 0–6 each do one job. iago-os is ahead here. |
| **Plain text as interface** (P2) | ICM p. 6 | **Already adopted** | Plans in `.iago/plans/` are markdown. Stage outputs are markdown/text. |
| **Layered context loading** (P3) | ICM p. 6 | **Partially adopted — gap exists** | Rules are path-scoped (`react-vite.md` only on `src/**/*.tsx`) — correct. But CLAUDE.md at 199 lines violates the 40–50 line ceiling for a routing file. Context that belongs in rule files is mixed into CLAUDE.md. Split needed: routing + identity only in CLAUDE.md; domain detail in `.claude/rules/`. |
| **Every output is an edit surface** (P4) | ICM p. 6 | **Adopted** | Plan files, stress test outputs, review outputs are all editable markdown before next stage runs. |
| **Configure the factory, not the product** (P5) | ICM p. 7 | **Adopted** | `.iago/plans/` + `_config/` equivalent is `.iago/context/`. |
| **Five-layer hierarchy (L3/L4 distinction)** | ICM Fig. 1, p. 6 | **Adapt** | iago-os doesn't distinguish reference material (stable) from working artifacts (per-run). In practice: CLAUDE.md + rules/ = L0–L3. `.iago/plans/` = L4 working artifacts. Making this distinction explicit in CLAUDE.md's routing table would help. No code change needed — just documentation of the mental model. |
| **40–50 line CLAUDE.md ceiling** | Blueprint Mistake 1 | **Adopt — actionable** | Current CLAUDE.md is 199 lines. The Workflow, Execution Path, Review Pipeline, Memory Architecture, Agent Escalation, Execution Discipline, Rules, Skills sections are all L1–L2 content that belongs in `.claude/rules/` files. CLAUDE.md should be a routing file plus identity declaration, nothing more. This directly addresses the "doc drift" known tension. |
| **80/20 context ratio (work:behavior)** | Blueprint Mistake 4 | **Adopt** | CLAUDE.md currently over-indexes on behavioral instructions (Output Style, Execution Discipline, Model Routing) relative to project facts. Behavioral rules should stay; project topology and routing should dominate. |
| **Living context files** | Blueprint Mistake 5 | **Adopt** | No `Last updated:` markers on rule files. No mechanism for detecting stale rules. Trivial to add. |
| **Decision sequence (5-step)** | Field Manual §4.1 | **Adapt** | The iago-os skill routing table (available-skills.md) serves a similar purpose but is 200+ lines. The 5-question decision sequence is a better cognitive shortcut: persistent context? → external data? → repeatable process? → output format? → deep reasoning? Could replace or precede the skill table in CLAUDE.md. |
| **Skill packaging trigger** | Field Manual §2.2 | **Adopt** | "Copy-paste same instructions 3+ conversations = skill waiting to be packaged." This is precisely what `.iago/learnings/patterns.md` is supposed to capture but doesn't (empty skeleton). The trigger criterion gives the learnings loop a concrete activation condition: 3+ occurrences → package as skill or rule. |
| **description field as trigger condition** | Field Manual §2.2.1 | **Adopt** | iago-os skills lack standardized YAML frontmatter with a trigger-condition description. Skills are invoked by name, not by Claude reading descriptions. Not a blocker, but worth enforcing as a quality standard for new skills. |
| **60/30/10 layer model** | Resource Index §8 | **Adopt as mental model** | iago-os doesn't use this vocabulary, but the pipeline already embodies it: `scripts/execute-pipeline.sh` is 60%, `.claude/rules/` is 30%, agent judgment is 10%. Naming it would help explain the pipeline to new contributors and inform future skill design decisions. |
| **Stage contract (Inputs/Process/Outputs)** | ICM p. 9 | **Adapt** | iago-os plan files have tasks + acceptance criteria but no explicit Inputs table listing which files/layers the implementation agent should load. Adding a standard `## Context` section to plan files (pointing to relevant rule files and prior artifacts) would tighten the L3/L4 distinction and reduce context bleed between plans. |
| **Edit-source principle** | ICM p. 18 | **Adopt** | iago-os has the same problem: `.iago/learnings/patterns.md` tracks recurring review findings, but there's no mechanism to push patterns back into CLAUDE.md or rules files. The principle: "recurring output edits = diagnostic signal → fix the source file." This directly enables the learnings loop Santiago already wants. |
| **MWP workspace-builder pattern** | ICM §4.4 | **Already adopted as `/iago-scaffold`** | `/iago-scaffold` + `/iago-init` is the workspace-builder. iago-os is ahead of the framework on this. |
| **Sequential/reviewable/repeatable fit** | ICM §5.1 | **Confirmed fit** | iago-os pipeline is sequential, human-reviewed at each stage gate, and runs repeatedly per plan. MWP's described sweet spot exactly matches the iago-os use case. |
| **Where MWP doesn't work** | ICM §5.2 | **Note** | iago-os uses LangGraph + n8n for dynamic multi-agent flows — correct not to apply MWP there. The architectural split (MWP for plan pipelines, LangGraph for dynamic agent flows) is sound. |

---

## Open Questions

1. **CLAUDE.md refactor scope.** The 199→40–50 line reduction requires deciding which sections
   belong in dedicated rule files vs the routing index. The Memory Architecture section (table +
   retrieval routing) is the single biggest offender — it's L2 content that belongs in a
   `memory-routing.md` rule file.

2. **L3/L4 plan structure.** Should iago-os plan files gain a `## Context` section naming the
   rule files (L3 reference) the implementing agent should load? Would require updating plan
   templates and the pipeline's impl session prompt.

3. **Learnings loop activation criterion.** The Field Manual's "3 copy-pastes = packaging signal"
   is the concrete trigger `.iago/learnings/patterns.md` needs. But the tracking mechanism
   (who writes patterns, when) is still undefined. This is the structural gap, not the criterion.

4. **AgentSkills.io spec compliance.** If iago-os skills should be portable to Codex CLI or other
   agents, validating against the AgentSkills.io open spec would be valuable. Current skills are
   Claude Code native (`.claude/skills/`). Unknown compatibility cost.

5. **Cross-model MWP validation.** ICM paper explicitly scopes cross-model testing as future work
   (all testing on Claude Opus 4.6 / Sonnet 4.6). iago-os uses Sonnet as the orchestrator model
   for some pipeline stages — the context-loading assumptions may behave differently.
