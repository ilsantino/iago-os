# Spec: iago-os Vision (Phase 0.2 Brainstorming Output)

_Date: 2026-04-28 | Inputs: `.iago/research/team-1` through `team-5` + `_summary.md` | Supersedes: `docs/specs/hermes-agent-adoption.md` (downgraded to research artifact) | Next stage: 0.3 council pass._

---

## Problem

iago-os has the strongest review pipeline in the comparable agent-tool set (T4 confirms no direct competitor) but is shipping operator-UX behind Hermes Agent on lifecycle hooks, autonomous gating, and rollback safety. The 9-wedge Hermes-adoption spec drafted on 2026-04-27 has two specific defects (T1: Wedges E/G blocked by missing native API; T3: Wedge I already 97% solved by accident) and is missing two high-leverage patterns that Hermes shipped in v0.11.0 (T2: shell-hook matchers, pre-LLM cron wake gate) and one rollback-safety pattern from a competitor (T4: Cline checkpoints). Without correction, the next 6 weeks burn on wedges with the wrong scope.

## Solution

Final 6-week wedge set = **9 wedges, not 12**. Drop 2 (I, E), defer 1 (G), keep 6 (A shipped + B/C/D/F/H enhanced), add 3 (J, K, L). All decisions justified by Team findings cited inline.

---

## Vision Statement

iago-os is the opinionated agency-delivery layer on top of Claude Code. It competes with Hermes Agent by closing the operator-UX gap (lifecycle hooks, autonomous gating, rollback safety) while preserving its review/audit moat (cross-model adversarial Codex gate, severity floors, 5-layer memory, hub-and-spoke agents). It is **not** a Hermes clone — Hermes optimizes for research-loop workflows; iago-os ships client deliverables. It is **not** a Cursor/Aider competitor (T4: those are IDEs, not delivery governance). It is **not** a Devin/OpenHands replacement (T4: those replace developers; iago-os augments a 3-person consultancy).

The 12-month direction is to make every iago-os pipeline run cheaper, faster, and more auditable per dollar of LLM spend, while staying on Claude Code (no SaaS additions) and maintaining the hub-and-spoke discipline that keeps the agent system tractable for a 3-person team.

---

## Capability Inventory (the moat — preserve and defend)

Per Team 5 internal scan, the existing moat is three compounding capabilities. None of these can be replicated in <3 months by any competitor in T4's comparison set (Aider, Cursor, Continue.dev, AutoGen, CrewAI, Devin, Sweep, Cline, OpenHands).

| # | Capability | Evidence | At-risk if neglected? |
|---|------------|----------|------------------------|
| 1 | **9-stage automated review pipeline** with severity floors and local fix loops | `scripts/execute-pipeline.sh` (959 lines, T5); 10 summaries in `.iago/summaries/`; PRs #11–#15 audit phase | Yes — pipeline correctness bugs (FAIL-regex, Codex cwd misfire) erode the moat if left unpatched (T5 mess list) |
| 2 | **Cross-model adversarial gate** (Codex/GPT-5.5 mandatory at stage 4) | `codex-companion.mjs`; cwd-misfire sanity check; structured P0/P1/P2 findings (T5) | Yes — recurrence of cwd misfire in PR #26 (despite PR #21 fix) signals the gate is fragile |
| 3 | **5-layer memory architecture** with frozen-snapshot rule | MEMORY.md + Obsidian + Graphify + MemPalace + MarkItDown (T5); auto-write hooks for diary + nightly graph rebuild | No — actively maintained, well-documented |

Pattern matrix from T4 confirms uniqueness: of 14 patterns checked across 9 competitors + iago-os, only iago-os has multi-stage pipeline + automated adversarial review + cross-model review + build gate + persistent multi-layer memory + skill catalog + multi-client discipline + stack opinions.

---

## Gap Analysis (justified by team findings)

### Gaps that become wedges (3 new + 4 enhanced)

| Gap | Source | Wedge | Effort | Replication confidence |
|-----|--------|-------|--------|------------------------|
| No regex-scoped lifecycle hooks (cannot say "before Edit to amplify/data/, run schema-validate.sh") | T2 P1 (Hermes v0.11.0 `hooks.<event>[].matcher`) | **J — Shell-hook matchers** | S (~0.5d) | HIGH (config extension to existing Claude Code hooks) |
| No rollback primitive in pipeline; Codex flags rollback safety repeatedly | T4 (Cline checkpoint/snapshot system); T5 mess (cwd misfire recurrence implies rollback-safety gap) | **K — Pre-stage pipeline checkpoints** | M (~1–2d) | HIGH (pure git plumbing) |
| Review rules embedded in shell prompt blocks; not diffable, not client-customizable | T4 (Continue.dev `.continue/checks/*.md` pattern); T5 (we are 80% there with `scripts/review-checks/*.md`) | **L — Externalize review-checks to `.iago/checks/*.md`** | S–M (~1d) | HIGH (already partial) |
| No session-compression between pipeline stages; long impl runs accumulate context unbounded | T2 P3 (Hermes compression config); T5 gap 1 | **B (enhance)** — fold compression-config recommendations | S (~0.5d) | MEDIUM |
| `[SILENT]` token is post-LLM; cron jobs always pay for inference even on no-op runs | T2 P5 (Hermes wakeAgent gate is pre-LLM) | **C (enhance)** — add `--wake-check` + `--allowed-tools` passthrough | S (~0.5d) | HIGH |
| MCP servers can sample LLMs without caps; cost/safety risk | T2 P6 (Hermes per-MCP `max_tokens_cap`/`max_rpm`) | **D (enhance)** — document recommended caps for our 5 servers | S (~0.5d, doc-only) | LOW for native enforcement (Claude Code lacks API); MEDIUM for ops constraint |
| Webhook spec lacks zero-compute push mode | T2 (Hermes v0.11.0 direct-delivery) | **H (enhance)** — add direct-delivery branch alongside HMAC subscription | S (~0.5d) | HIGH |

### Gaps that DO NOT become wedges (per cap)

| Gap | Source | Disposition | Justification |
|-----|--------|-------------|---------------|
| No native skill-catalog filter API | T1 (definitive: NO API) | **DROP Wedge E** — replace with two zero-cost moves: (1) document `paths` glob in skill frontmatter for path-scoped activation; (2) `UserPromptSubmit` hook returning advisory `additionalContext` hint about relevant skills | T1 says native filtering does not exist; the only "wedge-shaped" alternative is an MCP meta-tool rewrite that loses `/skill-name` slash invocation — bad tradeoff for a 3-person team. The two zero-cost moves capture 60% of the value at 5% of the cost. |
| No native skill-body progressive disclosure | T1 (partial: `disable-model-invocation` + `user-invocable` exist) | **DEFER Wedge G** — park with revisit trigger: (a) ship the 5-min audit adding `disable-model-invocation: true` to user-invoked-only skills; (b) revisit when Anthropic ships `disabledSkills` setting (GitHub Issue #43928) or MCP Tool Search extends to skills | Native partial coverage exists; full-fidelity progressive-disclosure costs 12–16h MCP server work for a benefit that mostly accrues at >100 skills (we have 36 — T5). |
| Skill frontmatter not strict agentskills.io | T3 (we are 97% compliant; 7 files have non-standard fields tolerated by all runtimes) | **DROP Wedge I** — replace with: (a) opportunistic 20-min metadata move when touching the 7 files; (b) 10-min `compatibility:` field add to ~10 Claude Code-specific skills | T3: zero external publishing path, zero portability need, zero observable benefit. Sprint would burn time on a problem that does not exist. |
| Plan-status visibility across multi-plan phases | T4 (Cursor Plans→Tasks→Stages) | **DEFER Wedge M** — revisit when running 3+ parallel plans regularly (we currently run 1–2) | Cosmetic dashboard; STATE.md as flat digest is sufficient at current scale. |
| Cross-client trajectory ingestion (read past summaries before planning new work) | T4 (Devin trajectory model) | **DEFER Wedge N** — revisit when ≥3 summaries exist on same client project (currently zero have that depth) | Premature; needs corpus first. |
| Architect/editor model split | T4 (Aider) | NOT A WEDGE — already implicit in pipeline (stress test = opus, impl = opus, distinct sessions) | Refactor opportunity at most. |

### Gaps that are CLEANUP, not wedges (Phase 1)

Per the digest, these run in Phase 1 (structural cleanup) using the MWP playbook method, not in this wedge set. Listed here because the council needs to know they are blocking the next pipeline run on `munet-web`:

- Codex stage 4 wrong-cwd misfire RECURRED in PR #26 despite PR #21 fix (T5 mess #5; MEMORY.md `project_pipeline_bugs`). **Patch standalone before Phase 1 wedge work begins.**
- Pipeline FAIL-regex per-line bug (T5 mess #5).
- macOS `timeout` incompatibility blocks Sebas (T5 mess #1).
- Plans/folder grouping inconsistency (T5 mess #4).
- STATE.md stale + over 80-line cap (T5 mess #5, #11).
- 18 branches (~7 stale), embedded git repo in `docs/research/_drop-2026-04-22/`, log artifacts in `.iago/` root (digest known mess).
- Local main diverged from origin/main (T5 mess #2).

---

## Options Considered

| Option | Drop | Defer | Add | Why not |
|--------|------|-------|-----|---------|
| **A — recommended** | I, E | G, M, N | J, K, L | Hits cap exactly. Each Add has HIGH replication confidence and a directly cited Team finding. |
| B — heavier prune | I, E, G | M, N | J, K, L | Violates max-2 removed cap. G has partial native value (`disable-model-invocation` audit) — drop is over-aggressive given T1's "YELLOW" feasibility verdict. |
| C — conservative add | I, E | G, L, M, N | J, K | Skips L. Saves ~1d but leaves review rules opaque to clients; per-client overrides remain blocked. The 80%-already-done state of L makes it the cheapest of the three Adds — wrong one to drop. |
| D — alternative third Add | I, E | G, L, N | J, K, M | M is cosmetic at our scale (1–2 parallel plans). L delivers per-client review-rule capability; M delivers a status table. L wins on capability/effort ratio. |

**Recommendation: Option A.** Defended below.

---

## Recommended Wedge Sequence

Wedges sequenced by dependency + risk-burndown order. Each line: ID — name — effort — depends on — primary justification.

```
Phase 1 (cleanup, blocks all wedge work) — see Cleanup section above
   │
   ├── PR-A standalone — Codex cwd misfire patch (BLOCKING)
   │
   ▼
Wave 1 (independent, parallel-safe via worktrees)
   │
   ├── Wedge J — shell-hook matchers — S (~0.5d) — depends on Phase 1
   │     T2 P1 — extend settings.json hooks with regex matcher + timeout
   │
   ├── Wedge B — distiller (with compression-config enhancement) — M (~2d) — depends on Phase 1
   │     T2 P3 + T5 gap 1 — structured stage summaries + auto-compress safety valve
   │
   └── Wedge C — cron + [SILENT] (with wake-gate enhancement) — M (~2d) — depends on Phase 1
         T2 P5 — pre-LLM wake gate + per-job toolset limit; cheaper than current spec
   │
   ▼
Wave 2 (depends on Wave 1 review-loop polish)
   │
   ├── Wedge K — pre-stage pipeline checkpoints — M (~2d) — depends on Wedge B
   │     T4 (Cline) — addresses Codex-flagged rollback-safety findings
   │
   ├── Wedge L — externalize review-checks to .iago/checks/*.md — S–M (~1d) — depends on Phase 1
   │     T4 (Continue.dev) — already 80% done; finishes the externalization
   │
   └── Wedge D — memory provider (with MCP sampling caps doc) — M (~2d) — depends on Phase 1
         T2 P6 — document recommended caps; native enforcement waits on Anthropic
   │
   ▼
Wave 3 (gateway + observability)
   │
   ├── Wedge H — webhook + HMAC (with direct-delivery enhancement) — M (~3d) — depends on Wedge J
   │     T2 P-update — direct-delivery for zero-compute push notifications
   │
   └── Wedge F — Telegram gateway (Telegram only, NOT 17-platform sprawl) — L (~5d) — depends on Wedge H
         T2 — counter-pattern noted: avoid Hermes's 17-platform sprawl (per-platform cost outweighs value)
   │
   ▼
Continuous (no wave)
   │
   └── 5-min audits / opportunistic moves
         - Wedge I replacement: `compatibility:` field add to ~10 Claude Code skills (T3)
         - Wedge G partial: `disable-model-invocation: true` audit on user-invoked-only skills (T1)
         - Wedge E partial: document `paths` glob usage + ship UserPromptSubmit advisory hint hook (T1)
```

**Total Wave 1+2 effort:** ~9–11 dev-days (excluding Phase 1 cleanup).
**Total Wave 3 effort:** ~8 dev-days.
**6-week minimum operator-UX surface:** Phase 1 cleanup + Wave 1 + Wave 2 + Wedge H. Wedge F (Telegram gateway) is the stretch goal at week 6.

---

## Why Option A Beats the Alternatives (defended)

**Why drop I, not B or D:**
T3 is the most evidence-loaded team finding in the synthesis. iago-os is already 97% compliant on the only fields that matter (`name`, `description`). The 7 files with non-standard fields are tolerated by all 35+ agentskills.io-compatible runtimes (T3 explicit). The cost-benefit math is unambiguous: zero external publishing path, zero portability need in next 6 weeks, zero observable user benefit. A wedge sprint would burn 4–8 hours producing no measurable change. Drop. Replace with a 10-minute `compatibility:` field add and a 20-minute opportunistic metadata move — both fit in margin time.

**Why drop E (not just defer):**
T1 is the most evidence-loaded team finding on the technical side. There is no native API to filter the skill catalog before injection. The two real options are (1) MCP meta-tool rewrite (8–12h, sacrifices `/skill-name` UX) or (2) `UserPromptSubmit` advisory hint hook (2h, advisory only, max 10K chars). Option 1 is a bad tradeoff — slash-invocation is core to operator UX. Option 2 is a doc + hook PR, not a wedge. So drop the wedge label and ship the doc + hook in margin time. The wedge slot is freed for J, which has clear-cut capability gain.

**Why defer G (not drop):**
T1 says G has YELLOW feasibility — `disable-model-invocation: true` and `user-invocable: false` provide partial native support. Unlike E, G has an immediate cheap win (5-min audit adding `disable-model-invocation` to user-invoked-only skills like `/iago-execute`, `/iago-fast`, `/iago-quick`, `/iago-prfix`). The full-fidelity wedge (custom MCP server for `skill_view`) costs 12–16h; benefit accrues mainly at >100 skills (we have 36 — T5). Defer with revisit trigger: when Anthropic ships GitHub Issue #43928 (`disabledSkills` setting) OR when our skill catalog crosses 80 skills, reactivate.

**Why add J:**
T2 P1 is the highest-leverage zero-runtime win in the entire team set. Regex-scoped hook matchers turn lifecycle automation from "all-or-nothing" into "per-tool-per-path." Critical for Wedge H (webhook gating per event type) and Wedge C (cron gating per script). Effort is config-extension, not new infra. HIGH replication confidence. No alternative captures this value.

**Why add K:**
T4 (Cline) provides the cleanest pattern, but the real driver is T5: Codex stage 4 wrong-cwd misfire RECURRED in PR #26 despite PR #21 fix. The pipeline currently has no rollback primitive — a fix in stage 3 that breaks stage 2 has no structured recovery path. Pre-stage `git stash create` refs cost ~2d to wire and address a recurring class of bugs. The Codex adversarial review is our moat (per T5 moat #2); rollback safety is the most-cited finding it produces. Pay the 2d.

**Why add L (instead of M or N):**
We are 80% there already (T5 confirms `scripts/review-checks/*.md` exists; just embedded in the pipeline script's prompt blocks). The remaining 20% — promoting to first-class `.iago/checks/*.md` artifacts with directory loading — is ~1d. The capability gain is real: per-client review-rule overrides (a healthcare client can drop in `.iago/checks/phi.md` without touching the pipeline). T4 explicitly notes Continue.dev's check-file pattern as the cleanest steal. M (Cursor's Plans→Tasks→Stages) is cosmetic at our 1–2 parallel-plan scale (T5). N (Devin trajectory ingestion) needs ≥3 same-project summaries to be useful (we have zero). L wins.

**Why preserve Wedge F at all (given counter-pattern flag):**
T2 explicitly counter-flags Hermes's 17-platform gateway sprawl. Wedge F stays in spec but **scoped to Telegram only**, with Slack as a future expansion vote (open question for council). Per-platform maintenance cost (policy gating, QR-code device flows, reaction-based state) is real — the Hermes pattern shows how this compounds. Stick to one channel for v1, add a second only if real iaGO client distribution demands it.

---

## 12-Month Direction

**Months 1–2 (May–June 2026):** Phase 1 cleanup → Wave 1 → Wave 2. Lock in operator-UX baseline for the next 12 months.

**Months 3–4:** Wave 3 (Webhook + Telegram). Begin feeding Codex findings into a categorized findings log to surface patterns for `.iago/checks/` evolution. Audit `disable-model-invocation:` drift quarterly.

**Months 5–8:** Re-evaluate deferred wedges. Triggers: (a) Anthropic ships `disabledSkills` setting → reactivate Wedge G full version; (b) skill catalog crosses 80 → reactivate Wedge G; (c) parallel plans cross 3 regularly → reactivate Wedge M; (d) ≥3 same-project summaries exist → reactivate Wedge N.

**Months 9–12:** Trajectory ingestion (Wedge N if reactivated) closes the loop on cross-project memory. Plan-status dashboard (Wedge M if reactivated) supports multi-client capacity. Optional: second messaging gateway (Slack) if iaGO client demand materializes.

**Always:** preserve cross-model adversarial gate, severity floors, hub-and-spoke topology, frozen-snapshot rule. These are not negotiable.

---

## Deferrable List (with revisit triggers)

| Item | Source | Revisit when |
|------|--------|--------------|
| Wedge G full version (MCP server for `skill_view`) | T1 | (a) GitHub #43928 ships `disabledSkills`, OR (b) skill catalog >80 |
| Wedge M (plan status table in STATE.md) | T4 | Running ≥3 parallel plans regularly |
| Wedge N (trajectory ingestion from `.iago/summaries/`) | T4 | ≥3 summaries exist on same client project |
| Architect/editor split (Aider pattern) | T4 | When reasoning model + editing model diverge in cost/quality |
| Slack gateway (alongside Telegram in Wedge F) | T2 counter-pattern note | Real iaGO client demands it |
| Mid-run `/steer` equivalent | T2 P4 | Anthropic exposes a runtime steering API (currently NONE) |
| MCP sampling-caps native enforcement | T2 P6 | Anthropic adds native MCP sampling caps; until then, ops constraint only |
| Hermes ACP editor-server mode | T2 counter-pattern | Never — IDE workflow, not delivery |
| Multi-platform messaging beyond Slack/Telegram | T2 counter-pattern | Never (per-platform cost outweighs agency value) |

---

## Open Questions for Stage 0.3 Council

1. **Drop count violates cap if we count G as removed.** Is "scope-reduce E + defer G" two removals, or one? Council must rule.
2. **Wedge L necessity.** Is per-client review-rule override a real iaGO need in 6 weeks, or speculative? If speculative, drop L → Option C (saves ~1d, frees a wedge slot).
3. **Wedge F scoping.** Telegram only, or Telegram + Slack from day 1? Depends on iaGO client comm distribution (council should provide signal — Santiago has the data).
4. **Codex stage 4 cwd misfire.** Standalone PR before Phase 1 cleanup, or first item in cleanup wedge? My read: standalone PR — it blocks munet-web pipeline runs and is a 1–2h fix.
5. **Wedge K rollback granularity.** Pre-stage checkpoints only, or also pre-fix-loop checkpoints (rollback within stage 3 if a fix iteration breaks an earlier finding)? Affects effort estimate (~2d → ~3d).
6. **Wave parallelization.** Run Wave 1 wedges in parallel via worktrees, or sequence them? Parallel saves ~3d but stresses the build-gate parallel-mode wedge (06) — already memory-pressured on 16GB Windows.
7. **Wedge B / Wedge K interaction.** Does the distiller compress checkpoints out of context? If so, K's restoration relies on git refs surviving; design needs explicit checkpoint-storage that distiller does not touch.
8. **Cleanup wedge (Phase 1) packaging.** One bundled cleanup PR (~13 items), or wedge-grouped cleanup (e.g., separate PRs for branch hygiene, plan-folder consolidation, STATE.md truncation)? Per `feedback_stack_prs`, stack commits on one branch → one PR is the iaGO default; council should confirm.

---

## Delivery Path

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| **Phase 0.3** (council) | 1 day | Single-pass council on this vision spec; Phase 0.5 if council says "research more" (one targeted research call, NOT full re-run) |
| **Phase 1** (cleanup) | 1 week | All 13 cleanup items shipped; PR-A standalone Codex cwd patch first |
| **Phase 2 Wave 1** (J + B + C) | 2 weeks | Shell-hook matchers shipped; distiller shipped; cron wake-gate shipped |
| **Phase 2 Wave 2** (K + L + D) | 2 weeks | Pipeline checkpoints shipped; review-checks externalized; MCP caps documented |
| **Phase 2 Wave 3** (H + F) | 1 week | Webhook + HMAC + direct-delivery shipped; Telegram gateway shipped |

Total: 6 weeks. Matches digest target.

---

## Sources cited inline

- T1 = `.iago/research/team-1-claude-code-internals.md`
- T2 = `.iago/research/team-2-hermes-state.md`
- T3 = `.iago/research/team-3-agentskills-io.md`
- T4 = `.iago/research/team-4-competitive.md`
- T5 = `.iago/research/team-5-internal.md`
- Synthesis = `.iago/research/_summary.md`
- Digest = `sessions/2026-04-28-iago-os-pipeline-speed-06.md`
- Original 9-wedge spec (now research artifact) = `docs/specs/hermes-agent-adoption.md`
