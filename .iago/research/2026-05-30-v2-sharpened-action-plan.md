# iago-os-v2 — Sharpened Action Plan (stress-tested)

_2026-05-30. Plan-of-record after a 5-lens adversarial stress-test (scope / sequencing / data-loss / completeness / simpler-path) of the reorg-audit action plan, scored against the canonical v2 objective. Companion to `2026-05-30-plan-state-and-reorg-audit.md` (state) — this file is the ACTION ORDER. Verdict: RESEQUENCE (not BLOCK); actions mostly right, order + scope were wrong._

## North star (re-anchor)

iago-os v2 = the 24/7 VPS daemon hosting agents of all **5 execution shapes** (PTY / HTTP-SDK / MCP-as-agent / webhook / daemon), controlled from the phone via **Telegram**, watched through a **Next.js dashboard**, **replacing OpenClaw** while keeping the cross-model review pipeline as the moat. Today **1 of 5 shapes built** (Claude PTY) → ~10–15% to "operational v2" (Phases 0–7 + 9–10). Everything below exists to finish Phase 2 cleanly and unblock the Phase-3 shape build — without losing work already on main.

## What the stress test changed (4 corrections)

1. **A4 (orphan recovery) moves from LAST → FIRST.** Unanimous. The orphan tips carry the **coverage floor** (adapter-isolation tests + fixtures, phase-1b integration harness, `biome.json`, InterfaceVersion centralization) — `biome.json` is MISSING on main today. PR 84 and the orphan edit the **same 5 daemon files** (`agent-manager.ts`, `main.ts`, `main.test.ts`, `state-paths.ts`, `telemetry.ts`); merging PR 84 first turns recovery into a 3-way merge on daemon core where a careless resolve **silently overwrites PR 84's fixes** (repeats the squash-to-sibling drop). P1's `/iago-verify` also falsely passes / hard-fails without the orphan coverage harness.
2. **code/02 is DROPPED, not re-stressed — it's actively harmful.** It git-mv's `scripts/review-checks/` while the LIVE pipeline (`execute-pipeline.js:261`, `dual-adversarial.js:86`) reads the old path → executing it silently guts the review moat. Re-archive per plan-archive convention.
3. **A1 expands 2 → 5 CONTEXT fixes, AND the comms-channel CONTEXT itself lacks the locked envelope.** The `agent-comms-channel` CONTEXT (the one that DEFINES the envelope) omits `quality_signal`, `seq`, `v`; `supervisor-role` uses `role:"supervisor"` not locked `role:"chief"`; dashboard needs a `quality_signal`/chief-as-blocker line; per-agent-bots needs an explicit consistency confirm. Otherwise `/iago-plan` (P3) inherits ADR contradictions → rework after code is written.
4. **P2 (mwp reorg) is DESCOPED off the critical path; P3 (plan the Phase-3 stacks) is PROMOTED.** P2 ships no shape/tab/Telegram/cutover — pure directory reorg, absent from the done-definition. P3 is the genuine on-ramp (shapes + comms + chief + dashboard) and depends only on corrected CONTEXTs, not the reorg.

## Guardrails

- **G0 — tag-before-touch (DONE 2026-05-30):** `salvage/b-05`=2666ff2, `salvage/c-03`=4d4b0b8 (real branch `feat/c-03-integration-harness-and-aggregator-projection`, NOT `…-integration-harness`), `salvage/pr79-mwp`=bc4c978 — pushed to origin. **Branch-deletion freeze:** no `-d`/remote-delete/gone-prune on `feat/b-05-minor-sweep`, `feat/c-03-integration-harness-and-aggregator-projection`, `feat/mwp-restructure-docs-02` until recovery PRs merge + content-presence asserts pass. Add to prune skip-list.
- **G1 — content-presence assertion on recovery:** checked-in manifest of every orphan path + post-merge `git ls-tree -r HEAD` proving each exists. 3-way `git merge`, NEVER cherry-pick the 5-file conflict set; modify/delete conflicts = MANUAL-REVIEW, never `-X ours/theirs`. Full vitest + coverage after.
- **G2 — worktree hygiene for the PR-84 re-gate:** commit any dirty tree first (never stash-to-switch); `git worktree add ../iago-wt-pr84 origin/feat/pr-triage-integration-test` (pin to remote ref); run ONE clean **dual** pass (Opus ∥ Codex together, `--base origin/main`) — not Codex-only; remove with plain `git worktree remove` (no `--force`).
- **G3 — no plaintext daemon secret on VPS disk:** PR 84 persists `env` (GH PAT + Telegram token) as 0600 JSON. Gate the **VPS-relevance / cutover** of PR 84 on at-rest encryption (systemd `LoadCredential=` / tmpfs + backup-exclusion). NOT a code-merge blocker; IS a cutover blocker. Document the rotation runbook as the rollback path.

## Ordered sequence (minimum critical path)

0. **G0 (done).** Salvage tags pushed; freeze declared.
1. **A3 — restore /industry-patterns** (broken on main today). Restore 8 files to `.claude/rules/patterns/{domain}.md` from `bc4c978` AND fix `SKILL.md:36` (still says `docs/patterns/`). `/iago-fast` if ≤3 edits else `/iago-quick` (8 files + pointer likely exceeds the fast ceiling). Independent, parallel-safe. Low OS impact (client skill).
2. **A4 — recover orphans FIRST**, behind G0+G1, via re-gated PRs to main (never raw git). Restores the coverage floor.
3. **A2 — re-gate PR 84** under G2 → human merges → backfill **04b + 04c + 04d** summaries (not just 04c).
4. **A1 — fix all 5 PR-85 CONTEXTs** (`/iago-fast`, docs-only) + de-dupe BOTH vision.md Open-Questions duplicates + reconcile stale STATE.md "cutover TODAY 2026-05-25" header + STATE count 4→5 → human merges → **Santiago re-locks Phase-3 anti-scope** (governance gate; P3 cannot start before this).
5. **P3 — `/iago-plan` the 5 Phase-3 stacks** (immediately after A1, decoupled from the reorg). Create the missing `feature-v2-codex-cohabitation` CONTEXT first, then plan in dep order: **shape-expansion** (codex/gemini/opencode PTY + anthropic/openai SDK + langchain-home) → **agent-comms-channel + supervisor/chief** → **per-agent-bots** → **dashboard-tabs LAST** (consumes comms NDJSON). Encode `depends_on`.
6. **P1 — finish + verify Phase 2.** Stress 05b's plan, execute 05a → 05b (reuse `runtime/scripts/check-evidence.mjs`), `/iago-verify` with a hardened gate (assert `biome.json` + adapter-isolation present — guaranteed by step 2; fail on any missing per-plan summary). **Hard precondition before human cutover:** cutover dry-run green + **rollback dry-run green** + evidence-checker PASS.
7. **Debt lane (background, NOT a Phase-3 gate):** docs/04 → docs/03 (wave order: registry before ROADMAP) → clients/02–05 ∥ → clients/01 (after 02–05; its rows cite their CLAUDE.md paths) → code/01. **code/02 DELETED.** If `runtime/CLAUDE.md` aids navigation during shape work, that's one `/iago-fast`, not the stack.

## Scope-creep callouts (the "don't lose scope" answer)
- **P2 mwp-reorg → background lane.** Do not gate Phase 3 on it. Every day on it = a day not building the 6 missing adapters.
- **code/02 → DROP.** Harmful (guts the live reviewer).
- **A2 "Codex-only re-run" → rejected.** Prior Opus + Codex passes were on different checkouts; one clean dual pass.

## Open items / verify-before-acting
- Both orphan tips confirmed resolvable (b-05=2666ff2, c-03=4d4b0b8). ✓ (done in G0)
- Uncommitted work hygiene: working tree is on `chore/cc-config-optimization`, clean except this audit doc. The earlier "uncommitted dual-adversarial.js" the lens saw is now committed/on another branch — re-confirm a clean tree before any A2 worktree op.
- A3 may exceed `/iago-fast` 3-file ceiling → use `/iago-quick`.
