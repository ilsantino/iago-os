# Skills Reference

Complete catalog of all 31 iaGO-OS skills. Each skill is a reusable workflow you invoke with `/skill-name` inside Claude Code.

---

## Workflow Skills (13)

Skills that implement the iaGO delivery workflow: init, discuss, plan, execute, verify.

### `/iago:init`

**Purpose:** Bootstrap a new project — gather vision through interactive discovery, produce PROJECT.md, ROADMAP.md, STATE.md, and config.json.

**Trigger:** Starting a new client project or bootstrapping `.iago/` for an existing codebase.

**Precondition:** `.iago/PROJECT.md` must NOT already exist.

**Profiles:** `research` (optional, for scanning existing codebases).

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

**Arguments:** `--research` dispatches the `research` profile first.

**Profiles:** `research` (optional).

**Example:**
```
> /iago:plan phase 1
# Produces: .iago/plans/phase-1-plan-01.md, phase-1-plan-02.md, ...
```

---

### `/iago:execute`

**Purpose:** Execute all plans for a phase. Dispatches a matching profile per plan, then runs review after each plan completes.

**Trigger:** Executing implementation plans for a ROADMAP phase.

**Precondition:** Plans must exist for the phase.

**Profiles:** Matching profile per plan (fullstack/frontend/backend based on file paths), `review-single` or `review-full` after each plan, `debug` ad-hoc.

**Example:**
```
> /iago:execute phase 1
# Dispatches matching profile for plan 1 → review → matching profile for plan 2 → review → ...
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

**Profiles:** Matching profile (fullstack/frontend/backend), `review-single`, `research` (optional).

**Example:**
```
> /iago:quick Add a loading spinner to the dashboard page
# Plans 1-3 tasks → dispatches matching profile → review → done
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

**Profiles:** `content`.

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

**Profiles:** `research`.

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

**Purpose:** Design multi-agent system architectures — agent roles, tool schemas, LangGraph state graphs, orchestration patterns. Use `--scope operational` for production-grade multi-agent design with 3-5 agents, LangGraph state graphs, n8n integration, and runbooks.

**Trigger:** Designing multi-agent architectures for client deliverables.

**Arguments:** `--scope operational` — production-grade design with topology, runbooks, and operational patterns.

**Agents:** None — orchestrator designs inline.

**Example:**
```
> /iago:agents Design a 3-agent system for automated customer support
# Produces: agent topology, tool schemas, state graph, orchestration pattern

> /iago:agents Design a customer support system --scope operational
# Produces: production-grade topology, LangGraph state graph, n8n integration, runbooks
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

**Purpose:** Execute an implementation plan by dispatching a fresh matching profile per task. No cross-task state leakage.

**Trigger:** Executing a multi-task implementation plan.

**Arguments:** `--full-review` uses `review-full` (two-stage gated review).

**Profiles:** Matching profile per task (fullstack/frontend/backend), `review-single` or `review-full`.

**Example:**
```
> /subagent-driven-development for .iago/plans/phase-1-plan-01.md
# Task 1 → matching profile → review → Task 2 → matching profile → review → ...
```

---

### `/code-review`

**Purpose:** Dispatch reviewer against a git diff to produce a structured review with severity-categorized findings.

**Trigger:** Implementation complete, needs review before merge.

**Arguments:** `--full` uses `review-full` profile (two-stage gated review).

**Profiles:** `review-single` (default) or `review-full` (with `--full` flag).

**Example:**
```
> /code-review
# Reviews staged changes → produces findings: Critical / Important / Minor
```

---

### `/deep-research`

**Purpose:** Multi-source research (codebase, context7 docs, web) synthesized into an actionable recommendation. Use `--focus market` for market sizing, competitive landscape analysis, and trend identification.

**Trigger:** Research, analysis, competitive audit, or market analysis beyond the codebase.

**Arguments:** `--focus market` — structured market analysis (market sizing, competitors, trends) for proposals or strategic planning.

**Output:** Research document written to `docs/research/`.

**Profiles:** `research`.

**Example:**
```
> /deep-research Compare DynamoDB single-table vs multi-table for our access patterns
# Researches → analyzes → produces recommendation with evidence

> /deep-research --focus market SaaS ticketing platforms for museums
# Market sizing → competitive landscape → trend analysis → strategic recommendation
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

## Content Skills (5)

Skills for producing written content — articles, investor materials, presentations.

### `/content-engine`

**Purpose:** Transform a single content source into multiple output formats. Use `--formats blog` for standalone blog posts and thought leadership articles. Other formats: `social` (Twitter, LinkedIn, Threads), `newsletter`, `summary`.

**Trigger:** Producing articles, multi-format content, or blog posts from a single source.

**Arguments:** `--formats blog` — standalone article/thought leadership. `--formats blog,social,newsletter` — full multi-format output. `--platforms twitter,linkedin` — target specific social channels.

**Profiles:** `content`.

**Example:**
```
> /content-engine --formats blog AI agents in supply chain management --tone technical
# Produces: polished long-form article with authoritative consulting voice

> /content-engine docs/content/ai-agents-article.md --platforms twitter,linkedin
# Produces: blog + social posts + newsletter + summary in docs/content/{slug}/
```

---

### `/investor-materials`

**Purpose:** Produce investor-facing documents (pitch deck outlines, one-pagers, executive summaries) with data-driven narratives.

**Trigger:** Creating pitch decks, one-pagers, or investor-facing documents.

**Profiles:** `content`.

---

### `/investor-outreach`

**Purpose:** Draft personalized investor outreach emails and follow-up sequences tailored to each investor's thesis and portfolio.

**Trigger:** Drafting investor emails, follow-ups, or outreach sequences.

**Agents:** None — orchestrator writes inline.

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

## Experimental Skills (5)

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

## Industry Skills (2)

Domain-specific pattern libraries for vertical industries. These are advisory — they provide DynamoDB data models, API patterns, and compliance guidance for their domain.

### `/healthcare-phi-compliance`

**Purpose:** HIPAA-compliant DynamoDB, Cognito, API Gateway, Lambda, and SES patterns for handling protected health information (PHI).

**Trigger:** Building features that handle PHI.

**Covers:** Encryption at rest/transit, access controls, audit logging, BAA requirements, minimum necessary principle.

---

### `/industry-patterns`

**Purpose:** Parameterized skill that loads domain-specific DynamoDB schemas, API patterns, and integration strategies for a named vertical. Pass `--domain` to select the domain.

**Trigger:** Building features for a specific industry vertical where standard patterns apply.

**Arguments:** `--domain <name>` — required. Options:
- `logistics` — Shipment lifecycle, route optimization, warehouse bin management, carrier API adapters
- `carrier-management` — Carrier profiles, rate tables, lane-level pricing, performance scorecards
- `customs` — HTS classification, duty/tax calculation, export license determination, denied party screening
- `energy` — Meter data ingestion (DynamoDB TTL), grid event streams, energy trading positions, demand response
- `inventory` — Stock tracking, reorder points, multi-location transfers, optimistic concurrency
- `production-scheduling` — Work orders, resource allocation, shift planning, constraint-based scheduling
- `quality-nonconformance` — Inspection records, defect classification, CAPA workflows, root cause analysis
- `returns` — RMA creation, return shipping, inspection/grading, disposition, refund processing

**Reference docs:** Full DynamoDB schemas, access patterns, and API examples for each domain live in `docs/patterns/`.

**Agents:** None — orchestrator loads patterns and advises inline.

**Example:**
```
> /industry-patterns --domain logistics
# Loads: shipment lifecycle schema, warehouse bin management, carrier API adapter patterns

> /industry-patterns --domain inventory
# Loads: stock tracking schema, optimistic-locking writes, reorder automation patterns
```
