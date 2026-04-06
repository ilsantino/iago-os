# iaGO-OS

A configuration layer for [Claude Code](https://claude.ai/code) that turns it into a structured project delivery system.

iaGO-OS is not a framework, not an SDK, and not a SaaS product. It's a set of files — markdown skills, agent profiles, hook scripts, and state management — that sit alongside your code in `.claude/` and `.iago/` directories. When Claude Code loads your project, it reads these files and becomes a disciplined delivery system instead of a blank-slate chatbot.

**Who it's for:** Teams and solo developers shipping real projects with Claude Code. We built it for our own 3-person AI consultancy running multiple client projects simultaneously — it solves the problems we hit every day.

**What it solves:**

- **Context rot.** Claude forgets everything between sessions. iaGO-OS hooks save and restore session state automatically. Every conversation picks up where the last one left off.
- **Config drift.** Without constraints, Claude writes inconsistent code — different patterns, different libraries, different quality. iaGO-OS enforces your stack, your conventions, and your review standards through rules and hooks.
- **Invisible work.** When Claude dispatches subagents, you can't see what they did or whether the results were verified. iaGO-OS profiles define what each agent can do, learnings accumulate across sessions, and every task ends with evidence — not claims.
- **No workflow.** Claude will happily write code without planning, skip tests, and call it done. iaGO-OS imposes a delivery pipeline: plan with verification commands, implement with TDD, review with multiple models, verify against goals before shipping.

**How it works:** You type `/iago:init` and Claude asks about your project. It produces a roadmap. You run `/iago:plan` and it breaks the next phase into tasks. You run `/iago:execute` and it dispatches specialized agents — one per task — then reviews each one through a 3-stage pipeline (internal review, quality check, cross-model adversarial review via GPT-5.4). You run `/iago:verify` and it checks every goal against real evidence. If it passes, it opens a PR.

For small stuff: `/iago:quick` does plan-implement-review in one shot. `/iago:fast` skips everything for a 3-file fix.

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

## Skills (31)

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
| `/iago:quick` | One-shot path: lightweight plan → matching profile → review-single → done. Composable flags: `--discuss`, `--research`, `--verify` | Small standalone task (1-3 tasks) outside a ROADMAP phase | Matching profile + `review-single` |
| `/iago:fast` | Inline execution with atomic commit. No planning, no agents, no review | Trivial fix — 3 files or fewer, obvious change | None (inline) |
| `/iago:pause` | Writes HANDOFF.json with workflow position, completed tasks, next action. Next session auto-resumes | Switching context, ending day, hitting a blocker | None |

### Workflow — Project Setup

| Skill | What it does | When to use |
|-------|-------------|-------------|
| `/iago:scaffold` | Creates a new project directory from the iaGO template (React 19 + Vite + TS + Tailwind + ShadCN + AWS Amplify Gen 2). Copies hooks, replaces template variables, inits git | Starting a greenfield client project |
| `/iago:proposal` | Generates a structured client proposal: scope, timeline, cost estimate, technical approach, deliverables. Dispatches `content` profile for prose quality | Pre-engagement — scoping a new client |
| `/iago:onboard` | Scans an existing codebase (directory structure, package.json, configs), produces architecture map and tech debt inventory, populates PROJECT.md | Onboarding an existing repo into iaGO workflow |
| `/iago:n8n` | Designs n8n automation workflow specs: node configs, trigger definitions, data flow diagrams, IAM policies | Designing webhook/event-driven automations |
| `/iago:agents` | Designs multi-agent architectures: agent roles, tool schemas, LangGraph state graphs, orchestration patterns. Use `--scope operational` for production-grade multi-agent design with topology, runbooks, and n8n integration | Designing agent systems for client deliverables |

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

Code review has two modes depending on the config (`review.mode` in `.iago/config.json`):

**Single-pass** (default for `/iago:quick`): The `review-single` profile does one pass — correctness, security, standards.

**Full** (default for `/iago:execute`): Three-stage pipeline:

```mermaid
flowchart LR
    Impl[executor completes task] --> S1

    S1[Stage 1: review-single] -->|pass| S2[Stage 2: review-full]
    S1 -->|critical findings| Fix1[executor fixes]
    Fix1 --> S1

    S2 -->|pass| Codex[Stage 3: codex adversarial-review]
    S2 -->|critical findings| Fix2[executor fixes]
    Fix2 --> S2

    Codex -->|pass| Done[Approved]
    Codex -->|critical findings| Fix3[executor fixes]
    Fix3 --> S1
```

1. **Stage 1 — Spec review:** `review-single` checks if the implementation matches the plan
2. **Stage 2 — Quality review:** `review-full` checks performance, security, maintainability
3. **Stage 3 — Cross-model (mandatory):** `/codex:adversarial-review` sends every diff to GPT-5.4 — a different model catches different blind spots

If any stage returns Critical findings, the orchestrator routes back to the executor for fixes before proceeding.

### Capability Modules (13)

Domain knowledge injected into agent prompts at dispatch time. Each module is a markdown file in `.claude/agents/capabilities/`:

| Capability | What it teaches the agent |
|-----------|--------------------------|
| `react-19` | `use()` + Suspense data fetching, ShadCN/UI patterns, TanStack Query, concurrent UI |
| `animation` | Framer Motion, GSAP + ScrollTrigger, Lenis smooth scroll, integration rules, a11y |
| `dynamodb` | Single-table design, access patterns, GSI strategy, batch operations, TTL |
| `lambda` | Thin handler pattern, cold start mitigation, ESM, environment config |
| `cognito` | JWT validation in API Gateway, token refresh, custom attributes, pre-signup triggers |
| `tdd` | RED-GREEN-REFACTOR cycle, rationalization prevention, coverage rules |
| `security` | OWASP Top 10, AWS-specific checks, hardcoded secrets, CORS, tenant isolation |
| `e2e` | Playwright selectors, `data-testid`, Page Object Model, auth via `storageState` |
| `review-spec` | Plan compliance verification — file paths, actions, tests, no deviations |
| `review-quality` | Performance, TypeScript strictness, maintainability, React/DynamoDB conventions |
| `content` | Consulting voice, multi-format output, channel adaptation, no filler |
| `infra` | AWS CLI, Amplify Gen 2, CDK, IAM, deployment patterns |
| `forms` | React Hook Form + Zod, ShadCN Controller integration, server error mapping |

### Agent Profiles (12)

Pre-composed base + capability combinations. The orchestrator selects the right profile based on file paths and task description.

| Profile | Base | Capabilities | Model | When dispatched |
|---------|------|-------------|-------|-----------------|
| `fullstack` | executor | react-19, dynamodb, lambda, tdd, forms, animation | auto | Task touches both `src/` and `amplify/` (also the fallback) |
| `frontend` | executor | react-19, tdd, forms, animation | auto | Task only touches `src/` — no backend changes |
| `backend` | executor | dynamodb, lambda, cognito, tdd | auto | Task only touches `amplify/` — no frontend changes |
| `review-single` | analyst | security, review-spec, review-quality | auto | Default review after implementation (`review.mode: "single"`) |
| `review-full` | analyst | security, review-spec, review-quality | auto | Two-stage gated review (`review.mode: "full"`) — Stage 1 must pass before Stage 2 |
| `security-audit` | analyst | security, cognito, review-quality | opus | Auth, payment, or data-access changes — always Opus, never downgraded |
| `research` | operator | dynamic (context-dependent) | sonnet | `/deep-research`, `--research` flag on plan/quick skills |
| `e2e` | executor | e2e, react-19 | sonnet | Writing or updating Playwright E2E tests |
| `infra` | operator | infra | sonnet | AWS CLI, Amplify deployments, CDK operations |
| `schema` | analyst | dynamodb | sonnet | DynamoDB single-table design, access pattern analysis |
| `content` | operator | content | sonnet | Articles, proposals, investor materials, outreach |
| `debug` | executor | dynamic (context-dependent) | auto | Build/typecheck/lint failures — capabilities selected based on error context |

## Hooks (9)

Hooks are automatic behaviors wired in `.claude/settings.json`. They fire on Claude Code lifecycle events — you never invoke them manually.

### Context & State

| Hook | Fires on | What it does | Why it matters |
|------|----------|-------------|----------------|
| `context-persistence` | Session start, pre-compact, stop | Saves a session snapshot before context compression. Restores the previous session's state on startup. Loads HANDOFF.json if `/iago:pause` was used | Every conversation picks up where the last one left off — no re-explaining the project |
| `context-monitor` | After every tool use | Reads the bridge file to check context window fill level. Warns at 70% and 90% thresholds with suggested actions (compact, pause, finish current task) | Prevents losing work to unexpected context limit hits |
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
    skills/                  # 31 skill definitions (SKILL.md each)
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
  docs/
    SETUP.md                 # First-time setup guide
    ARCHITECTURE.md          # How it works under the hood
    SKILLS.md                # Full skill reference catalog
    WORKFLOW.md              # Workflow phases explained
    IAGO-DASHBOARD.md        # Future dashboard vision
  CLAUDE.md                  # Root config — stack, standards, workflow
  HANDOFF.md                 # Current project state
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

| Situation | Command | What happens |
|-----------|---------|-------------|
| New client project | `/iago:init` | Interactive discovery, foundation artifacts |
| Next phase of ongoing work | `/iago:discuss` → `/iago:plan` → `/iago:execute` | Full pipeline |
| Small standalone task (1-3 tasks) | `/iago:quick "add search to dashboard"` | Plan + implement + review in one pass |
| Trivial fix (3 files max) | `/iago:fast "fix login button typo"` | Inline edit + atomic commit |
| Need to stop mid-session | `/iago:pause` | Saves state, next session auto-resumes |
| Design decision needed | `/brainstorming` | Socratic exploration → spec |
| Spec ready, need implementation | `/subagent-driven-development plan.md` | Fresh agent per task, mandatory review |

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

Each project has `.iago/config.json` controlling review mode and model routing:

```json
{
  "review": { "mode": "single" },
  "routing": {
    "default_model": "auto",
    "security_critical": "opus",
    "retry_upgrade": true
  }
}
```

- `review.mode: "single"` — one-pass review (faster, good for quick tasks)
- `review.mode: "full"` — two-stage gated review (recommended for client work)
- `routing.default_model: "auto"` — orchestrator picks model based on task complexity
- `routing.security_critical: "opus"` — always use Opus for auth/payment/data code

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

## License

Proprietary. Copyright iaGO AI.
