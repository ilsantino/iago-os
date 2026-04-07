# Skills & Agents Pattern Extraction

Pure extraction from research. No opinions, no recommendations.

---

## 1. Community Skills Inventory

### Workflow/Methodology

| # | Skill Name | Source Repo | Source Path | What It Does (1 sentence) | Triggering Conditions | Line Count | Dependencies |
|---|-----------|-------------|-------------|--------------------------|----------------------|------------|-------------|
| 1 | brainstorming | Superpowers | `skills/brainstorming/SKILL.md` | Design exploration with Socratic questioning, proposes 2-3 approaches, writes spec to `docs/superpowers/specs/` | Auto: before any creative work | — | Visual companion (optional) |
| 2 | writing-plans | Superpowers | `skills/writing-plans/SKILL.md` | Breaks approved spec into 2-5 minute tasks with exact file paths, complete code, test commands, expected output | Auto: with approved spec | — | Approved spec from brainstorming |
| 3 | subagent-driven-development | Superpowers | `skills/subagent-driven-development/SKILL.md` | Execute plans with fresh subagent per task, two-stage review (spec then quality) | Auto: with implementation plan | — | Task tool, spec-reviewer-prompt.md, code-quality-reviewer-prompt.md |
| 4 | executing-plans | Superpowers | `skills/executing-plans/SKILL.md` | Batch execution without subagents — load plan, review, execute in batches with human checkpoints | Fallback when no subagent support | — | None |
| 5 | dispatching-parallel-agents | Superpowers | `skills/dispatching-parallel-agents/SKILL.md` | Concurrent subagent workflows for 2+ independent tasks | Auto: 2+ independent tasks | — | None |
| 6 | verification-before-completion | Superpowers | `skills/verification-before-completion/SKILL.md` | No completion claims without fresh verification evidence — run command, read output, THEN claim result | Auto: before any success claim (always, cross-cutting) | — | None |
| 7 | using-superpowers | Superpowers | `skills/using-superpowers/SKILL.md` | Meta-skill: establishes skill system, priority rules, red flags | Auto-injected at session start via hook | — | Full Superpowers skill catalog |
| 8 | writing-skills | Superpowers | `skills/writing-skills/SKILL.md` | TDD for skill documentation, includes CSO concept and rationalization-table methodology | Manual: when creating skills | — | Subagent pressure scenarios |
| 9 | using-git-worktrees | Superpowers | `skills/using-git-worktrees/SKILL.md` | Creates isolated workspace on new branch, auto-detects project type, verifies clean test baseline | Auto: before implementation | — | Git worktree system |
| 10 | finishing-a-development-branch | Superpowers | `skills/finishing-a-development-branch/SKILL.md` | Verify tests, present 4 options (merge/PR/keep/discard), cleanup worktree | Auto: when tasks complete | — | Worktree pattern |
| 11 | verification-loop | ECC | `skills/verification-loop/SKILL.md` | Build > typecheck > lint > test > security verification pipeline | Not specified | — | None |
| 12 | deep-research | ECC | `skills/deep-research/SKILL.md` | Multi-source research workflow | Not specified | — | None |
| 13 | codebase-onboarding | ECC | `skills/codebase-onboarding/SKILL.md` | Rapid codebase understanding | Not specified | — | None |
| 14 | search-first | ECC | `skills/search-first/SKILL.md` | Search before creating to avoid duplication | Not specified | — | None |
| 15 | repo-scan | ECC | `skills/repo-scan/SKILL.md` | Repository structure analysis | Not specified | — | None |
| 16 | product-lens | ECC | `skills/product-lens/SKILL.md` | Product thinking for developers | Not specified | — | None |
| 17 | git-workflow | ECC | `skills/git-workflow/SKILL.md` | Git branching, PR, and merge patterns | Not specified | — | None |
| 18 | prompt-optimizer | ECC | `skills/prompt-optimizer/SKILL.md` | Optimize prompts for LLMs | Not specified | — | None |
| 19 | agentic-engineering | ECC | `skills/agentic-engineering/SKILL.md` | Patterns for building AI agents | Not specified | — | None |

### Code Quality

| # | Skill Name | Source Repo | Source Path | What It Does (1 sentence) | Triggering Conditions | Line Count | Dependencies |
|---|-----------|-------------|-------------|--------------------------|----------------------|------------|-------------|
| 20 | test-driven-development | Superpowers | `skills/test-driven-development/SKILL.md` | RED-GREEN-REFACTOR pipeline with iron law: no production code without failing test first | Auto: during any implementation | — | 11-entry rationalization table |
| 21 | requesting-code-review | Superpowers | `skills/requesting-code-review/SKILL.md` | Dispatch code-reviewer agent with git SHA range, structured severity output (Critical/Important/Minor) | Manual/workflow trigger | — | code-reviewer.md agent template |
| 22 | receiving-code-review | Superpowers | `skills/receiving-code-review/SKILL.md` | Technical evaluation of feedback with anti-performative-agreement and YAGNI check | Auto: when receiving review | — | None |
| 23 | systematic-debugging | Superpowers | `skills/systematic-debugging/SKILL.md` | 4-phase process: root cause investigation, pattern analysis, hypothesis testing, implementation; 3+ failed fixes = question architecture | Auto: any bug or failure | — | None |
| 24 | tdd-workflow | ECC | `skills/tdd-workflow/SKILL.md` | TDD with 80% coverage target, unit/integration/E2E | Not specified | — | None |
| 25 | coding-standards | ECC | `skills/coding-standards/SKILL.md` | Universal TS/JS/React standards, KISS/DRY/YAGNI principles | Not specified | — | None |
| 26 | security-review | ECC | `skills/security-review/SKILL.md` | Security checklist: secrets, input validation, XSS, CSRF | Not specified | — | None |
| 27 | security-scan | ECC | `skills/security-scan/SKILL.md` | Automated security scanning | Not specified | — | None |
| 28 | safety-guard | ECC | `skills/safety-guard/SKILL.md` | AI safety patterns | Not specified | — | None |
| 29 | eval-harness | ECC | `skills/eval-harness/SKILL.md` | Evaluation harness for agents | Not specified | — | None |

### Architecture

| # | Skill Name | Source Repo | Source Path | What It Does (1 sentence) | Triggering Conditions | Line Count | Dependencies |
|---|-----------|-------------|-------------|--------------------------|----------------------|------------|-------------|
| 30 | frontend-patterns | ECC | `skills/frontend-patterns/SKILL.md` | React component patterns, state management, data fetching, forms | Not specified | — | None |
| 31 | backend-patterns | ECC | `skills/backend-patterns/SKILL.md` | REST API, repository pattern, service layer, caching | Not specified | — | None |
| 32 | api-design | ECC | `skills/api-design/SKILL.md` | REST API design: resources, status codes, pagination, versioning | Not specified | — | None |
| 33 | mcp-server-patterns | ECC | `skills/mcp-server-patterns/SKILL.md` | Build MCP servers with Node/TS SDK | Not specified | — | None |
| 34 | architecture-decision-records | ECC | `skills/architecture-decision-records/SKILL.md` | ADR documentation | Not specified | — | None |
| 35 | design-system | ECC | `skills/design-system/SKILL.md` | Design system patterns | Not specified | — | None |
| 36 | claude-api | ECC | `skills/claude-api/SKILL.md` | Claude API patterns (Python + TS), streaming, tool use, vision | Not specified | — | None |

### Context Management

| # | Skill Name | Source Repo | Source Path | What It Does (1 sentence) | Triggering Conditions | Line Count | Dependencies |
|---|-----------|-------------|-------------|--------------------------|----------------------|------------|-------------|
| 37 | strategic-compact | ECC | `skills/strategic-compact/SKILL.md` | Manual compaction at logical task boundaries | Not specified | — | None |
| 38 | context-budget | ECC | `skills/context-budget/SKILL.md` | Token budget management | Not specified | — | None |
| 39 | token-budget-advisor | ECC | `skills/token-budget-advisor/SKILL.md` | Token budget recommendations | Not specified | — | None |
| 40 | content-hash-cache-pattern | ECC | `skills/content-hash-cache-pattern/SKILL.md` | Content-addressable caching | Not specified | — | None |

### Operations

| # | Skill Name | Source Repo | Source Path | What It Does (1 sentence) | Triggering Conditions | Line Count | Dependencies |
|---|-----------|-------------|-------------|--------------------------|----------------------|------------|-------------|
| 41 | e2e-testing | ECC | `skills/e2e-testing/SKILL.md` | E2E with Playwright | Not specified | — | None |
| 42 | database-migrations | ECC | `skills/database-migrations/SKILL.md` | Schema migration patterns | Not specified | — | None |
| 43 | docker-patterns | ECC | `skills/docker-patterns/SKILL.md` | Docker development patterns | Not specified | — | None |
| 44 | deployment-patterns | ECC | `skills/deployment-patterns/SKILL.md` | CI/CD and deployment patterns | Not specified | — | None |
| 45 | cost-aware-llm-pipeline | ECC | `skills/cost-aware-llm-pipeline/SKILL.md` | Cost-optimized LLM pipelines | Not specified | — | None |

### Meta/Discipline

| # | Skill Name | Source Repo | Source Path | What It Does (1 sentence) | Triggering Conditions | Line Count | Dependencies |
|---|-----------|-------------|-------------|--------------------------|----------------------|------------|-------------|
| 46 | continuous-learning | ECC | `skills/continuous-learning/` | Extract patterns from sessions | Not specified | — | Complex, over-engineered |
| 47 | continuous-learning-v2 | ECC | `skills/continuous-learning-v2/` | Observation-based learning with bash hooks | Not specified | — | Bash observer hooks |

### GSD Workflow Skills (slash commands, not SKILL.md files)

| # | Skill Name | Source Repo | Source Path | What It Does (1 sentence) | Triggering Conditions | Line Count | Dependencies |
|---|-----------|-------------|-------------|--------------------------|----------------------|------------|-------------|
| 48 | /gsd:quick | GSD | `get-shit-done/workflows/quick.md` | Lightweight planned execution: 10-step process with optional discuss/research/full flags, single plan with 1-3 tasks | Manual invocation with flags | — | Active project (ROADMAP.md) |
| 49 | /gsd:fast | GSD | `get-shit-done/workflows/fast.md` | Inline trivial tasks: ≤3 file edits, ≤1 minute, no subagent, no PLAN.md | Manual invocation | — | None |
| 50 | /gsd:do | GSD | `get-shit-done/workflows/do.md` | Intent-based dispatcher: takes freeform text, routes to best GSD command | Manual invocation | — | All GSD workflows |

**Total: 50 skills cataloged across 4 repos**

---

## 2. Overlap Map

| Overlap Area | Repo A Skill | Repo B Skill | Key Difference |
|-------------|-------------|-------------|----------------|
| **Verification loops** | ECC `verification-loop` (build > typecheck > lint > test > security) | Superpowers `verification-before-completion` (run command, read output, THEN claim) | ECC is a technical pipeline; Superpowers is a behavioral discipline (no claims without evidence) |
| **Context compaction** | ECC `strategic-compact` (manual at logical boundaries) | DECISION-hooks.md `context-persistence.mjs` PreCompact (token% + decision extraction + bridge file) | Hook covers automated compaction with structured snapshots; ECC skill is manual trigger guidance |
| **Context budget** | ECC `context-budget` + `token-budget-advisor` | DECISION-hooks.md `context-monitor.mjs` (80%/90% threshold warnings) + `statusline.mjs` (context % display) | Hooks cover runtime monitoring; ECC skills are advisory/planning |
| **Security review** | ECC `security-review` (manual checklist: secrets, XSS, CSRF) | ECC `security-scan` (automated scanning) | Review is manual checklist; scan is automated tooling |
| **Security — destructive commands** | ECC `safety-guard` (AI safety patterns) | DECISION-hooks.md `safety-guard.mjs` (13 destructive patterns + 17 secret regexes + 4 injection patterns) | Hook covers runtime blocking; skill is advisory patterns |
| **TDD** | ECC `tdd-workflow` (80% coverage, unit/integration/E2E) | Superpowers `test-driven-development` (iron law RED-GREEN-REFACTOR, rationalization table with 11 excuses) | ECC is coverage-target oriented; Superpowers is discipline-oriented with anti-rationalization |
| **Research** | ECC `deep-research` (multi-source research workflow) | GSD `gsd-phase-researcher` + `gsd-project-researcher` agents (focused/parallel research) | ECC is a single skill; GSD uses specialized agents in parallel (4x researchers + synthesizer) |
| **Planning** | Superpowers `writing-plans` (2-5 min tasks, exact file paths) | GSD `gsd-planner` agent (PLAN.md with 8-point verification, waves, dependencies) | Superpowers produces human-readable task lists; GSD produces machine-verifiable plans with frontmatter |
| **Plan verification** | Superpowers two-stage review (spec compliance then quality) | GSD `gsd-plan-checker` (8 verification dimensions, max 3 iterations) | Superpowers verifies implementation; GSD verifies the plan itself before execution |
| **Code review** | Superpowers `requesting-code-review` (dispatch agent with SHA range) | ECC `code-reviewer` agent (Bash tool for git diff) | Superpowers uses severity categories (Critical/Important/Minor); ECC uses agent with tool access |
| **Post-edit formatting** | ECC `post-edit-format.js` hook (Biome/Prettier auto-detect) | DECISION-hooks.md `post-edit-format.mjs` (Biome only, hardcoded) | Hook decision narrowed to Biome-only for our stack |
| **Post-edit typecheck** | ECC `post-edit-typecheck.js` hook (tsc filtered to file) | DECISION-hooks.md `post-edit-typecheck.mjs` (tsc filtered to file, tsconfig cache) | Nearly identical; hook version adds tsconfig caching |
| **Console warning** | ECC `post-edit-console-warn.js` hook | DECISION-hooks.md `post-edit-console-warn.mjs` (exit 0, non-blocking) | Identical pattern adopted |
| **Commit quality** | ECC `pre-bash-commit-quality.js` (staged secrets, debugger, console.log, conventional commits) | DECISION-hooks.md `commit-quality.mjs` (conventional prefix, 72-char, staged secret scan, console.log) | Hook adopts ECC pattern with stack-specific refinements |
| **Config protection** | ECC `config-protection.js` (blocks linter config edits) | DECISION-hooks.md `config-protection.mjs` (expanded denylist for React 19/Vite/Biome/Tailwind) | Hook expands ECC's denylist for our specific stack |
| **Cost tracking** | ECC `cost-tracker.js` (per-response, model rates) | DECISION-hooks.md `context-persistence.mjs` Stop event (per-session, flat-rate, client-tagged) | Hook uses per-session JSONL with client attribution instead of per-response model pricing |
| **Codebase onboarding** | ECC `codebase-onboarding` | ECC `repo-scan` | Onboarding is understanding-oriented; repo-scan is structure-oriented |
| **Debugging** | Superpowers `systematic-debugging` (4-phase, 3+ fails = question architecture) | GSD analysis paralysis guard (5+ reads without write = STOP) | Superpowers is a methodology; GSD is a hard behavioral constraint |

---

## 3. Agent Inventory

| # | Agent Name | Source Repo | Model | Tools Allowed | Role | Key Behavioral Rule | Format |
|---|-----------|-------------|-------|--------------|------|---------------------|--------|
| 1 | architect | ECC | opus | Read, Grep, Glob | Software architecture specialist | Read-only — no code modification | MD + YAML frontmatter |
| 2 | planner | ECC | opus | Not specified | Implementation planning | Complex reasoning tasks | MD + YAML frontmatter |
| 3 | code-reviewer | ECC | sonnet | Includes Bash (git diff) | Code quality review | Git diff access for targeted review | MD + YAML frontmatter |
| 4 | security-reviewer | ECC | sonnet | Not specified | Security audit | Security-focused analysis | MD + YAML frontmatter |
| 5 | tdd-guide | ECC | sonnet | Full (Edit, Write, etc.) | TDD workflow enforcement | Active code modification allowed | MD + YAML frontmatter |
| 6 | e2e-runner | ECC | sonnet | Full (Edit, Write, etc.) | Playwright testing | Active code modification allowed | MD + YAML frontmatter |
| 7 | build-error-resolver | ECC | sonnet | Not specified | Vite/TS error resolution | Error-focused debugging | MD + YAML frontmatter |
| 8 | typescript-reviewer | ECC | sonnet | Not specified | TypeScript-specific review | TS-focused analysis | MD + YAML frontmatter |
| 9 | doc-updater | ECC | sonnet | Not specified | Documentation maintenance | Documentation-focused | MD + YAML frontmatter |
| 10 | coder | Ruflo | Not per-agent (global settings.json) | Not per-agent (global agent_skills) | Code implementation specialist | — | MD + YAML frontmatter (`name`, `description`) |
| 11 | planner | Ruflo | Not per-agent | Not per-agent | Strategic planning, task decomposition | — | MD + YAML frontmatter |
| 12 | researcher | Ruflo | Not per-agent | Not per-agent | Research and analysis | — | MD + YAML frontmatter |
| 13 | reviewer | Ruflo | Not per-agent | Not per-agent | Code review and quality assurance | — | MD + YAML frontmatter |
| 14 | tester | Ruflo | Not per-agent | Not per-agent | Testing specialist | — | MD + YAML frontmatter |
| 15 | architect | Ruflo | Not per-agent (YAML format) | Uses `capabilities[]` field | System design (Codex CLI format) | — | YAML (`type`, `version`, `capabilities`, `optimizations`) |
| 16 | hierarchical-coordinator | Ruflo | Not per-agent | Not per-agent | Swarm coordination across hierarchical teams | Overkill for 3-person team | MD in `.claude/agents/swarm/` |
| 17 | queen-coordinator | Ruflo | Not per-agent | Not per-agent | Hive-mind leader for swarm intelligence | Enterprise swarm pattern, overkill | MD in `.claude/agents/hive-mind/` |
| 18 | gsd-project-researcher | GSD | Config profile (quality/balanced/budget) | Config agent_skills | Runs 4x parallel for initial project research | Part of parallel researcher wave | MD + YAML frontmatter |
| 19 | gsd-research-synthesizer | GSD | Config profile | Config agent_skills | Synthesizes output from 4x parallel researchers | Receives all researcher results | MD + YAML frontmatter |
| 20 | gsd-roadmapper | GSD | Config profile | Config agent_skills | Creates ROADMAP.md from synthesized research | User approval gate before STATE.md | MD + YAML frontmatter |
| 21 | gsd-phase-researcher | GSD | Haiku (budget) | Read/Grep/Glob focus | Focused research on current phase context | Optional; ~10% context budget | MD + YAML frontmatter |
| 22 | gsd-planner | GSD | Opus (quality) | Config agent_skills | Creates PLAN.md with 8-point task breakdown | Context budget ~30-40% | MD + YAML frontmatter |
| 23 | gsd-plan-checker | GSD | Opus (quality) | Config agent_skills | Verifies plans against 8 dimensions before execution | Max 3 iterations; blocks proceed on failure | MD + YAML frontmatter |
| 24 | gsd-executor | GSD | Sonnet (balanced) | Full (Edit, Write, Bash, git) with guards | Executes a single plan autonomously | Analysis paralysis guard: 5+ reads without write = STOP; 3 fix attempts max | MD + YAML frontmatter |
| 25 | gsd-verifier | GSD | Opus (quality) | Config agent_skills | Goal-backward verification of completed work | 3-level check: truths, artifacts, wiring; status routing (passed/gaps/human) | MD + YAML frontmatter |
| 26 | implementer | Superpowers | Dynamic (by task complexity) | Full context + code access | Gets full task text + architectural context, implements per plan | Must report DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED; must self-review | MD prompt template |
| 27 | spec-reviewer | Superpowers | Dynamic (most capable for review) | Code reading | Independently verifies implementation matches spec | "Do not trust the implementer report" — must read actual code | MD prompt template |
| 28 | code-quality-reviewer | Superpowers | Dynamic (most capable for review) | Git (SHA range) | Evaluates code quality after spec compliance passes | Only runs AFTER spec compliance; severity: Critical/Important/Minor | MD prompt template |
| 29 | code-reviewer | Superpowers | Dynamic (by complexity) | Git (SHA range), code reading | Structured code review template with severity categorization | Fix-before-proceeding gates | MD agent template |

**Total: 29 agents cataloged across 4 repos**

---

## 4. Agent Format Comparison

| Aspect | ECC | Ruflo | GSD | Superpowers |
|--------|-----|-------|-----|-------------|
| **File format** | Markdown (`.md`) | Markdown (`.md`) + alternative YAML (`.yaml`) | Markdown (`.md`) | Markdown (`.md`) |
| **Frontmatter fields** | `name`, `description`, `tools`, `model` | `name`, `description` (minimal) | YAML frontmatter with agent metadata (not fully enumerated) | No standard frontmatter — prompt templates |
| **Model specification** | Per-agent field: `model: opus\|sonnet\|haiku` | Global in `settings.json` (`"model": "claude-opus-4-6"`), NOT per-agent | Config `model-profiles` with tiers: `quality`/`balanced`/`budget`/`inherit` | Dynamic by task complexity: cheap (mechanical) / standard (integration) / most capable (architecture/review) |
| **Tool restriction method** | Allowlist array: `tools: ["Read", "Grep", "Glob"]` | Global `permissions.allow/deny` in settings.json, NOT per-agent | `agent_skills` feature flags in config.json | Implicit via prompt design (what context is provided limits available tools) |
| **System prompt style** | Markdown prose body after frontmatter | Markdown prompt template body | Self-contained per agent with own prompt, constraints, output format | Narrative prompt templates (implementer-prompt.md, spec-reviewer-prompt.md) |
| **Location in repo** | `agents/*.md` | `.claude/agents/core/*.md` (also `/swarm/`, `/hive-mind/`, `/v3/`, `/dual-mode/`) | `agents/*.md` (project root) | `skills/<skill>/` directory (agents embedded in skill definitions), `agents/code-reviewer.md` |

---

## 5. Agent Behavioral Patterns

### Superpowers Escalation Protocol

**Source:** `skills/subagent-driven-development/SKILL.md` (lines 103-118), `implementer-prompt.md`

| Status | Meaning | Invoking Agent Response |
|--------|---------|------------------------|
| **DONE** | All requirements complete, spec verified, tests passing, no issues | Accept and proceed to next task |
| **DONE_WITH_CONCERNS** | Requirements met but minor issues present (fixable in polish phase) | Decide: proceed or request fixes from same implementer |
| **NEEDS_CONTEXT** | Missing information blocks progress (unclear spec, architectural questions) | Provide more context, clarify spec, or escalate if architectural decision needed |
| **BLOCKED** | External blocker (dependency unavailable, test env down, access required) | Escalate to human; never force retry without changes (line 67) |

### GSD Analysis Paralysis Guard

**Exact heuristic:**
> "During task execution, if you make 5+ consecutive Read\Grep\Glob calls without any Edit\Write\Bash action: STOP."

**Secondary limit:** After 3 auto-fix attempts on a single task, stop fixing and move on.

**Deviation rules:**
- Auto-fix: bugs, missing critical functionality, blocking issues
- Ask: architectural changes
- Limit: 3 attempts max (prevents infinite fix loops)

**Enforcement location:** `agents/gsd-executor.md`, `<analysis_paralysis_guard>` section — built directly into the executor agent's system prompt.

### GSD Plan-Checker

**What it checks — 8 verification dimensions:**
1. `must_haves` frontmatter: `truths`, `artifacts`, `key_links`
2. Task-level field: `files` (which files affected)
3. Task-level field: `action` (what to do)
4. Task-level field: `verify` (how to verify)
5. Task-level field: `done` (completion signal)
6. Wave/dependency metadata (task ordering, parallelization groups)
7. Requirement ID traceability (linking back to ROADMAP.md)
8. Nyquist validation — automated test mapping

**When it runs:** After planner produces PLAN.md, in a loop capped at 3 iterations. Can be skipped with `--skip-check` or re-run with `--recheck`.

**Interaction with executor:** Plan-checker runs BEFORE executor. Only after plan passes verification does orchestrator spawn executor agents. Executor receives verified plan with all required fields populated and uses wave/dependency metadata for parallelization grouping.

### Superpowers Two-Stage Review

**Stage 1 — Spec-Compliance Review:**
- Agent: spec-reviewer (via `spec-reviewer-prompt.md`)
- Checks: Does implementation match approved spec? (exact requirements, not under/over-built)
- Tools: Code reading (must read actual files)
- Critical rule: "Do not trust the implementer report" — must independently verify
- Runs FIRST

**Stage 2 — Code-Quality Review:**
- Agent: code-quality-reviewer (via `code-quality-reviewer-prompt.md`, uses `agents/code-reviewer.md` template)
- Checks: Code quality (maintainability, patterns, performance, clarity, testing, documentation)
- Tools: Git (SHA range for targeted diff review)
- Output: Structured severity — Critical / Important / Minor
- Only runs AFTER spec compliance passes

**Sequential flow:**
1. Implementer completes task → reports status
2. Spec reviewer runs independently → verifies against spec
3. If spec review fails → return to implementer, repeat until approved
4. If spec review passes → code quality reviewer begins
5. If quality review finds issues → same implementer fixes, re-review
6. Both pass → task complete

**Rationale (line 64):** "This prevents wasting quality review on code that doesn't even meet spec."

### Superpowers CSO (Claude Search Optimization)

**Core principle:** Description fields should specify **when to use**, NOT what the command does. Prevents agents from reading the shortcut description and skipping the full instruction.

**Pattern:**
```
Description = "Use when [triggering conditions/context], not when [exclusion conditions]"
```

**Before/after examples (implied):**
- Bad: "Brainstorming skill explores context and proposes approaches"
- Good: "Use when starting a new design discussion, not when modifying existing code"
- Bad: "Writing-plans skill breaks specs into tasks"
- Good: "Use when you have an approved spec and need to plan implementation, not when spec is still in discussion"

**Applicability:** "Directly applicable to iaGO command metadata" (line 216 of analysis).

---

## 6. Skills Already Handled by Hooks

Cross-reference with `.iago/research/DECISION-hooks.md`:

| Skill | Source | Covered By Hook | Skip Reason |
|-------|--------|----------------|-------------|
| strategic-compact | ECC | `context-persistence.mjs` (PreCompact) — structured token + decision extraction to session snapshot | Hook automates what the skill advises manually |
| context-budget | ECC | `context-monitor.mjs` (PostToolUse) — 80%/90% threshold warnings with debounce | Hook provides runtime monitoring with injection |
| token-budget-advisor | ECC | `context-monitor.mjs` + `statusline.mjs` — context % display + threshold warnings | Hook handles advisory function automatically |
| safety-guard | ECC | `safety-guard.mjs` (PreToolUse Bash) — 13 destructive patterns, 17 secret regexes, 4 injection patterns | Hook blocks at runtime; skill is advisory |
| security-scan | ECC | `safety-guard.mjs` (PreToolUse Bash) — secret detection in commands + `commit-quality.mjs` staged secret scan | Hook covers runtime + commit-time scanning |
| verification-loop (format step) | ECC | `post-edit-format.mjs` (PostToolUse Edit) — Biome auto-format on every edit | Hook runs automatically after every edit |
| verification-loop (typecheck step) | ECC | `post-edit-typecheck.mjs` (PostToolUse Edit) — tsc filtered to edited file | Hook runs automatically after every edit |
| verification-loop (console step) | ECC | `post-edit-console-warn.mjs` (PostToolUse Edit) — console.* detection | Hook warns automatically after every edit |
| coding-standards (linting subset) | ECC | `post-edit-format.mjs` + `config-protection.mjs` — auto-format + block config edits | Hook enforces standards at edit time; blocks weakening |
| cost-aware-llm-pipeline (tracking subset) | ECC | `context-persistence.mjs` (Stop) — per-session utilization to costs.jsonl | Hook tracks tokens, duration, tools, client automatically |
| continuous-learning | ECC | `context-persistence.mjs` (PreCompact + Stop) — decision extraction via markers | Hook extracts decisions/patterns per session automatically |
| continuous-learning-v2 | ECC | `context-persistence.mjs` (PreCompact + Stop) — observation-based state capture | Hook captures session state without bash observers |

---

## 7. Our Stack Filter

Skills or agents referencing technologies we do NOT use:

| Skill/Agent | References | Our Equivalent |
|-------------|-----------|----------------|
| ECC `docker-patterns` | Docker, Dockerfile, docker-compose | AWS Amplify Gen 2 (managed hosting) — may still use Docker for Lambda containers |
| ECC `database-migrations` | Generic schema migrations (implies SQL/ORM) | DynamoDB single-table design (no schema migrations); pgvector only in specific cases |
| ECC `backend-patterns` | Repository pattern, service layer, REST (generic) | API Gateway + Lambda + DynamoDB single-table; patterns need adaptation |
| ECC `deployment-patterns` | Generic CI/CD | AWS Amplify Gen 2 deployment pipeline |
| ECC `claude-api` | Python + TS patterns | TS only (Python only in Lambda/LangGraph contexts) |
| ECC `mcp-server-patterns` | Node/TS SDK | Relevant — keep as-is |
| Ruflo `architect` (YAML format) | Codex CLI integration (`type`, `version`, `capabilities`) | Claude Code agents only — Codex CLI format not applicable |
| Ruflo `codex-coordinator` | OpenAI Codex dual-mode | Not used — we use Claude SDK only |
| Ruflo `v3-integration-architect` | Ruflo v3 framework | Not applicable — Ruflo-specific |
| Ruflo `hierarchical-coordinator` | Enterprise swarm pattern | Overkill for 3-person team |
| Ruflo `queen-coordinator` | Enterprise hive-mind pattern | Overkill for 3-person team |
| ECC golang-*, python-*, rust-*, swift-*, kotlin-*, java-*, perl-*, php-*, cpp-*, csharp skills | Go, Python, Rust, Swift, Kotlin, Java, Perl, PHP, C++, C# | Not applicable (100+ skills skipped) |
| ECC django-*, laravel-*, springboot-*, nuxt4-*, nextjs-turbopack skills | Django, Laravel, Spring Boot, Nuxt, Next.js | React 19 + Vite (no meta-frameworks) |
| ECC go-*, python-*, rust-*, kotlin-*, java-*, flutter-*, cpp-* agents | Non-JS/TS languages | Not applicable |
| ECC healthcare-*, pytorch-* agents | Healthcare PHI, PyTorch | Not applicable |
| Superpowers `using-git-worktrees` | Git worktree system | Not used in our workflow |
| Superpowers `finishing-a-development-branch` | Tightly coupled to worktree pattern | Not applicable without worktrees |
| Superpowers `dispatching-parallel-agents` | Assumes TodoWrite tool (deprecated/renamed) | Claude Code Task tool is the equivalent |
