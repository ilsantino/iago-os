# iaGO-OS v2 — Workstream A (Phase 2 VPS bootstrap) handoff

## State at session open

- **Workstreams B + C merged on `main`.** All 9 PRs from the prior session merged in PR-number order: #49 (B-01 IPC) → #50 (B-02 atomic rename) → #51 (B-03a main coverage) → #52 (C-01 telemetry session-id) → #53 (B-03b bot coverage) → #54 (B-04 PR40 hardening) → #55 (C-02 clean-tree + adversarial sentinel) → #56 (B-05 sweep) → #57 (C-03 integration harness + aggregator).
- **Dual adversarial reviews ran on every PR** before merge (Opus 4.7 + Codex). All Critical/Important findings fixed in-PR before Santiago merged. Minor findings documented in PR bodies for follow-up.
- **Worktree `iago-os-c`** at `../iago-os-c` was used for parallel C dispatch. Still on disk — may want to `git worktree remove ../iago-os-c` for cleanliness, or keep for future parallel work.
- **Three Phase-1 plans hit the 80-turn max-turns budget** (B-03 → split into 03 + 03b; B-04 → shipped partial with inline T8 completion; B-05 → shipped partial with explicit defer list). Workstream A's 7 plans (Phase 2 VPS bootstrap, ~42 tasks total) are at higher risk of the same. **Pre-emptive split is the strong recommendation** — see "Risk: max-turns" below.

## Plan stack

`.iago/plans/feature-phase-2-vps-bootstrap/` contains 7 plans + CONTEXT.md, already on main from PR #47:

| Plan | Title | Wave | depends_on |
|------|-------|------|------------|
| 01 | (see plan file) | 1 | — |
| 02 | 02-cutover-runbook | 1 | — |
| 03 | (see plan file) | 2 | 01 |
| 04 | (see plan file) | 2 | 01 |
| 05 | (see plan file) | 2 | 03 |
| 06 | (see plan file) | 3 | 04, 05 |
| 07 | (see plan file) | 3 | 06 |

Read `.iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md` for the workstream brief. Read each plan's frontmatter for `depends_on` to confirm wave grouping.

## Required reading (in order)

1. Prior session digest: `~/dev/obsidian-brain/sessions/2026-05-17-iago-os-v2-workstream-bc-merge-train.md` (will be written after session close)
2. Prior prior digest: `~/dev/obsidian-brain/sessions/2026-05-16-iago-os-v2-pre-dispatch.md`
3. `CLAUDE.md` + `.iago/CONTEXT.md` + `runtime/CONTEXT.md`
4. `.iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md` + `02-cutover-runbook.md` (the cutover doc Santiago will run)
5. Memory auto-loaded: `project_iago_v2_vision`, `feedback_garry_impressed_standard`, `feedback_no_auto_merge`, `feedback_explicit_authorization`, `feedback_worktree_per_session`, `reference_iago_v2_vps`

## Mission

1. **Sync main + verify Phase 1 state**
   ```bash
   git fetch origin --prune && git switch main && git pull
   gh pr list --state merged --search "merged:>2026-05-16" --limit 20  # confirm all 9 merged
   ```

2. **Pre-emptive split of Workstream A plans** (do this BEFORE dispatching)
   - Read each of the 7 plan files.
   - Count tasks per plan. **Any plan with >4 tasks OR >150 lines: split into 0Xa / 0Xb files.**
   - Reason: Phase 1 produced 3 max-turns failures on plans with 6-8 tasks. Splitting upfront avoids the partial-PR + manual-fix cycle that bloated the Phase 1 merge train.
   - Write the split plans inline (Read template from any prior `03b-`/`split_from:` plan); update `depends_on` so 0Xb depends on 0Xa.
   - Commit the split plan changes as a tiny `chore(plans): pre-emptive split of Phase 2 plans` PR — let Santiago merge before dispatch.

3. **Dispatch Workstream A** via `/iago-execute feature-phase-2-vps-bootstrap`
   - 7 (or more, after splits) plans, each through the 8-stage pipeline.
   - Each creates a PR. Santiago merges in PR order.
   - After plans 03 and 05 land, schedule the cutover window with Santiago.
   - Use the `iago-os-c` worktree (still present from prior session) for parallel dispatch where plans are file-disjoint. Audit the plan file surfaces first to confirm.

4. **Cutover window (Sunday 2026-05-18 8pm US/Mexico — confirm at dispatch time, default unless Santiago says otherwise)**
   - T-24h: Santiago runs Day-1 prep from `02-cutover-runbook.md`
   - T-15: Santiago notifies Sebas (CTO, Mac side)
   - T-0: Santiago runs `IAGO_CUTOVER_CONFIRM=YES bash runtime/deploy/cutover.sh`
   - T+10: Telegram screenshot + journalctl excerpt for `PHASE-2-EVIDENCE.md`
   - **Do NOT run the cutover script yourself** — it's destructive (replaces the OpenClaw deployment on the Hostinger VPS, memory `reference_iago_v2_vps`).

5. **Dual adversarial review on every Workstream A PR before merge** — same playbook as Phase 1 (Opus 4.7 + Codex per PR, parallel; fix Critical/Important locally; document Minor). Don't skip this step — Phase 2 changes deployment infra and rollback is harder.

6. **Cleanup PR for residual Opus Minors** from Phase 1 sweep (deferred list in `.iago/summaries/_dual-review-residuals.md` — to be written by current session before close). Quick `/iago-fast` or `/iago-quick` once A lands.

## Operating principles

- **Pre-emptively split big plans.** Phase 1 lesson: 6-8 tasks per plan with test additions → 80-turn ceiling hits 100% of the time. Cap at 4 tasks per plan. If a plan absolutely cannot split, dispatch with `--max-turns 120` (see if pipeline script supports it; otherwise just split).
- **Do NOT create chore PRs for plan doc moves.** Exception: the pre-emptive-split PR (step 2 above) IS a doc-only PR — that's intentional because it's prep for a major dispatch wave. Tiny PR, merge fast.
- **Worktree per concurrent session** (`feedback_worktree_per_session`). The `iago-os-c` worktree from Phase 1 is reusable for parallel A dispatches.
- **All Critical findings fix-in-place on PR branch** (Garry standard — `feedback_garry_impressed_standard`).
- **Santiago merges all PRs** (`feedback_no_auto_merge`).
- **Use Bash with `run_in_background:true` for pipeline invocations** — they take 30-90 min and exceed Bash 10-min timeout.
- **ScheduleWakeup if genuinely idle for >5 min** waiting on long-running pipeline.
- **Codex spurious-approve bug** (memory: `project_pipeline_bugs`): codex review stage sometimes claims "no diff" even when there is one. Workaround used in Phase 1: I generated `gh pr diff > .iago/reviews/prNN-diff.patch` upfront and made the Opus reviewer read THAT file instead of relying on git state. For Workstream A pipeline runs, accept the spurious-approve as the pipeline's default behavior — the dual-review step (Opus + Codex on the PR) catches what the pipeline's codex stage missed.

## Risk: max-turns

Hard data from Phase 1:
- B-01 (8 tasks but small): COMPLETED in budget
- B-02 (7 tasks): COMPLETED in budget
- B-03 (6 tasks, 139 lines): **FAILED at 80 turns** → split into 03 + 03b
- B-04 (8 tasks, 174 lines): **FAILED at 80 turns** → shipped partial with inline T8 completion
- B-05 (8 tasks, 302 lines): **FAILED at 80 turns** → shipped partial, deferred T3/T4/T7/T8

Pattern: plans with **>5 tasks AND extensive test additions** hit the ceiling. Workstream A plans need a careful read — VPS bootstrap involves a lot of bash + systemd unit files + cutover scripts. Each "task" may be heavier than a Phase 1 task.

## Files / pointers

- Plans: `.iago/plans/feature-phase-2-vps-bootstrap/`
- Cutover runbook: `.iago/plans/feature-phase-2-vps-bootstrap/02-cutover-runbook.md`
- Phase 1 evidence: `runtime/PHASE-1-EVIDENCE.md` (merged via #53)
- Phase 2 evidence target: `runtime/PHASE-2-EVIDENCE.md` (to be created/populated by plans 06/07)
- VPS credentials: see memory `reference_iago_v2_vps` (Hostinger KVM 2, Tailscale node srv1456441)
- Cutover script: `runtime/deploy/cutover.sh` (created by Phase 2 plans; Santiago runs)
- Worktree: `../iago-os-c` (still present, reusable)
- Dual-review residuals: `.iago/summaries/_dual-review-residuals.md` (Minor findings deferred from Phase 1 dual review)

## Begin

Verify state (step 1), then do the pre-emptive plan split (step 2). Commit the split as a doc-only PR. After Santiago merges it, dispatch Workstream A via `/iago-execute feature-phase-2-vps-bootstrap`. Run dual adversarial review on each PR before notifying Santiago to merge.
