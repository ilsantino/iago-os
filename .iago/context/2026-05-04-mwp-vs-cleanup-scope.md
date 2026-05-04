# Context: MWP audit vs feature-iago-os-cleanup — scope decision

**Date:** 2026-05-04
**Decision authority:** Orchestrator (with Santiago veto)
**Inputs:** `.iago/research/2026-04-28-mwp-restructure-audit.md` §1.7 + §2.5; `docs/specs/iago-os-cleanup.md`; `.iago/plans/feature-iago-os-cleanup/01-cleanup-hygiene.md` (revised 2026-05-04); council §8.3 PROCEED_WITH_REVISIONS verdict.

---

## Verdict — COEXIST

**MWP audit work runs as its own `feature-mwp-restructure`, NOT folded into `feature-iago-os-cleanup`.**

Cleanup ships as planned (5 items, one bundled PR, ~1.75 dev-days, council-roadmap Phase 1). MWP runs as a separate feature with its own waves and PRs, sequenced after cleanup but on its own clock — not gated by council-roadmap Wave 6 buffer (revision #3 collapses naturally with this split).

---

## Reasoning (5 points)

1. **The audit's own stress-test pivot says don't fold.** Audit §2.5 #6 is unambiguous: *"Coordinate with in-flight council-roadmap, not fold into it... folding would either reopen the counciled selection-of-5 OR bury MWP's highest-leverage finding in the deferred-8 margin-time bucket. Different fires; run as parallel/sequenced tracks."* The cleanup spec IS the realization of that counciled selection-of-5 (`docs/specs/iago-os-roadmap.md` Phase 1 mess list → `docs/specs/iago-os-cleanup.md`). Folding MWP into cleanup is the exact thing the audit pre-rejected.

2. **The cleanup spec is frozen + stress-tested + planned.** `feature-iago-os-cleanup/01-cleanup-hygiene.md` was revised 2026-05-04 with a full stress-test resolution log (Phase A: 10 reviewers, 5 lenses × 2 plans; 1 BLOCK + 13 IMPORTANTs addressed inline; Plan 02 deleted, scope collapsed into Task 7). Folding 8+ MWP items would force a re-spec, re-stress, and reopen the council's selection-of-5 criterion ("blocks munet-web pipeline run OR blocks Sebas-on-Mac" — which MWP M01-M12 do not satisfy).

3. **File-target overlap is empirically zero for Phase 1.** Cleanup touches: `.iago/STATE.md`, `.claude/rules/{git-workflow,execution-pipeline}.md`, `.iago/state/README.md`, `.iago/plans/feature-pipeline-speed-wedges/_deferred/` → `_archive/`, scripts/ inline GNU comments, `CLAUDE.md` Prerequisites extension. MWP M01-M12 touches: `iago-os/CLAUDE.md.backup` (delete), `.gitattributes` (`*.mjs eol=lf`), `.iago/prompts/` (commit untracked), doc moves between `docs/research/` ↔ `clients/munet-web/.iago/research/` and `docs/` ↔ `.iago/runbooks/`, MUNET root orphans (HANDOFF/SCOPE/ASSET) → `clients/munet-web/.iago/state/`, MEMORY.md pointer sweep. **Disjoint.** The only shared touchpoint is root `CLAUDE.md` Prerequisites — and that's only a 1-bullet append in cleanup vs a full trim+routing-rule restructure in MWP Phase 2 (M13). Phase 1 of MWP has no overlap at all.

4. **Decision-authority lineage.** Cleanup answers to council-roadmap (Phase 0.3 canonical roadmap, `docs/specs/iago-os-roadmap.md`). MWP answers to its own audit + post-stress-test council (`.iago/research/2026-04-28-mwp-restructure-audit.md` §8). Mixing destroys traceability — when someone asks 6 weeks from now "why was this in the cleanup PR?", the answer "because MWP Wave A folded in" is messier than "MWP Wave A was its own PR."

5. **MWP Phase 1 (M01-M12) is small enough to ride solo.** Estimated ~30-60 min of actual work (per audit §5.1 Executor's accounting; council adjusted to ~90 min in §8.4). One chore PR. It does not need cleanup's wrapper to be ship-ready.

---

## What this means concretely

- **`feature-iago-os-cleanup`** ships as planned (Plan 01, 5 items, one PR). No expansion.
- **`feature-mwp-restructure`** is created as a sibling feature folder (`.iago/plans/feature-mwp-restructure/`) with three waves:
  - **Wave A** = M01, M02, M03, M06–M11 (dormant-zone moves; M12 MEMORY pointer fix runs post-merge). Single chore PR. Council §8.3 said this is "shovel-ready" after revisions land. Sequence: AFTER cleanup PR merges (zero collision either way, but parallel review queue noise is avoidable).
  - **Wave B** = M13–M21 + M22–M23 (root CLAUDE.md trim incorporating routing rule from `docs/specs/iago-os-mwp-routing-rule.md`, per-client CLAUDE.md skeletonization, CONTEXT.md creation, sentria scaffold, workspace router, MEMORY/obsidian path sweep). Two-PR chain per Q4 pattern (pure `git mv` PR + path-fix PR). Sequence: AFTER council-roadmap Wave 2 ships (audit §5.2) — but **NOT** in Week 6 buffer (council Rev #3 rejected that placement).
  - **Wave C** = M24 (clients/ split to separate GitHub repos). Separate council per audit §5.3 + council §8.3. Defer until wedge cycle ships AND incident debt clear.
- **Council Rev #2 (routing rule)** can pull forward as a standalone `/iago-fast` PR (pre-Wave-A) per the spec at `docs/specs/iago-os-mwp-routing-rule.md` §1.5, OR ride Wave B as part of the M13 root trim. Recommendation: pull forward — single-file edit, no collision, lets the rule start working immediately.
- **Council Rev #3 (Phase 2 sequencing)** collapses naturally: Wave B is no longer competing for the council-roadmap Week 6 buffer because MWP is its own feature, not a council-roadmap line item. Wave B sequences against council-roadmap Wave 2 *completion* (file collision avoidance), not against the buffer (no longer relevant).

## What this rejects

- **Folding M01-M12 into cleanup as items 6-N.** Rejected for reasons 1–5 above.
- **Folding M13-M21 anywhere.** Phase 2 of the audit is structural surgery; it is not hygiene. Cannot ride a hygiene PR even if scope expanded.
- **Treating MWP and cleanup as competing.** They aren't. Cleanup answers a different fire (council-roadmap operator-UX correctness). MWP answers the organizational-hygiene "shitshow" complaint. Both legitimate, both ship.

---

## Open question for Santiago (one only — no menu)

**MWP Wave A timing relative to cleanup PR merge.** Wave A has zero file collision with cleanup. It can run in parallel (separate branches, separate PRs), in series (after cleanup merges), or be deferred indefinitely. Recommend: in series, immediately after cleanup merges. Reason: keeps PR review queue clean for both Santiago and any @claude reviewer (parallel cleanup-style PRs blur attention). Wave A is small enough that the delay cost is hours, not days. Override if you'd rather have Wave A in flight while cleanup is in review — both work; series is the safer default.

---

## Sources

- `.iago/research/2026-04-28-mwp-restructure-audit.md` §1.7, §2.5, §3.2, §3.4, §5, §8.3, §8.4
- `docs/specs/iago-os-cleanup.md` — full Phase 1 cleanup spec (5 items, council-roadmap-derived)
- `.iago/plans/feature-iago-os-cleanup/01-cleanup-hygiene.md` — stress-tested implementation plan (revised 2026-05-04)
- `docs/specs/iago-os-roadmap.md` — Phase 0.3 canonical roadmap (selection-of-5 authority)
- `docs/specs/iago-os-mwp-routing-rule.md` — Council Rev #2 spec (this session, 2026-05-04)
