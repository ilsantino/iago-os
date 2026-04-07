# Skills & Agents Assembly — iaGO-OS

> Date: 2026-03-31
> Sprint: 3 (Skills & Agents) — Phase 5 (Assembly)
> 
> Canonical references:
> - Conventions: `DECISION-conventions.md` (CSO, agent template, escalation, paralysis guard, two-stage review, storage)
> - Skills: `DECISION-skills.md` (34 skills, overlap resolutions, rejected skills, CLAUDE.md absorptions, rules/ contents)
> - Agents: `DECISION-agents.md` (8 agents, design decisions, complete definitions, rejected agents)

---

## 1. Skill → Agent Dispatch Map

| Skill | Dispatches | Trigger | Context Passed |
|-------|-----------|---------|----------------|
| verification-before-completion | none (CLAUDE.md rule) | Always active | Inherited by all agents |
| tdd | tdd-guide (ad-hoc) | Orchestrator detects TDD context | Task description, target files |
| systematic-debugging | build-error-resolver (ad-hoc) | Orchestrator detects build failure | Error output, failing file path |
| brainstorming | none (orchestrator-direct) | `/brainstorming` | User's design question |
| writing-plans | none (orchestrator-direct) | `/writing-plans` | Approved spec path |
| subagent-driven-development | implementer, code-reviewer, spec-reviewer, code-quality-reviewer | `/subagent-driven-development` | Plan with tasks, git SHA range (for review) |
| code-review | code-reviewer | `/code-review` | Git SHA range, changed file list |
| search-first | none (CLAUDE.md rule) | Always active | Inherited by all agents |
| deep-research | researcher | `/deep-research` | Research question, source scope |
| prompt-optimizer | none (orchestrator-direct) | `/prompt-optimizer` | Prompt text, target model |
| e2e-testing | e2e-runner (ad-hoc) | Orchestrator detects E2E work | Test scope, user flow description |
| mcp-server-patterns | none (rules/ reference) | Path-matched to MCP files | N/A — advisory patterns |
| article-writing | none (orchestrator-direct) | `/article-writing` | Topic, audience, length |
| content-engine | none (orchestrator-direct) | `/content-engine` | Source content, target formats |
| investor-materials | none (orchestrator-direct) | `/investor-materials` | Company data, deck type |
| investor-outreach | none (orchestrator-direct) | `/investor-outreach` | Investor list, stage |
| market-research | none (orchestrator-direct) | `/market-research` | Market/competitor scope |
| visa-doc-translate | none (orchestrator-direct) | `/visa-doc-translate` | Source document, target language |
| frontend-slides | none (orchestrator-direct) | `/frontend-slides` | Content, slide format |
| autonomous-loops | implementer (in loop) | `/autonomous-loops` | Task queue, iteration limits |
| continuous-agent-loop | none (self-managing) | `/continuous-agent-loop` | Watch criteria, state checkpoint |
| enterprise-agent-ops | none (orchestrator-direct) | `/enterprise-agent-ops` | System architecture scope |
| agent-payment-x402 | none (orchestrator-direct) | `/agent-payment-x402` | Payment flow spec |
| liquid-glass-design | none (orchestrator-direct) | `/liquid-glass-design` | UI component scope |
| santa-method | none (orchestrator-direct) | `/santa-method` | Problem statement |
| healthcare-phi-compliance | none (orchestrator-direct) | `/healthcare-phi-compliance` | Feature scope with PHI |
| carrier-relationship-management | none (orchestrator-direct) | `/carrier-relationship-management` | Carrier integration scope |
| customs | none (orchestrator-direct) | `/customs` | Trade compliance scope |
| energy | none (orchestrator-direct) | `/energy` | Energy domain scope |
| logistics | none (orchestrator-direct) | `/logistics` | Supply chain scope |
| inventory | none (orchestrator-direct) | `/inventory` | Inventory feature scope |
| production-scheduling | none (orchestrator-direct) | `/production-scheduling` | Scheduling feature scope |
| quality-nonconformance | none (orchestrator-direct) | `/quality-nonconformance` | QC feature scope |
| returns-reverse-logistics | none (orchestrator-direct) | `/returns-reverse-logistics` | Returns feature scope |

### Ad-Hoc Agents

Agents available for direct `/agent {name}` invocation without a skill trigger:

| Agent | When to Invoke Directly | Example |
|-------|------------------------|---------|
| tdd-guide | Orchestrator needs strict RED-GREEN-REFACTOR enforcement on a task | `/agent tdd-guide` with task: "Add validation to user registration form" |
| build-error-resolver | Build, typecheck, or lint error needs systematic diagnosis | `/agent build-error-resolver` with error: "TS2345: Argument of type 'string' is not assignable..." |
| e2e-runner | Playwright E2E tests need to be written, run, or debugged | `/agent e2e-runner` with scope: "Test the checkout flow end-to-end" |

### Dispatch Flow Diagram

```
subagent-driven-development
  |-- implementer (per task in plan)
  |-- code-reviewer (single-pass, default)
  +-- [opt-in "full review"]
      |-- spec-reviewer (Stage 1)
      +-- code-quality-reviewer (Stage 2, only if Stage 1 passes)

code-review
  +-- code-reviewer

deep-research
  +-- researcher (1 or more instances with different queries)

ad-hoc (orchestrator dispatches when context warrants):
  tdd-guide, build-error-resolver, e2e-runner
```

---

## 2. Meta-Instruction

**Verdict:** Yes
**Mechanism:** `.claude/rules/available-skills.md` — auto-loaded at session start
**Rationale:** Keeps skill listing separate from CLAUDE.md (which handles behavioral rules). Not a hook because this is static content, not logic.

**Production-ready content for `.claude/rules/available-skills.md`:**

```markdown
---
description: >-
  Reference of available skills and agents. Loaded at session start.
---

## Available Skills

### Core Workflow
- `/brainstorming` — Socratic design exploration, writes spec to docs/
- `/writing-plans` — Break spec into 2-5 min tasks with verification commands
- `/subagent-driven-development` — Execute plans with fresh subagent per task
- `/code-review` — Dispatch reviewer with severity output (Critical/Important/Minor)
- `/deep-research` — Multi-source research with actionable recommendation
- `/prompt-optimizer` — Optimize LLM prompts for client deliverables

### Content/Business
- `/article-writing` — Blog posts and long-form content
- `/content-engine` — Multi-format output (blog + social + newsletter)
- `/investor-materials` — Pitch decks, one-pagers
- `/investor-outreach` — Investor emails and outreach sequences
- `/market-research` — Market analysis and competitive research
- `/visa-doc-translate` — Visa document translation
- `/frontend-slides` — Presentation slides from code/data

### Experimental
- `/autonomous-loops` — Long autonomous tasks without per-step approval
- `/continuous-agent-loop` — Persistent agent with cross-iteration state
- `/enterprise-agent-ops` — Multi-agent system design patterns
- `/agent-payment-x402` — Agent-to-agent payment via x402
- `/liquid-glass-design` — Glassmorphism UI effects (TailwindCSS 4)
- `/santa-method` — Structured problem decomposition for ambiguous problems

### Industry
- `/healthcare-phi-compliance` — HIPAA/PHI compliance patterns
- `/carrier-relationship-management` — Carrier management for logistics
- `/customs` — Customs/trade compliance
- `/energy` — Energy sector patterns (metering, grid, trading)
- `/logistics` — Supply chain and logistics
- `/inventory` — Inventory management
- `/production-scheduling` — Manufacturing scheduling
- `/quality-nonconformance` — Quality control tracking
- `/returns-reverse-logistics` — Returns processing

### Available Agents
- `implementer` — Execute a single task from a plan
- `code-reviewer` — Single-pass review with severity findings
- `spec-reviewer` — Spec compliance (Stage 1 of full review)
- `code-quality-reviewer` — Quality review (Stage 2 of full review)
- `researcher` — Deep research across codebase and web
- `tdd-guide` — Enforce RED-GREEN-REFACTOR discipline
- `build-error-resolver` — Diagnose and fix build/typecheck/lint errors
- `e2e-runner` — Write and run Playwright E2E tests

### Behavioral Rules (always active)
- Verification: never claim done without evidence (CLAUDE.md)
- Search-first: search before creating (CLAUDE.md)
- TDD: red-green-refactor discipline (rules/tdd.md)
- Debugging: 4-phase systematic method (rules/systematic-debugging.md)
- E2E patterns: Playwright conventions (rules/e2e-testing.md)
- MCP patterns: Node/TS SDK conventions (rules/mcp-server-patterns.md)
```

---

## 3. Validation Checklist

- [x] Every skill with agent interaction -> agent exists in DECISION-agents.md
  - subagent-driven-development -> implementer, code-reviewer, spec-reviewer, code-quality-reviewer: all in agent catalog
  - code-review -> code-reviewer: in catalog (#2)
  - deep-research -> researcher: in catalog (#5)
  - tdd rule -> tdd-guide: in catalog (#6)
  - systematic-debugging rule -> build-error-resolver: in catalog (#7)
  - e2e-testing rule -> e2e-runner: in catalog (#8)
  - PASS

- [x] Every agent -> appears in dispatch map or ad-hoc table
  - implementer: dispatch map (subagent-driven-development)
  - code-reviewer: dispatch map (subagent-driven-development, code-review)
  - spec-reviewer: dispatch map (subagent-driven-development, opt-in)
  - code-quality-reviewer: dispatch map (subagent-driven-development, opt-in)
  - researcher: dispatch map (deep-research)
  - tdd-guide: ad-hoc table
  - build-error-resolver: ad-hoc table
  - e2e-runner: ad-hoc table
  - PASS

- [x] No skill duplicates hook functionality (DECISION-hooks.md)
  - Rejected skills list confirms: verification-loop, strategic-compact, context-budget, token-budget-advisor, safety-guard, security-scan, security-review, coding-standards, cost-aware-llm-pipeline all rejected for hook coverage
  - PASS

- [x] All skills follow CSO format (DECISION-conventions.md section A)
  - Every skill detail entry in DECISION-skills.md includes a "Trigger (CSO)" with "Use when [X]. Not when [Y]." pattern
  - PASS

- [x] All agents follow YAML template (DECISION-conventions.md section B)
  - All 8 agent definitions in DECISION-agents.md include: name, description (CSO), model, tools, maxTurns, plus Role/Constraints/Process/Output Format/Escalation sections
  - PASS

- [x] Execution agents have paralysis guard (DECISION-conventions.md section D)
  - Paralysis guard is in CLAUDE.md Execution Discipline section (inherited by all agents)
  - implementer Process step 7: "max 3 attempts per the paralysis guard"
  - build-error-resolver Constraint: "NEVER make more than 3 fix attempts"
  - build-error-resolver Process step 6: "Max 3 attempts"
  - tdd-guide: inherits from CLAUDE.md
  - PASS

- [x] All agents have escalation protocol (DECISION-conventions.md section C)
  - All 8 agent definitions end with `## Escalation` section referencing "Agent Escalation Protocol in CLAUDE.md" with agent-specific triggers
  - PASS

- [x] Model assignments cost-justified (no Opus where Sonnet suffices)
  - All 8 agents use `model: sonnet` — correct. No agent task requires Opus-level reasoning. Orchestrator (main session) runs on Opus for planning/architecture
  - PASS

- [x] Tool restrictions minimal (DECISION-agents.md tool matrix)
  - spec-reviewer: Read, Glob, Grep only (no Bash — prevents running tests and muddying verdict). Justified.
  - code-reviewer: Read, Glob, Grep, Bash (Bash for `git diff`). Justified.
  - code-quality-reviewer: Read, Glob, Grep, Bash (Bash for `git diff`). Justified.
  - researcher: Read, Glob, Grep, Bash, WebSearch, WebFetch (needs web access). Justified.
  - Implementation agents (implementer, tdd-guide, build-error-resolver, e2e-runner): full read/write/edit/bash. Justified — they produce code.
  - No agent has `Agent` tool (flat dispatch model). Justified.
  - PASS

---

## 4. Build Order

| # | Item | Type | Phase | Depends On |
|---|------|------|-------|------------|
| 1 | CLAUDE.md: Verification section | CLAUDE.md | 1 | — |
| 2 | CLAUDE.md: Search-First section | CLAUDE.md | 1 | — |
| 3 | CLAUDE.md: Agent Escalation Protocol section | CLAUDE.md | 1 | — |
| 4 | CLAUDE.md: Execution Discipline section | CLAUDE.md | 1 | — |
| 5 | `.claude/rules/tdd.md` | rules/ | 2 | CLAUDE.md (references Execution Discipline) |
| 6 | `.claude/rules/systematic-debugging.md` | rules/ | 2 | CLAUDE.md (references Execution Discipline) |
| 7 | `.claude/rules/e2e-testing.md` | rules/ | 2 | — |
| 8 | `.claude/rules/mcp-server-patterns.md` | rules/ | 2 | — |
| 9 | `.claude/agents/implementer.md` | agent | 3 | CLAUDE.md (escalation, execution discipline) |
| 10 | `.claude/agents/code-reviewer.md` | agent | 3 | CLAUDE.md (escalation) |
| 11 | `.claude/agents/spec-reviewer.md` | agent | 3 | CLAUDE.md (escalation) |
| 12 | `.claude/agents/code-quality-reviewer.md` | agent | 3 | CLAUDE.md (escalation) |
| 13 | `.claude/agents/researcher.md` | agent | 3 | CLAUDE.md (escalation) |
| 14 | `.claude/agents/tdd-guide.md` | agent | 3 | rules/tdd.md, CLAUDE.md |
| 15 | `.claude/agents/build-error-resolver.md` | agent | 3 | rules/systematic-debugging.md, CLAUDE.md |
| 16 | `.claude/agents/e2e-runner.md` | agent | 3 | rules/e2e-testing.md, CLAUDE.md |
| 17 | `.claude/skills/brainstorming/SKILL.md` | skill | 4 | — |
| 18 | `.claude/skills/writing-plans/SKILL.md` | skill | 4 | — |
| 19 | `.claude/skills/subagent-driven-development/SKILL.md` | skill | 4 | Agents (phase 3) |
| 20 | `.claude/skills/code-review/SKILL.md` | skill | 4 | code-reviewer agent |
| 21 | `.claude/skills/deep-research/SKILL.md` | skill | 4 | researcher agent |
| 22 | `.claude/skills/prompt-optimizer/SKILL.md` | skill | 4 | — |
| 23 | `.claude/rules/available-skills.md` | rules/ | 5 | All skills and agents (phases 3-4) |
| 24 | `.claude/skills/article-writing/SKILL.md` | skill | 6 | — |
| 25 | `.claude/skills/content-engine/SKILL.md` | skill | 6 | — |
| 26 | `.claude/skills/investor-materials/SKILL.md` | skill | 6 | — |
| 27 | `.claude/skills/investor-outreach/SKILL.md` | skill | 6 | — |
| 28 | `.claude/skills/market-research/SKILL.md` | skill | 6 | — |
| 29 | `.claude/skills/visa-doc-translate/SKILL.md` | skill | 6 | — |
| 30 | `.claude/skills/frontend-slides/SKILL.md` | skill | 6 | — |
| 31 | `.claude/skills/autonomous-loops/SKILL.md` | skill | 6 | — |
| 32 | `.claude/skills/continuous-agent-loop/SKILL.md` | skill | 6 | — |
| 33 | `.claude/skills/enterprise-agent-ops/SKILL.md` | skill | 6 | — |
| 34 | `.claude/skills/agent-payment-x402/SKILL.md` | skill | 6 | — |
| 35 | `.claude/skills/liquid-glass-design/SKILL.md` | skill | 6 | — |
| 36 | `.claude/skills/santa-method/SKILL.md` | skill | 6 | — |
| 37 | `.claude/skills/healthcare-phi-compliance/SKILL.md` | skill | 6 | — |
| 38 | `.claude/skills/carrier-relationship-management/SKILL.md` | skill | 6 | — |
| 39 | `.claude/skills/customs/SKILL.md` | skill | 6 | — |
| 40 | `.claude/skills/energy/SKILL.md` | skill | 6 | — |
| 41 | `.claude/skills/logistics/SKILL.md` | skill | 6 | — |
| 42 | `.claude/skills/inventory/SKILL.md` | skill | 6 | — |
| 43 | `.claude/skills/production-scheduling/SKILL.md` | skill | 6 | — |
| 44 | `.claude/skills/quality-nonconformance/SKILL.md` | skill | 6 | — |
| 45 | `.claude/skills/returns-reverse-logistics/SKILL.md` | skill | 6 | — |

---

## 5. File Manifest

| # | File Path | Type | Lines Est. | Source |
|---|-----------|------|------------|--------|
| 1 | `CLAUDE.md` (4 sections added) | config | ~25 | DECISION-skills.md absorptions |
| 2 | `.claude/rules/tdd.md` | rules | ~40 | DECISION-skills.md |
| 3 | `.claude/rules/systematic-debugging.md` | rules | ~30 | DECISION-skills.md |
| 4 | `.claude/rules/e2e-testing.md` | rules | ~35 | DECISION-skills.md |
| 5 | `.claude/rules/mcp-server-patterns.md` | rules | ~30 | DECISION-skills.md |
| 6 | `.claude/rules/available-skills.md` | rules | ~40 | This document (section 2) |
| 7 | `.claude/agents/implementer.md` | agent | ~65 | DECISION-agents.md |
| 8 | `.claude/agents/code-reviewer.md` | agent | ~55 | DECISION-agents.md |
| 9 | `.claude/agents/spec-reviewer.md` | agent | ~50 | DECISION-agents.md |
| 10 | `.claude/agents/code-quality-reviewer.md` | agent | ~55 | DECISION-agents.md |
| 11 | `.claude/agents/researcher.md` | agent | ~55 | DECISION-agents.md |
| 12 | `.claude/agents/tdd-guide.md` | agent | ~60 | DECISION-agents.md |
| 13 | `.claude/agents/build-error-resolver.md` | agent | ~60 | DECISION-agents.md |
| 14 | `.claude/agents/e2e-runner.md` | agent | ~60 | DECISION-agents.md |
| 15 | `.claude/skills/brainstorming/SKILL.md` | skill | ~50 | DECISION-skills.md |
| 16 | `.claude/skills/writing-plans/SKILL.md` | skill | ~45 | DECISION-skills.md |
| 17 | `.claude/skills/subagent-driven-development/SKILL.md` | skill | ~60 | DECISION-skills.md |
| 18 | `.claude/skills/code-review/SKILL.md` | skill | ~40 | DECISION-skills.md |
| 19 | `.claude/skills/deep-research/SKILL.md` | skill | ~35 | DECISION-skills.md |
| 20 | `.claude/skills/prompt-optimizer/SKILL.md` | skill | ~30 | DECISION-skills.md |
| 21 | `.claude/skills/article-writing/SKILL.md` | skill | ~30 | DECISION-skills.md |
| 22 | `.claude/skills/content-engine/SKILL.md` | skill | ~35 | DECISION-skills.md |
| 23 | `.claude/skills/investor-materials/SKILL.md` | skill | ~30 | DECISION-skills.md |
| 24 | `.claude/skills/investor-outreach/SKILL.md` | skill | ~25 | DECISION-skills.md |
| 25 | `.claude/skills/market-research/SKILL.md` | skill | ~30 | DECISION-skills.md |
| 26 | `.claude/skills/visa-doc-translate/SKILL.md` | skill | ~25 | DECISION-skills.md |
| 27 | `.claude/skills/frontend-slides/SKILL.md` | skill | ~30 | DECISION-skills.md |
| 28 | `.claude/skills/autonomous-loops/SKILL.md` | skill | ~35 | DECISION-skills.md |
| 29 | `.claude/skills/continuous-agent-loop/SKILL.md` | skill | ~35 | DECISION-skills.md |
| 30 | `.claude/skills/enterprise-agent-ops/SKILL.md` | skill | ~40 | DECISION-skills.md |
| 31 | `.claude/skills/agent-payment-x402/SKILL.md` | skill | ~25 | DECISION-skills.md |
| 32 | `.claude/skills/liquid-glass-design/SKILL.md` | skill | ~30 | DECISION-skills.md |
| 33 | `.claude/skills/santa-method/SKILL.md` | skill | ~30 | DECISION-skills.md |
| 34 | `.claude/skills/healthcare-phi-compliance/SKILL.md` | skill | ~40 | DECISION-skills.md |
| 35 | `.claude/skills/carrier-relationship-management/SKILL.md` | skill | ~30 | DECISION-skills.md |
| 36 | `.claude/skills/customs/SKILL.md` | skill | ~35 | DECISION-skills.md |
| 37 | `.claude/skills/energy/SKILL.md` | skill | ~35 | DECISION-skills.md |
| 38 | `.claude/skills/logistics/SKILL.md` | skill | ~35 | DECISION-skills.md |
| 39 | `.claude/skills/inventory/SKILL.md` | skill | ~30 | DECISION-skills.md |
| 40 | `.claude/skills/production-scheduling/SKILL.md` | skill | ~30 | DECISION-skills.md |
| 41 | `.claude/skills/quality-nonconformance/SKILL.md` | skill | ~25 | DECISION-skills.md |
| 42 | `.claude/skills/returns-reverse-logistics/SKILL.md` | skill | ~25 | DECISION-skills.md |

---

## 6. Estimated Totals

| Category | Count | Lines Est. | Context Cost |
|----------|-------|------------|-------------|
| CLAUDE.md sections | 4 | ~25 | Always loaded |
| Rules files | 5 | ~175 | Always loaded (tdd, systematic-debugging, available-skills) or path-matched (e2e-testing, mcp-server-patterns) |
| Agent definitions | 8 | ~460 | On-demand (when dispatched) |
| Core skills | 6 | ~260 | On-demand (when invoked) |
| Supplementary skills | 22 | ~660 | On-demand (when invoked) |
| **Total** | **45** | **~1,580** | ~200 lines always-loaded; ~1,380 lines on-demand |
