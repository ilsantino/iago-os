# Spec: Sentry + PostHog Observability Integration — Five-Layer Architecture

_Date: 2026-05-19 | Status: **Planned** (amended 2026-05-20 to add PostHog split + Layer E LLM telemetry, supersedes the original four-layer Sentry-only design) | Authors: Claude (orchestrator) + Santiago direction_

**Amendment 2026-05-20 (PostHog split).** Santiago provisioned a PostHog account. Triple-agent research (`agentId: ad8e77f2ea6f89199` for PostHog vs Sentry, `agentId: a7b91aaf7cdbc4184` for memory patterns, plus Explore on current planning) settled the split: Sentry stays for Layer A daemon errors and is the default for Layer D dispatch (re-evaluated at Phase 10), Layer B switches to PostHog (free tier covers 3+ users where Sentry's developer plan caps at 1), Layer C adds PostHog MCP alongside Sentry MCP, and a new **Layer E — LLM telemetry via PostHog Claude Code plugin** lands today on Santiago's machine (zero VPS infra). Confidence on the split: 90%. The dissenting 10% is concentrated in Layer D — if PostHog's error grouping plus webhook story matures enough by Phase 10, the Layer D default may flip. Trail: `.iago/decisions/2026-05-20-posthog-sentry-split-and-memory.md`.

> **Phase-numbering note:** Phase numbers in this spec reference the **canonical v2 roadmap** in `docs/specs/iago-os-v2-vision.md` § Phase Sequencing (Phase 0–12). They do NOT reference the operational `feature-phase-N` plan-folder numbering. In the canonical roadmap, OpenClaw→v2 cutover lands as **Stage D / roadmap Phase 7** (gated on Phase 6 dashboard stable), while the operational `feature-phase-2-vps-bootstrap` plan folder compresses VPS install + cutover into one operational unit shipping Sunday 2026-05-25. When this spec says "Phase 3" or "Phase 9" it means the canonical roadmap phase, not the operational folder.

---

## Context

iaGO-OS v2 is a multi-agent OS that hosts arbitrary agent shapes on a Hostinger VPS. The current v2 vision spec (`docs/specs/iago-os-v2-vision.md`) covers the runtime, control plane, dashboard, and preserved pipeline — but does **not** specify error observability, crash trace capture, or auto-fix dispatch on production errors.

The `.claude/rules/layer-triage.md` rule already references "Sentry-trace → fix-dispatch" as a rule-based+AI hybrid pattern. The Sentry MCP (`mcp__sentry__*`) is available via `claude mcp add` but has not yet been configured — install instructions are in `docs/specs/iago-os-v2-master-prompt.md` § "Sentry MCP" install block. Neither is wired into v2 operational planning. This spec closes that gap.

**This is NOT a Phase 2 / cutover scope addition.** The operational `feature-phase-2-vps-bootstrap` plan stack is locked through Sunday 2026-05-25 cutover. Sentry work is slotted into canonical roadmap Phases 3 (Layer A + B) and 9–10 (Layer D), all post-cutover.

---

## Vision

Sentry + PostHog sit across iaGO-OS v2 in five integration layers, each independently valuable, each shippable as a separate workstream. The full vision is: **production errors anywhere in the iaGO fleet (the v2 daemon itself, every client React app, every Lambda function) are observable in real time, queryable from agent reasoning loops, and — for the highest-confidence cases — auto-fixed by a dedicated agent that drives a pipeline PR. LLM cost, latency, and tool-failure telemetry is captured from every pipeline session and queryable by the orchestrator via MCP.**

Tool split: **Sentry** owns Layer A (daemon error capture, real-time exception hooks, source maps) and is the **default** for Layer D auto-fix dispatch (its structured event payload + HMAC webhook + issue grouping are battle-tested). **PostHog** owns Layer B (per-client app analytics + errors — free for 3+ users where Sentry's developer plan caps at 1) and Layer E (LLM cost + token + tool-span telemetry via the Claude Code plugin, with zero VPS infra). Layer C is dual-MCP: Sentry MCP for trace context inside a fix loop, PostHog MCP for cost queries ("how many tokens did Munet burn this week?").

Every Layer D fix path terminates in a **PR**, not an auto-commit. There is no "trusted-repo auto-commit" route. See Layer D § "Critical safety constraints" for the canonical enforcement requirements.

---

## The Five Layers

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

- `@sentry/node` SDK initialized inside `startDaemon()` in `runtime/daemon/main.ts`, **after** `loadSystemdCredentials()` and `loadConfig()` so the DSN env var is populated. Init must happen before any `AgentRuntime` adapter spawn so adapter crashes are captured from boot.
- DSN read from env var `SENTRY_DAEMON_DSN`. **The credential mechanism (systemd-creds bootstrap) exists post-cutover via `feature-phase-2-vps-bootstrap` Plan 01b, but the SENTRY_DAEMON_DSN entry itself does NOT yet exist in either Plan 01a's provision script or Plan 01b's `CREDENTIALS` array.** Layer A's PR must:
  1. Add a new entry to Plan 01a's `CRED_MAP` (e.g., `iago-sentry-daemon-dsn`)
  2. Add the matching entry to Plan 01b's `CREDENTIALS` array in `runtime/daemon/cred-bootstrap.ts` (`{ fileName: "iago-sentry-daemon-dsn", envVar: "SENTRY_DAEMON_DSN" }`)
  3. Provision the credential value on the VPS via the same `provision-credentials.sh` path
- `Sentry.captureException` wrappers in PTY adapter `onExit`, IPC server `onError`, heartbeat stall handler
- Release tagging tied to daemon SHA at deploy time (set via systemd unit env var `IAGO_DAEMON_RELEASE_SHA`)

**Effort:** ~1 day (revised up from half-day). Single PR. Modifies `runtime/daemon/main.ts`, `runtime/daemon/cred-bootstrap.ts`, the deploy-side provision script, daemon types, plus tests that exercise the Sentry init path with a stub transport.

**Phase:** Canonical roadmap **Phase 3 head** (post-cutover). NOT a Phase 2 add-on — adding a new credential surface and SDK init path to the locked cutover script is risk-on for marginal upside.

---

### Layer B — Per-client app observability (PostHog)

**Surface:** every client application (Munet booking flow, FullData pricing mock, DIN Pro pricing app, Sentria incident bot, future clients). React + Vite frontends. Amplify Gen 2 Lambda backends.

**Tool: PostHog** (switched from Sentry per amendment 2026-05-20).

**Rationale for the switch:**
- PostHog's free tier covers unlimited team members + 1M events/mo + 100K error exceptions/mo. Sentry's developer plan is free for **1 user only** — once Sebas joins (Phase 6 dashboard) we'd be forced to ~$26/mo for the Team plan to get client-app error tracking that PostHog gives away.
- Client apps need analytics AND errors. PostHog covers both in one SDK + one dashboard; Sentry covers only errors and would force a second analytics tool (Segment/Mixpanel/etc.) per client.
- PostHog error tracking is junior to Sentry on deep stack traces, but Layer B has no auto-fix-loop requirement (Layer D is Sentry-only by default — see that layer). PostHog's depth is sufficient for "see what's failing on Munet booking" triage.

**What it captures:**
- Frontend JS errors (uncaught exceptions, unhandled promise rejections, React error boundaries)
- Backend Lambda exceptions (timeout, throw, transient AWS errors)
- API Gateway 5xx events with correlation IDs
- **PLUS** product analytics: funnel conversion, retention, paths, session replay (for client apps with web UIs — Munet booking, FullData/DIN pricing mocks)
- **PLUS** feature flags + A/B experiments (becomes available without adding a tool)

**PostHog project structure:** one project per client (`munet`, `fulldata`, `din-pro`, `sentria`). Use PostHog's project-level isolation. Tags via event properties: `env` (sandbox/prod), `release` (build SHA), `feature` (booking/pricing/etc.).

**Implementation per client:**
- Frontend: `posthog-js` SDK initialized at app boot. Wrap router in `PostHogErrorBoundary` (or React error boundary that calls `posthog.captureException`). Source maps uploaded via PostHog Vite plugin.
- Backend: `posthog-node` SDK inside Lambda handlers; `captureException(err, { ... })` in catch blocks; flush before handler return (Lambda doesn't keep the process alive between invocations, so explicit `await posthog.shutdown()` or `posthog.flush()` is required — document in per-client setup).
- Project API key per project provisioned via Amplify env var pipeline (Layer B's per-client PR adds the env var; not amended into Plan 01b which is cutover-locked).

**Honest gap vs Sentry:** the Layer B implementer must explicitly wire `posthog-node` `captureException` into Lambda handlers — `@sentry/aws-serverless` auto-wraps the handler, `posthog-node` does not. Expect ~10 lines of glue per Lambda. Worth it for the free-tier ceiling.

**Status check (TODO):** audit which clients currently have ANY error tracking wired. Some may have Sentry (legacy), some may have nothing. Plan B per client: rip out Sentry if present (likely only DIN Pro and FullData mocks have anything; both are demos), install PostHog.

**Effort:** ~half-day per client + ~1 hour Lambda glue per backend. Independent fast/quick plans.

**Phase:** Canonical roadmap **Phase 3**, post-cutover. Lower priority than client deliverables but worth a "PostHog audit pass" sprint when bandwidth allows.

**Credentials queued for Phase 3 Layer B PR:** `POSTHOG_PROJECT_API_KEY` (one per client, scoped per Amplify project), `POSTHOG_HOST` (= `https://us.i.posthog.com` or `https://eu.i.posthog.com` depending on region — confirm before provisioning). These are client-side env vars, not VPS daemon credentials — they land in the per-client Amplify env config, not in `runtime/daemon/cred-bootstrap.ts`.

---

### Layer C — Dual MCP for agent queries (Sentry + PostHog)

**Surface:** any agent (PTY, HTTP/SDK, MCP-as-agent, etc.) querying live observability state from inside its own reasoning loop. Split by concern:

- **Sentry MCP** → daemon error trace context, "what crashed when", release-correlation. Used inside Layer D fix loop and for production-error triage.
- **PostHog MCP** → LLM cost queries ("how many tokens did Munet burn this week, broken down by model?"), client-app funnel analytics ("what's the booking-flow drop-off?"), agent run analytics ("which tools failed most often last 30 days?"). Used for operational reporting, cost forecasting, and pattern detection on top of Layer E telemetry.

The two MCPs do not overlap and both stay active. Sentry MCP is gated by daemon error visibility (Layer A surface). PostHog MCP is gated by event ingestion (Layer B + Layer E surfaces).

**What Layer C enables (Sentry MCP):**
- "Find all errors in the last hour on `munet`" — agent triages without leaving its session
- "What's the stack trace for issue #42?" — pinned investigation
- "How many users hit error X today?" — frequency-aware fix prioritization
- "What did Sentry log when this PR deployed?" — release-correlation queries

**What Layer C enables (PostHog MCP):**
- `query-run` — execute any HogQL query (the orchestrator can ask agent-instrumented questions like "show me $ai_generation failures by client over last 7 days")
- `get-llm-total-costs-for-project` — daily LLM cost per model over N days
- `query-error-tracking-issues-list` — Layer B client app error queries
- `insight-create-from-query`, `dashboard-create` — programmatic dashboard creation
- `query-generate-hogql-from-question` — natural language to HogQL for the orchestrator

**Implementation: Sentry MCP** (one-time setup):
1. `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp`
2. Authenticate: `mcp__sentry__authenticate` → follow OAuth flow → `mcp__sentry__complete_authentication`
3. Verify query tools are available (list tools after auth to confirm `mcp__sentry__find_issues`, `mcp__sentry__get_issue_details`, etc.)
4. Add `sentry` to CLAUDE.md active MCP table once confirmed

**Implementation: PostHog MCP** (one-time setup):
1. `claude mcp add --transport http posthog https://mcp.posthog.com/mcp` (verify exact URL against [posthog.com/docs/model-context-protocol](https://posthog.com/docs/model-context-protocol) at install time)
2. Authenticate: OAuth flow OR personal API key via `Authorization: Bearer <PERSONAL_API_KEY>` header — choose OAuth if available, falls back to PAT
3. Scope: select projects to expose to the MCP (start with all client projects + `iago-os-llm-telemetry` for Layer E)
4. Verify by running `query-run` with a trivial HogQL query against the iago-os-llm-telemetry project
5. Add `posthog` to CLAUDE.md active MCP table once confirmed

**Credentials queued:** `POSTHOG_PERSONAL_API_KEY` for PAT-fallback auth. Stored in Santiago's local `.env` for MCP use (not a VPS daemon credential — the MCP runs Claude-side, not daemon-side). If/when an HTTP/SDK agent on the VPS needs to query PostHog (Phase 3+), provision a separate **service-account** API key via systemd-creds and add to `cred-bootstrap.ts` in that PR.

**What's needed after setup:**
- Document which agents have Sentry MCP + PostHog MCP scope by default (probably all of them, gated by config)
- Establish "ask Sentry MCP before grep on errors" + "ask PostHog MCP for cost/usage data" patterns (parallel to the Graphify "check the graph first" pattern in CLAUDE.md)

**Effort:** ~1 hour each (2 hours total for both MCPs). One-time setup, two rules-doc additions.

**Phase:** **Available after one-time setup.** Run both checklists before the next production triage / cost-review session. Independent of any other Phase — runs on the Claude Code client side.

---

### Layer D — Webhook → auto-fix agent (the killer feature)

**Tool decision: Sentry is the default. Re-evaluate at Phase 10 implementation.** The spec was designed around Sentry's structured event payload, HMAC webhook signing, and mature issue grouping — those are what the fixer agent acts on. PostHog's error tracking exists but its grouping + webhook surface is younger; if by Phase 10 the gap has closed (and PostHog is already running for Layers B+E), the dispatch loop may flip to PostHog to consolidate on one tool. The Phase 9 Webhook/event shape adapter is source-agnostic by design — the swap cost is wiring a different SDK + payload parser, not redesigning Layer D itself.

**Surface:** Sentry detects a new or regressed issue in any monitored project; webhook fires; daemon receives it; daemon spawns a dedicated fixer agent; fixer reads trace + code, **proposes a PR fix**, routes through approval.

**Flow (revised — atomic dedupe + PR-only output):**

```
Production error fires in (e.g.) munet-web
    ↓ Sentry captures, deduplicates, alerts on new/resurfaced/regression
    ↓ Sentry webhook → VPS endpoint (Tailscale-fronted, HMAC-verified)
    ↓
Daemon's webhook handler:
    (1) validates HMAC signature against rotating secret
    (2) parses payload, extracts (sentry_org_id, sentry_project_id, issue_id, event_id)
    (3) checks Sentry-event-source allowlist (drop unknown org/project IDs)
    (4) ATOMIC CLAIM via SQLite UNIQUE(sentry_org_id, sentry_project_id, issue_id, attempt_window_24h) insert
        OR O_EXCL `tasks/sentry-fixer/claims/<hash>.json` file create.
        On UNIQUE-violation / EEXIST → ALREADY-CLAIMED, return 200 OK with no spawn (idempotency).
    (5) records attempt-start with idempotency_key = SHA256(sentry_event_id) BEFORE spawn
    ↓
Daemon spawns ephemeral agent: daemon-sentry-fixer
    ↓
Agent receives: issue_id, trace_id, file:line, error msg, env, frequency,
                resolved_repo_path, allowed_repo_remote, idempotency_key
    ↓
Agent uses mcp__sentry__* to fetch full trace context (Layer C)
    ↓
Agent reads affected file from clients/<project>/ checkout on VPS
    ↓
Agent computes affected file paths → checks against code-scope DENYLIST
    (auth/, credentials/, billing/, IAM/, secrets/ — see safety constraint 7)
    If any affected path matches denylist:
       → STOP. Telegram notification only. No PR. No spawn-side commits.
    ↓
Agent proposes fix → routes through Mode 1 pipeline (NOT auto-commit):
   → Auto-PR via `/iago-quick` pipeline (full review discipline)
       — pipeline opens PR branch
       — pipeline runs all stages incl. Codex adversarial
       — humans merge per `feedback_no_auto_merge.md`
   → Telegram notification ("fixer says X — see PR #N for review") with PR URL
    ↓
Cost ledger logs attempt + outcome with idempotency_key (canonical roadmap Phase 8)
    ↓
On agent exit (success/failure/timeout): write attempt-end to claim file
```

**Critical safety constraints (revised):**

1. **PR-only output. No "trusted-repo auto-commit" route.** Every Layer D fix terminates in a PR opened by `/iago-quick` (or `/iago-fast` if the change is genuinely trivial). Humans merge. The earlier draft of this spec floated a "high-confidence auto-commit on iago-os internal repo ONLY" path — that has been REMOVED. Rationale: (a) `feedback_no_auto_merge.md` prohibits any Claude-side merge; (b) there's no enforceable gate on "is this really the iago-os repo" without coordinated allowlist + realpath + git-remote + token-scope checks; (c) the daemon-sentry-fixer is itself running in Mode 3 (headless), so per `.iago/decisions/2026-05-19-three-invocation-modes.md` it MUST route code changes through Mode 1.

2. **Idempotent dedupe BEFORE agent spawn.** The webhook handler must atomically claim the (org, project, issue, 24h-window) tuple via SQLite `UNIQUE` insert OR `O_EXCL` file create BEFORE spawning the fixer agent. TOCTOU is unacceptable here — duplicate Sentry deliveries (which DO happen — Sentry retries on non-200) must be deduplicated at the handler, not at the agent. The agent never sees a duplicate trigger.

3. **Issue alerts, not Event alerts.** Sentry webhooks must fire on new/resurfaced/regressed issues only — never on every event. Configured at the Sentry project level. **Daemon-side check:** the webhook handler MUST verify the payload's `event_type` is one of `issue.created`, `issue.unresolved`, `issue.assigned`, or the equivalent alert-trigger types. Webhook payloads with `event_type: "event.fire"` or any per-event type must be rejected (logged + dropped). This is the daemon-side enforcement Codex flagged as missing.

4. **HMAC signature verification.** Every webhook payload MUST be verified against a rotating HMAC secret stored as a systemd credential (`iago-sentry-webhook-secret`). Secret rotation policy: rotate every 90 days OR after any suspected compromise. Tailscale-fronting alone is not sufficient (defense in depth). Verification happens BEFORE payload parsing — invalid signatures are dropped without logging the payload body (avoid log poisoning).

5. **PII scrubbing.** Pre-Sentry-send scrubbing lives in the SDK (`@sentry/node`, `@sentry/react`, `@sentry/aws-serverless`). For each client project, the Layer B implementer is responsible for:
   - Verifying default scrubbers are ON (PII, IP, cookie defaults)
   - Configuring a per-project denylist of known sensitive field names (e.g., Munet: `booking_email`, `phone`, `passport_id`; FullData: per `clients/fulldata/` PII inventory; DIN: B2B emails)
   - Audit: a Layer C agent query `mcp__sentry__find_issues` should return zero events containing literal PII tokens in a smoke-test sweep
   
   For the daemon (Layer A), `iago-os-daemon` Sentry project applies the same scrubbers; the only PII surface there is agent-prompted task text, scrubbed by default config.

6. **Fixer agent wall-clock timeout.** The 24h dedupe bounds invocation frequency, not duration. Max wall-clock time per fixer agent invocation: **20 minutes**. Kill via SIGTERM at timeout; record `aborted` to the claim ledger to preserve the 24h window (prevents immediate retry on the same issue). After SIGTERM fails to terminate in 30s, SIGKILL.

7. **Code-scope path denylist.** The fixer agent must not propose changes to auth, credential, billing, or IAM paths. Enforced at agent spawn time AS A PRE-CHECK before LLM dispatch — the daemon inspects the affected-files list (extracted from Sentry trace) and aborts spawn if any path matches:
   - `amplify/auth/**`, `**/auth*.ts`, `**/auth*.tsx`
   - `**/iam*`, `**/cognito*`
   - `**/secret*`, `**/credentials*`, `**/cred-bootstrap*`
   - `**/billing*`, `**/stripe*`, `**/payment*`
   - `runtime/daemon/cred-bootstrap.ts` (specifically — iago-os self-loop)
   - Any file under `.iago/state/`, `runtime/orgs/*/credentials/`
   
   On match: agent NOT spawned. Telegram notification only: "Sentry trace touches sensitive path X — manual review required." Logged to claim ledger as `denylist_blocked`.

8. **Repo-identity gate (replaces "iago-os repo only" slogan).** When the fixer agent operates against a repo, the daemon verifies BEFORE spawn:
   - `realpath(resolved_repo_path)` matches the daemon-config `allowed_repo_paths` for the Sentry project ID
   - `git -C <path> config remote.origin.url` matches the daemon-config `allowed_repo_remote` for that Sentry project
   - Token scope: the agent's `GH_TOKEN` cannot push to protected branches; restricted via fine-grained PAT scope (one PAT per repo)
   
   The "auto-commit only on iago-os repo" slogan from the prior draft is REMOVED — replaced with this enforcement-by-config gate that applies uniformly to all fix paths. No special iago-os carve-out exists.

**Implementation phases (revised):**

- **Canonical roadmap Phase 9 — Webhook/event shape lands first.** Generic Webhook/event-shape adapter from `docs/specs/iago-os-v2-vision.md` Phase 9. Handles HMAC + atomic claim + idempotency for ALL webhook sources (Sentry, GitHub, Linear, Slack, custom). Sentry is one event source among several. This is the prerequisite for all Layer D work.
- **Canonical roadmap Phase 10 (D-1) — iago-os-self version.** Wire the Sentry webhook → fixer-agent loop on the **iago-os repo itself first**. When the v2 daemon crashes in production, Sentry fires, fixer-agent proposes a PR fix (via `/iago-quick`), opens PR into iago-os. Test the entire loop on YOUR OWN infrastructure for ~1 month before generalizing. This is the v2 vision spec's Phase 10: *"Sentry → daemon → file-bus task → event-shape agent → pipeline → PR loop wired end-to-end."*
- **Canonical roadmap Phase 10+ (D-2) — generalize to one client.** Pick the lowest-risk client (probably FullData since it's a pricing mock, not handling money). Same loop, with Telegram approval gate. Post-Phase-10 generalization after the iago-os self-loop is battle-tested.

**Effort:**
- Phase 9 (Webhook/event shape, D-3 dep): ~1 week. Generic webhook-shape abstraction, HMAC, atomic claim infra, multi-source routing, dashboard integration.
- Phase 10 (D-1): ~2-3 days. Sentry-specific payload parser (default; re-evaluate PostHog at this point), fixer-agent prompt template, code-scope denylist, integration test against Sentry sandbox. Depends on Phase 9.
- Phase 10+ (D-2): ~1-2 days per client onboarding. Add Sentry project ID to allowlist, configure per-client denylist, smoke-test.

---

### Layer E — LLM telemetry via PostHog Claude Code plugin

**Surface:** every `claude -p` session spawned by the iaGO pipeline (Mode 1) — implementation, review, fix, codex-fallback, PR creation, @claude tag — plus interactive sessions on Santiago's machine. Also covers HTTP/SDK adapter Claude SDK calls in Phase 3+.

**Tool: PostHog Claude Code plugin** (`claude plugin install posthog`). Documented at [posthog.com/docs/llm-analytics/installation/claude-code](https://posthog.com/docs/llm-analytics/installation/claude-code).

**What it captures (automatic, no per-session wiring):**
- `$ai_generation` events per LLM call: model, input tokens, output tokens, cache tokens, cost (USD, computed per-model), latency, stop reason, optional conversation content (privacy mode strips it)
- `$ai_span` events per tool execution: Bash, Read, Edit, Write, Glob, Grep, MCP tool calls — with duration and errors per span
- `$ai_trace` per completed session: aggregated token totals, total cost, total latency, session metadata

**What this directly addresses for iaGO v2:**
- **Cost per client project.** Tag pipeline sessions with `client=munet`, `client=din`, `client=iago-os` (instrument the dispatcher to pass a `POSTHOG_DISTINCT_ID` or custom property at spawn time). Query via Layer C PostHog MCP: "show me last-month cost by client."
- **Failed tool call detection.** `$ai_span` events with non-zero error counts surface flaky tools without log-grepping `.iago/summaries/`. Cross-session pattern: HogQL query over spans grouped by tool name + error type.
- **Model cost tracking.** Anthropic Claude vs Codex CLI (when wired in Phase 3+) tracked as separate models in the same dashboard.
- **Pipeline stage performance.** Each stage of `execute-pipeline.sh` shows up as a separate session — implementation stages can be compared for token usage across plans, identifying expensive plans before they balloon.

**Honest gap:** the plugin fires on `SessionEnd`, not in real time. A mid-session PTY crash may lose the in-flight span data. This is fine for cost reporting (which is post-hoc by nature) but not a substitute for Layer A's real-time exception capture in the daemon.

**Implementation (zero-VPS-infra, available today):**
1. On Santiago's machine: `claude plugin install posthog`
2. Set two env vars in shell profile: `POSTHOG_PROJECT_API_KEY=<key>` + `POSTHOG_HOST=https://us.i.posthog.com` (or eu, per account region)
3. Verify by running a trivial `claude -p "hello"` session, then querying PostHog UI for the `$ai_generation` event
4. (Optional, Phase 3+) Repeat on the VPS for daemon-spawned `claude -p` sessions in `execute-pipeline.sh`. At that point, the env vars come from systemd-creds via `cred-bootstrap.ts` (separate PR; not in 01b).

**One-time decision: separate PostHog project for LLM telemetry.** Use a dedicated `iago-os-llm-telemetry` project on PostHog (NOT the client-app projects under Layer B). Rationale: LLM events are high-volume (1 session = dozens of $ai_generation + hundreds of $ai_span events); mixing them into a client project obscures product analytics and risks blowing the per-project event ceiling. The dedicated project also lets the Layer C PostHog MCP scope cleanly: "ask the iago-os-llm-telemetry project for cost/usage" vs "ask the munet project for booking-funnel data."

**Credentials (zero VPS infra for Phase 1–2):**
- Santiago's machine: `POSTHOG_PROJECT_API_KEY` (iago-os-llm-telemetry project) + `POSTHOG_HOST` in `~/.bashrc` or per-shell.
- VPS daemon (Phase 3+): queue `POSTHOG_LLM_TELEMETRY_KEY` + `POSTHOG_HOST` for the Phase 3 cred-bootstrap PR (NOT amended into Plan 01b — cutover-locked).

**Effort:** ~10 minutes Santiago-side (plugin + 2 env vars + smoke verify). VPS-side ~1 hour as part of the Phase 3 cred-bootstrap PR (alongside SENTRY_DAEMON_DSN provisioning).

**Phase:** **Available today on Santiago's machine.** No VPS dependency until Phase 3 (when pipeline runs may also run on the VPS daemon). NO new code in v2 plans 01a/01b/02a/02b/etc. — pure configuration.

---

## Phase mapping summary

| Layer | Tool | What | Phase (canonical v2 roadmap) |
|---|---|---|---|
| **A** | Sentry | Daemon observability (`iago-os-daemon` Sentry project, SDK in `runtime/daemon/main.ts`) | **Phase 3 head** (post-cutover) |
| **B** | **PostHog** *(switched 2026-05-20)* | Per-client app observability + analytics (one PostHog project per client, React + Lambda) | **Phase 3** ongoing (audit + gap-fill) |
| **C** | Sentry MCP + **PostHog MCP** | Dual MCP for agent queries (Sentry = trace context, PostHog = cost/usage) | **After one-time setup** (independent of canonical phases) |
| **D-1** | Sentry *(default; re-evaluate at impl)* | One-off webhook → fixer-agent loop on iago-os repo itself | **Phase 10** (requires Phase 9) |
| **D-2** | Sentry *(default; re-evaluate at impl)* | Generalize to one client (FullData first) | **Phase 10+** (post-Phase-10) |
| **D-3** | source-agnostic | Webhook/event shape (prerequisite for all D-N) | **Phase 9** (per v2 vision) |
| **E** | **PostHog Claude Code plugin** *(new 2026-05-20)* | LLM telemetry: $ai_generation, $ai_span, $ai_trace per pipeline session | **Available today** (zero VPS infra; VPS-side wiring queued for Phase 3 cred-bootstrap) |

---

## Decisions taken (post-dual-adversarial-review + 2026-05-20 PostHog split)

1. **Cloud Sentry, not self-hosted.** Free tier covers solo dev; Team tier ~$26/mo covers a small fleet. Self-hosting is operational drag for our scale.
2. **One Sentry project per error surface** (`iago-os-daemon` only — Layer A). **One PostHog project per client app** (`munet`, `fulldata`, `din-pro`, `sentria` — Layer B). **One dedicated PostHog project for LLM telemetry** (`iago-os-llm-telemetry` — Layer E). Mixing surfaces obscures filtering and risks per-project event ceilings.
3. **No SDK changes in operational `feature-phase-2-vps-bootstrap` scope.** Cutover is locked; adding any new observability + credential surface (Sentry OR PostHog) is risk-on for marginal value. Both land canonical Phase 3 head with the credential provisioning entries that Plan 01a/01b currently do NOT have.
4. **iago-os self-loop ships before client loop.** Sentry → auto-fix must be exercised on YOUR OWN infrastructure first. A month of dogfooding before exposing it to client production.
5. **Every Layer D fix terminates in a PR.** No "trusted-repo auto-commit" route — removed per `feedback_no_auto_merge.md` and dual-review findings. The repo-identity gate (constraint 8) replaces the slogan with enforceable config.
6. **Issue alerts at Sentry-side AND event_type allowlist at daemon-side.** Both must be in place; misconfigured Sentry alerts are caught daemon-side.
7. **Atomic dedupe at the webhook handler, not the agent.** SQLite UNIQUE insert or O_EXCL claim before spawn. TOCTOU race ruled out.
8. **Code-scope denylist enforced at spawn time** (pre-LLM dispatch). Sensitive paths never reach the fixer agent's reasoning loop.
9. **PostHog covers Layer B; Sentry stays on Layer A** (2026-05-20). Sentry's developer free tier is 1-user only — Santiago alone today, Sebas joining Phase 6. PostHog free tier is unlimited team + 1M events. The split keeps Sentry's auto-instrument depth (where it matters most — daemon errors that may trigger Layer D) and uses PostHog's free ceiling for client apps that don't need fix-loop-grade trace fidelity.
10. **Layer E uses the PostHog Claude Code plugin, not custom instrumentation** (2026-05-20). 2 env vars + `claude plugin install posthog` captures every pipeline session's tokens / cost / tool-spans. Cross-session pattern queries become HogQL one-liners via Layer C PostHog MCP. Rolling our own LLM observability stack (Langfuse, OpenTelemetry) is rejected for current scale — revisit if iaGO ever needs agent-chain debugging that PostHog spans can't express.
11. **Layer D tool stays Sentry by default; re-evaluate at Phase 10 implementation** (2026-05-20). The fix-dispatch loop depends on Sentry's structured event payload + HMAC webhook + mature issue grouping. PostHog has all three but they're younger. If at Phase 10 the gap has closed AND PostHog Layer B is running clean for 3+ months, the Layer D default may flip to consolidate on PostHog. The Phase 9 Webhook/event shape adapter is source-agnostic so the swap cost is a different SDK + payload parser, not a Layer D redesign.

---

## Open questions

- **OQ-1:** Should the daemon-sentry-fixer agent be a PTY (Claude/Codex) or an HTTP/SDK shape? PTY is simpler to wire; HTTP/SDK is cheaper per-invocation. Defer until Phase 10 implementation begins.
- **OQ-2:** Per-agent Sentry projects, or one project with `agent_id` tag? Current spec says single project — but if the agent fleet grows past ~20 agents, splitting may be valuable for separate alert routing. Revisit at canonical Phase 8 (cost ledger UI) when we have data on agent volume.
- **OQ-3:** What's the LangGraph / HTTP/SDK shape Sentry integration pattern? `@sentry/node` works for any Node process, but instrumenting LangGraph workflow steps as Sentry transactions is non-obvious. Defer to canonical Phase 3 when LangGraph adapter lands.
- **OQ-4 (from review):** HMAC secret rotation — manual 90-day cycle, or automated via the daemon's credential bootstrap path? Lean toward automated when Plan 06 (SIGHUP credential reload, in flight) ships; until then, manual + documented.
- **OQ-5 (from review):** Per-client PII denylist storage — in the client repo as `.sentry-pii-denylist.json`, in the Sentry project config UI, or in the daemon config? Defer to Layer B per-client setup; revisit if we hit a real PII leak.
- **OQ-6 (2026-05-20):** PostHog region — `us.i.posthog.com` vs `eu.i.posthog.com`. Defaults to the region of Santiago's account at signup; verify before provisioning the iago-os-llm-telemetry project. Affects `POSTHOG_HOST` env var across Layers B + E.
- **OQ-7 (2026-05-20):** Plugin-vs-manual instrumentation in long-lived daemon `claude -p` sessions. The PostHog Claude Code plugin hooks `SessionEnd` — short-lived `claude -p` pipeline stages flush correctly. Pipeline stages spawned by the v2 daemon (Phase 3+) are also short-lived (one per stage). But if Phase 3 introduces persistent daemon-side `claude -p` workers, a session may run for hours and never trigger `SessionEnd` — losing telemetry. Defer to Phase 3 when the first long-lived daemon claude-pty agent ships; if it's a real gap, add explicit `posthog-node` `captureEvent` calls in the adapter as a backup.
- **OQ-8 (2026-05-20):** Layer D re-evaluation trigger at Phase 10. The amendment says "Sentry default, re-evaluate at impl." Make the re-evaluation concrete: at Phase 10 kickoff, the implementer runs a 2-page comparison of (a) PostHog error grouping quality over 3+ months of Layer B data vs (b) Sentry's grouping in the same period. If PostHog grouping passes a defined bar (false-positive rate <X%, dedup accuracy >Y%), flip Layer D to PostHog and decommission the Sentry surface. Bar values to be set when the comparison runs (don't pre-commit to numbers without data).

---

## References

- `docs/specs/iago-os-v2-vision.md` — Canonical v2 vision; Phase 9 = Webhook/event shape, Phase 10 = Sentry/daemon/file-bus/event-shape/pipeline loop
- `docs/specs/iago-os-v2-master-prompt.md` — Sentry MCP install block + master prompt
- `.claude/rules/layer-triage.md` — Mentions Sentry-trace → fix-dispatch as rule-based+AI hybrid
- `.iago/decisions/2026-05-19-three-invocation-modes.md` — Three modes of agent invocation (this spec's Layer D fixer is Mode 3 → routes code changes through Mode 1)
- `.iago/decisions/2026-05-20-posthog-sentry-split-and-memory.md` — ADR for the 2026-05-20 PostHog split + SQLite-as-6th-layer memory verdict (this spec is the operational embodiment of that ADR)
- `memory:feedback_no_auto_merge` — Claude never merges PRs; auto-commit removed from this spec accordingly
- Sentry MCP: `mcp__sentry__authenticate`, `mcp__sentry__complete_authentication` — install via `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp` (see master-prompt § Sentry MCP install; not yet active in CLAUDE.md MCP table)
- PostHog MCP: install via `claude mcp add --transport http posthog https://mcp.posthog.com/mcp` (verify exact URL per `posthog.com/docs/model-context-protocol` at install time)
- PostHog Claude Code plugin: install via `claude plugin install posthog` ([posthog.com/docs/llm-analytics/installation/claude-code](https://posthog.com/docs/llm-analytics/installation/claude-code))
