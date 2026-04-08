# iaGO-OS

<div align="center">

<img src="https://img.shields.io/badge/Claude_Code-config_layer-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Code">
<img src="https://img.shields.io/badge/Skills-33-blue?style=for-the-badge" alt="Skills">
<img src="https://img.shields.io/badge/Agent_Profiles-12-green?style=for-the-badge" alt="Agent Profiles">
<img src="https://img.shields.io/badge/Platform-Windows_%7C_macOS-lightgrey?style=for-the-badge" alt="Platform">
<img src="https://img.shields.io/badge/License-Proprietary-red?style=for-the-badge" alt="License">

**Turn Claude Code into a disciplined project delivery system.**

*Plan with verification. Implement with TDD. Review with multiple models. Ship with evidence.*

</div>

---

A configuration layer for [Claude Code](https://claude.ai/code) that turns it into a structured project delivery system.

iaGO-OS is not a framework, not an SDK, and not a SaaS product. It's a set of files — markdown skills, agent profiles, hook scripts, and state management — that sit alongside your code in `.claude/` and `.iago/` directories. When Claude Code loads your project, it reads these files and becomes a disciplined delivery system instead of a blank-slate chatbot.

**Who it's for:** Teams and solo developers shipping real projects with Claude Code. We built it for our own 3-person AI consultancy running multiple client projects simultaneously — it solves the problems we hit every day.

**What it solves:**

- **Context rot.** Claude forgets everything between sessions. iaGO-OS hooks save and restore session state automatically. Every conversation picks up where the last one left off.
- **Config drift.** Without constraints, Claude writes inconsistent code — different patterns, different libraries, different quality. iaGO-OS enforces your stack, your conventions, and your review standards through rules and hooks.
- **Invisible work.** When Claude dispatches subagents, you can't see what they did or whether the results were verified. iaGO-OS profiles define what each agent can do, learnings accumulate across sessions, and every task ends with evidence — not claims.
- **No workflow.** Claude will happily write code without planning, skip tests, and call it done. iaGO-OS imposes a delivery pipeline: plan with verification commands, implement with TDD, review with multiple models, verify against goals before shipping.

**How it works:** You type `/iago:init` and Claude asks about your project. It produces a roadmap. You run `/iago:plan` and it breaks the next phase into tasks. You run `/iago:execute` and it dispatches specialized agents — one per task — then reviews each one through a 3-stage pipeline (internal review, quality check, cross-model adversarial review via GPT-5.4). You run `/iago:verify` and it checks every goal against real evidence. If it passes, it opens a PR.

For small stuff: `/iago:quick` does plan-implement-review in one shot. `/iago:fast` skips everything for a 3-file fix. `/iago:prfix` fixes PR review comments automatically.

## What It Looks Like

```bash
# Scaffold a new client project
./scripts/new-client.sh --name "Acme Corp" --project "dashboard" --path ../acme-dashboard
cd ../acme-dashboard && claude
```

Inside Claude Code:

```
> /iago:init                    # Interactive discovery → PROJECT.md + ROADMAP.md
> /iago:discuss phase 1         # Clarify ambiguities → context artifact
> /iago:plan phase 1            # Decompose into tasks → plan files
> /iago:execute phase 1         # Agent dispatch → build → review → PR
> /iago:verify phase 1          # Goal verification → ship or re-plan
```

Bypass modes for quick work:

```
> /iago:quick Add a loading spinner to the dashboard    # 1-3 tasks, one pass
> /iago:fast Fix the typo in the login button           # Inline, no agents
```

See the [Usage Manual](docs/MANUAL.md) for the complete how-to guide.

## Prerequisites

You need these installed before using iaGO-OS. Every tool listed here is used by the stack — skip one and something will break.

| Tool | Min Version | Install | Verify |
|------|-------------|---------|--------|
| **Node.js** | 20+ | [nodejs.org](https://nodejs.org/) | `node --version` |
| **Git** | 2.30+ | [git-scm.com](https://git-scm.com/) | `git --version` |
| **Claude Code** | Latest | `npm install -g @anthropic-ai/claude-code` | `claude --version` |
| **AWS CLI** | 2.x | [AWS CLI install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) | `aws --version` |
| **GitHub CLI** | 2.x | [cli.github.com](https://cli.github.com/) | `gh --version` |

### Why each one matters

- **Node.js 20+** — Runtime for hooks, state engine, Lambda functions, and all build tooling (Vite, Biome, Vitest)
- **Git** — Version control, branching workflow, conventional commits enforced by hooks
- **Claude Code** — The AI coding agent that iaGO-OS configures. Everything runs inside Claude Code sessions
- **AWS CLI** — Required for Amplify Gen 2 deployments, Lambda management, DynamoDB operations, and all infra-runner agent tasks
- **GitHub CLI (`gh`)** — Used by `/iago:verify` to open PRs, and by hooks for GitHub integration

### Optional (but recommended)

| Tool | What for | Install | Verify |
|------|----------|---------|--------|
| **Codex CLI** | Cross-model review with GPT-5.4 (`/codex:*` skills) | `npm install -g @openai/codex` | `codex --version` |
| **Playwright** | E2E testing (installed per-project via npm) | `npx playwright install` | `npx playwright --version` |

### First-time setup

After installing the prerequisites:

1. **Authenticate Claude Code:** `claude` (prompts for login on first run)
2. **Authenticate AWS:** `aws configure` (needs Access Key ID, Secret Key, region)
3. **Authenticate GitHub:** `gh auth login` (follow the prompts)

## Quick Start

```bash
# 1. Clone iaGO-OS
git clone https://github.com/iagoai/iago-os.git
cd iago-os

# 2. Install skills globally (available in every Claude Code session)
./scripts/sync-skills.sh --global

# 3. Scaffold your first project
./scripts/new-client.sh --name "My Client" --project "my-app" --path ../my-app
cd ../my-app && claude
```

See [docs/SETUP.md](docs/SETUP.md) for detailed instructions (Windows + macOS).

## Skills (33)

Skills are reusable workflows you invoke with `/skill-name` inside Claude Code. Each skill knows what steps to follow, which profiles to dispatch, what artifacts to produce, and what evidence to collect before reporting done.

### Workflow — The Delivery Pipeline

These skills implement the full project lifecycle. Run them in order for structured delivery, or use the bypass modes for quick work.

| Skill | What it does | When to use | Dispatches |
|-------|-------------|-------------|------------|
| `/iago:init` | Interactive discovery — asks about vision, constraints, phases. Produces PROJECT.md, ROADMAP.md, STATE.md, config.json | Starting a new client project | `research` (optional) |
| `/iago:discuss` | Surfaces 3-5 ambiguities in a ROADMAP phase, records decisions as a context artifact | Before planning a phase — clarifies gray areas | None (interactive) |
| `/iago:plan` | Decomposes a phase into plans with 2-8 tasks each. Every task has a verification command. Self-reviews for gaps | After discuss, before execute | `research` (optional) |
| `/iago:execute` | Wave analysis, profile dispatch per plan, build gate, 3-stage review pipeline, learnings extraction. The heavy lifter | When plans exist for a phase | Matching profile + review + `/codex:adversarial-review` |
| `/iago:verify` | Goal-backward verification — checks every ROADMAP success criterion against evidence (test output, build, file existence). Opens PR if passed | After all plans in a phase are executed | None (orchestrator-direct) |
| `/iago:quick` | One-shot path: lightweight plan → full pipeline (implement → build gate → review → codex → PR). Composable flags: `--discuss`, `--research`, `--verify` | Small standalone task (1-3 tasks) outside a ROADMAP phase | Pipeline (same as `/iago:execute`) |
| `/iago:fast` | Inline execution with atomic commit. No planning, no agents, no review | Trivial fix — 3 files or fewer, obvious change | None (inline) |
| `/iago:prfix` | Fetches all PR review comments via `gh`, dispatches parallel agents to fix each, verifies, runs tests/linter, commits, pushes, and tags reviewer for re-review | After PR gets review comments | Matching profile per fix |
| `/iago:pause` | Writes HANDOFF.json with workflow position, completed tasks, next action. Next session auto-resumes | Switching context, ending day, hitting a blocker | None |

### Workflow — Project Setup

| Skill | What it does | When to use |
|-------|-------------|-------------|
| `/iago:scaffold` | Creates a new project directory from the iaGO template (React 19 + Vite + TS + Tailwind + ShadCN + AWS Amplify Gen 2). Copies hooks, replaces template variables, inits git | Starting a greenfield client project |
| `/iago:proposal` | Generates a structured client proposal: scope, timeline, cost estimate, technical approach, deliverables. Dispatches `content` profile for prose quality | Pre-engagement — scoping a new client |
| `/iago:onboard` | Scans an existing codebase (directory structure, package.json, configs), produces architecture map and tech debt inventory, populates PROJECT.md | Onboarding an existing repo into iaGO workflow |
| `/iago:n8n` | Designs n8n automation workflow specs: node configs, trigger definitions, data flow diagrams, IAM policies | Designing webhook/event-driven automations |
| `/iago:agents` | Designs multi-agent architectures: agent roles, tool schemas, LangGraph state graphs, orchestration patterns. Use `--scope operational` for production-grade multi-agent design with topology, runbooks, and n8n integration | Designing agent systems for client deliverables |
| `/iago:schedule` | Install automated triggers (nightly review, usage digest, build health) from templates or create custom cron jobs | Setting up recurring automation for a project |

### Core — Design, Plan, Build, Review, Research

| Skill | What it does | When to use | Dispatches |
|-------|-------------|-------------|------------|
| `/brainstorming` | Socratic design exploration — asks questions, maps trade-offs, writes a spec to `docs/specs/` | Starting a new feature or architecture decision | None (interactive) |
| `/writing-plans` | Breaks an approved spec into 2-5 min tasks organized into parallel execution waves. Every task has a verify command | After brainstorming produces a spec | None (planning only) |
| `/subagent-driven-development` | Executes a plan by dispatching a fresh profile per task. No cross-task state leakage. Mandatory Codex adversarial review after internal review | Executing a multi-task implementation plan | Matching profile + review + `/codex:adversarial-review` |
| `/code-review` | Dispatches review profile against a git diff. Produces severity-categorized findings (Critical/Important/Minor). Anti-performative-agreement rules prevent empty "LGTM" | After implementation, before merge | `review-single` or `review-full` + `/codex:adversarial-review` |
| `/deep-research` | Multi-source research (codebase + context7 docs + web). Produces an actionable recommendation document in `docs/research/`. Use `--focus market` for market analysis and competitive research | Research question that goes beyond the codebase | `research` |
| `/prompt-optimizer` | Analyzes, rewrites, and tests LLM prompts for client-facing features. Recommends model tier. Output to `docs/prompts/` | Building or tuning chatbot/agent/classifier prompts | None (inline) |

### Content — Articles, Investor Materials, Presentations

| Skill | What it does | Dispatches |
|-------|-------------|------------|
| `/content-engine` | Multi-format content from a single source: blog (`--formats blog`), social posts, newsletter, summary. Use `--formats blog` for standalone articles | `content` |
| `/investor-materials` | Pitch deck outlines, one-pagers, executive summaries with data-driven narratives | `content` |
| `/investor-outreach` | Personalized investor emails and follow-up sequences tailored to each investor's thesis | None (inline) |
| `/visa-doc-translate` | Visa/immigration document translation with legal terminology and consulate conventions | None (inline) |
| `/frontend-slides` | Presentation slide content for React 19 + TailwindCSS 4 rendering or Marp markdown | None (inline) |

### Experimental — Advanced Patterns

| Skill | What it does |
|-------|-------------|
| `/autonomous-loops` | Bounded autonomous work with safety rails (max iterations, cost ceiling, verify interval) |
| `/continuous-agent-loop` | Persistent agent that watches for changes, reacts to events, checkpoints state |
| `/agent-payment-x402` | Agent-to-agent payment flows via x402 HTTP payment protocol |
| `/liquid-glass-design` | Glassmorphism and liquid glass UI effects with TailwindCSS 4 + ShadCN/UI |
| `/santa-method` | SANTA decomposition (Situation, Actors, Needs, Tensions, Actions) for ambiguous problems |

### Industry — Domain-Specific Pattern Libraries

Advisory skills that provide DynamoDB schemas, API patterns, and compliance guidance for vertical industries.

| Skill | Domain | Covers |
|-------|--------|--------|
| `/healthcare-phi-compliance` | Healthcare | HIPAA encryption, access controls, audit logging, BAA requirements |
| `/industry-patterns` | Multi-domain | Parameterized skill for 8 domains — pass `--domain` to select: `logistics`, `carrier-management`, `customs`, `energy`, `inventory`, `production-scheduling`, `quality-nonconformance`, `returns` |

Domain pattern reference docs (DynamoDB schemas, API patterns) live in `docs/patterns/`.

Full reference with triggers, arguments, and code examples: [docs/SKILLS.md](docs/SKILLS.md)

## Agent Architecture

### Hub-and-Spoke

iaGO-OS uses a hub-and-spoke model. Your main Claude Code session is the **orchestrator** (Opus) — it plans, reasons, and dispatches work. Agents are **capability-based**: each task is matched to a profile, the orchestrator selects a model, composes the prompt from a base + capability modules + learnings, and dispatches. Agents never spawn other agents, and they never talk to each other. All coordination flows through the orchestrator.

```mermaid
flowchart TD
    You([You]) -->|talk to| Orch

    subgraph Orchestrator [Orchestrator — Opus]
        Orch[Main Session]
        PM[Profile Matching]
        MC[Model Selection]
        Orch --> PM --> MC
    end

    MC -->|compose + dispatch| E[Executor Base]
    MC -->|compose + dispatch| A[Analyst Base]
    MC -->|compose + dispatch| O[Operator Base]

    subgraph Capabilities [13 Capability Modules]
        direction LR
        C1[react-19]
        C2[dynamodb]
        C3[tdd]
        C4[security]
        C5[...]
    end

    Capabilities -.->|injected into| E
    Capabilities -.->|injected into| A
    Capabilities -.->|injected into| O

    E -->|status| Orch
    A -->|status| Orch
    O -->|status| Orch
```

Every agent ends its response with exactly one of four statuses — no ambiguity about whether work is finished.

### Tool Sandboxing

Each base gets only the tools appropriate for its role. This prevents accidents and keeps agents focused:

| Base | Can read | Can write | Can run commands | Can search web |
|------|----------|-----------|-----------------|----------------|
| `executor` | Yes | Yes | Yes | No |
| `analyst` | Yes | No | Yes (diagnostics) | No |
| `operator` | Yes | No | Yes | Yes |

Analysts can't edit files. Executors can't search the web. This is by design.

### Review Pipeline

Both `/iago:execute` and `/iago:quick` run the same `scripts/execute-pipeline.sh`. Every plan goes through 6 local stages as separate `claude -p` sessions, then an async GitHub Action review-fix loop — no context bleed, no token burn in the orchestrator:

```mermaid
flowchart LR
    Plan[Plan file] --> Impl[1. Implement — Sonnet]
    Impl --> Build[2. Build gate — tsc + vite]
    Build -->|fail| Fix[Fix — Sonnet]
    Fix --> Build
    Build -->|pass| Review[3. Review — Sonnet]
    Review -->|critical| Fix2[Fix — Sonnet]
    Fix2 --> Build
    Review -->|pass| Codex[4. Codex — GPT-5.4]
    Codex --> PR[5. Create PR — Sonnet]
    PR --> Tag[5b. Tag @claude]
    Tag --> Summary[6. Summary]
    Tag -.->|async| GHA[GitHub Action review-fix loop]
```

1. **Implement (Sonnet):** Writes code from the plan, constrained to Edit/Write/Read/Glob/Grep/Bash
2. **Build gate:** `tsc --noEmit && vite build` — max 2 retries with Sonnet fix sessions
3. **Review (Sonnet):** Checks diff against plan — Critical/Important/Minor findings
4. **Codex adversarial (GPT-5.4):** Cross-model review for auth bypass, data loss, race conditions
5. **Create PR (Sonnet):** Stages, commits, pushes feature branch, creates PR via `gh`
5b. **Tag @claude:** Haiku synthesizes review request, posts on PR
6. **Summary:** Persists result to `.iago/summaries/` for `/iago:verify`

Critical findings trigger automatic fix → rebuild → re-review (max 2 rounds).
After PR creation, `claude-review-fix.yml` handles the async fix loop: Claude reviews → fix Action → push → re-tag → repeat until clean (max 5 rounds). Human reviews and merges.

### Capability Modules (13)

Domain knowledge injected into agent prompts at dispatch time. Each module is a markdown file in `.claude/agents/capabilities/`:

| Capability | What it teaches the agent |
|-----------|--------------------------|
| `react-19` | `use()` + Suspense data fetching, ShadCN/UI patterns, TanStack Query, concurrent UI |
| `animation` | Framer Motion, GSAP + ScrollTrigger, Lenis smooth scroll, integration rules, a11y |
| `dynamodb` | Single-table vs multi-table decision criteria, access patterns, GSI strategy, batch ops, TTL |
| `lambda` | Thin handler pattern, cold start mitigation, ESM, environment config |
| `cognito` | JWT validation in API Gateway, token refresh, custom attributes, pre-signup triggers |
| `tdd` | RED-GREEN-REFACTOR cycle, rationalization prevention, coverage rules |
| `security` | OWASP Top 10, AWS-specific checks, hardcoded secrets, CORS, tenant isolation |
| `e2e` | Playwright selectors, `data-testid`, Page Object Model, auth via `storageState` |
| `review-spec` | Plan compliance verification — file paths, actions, tests, no deviations |
| `review-quality` | Performance, TypeScript strictness, maintainability, React/DynamoDB conventions |
| `content` | Consulting voice, multi-format output, channel adaptation, no filler |
| `infra` | AWS CLI, Amplify Gen 2, IAM, deployment patterns |
| `forms` | React Hook Form + Zod, ShadCN Controller integration, server error mapping |

### Agent Profiles (12)

Pre-composed base + capability combinations. The orchestrator selects the right profile based on file paths and task description.

| Profile | Base | Capabilities | Model | When dispatched |
|---------|------|-------------|-------|-----------------|
| `fullstack` | executor | react-19, dynamodb, lambda, tdd, forms, animation | opus | Task touches both `src/` and `amplify/` (also the fallback) |
| `frontend` | executor | react-19, tdd, forms, animation | opus | Task only touches `src/` — no backend changes |
| `backend` | executor | dynamodb, lambda, cognito, tdd | opus | Task only touches `amplify/` — no frontend changes |
| `review-single` | analyst | security, review-spec, review-quality | sonnet | Default review after implementation (`review.mode: "single"`) |
| `review-full` | analyst | security, review-spec, review-quality | sonnet | Two-stage gated review (`review.mode: "full"`) — Stage 1 must pass before Stage 2 |
| `security-audit` | analyst | security, cognito, review-quality | opus | Auth, payment, or data-access changes — always Opus, never downgraded |
| `research` | operator | dynamic (context-dependent) | sonnet | `/deep-research`, `--research` flag on plan/quick skills |
| `e2e` | executor | e2e, react-19 | opus | Writing or updating Playwright E2E tests |
| `infra` | operator | infra | sonnet | AWS CLI, Amplify Gen 2 deployments, sandbox management |
| `schema` | analyst | dynamodb | sonnet | DynamoDB schema design (evaluates single vs multi-table), access pattern analysis |
| `content` | operator | content | sonnet | Articles, proposals, investor materials, outreach |
| `debug` | executor | dynamic (context-dependent) | opus | Build/typecheck/lint failures — capabilities selected based on error context |

## Hooks (8)

Hooks are automatic behaviors wired in `.claude/settings.json`. They fire on Claude Code lifecycle events — you never invoke them manually.

### Context & State

| Hook | Fires on | What it does | Why it matters |
|------|----------|-------------|----------------|
| `context-persistence` | Session start, pre-compact, stop | Saves a session snapshot before context compression. Restores the previous session's state on startup. Loads HANDOFF.json if `/iago:pause` was used | Every conversation picks up where the last one left off — no re-explaining the project |
| `usage-tracker` | After skill/agent use, session stop | Logs every skill invocation and agent dispatch to `.iago/state/usage-log.jsonl`. Writes a session summary at stop (duration, skills used, agents dispatched) | Feeds the usage report script and future dashboard |

### Safety & Quality

| Hook | Fires on | What it does | Why it matters |
|------|----------|-------------|----------------|
| `safety-guard` | Before bash, edit, write | Blocks commands that could leak secrets (`env`, `printenv`, `.env` reads), destructive operations (`rm -rf`, `drop table`), and disk-level writes | Prevents accidental damage to the project or credential exposure |
| `config-protection` | Before edit, write | Blocks changes that weaken Biome, TypeScript, or linter configs (disabling rules, loosening `strict`, adding `skipLibCheck`) | Config drift is how code quality erodes — this stops it at the source |
| `commit-quality` | Before bash (git commit) | Validates conventional commit format: type prefix required, subject under 72 chars, no WIP on main | Enforces clean git history without relying on developer discipline |

### Post-Edit Pipeline

| Hook | Fires on | What it does | Why it matters |
|------|----------|-------------|----------------|
| `post-edit-format` | After file edit | Runs `npx biome format --write` on the edited file | Every edit is auto-formatted — no style debates, no format commits |
| `post-edit-typecheck` | After TS/TSX edit | Runs `npx tsc --noEmit` on the edited file and reports type errors immediately | Type errors caught in seconds, not after a full build |
| `post-edit-console-warn` | After file edit | Scans the edited file for `console.log` and warns if found in production code paths | `console.log` in production is a code smell — catch it before review |

## Ecosystem Integrations

iaGO-OS builds on top of Claude Code's native capabilities and third-party plugins. These aren't custom — they ship with Claude Code or are installed separately — but they're wired into the workflow.

### Claude Code Native Skills

These come built into Claude Code. No installation needed.

| Skill | When to use |
|-------|-------------|
| `/simplify` | After implementation — reviews changed code for reuse and quality, then fixes issues |
| `/loop` | Recurring checks — e.g., `/loop 5m /codex:status` to poll a background job |
| `/schedule` | Cron-scheduled remote agents — automated tasks that run on a schedule |
| `/claude-api` | When building apps with the Claude API, Anthropic SDK, or Agent SDK |

### Codex Plugin (Cross-Model)

Uses GPT-5.4 via the Codex CLI for a second opinion from a different model family. Useful for catching blind spots that a single-model review might miss.

| Skill | When to use |
|-------|-------------|
| `/codex:review` | Read-only code review against git changes — GPT-5.4 perspective |
| `/codex:adversarial-review` | **Mandatory** cross-model review on every plan — auth, data loss, race conditions, business logic |
| `/codex:rescue` | Delegate debugging or implementation to Codex in background |
| `/codex:status` | Check active and recent Codex background jobs |
| `/codex:result` | Retrieve output from a finished Codex job |
| `/codex:cancel` | Cancel an active background job |
| `/codex:setup` | Check Codex CLI readiness and manage the review gate |

Requires the Codex CLI installed separately. See `/codex:setup` to verify.

### MCP Servers

[Model Context Protocol](https://modelcontextprotocol.io) servers give Claude access to external data sources during sessions.

| Server | What it provides | When to use |
|--------|-----------------|-------------|
| `context7` | Live library/framework documentation | Always prefer over web search for API syntax, setup, version migration (React, Tailwind, ShadCN, AWS SDK, etc.) |
| `obsidian` | Read/write access to an Obsidian vault | Knowledge base operations — notes, tags, frontmatter |

Configured in `.claude/settings.json` under `mcpServers`.

### Model Routing

Not all work needs the same model. iaGO-OS routes tasks by complexity:

| Model | Role | Used by |
|-------|------|---------|
| **Opus** | Orchestrator — planning, architecture, multi-file reasoning | Your main Claude Code session |
| **Sonnet** | Worker — implementation, review, research, debugging | Default for all agent profiles |
| **Haiku** | Mechanical — formatting, simple lookups | Reserved for lightweight tasks |
| **Codex (GPT-5.4)** | Cross-model — mandatory adversarial review on every plan, rescue delegation | `/codex:*` skills |

## Folder Structure

```
iago-os/
  .claude/
    settings.json            # Hook wiring
    skills/                  # 33 skill definitions (SKILL.md each)
    agents/                  # 3 bases + 13 capabilities + 12 profiles
      executor.md
      analyst.md
      operator.md
      capabilities/          # 13 capability modules
      profiles/              # 12 agent profiles
    rules/                   # 8 behavioral rules (TDD, debugging, git, etc.)
  .iago/
    hooks/                   # 9 hooks (context, safety, formatting, tracking)
      lib/                   # Shared utilities (stdin, flags, state-manager)
    state/                   # Runtime state (sessions, usage log)
  templates/
    client-project/          # Client project template
    internal-project/        # Internal project template
  scripts/
    new-client.sh/.ps1       # Scaffold new project from template
    sync-skills.sh/.ps1      # Sync skills/agents/rules to project or globally
    usage-report.sh/.ps1     # Usage analytics from JSONL telemetry
    execute-pipeline.sh      # Cross-session pipeline (no n8n needed)
    validate-hooks.sh        # CI: hook syntax validation
    validate-skills.sh       # CI: skill frontmatter validation
  n8n/                       # Optional: n8n visual orchestration layer
    workflows/               # Importable n8n workflow JSON
    scripts/                 # Shell wrappers for n8n Execute Command nodes
    README.md                # n8n setup guide
  docs/
    MANUAL.md                # Complete usage manual
    SETUP.md                 # First-time setup guide
    ARCHITECTURE.md          # How it works under the hood
    SKILLS.md                # Full skill reference catalog
    WORKFLOW.md              # Workflow phases explained
    automations/             # Trigger templates + pipeline specs
    patterns/                # Industry domain reference docs (8 domains)
  CLAUDE.md                  # Root config — stack, standards, workflow
  IAGO-OS-HANDOFF.md         # Current project state
```

## Tech Stack

Projects built with iaGO-OS use this stack (configurable per project):

- **Frontend:** React 19 + Vite + TypeScript (strict) + TailwindCSS 4 + ShadCN/UI + Framer Motion + GSAP/ScrollTrigger + Lenis
- **Backend:** AWS Amplify Gen 2 + Lambda + API Gateway + DynamoDB + Cognito + SES
- **Agents:** Claude SDK (Anthropic) + LangGraph + n8n
- **Testing:** Vitest (unit/integration), Playwright (E2E)
- **Tooling:** Biome (formatter + linter)

## How to Use

The [Usage Manual](docs/MANUAL.md) covers everything in detail. Here's the condensed version:

### The Delivery Cycle

Every project follows the same phases: **init → discuss → plan → execute → verify**. Each phase produces artifacts that feed the next one. Skip a phase and the next one will ask for it.

```
/iago:init      → PROJECT.md, ROADMAP.md, STATE.md, config.json
/iago:discuss   → .iago/context/{phase}.md
/iago:plan      → .iago/plans/{phase}-{plan}.md
/iago:execute   → .iago/summaries/{phase}-{plan}.md + git commits + PRs
/iago:verify    → .iago/reviews/{phase}.md + PR (if passed)
```

### Choosing the Right Mode

#### `/iago:execute` — Full Pipeline for ROADMAP Phases

For planned, multi-step work that was discussed, planned, and is ready to ship.

```
> /iago:execute stripe-connect-ticketing
```

This runs **all plans** in the phase through the 6-stage pipeline. Each plan gets its own implement → build → review → codex → PR cycle. Plans already exist from `/iago:plan`.

**Use when:** You ran `/iago:plan` and have `.iago/plans/` files ready. The phase has 2+ plans. You want full review coverage including Codex adversarial.

**Example:** You're building a Stripe Connect integration. Phase has 4 plans (domain logic, checkout handler, webhooks, frontend). `/iago:execute stripe-connect-ticketing` runs all 4 sequentially, each getting a separate PR with full review.

---

#### `/iago:quick` — Plan + Pipeline in One Shot

For standalone tasks that don't belong to a ROADMAP phase but still deserve proper review.

```
> /iago:quick add email validation to the contact form
> /iago:quick --discuss --verify refactor the auth middleware
```

This **creates a lightweight plan on the fly** (max 3 tasks), then runs it through the same pipeline as `/iago:execute`. Composable flags: `--discuss` (clarify first), `--research` (research first), `--verify` (verify after).

**Use when:** A task pops up that's not in the ROADMAP. It's too complex for a trivial fix (needs 1-3 tasks) but doesn't warrant a full phase cycle.

**Example:** Client asks for a loading spinner on the dashboard. Not in the ROADMAP, but needs a component + hook + test. `/iago:quick add loading spinner to dashboard` creates a plan, implements, reviews, and opens a PR.

---

#### `/iago:fast` — Inline Fix, No Pipeline

For trivially obvious changes where review would be overkill.

```
> /iago:fast fix the typo in the login button
> /iago:fast update the copyright year in footer
```

This edits files **directly in the current session** — no plan, no agents, no review pipeline. Just edit → verify (tsc/biome) → atomic commit.

**Use when:** The fix touches ≤3 files, requires no new dependencies, and the change is obvious. If you have to think about it, use `/iago:quick` instead.

**Example:** There's a typo in a button label. `/iago:fast fix typo in login button` edits the file, runs typecheck, and commits. Done in 30 seconds.

---

#### `/iago:prfix` — Fix PR Review Comments

For when a PR has been reviewed and comments need addressing.

```
> /iago:prfix              # Fix comments on current branch's PR
> /iago:prfix 16           # Fix comments on PR #16
> /iago:prfix --all        # Fix all open PRs with unresolved comments
```

This tags `@claude` on the PR, triggering the GitHub Action review-fix loop. Claude Code fixes all findings, pushes, and re-tags for re-review — up to 5 rounds until clean. You don't need to be in a session.

**Use when:** You get review comments on a PR (from Claude, Codex, or a human reviewer) and want them fixed automatically.

---

#### Quick Comparison

| | `/iago:execute` | `/iago:quick` | `/iago:fast` | `/iago:prfix` |
|---|---|---|---|---|
| **Plans** | Uses existing | Creates on-the-fly | None | None |
| **Pipeline** | Full 6-stage | Full 6-stage | Build gate only | GitHub Action loop |
| **Review** | 3-stage + Codex | 3-stage + Codex | None | Async (up to 5 rounds) |
| **Scope** | Phase (2+ plans) | 1-3 tasks | ≤3 files | Existing PR |
| **PR created** | Yes (per plan) | Yes | No | N/A (fixes existing) |
| **Time** | 30-60 min/plan | 10-20 min | < 1 min | Varies (async) |

### Multi-Client Setup

iaGO-OS supports multiple concurrent projects. Each gets its own `.iago/` state directory — no state is shared.

```bash
# Scaffold projects
./scripts/new-client.sh --name "Client A" --project "app" --path ../client-a
./scripts/new-client.sh --name "Client B" --project "api" --path ../client-b

# Sync updates from iaGO-OS to existing projects
./scripts/sync-skills.sh --target ../client-a
./scripts/sync-skills.sh --target ../client-b --dry-run  # preview first
```

### Configuration

Each project has `.iago/config.json` controlling review mode, model routing, and automation:

```json
{
  "review": { "mode": "single" },
  "routing": {
    "default_model": "auto",
    "security_critical": "opus",
    "retry_upgrade": true
  },
  "automation": {
    "n8n_webhook_url": "http://localhost:5678/webhook/iago-execute",
    "slack_webhook_url": ""
  }
}
```

- `review.mode: "single"` — one-pass review (faster, good for quick tasks)
- `review.mode: "full"` — two-stage gated review (recommended for client work)
- `routing.default_model: "auto"` — orchestrator picks model based on task complexity
- `routing.security_critical: "opus"` — always use Opus for auth/payment/data code
- `automation.n8n_webhook_url` — endpoint for cross-session dispatch (`/iago:execute --n8n`)
- `automation.slack_webhook_url` — optional Slack notifications for pipeline results

### Automation & Orchestration

iaGO-OS has three levels of automation, each solving a different problem:

**Level 1 — Scheduled triggers** (`/iago:schedule`)

Recurring tasks that run on a cron schedule without you being in a session. Install from templates or create custom:

```
> /iago:schedule nightly-review          # Code review against main every weeknight
> /iago:schedule build-health            # tsc + biome check every 6 hours
> /iago:schedule create "17 9 * * 1" "Weekly usage summary"   # Custom
```

6 built-in templates: nightly review, usage digest, stale handoff, dependency audit, learnings promotion, build health. See `docs/automations/trigger-templates.md`.

**Level 2 — Worktree parallelism** (in-session)

Non-conflicting plans within the same wave execute simultaneously in isolated git worktrees. Each agent gets its own copy of the repo — no file conflicts, no merge races. This happens automatically during `/iago:execute` when plans in the same wave don't share files. No setup needed.

**Level 3 — Cross-session pipeline** (`/iago:execute --pipeline`)

The full execute cycle (implement → build gate → review → codex → PR) runs across **separate Claude Code sessions**, each with fresh context. No n8n required — just a bash script:

```
/iago:execute phase-1 --pipeline
    → Session 1: implement (full context budget)
    → Build gate: tsc + vite (shell command, no Claude)
    → Session 2: review (only sees diff + plan, no implementation noise)
    → Session 3: codex adversarial review (GPT-5.4)
    → Session 4: create PR
```

Each step gets clean context. Fix cycles loop automatically (max 2 rounds). You can walk away while it runs. The orchestrator suggests this automatically when a phase has 3+ plans.

Or run it directly for a single plan:

```bash
bash scripts/execute-pipeline.sh --plan .iago/plans/01-phase-1-01.md --project-dir .
```

**Level 4 — n8n visual orchestration** (`/iago:execute --n8n`)

Same pipeline as Level 3, but orchestrated by n8n for visual monitoring, execution history, retry UI, and Slack notifications. Import `n8n/workflows/iago-execute-pipeline.json` into n8n. Full guide in `n8n/README.md`.

## Built On

iaGO-OS synthesizes patterns from six open-source Claude Code configurations. The skill/agent/workflow structure is original design built on top of these foundations:

| Project | What we learned from it |
|---------|----------------------|
| [Everything Claude Code](https://github.com/affaan-m/everything-claude-code) | Session lifecycle event model, post-edit quality pipeline (format → typecheck → console warn), config protection hooks, cost tracking patterns, hook-flags disable mechanism |
| [Ruflo](https://github.com/ruvnet/ruflo) | Real token tracking from Claude transcript JSONL, importance-ranked context injection, bridge-file pattern for statusline data sharing |
| [Get Shit Done](https://github.com/gsd-build/get-shit-done) | HANDOFF.json pause/resume pattern, bridge-file context monitoring, threshold-based compaction warnings that prevent context window surprises |
| [Paperclip](https://github.com/paperclipai/paperclip) | Multi-client isolation model — each project gets its own state directory with no shared state. Adapted from their SaaS tenant model to filesystem directories |
| [The Architect](https://github.com/Hainrixz/the-architect) | Agent-produces-agent-config pattern (agents that generate other agent definitions), blueprint template for project kickoff discovery |
| [Superpowers](https://github.com/obra/superpowers) | Verification-before-completion discipline ("never claim done without evidence"), two-stage code review with anti-performative-agreement rules, rationalization prevention tables for TDD |

## Documentation

- **[Usage Manual](docs/MANUAL.md)** — Complete how-to guide: workflow walkthrough, every mode explained, configuration, multi-client, troubleshooting
- [Setup Guide](docs/SETUP.md) — First-time installation (Windows + macOS)
- [Architecture](docs/ARCHITECTURE.md) — How iaGO-OS works under the hood
- [Skills Reference](docs/SKILLS.md) — Full catalog with triggers, arguments, and examples
- [Workflow](docs/WORKFLOW.md) — Phase flow, state transitions, artifact locations
- [n8n Pipeline](n8n/README.md) — Cross-session orchestration setup and usage
- [Trigger Templates](docs/automations/trigger-templates.md) — 6 ready-to-use scheduled automation templates
- [Pipeline Spec](docs/automations/cross-session-pipeline.md) — n8n workflow node-by-node specification

## License

Proprietary. Copyright iaGO AI.
