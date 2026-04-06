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
    skills/             # 41 skill definitions
    agents/             # 3 bases + 13 capabilities + 12 profiles
    rules/              # 8 behavioral rules
  .iago/
    hooks/              # 9 hook scripts
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
2. **Model routing** — picks Sonnet or Opus based on task complexity
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
3. **Stage 3 — Cross-model adversarial review:** `/codex:adversarial-review` sends the diff to GPT-5.4 targeting auth bypass, data loss, race conditions, business logic errors, and rollback safety. Mandatory on every plan.

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

## Agent System

### How Dispatch Works

1. **Profile matching** — the orchestrator looks at file paths in the task. `src/` only → `frontend`. `amplify/` only → `backend`. Both → `fullstack`. Explicit `profile:` in the plan overrides this.
2. **Model selection** — reads `.iago/config.json` routing. Auto mode: 4+ files → Opus, auth/payment → `security_critical` model, retry → upgrade. Otherwise Sonnet.
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
| `infra` | operator | AWS CLI, Amplify, CDK operations |
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

### `/article-writing`

Blog posts and thought leadership with an authoritative consulting voice.

```
> /article-writing AI agents in supply chain management --tone technical --length long
```

### `/content-engine`

Transforms one source into multiple formats.

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
| `/carrier-relationship-management` | Carrier profiles, rate tables, performance scorecards for logistics |
| `/customs` | Tariff classification, duty calculation, export controls, denied party screening |
| `/energy` | Meter data ingestion, grid events, energy trading, demand response programs |
| `/logistics` | Shipment lifecycle, route optimization, warehouse operations, carrier APIs |
| `/inventory` | Stock tracking, reorder points, multi-location transfers, cycle counting |
| `/production-scheduling` | Work orders, resource allocation, shift planning, capacity constraints |
| `/quality-nonconformance` | Inspections, defect classification, CAPA workflows, root cause analysis |
| `/returns-reverse-logistics` | RMA creation, return shipping, disposition, refund processing |

---

## Hooks Deep Dive

Hooks fire automatically on Claude Code lifecycle events. They're wired in `.claude/settings.json` and implemented in `.iago/hooks/`.

### Lifecycle

```
SessionStart → PreToolUse → [tool runs] → PostToolUse → ... → PreCompact → Stop
     |              |                          |                    |          |
     v              v                          v                    v          v
  context-       safety-guard           context-monitor        context-    context-
  persistence    config-protection      post-edit-format       persistence persistence
  (restore)      commit-quality         post-edit-typecheck    (snapshot)  (finalize)
                                        post-edit-console-warn              usage-tracker
                                        usage-tracker                       (summary)
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

The `context-monitor` hook watches context usage:
- **70% threshold** — suggests compacting or finishing the current task
- **90% threshold** — warns to pause or wrap up immediately

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
