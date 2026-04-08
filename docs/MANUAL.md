# iaGO-OS Usage Manual

Complete guide to using iaGO-OS for project delivery with Claude Code.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [The Delivery Cycle](#the-delivery-cycle)
3. [Bypass Modes](#bypass-modes)
4. [Code Review Pipeline](#code-review-pipeline)
5. [Agent System](#agent-system)
6. [Configuration](#configuration)
7. [Multi-Client Projects](#multi-client-projects)
8. [Content & Research Skills](#content--research-skills)
9. [Industry Skills](#industry-skills)
10. [Hooks Deep Dive](#hooks-deep-dive)
11. [Session Management](#session-management)
12. [Troubleshooting](#troubleshooting)

---

## Getting Started

### First-Time Setup

```bash
# Clone iaGO-OS
git clone https://github.com/ilsantino/iago-os.git
cd iago-os

# Install hook dependencies (biome, typescript)
npm install

# Install skills globally (available in every Claude Code session)
./scripts/sync-skills.sh --global          # macOS/Linux
.\scripts\sync-skills.ps1 -Global          # Windows PowerShell

# Scaffold your first project
./scripts/new-client.sh --name "Acme Corp" --project "dashboard" --path ../acme-dashboard

# Open Claude Code in the new project
cd ../acme-dashboard && claude
```

### What the Scaffold Creates

```
acme-dashboard/
  .claude/
    settings.json       # Hooks wired and ready
    skills/             # 33 skill definitions
    agents/             # 3 bases + 13 capabilities + 12 profiles
    rules/              # 8 behavioral rules
  .iago/
    hooks/              # 8 hook scripts
      lib/              # Shared utilities
    state/              # Runtime state (created on first session)
    plans/              # Implementation plans (empty)
    context/            # Context artifacts (empty)
    summaries/          # Execution summaries (empty)
    reviews/            # Verification reports (empty)
    learnings/          # Patterns + conventions (seeded with headers)
    config.json         # Project configuration
  CLAUDE.md             # Stack constraints and workflow rules
```

### Verify the Setup

Inside Claude Code, type `/iago:` — you should see autocomplete suggestions. The session-start hook will report "First iaGO session. No prior context."

---

## The Delivery Cycle

Every project follows five phases. Each phase produces artifacts that feed the next one.

### Phase 1: Init

```
> /iago:init
```

Claude asks 3-5 discovery questions about your project: what you're building, who the client is, constraints, and the first 2-5 phases.

**Produces:**
- `.iago/PROJECT.md` — Vision, client, constraints, stack
- `.iago/ROADMAP.md` — Phase definitions with success criteria
- `.iago/STATE.md` — Current workflow position (under 80 lines always)
- `.iago/config.json` — Review mode, model routing

**Tips:**
- Be specific about success criteria — `/iago:verify` checks against these literally
- If onboarding an existing codebase, use `/iago:onboard` first to scan the repo
- Init blocks if PROJECT.md already exists — it's a one-time bootstrap

### Phase 2: Discuss

```
> /iago:discuss phase 1
```

Claude surfaces 3-5 ambiguities in the phase: decisions that need to be made, unclear requirements, and trade-offs. Records everything as a context artifact.

**Produces:** `.iago/context/{phase}.md`

**Tips:**
- This is interactive — Claude asks, you answer, it captures decisions
- Skip with `--skip-discuss` flag on `/iago:plan` if requirements are already crystal clear
- Deferred items get logged — they don't disappear

### Phase 3: Plan

```
> /iago:plan phase 1
```

Decomposes the phase into implementation plans. Each plan has 2-8 tasks. Every task has a verification command that proves it works.

**Produces:** `.iago/plans/{phase}-{plan}.md` (one or more)

**Options:**
- `--research` — dispatches the `research` profile to investigate before planning
- Plans are grouped into waves for parallel execution
- A self-review loop checks for gaps before the plan is finalized

**Tips:**
- Read the generated plans before executing — they're your contract
- If a plan has more than 8 tasks, it should be split
- Plans reference specific file paths and verification commands — no "implement the feature" vagueness

### Phase 4: Execute

```
> /iago:execute phase 1
```

The heavy lifter. For each plan:

1. **Profile matching** — selects fullstack/frontend/backend based on file paths
2. **Model routing** — Opus for code-writing (executor-based profiles), Sonnet for review/analysis (analyst/operator profiles)
3. **Learnings injection** — injects patterns from previous sessions
4. **Agent dispatch** — fresh agent per plan, no shared state
5. **Build gate** — `tsc --noEmit` + `vite build` must pass before review
6. **3-stage review** — internal review → quality review → Codex adversarial review
7. **Learnings extraction** — recurring patterns get logged for future sessions
8. **PR creation** — branch per plan, conventional commit, PR via `gh`

**Produces:**
- `.iago/summaries/{phase}-{plan}.md` per plan
- Git commits on feature branches
- Pull requests on GitHub

**Options:**
- `--serial` — bypass parallel execution, run plans one at a time

**Tips:**
- PRs are never auto-merged — you review on GitHub and merge manually
- If a build gate fails, the `debug` profile is dispatched automatically (max 2 retries)
- Critical review findings get sent back to the executor for fixes — max 2 rounds before escalation

### Phase 5: Verify

```
> /iago:verify phase 1
```

Goal-backward verification. Reads every success criterion from ROADMAP.md and checks it against evidence:

- Tests pass → runs `npx vitest run`, reads output
- Build succeeds → runs `npx tsc --noEmit`, reads output
- Component exists → checks file paths
- Feature works → traces through code logic

**Produces:** `.iago/reviews/{phase}.md` with verdict: `passed`, `gaps_found`, or `human_needed`

If passed: creates a PR and advances to the next phase.
If gaps found: lists what's missing, suggests re-planning.
If human needed: lists what requires manual testing.

---

## Bypass Modes

Not every task needs the full pipeline.

### `/iago:quick` — Small Standalone Tasks

For 1-3 task work that's not part of a ROADMAP phase.

```
> /iago:quick Add a loading spinner to the dashboard page
> /iago:quick --research --verify Fix the DynamoDB query timeout
```

**Flags (composable):**
- `--discuss` — brief clarification before planning
- `--research` — dispatch `research` profile first
- `--verify` — run typecheck + tests + lint after

**Flow:** lightweight plan → matching profile → review-single → done

### `/iago:fast` — Trivial Fixes

For obvious changes to 3 files or fewer. No planning, no agents, no review.

```
> /iago:fast Fix the typo in the login button label
> /iago:fast Update the copyright year in the footer
```

**Flow:** inline edit → atomic commit → STATE.md log

**Redirects to `/iago:quick`** if you try to touch more than 3 files or the scope is unclear.

### Post-Review Fixes (`/iago:prfix`)

When a PR has review comments that need fixing, `/iago:prfix` dispatches the GitHub Action review-fix loop. See the Code Review Pipeline section for details.

---

## Code Review Pipeline

Every implementation goes through review. The depth depends on the config.

### Single-Pass Review (`review.mode: "single"`)

Default for `/iago:quick`. The `review-single` profile does one pass checking:
- Security (OWASP + AWS)
- Correctness (logic errors, missing error handling)
- Stack compliance (React 19 patterns, DynamoDB conventions, TS strict)
- YAGNI (code not required by the plan)

Findings are categorized: **Critical** (must fix) > **Important** (should fix) > **Minor** (log only).

### Full Review (`review.mode: "full"`)

Default for `/iago:execute`. Three stages:

1. **Stage 1 — Spec compliance:** Does the implementation match the plan? File paths, actions, tests.
2. **Stage 2 — Quality review:** Performance, TypeScript strictness, maintainability, conventions. Only runs if Stage 1 finds zero Critical issues.
3. **Stage 3 — Cross-model adversarial review:** `/codex:adversarial-review` sends the diff to GPT-5.4 targeting auth bypass, data loss, race conditions, business logic errors, and rollback safety. Mandatory on every plan. If the Codex CLI is unavailable, falls back to a Claude adversarial session checking the same targets.

Critical findings at any stage route back to the executor for fixes (max 2 rounds).

### Codex Integration

The Codex adversarial review is mandatory — not optional, not conditional. A different model architecture catches different blind spots.

```
> /codex:review                    # Read-only GPT-5.4 review of git changes
> /codex:adversarial-review        # Targeted review (auto-dispatched during execute)
> /codex:rescue                    # Delegate debugging to Codex in background
> /codex:status                    # Check background job status
> /codex:result                    # Get output from finished job
```

Requires the Codex CLI: `npm install -g @openai/codex`. Run `/codex:setup` to verify.

---

### Post-Review: Fixing PR Comments (`/iago:prfix`)

After a PR gets review comments — from Claude, Codex, or a human reviewer — use `/iago:prfix` to fix them automatically.

```
> /iago:prfix              # Fix comments on current branch's PR
> /iago:prfix 16           # Fix a specific PR by number
> /iago:prfix --all        # Fix all open PRs with unresolved comments
```

What happens:

1. `/iago:prfix` posts a comment tagging `@claude` on the PR with fix instructions
2. The `claude-review-fix.yml` GitHub Action picks it up
3. Claude Code Action reads all review findings, fixes the code, and pushes
4. A `[claude-review-complete]` signal triggers the review-fix loop
5. If findings remain, it loops: fix → push → re-tag → re-review (max 5 rounds)
6. When clean (or max rounds reached), the loop stops and the PR is ready for human merge

**Important:** This runs entirely via GitHub Actions — you don't need to stay in a session. The async loop handles everything.

**Requirements:**
- `.github/workflows/claude.yml` and `.github/workflows/claude-review-fix.yml` installed on the repo
- `GH_PAT` secret set on the repo (fine-grained PAT with Contents/Issues/Pull requests R/W scope)
- `CLAUDE_CODE_OAUTH_TOKEN` secret set on the repo

The GH_PAT is needed because GitHub's default `GITHUB_TOKEN` cannot trigger other workflows — a PAT makes the re-tag comment trigger the next review cycle.

---

## Agent System

### How Dispatch Works

1. **Profile matching** — the orchestrator looks at file paths in the task. `src/` only → `frontend`. `amplify/` only → `backend`. Both → `fullstack`. Explicit `profile:` in the plan overrides this.
2. **Model selection** — each profile has a hardcoded model in frontmatter. Executor-based profiles (fullstack, frontend, backend, debug, e2e) use Opus. Analyst/operator profiles (review-single, review-full, research, infra, schema, content) use Sonnet. `security-audit` always uses Opus.
3. **Prompt composition** — concatenates: base agent template + capability modules + learnings (patterns + conventions) + task description + project context.
4. **Dispatch** — the agent runs with only the tools its base allows. Executor can edit files. Analyst can only read. Operator can search the web.
5. **Status reporting** — every agent ends with exactly one status: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, or BLOCKED.

### Base Agents

| Base | Tools | Purpose |
|------|-------|---------|
| `executor` | Read, Glob, Grep, Edit, Write, Bash, Notebook | Produces code — needs write access |
| `analyst` | Read, Glob, Grep, Bash | Reviews and analyzes — no write access prevents accidental changes |
| `operator` | Read, Glob, Grep, Bash, WebSearch, WebFetch | Interacts with external systems — web search, APIs, infra |

### Profiles Quick Reference

| Profile | Base | Use case |
|---------|------|----------|
| `fullstack` | executor | Full-stack tasks spanning frontend + backend |
| `frontend` | executor | React components, features, forms, animations |
| `backend` | executor | Lambda handlers, DynamoDB operations, Cognito config |
| `review-single` | analyst | One-pass code review with severity findings |
| `review-full` | analyst | Two-stage gated review (spec then quality) |
| `security-audit` | analyst | Deep security review — always Opus |
| `research` | operator | Multi-source research across codebase and web |
| `e2e` | executor | Playwright E2E test writing |
| `infra` | operator | AWS CLI, Amplify Gen 2 deployments, sandbox management |
| `schema` | analyst | DynamoDB single-table design |
| `content` | operator | Articles, proposals, investor materials |
| `debug` | executor | Build/typecheck/lint error resolution |

### Feedback Loops

Agent quality improves across sessions through learnings:

- `.iago/learnings/patterns.md` — recurring review findings (anti-patterns flagged across sessions)
- `.iago/learnings/project-conventions.md` — project-specific conventions discovered during work

Both are injected into agent prompts before dispatch. Patterns at 5+ occurrences are candidates for promotion to CLAUDE.md — making them permanent constraints.

---

## Configuration

### `.iago/config.json`

```json
{
  "project": {
    "name": "my-project",
    "client": "Client Name",
    "type": "client"
  },
  "review": {
    "mode": "single"
  },
  "routing": {
    "default_model": "auto",
    "security_critical": "opus",
    "retry_upgrade": true,
    "review_matches_impl": true
  }
}
```

| Setting | Options | Effect |
|---------|---------|--------|
| `review.mode` | `"single"` / `"full"` | One-pass vs two-stage gated review |
| `routing.default_model` | `"auto"` / `"sonnet"` / `"opus"` | Model for all dispatches (auto = heuristic-based) |
| `routing.security_critical` | `"opus"` | Model for auth/payment/data-access tasks |
| `routing.retry_upgrade` | `true` / `false` | Upgrade to Opus on retry after failed attempt |
| `routing.review_matches_impl` | `true` / `false` | Review uses same model as implementation |

### CLAUDE.md

The root `CLAUDE.md` is the master config. It defines:
- Tech stack (locked — agents won't suggest alternatives)
- Code standards (TypeScript strict, no `any`, named exports only, etc.)
- Architecture rules (DynamoDB single-table, Lambda thin handlers, etc.)
- Workflow phases and skill references
- Model routing table

Claude Code loads CLAUDE.md automatically on every session.

### Rules

Eight behavioral rules in `.claude/rules/`:

| Rule | Scope | What it enforces |
|------|-------|-----------------|
| `tdd.md` | All code | RED-GREEN-REFACTOR cycle, rationalization prevention, 80% coverage |
| `systematic-debugging.md` | All code | 4-phase debugging, 3-fix escalation rule |
| `git-workflow.md` | All git ops | Branch naming, conventional commits, PR format |
| `available-skills.md` | All sessions | Skill catalog, agent catalog, behavioral rules |
| `react-vite.md` | `src/**/*.tsx` | React 19 patterns, ShadCN, TanStack Query, Vite config |
| `aws-amplify.md` | `amplify/**` | Amplify Gen 2, DynamoDB, Lambda, Cognito, SES patterns |
| `e2e-testing.md` | Test files | Playwright selectors, Page Object Model, auth patterns |
| `mcp-server-patterns.md` | MCP files | MCP SDK conventions, tool definitions, error handling |

Path-scoped rules only activate when editing files matching their scope.

---

## Multi-Client Projects

### Project Isolation

Each project gets its own `.iago/` directory. No state is shared between projects.

```
iago-os/                    # Source of truth
  templates/                # Project templates
  scripts/                  # Scaffold + sync tools

acme-dashboard/             # Client project A
  .claude/                  # Synced from iago-os
  .iago/                    # Project-specific state

beta-api/                   # Client project B
  .claude/                  # Synced from iago-os
  .iago/                    # Project-specific state
```

### Scaffold a New Project

```bash
# Client project
./scripts/new-client.sh --name "Acme Corp" --project "dashboard" --path ../acme-dashboard

# Internal project
./scripts/new-client.sh --name "iaGO" --project "tool" --path ../tool --internal
```

### Keep Projects in Sync

When iaGO-OS is updated (new skills, agent improvements, rule changes):

```bash
# Sync to a specific project
./scripts/sync-skills.sh --target ../acme-dashboard

# Preview changes first
./scripts/sync-skills.sh --target ../acme-dashboard --dry-run

# Sync globally (available in all Claude Code sessions)
./scripts/sync-skills.sh --global
```

### Usage Analytics

```bash
# Usage report across projects
./scripts/usage-report.sh ../acme-dashboard ../beta-api
```

Aggregates skill invocations, agent dispatches, and session durations from `.iago/state/usage-log.jsonl`.

---

## Content & Research Skills

### `/brainstorming`

Socratic design exploration. Claude asks questions, maps trade-offs, and writes a spec.

```
> /brainstorming How should we handle multi-tenant data isolation?
```

Produces: `docs/specs/{slug}.md`

### `/deep-research`

Multi-source research: codebase search, context7 library docs, web search.

```
> /deep-research Compare DynamoDB single-table vs multi-table for our access patterns
```

Produces: `docs/research/{slug}.md`

### `/content-engine`

Blog posts, thought leadership, and multi-format content. Use `--formats blog` for a standalone article, or default to all formats (blog + social + newsletter + summary).

```
> /content-engine --formats blog AI agents in supply chain management --tone technical
> /content-engine docs/content/source.md --platforms twitter,linkedin
```

```
> /content-engine docs/content/ai-agents-article.md --platforms twitter,linkedin
```

Produces: blog + social posts + newsletter + summary in `docs/content/{slug}/`

### `/investor-materials`

Pitch decks, one-pagers, executive summaries.

```
> /investor-materials pitch-deck --stage seed --ask 1.5M
```

### `/prompt-optimizer`

Optimizes LLM prompts for client deliverables.

```
> /prompt-optimizer for our customer support classifier prompt
```

---

## Industry Skills

Domain-specific pattern libraries. These provide DynamoDB schemas, API patterns, and compliance guidance — they don't write application code directly.

| Skill | What it provides |
|-------|-----------------|
| `/healthcare-phi-compliance` | HIPAA-compliant DynamoDB, Cognito, Lambda, SES patterns for PHI |
| `/industry-patterns --domain logistics` | Shipment lifecycle, route optimization, warehouse operations, carrier APIs |
| `/industry-patterns --domain carrier-management` | Carrier profiles, rate tables, performance scorecards |
| `/industry-patterns --domain customs` | Tariff classification, duty calculation, export controls, denied party screening |
| `/industry-patterns --domain energy` | Meter data ingestion, grid events, energy trading, demand response programs |
| `/industry-patterns --domain inventory` | Stock tracking, reorder points, multi-location transfers, cycle counting |
| `/industry-patterns --domain production-scheduling` | Work orders, resource allocation, shift planning, capacity constraints |
| `/industry-patterns --domain quality-nonconformance` | Inspections, defect classification, CAPA workflows, root cause analysis |
| `/industry-patterns --domain returns` | RMA creation, return shipping, disposition, refund processing |

Full DynamoDB schemas and API pattern reference docs live in `docs/patterns/`.

---

## Hooks Deep Dive

Hooks fire automatically on Claude Code lifecycle events. They're wired in `.claude/settings.json` and implemented in `.iago/hooks/`.

### Lifecycle

```
SessionStart → PreToolUse → [tool runs] → PostToolUse → ... → PreCompact → Stop
     |              |                          |                    |          |
     v              v                          v                    v          v
  context-       safety-guard           post-edit-format       context-    context-
  persistence    config-protection      post-edit-typecheck    persistence persistence
  (restore)      commit-quality         post-edit-console-warn (snapshot)  (finalize)
                                        usage-tracker                      usage-tracker
                                        (skill/agent tracking)             (summary)
```

### Disabling Hooks

Set environment variables to disable specific hooks:

```bash
IAGO_DISABLE_TYPECHECK=1 claude           # Disable post-edit typecheck
```

Each hook checks `isDisabled("hookname")` on startup.

---

## Session Management

### Pause and Resume

```
> /iago:pause
```

Writes `.iago/state/HANDOFF.json` with:
- Current workflow position (phase, plan, task number)
- Completed and remaining tasks
- Key decisions made this session
- Uncommitted files
- Exact next action to continue

**Resume is automatic.** The session-start hook loads HANDOFF.json, injects context, and deletes the file.

### Recovery Hierarchy

1. **HANDOFF.json** — manual pause via `/iago:pause` (highest precision)
2. **Session snapshot** — automatic save on context compression ("what was I doing?")
3. **Interrupted session detection** — crash recovery from incomplete snapshots

Stale warning: HANDOFF.json older than 7 days triggers an informational warning.

### Context Window Management

Context window management relies on the `PreCompact` event — `context-persistence` automatically snapshots the session before Claude Code compresses context. The `context-monitor` hook was removed (Claude Code doesn't expose context % to hooks).

---

## Scheduled Automation

Automated triggers run prompts on a cron schedule — without you being in a session. Use them for recurring hygiene tasks: nightly code review, dependency audits, stale-handoff detection.

### Two Modes

| Mode | Persistence | Auth required | Expiry |
|------|-------------|---------------|--------|
| **RemoteTrigger** | Persistent — survives session end | Yes (Claude Code RemoteTrigger auth) | No auto-expiry |
| **Session cron** (built-in `/schedule`) | Session-scoped only | No | 7 days |

Use RemoteTrigger for anything you want running unattended. Session cron is for monitoring tasks during an active session only.

### Install a Template

Six ready-to-use templates cover the most common recurring tasks:

```
> /iago:schedule nightly-review         # 10:43pm weeknights — code review against main
> /iago:schedule usage-digest           # 9:17am Monday — skill + agent usage summary
> /iago:schedule stale-handoff          # 8:23am daily — warn if HANDOFF.json > 3 days old
> /iago:schedule dependency-audit       # 10:41am Saturday — npm audit, critical/high vulns
> /iago:schedule learnings-promotion    # 9:07am Friday — find patterns qualifying for CLAUDE.md
> /iago:schedule build-health           # Every 6 hours — tsc + biome check
```

The skill reads the template from `docs/automations/trigger-templates.md`, resolves `$PROJECT_DIR` to the current working directory, and calls RemoteTrigger create. If RemoteTrigger auth fails, it falls back to session cron with a 7-day expiry warning.

### Create a Custom Trigger

```
> /iago:schedule create "43 22 * * 1-5" "Run /code-review --against main for today's commits."
```

Five-field cron expression (minute hour day month weekday), then the prompt in quotes.

### List Active Triggers

```
> /iago:schedule list
```

Shows trigger IDs, schedules, and first 60 characters of the prompt.

### Remove a Trigger

```
> /iago:schedule remove {trigger-id}
```

Use the ID from `list`. For session cron jobs, this calls CronDelete instead of RemoteTrigger delete.

### Template Reference

Full library with cron expressions, prompt text, and RemoteTrigger API bodies: [`docs/automations/trigger-templates.md`](automations/trigger-templates.md)

### RemoteTrigger Auth

Persistent triggers require RemoteTrigger authentication. If `/iago:schedule` reports an auth failure, run `/schedule` setup from the Claude Code command palette or authenticate via Claude Code settings before retrying.

---

## Pipeline Mode

### The Problem

When a phase has 3+ plans, running `/iago:execute` normally fills up the context window. The review agent carries all the implementation conversation. Quality drops. You might need to start a new session and re-explain everything.

### The Solution: `--pipeline`

```
/iago:execute phase-1 --pipeline
```

Same pipeline (implement → build → review → codex → PR), but each step runs in a **separate Claude session**. No context accumulates. You can walk away.

```
Step 1: claude -p "implement plan"    → fresh session, full context
Step 2: tsc + vite build              → shell command, no Claude
Step 3: claude -p "review this diff"  → fresh session, only sees the diff
Step 4: claude -p "codex review"      → fresh session, adversarial check
Step 5: claude -p "create PR"         → fresh session, commits + PR
```

If the build breaks, it auto-dispatches a fix session (max 2 retries). If review finds Critical issues, same thing. You don't need to be there.

### When to Use It

The orchestrator **tells you automatically** when a phase has 3+ plans:

> "This phase has 4 plans. Recommend `--pipeline` — each step runs in a fresh session so context doesn't fill up and you can walk away. Use it?"

You can also just add `--pipeline` yourself anytime.

### Three Ways to Execute

| Command | When | You need to be there? |
|---------|------|----------------------|
| `/iago:execute phase` | 1-2 plans, quick work | Yes — you're watching |
| `/iago:execute phase --pipeline` | 3+ plans, or you want to leave | No — walk away |
| `/iago:execute phase --n8n` | Same as pipeline + visual dashboard + Slack | No — plus monitoring |

### n8n (Optional Upgrade)

`--n8n` does the same thing as `--pipeline` but routes through n8n for visual execution history, retry UI, and Slack notifications. Only set this up if you want monitoring. See `n8n/README.md`.

Config for n8n:
```json
{
  "automation": {
    "n8n_webhook_url": "http://localhost:5678/webhook/iago-execute"
  }
}
```

---

## Troubleshooting

### Skills not showing in autocomplete

1. Verify `.claude/skills/` exists (locally or in `~/.claude/`)
2. Each skill needs a `SKILL.md` file with valid YAML frontmatter
3. Restart Claude Code after syncing skills

### Hooks not firing

1. Check `.claude/settings.json` exists in your project
2. Verify hook paths reference `$CLAUDE_PROJECT_DIR/.iago/hooks/`
3. Test manually: `echo '{}' | node .iago/hooks/usage-tracker.mjs post-tool-use`

### "ENOENT" errors from hooks

Hooks expect `.iago/state/` to exist:

```bash
node -e "import('./.iago/hooks/lib/state-manager.mjs').then(m => m.init())"
```

### Build gate fails repeatedly

The `debug` profile gets dispatched automatically (max 2 retries). After 2 failures, execution stops and escalates. Check:
- `npx tsc --noEmit` — type errors
- `npx biome check` — lint/format errors
- Node.js version (must be 20+)

### Codex review not running

1. Verify Codex CLI is installed: `codex --version`
2. Run `/codex:setup` to check authentication
3. The adversarial review is mandatory — if it's skipping, check for BLOCKED status in the plan summary

### Windows path issues

Git Bash and Node.js resolve paths differently on Windows. Use `$CLAUDE_PROJECT_DIR` (set by Claude Code) for consistency. Never use `/tmp/` directly — it resolves differently across shells.
