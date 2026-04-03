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

### Workflow (iaGO)
- `/iago:init` — Bootstrap .iago/, gather vision, produce PROJECT/ROADMAP/STATE/config
- `/iago:discuss` — Clarify gray areas per phase, produce context artifact
- `/iago:plan` — Break phase into plans with tasks, self-review, no placeholders
- `/iago:execute` — Wave analysis, dispatch implementer per plan, review after
- `/iago:verify` — Goal-backward verification, ship PR if passed
- `/iago:fast` — Inline trivial tasks (<=3 files), atomic commit, STATE.md log
- `/iago:quick` — Lightweight plan -> implementer -> reviewer
- `/iago:pause` — Write HANDOFF.json to state/

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
