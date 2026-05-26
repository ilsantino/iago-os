# feature-mwp-restructure-code — workstream brief

**Created:** 2026-05-25
**Source audit:** `.iago/research/2026-05-25-mwp-restructure-audit.md` §1.2, §1.5, §5 (cross-refs that break), §6 (orphans), §9 (code folder spec), §10.5 Q2 (mcp-servers KEEP top-level)
**Sibling workstreams:** `feature-mwp-restructure-docs/` (4 plans, ready); `feature-mwp-restructure-clients/` (5 plans, ready). This is the highest-risk folder — touches `scripts/`, `.iago/hooks/`, `.claude/settings.json`.

## Goal

Apply MWP physical layout to iago-os repo internals — the half of the restructure that touches code paths, hook chains, and pipeline scripts. The classification (L3 factory / L4 product / state) already lives in `.iago/CONTEXT.md` (docs folder Plan 01 reinforces it). This folder converts that classification into physical folder structure.

## Plans in this folder

| Plan | Wave | Deps | Scope |
|---|---|---|---|
| 01-iago-physical-split | 1 | docs/03 (ROADMAP/PROJECT.md), clients/01 (Level B sub-workspace registry) | Single atomic PR: `.iago/` → `_config/ + product/ + state/ + _archive/`. Move factory subdirs (config, context, decisions, hooks, learnings, prompts, runbooks) to `_config/`. Move product subdirs (plans, research, reviews, summaries, runs, logs, pipeline-runs) to `product/`. Update `.claude/settings.json` hook paths (5 paths). Sed-pass on ~14 scripts. Smoke-test pipeline still runs. |
| 02-scripts-restructure | 2 | 01 (review-checks lands in `.iago/_config/`) | `scripts/` → `pipeline/ + setup/ + ops/ + tests/`. Move `scripts/review-checks/*.md` to `.iago/_config/review-checks/` (Layer-3 reference loaded by review stage). Sed-pass on ~15 cross-references (incl. CLAUDE.md, available-skills.md, execution-pipeline.md). Smoke-test pipeline. |
| 03-cleanup-final | 3 | 01, 02 | Delete `graphify-out/` (orphan per §6); `git worktree list` audit + prune `pr40..44-fix` (stale per §6); document root `package.json` purpose; confirm `mcp-servers/` keep-top-level (§10.5 Q2 = KEEP, no move); final iago-os repo verification (full pipeline smoke + tree comparison vs audit §1 target). |

**Why sequential not parallel:** Plan 01 touches every script reference and the settings.json hook chain. Plan 02 cannot start until 01's `.iago/_config/review-checks/` target exists. Plan 03 verifies the end-state from 01+02. Parallelism risks transactional inconsistency mid-pipeline.

## Hard pre-flight dependencies (other folders)

- `feature-mwp-restructure-docs/03-roadmap-and-project-md` — creates `.iago/ROADMAP.md` and `.iago/PROJECT.md` (Plan 01 here assumes they exist at `.iago/` root)
- `feature-mwp-restructure-clients/01-register-clients-in-root-context` — populates Level B sub-workspaces registry in `.iago/CONTEXT.md` (Plan 01 here updates the folder map alongside but doesn't touch the registry rows)

If those haven't shipped, Plan 01 here STOPs with explicit error message naming the missing dep.

## Risk surface

| Risk | Mitigation |
|---|---|
| Hook chain breaks (`.claude/settings.json` points at `.iago/hooks/*.mjs` paths) | Plan 01 Task 3 updates settings.json in the SAME commit as the hooks/ move; smoke-test edits a dummy file post-move to confirm hooks fire |
| Pipeline scripts reference moved `.iago/{plans,summaries,reviews,...}` paths (14 files per audit §5.3) | Plan 01 Task 6 enumerates + sed-passes all references in same PR |
| `scripts/review-checks/` is loaded by review stage by path (15 references per audit §5.2) | Plan 02 Task 6 sed-passes all references in same PR |
| In-flight pipeline runs against old paths | Recommend: no `/iago-execute` runs while Plan 01 is in flight (single-PR window) |
| `git mv` partial-failure mid-move | Plans use `mkdir -p` for leaves + atomic `git mv src/* dst/` form (avoiding directory-into-directory nesting) |

## Acceptance for the whole folder (run after all 3 plans ship)

```bash
# Plan 01 — .iago/ physical split
test -d .iago/_config && test -d .iago/product && test -d .iago/_archive
test -d .iago/_config/hooks && test -d .iago/_config/runbooks
test -d .iago/product/plans && test -d .iago/product/summaries
! test -d .iago/hooks  # moved into _config/
! test -d .iago/plans  # moved into product/

# Plan 02 — scripts/ reshape
test -d scripts/pipeline && test -d scripts/setup && test -d scripts/ops && test -d scripts/tests
test -f scripts/pipeline/execute-pipeline.sh
test -d .iago/_config/review-checks
! test -d scripts/review-checks  # moved to .iago/_config/

# Plan 03 — cleanup
! test -d graphify-out  # orphan deleted
# (worktree prune verified manually via git worktree list)
test -d mcp-servers  # kept top-level per §10.5 Q2

# Pipeline still functional
bash -n scripts/pipeline/execute-pipeline.sh  # parses
test -f .claude/settings.json
grep -q "_config/hooks" .claude/settings.json  # hooks path updated

# No stale cross-refs
! grep -rln "scripts/review-checks" --include="*.md" --include="*.sh" --exclude-dir=_archive --exclude-dir=.worktrees .
! grep -rln "^.iago/hooks" --include="*.json" --include="*.sh" .
```

## Pipeline expectations

Each plan ships through `/iago-execute feature-mwp-restructure-code` standard pipeline. Three sequential PRs (Plans 01 → 02 → 03). High change-volume PRs (especially 01 with ~30 file moves + 14 script edits) — expect adversarial review to flag any path I missed.
