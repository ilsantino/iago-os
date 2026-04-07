# iaGO-OS — Handoff

> **Updated:** 2026-04-06
> **Status:** v0.1.0 RELEASED. All phases complete. Ready for first client validation.
> **Branch:** `main`

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
| 5A-C | Usage tracking, validation, docs | DONE | `f2c1e4b` |
| 5D | Release v0.1.0 (tag + push) | DONE | `v0.1.0` |
| 6 | Agent Architecture v2 | DONE | `75e9871` |
| 7 | Redundancy cleanup + docs update | DONE | (this commit) |

---

## What Just Happened (Session 2026-04-06)

### v0.1.0 Release — Final Cleanup

Full redundancy audit and documentation update:
- **6 skill files** updated: stale agent names (content-writer, implementer, code-reviewer) → profile names (content, fullstack/frontend/backend, review-single)
- **2 agent files** fixed: removed duplicated security checks from review-quality.md, clarified review-full.md phrasing
- **3 doc files** updated: SKILLS.md, WORKFLOW.md, SETUP.md — all old agent references replaced with profile-based dispatch
- **HANDOFF.md** updated: all phases marked DONE
- Tagged v0.1.0 and pushed to GitHub

### Agent Architecture v2 — Capability-Based Dispatch (Previous Session)

Redesigned the entire agent system from role-based to capability-based.

**Before:** 11 fixed role-based agents (implementer, code-reviewer, spec-reviewer, etc.), all hardcoded Sonnet, serial execution, no cross-session learning.

**After:**
- **3 base agents** — executor (write), analyst (read-only), operator (external data)
- **12 capability modules** — react-19, dynamodb, lambda, cognito, tdd, security, e2e, review-spec, review-quality, content, infra, forms
- **12 profiles** — pre-composed base + capabilities (fullstack, frontend, backend, review-single, review-full, security-audit, research, e2e, infra, schema, content, debug)
- **Smart model routing** — auto/sonnet/opus per task based on complexity, configurable in `.iago/config.json`
- **Parallel execution** — same-wave plans dispatch concurrently in `/iago:execute`
- **Feedback loops** — `.iago/learnings/` accumulates review patterns and project conventions, injected into agent prompts

**4 plans executed:**
1. Foundation — 12 capabilities + 3 bases (9 tasks)
2. Profiles + Cutover — 12 profiles, 3 skill updates, 11 old agents deleted (11 tasks)
3. Enhancements — routing config, parallel execution, learnings injection (5 tasks)
4. Documentation — CLAUDE.md, README, ARCHITECTURE.md, templates updated (6 tasks)

**Spec:** `docs/specs/agent-architecture-v2.md`
**Plans + summaries:** `docs/plans/agent-v2-0{1-4}-*`

### Also This Session

- Added Ecosystem Integrations section to README (native skills, Codex, MCP servers, model routing)
- Added Prerequisites section to README (Node.js, Git, Claude Code, AWS CLI, GitHub CLI)
- Replaced ASCII diagrams with Mermaid flowcharts
- AWS CLI configured and verified (user `iaguito`, account `582071018864`)

---

## What Exists Now

**Agent Architecture:**
- 3 base agents: `executor.md`, `analyst.md`, `operator.md`
- 12 capability modules in `.claude/agents/capabilities/`
- 12 profiles in `.claude/agents/profiles/`
- Dispatch flow: match profile → select model → compose prompt (base + caps + learnings + task) → dispatch

**Skills (31 with SKILL.md):** Consolidated from 41. 8 industry skills moved to `docs/patterns/` as reference docs, replaced by single `/industry-patterns` parameterized skill. `/article-writing` merged into `/content-engine` (`--formats blog`). `/market-research` merged into `/deep-research` (`--focus market`). `/enterprise-agent-ops` merged into `/iago:agents` (`--scope operational`).

**Rules (8):** Unchanged. `available-skills.md` updated with new agent catalog.

**Hooks (8):** statusline.mjs and context-monitor.mjs removed (dead code). Usage tracker hook active.

**Config:** `.iago/config.json` now includes `routing` section (default_model, security_critical, retry_upgrade, review_matches_impl).

**Learnings:** `.iago/learnings/patterns.md` + `project-conventions.md` — empty, ready to accumulate during first real project execution.

**Templates:** Both client and internal templates updated with learnings directory + routing config.

---

## What's Next

### In Progress — Full Audit (Important Tier)

Audit found 11 Critical, 14 Important, 14 Minor issues. Criticals fixed. Batch A (stale refs) fixed. 13 Important issues remain across Batches B-F:

| Batch | Area | Issues | Status |
|-------|------|--------|--------|
| B | iago-quick pipeline gaps | 4 | DONE (`5dd6b13`) |
| C | Summary path (execute→verify broken) | 3 | DONE (`5dd6b13`) |
| D | Script portability (macOS compat) | 3 | DONE (`5dd6b13`) |
| E | Hook/config schema | 1 | DONE (`5dd6b13`) |
| F | Docs/dead code | 2 | DONE (`5dd6b13`) |

See `sessions/2026-04-07-iago-os-audit.md` in Obsidian for full audit details.

### After Audit
1. **Sync skills to global** — `./scripts/sync-skills.sh --global` to propagate fixes.
2. **First real client validation** — MUNET Phase 1 is in progress (see `clients/munet-web/MUNET-HANDOFF.md`).

### Watch For
- Profile matching accuracy — do the file path heuristics pick the right profile?
- Opus routing — is auto model selection actually picking opus when it should?
- Learnings accumulation — do useful patterns emerge during real execution?
- Parallel execution — any file conflict issues in wave dispatch?

### Deferred
- iaGO Dashboard (needs 2+ weeks of real usage data first)
- Agent pool resizing (dynamic maxTurns based on task complexity)
- Custom profile promotion (auto-promote frequently used custom compositions)
- 14 Minor audit issues (unused deps, content duplication between rules/ and capabilities/)

---

## Key Design Decisions

- **Capability-based dispatch** — profiles compose base + capabilities per task, replacing fixed role agents
- **3-tier tool sandboxing** — executor (write), analyst (read-only), operator (external) prevents accidents
- **Smart routing via config.json** — per-project model routing, not hardcoded
- **Feedback loops** — learnings accumulate and inject, patterns promote to CLAUDE.md at 5+ occurrences
- **Hub-and-spoke preserved** — agents never spawn agents, all coordination through orchestrator
- **Codex integration** — `/codex:adversarial-review` is mandatory on every plan (not just auth/data/payment)

---

## Team Context

- 3-person AI consultancy (CEO on Windows 11, CTO on Mac)
- Stack: React 19 + Vite + TS strict + TailwindCSS 4 + ShadCN/UI + AWS (Amplify Gen 2 + Lambda + API Gateway + DynamoDB + Cognito + SES)
- Claude Max plan (200k context, Opus available for agents)
- AWS CLI authenticated (user iaguito, us-east-1)
- Biome as formatter/linter
- Codex plugin installed and authenticated
