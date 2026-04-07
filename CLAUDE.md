# iaGO-OS

3-person AI consultancy (CEO on Windows, CTO on Mac).
Claude Code configuration layer for multi-client project delivery.
Stack is fixed — do not suggest alternatives unless explicitly asked.

## Tech Stack

- **Frontend:** React 19 + Vite + TypeScript (strict) + TailwindCSS 4 + ShadCN/UI + Framer Motion + GSAP/ScrollTrigger + Lenis
- **Backend:** AWS Amplify Gen 2 + Lambda (Node.js 20) + API Gateway + DynamoDB + Cognito + SES
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
- ShadCN/UI + TailwindCSS 4: always verify setup against official ShadCN docs — Vite setup differs from Next.js

## Architecture

- DynamoDB — evaluate single-table vs multi-table per project (see dynamodb capability for decision criteria). Access patterns drive schema, not entity relationships
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

## Mandatory Execution Path (BLOCKING)

**NEVER implement a plan, spec, or task by directly editing code.** All implementation
MUST go through the execution skill that matches the scope:

| Scope | Skill | Review pipeline |
|-------|-------|-----------------|
| ROADMAP phase (1+ plans) | `/iago:execute {slug}` | Full 3-stage |
| Standalone plan (1-3 tasks) | `/iago:quick {desc}` | Full 3-stage |
| Multi-task plan (outside ROADMAP) | `/subagent-driven-development` | Full 3-stage |
| Trivial fix (≤3 files, obvious) | `/iago:fast {desc}` | Build gate only |

**You MUST invoke the Skill tool to load the skill.** Reading the plan file and
implementing it yourself is a critical workflow violation — even if you "know" what
to do. The skill orchestrates agent dispatch, build gates, and the review pipeline.
Without it, reviews are skipped and bugs ship.

If the user says "execute plan X" or "implement this", your FIRST action is to invoke
the matching skill via the Skill tool. Not read files. Not create tasks. Invoke the skill.

## Mandatory Review Pipeline (3-stage, non-negotiable)

Every plan that produces code changes MUST pass all 3 stages before a PR is created.
No exceptions. No "I'll review later." No skipping stages because the build passes.

**Stage 1 — Spec review:** `review-full` profile checks implementation matches the plan.
**Stage 2 — Quality review:** Same profile checks performance, security, maintainability.
**Stage 3 — Cross-model:** `/codex:adversarial-review` sends diff to GPT-5.4 for auth,
data-loss, race-condition, and business-logic review. A different model catches different
blind spots.

The pipeline also requires:
- **Build gate before review:** `npm run type-check && npm run build` must pass.
- **Critical findings → fix → re-review:** Max 2 fix rounds, then escalate.
- **Summary artifact:** `.iago/summaries/{plan}.md` written after pipeline completes.
- **Learnings extraction:** Review patterns logged to `.iago/learnings/patterns.md`.

See `.claude/rules/execution-pipeline.md` for the full pipeline specification.

## Learnings

`.iago/learnings/` accumulates review patterns and project conventions, injected into agent context before each dispatch. Patterns at 5+ occurrences are candidates for promotion to CLAUDE.md.

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
- `execution-pipeline.md` — **MANDATORY** 3-stage review pipeline, build gates, no-skip policy
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
Proprietary: `/iago:scaffold`, `/iago:proposal`, `/iago:onboard`, `/iago:n8n`, `/iago:agents`.
See `.claude/rules/available-skills.md` for the complete catalog including content, experimental, and industry skills.

## Agents

3 base agents, 13 capability modules, and 12 profiles in `.claude/agents/`. Bases: executor (write), analyst (read-only), operator (external data). Profiles compose base + capabilities per task. Hub-and-spoke: only the orchestrator dispatches — agents never spawn agents.

## Model Routing

- **Opus:** Orchestrator (main session) — planning, architecture, multi-file reasoning
- **Sonnet:** Default for all profiles — implementation, review, research, debugging, testing
- **Haiku:** Reserve for mechanical tasks (formatting, simple lookups) when needed
- **Codex (GPT-5.4):** Mandatory cross-model adversarial review on every plan (`/codex:adversarial-review`), plus `/codex:review` and `/codex:rescue`

Model selection per dispatch: profiles specify `model: auto | sonnet | opus`. Auto routing: 4+ files → opus, auth/payment → opus, retry → upgrade. Configurable in `.iago/config.json` routing section.
