# Superpowers Analysis

## Overview

**What it is:** Superpowers (v5.0.7, actively maintained, MIT license) is a complete software development methodology for coding agents, packaged as a plugin for Claude Code, Cursor, Codex, OpenCode, Gemini CLI, and GitHub Copilot CLI. It is NOT a code library or runtime tool -- it is pure markdown instructions that reshape agent behavior through a composable skills system.

**Philosophy:** The core belief is that coding agents fail not because they lack capability, but because they lack discipline. Left to their own devices, agents skip design, write code before tests, claim things work without verification, and rationalize every shortcut. Superpowers solves this by injecting mandatory workflow skills at session start, enforcing a brainstorm-then-design-then-plan-then-execute pipeline with hard gates between phases.

**Key assumptions about agent behavior:**
1. Agents will rationalize skipping any non-enforced step (extensive rationalization tables in every skill)
2. Agents lose context over long sessions -- subagents with fresh context per task are more reliable
3. Agents need explicit "red flags" lists to catch themselves before violating discipline
4. Skills must be "rigid" (TDD, debugging) or "flexible" (patterns) -- the skill declares which
5. Agent reports cannot be trusted -- independent verification required after every claim

**Maturity:** v5.0.x series, 800+ GitHub issues referenced in changelogs, multi-platform support (Windows fixes in v5.0.3-5.0.5), active community with Discord. Has evolved from slash commands to a skills-based system. The brainstorming visual companion went through a zero-dependency rewrite. Production-tested across real development sessions.

**Problem it solves:** Turns a coding agent from an eager junior dev who writes code immediately into one that follows a disciplined design-plan-implement-review-verify workflow, with quality gates enforced at each transition.

## Core Workflow

| Phase | What Happens | Mandatory or Optional | Source Path | Useful for iaGO-OS? | Reasoning |
|-------|---------------|-----------------------|-------------|---------------------|-----------|
| **1. Brainstorming** | Explores context, asks one question at a time, proposes 2-3 approaches, presents design in digestible sections, writes spec to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, runs self-review, gets user approval | Mandatory before any creative work | `skills/brainstorming/SKILL.md` | Yes - Adapt | Maps to iaGO "discuss" phase. The one-question-at-a-time and YAGNI principles are excellent. Visual companion is over-engineered for our needs. |
| **2. Git Worktree Setup** | Creates isolated workspace on new branch, auto-detects project type, runs setup, verifies clean test baseline | Mandatory before implementation | `skills/using-git-worktrees/SKILL.md` | Partial | Worktree pattern is good for isolation but adds complexity. Our `.iago/` state approach already provides isolation differently. |
| **3. Writing Plans** | Breaks spec into 2-5 minute tasks with exact file paths, complete code, test commands, expected output. Self-review for spec coverage, placeholders, type consistency | Mandatory with approved spec | `skills/writing-plans/SKILL.md` | Yes - Core Extract | The task granularity (2-5 min each), no-placeholders rule, and self-review checklist are high-leverage. Maps to iaGO "plan" phase. |
| **4a. Subagent-Driven Dev** | Fresh subagent per task, two-stage review (spec compliance then code quality), implementer can ask questions or escalate | Recommended execution mode | `skills/subagent-driven-development/SKILL.md` | Yes - Core Extract | The two-stage review pattern and escalation protocol (DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED) are excellent. Maps to iaGO "execute" phase. |
| **4b. Executing Plans** | Load plan, review critically, execute in batches with human checkpoints | Alternative execution mode | `skills/executing-plans/SKILL.md` | Skip | Simpler fallback for environments without subagent support. Our stack has subagents. |
| **5. Code Review** | Dispatch code-reviewer agent with git SHA range, structured output (Critical/Important/Minor), fix-before-proceeding gates | Mandatory between tasks | `skills/requesting-code-review/SKILL.md` + `agents/code-reviewer.md` | Adapt | Review template and severity categorization are useful. Maps to iaGO "verify" phase. |
| **6. Finishing Branch** | Verify tests, present 4 options (merge/PR/keep/discard), cleanup worktree | Mandatory at completion | `skills/finishing-a-development-branch/SKILL.md` | Partial | The structured options are clean but tightly coupled to worktree pattern. |
| **Cross-cutting: TDD** | RED-GREEN-REFACTOR with iron law: no production code without failing test first. Delete code written before tests. | Mandatory during implementation | `skills/test-driven-development/SKILL.md` | Adapt carefully | Principle is sound but the absolutism (delete all code written before tests) may be too rigid for a 3-person consultancy doing rapid prototyping. |
| **Cross-cutting: Verification** | No completion claims without fresh verification evidence. Run command, read output, THEN claim result. | Mandatory always | `skills/verification-before-completion/SKILL.md` | Yes - Core Extract | This is pure gold. Prevents the #1 agent failure: claiming success without evidence. |
| **Cross-cutting: Debugging** | 4-phase systematic process: root cause investigation, pattern analysis, hypothesis testing, implementation. 3+ failed fixes = question architecture. | Mandatory for any bug | `skills/systematic-debugging/SKILL.md` | Yes - Adapt | The "3 fixes failed = architectural problem" escalation is a brilliant heuristic. |

## Skills Catalog

| Skill | Purpose | Trigger Style | Core or Peripheral | Keep/Adapt/Skip | Reasoning | Source Path |
|-------|---------|---------------|--------------------|-----------------|-----------|-------------|
| **using-superpowers** | Meta-skill: establishes skill system, priority rules, red flags | Auto-injected at session start via hook | Core | Adapt | The skill-check-before-every-action pattern and rationalization table are powerful. We need our own version. | `skills/using-superpowers/SKILL.md` |
| **brainstorming** | Design exploration with Socratic questioning | Auto: before any creative work | Core | Adapt | One-question-at-a-time, 2-3 approaches with recommendation, design-in-sections. Skip visual companion. | `skills/brainstorming/SKILL.md` |
| **writing-plans** | Break spec into bite-sized TDD tasks | Auto: with approved spec | Core | Extract | 2-5 min task granularity, exact file paths, no placeholders, self-review. High-leverage. | `skills/writing-plans/SKILL.md` |
| **subagent-driven-development** | Execute plans with fresh subagent per task | Auto: with implementation plan | Core | Extract | Two-stage review, escalation protocol, model selection by complexity. Key pattern. | `skills/subagent-driven-development/SKILL.md` |
| **test-driven-development** | Enforce RED-GREEN-REFACTOR | Auto: during any implementation | Core | Adapt | Excellent discipline but "delete all pre-test code" is too rigid for our context. Keep RED-GREEN-REFACTOR, soften the absolutism. | `skills/test-driven-development/SKILL.md` |
| **systematic-debugging** | 4-phase root cause process | Auto: any bug or failure | Core | Extract | Root cause tracing, defense-in-depth, 3-fix escalation. All independently valuable. | `skills/systematic-debugging/SKILL.md` |
| **verification-before-completion** | Evidence before claims | Auto: before any success claim | Core | Extract | Highest-value-per-token skill in the entire repo. Pure discipline, zero overhead. | `skills/verification-before-completion/SKILL.md` |
| **requesting-code-review** | Structured review with severity | Manual/workflow trigger | Core | Adapt | Template with git SHA range, severity categories. Useful for iaGO reviews/. | `skills/requesting-code-review/SKILL.md` |
| **receiving-code-review** | Technical evaluation of feedback | Auto: when receiving review | Core | Adapt | Anti-performative-agreement stance and YAGNI check are good. The "no thanks" rule is extreme. | `skills/receiving-code-review/SKILL.md` |
| **dispatching-parallel-agents** | Concurrent subagent workflows | Auto: 2+ independent tasks | Peripheral | Skip | GSD already handles parallel subagent dispatch. Not unique value. | `skills/dispatching-parallel-agents/SKILL.md` |
| **executing-plans** | Batch execution without subagents | Fallback when no subagent support | Peripheral | Skip | Our stack supports subagents. | `skills/executing-plans/SKILL.md` |
| **using-git-worktrees** | Isolated workspaces via git worktrees | Auto: before implementation | Peripheral | Skip | Adds complexity we don't need. `.iago/` provides our isolation. | `skills/using-git-worktrees/SKILL.md` |
| **finishing-a-development-branch** | Merge/PR/keep/discard workflow | Auto: when tasks complete | Peripheral | Skip | Tightly coupled to worktree pattern. | `skills/finishing-a-development-branch/SKILL.md` |
| **writing-skills** | TDD for skill documentation | Manual: when creating skills | Meta | Adapt | CSO (Claude Search Optimization) concept and rationalization-table methodology are useful for writing iaGO instructions. | `skills/writing-skills/SKILL.md` |

## Agent / Subagent Model

**Architecture:** Controller-worker pattern where the main session acts as coordinator and dispatches fresh subagents per task via the `Task` tool.

**Key design decisions:**
1. **Fresh context per task** -- subagents never inherit session history. The controller constructs exactly what context each subagent needs. This prevents context pollution and preserves coordinator context for orchestration. (`skills/subagent-driven-development/SKILL.md`, lines 6-7)
2. **Three subagent roles** with dedicated prompt templates:
   - **Implementer** (`implementer-prompt.md`): Gets full task text + architectural context, can ask questions, must self-review before reporting. Reports status as DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED.
   - **Spec Reviewer** (`spec-reviewer-prompt.md`): Independently verifies implementation matches spec. Explicitly told "do not trust the implementer report" -- must read actual code.
   - **Code Quality Reviewer** (`code-quality-reviewer-prompt.md`): Uses the `code-reviewer.md` agent template with git SHA range for targeted diff review.
3. **Two-stage review is sequential**: Spec compliance MUST pass before code quality review begins. This prevents wasting quality review on code that doesn't even meet spec.
4. **Review loops**: If reviewer finds issues, same implementer subagent fixes, reviewer re-reviews. Repeat until approved.
5. **Model selection by complexity**: Cheap models for mechanical tasks (1-2 files, clear spec), standard for integration, most capable for architecture/design/review. (`skills/subagent-driven-development/SKILL.md`, lines 89-100)
6. **Escalation protocol**: BLOCKED and NEEDS_CONTEXT statuses trigger controller intervention -- provide more context, use more capable model, break task smaller, or escalate to human. Never force retry without changes.

**Comparison to GSD:** GSD's `spawn` command creates fresh-context subagents for task execution. Superpowers' model is structurally similar but adds the two-stage review loop and the spec-compliance-before-quality ordering, which GSD lacks.

## Planning Discipline

**Plan structure** (from `skills/writing-plans/SKILL.md`):
- Header: goal (1 sentence), architecture (2-3 sentences), tech stack
- File structure map: which files created/modified, responsibilities
- Tasks broken into 2-5 minute steps with checkbox syntax
- Each step has: exact file path, complete code, test command, expected output
- Self-review checklist: spec coverage, placeholder scan, type consistency

**No Placeholders rule** -- these are explicitly defined as plan failures:
- "TBD", "TODO", "implement later"
- "Add appropriate error handling" (without showing the code)
- "Similar to Task N" (repeat the code)
- Steps describing what to do without showing how

**Task sizing:** Each step is one action taking 2-5 minutes. "Write the failing test" is one step. "Run it to make sure it fails" is another step. This granularity ensures subagents stay focused.

**Execution handoff:** After saving plan, offers choice between subagent-driven (recommended) and inline execution. Plan saves to `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`.

**Comparison to GSD:** GSD uses `.planning/` directory with spec and task files. Superpowers uses `docs/superpowers/specs/` and `docs/superpowers/plans/`. The actual plan discipline is significantly more detailed in Superpowers -- GSD's plans are lighter-weight.

## Testing Philosophy

**Enforcement level:** Extremely strict TDD with "Iron Law" framing.

**Core rules:**
1. No production code without a failing test first
2. Write code before test? Delete it. No keeping as reference, no adapting.
3. Every test must be watched failing for the right reason (feature missing, not typo)
4. Minimal code to pass -- no YAGNI violations
5. Mocks only when unavoidable; test real code
6. Bug fixes always start with a failing regression test

**Anti-rationalization:** The TDD skill contains the most extensive rationalization-prevention in the repo. 11 excuse/reality pairs, red flags list, "Why Order Matters" section addressing specific arguments like "tests after achieve the same goals" and "deleting X hours of work is wasteful."

**Practicality assessment for iaGO-OS:**
- **Benefits:** The discipline prevents agent drift, catches bugs early, creates verifiable work
- **Rigidity concern:** "Delete all pre-test code" is extreme for a consultancy doing rapid prototyping. A client demo might need code-first exploration.
- **Recommendation:** Keep RED-GREEN-REFACTOR as default, add an explicit "prototype mode" escape hatch that the human can invoke, matching our user-instructions-override-skills principle.

**Testing of skills themselves:** The `writing-skills` skill applies TDD to documentation -- run baseline scenarios without the skill, document how agents fail, write skill addressing those failures, verify agents now comply. This is a novel and valuable pattern. (`skills/writing-skills/SKILL.md`)

## Git / Worktree Model

**Pattern:** Create git worktree for each feature, work in isolation, merge/PR/discard when done.

**Directory selection:** Priority order: existing `.worktrees/` > `CLAUDE.md` preference > ask user. Must verify directory is in `.gitignore`.

**Cross-platform status:** Windows support exists via the polyglot `.cmd` wrapper (`hooks/run-hook.cmd`) that works as both CMD batch and bash script. The wrapper finds Git for Windows bash in standard locations. Documented in `docs/windows/polyglot-hooks.md`. Multiple Windows-specific fixes in changelogs (v5.0.3, v5.0.5).

**Assessment for iaGO-OS:** The worktree pattern adds meaningful complexity. Our `.iago/` directory approach already handles state isolation. Git worktrees are useful for parallel development but overkill for a 3-person team that likely works on one thing at a time per project. The polyglot hook wrapper technique is useful for our cross-platform needs but the actual worktree management is a skip.

## State & Artifacts

**Files/artifacts produced during workflow:**

| Artifact | Location | When Created | iaGO-OS Mapping |
|----------|----------|--------------|-----------------|
| Design spec | `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` | After brainstorming approval | `.iago/specs/` or `.iago/DECISIONS.md` |
| Implementation plan | `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md` | After spec approval | `.iago/tasks/` |
| Git worktree | `.worktrees/<branch>` or `~/.config/superpowers/worktrees/` | Before implementation | Not needed (`.iago/` handles isolation) |
| TodoWrite tracking | In-memory (Claude Code TodoWrite tool) | During plan execution | `.iago/STATE.md` task tracking |
| Code review output | Subagent response (not persisted to disk) | After each task | `.iago/reviews/` |
| Commit history | Git | After each task step | Git (unchanged) |

**Key observation:** Superpowers produces relatively few persistent artifacts. Design specs and plans are the main durable outputs. Reviews are ephemeral (subagent responses). There is no session log, cost tracking, or state persistence file equivalent to iaGO's `STATE.md`. The TodoWrite tool provides in-session task tracking but nothing persists between sessions.

**Gaps relative to iaGO-OS needs:**
- No cost tracking (Ruflo covers this)
- No session persistence (ECC covers this)
- No roadmap/backlog concept (just current feature)
- No decision log (specs capture design rationale but not operational decisions)

## Modularity Analysis

**Independently extractable patterns (high modularity):**
1. **Verification-before-completion discipline** -- Pure markdown instructions, zero dependencies on rest of system
2. **Systematic debugging 4-phase process** -- Self-contained, references TDD optionally
3. **Two-stage review pattern** (spec compliance then quality) -- Works with any subagent system
4. **Plan task structure** (2-5 min steps, no placeholders, exact paths) -- Template extractable
5. **Rationalization prevention technique** (excuse/reality tables, red flags lists) -- Meta-pattern applicable to any iaGO instruction
6. **Implementer escalation protocol** (DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED) -- Reusable status vocabulary
7. **Code reviewer template** with severity categories -- Standalone template
8. **CSO (Claude Search Optimization)** for skill descriptions -- Applicable to iaGO command descriptions

**Tightly coupled components (require the full system):**
1. **Brainstorming -> writing-plans -> subagent-driven-development -> finishing-branch** pipeline -- Each skill explicitly invokes the next
2. **Git worktree management** -- Deeply integrated with branch lifecycle
3. **The `using-superpowers` meta-skill** -- Assumes the full Superpowers skill catalog exists
4. **Visual companion** -- Requires brainstorm server (Node.js), complex lifecycle management

**Assessment:** The highest-value patterns are the most modular. The tightly coupled pipeline is actually the least unique -- GSD already provides a similar workflow. The independently extractable pieces are where Superpowers adds novel value.

## Comparison vs ECC / Ruflo / GSD / The Architect

### Overlaps with GSD
- **discuss -> plan -> execute -> verify** workflow (GSD has this, Superpowers has brainstorm -> writing-plans -> subagent-driven-dev -> finishing-branch)
- **Fresh-context subagent spawning** (GSD's `spawn` = Superpowers' Task tool dispatch)
- **Slash commands / skills** for triggering workflows (GSD has 44 commands, Superpowers has 14 skills)
- **Plan files** (GSD's `.planning/` = Superpowers' `docs/superpowers/plans/`)

### Unique value Superpowers adds beyond GSD
1. **Two-stage review** (spec compliance THEN quality) -- GSD does not separate these
2. **Verification-before-completion** as a standalone discipline -- GSD has verification but not as a cross-cutting iron law
3. **Systematic debugging** with 4-phase process and 3-fix escalation -- GSD has no debugging methodology
4. **Rationalization prevention** as a writing technique -- Applicable to all iaGO instructions
5. **Plan task granularity** (2-5 min steps with exact code) -- GSD plans are less prescriptive
6. **Implementer escalation protocol** (4 status codes) -- GSD subagents don't have this vocabulary
7. **CSO for skill/command descriptions** -- Useful for making iaGO commands discoverable

### Complements ECC
- ECC handles hooks, sessions, cost tracking, config protection -- Superpowers has none of this
- Superpowers' verification discipline would layer on top of ECC's post-edit quality gates
- The polyglot hook wrapper (`run-hook.cmd`) is a simpler version of what ECC already does more thoroughly

### Complements Ruflo
- Ruflo handles context management, archiving, token tracking -- Superpowers ignores context management entirely
- Superpowers' planning discipline helps Ruflo by producing well-structured artifacts that are easier to archive/retrieve

### Complements The Architect
- The Architect handles design-phase conversation, Superpowers' brainstorming overlaps but is less structured
- The Architect produces 16-section blueprints, Superpowers produces lighter specs
- Key difference: The Architect's output is a blueprint for agent configuration. Superpowers' output is a plan for code implementation. They target different outputs.

### Conflicts with iaGO-OS constraints
1. **Git worktrees** -- Adds complexity we handle differently with `.iago/`
2. **`docs/superpowers/` directory convention** -- We use `.iago/` for all state
3. **TodoWrite dependency** -- Tightly coupled to Claude Code's TodoWrite tool
4. **Plugin marketplace distribution** -- We use a different distribution model
5. **Brainstorm visual companion** -- Heavy dependency (Node.js server) we don't want

## Top Patterns to Extract (Ranked)

1. **Verification-before-completion discipline** -- Highest ROI per token. Prevents the #1 agent failure mode (false success claims). Pure markdown, zero dependencies. Adapt into iaGO's verify phase as a cross-cutting rule. Source: `skills/verification-before-completion/SKILL.md`

2. **Two-stage review protocol** (spec compliance then code quality) -- Unique value not in GSD. Catches over/under-building before wasting review cycles on quality. Adapt the two prompt templates into iaGO's review system. Source: `skills/subagent-driven-development/spec-reviewer-prompt.md`, `code-quality-reviewer-prompt.md`

3. **Rationalization prevention technique** -- Meta-pattern for writing any iaGO instruction. Use excuse/reality tables, red flags lists, and "violating the letter is violating the spirit" framing. Source: `skills/test-driven-development/SKILL.md` (rationalization table), `skills/writing-skills/SKILL.md` (bulletproofing section)

4. **Plan task structure** (2-5 min steps, no placeholders, exact paths, self-review) -- More prescriptive than GSD's planning. The no-placeholders rule and self-review checklist are independently valuable. Source: `skills/writing-plans/SKILL.md`

5. **Implementer escalation protocol** (DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED) -- Clean status vocabulary for subagent reporting. Prevents silent failures and "close enough" work. Source: `skills/subagent-driven-development/SKILL.md` (lines 103-118), `implementer-prompt.md`

6. **Systematic debugging 4-phase + 3-fix escalation** -- The "3 fixes failed = question architecture" heuristic is brilliant and not in any other analyzed repo. Source: `skills/systematic-debugging/SKILL.md`

7. **CSO (Claude Search Optimization)** for descriptions -- "Description = when to use, NOT what it does" prevents agents from shortcutting past reading the full instruction. Directly applicable to iaGO command metadata. Source: `skills/writing-skills/SKILL.md` (CSO section)

8. **Code reviewer template** with severity categories and structured output -- Standalone template adaptable to iaGO's `reviews/` directory. Source: `skills/requesting-code-review/code-reviewer.md`

9. **Brainstorming one-question-at-a-time pattern** -- Simple discipline that prevents overwhelming users. Adapt for iaGO's discuss phase. Source: `skills/brainstorming/SKILL.md`

10. **Cross-platform polyglot hook wrapper** -- The `: << 'CMDBLOCK'` technique for CMD/bash dual scripts. ECC may already handle this but the pattern is worth knowing. Source: `hooks/run-hook.cmd`, `docs/windows/polyglot-hooks.md`

## What to Ignore

1. **Git worktree management** (`skills/using-git-worktrees/SKILL.md`, `skills/finishing-a-development-branch/SKILL.md`) -- Adds complexity, tightly coupled lifecycle, our `.iago/` approach handles isolation differently. Not cross-platform friendly despite efforts.

2. **Visual brainstorming companion** (`skills/brainstorming/visual-companion.md`, `skills/brainstorming/scripts/`) -- Requires Node.js server with WebSocket protocol, PID lifecycle management, Windows-specific workarounds (v5.0.3, v5.0.5 changelogs). Too heavy for our "no heavy deps" constraint.

3. **TodoWrite coupling** -- Multiple skills depend on Claude Code's TodoWrite tool for task tracking. We should use `.iago/STATE.md` instead.

4. **Executing-plans skill** (`skills/executing-plans/SKILL.md`) -- Fallback for environments without subagents. Our stack has subagents via Claude Code.

5. **Plugin marketplace distribution** -- Superpowers distributes via `/plugin install`. We have our own distribution model.

6. **Absolute TDD delete-code rule** -- "Write code before test? Delete it. Don't keep as reference. Don't look at it." This is too rigid for client prototype work. Keep TDD as default, add explicit prototype escape.

7. **`docs/superpowers/` directory convention** -- We use `.iago/` for everything. Don't adopt their directory structure.

8. **The `using-superpowers` meta-skill in its current form** -- It assumes the full Superpowers catalog. We need our own meta-instruction that's aware of iaGO commands and context.

9. **Dispatching parallel agents skill** (`skills/dispatching-parallel-agents/SKILL.md`) -- GSD already handles parallel dispatch. Not unique value.

10. **Writing-skills TDD methodology** -- Testing skills by running pressure scenarios with subagents is interesting but too process-heavy for a 3-person team maintaining a handful of instructions.

## Adaptation Notes

### Verification-before-completion -> iaGO verify phase
Incorporate as a cross-cutting rule in `CLAUDE.md` or equivalent. The rule is simple: "No completion claims without fresh verification evidence." Add the common-failures table (tests pass requires test output, build succeeds requires exit 0, etc.). This should fire before any task is marked complete in `.iago/STATE.md`.

### Two-stage review -> `.iago/reviews/`
After each task completion:
1. Dispatch spec-compliance reviewer (does code match task spec?)
2. Only if spec passes, dispatch quality reviewer (is code well-built?)
3. Write review output to `.iago/reviews/YYYY-MM-DD-<task>-review.md`
This adds persistence that Superpowers lacks.

### Rationalization prevention -> iaGO instruction writing style
When writing any iaGO instruction that enforces discipline:
- Add "violating the letter is violating the spirit" preamble
- Include excuse/reality table for known rationalizations
- Add red flags list for self-checking
- Use CSO: description says WHEN to use, not WHAT it does

### Plan task structure -> `.iago/tasks/`
Adopt the 2-5 minute task granularity and no-placeholders rule. Each task in `.iago/tasks/` should have: exact file paths, complete code or clear specification, test command with expected output, verification step. Add the self-review checklist (spec coverage, placeholder scan, type consistency) to the planning phase.

### Implementer escalation protocol -> subagent dispatch
Add DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED as standard status vocabulary for all iaGO subagent dispatches. This prevents silent failures and gives the coordinator clear signals for what to do next.

### Systematic debugging -> iaGO debugging instruction
Extract the 4-phase process and 3-fix escalation rule. This can be a standalone instruction in iaGO's execute phase. The key insight: "If 3+ fixes failed, stop fixing and question the architecture." This prevents the infinite-fix-loop that wastes agent time.

### CSO -> iaGO command metadata
When defining iaGO commands/instructions, follow Superpowers' discovery: description fields should say "Use when [triggering conditions]" not "This command does [workflow summary]." This prevents agents from following the description shortcut instead of reading the full instruction.

### Session start context injection -> iaGO init phase
Superpowers injects the `using-superpowers` meta-skill at session start via a hook. iaGO's init phase should similarly inject our meta-instruction that establishes the skill-check-before-action pattern, but scoped to iaGO's command catalog rather than Superpowers'.
