# Architecture

How iaGO-OS works under the hood.

## The Problem

Claude Code is powerful but stateless. Every conversation starts fresh. For a consultancy running multiple client projects across a team, this creates three problems:

1. **Context rot.** Claude forgets what happened last session. You re-explain the project, the decisions, the constraints — every single time.

2. **Config drift.** Each team member configures Claude Code differently. One person has strict TypeScript, another doesn't. One uses Biome, another forgets. Quality varies by who's driving.

3. **Invisible agents.** Claude Code can dispatch subagents, but there's no visibility into what they're doing, what they produced, or whether the results were verified.

## The Solution

iaGO-OS is a configuration layer that lives alongside your code. It doesn't replace Claude Code — it makes Claude Code consistent, persistent, and observable.

```
Your code     +  iaGO-OS layer     =  Structured delivery
(src/, etc.)     (.claude/ + .iago/)
```

## Layers

iaGO-OS is built in six layers, each building on the one below:

```
┌─────────────────────────────────────┐
│  CLAUDE.md                          │  Stack constraints, code standards,
│  (project root)                     │  workflow rules
├─────────────────────────────────────┤
│  Rules                              │  TDD, debugging, git workflow,
│  (.claude/rules/)                   │  React/Vite, AWS/Amplify, E2E, MCP
├─────────────────────────────────────┤
│  Skills                             │  41 reusable workflows
│  (.claude/skills/)                  │  (init, plan, execute, verify, ...)
├─────────────────────────────────────┤
│  Agents                             │  3 base agents + 12 capability modules + 12 profiles
│  (.claude/agents/)                  │  (executor, analyst, operator + compositions)
├─────────────────────────────────────┤
│  Hooks                              │  10 automatic behaviors
│  (.iago/hooks/)                     │  (context, safety, formatting, tracking)
├─────────────────────────────────────┤
│  State Engine                       │  Session memory, workflow state,
│  (.iago/hooks/lib/state-manager.mjs)│  usage telemetry
└─────────────────────────────────────┘
```

**CLAUDE.md** is the entry point. Claude Code loads it automatically. It defines the tech stack, code standards, and points to everything else.

**Rules** are behavioral instructions that are always active. They enforce TDD discipline, systematic debugging, git conventions, and framework-specific patterns. Some are path-scoped (e.g., `react-vite.md` only applies to `src/**/*.tsx`).

**Skills** are reusable workflows invoked with `/skill-name`. Each skill has a `SKILL.md` that describes preconditions, steps, agents to dispatch, and artifacts to produce.

**Agents** are composed per task from 3 base templates (executor, analyst, operator) and 12 capability modules. Profiles are pre-composed combinations — the orchestrator matches each task to a profile, selects the model, and composes the prompt. Hub-and-spoke: only the orchestrator dispatches agents — agents never spawn other agents.

## Capability-Based Dispatch

Agent capability is composed at dispatch time, not hardcoded per agent file:

- **Base agents** define tool access tiers: executor (write access — code, files), analyst (read-only — grep, read, search), operator (external access — AWS CLI, APIs, infra)
- **Capability modules** add domain knowledge injected into the prompt: `react-19`, `dynamodb`, `security`, `tdd`, `amplify`, `playwright`, `mcp`, `content`, `research`, `debug`, `infra`, `data-model`
- **Profiles** are pre-composed base + capability combinations ready for dispatch: `fullstack`, `review-single`, `review-quality`, `tdd-guide`, `e2e-runner`, `infra-runner`, `data-modeler`, `researcher`, `content-writer`, `build-resolver`, `spec-reviewer`, `debug` (dynamic)
- **Dispatch flow:** match task to profile → select model from config.json routing table → compose prompt (base + capabilities) → dispatch agent → log to usage-log.jsonl
- **Dynamic profiles** (`research`, `debug`) have capabilities selected at dispatch time based on task context — the orchestrator injects the relevant modules rather than using a fixed composition

## Feedback Loops

Agent quality improves across sessions through two learnings files:

- **`.iago/learnings/patterns.md`** accumulates recurring review findings — anti-patterns flagged by code-reviewer and code-quality-reviewer agents across sessions
- **`.iago/learnings/project-conventions.md`** holds project-specific conventions discovered during work (naming, structure, decisions made)
- Both files are injected into agent prompts before dispatch: `patterns.md` contributes the top 10 patterns (max 500 tokens); `project-conventions.md` injects up to 300 tokens
- **Pattern promotion rule:** any pattern appearing 5+ times in `patterns.md` is surfaced to the orchestrator as a candidate for promotion to `CLAUDE.md` — making it a permanent constraint rather than a soft suggestion

**Hooks** are automatic behaviors wired in `.claude/settings.json`. They fire on Claude Code lifecycle events (session start, tool use, stop) and handle context persistence, safety guards, formatting, and usage tracking.

**State Engine** (`state-manager.mjs`) manages `.iago/STATE.md`, `config.json`, session logs, and the decision log. Skills and hooks call its functions to read/write workflow state.

## Source Patterns

iaGO-OS synthesizes patterns from six open-source Claude Code configurations:

| Source | What we took |
|--------|-------------|
| [Everything Claude Code](https://github.com/affaan-m/everything-claude-code) | Session trio event model, post-edit quality pipeline, config protection, cost tracking, hook-flags disable |
| [Ruflo](https://github.com/ruvnet/ruflo) | Real token tracking from transcript JSONL, importance-ranked context, bridge-file statusline |
| [Get Shit Done](https://github.com/gsd-build/get-shit-done) | HANDOFF.json pause/resume, bridge-file context monitoring, threshold-based compaction warnings |
| [Paperclip](https://github.com/paperclipai/paperclip) | Multi-client isolation model (adapted to filesystem directories) |
| [The Architect](https://github.com/Hainrixz/the-architect) | Agent-produces-agent-config pattern, blueprint template for project kickoff |
| [Superpowers](https://github.com/obra/superpowers) | Verification-before-completion discipline, two-stage review, rationalization prevention |

The skill/agent/workflow structure is original iaGO design built on top of these patterns.

## Config Hierarchy

Configuration cascades from global to project-specific:

```
~/.claude/              Global (sync-skills --global)
  skills/               Available in all Claude Code sessions
  agents/               But no hooks — hooks need .iago/
  rules/

project/
  .claude/              Project-level
    settings.json       Hook wiring (points to .iago/hooks/)
    skills/             Can override global skills
    agents/             Can override global agents
    rules/              Can override global rules

  .iago/                iaGO state (per-project)
    hooks/              Hook implementations
    state/              Runtime state (sessions, usage, costs)
    plans/              Implementation plans
    summaries/          Session summaries
    reviews/            Code review artifacts
    context/            Phase context artifacts
    config.json         Project configuration
    STATE.md            Current workflow state
    PROJECT.md          Project vision and constraints
    ROADMAP.md          Phase definitions and status
```

**Resolution order:** Project `.claude/` overrides global `~/.claude/`. CLAUDE.md at project root is always loaded.

## Hook Lifecycle

Hooks fire on five Claude Code lifecycle events:

```
SessionStart ──→ PreToolUse ──→ [tool runs] ──→ PostToolUse ──→ ... ──→ PreCompact ──→ Stop
     │                │                              │                       │           │
     ▼                ▼                              ▼                       ▼           ▼
  context-         safety-guard              context-monitor           context-       context-
  persistence      config-protection         post-edit-format          persistence    persistence
  (restore)        commit-quality            post-edit-typecheck       (snapshot)     (finalize)
                                             post-edit-console-warn                   usage-tracker
                                             usage-tracker                            (summary)
                                             (skill/agent tracking)
```

**SessionStart:** `context-persistence` loads the previous session snapshot or HANDOFF.json. Injects context so Claude knows what happened last time.

**PreToolUse:** Safety hooks run before every bash command and file edit. `safety-guard` blocks secrets and destructive commands. `config-protection` prevents weakening linter configs. `commit-quality` validates conventional commits.

**PostToolUse:** Quality hooks run after tool execution. `context-monitor` checks context window fill level. Post-edit hooks format code, type-check, and warn about console.log. `usage-tracker` logs skill and agent invocations.

**PreCompact:** `context-persistence` snapshots the current session before context window compaction.

**Stop:** `context-persistence` finalizes the session (outcome, duration, tokens). `usage-tracker` writes a session summary to the usage log.

## Multi-Project Model

iaGO-OS supports multiple concurrent client projects:

```
iago-os/                  Source of truth
  templates/              Project templates
  scripts/                Scaffold + sync tools

acme-dashboard/           Client project A
  .claude/                Synced from iago-os
  .iago/                  Project-specific state

beta-api/                 Client project B
  .claude/                Synced from iago-os
  .iago/                  Project-specific state
```

**New project:** `new-client.sh` scaffolds from template, copies hooks, replaces variables, inits git.

**Updates:** `sync-skills.sh --target ../acme-dashboard` syncs skills, agents, and rules from iaGO-OS to an existing project. Use `--dry-run` to preview changes.

**Global:** `sync-skills.sh --global` installs to `~/.claude/` so skills are available everywhere — even in projects not scaffolded from the template.

Each project has its own `.iago/` state directory. No state is shared between projects.

## Usage Tracking

The `usage-tracker` hook logs telemetry to `.iago/state/usage-log.jsonl`:

```json
{"ts":"...","event":"skill_invoked","skill":"iago-plan","session":"s-123"}
{"ts":"...","event":"agent_dispatched","agent":"implementer","session":"s-123"}
{"ts":"...","event":"session_end","duration_min":45,"skills_used":[...],"agents_dispatched":[...],"session":"s-123"}
```

The `usage-report.sh` script aggregates this data across projects:

```bash
./scripts/usage-report.sh ../acme-dashboard ../beta-api
```

This data feeds into the future iaGO Dashboard (see `docs/IAGO-DASHBOARD.md`) — a web UI that makes the system observable without opening a terminal.

## Model Routing

| Role | Model | Why |
|------|-------|-----|
| Orchestrator (main session) | Opus | Planning, architecture, multi-file reasoning |
| Default subagents (executor, analyst, operator) | Sonnet | Implementation, review, research, debugging |
| Profile override (e.g., `fullstack`, `tdd-guide`) | Sonnet (configurable via `config.json` `modelRouting`) | Profile-level model selection; override per profile in `.iago/config.json` |
| Mechanical tasks | Haiku | Formatting, simple lookups (reserved) |
| Cross-model review | GPT-5.4 (Codex) | Second opinion on critical changes |

**Profile-level routing** is configured in `.iago/config.json` under the `modelRouting` key. Each profile can specify its own model; unspecified profiles inherit the `default` value. This allows high-stakes profiles (e.g., `infra-runner`) to be pinned to Opus while keeping routine profiles on Sonnet.
