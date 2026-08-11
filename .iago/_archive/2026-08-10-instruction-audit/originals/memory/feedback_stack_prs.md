---
name: Stack PRs — one branch, one PR, rebase before push
description: Feature work spanning multiple plans stacks commits on one branch and ships as a single PR; rebase on main immediately before push to avoid silently overwriting parallel work
type: feedback
originSessionId: e027f681-ce0f-4e11-ace2-4a2eb51a8dc4
---
For feature work spanning multiple plans in the same feature folder, stack commits on a single branch (use `--no-pr` on `scripts/execute-pipeline.sh` per plan) and create ONE PR from the last plan. Do not merge between plans in the same phase.

**Why:** Plans edit the same container / anchor files via slot anchors. Per-plan PRs create a continuous rebase loop and ship intermediate `Contenido próximamente` states to prod. Single PR lands the whole feature atomically.

**How to apply:** Run the pipeline per plan with `--no-pr` to stack commits. The LAST plan in the feature does NOT pass `--no-pr` — it pushes + creates the PR + tags @claude. Session digests should document which plan holds the PR responsibility.

**Rebase-before-push is mandatory** for any stacked-commit branch that was cut more than a day ago: before the final plan's push step, run `git fetch origin && git rebase origin/main` and verify the PR diff does not delete lines that merged in parallel (e.g., `gh pr diff | grep -c '^-.*OtherExhibitionPage'` must be 0). Parallel sessions on other features may have merged work that the stale branch's edits would silently overwrite on squash merge — this was caught by the 2026-04-20 combustibles-fósiles stress test where the worktree branch was behind `origin/main` by `ba7706b feat(electricidad): 05 #67` and a naive push would have erased electricidad from production.

**Exception: multi-plan UI redesigns (4+ plans, cinematic / full-page overhaul) should split per-plan PRs.** @claude has bounded review context; a 5-plan, 30-task cinematic diff dilutes per-file attention to the point where it misses exactly the bugs stress tests flag (e.g., `MotionValue<string>` as JSX children, `pathLength` vs `strokeDasharray` collision, wrong data export names). The 2026-04-21 electricidad-cinematic planning surfaced this: 5 plans × ~10 new files each ≈ 50-file PR, where @claude review thoroughness dominates the rebase cost. Split-signal: if planning produces ≥4 plans where each plan touches largely non-overlapping components AND the shared anchors can be consolidated into the foundation plan's diff (e.g., hoist cross-plan data constants like `SOURCE_TO_SCENE` into the foundation plan), prefer per-plan PRs rebased on each merged predecessor. Keep stacking for small multi-plan features where anchor overlap is high.
