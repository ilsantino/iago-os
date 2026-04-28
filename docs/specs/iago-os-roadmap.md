# iago-os Canonical Roadmap (Phase 0.3 Council Output)

_Date: 2026-04-28 | Inputs: vision spec at `docs/specs/iago-os-vision.md` (Phase 0.2) + 5-team research at `.iago/research/team-{1-5}-*.md` + 5-advisor council with peer review (Phase 0.3) | Supersedes: `docs/specs/hermes-agent-adoption.md` (now downgraded to research artifact) | Status: CANONICAL — Phase 1 cleanup + Phase 2 wedge plans must reference this document._

---

## Council Verdict

**Adopt First Principles' reframe; execute via Executor's discipline; reject Expansionist's expansion.**

The vision's largest defect — diagnosed unanimously through 5 peer reviews — is that wedges derive from Hermes feature-gaps, not iaGO client problems. T2 (Hermes counter-patterns) and T4 (no direct competitors) make Hermes-mimicry actively wrong. But pure "wait for client to pull" stalls Monday execution. The synthesis: **keep the wedge alphabet; tie each surviving wedge to a named client trigger; cut wedges with no client trigger; harden moat before adding surface.**

Cap held STRICTER than vision: **2 added (J, K-modified), 2 removed (E, I), 4 deferred (F, G, L, M, N), 3 reframed (C, D, H).** First Principles' "client-outcome gate" is adopted as the trigger condition for cycle 2 — wedges in cycle 2 must cite a named iaGO client problem before merge.

---

## Where the Council Agreed (5/5 unanimous or 4/5)

- **Codex cwd recurrence is the foundational failure, not a wedge.** Contrarian + First Principles + Outsider + Executor + Expansionist all converged. PR #21 fix didn't hold; PR #26 regressed; PR #26 round-2 review took 8h (T5). All 5 peer reviewers reinforced. Per `feedback_diagnose_before_fix`, root-cause before patching.
- **Wedge I drop holds.** 4/5 advisors confirm; only Expansionist reverses. Peer reviews 1-5 all flagged Expansionist's reversal as the weakest call due to capacity cost. T3: 97% compliant by accident, no external publishing path.
- **Wedge K must run pre-stage only, not full checkpoint primitive.** Contrarian (MODIFY pre-stage), First Principles (pre-stage YAGNI), Executor (don't gold-plate). Vision's full primitive overshoots.
- **Wedge L lacks client justification.** Contrarian DROP, First Principles DEFER until munet/din pulls, Outsider UNCLEAR, Executor SHIP cheap. Even those who keep it scope-tie it to existing client need (First Principles: "munet PHI"). No advisor defends L on speculative grounds.
- **Wedge F (Telegram) carries no signed iaGO client demand.** Executor cuts ("22% of budget for one channel"), First Principles defers, Contrarian drops from 6w. Only Expansionist expands.
- **Plan has zero named-client outcomes.** Outsider counted: munet/din/sentria/installflow named EXACTLY ZERO TIMES in vision body. First Principles named same defect: 8 of 9 wedges Hermes counterparts, 0 client-derived.
- **22.5 dev-day budget is fragile.** Contrarian ("fantasy"), Executor (real budget 17.5 with hidden coupling), Peer Review 2 (MUNET MVP contention), Peer Review 4 (client opportunity cost).

---

## Where the Council Clashed (resolved by Chairman)

| Clash | Sides | Resolution |
|-------|-------|------------|
| **Reframe wedges client-derived** vs **ship vision-as-spec** | First Principles vs Executor | Both right: First Principles wins on unit of analysis (peer reviews 1-5 confirm); Executor wins on Monday actionability. Reframe applied to C/H/L; J/K stay infra-derived because moat hardening is precondition for client outcomes. |
| **Capacity bull case** vs **capacity bear case** | Expansionist vs Contrarian/Executor | Peer reviews 1-5 unanimously sided against Expansionist. T3 distribution thesis is correct on 12-month horizon, wrong on 6-week one. Capacity wins. |
| **Cap holds (max 3/2)** vs **cap is wrong gate** | Executor vs First Principles/Expansionist | First Principles' client-outcome gate is better instrument but unmeasured today. Executor's discipline keeps Monday actionable. **Cap stays — modified to STRICTER 2/2 — adopt client-outcome gate for cycle 2.** |
| **W1 sequential** vs **W1 parallel** | Contrarian vs vision | Contrarian wins. 16GB Windows + parallel-build wedge 06 = thrash. Sequence W1, parallelize W2. |
| **Wedge D as doc** vs **MCP server** vs **drop** | Executor vs Expansionist vs Contrarian/First Principles | Executor's 0.5d doc-only preserves the cap, costs nothing, lets MCP-server thesis prove itself in cycle 2 if D's docs see usage. |

---

## Blind Spots Caught Through Peer Review

The 5 advisors optimized scope inside a frame; the 5 peer reviewers questioned the frame. Five distinct foundation-level gaps emerged, all converging on one theme: **iago-os is being designed in isolation from the client revenue surface that funds it.**

1. **No root-cause diagnosis on the 8h Codex stall** (PR1). Codex CLI regression? Anthropic API rate? iago-os script bug? Council debated wedges on top of un-isolated foundation. Violates `feedback_diagnose_before_fix`.
2. **MUNET MVP launch contention** (PR2). 6-week wedge horizon (through ~2026-06-09) overlaps MUNET launch + post-launch incident risk. None of the advisors ran wedge-set against client-revenue contention. Honest cap may be 1 wedge, not 1.5.
3. **Operator-hours-per-week sustaining cost at week 12, 24, 52** (PR3). Every wedge adds maintenance surface. T1-T5 measured capability, not maintenance burden. 6-week build → 12-month tax on 2 people.
4. **"Do nothing on iago-os until MUNET ships" option was never on the table** (PR4). Council debated which wedges; nobody asked whether shipping ANY tooling-wedge in next 6 weeks beats client deliverables.
5. **Client-prod-incident risk when wedges become irreversible dependencies** (PR5). Frozen-snapshot exists *because* Windows bash crashed mid-run; same bug class at client-incident severity is missing from risk model.

**Council remediation:** Phase 0 includes 30-min Codex stall RCA. Cap stricter than vision. Wave 3 (week 6) is buffer — no new wedge work — to absorb MUNET contention and Codex recurrence #4. Cycle 2 explicitly gated on (a) Codex cwd holds for 30 days, (b) MUNET ships, (c) named client request triggers each next wedge.

---

## The One Thing to Do First

**Monday 2026-04-29 morning, before any wedge work, before cleanup, before Phase 1:** diagnose the 8-hour Codex stall on PR #26 round-2.

Run a 30-minute root-cause check — Codex CLI regression vs Anthropic API rate vs iago-os script bug. Per `feedback_diagnose_before_fix`, do not patch K, J, or anything else until the failure mode is isolated.

**Output:** one-paragraph diagnosis posted to `.iago/research/codex-stall-diagnosis-2026-04-28.md` with curl evidence.

THEN open `scripts/lib/codex-companion.mjs` and write the cwd regression test.

If diagnosis takes longer than 90 minutes, escalate to `/codex:rescue` for cross-model second opinion and stop the wedge plan until resolved. Foundation before scope.

---

## Phase Sequencing (canonical)

```
Phase 0 (Monday morning, half-day)        ← STANDALONE, NOT A WEDGE
   ├── Codex 8h stall RCA (30 min)         ← FIRST commit precondition
   ├── Codex cwd patch + regression test (standalone PR)
   ├── macOS `timeout` shim (scripts/lib/run-claude.sh)
   └── FAIL-regex per-line parser fix
   │
   ▼
Phase 1 (Week 1, ~3 dev-days, cleanup)     ← One bundled PR
   └── 5 highest-leverage cleanup items (NOT all 13 from T5 mess list)
       Selection criteria: blocks munet-web pipeline run OR blocks Sebas-on-Mac.
       Defer the other 8 to opportunistic margin-time.
   │
   ▼
Wave 1 (Weeks 2-3, ~4.5 dev-days, sequential)
   ├── J  shell-hook matchers              (T2 P1 — 1d, security review for regex injection)
   ├── B  distiller WITHOUT compressing K refs (T2 P3 — 2d; MUST exclude $IAGO_STAGE_CHECKPOINT_* per Q7)
   └── C  REFRAMED as client-trigger primitive  (1.5d; ties to installflow Stripe-events pattern)
   │
   ▼
Wave 2 (Weeks 4-5, ~4.5 dev-days, parallel via worktrees)
   ├── K  pre-stage gate ONLY (not full checkpoint primitive)  (2d, sequential not parallel build)
   ├── H  REFRAMED as installflow Stripe-events wedge  (2d; tied to named client)
   └── D  doc-only (0.5d, NOT MCP server, NOT aggregator)
   │
   ▼
Week 6 (BUFFER)                             ← NO new wedge work
   ├── Codex-cwd recurrence #4 absorption
   ├── MUNET incident absorption
   └── One additional cleanup batch (5 of remaining 8)

TOTAL: ~13 dev-days under 17.5-day working budget. Buffer = 4.5 days.
```

**Why Phase 0 is standalone:** four advisors and three peer reviewers identified Codex cwd as the single failure mode capable of invalidating K + J + L on top of it. Patch the foundation first.

**Why Phase 1 cleanup capped at 5 items:** Contrarian's "13 items in 1 week is laughable" lands. Selection prioritizes blockers (Sebas Mac dead-stop, FAIL-regex parser, STATE.md truncation). Other 8 (branch hygiene, embedded git repo, log artifacts, etc.) are opportunistic.

**Why Wave 1 sequential:** 16GB Windows machine + parallel-build wedge 06 already memory-pressured. Three advisors (Contrarian, First Principles, Executor) said sequence W1.

**Why Wave 2 parallel-via-worktrees:** Wave 2 wedges touch non-overlapping files (K touches `scripts/lib/build-gate.sh`, H touches new endpoint module, D touches `.claude/rules/`). Worktree isolation per `feedback_worktree_per_session`.

**Why Week 6 is buffer:** Peer Reviews 2, 4, 5 named MUNET contention + client-incident risk. Executor predicted Codex-cwd recurrence #4. Buffer is the honest budget.

---

## Final Wedge-Set Verdict (canonical table)

| Wedge | Verdict | Effort | Sequence | Justification |
|-------|---------|--------|----------|---------------|
| A | KEEP (shipped) | 0d | Done | All advisors confirm shipped state |
| **Phase 0** | **NEW (not a wedge)** | 1d | **Mon** | Codex cwd RCA + standalone PR + macOS shim + FAIL-regex; Contrarian + First Principles + Executor + Peer Reviews 1, 4, 5 |
| **Cleanup** | KEEP-reduced | 3d | Wk 1 | 5 items not 13 (Contrarian); one bundled PR per `feedback_stack_prs` |
| J | **ADD-KEEP** | 1d | Wk 2 | Shell-hook matchers; T2 P1; security review for regex injection (Contrarian's catch) |
| B | ENHANCE-MODIFY | 2d | Wk 2 | Distiller MUST exclude `$IAGO_STAGE_CHECKPOINT_*` env vars (Q7 resolved per Executor) |
| C | ENHANCE-REFRAME | 1.5d | Wk 2-3 | Reframed as client-trigger primitive (First Principles); ties to installflow Stripe-events trigger |
| K | **ADD-MODIFY** | 2d | Wk 3 | Pre-stage gate only, NOT full checkpoint primitive; sequential build not parallel on 16GB |
| H | ENHANCE-REFRAME | 2d | Wk 4 | REFRAMED as installflow Stripe-events wedge tied to named client; T3 supports |
| D | ENHANCE-MINIMIZE | 0.5d | Wk 4 | Doc-only per Executor; defer MCP-server expansion to cycle 2 conditional on usage |
| F | **DEFER** | — | Cycle 2 | No signed client demand (Executor + First Principles + Contrarian); revisit when paying client requests |
| L | **DEFER** | — | Cycle 2 | Defer until munet PHI or din requirement materializes (First Principles + Contrarian) |
| E | **DROP** | — | — | Vision drop holds; 4/5 advisors confirm |
| I | **DROP** | — | — | Vision drop holds; 4/5 advisors confirm; reverse only if cycle-2 trigger conditions met |
| G | DEFER | — | Cycle 2 | Vision defer + 5-min `disable-model-invocation` audit per Contrarian |
| M | DEFER | — | Beyond | Vision defer holds (no parallel-plan pressure yet) |
| N | DEFER | — | Beyond | Vision defer holds (no same-project corpus yet) |
| **Wk 6** | **BUFFER** | 5d | Wk 6 | Codex recurrence #4 + MUNET incident absorption + cleanup batch 2 |

**Cap honored:** 2 added (J, K-modified), 2 removed (E, I), 4 deferred, 3 reframed.

---

## Open Questions — Final Verdicts (resolving the 8 from vision)

1. **Does deferring G count toward the 2-removed cap?** No (defer is not removal). Cap honored at 2/2.
2. **Wedge L necessity — real or speculative?** Speculative. **DEFER until munet PHI or din requirement materializes.**
3. **Wedge F scoping — Telegram only or Telegram + Slack?** Neither. **Defer F until paying client demands a channel.**
4. **Codex stage 4 cwd misfire — standalone PR before Phase 1 cleanup?** YES. Standalone Monday morning, after 30-min RCA. Non-negotiable.
5. **Wedge K rollback granularity — pre-stage only?** YES. Pre-stage only. Reject pre-fix-loop (Expansionist) — YAGNI without an incident.
6. **Wave parallelization?** Sequence W1; parallelize W2 via worktrees. 16GB Windows constraint.
7. **Wedge B/K interaction — does distiller compress checkpoints out of context?** Resolved: distiller MUST exclude `$IAGO_STAGE_CHECKPOINT_*` env vars (Executor's design). Add to B spec.
8. **Cleanup wedge packaging — one bundled PR or wedge-grouped?** One bundled PR (5 items) per `feedback_stack_prs`. Items are related (pipeline correctness + portability).

---

## Cycle 2 Trigger Conditions (when to revisit deferred wedges)

| Wedge | Reactivation trigger |
|-------|----------------------|
| F (Telegram/Slack gateway) | A paying iaGO client requests a messaging channel for delivery comms |
| L (externalize review-checks) | munet PHI compliance OR din-specific review requirement materializes |
| G (progressive skill disclosure) | Skill catalog crosses 80 OR Anthropic ships GitHub #43928 (`disabledSkills` setting) |
| I (agentskills.io publish) | (a) Codex cwd holds for 30 days, AND (b) MUNET ships, AND (c) one client requests skill catalog access |
| M (plan status in STATE.md) | 3+ parallel plans running regularly (currently 1-2) |
| N (trajectory ingestion) | ≥3 summaries on same client project (currently 0) |
| D MCP-server expansion | D doc-only sees real usage and saves operator time |
| K full checkpoint primitive | Pre-stage gate proves out and a fix-loop incident demonstrates need |

---

## Invariants (must hold for plan to remain valid)

Per First Principles' load-bearing invariants:

- **Cross-model gate produces correct findings ≥95% of runs.** Currently regressing per T5 (Codex cwd recurrence). Phase 0 RCA + standalone patch must restore before Wave 1 begins.
- **No iaGO client deliverable is delayed by wedge work.** Currently unmeasured. Add to STATE.md tracking.
- **Every wedge ships an iaGO client outcome within ≤2 plan executions on a real client repo.** Currently no tie-in. C/H reframes establish initial tie-ins (installflow Stripe-events).
- **Pipeline correctness regressions detected within 1 PR cycle, not 5.** Currently failing (PR #21 → PR #26 = 5 PRs). Phase 0 patch + regression test must hold this.

If any invariant breaks during execution, halt the wave and convene Phase 0.5 (one targeted research call), not a full council re-run.

---

## What This Document Replaces

- **Supersedes:** `docs/specs/hermes-agent-adoption.md` (now downgraded to research artifact). Future wedge plans reference THIS roadmap, not the original 9-wedge spec.
- **Builds on:** `docs/specs/iago-os-vision.md` (Phase 0.2 brainstorming output). The vision spec stays as the brainstorm artifact; this roadmap is the council-modified canonical version.
- **Phase 1 cleanup spec** (`docs/specs/iago-os-cleanup.md`) and **Phase 2 wedge plans** must cite this roadmap's verdict table, sequencing, and cycle-2 trigger conditions.

---

## Sources

- `docs/specs/iago-os-vision.md` — Phase 0.2 brainstorming output
- `.iago/research/_summary.md` — Phase 0.1 synthesis
- `.iago/research/team-{1-5}-*.md` — Phase 0.1 deep-research artifacts
- `sessions/2026-04-28-iago-os-pipeline-speed-06.md` — handoff digest with bounded scope rules
- 5 advisor responses (Contrarian, First Principles, Expansionist, Outsider, Executor) — 2026-04-28
- 5 peer reviews — 2026-04-28
- Chairman synthesis — 2026-04-28
- `feedback_diagnose_before_fix`, `feedback_stack_prs`, `feedback_worktree_per_session` (MEMORY.md frozen-snapshot) — guide constraints
