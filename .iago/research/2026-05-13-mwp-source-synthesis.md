# MWP Source Synthesis — Canonical Ground Truth

**Date:** 2026-05-13
**Author:** Claude Sonnet 4.6 (deep-research agent)
**Sources read:** All 8 canonical MWP source files (2 workflow starters, 4 PDFs via MarkItDown, 2 zips extracted + walked)
**Purpose:** Override secondhand interpretation in v2 master prompt and routing rule docs

---

## 1. Executive Verdict

The secondhand interpretation in iaGO's v2 docs is about 70% accurate and 30% materially wrong or missing.

The L0–L4 layer names and the factory/product distinction are accurate. The multi-agent question is where the biggest misalignment lives: MWP is explicitly a **single-agent, sequential, human-reviewed** protocol. The ICM paper is unambiguous — it handles exactly the class of workflow where each step waits for human review before the next runs. It explicitly names concurrent multi-agent collaboration (AutoGen-style) and complex automated branching as cases where MWP does **not** apply and frameworks are the right tool.

The 2026-04-21 council's rejection of MWP-as-architecture for v2 was correct. MWP is a context-delivery and workspace organization protocol, not a multi-agent coordination architecture. These are not competing tools — they are different layers. Where the v2 docs go wrong is treating MWP as an architecture choice rather than a context-structuring discipline that applies inside whatever architecture you choose.

The "rooms" pattern (Eduba terminology for per-workspace CONTEXT.md files) is accurately captured in the audit but NOT in the master prompt, which never names it. The 60/30/10 framework (Eduba's task-layer heuristic) is absent from all iaGO v2 docs entirely. The working-layer blueprint (L4 pattern) is documented in the paper but mischaracterized in the master prompt as a named "layer" when the canonical term is just "working artifacts."

Key gap: the MWP source says nothing about Telegram bots. Zero references across all 8 files.

---

## 2. MWP Layered Architecture

**Primary source:** ICM paper (Van Clief & McDermott), §3.2, Figure 1, Figure 2; working-layer-blueprint.pdf; vault-toolkit architecture CLAUDE.md files

The five-layer context hierarchy is formally defined in the ICM paper Figure 1:

| Layer | Name | Question | Canonical token budget | Where it lives |
|---|---|---|---|---|
| L0 | Global identity (CLAUDE.md) | "Where am I?" | ~800 tokens | Workspace root CLAUDE.md |
| L1 | Workspace routing (CONTEXT.md) | "Where do I go?" | ~300 tokens | Workspace-level CONTEXT.md |
| L2 | Stage contract | "What do I do?" | 200–500 tokens | Per-stage CONTEXT.md |
| L3 | Reference material (factory) | "What rules apply?" | 500–2k tokens (selective) | `_config/`, `references/`, `shared/` |
| L4 | Working artifacts (product) | "What am I working with?" | Varies, "rarely exceeds a few thousand tokens" | Stage `output/` dirs, source material |

**Critical distinction the paper emphasizes (§3.2, Table 2):**

L3 is the factory. Files here (voice.md, design-system.md, conventions.md) are configured once at workspace setup and stay stable across every run. The model should internalize them as constraints.

L4 is the product. Files here (research-output.md, script-draft.md) are produced and consumed during execution, changing every time. The model should process them as input to transform.

"Mixing persistent rules with per-run artifacts in an undifferentiated context window forces the model to sort them on its own." — ICM paper §3.2

**Actual folder structure from vault-toolkit reference implementation:**

```
workspace/
  CLAUDE.md          # L0 — always loaded, ~800 tokens, orientation
  CONTEXT.md         # L1 — loaded on workspace entry, routing
  stages/
    01_research/
      CONTEXT.md     # L2 — stage contract: Inputs / Process / Outputs
      references/    # L3 — reference material stable across runs
      output/        # L4 — working artifacts from this run
    02_script/
      CONTEXT.md
      references/
      output/
    03_production/
      CONTEXT.md
      references/
      output/
  _config/           # L3 — shared reference: voice, brand, constraints
  shared/            # L3 — cross-stage reference
  setup/
    questionnaire.md
```

**Stage contract structure** (ICM paper §3.3, canonical format):

```markdown
## Inputs
- Layer 4 (working): ../01_research/output/
- Layer 3 (reference): ../../_config/voice.md
- Layer 3 (reference): references/structure.md

## Process
[Stage instructions]

## Outputs
- output-file.md -> output/
```

The Inputs table is the control mechanism of the system. It makes context selection explicit, editable, and auditable rather than relying on agent judgment.

**Total context delivered per stage:** ICM paper §3.2 quantifies this as typically 2,000–8,000 tokens. A monolithic (all-stages-in-one-prompt) equivalent reaches 30,000–50,000+ tokens, pushing into the performance degradation range documented by Liu et al. (2024) "lost in the middle."

---

## 3. Workflow Starter Templates

**Primary source:** workflow-starter-code-project.md, workflow-starter-content-pipeline.md

These are download-and-fill templates, not architecture specs. They are simplified two-layer versions of MWP (map + rooms) without the full L0–L4 nomenclature. They represent the entry-level practical implementation Eduba packages for non-technical practitioners.

**Code project starter shape:**

```
my-app/
  CLAUDE.md          # L0 — identity, tech stack, workspaces, routing table, commands, conventions
  planning/
    CONTEXT.md       # L1 — specs, architecture docs, decision records
    specs/
    architecture/
    decisions/
  src/
    CONTEXT.md       # L1 — code structure, patterns, testing requirements
  docs/
    CONTEXT.md       # L1 — audiences, standards, rules
  ops/
    CONTEXT.md       # L1 — infra, deploy, monitoring, runbooks
```

The root CLAUDE.md contains a routing table in this canonical format:

| Task | Go to | Read | Skills |
|------|-------|------|--------|
| Spec a feature | /planning | CONTEXT.md | — |
| Write code | /src | CONTEXT.md | testing |
| Write docs | /docs | CONTEXT.md | doc-authoring |
| Deploy or debug | /ops | CONTEXT.md | — |

**Content pipeline starter shape:**

```
content-pipeline/
  CLAUDE.md          # L0 — identity, workspaces, routing table, naming conventions, rules
  script-lab/
    CONTEXT.md       # L1 — what, audience, voice, process, what good looks like
    ideas/
    drafts/
    final/
  production/
    CONTEXT.md       # L1 — what gets produced, tools, process, visual standards
    specs/
    builds/
    output/
  distribution/
    CONTEXT.md       # L1 — platforms, rules, posting cadence
    ready-to-post/
```

**How iaGO's `.iago/plans/`, `.iago/research/`, `.iago/runbooks/` map onto these:**

They don't map cleanly, and that is by design. The iaGO v2 docs are correctly using MWP's organizational principle (separate workspace per concern) but in a Claude Code + git-repo context rather than the simpler folder-on-desktop context the workflow starters target. The `.iago/` subtree functions as a planning-and-operations workspace sitting alongside (not inside) the code workspace. This is a valid MWP extension, not a violation of it.

What iaGO is missing is the per-workspace CONTEXT.md files that tell Claude how to navigate within each `.iago/` subdirectory — especially `plans/`, `research/`, and `runbooks/`. These are L1 files the audit correctly identified as absent.

---

## 4. Multi-Agent Question

**Primary source:** ICM paper §1, §5.1, §5.2, §4.1

**Answer: MWP addresses single-agent sequential workflows. The paper explicitly acknowledges multi-agent coordination as outside its scope.**

Direct quotes:

"The central observation is straightforward: if the prompts and context for each stage of a workflow already exist as files in a well-organized folder hierarchy, you do not need a coordination framework to manage multiple specialized agents. You need one orchestrating agent that reads the right files at the right moment." — ICM paper §1

"Real-time multi-agent collaboration, where agents need to communicate dynamically and respond to each other's outputs in tight loops, requires the kind of message-passing infrastructure that AutoGen and similar frameworks provide. MWP's sequential, file-based handoffs are too slow for this." — ICM paper §5.2

"High-concurrency systems where many users hit the same pipeline simultaneously need proper queueing, state isolation, and deployment infrastructure. MWP is local-first by design." — ICM paper §5.2

"Workflows that require complex branching logic based on AI decisions mid-pipeline are awkward in MWP. A human can make branching decisions between stages, but automated branching would require scripting that moves MWP toward being a framework itself." — ICM paper §5.2

The paper does show that within a stage, Opus 4.6 delegates sub-tasks to Sonnet 4.6 sub-agents using the same folder structure as the orchestration specification (§4.1). This is sub-agent delegation within a stage, not multi-agent architecture across stages. The primary model reads the stage CONTEXT.md and uses it to determine what context to pass to sub-agents.

**Conclusion:** The 2026-04-21 council rejection of MWP-as-architecture for iaGO v2 (which is a concurrent multi-agent daemon) was correct. MWP is not a replacement for the daemon's agent coordination layer. It is a discipline for structuring context within each agent's workspace. These operate at different layers. MWP belongs inside the workspace each agent operates in, not in the coordination protocol between agents.

---

## 5. Telegram Bot Strategy

**Finding: MWP, the ICM paper, the Clief Notes Skills Field Manual, the Clief Notes Resource Index, and both workflow starters contain zero references to Telegram.**

The Clief Notes Skills Field Manual covers: Projects, Custom Skills, Claude Code + CLAUDE.md, MCP Connectors, Memory, Code Execution, Artifacts, File Creation, Web Search, Extended Thinking.

The resource index covers: GitHub repos, MCP servers, UI libraries, Remotion, learning resources.

The vault-toolkit constraint files (all 8) cover: AI writing patterns, output drift, context hygiene, session consistency, voice architecture, layer triage, scaling-vs-automating, handoff-readiness.

None of these mention Telegram, bot design, or messaging-platform strategy.

**[INFERENCE]** The Telegram control surface in iaGO v2 is an architectural decision that comes from the daemon design, not from MWP. MWP is silent on delivery interfaces. The question of one-bot-routing-to-many vs one-bot-per-agent is an iaGO-specific design choice not addressable from MWP source documents.

---

## 6. Working-Layer Blueprint

**Primary source:** working-layer-bluebrint.pdf (converted via MarkItDown); vault-toolkit architecture files with layer annotations

The "working-layer blueprint" document is the Eduba video lesson companion document. It is NOT a formal specification — it is a beginner-facing explainer for the three-workspace (not five-layer) concept. Key content:

**Three-workspace model (the simplified MWP for practitioners):**

The document describes three example workspaces (Community, Production, Writing Room) as the concrete entry point. This is the "Eduba 3-layer" terminology that iaGO's master prompt references. The three layers are not the same as L0–L4 — they are three workspace divisions, each of which contains an L0 file, L1 files, and L3/L4 content.

**Token explanation (from the document):**

The document explains context windows and tokens in plain language before introducing the architecture. This is the pedagogical framing, not architecture definition.

**The actual layer descriptions in the document:**

- Layer 1 (The Map) = CLAUDE.md — floor plan, routing table, naming conventions
- Layer 2 (The Rooms) = Workspace CONTEXT.md files — per-workspace context loaded on entry
- Layer 3 (The Tools) = Skills, MCP servers — wired in per workspace, not loaded globally

This three-layer framing (Map → Rooms → Tools) is the informal Eduba presentation layer. The ICM paper's formal five-layer hierarchy (L0–L4) is the research paper's precise version of the same idea, with L2 and L3/L4 decomposed further.

**The vault-toolkit reference architecture CLAUDE.md explicitly annotates layers:**

```
CLAUDE.md: L0 (always loaded, ~800 tokens, orientation)
CONTEXT.md: L1 (loaded on workspace entry, routing)
Stage CONTEXT.md files: L2 (loaded per-task, stage contract)
_config/ files: L3 (reference, loaded selectively per stage)
Source material and stage outputs: L4 (working artifacts, loaded selectively)
```

This confirms the five-layer naming maps to the practical implementation as follows:

| ICM paper | Eduba simplified | Implementation artifact |
|---|---|---|
| L0 | Map | Root workspace CLAUDE.md |
| L1 | Rooms (entry) | Workspace-level CONTEXT.md |
| L2 | Rooms (stage) | Per-stage CONTEXT.md with Inputs/Process/Outputs |
| L3 | Tools (reference) | `_config/`, `references/`, skill files |
| L4 | (not named separately in 3-layer) | Stage `output/` directories, source material |

---

## 7. LLM Council Pattern

**Source:** `llm-council.zip` → `llm-council/SKILL.md`

The council in the zip is the same Karpathy LLM Council methodology already implemented in iaGO's `.claude/skills/council/`. The zip's SKILL.md defines:

- Five advisors: Contrarian, First Principles Thinker, Expansionist, Outsider, Executor
- Three tensions: Contrarian vs Expansionist (downside/upside), First Principles vs Executor (rethink/do it), Outsider as honest observer
- Four steps: frame the question (with workspace context scan) → convene 5 advisors in parallel → peer review (anonymized A–E) → chairman synthesis

The chairman's output structure:
1. Where the council agrees (convergence = high-confidence signal)
2. Where the council clashes (presented without smoothing)
3. Blind spots caught in peer review
4. Clear recommendation (not "it depends")
5. One thing to do first

**Comparison to iaGO's existing `/council` skill:**

The zip SKILL.md and iaGO's council skill are functionally identical — same advisor personas, same four-step structure, same chairman format. The zip SKILL.md adds one detail missing from some implementations: the workspace context scan step before framing (scan CLAUDE.md, memory/, relevant files — "don't spend more than 30 seconds on this"). The zip also specifies that transcripts are saved only on request, with no automatic file creation. The zip explicitly says "do NOT generate an HTML report or any files" — output goes directly in chat via markdown.

One difference: the zip's output goes to chat as markdown. IAgo's council saves an HTML report by default. This is a minor implementation divergence, not a methodology gap.

**Verdict:** No new information for iaGO. The council pattern is already implemented correctly.

---

## 8. ICM Paper Formal Claims and Limits

**Primary source:** Interpretable_Context_Methdology_.pdf (Van Clief & McDermott, Eduba / University of Edinburgh)

**The falsifiable claim:**

"Structuring the context delivery mechanism as a filesystem hierarchy affects practitioners' ability to control, inspect, and edit AI agent behavior across multi-step workflows, and... what this structure means for the quality of the model's output at each stage." — ICM paper §1

**What the validation actually shows:**

The paper's empirical foundation is an invite-only practitioner community of 52 members. Behavioral data comes from ongoing conversations, not instrumented measurement or controlled studies. The key quantitative finding — 30 of 33 practitioners report a U-shaped intervention pattern (heavy editing at stage 1, light in middle, heavy again at stage 3) — is self-reported and unverified.

The paper explicitly names its limitations (§4.6):
- No controlled comparison between MWP staged context loading and monolithic prompting on the same tasks
- Community is invite-only and self-selected (selection bias + enthusiasm bias)
- All testing on a single model family (Claude Opus 4.6 + Sonnet 4.6)
- Majority of active use concentrated in content production

**Where MWP does NOT apply (per the paper itself, §5.2):**

1. Real-time multi-agent collaboration (tight loops, dynamic message passing)
2. High-concurrency systems (concurrent users, queueing, state isolation)
3. Complex automated branching based on AI decisions mid-pipeline
4. Any workflow that is not sequential, reviewable, and repeatable

**The formal claims the paper makes (and does not make):**

The paper claims MWP provides "full orchestration capability with no framework code, no server infrastructure, and no developer dependency for day-to-day operation" for sequential, reviewable, repeatable workflows. It does not claim MWP is a general-purpose agent architecture. It explicitly positions itself as complementary to frameworks, not competitive with them.

**On MCP vs MWP (ICM paper §2.2):**

"MCP standardizes how models access external tools and data sources, solving the integration problem between AI systems and the services they need to call. MWP addresses a different layer: how to structure and deliver context to an agent across a multi-stage workflow. The two are complementary."

This distinction is not clearly made in the iaGO v2 docs and is worth adding.

**The 60/30/10 framework:**

This appears in the Clief Notes Skills Field Manual (§2.1, §2.2, §2.3, §2.4, §2.5 — every skill section) and the vault-toolkit constraint 06 (Layer Triage), and the Resource Index (§8). It is Eduba's task-triage heuristic:

- 60% of workflow tasks should be deterministic tools, databases, existing software
- 30% should be rule-based logic (automation, routing, templates)
- 10% should be genuine AI tasks (synthesis, judgment, creativity)

This framework is completely absent from all iaGO v2 docs. It is directly relevant to daemon task routing decisions (which tasks go to which tool layer) and to the pipeline's step design.

---

## 9. Misalignments Table

| # | Claim in iaGO docs | What MWP source actually says | Severity | Source citation |
|---|---|---|---|---|
| 1 | Master prompt §MWP: "Eduba 3-layer + ICM context hierarchy" — treats as one unified thing | These are two different framings of the same concept: Eduba's 3-layer (Map/Rooms/Tools) is the simplified practitioner view; ICM's L0–L4 is the formal research decomposition. They align but are not the same document. Conflating them obscures the fact that L2 (stage contracts with Inputs/Process/Outputs) and the L3/L4 factory/product distinction have no equivalent in the 3-layer model. | Medium | Working-layer-blueprint §§Layer 1–3; ICM paper §3.2, Figure 1 |
| 2 | Master prompt §MWP item 1: "Files concatenate, deeper does not replace" — accurate for Claude Code CLAUDE.md loading | This is correct per Anthropic memory docs, but MWP does not say this. This is a Claude Code platform behavior, not an MWP prescription. MWP is model-agnostic. Conflating them means the rule sounds like an MWP rule when it is actually a platform rule. | Low | ICM paper §4.1 "MWP is designed to be model-agnostic"; Anthropic memory docs |
| 3 | Master prompt §MWP item 6: "L4 = working/product" | Correct label but incomplete. L4 specifically refers to per-run working artifacts (outputs of previous stages, user-provided source material). The distinction that matters — and which the master prompt omits — is that L3 and L4 require different model processing modes: L3 material should be internalized as constraints, L4 material should be processed as input to transform. | Medium | ICM paper §3.2, Table 2 |
| 4 | Master prompt §MWP and the routing rule both focus on file organization. Neither mentions the stage contract structure (Inputs/Process/Outputs in L2 CONTEXT.md). | L2 stage contracts are the control mechanism of the system. The Inputs table distinguishes L3 from L4 files explicitly and makes context selection auditable. Without this, you have the folder structure but not the protocol. | High | ICM paper §3.2, §3.3, Figure 4 |
| 5 | Routing rule doc (`iago-os-mwp-routing-rule.md`) focuses on doc-routing (where files go). The paper's routing concept is about context loading (what files an agent loads at each stage). | Different concerns. File routing is "where should this document live." Context loading is "what does the agent read at this stage." The routing rule is solving a real problem (file placement confusion) but calling it MWP routing may conflate it with the paper's stage-scoped context loading. | Low | ICM paper §3.2 "Layered context loading" |
| 6 | MWP restructure audit (2026-04-28) §1.6 "Eduba 7-mistakes check" cites a target of 60-150 lines for CLAUDE.md | The ICM paper's token budget for L0 is ~800 tokens (~600 words, approximately 60-80 lines). The working-layer blueprint does not specify a line count. The "7 mistakes" list is an Eduba community document not present in the canonical source files — it is not from the ICM paper or the workflow starters. | Low | ICM paper Figure 1 (~800 tok for L0); no "7 mistakes" list found in any canonical source |
| 7 | The master prompt implies MWP addresses how to organize multi-agent work in v2. | MWP explicitly addresses single-agent sequential workflows. Multi-agent is named as out-of-scope. The v2 daemon architecture requires something MWP does not provide. | High | ICM paper §1 "You need one orchestrating agent"; §5.2 explicitly lists multi-agent collaboration as a non-applicable case |
| 8 | No iaGO v2 doc mentions the 60/30/10 framework. | This is Eduba's primary task-triage heuristic, appearing in every section of the Skills Field Manual and in the vault-toolkit constraint 06. It is the framework for deciding which tasks go to which layer (deterministic/rules-based/AI). Relevant to daemon task routing. | Medium | Skills Field Manual §2.1–2.5; vault-toolkit/constraints/06-layer-triage.md |
| 9 | No iaGO v2 doc mentions the MCP vs MWP distinction. | The ICM paper explicitly distinguishes the two: MCP handles external tool access (integration layer); MWP handles context structuring across workflow stages. They are complementary. | Low | ICM paper §2.2 |
| 10 | The vault-toolkit's 8 constraint files (`constraints/01` through `08`) are not referenced anywhere in iaGO docs. | These constraints (context hygiene, session consistency, voice architecture, layer triage, scaling-vs-automating, handoff-readiness) are directly applicable to iaGO's pipeline agent sessions. Constraint 03 (context hygiene) mirrors the iaGO `context-hygiene.md` rule almost exactly — in fact, the iaGO rule cites the same research (Liu et al. 2024, Lance Martin's taxonomy) as the vault-toolkit constraint 03. | Low | vault-toolkit/constraints/*.md |

---

## 10. Recommended Changes to iaGO v2 Docs

### `docs/specs/iago-os-v2-master-prompt.md` — §MWP Method

**Current text (lines ~154–163):**

```
## MWP Method (mandatory for all v2 work)

Every workspace inside the v2 daemon respects the iaGO MWP method
(Eduba 3-layer + ICM context hierarchy). Specifically:

1. Hierarchical CLAUDE.md. Root file ≤150 lines. Per-workspace CLAUDE.md
   files load on-demand. Files concatenate, deeper does not replace.
2. Doc-routing table at root. Drop-in section per docs/specs/iago-os-mwp-routing-rule.md.
   Auto-loads with root CLAUDE.md.
3. Per-client CLAUDE.md deltas only (8-15 lines). Stack divergence,
   commands, never-do-X. No duplication of root rules.
4. CONTEXT.md in each workspace subdir. Eduba "rooms" pattern. Index of
   what lives in that workspace.
5. Path-scoped .claude/rules/*.md with YAML frontmatter. Loads only when
   matching files are touched.
6. L0–L4 context hierarchy. L0 = CLAUDE.md routing, L1 = CONTEXT.md
   workspace index, L2 = stage contract (Inputs/Process/Outputs), L3 =
   reference/factory, L4 = working/product.
```

**Recommended replacement:**

```markdown
## MWP Method (context-structuring discipline — not multi-agent architecture)

MWP (Model Workspace Protocol, Van Clief & McDermott 2026) structures context
delivery for sequential, reviewable, repeatable workflows. It applies inside
each agent's workspace. It does not address multi-agent coordination — the
daemon's agent manager handles that layer.

### Five-layer context hierarchy (L0–L4)

| Layer | What | Token budget | Location |
|---|---|---|---|
| L0 | CLAUDE.md — workspace identity, routing table | ~800 tok | Workspace root |
| L1 | CONTEXT.md — workspace entry routing | ~300 tok | Workspace-level |
| L2 | Stage contract — Inputs / Process / Outputs | 200–500 tok | Per-stage CONTEXT.md |
| L3 | Reference/factory — rules, voice, conventions | 500–2k tok | `_config/`, `references/` |
| L4 | Working/product — per-run artifacts | Varies | Stage `output/` dirs |

**L3 vs L4 distinction:** L3 files are configured once and stable across runs
— the model internalizes them as constraints. L4 files change every run —
the model processes them as input to transform. Never mix them in one
undifferentiated context block.

### Stage contracts (L2 CONTEXT.md format)

Every stage defines a contract with three parts:

```
## Inputs
- Layer 4 (working): ../01_research/output/
- Layer 3 (reference): ../../_config/voice.md

## Process
[Stage instructions]

## Outputs
- output-file.md -> output/
```

The Inputs table is what makes context selection explicit and auditable.

### MWP vs MCP

MCP handles how agents access external tools (integration layer).
MWP handles how context is structured within a workflow stage. Complementary,
not competing.

### 60/30/10 task triage

Before routing any task to an AI agent, apply:
- 60%: use deterministic tools (scripts, databases, existing software)
- 30%: use rule-based logic (automation, routing, templates)
- 10%: use genuine AI (synthesis, judgment, creative work that requires it)

Over-routing deterministic work to agents wastes tokens and degrades quality
of genuinely AI-appropriate tasks.

### iaGO-specific rules

- Per-workspace `CLAUDE.md` delta only (8-15 lines — stack divergence, commands, never-do-X)
- Doc-routing table in root CLAUDE.md (auto-loads every session)
- Path-scoped `.claude/rules/*.md` with YAML `paths:` frontmatter (loads on file-match)
- Note: hierarchical CLAUDE.md concatenation (deeper does not replace) is a Claude Code
  platform behavior, not an MWP prescription. MWP is model-agnostic.
```

### `docs/specs/iago-os-v2-master-prompt.md` — other sections

No changes required outside the §MWP Method section. The v2 architecture decisions (daemon, Telegram, PTY adapters) are not addressed by MWP and the docs correctly derive them from other sources.

### `docs/specs/iago-os-mwp-routing-rule.md`

The doc-routing rule itself is well-reasoned and the analysis of why Option A (inline in root CLAUDE.md) is correct is sound. The only issue is that the document calls this "MWP routing" when what MWP means by "routing" is context-loading within stages, not file placement. A comment clarifying this distinction would prevent future confusion, but the rule itself is correct as written.

### Vault-toolkit constraints

Consider importing or referencing the vault-toolkit constraint library into `.iago/runbooks/` or `.claude/rules/`. Constraint 06 (Layer Triage / 60/30/10) is highest priority. Constraint 03 (Context Hygiene) overlaps with the existing `.claude/rules/context-hygiene.md` and can be cross-referenced.

---

## Sources

| Document | Format | Key sections read |
|---|---|---|
| `workflow-starter-code-project.md` | Markdown | Full |
| `workflow-starter-content-pipeline.md` | Markdown | Full |
| `working-layer-bluebrint.pdf` | PDF via MarkItDown | Full (companion to video lesson) |
| `Interpretable_Context_Methdology_.pdf` | PDF via MarkItDown | Full (1,530 lines) — §1 Intro, §2 Background, §3 Protocol, §4 Implementations, §5 Discussion, §6 Future Directions, §7 Conclusion |
| `clief_notes_resource_index_v1.pdf` | PDF via MarkItDown | Full |
| `clief_notes_skills_field_manual_v1.pdf` | PDF via MarkItDown | Full (11 pages, 10 skills) |
| `files.zip` → `vault-toolkit.zip` | Extracted | README.md, 3 architecture CLAUDE.md/CONTEXT.md sets, 3 stage CONTEXT.md files, 2 of 8 constraint files (03, 06) |
| `llm-council.zip` | Extracted | `llm-council/SKILL.md` (full) |
