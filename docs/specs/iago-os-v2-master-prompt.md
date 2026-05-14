# iago-os v2 — Master Prompt

_Date: 2026-05-13 | Status: **CANONICAL PROMPT** — executable as the master brief to any builder agent (Codex, Claude, or human contributor) | Author: Santiago + Claude orchestration_

---

## Use this prompt by

Loading the following artifacts as input before executing any task:

1. `docs/specs/iago-os-v2-vision.md` — 5-layer agent OS architecture
2. `.iago/research/2026-05-13-multi-agent-cohabitation.md` — concrete primitives to steal from cortextOS / Hermes / Paperclip
3. `.iago/research/2026-05-13-mwp-source-synthesis.md` — canonical MWP ground truth (supersedes the 2026-04-28 audit, which was secondhand and ~30% materially wrong)
4. `docs/specs/iago-os-mwp-routing-rule.md` — doc-routing decision tree
5. `CLAUDE.md` (root) — execution discipline, pipeline rules, memory architecture
6. Memory: `feedback_garry_impressed_standard.md`, `project_iago_v2_vision.md`, `feedback_iago_v2_overrides_council.md`

If any of these are missing or stale, stop and surface the gap before writing code.

---

## Standard (non-negotiable)

**The marginal cost of completeness is near zero with AI. Build the ocean.**

Every deliverable ships:
- Implementation (the thing that does the work)
- Tests (Vitest for TS, Pytest where Python is used)
- Documentation (inline + dedicated `.md` where ops matter)
- Telemetry (NDJSON stage events per the existing iaGO pipeline pattern)
- Migration path (how to deploy + how to roll back)

Never:
- Offer "let's table this for later" when the real fix is within reach
- Ship a workaround when the permanent solve is achievable in the same PR
- Leave a dangling thread when tying it off takes five more minutes
- Defer the documentation to a follow-up
- Present a plan when the answer is the finished product

**The bar is "holy shit, that's done."** Not "good enough." Not "MVP, iterate later."

---

## Mission

Build iago-os v2: a multi-agent operating system that runs Santiago's consultancy and his life.

It must:

1. **Cohabit Codex + Claude agents** on a single Hostinger VPS reached over Tailscale, with both runtimes alive simultaneously and coordinating via a shared file-bus (cortextOS pattern, not Hermes single-agent pattern).
2. **Run 24/7 as a systemd service** (no Docker auth dance, no daemon-restart auth dance). Survive reboots; resume in-flight work from crash markers.
3. **Be controlled from a phone via Telegram.** Start agents, inject prompts, approve/deny irreversible actions, abort, and observe state — all from the Telegram app. WhatsApp deferred to demand; Slack/Discord deferred entirely.
4. **Spawn its own terminal sessions** when work needs to happen. Each agent owns a PTY (Claude Code or Codex), claims tasks via O_EXCL file locks, and writes results back to the shared bus.
5. **Operate multiple agents simultaneously**, coordinating without colliding. The supervisor agent dispatches; specialists claim and execute; results merge through ticket-style coordination.
6. **Visualize agent state in a minimal web dashboard** running on the same VPS, accessible over Tailscale. Live agent list, current tasks, token spend, intervention controls. Same-host IPC, not REST.
7. **Self-learn.** Append patterns to `.iago/learnings/patterns.md`. Ingest session digests into MemPalace. Update Graphify nightly. After N occurrences, promote learnings into CLAUDE.md candidates automatically.
8. **Integrate with apps** through MCP servers and webhook endpoints. Email auto-provision via SES + IMAP polling; calendar via Google Workspace MCP; error capture via Sentry MCP; bug-fix dispatch via GitHub webhook.
9. **Replace OpenClaw** (currently running on the same VPS). Delete the OpenClaw installation as part of cutover.
10. **Ask Santiago for help when it needs it** — and only then. Background work is silent. Decisions that change scope, spend money, or touch production trigger a Telegram approval handshake (cortextOS `pending/` → `resolved/` file pattern).

---

## Reference architecture (5 layers)

Already specified in `docs/specs/iago-os-v2-vision.md`. Summary for executors:

```
┌──────────────────────────────────────────────────┐
│  Phone (Telegram) — control plane                 │
└──────────────────┬───────────────────────────────┘
                   ▼ (Tailscale mesh)
┌──────────────────────────────────────────────────┐
│  Hostinger VPS — runtime substrate (systemd)      │
│                                                    │
│   iago-os-v2-daemon                                │
│    ├─ PTY adapters (Claude Code + Codex)          │
│    ├─ Agent manager (registration, crash, restart)│
│    ├─ File-bus (O_EXCL task claims)               │
│    ├─ Telegram router (one bot, per-agent tagging) │
│    ├─ Cron scheduler (pre-LLM wake gates)         │
│    ├─ IPC server (Unix socket → dashboard + CLI)  │
│    └─ Webhook receiver (Sentry, GitHub, Stripe)   │
│                                                    │
│   Filesystem state                                 │
│    ├─ orgs/<client>/agents/<agent>/config.json    │
│    ├─ tasks/{pending,claimed,resolved}/           │
│    ├─ approvals/{pending,resolved}/                │
│    ├─ crons.json per agent                        │
│    └─ ledger.sqlite (cost tracking when activated)│
│                                                    │
│   Dashboard (Next.js, same-host IPC)              │
└──────────────────────────────────────────────────┘
```

---

## Primitives to adopt (verbatim, with file references)

### From cortextOS (https://github.com/grandamenium/cortextos)

| Primitive | Upstream file | Reason |
|---|---|---|
| Per-runtime PTY adapter | `src/pty/agent-pty.ts`, `src/pty/codex-app-server-pty.ts` | Codex + Claude cohabitation, one daemon |
| Agent manager (register, crash, restart, multi-org cascade) | `src/daemon/agent-manager.ts` | Lifecycle without DB |
| O_EXCL file-lock task claiming | `src/bus/task.ts` `claimTask()` `wx` flag | Coordination without broker |
| Telegram approval handshake | `src/daemon/fast-checker.ts` `appr_*` callbacks + `pending/` → `resolved/` | HITL primitive |
| `.daemon-stop` crash marker | `agent-manager.ts` | Distinguish graceful vs crash on boot |
| IPC server (Unix socket / named pipe) | `src/daemon/ipc-server.ts` | Dashboard + CLI talk to daemon |
| Cron scheduler with `crons.json` per agent | `src/daemon/cron-scheduler.ts` | Scheduled wakeups |

### From Hermes v0.11.0 (https://github.com/NousResearch/hermes-agent)

| Primitive | Upstream config | Reason |
|---|---|---|
| Pre-LLM cron wake gate | `cron/jobs.py` `wakeAgent` | Don't burn tokens on no-op runs |
| Shell-hook matchers (regex + timeout) | `cli-config.yaml` `hooks.<event>[]` | Scoped lifecycle automation |
| Compression-threshold safety valve | `compression.{threshold:0.50,target_ratio:0.20,protect_last_n:20}` | Survive long sessions |
| MCP sampling caps | `mcp_servers.<n>.sampling.max_tokens_cap` | Bound MCP cost |

### From Paperclip (pattern only, not stack)

| Primitive | What | Reason |
|---|---|---|
| Per-agent cost ledger + hard pause at budget | SQLite, not Postgres | Activate when API billing lands |
| Heartbeat-driven wakeup pattern | Implemented via cortextOS cron-scheduler.ts, not Paperclip server | Same outcome, lighter stack |

### From iaGO existing pipeline (preserve, do not rewrite)

| Component | Why kept |
|---|---|
| `scripts/execute-pipeline.sh` | 6 telemetry-recorded successful runs; self-freeze hack works |
| `codex-companion.mjs` | Cross-model adversarial review is the moat |
| `scripts/review-checks/*.md` | Domain-routing review modules |
| Skill routing (`/iago-fast`, `/iago-quick`, `/iago-execute`) | Real workflow decisions |
| 5-layer memory (MEMORY.md + Obsidian + Graphify + MemPalace + MarkItDown) | Working, well-documented |

---

## What v2 is NOT (anti-scope)

- **NOT a Cursor/Aider/Continue replacement.** IDE workflow is out of scope. iaGO v2 runs on a server, not in an editor. **HOWEVER:** Santiago uses Cursor (or any editor with a terminal) as his daily IDE alongside v2 — he opens the iago-os repo in Cursor, sees files, and pulls up Claude or Codex inside Cursor's terminal. v2 daemon is the BACKEND that runs autonomously on the VPS; the IDE is Santiago's FRONTEND for direct hands-on work. These are complementary, not competitive.
- **NOT a Devin clone.** Augments Santiago + Sebas; does not replace developers.
- **NOT a 17-platform messaging gateway.** Telegram only for v1. Slack/Discord/WhatsApp deferred to demand from a paying client.
- **NOT multi-tenant SaaS internally.** `clients/{name}/` directory separation is sufficient. Multi-tenancy stays a possible product angle, not internal infra.
- **NOT Postgres.** SQLite + JSON/JSONL. cortextOS pattern.
- **NOT Docker-wrapped agents.** systemd on the VPS directly. Eliminates the "container restart → re-auth Claude" fragility.
- **NOT a Sentry replacement.** Sentry is a mature observability product (years of telemetry pipeline engineering). Integrate WITH Sentry via its MCP server; the AI autofix layer is where iaGO v2 plugs in.
- **NOT a Linear replacement.** File-bus tasks/ directory with O_EXCL claims IS the ticketing system. No external task tracker.

---

## MWP Method (context-structuring discipline — NOT multi-agent architecture)

MWP (Model Workspace Protocol, Van Clief & McDermott 2026 — ICM paper) structures **context delivery** for **sequential, reviewable, repeatable** workflows. It applies *inside each agent's workspace*. It does **NOT** address multi-agent coordination — the v2 daemon's agent manager handles that layer.

The ICM paper explicitly names multi-agent collaboration, high-concurrency systems, and mid-pipeline automated branching as **out of scope** for MWP (§5.2). Treating MWP as a v2 architecture choice is a category error. Treat it as a context-structuring discipline applied within whatever architecture you've chosen (in our case, the cortextOS-style daemon).

Source: canonical synthesis at `.iago/research/2026-05-13-mwp-source-synthesis.md`.

### Five-layer context hierarchy (L0–L4)

| Layer | What | Token budget | Location |
|---|---|---|---|
| L0 | CLAUDE.md — workspace identity, routing table | ~800 tok | Workspace root |
| L1 | CONTEXT.md — workspace entry routing | ~300 tok | Workspace-level |
| L2 | Stage contract — `Inputs / Process / Outputs` | 200–500 tok | Per-stage CONTEXT.md |
| L3 | Reference/factory — rules, voice, conventions, skills | 500–2k tok | `.claude/rules/`, `docs/specs/`, `docs/patterns/` (iaGO canon); `_config/`, `references/` (vault-toolkit naming, optional) |
| L4 | Working/product — per-run artifacts, source material | Varies | Stage `output/`, plan files |

### L3 vs L4 distinction (critical — was missing from prior docs)

- **L3 (factory)** — configured once at workspace setup, stable across runs. The model **internalizes** as constraints. Examples: voice.md, conventions.md, `.claude/rules/*.md`, skill files.
- **L4 (product)** — produced and consumed per-run, changes every time. The model **processes** as input to transform. Examples: plan files, research artifacts, draft outputs, source material being analyzed.

> "Mixing persistent rules with per-run artifacts in an undifferentiated context window forces the model to sort them on its own." — ICM paper §3.2

Never bundle L3 and L4 in one context block. The stage contract's Inputs table (see below) is what enforces this separation.

### Stage contracts (L2 CONTEXT.md required format)

Every workspace stage that an agent runs through MUST define a contract. The Inputs table is the control mechanism — it makes context selection explicit, editable, and auditable rather than relying on agent judgment.

```markdown
## Inputs
- Layer 4 (working): ../01_research/output/
- Layer 3 (reference): ../../_config/voice.md
- Layer 3 (reference): references/structure.md

## Process
[Stage instructions — what the agent does with the inputs]

## Outputs
- output-file.md -> output/
```

Per stage, total context delivered should be 2,000–8,000 tokens (ICM §3.2). A monolithic all-stages prompt reaches 30,000–50,000+ tokens and degrades per Liu et al. 2024 "lost in the middle."

### MWP vs MCP — complementary, not competing

- **MCP** standardizes how models access external tools and data sources (integration layer)
- **MWP** structures how context is delivered to an agent across workflow stages (context layer)

A v2 daemon agent uses both: MCP servers for Sentry / Google Workspace / Obsidian / Graphify integration; MWP for organizing the agent's workspace files and stage contracts. Source: ICM §2.2.

### 60/30/10 task triage framework (Eduba canon — was missing)

Before routing any task to an AI agent, apply:

- **60%** — deterministic tools (scripts, databases, existing software, CLI utilities)
- **30%** — rule-based logic (automation, routing, templates, deterministic conditionals)
- **10%** — genuine AI (synthesis, judgment, creative work that requires LLM reasoning)

Over-routing deterministic work to agents wastes tokens, degrades quality on genuinely AI-appropriate tasks, and creates non-reproducible workflows. Source: Clief Notes Skills Field Manual §2.1–2.5; vault-toolkit constraint 06.

**Applied to v2 daemon design:** the daemon itself (cron scheduler, file-bus, IPC server, webhook receiver) is 60% layer — deterministic infrastructure. Rule-based routing (which agent handles which task type) is 30%. Only the agent execution itself (writing code, interpreting Sentry traces, drafting responses) is 10% AI.

### iaGO-specific MWP rules

- **Per-workspace `CLAUDE.md` delta only (8-15 lines)** — stack divergence, commands, never-do-X. No duplication of root rules.
- **Doc-routing table** lives in root CLAUDE.md per `docs/specs/iago-os-mwp-routing-rule.md` (auto-loads every session).
- **Path-scoped `.claude/rules/*.md` with YAML `description:` + `globs:` frontmatter** (the canonical iaGO schema — see `.claude/rules/react-vite.md`, `aws-amplify.md` for examples) loads only when matching files are touched.
- **Note on hierarchical CLAUDE.md concatenation** ("deeper does not replace") — this is a Claude Code platform behavior, NOT an MWP prescription. MWP is model-agnostic per ICM §4.1.

### What MWP does NOT address (and what fills the gap in v2)

| Concern | MWP says | v2 derives from |
|---|---|---|
| Multi-agent coordination | Out of scope (ICM §5.2) | cortextOS daemon (agent-manager.ts, file-bus, PTY adapters) |
| Telegram bot strategy | Silent (zero references in source corpus) | Operational choice — recommend per-org bot routing |
| Concurrent state isolation | Out of scope (ICM §5.2) | O_EXCL file locks (cortextOS pattern) |
| Mid-pipeline automated branching | Out of scope (ICM §5.2) | Pipeline `review → fix → re-review` loop (iaGO existing) |
| Cost enforcement | Not mentioned | Paperclip-pattern SQLite ledger (deferred to API-billing trigger) |

---

## Feature requirements (in priority order)

### P0 — Foundation (Phase 0–2 of vision sequencing)

1. **VPS audit.** Inventory OpenClaw state, Tailscale mesh health, systemd availability. Output: `runtime/migration/00-vps-audit.md`.
2. **Daemon skeleton (local first).** `runtime/` directory in iago-os. Agent manager + file-bus + one PTY adapter (Claude Code first). Hello-world end-to-end on Santiago's Windows: register agent → claim task → Telegram approval → resume.
3. **VPS install alongside OpenClaw.** systemd unit `iago-os-v2-daemon.service`. Run in parallel. Validate one non-critical workflow.
4. **Telegram control surface.** Bot token, `appr_*` callback handler, file-based handshake. Santiago can `/start`, `/agents`, `/approve <id>`, `/abort <agent>`, `/inject <agent> <text>` from his phone.

### P1 — Multi-runtime + dashboard + daemon hardening

5. **Codex PTY adapter.** `runtime/pty/codex-app-server-pty.ts`. Codex agents cohabit with Claude in the same daemon.
6. **Wedge J — shell-hook matchers.** Regex + timeout on Claude Code hooks. Lands in daemon hook config.
7. **Wedge B — distiller + compression safety valve.** For long-running daemon sessions.
8. **Dashboard skeleton.** Next.js (or Streamlit fallback) via IPC server. Agent list, current state, recent activity, token spend per agent / project / model.
8a. **Wedge K — pre-stage pipeline checkpoints.** Rollback safety inside the pipeline. Required by daemon crash-recovery (cortextOS `.daemon-stop` marker pattern). Lands as part of Phase 2–3 daemon hardening, NOT demand-triggered (Wave 2 per vision spec wedge table).
8b. **OpenClaw cutover + cleanup.** Migrate remaining workflows, stop OpenClaw, archive state, delete after 30 days. Sequenced as roadmap Phase 7 (Stage D + E of the OpenClaw migration sequence), gated on Phase 6 dashboard stable. Not demand-triggered.

### P2 — Self-running automation pipeline (the Cormac loop, reimagined)

9. **Sentry MCP server integration.** Agents query Sentry context directly (issues, errors, projects, traces, breadcrumbs) when handling error-fix tasks.
   - **Install:** `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp` (Codex: `codex mcp add sentry --url https://mcp.sentry.dev/mcp`)
   - **Auth:** OAuth on first launch, scope to iaGO org
   - **Plan recommendation:** Start on **Sentry Developer (free, $0/mo)** — 5k events/mo + 30-day retention + 1 user is plenty for v2 build phase. **Skip Seer subscription** — we are the autofix; our daemon agents query Sentry for context and dispatch Codex/Claude to fix. Upgrade to **Team ($26/mo)** when error volume exceeds 5k/mo OR when adding Sebas to Sentry.
   - **Scope:** restrict MCP to one project at a time via URL slug (`https://mcp.sentry.dev/mcp/iago/<project-slug>`) — keeps agent context narrow.
10. **Webhook receiver.** Sentry → daemon webhook → file-bus task created → agent claims → fix → PR. Same path for GitHub events, Stripe events. HMAC validation.
11. **Auto-PR loop.** Agent fixes bug → runs existing iaGO pipeline (build gate → review → Codex adversarial → PR) → tags `@claude` for async review → Santiago morning-reviews-and-merges.
12. **Email auto-provision.** Each agent gets an email address (subdomain catch-all on AWS SES + IMAP polling for inbound). Agents can email each other, email clients, and read replies.
13. **Learning loop.** Pattern extraction stage in pipeline writes to `.iago/learnings/patterns.md`. 5+ occurrence threshold promotes to CLAUDE.md candidate via daemon-managed PR.
14. **KPI ingestion.** Daemon polls revenue (Stripe), feedback (a forms endpoint), and project signals (GitHub, telemetry) → writes to dashboard knowledge base.

### P3 — Demand-triggered

15. **Cost ledger (SQLite).** Per-agent budget + hard pause. Activates when any client moves to API billing.
16. **Wedge L — externalize review-checks.** Per-client review-rule overrides. Activates when a paying client requires custom review rules.
17. **Second messaging platform** (Slack or WhatsApp) — only when a paying client demands it.

---

## Acceptance criteria

For each P0 / P1 / P2 deliverable, the PR must pass:

1. **Build gate.** `tsc --noEmit && vite build` exit 0 (Node side). Pytest exit 0 (Python side).
2. **Unit tests.** ≥80% line coverage on new code per `.claude/rules/tdd.md`.
3. **Integration test.** End-to-end happy path documented and runnable: agent registers → claims task → completes work → Telegram notification fires → human approves → next step runs.
4. **Documentation.** `runtime/<component>/README.md` with: purpose, dependencies, configuration, ops runbook, failure modes.
5. **Telemetry.** NDJSON event emission per stage, keyed on `CLAUDE_CODE_SESSION_ID` where applicable.
6. **Rollback path.** Documented + tested. What does "undo this deployment" look like?
7. **Verification path completed.** Either (a) the full iaGO 8-stage pipeline via `/iago-execute` or `/iago-quick` (stress → impl → build → review → codex → fix → PR → summary), or (b) `/iago-fast` for trivial fixes (≤3 files, obvious, build gate only), or (c) a documentation-only deliverable produced inside a skill invocation. Manual `git commit` outside a skill is **never** the equivalent path — per root `CLAUDE.md` Execution Path table, all implementation goes through matching skill. The Garry standard is COMPLETENESS, and the skill-routing rule is how completeness is enforced. Pick the skill that's right for the deliverable; document the choice in the PR description.
8. **Self-evidence.** PR description includes a screenshot or terminal log proving the feature works end-to-end. Not a description; evidence.

If any criterion is not met, the deliverable is not done. Re-open and finish.

---

## Garry-impressed checklist (apply before declaring done)

Before any "DONE" status, check:

- [ ] Implementation handles every code path I can think of, including the failure ones
- [ ] Tests exercise the failure paths, not just the happy path
- [ ] Docs include a "what breaks and how to recover" section
- [ ] No `TODO`, `FIXME`, or `XXX` comments left in shipped code (unless tied to a tracked issue with a date)
- [ ] No "this is good enough for now" rationalizations
- [ ] If the real fix was 5 more minutes away, the real fix is what landed
- [ ] If there's a workaround, the upstream issue is filed AND the workaround documents the issue link
- [ ] If there's a dangling thread (cleanup, config migration, deprecation note), it's in this PR not the next one
- [ ] Pipeline review came back clean, not "clean with carry-over findings"

If any box unchecked: not done. Reopen.

---

## Phased sequencing (mirror of vision doc)

| Phase | Duration | Deliverable | Trigger |
|---|---|---|---|
| 0 | 0.5d | VPS audit | Day 1 |
| 1 | 5–7d | Daemon skeleton local + hello-world end-to-end | Phase 0 done |
| 1b | 3d | May-12 punch list (4 items: session-ID instrumentation, learnings write path, dirty-branch guard, fallback parser fix) | Parallel to Phase 1 |
| 2 | 2–3d | VPS install alongside OpenClaw, one workflow migrated | Phase 1 + 1b done |
| 3 | 3–4d | Codex PTY adapter | Phase 2 stable |
| 4 | 1d | Wedge J shell-hook matchers | Phase 2 stable |
| 5 | 2d | Wedge B distiller + compression | Phase 3 + 4 done |
| 6 | 5–7d | Dashboard skeleton | Phase 3 stable |
| 7 | 1d | OpenClaw cutover + 30-day archive | Phase 6 stable + Santiago green-light |
| 8 | 2d | Cost ledger SQLite | Triggered when first API-billing client |
| 9 | 2–3d | Wedge H webhook surface (Sentry + GitHub + Stripe) | Triggered when first webhook integration |
| 10 | 1d | Auto-PR loop end-to-end | Phase 9 done |
| 11 | 2d | Email auto-provision | Phase 7 stable |
| 12 | 1d | Learning loop pattern extraction | Phase 6 done |

**Total to operational v2 (Phases 0–7 + 10):** ~25–30 dev-days. ~5–6 weeks at sustainable pace.

---

## Operator goals (the "self-running" claim)

For v2 to be the worker that never sleeps, the daemon must:

1. **Run autonomously between human inputs.** Cron + webhook triggers initiate work; agents claim, execute, write results, queue notifications.
2. **Surface decisions, not status.** Don't ping Santiago for "I'm starting work." Ping only when irreversible / scope-changing / spend-changing decision requires approval.
3. **Show what's happening.** Dashboard reflects live agent state. Santiago opens dashboard from phone (via Tailscale) and sees: 3 agents working, 1 blocked on approval, 2 idle.
4. **Recover from failure.** PTY crash → marker → restart. Daemon crash → systemd restart → resume from markers. VPS reboot → systemd start → resume.
5. **Track what it learned.** Every plan-execution outcome (success, fail, rework count, time-to-merge) writes to telemetry. Patterns surface in `.iago/learnings/patterns.md`. Promotion to CLAUDE.md is a daemon-managed routine PR.
6. **Operate per-client.** Each client has its own org under `orgs/<client>/`. Agents in different orgs don't see each other's state. Cross-org tasks require explicit routing.
7. **Cost-bound.** When the cost ledger is active, any agent run that would push monthly spend over budget halts. Santiago is notified via Telegram. Override is one tap.

---

## How to ship this prompt

If you're an agent executing against this prompt:

1. Read all 6 input artifacts named at the top.
2. Confirm the v2 vision doc and research artifact are aligned with this prompt. If conflict, flag to Santiago and stop.
3. Pick the earliest unfinished phase from the sequencing table.
4. Plan that phase via `/iago-plan --feature <phase-slug>` (use the existing iaGO planning skill).
5. Execute via `/iago-execute <phase-slug>` (existing pipeline). The pipeline is preserved — use it.
6. Before declaring done, walk the Garry checklist above. Every box. No exceptions.
7. Write a session digest to Obsidian (`sessions/{date}-iago-os-v2.md`) per `~/.claude/rules/obsidian.md`. Link the PR and the artifacts changed.
8. Update STATE.md per project rule.

---

## Open questions Santiago must answer before Phase 1

1. **OpenClaw active dependencies.** What is running on it now that v2 must NOT break? (Inventory needed before cutover.)
2. **Telegram bot strategy.** ✅ DECIDED 2026-05-13 — one bot, per-agent file-bus tagging (Hermes-style routing with cortextOS-style approval handshake). cortextOS's per-agent-token pattern is rejected — operational overhead too high for 3-person scale. Subject to revisit if a paying client needs strict per-tenant bot isolation.
3. **Sebas access.** Day-1 or after dashboard? Default: Santiago-only Phases 1–3; Sebas joins Phase 6.
4. **Dashboard scope v1.** Full Next.js port or Streamlit minimal? Default: Streamlit minimal until daemon is stable.
5. **MUNET parallelism.** v2 proceeds in parallel with MUNET stalled, or pause for MUNET MVP? Default: parallel.

---

## Sources cited

- `docs/specs/iago-os-v2-vision.md` (2026-05-13) — 5-layer architecture
- `.iago/research/2026-05-13-multi-agent-cohabitation.md` (2026-05-13) — primitives + adoption verdicts
- `.iago/research/2026-05-13-mwp-source-synthesis.md` (2026-05-13) — canonical MWP source synthesis (overrides 2026-04-28 audit)
- `.iago/research/2026-04-28-mwp-restructure-audit.md` (2026-04-28) — superseded MWP method audit (kept for historical reasoning trail only)
- `docs/specs/iago-os-mwp-routing-rule.md` (2026-05-04) — doc-routing rule
- `.iago/research/iago-os-adversarial-review-2026-05.md` (2026-05-12) — May-12 punch list
- cortextOS: github.com/grandamenium/cortextos
- Hermes: github.com/NousResearch/hermes-agent (v0.11.0)
- Paperclip: github.com/paperclipai/paperclip
- Sentry Seer (Autofix + Agent + MCP Server): sentry.io/welcome/
- Cormac video reference: "Build with Cormac — self-running company" (source on Santiago's local machine; not reachable from builder agents on VPS or in `claude -p` subprocess). Source pattern derived: Sentry → Slack → Linear → Cursor PR loop. v2 collapses this to: Sentry → daemon webhook → file-bus → agent PTY → pipeline → PR → Telegram. Pattern is canonical; primary source is not.
