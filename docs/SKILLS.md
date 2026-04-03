# Skills Reference

Complete catalog of all 41 iaGO-OS skills. Each skill is a reusable workflow you invoke with `/skill-name` inside Claude Code.

---

## Workflow Skills (13)

Skills that implement the iaGO delivery workflow: init, discuss, plan, execute, verify.

### `/iago:init`

**Purpose:** Bootstrap a new project — gather vision through interactive discovery, produce PROJECT.md, ROADMAP.md, STATE.md, and config.json.

**Trigger:** Starting a new client project or bootstrapping `.iago/` for an existing codebase.

**Precondition:** `.iago/PROJECT.md` must NOT already exist.

**Agents:** `researcher` (optional, for scanning existing codebases).

**Example:**
```
> /iago:init
# Claude asks: What are we building? Who is the client? What are the constraints?
# Produces: .iago/PROJECT.md, .iago/ROADMAP.md, .iago/STATE.md, .iago/config.json
```

---

### `/iago:discuss`

**Purpose:** Clarify implementation details for a specific ROADMAP phase before planning. Surfaces ambiguities, records decisions, produces a context artifact.

**Trigger:** Clarifying gray areas for a ROADMAP phase before planning.

**Precondition:** `.iago/ROADMAP.md` must exist with defined phases.

**Agents:** None — interactive conversation with the orchestrator.

**Example:**
```
> /iago:discuss phase 2
# Claude identifies unclear requirements, asks targeted questions
# Produces: .iago/context/phase-2-context.md
```

---

### `/iago:plan`

**Purpose:** Break a ROADMAP phase into implementation plans with 2-8 verifiable tasks each. Each task has a verification command.

**Trigger:** Having a discussed phase ready for implementation planning.

**Precondition:** Phase must be discussed (context artifact exists or `--skip-discuss` flag).

**Arguments:** `--research` dispatches the `researcher` agent first.

**Agents:** `researcher` (optional).

**Example:**
```
> /iago:plan phase 1
# Produces: .iago/plans/phase-1-plan-01.md, phase-1-plan-02.md, ...
```

---

### `/iago:execute`

**Purpose:** Execute all plans for a phase. Dispatches one `implementer` agent per plan, then runs review agents after each plan completes.

**Trigger:** Executing implementation plans for a ROADMAP phase.

**Precondition:** Plans must exist for the phase.

**Agents:** `implementer`, `code-reviewer`, `spec-reviewer`, `code-quality-reviewer`, `tdd-guide`, `build-error-resolver`.

**Example:**
```
> /iago:execute phase 1
# Dispatches implementer for plan 1 → reviews → implementer for plan 2 → reviews → ...
```

---

### `/iago:verify`

**Purpose:** Goal-backward verification that a phase met its ROADMAP success criteria. Creates a PR if all goals pass.

**Trigger:** Verifying a completed ROADMAP phase.

**Precondition:** Phase execution must be complete (plan summaries exist).

**Agents:** None — orchestrator-direct analysis.

**Example:**
```
> /iago:verify phase 1
# Checks each ROADMAP goal against evidence (test output, build success, file existence)
# If passed: opens PR. If failed: lists what's missing.
```

---

### `/iago:quick`

**Purpose:** Lightweight one-shot path for standalone tasks (1-3 tasks). Plans, implements, and reviews in one pass.

**Trigger:** Small focused task outside the full multi-phase workflow.

**Arguments:** `--research` dispatches researcher first. `--full-review` adds spec + quality review.

**Agents:** `implementer`, `code-reviewer`, `researcher` (optional).

**Example:**
```
> /iago:quick Add a loading spinner to the dashboard page
# Plans 1-3 tasks → dispatches implementer → reviews → done
```

---

### `/iago:fast`

**Purpose:** Execute trivially obvious changes inline (3 files or fewer). No planning, no agents, no review. Commits atomically.

**Trigger:** Trivial fix — single file edit, no new dependencies, obvious change.

**Agents:** None — inline execution.

**Example:**
```
> /iago:fast Fix the typo in the login button label
# Edits the file, commits, updates STATE.md
```

---

### `/iago:pause`

**Purpose:** Capture current workflow position into `HANDOFF.json` so the next session resumes without re-discovery.

**Trigger:** Pausing work mid-session (switching context, ending day, hitting a blocker).

**Agents:** None.

**Example:**
```
> /iago:pause
# Writes .iago/state/HANDOFF.json with current task, next action, blockers
# Next session auto-loads this and picks up where you left off
```

---

### `/iago:scaffold`

**Purpose:** Scaffold a new client project directory with the iaGO stack (React 19 + Vite + TS + Tailwind + ShadCN + AWS Amplify Gen 2).

**Trigger:** Starting a new project that needs the full directory structure.

**Agents:** None — orchestrator handles inline.

**Example:**
```
> /iago:scaffold
# Creates project structure, installs dependencies, configures Vite/Tailwind/ShadCN
```

---

### `/iago:proposal`

**Purpose:** Generate a structured client proposal covering scope, timeline, cost, technical approach, and deliverables.

**Trigger:** Generating a client proposal.

**Agents:** `content-writer`.

**Example:**
```
> /iago:proposal for Acme Corp's inventory management system
# Produces a proposal document with scope, phases, timeline, cost estimate
```

---

### `/iago:onboard`

**Purpose:** Scan an existing codebase to produce an architecture map, identify tech debt, and populate PROJECT.md.

**Trigger:** Onboarding an existing codebase into the iaGO workflow.

**Precondition:** Codebase must exist. `.iago/PROJECT.md` should not exist yet.

**Agents:** `researcher`.

**Example:**
```
> /iago:onboard
# Scans directory structure, package.json, configs
# Produces: architecture map, tech debt inventory, populated PROJECT.md
```

---

### `/iago:n8n`

**Purpose:** Design n8n automation workflow specifications — node configurations, trigger definitions, data flow, IAM policies.

**Trigger:** Designing n8n automation workflows (webhooks, Lambda, DynamoDB events, SES).

**Agents:** None — orchestrator designs inline.

**Example:**
```
> /iago:n8n Design a workflow that triggers on new DynamoDB records and sends SES notifications
# Produces: workflow spec with node configs, trigger definitions, IAM policies
```

---

### `/iago:agents`

**Purpose:** Design multi-agent system architectures — agent roles, tool schemas, LangGraph state graphs, orchestration patterns.

**Trigger:** Designing multi-agent architectures for client deliverables.

**Agents:** None — orchestrator designs inline.

**Example:**
```
> /iago:agents Design a 3-agent system for automated customer support
# Produces: agent topology, tool schemas, state graph, orchestration pattern
```

---

## Core Skills (6)

General-purpose skills for design, planning, implementation, review, and research.

### `/brainstorming`

**Purpose:** Socratic design exploration. Explores a problem space through questions and trade-off analysis, produces a written spec.

**Trigger:** Starting a new feature, design decision, or architecture choice.

**Output:** Spec written to `docs/specs/`.

**Agents:** None — interactive conversation.

**Example:**
```
> /brainstorming How should we handle multi-tenant data isolation?
# Socratic questioning → trade-off analysis → written spec
```

---

### `/writing-plans`

**Purpose:** Break an approved spec into small, verifiable implementation tasks (2-5 min each) organized into parallel execution waves.

**Trigger:** Having an approved spec that needs implementation planning.

**Precondition:** Spec must exist (from `/brainstorming` or written manually).

**Agents:** None — planning only.

**Example:**
```
> /writing-plans for docs/specs/multi-tenant-isolation.md
# Produces: plan file with tasks, verification commands, execution waves
```

---

### `/subagent-driven-development`

**Purpose:** Execute an implementation plan by dispatching a fresh `implementer` agent per task. No cross-task state leakage.

**Trigger:** Executing a multi-task implementation plan.

**Arguments:** `--full-review` adds spec-reviewer + code-quality-reviewer.

**Agents:** `implementer`, `code-reviewer`, `spec-reviewer` (optional), `code-quality-reviewer` (optional).

**Example:**
```
> /subagent-driven-development for .iago/plans/phase-1-plan-01.md
# Task 1 → implementer → review → Task 2 → implementer → review → ...
```

---

### `/code-review`

**Purpose:** Dispatch reviewer against a git diff to produce a structured review with severity-categorized findings.

**Trigger:** Implementation complete, needs review before merge.

**Arguments:** `--full` adds spec-reviewer + code-quality-reviewer (two-stage review).

**Agents:** `code-reviewer`, `spec-reviewer` (optional), `code-quality-reviewer` (optional).

**Example:**
```
> /code-review
# Reviews staged changes → produces findings: Critical / Important / Minor
```

---

### `/deep-research`

**Purpose:** Multi-source research (codebase, context7 docs, web) synthesized into an actionable recommendation.

**Trigger:** Research, analysis, or competitive audit beyond the codebase.

**Output:** Research document written to `docs/research/`.

**Agents:** `researcher`.

**Example:**
```
> /deep-research Compare DynamoDB single-table vs multi-table for our access patterns
# Researches → analyzes → produces recommendation with evidence
```

---

### `/prompt-optimizer`

**Purpose:** Optimize Claude SDK prompts for client-facing features. Improve quality, reduce cost, select the right model tier.

**Trigger:** Building or tuning LLM prompts for chatbots, agents, classification, extraction.

**Output:** Optimized prompt written to `docs/prompts/`.

**Agents:** None — orchestrator works inline.

**Example:**
```
> /prompt-optimizer for our customer support classifier prompt
# Analyzes → rewrites → tests → produces optimized prompt with model recommendation
```

---

## Content Skills (7)

Skills for producing written content — articles, investor materials, presentations.

### `/article-writing`

**Purpose:** Produce polished long-form content (blog posts, thought leadership, tutorials) with an authoritative voice.

**Trigger:** Writing blog posts, articles, or long-form content.

**Agents:** `content-writer`.

---

### `/content-engine`

**Purpose:** Transform a single content source into multiple output formats (blog, social posts, newsletter, summary).

**Trigger:** Producing multi-format content from a single source.

**Agents:** `content-writer`.

---

### `/investor-materials`

**Purpose:** Produce investor-facing documents (pitch deck outlines, one-pagers, executive summaries) with data-driven narratives.

**Trigger:** Creating pitch decks, one-pagers, or investor-facing documents.

**Agents:** `content-writer`.

---

### `/investor-outreach`

**Purpose:** Draft personalized investor outreach emails and follow-up sequences tailored to each investor's thesis and portfolio.

**Trigger:** Drafting investor emails, follow-ups, or outreach sequences.

**Agents:** None — orchestrator writes inline.

---

### `/market-research`

**Purpose:** Structured market analysis — market sizing, competitive landscape, trend identification — for proposals or strategic planning.

**Trigger:** Analyzing markets, competitors, or industry trends.

**Agents:** None — orchestrator researches inline.

---

### `/visa-doc-translate`

**Purpose:** Translate and prepare visa/immigration documents with attention to legal terminology and consulate-specific conventions.

**Trigger:** Translating or preparing visa and immigration documents.

**Agents:** None — orchestrator translates inline.

---

### `/frontend-slides`

**Purpose:** Generate presentation slide content structured for React 19 + TailwindCSS 4 rendering or Marp-compatible markdown.

**Trigger:** Generating presentation slides from code, data, or content.

**Agents:** None — orchestrator generates inline.

---

## Experimental Skills (6)

Skills exploring advanced patterns — autonomous execution, persistent agents, payment protocols.

### `/autonomous-loops`

**Purpose:** Execute a bounded loop of autonomous work with safety rails (max iterations, cost ceiling, verify interval) without per-step approval.

**Trigger:** Bulk refactors, migration scripts, batch processing.

**Agents:** None — executes inline with safety rails.

---

### `/continuous-agent-loop`

**Purpose:** Run a persistent agent loop that watches for changes, reacts to events, and checkpoints state to survive context limits.

**Trigger:** Monitoring, polling, continuous integration tasks.

**Agents:** None — reacts inline.

---

### `/enterprise-agent-ops`

**Purpose:** Design production-grade multi-agent architectures (3-5 agents) with topology, LangGraph state graphs, n8n integration, and runbooks.

**Trigger:** Designing multi-agent systems for client deployments.

**Agents:** None — design specification only.

---

### `/agent-payment-x402`

**Purpose:** Design agent-to-agent payment flows using the x402 HTTP payment protocol, including safety rails and DynamoDB audit records.

**Trigger:** Implementing agent-to-agent payment flows.

**Agents:** None — design specification only.

---

### `/liquid-glass-design`

**Purpose:** Implement glassmorphism and liquid glass UI effects using TailwindCSS 4 + ShadCN/UI with WCAG-compliant composition.

**Trigger:** Implementing glassmorphism UI effects for client projects.

**Agents:** None — orchestrator implements inline.

---

### `/santa-method`

**Purpose:** Decompose a complex, ambiguous problem into structured sub-problems (Situation, Actors, Needs, Tensions, Actions) before exploring solutions.

**Trigger:** Complex, ambiguous problem that needs structured decomposition before solution design.

**Agents:** None — orchestrator facilitates inline.

---

## Industry Skills (9)

Domain-specific pattern libraries for vertical industries. These are advisory — they provide DynamoDB data models, API patterns, and compliance guidance for their domain.

### `/healthcare-phi-compliance`

**Purpose:** HIPAA-compliant DynamoDB, Cognito, API Gateway, Lambda, and SES patterns for handling protected health information (PHI).

**Trigger:** Building features that handle PHI.

**Covers:** Encryption at rest/transit, access controls, audit logging, BAA requirements, minimum necessary principle.

---

### `/carrier-relationship-management`

**Purpose:** DynamoDB data models, API patterns, and integration strategies for carrier onboarding, rate negotiation, and performance tracking.

**Trigger:** Building carrier management features for logistics clients.

**Covers:** Carrier profiles, rate tables, lane-level pricing, performance scorecards, contract management.

---

### `/customs`

**Purpose:** Patterns for customs and trade compliance — tariff classification, duty calculation, export controls, and restricted party screening.

**Trigger:** Building customs and trade compliance features.

**Covers:** HTS classification, duty/tax calculation, export license determination, denied party screening, AES filing.

---

### `/energy`

**Purpose:** Patterns for energy sector applications — smart metering, grid event processing, energy trading, and demand response.

**Trigger:** Building energy sector applications.

**Covers:** Meter data ingestion (DynamoDB TTL), grid event streams, energy trading positions, demand response programs.

---

### `/logistics`

**Purpose:** DynamoDB single-table design and event-driven patterns for shipment tracking, route planning, warehouse operations.

**Trigger:** Building logistics and supply chain features.

**Covers:** Shipment lifecycle, route optimization, warehouse bin management, n8n webhook integration, carrier API adapters.

---

### `/inventory`

**Purpose:** DynamoDB patterns for stock level management, optimistic-locking writes, reorder automation, multi-location transfers.

**Trigger:** Building inventory management features.

**Covers:** Stock tracking, reorder points, multi-location transfers, cycle counting, optimistic concurrency.

---

### `/production-scheduling`

**Purpose:** DynamoDB data models and Lambda-based scheduling patterns for work orders, resource allocation, and shift planning.

**Trigger:** Building manufacturing production scheduling features.

**Covers:** Work orders, resource allocation, shift planning, constraint-based scheduling, production line capacity.

---

### `/quality-nonconformance`

**Purpose:** DynamoDB data models, Cognito RBAC patterns, and CAPA workflows for inspection recording, defect classification, and corrective actions.

**Trigger:** Building quality control or nonconformance tracking features.

**Covers:** Inspection records, defect classification, CAPA workflows, root cause analysis, audit trails.

---

### `/returns-reverse-logistics`

**Purpose:** DynamoDB patterns, webhook integration, and disposition logic for RMA creation, return tracking, inspection, and refund processing.

**Trigger:** Building returns processing or reverse logistics features.

**Covers:** RMA creation, return shipping, inspection/grading, disposition (restock/refurbish/scrap), refund processing.
