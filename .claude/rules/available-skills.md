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
- `/content-engine` — Blog posts, articles, and multi-format output (`--formats blog` for standalone articles)
- `/investor-materials` — Pitch decks, one-pagers
- `/investor-outreach` — Investor emails and outreach sequences
- `/visa-doc-translate` — Visa document translation
- `/frontend-slides` — Presentation slides from code/data

### Experimental
- `/autonomous-loops` — Long autonomous tasks without per-step approval
- `/continuous-agent-loop` — Persistent agent with cross-iteration state
- `/agent-payment-x402` — Agent-to-agent payment via x402
- `/liquid-glass-design` — Glassmorphism UI effects (TailwindCSS 4)
- `/santa-method` — Structured problem decomposition for ambiguous problems

### Industry
- `/healthcare-phi-compliance` — HIPAA/PHI compliance patterns
- `/industry-patterns` — Parameterized skill for 8 industry domains (`--domain logistics|inventory|customs|energy|carrier|production|quality|returns`). Pattern docs in `docs/patterns/`

### Post-Review
- `/iago:prfix` — Fix all PR review comments, dispatch through pipeline, push, request re-review

### Workflow (iaGO)
- `/iago:init` — Bootstrap .iago/, gather vision, produce PROJECT/ROADMAP/STATE/config
- `/iago:discuss` — Clarify gray areas per phase, produce context artifact
- `/iago:plan` — Break phase into plans with tasks, self-review, no placeholders
- `/iago:execute` — Wave analysis, dispatch profile per plan, review after
- `/iago:verify` — Goal-backward verification, ship PR if passed
- `/iago:fast` — Inline trivial tasks (<=3 files), atomic commit, STATE.md log
- `/iago:quick` — Lightweight plan -> pipeline (full review + async fix loop)
- `/iago:pause` — Write HANDOFF.json to state/
- `/iago:scaffold` — Scaffold new client project from iaGO template (React 19 + Vite + AWS)
- `/iago:proposal` — Generate client proposal (scope, timeline, cost, tech approach)
- `/iago:onboard` — Scan existing codebase, produce architecture map, populate PROJECT.md
- `/iago:n8n` — Design n8n automation workflows (webhooks, Lambda, DynamoDB events)
- `/iago:agents` — Design multi-agent architectures (Claude SDK + LangGraph)
- `/iago:schedule` — Install trigger templates or create custom scheduled automations

### Built-in (Claude Code native)
- `/simplify` — Review changed code for reuse, quality, and efficiency, then fix issues found
- `/loop` — Run a prompt or command on a recurring interval (e.g., `/loop 5m /codex:status`)
- `/schedule` — Create, update, or run cron-scheduled remote agents (triggers)
- `/claude-api` — Guidance for building with Claude API, Anthropic SDK, or Agent SDK

### MCP Servers (active)
- `context7` — Fetch current library/framework docs (React, Tailwind, ShadCN, AWS SDK, etc.) — prefer over web search for API syntax and setup

### Marketplace Plugins (not installed — evaluate when needed)
- `typescript-lsp` — Real-time TS diagnostics via language server (may replace post-edit-typecheck hook)
- `playwright` — Playwright integration (may complement `e2e` profile)
- `github` — PR/issue management directly from Claude Code

### Codex (cross-model, plugin-managed)
- `/codex:review` — GPT-5.4 read-only code review against git changes
- `/codex:adversarial-review` — **Mandatory** cross-model review on every plan (auth, data loss, race conditions, business logic)
- `/codex:rescue` — Delegate debugging or implementation to Codex in background (`--write` for fixes)
- `/codex:status` — Show active and recent Codex background jobs
- `/codex:result` — Retrieve output from a finished Codex job
- `/codex:cancel` — Cancel an active background Codex job
- `/codex:setup` — Check Codex CLI readiness and manage review gate

## Agent Architecture (3 bases + 13 capabilities + 12 profiles)

Hub-and-spoke: only the orchestrator dispatches agents — agents never spawn other agents.

### Base Agents (3 — tool access tiers)
- `executor` — Can read, write, and run commands. For implementation tasks. Tools: Read, Glob, Grep, Edit, Write, Bash, Notebook
- `analyst` — Can read and run diagnostics. For reviews, modeling, analysis. Tools: Read, Glob, Grep, Bash
- `operator` — Can read, run commands, and search web. For research, content, infra. Tools: Read, Glob, Grep, Bash, WebSearch, WebFetch

### Capability Modules (13 — injected into agent prompts)
react-19, dynamodb, lambda, cognito, tdd, security, e2e, review-spec, review-quality, content, infra, forms, animation

### Profiles (12 — pre-composed base + capabilities)
- `fullstack` (executor) — react-19 + dynamodb + lambda + tdd + forms + animation — full-stack implementation
- `frontend` (executor) — react-19 + tdd + forms + animation — frontend-only implementation
- `backend` (executor) — dynamodb + lambda + cognito + tdd — backend-only implementation
- `review-single` (analyst) — security + review-spec + review-quality — single-pass code review
- `review-full` (analyst) — security + review-spec + review-quality — two-stage gated review
- `security-audit` (analyst, opus) — security + cognito + review-quality — deep security review
- `research` (operator) — dynamic capabilities — deep research across codebase and web
- `e2e` (executor) — e2e + react-19 — Playwright E2E test writing
- `infra` (operator) — infra — AWS CLI, Amplify Gen 2 deployments, sandbox management
- `schema` (analyst) — dynamodb — DynamoDB schema design (evaluates single vs multi-table)
- `content` (operator) — content — articles, investor materials, outreach
- `debug` (executor) — dynamic capabilities — build/typecheck/lint error resolution

### Behavioral Rules (always active)
- Verification: never claim done without evidence (CLAUDE.md)
- Search-first: search before creating (CLAUDE.md)
- TDD: red-green-refactor discipline (rules/tdd.md)
- Debugging: 4-phase systematic method (rules/systematic-debugging.md)
- E2E patterns: Playwright conventions (rules/e2e-testing.md)
- MCP patterns: Node/TS SDK conventions (rules/mcp-server-patterns.md)
