# ADR — PostHog + Sentry split for v2 observability; SQLite-as-6th-layer memory

_Date: 2026-05-20 | Status: Decided | Authors: Claude (orchestrator) + Santiago direction_

---

## Context

Two questions arose 2026-05-20, one day after PR #71 merged the original four-layer Sentry-only spec:

1. **Observability tooling.** Santiago provisioned a fresh PostHog account. Question: should PostHog replace Sentry in v2, complement it, or stay out entirely? PR #71's spec assumed Sentry was the sole tool. The dual-adversarial review on that PR did not consider PostHog as an option.
2. **Memory architecture.** Santiago shared three reels describing AI memory patterns: PostHog MCP as analytics-memory, Postgres as structured SQL memory, data warehouse as centralized AI-ready storage. Question: should iago-os v2 adopt these instead of (or alongside) the current iaGO 5-layer memory system (MEMORY.md / Obsidian / Graphify / MemPalace / MarkItDown)?

Both questions were researched by parallel subagents on 2026-05-20:

- PostHog vs Sentry research: `agentId: ad8e77f2ea6f89199` (subagent: research)
- Memory patterns research: `agentId: a7b91aaf7cdbc4184` (subagent: research)
- Current v2 planning state: Explore agent (anonymous)

Each ran ~3 minutes, used WebFetch/WebSearch across posthog.com, sentry.io, letta.com, mem0.ai, zep.ai, motherduck.com, LangGraph docs, plus PostHog/Sentry comparison articles. Outputs synthesized in the conversation that preceded this ADR.

---

## Decision 1 — Observability: PostHog + Sentry split, not "all-in on either"

The original four-layer Sentry-only spec becomes a **five-layer Sentry + PostHog split**, with tools assigned by layer concern:

| Layer | Tool | Why |
|---|---|---|
| **A — Daemon error capture** (`iago-os-daemon`) | **Sentry** | Real-time `process.on('uncaughtException')` capture; `@sentry/node` auto-wraps http/fs/express/etc with breadcrumbs; structured payload that Layer D's fix-dispatch loop depends on. PostHog's `posthog-node` `captureException` works but doesn't auto-instrument to the same depth — would mean writing ~50 lines of wrappers per failure mode. For the daemon that may trigger Layer D, depth matters. |
| **B — Per-client app analytics + errors** (Munet, FullData, DIN Pro, Sentria) | **PostHog** | PostHog free tier = unlimited team + 1M events/mo + 100K exception events/mo. Sentry's developer free is **1 user only** — once Sebas joins Phase 6 we'd be forced to ~$26/mo just for client-app errors. Client apps need analytics AND errors; PostHog bundles both. The error-tracking depth gap vs Sentry is real but doesn't matter because no Layer D auto-fix dispatches off client app errors (that's deferred to D-2 in Phase 10+ anyway, and re-evaluated at that point). |
| **C — Agent MCP queries** | **Sentry MCP + PostHog MCP** | Two MCPs, no overlap. Sentry MCP for "fetch trace context for issue #42." PostHog MCP for "what did Munet cost in tokens last month?" Both gated by event ingestion in their respective layers. |
| **D — Webhook → auto-fix dispatch** (Phase 10) | **Sentry** (default; re-evaluate at impl) | Built on Sentry's structured event payload + HMAC webhook + mature issue grouping. PostHog has all three but they're younger. If by Phase 10 the gap has closed AND Layer B PostHog is running clean for 3+ months, the Layer D default may flip to consolidate on PostHog. The Phase 9 Webhook/event shape adapter is source-agnostic by design — swap cost is a different SDK + payload parser, not a Layer D redesign. |
| **E — LLM telemetry** (NEW) | **PostHog Claude Code plugin** | Only viable option. `claude plugin install posthog` + 2 env vars captures `$ai_generation` + `$ai_span` + `$ai_trace` per pipeline session. Zero VPS infra; lands on Santiago's machine today. VPS-side env vars queued for Phase 3 cred-bootstrap PR. |

**Confidence: 90%.** The dissenting 10% concentrates in Layer D — by Phase 10 PostHog may close the grouping gap, making one-tool consolidation cleaner. We commit to re-evaluating at Phase 10 impl kickoff, not before.

### What this is NOT

- **NOT "drop Sentry entirely."** Original consideration; rejected because Layer A's real-time auto-instrument depth and Layer D's mature issue grouping are both load-bearing on Sentry-specific properties. Going PostHog-only today would force writing wrappers around 5–7 failure modes AND committing to a less-mature dispatch payload for Layer D — for a token savings of $0 (Sentry FREE handles 1 user until Phase 6 anyway).
- **NOT "dual tools for every layer."** Each layer picks one tool. The split is per-concern, not per-redundancy. No layer runs both Sentry and PostHog SDKs in the same component.
- **NOT amended into Plan 01b** (cutover-locked Phase 2). Credential provisioning for both `SENTRY_DAEMON_DSN` and `POSTHOG_*` env vars lands in Phase 3 PRs alongside the Sentry Layer A SDK init, NOT retroactively pushed into the locked cutover script. Layer E plugin install on Santiago's machine is zero-VPS-infra and is independent of any Phase work.

### Cost reality at decision time (2026-05-20)

| Tool | Tier | Cost for 3 users + low event volume |
|---|---|---|
| Sentry | Developer (free) | $0 — but 1-user cap |
| Sentry | Team | $26/mo — required at 2+ users |
| PostHog | Cloud free | $0 — unlimited team, 1M events/mo, 100K exceptions |
| PostHog Claude Code plugin | Free | $0 — included in PostHog free tier |

Total monthly cost of the split, Santiago-only: **$0**. Total when Sebas joins (Phase 6): **$26/mo** (Sentry Team for Layer A + D; PostHog remains free).

### Triggers to revisit this decision

- **Sentry Team cost outweighs value** — if Phase 10 ships and Layer D auto-fix is not actually firing (low daemon-error volume in production), the $26/mo for Sentry Team may not be justified. Reconsider single-user developer plan or consolidate on PostHog at that point.
- **PostHog error grouping matures past Sentry** — track PostHog's release-notes posts on error tracking improvements. If they ship grouping + webhook parity, the Layer D consolidation case strengthens.
- **A real PII incident on PostHog** — PostHog's PII defaults are weaker than Sentry's. If Layer B has a leak, re-evaluate per-client PII denylist storage (see Open Question OQ-5 in the spec).
- **Plugin telemetry gap (Layer E)** — if Phase 3+ daemon `claude -p` sessions run long enough that `SessionEnd` doesn't fire reliably, add `posthog-node` `captureEvent` as a backup in the adapter (see OQ-7 in the spec).

---

## Decision 2 — Memory: Keep 5-layer + name SQLite session state as the 6th layer. Defer Postgres and data warehouse.

The current 5-layer iaGO memory architecture carries forward to v2 unchanged. Adding to it:

| Layer | What | Where it lives | Status |
|---|---|---|---|
| 1 — **MEMORY.md** | User prefs, feedback, project context (frozen-snapshot) | `~/.claude/projects/<slug>/memory/MEMORY.md` | ✅ existing, no change |
| 2 — **Obsidian** | Session digests, meetings, business docs | `dev/obsidian-brain/` + MCP | ✅ existing, no change |
| 3 — **Graphify** | Knowledge graph + wiki over vault | `dev/obsidian-brain/graphify-out/` + MCP | ✅ existing, no change |
| 4 — **MemPalace** | ChromaDB vector store + agent diary across 7 wings | `~/.mempalace/` + MCP | ✅ existing, no change |
| 5 — **MarkItDown** | Document conversion (DOCX/PPTX/XLSX/PDF → markdown) | global MCP | ✅ existing, no change |
| 6 — **SQLite (NEW NAMING)** | Agent session state + cost ledger + event/replay dedupe (per v2 vision § 132, 472) | VPS `/var/lib/iago-os/state/ledger.sqlite` (single DB file, multiple tables) | 📋 already planned in v2 vision; this ADR just names it as the 6th layer |

**SQLite is not a new addition — it's already planned in the v2 vision spec** ([`docs/specs/iago-os-v2-vision.md`](docs/specs/iago-os-v2-vision.md) §§ 68-69, 132, 472). The vision doc explicitly says "Not Postgres. SQLite for cost ledger + session state. JSON/JSONL for everything else (cortextOS pattern)." This ADR formalizes the existing intent and names SQLite session state as the 6th memory layer to make the addition explicit in CLAUDE.md and the memory architecture docs.

### What SQLite owns that the 5 layers don't

The single missing primitive across 1–5: **per-agent session resumption** after a daemon restart. When the v2 daemon crashes and restarts, a long-running PTY agent currently cold-starts — it has no knowledge of where it left off in its task. The 5 layers cover *content* (notes, conversations, structured business docs) but not *operational state* (last task ID, last file edited, last checkpoint, crash count).

Schema sketch (final form lands in Phase 3 PR):

```sql
-- per-agent operational state
CREATE TABLE agent_sessions (
  session_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  org TEXT NOT NULL,
  runtime_shape TEXT NOT NULL,
  last_task_id TEXT,
  last_file_edited TEXT,
  plan_checkpoint TEXT,
  crash_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- cost ledger (already planned, Phase 8)
CREATE TABLE cost_entries (
  entry_id TEXT PRIMARY KEY,
  session_id TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  ts INTEGER NOT NULL
);

-- webhook dedupe (Phase 9 + Layer D)
CREATE TABLE webhook_claims (
  source TEXT NOT NULL,
  source_event_key TEXT NOT NULL,
  attempt_window_start INTEGER NOT NULL,
  outcome TEXT,
  ts INTEGER NOT NULL,
  PRIMARY KEY (source, source_event_key, attempt_window_start)
);
```

Same DB file, three concerns. Hermes pattern (single-instance SQLite is sufficient at our scale).

### Why NOT Postgres

The Sewell reel framed Postgres as the canonical "AI memory" backend. Research confirmed real adoption (Letta, LangGraph cloud, Paperclip enterprise). But Postgres pays off when you need:

- Multi-instance writes (multiple daemons sharing state)
- Row-level locking across concurrent agents
- Managed point-in-time backups with WAL replication

iaGO v2 has none of these today: single Hostinger VPS, single daemon process, no managed-DB requirement. SQLite gives 95% of the value at 5% of the operational cost. The migration to Postgres is straightforward when triggered (same schema, swap the driver) — defer until trigger fires.

**Trigger to revisit:** (a) iago-os scales to multi-VPS daemon instances sharing agent state, OR (b) Obsidian MCP latency over Tailscale from the VPS measures consistently above ~2s for `search_notes` calls (in which case structured client data — agreements, retainers, deliverable status — should move to a VPS-local Postgres table for sub-second agent queries).

### Why NOT data warehouse (yet)

The reel showed "CRM + ERP + Web Analytics + IoT → ingest → warehouse → AI queries it." Real pattern (MotherDuck, DuckDB, ClickHouse) but for enterprise-scale data integration. iaGO's own ops do NOT have the source diversity to justify it — 5–7 client projects + Obsidian + GitHub PRs is a notes + structured facts problem, already covered.

**Trigger to revisit:** Red Sun Farms PoC (greenhouse IoT + production + ERP data, see `memory:project_rsf_relationship`). When that ships and an agent needs to query across all three systems in natural language, set up DuckDB local first (zero infra) or MotherDuck for cloud scale. This is a CLIENT deliverable architecture, not iaGO's own operational stack — treat as separate decision when RSF scope locks.

### Why NOT Zep / Graphiti (yet)

Genuinely underrated alternative. Zep's temporal knowledge graph (facts with validity windows) directly solves a real MemPalace weakness — stale embeddings co-exist with new ones, so retrieval can return outdated facts. ("MUNET retainer = $X as of date Y, superseded by $Z on date W" — Zep tracks the supersession; ChromaDB returns both as similarly-relevant.)

**Trigger to revisit:** if iaGO encounters a measurable recall failure where an agent acts on a stale fact (wrong client retainer, superseded scope) and the cost is non-trivial. Until then, Graphify entity tracking + Obsidian git history cover temporal versioning adequately.

### What MEMORY.md and CLAUDE.md need

- CLAUDE.md "Memory Architecture" table grows from 5 rows to 6 rows. Add the SQLite row.
- `feedback_memory_no_reread.md` (existing) remains correct — applies to MEMORY.md only.
- A new memory entry: `project_iago_v2_memory_sqlite.md` pointing at this ADR.

These changes do NOT need to ship now — they'll be amended naturally when the Phase 3 cred-bootstrap PR adds the SQLite schema file. This ADR just records the decision.

---

## Implementation footprint

| Change | File / artifact | Phase | Effort |
|---|---|---|---|
| Spec amendment (PostHog + Sentry split, Layer E) | `docs/specs/sentry-integration.md` | now (this PR) | done |
| ADR | `.iago/decisions/2026-05-20-posthog-sentry-split-and-memory.md` | now (this PR) | done |
| Master prompt memory section | `docs/specs/iago-os-v2-master-prompt.md` line 161 | now (this PR) | small |
| Vision doc memory section | `docs/specs/iago-os-v2-vision.md` line 337 | now (this PR) | small |
| STATE.md + MEMORY.md | both | now (this PR) | small |
| PostHog Claude Code plugin install | Santiago's machine | today (no PR) | 10 min |
| PostHog MCP install | Santiago's machine | today (no PR) | ~30 min |
| Sentry SDK in daemon (Layer A) | Phase 3 PR (NOT 01b) | Phase 3 head | ~1 day |
| Sentry credential entry in `cred-bootstrap.ts` | Phase 3 PR alongside Layer A SDK init | Phase 3 head | ~30 min as part of Layer A PR |
| PostHog Project API key + Host in client app envs (Layer B) | Phase 3 per-client PR per client | Phase 3 audit pass | ~half-day/client |
| PostHog SDK in client React + Lambda code (Layer B) | Phase 3 per-client PR | Phase 3 audit pass | ~half-day/client + ~1h glue/lambda |
| PostHog VPS env vars in `cred-bootstrap.ts` (Layer E + future VPS-side LLM telemetry) | Phase 3 PR alongside Layer A SDK init | Phase 3 head | ~15 min as part of Layer A PR |
| SQLite `agent_sessions` schema | Phase 3 PR (alongside cost-ledger work) | Phase 3 / Phase 8 | ~half-day |

No retroactive changes to Plan 01a, 01b, 02a, 02b, 03a, 03b, 04a, 04b, 05a, 05b, 06, 07a, 07b. The Phase 2 cutover (Sunday 2026-05-25) is not affected.

---

## Stress test (inline)

I ran the verdict through 5 adversarial probes before recording it:

1. **"Two SDKs in client apps is overhead."** True for components that need errors. But Layer B clients need analytics anyway — without PostHog they'd need a second tool (Mixpanel, Segment, Amplitude). PostHog bundling errors + analytics actually reduces SDK count vs Sentry-for-errors + analytics-tool-X. Net: simpler.
2. **"PostHog Claude Code plugin is post-session, so PTY crashes lose telemetry."** Confirmed real risk. Mitigations: (a) pipeline stages are short-lived (one stage per `claude -p`) so SessionEnd fires reliably; (b) the daemon's Layer A Sentry capture still catches the PTY crash itself; (c) OQ-7 in the spec flags this for Phase 3 daemon-claude-pty review with `posthog-node` `captureEvent` backup if it bites.
3. **"You're calling SQLite a 6th layer but it's not new."** Correct — SQLite was already planned in the v2 vision. Naming it as a memory layer is a documentation move, not an architectural addition. The ADR is explicit about this.
4. **"Don't you just push Sentry's spec rewrite cost to the next PR?"** Yes — Layer A still gets a Phase 3 PR for SDK init and cred provisioning, as the original Sentry-only spec already required. Layer B + Layer E add their own PRs. The amendment doesn't reduce Phase 3 work; it just reshapes it across two tools.
5. **"What about HIPAA-style data sensitivity if a client app handles PHI?"** Out of scope for current iaGO v2 surface. None of Munet, FullData, DIN Pro, Sentria handle PHI. If a future client does, healthcare-phi-compliance skill applies and PII denylist tightens (OQ-5). PostHog supports project-level PHI mode (similar to Sentry); evaluate at that client onboarding.

Verdict: PROCEED. Confidence 90% on the observability split; 95% on the memory verdict.

---

## References

- `docs/specs/sentry-integration.md` — operational embodiment of this ADR (Layers A–E)
- `docs/specs/iago-os-v2-vision.md` § 68-69, 132, 472 — pre-existing SQLite plan that this ADR formalizes as the 6th memory layer
- `docs/specs/iago-os-v2-master-prompt.md` line 161 — 5-layer memory list (updated by this PR to 5-layer + SQLite)
- `.iago/decisions/2026-05-19-three-invocation-modes.md` — three invocation modes (Layer D fixer runs in Mode 3, routes code through Mode 1)
- `memory:feedback_no_auto_merge` — no Claude-side merge; reinforces PR-only Layer D output
- `memory:project_iago_v2_vision` — v2 architecture lock 2026-05-13
- `memory:project_red_sun_farms` — trigger for future data warehouse evaluation
- Research subagents (2026-05-20): PostHog vs Sentry (`agentId: ad8e77f2ea6f89199`), memory patterns (`agentId: a7b91aaf7cdbc4184`)
