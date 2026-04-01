# Discipline & Allocation Decisions

> Phase 4a of Workflow Engine — Discipline Placement & CLAUDE.md Budget
> Date: 2026-04-01
> Depends on: workflow-synthesis.md (discipline patterns, config hierarchy), DECISION-hooks.md (hook coverage), DECISION-skills-agents.md (agent prompts, skill placements), DECISION-conventions.md (escalation protocol, paralysis guard, CSO), DECISION-execution.md (plan format, dispatch model), DECISION-workflow-foundation.md (phases, state dir, config)

---

## Decision 9: Cross-Cutting Discipline Patterns

Every discipline pattern from the research has exactly one canonical home. No duplication across layers — if a hook enforces it, don't repeat it in CLAUDE.md. If CLAUDE.md states it, don't restate it in every agent prompt (agents inherit CLAUDE.md).

### Complete Placement Table

| # | Pattern | Source | Location | Enforcement | Already Handled By |
|---|---------|--------|----------|-------------|-------------------|
| 1 | Analysis paralysis guard (7 reads → stop) | GSD, Superpowers | CLAUDE.md | §Execution Discipline — universal behavioral rule | CLAUDE.md (DECISION-conventions.md §D) |
| 2 | Fix-attempt escalation (3 fails → stop) | GSD, Superpowers | CLAUDE.md | §Execution Discipline — universal behavioral rule | CLAUDE.md (DECISION-conventions.md §D) |
| 3 | Verification-before-completion | Superpowers | CLAUDE.md | §Verification — universal behavioral rule | CLAUDE.md (DECISION-skills.md §1) |
| 4 | Search before creating | ECC | CLAUDE.md | §Search First — universal behavioral rule | CLAUDE.md (DECISION-skills.md §8) |
| 5 | Agent escalation protocol (DONE/BLOCKED/...) | Superpowers | CLAUDE.md | §Agent Escalation Protocol — inherited by all agents | CLAUDE.md (DECISION-conventions.md §C) |
| 6 | No scope creep during execution | GSD | CLAUDE.md | §Execution Discipline — 1-line addition | **New** |
| 7 | Deviation rules (auto-fix vs ASK) | GSD | CLAUDE.md | §Execution Discipline — 1-line addition | **New** |
| 8 | STATE.md digest discipline (<80 lines) | GSD | CLAUDE.md | §Workflow — 1-line constraint | **New** |
| 9 | Skill-check meta-rule | Superpowers | .claude/rules/ | available-skills.md auto-loaded | `available-skills.md` (DECISION-skills-agents.md §2) |
| 10 | TDD red-green-refactor | Superpowers + ECC | .claude/rules/ | tdd.md always-on rule (~40 lines) | `tdd.md` (DECISION-skills.md §2) |
| 11 | Rationalization prevention (excuse/reality tables) | Superpowers | .claude/rules/ | Embedded in tdd.md as anti-excuse discipline | `tdd.md` (DECISION-skills.md §2) |
| 12 | Systematic debugging 4-phase | Superpowers | .claude/rules/ | systematic-debugging.md always-on rule (~30 lines) | `systematic-debugging.md` (DECISION-skills.md §3) |
| 13 | No-placeholders rule | Superpowers | Skill SKILL.md | Plan self-review in `/iago:plan` | `/iago:plan` skill (DECISION-execution.md §4) |
| 14 | Self-review before marking plan done | Superpowers | Skill SKILL.md | 6-point checklist in `/iago:plan` | `/iago:plan` skill (DECISION-execution.md §4) |
| 15 | Fresh context per dispatch | GSD | Skill SKILL.md | subagent-driven-development dispatch model | SDD skill (DECISION-execution.md §5) |
| 16 | Two-stage review discipline | Superpowers | Skill SKILL.md | Opt-in via "full review" trigger | SDD + code-review skills (DECISION-conventions.md §E) |
| 17 | Commit message conventions | Multiple | Hook | `commit-quality.mjs` — mechanical enforcement, zero tokens | Hook (DECISION-hooks.md §4) |
| 18 | Config file protection | ECC | Hook | `config-protection.mjs` — blocks edits to protected files | Hook (DECISION-hooks.md §3) |
| 19 | Destructive command blocking (13 patterns) | GSD + ECC | Hook | `safety-guard.mjs` — PreToolUse Bash | Hook (DECISION-hooks.md §4) |
| 20 | Secret detection (17 patterns) | ECC | Hook | `safety-guard.mjs` — PreToolUse Edit/Write | Hook (DECISION-hooks.md §4) |
| 21 | Injection detection (4 patterns) | GSD + ECC | Hook | `safety-guard.mjs` — PreToolUse Edit/Write | Hook (DECISION-hooks.md §4) |
| 22 | Context budget monitoring | GSD | Hook + config | `context-monitor.mjs` + `planning.context_budget_pct` | Hook (DECISION-hooks.md §6) |
| 23 | Post-edit formatting (Biome) | ECC | Hook | `post-edit-format.mjs` — PostToolUse Edit | Hook (DECISION-hooks.md §3) |
| 24 | Post-edit typecheck | ECC | Hook | `post-edit-typecheck.mjs` — PostToolUse Edit | Hook (DECISION-hooks.md §3) |

### Patterns Already Covered (No Action Needed)

These patterns have canonical homes in existing decisions. Do not re-place them.

| Pattern | Covered By | Decision File |
|---------|-----------|---------------|
| Analysis paralysis guard | CLAUDE.md §Execution Discipline | DECISION-conventions.md §D |
| Fix-attempt escalation | CLAUDE.md §Execution Discipline | DECISION-conventions.md §D |
| Verification-before-completion | CLAUDE.md §Verification | DECISION-skills.md §1 |
| Search before creating | CLAUDE.md §Search First | DECISION-skills.md §8 |
| Agent escalation protocol | CLAUDE.md §Agent Escalation Protocol | DECISION-conventions.md §C |
| Skill-check meta-rule | `.claude/rules/available-skills.md` | DECISION-skills-agents.md §2 |
| TDD + rationalization prevention | `.claude/rules/tdd.md` | DECISION-skills.md §2 |
| Systematic debugging | `.claude/rules/systematic-debugging.md` | DECISION-skills.md §3 |
| No-placeholders rule | `/iago:plan` SKILL.md | DECISION-execution.md §4 |
| Plan self-review | `/iago:plan` SKILL.md | DECISION-execution.md §4 |
| Fresh context per dispatch | `/subagent-driven-development` SKILL.md | DECISION-execution.md §5 |
| Two-stage review | `/subagent-driven-development` + `/code-review` SKILL.md | DECISION-conventions.md §E |
| Commit conventions | `commit-quality.mjs` hook | DECISION-hooks.md §4 |
| Config protection | `config-protection.mjs` hook | DECISION-hooks.md §3 |
| Destructive commands | `safety-guard.mjs` hook | DECISION-hooks.md §4 |
| Secret detection | `safety-guard.mjs` hook | DECISION-hooks.md §4 |
| Injection detection | `safety-guard.mjs` hook | DECISION-hooks.md §4 |
| Context monitoring | `context-monitor.mjs` hook | DECISION-hooks.md §6 |
| Post-edit formatting | `post-edit-format.mjs` hook | DECISION-hooks.md §3 |
| Post-edit typecheck | `post-edit-typecheck.mjs` hook | DECISION-hooks.md §3 |

### New Placements (3 additions to CLAUDE.md)

Only 3 discipline patterns need new homes. All are short enough for CLAUDE.md inline placement.

**#6 — No scope creep (→ CLAUDE.md §Execution Discipline)**

```
During execution, implement only what the plan specifies. New ideas go to deferred, not into current work.
```

1 line. Universal — applies to orchestrator and all agents during execution. Can't be a hook (no mechanical way to detect scope creep). Can't be path-scoped (applies everywhere). Too short for a rules file.

**#7 — Deviation rules (→ CLAUDE.md §Execution Discipline)**

```
Auto-fix bugs, missing imports, and blocking issues. ASK before architectural changes or scope modifications.
```

1 line. Clarifies what agents can fix autonomously vs what requires human approval. Complements the 3-fix escalation already in Execution Discipline.

**#8 — STATE.md digest discipline (→ CLAUDE.md §Workflow)**

```
STATE.md is a digest — keep under 80 lines. Overflow decisions to PROJECT.md.
```

1 line. Prevents STATE.md from becoming a dump. The 80-line cap is from DECISION-workflow-foundation.md. Placing it in the Workflow section (not Execution Discipline) because it's a structural constraint, not a behavioral one.

### Updated Execution Discipline Text (for CLAUDE.md)

With the 3 new lines integrated:

```markdown
## Execution Discipline

During task execution, if you make 7+ consecutive Read/Grep/Glob calls without any
Edit/Write/Bash action: STOP. State what you have learned so far and ask whether to
continue investigating or begin producing output.

Exception: explicit research/analysis/review tasks may read freely, but must still
produce a written artifact (summary, analysis, recommendation) before reporting DONE.

After 3 failed attempts to fix the same issue, STOP. Report the failure pattern and
escalate — do not attempt a 4th fix without new information or a different approach.

During execution, implement only what the plan specifies. New ideas go to deferred, not into current work.
Auto-fix bugs, missing imports, and blocking issues. ASK before architectural changes or scope modifications.
```

12 lines of content + 1 header = 13 lines total.

---

## Decision 6: CLAUDE.md Line Budget

### Design Principles

1. **Every line costs tokens on every interaction.** CLAUDE.md loads every session for every agent. Treat it like a fixed tax.
2. **Short universal rules only.** If a rule needs >5 lines of explanation, it belongs in `.claude/rules/`.
3. **Pointers, not content.** CLAUDE.md points to rules/, skills/, agents/ — it doesn't duplicate their content.
4. **Room for growth.** Target ~100 lines now, leaving headroom for project-specific additions up to 200.

### Section Budget

| # | Section | Lines | Contents Summary |
|---|---------|-------|-----------------|
| 1 | Identity | 5 | Team (3-person consultancy, CEO/CTO/dev), iaGO-OS purpose (Claude Code config layer for multi-client delivery), "stack is fixed" declaration |
| 2 | Tech Stack | 7 | Frontend (React 19 + Vite + TS strict + TailwindCSS 4 + ShadCN/UI), Backend (AWS Amplify Gen 2 + Lambda + API Gateway + DynamoDB + Cognito), Agents (Claude SDK + LangGraph + n8n), Tooling (Biome + Vitest + Playwright), Infra (AWS CDK + GitHub Actions) |
| 3 | Code Standards | 11 | Biome only (no Prettier/ESLint), TS strict (no `any`/`as`/`@ts-ignore`), named exports only, no barrel files except public API, functional components only, `use()` + Suspense for data, error boundaries, colocation, kebab-case files |
| 4 | Architecture Rules | 10 | DynamoDB single-table, Lambda thin handlers, Cognito JWT in API Gateway authorizer, Amplify Gen 2 `define*` API, TanStack Query for server state + Context for UI state, no ORMs, feature folders |
| 5 | Workflow | 6 | Phase summary (init→discuss→plan→execute→verify), quick/fast mode pointers, STATE.md <80 lines constraint, artifact directory references |
| 6 | Verification | 4 | Never claim done without running verification and reading output. "Tests pass" means you ran them. |
| 7 | Search First | 2 | Search codebase before creating. Duplication is a bug. |
| 8 | Agent Escalation Protocol | 7 | STATUS line requirement, DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED definitions |
| 9 | Execution Discipline | 13 | 7-read paralysis guard with research exception, 3-fix escalation, no scope creep, deviation rules (auto-fix vs ASK) |
| 10 | Pointers | 8 | Rules (→ `.claude/rules/`), Skills (→ `.claude/rules/available-skills.md`), Agents (8 agents on Sonnet, orchestrator on Opus) |
| 11 | Model Routing | 4 | Opus = orchestrator (planning, architecture), Sonnet = all subagents, Haiku = reserved for mechanical tasks |
| — | Headers + blank lines | ~13 | Section headers (##) and breathing room between sections |
| | **Total** | **~90** | **Under 200. ~110 lines of headroom for project-specific additions.** |

### What CLAUDE.md Does NOT Include

| Content | Lives In Instead | Reasoning |
|---------|-----------------|-----------|
| TDD procedure + 11 excuse/reality pairs | `.claude/rules/tdd.md` (~40 lines) | Too long. Domain-specific. Would consume 40% of CLAUDE.md budget for one rule. |
| Systematic debugging 4-phase process | `.claude/rules/systematic-debugging.md` (~30 lines) | Too long. Only relevant during debugging, not every interaction. |
| E2E testing Playwright patterns | `.claude/rules/e2e-testing.md` (~35 lines) | Path-scoped to test files. No cost when not editing tests. |
| MCP server conventions | `.claude/rules/mcp-server-patterns.md` (~30 lines) | Path-scoped to MCP code. Niche — most sessions don't touch MCP. |
| Full skill + agent catalog | `.claude/rules/available-skills.md` (~40 lines) | Reference material. Needs its own CSO description field. |
| React 19 component patterns (detailed) | `.claude/rules/react-vite.md` (~25 lines) | Path-scoped to `.tsx/.jsx`. CLAUDE.md has the 1-line summary; rules file has the detail. |
| AWS/DynamoDB/Lambda patterns (detailed) | `.claude/rules/aws-amplify.md` (~30 lines) | Path-scoped to backend/infra. CLAUDE.md has the 1-line summary; rules file has the detail. |
| Git branching + PR conventions | `.claude/rules/git-workflow.md` (~20 lines) | Too detailed for CLAUDE.md. Always-on but low token cost at 20 lines. |
| No-placeholders rule (full list) | `/iago:plan` SKILL.md | Only loaded when planning. Zero cost during implementation. |
| Plan self-review 6-point checklist | `/iago:plan` SKILL.md | Only loaded when planning. |
| Two-stage review protocol | `/subagent-driven-development` SKILL.md | Only loaded during execution dispatch. |
| Destructive command patterns (13 regexes) | `safety-guard.mjs` hook | Mechanical enforcement. Zero token cost. Regexes in CLAUDE.md would waste context and be weaker than hook enforcement. |
| Secret detection patterns (17 regexes) | `safety-guard.mjs` hook | Same — hook enforcement is strictly superior to prompt-based for pattern matching. |
| Commit validation rules | `commit-quality.mjs` hook | Hook catches bad commits before they happen. CLAUDE.md rule would only "suggest" — weaker. |
| Config file denylist | `config-protection.mjs` hook | Hook blocks edits mechanically. Listing protected files in CLAUDE.md is noise. |
| Context budget thresholds | `context-monitor.mjs` hook + `config.json` | Hook injects warnings at the right moment. Static rules in CLAUDE.md can't adapt to actual context usage. |
| Per-agent escalation triggers | Each agent's `## Escalation` section | Agent-specific. Loading all 8 agents' triggers into CLAUDE.md wastes 40+ lines on content only relevant to the dispatched agent. |
| Rationalization prevention tables | `.claude/rules/tdd.md` | The 11-entry excuse/reality table is TDD-specific. Generalized anti-rationalization is already in Execution Discipline (the paralysis guard IS the generalized version). |

### Config Hierarchy

Precedence order for conflict resolution. Higher number wins.

| # | Layer | Scope | Precedence | Token Cost | Override Model |
|---|-------|-------|-----------|-----------|----------------|
| 1 | **CLAUDE.md** | Project-level. Loaded every session, every agent. | Lowest — guidance, not hard constraint. | ~90 lines always. | Agents inherit. Can be supplemented by rules but not contradicted. |
| 2 | **.claude/rules/** | Domain-scoped or always-on. Loaded automatically by Claude Code based on `paths:` frontmatter or unconditionally. | Medium — hard constraints within their scope. | ~130 lines always-on + ~120 lines path-scoped (loaded on demand). | Override CLAUDE.md within their domain. Path-scoped rules only active when editing matching files. |
| 3 | **Skills** | Task-scoped. Loaded only when user invokes `/{name}` or orchestrator calls the skill. | Medium — workflow instructions for the active task. | Zero when not invoked. ~30-60 lines per invocation. | Must align with CLAUDE.md + rules. Can add procedure but can't contradict constraints. |
| 4 | **Agent prompts** | Role-scoped. Loaded only when agent is dispatched. | Medium — role-specific behavior for dispatched agent. | Zero when not dispatched. ~50-65 lines per agent. | Inherit CLAUDE.md. Agent constraints can tighten (restrict tools, add process) but never loosen rules. |
| 5 | **Hooks** | Event-scoped. Run as external Node.js processes on matching events. | Highest — mechanical enforcement, no prompt override possible. | Zero context tokens. ~1,120 lines of hook code, but none loaded into context. | Cannot be overridden by any prompt-based layer. The only way to bypass is `IAGO_DISABLED_HOOKS` env var. |

**Conflict resolution rules:**
- Hook blocks an action → action is blocked. Period. No CLAUDE.md rule, skill, or agent prompt can override a hook.
- Rule says X, CLAUDE.md says Y → rule wins within its scope. Rules are hard constraints.
- Skill says do Z during a workflow → valid as long as Z doesn't violate rules or CLAUDE.md.
- Agent prompt restricts tools → agent-level restriction is additive, never subtractive (can't grant tools that the agent definition denies).

**Independence principle (from ECC):** Layers compose but don't require each other. You can use CLAUDE.md without rules/. You can use hooks without skills. Each layer adds to the system independently.

---

## Rules Files Specification

### Complete Rules File Table

| # | File | Path | Scope | Lines | Status |
|---|------|------|-------|-------|--------|
| 1 | `tdd.md` | `.claude/rules/tdd.md` | Always-on | ~40 | Decided (Sprint 3) |
| 2 | `systematic-debugging.md` | `.claude/rules/systematic-debugging.md` | Always-on | ~30 | Decided (Sprint 3) |
| 3 | `e2e-testing.md` | `.claude/rules/e2e-testing.md` | Path: `**/*.{test,spec}.{ts,tsx}`, `e2e/**`, `tests/**` | ~35 | Decided (Sprint 3) |
| 4 | `mcp-server-patterns.md` | `.claude/rules/mcp-server-patterns.md` | Path: `**/mcp/**`, `**/mcp-*.ts` | ~30 | Decided (Sprint 3) |
| 5 | `available-skills.md` | `.claude/rules/available-skills.md` | Always-on | ~40 | Decided (Sprint 3) |
| 6 | `git-workflow.md` | `.claude/rules/git-workflow.md` | Always-on | ~20 | **New** |
| 7 | `react-vite.md` | `.claude/rules/react-vite.md` | Path: `src/**/*.{tsx,jsx}`, `src/**/*.css` | ~25 | **New** |
| 8 | `aws-amplify.md` | `.claude/rules/aws-amplify.md` | Path: `amplify/**`, `src/api/**`, `infra/**`, `**/lambda/**` | ~30 | **New** |

**Totals:**
- 8 rules files, ~250 lines total
- Always-on: 4 files, ~130 lines (tdd, systematic-debugging, available-skills, git-workflow)
- Path-scoped: 4 files, ~120 lines (e2e-testing, mcp-server-patterns, react-vite, aws-amplify)

### Rules by Domain

#### common/ (always-on, cross-cutting)

**`tdd.md` (~40 lines)** — Already decided, DECISION-skills.md §2

RED-GREEN-REFACTOR iron law. Merge of Superpowers' anti-rationalization discipline (11 excuse/reality pairs) with ECC's 80% coverage target. Key contents:
- Write failing test first, then minimal code to pass, then refactor
- 11 excuse/reality pairs (e.g., "This is too simple for TDD" → "Simple bugs in simple code cause the most embarrassing production incidents")
- 80% line coverage target, 100% for auth/payment paths
- Vitest for unit/integration, Playwright for E2E
- Bug fixes start with failing regression test

**`systematic-debugging.md` (~30 lines)** — Already decided, DECISION-skills.md §3

4-phase systematic debugging with escalation. Key contents:
- Phase 1: Root cause investigation (read errors, trace execution, identify actual vs expected)
- Phase 2: Pattern analysis (is this a known pattern? check similar code, recent changes)
- Phase 3: Hypothesis testing (form hypothesis, predict outcome, test prediction)
- Phase 4: Implementation (fix root cause, not symptoms)
- Cross-reference: after 3 failed fixes, escalate per CLAUDE.md §Execution Discipline

**`available-skills.md` (~40 lines)** — Already decided, DECISION-skills-agents.md §2

Meta-instruction listing all skills and agents for CSO matching. Loaded at session start so Claude knows what capabilities exist. Key contents:
- 6 core workflow skills (brainstorming, writing-plans, SDD, code-review, deep-research, prompt-optimizer)
- 6 content/business skills
- 6 experimental skills
- 9 industry skills
- 8 agents with brief role descriptions
- 4 behavioral rules with location cross-references

**`git-workflow.md` (~20 lines)** — **New**

```yaml
---
description: >-
  Git branching, PR conventions, and merge strategy.
  Loaded every session — git operations happen in nearly all work.
---
```

Key contents:
- Branch naming: `feat/{slug}`, `fix/{slug}`, `chore/{slug}`, `research/{slug}` from `main`
- One branch per logical change — don't bundle unrelated work
- PR title: conventional prefix matching branch type, under 70 chars
- PR body: `## Summary` (1-3 bullets) + `## Test Plan` (checklist)
- Squash merge to main — clean linear history
- Delete branch after merge
- Feature branches: push frequently, `--force-with-lease` OK (not `--force`)
- Never push directly to main — always PR
- Tag releases: `v{major}.{minor}.{patch}`

#### typescript/ (path-scoped to frontend code)

**`react-vite.md` (~25 lines)** — **New**

```yaml
---
description: >-
  React 19 + Vite + ShadCN/UI patterns.
  Use when editing React components or frontend code.
paths:
  - "src/**/*.tsx"
  - "src/**/*.jsx"
  - "src/**/*.css"
---
```

Key contents:
- React 19: `use()` + `<Suspense>` for data fetching — no `useEffect` for data loading
- Mark client components with `"use client"` when server component boundary is relevant
- Component file structure: props interface → component function → named export
- ShadCN/UI: use components from `@/components/ui/` — don't rebuild what ShadCN provides
- TanStack Query for server state, React Context for UI state — never mix
- Form handling: React Hook Form + Zod schema validation
- Routing: React Router v7 (or TanStack Router) with lazy-loaded routes via `React.lazy` + `<Suspense>`
- Tailwind utility classes only — no CSS modules, no styled-components, no inline styles
- Custom hooks: prefix with `use`, extract to `hooks/` when reused across 2+ components
- No prop drilling beyond 2 levels — use Context or component composition

#### aws/ (path-scoped to backend/infra code)

**`aws-amplify.md` (~30 lines)** — **New**

```yaml
---
description: >-
  AWS Amplify Gen 2 + DynamoDB + Lambda + Cognito + API Gateway patterns.
  Use when editing backend, infrastructure, or API code.
paths:
  - "amplify/**"
  - "src/api/**"
  - "infra/**"
  - "**/lambda/**"
---
```

Key contents:
- Amplify Gen 2: `defineBackend`, `defineAuth`, `defineData`, `defineFunction` — not Gen 1 `amplify add`
- DynamoDB: single-table design — access patterns drive schema, not entity relationships
- DynamoDB: composite keys (`pk`/`sk`), GSI for secondary access patterns, no table scans
- DynamoDB: `DynamoDBDocumentClient` with typed helper functions for get/put/query/update
- Lambda: handler is a thin wrapper calling domain logic — no business logic in handler file
- Lambda: structured JSON logging with correlation ID from API Gateway request context
- Lambda: minimize cold starts — lazy-load heavy dependencies, keep handler module lean
- Cognito: user pool for authentication, identity pool for AWS credential vending
- Cognito: JWT validation in API Gateway Lambda authorizer — not in each Lambda handler
- API Gateway: request/response validation via JSON Schema models
- API Gateway: CORS configured at API level, not per-Lambda
- Error handling: domain exceptions → HTTP status code mapping in handler layer
- IAM: least privilege — specific resource ARNs, never `Resource: "*"`

### Discipline Rules Landing in rules/

All discipline patterns from Decision 9 that landed in `.claude/rules/` were already placed by Sprint 3 decisions. No new discipline patterns created rules/ files.

| Pattern | Rules File | Decided In |
|---------|-----------|-----------|
| TDD red-green-refactor + rationalization prevention | `tdd.md` | DECISION-skills.md §2 |
| Systematic debugging 4-phase + escalation | `systematic-debugging.md` | DECISION-skills.md §3 |
| Skill-check meta-rule | `available-skills.md` | DECISION-skills-agents.md §2 |

The 3 new discipline placements (#6 scope creep, #7 deviation rules, #8 STATE.md digest) all went to CLAUDE.md — they're each 1 line, universal, and don't warrant standalone files.

The 3 new rules files (`git-workflow.md`, `react-vite.md`, `aws-amplify.md`) are domain-specific conventions, not discipline patterns. They provide detailed stack guidance that's too long for CLAUDE.md but essential for code quality in their respective domains.

---

## Always-Loaded Token Budget

| Layer | Files | Lines | Notes |
|-------|-------|-------|-------|
| CLAUDE.md | 1 | ~90 | Universal rules, stack, identity, pointers |
| Always-on rules | 4 | ~130 | tdd, systematic-debugging, available-skills, git-workflow |
| **Total always-loaded** | **5** | **~220** | Loaded every session, every interaction |
| Path-scoped rules | 4 | ~120 | e2e-testing, mcp-server-patterns, react-vite, aws-amplify |
| **Max loaded (all paths active)** | **9** | **~340** | Theoretical max if editing frontend + backend + tests + MCP simultaneously |

Compare: Sprint 3 estimated ~200 lines always-loaded. We're at ~220 — the 20-line increase is `git-workflow.md`, which earns its cost because git operations happen in nearly every session.

---

## Dependency Map

```
DECISION-conventions.md (Sprint 3)
  ├── Escalation protocol text ─────────► CLAUDE.md §Agent Escalation Protocol
  ├── Execution Discipline text ────────► CLAUDE.md §Execution Discipline (+ 2 new lines from this doc)
  └── CSO convention ───────────────────► All rules/ and skills/ frontmatter

DECISION-skills.md (Sprint 3)
  ├── Verification absorption ──────────► CLAUDE.md §Verification
  ├── Search-first absorption ──────────► CLAUDE.md §Search First
  └── 4 rules files spec ──────────────► tdd.md, systematic-debugging.md, e2e-testing.md, mcp-server-patterns.md

DECISION-skills-agents.md (Sprint 3)
  └── available-skills.md spec ─────────► .claude/rules/available-skills.md

DECISION-hooks.md (Sprint 2)
  └── Hook enforcement ─────────────────► 17 patterns enforced mechanically (no CLAUDE.md duplication needed)

This document (DECISION-discipline)
  ├── 3 new CLAUDE.md lines ────────────► Execution Discipline + Workflow sections
  ├── 3 new rules files ────────────────► git-workflow.md, react-vite.md, aws-amplify.md
  ├── CLAUDE.md line budget ────────────► Next: actual CLAUDE.md file creation (Sprint 5)
  └── Config hierarchy ─────────────────► Governs all future "where does X go?" decisions
```
