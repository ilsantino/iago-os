# iaGO-OS — Handoff

> **Updated:** 2026-04-02
> **Status:** Phase 1A COMPLETE. Scaffold built. Repo rename pending.
> **Branch:** `master`

---

## Repo Rename — ACTION REQUIRED

The repo currently lives at `C:\Users\sanal\dev\.iago`. This creates a confusing nested path: `.iago/.iago/` (repo root contains a `.iago/` product directory).

**Fix:** Rename the repo root to `iago-os`:
```
cd C:\Users\sanal\dev
ren .iago iago-os
```

After rename, the structure becomes:
```
dev\iago-os\          ← repo root
  .iago\              ← the product (hooks, state, context — deployed to target projects)
  .claude\            ← Claude Code config for developing iaGO-OS
  research\           ← design documents from Sprints 1-4
  CLAUDE.md           ← master instructions (part of the product)
  HANDOFF.md          ← this file
  README.md           ← project overview
```

Once renamed, delete this section.

---

## Where We Are

Five sprints completed or in progress:
1. **Research sprint** — COMPLETE. Analyzed 6 open-source Claude Code configuration repos.
2. **Hook architecture sprint** — COMPLETE. 8 decisions across 5 phases.
3. **Skills & Agents sprint** — COMPLETE. 8 agents, 34 skills, ~1,580 lines across 42 files.
4. **Workflow Engine sprint** — COMPLETE. Canonical reference: `DECISION-workflow.md`.
5. **Implementation sprint** — IN PROGRESS. Phase 1A complete, Phase 1B complete (hooks committed).

### Build Progress

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Research + CLAUDE.md | DONE |
| 1A | Scaffold + hook utilities | DONE (commit `c2eb216`) |
| 1B | Hook suite + settings.json wiring | DONE (commit `ee6d7a5`) |
| 2A | Rules files (8 files, ~250 lines) | PENDING |
| 2B | Agent definitions (8 files, ~460 lines) | PENDING |
| 3A | Workflow skills (8 `/iago:*` skills) | PENDING |
| 3B | Core feature skills (6 skills) | PENDING |
| 4A | Content/experimental skills (13 skills) | PENDING |
| 4B | Industry skills (9 skills) | PENDING |

### What Was Done in Phase 1A

- Restored deleted working tree files (previous session left them in limbo)
- Created all 36 skill directories from §10 manifest with `.gitkeep`
- Created `.iago/state/` directory (gitignored)
- Fixed `.gitignore` — added `*.local.md` and `.env`/`.env.*` patterns
- Validated CLAUDE.md (106 lines, 13 sections, under 200 budget)

### Next: Phase 2A — Rules Files

Build 8 rules files in `.claude/rules/`. Can run in parallel with any remaining Phase 1 work.
See `research/CHERRY-PICK-PLAN.md` §10, Phase 2A for the file list and line estimates.

---

## Repository Structure

```
iago-os/  (currently .iago — rename pending)
  CLAUDE.md                              # Master instructions (106 lines, 13 sections)
  CLAUDE.local.md.template               # Per-developer override template
  HANDOFF.md                             # This file — session continuity
  README.md                              # Project overview
  .gitignore                             # Node.js + Claude Code patterns
  .claude/
    settings.json                        # Hook wiring (12 entries)
    settings.local.json                  # Local permissions (gitignored)
    agents/                              # 8 agent definitions (Phase 2B)
    rules/                               # 8 rule files (Phase 2A)
    skills/                              # 36 skill directories (Phases 3-4)
      iago-init/ ... iago-pause/         #   8 workflow skills
      brainstorming/ ... prompt-optimizer/  #   6 core skills
      article-writing/ ... santa-method/ #   13 content/experimental skills
      healthcare-phi-compliance/ ...     #   9 industry skills
  .iago/
    .gitignore                           # Ignores state/ only
    hooks/                               # 9 hook files (Phase 1B — committed)
      lib/                               # 3 shared utilities
    context/                             # Discussion artifacts (tracked)
    plans/                               # Implementation plans (tracked)
    summaries/                           # Execution summaries (tracked)
    reviews/                             # Verification reports (tracked)
    state/                               # Runtime data (gitignored)
  research/                              # 25+ design docs from Sprints 1-4
    CHERRY-PICK-PLAN.md                  # Canonical build plan (§10 = phase map)
    SPRINT-STATUS.md                     # Sprint tracker
    BUILD-ORDER.md                       # Dependency graph
    DECISION-*.md                        # Architecture decisions
```

## Git History

```
c2eb216 feat(core): complete §10 directory scaffold and fix .gitignore
ee6d7a5 feat(hooks): cross-platform Node.js hook suite
7aa4383 feat(core): repo skeleton and master CLAUDE.md
ae24e63 research: final cherry-pick plan synthesized from all decisions
```

---

## Key Design Decisions (Quick Reference)

- **No dispatcher** — hooks registered directly in `.claude/settings.json`
- **Node.js only** — all hooks are `.mjs`, zero bash, cross-platform
- **File-based state** — JSON/JSONL in `.iago/state/`, no databases
- **Hub-and-spoke agents** — only orchestrator (Opus) dispatches, agents (Sonnet) never spawn agents
- **5-phase workflow** — init, discuss, plan, execute, verify
- **CLAUDE.md budget** — 200 lines max, currently 106

## Team Context

- 3-person AI consultancy (CEO on Windows 11 Surface Pro 16GB, CTO on Mac)
- Stack: React 19 + Vite + TS strict + TailwindCSS 4 + ShadCN/UI + AWS
- Claude Max 200 plan, 200K context window
- Biome as standard formatter/linter
- iaGO-OS is a Claude Code configuration layer, not a framework
