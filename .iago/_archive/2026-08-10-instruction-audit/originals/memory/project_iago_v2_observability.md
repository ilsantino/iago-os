---
name: iago-os v2 observability split
description: Sentry + PostHog split for v2 observability (5 layers); Sentry for daemon errors + Layer D dispatch default, PostHog for client apps + LLM telemetry, dual MCP for queries
type: project
originSessionId: 0d8cdb7c-0dd5-45b9-921a-d8d57a58ed38
---
**Decision date:** 2026-05-20 (one day after PR #71 merged the original 4-layer Sentry-only spec)

**ADR:** `.iago/decisions/2026-05-20-posthog-sentry-split-and-memory.md`
**Operational spec:** `docs/specs/sentry-integration.md` (amended 2026-05-20 with five-layer split)

**Five-layer split (tool by concern, not by redundancy):**

| Layer | Tool | What |
|---|---|---|
| A | **Sentry** | Daemon error capture (`iago-os-daemon`), real-time `@sentry/node` hooks |
| B | **PostHog** | Per-client app analytics + errors (Munet, FullData, DIN Pro, Sentria) — free for 3+ users where Sentry's developer plan caps at 1 |
| C | **Both MCPs** | Sentry MCP for trace context, PostHog MCP for cost/usage queries |
| D | **Sentry** (default; re-evaluate Phase 10) | Webhook → auto-fix dispatch loop. Source-agnostic Phase 9 adapter so swap is cheap if needed. |
| E | **PostHog Claude Code plugin** (NEW) | LLM telemetry: $ai_generation + $ai_span + $ai_trace per pipeline session. `claude plugin install posthog` + 2 env vars. Zero VPS infra. |

**Why:** Confidence 90%. Sentry's auto-instrument depth + structured event payload + HMAC webhook + mature issue grouping matter for Layers A and D. PostHog's free tier (unlimited team, 1M events/mo) wins for client apps that don't need Layer-D-grade trace fidelity. Layer E plugin is the only viable option for LLM cost/token/tool-span telemetry — closes the cost-per-client gap.

**How to apply:**
- Today (zero infra): `claude plugin install posthog` on Santiago's machine + 2 env vars (`POSTHOG_PROJECT_API_KEY`, `POSTHOG_HOST`).
- Phase 3: Layer A Sentry SDK init in `runtime/daemon/main.ts` + add SENTRY_DAEMON_DSN to `cred-bootstrap.ts` CREDENTIALS array (in same PR — NOT amended into locked Plan 01b).
- Phase 3 audit pass: per-client PostHog SDK + Vite plugin + Lambda glue (`posthog-node` `captureException`).
- Phase 10 impl kickoff: 2-page comparison PostHog vs Sentry error grouping over 3+ months of Layer B data. If PostHog passes the bar, flip Layer D default; else stay Sentry.

**Triggers to revisit:**
- Sentry Team $26/mo doesn't justify Layer D usage in production → consolidate on PostHog
- PostHog ships grouping + webhook parity with Sentry → flip Layer D default
- PII incident on PostHog Layer B → re-evaluate denylist storage (OQ-5)
- Long-lived daemon claude-pty sessions lose telemetry on SessionEnd → add `posthog-node` captureEvent backup (OQ-7)

**Cost reality at decision time:** $0/mo Santiago-only. $26/mo when Sebas joins Phase 6 (Sentry Team plan; PostHog stays free).
