# iaGO-OS

3-person AI consultancy (CEO Windows, CTO Mac).
Claude Code config layer for multi-client delivery.
Stack fixed — no alternatives unless asked.

## Prerequisites

- **macOS:** `brew install coreutils` — pipeline requires `timeout` or `gtimeout` on PATH (`scripts/execute-pipeline.sh` hard-fails otherwise)
- `gsort` — installed via `brew install coreutils` (macOS only); `scripts/execute-pipeline.sh` uses `sort -V` (GNU version sort) for codex-companion plugin cache lookup, with `-r` BSD fallback if GNU sort is absent

## Tech Stack

- **Frontend:** React 19 + Vite + TypeScript (strict) + TailwindCSS 4 + ShadCN/UI + Framer Motion + GSAP/ScrollTrigger + Lenis
- **Backend:** AWS Amplify Gen 2 + Lambda (Node.js 20) + API Gateway + DynamoDB + Cognito + SES
- **Agents:** Claude SDK (Anthropic) + LangGraph + n8n
- **Testing:** Vitest (unit/integration), Playwright (E2E)
- **Tooling:** Biome (formatter + linter) — never Prettier, ESLint, gofmt
- **Infra:** AWS Amplify Gen 2 (manages all AWS resources), GitHub Actions CI/CD

## Code Standards

- TypeScript strict — no `any`, no `as` casts (except type guards), no `@ts-ignore`
- Named exports only — no default exports
- Functional components only — no class components
- `use()` + `<Suspense>` for data fetching — no useEffect for data
- Error boundaries for component-level errors
- Colocation: component + test + styles same directory
- Naming: kebab-case files, PascalCase components, camelCase utilities
- Barrel files (`index.ts`) only at public API boundaries
- Imports: external first, then internal with `@/` aliases
- ShadCN/UI + TailwindCSS 4: verify setup against official ShadCN docs — Vite differs from Next.js

## Architecture

- **AWS mandatory for all backend.** No CF templates, no raw CDK, no serverless framework. Amplify Gen 2 only: `defineBackend`, `defineAuth`, `defineData`, `defineFunction`. Amplify manages CF under hood — never create CF directly.
- DynamoDB — evaluate single-table vs multi-table per project. Access patterns drive schema, not entity relationships
- Lambda: thin handlers calling domain logic modules
- Cognito JWT validation in API Gateway authorizer, not Lambda handlers
- TanStack Query for server state, React Context for UI state only
- Feature folders: `src/features/{name}/` with components, hooks, api, types
- No ORMs — DynamoDB DocumentClient with typed helpers
- Forms: React Hook Form + Zod validation

## Workflow

Phases: init → discuss → plan (+ stress) → execute → verify. See `/iago-*` skills.
Plan modes: `/iago-plan {slug}` (ROADMAP phase) | `/iago-plan --feature "desc"` or `--feature file.md/.pdf` (standalone feature).
Quick: `/iago-fast` (trivial, ≤3 files) | `/iago-quick` (1-3 tasks, composable flags).
Artifacts: `.iago/plans/`, `.iago/context/`, `.iago/summaries/`, `.iago/reviews/`.
STATE.md digest — keep under 80 lines. Overflow to PROJECT.md.
Pause: `/iago-pause`. Resume automatic on next session.

## Execution Path

**NEVER implement plan/spec/task by editing code directly.** All implementation goes through matching skill:

| Scope | Skill | Review |
|-------|-------|--------|
| ROADMAP phase (1+ plans) | `/iago-execute {slug}` | Full 8-stage pipeline |
| Standalone plan (1-3 tasks) | `/iago-quick {desc}` | Full 8-stage pipeline |
| Multi-task plan (outside ROADMAP) | `/subagent-driven-development` | Full 8-stage pipeline |
| Trivial fix (≤3 files, obvious) | `/iago-fast {desc}` | Build gate only |

User says "execute plan X" or "implement this" → invoke matching skill. Not read files. Not create tasks. Invoke skill.

### execute vs quick

Both run `scripts/execute-pipeline.sh` with full review pipeline. Difference is scope:

- **`/iago-execute {phase-slug}`** — all plans in ROADMAP phase. Plans exist from `/iago-plan`. Supports wave grouping + parallel dispatch.
- **`/iago-quick {description}`** — creates lightweight plan on fly (max 3 tasks), runs pipeline on single plan. No ROADMAP needed.

## Review Pipeline

Built into `scripts/execute-pipeline.sh`. Each step = separate `claude -p` session:

0. **Stress test** — adversarial review of the plan itself (opus); skipped if plan has `## Stress Test` section; BLOCK stops pipeline, PROCEED_WITH_NOTES forwards concerns to impl session
1. **Implement** — reads plan + stress-test notes (if any), writes code
2. **Build gate** — `tsc --noEmit && vite build` (max 2 retries)
3. **Review** — three-pass: plan compliance + domain routing + adversarial; all check modules loaded, reviewer selects relevant domains; severity floors enforced; fix all findings locally (Critical→Important→Minor)
4. **Codex adversarial** — reads plan + diff; checks auth, data loss, races, rollback safety
4b. **Codex fix** — opus fixes all Codex findings + rebuild (skipped if no findings)
5. **Create PR** — stages, commits, pushes, creates PR via `gh`
5b. **Tag @claude** — sonnet synthesizes context-rich review request (plan + diff → domains, focus areas, edge cases), posts on PR
6. **Summary** — writes results to `.iago/summaries/`

Async review-fix loop via GitHub Actions: `claude.yml` reviews, `claude-review-fix.yml` fixes + re-tags (max 5 rounds). Priority: Critical → Important → Minor. Summary posted when clean.

**Control flags:** Both `/iago-execute` and `/iago-quick` auto-tag @claude by default (suppress with `--no-review` or `--no-tag` respectively). Manual trigger: `/iago-prfix`. Details in `.claude/rules/execution-pipeline.md`.

**Terminology:** "review" in `/iago-execute` and `/iago-quick` flags means the **GitHub PR workflow** — tagging @claude on the PR to trigger the async review-fix loop via GitHub Actions. It does NOT mean the local multi-step review pipeline (steps 3-4b), which always runs regardless of flags.

**Skip:** Only via `/iago-fast` (build gate only).

## Memory Architecture

Six layers, each with distinct purpose and access pattern:

| Layer | What | Access | Automation |
|-------|------|--------|------------|
| **MEMORY.md** | User prefs, feedback, project context | Always-loaded in context | Manual (Claude writes) |
| **Obsidian** | Session digests, meetings, decisions, business docs | MCP (`search_notes`, `read_note`, `write_note`) | Semi-auto (session digests) |
| **Graphify** | Knowledge graph + wiki over vault (incl. Drive) | MCP (`query_graph`, `get_node`) + `graphify-out/wiki/` | Auto (nightly rebuild via Task Scheduler) |
| **MemPalace** | Conversation history, agent diary | MCP (`mempalace_search`, `mempalace_diary_read`) | Auto (stop hook writes diary every session) |
| **MarkItDown** | Upstream document conversion (DOCX/PPTX/XLSX/EPub/YouTube/large PDFs → markdown) | MCP (`convert_to_markdown`) | Manual (producer, not storage) |
| **SQLite** | Agent session state + cost ledger + event/replay dedupe | Direct DB queries (`/var/lib/iago-os/state/ledger.sqlite`) | Auto (daemon writes; schema ships in Phase 3) |

### Retrieval Routing

| Need | Tool |
|------|------|
| Structured notes, decisions, meetings | Obsidian MCP |
| Entity relationships, community structure | Graphify MCP (`query_graph`, `get_node`) or `graphify-out/wiki/index.md` |
| Past conversation recall, reasoning trails | MemPalace (`mempalace_search`) |
| Cross-session agent continuity | MemPalace diary (`mempalace_diary_read`) |
| Library/framework docs | Context7 (`query-docs`) |
| Document ingestion (DOCX, XLSX, large PDFs) | MarkItDown MCP (`convert_to_markdown`) |

### MemPalace Wings

13.5K drawers across 7 wings: `iago_os`, `munet`, `din`, `sentria`, `installflow`, `santiago`, `business`. Stop hook auto-writes diary entries. Bulk backfill: `mempalace mine ~/.claude/projects/{dir}/ --mode convos --wing {name}`.

### Frozen-snapshot rule

**MEMORY.md is a frozen snapshot.** Loaded into context at session start by Claude Code, including `claude -p` sessions (auto-loaded by default; only `claude --bare` skips it). Mid-session: do not grep, Read, or open the file at `~/.claude/projects/{project-slug}/memory/MEMORY.md` — content is already present in your context. Mutations (Write to add new entries) persist for next session, do not reflect in current context.

**Permitted exceptions:**
- **Read-after-Write to verify persistence** — after writing a new memory entry, you may Read to confirm the write succeeded. The prohibition is on grepping to retrieve already-injected content, not on verifying write side effects.
- **Skills explicitly designed to reference cross-session preferences** (e.g., `/council`, which reads `~/.claude/projects/*/memory/` to ground multi-advisor decisions). Such skills must include an inline comment explaining the exception.

Implementation, fix, and review sessions must follow this rule unconditionally. Preserves prefix-cache and avoids redundant reads.

## Learnings

`.iago/learnings/` accumulates review patterns. 5+ occurrences → candidate for CLAUDE.md promotion.

## Verification

Never claim done without running verification and reading output.
"Tests pass" = ran them, saw green. "Build succeeds" = ran it, saw exit 0.
Demonstrate outcomes, don't assert them.

## Search First

Search codebase before creating any new file/component/utility. Duplication is bug.

## Agent Escalation Protocol

Every subagent ends with exactly one status:

- **DONE** — requirements verified with evidence
- **DONE_WITH_CONCERNS** — requirements met, minor issues listed
- **NEEDS_CONTEXT** — state exactly what info missing
- **BLOCKED** — state external blocker; no retry without resolving

## Execution Discipline

7+ consecutive Read/Grep/Glob without Edit/Write/Bash: STOP. State findings, ask to continue or start writing. Exception: research/analysis tasks may read freely but must produce artifact before DONE.

3 failed fixes same issue: STOP. Report pattern, escalate. No 4th attempt without new info.

During execution: only what plan specifies. New ideas → deferred. Auto-fix bugs, missing imports, blockers. ASK before architectural changes.

## Rules

Detailed rules in `.claude/rules/`:
- `execution-pipeline.md` — **MANDATORY** review pipeline (plan+adversarial, codex, codex fix), build gates, no-skip
- `tdd.md` — RED-GREEN-REFACTOR, rationalization prevention, 80% coverage
- `systematic-debugging.md` — 4-phase debugging, 3-fix escalation
- `git-workflow.md` — branching, PRs, merge strategy
- `available-skills.md` — full skill + agent catalog
- `react-vite.md` — React 19 + Vite patterns *(path-scoped: `src/**/*.tsx`)*
- `aws-amplify.md` — Amplify Gen 2 + DynamoDB + Lambda *(path-scoped: `amplify/**`)*
- `e2e-testing.md` — Playwright conventions *(path-scoped: test files)*
- `mcp-server-patterns.md` — MCP Node/TS SDK *(path-scoped: MCP files)*

## Skills

Core: `/brainstorming`, `/writing-plans`, `/subagent-driven-development`, `/code-review`, `/deep-research`, `/prompt-optimizer`.
Workflow: `/iago-init`, `/iago-discuss`, `/iago-plan`, `/iago-stress`, `/iago-execute`, `/iago-verify`, `/iago-fast`, `/iago-quick`, `/iago-pause`.
Post-review: `/iago-prfix` — fix PR review comments, push, re-review.
Proprietary: `/iago-scaffold`, `/iago-proposal`, `/iago-onboard`, `/iago-n8n`, `/iago-agents`.
Audit (on-demand deep sweeps, not per-plan): `/amplify-bug-bounty`, `/frontend-bug-bounty` — full ~200-rule audits for pre-launch hardening, post-incident, periodic. Highest-leverage rules from both already run on every plan via `scripts/review-checks/data-integrity.md` and `scripts/review-checks/amplify.md`. Shell + deploy hazards (remote ssh pipefail, secret-file mode races, systemctl state guards, log-pattern coverage) run via `scripts/review-checks/shell-deploy.md` and trigger when the diff touches `**/deploy/**`, `**/*.sh`, or systemd unit files.
Full catalog: `.claude/rules/available-skills.md`.

## Agents

3 bases, 13 capabilities, 12 profiles in `.claude/agents/`. Bases: executor (write), analyst (read-only), operator (external data). Profiles compose base + capabilities per task. Hub-and-spoke: only orchestrator dispatches — agents never spawn agents.

## Output Style (orchestrator sessions)

Terse by default. All technical substance stays. Only fluff dies.

Drop: articles (a/an/the), filler (just/really/basically/simply), pleasantries
(sure/certainly/of course), hedging. Fragments OK. Short synonyms preferred.
Technical terms exact. Code blocks unchanged. Errors quoted exact.

Pattern: [thing] [action] [reason]. [next step].

Not: "Sure! I'd be happy to help. The issue is likely caused by..."
Yes: "Bug in auth middleware. Token expiry check uses < not <=. Fix:"

Restore full prose for: security warnings, irreversible actions, multi-step
sequences where fragments risk misread, user confused.

Pipeline agents excluded — they use plan-spec output format, not caveman.

## Model Routing

- **Opus:** Orchestrator + all code-writing sessions (impl, fix, debug)
- **Sonnet:** PR creation, @claude tag synthesis, Codex fallback, mechanical analysis
- **Codex (GPT-5.5):** Cross-model adversarial review, `/codex:rescue` — model pinned in `~/.codex/config.toml` (each operator must create their own; no machine-level default in repo)

Pipeline: opus for impl/fix/review. Sonnet for PR creation + @claude tags + Codex fallback. Orchestrator uses opus for code-writing agent dispatches. Analyst profiles use sonnet unless security-critical.
