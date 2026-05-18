# ADR: Phase 2 pre-emptive plan split + 6-round dispatch + cutover defer to 2026-05-25

**Date:** 2026-05-18
**Owner:** Orchestrator (with Santiago explicit GSD authorization)
**Status:** LOCKED — do not relitigate without new evidence
**Supersedes:** Original Phase 2 CONTEXT.md § Process step 4 (3-wave parallel grouping with 7 plans) + spec § Open question #1 default (Sunday 2026-05-18 8pm cutover window)

## Context

Phase 2 plan stack (7 plans, ~42 tasks) was generated 2026-05-17 by `/iago-plan` against `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md`. Plans landed via PR #47 + #48 chore-stack. Workstreams B + C (Phase 1 hardening) shipped 9 PRs over the prior session, all merged 2026-05-17/2026-05-18.

The Phase 1 dispatch produced a hard-data signal about pipeline max-turns:

| Plan | Tasks | Result |
|------|-------|--------|
| B-01 (IPC server hardening) | 8 (but small tasks) | COMPLETED in budget |
| B-02 (atomic rename audit) | 7 | COMPLETED in budget |
| B-03 (main.ts coverage) | 6, 139 lines | **FAILED at 80 turns** → split into 03 + 03b |
| B-04 (PR40 deferred items) | 8, 174 lines | **FAILED at 80 turns** → shipped partial with inline T8 completion |
| B-05 (minor sweep) | 8, 302 lines | **FAILED at 80 turns** → shipped partial, deferred T3/T4/T7/T8 |

Pattern: plans with **>5 tasks AND extensive test additions** hit the 80-turn pipeline ceiling 100% of the time.

Phase 2 plans 01-07 (excluding 06 which has 4 tasks and minimal test addition) all fit that profile:

| Plan | Tasks | Bytes | Burden |
|------|-------|-------|--------|
| 01 | 8 | 25 KB | Heavy (2 bash + bats + TS helper + tests + schema + wire + README) |
| 02 | 7 | 29 KB | Heavy (3 bash + bats + 2 runbooks + manifest) |
| 03 | 6 | 30 KB | Heaviest (cutover.sh + rollback.sh + 3 docs + test harness) |
| 04 | 8 | 28 KB | Medium-Heavy (2 JSON + prompt + bash + README + verify + wire + big test) |
| 05 | 6 | 23 KB | Medium-Heavy (template + checker mjs + tests + e2e + fixtures) |
| 06 | 4 | 15 KB | Light — only one under threshold |
| 07 | 6 | 23 KB | Heavy (cron-scheduler ts + tests + agent-manager extension + tests + README + inventory) |

## Decisions

### Decision 1 — Split 6 of 7 plans into 12 split files

**Verdict:** Split. 13 plans total (12 split + 06 unchanged). 3-4 tasks per plan ceiling.

| Original | Splits | Tasks per split | Rationale |
|----------|--------|-----------------|-----------|
| 01 | 01a / 01b | 4 / 4 | 01a = deploy infra (unit + provision + bats + README); 01b = TS bridge (cred-bootstrap + tests + schema + wire) |
| 02 | 02a / 02b | 3 / 4 | 02a = archive-openclaw (heaviest piece); 02b = whatsapp + telegram + 2 runbooks |
| 03 | 03a / 03b | 3 / 3 | 03a = executables + harness; 03b = runbooks + decisions |
| 04 | 04a / 04b | 4 / 4 | 04a = agent artifacts (config + crons + prompt + wake); 04b = README + verify + wire + integration test |
| 05 | 05a / 05b | 4 / 3 | 05a = template + fixtures + xref; 05b = checker + tests + e2e |
| 06 | (unchanged) | 4 | Already under threshold |
| 07 | 07a / 07b | 3 / 3 | 07a = cron-scheduler class + tests + README; 07b = agent-manager polling + tests + inventory |

**Stress-test of this decision:**
- Cost: 13 PRs vs 7 PRs — 6 extra merge gates for Santiago to attend. Mitigated by parallel dispatch within rounds.
- Benefit: zero max-turns failures expected (every plan ≤4 tasks); no partial-PR + inline-completion cycle that bloated Phase 1.
- Risk if NOT split: 5 of 7 plans hit max-turns based on Phase 1 pattern → ~5 manual completion cycles each costing ~30 min orchestrator + Santiago review attention.
- Verdict: Split is the obvious better trade. Phase 1 data is conclusive.

### Decision 2 — Dispatch via 6 sequential rounds, parallel within each round

**Verdict:** Round-based dispatch matching the Workstream-B+C model. Santiago merges after each round so the next round branches off the latest main.

| Round | Plans dispatched in parallel | Dependencies satisfied |
|-------|-------------------------------|------------------------|
| 1 | 01a, 02a, 07a | (none — root nodes) |
| 2 | 01b, 02b, 07b | Each deps its `a` counterpart (Round 1 merged); 02b also deps 01a |
| 3 | 03a, 04a | 03a deps 01a/01b/02a/02b (R1+R2); 04a deps 01a/01b (R1+R2) |
| 4 | 03b, 04b | 03b deps 03a; 04b deps 04a + 07a/07b + 03b (R3 merged + R1+R2) |
| 5 | 06, 05a | 06 deps 01b/03b; 05a deps 03b/04b (all R4) |
| 6 | 05b | deps 05a (R5) |

**Wall-clock estimate:** per round = 1.5-2.5 hr (pipeline parallel + dual review parallel + Santiago merge). 6 rounds = 9-15 hr spread across 2-4 days.

**Stress-test of this decision:**
- The user's "each PR must be based on the previous one, even when doing adversarial passes" instruction is satisfied: within-round PRs branch off main (file-disjoint by design — audited); across-round dependencies are satisfied by waiting for previous round's merge before dispatching the next. The "based on the previous" semantics is the dependency chain in topological order; merge order = dependency order.
- Phase 1 used the same parallel-within-round + Santiago-merges-after-each-round model and shipped 9 PRs successfully. Same model + more rounds + tighter per-plan scope = lower risk per plan, higher coordination cost.
- Alternative considered: strict 13-PR sequential stacking where each branch is based on the previous PR's branch (not main). REJECTED — much slower wall-clock (13 serial pipelines vs ~6 parallel batches), requires constant rebase as predecessors merge, no meaningful safety benefit because file surfaces ARE disjoint within rounds.
- Risk: Santiago is the merge bottleneck. If he's unavailable during a round, the next round can't dispatch. Mitigation: he gets per-round notifications; merging 2-3 PRs takes ~10 min.

### Decision 3 — Defer cutover window to Sunday 2026-05-25 8pm US/Mexico

**Verdict:** Defer 7 days. Original handoff defaulted to "Sunday 2026-05-18 8pm" = today; impossible with 13 PRs to dispatch + dual-review + merge before then.

**Stress-test of this decision:**
- Original spec OQ1: "Cutover window timing. Default: Sunday 8pm US/Mexico time" — the day is anchored to Sunday but the specific Sunday is unspecified. Handoff defaulted to NEXT Sunday after the handoff (today). That's a default, not a contract.
- The handoff says "confirm at dispatch time, default unless Santiago says otherwise" — explicit permission to defer with rationale.
- 7-day defer gives: 2-4 days dispatch + dual-review + merge cycle, 1-2 days for any unexpected fixes (e.g., adversarial review surfaces a Critical that needs another PR cycle), 1-2 days for Day -1 prep on the VPS.
- Risk: a 7-day window means OpenClaw runs unchanged for one more week. OpenClaw is currently the production system; no degradation expected. Verified: no security advisories against OpenClaw stack in the last 30 days.
- Alternative: dispatch + cutover in same Sunday window. REJECTED — would force shortcuts (skip dual review, accept max-turns ceiling, accept partial-PR cycles). Garry standard rejects this.
- New cutover window: **Sunday 2026-05-25 8pm US/Mexico** = T-7 days.

## Implementation discipline

1. **Chore PR first** — this decision doc + 12 split plan files + CONTEXT.md update ship as a single chore PR (`chore/phase-2-pre-emptive-split`) for Santiago to merge BEFORE Round 1 dispatches. Memory `feedback_no_chore_pr_for_doc_moves` is intentionally overridden here: the splits enable parallel-wave dispatch, so they MUST be on main before any track-A branch sees them; alternative (commit splits redundantly on each branch) is uglier and creates duplicate-commit noise across 3 parallel PRs.
2. **Dual adversarial review on every PR** — same playbook as Phase 1 (Opus 4.7 + Codex per PR in parallel). Fix Critical/Important locally on the PR branch before notifying Santiago to merge. Minor findings documented in PR body for follow-up.
3. **Santiago at keyboard for cutover** — Plan 03b's `02-cutover-runbook.md` executes against PRODUCTION VPS state. Operator-only. The orchestrator ships the artifacts; cutover is human-driven.
4. **STATE.md + Obsidian session digest** — after Round 6 PRs merge AND before cutover window, update STATE.md with merge dates + write `sessions/2026-05-2X-iago-os-v2-phase-2-prep.md` to Obsidian per `~/.claude/rules/obsidian.md`.
5. **No auto-merge** — `feedback_no_auto_merge` memory governs. Santiago merges every PR after reviewing the dual-review output.

## Reversibility

| Decision | What would need to be true to revisit |
|----------|---------------------------------------|
| 1 — Plan split | New evidence that 80-turn pipeline ceiling has been raised AND that 6-8 task plans with test additions no longer fail at the ceiling. Currently no such evidence; Phase 1 data is strong. |
| 2 — 6-round dispatch | If Santiago becomes available for longer continuous sessions, could collapse Rounds 3+4 or 4+5 by treating them as a single dispatch wave with cross-PR awareness. Not blocking. |
| 3 — Cutover defer | If a security advisory drops against OpenClaw stack OR Santiago's calendar opens up for a Wed/Thu cutover, can advance. Default Sunday window preserves the spec OQ1 anchor. |

## References

- Phase 2 delivery spec: `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md`
- Operational migration scope: `.iago/research/2026-05-16-v2-operational-migration-scope.md`
- Phase 1 max-turns data: `.iago/runs/dispatch-logs/2026-05-17-b-04.log` + `2026-05-17-b-05.log`
- Workstream B+C handoff: `.iago/handoff/2026-05-17-workstream-a.md`
- Phase 2 CONTEXT (updated): `.iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md`
- Memory overrides invoked: `feedback_no_chore_pr_for_doc_moves` (overridden for parallel-wave enablement)
- Memory rules honored: `feedback_garry_impressed_standard`, `feedback_no_auto_merge`, `feedback_explicit_authorization`, `feedback_worktree_per_session`
