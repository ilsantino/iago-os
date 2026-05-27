# Spec: Review Pipeline Control

## Problem

PR review-fix loop always auto-triggers after pipeline creates PR. No way to choose manual vs automatic per invocation. User wants to inspect PRs before burning review rounds on quick tasks, but wants full automation on ROADMAP phases.

## Solution

Flag-based control on existing skills. Different defaults per skill scope.

- `/iago:execute` → auto-review (default). Override: `--no-review`
- `/iago:quick` → manual review (default). Override: `--review`
- `/iago:prfix` → unchanged, manually triggers loop on any PR

## Scope

### In Scope
- `--review` / `--no-review` flags on `/iago:execute` and `/iago:quick`
- Modify `scripts/execute-pipeline.sh` to accept `--no-tag` flag (skips step 5b)
- Update skill files to parse and pass flag
- Update `execution-pipeline.md` rule doc
- PR review pipeline setup docs in `docs/pr-review-pipeline.md`

### Out of Scope
- New skills (no `/iago:prpipeline` or `/iago:prreview`)
- Per-project config in `.iago/config.yml`
- Changes to GitHub Actions workflows (they stay as-is)

## Technical Approach

### Pipeline script change
`scripts/execute-pipeline.sh` gets `--no-tag` flag:
```bash
# When --no-tag is passed, skip step 5b (tag @claude)
if [ "$NO_TAG" != "true" ]; then
  # Step 5b: Tag @claude for review
  ...
fi
```

### Skill changes
`/iago:execute` skill parses `--no-review` flag → passes `--no-tag` to script.
`/iago:quick` skill parses `--review` flag → omits `--no-tag` when present.

### Flow
```
/iago:execute phase-slug           → impl → build → review → PR → @claude (auto)
/iago:execute phase-slug --no-review → impl → build → review → PR → STOP
/iago:quick desc                   → impl → build → review → PR → STOP
/iago:quick desc --review          → impl → build → review → PR → @claude (auto)

Manual trigger anytime: /iago:prfix (tags @claude on current branch PR)
```

## Delivery Path

### Phase 1: Script + skill changes (0.5 day)
- Add `--no-tag` to `execute-pipeline.sh`
- Update `/iago:execute` and `/iago:quick` skill files
- Update `execution-pipeline.md` rules

### Phase 2: Documentation (0.5 day)
- Write `docs/pr-review-pipeline.md` — full setup guide
- Update README with pipeline overview
- Update CLAUDE.md pipeline section

## Open Questions

None — ready to plan.
