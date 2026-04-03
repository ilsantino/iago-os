# Phase 5 Prompt — Copy-paste into fresh conversation

```
# iaGO-OS — Phase 5: Usage Tracking + Validate + Docs + Release v0.1.0

## Before you write a single file, read:
1. HANDOFF.md — full current state + Phase 5 plan (the plan is IN the handoff)
2. CLAUDE.md — stack constraints
3. docs/IAGO-DASHBOARD.md — understand why usage tracking matters
4. .claude/settings.json — current hook wiring (you'll extend this)
5. .iago/hooks/lib/state-manager.mjs — existing state engine
6. .iago/hooks/context-persistence.mjs — reference hook pattern
7. scripts/sync-skills.sh — you'll add a --global flag
8. One built skill (e.g., .claude/skills/iago-init/SKILL.md) — format reference

## What you're building (4 sub-phases)

### 5A: Usage Tracking
Build the telemetry system that feeds future dashboard decisions.

1. .iago/hooks/usage-tracker.mjs — PostToolUse hook (Skill matcher) + Stop hook
   - On Skill invocation: log {ts, event:"skill_invoked", skill, session}
   - On Stop: log session summary {ts, event:"session_end", duration, skills_used, agents_dispatched}
   - Writes JSONL to .iago/state/usage-log.jsonl
   - Match the coding style of existing hooks (context-persistence.mjs)

2. Wire into .claude/settings.json:
   - PostToolUse: add usage-tracker.mjs with Skill matcher
   - Stop: add usage-tracker.mjs

3. Wire into BOTH templates:
   - templates/client-project/.claude/settings.json.template
   - templates/internal-project/.claude/settings.json.template

4. scripts/usage-report.sh + .ps1:
   - Accept one or more project paths
   - Read .iago/state/usage-log.jsonl from each
   - Produce: skill frequency, agent frequency, avg session duration, common workflows
   - Output to stdout (human-readable summary)

### 5B: Validate
Collapse into one step — fix issues inline:

1. Add --global flag to scripts/sync-skills.sh and .ps1:
   - Syncs skills + agents + rules to ~/.claude/ (NOT hooks)
   - Run it and verify counts match

2. Re-run scripts/new-client.sh with test values:
   - Verify: no .template files, no {{vars}}, valid JSON, git init
   - Cleanup after

3. In the test project, verify:
   - /iago:init skill is discoverable (it appears in skill list)
   - session-start hook fires without error
   - state-manager.mjs init() works: node -e "import('./path').then(m => m.init())"

### 5C: Docs
The main event. Write these 4 documents:

README.md (~200 lines):
- What iaGO-OS is (1 paragraph — who it's for, what problem it solves)
- Quick start (3 commands: clone, sync, scaffold)
- A real workflow example showing init → discuss → plan → execute → verify
  (show actual terminal output or realistic mock — make it concrete)
- Skills table: name | purpose | trigger (grouped by category)
- Agents table: name | role | model
- Folder structure (ASCII tree of what ships)
- License: proprietary
- TONE: dummy-proof. Explain to a developer who's never used Claude Code
  skills before. Lead with "here's what using it looks like" not "here's
  the architecture." No jargon without immediate explanation. If someone
  reads only the README, they should understand exactly what this does
  and feel confident they can use it.

docs/SETUP.md (~150 lines):
- Prerequisites: Node 20+, Claude Code CLI, git, Biome
- Windows setup (PowerShell commands)
- macOS setup (bash commands)
- Global install (sync-skills --global)
- First project scaffold (new-client)
- Verification checklist (5 things to check)
- Troubleshooting: common issues and fixes

docs/ARCHITECTURE.md (~200 lines):
- Problem: why this exists (context rot, config drift, invisible agents)
- Layers: CLAUDE.md → rules → skills → agents → hooks → state engine
- Source patterns: what came from ECC, Ruflo/Superpowers, GSD
- Config hierarchy: global ~/.claude/ → project .claude/ → .iago/
- Hook lifecycle: SessionStart → PreToolUse → PostToolUse → PreCompact → Stop
- Multi-project model: templates → new-client → sync-skills → per-project state
- Usage tracking: how telemetry flows from hooks to JSONL to future dashboard

docs/SKILLS.md (~300 lines):
- Full catalog grouped by category
- Per skill: name, purpose, trigger condition, arguments/flags, agents dispatched, example
- Include all 35 skills

### 5D: Release
1. git add all Phase 5 changes
2. Commit: "feat: usage tracking, validation, docs, and v0.1.0 release"
3. git tag v0.1.0
4. DO NOT push — ask user first
5. Print final summary:
   - Total file count
   - Skills: 35, Agents: 11, Rules: 8, Hooks: 10 (9 existing + usage-tracker), Scripts: 6
   - Status: v0.1.0 ready

## Validation checklist
- [ ] usage-tracker.mjs exists and is wired in settings.json
- [ ] usage-tracker.mjs wired in BOTH template settings.json files
- [ ] usage-report scripts exist (sh + ps1)
- [ ] sync-skills has --global flag (sh + ps1)
- [ ] README.md exists at repo root
- [ ] docs/SETUP.md, docs/ARCHITECTURE.md, docs/SKILLS.md exist
- [ ] README is approachable — no jargon wall, leads with usage example
- [ ] Skills catalog in docs/SKILLS.md has all 35 skills
- [ ] No files modified under research/
- [ ] git tag v0.1.0 applied
```
