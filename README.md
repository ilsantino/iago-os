# iaGO-OS

A configuration layer for [Claude Code](https://claude.ai/code) that turns it into a structured project delivery system. Built for AI consultancies that ship client projects with Claude.

**The problem:** Claude Code starts every conversation fresh. It doesn't remember what happened last session, doesn't follow a consistent workflow, and doesn't know which client you're working on. When you're running multiple projects across a team, this becomes chaos.

**iaGO-OS fixes this** by giving Claude Code skills (reusable workflows), agents (specialized workers), hooks (automatic behaviors), and a state engine (session memory). Every conversation picks up where the last one left off, follows the same workflow, and produces consistent results.

## What Using It Looks Like

Here's a real workflow — starting a new client project from scratch:

```
# 1. Scaffold the project
./scripts/new-client.sh --name "Acme Corp" --project "dashboard" --path ../acme-dashboard

=== iaGO New Client ===
  Client:   Acme Corp (acme-corp)
  Project:  dashboard
  Template: client-project
  Target:   ../acme-dashboard

[1/5] Copying template...
[2/5] Copying hooks...
[3/5] Replacing variables...
[4/5] Creating .iago subdirectories...
[5/5] Initializing git...

=== Done ===
  Files:     23

# 2. Open Claude Code in the new project
cd ../acme-dashboard && claude
```

Now inside Claude Code:

```
# Initialize — Claude asks about your vision, constraints, and phases
> /iago:init

# Clarify the first phase — surfaces ambiguities, records decisions
> /iago:discuss phase 1

# Plan — breaks the phase into tasks with verification commands
> /iago:plan phase 1

# Execute — dispatches implementer agents, reviews each plan after
> /iago:execute phase 1

# Verify — checks every ROADMAP goal against evidence, opens a PR
> /iago:verify phase 1
```

Every session starts with context from the last one. Every skill follows the same discipline. Every agent reports with evidence, not claims.

For quick one-off tasks that don't need the full workflow:

```
> /iago:quick    # 1-3 tasks: plan, implement, review in one pass
> /iago:fast     # Trivial fix (3 files or fewer), no planning needed
```

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

## Skills (41)

Skills are reusable workflows you invoke with `/skill-name` inside Claude Code. Think of them as recipes — each one knows what steps to follow, which agents to dispatch, and what evidence to collect.

### Workflow

| Skill | What it does |
|-------|-------------|
| `/iago:init` | Bootstrap project — gather vision, produce PROJECT.md + ROADMAP.md |
| `/iago:discuss` | Clarify a ROADMAP phase before planning |
| `/iago:plan` | Break a phase into implementation plans with verifiable tasks |
| `/iago:execute` | Dispatch implementer + reviewer agents per plan |
| `/iago:verify` | Verify phase goals against evidence, open PR |
| `/iago:quick` | Lightweight path for 1-3 task standalone work |
| `/iago:fast` | Inline trivial changes (3 files or fewer) |
| `/iago:pause` | Save session state for next conversation |
| `/iago:scaffold` | Scaffold a new project from the iaGO template |
| `/iago:proposal` | Generate a client proposal document |
| `/iago:onboard` | Scan existing codebase, produce architecture map |
| `/iago:n8n` | Design n8n automation workflows |
| `/iago:agents` | Design multi-agent architectures |

### Core

| Skill | What it does |
|-------|-------------|
| `/brainstorming` | Socratic design exploration, produces a spec |
| `/writing-plans` | Break a spec into small verifiable tasks |
| `/subagent-driven-development` | Execute plans with fresh agent per task |
| `/code-review` | Dispatch reviewer with severity-categorized findings |
| `/deep-research` | Multi-source research with actionable recommendation |
| `/prompt-optimizer` | Optimize LLM prompts for client deliverables |

### Content

| Skill | What it does |
|-------|-------------|
| `/article-writing` | Blog posts and long-form content |
| `/content-engine` | Multi-format output (blog + social + newsletter) |
| `/investor-materials` | Pitch decks and one-pagers |
| `/investor-outreach` | Investor emails and outreach sequences |
| `/market-research` | Market analysis and competitive research |
| `/visa-doc-translate` | Visa document translation |
| `/frontend-slides` | Presentation slides from code/data |

### Experimental

| Skill | What it does |
|-------|-------------|
| `/autonomous-loops` | Long autonomous tasks without per-step approval |
| `/continuous-agent-loop` | Persistent agent with cross-iteration state |
| `/enterprise-agent-ops` | Multi-agent system design patterns |
| `/agent-payment-x402` | Agent-to-agent payment via x402 protocol |
| `/liquid-glass-design` | Glassmorphism UI effects (TailwindCSS 4) |
| `/santa-method` | Structured problem decomposition |

### Industry

| Skill | What it does |
|-------|-------------|
| `/healthcare-phi-compliance` | HIPAA/PHI compliance patterns |
| `/carrier-relationship-management` | Carrier management for logistics |
| `/customs` | Customs and trade compliance |
| `/energy` | Energy sector (metering, grid, trading) |
| `/logistics` | Supply chain and logistics |
| `/inventory` | Inventory management |
| `/production-scheduling` | Manufacturing scheduling |
| `/quality-nonconformance` | Quality control tracking |
| `/returns-reverse-logistics` | Returns processing |

Full reference with triggers, arguments, and examples: [docs/SKILLS.md](docs/SKILLS.md)

## Agent Architecture

### Hub-and-Spoke

iaGO-OS uses a hub-and-spoke model. Your main Claude Code session is the **orchestrator** (Opus) — it plans, reasons, and dispatches work. The 11 **agents** (all Sonnet) are specialized workers that execute a single task and report back. Agents never spawn other agents, and they never talk to each other. All coordination flows through the orchestrator.

```
                          ┌──────────────┐
                          │  Orchestrator │  ← You talk to this (Opus)
                          │  (main session)│
                          └──────┬───────┘
                                 │ dispatches
          ┌──────────┬───────────┼───────────┬──────────┐
          ▼          ▼           ▼           ▼          ▼
    implementer  researcher  code-reviewer  ...    infra-runner
      (Sonnet)    (Sonnet)     (Sonnet)             (Sonnet)
          │          │           │                      │
          └──────────┴───────────┴──────────────────────┘
                            │ reports back
                    DONE | DONE_WITH_CONCERNS
                    NEEDS_CONTEXT | BLOCKED
```

Every agent ends its response with exactly one of four statuses — no ambiguity about whether work is finished.

### Tool Sandboxing

Each agent gets only the tools it needs. This prevents accidents and keeps agents focused:

| Agent | Can read | Can write | Can run commands |
|-------|----------|-----------|-----------------|
| `implementer` | Yes | Yes | Yes |
| `code-reviewer` | Yes | No | Yes (diagnostics only) |
| `spec-reviewer` | Yes | No | No |
| `code-quality-reviewer` | Yes | No | Yes (diagnostics only) |
| `researcher` | Yes | No | Yes + WebSearch + WebFetch |
| `tdd-guide` | Yes | Yes | Yes |
| `build-error-resolver` | Yes | Yes | Yes |
| `e2e-runner` | Yes | Yes | Yes |
| `content-writer` | Yes | Yes | Yes |
| `infra-runner` | Yes | No | Yes (AWS CLI, CDK) |
| `data-modeler` | Yes | No | No |

Reviewers can't edit files. The data-modeler can't run commands. The implementer can do everything. This is by design.

### Review Pipeline

Code review has two modes depending on the config (`review.mode` in `.iago/config.json`):

**Single-pass** (default for `/iago:quick`): The `code-reviewer` agent does one pass — correctness, security, standards.

**Full** (default for `/iago:execute`): Two-stage pipeline:
1. **Stage 1 — Spec review:** `spec-reviewer` checks if the implementation matches the plan
2. **Stage 2 — Quality review:** `code-quality-reviewer` checks performance, security, maintainability
3. **Stage 3 (optional) — Cross-model:** `/codex:adversarial-review` sends the diff to GPT-5.4 for a second opinion on auth, data loss, and race conditions

If any stage returns Critical findings, the orchestrator routes back to the implementer for fixes before proceeding.

### Agent Catalog

| Agent | Role | When dispatched |
|-------|------|-----------------|
| `implementer` | Execute tasks from plans (React 19, DynamoDB, Amplify) | `/iago:execute`, `/subagent-driven-development` |
| `code-reviewer` | Single-pass review with OWASP + AWS security checklist | `/code-review`, `/iago:quick` |
| `spec-reviewer` | Spec compliance — does the code match the plan? | `/iago:execute` (full review mode) |
| `code-quality-reviewer` | Quality, performance, security, maintainability | `/iago:execute` (full review mode, after spec passes) |
| `researcher` | Deep research via codebase, context7, and web | `/deep-research`, `/iago:onboard --deep` |
| `tdd-guide` | RED-GREEN-REFACTOR with Vitest + React Testing Library | When enforcing TDD discipline on a task |
| `build-error-resolver` | 4-phase debugging for Vite/TS/Amplify errors | Build failures during execution |
| `e2e-runner` | Playwright E2E with Cognito auth and ShadCN selectors | After implementation, when E2E tests are needed |
| `content-writer` | Articles, investor materials, outreach, presentations | `/article-writing`, `/content-engine`, `/investor-*` |
| `infra-runner` | AWS CLI, Amplify, CDK, DynamoDB, Lambda, SES ops | Infrastructure tasks, deployments |
| `data-modeler` | DynamoDB single-table design and access patterns | Schema design, GSI strategy |

## Hooks (10)

Hooks are automatic behaviors that fire during Claude Code sessions. You don't invoke them — they run on their own.

| Hook | When | What it does |
|------|------|-------------|
| `context-persistence` | Session start, compact, stop | Saves/restores session state across conversations |
| `context-monitor` | After every tool use | Warns when context window is filling up |
| `usage-tracker` | After skill/agent use, stop | Logs usage telemetry to JSONL |
| `safety-guard` | Before bash/edit | Blocks secrets and destructive commands |
| `config-protection` | Before edit | Prevents weakening linter/formatter configs |
| `commit-quality` | Before bash (git) | Validates conventional commit format |
| `post-edit-format` | After edit | Auto-formats with Biome |
| `post-edit-typecheck` | After edit | Runs `tsc --noEmit` on edited TS files |
| `post-edit-console-warn` | After edit | Warns about `console.log` in production code |
| `statusline` | Continuous | Shows branch, context %, client, duration |

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
| `/codex:adversarial-review` | Targeted review for auth, data loss, race conditions, rollback safety |
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
| **Sonnet** | Worker — implementation, review, research, debugging | All 11 agents |
| **Haiku** | Mechanical — formatting, simple lookups | Reserved for lightweight tasks |
| **Codex (GPT-5.4)** | Cross-model — adversarial review, rescue delegation | `/codex:*` skills |

## Folder Structure

```
iago-os/
  .claude/
    settings.json            # Hook wiring
    skills/                  # 41 skill definitions (SKILL.md each)
    agents/                  # 11 agent definitions
    rules/                   # 8 behavioral rules (TDD, debugging, git, etc.)
  .iago/
    hooks/                   # 10 hooks (context, safety, formatting, tracking)
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

- **Frontend:** React 19 + Vite + TypeScript (strict) + TailwindCSS 4 + ShadCN/UI
- **Backend:** AWS Amplify Gen 2 + Lambda + API Gateway + DynamoDB + Cognito + SES
- **Agents:** Claude SDK (Anthropic) + LangGraph + n8n
- **Testing:** Vitest (unit/integration), Playwright (E2E)
- **Tooling:** Biome (formatter + linter)

## Documentation

- [SETUP.md](docs/SETUP.md) — First-time setup (Windows + macOS)
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — How iaGO-OS works under the hood
- [SKILLS.md](docs/SKILLS.md) — Full skill reference catalog
- [WORKFLOW.md](docs/WORKFLOW.md) — Workflow phases explained

## License

Proprietary. Copyright iaGO AI.
