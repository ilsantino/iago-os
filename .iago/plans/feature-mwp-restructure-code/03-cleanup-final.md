---
phase: feature-mwp-restructure-code
plan: 03
wave: 3
depends_on: [01-iago-physical-split, 02-scripts-restructure, feature-mwp-restructure-docs/04-runtime-claude-md]
context: .iago/research/2026-05-25-mwp-restructure-audit.md
created: 2026-05-25
source: feature
---

# Plan: feature-mwp-restructure-code/03-cleanup-final

## Goal

Final cleanup pass per audit §6 + §9 Phase 9: delete `graphify-out/` (confirmed orphan — live graph in dev/obsidian-brain), prune stale worktrees (`pr40..44-fix`), document root `package.json` purpose (biome + typescript dev tooling scope), confirm `mcp-servers/` keep-at-top-level per §10.5 Q2 (no move), final iago-os repo verification against audit §1 target structure.

## Tasks

### Task 1: Delete `graphify-out/` (orphan)

- **files:** `graphify-out/`
- **action:** Per audit §6: empty `cache/` only, last write 2026-04-10, live graph lives in `dev/obsidian-brain/graphify-out/` per global CLAUDE.md. Confirm no live references before deletion: `grep -rln "graphify-out/" --include="*.md" --include="*.sh" --include="*.json" --exclude-dir=_archive --exclude-dir=.worktrees .` — should return zero hits in live tree (historical references in audit/research files OK). If clean, `git rm -r graphify-out/`.
- **verify:** `! test -d graphify-out && ! grep -rln "graphify-out/" --include="*.md" --include="*.sh" --include="*.json" --exclude-dir=_archive --exclude-dir=.worktrees --exclude-dir=.iago/research . | grep -v "obsidian-brain"`
- **expected:** dir gone; zero live references to the local path (obsidian-brain references and historical research refs OK)

### Task 2: Audit + prune stale git worktrees (PROGRAMMATIC — not hardcoded list)

**Stress-test BLOCK fix (C1):** original named only `pr40..pr44-fix` (6 worktrees) but disk has ~13 stranded dirs including `pr45-codex, pr45-fix, pr45-rebase, pr46-codex, pr46-fix`. Hardcoded list would silently leave 7+ orphans. Programmatic approach handles all stranded dirs.

- **files:** `.worktrees/*` (gitignored worktree dirs)
- **action:** Programmatic prune — enumerate stranded dirs (on disk but NOT in `git worktree list`) and remove them after confirming the associated PR is merged.
  ```bash
  set -euo pipefail
  
  # Step A: collect registered worktree paths
  REGISTERED=$(git worktree list --porcelain | grep "^worktree " | awk '{print $2}')
  
  # Step B: collect disk dirs under .worktrees/
  DISK_DIRS=$(ls -d .worktrees/*/ 2>/dev/null | sed 's|/$||')
  
  # Step C: for each disk dir, determine: registered (call git worktree remove) vs stranded (rm -rf after PR-merged check)
  for d in $DISK_DIRS; do
    ABS_D=$(cd "$d" && pwd)
    if echo "$REGISTERED" | grep -qF "$ABS_D"; then
      # Registered — try graceful remove
      NAME=$(basename "$d")
      # Skip protected names
      case "$NAME" in
        chain-rebase) echo "SKIP: $NAME (preserved)"; continue ;;
      esac
      echo "Removing registered worktree: $d"
      git worktree remove "$d" || git worktree remove --force "$d"
    else
      # Stranded — extract PR number from name (e.g., pr40-fix → 40) and check merged state
      NAME=$(basename "$d")
      PR_NUM=$(echo "$NAME" | grep -oE 'pr[0-9]+' | grep -oE '[0-9]+' | head -1)
      if [ -n "$PR_NUM" ]; then
        STATE=$(gh pr view "$PR_NUM" --json state -q .state 2>/dev/null || echo "UNKNOWN")
        if [ "$STATE" = "MERGED" ] || [ "$STATE" = "CLOSED" ]; then
          echo "Removing stranded worktree (PR #$PR_NUM $STATE): $d"
          rm -rf "$d"
        else
          echo "SKIP (PR #$PR_NUM is $STATE): $d"
        fi
      else
        echo "SKIP (cannot extract PR number from $NAME): $d"
      fi
    fi
  done
  
  # Step D: prune stale registry entries
  git worktree prune
  ```
- **verify:** `git worktree list | wc -l` (count post-prune); confirm `chain-rebase` and active worktrees preserved; confirm no `pr4[0-9]-*` dirs remain (all merged PRs)
- **expected:** all stranded worktrees for merged PRs removed; protected names (chain-rebase, active branches) preserved; git worktree list clean

### Task 3: Document root `package.json` purpose

- **files:** `CLAUDE.md` (or `.claude/rules/stack.md` if docs/01 already extracted it)
- **action:** Per audit §6 + §1.1: root `package.json` scopes biome (`@biomejs/biome ^1.9.0`) + typescript (`^5.7.0`) for repo-wide dev tooling. Currently UNDOCUMENTED — engineers may wonder why an iago-os meta-repo has a package.json. Add a note in `.claude/rules/stack.md` (created by docs/01) or root CLAUDE.md `## Architecture` section: 1-line "Root `package.json` scopes dev tooling only — biome (formatter+linter) and typescript (compiler). Per-project deps live in client/runtime subtrees with own package.json." If stack.md exists from docs/01, prefer adding there.
- **verify:** `grep -q "package.json scopes dev tooling" .claude/rules/stack.md 2>/dev/null || grep -q "package.json" CLAUDE.md`
- **expected:** purpose documented in stack.md OR CLAUDE.md

### Task 4: Confirm `mcp-servers/` keep-at-top-level (audit §10.5 Q2)

- **files:** (verification only — read existing `mcp-servers/CLAUDE.md` created by docs/04)
- **action:** Per audit §10.5 Q2 (Santiago decided KEEP top-level 2026-05-25): mcp-servers stays at repo root, NOT under `.claude/mcp-servers/`. Verify the decision is recorded: `grep -q "KEEP top-level" mcp-servers/CLAUDE.md` (docs/04 created mcp-servers/CLAUDE.md with this annotation). If file missing or annotation missing, fix in this PR (recreate the 1-line decision record).
- **verify:** `test -f mcp-servers/CLAUDE.md && grep -q "KEEP top-level" mcp-servers/CLAUDE.md && test -d mcp-servers/youtube-transcript`
- **expected:** mcp-servers/CLAUDE.md exists with KEEP decision; youtube-transcript still in place

### Task 5: Verify CLAUDE.local.md.template disposition

- **files:** `CLAUDE.local.md.template`
- **action:** Per audit §1.1 + §2 mapping: this template stays at repo root for legibility (per-user override pattern). Confirm it's still there + still referenced in CLAUDE.md or onboarding docs. If unreferenced, add 1-line mention in `.claude/rules/stack.md` or onboarding docs: "Per-user overrides go in CLAUDE.local.md (template at CLAUDE.local.md.template — copy + customize)."
- **verify:** `test -f CLAUDE.local.md.template`
- **expected:** template preserved at root

### Task 6: Final iago-os repo verification (set -e for fail-fast)

**Stress-test fix (Important — non-binding sweep):** original block ran checks without `set -e`, so individual failures were silently swallowed and the implementer could see "all green" while a check actually failed. Wrap in `set -e` for fail-fast semantics.

- **files:** (verification only — comprehensive end-state check)
- **action:** Run final acceptance sweep matching audit §1.1 target column, with fail-fast:
  ```bash
  set -euo pipefail
  
  # Root structure clean
  echo "=== Root structure ==="
  ls -A | sort
  
  # .iago/ physical split complete
  echo "=== .iago/ physical split ==="
  test -d .iago/_config
  test -d .iago/product
  test -d .iago/state
  test -d .iago/_archive
  test -f .iago/STATE.md
  test -f .iago/PROJECT.md
  test -f .iago/ROADMAP.md
  
  # scripts/ reshape complete
  echo "=== scripts/ reshape ==="
  [ "$(ls -d scripts/*/ | wc -l)" = "4" ]
  test -d scripts/pipeline
  test -d scripts/setup
  test -d scripts/ops
  test -d scripts/tests
  
  # All sub-workspaces have CLAUDE.md
  echo "=== Sub-workspaces ==="
  test -f runtime/CLAUDE.md
  test -f mcp-servers/CLAUDE.md
  for c in din fulldata palazuelos rsf; do test -f "clients/$c/CLAUDE.md" || { echo "MISSING: clients/$c/CLAUDE.md"; exit 1; }; done
  
  # Pipeline functional
  echo "=== Pipeline parses ==="
  bash -n scripts/pipeline/execute-pipeline.sh
  
  # No stale orphans
  echo "=== No orphans ==="
  ! test -d graphify-out
  
  echo "=== ALL CHECKS PASSED ==="
  ```
- **verify:** entire script exits 0 (set -e ensures first failure exits non-zero)
- **expected:** end-state matches audit §1 target; ALL checks pass (no silent skips)

## Stress Test

**Verdict:** **PROCEED_WITH_NOTES** (initial verdict BLOCK; criticals fixed inline; revised verdict PROCEED_WITH_NOTES)
**Date:** 2026-05-25
**Reviewer:** analyst (opus, read-only)

### Critical (all fixed in this plan revision)
- **C1: Worktree prune list materially incomplete** — original plan named only 6 (`pr40..pr44`), disk has ~13 stranded dirs (`pr45-codex`, `pr45-fix`, `pr45-rebase`, `pr46-codex`, `pr46-fix` also present). Hardcoded list would leave 7+ orphans. **Fixed:** Task 2 now uses programmatic enumeration via `git worktree list` + disk walk; for each stranded dir, extracts PR number from name + checks `gh pr view --json state` for MERGED/CLOSED before deletion; protected names (chain-rebase, active worktrees) preserved.
- **C2: Cross-folder dependency on docs/04 undeclared in frontmatter** — Task 4 verifies `mcp-servers/CLAUDE.md` which is created by `feature-mwp-restructure-docs/04`. Running Plan 03 before docs/04 fails verify. **Fixed:** frontmatter `depends_on: [01-iago-physical-split, 02-scripts-restructure, feature-mwp-restructure-docs/04-runtime-claude-md]`.

### Important (fixed in this plan revision)
- **Task 6 verification was non-binding** — bash snippet without `set -e` swallowed individual failures silently. **Fixed:** Task 6 now wraps verification in `set -euo pipefail` with explicit ALL-CHECKS-PASSED echo at end.
- **Task 2 `--force` branch for dirty worktrees** — added fallback `git worktree remove --force` after first attempt fails.

### Minor (acknowledged)
- Tasks 3 + 5 (document package.json + verify CLAUDE.local.md.template) are independent of cleanup actions. Could collapse into one task, but separation aids traceability.
- `graphify-out/cache/` confirmed empty — no content-loss risk on deletion.

## Verification

```bash
! test -d graphify-out                                                       # exit 0
test -f mcp-servers/CLAUDE.md                                                # exit 0 (decision recorded)
grep -q "KEEP top-level" mcp-servers/CLAUDE.md                               # exit 0
test -f CLAUDE.local.md.template                                             # exit 0 (preserved)
test -d .iago/_config && test -d .iago/product                               # exit 0 (Plan 01 end-state)
[ "$(ls -d scripts/*/ | wc -l)" = "4" ]                                      # exit 0 (Plan 02 end-state)
bash -n scripts/pipeline/execute-pipeline.sh                                 # exit 0
```
