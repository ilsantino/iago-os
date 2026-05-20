# Spec: Sentry Integration — Four-Layer Architecture

_Date: 2026-05-19 | Status: **Planned** (amended post-dual-adversarial-review 2026-05-19) | Authors: Claude (orchestrator) + Santiago direction_

> **Phase-numbering note:** Phase numbers in this spec reference the **canonical v2 roadmap** in `docs/specs/iago-os-v2-vision.md` § Phase Sequencing (Phase 0–12). They do NOT reference the operational `feature-phase-N` plan-folder numbering. In the canonical roadmap, OpenClaw→v2 cutover lands as **Stage D / roadmap Phase 7** (gated on Phase 6 dashboard stable), while the operational `feature-phase-2-vps-bootstrap` plan folder compresses VPS install + cutover into one operational unit shipping Sunday 2026-05-25. When this spec says "Phase 3" or "Phase 9" it means the canonical roadmap phase, not the operational folder.

---

## Context

iaGO-OS v2 is a multi-agent OS that hosts arbitrary agent shapes on a Hostinger VPS. The current v2 vision spec (`docs/specs/iago-os-v2-vision.md`) covers the runtime, control plane, dashboard, and preserved pipeline — but does **not** specify error observability, crash trace capture, or auto-fix dispatch on production errors.

The `.claude/rules/layer-triage.md` rule already references "Sentry-trace → fix-dispatch" as a rule-based+AI hybrid pattern. The Sentry MCP (`mcp__sentry__*`) is available via `claude mcp add` but has not yet been configured — install instructions are in `docs/specs/iago-os-v2-master-prompt.md` § "Sentry MCP" install block. Neither is wired into v2 operational planning. This spec closes that gap.

**This is NOT a Phase 2 / cutover scope addition.** The operational `feature-phase-2-vps-bootstrap` plan stack is locked through Sunday 2026-05-25 cutover. Sentry work is slotted into canonical roadmap Phases 3 (Layer A + B) and 9–10 (Layer D), all post-cutover.

---

## Vision

Sentry sits across iaGO-OS v2 in four distinct integration layers, each independently valuable, each shippable as a separate workstream. The full vision is: **production errors anywhere in the iaGO fleet (the v2 daemon itself, every client React app, every Lambda function) are observable in real time, queryable from agent reasoning loops, and — for the highest-confidence cases — auto-fixed by a dedicated agent that drives a pipeline PR.**

Every Layer D fix path terminates in a **PR**, not an auto-commit. There is no "trusted-repo auto-commit" route. See Layer D § "Critical safety constraints" for the canonical enforcement requirements.

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

**Phase:** Canonical roadmap **Phase 3**, post-cutover. Lower priority than client deliverables but worth a "Sentry audit pass" sprint when bandwidth allows.

---

### Layer C — Sentry MCP for agent queries

**Surface:** any agent (PTY, HTTP/SDK, MCP-as-agent, etc.) querying live Sentry state from inside its own reasoning loop.

**What it enables:**
- "Find all errors in the last hour on `munet`" — agent triages without leaving its session
- "What's the stack trace for issue #42?" — pinned investigation
- "How many users hit error X today?" — frequency-aware fix prioritization
- "What did Sentry log when this PR deployed?" — release-correlation queries

**Implementation:** the Sentry MCP server is available after a one-time setup. CLAUDE.md's active MCP table does not yet list Sentry — the install command is in `docs/specs/iago-os-v2-master-prompt.md` § "Sentry MCP" install block.

**One-time setup checklist:**
1. `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp`
2. Authenticate: `mcp__sentry__authenticate` → follow OAuth flow → `mcp__sentry__complete_authentication`
3. Verify query tools are available (list tools after auth to confirm `mcp__sentry__find_issues`, `mcp__sentry__get_issue_details`, etc.)
4. Add `sentry` to CLAUDE.md active MCP table once confirmed

**What's needed after setup:**
- Document which agents have Sentry MCP scope by default (probably all of them, gated by config)
- Establish "ask Sentry MCP before grep" pattern for production triage tasks (parallel to the Graphify "check the graph first" pattern in CLAUDE.md)

**Effort:** ~1 hour. One-time setup, one rules-doc addition.

**Phase:** **Available after one-time setup.** Run the checklist above before the next production triage session. Independent of any other Phase — runs on the Claude Code client side.

---

### Layer D — Sentry-webhook → auto-fix agent (the killer feature)

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
- Phase 10 (D-1): ~2-3 days. Sentry-specific payload parser, fixer-agent prompt template, code-scope denylist, integration test against Sentry sandbox. Depends on Phase 9.
- Phase 10+ (D-2): ~1-2 days per client onboarding. Add Sentry project ID to allowlist, configure per-client denylist, smoke-test.

---

## Phase mapping summary

| Layer | What | Phase (canonical v2 roadmap) |
|---|---|---|
| **A** | Daemon observability (`iago-os-daemon` Sentry project, SDK in `runtime/daemon/main.ts`) | **Phase 3 head** (post-cutover) |
| **B** | Per-client app observability (one Sentry project per client, React + Lambda) | **Phase 3** ongoing (audit + gap-fill) |
| **C** | Sentry MCP for agent queries | **After one-time setup** (independent of canonical phases) |
| **D-1** | One-off Sentry → fixer-agent loop on iago-os repo itself | **Phase 10** (requires Phase 9) |
| **D-2** | Generalize to one client (FullData first) | **Phase 10+** (post-Phase-10) |
| **D-3** | Webhook/event shape (prerequisite for all D-N) | **Phase 9** (per v2 vision) |

---

## Decisions taken (post-dual-adversarial-review)

1. **Cloud Sentry, not self-hosted.** Free tier covers solo dev; Team tier ~$26/mo covers a small fleet. Self-hosting is operational drag for our scale.
2. **One project per surface** (`iago-os-daemon`, `munet`, `fulldata`, `din-pro`, `sentria`). Mixing surfaces in one project obscures tag-based filtering.
3. **No Sentry SDK in operational `feature-phase-2-vps-bootstrap` scope.** Cutover is locked; adding a new observability + credential surface is risk-on for marginal value. Layer A lands canonical Phase 3 head, including the credential provisioning entries that Plan 01a/01b currently do NOT have.
4. **iago-os self-loop ships before client loop.** Sentry → auto-fix must be exercised on YOUR OWN infrastructure first. A month of dogfooding before exposing it to client production.
5. **Every Layer D fix terminates in a PR.** No "trusted-repo auto-commit" route — removed per `feedback_no_auto_merge.md` and dual-review findings. The repo-identity gate (constraint 8) replaces the slogan with enforceable config.
6. **Issue alerts at Sentry-side AND event_type allowlist at daemon-side.** Both must be in place; misconfigured Sentry alerts are caught daemon-side.
7. **Atomic dedupe at the webhook handler, not the agent.** SQLite UNIQUE insert or O_EXCL claim before spawn. TOCTOU race ruled out.
8. **Code-scope denylist enforced at spawn time** (pre-LLM dispatch). Sensitive paths never reach the fixer agent's reasoning loop.

---

## Open questions

- **OQ-1:** Should the daemon-sentry-fixer agent be a PTY (Claude/Codex) or an HTTP/SDK shape? PTY is simpler to wire; HTTP/SDK is cheaper per-invocation. Defer until Phase 10 implementation begins.
- **OQ-2:** Per-agent Sentry projects, or one project with `agent_id` tag? Current spec says single project — but if the agent fleet grows past ~20 agents, splitting may be valuable for separate alert routing. Revisit at canonical Phase 8 (cost ledger UI) when we have data on agent volume.
- **OQ-3:** What's the LangGraph / HTTP/SDK shape Sentry integration pattern? `@sentry/node` works for any Node process, but instrumenting LangGraph workflow steps as Sentry transactions is non-obvious. Defer to canonical Phase 3 when LangGraph adapter lands.
- **OQ-4 (from review):** HMAC secret rotation — manual 90-day cycle, or automated via the daemon's credential bootstrap path? Lean toward automated when Plan 06 (SIGHUP credential reload, in flight) ships; until then, manual + documented.
- **OQ-5 (from review):** Per-client PII denylist storage — in the client repo as `.sentry-pii-denylist.json`, in the Sentry project config UI, or in the daemon config? Defer to Layer B per-client setup; revisit if we hit a real PII leak.

---

## References

- `docs/specs/iago-os-v2-vision.md` — Canonical v2 vision; Phase 9 = Webhook/event shape, Phase 10 = Sentry/daemon/file-bus/event-shape/pipeline loop
- `docs/specs/iago-os-v2-master-prompt.md` — Sentry MCP install block + master prompt
- `.claude/rules/layer-triage.md` — Mentions Sentry-trace → fix-dispatch as rule-based+AI hybrid
- `.iago/decisions/2026-05-19-three-invocation-modes.md` — Three modes of agent invocation (this spec's Layer D fixer is Mode 3 → routes code changes through Mode 1)
- `memory:feedback_no_auto_merge` — Claude never merges PRs; auto-commit removed from this spec accordingly
- Sentry MCP: `mcp__sentry__authenticate`, `mcp__sentry__complete_authentication` — install via `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp` (see master-prompt § Sentry MCP install; not yet active in CLAUDE.md MCP table)
