# iaGO-OS — Handoff

> **Updated:** 2026-04-03
> **Status:** Phase 2 COMPLETE. Phase 3 (skills build-out) next.
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
| 3A | Remaining workflow + proprietary skills (7) | PENDING |
| 3B | Core feature skills (6) | PENDING |
| 3C | Content/Business + Experimental skills (13) | PENDING |
| 3D | Industry skills (9) | PENDING |

### What Exists Now

**Skills with SKILL.md (6 built):**
iago-init, iago-discuss, iago-plan, iago-execute, iago-verify, iago-quick

**Skills as empty directories (30 remaining):**
- Workflow: iago-fast, iago-pause
- Core: brainstorming, writing-plans, subagent-driven-development, code-review, deep-research, prompt-optimizer
- Content/Business: article-writing, content-engine, investor-materials, investor-outreach, market-research, visa-doc-translate, frontend-slides
- Experimental: autonomous-loops, continuous-agent-loop, enterprise-agent-ops, agent-payment-x402, liquid-glass-design, santa-method
- Industry: healthcare-phi-compliance, carrier-relationship-management, customs, energy, logistics, inventory, production-scheduling, quality-nonconformance, returns-reverse-logistics

**Proprietary skills (5 — directories DON'T exist yet, specs NOT in research):**
iago-scaffold, iago-proposal, iago-onboard, iago-n8n, iago-agents

**Agents (11 built, all enhanced with stack intelligence):**
implementer, code-reviewer, spec-reviewer, code-quality-reviewer, researcher, tdd-guide, build-error-resolver, e2e-runner, content-writer, infra-runner, data-modeler

**Rules (8 built):**
tdd.md, systematic-debugging.md, available-skills.md, git-workflow.md, e2e-testing.md, mcp-server-patterns.md, react-vite.md, aws-amplify.md

**Hooks (9 built):**
All committed and wired in settings.json.

**State engine:**
.iago/hooks/lib/state-manager.mjs — 8 exported functions, tested.

**Other:**
- templates/client-project/.iago/ — 5 template files
- docs/WORKFLOW.md — complete workflow reference
- Codex plugin integrated (available-skills.md + CLAUDE.md)
- Built-in skills, MCP servers, marketplace plugins cataloged

---

## Key Design Decisions

- **11 agents, hub-and-spoke** — orchestrator (Opus) dispatches, agents (Sonnet) never spawn agents
- **No subagents** — domain expertise flows through skills → context → plans → agents
- **Codex integration** — `/codex:review`, `/codex:adversarial-review`, `/codex:rescue` in catalog
- **context7 MCP** — active for library docs
- **Proprietary §4b was dropped** — CHERRY-PICK-PLAN compilation omitted the proprietary skills section. Specs must be derived from context clues in DECISION-skills.md and DECISION-conventions.md.

---

## Spec Locations for Remaining Skills

| Category | Spec Location |
|----------|---------------|
| iago-fast, iago-pause | CHERRY-PICK-PLAN.md §4a + DECISION-workflow.md §7-8 |
| Proprietary (5) | Derive from DECISION-conventions.md line 251 + stack context |
| Core feature (6) | DECISION-skills.md §Core Skills #4-10 |
| Content/Business (7) | DECISION-skills.md §Content/Business Skills C1-C7 |
| Experimental (6) | DECISION-skills.md §Experimental/Agentic Skills E1-E6 |
| Industry (9) | DECISION-skills.md §Industry Skills I1-I9 |

---

## Team Context

- 3-person AI consultancy (CEO on Windows 11, CTO on Mac)
- Stack: React 19 + Vite + TS strict + TailwindCSS 4 + ShadCN/UI + AWS (Amplify Gen 2 + Lambda + API Gateway + DynamoDB + Cognito + SES)
- Claude Max plan
- Biome as formatter/linter
- Codex plugin v1.0.2 installed and authenticated
