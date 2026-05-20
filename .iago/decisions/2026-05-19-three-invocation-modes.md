# ADR — Three Modes of Agent Invocation

**Date:** 2026-05-19
**Status:** Accepted (amended post-dual-adversarial-review 2026-05-19)
**Decided by:** Santiago, 2026-05-19
**Author:** Claude (orchestrator) + Santiago direction
**Supersedes:** Implicit pipeline-is-mandatory framing in older iaGO-OS workflow docs

> **Phase-numbering note:** This ADR uses the operational `feature-phase-N` numbering (e.g., `feature-phase-2-vps-bootstrap` ships cutover + VPS install). The canonical vision spec (`docs/specs/iago-os-v2-vision.md` § Phase Sequencing) uses roadmap Phase 0–12 numbering where the OpenClaw→v2 cutover is Stage D / roadmap Phase 7. Both refer to the same Sunday 2026-05-25 cutover event; the operational `feature-phase-2` is a compressed grouping that includes VPS install + cutover artifacts.

---

## Context

The pipeline (`scripts/execute-pipeline.sh`) has been the primary path for code-generation work since v1 of iaGO-OS. Every `/iago-execute`, `/iago-quick`, and `/iago-fast` skill either runs the pipeline or bypasses it via the build-gate-only path. As a result, internal mental models — Santiago's, the team's, and the orchestrator's — have conflated "running an agent" with "running the pipeline."

The v2 multi-agent OS vision adds a separate execution path: the daemon hosts long-running agents as **infrastructure** (e.g., `claude-implement`, `codex-review`, `langgraph-research`) addressable via Telegram, cron, or webhook. **This is a NEW surface alongside the pipeline, NOT a replacement OR a substrate that the pipeline runs on.**

In a Telegram session on 2026-05-19, Santiago surfaced the confusion explicitly: "what if I want claude-implement but I don't necessarily want it to go through iago-execute… is that a thing?" This ADR locks the answer.

---

## Decision

**Three distinct modes of agent invocation are first-class in iaGO-OS v2. All three coexist. None is mandatory for the modes' own use cases. Repository-code-change work continues to follow the canonical skill-routing rule (see "What this does NOT change" below).**

### Mode 1 — Pipeline-wrapped invocation

**Surface:** `/iago-execute`, `/iago-quick`, `/iago-fast`, `/iago-prfix` skills

**What happens:** `scripts/execute-pipeline.sh` runs as a script via `child_process` and orchestrates **fresh, ephemeral `claude -p` sessions per stage** (stress → implement → build → review → Codex → fix → PR → @claude tag → summary). Six to eight isolated stages. Each stage gets its own clean context. Output is a PR with full review discipline.

**Important architectural note:** Mode 1 stages are **NOT** invocations of a long-running named daemon agent. The pipeline does not consume the `AgentRuntime` registry — it spawns its own short-lived processes via `child_process`. This isolation is intentional: fresh prefix cache per stage, no agent-state bleed, self-freeze of `scripts/execute-pipeline.sh` to prevent byte-offset hazards, and stage-scoped telemetry. The canonical mechanism is defined in `docs/specs/iago-os-v2-vision.md` § "Process step 4" and `.claude/rules/execution-pipeline.md`.

**When to use:** All implementation work on tracked repos (iago-os, clients/\*, runtime/), client deliverables, money on the line, work that requires the review discipline and audit trail. The cross-model Codex review and severity-floor multi-pass review are the moat.

**Cost:** ~30-60 minutes per plan, multiple model invocations, ~$2-8 per plan depending on size.

### Mode 2 — Direct invocation of a long-running daemon agent

**Surface:** Telegram bot routing to a named agent registered in the daemon (`runtime/orgs/<org>/agents/<name>/config.json`). From phone: `/start claude-main` → `/inject claude-main "<task text>"`. From laptop (post–dashboard ship): dashboard "send to agent" widget.

**What happens:** The daemon spawns or wakes the named agent via its `AgentRuntime` adapter. Agent receives the task verbatim, works in its own long-lived session (PTY, HTTP/SDK, MCP, etc.), and may need approval for sensitive operations via the file-bus approval handshake. **No pipeline orchestration. No stress test, no Codex pass, no automatic PR.**

**When to use:** Operational and runtime tasks that do NOT modify tracked repository code — answering a question against live infra, querying logs, triaging an incident from your phone, exploring agent capabilities, running an ad-hoc daemon-side analysis. Mode 2 is the runtime control plane; it is **not** an escape hatch for implementation work that should go through Mode 1.

**Mode 2 boundary (explicit, do not relax):**

- **CAN do via Mode 2:** read-only queries against live infra, dashboard-style "show me X" requests, incident triage, log/journal inspection, runtime config introspection, agent-to-agent prototyping that does not commit code.
- **CANNOT do via Mode 2:** edit files on a tracked repo, commit, push, open PRs, modify production config that's under source control. Repository code changes go through Mode 1 (the canonical skill-routing rule).
- **Edge case — `claude -p` from laptop:** running `claude -p "<task>"` on your local machine outside any iaGO skill is **NOT** Mode 2 — it is unsanctioned direct work. If the task changes tracked repo code, use `/iago-fast` (≤3 files, obvious) or `/iago-quick`. Mode 2 specifically refers to invoking a daemon-hosted named agent, not raw `claude -p`.

**Cost:** Single-agent invocation, ~$0.30-2 per task depending on scope.

### Mode 3 — Headless / scheduled invocation

**Surface:** Cron (Phase 2 Plan 07a — in flight), webhook handlers (canonical roadmap Phase 9 — Shape 4 Webhook/event), Sentry triggers (per `docs/specs/sentry-integration.md` Layer D, lands canonical roadmap Phase 9+), external event sources.

**What happens:** No user in the loop at invocation time. The daemon spawns the agent in response to a trigger. Agent does its task autonomously. May or may not require human approval before destructive actions — configured per-agent and per-trigger. Reports outcome to file-bus + Telegram notification (typically).

**Mode 3 implementation-discipline constraint:** if the triggered agent's job IS to land code changes (e.g., a Sentry-fix agent that proposes a fix), it MUST route the fix through Mode 1 (the pipeline) for PR creation. The trigger is automated; the code-change discipline is not. See `docs/specs/sentry-integration.md` § "Critical safety constraints" for the canonical enforcement requirements.

**When to use:** Routine work that doesn't need human attention every time. Nightly digests, dependency-update PRs (which themselves use Mode 1 for the PR creation), Sentry-trace triage, PR-triage on incoming GitHub PRs, log analysis, periodic health reports.

**Cost:** Depends on cadence and agent. Cost ledger (canonical roadmap Phase 8) tracks per-agent spend so spend-runaway agents are visible and throttleable.

---

## Implications

### For users (Santiago, Sebas, future team)

- **The pipeline (Mode 1) remains the single path for code changes on any tracked repo.** Mode 2 exists for runtime/operational tasks; Mode 3 exists for triggered automation. None of them is a shortcut for "I want to change some code without going through review."
- **One physical Claude/Codex/etc. backend can serve multiple modes.** The daemon may host a `claude-implement` agent for Mode 2 use (e.g., answering Telegram questions about a client deployment), while Mode 1 separately spawns ephemeral `claude -p` processes for pipeline stages. They are SEPARATE processes, not the same long-lived agent doing double duty.
- **Different agents for different intents is the design.** See the 5-shape `AgentRuntime` registry in `docs/specs/iago-os-v2-vision.md` — different LLMs (Claude, Codex, Gemini), different shapes (PTY, HTTP/SDK, MCP-as-agent, Webhook/event, Daemon), all on one VPS, all addressable via Mode 2 or Mode 3.

### For the orchestrator (this Claude session)

- **`/iago-execute`, `/iago-quick`, `/iago-fast` remain the canonical path for repository code work.** The mandatory-skill rule in `CLAUDE.md` ("NEVER implement plan/spec/task by editing code directly") and `.claude/rules/execution-pipeline.md` ("the only way to skip the pipeline is `/iago-fast`") is **unchanged** by this ADR.
- **What this ADR adds:** awareness that Mode 2 (daemon-hosted agents) and Mode 3 (triggered agents) are first-class surfaces — not bypass routes for code work. When the user says "do X" and X is a runtime/operational task, Mode 2 is the answer. When X is code, route through Mode 1.
- Document Mode 3 triggers as they're built. The cron scheduler (Plan 07a) is a Mode 3 enabler; the Sentry-fix-dispatch (canonical roadmap Phase 9+ per `docs/specs/sentry-integration.md`) is another; both should have their own ADRs as they land.

### For the v2 daemon

- The daemon owns Mode 2 and Mode 3. The daemon does NOT own Mode 1 — the pipeline runs as a `child_process`-spawned script, independent of the daemon's agent lifecycle.
- The polymorphic `AgentRuntime` interface handles Mode 2/3 agent shapes; the pipeline handles its own stage orchestration via fresh `claude -p` invocations. Both surfaces are open for extension.

---

## What this does NOT change

- **The pipeline remains the only path for shipping code on a tracked repo.** Mode 1 is not deprecated, is not optional for repo work, is not "one of three options to choose by feel." It is foreground for any task that modifies tracked code.
- **The mandatory-skill rule (`CLAUDE.md` and `.claude/rules/execution-pipeline.md`) is unchanged.** The only way to skip the full pipeline for code work is `/iago-fast` (≤3 files, obvious change). Mode 2 is NOT an exemption — Mode 2 is for non-code runtime work.
- **The skill catalog stays.** `/iago-execute`, `/iago-quick`, `/iago-fast`, `/iago-prfix` remain the primary user-facing surface for repo work.
- **Plan files remain canonical for repo work.** Mode 2 and Mode 3 do not have plans because they don't modify repo code; that is part of their tradeoff. Mode 1 has plans because plans are the discipline contract for code changes.

---

## Open questions

- **OQ-1:** Should Mode 2 invocations produce summary artifacts (`.iago/summaries/`)? Lean toward "yes, lightweight summary only" — visibility matters, but a full pipeline-style summary is heavyweight. Defer until Mode 2 is actually in use post-cutover.
- **OQ-2:** How do Mode 2 invocations interact with STATE.md? If Santiago direct-invokes claude-main via Telegram for a runtime query, does it show up? Probably as a one-line entry in an "Ad-hoc Mode 2 invocations" table — TBD format. Revisit Phase 3.
- **OQ-3:** Mode 3 cost-runaway guards — the cost ledger (canonical roadmap Phase 8) gives visibility, but who/what enforces a hard limit? Currently underspecified. The Hermes pattern (rate limiter per-MCP-server) is the closest reference; needs to extend to per-agent and per-trigger. Defer to canonical Phase 8.
- **OQ-4 (new, from review):** What's the exact enforceable boundary between Mode 1 and Mode 2 at the laptop CLI? Today: `claude -p` raw call is unsanctioned; `/iago-fast` is Mode 1's minimum-discipline path; daemon-hosted `claude-implement` via Telegram is Mode 2. Need to revisit if Santiago wants a laptop-side Mode 2 entry point post-dashboard.

---

## References

- `docs/specs/iago-os-v2-vision.md` — Canonical v2 vision; the `AgentRuntime` polymorphic interface enables Mode 2/3 agent shapes
- `docs/specs/sentry-integration.md` — Sentry → auto-fix is the highest-value Mode 3 application; lands canonical roadmap Phase 9+
- `.iago/decisions/2026-05-15-agent-shape-taxonomy.md` — Five agent shapes (PTY, HTTP/SDK, MCP-as-agent, Webhook/event, Daemon) all support Mode 2 and Mode 3 invocation
- `.claude/rules/execution-pipeline.md` — Mandatory pipeline discipline for repo code work (Mode 1)
- `CLAUDE.md` — Mandatory-skill rule for all implementation work
- README.md — Project-level framing reflects this multi-mode model post-PR-#70
