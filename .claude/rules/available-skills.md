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

### Built-in (Claude Code native)
- `/simplify` — Review changed code for reuse, quality, and efficiency, then fix issues found
- `/loop` — Run a prompt or command on a recurring interval (e.g., `/loop 5m /codex:status`)
- `/schedule` — Create, update, or run cron-scheduled remote agents (triggers)
- `/claude-api` — Guidance for building with Claude API, Anthropic SDK, or Agent SDK

### MCP Servers (active)
- `context7` — Fetch current library/framework docs (React, Tailwind, ShadCN, AWS SDK, etc.) — prefer over web search for API syntax and setup

### Marketplace Plugins (not installed — evaluate when needed)
- `typescript-lsp` — Real-time TS diagnostics via language server (may replace post-edit-typecheck hook)
- `playwright` — Playwright integration (may complement e2e-runner agent)
- `github` — PR/issue management directly from Claude Code

### Codex (cross-model, plugin-managed)
- `/codex:review` — GPT-5.4 read-only code review against git changes
- `/codex:adversarial-review` — Challenge review targeting auth, data loss, race conditions, rollback safety
- `/codex:rescue` — Delegate debugging or implementation to Codex in background (`--write` for fixes)
- `/codex:status` — Show active and recent Codex background jobs
- `/codex:result` — Retrieve output from a finished Codex job
- `/codex:cancel` — Cancel an active background Codex job
- `/codex:setup` — Check Codex CLI readiness and manage review gate

### Available Agents (11 — all Sonnet, hub-and-spoke)
- `implementer` — Execute tasks from plans (React 19, DynamoDB, Amplify patterns built-in)
- `code-reviewer` — Single-pass review with OWASP + AWS security checklist
- `spec-reviewer` — Spec compliance with stack-specific validation (Stage 1)
- `code-quality-reviewer` — Quality review with React/DynamoDB/Lambda checks (Stage 2)
- `researcher` — Deep research via codebase, context7, and web sources
- `tdd-guide` — RED-GREEN-REFACTOR with Vitest + React Testing Library patterns
- `build-error-resolver` — 4-phase debugging with common Vite/TS/Amplify error patterns
- `e2e-runner` — Playwright E2E with Cognito auth, ShadCN selectors, Suspense patterns
- `content-writer` — Articles, investor materials, market research, outreach, presentations
- `infra-runner` — AWS CLI, Amplify, CDK, DynamoDB, Lambda, Cognito, SES operations
- `data-modeler` — DynamoDB single-table design, access patterns, GSI strategy

### Behavioral Rules (always active)
- Verification: never claim done without evidence (CLAUDE.md)
- Search-first: search before creating (CLAUDE.md)
- TDD: red-green-refactor discipline (rules/tdd.md)
- Debugging: 4-phase systematic method (rules/systematic-debugging.md)
- E2E patterns: Playwright conventions (rules/e2e-testing.md)
- MCP patterns: Node/TS SDK conventions (rules/mcp-server-patterns.md)
