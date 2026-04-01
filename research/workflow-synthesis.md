# Workflow & State Pattern Synthesis

> Extracted from: gsd-analysis.md, superpowers.md, the-architect.md
> Date: 2026-04-01

---

## 1. Workflow Phase Patterns

### GSD Phases

| Phase | Command | What It Does | Input | Output | Gate | Driver |
|-------|---------|-------------|-------|--------|------|--------|
| **new-project** | `/gsd:new-project` | Questions -> 4x parallel researchers -> synthesizer -> requirements -> roadmapper -> user approval -> STATE.md init | User answers to project questions | PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, config.json, research/SUMMARY.md | `project_exists` check blocks re-init | Orchestrator + 4x parallel `gsd-project-researcher` + `gsd-roadmapper` |
| **discuss** | `/gsd:discuss-phase` | Identify gray areas (domain-aware heuristics), let user choose which to discuss, deep-dive each, produce CONTEXT.md. User = visionary, Claude = builder. Scope is FIXED from ROADMAP.md — clarifies HOW, never adds new capabilities. Loads prior CONTEXT.md to avoid re-asking. | ROADMAP.md (phase goals), prior CONTEXT.md files, lightweight codebase grep (~10% context) | `XX-CONTEXT.md` with XML sections: `<domain>`, `<decisions>`, `<canonical_refs>`, `<specifics>`, `<deferred>` | Soft gate: `plan-phase` warns if no CONTEXT.md, offers to run discuss first | Main session (no subagent) |
| **ui** | `/gsd:ui-phase` | Design contract for frontend phases, produces UI-SPEC.md | CONTEXT.md, ROADMAP.md | `XX-UI-SPEC.md` | Optional — executor reads UI-SPEC.md if present | Main session |
| **plan** | `/gsd:plan-phase` | Research (optional) -> Planner -> Plan-Checker loop (max 3 iterations) -> PLAN.md files. Plans have YAML frontmatter with wave/dependency metadata, must_haves (truths, artifacts, key_links), task-level files/action/verify/done fields. Plan-checker enforces 8 verification dimensions. | CONTEXT.md, RESEARCH.md (optional), REQUIREMENTS.md, STATE.md, ROADMAP.md | `XX-RESEARCH.md` (optional), `XX-YY-PLAN.md` (one per plan) | Plan-checker blocks proceed if plans fail 8-dimension verification (max 3 correction iterations) | `gsd-phase-researcher` + `gsd-planner` + `gsd-plan-checker` |
| **execute** | `/gsd:execute-phase` | Wave analysis -> parallel/sequential executor spawning -> atomic commits -> SUMMARY.md per plan -> regression gate -> verification. Plans grouped into dependency waves. Within waves, agents run in parallel (worktree isolation). Orchestrator stays at ~10-15% context. | PLAN.md files, PROJECT.md, STATE.md, config.json, CLAUDE.md | `XX-YY-SUMMARY.md` per plan (with YAML frontmatter: dependency graph, tech-stack, key-files, metrics), atomic git commits per task | SUMMARY.md existence gates completion. 5+ consecutive read-only calls = analysis paralysis stop. 3 auto-fix attempts max per task. | `gsd-executor` (one per plan, fresh context, worktree isolation) |
| **verify** | `/gsd:verify-work` | Goal-backward verification: truths -> artifacts (3-level check) -> wiring -> requirements coverage -> anti-pattern scan -> VERIFICATION.md. Status determines routing. | Phase goal from ROADMAP.md, PLAN.md files (for must_haves), SUMMARY.md files | `XX-VERIFICATION.md` with status frontmatter | `passed` -> done; `gaps_found` -> gap closure cycle (re-plan + re-execute gaps); `human_needed` -> UAT | `gsd-verifier` |
| **ship** | `/gsd:ship` | Create PR from phase branch | Phase branch, completed verification | Pull request | Requires branching_strategy to be set | Main session |
| **transition** | (internal only) | Mark phase complete, evolve PROJECT.md, advance STATE.md, route to next phase. Never exposed as a command. | SUMMARY.md files, VERIFICATION.md status | Updated STATE.md, evolved PROJECT.md | Triggered by execute-phase auto-advance or manually | Internal orchestrator logic |

**Phase ordering enforcement:** Not hard-blocked by code. Layered via: (1) soft gates with AskUserQuestion prompts, (2) artifact dependency (each phase produces what the next consumes), (3) init validation via `gsd-tools.cjs`, (4) auto-advance chain with `--auto` flag propagating `workflow._auto_chain_active`.

**Quick task bypass tiers:**
- `/gsd:fast` — Inline trivial tasks: <= 3 file edits, <= 1 minute, no new deps. No subagent, no PLAN.md. Atomic commit + STATE.md log.
- `/gsd:quick` — Lightweight planned: single plan, 1-3 tasks, ~30-40% context budget. Composable flags: `--discuss`, `--research`, `--full` (adds plan-checking + verification).
- `/gsd:do` — Intent-based dispatcher: parses freeform text, routes to best GSD command. Never does work itself.

---

### Superpowers Phases

| Phase | What It Does | Input | Output | Gate | Driver |
|-------|-------------|-------|--------|------|--------|
| **1. Brainstorming** | Explores context, asks one question at a time, proposes 2-3 approaches with recommendation, presents design in digestible sections. YAGNI principles enforced. | User's creative request, existing codebase context | `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (design spec) | Self-review checklist run. User approval required before proceeding. | Main session (skill: `brainstorming/SKILL.md`) |
| **2. Git Worktree Setup** | Creates isolated workspace on new branch, auto-detects project type, runs setup, verifies clean test baseline | Approved spec, git repository | New git worktree on feature branch, verified clean test state | Must have approved spec from Phase 1. Test baseline must pass. | Main session (skill: `using-git-worktrees/SKILL.md`) |
| **3. Writing Plans** | Breaks spec into 2-5 minute tasks with exact file paths, complete code, test commands, expected output. No placeholders allowed ("TBD", "TODO", "implement later", "similar to Task N" are explicit failures). | Approved design spec | `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md` (implementation plan with checkbox tasks) | Self-review checklist: spec coverage, placeholder scan, type consistency. Must have approved spec. | Main session (skill: `writing-plans/SKILL.md`) |
| **4a. Subagent-Driven Dev** (recommended) | Fresh subagent per task. Two-stage review: spec compliance THEN code quality (quality review only after spec passes). Implementer can report DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED. Review loops until approved. | Implementation plan, task context | Committed code per task, review results (ephemeral — not persisted to disk) | Each task passes two-stage review before next begins. BLOCKED/NEEDS_CONTEXT triggers controller intervention. | Implementer subagent + spec-reviewer subagent + code-quality-reviewer subagent (fresh context each) |
| **4b. Executing Plans** (fallback) | Load plan, review critically, execute in batches with human checkpoints. For environments without subagent support. | Implementation plan | Committed code | Human checkpoints between batches | Main session (skill: `executing-plans/SKILL.md`) |
| **5. Code Review** | Dispatch code-reviewer agent with git SHA range. Structured output: Critical / Important / Minor severity categories. | Git SHA range of changes, review template | Structured review (subagent response, not persisted) | Fix-before-proceeding gate on Critical issues | `code-reviewer` agent |
| **6. Finishing Branch** | Verify tests pass. Present 4 options: merge / PR / keep branch / discard. Cleanup worktree. | Completed and reviewed code on feature branch | Merged code or PR or preserved branch | Tests must pass before options presented | Main session (skill: `finishing-a-development-branch/SKILL.md`) |

**Cross-cutting disciplines (always active):**

| Discipline | What It Does | Trigger | Source |
|-----------|-------------|---------|--------|
| **TDD** | RED-GREEN-REFACTOR iron law. No production code without failing test first. Delete code written before tests. Minimal code to pass. Mocks only when unavoidable. Bug fixes start with failing regression test. | During any implementation | `skills/test-driven-development/SKILL.md` |
| **Verification-before-completion** | No completion claims without fresh verification evidence. Run command, read output, THEN claim result. Prevents #1 agent failure: claiming success without evidence. | Before any success claim | `skills/verification-before-completion/SKILL.md` |
| **Systematic debugging** | 4-phase process: root cause investigation, pattern analysis, hypothesis testing, implementation. 3+ failed fixes = stop fixing, question the architecture. | Any bug or failure | `skills/systematic-debugging/SKILL.md` |

**Enforcement mechanism:** Purely prompt-based (LLM honor system). Skills contain extensive rationalization prevention: excuse/reality tables, red flags lists, "violating the letter is violating the spirit" framing. No hooks, no code guards.

---

### The Architect Phases

| Phase | What It Does | Input | Output | Gate | Driver |
|-------|-------------|-------|--------|------|--------|
| **1. Discovery** | Ask 2-3 questions: vision, audience, stage, tech preferences. Classify into 1 of 6 archetypes (SaaS, marketing, mobile, API/backend, internal tool, content platform) using signal keywords. Handle hybrids (primary + secondary archetype). | User's project description | Archetype classification. Loaded archetype knowledge file (`knowledge/archetypes/<type>.md`). | Must complete before Phase 2. Fast-track option: 3 essential questions + smart defaults. | Main session (single agent, conversational) |
| **2. Deep Dive** | Load archetype-specific question set (3-5 targeted questions). Load relevant building-block files as decisions arise (auth -> `auth-patterns.md`, database -> `database-patterns.md`, etc.). Use `/deep-research` for unfamiliar tech comparisons. | Archetype classification, user answers, building-block reference files | Accumulated design decisions, loaded context from knowledge library | Must complete archetype-specific questions | Main session with on-demand knowledge file loading |
| **3. Architecture** | Present full proposed stack in compact table with rationale. Present high-level architecture, core features, rough build phases. All in ONE message, under 40 lines, dense and scannable. Get user confirmation — max 2 iterations before asking about sticking points. | All accumulated decisions from Phase 1-2 | Architecture confirmation from user | User sign-off required. Max 2 iteration attempts. | Main session |
| **4. Generate** | Read blueprint template + CLAUDE.md template + skills registry. Compose and write complete blueprint. Present summary with file path. | Confirmed architecture, `templates/blueprint-template.md`, `templates/claude-md-template.md`, `knowledge/skills-registry.md` | `output/<project-name>-blueprint.md` (16-section blueprint), including Section 15: complete CLAUDE.md for target project | Phases 1-3 must be complete. CLAUDE.md rule #1: "NEVER generate the blueprint before completing Phases 1-3." | Main session |

**16-section blueprint output:**
1. Project Overview — 2. Tech Stack — 3. Directory Structure — 4. Data Model — 5. API Design — 6. Frontend Architecture — 7. Design System — 8. Auth & Authorization — **9. Build Order (most critical)** — 10. Environment Setup — 11. Dependencies — 12. Deployment Strategy — 13. Testing Strategy — 14. Skills to Use — **15. CLAUDE.md for Target Project** — 16. Non-Negotiable Rules

**Enforcement mechanism:** Prompt-based only. CLAUDE.md rule #1 is the only gate. No hooks, no code guards. Single-agent, single-session.

**Conversation style rules:** Confident architect reviewing a client brief. Lead with recommendations, not option lists. "Here's what I'd build" framing. Max 3 questions per message. Match user's energy. Keep messages concise with tables and bullets.

---

### Our Original Vision (iaGO-OS)

| Phase | What It Does |
|-------|-------------|
| **init** | Bootstrap `.iago/` directory structure for a new project. Create STATE.md, PROJECT.md, ROADMAP.md. Load or generate initial configuration. Inject meta-instruction establishing iaGO skill/command system for the session. |
| **discuss** | Requirements gathering and clarification. Surface gray areas and decisions the user cares about. Produce structured CONTEXT.md. Scope guardrails: clarify HOW within agreed scope, never expand WHAT. |
| **plan** | Break requirements into implementation plans with granular tasks. Verification loop before execution. Plans declare dependencies for wave-based execution. No placeholders. |
| **execute** | Fresh-context subagent per task. Atomic commits. Escalation protocol (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED). Two-stage review (spec compliance then quality). Wave-based parallelism for independent tasks. |
| **verify** | Goal-backward verification: does the implementation actually achieve the stated goal? Three-level check (truths -> artifacts -> wiring). No completion claims without fresh evidence. Status routing: passed -> done, gaps -> re-plan, human_needed -> UAT. |

---

## 2. State Directory Patterns

### GSD `.planning/` Directory

| File | Purpose | Format | Created By | Read By | Size Constraint |
|------|---------|--------|-----------|---------|----------------|
| `PROJECT.md` | Vision, constraints, decisions, evolution rules | Markdown | `new-project` | All agents | None specified |
| `REQUIREMENTS.md` | Scoped requirements (v1/v2/out-of-scope), traceability table | Markdown with checkbox lists | `new-project` | Planner, Verifier, Auditor | None specified |
| `ROADMAP.md` | Phase breakdown, goals, success criteria, progress tracking | Markdown with phase table | `new-project` via `gsd-roadmapper` | Orchestrators (phase goals, progress) | None specified |
| `STATE.md` | Living memory: position, decisions, blockers, metrics, session continuity | Markdown | `new-project`, updated by every workflow | All agents (position, decisions, blockers) | **< 100 lines.** "It's a DIGEST, not an archive." Keep only 3-5 recent decisions, only active blockers, remove resolved ones. Full log in PROJECT.md. |
| `config.json` | Workflow config: mode, granularity, gates, parallelization, hooks, agent skills. "Absent = enabled" defaults. | JSON | `new-project` settings step | All workflows (feature flags, model profiles) | 44+ options across mode, granularity, workflow, planning, parallelization, gates, safety, hooks, agent_skills |
| `MILESTONES.md` | Archive of completed milestones | Markdown | `complete-milestone` | Progress reporting | None specified |
| `HANDOFF.json` | Machine-readable pause state: phase, plan, task numbers, completed tasks with commit hashes, remaining tasks, blockers, human actions pending, decisions, uncommitted files, next action | JSON | `pause-work` | `resume-work` | None specified |
| `.continue-here.md` | Human-readable pause state with XML sections: `<current_state>`, `<completed_work>`, `<remaining_work>`, `<decisions_made>`, `<blockers>`, `<context>`, `<next_action>` | Markdown (per phase) | `pause-work` | Humans, `resume-work` | **Deleted after resume** — transient |
| `research/SUMMARY.md` | Synthesized research output | Markdown | `gsd-research-synthesizer` | Planner | None specified |
| `research/STACK.md` | Stack analysis | Markdown | `gsd-project-researcher` | Synthesizer | None specified |
| `research/FEATURES.md` | Feature analysis | Markdown | `gsd-project-researcher` | Synthesizer | None specified |
| `research/ARCHITECTURE.md` | Architecture analysis | Markdown | `gsd-project-researcher` | Synthesizer | None specified |
| `research/PITFALLS.md` | Pitfall analysis | Markdown | `gsd-project-researcher` | Synthesizer | None specified |
| `codebase/STACK.md`, `ARCHITECTURE.md`, `CONVENTIONS.md`, `CONCERNS.md`, `STRUCTURE.md`, `TESTING.md`, `INTEGRATIONS.md` | Codebase map artifacts | Markdown | `map-codebase` via 4x parallel `gsd-codebase-mapper` | Planner, Researcher | None specified |
| `phases/XX-name/XX-CONTEXT.md` | User decisions per phase | Markdown with XML sections (`<domain>`, `<decisions>`, `<canonical_refs>`, `<specifics>`, `<deferred>`) | `discuss-phase` | Researcher, Planner, Executor | None specified |
| `phases/XX-name/XX-RESEARCH.md` | Phase-specific research | Markdown | `plan-phase` researcher | Planner, Plan Checker | None specified |
| `phases/XX-name/XX-YY-PLAN.md` | Implementation plan per plan | Markdown with YAML frontmatter (phase, plan, type, wave, depends_on, autonomous, requirements, must_haves: truths/artifacts/key_links). Task-level: files, action, verify, done. | `plan-phase` planner | Executor, Plan Checker, Verifier | None specified |
| `phases/XX-name/XX-YY-SUMMARY.md` | Execution summary per plan | Markdown with YAML frontmatter (dependency graph, tech-stack, key-files, metrics) | Executor | Verifier, Transition, STATE.md updates | None specified |
| `phases/XX-name/XX-VERIFICATION.md` | Verification report with status | Markdown with status frontmatter (`passed` / `gaps_found` / `human_needed`) | Verifier | Gap closure cycle, Transition | None specified |
| `phases/XX-name/XX-UI-SPEC.md` | UI design contract | Markdown | `ui-phase` | Executor, UI Auditor | None specified |
| `phases/XX-name/XX-UI-REVIEW.md` | UI review results | Markdown | `ui-review` | Executor | None specified |
| `phases/XX-name/XX-UAT.md` | User acceptance test | Markdown with YAML frontmatter | `verify-work` / execute-phase | Human tester | None specified |
| `phases/XX-name/.continue-here.md` | Phase-level pause state | Markdown | `pause-work` | `resume-work` | Transient — deleted after resume |
| `quick/YYMMDD-xxx-slug/` | Quick task artifacts | Contains: `{id}-PLAN.md`, `{id}-SUMMARY.md`, optional `{id}-CONTEXT.md`, `{id}-RESEARCH.md`, `{id}-VERIFICATION.md` | Quick planner/executor | Quick verifier | 1-3 tasks per quick plan |
| `todos/pending/`, `todos/done/` | Captured ideas and completed todos | Markdown | `/gsd:todo` | Progress reporting | None specified |
| `threads/` | Persistent context threads | Markdown | `/gsd:thread` | Context loading | None specified |
| `seeds/` | Forward-looking ideas | Markdown | `/gsd:plant-seed` | Future planning | None specified |
| `debug/`, `debug/resolved/` | Active and resolved debug sessions | Markdown | Debug workflow | Debugging | None specified |
| `debug/knowledge-base.md` | Persistent debug learnings | Markdown | Debug workflow | Future debugging | None specified |

**File interconnection pattern:**
```
PROJECT.md ──────────────► All agents (vision, constraints)
REQUIREMENTS.md ─────────► Planner, Verifier, Auditor
ROADMAP.md ──────────────► Orchestrators (phase goals, progress)
STATE.md ────────────────► All agents (position, decisions, blockers)
config.json ─────────────► All workflows (feature flags, model profiles)
CONTEXT.md (per phase) ──► Researcher, Planner, Executor
RESEARCH.md (per phase) ─► Planner, Plan Checker
PLAN.md (per plan) ──────► Executor, Plan Checker, Verifier
SUMMARY.md (per plan) ───► Verifier, Transition, STATE.md updates
VERIFICATION.md ─────────► Gap closure cycle
UI-SPEC.md ──────────────► Executor, UI Auditor
```

---

### Superpowers `docs/superpowers/` Directory

| File | Purpose | Format |
|------|---------|--------|
| `specs/YYYY-MM-DD-<topic>-design.md` | Design spec from brainstorming phase. Captures approaches explored, chosen approach with rationale, design sections. | Markdown |
| `plans/YYYY-MM-DD-<feature-name>.md` | Implementation plan. Header (goal, architecture, tech stack), file structure map, 2-5 min tasks with checkboxes, exact file paths, complete code, test commands, expected output. | Markdown with checkbox syntax |
| In-memory TodoWrite tracking | Task progress during plan execution. No disk persistence. | Claude Code TodoWrite tool (ephemeral) |
| Code review output | Subagent review responses — not persisted to disk. Critical/Important/Minor severity. | Subagent response (ephemeral) |
| Git commits | Atomic commits per task step. | Git history |

**Key observation:** Superpowers produces very few persistent artifacts. Only specs and plans are durable. Reviews are ephemeral. No session log, no cost tracking, no state persistence file, no roadmap/backlog concept. TodoWrite provides in-session task tracking but nothing persists between sessions.

---

### The Architect `output/` Directory

| File | Purpose | Format |
|------|---------|--------|
| `output/<project-name>-blueprint.md` | Complete 16-section project blueprint. The ONLY file written by The Architect. Self-contained: a Claude Code instance with zero prior context must build from it without clarification. | Markdown (16 structured sections) |

**Key observation:** The Architect has NO persistent state. Single session, single output file. The blueprint IS the externalized state — Section 15 (CLAUDE.md for target project) is the only artifact that persists to the next agent. Knowledge files are loaded on demand during conversation but produce no intermediate artifacts.

**Context management:** Lazy-loading. Archetype files avg ~100 lines, building blocks avg ~80 lines. Full knowledge base could fit simultaneously but lazy loading keeps each phase focused.

---

## 3. Config Patterns

### GSD config.json

**File:** `.planning/config.json`
**Design pattern:** "Absent = Enabled" — feature flags default to enabled; users explicitly disable features.
**Consumed by:** All workflows (feature flags, model profiles)

#### Feature Toggles

| Field | Type | Default | Description | Already Handled by iaGO Hooks? |
|-------|------|---------|-------------|-------------------------------|
| `mode` | enum | `interactive` | `interactive` / `yolo` / `custom` — controls how much human confirmation is required | No — workflow-level concern |
| `granularity` | enum | `standard` | `minimal` / `standard` / `complex` — selects which summary template agents use (`summary-minimal.md`, `summary-standard.md`, `summary-complex.md`) | No — artifact format concern |
| `parallelization.enabled` | boolean | `true` | Whether agents within a wave run in parallel vs sequentially | No — orchestration concern |
| `agent_skills` | object | (all enabled) | Per-agent capability toggles | No — agent config concern |
| `safety` | object | (all enabled) | Security scanning, prompt injection detection, path traversal prevention | **Yes** — `safety-guard.mjs` handles destructive commands, secret detection, injection detection (DECISION-hooks.md §4) |

#### Thresholds

| Field | Type | Default | Description | Already Handled by iaGO Hooks? |
|-------|------|---------|-------------|-------------------------------|
| Context monitor warning | percentage | 35% remaining (GSD) | Inject warning when context limited | **Yes** — `context-monitor.mjs` with thresholds at 80%/90% used (DECISION-hooks.md §6). Different threshold scale but same mechanism. |
| Context monitor critical | percentage | 25% remaining (GSD) | Force escalation, suggest pause | **Yes** — same hook, 90% threshold |
| Plan-checker max iterations | integer | 3 | Max correction loops before plan is accepted or rejected | No — planning concern |
| Quick task limit | integer | 1-3 tasks | Max tasks per quick plan | No — task sizing concern |
| STATE.md size cap | lines | ~100 | "It's a DIGEST, not an archive" | No — state management concern |
| Analysis paralysis guard | integer | 5 | 5+ consecutive read-only tool calls without edit/write/bash = STOP | No — agent behavior concern |
| Auto-fix attempt limit | integer | 3 | 3 auto-fix attempts on a single task, then move on | No — agent behavior concern |

#### Workflow Behavior

| Field | Type | Default | Description | Already Handled by iaGO Hooks? |
|-------|------|---------|-------------|-------------------------------|
| `workflow.auto_advance` | boolean | `false` | Auto-chain: discuss -> plan -> execute -> verify -> transition | No — orchestration concern |
| `workflow._auto_chain_active` | boolean | — | Internal flag propagated between commands during auto-advance | No — internal state |
| `branching_strategy` | string | — | Required for `/gsd:ship`. Controls branch naming and PR creation. | No — git workflow concern |
| `gates` | object | (all enabled) | Verification gates, regression gates between phases | No — quality gate concern |

#### Model Profile Tiering

| Profile | Agent Types | Purpose |
|---------|------------|---------|
| `quality` (Opus) | Planning, architecture decisions, reviews | Highest capability for judgment-heavy work |
| `balanced` (Sonnet) | Execution, following instructions | Good balance of capability and speed |
| `budget` (Haiku) | Read-only work, simple lookups | Cheapest for mechanical tasks |
| `inherit` | — | Use parent session's model |

### ECC Config Architecture (Hierarchy)

Config sources layer in this priority order:

| # | Source | Path | Purpose | Scope |
|---|--------|------|---------|-------|
| 1 | `CLAUDE.md` | repo root | Project-level guidance: architecture, test commands, skill routing table | Loaded first as project context |
| 2 | `.claude/rules/*.md` | `.claude/rules/` | Always-active constraints: commit style, architecture conventions, detected workflows, stack-specific rules | Immutable guardrails, always active |
| 3 | `RULES.md` | repo root | Concise must-always / must-never rules: agent format, skill format, hook format, commit style | Hard rules |
| 4 | `hooks/hooks.json` | `hooks/` | Event-driven automation: PreToolUse, PostToolUse, PreCompact, SessionStart, Stop, SessionEnd with matchers, timeouts, async flags | Runtime automation |
| 5 | `.claude/identity.json` | `.claude/` | User preferences: technical level, verbosity, domains | Personalization |
| 6 | `.claude/team/*.json` | `.claude/team/` | Team configuration | Multi-user |
| 7 | `.claude/ecc-tools.json` | `.claude/` | Tool configuration for ECC-specific operations | Tool config |
| 8 | `.mcp.json` | repo root | MCP server configs (external tool access) | External integrations |

**Composition model:** CLAUDE.md sets foundational context. `.claude/rules/` enforces immutable constraints. Hooks register event listeners. Skills activate on-demand by command or context match. Agents spawn as subagents with specific tool/model configs. MCP servers bridge external tools.

**Override rules:** CLAUDE.md provides context (soft guidance). Rules provide hard constraints (always active, no override). Hooks provide event-driven behavior (can be disabled per-hook via env var in iaGO's model: `IAGO_DISABLED_HOOKS`).

---

## 4. Plan Format Patterns

### GSD Plan Format

**File naming:** `XX-YY-PLAN.md` (XX = phase number, YY = plan number within phase)
**Location:** `.planning/phases/XX-phase-name/`

**YAML Frontmatter:**

```yaml
phase: 3                           # Phase number
plan: 2                            # Plan number within phase
type: implementation               # Plan type classification
wave: 1                            # Wave number (determines execution order)
depends_on: [3-1]                  # Dependencies on other plans (list of plan IDs)
autonomous: true                   # Whether plan can execute independently
requirements: [REQ-001, REQ-003]   # Linked requirement IDs (traceability)
must_haves:
  truths:                          # Core facts the plan depends on
    - "API uses REST with JSON responses"
  artifacts:                       # Deliverables/outputs required
    - "src/routes/users.ts"
  key_links:                       # Critical file/module references
    - "src/db/schema.ts"
```

**Body sections:** Header with goal, architecture, tech stack. File structure map. Task list with checkbox syntax.

**Task-level fields:**

| Field | Purpose |
|-------|---------|
| `files` | Files affected by the task |
| `action` | What the task does (implementation description) |
| `verify` | How to verify task completion (test command + expected output) |
| `done` | Task completion status (checkbox) |

**Wave/dependency metadata:** Plans declare `wave` and `depends_on`. Waves execute sequentially; plans within a wave execute in parallel. Dependency graph enables transitive closure for context selection.

**Context budget targets:**
- Standard quick: ~30% context usage
- Full quick: ~40% context usage
- Full phase orchestrator: ~10-15% context (for 200K models)
- For 1M+ models (Opus 4.6, Sonnet 4.6): richer context can be passed directly

### Plan-Checker Verification Loop

**Loop cap:** Max 3 iterations (planner submits, checker reviews, planner fixes — repeat up to 3x)

**8 Verification Dimensions:**

| # | Dimension | What It Checks |
|---|-----------|---------------|
| 1 | `must_haves.truths` | Core facts/assumptions are valid and documented |
| 2 | `must_haves.artifacts` | All required deliverables are listed |
| 3 | `must_haves.key_links` | Critical file references exist and are correct |
| 4 | Task `files` | Every task specifies which files it touches |
| 5 | Task `action` | Every task has a clear implementation description |
| 6 | Task `verify` | Every task has a verification step with expected output |
| 7 | Wave/dependency metadata | Dependencies are correctly declared, no circular deps |
| 8 | **Nyquist validation** | Automated test mapping — every requirement has corresponding test coverage |

**Outcome:** Plans verified before expensive execution. "Prevents delivering plans with gaps."

### Superpowers Plan Format

**File naming:** `YYYY-MM-DD-<feature-name>.md`
**Location:** `docs/superpowers/plans/`

**Header:**
- Goal (1 sentence)
- Architecture (2-3 sentences)
- Tech stack

**File structure map:** Which files created/modified and their responsibilities.

**Task structure:** Checkbox syntax, each task is ONE action taking 2-5 minutes.

| Requirement | Description |
|------------|-------------|
| **2-5 minute granularity** | "Write the failing test" is one step. "Run it to make sure it fails" is another step. |
| **Exact file paths** | Every task specifies the exact file to create/modify |
| **Complete code** | No partial code — show the actual implementation |
| **Test command** | Exact command to run |
| **Expected output** | What the test command should produce |

**No-placeholders rule** — these are EXPLICIT plan failures:
- "TBD", "TODO", "implement later"
- "Add appropriate error handling" (without showing the code)
- "Similar to Task N" (repeat the code)
- Steps describing what to do without showing how

**Self-review checklist** (run before plan is finalized):
- Spec coverage: does the plan cover everything in the approved spec?
- Placeholder scan: any "TBD", "TODO", "implement later", "similar to" text?
- Type consistency: do types match across tasks?

**Execution handoff:** After saving plan, offers choice between subagent-driven (recommended) and inline execution.

---

## 5. Execution Model Patterns

### GSD Execution Model

**Architecture:** Orchestrator stays lean (~10-15% context for 200K windows). Delegates all heavy work to fresh-context subagents.

**Wave-based execution:**
```
Wave 1: Plans with no deps → all execute in parallel
Wave 2: Plans depending on Wave 1 → parallel after Wave 1 completes
Wave 3: Plans depending on Wave 2 → parallel after Wave 2 completes
```

**Subagent spawning (per plan):**
```
Task(
  subagent_type = "gsd-executor",
  model = "{executor_model}",        # From model profile config
  isolation = "worktree",            # Each executor gets separate git worktree
  prompt = "<objective>...</objective>
    <execution_context>
      @~/.claude/get-shit-done/workflows/execute-plan.md
      @~/.claude/get-shit-done/templates/summary.md
      @~/.claude/get-shit-done/references/checkpoints.md
    </execution_context>
    <files_to_read>
      - {phase_dir}/{plan_file}
      - .planning/PROJECT.md
      - .planning/STATE.md
      - .planning/config.json
      - ./CLAUDE.md
    </files_to_read>"
)
```

**Context payload per agent type:**

| Agent | Gets | Does NOT Get |
|-------|------|-------------|
| **Executor** | Specific PLAN.md, PROJECT.md, STATE.md, config.json, CLAUDE.md, workflow reference files | Other plans, conversation history, orchestrator state, RESEARCH.md |
| **Researcher** | CONTEXT.md (user decisions), REQUIREMENTS.md, STATE.md, phase description | Plans, summaries, conversation history |
| **Planner** | RESEARCH.md, CONTEXT.md, REQUIREMENTS.md, STATE.md, ROADMAP.md | Conversation history, other phase plans |
| **Verifier** | Phase goal from ROADMAP.md, PLAN.md files (for must_haves), SUMMARY.md files | Research, context, conversation history |

**What is deliberately excluded and why:**
- **Conversation history** — the entire point; agents get structured artifacts, not accumulated chat
- **Other phases' plans** — agents see only their assigned work
- **Orchestrator internal state** — agents don't know about wave grouping, other running agents
- **Intermediate reasoning** — if a researcher discovered something, it's in RESEARCH.md; the raw discovery process is gone

**SUMMARY.md output per plan:**

| Frontmatter Field | Purpose |
|-------------------|---------|
| `dependency_graph` | `requires`, `provides`, `affects` — explicit links for transitive closure |
| `tech_stack` | Technologies used in this plan |
| `key_files` | Key files modified/created |
| `metrics` | Performance/outcome metrics |

Three summary template variants selected by `granularity` config:
- `summary-minimal.md` — Lean: performance, accomplishments, commits, files
- `summary-standard.md` — Full: dependency graph frontmatter, deviation documentation
- `summary-complex.md` — Extended: multi-plan phases

**Agent behavior guards:**
- Analysis paralysis: 5+ consecutive Read/Grep/Glob calls without Edit/Write/Bash = STOP
- Auto-fix limit: 3 attempts on a single task, then move on
- Deviation rules: auto-fix bugs/missing-critical/blocking-issues; ASK for architectural changes

**Parallel commit safety:**
1. `--no-verify` commits during parallel execution (skip pre-commit hooks)
2. Post-wave hook validation (orchestrator runs hooks once after wave completes)
3. STATE.md file locking (O_EXCL atomic lock file, 10s stale timeout, spin-wait with jitter)

**Result collection:**
1. File-based: agents write SUMMARY.md to disk
2. Git-based: agents make atomic commits; orchestrator verifies via `git log`
3. Structured return: agents return markdown block (`## PLAN COMPLETE` with task table, commit hashes, duration)
4. Spot-check fallback: if agent doesn't return completion signal, orchestrator checks `test -f "{summary_path}"` and `git log --grep`

### Superpowers Execution Model

**Architecture:** Fresh subagent per task (finer granularity than GSD's per-plan). Main session acts as coordinator.

**Two-stage review (sequential — spec compliance MUST pass before quality review):**

| Stage | Agent | What It Checks | Key Rule |
|-------|-------|----------------|----------|
| 1. Spec compliance | `spec-reviewer` subagent | Does implementation match the approved spec? | "Do not trust the implementer report — must read actual code" |
| 2. Code quality | `code-quality-reviewer` subagent | Is the code well-built? Uses git SHA range for targeted diff. | Only runs after spec compliance passes. Structured output: Critical / Important / Minor. |

**Review loop:** If reviewer finds issues → same implementer subagent fixes → reviewer re-reviews → repeat until approved.

**Escalation protocol (implementer status vocabulary):**

| Status | Meaning | Controller Action |
|--------|---------|------------------|
| `DONE` | Task completed successfully | Proceed to review |
| `DONE_WITH_CONCERNS` | Completed but with noted issues | Review with attention to concerns |
| `NEEDS_CONTEXT` | Insufficient information to proceed | Provide more context, break task smaller |
| `BLOCKED` | Cannot proceed | Use more capable model, break task smaller, or escalate to human. Never force retry without changes. |

**Model selection by complexity:**
- Cheap models: mechanical tasks (1-2 files, clear spec)
- Standard models: integration work
- Most capable models: architecture/design/review

### The Architect Execution Model

**Architecture:** Single agent, single session, no subagents. Purely conversational.

**Iterative design pattern:**
1. Classify project → load archetype knowledge on demand
2. Deep-dive questions → load building-block files as decisions arise
3. Present architecture in ONE message, under 40 lines → max 2 iterations for confirmation
4. Generate blueprint from templates + accumulated decisions

**Key execution principles:**
- Progressively loaded context (lazy-loading knowledge files)
- Max 3 questions per message
- Max 2 architecture iterations before asking about sticking points
- Blueprint Section 9 (Build Order) is the most critical output — numbered, dependency-ordered, enables autonomous execution
- Output is agent-config: Section 15 produces a CLAUDE.md that another agent instance reads to build

---

## 6. Quick/Fast Mode Patterns

### GSD Fast Mode (`/gsd:fast`)

**Trigger criteria:** Trivial tasks only.
- <= 3 file edits
- <= 1 minute estimated
- No new dependencies
- No research needed

**What it does:**
1. Parse task description
2. Scope check (trivial criteria above)
3. Execute inline — no subagent spawning
4. Atomic commit with conventional format
5. Log to STATE.md quick tasks table (if it exists)

**What it skips:** Everything. No PLAN.md, no SUMMARY.md, no subagent, no verification, no discussion, no research.

**Artifacts created:** Git commit only. STATE.md log entry if table exists.

**Guardrails:**
- NEVER spawns a Task/subagent
- NEVER creates PLAN.md or SUMMARY.md
- If task takes more than 3 file edits → redirects to `/gsd:quick`
- If unsure how to implement → redirects to `/gsd:quick`

### GSD Quick Mode (`/gsd:quick`)

**Trigger criteria:** Small focused tasks.
- 1-3 focused tasks per plan
- ~30% context usage (standard) / ~40% (full)
- Requires active project (ROADMAP.md must exist)

**What it does:**
1. Parse arguments for `--discuss`, `--research`, `--full` flags
2. Initialize via `gsd-tools.cjs init quick`
3. Create task directory: `.planning/quick/YYMMDD-xxx-slug/`
4. *(Optional, `--discuss`)* Discussion phase: 2-4 gray areas, max 2 questions per area
5. *(Optional, `--research`)* Research phase: single focused researcher (NOT 4 parallel like full phases)
6. Spawn planner in quick mode: single plan, 1-3 tasks
7. *(Optional, `--full`)* Plan-checker loop: max 2 iterations (vs 3 for full phases)
8. Spawn executor with plan reference
9. *(Optional, `--full`)* Verification by `gsd-verifier`
10. Update STATE.md quick tasks table
11. Commit all artifacts

**What it skips (always):**
- No ROADMAP.md phase manipulation
- No multi-plan waves
- No regression gates
- Does NOT update ROADMAP.md (separate from planned phases)

**What it skips (default, without flags):**
- No plan checking
- No verification
- Just plan + execute

**Composable flags:**
- `--discuss` → adds discussion phase
- `--research` → adds research phase
- `--full` → adds plan-checking (2 iterations) + verification
- All flags composable: `--discuss --research --full`

**Artifacts created:**

| Artifact | Always/Optional |
|----------|----------------|
| `{id}-PLAN.md` | Always |
| `{id}-SUMMARY.md` | Always |
| `{id}-CONTEXT.md` | Optional (`--discuss`) |
| `{id}-RESEARCH.md` | Optional (`--research`) |
| `{id}-VERIFICATION.md` | Optional (`--full`) |

**Quick ID format:** `YYMMDD-xxx` (date + Base36 precision)

### GSD Intent Dispatcher (`/gsd:do`)

**What it does:** Takes freeform text, matches intent to best GSD command, dispatches. Never does work itself — pure routing.

**Routing logic:**
- Bug/error → `/gsd:debug`
- Complex task → `/gsd:add-phase`
- Small actionable task → `/gsd:quick`
- Research → `/gsd:research-phase`

### The Architect Fast-Track Mode

**Trigger:** User says "just build it" or wants minimal discovery.
**What it does:** 3 essential questions + smart defaults for everything else. Skips full deep-dive.
**Output:** Same 16-section blueprint, just with more defaulted choices.

---

## 7. Pause/Resume Patterns

### GSD Pause/Resume

**Trigger:** Explicit command only (`/gsd:pause-work`). Not automated — there is no automatic pause-on-context-exhaustion. The context monitor warns at 25% remaining and suggests the user run `/gsd:pause-work`, but the user must invoke it.

**What pause creates:**

**1. HANDOFF.json** — Machine-readable pause state

```json
{
  "phase": 3,
  "plan": 2,
  "task_numbers": [4, 5, 6],
  "completed_tasks": [
    { "task": 1, "commit": "abc123" },
    { "task": 2, "commit": "def456" },
    { "task": 3, "commit": "ghi789" }
  ],
  "remaining_tasks": [4, 5, 6],
  "blockers": [],
  "human_actions_pending": [],
  "decisions": ["JWT over session cookies", "bcrypt for hashing"],
  "uncommitted_files": ["src/auth.ts", "src/routes/login.ts"],
  "next_action": "Execute task 4: OAuth Google provider setup"
}
```

**2. `.continue-here.md`** — Human-readable pause state (per phase: `.planning/phases/XX-name/.continue-here.md`)

Format: XML-tagged sections in Markdown:
- `<current_state>` — Where work is right now
- `<completed_work>` — What's done
- `<remaining_work>` — What's left
- `<decisions_made>` — Key decisions so far
- `<blockers>` — Current obstacles
- `<context>` — Context needed for resume
- `<next_action>` — Explicit next step

Both files are committed as WIP.

**Resume behavior (`/gsd:resume-work`):**
1. Read HANDOFF.json for machine-parseable state restore
2. Read .continue-here.md for human-readable context
3. Reconstruct orchestrator position (phase, plan, task)
4. **Delete .continue-here.md after resume** — it's transient, not permanent storage
5. Continue from `next_action`

**Idempotent re-run as fallback:** Even without pause/resume, `execute-phase` discovers completed SUMMARYs → skips them → resumes from first incomplete plan. STATE.md tracks phase/plan/status.

### iaGO Pause/Resume (from DECISION-hooks.md)

**Trigger:** Future `/iago:pause` slash command (not yet built). Not auto-generated.

**What pause creates:** HANDOFF.json at `.iago/state/HANDOFF.json`

```json
{
  "paused_at": "2026-03-31T15:30:00Z",
  "session_id": "abc123",
  "client": "acme",
  "current_task": "Implement login flow — password validation done, need OAuth next",
  "completed_steps": ["Email/password registration endpoint", "Login endpoint with JWT"],
  "remaining_steps": ["OAuth Google provider", "Refresh token rotation"],
  "blockers": [],
  "key_decisions": ["JWT over session cookies", "bcrypt for hashing"],
  "uncommitted_files": ["src/auth.ts", "src/routes/login.ts"],
  "next_action": "Implement Google OAuth — start with passport-google-oauth20 setup"
}
```

**Resume behavior (SessionStart hook):**
1. `context-persistence.mjs session-start` checks for HANDOFF.json
2. If present: loads it, injects context via `hookSpecificOutput`, deletes HANDOFF.json after load
3. If absent: loads most recent session snapshot from `.iago/state/sessions/`

### Relationship Between Pause/Resume and Session Persistence

| Mechanism | Trigger | What It Captures | Lifecycle |
|-----------|---------|-----------------|-----------|
| **Session persistence** (context-persistence.mjs) | Automatic — fires on PreCompact and Stop events | Session-level state: files modified, tools used, key decisions, tokens, current task, client, branch | Snapshot written on compaction and session end. Loaded on next SessionStart. Kept last 10, pruned automatically. |
| **Pause/resume** (HANDOFF.json) | Manual — user invokes `/iago:pause` | Task-level state: completed steps with specifics, remaining steps, blockers, uncommitted files, exact next action | Written once on pause, read and deleted on resume. More structured and actionable than session snapshots. |

**Key difference:** Session persistence is automatic and captures broad session context (good enough for "what was I doing?"). Pause/resume is manual and captures precise task-level state (good enough for "continue exactly where I left off"). They complement — session persistence is the safety net; pause/resume is the precision tool.

**Recovery hierarchy:**
1. HANDOFF.json present → load it (most precise)
2. No HANDOFF.json, recent session snapshot → load that (broad context)
3. No session snapshot, `outcome` missing → interrupted session detected, load last PreCompact snapshot

---

## 8. Discipline Patterns

### GSD Discipline Rules

**Analysis paralysis guard:**
- "During task execution, if you make 5+ consecutive Read/Grep/Glob calls without any Edit/Write/Bash action: STOP."
- Prevents agents from endlessly researching without producing output
- Source: `agents/gsd-executor.md`, `<analysis_paralysis_guard>`

**Auto-fix attempt limit:**
- After 3 auto-fix attempts on a single task, stop fixing and move on
- Prevents infinite fix loops that waste context
- Source: `agents/gsd-executor.md`

**Deviation rules (auto-fix hierarchy):**
- Auto-fix allowed: bugs, missing critical functionality, blocking issues
- Must ASK: architectural changes, scope modifications
- 3-attempt limit on any single auto-fix effort
- Source: `agents/gsd-executor.md`, `<deviation_rules>`

**Plan discipline:**
- Plan-checker verification loop: max 3 iterations
- 8 verification dimensions (truths, artifacts, key_links, task files, task action, task verify, wave/deps, Nyquist test mapping)
- Plans block execution if they fail verification
- Source: `get-shit-done/workflows/plan-phase.md`, `agents/gsd-plan-checker.md`

**Execution discipline:**
- Fresh context per plan — eliminates context rot
- Orchestrator stays at ~10-15% context (for 200K windows)
- Pass file paths only — executors read files themselves
- Atomic commits per task
- SUMMARY.md required per plan to gate completion
- Source: `get-shit-done/workflows/execute-phase.md`

**Scope discipline:**
- Phase boundary from ROADMAP.md is FIXED
- Discussion clarifies HOW, never WHETHER to add new capabilities
- Scope creep suggestions captured in "Deferred Ideas" section of CONTEXT.md
- Source: `get-shit-done/workflows/discuss-phase.md`

**Context discipline:**
- Quick tasks: ~30% context budget (standard), ~40% (full)
- STATE.md capped at ~100 lines ("It's a DIGEST, not an archive")
- Context monitor hook: warning at 35% remaining, critical at 25% remaining
- `/clear` recommended before new phases (relaxed for 1M+ context windows)
- Source: `get-shit-done/workflows/quick.md`, `templates/state.md`, `hooks/gsd-context-monitor.js`

### Superpowers Discipline Rules

**"Check skills before every action" meta-rule:**
- The `using-superpowers` meta-skill establishes a skill-check-before-every-action pattern
- Auto-injected at session start via hook
- Before any action, agent must check which skill applies and follow it
- Source: `skills/using-superpowers/SKILL.md`

**Rationalization prevention technique:**
- Excuse/reality tables: list 11+ common rationalizations agents use to skip steps, paired with the reality of why the step matters
- Red flags lists: explicit warning signs that an agent is about to violate discipline
- "Violating the letter is violating the spirit" preamble: prevents technically-compliant-but-wrong shortcuts
- Red flags include: "I already know the answer" (haven't run tests), "This is too simple for TDD" (it's never too simple), "I'll add tests later" (you won't), "The user wants speed" (speed without correctness is waste)
- Source: `skills/test-driven-development/SKILL.md` (11 excuse/reality pairs), `skills/writing-skills/SKILL.md` (bulletproofing section)

**Key agent behavior assumptions (enforced across all skills):**
1. Agents will rationalize skipping any non-enforced step
2. Agents lose context over long sessions — subagents with fresh context are more reliable
3. Agents need explicit "red flags" lists to catch themselves
4. Skills must declare whether they are "rigid" (TDD, debugging) or "flexible" (patterns)
5. Agent reports cannot be trusted — independent verification required after every claim

**No-placeholders rule:**
- "TBD", "TODO", "implement later" = plan failure
- "Add appropriate error handling" (without showing code) = plan failure
- "Similar to Task N" (repeat the code instead) = plan failure
- Steps describing WHAT without showing HOW = plan failure
- Source: `skills/writing-plans/SKILL.md`

**Self-review before marking complete:**
- Spec coverage: does plan cover everything in approved spec?
- Placeholder scan: any forbidden text found?
- Type consistency: do types match across tasks?
- Must run before plan is finalized
- Source: `skills/writing-plans/SKILL.md`

**Verification-before-completion pattern:**
- "No completion claims without fresh verification evidence"
- Run the command, read the output, THEN claim the result
- Prevents the #1 agent failure mode: claiming success without evidence
- Common verification failures: "tests pass" (didn't run them), "build succeeds" (didn't check exit code), "feature works" (didn't test it)
- Source: `skills/verification-before-completion/SKILL.md`

**Systematic debugging (4-phase + 3-fix escalation):**
1. Root cause investigation
2. Pattern analysis
3. Hypothesis testing
4. Implementation
- Escalation rule: "If 3+ fixes failed, stop fixing and question the architecture"
- Prevents infinite-fix-loop that wastes agent time
- Source: `skills/systematic-debugging/SKILL.md`

**Two-stage review discipline:**
- Spec compliance MUST pass before code quality review begins
- Prevents wasting quality review cycles on code that doesn't meet spec
- Reviewer told: "Do not trust the implementer report — must read actual code"
- Source: `skills/subagent-driven-development/SKILL.md`

**CSO (Claude Search Optimization) for descriptions:**
- "Description = when to use, NOT what it does"
- Prevents agents from reading only the description and skipping the full instruction
- Source: `skills/writing-skills/SKILL.md`

### The Architect Discipline Rules

**Discovery-before-design requirement:**
- CLAUDE.md rule #1: "NEVER generate the blueprint before completing Phases 1-3"
- Prompt-based enforcement only (no hooks, no code guards)
- Source: `CLAUDE.md`

**Iterative deepening pattern:**
- Phase 1 (Discovery): broad questions — vision, audience, stage
- Phase 2 (Deep Dive): archetype-specific narrow questions
- Knowledge files loaded on demand as decisions arise (lazy-loading)
- Source: `questions/phase-1-discovery.md`, `questions/phase-2-branches.md`

**Architecture validation gates:**
- Architecture presented in ONE message, under 40 lines
- Max 2 iterations for user confirmation
- After 2 iterations, ask about sticking points instead of re-presenting
- Source: `questions/phase-3-confirmation.md`

**Opinionated consultant posture:**
- Lead with recommendations, not option lists
- "Here's what I'd build" framing, never "here are your options"
- Max 3 questions per message
- Match user's energy (casual → casual, detailed → detailed)
- Source: `CLAUDE.md` conversation style rules

**Non-negotiable rules section:**
- Every blueprint includes 5-10 hard constraints the builder must never violate
- More reliable than hoping AI follows general guidelines
- Source: `templates/blueprint-template.md` Section 16

---

## 9. Config Hierarchy (from ECC)

### Complete Hierarchy (precedence order)

| # | Layer | Path | Content Type | Scope | Always-On vs On-Demand |
|---|-------|------|-------------|-------|----------------------|
| 1 | `CLAUDE.md` | repo root | Prose + tables | Project-level guidance: architecture, test commands, skill routing table | Always loaded first as project context |
| 2 | `.claude/rules/*.md` | `.claude/rules/` | Markdown guardrails | Always-active constraints: commit style, architecture conventions, stack specs, hook rules, testing requirements | Always-on ("always-active constraints") |
| 3 | `RULES.md` | repo root | Prose guidelines | Concise must-always / must-never rules: agent format, skill format, hook format, commit style | Always loaded (referenced) |
| 4 | `hooks/hooks.json` (or `settings.json`) | hooks/ or .claude/ | JSON registration | Event-driven automation: PreToolUse, PostToolUse, PreCompact, SessionStart, Stop, SessionEnd with matchers, timeouts, async flags | Event-driven (fires on matching events) |
| 5 | `.claude/identity.json` | `.claude/` | JSON config | User preferences: technical level, verbosity, domains | Metadata (loaded at session start) |
| 6 | `.claude/team/*.json` | `.claude/team/` | JSON configs | Team configuration | Metadata |
| 7 | `.claude/ecc-tools.json` | `.claude/` | JSON config | Tool-specific configuration | Metadata |
| 8 | `.mcp.json` | repo root | JSON config | MCP server configs (external tool access) | External integrations |

### Composition Rules

**Independence principle:** "Config layers compose but don't require each other. You can use CLAUDE.md without .claude/rules/. You can use hooks.json without identity.json. Each layer adds to the system independently."

**How layers compose:**
- `CLAUDE.md` is loaded first as project context (guidance)
- `.claude/rules/` files are always-active constraints (guardrails)
- `hooks/hooks.json` registers event-driven automations
- Skills are activated on-demand by commands or context matching
- Agents are spawned as subagents with specific tool/model configs
- MCP servers provide external tool access

### What Belongs Where

| Content Type | Put In | Criteria | Example |
|-------------|--------|----------|---------|
| Project architecture, stack, conventions, routing tables | `CLAUDE.md` | Guidance that agents should be aware of but isn't a hard constraint | "Tech stack: Next.js 15, TypeScript strict, Tailwind v4" |
| Hard constraints, must-do / must-not rules | `.claude/rules/*.md` | Immutable guardrails, always enforced, no exceptions | "NEVER commit console.log to main branch" |
| Event-triggered automation | `settings.json` hooks | Logic that runs before/after tool use, at session boundaries | Format on save, typecheck on edit, secret scan on commit |
| On-demand workflow guidance | `.claude/skills/*/SKILL.md` | Activated by user command or context matching | `/brainstorming`, `/code-review` |
| Agent definitions with tool/model restrictions | `.claude/agents/*.md` | Spawned as subagents for specific roles | `implementer.md`, `code-reviewer.md` |

### Profile-Based Gating (ECC pattern)

ECC uses profile-based hook gating:
- Each hook declares which profiles it runs in: `minimal` / `standard` / `strict`
- `ECC_HOOK_PROFILE` env var controls active profile
- `minimal` for quick exploratory work, `strict` for production code

iaGO simplification: No profiles. Per-hook disable via `IAGO_DISABLED_HOOKS=hook-id-1,hook-id-2` env var (from DECISION-hooks.md §1).

### Rules File Types (from ECC)

Two types observed:
1. **Generated bundles** (e.g., `everything-claude-code-guardrails.md`) — auto-generated aggregation of commit style, architecture conventions, detected workflows
2. **Project-specific** (e.g., `node.md`) — hand-written: stack (Node 18+, CommonJS), file conventions, hook development rules, testing requirements

### Skills and Agents: Discovery & Activation

**Skills:**
- Located in `skills/*/SKILL.md` directories
- "Skills are independent markdown files. Each skill is a standalone document. No skill depends on another skill."
- Activated on-demand by commands or context matching
- Only infrastructure dependency: agent definition format (YAML frontmatter + markdown body)

**Agents:**
- Defined as Markdown files with YAML frontmatter in `agents/*.md`
- YAML frontmatter includes: `name`, `description` (CSO format), `model` (opus/sonnet/haiku), tool restrictions
- Model routing: opus for planning/architecture, sonnet for most execution, haiku for high-volume/cost-sensitive
- Tool restrictions per role: read-only agents get Read/Glob/Grep only; active agents get full tool access; no agent gets the `Agent` tool (flat dispatch model)

---

## 10. Compatibility Notes

### Hook Compatibility (cross-reference with DECISION-hooks.md)

| Workflow Event/Need | Mapped to Existing iaGO Hook | Status | Notes |
|--------------------|-----------------------------|--------|-------|
| Session start context injection | `context-persistence.mjs session-start` | Decided (DECISION-hooks.md §2) | Loads session snapshot or HANDOFF.json. Injects via `hookSpecificOutput`. |
| Context usage monitoring | `context-monitor.mjs` (PostToolUse, all tools) | Decided (DECISION-hooks.md §6) | Reads bridge-ctx.json. Thresholds: 80% warning, 90% critical (different from GSD's 35%/25% remaining — same concept, different scale). |
| Pre-compaction state save | `context-persistence.mjs pre-compact` | Decided (DECISION-hooks.md §2) | Reads transcript JSONL, extracts key state, writes session snapshot. |
| Session end finalization | `context-persistence.mjs stop` | Decided (DECISION-hooks.md §2, §5) | Writes end_time, outcome, total tokens. Appends to costs.jsonl. |
| Post-edit formatting | `post-edit-format.mjs` (PostToolUse, Edit) | Decided (DECISION-hooks.md §3) | Hardcoded Biome. |
| Post-edit typecheck | `post-edit-typecheck.mjs` (PostToolUse, Edit) | Decided (DECISION-hooks.md §3) | `tsc --noEmit` filtered to edited file. |
| Post-edit console.log warning | `post-edit-console-warn.mjs` (PostToolUse, Edit) | Decided (DECISION-hooks.md §3) | Warn only (exit 0). |
| Config file protection | `config-protection.mjs` (PreToolUse, Edit/Write/MultiEdit) | Decided (DECISION-hooks.md §3) | Denylist of protected config files. |
| Destructive command blocking | `safety-guard.mjs` (PreToolUse, Bash) | Decided (DECISION-hooks.md §4) | 13 destructive patterns + allowlist. |
| Secret detection in writes | `safety-guard.mjs` (PreToolUse, Edit/Write/MultiEdit) | Decided (DECISION-hooks.md §4) | 17 secret patterns + exemptions. |
| Injection detection | `safety-guard.mjs` (PreToolUse, Edit/Write/MultiEdit) | Decided (DECISION-hooks.md §4) | Path traversal, prompt injection markers, classic injection phrasing, base64 payloads. |
| Commit quality enforcement | `commit-quality.mjs` (PreToolUse, Bash on `git commit`) | Decided (DECISION-hooks.md §4) | Conventional prefix, subject length, no WIP on main, staged secret scan. |
| Statusline display | `statusline.mjs` (Statusline event) | Decided (DECISION-hooks.md §8) | 4 fields: branch, context %, client, duration. Writes bridge-ctx.json. |
| Cost/utilization tracking | Integrated into `context-persistence.mjs stop` | Decided (DECISION-hooks.md §5) | Appends to `.iago/state/costs.jsonl`. Per-session, not per-token. |
| Pause state creation | Future `/iago:pause` slash command | Not yet built | Will write HANDOFF.json to `.iago/state/`. |
| Resume state loading | `context-persistence.mjs session-start` | Decided (DECISION-hooks.md §2) | Reads and deletes HANDOFF.json if present. |

**What does NOT need redesigning (already covered by hooks):**
- Context monitoring and warnings
- Session persistence and recovery
- Pre/post-edit quality pipeline
- Safety guards (destructive commands, secrets, injection)
- Commit quality
- Cost tracking
- Statusline with bridge file

**What still needs workflow-level design (not hook concerns):**
- Phase orchestration (discuss → plan → execute → verify)
- Plan creation and verification (plan-checker loop)
- Wave-based execution with dependency ordering
- Subagent dispatch with context payload construction
- State file management (STATE.md, ROADMAP.md, PLAN.md, SUMMARY.md)
- Quick/fast task tiering
- Auto-advance chain logic

### Agent Compatibility (cross-reference with DECISION-skills-agents.md)

| Workflow Phase | Agent(s) from DECISION-skills-agents.md | Status | Notes |
|---------------|----------------------------------------|--------|-------|
| **Plan execution** | `implementer` | Decided | Execute a single task from a plan. Model: sonnet. Full tool access. Max 3 fix attempts (paralysis guard). |
| **Spec compliance review** | `spec-reviewer` | Decided | Stage 1 of two-stage review. Read/Glob/Grep only (no Bash — prevents running tests). Opt-in via "full review" flag. |
| **Code quality review** | `code-quality-reviewer` | Decided | Stage 2 of two-stage review. Only runs if Stage 1 passes. Read/Glob/Grep/Bash (Bash for `git diff`). Opt-in. |
| **Single-pass review** | `code-reviewer` | Decided | Default review mode (not two-stage). Read/Glob/Grep/Bash. Severity output: Critical/Important/Minor. |
| **Research** | `researcher` | Decided | Deep research across codebase and web. Read/Glob/Grep/Bash/WebSearch/WebFetch. |
| **TDD enforcement** | `tdd-guide` | Decided | Ad-hoc agent. RED-GREEN-REFACTOR discipline. Full tool access. Dispatched when orchestrator detects TDD context. |
| **Build error resolution** | `build-error-resolver` | Decided | Ad-hoc agent. 4-phase systematic debugging. Full tool access. Max 3 fix attempts. Dispatched on build failure. |
| **E2E testing** | `e2e-runner` | Decided | Ad-hoc agent. Playwright E2E tests. Full tool access. Dispatched when orchestrator detects E2E work. |

**Escalation protocol (already decided in DECISION-conventions.md / DECISION-skills-agents.md):**

| Status | Meaning | Controller Action |
|--------|---------|------------------|
| `DONE` | Task completed successfully | Proceed to next task or review |
| `DONE_WITH_CONCERNS` | Completed with noted issues | Review with attention to flagged concerns |
| `NEEDS_CONTEXT` | Insufficient information | Provide more context, break task smaller |
| `BLOCKED` | Cannot proceed | Use more capable model, break task smaller, or escalate to human. Never force retry without changes. |

All agents reference "Agent Escalation Protocol in CLAUDE.md" with agent-specific triggers (DECISION-skills-agents.md §3, validation checklist).

**Tool restrictions per agent (already decided):**

| Agent | Tools | Rationale |
|-------|-------|-----------|
| `implementer` | Read, Glob, Grep, Edit, Write, Bash | Produces code — needs full write access |
| `code-reviewer` | Read, Glob, Grep, Bash | Bash for `git diff`. No write access. |
| `spec-reviewer` | Read, Glob, Grep | No Bash — prevents running tests and muddying verdict |
| `code-quality-reviewer` | Read, Glob, Grep, Bash | Bash for `git diff`. No write access. |
| `researcher` | Read, Glob, Grep, Bash, WebSearch, WebFetch | Needs web access for deep research |
| `tdd-guide` | Full (Read, Glob, Grep, Edit, Write, Bash) | Produces code and runs tests |
| `build-error-resolver` | Full (Read, Glob, Grep, Edit, Write, Bash) | Diagnoses and fixes errors |
| `e2e-runner` | Full (Read, Glob, Grep, Edit, Write, Bash) | Writes and runs Playwright tests |

**No agent has the `Agent` tool** — flat dispatch model. Only the orchestrator (main session) can spawn agents.

**Model assignments (all decided as sonnet):**
- All 8 agents use `model: sonnet` — no agent task requires Opus-level reasoning
- Orchestrator (main session) runs on Opus for planning/architecture
- No haiku agents defined

**Dispatch model (from DECISION-skills-agents.md §1):**

```
subagent-driven-development
  |-- implementer (per task in plan)
  |-- code-reviewer (single-pass, default)
  +-- [opt-in "full review"]
      |-- spec-reviewer (Stage 1)
      +-- code-quality-reviewer (Stage 2, only if Stage 1 passes)

code-review
  +-- code-reviewer

deep-research
  +-- researcher (1 or more instances)

ad-hoc (orchestrator dispatches when context warrants):
  tdd-guide, build-error-resolver, e2e-runner
```

**Config and rules already decided (from DECISION-skills-agents.md §2, §4-5):**
- Meta-instruction in `.claude/rules/available-skills.md` — auto-loaded at session start, lists all skills and agents
- CLAUDE.md sections: Verification, Search-First, Agent Escalation Protocol, Execution Discipline
- Rules files: `tdd.md`, `systematic-debugging.md`, `e2e-testing.md`, `mcp-server-patterns.md`
- Always-loaded context: ~200 lines (CLAUDE.md sections + always-on rules)
- On-demand context: ~1,380 lines (agents + skills, loaded when dispatched/invoked)
