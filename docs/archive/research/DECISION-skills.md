# Community Skills Catalog — Final

> Date: 2026-03-31
> Sprint: 3 (Skills & Agents) — Phase 3

---

## Core Skills (12)

| # | Our Name | Source | What It Does | Format | Lines Est. |
|---|----------|--------|--------------|--------|------------|
| 1 | verification-before-completion | Superpowers | Never claim success without running a command and reading its output | CLAUDE.md | 4 |
| 2 | tdd | Superpowers + ECC | RED-GREEN-REFACTOR with anti-rationalization table + 80% coverage target | rules/ | ~40 |
| 3 | systematic-debugging | Superpowers | 4-phase debugging: investigate, analyze, hypothesize, implement; 3+ fails = question architecture | rules/ | ~30 |
| 4 | brainstorming | Superpowers | Socratic design exploration — 2-3 approaches, writes spec to docs/ | SKILL.md | ~50 |
| 5 | writing-plans | Superpowers | Break approved spec into 2-5 min tasks with file paths, code, test commands | SKILL.md | ~45 |
| 6 | subagent-driven-development | Superpowers | Execute plans with fresh subagent per task, two-stage review | SKILL.md | ~60 |
| 7 | code-review | Superpowers + ECC | Dispatch reviewer agent with git SHA range, severity output (Critical/Important/Minor) | SKILL.md | ~40 |
| 8 | search-first | ECC | Search codebase before creating anything to avoid duplication | CLAUDE.md | 3 |
| 9 | deep-research | ECC | Multi-source research workflow for consulting analysis tasks | SKILL.md | ~35 |
| 10 | prompt-optimizer | ECC | Optimize prompts for LLM-powered features we build for clients | SKILL.md | ~30 |
| 11 | e2e-testing | ECC | Playwright E2E patterns for React 19 + Vite apps | rules/ | ~35 |
| 12 | mcp-server-patterns | ECC | Build MCP servers with Node/TS SDK | rules/ | ~30 |

### Core Skill Details

#### 1. verification-before-completion

- **Source:** Superpowers → `skills/verification-before-completion/SKILL.md`
- **Trigger (CSO):** "Use when claiming any task is complete. Not when mid-implementation."
- **Key adaptation:** Absorbed to 4-line CLAUDE.md rule — the behavioral constraint is universal and short enough
- **What it replaces/merges:** Absorbs the behavioral core of ECC `verification-loop` (the pipeline steps — format, typecheck, lint — are already hooks)
- **Format:** CLAUDE.md
- **Lines estimate:** 4
- **Agent interaction:** Applies to all agents via CLAUDE.md inheritance

#### 2. tdd

- **Source:** Superpowers `test-driven-development` → merged with ECC `tdd-workflow`
- **Trigger (CSO):** "Use when implementing any feature or fixing any bug. Not when writing research, docs, or config."
- **Key adaptation:** Merge Superpowers' 11-entry rationalization table (anti-excuse discipline) with ECC's 80% coverage target and unit/integration/E2E tiering. Drop ECC's generic framework references, keep Vitest + Playwright
- **What it replaces/merges:** Winner over ECC `tdd-workflow`; merges ECC's coverage target into Superpowers' discipline framework
- **Format:** `.claude/rules/tdd.md`
- **Lines estimate:** ~40
- **Agent interaction:** Inherited by all implementation agents; tdd-guide agent references this rule

#### 3. systematic-debugging

- **Source:** Superpowers → `skills/systematic-debugging/SKILL.md`
- **Trigger (CSO):** "Use when a test fails, a build breaks, or unexpected behavior occurs. Not when writing new code from scratch."
- **Key adaptation:** Integrate the analysis paralysis guard (already in CLAUDE.md) as a cross-reference — "after 3 failed fix attempts, escalate per Execution Discipline rules"
- **What it replaces/merges:** Standalone. GSD's paralysis guard is a separate CLAUDE.md rule, not a debugging methodology
- **Format:** `.claude/rules/systematic-debugging.md`
- **Lines estimate:** ~30
- **Agent interaction:** Used by all implementation agents and build-error-resolver agent

#### 4. brainstorming

- **Source:** Superpowers → `skills/brainstorming/SKILL.md`
- **Trigger (CSO):** "Use when starting a new feature, design decision, or architecture choice. Not when modifying existing code with clear requirements."
- **Key adaptation:** Write specs to `docs/specs/` (not `docs/superpowers/specs/`). Drop visual companion dependency. Add "PoC-first" constraint — specs must identify the 4-week-or-less delivery path
- **What it replaces/merges:** Absorbs ECC `product-lens` (product thinking folded into the Socratic questioning phase)
- **Format:** `.claude/skills/brainstorming/SKILL.md`
- **Lines estimate:** ~50
- **Agent interaction:** Feeds into writing-plans skill

#### 5. writing-plans

- **Source:** Superpowers → `skills/writing-plans/SKILL.md`
- **Trigger (CSO):** "Use when you have an approved spec and need to plan implementation. Not when spec is still in discussion."
- **Key adaptation:** Tasks target our stack (React 19 + Vite + AWS Amplify). Output format compatible with subagent-driven-development. Add wave/dependency metadata inspired by GSD planner (but simpler — no 8-point verification, just task ordering)
- **What it replaces/merges:** Winner over GSD `gsd-planner` (too heavy for 3-person team). Merges GSD's wave concept for parallel task groups
- **Format:** `.claude/skills/writing-plans/SKILL.md`
- **Lines estimate:** ~45
- **Agent interaction:** Produces plans consumed by subagent-driven-development

#### 6. subagent-driven-development

- **Source:** Superpowers → `skills/subagent-driven-development/SKILL.md`
- **Trigger (CSO):** "Use when executing a multi-task implementation plan. Not when task is trivial (single file, <5 min)."
- **Key adaptation:** Replace TodoWrite references with Claude Code Task tool. Include the escalation protocol (DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED) from CLAUDE.md. Default to single-pass review; opt into two-stage with "full review" trigger. Absorb Superpowers `executing-plans` as the fallback path (inline, not separate skill)
- **What it replaces/merges:** Absorbs `executing-plans` (non-subagent fallback). Absorbs `dispatching-parallel-agents` (parallel dispatch is a mode within this skill, not separate)
- **Format:** `.claude/skills/subagent-driven-development/SKILL.md`
- **Lines estimate:** ~60
- **Agent interaction:** Spawns implementer, spec-reviewer, code-quality-reviewer agents. References writing-plans output

#### 7. code-review

- **Source:** Superpowers `requesting-code-review` + `receiving-code-review` → merged with ECC `code-reviewer` agent pattern
- **Trigger (CSO):** "Use when implementation is complete and needs review before merge. Not when still implementing."
- **Key adaptation:** Merge requesting (dispatch with SHA range) and receiving (anti-performative-agreement, YAGNI check) into single skill. Use Superpowers' severity categories (Critical/Important/Minor). Single-pass by default, two-stage on "full review"
- **What it replaces/merges:** Merges Superpowers `requesting-code-review` + `receiving-code-review` + ECC code-reviewer agent dispatch
- **Format:** `.claude/skills/code-review/SKILL.md`
- **Lines estimate:** ~40
- **Agent interaction:** Dispatches code-reviewer agent

#### 8. search-first

- **Source:** ECC → `skills/search-first/SKILL.md`
- **Trigger (CSO):** "Use before creating any new file, component, or utility. Not when explicitly asked to create from scratch."
- **Key adaptation:** Absorbed to 3-line CLAUDE.md rule — simple behavioral constraint
- **What it replaces/merges:** Standalone. Complements ECC `codebase-onboarding` (which is proprietary via iago-onboard)
- **Format:** CLAUDE.md
- **Lines estimate:** 3
- **Agent interaction:** Applies to all agents via CLAUDE.md inheritance

#### 9. deep-research

- **Source:** ECC → `skills/deep-research/SKILL.md`
- **Trigger (CSO):** "Use when the user requests research, analysis, or competitive audit. Not when the answer is in the codebase (use search-first instead)."
- **Key adaptation:** Align output format with iaGO research conventions (see `.iago/research/` structure). Add consulting lens — research must conclude with actionable recommendation, not just findings
- **What it replaces/merges:** Winner over GSD's parallel researcher agents (overkill for 3-person team). GSD's synthesizer concept is folded in as the "synthesis step" of the research workflow
- **Format:** `.claude/skills/deep-research/SKILL.md`
- **Lines estimate:** ~35
- **Agent interaction:** May spawn researcher subagents for parallel source analysis

#### 10. prompt-optimizer

- **Source:** ECC → `skills/prompt-optimizer/SKILL.md`
- **Trigger (CSO):** "Use when building or tuning LLM prompts for client deliverables. Not when writing CLAUDE.md rules or agent prompts (those follow iaGO conventions)."
- **Key adaptation:** Focus on Claude SDK prompts (our primary model). Add cost-awareness — optimize for Haiku/Sonnet where possible before reaching for Opus
- **What it replaces/merges:** Standalone. Complements `claude-api` skill (which is available as a built-in Claude Code skill)
- **Format:** `.claude/skills/prompt-optimizer/SKILL.md`
- **Lines estimate:** ~30
- **Agent interaction:** none

#### 11. e2e-testing

- **Source:** ECC → `skills/e2e-testing/SKILL.md`
- **Trigger (CSO):** "Use when writing or maintaining E2E tests. Not when writing unit or integration tests (use tdd rule)."
- **Key adaptation:** Lock to Playwright + React 19 + Vite. Drop references to other frameworks. Add Amplify Gen 2 local dev server patterns
- **What it replaces/merges:** Standalone
- **Format:** `.claude/rules/e2e-testing.md`
- **Lines estimate:** ~35
- **Agent interaction:** Used by e2e-runner agent

#### 12. mcp-server-patterns

- **Source:** ECC → `skills/mcp-server-patterns/SKILL.md`
- **Trigger (CSO):** "Use when building or extending MCP servers. Not when consuming MCP tools as a client."
- **Key adaptation:** TS-only (drop any Python references). Add iaGO-specific patterns for connecting MCP to our AWS backend
- **What it replaces/merges:** Standalone
- **Format:** `.claude/rules/mcp-server-patterns.md`
- **Lines estimate:** ~30
- **Agent interaction:** none

---

## Content/Business Skills

These are ECC-sourced skills requested for inclusion. They serve consulting and business development workflows, not software engineering. Loaded on-demand via slash command — zero context cost when unused.

| # | Our Name | Source | What It Does | Format | Lines Est. |
|---|----------|--------|--------------|--------|------------|
| C1 | article-writing | ECC | Structured article/blog post creation workflow | SKILL.md | ~30 |
| C2 | content-engine | ECC | Content pipeline for multi-format output (blog, social, newsletter) | SKILL.md | ~35 |
| C3 | investor-materials | ECC | Create investor decks, one-pagers, pitch materials | SKILL.md | ~30 |
| C4 | investor-outreach | ECC | Investor communication and outreach workflows | SKILL.md | ~25 |
| C5 | market-research | ECC | Market analysis and competitive research | SKILL.md | ~30 |
| C6 | visa-doc-translate | ECC | Visa document translation and preparation | SKILL.md | ~25 |
| C7 | frontend-slides | ECC | Presentation/slide generation from frontend code | SKILL.md | ~30 |

#### C1. article-writing

- **Source:** ECC → `skills/article-writing/SKILL.md`
- **Trigger (CSO):** "Use when writing blog posts, articles, or long-form content. Not when writing documentation or READMEs."
- **Key adaptation:** Add iaGO consulting voice guidelines. Output to `docs/content/` directory
- **What it replaces/merges:** Standalone
- **Format:** `.claude/skills/article-writing/SKILL.md`
- **Lines estimate:** ~30
- **Agent interaction:** none

#### C2. content-engine

- **Source:** ECC → `skills/content-engine/SKILL.md`
- **Trigger (CSO):** "Use when producing multi-format content from a single source (blog + social + newsletter). Not when writing a single article (use article-writing)."
- **Key adaptation:** Align output formats with iaGO client deliverable templates
- **What it replaces/merges:** Standalone. Complements article-writing for multi-channel output
- **Format:** `.claude/skills/content-engine/SKILL.md`
- **Lines estimate:** ~35
- **Agent interaction:** May spawn parallel subagents for format adaptation

#### C3. investor-materials

- **Source:** ECC → `skills/investor-materials/SKILL.md`
- **Trigger (CSO):** "Use when creating pitch decks, one-pagers, or investor-facing documents. Not when doing market research (use market-research)."
- **Key adaptation:** Add iaGO branding templates. Frontend-slides skill can be used for the presentation layer
- **What it replaces/merges:** Standalone
- **Format:** `.claude/skills/investor-materials/SKILL.md`
- **Lines estimate:** ~30
- **Agent interaction:** May invoke frontend-slides for deck generation

#### C4. investor-outreach

- **Source:** ECC → `skills/investor-outreach/SKILL.md`
- **Trigger (CSO):** "Use when drafting investor emails, follow-ups, or outreach sequences. Not when creating pitch materials (use investor-materials)."
- **Key adaptation:** Minimal — use as-is from ECC
- **What it replaces/merges:** Standalone
- **Format:** `.claude/skills/investor-outreach/SKILL.md`
- **Lines estimate:** ~25
- **Agent interaction:** none

#### C5. market-research

- **Source:** ECC → `skills/market-research/SKILL.md`
- **Trigger (CSO):** "Use when analyzing markets, competitors, or industry trends for client engagements. Not when doing technical research (use deep-research)."
- **Key adaptation:** Align output with iaGO research document conventions (`.iago/research/` structure)
- **What it replaces/merges:** Standalone. Complements deep-research (market vs. technical focus)
- **Format:** `.claude/skills/market-research/SKILL.md`
- **Lines estimate:** ~30
- **Agent interaction:** none

#### C6. visa-doc-translate

- **Source:** ECC → `skills/visa-doc-translate/SKILL.md`
- **Trigger (CSO):** "Use when translating or preparing visa/immigration documents. Not when doing general translation."
- **Key adaptation:** Minimal — use as-is from ECC
- **What it replaces/merges:** Standalone
- **Format:** `.claude/skills/visa-doc-translate/SKILL.md`
- **Lines estimate:** ~25
- **Agent interaction:** none

#### C7. frontend-slides

- **Source:** ECC → `skills/frontend-slides/SKILL.md`
- **Trigger (CSO):** "Use when generating presentation slides from code or data. Not when writing static documents."
- **Key adaptation:** Lock to React 19 + Vite for slide rendering. Use TailwindCSS 4 for styling
- **What it replaces/merges:** Standalone
- **Format:** `.claude/skills/frontend-slides/SKILL.md`
- **Lines estimate:** ~30
- **Agent interaction:** none

---

## Experimental/Agentic Skills

ECC-sourced experimental patterns. These push boundaries — use with caution, monitor costs. Loaded on-demand via slash command.

| # | Our Name | Source | What It Does | Format | Lines Est. |
|---|----------|--------|--------------|--------|------------|
| E1 | autonomous-loops | ECC | Autonomous agent execution loops without human checkpoints | SKILL.md | ~35 |
| E2 | continuous-agent-loop | ECC | Persistent agent loop maintaining state across iterations | SKILL.md | ~35 |
| E3 | enterprise-agent-ops | ECC | Enterprise-scale agent operations patterns | SKILL.md | ~40 |
| E4 | agent-payment-x402 | ECC | Agent-to-agent payment via x402 protocol | SKILL.md | ~25 |
| E5 | liquid-glass-design | ECC | Liquid glass UI design patterns | SKILL.md | ~30 |
| E6 | santa-method | ECC | Santa method for structured problem decomposition | SKILL.md | ~30 |

#### E1. autonomous-loops

- **Source:** ECC → `skills/autonomous-loops/SKILL.md`
- **Trigger (CSO):** "Use when running long autonomous tasks that don't need human approval at each step. Not when task requires human judgment at checkpoints (use subagent-driven-development)."
- **Key adaptation:** Add hard safety rails — max iterations, cost ceiling, mandatory verification-before-completion at loop exit. Integrate with context-monitor hooks (auto-pause at 90% context)
- **What it replaces/merges:** Standalone
- **Format:** `.claude/skills/autonomous-loops/SKILL.md`
- **Lines estimate:** ~35
- **Agent interaction:** Spawns implementation agents in loop; must respect escalation protocol

#### E2. continuous-agent-loop

- **Source:** ECC → `skills/continuous-agent-loop/SKILL.md`
- **Trigger (CSO):** "Use when maintaining a persistent agent that watches and reacts over time. Not when running a one-shot task."
- **Key adaptation:** Integrate with iaGO session persistence — loop state saved via context-persistence hook. Add compaction-aware checkpointing
- **What it replaces/merges:** Standalone. Differs from autonomous-loops in persistence model (continuous vs. bounded)
- **Format:** `.claude/skills/continuous-agent-loop/SKILL.md`
- **Lines estimate:** ~35
- **Agent interaction:** Self-managing loop agent; uses session snapshots for state recovery

#### E3. enterprise-agent-ops

- **Source:** ECC → `skills/enterprise-agent-ops/SKILL.md`
- **Trigger (CSO):** "Use when designing multi-agent systems for client deployments. Not when building single-agent features."
- **Key adaptation:** Scale down from enterprise to consultancy — 3-5 agents max per system. Add LangGraph integration patterns (our agent orchestration framework). Add n8n webhook patterns for agent triggering
- **What it replaces/merges:** Standalone
- **Format:** `.claude/skills/enterprise-agent-ops/SKILL.md`
- **Lines estimate:** ~40
- **Agent interaction:** Meta-skill — describes how to architect agent systems

#### E4. agent-payment-x402

- **Source:** ECC → `skills/agent-payment-x402/SKILL.md`
- **Trigger (CSO):** "Use when implementing agent-to-agent payment flows using x402 protocol. Not when building traditional payment integrations."
- **Key adaptation:** Minimal — experimental protocol, use as-is. Note: requires x402-compatible endpoints
- **What it replaces/merges:** Standalone
- **Format:** `.claude/skills/agent-payment-x402/SKILL.md`
- **Lines estimate:** ~25
- **Agent interaction:** none (describes a pattern, not an agent workflow)

#### E5. liquid-glass-design

- **Source:** ECC → `skills/liquid-glass-design/SKILL.md`
- **Trigger (CSO):** "Use when implementing glassmorphism or liquid glass UI effects. Not when building standard UI components (use ShadCN/UI defaults)."
- **Key adaptation:** Lock to TailwindCSS 4 + ShadCN/UI. Provide CSS custom property patterns compatible with our design system
- **What it replaces/merges:** Absorbs ECC `design-system` (liquid-glass is the specific design language; generic design-system patterns go into CLAUDE.md or rules)
- **Format:** `.claude/skills/liquid-glass-design/SKILL.md`
- **Lines estimate:** ~30
- **Agent interaction:** none

#### E6. santa-method

- **Source:** ECC → `skills/santa-method/SKILL.md`
- **Trigger (CSO):** "Use when decomposing a complex, ambiguous problem into structured sub-problems. Not when requirements are already clear (use writing-plans)."
- **Key adaptation:** Minimal — methodology skill, stack-agnostic. Position as pre-brainstorming for especially ambiguous problems
- **What it replaces/merges:** Standalone. Complements brainstorming (santa-method decomposes the problem; brainstorming explores solutions)
- **Format:** `.claude/skills/santa-method/SKILL.md`
- **Lines estimate:** ~30
- **Agent interaction:** none

---

## Industry Skills

ECC-sourced niche/industry skills. These are domain-specific knowledge bases for client engagements in regulated or specialized industries. Loaded on-demand — only pull into context when working on a matching client project.

| # | Our Name | Source | What It Does | Format | Lines Est. |
|---|----------|--------|--------------|--------|------------|
| I1 | healthcare-phi-compliance | ECC | HIPAA/PHI compliance patterns for healthcare data | SKILL.md | ~40 |
| I2 | carrier-relationship-management | ECC | Logistics carrier relationship and rate management | SKILL.md | ~30 |
| I3 | customs | ECC | Customs/trade compliance workflows (bundle) | SKILL.md | ~35 |
| I4 | energy | ECC | Energy sector operational patterns (bundle) | SKILL.md | ~35 |
| I5 | logistics | ECC | Logistics and supply chain patterns (bundle) | SKILL.md | ~35 |
| I6 | inventory | ECC | Inventory management patterns (bundle) | SKILL.md | ~30 |
| I7 | production-scheduling | ECC | Manufacturing production scheduling workflows | SKILL.md | ~30 |
| I8 | quality-nonconformance | ECC | Quality control nonconformance tracking and resolution | SKILL.md | ~25 |
| I9 | returns-reverse-logistics | ECC | Returns processing and reverse logistics workflows | SKILL.md | ~25 |

#### I1. healthcare-phi-compliance

- **Source:** ECC → `skills/healthcare-phi-compliance/SKILL.md`
- **Trigger (CSO):** "Use when building features that handle protected health information (PHI). Not when building non-healthcare applications."
- **Key adaptation:** Add AWS-specific HIPAA patterns (Cognito for auth, DynamoDB encryption at rest, API Gateway with WAF). Add Amplify Gen 2 HIPAA-eligible service configuration
- **What it replaces/merges:** Standalone
- **Format:** `.claude/skills/healthcare-phi-compliance/SKILL.md`
- **Lines estimate:** ~40
- **Agent interaction:** none — advisory patterns, not a workflow

#### I2. carrier-relationship-management

- **Source:** ECC → `skills/carrier-relationship-management/SKILL.md`
- **Trigger (CSO):** "Use when building carrier management features for logistics clients. Not when building general CRM."
- **Key adaptation:** Adapt data models to DynamoDB single-table design. Add API Gateway patterns for carrier API integrations
- **What it replaces/merges:** Standalone
- **Format:** `.claude/skills/carrier-relationship-management/SKILL.md`
- **Lines estimate:** ~30
- **Agent interaction:** none

#### I3. customs

- **Source:** ECC → `skills/customs-*/SKILL.md` (bundled)
- **Trigger (CSO):** "Use when building customs/trade compliance features. Not when building general logistics (use logistics skill)."
- **Key adaptation:** Bundle multiple ECC customs-* skills into single consolidated skill. Adapt to DynamoDB for compliance record storage
- **What it replaces/merges:** Consolidates all ECC customs-* skills into one
- **Format:** `.claude/skills/customs/SKILL.md`
- **Lines estimate:** ~35
- **Agent interaction:** none

#### I4. energy

- **Source:** ECC → `skills/energy-*/SKILL.md` (bundled)
- **Trigger (CSO):** "Use when building energy sector applications (metering, grid, trading). Not when building general industrial apps."
- **Key adaptation:** Bundle multiple ECC energy-* skills. Adapt to our AWS stack for time-series data handling (DynamoDB TTL + Lambda scheduled processing)
- **What it replaces/merges:** Consolidates all ECC energy-* skills into one
- **Format:** `.claude/skills/energy/SKILL.md`
- **Lines estimate:** ~35
- **Agent interaction:** none

#### I5. logistics

- **Source:** ECC → `skills/logistics-*/SKILL.md` (bundled)
- **Trigger (CSO):** "Use when building logistics and supply chain features. Not when building carrier management (use carrier-relationship-management)."
- **Key adaptation:** Bundle multiple ECC logistics-* skills. Adapt to DynamoDB single-table for shipment tracking. Add n8n webhook patterns for logistics event processing
- **What it replaces/merges:** Consolidates all ECC logistics-* skills into one
- **Format:** `.claude/skills/logistics/SKILL.md`
- **Lines estimate:** ~35
- **Agent interaction:** none

#### I6. inventory

- **Source:** ECC → `skills/inventory-*/SKILL.md` (bundled)
- **Trigger (CSO):** "Use when building inventory management features. Not when building warehouse logistics (use logistics skill)."
- **Key adaptation:** Bundle multiple ECC inventory-* skills. DynamoDB single-table design for inventory records with optimistic locking via version attributes
- **What it replaces/merges:** Consolidates all ECC inventory-* skills into one
- **Format:** `.claude/skills/inventory/SKILL.md`
- **Lines estimate:** ~30
- **Agent interaction:** none

#### I7. production-scheduling

- **Source:** ECC → `skills/production-scheduling/SKILL.md`
- **Trigger (CSO):** "Use when building manufacturing production scheduling features. Not when building project management tools."
- **Key adaptation:** Adapt to Lambda for scheduling computation. DynamoDB for schedule storage
- **What it replaces/merges:** Standalone
- **Format:** `.claude/skills/production-scheduling/SKILL.md`
- **Lines estimate:** ~30
- **Agent interaction:** none

#### I8. quality-nonconformance

- **Source:** ECC → `skills/quality-nonconformance/SKILL.md`
- **Trigger (CSO):** "Use when building quality control or nonconformance tracking features. Not when building general issue tracking."
- **Key adaptation:** Adapt data models to DynamoDB. Add Cognito-based role access for quality inspectors
- **What it replaces/merges:** Standalone
- **Format:** `.claude/skills/quality-nonconformance/SKILL.md`
- **Lines estimate:** ~25
- **Agent interaction:** none

#### I9. returns-reverse-logistics

- **Source:** ECC → `skills/returns-reverse-logistics/SKILL.md`
- **Trigger (CSO):** "Use when building returns processing or reverse logistics features. Not when building forward logistics (use logistics skill)."
- **Key adaptation:** Adapt to DynamoDB for return tracking. Add API Gateway webhook patterns for return status updates
- **What it replaces/merges:** Standalone
- **Format:** `.claude/skills/returns-reverse-logistics/SKILL.md`
- **Lines estimate:** ~25
- **Agent interaction:** none

---

## Overlap Resolutions

| Overlap | Winner | Merged From | Reasoning |
|---------|--------|-------------|-----------|
| Verification loops (ECC `verification-loop` vs Superpowers `verification-before-completion`) | Superpowers `verification-before-completion` | ECC pipeline steps are hooks (format, typecheck, lint) | ECC's pipeline is fully covered by post-edit hooks. Superpowers' behavioral discipline ("never claim without evidence") is the residual value — absorbed into CLAUDE.md |
| TDD (ECC `tdd-workflow` vs Superpowers `test-driven-development`) | Superpowers `test-driven-development` | ECC 80% coverage target merged in | Superpowers' anti-rationalization table is the harder-to-replicate value. ECC's coverage target is a useful concrete metric. Combined as `tdd` rule |
| Context compaction (ECC `strategic-compact` vs hooks) | Hooks | — | `context-persistence.mjs` PreCompact handles structured snapshots automatically. Manual guidance is redundant |
| Context budget (ECC `context-budget` + `token-budget-advisor` vs hooks) | Hooks | — | `context-monitor.mjs` + `statusline.mjs` provide runtime monitoring with threshold warnings. Advisory skills are redundant |
| Security (ECC `security-review` + `security-scan` + `safety-guard` vs hooks) | Hooks | — | `safety-guard.mjs` blocks destructive commands + detects secrets + injection at runtime. `commit-quality.mjs` scans staged diffs. Manual security-review checklist has marginal value over runtime guards — rejected for context budget reasons |
| Code review (Superpowers `requesting-code-review` + `receiving-code-review` vs ECC `code-reviewer`) | Superpowers (merged) | ECC agent dispatch pattern | Superpowers has severity categories + anti-performative-agreement. Merged into single `code-review` skill |
| Research (ECC `deep-research` vs GSD parallel researchers) | ECC `deep-research` | GSD synthesizer concept as a step | GSD's 4x parallel researchers + synthesizer is overkill for 3-person team. Folded synthesizer as a step within deep-research |
| Planning (Superpowers `writing-plans` vs GSD `gsd-planner`) | Superpowers `writing-plans` | GSD wave/dependency concept | GSD's 8-point verification is enterprise overhead. Superpowers' 2-5 min task breakdown is right-sized. Added GSD's wave concept for task parallelization |
| Plan verification (Superpowers two-stage vs GSD `gsd-plan-checker`) | Neither as standalone | Plan-checker concept absorbed into writing-plans output validation | GSD's plan-checker is a separate agent (expensive). Superpowers' two-stage review is for implementation, not plans. Quick validation step added to writing-plans |
| Codebase onboarding (ECC `codebase-onboarding` vs `repo-scan`) | Neither | — | Both covered by proprietary `iago-onboard` skill. Community versions rejected |
| Formatting (ECC `post-edit-format.js` vs hooks) | Hooks | — | `post-edit-format.mjs` is already a hook. No skill needed |
| Debugging (Superpowers `systematic-debugging` vs GSD paralysis guard) | Both kept, different layers | — | Superpowers' debugging is a methodology (rules/ file). GSD's paralysis guard is a behavioral constraint (CLAUDE.md). They complement, not conflict |
| Cost tracking (ECC `cost-aware-llm-pipeline` vs hooks) | Hooks (tracking portion) | — | `context-persistence.mjs` Stop event handles session cost logging. The pipeline design portion of cost-aware-llm-pipeline is niche — rejected |

---

## Rejected Skills

| Skill | Source | Rejection Reason |
|-------|--------|------------------|
| verification-loop | ECC | Fully covered by post-edit hooks (format, typecheck, console-warn) + verification-before-completion CLAUDE.md rule |
| strategic-compact | ECC | Covered by `context-persistence.mjs` PreCompact hook |
| context-budget | ECC | Covered by `context-monitor.mjs` + `statusline.mjs` hooks |
| token-budget-advisor | ECC | Covered by `context-monitor.mjs` + `statusline.mjs` hooks |
| safety-guard (skill) | ECC | Covered by `safety-guard.mjs` hook (runtime blocking) |
| security-scan | ECC | Covered by `safety-guard.mjs` + `commit-quality.mjs` hooks |
| security-review | ECC | Marginal value over runtime hooks; not worth context tokens |
| coding-standards | ECC | Linting covered by hooks; KISS/DRY/YAGNI are assumed engineering principles, not skill-worthy |
| eval-harness | ECC | Over-specialized for our team size; build ad-hoc when needed |
| content-hash-cache-pattern | ECC | Niche optimization pattern; add to rules/ only when a project needs it |
| continuous-learning | ECC | Covered by `context-persistence.mjs` decision extraction |
| continuous-learning-v2 | ECC | Covered by `context-persistence.mjs` session state capture |
| cost-aware-llm-pipeline | ECC | Tracking covered by hooks; pipeline design is too niche for always-loaded skill |
| executing-plans | Superpowers | Absorbed into `subagent-driven-development` as fallback mode |
| dispatching-parallel-agents | Superpowers | Absorbed into `subagent-driven-development` as parallel mode |
| requesting-code-review | Superpowers | Merged into unified `code-review` skill |
| receiving-code-review | Superpowers | Merged into unified `code-review` skill |
| using-superpowers | Superpowers | Meta-skill for Superpowers ecosystem; replaced by iaGO CLAUDE.md conventions |
| writing-skills | Superpowers | Meta-skill for creating skills; we have DECISION-conventions.md for that |
| using-git-worktrees | Superpowers | Git worktrees not used in our workflow |
| finishing-a-development-branch | Superpowers | Coupled to worktree pattern; standard git/PR workflow suffices |
| docker-patterns | ECC | AWS Amplify Gen 2 is our deployment target; Docker only for Lambda containers (too niche for a skill) |
| database-migrations | ECC | DynamoDB single-table design has no schema migrations |
| deployment-patterns | ECC | Covered by Amplify Gen 2 defaults; too generic |
| frontend-patterns | ECC | Absorbed into CLAUDE.md stack conventions + React 19 rules |
| backend-patterns | ECC | Too generic; our API Gateway + Lambda + DynamoDB patterns go in rules/ as needed |
| api-design | ECC | Absorbed into CLAUDE.md stack conventions for API Gateway |
| architecture-decision-records | ECC | We use `.iago/research/DECISION-*.md` format; ADR is a different convention |
| design-system | ECC | Absorbed into liquid-glass-design (our specific design language) + ShadCN/UI defaults |
| claude-api | ECC | Available as built-in Claude Code skill (`claude-api`); no need to duplicate |
| git-workflow | ECC | Commit quality handled by hook; branching is standard practice, not skill-worthy |
| agentic-engineering | ECC | Absorbed into enterprise-agent-ops (our adapted version) |
| codebase-onboarding | ECC | Covered by proprietary `iago-onboard` skill |
| repo-scan | ECC | Covered by proprietary `iago-onboard` skill |
| product-lens | ECC | Absorbed into `brainstorming` skill (product thinking in Socratic phase) |
| /gsd:quick | GSD | GSD workflow commands replaced by iaGO skills (brainstorming → writing-plans → subagent-driven-development) |
| /gsd:fast | GSD | Trivial tasks don't need a skill — just do them |
| /gsd:do | GSD | Dispatcher pattern replaced by Claude Code's native skill matching via CSO descriptions |

---

## CLAUDE.md Absorptions

These lines are added to `CLAUDE.md` under the appropriate sections. Exact text:

```markdown
## Verification

Never claim a task is complete without running a verification command and reading its
output. "I believe this works" is not evidence. Test output is evidence.

## Search-First

Before creating any new file, component, utility, or hook, search the codebase for
existing implementations. Duplicate code is a bug.

## Agent Escalation Protocol

Every agent MUST end its response with exactly one status line:

STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

- DONE — requirements verified with evidence (test output, build success)
- DONE_WITH_CONCERNS — requirements met, minor issues listed
- NEEDS_CONTEXT — state exactly what information is missing
- BLOCKED — state the external blocker; do not retry

## Execution Discipline

During task execution, if you make 7+ consecutive Read/Grep/Glob calls without any
Edit/Write/Bash action: STOP. State what you have learned so far and ask whether to
continue investigating or begin producing output.

Exception: explicit research/analysis/review tasks may read freely, but must still
produce a written artifact (summary, analysis, recommendation) before reporting DONE.

After 3 failed attempts to fix the same issue, STOP. Report the failure pattern and
escalate — do not attempt a 4th fix without new information or a different approach.
```

**Note:** The Agent Escalation Protocol and Execution Discipline sections are from DECISION-conventions.md and are included here for completeness. They were decided in Phase 2.

---

## rules/ File Contents

### `.claude/rules/tdd.md`

```markdown
---
description: >-
  Use when implementing any feature or fixing any bug.
  Not when writing research, docs, or config.
---

## TDD Discipline — RED-GREEN-REFACTOR

### Iron Law

No production code without a failing test first. No exceptions.

### Process

1. **RED** — Write a failing test that describes the desired behavior
2. **GREEN** — Write the minimum code to make the test pass
3. **REFACTOR** — Clean up while keeping tests green

### Coverage Target

Aim for 80% coverage. Unit tests (Vitest) for logic, integration tests for API
routes, E2E tests (Playwright) for critical user flows.

### Anti-Rationalization Table

If you catch yourself thinking any of these, STOP and write the test:

| Excuse | Why It's Wrong |
|--------|---------------|
| "This is too simple to test" | Simple code becomes complex code. Test it now. |
| "I'll add tests later" | You won't. Write them first. |
| "This is just a prototype" | Prototypes become production. Test the contract. |
| "The types guarantee correctness" | Types don't catch logic bugs. Test behavior. |
| "It's just a UI component" | UI bugs are user-facing bugs. Test interactions. |
| "I need to see the shape first" | Write the test to define the shape. |
| "Testing this would be too slow" | Mock the slow part. Test the logic. |
| "This is a one-line change" | One-line changes cause production outages. Test it. |
| "The existing tests cover this" | Verify. Run them. If they pass without your change, they don't cover it. |
| "I'm just refactoring" | Refactoring without tests is renaming. Tests prove behavior is preserved. |
| "This is infrastructure code" | Infrastructure bugs are the hardest to debug. Test it. |

### Tools

- **Unit/Integration:** Vitest
- **E2E:** Playwright
- **Coverage:** `vitest --coverage`
```

### `.claude/rules/systematic-debugging.md`

```markdown
---
description: >-
  Use when a test fails, a build breaks, or unexpected behavior occurs.
  Not when writing new code from scratch.
---

## Systematic Debugging

### Phase 1 — Root Cause Investigation

1. Read the FULL error message and stack trace
2. Identify the failing file and line number
3. Check git log for recent changes to that area
4. Read the relevant source code (not just the error line — the surrounding context)

### Phase 2 — Pattern Analysis

1. Is this a known pattern? (import error, type mismatch, null reference, async timing)
2. Has this file/module had similar issues before?
3. Are there related test failures that point to a shared root cause?

### Phase 3 — Hypothesis Testing

1. Form ONE hypothesis about the root cause
2. Make the SMALLEST possible change to test that hypothesis
3. Run the failing test/build to verify

### Phase 4 — Implementation

1. Fix the root cause, not the symptom
2. Run the full test suite to check for regressions
3. If the fix touches shared code, verify all consumers

### Escalation

After 3 failed fix attempts on the same issue, STOP. Do not attempt a 4th fix.
Report the failure pattern and escalate — the architecture may need questioning.

See also: Execution Discipline rules in CLAUDE.md.
```

### `.claude/rules/e2e-testing.md`

```markdown
---
description: >-
  Use when writing or maintaining E2E tests.
  Not when writing unit or integration tests.
paths:
  - "e2e/**"
  - "tests/e2e/**"
  - "**/*.e2e.ts"
  - "playwright.config.*"
---

## E2E Testing — Playwright + React 19 + Vite

### Setup

- Config: `playwright.config.ts` at project root
- Base URL: `http://localhost:5173` (Vite dev server)
- Browsers: Chromium only for dev, all three for CI

### Patterns

1. **Page Object Model** — One class per page/component, encapsulate selectors
2. **Data-testid** — Use `data-testid` attributes, not CSS selectors or text content
3. **Wait for network** — Use `page.waitForResponse()` for API calls, not arbitrary timeouts
4. **Auth fixtures** — Create authenticated browser contexts in fixtures, not in each test
5. **Isolation** — Each test creates its own data. No test depends on another test's state

### Structure

```
e2e/
  fixtures/       # Shared fixtures (auth, test data)
  pages/          # Page Object Model classes
  specs/          # Test files (*.e2e.ts)
```

### Commands

- Run all: `npx playwright test`
- Run headed: `npx playwright test --headed`
- Debug: `npx playwright test --debug`
- Report: `npx playwright show-report`

### Anti-patterns

- No `page.waitForTimeout()` — use explicit waits
- No shared state between tests
- No CSS selector chains — use data-testid or getByRole
```

### `.claude/rules/mcp-server-patterns.md`

```markdown
---
description: >-
  Use when building or extending MCP servers.
  Not when consuming MCP tools as a client.
paths:
  - "src/mcp/**"
  - "mcp-server/**"
  - "**/mcp*.ts"
---

## MCP Server Patterns — Node/TS SDK

### Setup

Use `@modelcontextprotocol/sdk` (TypeScript). Each server is a standalone Node process.

### Tool Definition

```typescript
server.tool("tool-name", {
  description: "Use when [X]. Not when [Y].",  // CSO pattern
  inputSchema: z.object({ ... }),              // Zod schema
}, async (input) => {
  // Implementation
  return { content: [{ type: "text", text: result }] };
});
```

### Patterns

1. **One concern per server** — Don't build monolith MCP servers
2. **Zod for validation** — All inputs validated with Zod schemas
3. **Error as content** — Return errors as text content, not thrown exceptions
4. **Idempotent tools** — Tools should be safe to retry
5. **Resource URIs** — Use `resource://` scheme for structured data access

### AWS Integration

- Lambda-backed tools: Invoke via AWS SDK, not HTTP
- DynamoDB access: Use single-table patterns, return typed results
- Cognito auth: Pass JWT in tool context, validate server-side

### Testing

- Unit test tool handlers with mock inputs
- Integration test with MCP Inspector (`npx @modelcontextprotocol/inspector`)
```

---

## Summary

| Category | Count | Format Breakdown |
|----------|-------|-----------------|
| Core Skills | 12 | 2 CLAUDE.md, 5 SKILL.md, 4 rules/, 1 SKILL.md (code-review) |
| Content/Business Skills | 7 | 7 SKILL.md |
| Experimental/Agentic Skills | 6 | 6 SKILL.md |
| Industry Skills | 9 | 9 SKILL.md |
| **Total Active** | **34** | **2 CLAUDE.md + 27 SKILL.md + 4 rules/** |
| Rejected | 33 | — |
| Absorbed (overlap losers) | 11 | Merged into winners |
| Hook-covered | 12 | Already handled by 9 hook files |

**Context cost model:**
- CLAUDE.md absorptions: ~25 lines (always loaded)
- rules/ files: ~135 lines (loaded when path-matched or unconditionally)
- Core SKILL.md files: ~260 lines (loaded on-demand via slash command)
- Content/Business/Experimental/Industry SKILL.md: ~660 lines (loaded on-demand, zero cost when unused)
