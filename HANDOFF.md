# iaGO-OS — Handoff

> **Updated:** 2026-03-31
> **Status:** Hook architecture decisions complete. Implementation next.
> **Branch:** `master` (no `main` branch yet — create remote + push when ready)

---

## Where We Are

Two sprints completed:
1. **Research sprint** — Analyzed 6 open-source Claude Code configuration repos
2. **Hook architecture sprint** — Made 8 decisions across 5 phases, compiled into canonical reference

Everything is decided. Nothing is implemented yet. The repo contains only research and decision documents.

## Repository Structure

```
iago-os/
  README.md                              # Project overview, architecture, design principles
  HANDOFF.md                             # This file
  .gitignore                             # Standard
  .claude/
    settings.local.json                  # Local permissions (legacy from research cloning)
  research/                              # Sprint 1: raw analysis files
    ecc-analysis.md                      #   Everything Claude Code
    ruflo-analysis.md                    #   Ruflo
    gsd-analysis.md                      #   Get Shit Done
    paperclip-analysis.md                #   Paperclip
    the-architect.md                     #   The Architect
    superpowers.md                       #   Superpowers
    hooks-synthesis.md                   #   Extracted hook/dispatcher/persistence patterns
    SPRINT-STATUS.md                     #   Sprint 1 tracker
  .iago/
    research/                            # Sprint 2: architecture decisions
      DECISION-foundation.md             #   Phase 2: hook location, dispatcher, statusline
      DECISION-core.md                   #   Phase 3: persistence, compaction, cost tracking
      DECISION-guards.md                 #   Phase 4: post-edit pipeline, safety guard
      DECISION-hooks.md                  #   Phase 5: CANONICAL reference (compiled from all above)
```

## Git History

```
c438881 research: complete hook architecture decisions
d8697df research: analyze ECC, Ruflo, GSD, Paperclip, The-Architect and Superpowers
```

---

## What's Decided (Summary)

Read `.iago/research/DECISION-hooks.md` for the full canonical reference. Key points:

- **12 files** to implement: 3 shared utilities + 9 hooks
- **~1,120 lines** total estimated
- **Hook location:** `.iago/hooks/` (tracked), `.iago/state/` (gitignored runtime)
- **No dispatcher** — each hook is standalone `.mjs`, registered directly in `.claude/settings.json`
- **Context persistence:** SessionStart/PreCompact/Stop trio, real token tracking from transcript JSONL
- **Compaction:** Token-percentage from statusline bridge file, warnings at 80%/90%
- **Cost tracking:** Per-session utilization JSONL, client-tagged, integrated into Stop hook
- **Post-edit:** Biome format → typecheck → console-warn (in order)
- **Safety:** 13 destructive command patterns, 17 secret regexes, 4 injection patterns
- **Commit quality:** Conventional commits, 72-char limit, staged secret scan
- **Statusline:** git branch, context %, client slug, session duration → bridge file

## What's NOT Done

### Next: iaGO-OS Skills & Agents

The hook architecture is decided but the higher-level features are not:

1. **Slash commands** — `/iago:pause`, `/iago:client <slug>`, `/iago:costs`, `/iago:resume`
   - These are Claude Code skills (markdown + YAML frontmatter in `.claude/commands/`)
   - `/iago:pause` writes HANDOFF.json from current session state
   - `/iago:client` sets `.iago/state/active-client.json`
   - `/iago:costs` queries costs.jsonl and summarizes

2. **CLAUDE.md generation** — What instructions does iaGO inject into project-level CLAUDE.md?
   - Verification-before-completion discipline (from Superpowers)
   - Two-stage review (spec compliance then quality)
   - Task granularity rules (2-5 min steps, exact file paths)
   - Rationalization prevention
   - How does this relate to The Architect's blueprint template?

3. **Agent definitions** — YAML frontmatter format for specialized agents
   - ECC's agent pattern (markdown + YAML frontmatter)
   - What agents does a consultancy need? (reviewer, planner, implementer, researcher?)
   - How do agents interact with the hook system?

4. **Project kickoff** — The Architect's blueprint pattern
   - Discovery → Deep Dive → Architecture → Generate workflow
   - Outputs CLAUDE.md + agent configs for the target project
   - How does this integrate with per-client isolation?

5. **Implementation** — Build the 12 hook files from DECISION-hooks.md
   - Build order defined: lib/ utilities → standalone hooks → complex hooks
   - settings.json wiring
   - .iago/state/ directory + .gitignore setup

---

## Key Design Decisions (Quick Reference)

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

## Team Context

- 3-person AI consultancy (CEO on Windows 11 Surface Pro 16GB, CTO on Mac)
- Stack: React 19 + Vite + TS strict + TailwindCSS 4 + ShadCN/UI + AWS
- Agents: LangGraph + Claude SDK, n8n
- Claude Max 200 plan, 200K context window
- Biome as standard formatter/linter
- iaGO-OS is a Claude Code configuration layer, not a framework
