You are helping me build iaGO-OS, a Claude Code configuration layer for a 3-person AI consultancy (Windows + Mac).

## What iaGO-OS is
A set of Node.js hooks, rules, agents, and skills that sit on top of Claude Code for multi-client consultancy work. It handles context persistence across compaction, cost tracking, safety guards, auto-formatting, and structured workflows. It is NOT a framework — it's a configuration layer.

## Repo location
C:\Users\sanal\dev\iago-os (or C:\Users\sanal\dev\.iago if not yet renamed)

The repo root contains a .iago/ subdirectory — that's the PRODUCT (the state directory deployed to target projects). Don't confuse the repo root with the inner .iago/ directory.

## Structure
- CLAUDE.md — master instructions (106 lines, 13 sections)
- .claude/ — Claude Code config: settings.json (hook wiring), agents/, rules/, skills/
- .iago/ — the product: hooks/ (9 Node.js .mjs files), context/, plans/, summaries/, reviews/, state/ (gitignored)
- research/ — 25+ design docs from 4 research sprints
- research/CHERRY-PICK-PLAN.md — the canonical build plan (§10 has the full phase map)

## Build status
Read HANDOFF.md for current state. It tracks which phases are done, what's next, and key decisions.

## Key constraints
- TypeScript strict, Biome (never Prettier/ESLint), React 19, AWS Amplify Gen 2
- All hooks are .mjs, Node.js only, zero bash — must work on both Windows and Mac
- CLAUDE.md must stay under 200 lines
- Hub-and-spoke: Opus orchestrates, all subagents run on Sonnet
- Don't suggest alternative tools/frameworks — the stack is fixed
