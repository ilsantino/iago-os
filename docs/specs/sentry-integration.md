# Spec: Sentry Integration — Four-Layer Architecture

_Date: 2026-05-19 | Status: **Planned** | Authors: Claude (orchestrator) + Santiago direction_

---

## Context

iaGO-OS v2 is a multi-agent OS that hosts arbitrary agent shapes on a Hostinger VPS. The current v2 vision spec (`docs/specs/iago-os-v2-vision.md`) covers the runtime, control plane, dashboard, and preserved pipeline — but does **not** specify error observability, crash trace capture, or auto-fix dispatch on production errors.

The `.claude/rules/layer-triage.md` rule already references "Sentry-trace → fix-dispatch" as a rule-based+AI hybrid pattern. The Sentry MCP (`mcp__sentry__*`) is available via `claude mcp add` but has not yet been configured — install instructions are in `docs/specs/iago-os-v2-master-prompt.md:314`. Neither is wired into v2 operational planning. This spec closes that gap.

This is **not** a Phase 2 scope addition. Phase 2 (locked, cutover 2026-05-25) ships VPS bootstrap + OpenClaw cutover only. Sentry integration is slotted across Phase 2 tail and Phases 3, 9, and 10 as outlined below.

---

## Vision

Sentry sits across iaGO-OS v2 in four distinct integration layers, each independently valuable, each shippable as a separate workstream. The full vision is: **production errors anywhere in the iaGO fleet (the v2 daemon itself, every client React app, every Lambda function) are observable in real time, queryable from agent reasoning loops, and — for the highest-confidence cases — auto-fixed by a dedicated agent that drives a pipeline PR.**

---

## The Four Layers

### Layer A — Daemon observability (`iago-os-daemon` project)

**Surface:** the v2 daemon itself, plus all `AgentRuntime` adapters (PTY, HTTP/SDK, MCP-as-agent, Webhook/event, Daemon).

**What it captures:**
- Unhandled rejections in daemon Node process
- PTY adapter crashes (spawn failure, write-to-dead-process, unexpected exit codes)
- HTTP/SDK adapter failures (timeout, 5xx from upstream, malformed response)
- IPC server errors (socket bind failure, message parse error)
- File-bus integrity violations (rename collision, claim mismatch, lock acquisition failure)
- Heartbeat stall events (adapter unresponsive past threshold)

**Sentry project structure:** single project `iago-os-daemon`. Tags: `agent_id`, `org`, `runtime_shape`, `phase`, `release` (Git SHA of daemon at deploy time).

**Implementation:**
- `@sentry/node` SDK initialized in `runtime/daemon/index.ts` boot path (or wherever the daemon entry point lives post-Phase-2)
- DSN read from env var `SENTRY_DAEMON_DSN`, provisioned via the credential bootstrap path (Plan 01b → systemd-creds, already in Phase 2)
- `Sentry.captureException` wrappers in PTY adapter `onExit`, IPC server `onError`, heartbeat stall handler
- Release tagging tied to daemon SHA at deploy time (set via systemd unit env var)

**Effort:** ~half-day. Single PR, modifies `runtime/daemon/index.ts` + daemon types + one new test that exercises the Sentry init path with a stub transport.

**Phase:** Phase 2 tail (add-on, post-cutover) or Phase 3 head. Safer at Phase 3 head — adding to Phase 2 right before cutover is risk-on for marginal upside.

---

### Layer B — Per-client app observability

**Surface:** every client application (Munet booking flow, FullData pricing mock, DIN Pro pricing app, Sentria incident bot, future clients). React + Vite frontends. Amplify Gen 2 Lambda backends.

**What it captures:**
- Frontend JS errors (uncaught exceptions, unhandled promise rejections, React error boundaries)
- Backend Lambda exceptions (timeout, throw, transient AWS errors)
- API Gateway 5xx events with correlation IDs

**Sentry project structure:** one project per client (`munet`, `fulldata`, `din-pro`, `sentria`). Tags: `env` (sandbox/prod), `release` (build SHA), `feature` (booking/pricing/etc.).

**Implementation per client:**
- Frontend: `@sentry/react` + Vite plugin. Wrap router in `Sentry.ErrorBoundary`. Source maps uploaded on build.
- Backend: `@sentry/aws-serverless` Lambda wrapper. Auto-instrumented with Amplify-Gen-2-compatible adapter.
- DSN per project provisioned via Amplify env var pipeline (not in this spec's scope).

**Status check (TODO):** audit which clients currently have Sentry wired. Some may already have it; some will be greenfield.

**Effort:** ~half-day per client. Independent fast/quick plans.

**Phase:** Phase 3, post-cutover. Lower priority than client deliverables but worth a "Sentry audit pass" sprint when bandwidth allows.

---

### Layer C — Sentry MCP for agent queries

**Surface:** any agent (PTY, HTTP/SDK, MCP-as-agent, etc.) querying live Sentry state from inside its own reasoning loop.

**What it enables:**
- "Find all errors in the last hour on `munet`" — agent triages without leaving its session
- "What's the stack trace for issue #42?" — pinned investigation
- "How many users hit error X today?" — frequency-aware fix prioritization
- "What did Sentry log when this PR deployed?" — release-correlation queries

**Implementation:** the Sentry MCP server is available after a one-time setup. CLAUDE.md's active MCP table does not yet list Sentry — the install command is at `docs/specs/iago-os-v2-master-prompt.md:314`.

**One-time setup checklist:**
1. `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp`
2. Authenticate: `mcp__sentry__authenticate` → follow OAuth flow → `mcp__sentry__complete_authentication`
3. Verify query tools are available (list tools after auth to confirm `mcp__sentry__find_issues`, `mcp__sentry__get_issue_details`, etc.)
4. Add `sentry` to CLAUDE.md active MCP table once confirmed

**What's needed after setup:**
- Document which agents have Sentry MCP scope by default (probably all of them, gated by config)
- Establish "ask Sentry MCP before grep" pattern for production triage tasks (parallel to the Graphify "check the graph first" pattern in CLAUDE.md)

**Effort:** ~1 hour. One-time setup, one rules-doc addition.

**Phase:** **Available after one-time setup.** Run the checklist above before the next production triage session.

---

### Layer D — Sentry-webhook → auto-fix agent (the killer feature)

**Surface:** Sentry detects a new or regressed issue in any monitored project; webhook fires; daemon receives it; daemon spawns a dedicated fixer agent; fixer reads trace + code, proposes fix, routes through approval.

**Flow:**

```
Production error fires in (e.g.) munet-web
    ↓ Sentry captures, deduplicates, alerts on new/resurfaced/regression
    ↓ Sentry webhook → VPS endpoint (Tailscale-fronted, HMAC-verified)
    ↓
Daemon's webhook handler validates signature, parses payload
    ↓
Daemon checks tasks/sentry-fixer/last-attempt/<issue_id>.json
    → if attempt within last 24h → skip (rate limit)
    → else → continue
    ↓
Daemon spawns ephemeral agent: daemon-sentry-fixer
    ↓
Agent receives: issue_id, trace_id, file:line, error msg, env, frequency
    ↓
Agent uses mcp__sentry__* to fetch full trace context (Layer C)
    ↓
Agent reads affected file from clients/<project>/ checkout on VPS
    ↓
Agent proposes fix → routes through one of:
   → Auto-PR via /iago-quick pipeline (full review discipline, human merges)
   → Telegram notification ("fixer says X, approve to PR?")
   → High-confidence auto-commit on iago-os internal repo ONLY
    ↓
Cost ledger logs attempt + outcome (Phase 8 — see iago-os-v2-vision)
```

**Critical safety constraints:**

1. **Auto-commit only on iago-os repo itself.** All client-app fixes route through Telegram approval before PR. One bad hallucination cannot break a client's production. This is non-negotiable.
2. **Rate limit:** one fixer spawn per Sentry issue per 24h. Otherwise an issue that fires on every page load consumes unbounded Claude/Codex calls.
3. **Issue alerts, not Event alerts.** Sentry webhooks must fire on new/resurfaced/regressed issues only — never on every event. Otherwise a runaway 500 storms the daemon.
4. **HMAC signature verification** on every webhook payload. Tailscale-fronting alone is not sufficient (defense in depth).
5. **PII scrubbing pre-Sentry-send.** Munet handles bookings; FullData handles data; default Sentry scrubbers must be verified ON, plus per-project denylist for known sensitive fields.
6. **Fixer agent wall-clock timeout.** The 24h rate limit bounds invocation frequency, not duration. A pathological trace could run unbounded. Max wall-clock time per fixer agent invocation: 20 minutes. Kill via SIGTERM at timeout; write `aborted` to the rate-limit ledger to preserve the 24h window (prevents immediate retry on the same issue).
7. **Code-scope path filter.** The fixer agent must not propose changes to auth, credential, or IAM paths. Enforced as a denylist at agent spawn time: `amplify/auth/`, any file matching `**/auth*`, `**/iam*`, `**/secrets*`, `**/credentials*`, billing Lambdas. Matching files → Telegram notification only ("Sentry trace touches sensitive path, manual review required"). This applies to the iago-os self-loop (D-1) as well as client loops (D-2+).

**Implementation phases:**

- **Phase 10 — one-off iago-os-self version (RECOMMENDED EARLY).** Wire the Sentry webhook → fixer-agent loop on the **iago-os repo itself first**. When the v2 daemon crashes in production, Sentry fires, fixer-agent proposes a fix, opens PR into iago-os. Test the entire loop on YOUR OWN infrastructure for a month before generalizing. Requires Phase 9 webhook receiver infrastructure (`sentry-event` adapter, Shape 4) as a prerequisite — consistent with v2 vision Phase 10: *"Sentry → daemon → file-bus task → event-shape agent → pipeline → PR loop wired end-to-end."*
- **Phase 10+ — generalize to one client.** Pick the lowest-risk client (probably FullData since it's a pricing mock, not handling money). Same loop, with Telegram approval gate. Post-Phase-10 generalization after the iago-os self-loop is battle-tested.
- **Phase 9 — formalize as Webhook/event shape.** Webhook/event shape from the canonical v2 vision spec (`docs/specs/iago-os-v2-vision.md` Phase 9). Generalizes to all webhook sources (Sentry, GitHub, Linear, Slack, custom). Sentry becomes one of several. This is the prerequisite for D-1 and D-2.

**Effort:**
- Phase 10 one-off (D-1): ~2-3 days. Webhook endpoint, signature verification, payload parser, agent spawn, fixer-agent prompt template, rate-limit ledger, integration test against Sentry sandbox. Depends on Phase 9 webhook-shape scaffold.
- Phase 9 formalization (D-3): ~1 week. Generic webhook-shape abstraction, multi-source routing, dashboard integration.

---

## Phase mapping summary

| Layer | What | Phase |
|---|---|---|
| **A** | Daemon observability (`iago-os-daemon` Sentry project, SDK in `runtime/daemon/`) | **Phase 3 head** (post-cutover, low-risk add-on) |
| **B** | Per-client app observability (one Sentry project per client, React + Lambda) | **Phase 3** ongoing (audit + gap-fill sprint) |
| **C** | Sentry MCP for agent queries | **After one-time setup** (see Layer C checklist; not yet configured) |
| **D-1** | One-off Sentry → fixer-agent loop on iago-os repo itself | **Phase 10** (requires Phase 9 webhook infra) |
| **D-2** | Generalize to one client (FullData first) | **Phase 10+** (post-Phase-10 generalization) |
| **D-3** | Formalize as Webhook/event shape | **Phase 9** (per v2 vision) |

---

## Decisions taken

1. **Cloud Sentry, not self-hosted.** Free tier covers solo dev; Team tier ~$26/mo covers a small fleet. Self-hosting is operational drag for our scale.
2. **One project per surface** (`iago-os-daemon`, `munet`, `fulldata`, `din-pro`, `sentria`). Mixing surfaces in one project obscures tag-based filtering.
3. **No Sentry SDK in Phase 2 scope.** Cutover is 6 days out; adding a new observability surface to the cutover script is risk-on for marginal value. Layer A lands Phase 3 head.
4. **iago-os self-loop ships before client loop.** Sentry → auto-fix must be exercised on YOUR OWN infrastructure first. A month of dogfooding before exposing it to client production.
5. **Human approval default for all client-app fixes.** Auto-commit only on `iago-os` repo. Non-negotiable.
6. **Issue alerts, not Event alerts.** Webhook trigger source is configured in Sentry project settings; this constraint is enforced at the Sentry config level, not in code.

---

## Open questions

- **OQ-1:** Should the daemon-sentry-fixer agent be a PTY (Claude/Codex) or an HTTP/SDK shape? PTY is simpler to wire today; HTTP/SDK shape is cheaper per-invocation since it's short-lived. Defer the call until Phase 4 implementation begins.
- **OQ-2:** Per-agent Sentry projects, or one project with `agent_id` tag? Current spec says single project — but if the agent fleet grows past ~20 agents, splitting may be valuable for separate alert routing. Revisit at Phase 8 (cost ledger UI) when we have data on agent volume.
- **OQ-3:** What's the LangGraph / HTTP/SDK shape Sentry integration pattern? `@sentry/node` works for any Node process, but instrumenting LangGraph workflow steps as Sentry transactions is non-obvious. Defer to Phase 3 when LangGraph adapter lands.

---

## References

- `docs/specs/iago-os-v2-vision.md` — Canonical v2 vision; Phase 9 references Webhook/event shape
- `.claude/rules/layer-triage.md` — Mentions Sentry-trace → fix-dispatch as rule-based+AI hybrid
- `.iago/decisions/2026-05-19-three-invocation-modes.md` — Three modes of agent invocation (this spec assumes Mode 3 for fixer agent)
- Sentry MCP: `mcp__sentry__authenticate`, `mcp__sentry__complete_authentication` — install via `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp` (see `docs/specs/iago-os-v2-master-prompt.md:314`; not yet active in CLAUDE.md MCP table)
