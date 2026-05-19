# ADR — Three Modes of Agent Invocation

**Date:** 2026-05-19
**Status:** Accepted
**Decided by:** Santiago, 2026-05-19
**Author:** Claude (orchestrator) + Santiago direction
**Supersedes:** Implicit pipeline-is-mandatory framing in older iaGO-OS workflow docs

---

## Context

The pipeline (`scripts/execute-pipeline.sh`) has been the primary path for code-generation work since v1 of iaGO-OS. Every `/iago-execute`, `/iago-quick`, and `/iago-fast` skill either runs the pipeline or bypasses it via the build-gate-only path. As a result, internal mental models — Santiago's, the team's, and the orchestrator's — have conflated "running an agent" with "running the pipeline."

The v2 multi-agent OS vision changes this. The daemon hosts agents as **infrastructure**. Agents are addressable resources (e.g., `claude-implement`, `codex-review`, `langgraph-research`). The pipeline is **one consumer** of these agents — an opinionated wrapper that orchestrates them through a review discipline. It is not the only consumer.

In a Telegram session on 2026-05-19, Santiago surfaced the confusion explicitly: "what if I want claude-implement but I don't necessarily want it to go through iago-execute… is that a thing?" This ADR locks the answer.

---

## Decision

**Three distinct modes of agent invocation are first-class in iaGO-OS v2. All three coexist. None is mandatory. Choose by intent, not by habit.**

### Mode 1 — Pipeline-wrapped invocation

**Surface:** `/iago-execute`, `/iago-quick`, `/iago-fast`, `/iago-prfix`

**What happens:** `scripts/execute-pipeline.sh` (or its `/iago-fast` build-gate-only variant) orchestrates fresh `claude -p` sessions through stress → implement → build → review → Codex → fix → PR → @claude tag → summary. Six to eight isolated stages. Output is a PR with full review discipline.

**When to use:** Client deliverables, money on the line, work that requires the review discipline and audit trail. Anything destined for production. The cross-model Codex review and severity-floor multi-pass review are the moat — use it where it matters.

**Cost:** ~30-60 minutes per plan, multiple model invocations, ~$2-8 per plan depending on size.

### Mode 2 — Direct invocation

**Surface:** Telegram bot routing to a named agent. From phone: `/start claude-main` → `/inject claude-main "refactor the auth middleware to use JWT"`. From laptop (post-Phase-6): dashboard "send to agent" widget.

**What happens:** The daemon spawns or wakes the named agent. Agent receives the task verbatim. No pipeline orchestration. No stress test, no Codex pass, no automatic PR. Agent works, may need approval for sensitive operations (file writes, network calls) via the file-bus approval handshake, and reports completion.

**When to use:** Internal work, prototypes, exploration, debugging, "just do it and I'll review the diff myself" tasks. Anything where review discipline is overhead, not value.

**Cost:** Single-agent invocation, ~$0.30-2 per task depending on scope.

### Mode 3 — Headless / scheduled invocation

**Surface:** Cron (Phase 2 Plan 07a — in flight), webhook handlers (Phase 9), Sentry triggers (per `docs/specs/sentry-integration.md` Phase 4+), external event sources.

**What happens:** No user in the loop at invocation time. The daemon spawns the agent in response to a trigger. Agent does its task autonomously. May or may not require human approval before destructive actions — configured per-agent. Reports outcome to file-bus + Telegram notification (typically).

**When to use:** Routine work that doesn't need human attention every time. Nightly digests, dependency-update PRs, Sentry-trace triage, PR-triage on incoming GitHub PRs, log analysis, periodic health reports.

**Cost:** Depends on cadence and agent. Cost ledger (Phase 8) tracks per-agent spend so spend-runaway agents are visible and throttleable.

---

## Implications

### For users (Santiago, Sebas, future team)

- **No more "the pipeline is the only way."** When you want speed, use Mode 2. When you want discipline, use Mode 1. When you want it to happen without you, use Mode 3.
- **One agent can serve all three modes simultaneously.** `claude-implement` lives on the VPS. The pipeline invokes it (Mode 1) for client-PR work. You invoke it directly via Telegram (Mode 2) for a quick refactor on internal infra. A cron job invokes it (Mode 3) at 3am to run a dependency-update sweep.
- **Different agents for different intents is the design.** See the 14-agent fleet sketch referenced from the README's v2 framing — different LLMs (Claude, Codex, Gemini), different shapes (PTY, HTTP/SDK, MCP-as-agent, Webhook/event, Daemon), all on one VPS, all addressable.

### For the orchestrator (this Claude session)

- Stop treating `/iago-execute` as the only valid path to invoking an agent. When the user says "do X" and X is small / internal / exploratory, dispatch in Mode 2 (or fall back to direct edit if the user is operating on the laptop). When X is client-bound and needs discipline, route to Mode 1.
- **The skill-invocation-is-required rule (`.claude/rules/execution-pipeline.md`) still applies for plan-driven work,** because plans exist specifically to capture the discipline contract. Direct invocation skips the plan; if a plan exists, use the skill.
- Document Mode 3 triggers as they're built. The cron scheduler (07a) is a Mode 3 enabler; the Sentry-fix-dispatch (Phase 4+) is another; both should have their own ADRs as they land.

### For the v2 daemon

- The daemon does not know or care which mode invoked an agent. From its perspective, every invocation is "spawn agent X with task Y." The mode distinction lives **above** the daemon (in the pipeline script, the Telegram bot, the cron scheduler, the webhook handler).
- This means adding a new invocation surface is a matter of adding a new caller to the daemon's IPC — not a daemon-internal change. The polymorphic `AgentRuntime` interface handles the agent side; the multi-mode surface handles the caller side. Both are open for extension.

---

## What this does NOT change

- **The pipeline remains the primary path for shipping client work.** Mode 1 is not deprecated; it is foreground. The moat — cross-model Codex review, severity floors, secret-exclusion staging — is unchanged.
- **The skill catalog stays.** `/iago-execute`, `/iago-quick`, `/iago-fast`, `/iago-prfix` remain the primary user-facing surface for Mode 1 work.
- **Plan files remain canonical.** Mode 2 and Mode 3 do not have plans; that is part of their tradeoff. Mode 1 has plans because plans are the discipline contract.

---

## Open questions

- **OQ-1:** Should Mode 2 invocations also produce summary artifacts (`.iago/summaries/`), or is that overhead for the "just do it" intent? Lean toward "yes, lightweight summary only" — visibility matters, but a full pipeline-style summary is heavyweight. Defer until Mode 2 is actually in use post-cutover.
- **OQ-2:** How do Mode 2 invocations interact with the orchestrator's plan-tracking discipline? If Santiago direct-invokes claude-implement to refactor X, does that show up in STATE.md? Probably as a one-line entry in an "Ad-hoc invocations" table — TBD format. Revisit Phase 3.
- **OQ-3:** Mode 3 cost-runaway guards — the cost ledger (Phase 8) gives visibility, but who/what enforces a hard limit? Currently underspecified. The Hermes pattern (rate limiter per-MCP-server) is the closest reference; needs to extend to per-agent and per-trigger. Defer to Phase 8.

---

## References

- `docs/specs/iago-os-v2-vision.md` — Canonical v2 vision; the `AgentRuntime` polymorphic interface enables this multi-mode design
- `docs/specs/sentry-integration.md` — Sentry → auto-fix is the highest-value Mode 3 application
- `.iago/decisions/2026-05-15-agent-shape-taxonomy.md` — Five agent shapes (PTY, HTTP/SDK, MCP-as-agent, Webhook/event, Daemon) all support all three invocation modes
- `.claude/rules/execution-pipeline.md` — Pipeline discipline rules (apply to Mode 1)
- README.md — Project-level framing reflects this multi-mode model post-PR-#70
