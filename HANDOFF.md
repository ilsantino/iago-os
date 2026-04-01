# iaGO-OS — Handoff

> **Updated:** 2026-04-01
> **Status:** Sprint 4 (Workflow Engine) Phase 4b complete. Phase 5 next.
> **Branch:** `master` (no `main` branch yet — create remote + push when ready)

---

## Where We Are

Four sprints completed or in progress:
1. **Research sprint** — COMPLETE. Analyzed 6 open-source Claude Code configuration repos
2. **Hook architecture sprint** — COMPLETE. 8 decisions across 5 phases, compiled into canonical reference
3. **Skills & Agents sprint** — COMPLETE. 8 agents, 34 skills, ~1,580 lines across 42 files
4. **Workflow Engine sprint** — IN PROGRESS. Phases 1-4b complete, Phase 5 (templates + assembly) next

Nothing is implemented yet. The repo contains research and decision documents across 4 sprints.

## Repository Structure

```
iago-os/
  README.md                              # Project overview, architecture, design principles
  HANDOFF.md                             # This file
  .gitignore                             # Standard
  .claude/
    settings.local.json                  # Local permissions (legacy from research cloning)
  research/
    SPRINT-STATUS.md                     # Sprint tracker (all sprints)
    # Sprint 1: Research
    ecc-analysis.md                      #   Everything Claude Code
    ruflo-analysis.md                    #   Ruflo
    gsd-analysis.md                      #   Get Shit Done
    paperclip-analysis.md                #   Paperclip
    the-architect.md                     #   The Architect
    superpowers.md                       #   Superpowers
    # Sprint 2: Hook Architecture
    hooks-synthesis.md                   #   Extracted hook/dispatcher/persistence patterns
    DECISION-foundation.md               #   Hook location, dispatcher, statusline
    DECISION-core.md                     #   Persistence, compaction, cost tracking
    DECISION-guards.md                   #   Post-edit pipeline, safety guard
    DECISION-hooks.md                    #   CANONICAL hook reference (compiled from all)
    # Sprint 3: Skills & Agents
    skills-agents-synthesis.md           #   Pattern extraction from all repos
    DECISION-conventions.md              #   CSO, agent template, escalation, paralysis guard
    DECISION-skills.md                   #   34 skills, overlap resolutions, CLAUDE.md absorptions
    DECISION-agents.md                   #   8 agents, tool restrictions, model assignments
    DECISION-skills-agents.md            #   Assembly: dispatch map, meta-instruction, build order
    # Sprint 4: Workflow Engine
    workflow-synthesis.md                #   Workflow, state, config, execution patterns
    DECISION-workflow-foundation.md      #   Phases, state dir, config.json
    DECISION-execution.md                #   Plan format, dispatch, quick/fast modes
    DECISION-discipline.md               #   Discipline placement, CLAUDE.md budget, rules files
```

## Git History

```
77a5851 research: complete Sprint 4 Phase 3 — execution model decisions
a2ffc61 research: complete Sprint 4 Phases 1-2 — workflow extraction + foundation decisions
0ef5d32 research: complete Sprint 3 Phase 5 — skills & agents assembly
c438881 research: complete hook architecture decisions
d8697df research: analyze ECC, Ruflo, GSD, Paperclip, The-Architect and Superpowers
```

---

## What's Decided (Summary)

### Sprint 2: Hooks (`DECISION-hooks.md`)
- **12 files** to implement: 3 shared utilities + 9 hooks, ~1,120 lines
- Hook location: `.iago/hooks/` (tracked), `.iago/state/` (gitignored)
- No dispatcher — direct `.claude/settings.json` registration
- Safety: 13 destructive patterns, 17 secret regexes, 4 injection patterns
- Post-edit: Biome → typecheck → console-warn pipeline
- Context: statusline bridge file, 80%/90% warnings, session persistence trio

### Sprint 3: Skills & Agents (`DECISION-skills-agents.md`)
- **42 files**: 4 CLAUDE.md sections + 5 rules + 8 agents + 28 skills, ~1,580 lines
- 8 agents (all Sonnet), orchestrator on Opus
- Escalation protocol: DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED
- CSO descriptions, paralysis guard (7 reads), 3-fix escalation

### Sprint 4: Workflow Engine
- **5 phases**: init → discuss → plan → execute → verify
- State dir: `.iago/` with plans/, context/, summaries/, reviews/
- Plan format: YAML frontmatter + tasks with files/action/verify/expected
- Quick modes: `/iago:fast` (trivial), `/iago:quick` (1-3 tasks)
- **Discipline**: 24 patterns placed across 5 layers, CLAUDE.md ~90 lines (under 200 budget)
- **Rules files**: 8 total (4 always-on ~130 lines + 4 path-scoped ~120 lines)
- Config hierarchy: Hooks > Rules > CLAUDE.md > Skills > Agent prompts
- **Pause/resume**: explicit `/iago:pause` skill → HANDOFF.json; auto-resume via SessionStart hook

## What's NOT Done

### Next: Sprint 4 Phase 5 — Templates + Assembly

STATE.md template, ROADMAP.md template, PROJECT.md template, plan/summary/review artifact templates. Workflow assembly doc tying everything together.

### Then: Sprint 5 — Implementation

Build everything defined in Sprints 2-4:
- 12 hook files (~1,120 lines) — build order in DECISION-hooks.md §11
- 42 skill/agent/rules files (~1,580 lines) — build order in DECISION-skills-agents.md §4
- CLAUDE.md (~90 lines) — budget in DECISION-discipline.md
- 3 new rules files (~75 lines) — specs in DECISION-discipline.md
- Workflow skill files (`/iago:init`, `/iago:discuss`, `/iago:plan`, `/iago:execute`, `/iago:verify`, `/iago:fast`, `/iago:quick`)
- settings.json wiring
- `.iago/` directory + .gitignore setup

---

## Key Design Decisions (Quick Reference)

### Sprint 2: Hooks
| # | Decision | Verdict |
|---|----------|---------|
| 1 | Dispatcher | Skip — direct registration, no profiles |
| 2 | Context persistence | ECC trio + Ruflo token tracking, HANDOFF.json for pause/resume |
| 3 | Post-edit pipeline | Biome (hardcoded), tsc filtered to edited file, console.* warn |
| 4 | Safety guard | 13 destructive patterns + 17 secret regexes + 4 injection patterns |
| 5 | Cost tracking | Per-session JSONL, client-tagged, integrated into Stop hook |
| 6 | Compaction | Token-percentage only, 65/80/90 thresholds, bridge file |
| 7 | Hook location | `.iago/hooks/` tracked, `.iago/state/` gitignored |
| 8 | Statusline | 4 fields, bridge file to context monitor |

### Sprint 4: Workflow Engine
| # | Decision | Verdict |
|---|----------|---------|
| 1 | Phase structure | 5 phases (init→discuss→plan→execute→verify) + fast/quick bypass |
| 2 | State directory | `.iago/` with 6 tracked subdirs + gitignored state/ |
| 3 | config.json | 9 fields, explicit defaults, project.name only required field |
| 4 | Plan format | YAML frontmatter + task fields, max 8 tasks/plan, no placeholders |
| 5 | Subagent execution | Per-plan dispatch, sequential waves, deferred parallelism |
| 6 | CLAUDE.md budget | ~90 lines across 11 sections, under 200 limit |
| 7 | Quick/fast modes | Fast (inline ≤3 files) + Quick (lightweight plan, 1-3 tasks) |
| 9 | Discipline placement | 24 patterns across 5 layers, 21 already placed, 3 new CLAUDE.md lines |

## Team Context

- 3-person AI consultancy (CEO on Windows 11 Surface Pro 16GB, CTO on Mac)
- Stack: React 19 + Vite + TS strict + TailwindCSS 4 + ShadCN/UI + AWS
- Agents: LangGraph + Claude SDK, n8n
- Claude Max 200 plan, 200K context window
- Biome as standard formatter/linter
- iaGO-OS is a Claude Code configuration layer, not a framework
