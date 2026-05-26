# iaGO-OS

3-person AI consultancy (CEO Windows, CTO Mac). Stack fixed — see `.claude/rules/stack.md`.

## Prerequisites
macOS: `brew install coreutils` (provides `timeout`/`gsort` for `scripts/execute-pipeline.sh`; BSD `sort -r` fallback exists for codex-companion lookup).

## Architecture
- **AWS mandatory for backend.** Amplify Gen 2 only (`defineBackend`, `defineAuth`, `defineData`, `defineFunction`); no raw CF/CDK/SAM/Serverless. DynamoDB single-table vs multi-table per project (access patterns drive schema; no ORMs — DocumentClient + typed helpers). Lambda thin handlers calling domain modules.
- Cognito JWT validation in API Gateway authorizer. TanStack Query for server state, React Context for UI. Forms: React Hook Form + Zod. Feature folders: `src/features/{name}/`.

## Doc routing — where new docs go
Auto-loads with this file. Consult before any Write to a `.md` path.

| Doc type | Location |
|---|---|
| Feature plan (multi-task) | `.iago/plans/feature-{slug}/{NN}.md` |
| Phase plan (ROADMAP) | `.iago/plans/{phase-slug}-{NN}.md` |
| Quick-fix plan | `.iago/plans/quick-{YYMMDD}-{slug}.md` |
| Execution summary | `.iago/summaries/{plan-slug}.md` |
| Phase decision artifact | `.iago/context/{YYYY-MM-DD}-{slug}.md` |
| Research / brainstorm / audit | `.iago/research/{YYYY-MM-DD}-{slug}.md` |
| Ops runbook (repeatable how-to) | `.iago/runbooks/{slug}.md` |
| Recurring review pattern | `.iago/learnings/patterns.md` (append) |
| Client-specific (any of the above) | `clients/{name}/.iago/{same-taxonomy}/` |
| Public-facing iaGO-OS docs | `docs/` (ARCHITECTURE, MANUAL, SETUP, etc.) |
| Domain-skill reference (industry pattern) | `docs/patterns/{domain}.md` |
| Phase-cycle artifact (vision / canonical roadmap) | `docs/specs/` (paired with `.iago/research/`) |
| Stale / superseded plan | `.iago/plans/_archive/{YYYY-MM-{slug}}/` (with roadmap pointer) |
| Stale / superseded doc (decision-bearing) | `docs/archive/` |
| Stale / superseded doc (no future value) | DELETE |

**Heuristic.** Name the doc's primary reader (Claude in this repo / Claude in a client subtree / human via GitHub) — that names the location. <!-- paths reflect Phase 1 (Wave 1 docs) layout; update after feature-mwp-restructure-code/01 physical split ships -->

## Workflow
Phases: init → discuss → plan (+ stress) → execute → verify. See `/iago-*` skills. Plan modes: `/iago-plan {slug}` (ROADMAP) | `--feature "desc"|file.md/.pdf` (standalone). Quick: `/iago-fast` (≤3 files) | `/iago-quick` (1-3 tasks). Artifacts per `## Doc routing`. STATE.md ≤ 80 lines; overflow → PROJECT.md.

## Execution Path
**NEVER implement plan/spec/task by editing code directly.** All via matching skill (user says "execute plan X" → invoke skill, not read or decompose):

| Scope | Skill | Review |
|-------|-------|--------|
| ROADMAP phase (1+ plans) | `/iago-execute {slug}` | Full 8-stage pipeline |
| Standalone plan (1-3 tasks) | `/iago-quick {desc}` | Full 8-stage pipeline |
| Multi-task plan (outside ROADMAP) | `/subagent-driven-development` | Full 8-stage pipeline |
| Trivial fix (≤3 files, obvious) | `/iago-fast {desc}` | Build gate only |

## Review Pipeline
`scripts/execute-pipeline.sh`: stress → impl → build gate → review → codex → codex fix → PR → tag → summary + async GitHub review-fix loop. Details in `.claude/rules/execution-pipeline.md`. Skip only via `/iago-fast`.

## Verification
Never claim done without running verification and reading output. "Tests pass" = ran them, saw green. "Build succeeds" = ran it, saw exit 0.

## Search First
Search codebase before creating any new file/component/utility. Duplication is bug.

## Agent Escalation Protocol
Every subagent ends with one status: **DONE** (verified) / **DONE_WITH_CONCERNS** (minor issues listed) / **NEEDS_CONTEXT** (state missing info) / **BLOCKED** (state external blocker; no retry without resolving).

## Execution Discipline
7+ consecutive Read/Grep/Glob without Edit/Write/Bash: STOP, state findings, ask to continue. 3 failed fixes same issue: STOP, escalate. During execution: only what plan specifies; new ideas deferred; auto-fix bugs/imports/blockers; ASK before architectural changes.

## Rules
Detailed rules in `.claude/rules/`: `stack.md` (tech stack), `output-style.md` (orchestrator response style), `memory.md` (six-layer memory + frozen-snapshot rule), `execution-pipeline.md` (**MANDATORY** review pipeline), `tdd.md` (RED-GREEN-REFACTOR), `systematic-debugging.md` (4-phase debugging), `git-workflow.md` (branching/PRs), `available-skills.md` (full skill catalog). Path-scoped: `react-vite.md` (src/**/*.tsx), `aws-amplify.md` (amplify/**), `e2e-testing.md` (tests), `mcp-server-patterns.md` (MCP files). Code standards live in the path-scoped React/AWS/TDD/MCP rules.

## Agents
3 bases, 13 capabilities, 12 profiles in `.claude/agents/`. Hub-and-spoke: only orchestrator dispatches.

## Model Routing
Opus: orchestrator + code-writing (impl/fix/debug). Sonnet: PR creation, @claude tags, Codex fallback, mechanical analysis. Codex (GPT-5.5): cross-model adversarial review, `/codex:rescue` — pinned in `~/.codex/config.toml`.
