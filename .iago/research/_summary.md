# Phase 0.1 Research Synthesis — Strategic Validation

_Date: 2026-04-28 | Inputs: team-1 through team-5 artifacts in this directory | Next stage: 0.2 brainstorming on this synthesis with bounded scope (max 3 wedges added, max 2 removed)._

---

## Executive verdict (1 paragraph)

iago-os already has the strongest review pipeline in the comparable set — no competitor (Aider, Cursor, Continue, AutoGen, CrewAI, Devin, Sweep, Cline, OpenHands) ships an 8-stage pre-PR pipeline with cross-model adversarial review and a 5-layer memory architecture. The Hermes 9-wedge spec we drafted is sound in direction but has two specific defects: **Wedge I (agentskills.io) is already done** (we are 97% compliant by coincidence — drop it), and **Wedges E/G (skill filtering) are gated by a hard Claude Code limitation** with no native API to filter the catalog before injection — both must be reduced to workarounds or deferred. Hermes shipped six releases in 30 days while we were drafting the spec; the most actionable additions are **shell-hook matchers** (Wedge J) and **pre-LLM cron wake gate** (fold into Wedge C). The competitive pass identifies one strong steal — **pre-stage pipeline checkpoints** from Cline, directly addressing the rollback-safety finding Codex keeps flagging. Final recommended scope for brainstorming: drop Wedge I, scope-reduce E and G to workarounds, add 2 new wedges (J shell-hook matchers + checkpoints), keep B/C/D/F/H with documented enhancements.

---

## Wedge-by-wedge verdict (consolidated)

| Wedge | Current status | Verdict | Justification (team source) |
|-------|---------------|---------|------------------------------|
| **A** frozen-snapshot | SHIPPED #23 | KEEP, no further work | T5 confirms operational |
| **B** distiller | PROPOSED | **KEEP, ENHANCE** — add compression-config recommendations (threshold, protect_last_n); document distinction between distiller (structured learning) and auto-compression (context safety valve) | T2 P3, T5 |
| **C** cron + `[SILENT]` | PARTIAL (`/autonomous-loops`, `/iago-schedule` exist) | **KEEP, ENHANCE** — add pre-LLM wake gate (`--wake-check`), `--allowed-tools` per-job toolset; cheaper than post-LLM `[SILENT]` | T2 P5, T5 |
| **D** memory provider | PARTIAL (5 layers, no aggregator) | **KEEP, ENHANCE** — document MCP sampling caps (`max_tokens_cap`, `max_rpm`) per server; fold Continue's check-file pattern (versionable rules) into related work | T2 P6, T4, T5 |
| **E** conditional skill activation | PROPOSED | **SCOPE-REDUCE OR DROP** — Team 1: no native catalog-filter API. Three options: (a) document `paths` glob in skill frontmatter (zero cost, partial scope); (b) `UserPromptSubmit` advisory hint hook (~2h, advisory only); (c) full MCP meta-tool rewrite (8–12h, **loses `/skill-name` slash invocation**). Recommend (a)+(b) as documentation/hook work, NOT a wedge. | T1, T5 |
| **F** Telegram gateway | PROPOSED | **KEEP, SCOPED** — Telegram only. Reject Hermes's 17-platform sprawl as counter-pattern (per-channel maintenance cost outweighs agency-delivery value) | T2 counter-pattern |
| **G** progressive skill disclosure | PROPOSED | **DEFER** — Team 1: only partial native support (`disable-model-invocation`, `user-invocable`, `/skills` cmd). Recommend (a) audit and add `disable-model-invocation: true` to all skills that should be user-invoked only (5 min, zero cost), (b) watch GitHub Issue #43928 (`disabledSkills` settings field). Revisit when Anthropic ships native filtering. | T1 |
| **H** webhook + HMAC | PROPOSED | **KEEP, ENHANCE** — add Hermes v0.11.0 direct-delivery mode (LLM-bypass for zero-compute push notifications); HMAC verification stays as base requirement | T2 P-update, T5 |
| **I** agentskills.io compliance | PROPOSED | **DROP as a wedge** — Team 3: 37/37 skills already use `name`+`description` correctly; only 7 files have non-standard fields (movable to `metadata` in 20 min, opportunistic). No external publishing path = zero value sprint. Replace wedge with: 10-min `compatibility:` field add to ~10 Claude Code-specific skills. | T3 |

---

## New wedge candidates (from external + internal scan)

### **Wedge J — Shell-hook matchers** (ADD — strongest candidate)
**Source:** T2 Pattern 1 (Hermes v0.11.0)
**What:** Extend Claude Code `settings.json` hook entries with `matcher` (regex on tool name) and `timeout_seconds`. Enables fine-grained automation: "before any Edit to `amplify/data/`, run schema-validation script."
**Effort:** S (~0.5d) — pure config + small hook-runner extension.
**Why:** Zero new runtime, no SaaS dependency, directly leverages existing hooks. High leverage for Wedge H (webhook gating) and Wedge C (cron) workflows.
**Replication confidence:** HIGH. Claude Code already supports `pre_tool_call`/`post_tool_call`; adding regex matcher is thin extension.

### **Wedge K — Pre-stage pipeline checkpoints** (ADD — second strongest)
**Source:** T4 (Cline checkpoint/snapshot system)
**What:** Before each pipeline stage (stress test → implement → build gate → review → codex), capture `git stash create` ref or worktree snapshot. Store in `$IAGO_STAGE_CHECKPOINT_{n}`. If a fix in stage 3 breaks stage 2 artifacts, restore and retry differently rather than accumulating broken intermediate state.
**Effort:** M (~1–2d) — checkpoint capture in `scripts/lib/build-gate.sh` + restore in fix-retry loop.
**Why:** Directly addresses the rollback-safety finding Codex adversarial review consistently flags. iago-os pipeline currently has no rollback primitive.
**Replication confidence:** HIGH. Pure git plumbing.

### **Wedge L — Externalized review-check files** (ADD — third candidate)
**Source:** T4 (Continue.dev `.continue/checks/*.md` pattern)
**What:** Promote `scripts/review-checks/*.md` from script-internal to first-class `.iago/checks/*.md` artifacts. Already 80% there — finish the externalization. Makes rules diffable, client-customizable, independently updateable.
**Effort:** S–M (~1d) — refactor, no new logic.
**Why:** Already exists in partial form. Externalization unlocks per-client check overrides (e.g., a healthcare client adds `.iago/checks/phi.md`). Lower priority than J/K but cheap.
**Replication confidence:** HIGH. Already partial.

### Speculative (consider but recommend DEFER)
- **Wedge M — Plan stage status in STATE.md** (T4 Cursor) — Pending/In-Progress/Review/Done table. Trivial but cosmetic; defer until multi-plan dashboards become a real pain point.
- **Wedge N — Trajectory ingestion** (T4 Devin) — read `.iago/summaries/` for same-client project before planning. Useful but speculative; defer until 3+ summaries on a single project exist (none currently).
- **Architect/Editor split** (T4 Aider) — separate "stress-test reasoning" from "implementation" model routing. Already implicit in pipeline (stress test = opus, impl = opus, but distinct sessions). Cosmetic.

---

## Counter-patterns (do NOT copy)

| Pattern | Source | Why skip |
|---|---|---|
| Hermes ACP editor-server mode | T2 | IDE coding-assistant workflow; iago-os is pipeline-first, terminal-first. Adds editor coupling for zero delivery value. |
| 17-platform messaging gateway sprawl | T2 | Per-platform maintenance dwarfs agency-delivery value. Telegram + optionally Slack is correct scope. |
| Nous Tool Gateway (subscription tools) | T2 | We manage our own API keys; depending on a vendor portal is a regression. |
| Personality presets / human-delay simulation | T2 | Anti-features for a delivery pipeline (speed matters; CLAUDE.md governs behavior). |
| Mid-run `/steer` | T2 | LOW replication confidence on Windows + Claude Code CLI. Document as architectural gap; reconsider if Anthropic exposes equivalent. |
| `privacy.redact_pii` blanket strip | T2 | Project-level concern (each client has its own posture); blanket-strip would corrupt legitimate test data. |
| AutoGen/CrewAI mesh agent topology | T4 | Hub-and-spoke is intentional simplicity for a 3-person agency; mesh is overkill. |
| Sweep issue-to-PR (legacy) | T4 | Existing Linear/Slack workflow handles this; no acquisition value. |

---

## Mess to address (cleanup, not wedges)

Pulled from T5, MEMORY.md `project_pipeline_bugs`, and digest gotchas. These BLOCK Phase 1 cleanup wedge work, in priority order:

1. **Codex stage 4 wrong-cwd misfire RECURRED in PR #26** despite PR #21 fix. Verdict "approve" with "no diff provided" = not actually reviewed. **Patch before next pipeline run.**
2. **Pipeline FAIL-regex per-line bug** (documented in MEMORY.md `project_pipeline_bugs.md`). Critical — affects review verdict parsing.
3. **macOS `timeout` incompatibility** in `run_claude()` — Sebas (Mac CTO) hits this on first pipeline run. OS-detect for `gtimeout`.
4. **`.iago/plans/` inconsistency** — 5 loose `audit-*.md` + 1 `quick-*.md` mixed with 2 `feature-*/` folders. Per `feedback_plan_folder_grouping`, multi-plan work goes in `feature-{slug}/01.md, 02.md, ...`.
5. **`.iago/pipeline-wedge-06.log` (12KB) in `.iago/` root** — log artifact, not session output. Move or `.gitignore`.
6. **`docs/research/_drop-2026-04-22/` embedded git repo** (`claude-office-skills-ref`) — submodule or removal.
7. **`docs/research/munet-web-playbook.md` vs `wip/munet-web-playbook-v2`** — duplication. Reconcile.
8. **18 branches, ~7 likely stale** — prune.
9. **STATE.md = 5.9KB (~200 lines)** vs 80-line cap per CLAUDE.md. Truncate, overflow to PROJECT.md.
10. **`feature-pipeline-speed-wedges/_deferred/` (4 wedges)** — re-rank against current 8h44m baseline; promote or formally drop.
11. **Local main diverged from origin/main** — CRLF fix committed locally, same content in PR #15.
12. **STATE.md timestamp stale** (says 2026-04-13, last entries 2026-04-27).
13. **Review round 2 on PR #26 took ~8h.** Add hard timeout to `claude -p` review stage.

---

## Open questions for brainstorming (Stage 0.2)

These are the questions the bounded brainstorming session should answer:

1. **Wedge E final verdict.** Drop entirely, scope-reduce to documentation+hint-hook combo, or commit to MCP meta-tool rewrite (accepting loss of `/skill-name` UX)? My read of T1+T5 says **scope-reduce**, but it's a real call.
2. **Wedge G final verdict.** Defer (recommended) or commit to MCP server for `skills_list`/`skill_view`? T1 says ~12-16h effort with reusable cross-project benefit.
3. **Wedge K (checkpoints) priority.** Is rollback-safety the most-cited Codex finding? If yes, K is wedge #1. If no, lower priority.
4. **Wedge J (shell-hook matchers) packaging.** Standalone wedge, or fold into Wedge H plan?
5. **Cleanup vs. wedges sequencing.** Pipeline FAIL-regex + Codex cwd bugs MUST patch before next pipeline run — should they be a standalone PR before any cleanup wedge, or first item in cleanup wedge?
6. **Are wedges B + K + L sufficient, or do we also commit to M (plan-status table) and N (trajectory ingestion)?** The cap is 3 added; B/K/L use 2 of 3 (B is already in spec, just enhanced; K + L = 2 net new). Room for 1 more if compelling.
7. **Telegram vs Slack as primary gateway (Wedge F).** Telegram is current spec. Is Slack a stronger fit for client-facing comms? (Open question — depends on iaGO client distribution.)

---

## Recommended Phase 0.2 brainstorming inputs

When invoking `/brainstorming`, feed it:

- This summary (`.iago/research/_summary.md`)
- Team 1 artifact (gates Wedges E, G)
- Team 2 artifact (gates Wedge B, C, D, H enhancements + new Wedge J)
- Team 3 artifact (gates Wedge I drop)
- Team 4 artifact (gates new Wedges K, L, M, N)
- Team 5 artifact (gates internal moat assessment)

**Bounded scope (per digest):** Max 3 wedges added to current 9, max 2 wedges removed, all decisions justified by Team findings. **Recommended starting position:** Drop I, scope-reduce E (not a counted "drop" — it stays in spec as documentation/hint-hook), defer G, add J + K (+ L if budget allows).

**Output target:** `docs/specs/iago-os-vision.md`. Vision statement, capability inventory, gap analysis, 12-month direction. This becomes the input for Stage 0.3 council pass.

---

## Sources

- `.iago/research/team-1-claude-code-internals.md` — Claude Code skill-loader hooks (claude-code-guide agent)
- `.iago/research/team-2-hermes-state.md` — Hermes Agent v0.11.0 (research agent)
- `.iago/research/team-3-agentskills-io.md` — agentskills.io standard (research agent)
- `.iago/research/team-4-competitive.md` — competitive landscape (research agent)
- `.iago/research/team-5-internal.md` — iago-os internal inventory (research agent)
- `sessions/2026-04-28-iago-os-pipeline-speed-06.md` — handoff digest (Obsidian vault)
- `docs/specs/hermes-agent-adoption.md` — original 9-wedge spec (becomes research artifact post-Phase 0)
