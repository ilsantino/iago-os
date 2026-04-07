# Paperclip Integration Decision

> Date: 2026-04-01
> Sprint: 5 — Pre-implementation scoping
> Depends on: paperclip-analysis.md, DECISION-hooks.md §5, DECISION-skills-agents.md

---

## Verdict: DEFER

**Reasoning:** Paperclip is a production agent management platform (50+ DB tables, PostgreSQL, React UI, heartbeat scheduler, budget enforcement, multi-company isolation). iaGO-OS is a Claude Code build environment for a 3-person team. These are different concerns at different layers. Deploying Paperclip alongside OpenClaw today creates two production orchestration systems when you have zero concurrent client agent deployments that need budget enforcement. The one capability Paperclip adds that we genuinely lack — per-agent dollar-denominated budget enforcement — is a scaling problem we don't have yet. Claude Max is flat-rate; our dev sessions don't need budget caps. API-billed client agents will, but those live in OpenClaw, not iaGO-OS.

---

## Revisit Trigger

Revisit when ALL THREE are true:

1. **3+ concurrent client agent deployments** running on API billing (not Claude Max flat-rate)
2. **OpenClaw lacks budget enforcement** — no per-agent spend caps, no auto-pause at limit
3. **At least one client has requested** cost controls or spend visibility for their deployed agents

If OpenClaw grows its own budget enforcement before these triggers hit, Paperclip may never be needed. If a client requests spend controls before OpenClaw supports it, Paperclip becomes the fastest path to production budget gates.

---

## Original Session 8 Audit

| # | Item | Verdict | Reasoning |
|---|------|---------|-----------|
| 1 | Company JSON config files | **DEFER** | Paperclip's company model is DB-backed with full CRUD API + UI. JSON config files were always the wrong approach — you'd create companies via the Paperclip API or UI, not static files. Moot until Paperclip is deployed. |
| 2 | Agent JSON config files | **DEFER** | Same as above. Agents are created via Paperclip API with `adapter_config` jsonb, not static JSON. The agent definition format is Paperclip's concern, not iaGO's. |
| 3 | Custom docker-compose.yml with PAPERCLIP_SECRET | **MODIFY → DEFER** | The original plan assumed `PAPERCLIP_SECRET` — the actual env var is `BETTER_AUTH_SECRET` (Better Auth, not custom auth). Docker compose exists in two variants: `docker-compose.quickstart.yml` (embedded PGlite, single container) and `docker-compose.yml` (external PostgreSQL). Either works on Hostinger. But deploying Docker on Hostinger is an infra task, not an iaGO-OS task. Defer until the integration is adopted. |
| 4 | Heartbeat protocol integration | **DEFER** | The heartbeat procedure (9-step wake loop) is Paperclip's SKILL.md — it's injected into agents via Paperclip's skills system, not via iaGO-OS. If we adopt Paperclip, its built-in `skills/paperclip/SKILL.md` handles this. iaGO-OS would never implement the heartbeat protocol itself. |
| 5 | Budget/approval workflow setup | **DEFER** | Budget enforcement is Paperclip's core value proposition (multi-scope policies, warn at 80%, hard-stop at 100%, auto-pause, board override). This is exactly what we'd adopt Paperclip FOR. But we don't need it today — Claude Max is flat-rate, and we have zero API-billed production agents. |

---

## Capabilities Paperclip Owns (DO NOT BUILD)

These capabilities belong to Paperclip's domain. iaGO-OS must never build them, even partially. If we need them before adopting Paperclip, we adopt Paperclip — we don't build a half-version.

| # | Capability | Paperclip Feature | iaGO-OS Boundary |
|---|-----------|-------------------|-----------------|
| 1 | Production agent budget enforcement (warn/hard-stop/auto-pause) | `budget_policies` + `budget_incidents` + auto-pause at 100% | iaGO tracks dev session utilization (tokens, duration) for internal metrics. It does NOT enforce spend limits or pause agents. Different layer entirely. |
| 2 | Per-token dollar cost tracking for production agents | `cost_events` table with `cost_cents`, provider, model attribution | iaGO's `costs.jsonl` tracks session utilization (token counts, not dollars). Claude Max is flat-rate — dollar costs are irrelevant for dev sessions. |
| 3 | Multi-company agent management (hire/pause/terminate) | Companies + agents + org chart + status machine | iaGO's `config.json` has `project.client` for cost tagging. It does NOT manage client orgs or production agents. |
| 4 | Agent heartbeat/scheduling (timer + cron) | `heartbeat_runs` + `routines` + `routine_triggers` + background scheduler | iaGO-OS agents are Claude Code subagents dispatched synchronously during dev. They don't need heartbeats or cron. |
| 5 | Production task/issue management | Issues with hierarchy, status machine, atomic checkout, comments, documents | iaGO has plans/tasks/summaries for dev workflow. These are dev artifacts, not production tickets. |
| 6 | Agent governance/approvals | `approvals` table — hire_agent, approve_ceo_strategy, budget_override | iaGO has no approval gates. Dev team of 3 doesn't need board approvals. |
| 7 | Production audit trail | `activity_log` — immutable, actor-typed, entity-linked | iaGO has git history for dev audit. No separate audit log needed. |
| 8 | Agent authentication (JWT/API keys for production agents) | `agent_api_keys` + `createLocalAgentJwt()` + Better Auth | iaGO agents are Claude Code subagents running in the same session. No auth between them. |
| 9 | Encrypted secret management for production agents | `company_secrets` + `company_secret_versions` + master key encryption | iaGO uses `.env` files and Claude Code's built-in secret handling. Production secrets are an infra concern. |
| 10 | Git workspace isolation for production agents | `execution_workspaces` + worktree strategy + branch templates | iaGO's `isolation: "worktree"` in agent frontmatter handles dev-time isolation. Production workspace management is Paperclip's job. |

### The Bright Line

**iaGO-OS = build environment.** Tracks dev session metrics, enforces code quality, orchestrates implementation workflow.

**Paperclip = production agent management.** Tracks dollar costs, enforces budgets, manages persistent agent lifecycles, handles multi-tenant isolation.

**OpenClaw = production agent runtime.** Deploys and runs the actual client-facing agents.

If you find yourself adding a `budget_limit` field to iaGO's `config.json`, or a `heartbeat_interval` to an agent definition, or a `cost_cents` column anywhere — stop. That's Paperclip's job. File a note to revisit the Paperclip integration.

---

## Integration Spec

N/A — deferred.

When revisited, the minimal integration path is:
- `docker-compose.quickstart.yml` on Hostinger (single container, embedded PGlite)
- `BETTER_AUTH_SECRET` in Docker env
- OpenClaw agents configured with `openclaw_gateway` adapter type in Paperclip
- Paperclip's built-in `skills/paperclip/SKILL.md` handles heartbeat protocol
- iaGO-OS needs zero new files — Paperclip is a separate deployment

---

## Impact on Build Plan

- **Phases affected:** None. Paperclip was never in the Sprint 5 build order (DECISION-workflow.md §13).
- **Files removed:** 0
- **Files added:** 0
- **Net effect on total file count:** Neutral
- **Original Session 8:** Entirely deferred. No Session 8 in v0.1.0 build.
