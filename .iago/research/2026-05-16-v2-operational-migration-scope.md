# iaGO-OS v2 — Operational Migration Scope (Phases 2-12 + End-State Goals)

**Date:** 2026-05-16
**Status:** Research — opinionated verdicts per Garry-impressed standard
**Author:** Claude (research subagent dispatched by orchestrator)
**Supersedes nothing** — extends `docs/specs/iago-os-v2-master-prompt.md` § Phased Sequencing with the operational "what additional shit we actually need" inventory Santiago asked for 2026-05-16
**Sources cited:** see § References

This document answers: **what does "v2 actually running my life" look like in measurable terms, and what is the full operational migration path to get there?** Phase 1 is mid-flight (6 PRs open against `main`, plan 07 acceptance gate pending merge). This research scopes Phases 2-12 + the punch list inside Phase 1, defines end-state success signals concretely, and proposes a recommended execution sequence.

Every section ends with an explicit recommendation + reasoning + acceptance criteria. Where Santiago must decide, the question is named with a default recommended answer.

---

## Table of Contents

- [0. End-state goals — what "v2 works" looks like measurably](#0-end-state-goals--what-v2-works-looks-like-measurably)
- [1. First-real-workflow — what proves v2 works post-Phase-2](#1-first-real-workflow--what-proves-v2-works-post-phase-2)
- [2. Multi-account Anthropic auth migration](#2-multi-account-anthropic-auth-migration)
- [3. Memory layer cutover decision](#3-memory-layer-cutover-decision)
- [4. Cron tasks migration from OpenClaw](#4-cron-tasks-migration-from-openclaw)
- [5. Cost ledger readiness](#5-cost-ledger-readiness)
- [6. Sentria port to v2 Daemon shape](#6-sentria-port-to-v2-daemon-shape)
- [7. Sebas access](#7-sebas-access)
- [8. Dashboard scope for Phase 6](#8-dashboard-scope-for-phase-6)
- [9. Cross-shape event router (Phase 5)](#9-cross-shape-event-router-phase-5)
- [10. External integrations roadmap](#10-external-integrations-roadmap)
- [11. Pipeline-on-VPS migration](#11-pipeline-on-vps-migration)
- [12. MUNET dependency](#12-munet-dependency)
- [13. Garry-impressed gap audit](#13-garry-impressed-gap-audit)
- [Open questions for Santiago](#open-questions-for-santiago)
- [References](#references)
- [Recommended action sequence](#recommended-action-sequence)

---

## 0. End-state goals — what "v2 works" looks like measurably

The vision doc defines layers and shapes; the master prompt defines acceptance criteria per deliverable. Neither answers the operator question: **what does Santiago observe when v2 is actually running his life?** This section defines that, as concrete signals per cadence.

### 0.1 Daily morning state (the phone-first UX)

**The signal Santiago observes:** Santiago wakes up, opens Telegram, hits `/agents` on the iaGO bot. Within 2s he sees:

```
iaGO-OS v2 — Fleet status 2026-05-17 08:14 UTC

Last 14h since you closed Telegram:
  3 agents ran to completion (idle now)
  1 agent blocked on approval (needs you)
  1 webhook event handled (Sentry P1 → PR #128, awaiting your merge)
  $4.27 spent across all agents (Anthropic + OpenAI)

Open agents:
  claude-pty[munet-fix-001]   idle   24m last activity   $0.71 today
  codex-pty[hermes-review]    idle   1h12m last activity $0.34 today
  sentry-event-handler        listening — 1 event resolved
  cron-tick-event             idle — next fire 09:00 UTC (PR triage)

Pending approval (1):
  approval_abc123 — "Apply codemod across 47 files in clients/munet-web?"
    Tap /approve allow abc123  or  /approve deny abc123
```

**Acceptance threshold:**
- `/agents` returns in ≤2s (IPC server cache + Tailscale latency)
- Cost roll-up is accurate to ±$0.05 per agent for the day
- Approval queue is exhaustive — no "background" approval that didn't surface to Telegram
- Last-activity timestamps reflect real PTY/HTTP activity, not just heartbeat ticks

**Why this matters:** Phase 6 dashboard is the rich UI, but the phone-first 30-second morning check is the OS-level signal. If `/agents` doesn't tell Santiago everything that happened overnight in one screen, v2 is failing its core promise.

### 0.2 Per-incident wall-clock

**The signal:** Sentry P0 error fires on a client project.

```
T+00:00  Sentry webhook arrives at VPS:443 (HMAC validated)
T+00:01  Daemon spawns sentry-event-handler ephemeral worker
T+00:02  Worker claims file-bus task; queries Sentry MCP for stacktrace + breadcrumbs
T+00:08  Worker dispatches fix-agent (claude-pty subagent) with context bundle
T+00:30  Subagent edits, runs build gate, queues PR
T+04:00  Pipeline review stage (3-pass) emits findings
T+06:00  Codex adversarial review emits findings
T+07:30  Local fix loop converges (≤2 rounds)
T+08:00  PR opened, @claude tagged
T+08:01  Telegram fires: "Sentry #4421 → PR #149 [open]. Review + merge."
T+20:00  Santiago reads on phone, taps "View PR" link, merges in GitHub mobile UI
```

**Acceptance threshold:**
- T+08:00 cap — Sentry-to-PR-open ≤8 minutes wall clock for a typical 1-3 file fix
- Santiago notification is single-message-per-incident (no progress spam)
- Failed fixes (pipeline can't close findings) surface as "blocked" with specific reason, never silent

**Why this matters:** The Cormac demo Santiago has been chasing (Sentry → Slack → Linear → Cursor → PR) collapses into Sentry → Telegram → merge. The wall-clock target is what makes it feel autonomous rather than "AI did 50% and now I do 50%."

### 0.3 Weekly operations rhythm

**The signal:** Santiago opens dashboard on phone (Tailscale), checks weekly view.

```
Week of 2026-05-12

Pipeline runs: 23
  Auto-resolved (no human merge): 0   ← always 0 by design (no auto-merge rule)
  Resolved with 1 human merge:   18   ← target = high
  Stuck in review loop (>3 rounds): 3
  Failed at build gate (max retries): 1
  Codex flagged irreversible-risk: 1

Per-client breakdown:
  munet-web:      11 runs  $52  ($4.7/run avg)
  iago-os:         8 runs  $31
  sentria:         3 runs  $14
  internal:        1 run   $6

Review-fix async loop:
  Triggered: 18 times
  Closed clean within 1 round: 12 (67%)
  Closed clean within 5 rounds: 16 (89%)
  Hit max rounds, escalated:    2 (11%)
```

**Acceptance threshold:**
- ≥80% of pipeline runs result in human merge within 24h of trigger
- ≥85% of @claude review-fix loops close within 5 rounds (matches `claude-review-fix.yml` cap)
- Stuck-in-loop count surfaces per-PR with the actual sticking finding
- Per-client cost breakdown is accurate ±$1/week

**Why this matters:** Weekly view is where Santiago decides "is the daemon paying for itself" and "is any client/agent burning budget without delivering." Without it, he's flying blind on the 5+ pipeline runs/week scale.

### 0.4 Monthly cost + learning rhythm

**The signal:** First of month, Santiago opens dashboard `/cost` view + `/learnings` view.

```
Cost — April 2026

Total Anthropic:  $284  (claude-opus-4-7 + claude-sonnet-4-7)
Total OpenAI:      $87  (gpt-5.5 via codex-companion)
Total infra:       $35  (Hostinger VPS + SES + small misc)
                   ----
                  $406  ← within $500 budget

Per-profile breakdown:
  default:                      $98   (orchestrator + small fixes)
  ilsantino_anthropic_sutoken: $187   (heavy pipeline runs on munet-web)
  iaguito_anthropic_sutoken:   $121   (internal iago-os work)

Per-shape spend:
  Shape 1 (PTY):    $342   (84%)  ← expected dominance
  Shape 2 (HTTP):    $44   (11%)
  Shape 4 (Event):   $20    (5%)
  Shapes 3+5:        $0    (not yet active)

Learnings extracted this month: 7
  Promoted to CLAUDE.md candidates (≥5 occurrences): 2
    - "Always check `await` on Lambda async ops" (already in CLAUDE.md, drop candidate)
    - "Codex stage 4 wrong-cwd bug pattern" (NEW — opens PR for review)
```

**Acceptance threshold:**
- Cost ledger reconciles ±$5/mo against the actual Anthropic + OpenAI invoices
- Learnings dedupe correctly (already-in-CLAUDE.md patterns drop, novel patterns surface)
- Per-profile attribution is correct (no "$0 on profile X but agent ran 12 times under X" bugs)

**Why this matters:** Monthly is the cadence at which Santiago decides "promote MUNET to API billing" or "switch sentria to OpenAI cheaper model." Without per-profile + per-shape breakdown, he can't make that call.

### 0.5 Per-client deliverable cadence (the "consultancy" rhythm)

**The signal:** A MUNET feature lands in production.

```
Feature: M3-06 event-pricing-mode

Phase    Trigger              Wall clock    Human touchpoints
-----    -------              ----------    -----------------
Plan     Santiago: "/iago-plan --feature ..."   12m    1 (santiago dispatches)
Stress   Pipeline auto-stress             3m     0
Execute  /iago-execute (auto)            42m    0 (background)
PR open  Pipeline auto-PR                ---    0 (auto)
Review   @claude async fix-loop          18m    0 (autoclosed clean)
Merge    Santiago: tap merge in GitHub    ---    1 (santiago merges)
Deploy   Amplify CI auto-deploy           7m    0 (auto)
Verify   Santiago: smoke test on phone   ---    1 (santiago verifies)
```

**Total: ~82 min wall clock, 3 human touchpoints** (dispatch → merge → verify).

**Acceptance threshold:**
- Median client-feature wall clock ≤2h for a single-plan feature
- Human touchpoints = exactly 3 (dispatch, merge, smoke) — no "intermediate progress check" required
- Failed flows surface to Telegram with reason ≤30s after failure

**Why this matters:** This is the rhythm that justifies billing client features as fixed-price deliverables rather than hourly. Without it, Santiago is still in the loop on every step.

### 0.6 Failure-mode goals (the "what survives a crash" surface)

**The signal:** Hard reboot of the VPS (or daemon SIGKILL) at any moment.

```
T-00:01  daemon SIGKILLed (no graceful shutdown — simulates real crash)
T+00:00  systemd auto-restarts iago-os-v2-daemon.service
T+00:02  daemon boots, scans for .daemon-stop markers
T+00:03  daemon detects 3 agent handles with NO marker (= crash)
T+00:04  daemon replays session.jsonl per handle up to recorded HWM
T+00:08  daemon re-claims orphaned tasks/claimed/<id>.json that match crashed handles
T+00:09  daemon re-spawns PTY adapters for the 3 handles
T+00:10  Santiago receives Telegram: "Daemon recovered from crash. 3 handles restored."
```

**Acceptance threshold:**
- Daemon back to fully operational ≤30s after systemd restart
- Zero double-billing on crash recovery (idempotency tables + generation tokens work)
- No orphan PTY processes left over (SIGINT-during-spawn EC1 + startup-cleanup EC2 from Plan 07 stress)
- Telegram crash notice fires exactly once, not per-handle

**Why this matters:** Operating an autonomous daemon means it WILL crash. The crash-survival contract is what separates "production-grade" from "neat prototype."

### 0.7 End-state summary table

| Cadence | What Santiago sees | Threshold | Phase that delivers |
|---|---|---|---|
| Per-second | Telegram bot responsive to commands | <2s reply | Phase 1 (in flight, PR #45) |
| Per-incident | Sentry → PR wall clock | ≤8 min | Phase 9-10 (Shape 4 + auto-PR) |
| Daily | `/agents` morning recap | exhaustive, accurate | Phase 1 + Phase 2 (VPS install) |
| Weekly | Dashboard pipeline summary | merge rate ≥80% | Phase 6 (dashboard) |
| Monthly | Cost + learnings dashboard | ledger reconciles ±$5 | Phase 8 (cost) + Phase 12 (learnings) |
| Per-feature | Client deliverable wall clock | ≤2h, 3 touchpoints | Phase 2 + Phase 11 (email) |
| Per-crash | Recovery wall clock | ≤30s | Phase 1 (in flight, plans 02/03/07) |

**Recommendation:** Lock these as the **operational acceptance gate** for declaring "v2 operational" (post Phase 7 cutover). The master prompt's per-PR acceptance criteria cover correctness; this section covers operator experience. Both gates apply.

---

## 1. First-real-workflow — what proves v2 works post-Phase-2

**Question:** After Phase 2 puts the daemon on the VPS alongside OpenClaw, what is the first end-to-end workflow we run to prove it's not a science-fair toy?

**Candidates evaluated:**

| Option | Pros | Cons | Phase dependency |
|---|---|---|---|
| Sentria daemon early port (Shape 5) | Real production traffic; tests Shape 5 in isolation; gives Sentria a v2 home | Forces Shape 5 work into Phase 2 (master prompt slots it at Phase 11); couples Sentria MVP timeline to v2 | Phase 11 today; would need re-sequencing |
| iaGO pipeline-on-VPS | Frees Santiago's Windows laptop; tests Shape 1 + IPC under load | Pipeline is the moat — moving it carries risk; needs build-gate on Linux | Phase 11 (proposed in §11 below) |
| MUNET deployment monitoring | Real product; cheap (just polls Amplify + reports) | Read-only — doesn't exercise write path or HITL approval | Phase 9-10 (Shape 4 + webhook) |
| Sebas onboarding flow | Validates dashboard + multi-user from day 2 | Sebas isn't on Tailscale yet; requires Phase 6 dashboard | Phase 6+ |
| Daily-digest agent | Cron triggered, writes Obsidian note, low blast radius | Trivial; doesn't prove much beyond "daemon runs cron + writes file" | Phase 2 fits |

**Recommendation:** **iaGO pipeline-on-VPS as the first real workflow**, but **scoped narrowly to one cron-triggered routine**: a nightly **PR triage agent** that runs on the VPS, queries open iago-os PRs via `gh api`, classifies them (waiting-on-claude / waiting-on-santiago / merge-ready), posts a single Telegram summary to Santiago. NOT the full pipeline-on-VPS migration (§11) — just one cron-fired agent that exercises Phase 2's full stack.

**Why this and not the others:**
- **Sentria daemon early port** would require sequencing Shape 5 work into Phase 2 — that breaks the master prompt's Phase ordering and forces premature Shape 5 design. Sentria is a Lambda-based webhook handler today; it doesn't need a daemon to function. Port stays at Phase 11+ per memory:project_sentria stability concerns.
- **Pipeline-on-VPS full migration** is its own multi-day effort (see §11). Doing it as "first workflow" conflates "prove daemon works" with "prove pipeline ports." Separate concerns.
- **MUNET deployment monitoring** is too read-only to test the write path. v2's value is autonomous action, not passive observation.
- **Sebas onboarding** is a Phase 6 concern (dashboard required first).
- **PR triage agent** exercises: cron-scheduler, multi-org agent resolution (it operates on iago-os repo only), file-bus task creation/claim, claude-pty spawn, gh CLI tool use, Telegram outbound. It's the **smallest workflow that touches the full Phase 2 stack** and produces a daily artifact Santiago can verify.

**Concrete contract for the first workflow:**

```yaml
# orgs/internal/agents/pr-triage/config.json
agentId: pr-triage
runtime: claude-pty
shape: pty
org: internal
cwd: /home/ilsantino/iago-os
env:
  GH_TOKEN: ${CRED:gh-token}  # systemd LoadCredential
autoStart: false               # cron-driven only
```

```json
// orgs/internal/agents/pr-triage/crons.json
{
  "schedule": "0 14 * * *",   // 09:00 EST nightly
  "wakeCheck": "scripts/check-prs-pending.sh",  // pre-LLM Hermes gate
  "prompt": "Run gh pr list --state open --json number,title,reviewDecision,statusCheckRollup. Classify each as: waiting_claude / waiting_santiago / merge_ready / stuck. Write summary to tasks/pending/pr-triage__$(date +%s).json. Done."
}
```

**Acceptance criteria for "v2 works":**
1. PR triage runs at 14:00 UTC daily for 7 consecutive days without manual intervention
2. Each run produces one Telegram message to Santiago
3. Wake-check correctly skips the LLM call when zero PRs are open (saves $0.10/run)
4. Crash recovery test: kill daemon mid-run, restart, run resumes from session.jsonl HWM
5. Cost ledger (when Phase 8 active) shows pr-triage spend ≤$0.50/week
6. Santiago acts on at least one Telegram message within the 7-day window (proves the signal is useful, not just emitted)

**Why this gate:** A 7-day clean run with one user action satisfies the "autonomous daemon doing useful work" claim. Anything shorter is a demo; anything broader (multi-agent, multi-shape) conflates Phase 2 with Phase 3+.

**Santiago decision needed:** Approve PR-triage as first workflow OR substitute. **Default recommended:** approve.

---

## 2. Multi-account Anthropic auth migration

**Context:** OpenClaw runs 3 Anthropic profiles per audit doc:
- `default`
- `ilsantino_anthropic_sutoken`
- `iaguito_anthropic_sutoken`

v2 daemon must preserve this (per audit doc § Active dependencies + Santiago decision 2026-05-13 "flexibility to change LLMs at will").

**Current Phase 1 plans:** No multi-profile mapping has been written. `runtime/daemon/config.ts` (Plan 07 Task 1) defines `AgentConfig = { agentId; runtimeId; org?; cwd; env; autoStart }`. No `auth_profile` field.

**Recommendation: add `auth_profile` field to AgentConfig in Phase 2, NOT Phase 1.** Reasoning: Phase 1 ships one Claude PTY adapter that uses `env.ANTHROPIC_API_KEY` directly (single profile). The multi-profile selector is a Phase 2 concern when the daemon lands on the VPS alongside OpenClaw's profile state.

### 2.1 Schema design

```ts
// runtime/daemon/auth-profile.ts (new file, Phase 2)
type AuthProfile = {
  name: "default" | "ilsantino_anthropic_sutoken" | "iaguito_anthropic_sutoken";
  provider: "anthropic" | "openai" | "google";
  mode: "token" | "oauth";
  credentialRef: string;  // systemd LoadCredential= name (e.g., "anthropic-default")
};

// runtime/daemon/config.ts amended:
type AgentConfig = {
  agentId: string;
  runtimeId: string;
  org?: string;
  cwd: string;
  env: Record<string, string>;
  authProfile?: string;  // NEW: references profile name from auth-profiles.json
  autoStart: boolean;
};
```

### 2.2 Canonical store

**Recommendation:** profiles live in `orgs/_global/auth-profiles.json` at the v2 state root (mode 600). Per-profile credential bytes NEVER live in this file — they live in systemd `LoadCredential=` files (per ADR § HTTP-shape adapter authentication). The JSON only references credential names.

```json
{
  "profiles": [
    {
      "name": "default",
      "provider": "anthropic",
      "mode": "token",
      "credentialRef": "anthropic-default"
    },
    {
      "name": "ilsantino_anthropic_sutoken",
      "provider": "anthropic",
      "mode": "token",
      "credentialRef": "anthropic-ilsantino"
    },
    {
      "name": "iaguito_anthropic_sutoken",
      "provider": "anthropic",
      "mode": "token",
      "credentialRef": "anthropic-iaguito"
    }
  ]
}
```

systemd unit `iago-os-v2-daemon.service` declares:
```
LoadCredential=anthropic-default:/etc/iago-os/credentials/anthropic-default
LoadCredential=anthropic-ilsantino:/etc/iago-os/credentials/anthropic-ilsantino
LoadCredential=anthropic-iaguito:/etc/iago-os/credentials/anthropic-iaguito
```

Adapter resolves: `process.env.CREDENTIALS_DIRECTORY + "/" + profile.credentialRef` → reads the secret. 1Password CLI provisions the files at deploy time, never at runtime (per ADR decision 2026-05-15).

### 2.3 Default profile selection rules

In order:
1. Agent config `authProfile` field (explicit per-agent override)
2. Org-level default (`orgs/<org>/auth-default.json` if present)
3. Global default (`auth-profiles.json[0]` = `default` profile)

**Reasoning:** mirrors cortextOS multi-org cascade pattern (audit doc § Active dependencies item 3). Per-agent override needed because `iaguito_anthropic_sutoken` is Santiago's iaGO-billed account (consultancy expense) while `ilsantino_anthropic_sutoken` is personal — they MUST be selectable per-agent to attribute spend correctly.

### 2.4 Profile-to-agent mapping (initial)

Based on OpenClaw current usage + memory:

| Agent | Default profile | Reason |
|---|---|---|
| `claude-pty` (any agent on iago-os repo) | `iaguito_anthropic_sutoken` | iaGO consultancy work |
| `claude-pty` (any agent on clients/munet-web) | `ilsantino_anthropic_sutoken` | personal account (MUNET pre-revenue at MVP) — Santiago can flip later |
| `claude-pty` (clients/sentria, clients/din, clients/fulldata) | `iaguito_anthropic_sutoken` | iaGO billable client work |
| `codex-pty` (any) | `default` | Codex is OpenAI, profile field unused for non-Anthropic |
| `pr-triage` agent (§1) | `iaguito_anthropic_sutoken` | internal infra |
| Sentry-event handler (Phase 9) | `iaguito_anthropic_sutoken` | infra observability |

**Recommendation:** map in `orgs/<org>/auth-default.json` at Phase 2 deploy time. No per-agent override unless audit shows mis-attribution.

### 2.5 Rotation procedure

Each token expires independently (Anthropic console). Procedure:

1. Generate new token in Anthropic console for the profile owner's account
2. Write to `/etc/iago-os/credentials/anthropic-<profile>` (mode 600)
3. `systemctl reload iago-os-v2-daemon` (NOT restart — reload via SIGHUP picks up new LoadCredential without dropping live PTY sessions, IF the daemon implements SIGHUP credential re-read)
4. Verify via `/cost` Telegram command: next agent spawn on that profile authenticates successfully

**Acceptance:** rotation cycle takes ≤2 min, zero PTY session loss. **Implementation requirement:** Phase 2 daemon main.ts adds SIGHUP handler that re-reads credential dir (NEW work item, list in §13 Phase 2 gap audit).

### 2.6 Cost-tap attribution per profile

The cost ledger (Phase 8) MUST tag every cost event with `authProfile`. Schema:

```ts
type CostEvent = {
  timestamp: number;
  agentId: string;
  org: string;
  authProfile: string;       // NEW — required
  provider: "anthropic" | "openai";
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
};
```

Dashboard cost view filters by profile (per § 0.4 monthly recap example).

**Acceptance gate:**
- 3 profiles registered in auth-profiles.json on Phase 2 deploy
- `/cost` Telegram command splits by profile
- Rotation procedure documented in `runtime/daemon/auth-profile.md`
- Profile drift detector: weekly cron compares profile list against OpenClaw's known set; alerts if any profile becomes stale

**Santiago decision needed:** Approve the 3-profile schema + initial mapping above. **Default recommended:** approve as-stated.

---

## 3. Memory layer cutover decision

**Context:** Three memory stores exist today, plus Obsidian:

| Store | Location | What it does | Who reads/writes |
|---|---|---|---|
| **LanceDB (OpenClaw)** | `~/.openclaw/memory/` on VPS, 72 KiB | Vector store for per-agent recall; OpenClaw `memory-lancedb` plugin | OpenClaw agents only |
| **MemPalace** | `~/.mempalace/` on Santiago's Windows (Mac copy for Sebas pending), ChromaDB + KG + diary | Cross-session conversation memory, agent diary, 13.5K drawers across 7 wings | Claude Code via MCP |
| **Obsidian vault** | `~/dev/obsidian-brain/` on Santiago's Windows | Structured notes, sessions, decisions, meetings | Claude Code via MCP, Graphify nightly |
| **Graphify graph** | derived from Obsidian, in `obsidian-brain/graphify-out/` | Knowledge graph over the vault | MCP query tools |

### 3.1 What each layer actually does (today)

- **LanceDB in OpenClaw** is per-agent vector recall. When `agents/main/sessions/*.jsonl` grows, OpenClaw indexes it into LanceDB so the agent can `mem.search("did I decide X")` mid-session. Per audit doc, it's 72 KiB — sparse use.
- **MemPalace** is cross-Claude-Code-session memory. Stop hook writes a diary entry per session; mining backfills conversation history into wings. Used by Claude Code via `mempalace_search` MCP tool.
- **Obsidian** is the structured layer — meetings, sessions, decisions all live here. Graphify builds a graph over it nightly.

### 3.2 Verdict: keep all four layers, define their roles for v2 cleanly

**Recommendation:**

| Layer | v2 role | Lives where | What the daemon does with it |
|---|---|---|---|
| **LanceDB** | **RETIRE** at Phase 7 cutover | N/A | Daemon does NOT use LanceDB. The OpenClaw use case (per-agent in-session vector recall) is replaced by session.jsonl replay (cortextOS pattern — already in Phase 1 plan 02). |
| **MemPalace** | **STAYS on Santiago's box** (Windows primary, Mac for Sebas Phase 6+) | Local `~/.mempalace/` | Daemon agents query via MCP over Tailscale (`mempalace_search` works over IPC). NO MemPalace on VPS. |
| **Obsidian** | **STAYS on Santiago's box**; daemon writes session digests there via MCP | Local `~/dev/obsidian-brain/` | Daemon agents write session digests via Obsidian MCP `write_note` over Tailscale. |
| **Graphify** | **STAYS on Santiago's box**, nightly rebuild via Task Scheduler | Local | Daemon agents read via Graphify MCP. |

### 3.3 Why MemPalace + Obsidian stay on Santiago's box (not VPS)

**Reasoning trail:**

1. **MemPalace is a personal memory layer.** Santiago's conversations + reasoning trails are private. Hosting on a $5/mo VPS that could be compromised (despite Tailscale-only inbound, future ufw rules etc) widens the blast radius. Local = lowest risk.
2. **Obsidian vault contains business-sensitive data** (client contracts, meeting notes, financial models). Same blast-radius argument.
3. **Latency over Tailscale is fine.** ChromaDB query over Tailscale: <100ms. MCP call from VPS daemon → Santiago's Windows → MemPalace → response: <300ms. Acceptable for agent reasoning (agents don't query memory every token).
4. **Sync complexity stays zero.** If MemPalace lived on VPS, Santiago + Sebas would each need a sync mechanism for their local Claude Code sessions. By keeping it local-primary, Santiago's box owns the truth; Sebas gets his own Mac copy (Phase 6).
5. **Disk bound.** Obsidian vault is several GiB (Drive sync content). VPS 71G free is fine but Santiago's box has TB. Local is the right tier.

**The exception:** if Phase 9+ event-handler agents need to query "did we see a similar Sentry error in the past" mid-incident, those queries traverse Tailscale to Santiago's MemPalace. Acceptable latency. If Santiago is offline (laptop closed), the agent gracefully degrades to context-only reasoning.

### 3.4 What replaces LanceDB

cortextOS session.jsonl replay (Phase 1 plan 02) + Hermes compression-threshold summarizer (Phase 5) cover the use case LanceDB served in OpenClaw:
- **Replay** restores conversational state after crash (better than LanceDB's "search past sessions")
- **Compression** keeps long sessions tractable without LanceDB vector indexing

No new vector store needed for per-agent recall. If Phase 12+ surfaces a need for cross-session vector recall on the VPS (e.g., "find similar incidents across all sentry-event runs"), evaluate then. Don't pre-build.

### 3.5 Cutover action

At Phase 7 Stage E (OpenClaw cleanup):
1. Archive `~/.openclaw/memory/` to tarball alongside `~/.openclaw/credentials/` (per audit doc § Cutover readiness)
2. Document in `runtime/migration/E-openclaw-removed.md` that LanceDB is **not migrated** — session.jsonl + Hermes compression cover the v2 use case
3. Tarball deleted after 30-day window

**Acceptance:**
- Daemon agents do NOT depend on LanceDB at any phase
- MemPalace + Obsidian + Graphify reachable from VPS over Tailscale (test: `tailscale ssh root@srv1456441 'curl http://100.77.40.22:<mcp-port>/...'` returns valid response)
- Session digests written to Obsidian by daemon agents include `originSessionId` field (matches MemPalace + daemon session.jsonl join key)

**Santiago decision needed:** confirm LanceDB retirement (not migration). **Default recommended:** retire — replay + compression cover the use case.

---

## 4. Cron tasks migration from OpenClaw

**Context:** Audit doc says `~/.openclaw/cron/` is 3.5 MiB of scheduled-job state. The audit didn't dump contents (which jobs, on what schedule). Cannot fully inventory without Tailscale SSH browser-auth which is blocked in this session (per audit "check-mode" issue).

**Recommendation:** Phase 2 includes a **cron migration sub-task** that runs as the first real work after VPS install:

### 4.1 Sub-task contract

```bash
# Run from Santiago's Windows box after Phase 2 daemon install:
tailscale ssh root@srv1456441 'find /home/ilsantino/.openclaw/cron -name "*.json" -type f -exec cat {} \;' > runtime/migration/openclaw-cron-inventory.json

# Then for each entry, decide: migrate / retire / leave-on-openclaw-until-cutover
```

### 4.2 Default migration rule

For each OpenClaw cron entry, apply this triage:

| Entry pattern | v2 action | Reasoning |
|---|---|---|
| "ping bot every Nh" | RETIRE — daemon has its own heartbeat | OpenClaw heartbeat was per-agent; v2 heartbeat is daemon-level (Phase 1 plan 03) |
| "run X agent every N hours" | MIGRATE — write `orgs/<org>/agents/<agent>/crons.json` | This is the canonical cortextOS pattern v2 adopts |
| "fetch RSS / poll feed" | EVALUATE — likely a Shape 5 (daemon) candidate in Phase 11+ | Don't force into Phase 2 |
| "compact memory / vacuum DB" | RETIRE — v2 has no LanceDB | Per §3 |
| "send Telegram digest" | MIGRATE to a v2 cron-tick-event handler (Phase 9) OR a `claude-pty` cron-driven agent (Phase 2) | Use Phase 2 path if simple; defer to Phase 9 if needs HTTP/SDK calls |
| "WhatsApp poller" | DROP — WhatsApp explicitly retired per Santiago 2026-05-13 | Audit doc § Active dependencies |

### 4.3 Cron schema in v2

cortextOS `crons.json` per agent:
```json
{
  "schedule": "0 14 * * *",          // cron syntax
  "wakeCheck": "scripts/check.sh",   // pre-LLM gate (Hermes pattern)
  "prompt": "Do the thing.",
  "timeoutSec": 600,
  "maxConcurrent": 1                 // never spawn two in parallel for the same agent
}
```

Daemon's `cron-scheduler.ts` (Phase 2 work item) reads all `orgs/*/agents/*/crons.json` at boot + on SIGHUP, schedules wake-ups.

### 4.4 Acceptance

- `runtime/migration/openclaw-cron-inventory.json` exists after Phase 2 install (real data from VPS)
- Per-entry triage table written to `runtime/migration/01-cron-migration.md`
- Migrated entries land as `orgs/<org>/agents/<agent>/crons.json` files
- Retired entries are documented with "retired because X" reasoning
- OpenClaw cron does NOT run during the parallel-operation window (Phase 2 → Phase 7) — disable in OpenClaw config to prevent duplicate firings

**Santiago decision needed:** Once inventory lands (Phase 2 sub-task), Santiago confirms per-entry triage. Can't pre-decide without the data.

---

## 5. Cost ledger readiness

**Context:** Phase 8 (cost ledger, SQLite, hard pause at budget) is **demand-triggered** per master prompt: activates "when any client moves to API billing." Need to determine: has any client done this?

### 5.1 Per-client billing state audit

Based on memory + repo introspection:

| Client | Billing state today | Path to API billing | Trigger date |
|---|---|---|---|
| **MUNET** | Pre-revenue (tech fee per ticket model, museum opens "MVP" 2026-Q2 per memory:project_munet_mvp_scope). Santiago uses Claude Max flat-rate. | Would migrate to per-feature API billing only if Santiago charges MUNET for AI work as line-item. No signal this is planned. | Not imminent |
| **DIN Pro** | Phase 02+ visual demo only per memory:reference_din_repo. No live AI features. | Same as MUNET — not on API meter yet | Not imminent |
| **FullData** | Demo only, pricing mock | Same | Not imminent |
| **Sentria** | Uses Bedrock (AWS-billed, $165/mo all-in per memory:project_sentria). Bedrock cost lives in client's AWS, not iaGO's Anthropic billing. | If Sentria moves to direct Anthropic (currently Bedrock), bills go to iaGO | Not imminent |
| **iaGO internal** (iago-os, iago-workspaces) | Claude Max flat-rate | N/A — internal use stays on Max | Never (by design) |

**Verdict:** **NO client is on API billing today.** Phase 8 cost ledger is NOT urgent.

### 5.2 But the trigger watch is real

The first API-billing event will be:
- A client signs a contract that line-items "AI Agent Hours" or "AI Token Spend Pass-Through"
- OR Santiago decides MUNET ticket-issuance flow should run heavy LLM work that justifies billing per-ticket

**Recommendation: define the trigger watch as a Phase 8 prerequisite, not Phase 8 itself.**

### 5.3 Trigger-watch contract

Create `runtime/cost-ledger/TRIGGER-WATCH.md` (Phase 2 deliverable, 1h work):

```markdown
# Cost-ledger Phase 8 trigger watch

Phase 8 activates when ANY of:

1. A client contract signs with "AI Token Pass-Through" or "Per-API-Call" billing clause
2. iaGO sends a client an invoice that line-items Anthropic/OpenAI API cost
3. Monthly Anthropic spend across all iaGO accounts exceeds $1500/mo (proxy: revenue concern emerges)
4. A new Shape 2 (HTTP/SDK) adapter ships that uses pay-per-call API (Bedrock fine-tuning, Replicate, fal.ai, etc.)
5. Santiago manually triggers via `/cost-ledger activate` Telegram command

Until then: cost-tap exists at the adapter level (CostEvent emission) but writes only to telemetry NDJSON.
Activation work: Phase 8 (2d) wires SQLite ledger + budget enforcement.
```

### 5.4 Pre-Phase-8 instrumentation

Even without the ledger, **CostEvent emission via `AgentRuntime.costTap()` MUST land in Phase 1 + Phase 3**. Per master prompt § AgentRuntime interface, `costTap?(handle): AsyncIterable<CostEvent>` is optional but recommended. If Phase 1's claude-pty adapter doesn't emit cost events, Phase 8 has nothing to ledger when it activates.

**Phase 1 gap (calls out in §13):** verify Plan 04 (claude-pty adapter) implements `costTap()`. If not, file as in-PR fix.

**Acceptance:**
- TRIGGER-WATCH.md exists at Phase 2 close
- Phase 1 claude-pty adapter emits CostEvent (≥1 per response — derived from Claude API response usage block)
- Telemetry NDJSON contains cost events under stage `cost-tap`
- Dashboard (Phase 6) shows cumulative cost even pre-ledger, derived from telemetry

**Santiago decision needed:** Confirm Phase 8 is demand-deferred. **Default recommended:** confirm. Phase 8 has zero current pressure.

---

## 6. Sentria port to v2 Daemon shape

**Context:** Sentria today is a Telegram-only Lambda-based incident bot (memory:project_sentria + clients/sentria/CLAUDE.md):
- Telegram webhook → Lambda `incidentFlowHandler` (state machine + Bedrock classification)
- EventBridge cron (5min) → Lambda `slaMonitor` → `escalationNotifier`
- AWS Amplify Gen 2, multi-tenant, ~$165/mo

**Sentria is NOT a daemon today.** It's serverless. Lambdas spawn on request and die.

### 6.1 Should Sentria port to v2 Shape 5 (Daemon)?

The master prompt lists Sentria as a "future Shape 5 candidate" (Phase 11+). Open question 6: ship now or stay standalone?

**Verdict: STAY STANDALONE. Do not port.**

**Reasoning:**

1. **Sentria's architecture is serverless-correct.** Lambda + EventBridge is the right shape for "infrequent inbound events with bursty fan-out." Forcing it into a v2 Daemon shape adds an always-on process to handle traffic that Lambda handles for ~$5/mo of compute. Net cost increase, no benefit.
2. **Sentria's resilience model is AWS-native.** EventBridge retries, DLQs, Lambda concurrency limits — Sentria gets all of this for free. v2 Daemon shape would have to reimplement these as Shape 5 contracts (per ADR § Shape 5 semantics: idempotency keys, recovery from cursor state, recycling policy). Wasted work.
3. **Sentria is a PRODUCT for a paying client (Absara).** Coupling its uptime to v2 daemon health turns a v2 outage into a Sentria outage. Wrong blast-radius coupling.
4. **The "agent inside v2" framing for Sentria is incorrect.** Sentria's "agent" is the conversation state machine inside the Lambda — there's no PTY, no HTTP-SDK call from a long-running process. It's an event-driven function.
5. **The actual integration v2 needs with Sentria is webhook → agent dispatch.** If Sentria detects an unresolvable incident, IT could send a webhook to v2 daemon's Shape 4 handler, which dispatches a Claude-PTY fix-agent. That's the right coupling — v2 handles the "Sentria escalated to me" event, not the "Sentria runs inside me" architecture.

### 6.2 What v2 SHOULD do with Sentria

| Concern | v2 action | Phase |
|---|---|---|
| Sentria escalations land in Santiago's Telegram | Already does today via Sentria's own bot. No v2 action needed. | N/A |
| Sentria errors fire to Sentry MCP | Phase 9 (Shape 4 sentry-event handler) picks them up — same as any other client error | Phase 9 |
| Sentria PRs auto-pipeline | Phase 11 (pipeline-on-VPS, §11) handles sentria PRs same as any other client | Phase 11 |
| Sentria deployment monitoring | Phase 6 dashboard could include Sentria's Amplify deploy status as a card | Phase 6 (nice-to-have) |

**No new Sentria-specific code in v2.** Sentria stays at bas-labs/sentria, deployed via Amplify, billed to Absara.

### 6.3 The narrow exception

IF in Phase 11+ a need surfaces for "monitor Sentria's IMAP-style mailbox for failed-delivery bounces" (e.g., Telegram bot token expiry, AWS billing alerts emailed to Sentria's ops address), THAT could be the first Shape 5 daemon-shape agent inside v2 — but it's a different agent than "Sentria the product."

**Santiago decision needed:** Confirm Sentria stays standalone. **Default recommended:** confirm. Override master prompt Phase 11 default "port Sentria to Shape 5" — it's the wrong abstraction for Sentria's traffic shape.

---

## 7. Sebas access

**Context:** Master prompt open question 3: "Sebas day-1 or after dashboard?" Default: Santiago-only Phases 1-3, Sebas joins Phase 6.

### 7.1 Recommendation: stay with default. Sebas joins Phase 6.

**Reasoning:**

1. **Phases 1-3 are highly iterative.** Daemon shape changes, command schemas shift, telemetry format may break. Adding a second user during volatility = double the cognitive load on Santiago + risk Sebas sees a half-working state and loses trust.
2. **Sebas is on Mac.** All Phase 1-3 testing happens on Santiago's Windows box. Mac compatibility surfaces later (Phase 2 VPS install removes the OS dependency since both Santiago and Sebas reach VPS over Tailscale). Forcing Mac testing pre-Phase-2 is wasted work.
3. **Phase 6 (dashboard) is when Sebas gets value.** A Telegram-only multi-user surface is awkward — both users share command history, Sebas can't see what Santiago dispatched without scrolling. The dashboard is the right surface for two users.
4. **Sebas is not blocked.** He has Claude Max + Cursor + his own Mac. Pre-Phase-6 he keeps working in iaGO the way he does today.

### 7.2 What Sebas needs at Phase 6

**Tailscale ACL changes:**

| Change | Required by | Effort |
|---|---|---|
| Add Sebas's Mac to Santiago's Tailnet | Phase 6 dashboard access | 1h — Santiago invites in Tailscale admin |
| Configure persistent ACL (no check-mode prompt per session) | Phase 6 — needed for daemon automation paths | 2h — write ACL JSON in Tailscale admin |
| Issue Sebas an SSH key for direct VPS access (optional, complements Tailscale SSH) | Phase 6 if Tailscale check-mode persists | 1h |

**Telegram bot strategy:**

| Option | Pros | Cons | Recommendation |
|---|---|---|---|
| One bot, two allowed user IDs in allowlist | Simplest. Matches "one bot, per-agent file-bus tagging" decision (Santiago 2026-05-13). | Santiago + Sebas share command history visible to each other. | **Recommended.** Consultancy = team, not adversaries. Shared visibility is a feature. |
| Two bots (one per user) | Privacy between Santiago + Sebas | 2× bot tokens to rotate, 2× polling. Doubles operational surface. | Reject. |
| One bot, role-based command gating | Sebas can `/agents` + `/approve <id>` but not `/abort` | Adds RBAC complexity (need a `roles.json`). Premature. | Defer to Phase 8+ if Sebas actually breaks something. |

**Dashboard auth:**

| Mechanism | Approach |
|---|---|
| Same-host IPC dashboard (cortextOS pattern) | Dashboard authenticates via Tailscale node identity. Sebas's Mac = Sebas; Santiago's Windows = Santiago. No login screen. |
| Bot allowlist mirrors dashboard auth | `allowedUserIds` in Telegram bot = `allowedTailscaleNodes` in dashboard config. One source of truth. |

### 7.3 Phase 6 acceptance for Sebas

- Sebas's Mac on Tailnet, ACL persistent (no per-session browser auth)
- Sebas opens `https://srv1456441.tailnet/dashboard` from Mac → sees same fleet view as Santiago
- Sebas `/agents` in Telegram → returns the same list as Santiago's `/agents`
- Sebas `/abort agent-foo` → daemon honors, logs `aborted_by: sebas` in telemetry
- One bot, two allowed user IDs, no per-user state divergence

**Santiago decision needed:** Confirm Phase 6 = Sebas onboarding window. **Default recommended:** confirm. Sebas accepts the wait per memory:project_munet_mvp_scope MUNET is stalled — he's not bottlenecked.

---

## 8. Dashboard scope for Phase 6

**Context:** Per master prompt: "full Next.js port via IPC server. Agent list across all 5 shapes, per-shape filters, current state, recent activity, token spend per agent / project / model / shape, intervention controls. Streamlit fallback dropped." 8-10d effort.

Need: prioritized screen + data + action list.

### 8.1 Screen inventory (priorities P0 = must-ship-in-Phase-6; P1 = nice-to-have-in-Phase-6; P2 = defer)

#### Home / Fleet view (P0)

**Data shown:**
- All registered agents (live + idle + crashed)
- Per agent: shape badge, agentId, runtimeId, lastStatus, lastActivity (relative time), org, cost-today
- 5-shape filter chips (PTY / HTTP / MCP / Event / Daemon)
- Org filter dropdown (`_global`, `iago-os`, `munet-web`, `sentria`, ...)
- Pending approvals count (badge on top nav)

**Actions:**
- Click agent → drill to per-agent page
- Toggle shape filters
- Refresh (auto every 5s via IPC poll)

#### Per-agent page (P0)

**Data shown:**
- Agent metadata: id, runtime, version, shape, org, created, lastSpawn
- Current handle: status, generation token, RSS (Shape 5), session HWM (Shape 1)
- Last 10 telemetry events (table — timestamp, stage, severity, extras)
- Cost spent: today / week / month (with profile breakdown)
- Session.jsonl tail (last 50 events, expandable to full)

**Actions:**
- `/abort` button (confirmation dialog)
- `/restart` button (confirmation)
- `/inject text` text input (Shape 1 only — gated per `runtime.shape`)
- `/send <message>` (Shapes 2/3/4/5)
- "Show full session log" → opens in new tab

#### Cost view (P0)

**Data shown:**
- Total spend: today / this week / this month / YTD
- Breakdown:
  - Per profile (default / ilsantino / iaguito)
  - Per shape
  - Per org (client)
  - Per model (opus / sonnet / gpt-5.5)
- Burndown chart (line, last 30 days)
- Top 10 cost-burning agents this month (table)

**Actions:**
- Filter date range
- Export CSV (for invoicing or reconciliation)

#### Approvals queue (P0)

**Data shown:**
- All pending approvals: approvalId, agentId, reason, createdAt, age
- Telegram link (opens bot chat at the approval message)

**Actions:**
- Allow / Deny buttons (mirror Telegram callback path → `resolveApproval()`)
- "Allow all from agent X" bulk action (P1)

#### Pipeline runs view (P0)

**Data shown:**
- All pipeline invocations (cortextOS task-bus + iaGO `execute-pipeline.sh` integration)
- Per-run: plan, project-dir, current stage (stress/impl/build/review/codex/PR), wall clock
- Telemetry NDJSON tail per run
- PR link if past stage 5

**Actions:**
- "Kill" button (SIGTERM the pipeline child process)
- "View log" → tail per-stage stdout

#### Logs view (P1)

**Data shown:**
- Filterable tail of `telemetry/<date>.ndjson`
- Filter by: agentId, stage, severity
- Search (regex)

**Actions:**
- "Download log range" (CSV / JSON)

#### Settings (P1)

**Data shown:**
- Daemon config (read-only: telegram allowlist, heartbeat intervals, IPC socket path)
- Auth profiles list (names only, no secrets)
- Cron schedule per agent

**Actions:**
- "Edit cron" → writes back to `orgs/<org>/agents/<agent>/crons.json` (requires daemon SIGHUP)
- "Edit allowlist" (P2 — risky)

#### Learnings view (P1)

**Data shown:**
- Recent learnings extracted (Phase 12)
- Promotion candidates (5+ occurrences not yet in CLAUDE.md)

**Actions:**
- "Promote to CLAUDE.md" → opens PR via gh CLI

#### Sebas's view (P2)

A "personal" mode where the dashboard filters to Sebas's actions only. Useful if Santiago + Sebas split work explicitly (probably never needed at 3-person scale).

### 8.2 Tech stack (locked per master prompt)

- Next.js (cortextOS port). Use App Router (Next 14+).
- Tailwind v4 + ShadCN/UI (per iaGO root CLAUDE.md tech-stack rule)
- Same-host IPC (Unix socket on VPS) to daemon — NO REST API
- Tailscale serves the dashboard at `https://srv1456441.tailnet/dashboard`
- Auth: Tailscale node identity (no login screen)

### 8.3 What stays OUT of Phase 6

- Mobile-first responsive design beyond "works on phone Safari." Phase 6 ships desktop-first; phone uses Telegram for control + dashboard for read-only.
- Real-time websockets. Phase 6 ships 5s IPC poll. Websockets land Phase 12+ if needed.
- Edit-config UI for risky surfaces (allowlist, profiles). Edit JSON files directly.
- Multi-window comparison. Phase 6 is one user one viewport.
- Custom themes. Use ShadCN defaults.

### 8.4 Acceptance

- All P0 screens render real data from daemon IPC
- Per-shape filter actually filters (test with 5 shapes registered)
- Cost view total reconciles ±$0.10 against telemetry NDJSON cost-tap events
- `/abort` button → daemon honors → agent status flips to "exited" within 5s
- `/inject` gated to Shape 1 (UI greys out for non-PTY agents)
- Dashboard reachable from Santiago + Sebas Tailnet nodes
- Phase 6 PR description includes screenshot of every P0 screen rendering real daemon data

**Santiago decision needed:** Confirm P0/P1/P2 split. **Default recommended:** confirm. P0 = 5 screens (fleet, per-agent, cost, approvals, pipeline-runs). P1 deferable if Phase 6 runs over 10d budget.

---

## 9. Cross-shape event router (Phase 5)

**Context:** Hermes's `cli-config.yaml` `hooks.<event>[]` syntax (regex matcher + timeout) is generalized to a cross-shape router in v2 Phase 5. Per master prompt § P1 item 6: "Generalized in Phase 5 to a cross-shape event router (Hermes deeper-adoption)."

Need: concrete starter rules Santiago wants.

### 9.1 Rule syntax draft

```yaml
# orgs/_global/event-router.yaml
rules:
  - name: pty-crash-ping
    on: pty.exit
    matcher:
      exitCode: "!= 0"
    action:
      type: telegram-ping
      template: "Agent {agentId} crashed (exit {exitCode}). Last 100 lines:\n{sessionTail}"

  - name: sentry-p0-fix-dispatch
    on: webhook.sentry
    matcher:
      level: "fatal"
      project: "(munet|sentria|din)"   # regex
    action:
      type: dispatch-agent
      agent: fix-agent
      payload:
        sentryEventId: "{event.id}"
        traceId: "{event.contexts.trace.trace_id}"
        org: "{event.project}"

  - name: daily-summary
    on: cron.tick
    matcher:
      cron: "0 9 * * *"   # 09:00 UTC daily
    action:
      type: dispatch-agent
      agent: summary-agent
      payload:
        scope: "yesterday"
        outputObsidianPath: "daily/{date}.md"

  - name: pr-merged-learnings-extract
    on: webhook.github
    matcher:
      action: "closed"
      merged: true
      base: "main"
      repo: "ilsantino/iago-os"
    action:
      type: dispatch-agent
      agent: learnings-extractor
      payload:
        prNumber: "{event.pull_request.number}"

  - name: stripe-failed-charge-pause
    on: webhook.stripe
    matcher:
      type: "charge.failed"
    action:
      type: telegram-ping
      template: "Stripe charge failed for {customer.email}. Manual review needed."

  - name: cron-pre-llm-gate
    on: cron.pre-llm
    matcher:
      agent: "pr-triage"
    action:
      type: run-script
      script: "scripts/check-prs-pending.sh"
      onExitNonzero: "skip-llm"

  - name: mcp-rate-limit-breach
    on: mcp.rate-limit-breach
    matcher:
      server: ".*"
    action:
      type: telegram-ping
      template: "MCP {server} hit rate limit. Paused for {pauseSeconds}s."

  - name: heartbeat-stall-detected
    on: heartbeat.stall
    matcher:
      agent: ".*"
    action:
      type: telegram-ping
      template: "Agent {agentId} stalled. Restarting automatically. RSS was {rssBytes}."

  - name: approval-pending-too-long
    on: approval.pending
    matcher:
      ageMs: ">= 3600000"   # 1 hour
    action:
      type: telegram-ping
      template: "Approval {approvalId} pending 1+ hour. {reason}"

  - name: codex-cost-spike
    on: cost-tap.event
    matcher:
      perCallUSD: ">= 1.50"
    action:
      type: telegram-ping
      template: "Single Codex call cost ${perCallUSD}. Agent {agentId}, prompt {firstNTokens}."
```

### 9.2 Starter 10 rules — opinion

| # | Rule | Why it ships day 1 |
|---|---|---|
| 1 | `pty-crash-ping` | Every PTY crash should be visible (no silent crashes) |
| 2 | `sentry-p0-fix-dispatch` | Cormac loop — the moat |
| 3 | `daily-summary` | The "morning recap" §0.1 |
| 4 | `pr-merged-learnings-extract` | Phase 12 learning loop trigger |
| 5 | `stripe-failed-charge-pause` | When installflow lands or any client takes Stripe |
| 6 | `cron-pre-llm-gate` | Hermes wake-gate — saves tokens |
| 7 | `mcp-rate-limit-breach` | Phase 5 MCP rate-limiter sibling — needs visibility |
| 8 | `heartbeat-stall-detected` | Without this, Santiago doesn't know auto-restart fired |
| 9 | `approval-pending-too-long` | HITL approvals shouldn't ghost — needs reminder |
| 10 | `codex-cost-spike` | Budget canary even pre-ledger |

### 9.3 Engine design

`runtime/daemon/event-router.ts` (Phase 5 work item):
- Loads `orgs/_global/event-router.yaml` at boot + SIGHUP
- Subscribes to: PTY status callbacks, webhook receiver, cron-scheduler, MCP server hooks, heartbeat controller, approval-bus, cost-tap stream
- For each event, evaluates all rules in YAML order; first match wins (or all-match if `runAll: true` per rule)
- Action handlers registered: `telegram-ping`, `dispatch-agent`, `run-script`, future `email-send`, `webhook-out`
- Matcher syntax: literal equality, `!= X`, `>= N`, regex `/.../`, template interpolation `{path.to.field}`

### 9.4 Acceptance

- 10 starter rules in `orgs/_global/event-router.yaml` at Phase 5 close
- Each rule has an integration test that fires a synthetic event and asserts the action ran
- Rules can be added by editing YAML + sending SIGHUP — no daemon restart
- Telemetry tags every rule firing with `rule_name`, `match_ms`, `action_outcome`

**Santiago decision needed:** Approve 10 starter rules + matcher syntax. **Default recommended:** approve. Adjust list if any starter doesn't match Santiago's actual workflow.

---

## 10. External integrations roadmap

**Context:** External services v2 will integrate with. Order of landing + per-integration prereqs.

### 10.1 Integration table

| # | Integration | Account state | Phase | Cost | Prereqs |
|---|---|---|---|---|---|
| 1 | **Sentry MCP** | Account exists (per memory). Org: iago. | Phase 9 | $0 (Developer plan) | Plan recommendation: Developer (5k events/mo, 30d retention, 1 user). Skip Seer ($20/mo) — we ARE the autofix. |
| 2 | **GitHub webhooks** | Personal access token exists (ilsantino). | Phase 9 | $0 | Per-repo webhook config (`Settings > Webhooks`). HMAC secret per repo, stored systemd LoadCredential. |
| 3 | **Stripe webhooks** | NO account yet (memory:feedback_stripe_test_mode says "build with test keys"). | Demand-triggered (Phase 9 surface + first paying client) | $0 webhook fee | Per-client Stripe account (Santiago doesn't own client accounts). Pre-create test webhook for installflow. |
| 4 | **Google Workspace MCP** | Santiago has Workspace. | Phase 11+ | $0 (uses Workspace seat already owned) | Anthropic-published `gworkspace-mcp` does not exist as of 2026-05-16. Use Google MCP Python `mcp-google-workspace` (community) — verify license + audit before install. OAuth scope: calendar.events + drive.readonly + gmail.readonly to start. |
| 5 | **SES email auto-provision** | iaGO domain exists. SES sandbox status unknown — needs check. | Phase 11 | ~$0.10/1000 emails sent | Move SES out of sandbox (Santiago request via AWS Support, 24-48h SLA). Add MX record for subdomain catch-all (e.g., `@agents.iagoag.com`). IMAP receive via SES → S3 → daemon IMAP poller (Shape 5 `imap-daemon`). |
| 6 | **Anthropic Console API** (admin scoping) | Existing 3 profiles. | Phase 8 trigger | included | If Phase 8 ledger activates, may want Admin API for per-key usage queries — Anthropic ships this in dashboard but no public API for org-level usage yet. Manual CSV export until they ship API. |
| 7 | **OpenAI Console API** (admin) | Codex uses OpenAI key. | Phase 3 (Shape 2 openai-sdk) | included | Usage tracking via Console; programmatic usage API exists (verify scopes). |
| 8 | **Obsidian Local REST API** (alternative to MCP) | Plugin exists. Santiago uses MCP. | N/A | $0 | Stay with MCP per memory MemPalace + Graphify routing. |
| 9 | **Telegram Bot API** | Bot token exists in OpenClaw. | Phase 1 (in flight) | $0 | Rotate via BotFather post-OpenClaw cutover (Stage E). |
| 10 | **WhatsApp Cloud API** | OpenClaw has token. | RETIRE at Stage E | N/A | Per Santiago 2026-05-13: revoke at OpenClaw cutover. Per audit doc § OAuth tokens. |
| 11 | **Meta Business webhooks** | Tied to WhatsApp. | RETIRE at Stage E | N/A | Remove webhook bindings via Meta Business console (Santiago's manual step at cutover). |
| 12 | **fal.ai** (iago-workspaces) | NOT YET — Santiago pending per memory:project_iago_workspaces | Phase 11+ | pay-per-use | Outside v2 daemon scope — used by content-pipeline workspace. Don't bundle. |
| 13 | **HeyGen + ElevenLabs** (iago-workspaces) | NOT YET — pending | Phase 11+ | subscription | Same — outside v2. |
| 14 | **n8n** | Configured for use elsewhere; not currently running. | Demand-triggered Phase 3+ | self-hosted free or cloud $20/mo | Master prompt notes "may return as VPS automation primitive in Phase 3." Defer concrete adoption. |

### 10.2 Per-integration land order (recommendation)

```
Phase 9 (Shape 4 surface):
  1. Sentry MCP        — install via `claude mcp add --transport http sentry ...`
  2. GitHub webhooks   — per-repo config + HMAC verify

Phase 10 (auto-PR loop):
  uses Sentry + GitHub from Phase 9 — no new integration

Phase 11 (email + Shape 5):
  3. SES out of sandbox + subdomain catch-all  (~3d incl. AWS support wait)
  4. Google Workspace MCP                       (~1d incl. OAuth)

Phase 8 (cost ledger trigger):
  6. Anthropic Admin API usage queries (if available; else CSV)

Demand-triggered:
  - Stripe webhooks (when first paying client)
  - n8n (when first workflow that fits)
```

### 10.3 Sentry MCP install procedure (per master prompt)

Verified install commands (master prompt § P2 item 9):

```bash
# Claude Code
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp

# Codex
codex mcp add sentry --url https://mcp.sentry.dev/mcp

# OAuth on first launch — scope to iaGO org

# Scope MCP to single project (keeps agent context narrow):
# Use https://mcp.sentry.dev/mcp/iago/<project-slug>
```

### 10.4 Acceptance per phase

- **Phase 9:** Sentry MCP installed on VPS + GitHub webhook firing to `https://srv1456441.tailnet/webhook/github` → daemon processes event → telemetry logs the receipt
- **Phase 11:** SES out of sandbox + 1 agent successfully sends + receives an email via subdomain catch-all → IMAP poller daemon-shape adapter reads inbox
- **Demand-triggered (Stripe):** when first client signs Stripe contract, 1-day spike to add `stripe-event` Shape 4 adapter + event-router rule (§9)

**Santiago decision needed:**
- Approve Sentry Developer (free) tier choice for Phase 9. **Default recommended:** approve. Upgrade to Team ($26/mo) only when adding Sebas to Sentry OR when event volume >5k/mo.
- Confirm WhatsApp + Meta webhook drop at Stage E. **Default recommended:** confirm per Santiago 2026-05-13.
- Defer n8n. **Default recommended:** defer.

---

## 11. Pipeline-on-VPS migration

**Context:** `scripts/execute-pipeline.sh` runs from Santiago's Windows today. Per memory:project_pipeline_bugs there are known FAIL-regex and Codex wrong-cwd bugs. Moving it to VPS would free Santiago's laptop + enable GitHub-webhook-driven autonomous pipeline runs.

### 11.1 What's Windows-specific in the current pipeline

| Concern | Windows-isms |
|---|---|
| Self-freeze re-exec | Per CLAUDE.md execution-pipeline.md — "exists because bash on Windows reads scripts by byte offset" — the hack is BENIGN on Linux but still runs. No port issue. |
| `gh`, `git`, `claude`, `codex`, `node`, `bash` on PATH | Linux equivalents exist; install on VPS (Node 22 already there per audit) |
| `gsort -V` for codex-companion lookup | Per CLAUDE.md macOS prereq — uses BSD `sort -r` fallback. Linux `sort -V` works natively. No port issue. |
| PowerShell calls | None in execute-pipeline.sh proper; some `scripts/*.mjs` may use platform-specific paths |
| `timeout` / `gtimeout` | Linux ships `timeout` natively. No issue. |
| Windows path quirks (CRLF, `C:/...` absolute) | The fix at line 47 already handles both — no port issue |
| `console-check.mjs` `taskkill /T` | Per memory:feedback_worktree_hygiene — Windows-specific. NOT needed on Linux (kill children via process group). |

**Net: pipeline is ~95% portable.** One Windows-specific helper (`console-check.mjs`) needs a Linux branch; everything else runs as-is.

### 11.2 What needs porting

| Item | Effort | Detail |
|---|---|---|
| `console-check.mjs` Linux branch | 2h | Replace `taskkill /T /F /PID` with `kill -- -<pgid>` |
| Codex stage 4 wrong-cwd bug | 1h | Per memory:project_pipeline_bugs — fix before any VPS run |
| FAIL-regex per-line bug in pipeline | 1h | Per memory:project_pipeline_bugs — fix before any VPS run |
| codex-companion.mjs path resolution | 1h | Verify `~/.codex/config.toml` works on Linux (likely yes — Codex CLI 0.125.0+ cross-platform per memory:reference_codex_windows) |
| Anthropic credentials provisioning | 2h | Each of 3 profiles needs `LoadCredential=` file (overlap with §2 auth migration) |
| Telegram dispatch from pipeline | 2h | Pipeline already does NOT dispatch Telegram; the daemon does. If pipeline-on-VPS needs to notify, route via daemon IPC. |

### 11.3 Architecture options

| Option | Description | Pros | Cons | Recommendation |
|---|---|---|---|---|
| A: **Shape 4 (Webhook-driven)** | GitHub webhook → daemon spawns ephemeral `pipeline-runner-event` worker → runs `execute-pipeline.sh` | Reactive; one entry per event; matches event-router design | Pipeline is a long-lived process (40+ min); ephemeral-worker model may need adjustment for long workers | **Recommended.** Lands naturally in Phase 9 alongside Sentry/GitHub webhooks. |
| B: **Shape 5 (Always-on watcher)** | Daemon-shape agent polls GitHub API for new commits/PRs every N min → runs pipeline | Simpler initial impl | Polling overhead; wakes for nothing 99% of time | Reject — Hermes wake-gate already on cron path; this duplicates. |
| C: **Separate systemd unit** | `iago-os-pipeline-runner.service` independent of v2 daemon, fires per GitHub webhook | Decouples pipeline from daemon stability | Pipeline can't share daemon's telemetry, cost-tap, IPC | Reject — defeats v2 unified telemetry. |
| D: **PTY agent that runs the pipeline** | `pipeline-pty` adapter wraps `bash scripts/execute-pipeline.sh` | Inherits Shape 1's cost-tap, replay, heartbeat | Pipeline isn't really PTY-shaped; force-fit | Reject — wrong shape. |

**Recommendation: Option A (Shape 4 webhook-driven)** with a twist: the Shape 4 ephemeral worker spawns a long-lived `child_process.spawn` for `execute-pipeline.sh` and supervises it for the 40+ min run. This is consistent with ADR § Shape 4 semantics: "spawn() is idempotent; per-event work runs in ephemeral child process."

### 11.4 GitHub webhook trigger contract

Per repo, configure webhook:
- URL: `https://srv1456441.tailnet/webhook/github/iago-os` (per-repo path)
- Events: `pull_request.opened`, `pull_request.synchronize`, `push.refs/heads/main`, `workflow_run.completed`
- Secret: HMAC stored in `LoadCredential=github-webhook-iago-os`

Daemon `webhook-receiver.ts` (Phase 9) routes by URL path → dispatches to `pipeline-runner-event` adapter (Phase 11 work item) → adapter examines event payload, determines whether to run pipeline:

```typescript
// runtime/agent-runtime/event/pipeline-runner-event.ts
async function handleEvent(event: GitHubWebhookEvent) {
  if (event.type === "pull_request" && event.action === "opened") {
    // Trigger pipeline on the PR's branch (PR auto-review path)
    // — but the existing iaGO model is /iago-execute triggered manually
    // — so for v2, the pipeline-on-VPS use case is:
    //   "Santiago dispatches /iago-execute via Telegram, daemon runs pipeline-runner-event"
    return;
  }
  if (event.type === "push" && event.ref === "refs/heads/main") {
    // Could trigger post-merge learnings extraction (Phase 12 rule)
    // — handled by event-router learnings-extract rule (§9)
    return;
  }
}
```

### 11.5 Telegram dispatch path

The real "pipeline-on-VPS" trigger Santiago wants:

```
Phone → Telegram: "/iago-execute feature-foo --project clients/munet-web"
  → bot parses, validates allowedUserId
  → bot writes tasks/pending/pipeline-runner__<uuid>.json with payload {plan, projectDir}
  → pipeline-runner-event handler claims, spawns execute-pipeline.sh as supervised child
  → telemetry streams to dashboard
  → on completion: bot replies "PR #149 open, tagged @claude"
```

**This is the practical workflow.** It lands in Phase 11 alongside the email auto-provision Shape 5 work (similar daemon-child supervision pattern).

### 11.6 Acceptance for "pipeline runs on VPS"

- Santiago dispatches `/iago-execute feature-foo --project clients/munet-web` from Telegram
- Pipeline runs end-to-end on VPS, producing PR + @claude tag
- Santiago receives single Telegram on completion (not per-stage)
- Telemetry NDJSON written to VPS state dir, visible on dashboard
- 3 Anthropic profiles work (per §2 auth) — pipeline picks profile per project per `auth-default.json`
- Codex stage 4 runs cleanly on Linux (Codex Windows bug per memory does not regress)
- Build gate passes on Linux for both Node + Python sub-projects
- Crash mid-pipeline → daemon detects via heartbeat → telegram alert + status = "blocked" with stage name

**Phase placement: Phase 11** (alongside Shape 5 IMAP daemon — both are "supervised long-lived child" patterns, share infrastructure).

**Santiago decision needed:**
- Approve Phase 11 placement (not earlier). **Default recommended:** approve. Pipeline-on-VPS is high-value but not high-urgency — Phase 1-7 deliver the daemon foundation first.
- Confirm bug fixes (FAIL-regex, Codex wrong-cwd) ship before Phase 11. **Default recommended:** ship as `/iago-fast` fixes BEFORE Phase 11 starts — don't carry pipeline bugs into VPS.

---

## 12. MUNET dependency

**Context:** Memory says M2 deferred post-MVP, scope cuts 2026-04-17. Where does v2 daemon intersect MUNET?

### 12.1 Verdict: MUNET stays mostly separate from v2 daemon. v2 reads MUNET; v2 doesn't run MUNET.

**Three intersection points evaluated:**

| Intersection | v2 owns? | Reasoning |
|---|---|---|
| **MUNET pipeline (run dev/PR flow on VPS)** | YES, via §11 path (Phase 11) | When Santiago dispatches `/iago-execute` for MUNET via Telegram, the pipeline-on-VPS path runs it. Same as iaGO's own pipeline. No MUNET-specific code. |
| **MUNET fix-agent on Sentry errors** | YES, via Phase 9 sentry-event handler | If MUNET has a Sentry project, errors fire → sentry-event handler → dispatch fix-agent (claude-pty subagent) → fix on a branch of clients/munet-web → PR. Standard Shape 4 flow. |
| **MUNET prod monitoring** (per memory:reference_munet_prod_aws — Sebas's AWS account 851725296610) | NO | MUNET prod is on Sebas's AWS. v2 daemon does NOT have credentials there. Monitoring stays in AWS-native (CloudWatch + Amplify console). |
| **MUNET prod deploy** | NO | Amplify Hosting auto-deploys on PR merge to `main` branch of bas-labs/munet-web. v2 has no role. |
| **MUNET data plane (DynamoDB writes)** | NO | Server-side only. v2 has no access. |
| **MUNET admin actions** (refunds, manual ticket comp) | NO | Done via Panel MUNET (Cognito-auth UI). v2 has no role. |

### 12.2 What v2 DOES NOT do

- Does not run MUNET sandbox (`npx ampx sandbox`) — that's Santiago + Sebas local dev only
- Does not own MUNET secrets (Stripe, SES, QR HMAC) — those live in Amplify env vars + AWS SSM
- Does not deploy MUNET — Amplify CI does
- Does not touch MUNET DynamoDB — Lambda handlers do
- Does not have Cognito admin in MUNET prod — Santiago + Sebas do

### 12.3 What v2 DOES do (via Phase 9-11 generic surfaces)

- Runs MUNET pipeline on VPS when dispatched (Phase 11)
- Triages MUNET Sentry errors (Phase 9, if/when MUNET has a Sentry project — verify)
- Dashboard surface (Phase 6) could show MUNET deploy status as a card (P1 nice-to-have)
- Auto-PR for MUNET fixes when sentry-event handler fires (Phase 10)

### 12.4 Open question: does MUNET have a Sentry project?

Memory + repo introspection: **no Sentry config found in clients/munet-web/.** MUNET ships without error tracking today. Either:
- A) Santiago adds Sentry to MUNET at MVP — v2 sentry-event handler picks it up automatically at Phase 9
- B) MUNET stays without Sentry — v2 has no MUNET intersection beyond pipeline dispatch

**Recommendation: add Sentry to MUNET as a separate `/iago-fast` task before MVP go-live, regardless of v2 daemon.** Reasoning: production-grade observability is non-negotiable; not a v2-coupled decision.

### 12.5 Acceptance for "v2 + MUNET integration works"

(Tested at Phase 11 close; Phase 9 close for sentry-handler dimension):

- `/iago-execute munet-web-feature` from Telegram → pipeline runs on VPS → PR opens on bas-labs/munet-web → @claude tagged
- If MUNET Sentry project exists at Phase 9, simulated Sentry error → fix-agent dispatches → PR opens for MUNET → Santiago merges
- Dashboard shows MUNET pipeline runs separately from iago-os runs (per-org filter, §8)
- v2 has zero direct write access to MUNET prod AWS account (verify: VPS has no AWS credentials for account 851725296610)
- Sebas's MUNET work continues via Cursor + local sandbox unchanged — v2 doesn't disrupt

**Santiago decision needed:** Add Sentry to MUNET before MVP? **Default recommended:** yes — `/iago-fast` task this week, ahead of v2 Phase 9. Decouples MUNET observability from v2 schedule.

---

## 13. Garry-impressed gap audit

The exhaustive "what's actually unfinished" inventory. Walks current Phase 1 mid-flight + master prompt acceptance criteria + Garry checklist.

### 13.1 In-PR gaps (must fix before merging the 6 open PRs)

The 6 open PRs (#41-#46) are all Phase 1 plans 02-07. Status: Validate workflows green, but no @claude review tagged yet, no merge.

| PR | Plan | Gaps identified (per stress test forward-lists + my read) |
|---|---|---|
| #41 (file-bus + session-log) | 02 | Verify: atomicRename helper exported + used by 03/05/06/07. Verify: replay HWM two-phase pause/resume tested. |
| #42 (agent-manager + heartbeat + markers) | 03 | Verify: lastStatusChangeMs reset on restart (EC2 from stress). Verify: heartbeat-double-restart guard via generation token (ADR § Shape 2/3 patterns). Verify: subagent spawn parent-child cost-rollup (master prompt requirement). |
| #43 (Shape 1 PTY claude-pty adapter) | 04 | Verify: version pinning (claude 2.1.113+ pinned per stress P04). Verify: golden prompt/status transcript present. Verify: fail-closed on unknown parse. **Critical: verify costTap() implemented per §5 — this is THE place to emit Anthropic spend events.** |
| #44 (IPC server + telemetry) | 05 | Already merged-style note in summary; verify socket unlink on startup (stress note). |
| #45 (Telegram approval handshake) | 06 | Verify per-agent file-bus tagging (`<agentId>__<taskId>.json` form). Verify: chatId env var or fallback to allowedUserIds[0] (PR2 stress). Verify: validateAgentId() helper. |
| #46 (hello-world acceptance gate) | 07 | Verify all of §0.6 crash recovery contract works. Verify: SIGINT during spawn doesn't leak PTY (EC1). Verify: startup-cleanup sequence (EC2). Verify: integration test passes. Verify: PHASE-1-EVIDENCE.md filled with real evidence, not template. Verify: biome check . runs in build gate. |

**Action:** Santiago should tag @claude on each PR (auto-fix loop) OR run `/iago-prfix` to fix locally. Master prompt says all 6 PRs need merging before Phase 2 starts.

### 13.2 Phase 1b — May-12 punch list (4 items, 3d, parallel to Phase 1)

Per master prompt § Phase 1b. Not yet started.

| Item | Acceptance |
|---|---|
| 1. `CLAUDE_CODE_SESSION_ID` instrumentation | Pipeline injects UUID per invocation; telemetry NDJSON carries it; dashboard uses it as join key |
| 2. Fix learnings system write path | `scripts/learnings-extract.sh` writes to `.iago/learnings/patterns.md`; verifiable via 1 manual run |
| 3. Fix `/iago-execute` Step 3 dirty-branch guard | Pipeline detects dirty working tree before impl session, refuses to run; tested with synthetic dirty branch |
| 4. Fix Claude adversarial fallback false-clean parser | Test: synthetic "BLOCK" response from fallback parser correctly surfaces as findings, not "clean" |

**Recommendation:** ship Phase 1b as 4 separate `/iago-fast` PRs in parallel with Phase 2 work. Don't bundle with Phase 1 daemon PRs.

### 13.3 Phase 2 (VPS install alongside OpenClaw) — concrete acceptance

Per master prompt: "VPS install alongside OpenClaw, one workflow migrated, no OpenClaw impact." 2-3d.

| Gap to close | Spec |
|---|---|
| systemd unit file | `iago-os-v2-daemon.service` with `LoadCredential=` for 3 Anthropic profiles + Telegram token + future webhook secrets. `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, `ProtectHome=true`. |
| Persistent Tailscale ACL | Replace check-mode SSH auth with persistent ACL OR SSH key for ilsantino user (per audit § Tailscale SSH note) |
| Multi-account Anthropic auth migration (§2) | Profile schema + initial mapping deployed |
| Cron migration sub-task (§4) | Inventory + per-entry triage written |
| First real workflow (PR triage agent per §1) | Running for 7 days clean |
| `runtime/migration/02-vps-install.md` | Document install steps + rollback (`systemctl stop`, archive state, reinstall OpenClaw priority) |
| TRIGGER-WATCH.md for cost ledger (§5) | Written |
| Daemon SIGHUP handler for credential reload (§2) | Implemented + tested |
| Pipeline bug fixes (FAIL-regex, Codex wrong-cwd) | Shipped via `/iago-fast` BEFORE Phase 11, per §11 |

### 13.4 Phase 3 (Shape expansion) — concrete acceptance

7-10d. Shape 1 (codex/gemini/opencode) + Shape 2 (anthropic/openai SDK) + Shape 3 (hermes-mcp).

| Gap | Detail |
|---|---|
| codex-pty adapter | Version pinning + golden transcripts (per Plan 04 pattern); test cohabits with claude-pty |
| gemini-pty adapter | Open question: does Gemini ship a CLI? If not, API-backed pseudo-PTY |
| opencode-pty adapter | sst/opencode wrapper; same shape contract |
| anthropic-sdk adapter | Shape 2 semantics: idempotency keys, generation tokens, AbortController, costTap |
| openai-sdk adapter | Same; also enables LangGraph host scripts |
| hermes-mcp adapter | Shape 3 semantics: per-request deadlines, restart fencing on hang |
| Cross-shape task fairness mechanism (Open Q11) | Per-shape claim quotas OR weighted-fair-queueing — decide at Phase 3 |
| HTTP-shape auth integration (§2) | adapters resolve credentials via `process.env.CREDENTIALS_DIRECTORY` |
| LangGraph hosting verification (Open Q7) | Run 1 LangGraph workflow as Shape 2 to validate pattern |

### 13.5 Phase 4 (Wedge J shell-hook matchers) — concrete acceptance

1d. Master prompt P1 item 6 — regex + timeout on hooks. Lands in daemon hook config.

| Gap | Detail |
|---|---|
| Regex matcher syntax in event-router (§9 prep) | Phase 4 ships scoped lifecycle automation (pre-edit, post-edit hooks). Phase 5 generalizes to cross-shape. |
| Timeout enforcement | Hook scripts killed at timeout; logged to telemetry |

### 13.6 Phase 5 (distiller + Hermes-deeper bundle) — concrete acceptance

4-5d. Per master prompt.

| Gap | Detail |
|---|---|
| Sliding-window summarizer | `compression.{threshold:0.50, target_ratio:0.20, protect_last_n:20}` exact Hermes semantics |
| MCP rate-limiter | Token-bucket per MCP server (budget, refill, hard-pause) |
| Cross-shape event router (§9) | 10 starter rules + YAML matcher engine |

### 13.7 Phase 6 (full Next.js dashboard) — concrete acceptance

8-10d. Per §8 above.

| Gap | Detail |
|---|---|
| Next.js scaffold inside `runtime/dashboard/` | App Router, Tailwind v4, ShadCN/UI per iaGO conventions |
| All P0 screens (§8.1) | Render real data from IPC |
| Sebas onboarding work (§7) | Tailscale ACL + dashboard auth via node identity |
| Phone-friendly view | Works on iOS Safari at 375px width (test on actual phone) |

### 13.8 Phase 7 (OpenClaw cutover + cleanup) — concrete acceptance

1d. Per audit doc § Cutover readiness + master prompt.

| Gap | Detail |
|---|---|
| Stage D: migrate remaining workflows | Verify zero OpenClaw cron firings (per §4 migration done) |
| Stage E: archive state (30d retain) | Tarball `~/.openclaw/` per audit § Cutover readiness |
| WhatsApp token revoke | Meta Business console action — Santiago does manually |
| Telegram bot token rotate via BotFather | Santiago does manually + updates LoadCredential |
| Stop user systemd unit `openclaw-gateway.service` | `systemctl --user stop openclaw-gateway && systemctl --user disable openclaw-gateway` |
| Delete archive after 30 days | Calendar reminder; `runtime/migration/E-openclaw-removed.md` documents date |
| LanceDB retirement note (§3.5) | Written |

### 13.9 Phase 8 (cost ledger SQLite) — demand-triggered

2d. Activates per §5 trigger. Not currently triggered.

### 13.10 Phase 9 (Wedge H webhook + Shape 4) — concrete acceptance

3-4d. Per master prompt + §10 + §11.

| Gap | Detail |
|---|---|
| HMAC webhook receiver | Generic; per-source HMAC secret via LoadCredential |
| `sentry-event` adapter + Sentry MCP install | Per §10 |
| `github-event` adapter + GitHub webhooks | Per §10 |
| `cron-tick-event` adapter | Bridges cron-scheduler events into event-router (§9) |
| Burst handling | Bounded queue (1000 events), per-source concurrency limit (5 workers) per ADR § Shape 4 |
| Idempotency-key schema (Open Q9) | Lock canonical format per master prompt default recommendation |
| Event dedupe SQLite table | `replay_dedupe(idempotency_key, completed_at)` |

### 13.11 Phase 10 (auto-PR loop end-to-end) — concrete acceptance

1d. Phase 9 webhook surface + Phase 11 pipeline-on-VPS converge.

| Gap | Detail |
|---|---|
| Sentry event → file-bus task → claude-pty fix-agent → execute-pipeline.sh → PR | End-to-end test with synthetic Sentry payload |
| Test the §0.2 8-min wall-clock target | Measure; if regression, identify slow stage |

### 13.12 Phase 11 (email auto-provision + Shape 5) — concrete acceptance

2-3d. Per master prompt + §10 (SES) + §11 (pipeline-on-VPS shares supervision pattern).

| Gap | Detail |
|---|---|
| SES out of sandbox | AWS Support request |
| Subdomain catch-all MX record | `agents.iagoag.com` |
| `imap-daemon` Shape 5 adapter | IMAP poller per ADR § Shape 5 semantics (cursor persistence) |
| pipeline-runner-event Shape 4 adapter (§11) | Supervised long-lived child pattern |

### 13.13 Phase 12 (learning loop) — concrete acceptance

1d. Per master prompt.

| Gap | Detail |
|---|---|
| Pattern extraction stage in pipeline | Writes to `.iago/learnings/patterns.md` |
| 5+ occurrence threshold detector | Promotes pattern to CLAUDE.md candidate |
| Daemon-managed PR | `gh pr create` with the candidate diff |
| Event-router rule (§9 #4) | Triggers extractor on PR merge |

### 13.14 Deferred / out-of-scope for v2 (documented to prevent scope creep)

| Item | Reason | When revisited |
|---|---|---|
| Mobile-native iOS app | Telegram + dashboard sufficient | Never (out of scope) |
| Slack integration | Master prompt: only on real demand from paying client | When a client requires |
| WhatsApp re-add | Santiago dropped 2026-05-13 | Never (or never until business need) |
| Cursor IDE integration | Master prompt clarification: Cursor is Santiago's daily IDE alongside v2, not integrated into v2 | Never |
| Docker | Master prompt: systemd on VPS only | Never |
| Postgres | Master prompt: SQLite only | Never |
| Multi-tenant SaaS (internal use) | `clients/*/` separation sufficient | Never internal; consider as product line later |
| LangGraph as native runtime | Hosts as Shape 2; not replaces | If complexity surfaces |
| Linear / Jira / etc | File-bus tasks/ IS the ticketing | Never |
| Sentry replacement | Integrate WITH Sentry via MCP | Never |
| Mempalace on VPS | Per §3 stays on Santiago's box | Never unless privacy model changes |

---

## Open questions for Santiago

Prioritized. Each has a recommended default.

| # | Question | Default | Phase blocked? |
|---|---|---|---|
| 1 | Approve PR-triage agent as first real workflow (§1)? | YES | Phase 2 close |
| 2 | Approve 3-profile auth schema + initial mapping (§2)? | YES (as-stated) | Phase 2 mid |
| 3 | Confirm LanceDB retirement, not migration (§3)? | YES | Phase 7 |
| 4 | Confirm Phase 8 cost ledger stays demand-triggered (§5)? | YES | None — already deferred |
| 5 | Confirm Sentria stays standalone, NOT ported to v2 Shape 5 (§6)? | YES (override master prompt default) | Phase 11 |
| 6 | Confirm Sebas joins at Phase 6 (§7)? | YES | Phase 6 |
| 7 | Approve dashboard P0/P1/P2 split (§8)? | YES | Phase 6 |
| 8 | Approve 10 starter event-router rules (§9)? | YES | Phase 5 |
| 9 | Approve Sentry Developer (free) tier (§10)? | YES | Phase 9 |
| 10 | Confirm Phase 11 placement for pipeline-on-VPS (§11)? | YES | Phase 11 |
| 11 | Add Sentry to MUNET before MVP via `/iago-fast` (§12)? | YES (decouple from v2 schedule) | None — this week |
| 12 | Ship the 6 open PRs (#41-#46) — Santiago tag @claude OR run `/iago-prfix`? | Run `/iago-prfix` per PR | Phase 1 close — BLOCKING all later phases |
| 13 | Ship 4-item Phase 1b punch list as parallel `/iago-fast` PRs? | YES | Phase 2 stable |
| 14 | Lock idempotency-key schema for Shape 4 (Open Q9 from master prompt)? | Default per master prompt: derive from `sessionId + agentId + operation-sequence-number` | Phase 9 |
| 15 | Cross-shape task fairness mechanism (Open Q11 master prompt)? | Defer to Phase 3 design; instrument with monitoring first | Phase 3 |
| 16 | Cron migration triage per-entry (§4) — Santiago confirms after inventory lands? | Triage when data lands; no pre-decision possible | Phase 2 |
| 17 | SIGHUP credential-reload handler in Phase 2 (§2.5)? | YES — list in §13.3 gap | Phase 2 |
| 18 | Sentria CV blurb says "multi-agent" but code is single-bot — reconcile or accept divergence? | Accept divergence — CV is forward-looking, code ships as-is | None (orthogonal) |

---

## References

### Read in researching this doc

- `C:\Users\sanal\dev\iago-os\CLAUDE.md` — Garry standard, model routing, memory architecture, execution path
- `C:\Users\sanal\dev\iago-os\docs\specs\iago-os-v2-vision.md` (2026-05-15) — 5-layer architecture, Agent Shape Taxonomy, Phase Sequencing, OpenClaw migration stages
- `C:\Users\sanal\dev\iago-os\docs\specs\iago-os-v2-master-prompt.md` (2026-05-15) — mission, acceptance criteria, Garry checklist, phased sequencing table
- `C:\Users\sanal\dev\iago-os\.iago\decisions\2026-05-15-agent-shape-taxonomy.md` — ADR, interface contract, per-shape semantics, HTTP auth decision
- `C:\Users\sanal\dev\iago-os\runtime\migration\00-vps-audit.md` (2026-05-13, amended 2026-05-15) — VPS state + active OpenClaw dependencies + cutover readiness
- `C:\Users\sanal\dev\iago-os\.iago\research\2026-05-13-multi-agent-cohabitation.md` (with 2026-05-15 amendment header) — cortextOS/Hermes/Paperclip primitives
- `C:\Users\sanal\dev\iago-os\.iago\STATE.md` — current Phase 1 status
- `C:\Users\sanal\dev\iago-os\.iago\plans\feature-v2-phase-1-daemon\CONTEXT.md` + plans 01-07 — Phase 1 plan stack with stress notes
- `C:\Users\sanal\dev\iago-os\.iago\plans\feature-v2-phase-1-daemon\06-telegram-approval-handshake.md` — Telegram contract
- `C:\Users\sanal\dev\iago-os\.iago\plans\feature-v2-phase-1-daemon\07-hello-world-integration-and-rollback.md` — acceptance gate
- `C:\Users\sanal\dev\iago-os\runtime\CONTEXT.md` — broader v2 daemon umbrella
- `C:\Users\sanal\dev\iago-os\runtime\package.json` — current runtime deps
- `C:\Users\sanal\dev\iago-os\runtime\daemon\` + `agent-runtime\` + `telegram\` directory listings
- `C:\Users\sanal\dev\iago-os\.iago\summaries\05-ipc-server-and-telemetry.md` — most recent pipeline summary
- `C:\Users\sanal\dev\iago-os\scripts\execute-pipeline.sh` (lines 1-80) — for Windows-vs-Linux portability analysis (§11)
- `C:\Users\sanal\dev\iago-os\clients\sentria\CLAUDE.md` — Sentria architecture (§6)
- `C:\Users\sanal\.claude\projects\C--Users-sanal-dev-iago-os\memory\project_mempalace.md` — MemPalace state (§3)
- `C:\Users\sanal\.claude\projects\C--Users-sanal-dev-iago-os\memory\project_sentria.md` — Sentria details (§6)
- `C:\Users\sanal\.claude\projects\C--Users-sanal-dev-iago-os\memory\project_iago_v2_vision.md` — vision lock
- `C:\Users\sanal\.claude\projects\C--Users-sanal-dev-iago-os\memory\project_munet.md` + `project_munet_mvp_scope.md` — MUNET context (§12)
- `C:\Users\sanal\.claude\projects\C--Users-sanal-dev-iago-os\memory\project_iago_workspaces.md` — workspaces decoupling

### Tool-derived data

- `gh pr list` — 6 open PRs (#41-#46) all Phase 1 plans 02-07, all Validate checks green
- `git log` (recent) — PR #40 merged 2026-05-16 (Plan 01 scaffolding), PR #39 merged 2026-05-15 (Agent Shape Taxonomy docs)
- Tailscale status — VPS srv1456441 reachable; Tailscale SSH check-mode active (blocks scriptable SSH; needs persistent ACL per §7 + §13.3)
- VPS read-only introspection attempted via `tailscale ssh` — BLOCKED by interactive browser-auth prompt (per audit doc § Tailscale SSH note; persistent ACL or SSH key needed before Phase 2 automation). Existing audit doc data (2026-05-13/15) used as authoritative source.
- Repo introspection — no Sentry config in `clients/munet-web/`; Sentria is Lambda-based (no daemon shape today); 4 clients in iaGO mono-repo (munet-web, sentria, din, fulldata, palazuelos, rsf, hermes); `runtime/` has daemon/ + agent-runtime/ + telegram/ subdirs from Plan 04/05/06 implementations

### External docs that will be needed in future phases

- Sentry MCP install: `https://mcp.sentry.dev/mcp` per master prompt (verify URL valid at Phase 9)
- GitHub webhook docs: `https://docs.github.com/en/webhooks` (verify HMAC SHA-256 spec at Phase 9)
- Google Workspace MCP (community): `mcp-google-workspace` Python package (verify license + last-update at Phase 11)
- AWS SES sandbox-to-prod: AWS Support ticket path (24-48h SLA, no API)
- Tailscale ACL config: `https://login.tailscale.com/admin/acls` (Phase 6 multi-user prep)

---

## Recommended action sequence

Concrete sequenced plan from now (2026-05-16) through Phase 12, with parallelism noted.

### Immediate (this week, 2026-W20)

```
PARALLEL TRACK A — ship Phase 1 PRs:
  Day 1-2: /iago-prfix on PRs #41-#46 in order (or tag @claude)
  Day 3:   merge clean, verify hello-world acceptance gate
  Day 3:   write session digest to Obsidian sessions/2026-05-XX-iago-os-v2-phase-1.md
  Day 3:   update STATE.md with Phase 1 complete

PARALLEL TRACK B — Phase 1b punch list (independent):
  /iago-fast 1: CLAUDE_CODE_SESSION_ID instrumentation
  /iago-fast 2: learnings system write path fix
  /iago-fast 3: dirty-branch guard
  /iago-fast 4: fallback parser fix

PARALLEL TRACK C — orthogonal fixes (independent):
  /iago-fast 5: add Sentry to MUNET (§12)
  /iago-fast 6: fix pipeline FAIL-regex bug (per memory:project_pipeline_bugs)
  /iago-fast 7: fix Codex stage 4 wrong-cwd bug
```

### Week 2026-W21 (Phase 2)

```
Day 1:    Tailscale persistent ACL setup
Day 1:    systemd unit file authored + LoadCredential= secrets provisioned (3 profiles + Telegram + future webhook secrets)
Day 2:    Daemon SIGHUP credential-reload handler
Day 2:    VPS install: deploy daemon, run alongside OpenClaw
Day 3:    Run cron inventory sub-task (§4); produce runtime/migration/01-cron-migration.md
Day 3:    Multi-account Anthropic auth migration (§2) — auth-profiles.json deployed, per-org defaults written
Day 4:    Deploy PR-triage agent (§1) — runs daily 14:00 UTC
Day 5-7:  Observe PR-triage for 7 days; verify acceptance gate hits
```

### Week 2026-W22 (Phase 3 + Phase 4 parallel)

```
PARALLEL TRACK A — Phase 3 Shape expansion (7-10d):
  Codex-pty + Gemini-pty + opencode-pty adapters
  Anthropic-sdk + OpenAI-sdk adapters
  Hermes-mcp adapter
  Cross-shape task fairness instrumentation

PARALLEL TRACK B — Phase 4 shell-hook matchers (1d):
  Wedge J implementation
```

### Weeks 2026-W23-W24 (Phase 5 + Phase 6 parallel)

```
PARALLEL TRACK A — Phase 5 Hermes-deeper bundle (4-5d):
  Distiller + compression-threshold + MCP rate-limiter + cross-shape event router with 10 starter rules

PARALLEL TRACK B — Phase 6 Next.js dashboard (8-10d):
  All P0 screens (fleet, per-agent, cost, approvals, pipeline-runs)
  Sebas Tailscale onboarding
  Dashboard auth via node identity
```

### Week 2026-W25 (Phase 7 cutover)

```
Day 1: Verify all OpenClaw workflows migrated or retired
Day 1: Sebas confirms dashboard access on Mac
Day 2: Stop OpenClaw user systemd unit; archive ~/.openclaw/ to tarball
Day 2: Revoke WhatsApp + Meta Business webhook (Santiago manual)
Day 2: Rotate Telegram bot token via BotFather
Day 3: Smoke-test full v2 standalone for 24h
Day 30 from cutover: delete OpenClaw archive
```

### Weeks 2026-W26+ (Phase 9 + 10 + 11 + 12 demand-triggered)

```
Phase 9 (3-4d) when Sentry MCP demand surfaces:
  Webhook receiver + HMAC + sentry-event + github-event + cron-tick-event adapters
  Burst handling + idempotency schema

Phase 10 (1d) immediately after Phase 9:
  Auto-PR loop end-to-end test

Phase 11 (2-3d) — high value, can land soon after Phase 9:
  SES sandbox-to-prod request (24-48h wait — fire on Phase 7 day to overlap)
  Subdomain catch-all
  imap-daemon Shape 5 adapter
  pipeline-runner-event Shape 4 adapter (§11)

Phase 12 (1d):
  Learning loop pattern extraction + auto-promotion PR

Phase 8 (2d) — demand-triggered ONLY:
  Lands when TRIGGER-WATCH.md condition fires
```

### Cumulative wall-clock estimate

- Phase 1 close + Phase 1b: 1 week (W20)
- Phase 2: 1 week (W21)
- Phase 3 + Phase 4: 1.5 weeks (W22-W23 early)
- Phase 5 + Phase 6: 2 weeks (W23-W24)
- Phase 7 cutover: 1 week (W25)
- Phase 9 + 10 + 11: 1.5 weeks (W26-W27 if started immediately post-cutover)
- Phase 12: 0.5 week
- Phase 8: 0.5 week if/when triggered

**Operational v2 (Phases 0-7 + 9-11): ~8 weeks from 2026-05-16.** Lands operationally around 2026-07-15. Matches master prompt § Phased Sequencing estimate (38-46 dev-days).

### Risk-adjusted view

- **Highest schedule risk:** Phase 6 Next.js dashboard (8-10d range). Next.js + Tailwind v4 + ShadCN + IPC binding has unknowns. If it blows out, P1 screens cut to P2.
- **Highest blast-radius risk:** Phase 7 cutover. Mitigation = 30-day OpenClaw archive retention + tested rollback path.
- **Highest schedule-overlap risk:** Phase 3 (7-10d) running parallel to Phase 4 (1d) is safe; Phase 5 + Phase 6 parallel is the stretch — both touch daemon internals + UI. Mitigation = serial if conflicts surface.
- **Lowest risk:** Phase 1b punch-list parallel to Phase 2 — entirely independent codebases.

---

End of operational migration scope.
