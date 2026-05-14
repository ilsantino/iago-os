# Spec: iago-os v2 Vision — Agent OS

_Date: 2026-05-13 | Status: **CANONICAL** | Supersedes: `docs/specs/iago-os-vision.md` (2026-04-28, downgraded to research artifact) | Locked by: Santiago, 2026-05-13_

---

## Vision Statement

**iago-os v2 is a multi-agent operating system.** Agents (Codex + Claude, side by side) cohabit on a Hostinger VPS reached over a Tailscale mesh, are controlled from a phone via Telegram, and are observed through a web dashboard. The existing iago-os review pipeline (cross-model Codex, severity floors, secret-exclusion, skill routing) stays — it is the moat.

This **replaces OpenClaw** as the production agent runtime. Same VPS, same Tailscale mesh, new software.

This **overrides** the 2026-04-21 council "defer" verdict on iago-os-v2, the prior "Paperclip = DEFER" verdict, the prior "cortextOS = cherry-pick only" verdict, the prior "agentic-os-dashboard = patterns only" verdict, and the 2026-04-28 "not a Hermes clone, not a Devin replacement" framing. Closer-to-Hermes is now the target.

---

## The 5 Layers

| # | Layer | What it is | Primary source pattern |
|---|---|---|---|
| 1 | **Runtime substrate** | Hostinger VPS + Tailscale mesh; systemd service host | OS-native (no Docker auth dance) |
| 2 | **Agent execution** | Daemon spawning per-runtime PTY adapters (Claude Code + Codex side by side); file-bus coordination; crash markers + auto-restart | **cortextOS** `agent-pty.ts` + `codex-app-server-pty.ts` + `agent-manager.ts` |
| 3 | **Control plane** | Telegram-primary phone control: start/stop/inject/approve/abort agents; file-based approval handshake (`pending/` → `resolved/`) | **cortextOS** `fast-checker.ts` `appr_*` callbacks |
| 4 | **Dashboard** | Web UI for live agent state, token spend, intervention; same-host IPC, not REST | **cortextOS** Next.js + `ipc-server.ts` (free if daemon adopted); fallback Streamlit pattern from agentic-os-dashboard |
| 5 | **Pipeline (preserved)** | Cross-model Codex review, severity floors, secret-exclusion staging, skill routing, stress test | **iago-os existing** — do not rewrite |

---

## Adopted Primitives (concrete, verbatim where possible)

Cited file paths are in the upstream repos; iaGO ports land under `runtime/` (new directory in this repo, to be created in Phase 1).

### From cortextOS — adopt verbatim

| Primitive | Upstream | Why we want it |
|---|---|---|
| **PTY adapter per runtime** | `src/pty/agent-pty.ts` (Claude Code), `src/pty/codex-app-server-pty.ts` (Codex) | Solves Codex + Claude cohabitation with zero broker / zero container orchestration. Two adapters, one daemon, both alive simultaneously. |
| **O_EXCL file-lock task claiming** | `src/bus/task.ts` `claimTask()` (`wx` flag → `EEXIST` on collision) | ~10 lines of TS that prevent any double-work race in parallel agent runs. No DB. Replaces our currently-unprotected wave dispatch in `execute-pipeline.sh`. |
| **File-based approval handshake** | `src/daemon/fast-checker.ts` (`appr_(allow\|deny)_<id>` callbacks → file moves `pending/` → `resolved/`) | The right HITL primitive for Telegram. Simpler than webhook round-trip; survives network hiccups. |
| **`.daemon-stop` crash markers** | `src/daemon/agent-manager.ts` | Distinguishes graceful shutdown from crash on next boot. Decides restore-vs-cold-start. No DB. |
| **Multi-org agent resolution cascade** | `agent-manager.ts` `resolveAgentOrg()` (BUG-043 fix) | Lets one daemon host agents from multiple client orgs without collision. Maps to iaGO's `clients/*/` separation. |
| **`crons.json` per-agent schedule + `cron-scheduler.ts` daemon-managed wakeups** | `src/daemon/cron-scheduler.ts` | Replaces manual `claude -p` invocations. Hermes also has this; cortextOS's is the cleaner reference. |
| **Same-host IPC server (Unix socket / named pipe)** | `src/daemon/ipc-server.ts` (`fleet-health`, 30s cache) | Dashboard and CLI both talk to the daemon over this. No REST API surface to secure. |

### From Hermes v0.11.0 — adopt selectively

| Primitive | Upstream | Why |
|---|---|---|
| **Pre-LLM cron wake gate** | `cron/jobs.py` `wakeAgent` | Strictly cheaper than our current post-LLM `[SILENT]` token. Adopt as Wedge C addendum: `--wake-check <script>` flag. |
| **Shell-hook matchers + regex + timeout** | `cli-config.yaml` `hooks.<event>[].matcher` | Wedge J. Scoped pre/post-edit hooks ("before any Edit to `amplify/data/`, run schema-validate"). |
| **MCP sampling caps** | `cli-config.yaml.example` `mcp_servers.<n>.sampling.*` | Documented ops constraint on our 5 MCP servers. Native enforcement pending Anthropic. |
| **Compression-threshold safety valve** | `compression.{enabled,threshold:0.50,target_ratio:0.20,protect_last_n:20}` | Fold into Wedge B distiller. |
| **`max_concurrent_children` parallel limit** | `delegation.max_concurrent_children` (default 3) | Document our existing wave-grouping explicitly in pipeline config. |

### From Paperclip — adopt the pattern, not the stack

| Primitive | Upstream | Why |
|---|---|---|
| **Per-agent cost ledger + hard pause at budget** | Paperclip server, Postgres-backed | Activate when ANY client moves Claude Max flat-rate → API billing. Implement with SQLite, not Postgres. Skip ancestry tracking (over-engineered at our scale). |
| **DB-backed session state (resume mid-task)** | Paperclip Postgres | Adopt the pattern, implement with SQLite per cortextOS/Hermes precedent. |
| **Heartbeat-driven agent wakeup** | Paperclip heartbeat scheduler | Already covered by cortextOS `cron-scheduler.ts` — use cortextOS's impl, not Paperclip's. |

### Explicitly NOT adopted

- **Paperclip org chart / reporting lines** — three people don't need agent CEO/CTO titles. Adds confusion for clients.
- **Paperclip multi-tenant isolation (for internal use)** — `clients/*/` directory separation already does this. Multi-tenancy stays available as a client-deliverable product angle, not internal infra.
- **Paperclip Docker exec auth dance** — every container restart re-auths. systemd on the VPS directly.
- **Hermes 17-platform gateway** — Telegram only; Discord/Slack only on real demand.
- **Hermes single-agent assumption** — Hermes itself is one agent with delegation. We need cortextOS's multi-agent daemon over Hermes-style instances, not Hermes alone.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Santiago's phone                                                │
│  └─ Telegram app                                                 │
└────────────────┬────────────────────────────────────────────────┘
                 │  (over public internet → Tailscale entry)
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Hostinger VPS (Tailscale node)                                  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  iago-os v2 daemon  (systemd service, Node.js 20)         │   │
│  │                                                            │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │   │
│  │  │ Claude Code │  │   Codex     │  │  Hermes (?)  │      │   │
│  │  │  PTY adapter│  │  PTY adapter│  │  PTY adapter │      │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘      │   │
│  │         │                │                 │              │   │
│  │  ┌──────▼────────────────▼─────────────────▼──────┐      │   │
│  │  │  Agent manager (registration, crash/restart,    │      │   │
│  │  │  multi-org cascade, .daemon-stop markers)       │      │   │
│  │  └──────┬──────────────────────────────────────────┘      │   │
│  │         │                                                  │   │
│  │  ┌──────▼─────┐  ┌──────────┐  ┌───────────┐  ┌────────┐│   │
│  │  │  File bus  │  │ Telegram │  │   Cron    │  │  IPC   ││   │
│  │  │ (O_EXCL    │  │  router  │  │ scheduler │  │ server ││   │
│  │  │  claims)   │  │ (per-bot │  │ (wake     │  │(Unix   ││   │
│  │  │            │  │  token)  │  │  gates)   │  │ socket)││   │
│  │  └──────┬─────┘  └────┬─────┘  └─────┬─────┘  └────┬───┘│   │
│  │         │             │              │              │     │   │
│  └─────────┼─────────────┼──────────────┼──────────────┼────┘   │
│            │             │              │              │         │
│  ┌─────────▼─────────────▼──────────────▼──────────────▼────┐   │
│  │  Filesystem state: tasks/, pending/, resolved/,           │   │
│  │  orgs/<client>/agents/<agent>/, crons.json, SQLite (cost) │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Dashboard (Next.js, same-host, IPC to daemon)            │   │
│  │  - Live agent state                                       │   │
│  │  - Token spend per agent / project / model                │   │
│  │  - Session threads + intervention controls                │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Wedge Reinterpretation (existing roadmap under new frame)

| Wedge | Original purpose | New purpose | Status change |
|---|---|---|---|
| **A** Frozen-snapshot MEMORY | Pipeline context discipline | Same — kept | ✅ shipped, no change |
| **B** Distiller (+ compression safety valve) | Pipeline context compression between stages | Same + becomes load-bearing for long-running daemon sessions | Wave 1, kept |
| **C** `/routines` bind audit | Cron + `[SILENT]` token | **CLOSED** — `/routines` BIND-NOT-VIABLE (PR #37). Replaced by **cortextOS `cron-scheduler.ts` + Hermes pre-LLM wake gate** as v2 cron substrate | Adopted via cortextOS daemon, not via `/routines` |
| **D** Memory provider doc | MCP sampling caps doc | Same — kept as doc-only | ✅ ship doc, no daemon change |
| **F** Telegram gateway | Week-6 stretch, "Telegram only" scoped narrow | **PROMOTED to load-bearing control plane.** First v2 deliverable after daemon foundation. cortextOS `fast-checker.ts` approval handshake is the reference impl | Wave 1, top priority |
| **G** Skill body progressive disclosure | Deferred (yellow feasibility) | Same — defer | No change |
| **H** Webhook + HMAC | Stripe-events for installflow | **PROMOTED to load-bearing VPS event trigger surface.** GitHub events + Stripe events + arbitrary HMAC webhooks → daemon → agent wakeup | Wave 2, ahead of original schedule |
| **J** Shell-hook matchers | Regex-scoped lifecycle hooks | Same — Wave 1 next move | 🟢 NEXT |
| **K** Pre-stage pipeline checkpoints | Rollback safety in pipeline | Same — kept (still load-bearing for daemon crash recovery) | Wave 2 |
| **L** Externalize review-checks | Per-client review-rule overrides | Same — kept | Wave 2 |
| **M, N** Plan dashboard / trajectory ingestion | Deferred | **Folded into Dashboard layer (#4)** — no separate wedges needed. Dashboard ships agent state + cost; trajectory ingestion lands as a dashboard query | Promoted into Layer 4 |
| **E, I** | Dropped (vision-confirmed) | Still dropped | No change |

**Removed from scope:** `--n8n` dispatch flag (was already dead per May-12 review). However, n8n may return as a VPS automation primitive — leave that question to Phase 3.

---

## OpenClaw → VPS Migration Sequence

**Phase 0 — VPS audit (read-only, no destructive ops).**

1. SSH into Hostinger VPS via Tailscale.
2. Inventory: what is OpenClaw running right now? What workflows touch it? What state lives in `~/openclaw/` or equivalent?
3. Confirm Tailscale mesh health, Node.js version, systemd availability.
4. Write `runtime/migration/00-vps-audit.md` with the inventory.

**Phase 1 — Daemon skeleton land (local first).**

1. Create `runtime/` directory in iago-os.
2. Port cortextOS minimal daemon: agent-manager + file-bus + one PTY adapter (Claude Code first).
3. Local-only — runs on Santiago's Windows box for development, not on VPS yet.
4. systemd unit file authored but not deployed.
5. Hello-world: register one Claude Code agent, claim a task, send Telegram message via test bot, receive `appr_allow` callback, agent proceeds. End-to-end on localhost.

**Phase 2 — VPS install alongside OpenClaw.**

1. Deploy daemon to VPS as `iago-os-v2-daemon.service`. Run in parallel with OpenClaw, different ports / state dirs.
2. Validate on one non-critical workflow.
3. Migrate Telegram bot token from OpenClaw to v2 daemon (or use a separate bot during cutover).

**Phase 3 — Cutover.**

1. Migrate remaining workflows from OpenClaw to v2 daemon.
2. Stop OpenClaw systemd unit.
3. Archive OpenClaw state (do not delete yet — keep 30 days).
4. Update DNS / Telegram bot bindings.

**Phase 4 — Cleanup.**

1. Uninstall OpenClaw from VPS.
2. Delete archived state.
3. Document removal in `runtime/migration/04-openclaw-removed.md`.

**Open question (need Santiago input):** does OpenClaw run anything you actively depend on right now that would break if it stops? If yes, list it before Phase 2 cutover. If no, Phase 2 + 3 can collapse into one.

---

## Pipeline Preservation (do not touch)

The existing iaGO pipeline is the moat. Per the 2026-05-12 adversarial review's evidence, it works end-to-end (6 telemetry-recorded runs, 39.5 min wall-clock on the latest). The v2 daemon **invokes** the pipeline as a stage type, it does not replace the pipeline.

What stays unchanged:

- `scripts/execute-pipeline.sh` (self-freeze, byte-offset hack, telemetry)
- Codex cross-model adversarial review (`codex-companion.mjs`)
- Review check modules (`scripts/review-checks/*.md`)
- Skill routing (`/iago-fast`, `/iago-quick`, `/iago-execute`)
- Severity floors, secret-exclusion staging patterns
- 5-layer memory architecture (MEMORY.md, Obsidian, Graphify, MemPalace, MarkItDown)

What changes:

- Pipeline is dispatched **by** the daemon (cron / Telegram / webhook trigger), not manually invoked from Santiago's terminal.
- Pipeline telemetry NDJSON gets streamed to the dashboard via the IPC server.
- `CLAUDE_CODE_SESSION_ID` injection (May-12 punch list) becomes the join key between Agent View and the dashboard.

---

## Reopened Decisions (formerly closed, now active)

| Decision | Old verdict | New status |
|---|---|---|
| Paperclip adoption | DEFER ("iaGO = build env, not runtime") | **REOPENED** — adopt cost-ledger pattern + heartbeat pattern; skip stack/Docker/Postgres |
| cortextOS adoption | Cherry-pick patterns only | **REOPENED** — adopt daemon architecture as v2 runtime spine |
| agentic-os-dashboard | Cherry-pick MCP health check only | **REOPENED** — fallback dashboard pattern if cortextOS dashboard not adopted |
| iago-os-v2 (MWP parallel project) | PAUSED pending Sebas + MUNET | **ACTIVE** — this doc is the v2 spec; MWP-native framing is not the architecture (filesystem-as-orchestration was wrong fit; cortextOS daemon is the right fit) |
| Wedge F Telegram | Stretch goal, scoped narrow | **PROMOTED** to first v2 deliverable after daemon foundation |
| Wedge H webhooks | Stripe-events for installflow | **PROMOTED** to general VPS event trigger surface |

---

## May-12 Punch List (reinterpreted)

The 4.5-day punch list from `.iago/research/iago-os-adversarial-review-2026-05.md` is still valid but reinterpreted under v2 frame:

| Item | Original purpose | v2 interpretation | Keep? |
|---|---|---|---|
| Instrument pipeline with `CLAUDE_CODE_SESSION_ID` → Agent View | Free monitoring win | **Becomes dashboard join key** (Layer 4) | ✅ Keep |
| Fix learnings system write path | Dead infrastructure → actually accumulate | Daemon writes pattern-extraction back to `.iago/learnings/` | ✅ Keep |
| Fix `/iago-execute` Step 3 dirty-branch guard | Silent work loss prevention | Same — correctness fix | ✅ Keep |
| Fix Claude adversarial fallback false-clean parser | Latent correctness bug | Same — correctness fix | ✅ Keep |
| Migrate one Routine (nightly PR triage) | Validate Routines for iago-os | **Replaced**: validate cortextOS `cron-scheduler.ts` pattern instead. `/routines` is BIND-NOT-VIABLE per PR #37; cortextOS cron is the v2 substrate | ❌ Drop — use cortextOS cron |
| Delete dead `--n8n` flag + `.iago/config.json` ref | Remove false documentation | **HOLD** — n8n may return as VPS automation primitive in Phase 3 | 🟡 Defer decision |

**Net: 4 of 6 punch-list items still apply (~3 days work). Drop the Routines migration; hold the n8n deletion.**

---

## Phase Sequencing (v2, supersedes old roadmap waves)

| Phase | Duration | Deliverable | Gate |
|---|---|---|---|
| **0 — VPS audit** | 0.5d | `runtime/migration/00-vps-audit.md` with OpenClaw inventory + Tailscale/systemd health | Before any daemon code |
| **1 — Daemon skeleton (local)** | 5-7d | `runtime/` directory with agent-manager + file-bus + Claude Code PTY adapter + Telegram approval handshake; hello-world end-to-end on Santiago's Windows | Local validation |
| **1b — May-12 punch list (4 of 6 items)** | 3d | `CLAUDE_CODE_SESSION_ID` instrumentation, learnings write path, dirty-branch guard, fallback parser fix | Parallel to Phase 1 — independent |
| **2 — VPS install alongside OpenClaw** | 2-3d | `iago-os-v2-daemon.service` running on VPS, one workflow migrated, no OpenClaw impact | Phase 1 + 1b complete |
| **3 — Codex PTY adapter** | 3-4d | `runtime/pty/codex-app-server-pty.ts` — Codex agents cohabit with Claude in daemon | Phase 2 stable |
| **4 — Wedge J shell-hook matchers** | 1d | regex + timeout on hooks; lands in daemon hook config | Phase 2 stable |
| **5 — Wedge B distiller + compression** | 2d | Stage compression for long-running daemon sessions | Phase 3 + 4 |
| **6 — Dashboard skeleton** | 5-7d | Next.js dashboard via IPC server: agent list, current state, recent activity | Phase 3 stable |
| **7 — OpenClaw cutover + cleanup** | 1d | All workflows on v2 daemon, OpenClaw stopped, state archived | Phase 6 stable + Santiago green-light |
| **8 — Cost ledger (SQLite)** | 2d | Per-agent cost tracking + hard pause when budget breached | Triggered when first API-billing client lands |
| **9 — Wedge H webhook surface** | 2-3d | HMAC webhook receiver → daemon trigger → agent wakeup | Triggered when first webhook integration demand |

**Total Phase 0-7 effort:** ~22-28 dev-days (4-6 weeks at sustainable pace).
**Phase 8 + 9 are demand-triggered**, not scheduled.

---

## What v2 is NOT

Stay scoped:

- **Not a Cursor/Aider/Continue replacement.** Those are IDEs. iaGO v2 is a delivery runtime.
- **Not a Devin clone.** Devin replaces developers. iaGO v2 augments a 3-person consultancy by giving Santiago + Sebas remote control over the agents that do the work.
- **Not 17-platform messaging.** Telegram only. Slack/Discord only on real demand from a paying client.
- **Not multi-tenant SaaS (internal use).** Per-client directory separation is sufficient. Multi-tenancy stays a possible product angle, not internal infra.
- **Not Postgres.** SQLite for cost ledger + session state. JSON/JSONL for everything else (cortextOS pattern).
- **Not Docker for agent runtime.** systemd on VPS. Docker auth dance is operational fragility.

---

## Open Questions (need Santiago verdict before Phase 1)

1. **OpenClaw active dependencies.** What is OpenClaw doing on the VPS right now? Anything we can't lose during cutover?
2. **Telegram bot strategy.** One bot per agent (cortextOS pattern) or one bot routing to many agents (Hermes pattern)? cortextOS's per-bot approach is simpler to start; one-router scales better long-term. Default recommendation: **one bot for v2 with per-agent message tagging in the file bus**.
3. **Sebas integration.** Does Sebas get his own Tailscale node + Telegram bot binding from day 1, or after v2 stabilizes? Default recommendation: **single user (Santiago) for Phases 1-3**; add Sebas in Phase 6 when dashboard is up.
4. **Dashboard scope (v1).** Full cortextOS Next.js port, or Streamlit minimal cockpit while daemon stabilizes? Default recommendation: **Streamlit minimal in Phase 6; promote to Next.js when daemon is stable and dashboard usage justifies the rewrite**.
5. **MUNET handling during v2 build.** MUNET is currently stalled. Does v2 work proceed in parallel, or does MUNET MVP need to ship first? Per memory `project_munet_mvp_scope`, M2 03-06 + ticket-email-fix wave 2 are deferred post-MVP. Default: **v2 build proceeds in parallel; MUNET remains highest-revenue priority when it unblocks**.

---

## Sources

- **Research artifact (2026-05-13):** `.iago/research/2026-05-13-multi-agent-cohabitation.md` — comparison + adoption verdicts
- **Hermes details:** `.iago/research/team-2-hermes-state.md`
- **cortextOS eval (verdict now overridden):** `~/dev/obsidian-brain/projects/cortextos-eval.md`
- **Paperclip eval (verdict now overridden):** `~/dev/obsidian-brain/projects/paperclip-eval.md`
- **agentic-os-dashboard eval (verdict now overridden):** `~/dev/obsidian-brain/projects/agentic-os-dashboard-eval.md`
- **May-12 adversarial review:** `.iago/research/iago-os-adversarial-review-2026-05.md`
- **Old vision (superseded):** `docs/specs/iago-os-vision.md` — keep for historical reasoning trail; do not execute against
- **Old wedge roadmap (partially superseded):** `docs/specs/iago-os-roadmap.md` — wedge primitives still valid; framing reinterpreted per this doc
- **Council decision (now overridden):** `~/dev/obsidian-brain/decisions/2026-04-21-iago-os-v2-council.md` — keep for historical reasoning; verdict reversed by Santiago 2026-05-13

---

## What Reads This Doc

Every iago-os work session anchors here first. Specifically:

- `/iago-plan` for any wedge work → read this doc, interpret wedge under v2 frame
- `/iago-execute` → pipeline still applies, daemon dispatch waits on Phase 2
- Future research subagents → this doc is canonical, not the 2026-04-28 vision spec
- Session digests written to Obsidian → reference this doc by name
