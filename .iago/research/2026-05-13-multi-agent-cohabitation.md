# Multi-Agent Cohabitation: cortextOS / Hermes / Paperclip
**Date:** 2026-05-13
**Context:** Input for `docs/specs/iago-os-v2-vision.md`. Vision locked: Hostinger VPS + Tailscale mesh, Codex + Claude cohabiting, Telegram-primary control, web dashboard for live state + intervention. Pipeline kept.

> **AMENDMENT 2026-05-15:** This artifact is the source research for the 2026-05-13 vision lock. The 2026-05-15 spec amendment (PR #39 / `.iago/decisions/2026-05-15-agent-shape-taxonomy.md`) introduces additional findings that override two recommendations below:
>
> 1. **Streamlit fallback dashboard recommendation is REVOKED.** Phase 6 ships the full cortextOS Next.js dashboard directly — no Streamlit fallback. The agentic-os-dashboard pattern is retained only as a MCP health-check reference. Override reason: Garry-impressed standard ("build the ocean") + cross-model verdict that the Streamlit fallback creates a permanent half-finished UI risk.
> 2. **"PTY-only adapter registry" framing is REVOKED.** v2 hosts agents of any execution shape via a polymorphic `AgentRuntime` interface (5 shapes: PTY, HTTP/SDK, MCP-as-agent, Webhook/event, Daemon). PTY is Shape 1 of 5, not the universal abstraction. See `.iago/decisions/2026-05-15-agent-shape-taxonomy.md` for the full reframe.
> 3. **Hermes runtime adoption verdict REVISED.** Hermes runtime IS adopted in Phase 3 as a Shape 3 (MCP-as-agent) runtime via `hermes-mcp` adapter (was: "patterns only, runtime NOT adopted"). The Shape 3 abstraction enables coherent Hermes-as-runtime adoption that wasn't tractable under PTY-only framing.

---

## 1. cortextOS — File-Bus + PTY-Persistence Pattern

**Repo:** github.com/grandamenium/cortextos · TypeScript · MIT · 33 stars · active (last push 2026-05-11)
**Stack:** Node.js 20, PM2, Next.js dashboard, SQLite-adjacent JSONL/JSON files.

### Agent Registration

Agents register via filesystem scan, not a central registry call. The daemon (`src/daemon/agent-manager.ts`) walks `frameworkRoot/orgs/*/agents/` at startup, loads each agent's `config.json`, and builds a `Map<agentName, {process, checker, poller, activityPoller}>`. Two enable/disable mechanisms: per-agent `config.json` field `enabled: false`, or an instance-level `enabled-agents.json` registry written by CLI (`cortextos enable/disable`). No heartbeat ping at registration — purely filesystem-driven discovery.

**Multi-org fix (BUG-043):** `resolveAgentOrg()` in `agent-manager.ts` determines an agent's org through a four-step cascade: (1) explicit org param, (2) `enabled-agents.json` entry, (3) filesystem scan across all orgs, (4) fallback to daemon startup org. Enables agents in different orgs to cohabit on the same host without collision.

### File Bus and Work Claiming

The coordination primitive lives in `src/bus/task.ts`. Task claiming uses **POSIX O_EXCL semantics**: `claimTask()` writes a companion lock file at `<taskDir>/.claims/<taskId>.claim` with flag `'wx'` (write exclusive). First writer wins; subsequent attempts receive `EEXIST` and throw `"already claimed by X"`. Re-claiming by the same agent is idempotent. Tasks must be in `'pending'` status to claim — non-pending tasks are rejected at the claim layer.

Task files are JSON, named `task_<epoch>_<random>.json`, stored in a shared bus directory on the filesystem. Fields: `status`, `assigned_to`, `blocked_by[]`, `blocks[]`, `org`, `project`. Cross-org task lookup uses a two-tier strategy: fast same-org path first, then fallback scan across all orgs — enabling specialists in one org to claim tasks filed by orchestrators in another.

**What this is NOT:** There is no shared DB, no message queue, no Redis. The entire state substrate is the local filesystem. This is both the strength (zero infra beyond a VPS) and the weakness (no native distributed coordination across machines).

### Agent Communication

Each running agent gets a `FastChecker` instance (`src/daemon/fast-checker.ts`) — one-to-one. Messages arrive via two paths: Telegram messages queued via `queueTelegramMessage()`, and inbox messages polled from `src/bus/message.ts`. Per poll cycle, both are merged into a `messageBlock` and injected into the agent's PTY via `agent.injectMessage()`. Agents communicate with each other by writing to each other's bus inboxes (filesystem files), not via direct IPC.

### Agent Crash and Restart

`AgentProcess` (`src/daemon/agent-process.ts`) monitors PTY exit codes and emits `onStatusChanged` events. `FastChecker` listens for crash events and triggers auto-restart. Crash count increments; after a threshold the agent enters `"halted"` state. Telegram notification fires: `"Agent crashed (crash #N) — auto-restarting"`. A `pendingRestarts` Set handles the race condition (BUG-011) where restart requests arrive during an ongoing shutdown. Before daemon shutdown, `.daemon-stop` marker files are written to agent state dirs to distinguish graceful stops from crashes — used on next boot to decide whether to restore or treat as cold start.

PTY sessions run via `src/pty/agent-pty.ts` (Claude Code) or `src/pty/codex-app-server-pty.ts` (Codex). Both adapters exist in the same daemon, meaning Claude Code and Codex agents cohabit natively. The `hermes-pty.ts` adapter also exists (experimental).

### Dashboard Visibility

The IPC server (`src/daemon/ipc-server.ts`) uses a Unix domain socket (macOS/Linux) or named pipe (Windows) for CLI-to-daemon communication. JSON messages with `type`, `agent`, `data`, `source` fields. The `fleet-health` IPC command walks `crons.json` + last-24h execution log for each agent and caches results for 30 seconds. The Next.js dashboard connects via this IPC server, not via a REST API or direct DB — it's local-first, same-host architecture.

### Telegram Routing

Telegram routing is **agent-specific**: each agent's `FastChecker` is initialized with a `chatId` and `allowedUserId`. There is no central router that decides which agent handles a message — instead each agent has its own bot token or chat binding. Human approvals use **file-based handshake**: approval buttons in Telegram trigger `appr_(allow|deny)_<approvalId>` callbacks, which call `routeApprovalCallback()`, moving a file from `pending/` to `resolved/` and notifying the requesting agent via its inbox. The agent's PTY-injected hook polls the response file, blocking until the approval lands. This is the "wait for human approval" primitive — file polling, not a socket or webhook.

### Key source files
- `src/daemon/agent-manager.ts` — registration, crash/restart, multi-org
- `src/daemon/fast-checker.ts` — Telegram routing, approval handshake, HITL waits
- `src/daemon/ipc-server.ts` — dashboard IPC, fleet health, cron management
- `src/bus/task.ts` — O_EXCL file-lock task claiming
- `src/pty/agent-pty.ts`, `codex-app-server-pty.ts` — PTY adapters per runtime

---

## 2. Hermes — Multi-Agent Pattern

**Repo:** github.com/NousResearch/hermes-agent · Python + React/Ink · MIT · 123K stars · v0.11.0 (2026-04-23)
**Primary local source:** `.iago/research/team-2-hermes-state.md` (22KB, comprehensive)

### Agent Spawning and Isolation

Hermes is not a multi-agent runtime in the same sense as cortextOS. It is a **single-agent CLI** with delegation capabilities. From `team-2-hermes-state.md` (Pattern 2, citing v0.11.0 release notes and `cli-config.yaml.example`):

The `delegation.*` config block controls subagent behavior: `max_spawn_depth` (1–3), `max_concurrent_children` (default 3), `orchestrator_enabled` (bool), `subagent_auto_approve`, `delegation.model`/`delegation.provider` override. Subagents with `role="orchestrator"` can spawn their own workers. Subagents are spawned as subprocess invocations of the same Hermes binary — isolated Python processes, not PTY sessions. Each subagent has its own context window and tool permissions.

### State Sharing and File Coordination

v0.11.0 adds an explicit **file-coordination layer** preventing concurrent sibling agents from overwriting each other's edits (Pattern 2). The mechanism is a patch-merge or locking wrapper — implementation details are not fully disclosed in public docs, but the config surface confirms it exists. This is distinct from cortextOS's O_EXCL approach: Hermes has a coordination layer that mediates concurrent edits, whereas cortextOS gives each agent exclusive claim on tasks before work begins.

**SQLite state:** Hermes uses SQLite (not raw JSON files) for session state, compression history, and skill metadata. This is a stronger persistence guarantee than cortextOS's JSONL files.

### Telegram Gateway and Message Routing

Hermes supports 17 messaging platforms (Telegram, Discord, Slack, Signal, WhatsApp, iMessage, WeChat, WeCom, Feishu, DingTalk, Matrix, Mattermost, QQBot, and others). Per `team-2-hermes-state.md` Wedge F: the gateway is a multi-platform adapter layer. For Telegram specifically, routing is **per-conversation-thread**: each conversation spawns a `claude -p` equivalent in a per-conversation worktree. There is no explicit per-agent routing by name from the Telegram surface — the conversation IS the agent context.

"Wait for human approval" in Hermes uses **reaction-based processing state**: the agent posts a message with buttons or reactions; the gateway polls for the reaction and resumes the agent session. This is architecturally similar to cortextOS's file-based handshake but implemented at the message-platform layer rather than the filesystem.

### Context Compression

`compression.*` config block: `enabled`, `threshold` (0.50 — trigger at 50% context fill), `target_ratio` (0.20), `protect_last_n` (20 messages). Compression model falls back to main model on 503/404. This is a runtime safety valve distinct from the distiller pattern. Source: `cli-config.yaml.example` compression section + v0.11.0 release notes.

### Shell Hooks and Lifecycle

`cli-config.yaml` `hooks.<event>[]`: wire any shell script as a lifecycle callback. Events: `pre_tool_call`, `post_tool_call`, `on_session_start`. Each hook entry has `matcher` (tool-name regex), `command` (script path), `timeout`. `hooks_auto_accept: bool` for non-interactive mode. Shipped v0.11.0. Source: `cli-config.yaml.example`; v0.11.0 release notes.

### MCP Sampling Controls

Per-MCP-server caps: `mcp_servers.<name>.sampling.enabled`, `.model`, `.max_tokens_cap` (default 4096), `.max_rpm`, `.max_tool_rounds` (default 5). Source: `cli-config.yaml.example` MCP section. Prevents runaway token burn from misbehaving MCP servers.

### Cron and Pre-LLM Gate

`cron/jobs.py` schema: `enabled_toolsets` (per-job tool whitelist), `wakeAgent` gate (script-return signal that skips LLM invocation entirely when no action is needed). Source: `cron/jobs.py` schema analysis; v0.11.0 release notes.

### What Hermes Is NOT

Hermes is not a multi-agent cohabitation runtime. It is one agent with controlled subagent delegation. Running N independent Hermes instances on the same host is not natively supported — each instance has its own config, SQLite DB, and skill catalog. Cohabitation of multiple independent Hermes agents requires external process management (PM2, systemd) and manual coordination. cortextOS's daemon handles exactly this gap: it manages multiple Hermes/Claude/Codex PTY instances under one coordinator.

---

## 3. Paperclip — Agent Management Primitives

**Repo:** github.com/paperclipai/paperclip · TypeScript monolith · MIT · 57.3K stars
**Local sources:** `projects/paperclip-eval.md` (Obsidian, with Tim video transcript, 2026-05-04 correction)
**Canonical internal decision:** `docs/archive/research/DECISION-paperclip.md` (2026-04-01) — DEFER until 3+ triggers fire

### Agent Spawn Mechanism

BYO-agent architecture. Paperclip does not spawn agents — it sends heartbeat signals to agents that are already running and can receive them. Supported runtimes: Claude Code (interactive login inside Docker), Codex (headless `codex login --device-auth`), OpenClaw, Cursor, Python scripts, bash scripts, HTTP webhooks. Each runtime has an adapter in `/packages`. The agent itself runs wherever it runs (Docker container on VPS, local machine, cloud VM); Paperclip just schedules the wakeup.

Actual spawn from the Tim demo: `docker exec -it <container_id> /bin/bash` → `claude login` inside container. Container hosts both the Paperclip server and the agent workspace. All agents share one VPS filesystem (`~/paperclip-work`) with git worktrees per ticket for isolation.

### Budget Enforcement

Per-agent monthly budgets with hard stops. Token/cost tracking is scoped per: company, agent, project, goal, issue, provider, model — full ancestry. Warning threshold at 80%; hard pause at 100%. Budget checks happen **before workspace resolution** during heartbeat invocation — the agent never wakes up if over budget. Board (human) can override. Source: Paperclip GitHub README (fetched 2026-05-13); Tim video transcript in `projects/paperclip-eval.md`.

At 3-person-team scale with a single client: **budget enforcement is moderate value**. It prevents runaway Codex API spend on multi-day autonomous runs. At the current iaGO scale (Santiago + Sebas + occasional Claude Max flat-rate), it is not critical — but becomes critical the moment you bill API costs to a client.

### Multi-Tenant Isolation

Every entity carries a company ID. Audit trails, agent state, and issue boards are scoped per company. One Paperclip deployment manages unlimited companies with isolated access controls and agent API keys. Short-lived run JWTs provide authentication boundaries per heartbeat invocation. Source: GitHub README.

At 3-person-team scale: **multi-tenancy is over-engineering for internal use**. It becomes the primary value proposition the moment you sell "AI Company in a Box" deployments to clients (each client = one company). The canonical DECISION-paperclip.md correctly defers internal adoption; the external service-line angle remains open.

### Coordination Primitives

Atomic task checkout prevents double-work via execution locks (mechanism not fully documented in public sources; implied DB-backed given Postgres dependency). Coalescing queue at the DB layer prevents duplicate heartbeats from firing for the same agent. Blocker relationships between tickets (`blocked_by[]`, `blocks[]`) are first-class. Session persistence: agents resume task context across reboots (DB-backed, not file-backed like cortextOS).

### Communication Between Agents

Org chart hierarchy: agents communicate via ticket comments and task delegation up/down reporting lines. Goal ancestry carries the "why" into every agent prompt. No direct agent-to-agent IPC — everything routes through the ticket system and the Paperclip server. This is a deliberate design choice: the ticket IS the shared state; agents coordinate by reading and writing ticket comments, not by talking to each other directly.

### Phone/Remote Control

Mobile-ready React dashboard. Approval workflows with execution policies. Agent pause/resume/terminate at any time. Real-time cost monitoring. No native Telegram integration — control is web-dashboard-first. The heartbeat cron fires on schedule; human intervention happens via the dashboard UI, not a chat interface.

### Primitives that matter at 3-person scale

| Primitive | Value at 3-person scale | Skip? |
|---|---|---|
| Budget enforcement | Moderate (API billing protection) | No — keep, activate when API billing |
| Multi-tenant isolation | Low (internal), High (client deliverable) | Skip for internal; keep for client service line |
| Atomic task checkout | High (prevents duplicate work in parallel agent runs) | Keep |
| Heartbeat scheduler | High (replaces manual invocation) | Keep |
| DB-backed session persistence | High (agents resume, not restart) | Keep |
| Org chart / reporting lines | Low (3 people don't need an HR model) | Skip |
| Board approval gates | Moderate (useful for client-facing sign-offs) | Adapt (repurpose for client approvals, not internal) |
| Mobile dashboard | High (Santiago is mobile) | Keep |

---

## 4. Comparison Table

| Axis | cortextOS | Hermes v0.11.0 | Paperclip |
|---|---|---|---|
| **Agent spawn** | PTY subprocess per runtime (Claude Code, Codex, Hermes adapters) | Python subprocess per delegation call; orchestrator role can spawn workers | Heartbeat signal to pre-existing agent process; BYO runtime |
| **State sharing** | Shared filesystem (JSONL + JSON files); no DB | SQLite per instance; no cross-instance sharing | Postgres (DB-backed); full session state persisted |
| **Coordination primitives** | O_EXCL file locks on task claims; file-bus inbox per agent | File-coordination layer (v0.11.0, mechanism internal); `max_concurrent_children` config | Atomic checkout (execution lock); coalescing heartbeat queue; blocker relationships |
| **Agent-to-agent communication** | Filesystem inbox writes; PTY injection | Subagent result returns to parent orchestrator; no peer-to-peer | Ticket comments + task delegation via org chart; no direct IPC |
| **Phone/remote control** | Telegram (per-agent bot token) + iOS messaging | 17 platforms (Telegram, Discord, Slack, Signal, WhatsApp, iMessage, WeChat + 10 more) | Web dashboard (mobile-ready); no native chat integration |
| **Persistence across restart** | PM2 process management; `.daemon-stop` markers; JSONL history | SQLite session state; compression history survives | Full DB-backed state; agents resume mid-task |
| **Multi-model support** | Native: Claude Code PTY + Codex App Server PTY + Hermes PTY adapters in same daemon | Single-model assumption per instance; `delegation.model` override for subagents | Model-agnostic adapter pattern; Claude Code + Codex confirmed in demo |
| **Dashboard** | Next.js, same-host IPC, 30s cache | React/Ink TUI (local); web dashboard (v0.9.0+) | React UI, mobile-ready, real-time cost monitoring |
| **Budget enforcement** | None | None (MCP `max_tokens_cap` is a per-server cap, not a per-agent budget) | Per-agent monthly budget with hard pause; ancestry-scoped cost tracking |
| **Heartbeat/scheduling** | `crons.json` per agent; `cron-scheduler.ts` daemon-managed | `cron/jobs.py` with `wakeAgent` pre-LLM gate and per-job `enabled_toolsets` | DB-backed heartbeat cron + event triggers (task assign, @-mention) |
| **Lock/lease mechanism** | O_EXCL file write (`'wx'` flag); EEXIST on collision | Undisclosed internal; config surface confirms it exists | Execution lock (DB-backed, implied); coalescing queue prevents duplicate heartbeats |

---

## 5. Recommendation for iaGO v2

### What to adopt verbatim

**From cortextOS:**

1. **PTY adapter pattern per runtime** (`agent-pty.ts` / `codex-app-server-pty.ts`). This is the concrete mechanism for running Claude Code and Codex as cohabiting peers on the same VPS. Two adapters, one daemon, both alive simultaneously. Adopt this architecture directly — it solves the "Codex + Claude side-by-side" requirement without introducing a message broker or container orchestrator.

2. **O_EXCL file-lock task claiming** (`src/bus/task.ts`). The `'wx'` flag trick is 10 lines of TypeScript that prevents any double-work race condition in parallel agent execution. Zero infra dependency — works on Hostinger VPS with a plain filesystem. Adopt verbatim as the coordination primitive for iaGO's parallel plan execution (currently unprotected in `execute-pipeline.sh` wave runs).

3. **File-based approval handshake** (`src/daemon/fast-checker.ts` `appr_` callbacks). For Telegram-primary control: agent posts approval request to Telegram, human taps button, callback writes file from `pending/` to `resolved/`, agent's polling loop resumes. This is simpler than a webhook round-trip and survives network hiccups. Adopt for the Wedge F Telegram gateway — it's the reference implementation the adoption spec already cites.

4. **`.daemon-stop` crash marker** (`agent-manager.ts`). Write a marker on graceful shutdown; absence of marker on next boot = crash. Used to decide whether to restore context or cold-start. Cheap, effective, no DB needed. Add to iaGO's pipeline self-freeze + recovery logic.

**From Hermes v0.11.0:**

5. **Pre-LLM cron wake gate** (`cron/jobs.py` `wakeAgent`). Script returns a no-wake signal → LLM is never invoked. Strictly cheaper than iaGO's current post-LLM `[SILENT]` token (Wedge C). Adopt as a Wedge C addendum: `--wake-check <script>` flag in `scripts/scheduled-runner.sh`.

6. **Shell-hook matchers with regex + timeout** (`cli-config.yaml` hooks). Extend iaGO's existing Claude Code hooks with `matcher` (tool-name regex) and per-hook `timeout_seconds`. Enables scoped pre/post-edit hooks (e.g., "before any Edit to `amplify/data/resource.ts`, run schema-validation"). Zero new runtime. Adopt as Wedge J (already in the team-2 research recommendation).

7. **MCP sampling caps** (`cli-config.yaml.example` MCP section). Document `max_tokens_cap` and `max_rpm` for each of iaGO's 5 MCP servers. Enforcement pending Claude Code native support; adopt as documented ops constraint now, enforce when API is available.

**From Paperclip:**

8. **Heartbeat-driven agent wakeup** (not the full Paperclip stack — just the pattern). Replace manual `claude -p` invocations with a daemon that wakes agents on schedule + event triggers. cortextOS already implements this with `cron-scheduler.ts`. Use cortextOS's implementation, not Paperclip's, to avoid the Postgres dependency.

9. **DB-backed session state** (adapt, not adopt verbatim). SQLite (not Postgres) is sufficient at 3-person scale. Agents should store last-task context in SQLite so they resume mid-task after restart, not cold-start. Adopt the pattern from Paperclip; implement with SQLite like Hermes does.

### What to adapt

**Paperclip's budget enforcement — adapt for API billing, skip for flat-rate.** The pattern is correct (per-agent monthly budget, hard pause at 100%). The implementation (Postgres + full ancestry tracking) is over-engineering for internal iaGO use. Adapt: add a simple per-agent cost ledger in SQLite. Activate when any client project moves from Claude Max flat-rate to API billing. Do not build it now.

**Paperclip's atomic checkout — adapt using cortextOS's O_EXCL approach.** Paperclip's DB-backed execution lock is equivalent to cortextOS's file-lock. Since iaGO runs on VPS without Postgres in the near term, use the file-lock approach (simpler, same guarantee on a single-host filesystem).

**Hermes's `max_concurrent_children` → iaGO wave grouping.** The `3` default in Hermes maps directly to iaGO's existing wave-grouping logic in `/iago-execute`. Already conceptually adopted — document the explicit parallel limit in the pipeline config rather than leaving it implicit.

### What to skip

**Paperclip's org chart / reporting lines.** Three people do not need agent CEO/CTO/Engineer titles with formal reporting lines. Adds naming confusion for clients (Munet's CEO is a real person). The heartbeat scheduler and budget enforcement are the load-bearing primitives — extract those, leave the HR metaphor behind.

**Paperclip's multi-tenant isolation (for internal use).** Company-scoped schemas and cross-client audit trails are the product when selling "AI Company in a Box." For internal iaGO use, `clients/*/` directory separation is sufficient. Canonical DECISION-paperclip.md already deferred this correctly.

**Hermes's 17-platform gateway.** Telegram is the correct scope for a 3-person mobile-first control surface. Each additional platform adds adapter maintenance with zero client delivery value. Wedge F explicitly scopes Telegram first, Discord/Slack as future. cortextOS's Telegram adapter is the reference — same single-platform discipline.

**Paperclip's full Docker deployment model.** The `docker exec -it <container> claude login` dance is an operational fragility. Every container restart requires SSH re-authentication. On a Tailscale mesh with a Hostinger VPS, run the daemon as a systemd service directly on the host (not in Docker) to avoid this. PM2 (cortextOS's approach) or systemd are both acceptable — prefer systemd on a Linux VPS for reliability.

**cortextOS's Next.js dashboard at the runtime layer.** For a 3-person agency, the agentic-os-dashboard Streamlit pattern (reading `~/.claude/` state) is faster to ship and cheaper to maintain. The cortextOS dashboard couples tightly to its IPC server — portable only if you adopt the full cortextOS daemon. If adopting the cortextOS daemon architecture, the dashboard comes for free. If building iaGO's own daemon, use a lighter UI.

---

## Executive Summary

The correct iaGO v2 multi-agent architecture borrows the **process model from cortextOS** (PTY adapter per runtime, O_EXCL file-lock claiming, file-based approval handshake, crash markers), the **scheduling and hook primitives from Hermes** (pre-LLM wake gate, shell-hook matchers, MCP sampling caps), and the **budget pattern from Paperclip** (per-agent cost ledger, hard pause) stripped of its Postgres dependency. cortextOS is the structural reference for how Claude Code and Codex cohabit on one VPS host under one daemon — its daemon architecture and PTY adapters are the only implementation that explicitly solves the multi-runtime cohabitation problem at zero infra overhead. Hermes contributes runtime safety valves (compression thresholds, wake gates) that reduce cost on idle agents. Paperclip contributes the budget enforcement pattern worth adopting when API billing enters the picture, and nothing else at 3-person scale. The Telegram approval handshake (cortextOS's file-based `pending/` → `resolved/` pattern) is the concrete primitive for phone-driven human-in-the-loop, and should be the foundation for Wedge F. Skip Paperclip's org chart, multi-tenancy, and Docker auth model; skip Hermes's 17-platform gateway; adopt cortextOS's daemon architecture as the v2 runtime spine.
