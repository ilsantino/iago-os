# iaGO-OS Build Order & File Manifest

> Date: 2026-04-01
> Sprint: 5 — Phase 3 (Logistics)
> All design decisions are final. This document sequences implementation only.

---

## Phase Dependency Diagram

```
Phase 0 (research + CLAUDE.md) ← DONE
    │
    ├─► 1A (scaffold + hook utilities)
    │       │
    │       └─► 1B (hooks + settings.json wiring)
    │               │
    │               ▼ ── BLOCKING VALIDATION: hooks fire, $CLAUDE_PROJECT_DIR resolves ──
    │
    ├─► 2A (rules files)              ◄── parallel with 1A/1B
    │       │
    │       └─► 2B (agent definitions) ◄── agents reference rules
    │               │
    │               ▼ ── BLOCKING VALIDATION: agent dispatch works ──
    │
    ├─► 3A (workflow skills: init, discuss, plan, execute, verify, fast, quick, pause)
    │       │                          ◄── depends on 2A + 2B
    │       │
    │       ▼ ── BLOCKING VALIDATION: /iago:init creates artifacts ──
    │
    ├─► 3B (core feature skills)      ◄── depends on 2B (dispatches agents)
    │
    ├─► 4A (content + experimental)   ◄── depends on 1A only (standalone skills)
    │
    └─► 4B (industry skills)          ◄── depends on 1A only (standalone skills)
```

**Parallelism:** 1A→1B (hooks) and 2A→2B (rules+agents) can run in parallel.
Phases 4A and 4B can run in parallel with everything after 1A.

---

## Complete File Manifest

### Hook System

| # | Path | Category | Source | Lines | Phase |
|---|------|----------|--------|-------|-------|
| 1 | `.iago/hooks/lib/stdin.mjs` | utility | DECISION-hooks.md §12 | ~20 | 1A |
| 2 | `.iago/hooks/lib/flags.mjs` | utility | DECISION-hooks.md §12 | ~15 | 1A |
| 3 | `.iago/hooks/lib/transcript.mjs` | utility | DECISION-hooks.md §12 | ~80 | 1A |
| 4 | `.iago/hooks/statusline.mjs` | hook | DECISION-hooks.md §8 | ~90 | 1B |
| 5 | `.iago/hooks/context-persistence.mjs` | hook | DECISION-hooks.md §2 | ~280 | 1B |
| 6 | `.iago/hooks/context-monitor.mjs` | hook | DECISION-hooks.md §6 | ~60 | 1B |
| 7 | `.iago/hooks/post-edit-format.mjs` | hook | DECISION-hooks.md §3 | ~50 | 1B |
| 8 | `.iago/hooks/post-edit-typecheck.mjs` | hook | DECISION-hooks.md §3 | ~80 | 1B |
| 9 | `.iago/hooks/post-edit-console-warn.mjs` | hook | DECISION-hooks.md §3 | ~45 | 1B |
| 10 | `.iago/hooks/config-protection.mjs` | hook | DECISION-hooks.md §3 | ~100 | 1B |
| 11 | `.iago/hooks/safety-guard.mjs` | hook | DECISION-hooks.md §4 | ~180 | 1B |
| 12 | `.iago/hooks/commit-quality.mjs` | hook | DECISION-hooks.md §4 | ~120 | 1B |

### Config

| # | Path | Category | Source | Lines | Phase |
|---|------|----------|--------|-------|-------|
| 13 | `.iago/.gitignore` | config | DECISION-workflow.md §2 | ~3 | 1A |
| 14 | `.claude/settings.json` | config | DECISION-hooks.md §10 | ~100 | 1B |
| 15 | `CLAUDE.md` | config | DECISION-claude-md.md | ~105 | **DONE** |

### Rules Files

| # | Path | Category | Source | Lines | Phase |
|---|------|----------|--------|-------|-------|
| 16 | `.claude/rules/tdd.md` | rule (always-on) | DECISION-skills.md §2 | ~40 | 2A |
| 17 | `.claude/rules/systematic-debugging.md` | rule (always-on) | DECISION-skills.md §3 | ~30 | 2A |
| 18 | `.claude/rules/available-skills.md` | rule (always-on) | DECISION-skills-agents.md §2 | ~40 | 2A |
| 19 | `.claude/rules/git-workflow.md` | rule (always-on) | DECISION-discipline.md | ~20 | 2A |
| 20 | `.claude/rules/e2e-testing.md` | rule (path-scoped) | DECISION-skills.md §11 | ~35 | 2A |
| 21 | `.claude/rules/mcp-server-patterns.md` | rule (path-scoped) | DECISION-skills.md §12 | ~30 | 2A |
| 22 | `.claude/rules/react-vite.md` | rule (path-scoped) | DECISION-discipline.md | ~25 | 2A |
| 23 | `.claude/rules/aws-amplify.md` | rule (path-scoped) | DECISION-discipline.md | ~30 | 2A |

### Agent Definitions

| # | Path | Category | Source | Lines | Phase |
|---|------|----------|--------|-------|-------|
| 24 | `.claude/agents/implementer.md` | agent | DECISION-agents.md | ~65 | 2B |
| 25 | `.claude/agents/code-reviewer.md` | agent | DECISION-agents.md | ~55 | 2B |
| 26 | `.claude/agents/spec-reviewer.md` | agent | DECISION-agents.md | ~50 | 2B |
| 27 | `.claude/agents/code-quality-reviewer.md` | agent | DECISION-agents.md | ~55 | 2B |
| 28 | `.claude/agents/researcher.md` | agent | DECISION-agents.md | ~55 | 2B |
| 29 | `.claude/agents/tdd-guide.md` | agent | DECISION-agents.md | ~60 | 2B |
| 30 | `.claude/agents/build-error-resolver.md` | agent | DECISION-agents.md | ~60 | 2B |
| 31 | `.claude/agents/e2e-runner.md` | agent | DECISION-agents.md | ~60 | 2B |

### Workflow Skills (/iago:* commands)

| # | Path | Category | Source | Lines | Phase |
|---|------|----------|--------|-------|-------|
| 32 | `.claude/skills/iago-init/SKILL.md` | skill (workflow) | DECISION-workflow.md §1, §11 | ~80 | 3A |
| 33 | `.claude/skills/iago-discuss/SKILL.md` | skill (workflow) | DECISION-workflow.md §1 | ~60 | 3A |
| 34 | `.claude/skills/iago-plan/SKILL.md` | skill (workflow) | DECISION-workflow.md §1, §4 | ~90 | 3A |
| 35 | `.claude/skills/iago-execute/SKILL.md` | skill (workflow) | DECISION-workflow.md §1, §5 | ~85 | 3A |
| 36 | `.claude/skills/iago-verify/SKILL.md` | skill (workflow) | DECISION-workflow.md §1 | ~70 | 3A |
| 37 | `.claude/skills/iago-fast/SKILL.md` | skill (workflow) | DECISION-workflow.md §7 | ~50 | 3A |
| 38 | `.claude/skills/iago-quick/SKILL.md` | skill (workflow) | DECISION-workflow.md §7 | ~60 | 3A |
| 39 | `.claude/skills/iago-pause/SKILL.md` | skill (workflow) | DECISION-discipline.md §8 | ~40 | 3A |

### Core Feature Skills

| # | Path | Category | Source | Lines | Phase |
|---|------|----------|--------|-------|-------|
| 40 | `.claude/skills/brainstorming/SKILL.md` | skill (core) | DECISION-skills.md §4 | ~50 | 3B |
| 41 | `.claude/skills/writing-plans/SKILL.md` | skill (core) | DECISION-skills.md §5 | ~45 | 3B |
| 42 | `.claude/skills/subagent-driven-development/SKILL.md` | skill (core) | DECISION-skills.md §6 | ~60 | 3B |
| 43 | `.claude/skills/code-review/SKILL.md` | skill (core) | DECISION-skills.md §7 | ~40 | 3B |
| 44 | `.claude/skills/deep-research/SKILL.md` | skill (core) | DECISION-skills.md §9 | ~35 | 3B |
| 45 | `.claude/skills/prompt-optimizer/SKILL.md` | skill (core) | DECISION-skills.md §10 | ~30 | 3B |

### Content/Business Skills

| # | Path | Category | Source | Lines | Phase |
|---|------|----------|--------|-------|-------|
| 46 | `.claude/skills/article-writing/SKILL.md` | skill | DECISION-skills.md C1 | ~30 | 4A |
| 47 | `.claude/skills/content-engine/SKILL.md` | skill | DECISION-skills.md C2 | ~35 | 4A |
| 48 | `.claude/skills/investor-materials/SKILL.md` | skill | DECISION-skills.md C3 | ~30 | 4A |
| 49 | `.claude/skills/investor-outreach/SKILL.md` | skill | DECISION-skills.md C4 | ~25 | 4A |
| 50 | `.claude/skills/market-research/SKILL.md` | skill | DECISION-skills.md C5 | ~30 | 4A |
| 51 | `.claude/skills/visa-doc-translate/SKILL.md` | skill | DECISION-skills.md C6 | ~25 | 4A |
| 52 | `.claude/skills/frontend-slides/SKILL.md` | skill | DECISION-skills.md C7 | ~30 | 4A |

### Experimental Skills

| # | Path | Category | Source | Lines | Phase |
|---|------|----------|--------|-------|-------|
| 53 | `.claude/skills/autonomous-loops/SKILL.md` | skill | DECISION-skills.md | ~35 | 4A |
| 54 | `.claude/skills/continuous-agent-loop/SKILL.md` | skill | DECISION-skills.md | ~35 | 4A |
| 55 | `.claude/skills/enterprise-agent-ops/SKILL.md` | skill | DECISION-skills.md | ~40 | 4A |
| 56 | `.claude/skills/agent-payment-x402/SKILL.md` | skill | DECISION-skills.md | ~25 | 4A |
| 57 | `.claude/skills/liquid-glass-design/SKILL.md` | skill | DECISION-skills.md | ~30 | 4A |
| 58 | `.claude/skills/santa-method/SKILL.md` | skill | DECISION-skills.md | ~30 | 4A |

### Industry Skills

| # | Path | Category | Source | Lines | Phase |
|---|------|----------|--------|-------|-------|
| 59 | `.claude/skills/healthcare-phi-compliance/SKILL.md` | skill | DECISION-skills.md | ~40 | 4B |
| 60 | `.claude/skills/carrier-relationship-management/SKILL.md` | skill | DECISION-skills.md | ~30 | 4B |
| 61 | `.claude/skills/customs/SKILL.md` | skill | DECISION-skills.md | ~35 | 4B |
| 62 | `.claude/skills/energy/SKILL.md` | skill | DECISION-skills.md | ~35 | 4B |
| 63 | `.claude/skills/logistics/SKILL.md` | skill | DECISION-skills.md | ~35 | 4B |
| 64 | `.claude/skills/inventory/SKILL.md` | skill | DECISION-skills.md | ~30 | 4B |
| 65 | `.claude/skills/production-scheduling/SKILL.md` | skill | DECISION-skills.md | ~30 | 4B |
| 66 | `.claude/skills/quality-nonconformance/SKILL.md` | skill | DECISION-skills.md | ~25 | 4B |
| 67 | `.claude/skills/returns-reverse-logistics/SKILL.md` | skill | DECISION-skills.md | ~25 | 4B |

---

## Build Phases

### Phase 1A: Scaffold + Hook Utilities
**Depends on:** nothing
**Commit:** `feat(core): scaffold .iago/ directories and hook utilities`
**Files:**
- [ ] `.iago/.gitignore` — ignores `state/` only
- [ ] `.iago/hooks/lib/stdin.mjs` — parse stdin JSON from Claude Code
- [ ] `.iago/hooks/lib/flags.mjs` — check IAGO_DISABLED_HOOKS env var
- [ ] `.iago/hooks/lib/transcript.mjs` — read transcript JSONL, extract token usage
- [ ] Create empty dirs: `.iago/state/`, `.iago/context/`, `.iago/plans/`, `.iago/summaries/`, `.iago/reviews/`
**Validation:** `node .iago/hooks/lib/stdin.mjs` doesn't crash. Directories exist.
**Est. files:** 4 | **Est. lines:** ~118

### Phase 1B: Hook Suite + Settings Wiring
**Depends on:** 1A
**Commit:** `feat(hooks): complete hook suite with settings.json wiring`
**Files:**
- [ ] `.iago/hooks/statusline.mjs` — git branch, ctx%, client, duration
- [ ] `.iago/hooks/context-persistence.mjs` — SessionStart/PreCompact/Stop lifecycle
- [ ] `.iago/hooks/context-monitor.mjs` — context usage warnings at 80%/90%
- [ ] `.iago/hooks/post-edit-format.mjs` — Biome format on Edit
- [ ] `.iago/hooks/post-edit-typecheck.mjs` — tsc --noEmit filtered to edited file
- [ ] `.iago/hooks/post-edit-console-warn.mjs` — console.* detection
- [ ] `.iago/hooks/config-protection.mjs` — block edits to protected config files
- [ ] `.iago/hooks/safety-guard.mjs` — destructive commands, secrets, injection
- [ ] `.iago/hooks/commit-quality.mjs` — conventional commits, staged secret scan
- [ ] `.claude/settings.json` — 12 hook entries across 7 event types
**Validation (BLOCKING):**
1. Start a new Claude Code session in this repo. Confirm SessionStart hook fires (check for `hookSpecificOutput` or session snapshot creation in `.iago/state/sessions/`).
2. Verify `$CLAUDE_PROJECT_DIR` resolves correctly on Windows in settings.json paths.
3. Make a test Edit to a .ts file. Confirm post-edit-format fires (Biome runs).
4. If any fails: STOP. Fix before proceeding.
**Est. files:** 10 | **Est. lines:** ~1,150

### Phase 2A: Rules Files
**Depends on:** Phase 0 (CLAUDE.md must exist)
**Commit:** `feat(rules): always-on and path-scoped rule files`
**Files:**
- [ ] `.claude/rules/tdd.md` — RED-GREEN-REFACTOR, 11 rationalization pairs, 80% coverage
- [ ] `.claude/rules/systematic-debugging.md` — 4-phase debugging, 3-fix escalation
- [ ] `.claude/rules/available-skills.md` — full skill + agent catalog for CSO matching
- [ ] `.claude/rules/git-workflow.md` — branching, PRs, merge strategy
- [ ] `.claude/rules/e2e-testing.md` — Playwright + React 19 + Vite conventions
- [ ] `.claude/rules/mcp-server-patterns.md` — Node/TS MCP SDK patterns
- [ ] `.claude/rules/react-vite.md` — React 19, ShadCN, TanStack Query patterns
- [ ] `.claude/rules/aws-amplify.md` — Amplify Gen 2, DynamoDB, Lambda, Cognito
**Validation (BLOCKING):**
1. Start Claude Code session. Ask it about TDD. Confirm it references the tdd.md rule content (not generic knowledge).
2. Edit a `.tsx` file. Confirm react-vite.md path-scoped rule loads.
**Est. files:** 8 | **Est. lines:** ~250

### Phase 2B: Agent Definitions
**Depends on:** 2A (agents reference rules like tdd.md, systematic-debugging.md)
**Commit:** `feat(agents): 8 subagent definitions`
**Files:**
- [ ] `.claude/agents/implementer.md` — execute tasks from plans, full tool access
- [ ] `.claude/agents/code-reviewer.md` — single-pass severity review, Read/Glob/Grep/Bash
- [ ] `.claude/agents/spec-reviewer.md` — spec compliance, Read/Glob/Grep only
- [ ] `.claude/agents/code-quality-reviewer.md` — quality review, Read/Glob/Grep/Bash
- [ ] `.claude/agents/researcher.md` — deep research, includes WebSearch/WebFetch
- [ ] `.claude/agents/tdd-guide.md` — RED-GREEN-REFACTOR enforcement, full tools
- [ ] `.claude/agents/build-error-resolver.md` — systematic debugging, full tools
- [ ] `.claude/agents/e2e-runner.md` — Playwright E2E tests, full tools
**Validation (BLOCKING):**
1. Dispatch `researcher` agent with a simple question. Confirm it runs on Sonnet, respects tool restrictions, and returns with escalation status.
2. If agent dispatch fails: STOP. Check YAML frontmatter format against Claude Code docs.
**Est. files:** 8 | **Est. lines:** ~460

### Phase 3A: Workflow Skills
**Depends on:** 2A + 2B (workflow skills reference agents and rules)
**Commit:** `feat(skills): iaGO workflow skills`
**Files:**
- [ ] `.claude/skills/iago-init/SKILL.md` — bootstrap .iago/, gather vision, produce PROJECT/ROADMAP/STATE/config
- [ ] `.claude/skills/iago-discuss/SKILL.md` — clarify gray areas per phase, produce context artifact
- [ ] `.claude/skills/iago-plan/SKILL.md` — break phase into plans with tasks, self-review, no-placeholders
- [ ] `.claude/skills/iago-execute/SKILL.md` — wave analysis, dispatch implementer per plan, review after
- [ ] `.claude/skills/iago-verify/SKILL.md` — goal-backward verification, produce review, ship PR if passed
- [ ] `.claude/skills/iago-fast/SKILL.md` — inline trivial tasks (≤3 files), atomic commit, STATE.md log
- [ ] `.claude/skills/iago-quick/SKILL.md` — lightweight plan → implementer → reviewer, composable flags
- [ ] `.claude/skills/iago-pause/SKILL.md` — write HANDOFF.json to .iago/state/
**Validation (BLOCKING):**
1. Run `/iago:init` in a test directory. Confirm it creates PROJECT.md, ROADMAP.md, STATE.md, config.json.
2. Confirm skills are discoverable via `/` autocomplete in Claude Code.
**Est. files:** 8 | **Est. lines:** ~535

### Phase 3B: Core Feature Skills
**Depends on:** 2B (some skills dispatch agents)
**Commit:** `feat(skills): core feature skills`
**Files:**
- [ ] `.claude/skills/brainstorming/SKILL.md` — Socratic design exploration, writes spec
- [ ] `.claude/skills/writing-plans/SKILL.md` — break spec into 2-5 min tasks
- [ ] `.claude/skills/subagent-driven-development/SKILL.md` — execute plans with fresh subagent per task
- [ ] `.claude/skills/code-review/SKILL.md` — dispatch reviewer with git SHA range
- [ ] `.claude/skills/deep-research/SKILL.md` — multi-source research with recommendation
- [ ] `.claude/skills/prompt-optimizer/SKILL.md` — optimize LLM prompts for client deliverables
**Validation:** Invoke `/brainstorming` with a test topic. Confirm it follows the skill procedure.
**Est. files:** 6 | **Est. lines:** ~260

### Phase 4A: Content/Business + Experimental Skills
**Depends on:** Phase 0 (CLAUDE.md only — these are standalone skills)
**Commit:** `feat(skills): content, business, and experimental skills`
**Files:**
- [ ] `.claude/skills/article-writing/SKILL.md`
- [ ] `.claude/skills/content-engine/SKILL.md`
- [ ] `.claude/skills/investor-materials/SKILL.md`
- [ ] `.claude/skills/investor-outreach/SKILL.md`
- [ ] `.claude/skills/market-research/SKILL.md`
- [ ] `.claude/skills/visa-doc-translate/SKILL.md`
- [ ] `.claude/skills/frontend-slides/SKILL.md`
- [ ] `.claude/skills/autonomous-loops/SKILL.md`
- [ ] `.claude/skills/continuous-agent-loop/SKILL.md`
- [ ] `.claude/skills/enterprise-agent-ops/SKILL.md`
- [ ] `.claude/skills/agent-payment-x402/SKILL.md`
- [ ] `.claude/skills/liquid-glass-design/SKILL.md`
- [ ] `.claude/skills/santa-method/SKILL.md`
**Validation:** Spot-check 2-3 skills via `/` invocation. Confirm CSO descriptions in frontmatter.
**Est. files:** 13 | **Est. lines:** ~400

### Phase 4B: Industry Skills
**Depends on:** Phase 0 (CLAUDE.md only — standalone skills)
**Commit:** `feat(skills): industry-specific skills`
**Files:**
- [ ] `.claude/skills/healthcare-phi-compliance/SKILL.md`
- [ ] `.claude/skills/carrier-relationship-management/SKILL.md`
- [ ] `.claude/skills/customs/SKILL.md`
- [ ] `.claude/skills/energy/SKILL.md`
- [ ] `.claude/skills/logistics/SKILL.md`
- [ ] `.claude/skills/inventory/SKILL.md`
- [ ] `.claude/skills/production-scheduling/SKILL.md`
- [ ] `.claude/skills/quality-nonconformance/SKILL.md`
- [ ] `.claude/skills/returns-reverse-logistics/SKILL.md`
**Validation:** Spot-check 1-2 skills. Confirm frontmatter format.
**Est. files:** 9 | **Est. lines:** ~285

---

## Blocking Validations Summary

| Phase | Validation | What Breaks If It Fails |
|-------|-----------|------------------------|
| 1B | SessionStart hook fires | All session persistence, context recovery, pause/resume |
| 1B | `$CLAUDE_PROJECT_DIR` resolves on Windows | Every hook path in settings.json — entire hook system broken |
| 1B | Post-edit-format fires on Edit | Post-edit pipeline (format, typecheck, console-warn) |
| 2A | Rules files discovered by Claude Code | TDD discipline, debugging methodology, skill catalog — all invisible |
| 2B | Agent dispatch works from orchestrator | Subagent-driven development, code review, research — no agents available |
| 3A | `/iago:init` creates expected artifacts | Entire workflow broken — no PROJECT.md, ROADMAP.md, STATE.md |
| 3A | Skills discoverable via `/` autocomplete | Users can't invoke workflow commands |

---

## Known Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `$CLAUDE_PROJECT_DIR` undefined on Windows | Medium | Critical — all hooks fail | Test in Phase 1B. Fallback: use relative paths from `.claude/settings.json` location. |
| Hook timeout (>2s sync budget) | Low | Degraded UX — hooks silently dropped | `safety-guard.mjs` is the largest (180 lines, 34 regex patterns). Benchmark in 1B. Fallback: split into smaller hooks. |
| `settings.json` schema mismatch | Low | Hooks not registered | Cross-reference with Claude Code docs in Phase 1B. Use `context7` MCP for current schema. |
| Skill frontmatter rejected by Claude Code | Medium | Skills invisible | Test one skill in Phase 2A before building all 36. Verify `description`, `name` fields match Claude Code expectations. |
| Biome not installed in target project | Medium | `post-edit-format.mjs` errors on every Edit | Hook should check `npx biome --version` and exit cleanly if missing. |
| Transcript JSONL path varies by OS/version | Medium | Token tracking, statusline broken | `lib/transcript.mjs` must detect path dynamically. Test on Windows in 1B. |

---

## Open Questions (Non-Blocking, Resolve Post-v0.1.0)

1. **Skill naming:** Claude Code skills use directory names for `/` completion. Will `iago-init` show as `/iago-init` or `/iago:init`? May need `:` in directory name or a `name:` frontmatter field.
2. **settings.json merge:** If a target project already has `.claude/settings.json`, iaGO hooks must merge, not overwrite. v0.1.0 assumes clean project. Address in v0.2.0.
3. **Hook performance profiling:** No benchmarks exist. Real-world hook latency may require optimization. Measure after v0.1.0 deployment.
4. **available-skills.md accuracy:** Must be manually kept in sync with actual skill files. Consider a build script for v0.2.0.

---

## Totals

| Category | Files | Lines Est. |
|----------|-------|-----------|
| Hook utilities (lib/) | 3 | ~115 |
| Hooks (.mjs) | 9 | ~1,005 |
| Config (.gitignore, settings.json) | 2 | ~103 |
| CLAUDE.md | 1 | ~105 (done) |
| Rules files | 8 | ~250 |
| Agent definitions | 8 | ~460 |
| Workflow skills (/iago:*) | 8 | ~535 |
| Core feature skills | 6 | ~260 |
| Content/business skills | 7 | ~205 |
| Experimental skills | 6 | ~195 |
| Industry skills | 9 | ~285 |
| **Total** | **67** | **~3,518** |

**Already built:** CLAUDE.md (Phase 0, 105 lines)
**Remaining to build:** 66 files, ~3,413 lines across 8 phases

### Context budget (per session)

| Layer | Files | Lines | When Loaded |
|-------|-------|-------|-------------|
| Always-loaded | 5 | ~220 | Every session (CLAUDE.md + 4 always-on rules) |
| Path-scoped rules | 4 | ~120 | When editing matching files |
| Agent (one at a time) | 1 | ~55-65 | When dispatched |
| Skill (one at a time) | 1 | ~25-90 | When invoked |
| Hooks | 12 | ~1,120 | Never — external Node.js processes, zero token cost |
