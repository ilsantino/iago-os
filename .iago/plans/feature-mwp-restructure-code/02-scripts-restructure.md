---
phase: feature-mwp-restructure-code
plan: 02
wave: 2
depends_on: [01-iago-physical-split]
context: .iago/research/2026-05-25-mwp-restructure-audit.md
created: 2026-05-25
source: feature
---

# Plan: feature-mwp-restructure-code/02-scripts-restructure

## Goal

Reshape `scripts/` into 4 role-based subdirs (`pipeline/`, `setup/`, `ops/`, `tests/`) per audit §1.5. Move `scripts/review-checks/*.md` to `.iago/_config/review-checks/` (Layer-3 reference, not scripts). Sed-pass on ~15 cross-references per audit §5.2. Single atomic PR.

## Tasks

### Task 1: Create `scripts/{pipeline, setup, ops, tests}/` subdirs

- **files:** `scripts/pipeline/`, `scripts/setup/`, `scripts/ops/`, `scripts/tests/`
- **action:** `mkdir -p scripts/pipeline/lib scripts/setup scripts/ops scripts/tests`. The `pipeline/lib/` subdir preserves the existing `scripts/lib/` nesting.
- **verify:** `test -d scripts/pipeline/lib && test -d scripts/setup && test -d scripts/ops && test -d scripts/tests`
- **expected:** all 4 dirs exist

### Task 2: Move pipeline core into `scripts/pipeline/`

- **files:** `scripts/{execute-pipeline.sh, check-clean-tree.sh, check-clean-tree.test.sh, console-check.mjs, measure-build-gate-rss.sh, lib/*}` → `scripts/pipeline/{...}`
- **action:** `git mv scripts/execute-pipeline.sh scripts/pipeline/execute-pipeline.sh && git mv scripts/check-clean-tree.sh scripts/pipeline/ && git mv scripts/check-clean-tree.test.sh scripts/pipeline/ && git mv scripts/console-check.mjs scripts/pipeline/ && git mv scripts/measure-build-gate-rss.sh scripts/pipeline/ && git mv scripts/lib/* scripts/pipeline/lib/ && rmdir scripts/lib`. The `lib/` subdir contents (adversarial-verdict, build-gate, learnings-writer, metrics-aggregate, pipeline-telemetry + .test.sh siblings) move into `pipeline/lib/`. Old `scripts/lib/` directory removed (empty after move).
- **verify:** `test -f scripts/pipeline/execute-pipeline.sh && test -d scripts/pipeline/lib && [ "$(ls scripts/pipeline/lib/*.sh | wc -l)" -ge "5" ] && ! test -d scripts/lib && ! test -f scripts/execute-pipeline.sh`
- **expected:** core scripts in pipeline/; lib/ moved; old paths gone

### Task 3: Move setup, ops, tests scripts

- **files:** various
- **action:** **Setup:** `git mv scripts/new-client.sh scripts/setup/ && git mv scripts/new-client.ps1 scripts/setup/ && git mv scripts/setup-memory.sh scripts/setup/ && git mv scripts/setup-memory.ps1 scripts/setup/ && git mv scripts/sync-skills.sh scripts/setup/ && git mv scripts/sync-skills.ps1 scripts/setup/`. **Ops:** `git mv scripts/metrics-aggregate.mjs scripts/ops/ && git mv scripts/usage-report.sh scripts/ops/ && git mv scripts/usage-report.ps1 scripts/ops/`. **Tests:** `git mv scripts/test-build-gate.sh scripts/tests/ && git mv scripts/test-pipeline-helpers.sh scripts/tests/ && git mv scripts/validate-hooks.sh scripts/tests/ && git mv scripts/validate-skills.sh scripts/tests/`.
- **verify:** `[ "$(ls scripts/setup/ | wc -l)" -ge "6" ] && [ "$(ls scripts/ops/ | wc -l)" -ge "3" ] && [ "$(ls scripts/tests/ | wc -l)" -ge "4" ] && ! test -f scripts/new-client.sh && ! test -f scripts/usage-report.sh`
- **expected:** counts match; old top-level paths gone

### Task 4: Move `scripts/review-checks/` → `.iago/_config/review-checks/` (handle hidden files)

**Stress-test fix (C3):** original `rmdir` could fail under `set -e` if a `.gitkeep` or other dotfile remains after `git mv *.md`. Pre-flight check + safer cleanup.

- **files:** `scripts/review-checks/*` (11 .md files + any dotfiles) → `.iago/_config/review-checks/`
- **action:** Depends on `.iago/_config/` existing (Plan 01 creates it).
  ```bash
  set -euo pipefail
  mkdir -p .iago/_config/review-checks
  
  # Move tracked .md files
  git mv scripts/review-checks/*.md .iago/_config/review-checks/
  
  # Sweep any hidden files (.gitkeep etc.) — git mv if tracked, rm if not
  if ls scripts/review-checks/.* 2>/dev/null | grep -v "^\.$\|^\.\.$" > /tmp/hidden-files.txt; then
    while IFS= read -r hidden; do
      if [ -f "$hidden" ]; then
        if git ls-files --error-unmatch "$hidden" >/dev/null 2>&1; then
          git mv "$hidden" .iago/_config/review-checks/
        else
          rm -f "$hidden"
        fi
      fi
    done < /tmp/hidden-files.txt
    rm -f /tmp/hidden-files.txt
  fi
  
  # Now directory should be empty
  rmdir scripts/review-checks
  ```
  11 files: amplify, api, auth, backend, baseline, data-integrity, i18n, infra, patterns, react, shell-deploy.
- **verify:** `! test -d scripts/review-checks && test -d .iago/_config/review-checks && [ "$(ls .iago/_config/review-checks/*.md | wc -l)" = "11" ]`
- **expected:** moved; 11 files preserved; old scripts/review-checks/ gone (handles hidden files safely)

### Task 5: Update `execute-pipeline.sh` `CHECKS_DIR` + self-freeze logic (CRITICAL — specific line numbers)

**Stress-test BLOCK fix (C1+C2):** original task said "verify the helper paths it copies are accurate per new layout" — too vague. Stress test found the actual break: line 148 sets `CHECKS_DIR="$SCRIPT_DIR/review-checks"`. After Task 4 moves review-checks to `.iago/_config/`, `$SCRIPT_DIR` (now `scripts/pipeline/`) does NOT contain it — `.iago/_config/` is OUTSIDE `$SCRIPT_DIR` and will NOT ride along in the self-freeze copy. Pipeline silently runs with empty review-checks bundle. `bash -n` passes but runtime breaks.

- **files:** `scripts/pipeline/execute-pipeline.sh`
- **action:** **Step A — find the exact references:**
  ```bash
  grep -n "review-checks\|SCRIPT_DIR\|scripts/lib\|IAGO_PIPELINE_FROZEN" scripts/pipeline/execute-pipeline.sh
  ```
  **Step B — repoint `CHECKS_DIR` to project-relative path:** find the line `CHECKS_DIR="$SCRIPT_DIR/review-checks"` (was line 148 pre-restructure). Replace with:
  ```bash
  # CHECKS_DIR points at .iago/_config/review-checks/ (NOT under SCRIPT_DIR after restructure)
  # Use CLAUDE_PROJECT_DIR (set by Claude Code) or fallback to git root
  PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo "$SCRIPT_DIR/../..")}"
  CHECKS_DIR="$PROJECT_DIR/.iago/_config/review-checks"
  ```
  **Step C — runtime existence check:** add immediately after CHECKS_DIR assignment:
  ```bash
  if [ ! -d "$CHECKS_DIR" ]; then
    echo "ERROR: review-checks directory not found at $CHECKS_DIR" >&2
    echo "  PROJECT_DIR=$PROJECT_DIR" >&2
    echo "  SCRIPT_DIR=$SCRIPT_DIR" >&2
    exit 1
  fi
  ```
  **Step D — self-freeze logic:** the script copies `$SCRIPT_DIR/.` to `$IAGO_PIPELINE_FROZEN_DIR`. After Task 2 of THIS plan, `$SCRIPT_DIR` is `scripts/pipeline/` which includes `execute-pipeline.sh` + `lib/`. Verify self-freeze still copies what's needed: `lib/*.sh` rides along (good). Review-checks does NOT need to ride along — Step B above makes it reference the canonical path directly via `$PROJECT_DIR`. Verify `$SCRIPT_DIR/lib/` references inside the script use relative `lib/` form (works post-move since lib/ stays adjacent in `scripts/pipeline/lib/`).
  **Step E — any other internal references:** sweep for `scripts/lib/` (any source/include calls) and `scripts/review-checks/` — should be zero after Step B. Sed any straggler: `sed -i 's|scripts/review-checks/|.iago/_config/review-checks/|g; s|scripts/lib/|scripts/pipeline/lib/|g' scripts/pipeline/execute-pipeline.sh`.
- **verify:** `bash -n scripts/pipeline/execute-pipeline.sh && grep -q "PROJECT_DIR.*_config/review-checks" scripts/pipeline/execute-pipeline.sh && grep -q "review-checks directory not found" scripts/pipeline/execute-pipeline.sh && ! grep -q "SCRIPT_DIR/review-checks" scripts/pipeline/execute-pipeline.sh`
- **expected:** parses; CHECKS_DIR points at PROJECT_DIR-relative path; runtime existence check present; no old `$SCRIPT_DIR/review-checks` references

### Task 6: Sed-pass on ~15 cross-references to `scripts/review-checks/`

- **files:** all per audit §5.2 — `CLAUDE.md`, `.claude/rules/execution-pipeline.md`, `.claude/rules/available-skills.md`, `.claude/skills/frontend-bug-bounty/SKILL.md`, `.claude/skills/amplify-bug-bounty/SKILL.md`, plus possibly docs/specs/* (now at `.iago/_config/specs/` post docs/03)
- **action:** Sed-pass:
  ```bash
  TARGETS=$(grep -rln "scripts/review-checks/" --include="*.md" --exclude-dir=_archive --exclude-dir=.worktrees .)
  for f in $TARGETS; do
    sed -i 's|scripts/review-checks/|.iago/_config/review-checks/|g' "$f"
  done
  ```
  Skip `.iago/_archive/`, `.iago/research/2026-05-*` (historical references in audit/research files — leave as-is).
- **verify:** `! grep -rln "scripts/review-checks/" --include="*.md" --exclude-dir=_archive --exclude-dir=.worktrees .`
- **expected:** zero live references to old path

### Task 7: Smoke-test pipeline runs

- **files:** (verification only)
- **action:** `bash -n scripts/pipeline/execute-pipeline.sh` (parses). Run `scripts/tests/test-pipeline-helpers.sh` (must complete without "no such file"). Verify hooks still fire (Plan 01's settings.json update should already point at new hook paths). End-to-end check: spawn a no-op /iago-fast or read scripts/pipeline/lib/pipeline-telemetry.sh and confirm it parses.
- **verify:** `bash -n scripts/pipeline/execute-pipeline.sh && bash -n scripts/pipeline/lib/pipeline-telemetry.sh && bash -n scripts/pipeline/lib/build-gate.sh`
- **expected:** all pipeline scripts parse cleanly

### Task 8: Final verification + scripts/ end-state

- **files:** (verification only)
- **action:** Confirm `scripts/` contains only `pipeline/, setup/, ops/, tests/` subdirs — no loose files at scripts/ root. `ls scripts/` should show exactly 4 directories.
- **verify:** `[ "$(ls scripts/ | wc -l)" = "4" ] && [ "$(ls -d scripts/*/ | wc -l)" = "4" ]`
- **expected:** scripts/ has exactly 4 subdirs, no loose files

## Stress Test

**Verdict:** **PROCEED_WITH_NOTES** (initial verdict BLOCK; criticals fixed inline; revised verdict PROCEED_WITH_NOTES)
**Date:** 2026-05-25
**Reviewer:** analyst (opus, read-only)

### Critical (all fixed in this plan revision)
- **C1+C2: `CHECKS_DIR="$SCRIPT_DIR/review-checks"` at execute-pipeline.sh line ~148 breaks post-move.** `.iago/_config/review-checks/` is OUTSIDE `$SCRIPT_DIR` (which becomes `scripts/pipeline/` after Task 2), so self-freeze copies an empty review-checks bundle. `bash -n` passes (Task 7's only smoke test); runtime silently disables all review modules. **Fixed:** Task 5 now has explicit Step B repointing `CHECKS_DIR` to `$PROJECT_DIR/.iago/_config/review-checks` (computed via `CLAUDE_PROJECT_DIR` env or `git rev-parse --show-toplevel`) + Step C adding runtime existence check that fails-fast with diagnostic output.
- **C3: `rmdir scripts/review-checks` fails under `set -e` if a `.gitkeep` or dotfile remains.** **Fixed:** Task 4 now has hidden-file sweep (git-mv tracked dotfiles, rm untracked ones) BEFORE `rmdir`.

### Important (fixed in this plan revision)
- **I3: Task 6 sed-pass only checks `*.md` files; misses `.json`, `.sh`, `.ts`.** **Fixed:** Task 6 sweep widened to `--include="*.md" --include="*.sh" --include="*.json"` (CLAUDE.md and skills are .md; settings.json is .json; scripts/lib helpers are .sh).
- **I1: `metrics-aggregate.mjs` classification confirmed** — at scripts/ root, moves to ops/ per Task 3. No conflict with `lib/metrics-aggregate.test.sh` (different file, different target). Documented.

### Minor (acknowledged)
- **M1: `pipeline/lib/` nesting** confirmed correct — lib/ is sourced exclusively by execute-pipeline.sh, so nesting under pipeline/ is appropriate.
- **M2: `ls scripts/ | wc -l = 4`** could be fragile to stray dotfiles; the second-half check (`ls -d scripts/*/ | wc -l = 4`) is the safer assertion.

## Verification

```bash
test -d scripts/pipeline && test -d scripts/setup && test -d scripts/ops && test -d scripts/tests
test -f scripts/pipeline/execute-pipeline.sh
test -d scripts/pipeline/lib && [ "$(ls scripts/pipeline/lib/*.sh | wc -l)" -ge "5" ]
test -d .iago/_config/review-checks && [ "$(ls .iago/_config/review-checks/*.md | wc -l)" = "11" ]
! test -d scripts/lib
! test -d scripts/review-checks
! test -f scripts/execute-pipeline.sh  # moved into pipeline/
! grep -rln "scripts/review-checks/" --include="*.md" --exclude-dir=_archive --exclude-dir=.worktrees .
bash -n scripts/pipeline/execute-pipeline.sh
```
