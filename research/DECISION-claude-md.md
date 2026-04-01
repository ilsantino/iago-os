# CLAUDE.md Specification

> Date: 2026-04-01
> Sprint: 5 — Phase 2
> Source: DECISION-workflow.md §6 (budget), §9 (discipline placement), §10 (rules files)

---

## Line Budget

| # | Section | Target Lines | Actual Lines | Contents Summary |
|---|---------|-------------|-------------|-----------------|
| 1 | Identity | 5 | 5 | Team, purpose, "stack is fixed" |
| 2 | Tech Stack | 9 | 9 | Frontend, backend, agents, testing, tooling, infra |
| 3 | Code Standards | 12 | 12 | TS strict, named exports, functional components, colocation, naming, imports |
| 4 | Architecture | 11 | 11 | DynamoDB, Lambda, Cognito, Amplify, TanStack Query, feature folders, Zod |
| 5 | Workflow | 8 | 8 | Phase summary, quick modes, artifacts, STATE.md cap, pause |
| 6 | Verification | 6 | 6 | Never claim done without evidence (discipline §9 pattern #3) |
| 7 | Search First | 5 | 5 | Search before creating (discipline §9 pattern #4) |
| 8 | Agent Escalation Protocol | 9 | 9 | DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED (discipline §9 pattern #5) |
| 9 | Execution Discipline | 12 | 12 | 7-read guard, 3-fix escalation, no scope creep, deviation rules (discipline §9 patterns #1, #2, #6, #7) |
| 10 | Rules | 12 | 12 | Pointer + list of all 8 rules files |
| 11 | Skills | 6 | 6 | Core + workflow skill names, pointer to catalog |
| 12 | Agents | 4 | 4 | 8 agent names, model, hub-and-spoke constraint |
| 13 | Model Routing | 6 | 6 | Opus/Sonnet/Haiku allocation |
| | **Total** | **≤200** | **105** | **95 lines headroom for project-specific additions** |

Discipline sections (6-9) total 32 lines — more than the original ~15 estimate because the decided content (4 separate CLAUDE.md patterns from §9) requires it. Total still well under budget.

---

## Draft CLAUDE.md

```markdown
# iaGO-OS

3-person AI consultancy (CEO on Windows, CTO on Mac).
Claude Code configuration layer for multi-client project delivery.
Stack is fixed — do not suggest alternatives unless explicitly asked.

## Tech Stack

- **Frontend:** React 19 + Vite + TypeScript (strict) + TailwindCSS 4 + ShadCN/UI
- **Backend:** AWS Amplify Gen 2 + Lambda (Node.js 20) + API Gateway + DynamoDB + Cognito
- **Agents:** Claude SDK (Anthropic) + LangGraph + n8n
- **Testing:** Vitest (unit/integration), Playwright (E2E)
- **Tooling:** Biome (formatter + linter) — never Prettier, ESLint, or gofmt
- **Infra:** AWS CDK, GitHub Actions CI/CD

## Code Standards

- TypeScript strict — no `any`, no `as` casts (except type guards), no `@ts-ignore`
- Named exports only — no default exports
- Functional components only — no class components
- `use()` + `<Suspense>` for data fetching — no useEffect for data loading
- Error boundaries for component-level error handling
- Colocation: component + test + styles in same directory
- File naming: kebab-case files, PascalCase components, camelCase utilities
- Barrel files (`index.ts`) only at public API boundaries
- Imports: external deps first, then internal with `@/` aliases

## Architecture

- DynamoDB single-table design — access patterns drive schema, not entity relationships
- Lambda: thin handler wrappers calling domain logic modules
- Cognito JWT validation in API Gateway authorizer, not in Lambda handlers
- Amplify Gen 2: `defineBackend`, `defineAuth`, `defineData`, `defineFunction`
- TanStack Query for server state, React Context for UI state only
- Feature folders: `src/features/{name}/` with components, hooks, api, types
- No ORMs — DynamoDB DocumentClient with typed helpers
- Form handling: React Hook Form + Zod validation

## Workflow

Phases: init → discuss → plan → execute → verify. See `/iago:*` skills.
Quick modes: `/iago:fast` (trivial, ≤3 files) | `/iago:quick` (1-3 tasks, composable flags).
Artifacts: `.iago/plans/`, `.iago/context/`, `.iago/summaries/`, `.iago/reviews/`.
STATE.md is a digest — keep under 80 lines. Overflow decisions to PROJECT.md.
Pause: `/iago:pause`. Resume is automatic on next session start.

## Verification

Never claim a task is complete without running a verification command and reading its output.
"Tests pass" means you ran them and saw green. "Build succeeds" means you ran it and saw exit 0.
Do not assert outcomes — demonstrate them.

## Search First

Before creating any new file, component, or utility, search the codebase for existing implementations.
Duplication is a bug.

## Agent Escalation Protocol

Every subagent MUST end its response with exactly one status:

- **DONE** — requirements verified with evidence (test output, build success)
- **DONE_WITH_CONCERNS** — requirements met, minor issues listed
- **NEEDS_CONTEXT** — state exactly what information is missing
- **BLOCKED** — state the external blocker; do not retry without resolving it

## Execution Discipline

7+ consecutive Read/Grep/Glob without Edit/Write/Bash: STOP. State findings, ask
whether to continue reading or start writing. Exception: research/analysis/review
tasks may read freely but must produce a written artifact before reporting DONE.

3 failed fix attempts on the same issue: STOP. Report failure pattern, escalate.
No 4th attempt without new information or a different approach.

During execution, implement only what the plan specifies. New ideas go to deferred.
Auto-fix bugs, missing imports, and blocking issues. ASK before architectural changes.

## Rules

Detailed rules in `.claude/rules/`:
- `tdd.md` — RED-GREEN-REFACTOR, rationalization prevention, 80% coverage
- `systematic-debugging.md` — 4-phase debugging, 3-fix escalation
- `git-workflow.md` — branching, PRs, merge strategy
- `available-skills.md` — full skill and agent catalog
- `react-vite.md` — React 19 + Vite patterns *(path-scoped: `src/**/*.tsx`)*
- `aws-amplify.md` — Amplify Gen 2 + DynamoDB + Lambda *(path-scoped: `amplify/**`)*
- `e2e-testing.md` — Playwright conventions *(path-scoped: test files)*
- `mcp-server-patterns.md` — MCP Node/TS SDK *(path-scoped: MCP files)*

## Skills

Core: `/brainstorming`, `/writing-plans`, `/subagent-driven-development`, `/code-review`, `/deep-research`, `/prompt-optimizer`.
Workflow: `/iago:init`, `/iago:discuss`, `/iago:plan`, `/iago:execute`, `/iago:verify`, `/iago:fast`, `/iago:quick`, `/iago:pause`.
See `.claude/rules/available-skills.md` for the complete catalog including content, experimental, and industry skills.

## Agents

8 agents in `.claude/agents/`: implementer, code-reviewer, spec-reviewer, code-quality-reviewer, researcher, tdd-guide, build-error-resolver, e2e-runner.
All on Sonnet. Hub-and-spoke: only the orchestrator (this session) dispatches agents — agents never spawn other agents.

## Model Routing

- **Opus:** Orchestrator (main session) — planning, architecture, multi-file reasoning
- **Sonnet:** All subagents — implementation, review, research, debugging, testing
- **Haiku:** Reserve for mechanical tasks (formatting, simple lookups) when needed
```

---

## What CLAUDE.md Explicitly Does NOT Include

| Topic | Lives In Instead | Why Not CLAUDE.md |
|-------|-----------------|------------------|
| TDD procedure + 11 rationalization pairs | `.claude/rules/tdd.md` (~40 lines) | 40 lines for one rule. Would consume 38% of budget. |
| Systematic debugging 4-phase process | `.claude/rules/systematic-debugging.md` (~30 lines) | Too long. Only relevant during debugging. |
| E2E Playwright patterns | `.claude/rules/e2e-testing.md` (~35 lines) | Path-scoped. Zero cost when not editing tests. |
| MCP server conventions | `.claude/rules/mcp-server-patterns.md` (~30 lines) | Path-scoped. Niche — most sessions never touch MCP. |
| React 19 component patterns (detailed) | `.claude/rules/react-vite.md` (~25 lines) | Path-scoped. CLAUDE.md has the 1-line summary. |
| AWS/DynamoDB patterns (detailed) | `.claude/rules/aws-amplify.md` (~30 lines) | Path-scoped. CLAUDE.md has the 1-line summary. |
| Git branching + PR conventions | `.claude/rules/git-workflow.md` (~20 lines) | Too detailed for CLAUDE.md. |
| Full skill + agent catalog with descriptions | `.claude/rules/available-skills.md` (~40 lines) | Reference material. CLAUDE.md lists names only. |
| No-placeholders rule (full list) | `/iago:plan` SKILL.md | Only loaded when planning. Zero idle cost. |
| Plan self-review 6-point checklist | `/iago:plan` SKILL.md | Only loaded when planning. |
| Two-stage review protocol | `/subagent-driven-development` SKILL.md | Only loaded during execution dispatch. |
| Fresh-context dispatch details | `/subagent-driven-development` SKILL.md | Implementation detail of one skill. |
| Destructive command patterns (13 regexes) | `safety-guard.mjs` hook | Mechanical enforcement > prompt enforcement. Zero tokens. |
| Secret detection patterns (17 regexes) | `safety-guard.mjs` hook | Same — hook enforcement is strictly superior. |
| Commit validation rules | `commit-quality.mjs` hook | Hook catches violations mechanically. |
| Config file denylist | `config-protection.mjs` hook | Hook blocks edits. Listing files in CLAUDE.md is noise. |
| Context budget thresholds (80%/90%) | `context-monitor.mjs` hook | Hook injects warnings at runtime. Static rule can't adapt. |
| Post-edit format/typecheck pipeline | `post-edit-*.mjs` hooks | Automatic. Telling Claude about hooks it can't control wastes tokens. |
| Per-agent escalation triggers | Each agent's `## Escalation` section | Agent-specific. 8 agents × ~5 lines = 40 lines of content only relevant to one agent at a time. |
| config.json schema / field reference | `/iago:init` SKILL.md + DECISION-workflow.md §3 | Implementation detail. Users don't read config schema in every session. |
| Workflow phase details (gates, drivers) | `/iago:*` skill files | Phase details loaded on demand when the skill is invoked. |
| HANDOFF.json schema | `/iago:pause` SKILL.md + DECISION-workflow.md §8 | Only needed during pause. |
| Artifact templates (plan, summary, review) | Skill files + DECISION-workflow.md §11 | Templates loaded when the creating skill is invoked. |
| Cost tracking fields | `context-persistence.mjs` hook | Internal hook bookkeeping. No human action required. |
| Production agent concerns (budgets, heartbeats) | Paperclip (deferred) | DECISION-paperclip.md — not iaGO's domain. |

---

## Absorbed Content Audit

Every piece of content from prior decisions that was marked "absorbed into CLAUDE.md" with its exact placement:

| Content | Source Decision | Placed In CLAUDE.md Section |
|---------|----------------|----------------------------|
| Verification-before-completion (~4 lines) | DECISION-skills.md §1 (core skill #1) | §6 Verification |
| Search-first (~3 lines) | DECISION-skills.md §8 (core skill #8) | §7 Search First |
| Agent Escalation Protocol vocabulary | DECISION-conventions.md §C | §8 Agent Escalation Protocol |
| Execution Discipline: paralysis guard (7 reads) | DECISION-conventions.md §D, discipline pattern #1 | §9 Execution Discipline (lines 1-3) |
| Execution Discipline: fix escalation (3 fails) | DECISION-conventions.md §D, discipline pattern #2 | §9 Execution Discipline (lines 5-6) |
| No scope creep during execution | DECISION-discipline.md, discipline pattern #6 | §9 Execution Discipline (line 8) |
| Deviation rules (auto-fix vs ASK) | DECISION-discipline.md, discipline pattern #7 | §9 Execution Discipline (line 9) |
| STATE.md digest (<80 lines) | DECISION-discipline.md, discipline pattern #8 | §5 Workflow (line 4) |

**Verification:** 8 absorbed items, all from §9 discipline patterns #1-#8. Each has exactly one home. No duplication with rules/, skills/, or hooks.
