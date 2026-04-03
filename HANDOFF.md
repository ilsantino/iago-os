# iaGO-OS — Handoff

> **Updated:** 2026-04-03
> **Status:** Phase 4 COMPLETE. Phase 5 next (usage tracking + validate + docs + v0.1.0).
> **Branch:** `master`

---

## Where We Are

| Phase | Description | Status | Commit |
|-------|-------------|--------|--------|
| 0 | Research + CLAUDE.md | DONE | `7aa4383` |
| 1A | Scaffold + hook utilities | DONE | `c2eb216` |
| 1B | Hook suite + settings.json wiring | DONE | `ee6d7a5` |
| 1C | State engine + rule files (8) | DONE | `b6c9aca` |
| 2A | Templates + iago-init + iago-discuss | DONE | `2358704` |
| 2B | 11 agents + iago-plan + iago-execute | DONE | `6a73414` + `f25e51d` |
| 2C | iago-verify + iago-quick + WORKFLOW.md | DONE | `f7e92a8` |
| 3A | Remaining workflow + proprietary skills (7) | DONE | `e8aa936` |
| 3B | Core feature skills (6) | DONE | `5eaee56` |
| 3C | Content/Business + Experimental skills (13) | DONE | `108020f` |
| 3D | Industry skills (9) | DONE | `e081d93` |
| 4A | Templates (client + internal) | DONE | `77434da` |
| 4B | Scripts (new-client + sync-skills) | DONE | `a0a548e` |
| 5A | Usage tracking hook + aggregation script | PENDING |
| 5B | Validate (global install, e2e, dry run) | PENDING |
| 5C | Docs (README, SETUP, ARCHITECTURE, SKILLS) | PENDING |
| 5D | Release v0.1.0 (tag + push) | PENDING |

---

## What Exists Now

**Skills (35 with SKILL.md):**
- Workflow (13): iago-init, iago-discuss, iago-plan, iago-execute, iago-verify, iago-quick, iago-fast, iago-pause, iago-scaffold, iago-proposal, iago-onboard, iago-n8n, iago-agents
- Core (6): brainstorming, writing-plans, subagent-driven-development, code-review, deep-research, prompt-optimizer
- Content (7): article-writing, content-engine, investor-materials, investor-outreach, market-research, visa-doc-translate, frontend-slides
- Experimental (6): autonomous-loops, continuous-agent-loop, enterprise-agent-ops, agent-payment-x402, liquid-glass-design, santa-method
- Industry (9): healthcare-phi-compliance, carrier-relationship-management, customs, energy, logistics, inventory, production-scheduling, quality-nonconformance, returns-reverse-logistics

**Agents (11):** implementer, code-reviewer, spec-reviewer, code-quality-reviewer, researcher, tdd-guide, build-error-resolver, e2e-runner, content-writer, infra-runner, data-modeler

**Rules (8):** tdd, systematic-debugging, available-skills, git-workflow, e2e-testing, mcp-server-patterns, react-vite, aws-amplify

**Hooks (9):** All wired in settings.json.

**Templates (2 sets):**
- templates/client-project/ — 8 files (CLAUDE.md.template + 6 .iago/ + 1 .claude/)
- templates/internal-project/ — 8 files (mirrors client, Opus default, IP clause)

**Scripts (4):**
- scripts/new-client.sh + .ps1 — scaffold new project from template
- scripts/sync-skills.sh + .ps1 — sync skills/agents/rules/hooks to client project

**State engine:** .iago/hooks/lib/state-manager.mjs — 8 exported functions

**Other:** docs/WORKFLOW.md, Codex plugin, context7 MCP, built-in skills cataloged

---

## Phase 5 Plan

### 5A: Usage Tracking

**Goal:** Automatically document real iaGO-OS usage so we know what to improve before building the iaGO Dashboard (see docs/IAGO-DASHBOARD.md).

**Approach — hook-based telemetry:**

1. **New hook: `usage-tracker.mjs`**
   - Fires on PostToolUse (Skill matcher) — logs every skill invocation
   - Fires on Stop — logs session summary (duration, skills used, agents dispatched)
   - Writes JSONL to `.iago/state/usage-log.jsonl`

2. **Event schema:**
   ```json
   {"ts":"ISO","event":"skill_invoked","skill":"iago-plan","session":"abc"}
   {"ts":"ISO","event":"agent_dispatched","agent":"implementer","skill":"iago-execute","session":"abc"}
   {"ts":"ISO","event":"session_end","duration_min":45,"skills_used":["iago-plan","iago-execute"],"agents_dispatched":["implementer","code-reviewer"],"session":"abc"}
   ```

3. **Aggregation script: `scripts/usage-report.sh/.ps1`**
   - Reads `.iago/state/usage-log.jsonl` from one or more project paths
   - Produces: skill frequency, agent frequency, avg session duration, most common workflows
   - Output: `docs/usage-report-{date}.md`

4. **Wire into settings.json.template** (both client + internal templates)

**Why this approach:**
- No new dependencies — uses existing hook infrastructure
- JSONL is append-only, cheap, and easy to parse
- Feeds directly into the iaGO Dashboard later (DynamoDB Streams ingest)
- Answers the key questions: which skills matter, which agents earn their keep, where does the workflow break down

### 5B: Validate

Collapsed into one step — fix issues inline as found:

1. **Global install:** Add `--global` flag to sync-skills that syncs skills + agents + rules to `~/.claude/` (NO hooks — hooks reference `.iago/hooks/` which only exists in projects). Verify counts.
2. **E2E test:** Re-run new-client.ps1 → verify structure, no `{{vars}}`, valid JSON, git init (already passed in 4B, this is a final check).
3. **Workflow dry run:** In a test project, verify `/iago:init` is discoverable, SKILL.md is readable, session-start hook loads context, state-manager functions work via Node.

### 5C: Docs

**README.md** — the "what is this and how do I use it in 2 minutes" document:
- What (1 paragraph — what iaGO-OS is and who it's for)
- Quick start (3 commands to scaffold a project)
- Show don't tell: a real example workflow (init → discuss → plan → execute → verify)
- Skills table (name + one-line purpose + trigger phrase)
- Agents table (name + role + model)
- Folder structure (ASCII tree)
- License (proprietary)
- **Tone:** dummy-proof, not intimidating. Explain to a developer who's never seen Claude Code skills before. Lead with "here's what using it looks like" before "here's how it works internally."

**docs/SETUP.md** — first-time setup:
- Prerequisites (Node 20+, Claude Code, git, Biome)
- Windows + Mac setup (both paths)
- Global install (sync-skills --global)
- First project scaffold
- Verification checklist
- Troubleshooting common issues

**docs/ARCHITECTURE.md** — how it works:
- Problem: context rot, fresh-context agents, config drift across projects
- Solution: configuration layer that lives alongside code
- Layers diagram (CLAUDE.md → rules → skills → agents → hooks → state engine)
- Source patterns (ECC, Ruflo/Superpowers, GSD — what was taken from where)
- Config hierarchy (global ~/.claude/ → project .claude/ → .iago/)
- Hook lifecycle (SessionStart → PreToolUse → PostToolUse → PreCompact → Stop)
- Multi-project model (templates + sync-skills + per-project .iago/ state)

**docs/SKILLS.md** — full reference catalog:
- Grouped by category (Workflow, Core, Content, Experimental, Industry)
- Per skill: name, purpose, trigger, arguments, agents dispatched, example usage

### 5D: Release

1. `git add -A && commit`
2. `git tag v0.1.0`
3. Push main + tags
4. Print summary: file counts, skill/agent/rule/hook/script counts, status

---

## Post v0.1.0

**Immediate (weeks 1-2):** Use iaGO-OS on 2+ real client projects. Collect usage data via the tracking hook. Identify what works, what's friction, what's missing.

**iaGO Dashboard:** Separate product — web UI that makes iaGO-OS visible. See `docs/IAGO-DASHBOARD.md` for vision. Prerequisites: stable config layer + 2+ weeks of real usage data. Do NOT start until prerequisites are met.

---

## Key Design Decisions

- **11 agents, hub-and-spoke** — orchestrator (Opus) dispatches, agents (Sonnet) never spawn agents
- **Codex integration** — `/codex:review`, `/codex:adversarial-review`, `/codex:rescue` in catalog
- **context7 MCP** — active for library docs
- **Proprietary §4b was dropped** — CHERRY-PICK-PLAN compilation omitted the proprietary skills section. Specs derived from context clues.
- **Usage tracking via hooks** — JSONL telemetry, not external analytics. Feeds future dashboard.

---

## Team Context

- 3-person AI consultancy (CEO on Windows 11, CTO on Mac)
- Stack: React 19 + Vite + TS strict + TailwindCSS 4 + ShadCN/UI + AWS (Amplify Gen 2 + Lambda + API Gateway + DynamoDB + Cognito + SES)
- Claude Max plan
- Biome as formatter/linter
- Codex plugin v1.0.2 installed and authenticated
