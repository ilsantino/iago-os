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

## Agents (11)

Agents are specialized workers dispatched by skills. All run on Sonnet. Your main Claude Code session (the orchestrator, on Opus) dispatches them — agents never spawn other agents.

| Agent | Role |
|-------|------|
| `implementer` | Execute tasks from plans (React 19, DynamoDB, Amplify) |
| `code-reviewer` | Single-pass review with OWASP + AWS security checklist |
| `spec-reviewer` | Spec compliance with stack-specific validation |
| `code-quality-reviewer` | Quality review with React/DynamoDB/Lambda checks |
| `researcher` | Deep research via codebase, context7, and web |
| `tdd-guide` | RED-GREEN-REFACTOR with Vitest + React Testing Library |
| `build-error-resolver` | 4-phase debugging for Vite/TS/Amplify errors |
| `e2e-runner` | Playwright E2E with Cognito auth and ShadCN selectors |
| `content-writer` | Articles, investor materials, market research |
| `infra-runner` | AWS CLI, Amplify, CDK, DynamoDB, Lambda operations |
| `data-modeler` | DynamoDB single-table design and access patterns |

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
