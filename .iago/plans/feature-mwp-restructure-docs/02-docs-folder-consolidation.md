---
phase: feature-mwp-restructure-docs
plan: 02
wave: 2
depends_on: [01]
context: .iago/research/2026-05-25-mwp-restructure-audit.md
created: 2026-05-25
source: feature
---

# Plan: feature-mwp-restructure-docs/02-docs-folder-consolidation

## Goal

Collapse the `docs/` dumping ground per audit §1.4: archive 33 historical files into `.iago/_archive/{plans,research,specs}/`, move automations to runbooks, move industry patterns to `.claude/rules/patterns/`, merge the 6 root MDs (ARCHITECTURE/SETUP/MANUAL/WORKFLOW/GITHUB-PIPELINE/IAGO-DASHBOARD) into their canonical homes or relocate, and verify zero `.md` files survive at `docs/` root. After this plan: `docs/` directory either contains only `specs/` (handled by Plan 03) or is empty and ready for Plan 03's cleanup.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create (dirs) | `.iago/_archive/plans/`, `.iago/_archive/research/`, `.iago/_archive/specs/`, `.iago/_config/runbooks/automations/`, `.claude/rules/patterns/` | new homes per audit §1.4 |
| move | `docs/archive/plans/*` → `.iago/_archive/plans/2026-04-historical/` | 9 historical plan files (agent-v2-0{1..4}-{plan,summary}.md + adversarial-review-fixes-plan.md) |
| move | `docs/archive/research/*` → `.iago/_archive/research/2026-04-historical/` | **28** historical decision/research files (DECISION-*.md set + SPRINT-STATUS.md) |
| move | `docs/archive/specs/*` → `.iago/_archive/specs/2026-04-historical/` | 2 archived specs (agent-architecture-v2, review-pipeline-control) |
| move | `docs/research/*` → `.iago/_archive/research/2026-04-research/` | 5 files (claude-agent-sdk, hermes-agent, paperclip-transcript, etc.) — decisions baked into v2 vision |
| move | `docs/automations/*` → `.iago/_config/runbooks/automations/` | 2 files (cross-session-pipeline, trigger-templates) — runbook-shaped |
| move | `docs/patterns/*.md` → `.claude/rules/patterns/` | 8 industry patterns (carrier, customs, energy, inventory, logistics, production, quality, returns) |
| modify | `.claude/skills/industry-patterns/SKILL.md` | update reference paths from `docs/patterns/` to `.claude/rules/patterns/` |
| move | `docs/IAGO-DASHBOARD.md` → `.iago/_config/runbooks/dashboard.md` | ops runbook home |
| delete | `docs/SETUP.md` | content folds into README.md `## Quick start` (already exists per audit §3.8) |
| delete | `docs/MANUAL.md` | content folds into README.md (already exists per audit §3.8) |
| delete | `docs/WORKFLOW.md` | content folds into `.claude/rules/execution-pipeline.md` (already exists per audit §3.6) |
| delete | `docs/GITHUB-PIPELINE.md` | content folds into `.claude/rules/execution-pipeline.md` (already exists per audit §3.7) |
| delete or move | `docs/ARCHITECTURE.md` | DELETE if duplicates `docs/specs/iago-os-v2-vision.md` (verify in Task 7); else MOVE to `.iago/_config/architecture.md` |

## Tasks

### Task 1: Scaffold target directories

- **files:** `.iago/_archive/plans/`, `.iago/_archive/research/`, `.iago/_archive/specs/`, `.iago/_config/runbooks/automations/`, `.claude/rules/patterns/`
- **action:** Create the 5 target directories. Use `mkdir -p` so existing `.iago/_config/runbooks/` is preserved. Add a `README.md` to `.iago/_archive/` explaining the archive convention (1-line pointer to `.claude/rules/execution-pipeline.md` § Plan archive convention; explicitly notes: `_archive/` is tracked, not gitignored, unlike `.iago/state/`).
- **verify:** `test -d .iago/_archive/plans && test -d .iago/_archive/research && test -d .iago/_archive/specs && test -d .iago/_config/runbooks/automations && test -d .claude/rules/patterns && test -f .iago/_archive/README.md`
- **expected:** all dirs exist, README present, exit 0

### Task 2: Move `docs/archive/*` into `.iago/_archive/`

- **files:** all files under `docs/archive/{plans,research,specs}/`
- **action:** Task 1 created the parent dirs `.iago/_archive/{plans,research,specs}/` but NOT the `2026-04-historical/` leaf. Stress-test flagged `git mv src dst` directory-into-existing-dir nesting: if leaf existed, mv would create `.iago/_archive/plans/plans/2026-04-historical/`. Safer form — create leaf first, then mv contents: `mkdir -p .iago/_archive/plans/2026-04-historical .iago/_archive/research/2026-04-historical .iago/_archive/specs/2026-04-historical && git mv docs/archive/plans/* .iago/_archive/plans/2026-04-historical/ && git mv docs/archive/research/* .iago/_archive/research/2026-04-historical/ && git mv docs/archive/specs/* .iago/_archive/specs/2026-04-historical/`. Use `git mv` (not raw `mv`) to preserve git history per audit §7.6. After: `rmdir docs/archive/{plans,research,specs} docs/archive` (each succeeds only if empty, confirming all moved).
- **verify:** `! test -d docs/archive && ls .iago/_archive/plans/2026-04-historical/*.md | wc -l && ls .iago/_archive/research/2026-04-historical/*.md | wc -l && ls .iago/_archive/specs/2026-04-historical/*.md | wc -l`
- **expected:** docs/archive does not exist; counts are 9, **28**, 2 respectively (stress-test correction: audit §1.4 said 22 for research but disk has 28 — DECISION-*.md set is 27 files + SPRINT-STATUS.md = 28)

### Task 3: Move `docs/research/*` → `.iago/_archive/research/2026-04-research/`

- **files:** 5 files under `docs/research/` (agent-sdk-integration-architecture.md, claude-agent-sdk.md, claude-platform-agent-deployment.md, hermes-agent.md, paperclip-transcript.txt)
- **action:** `mkdir -p .iago/_archive/research/2026-04-research && git mv docs/research/* .iago/_archive/research/2026-04-research/`. Then `rmdir docs/research` (only succeeds if empty).
- **verify:** `! test -d docs/research && ls .iago/_archive/research/2026-04-research/ | wc -l`
- **expected:** docs/research does not exist; count is 5

### Task 4: Move `docs/automations/*` → `.iago/_config/runbooks/automations/`

- **files:** 2 files under `docs/automations/`
- **action:** `git mv docs/automations/* .iago/_config/runbooks/automations/`. Then `rmdir docs/automations`.
- **verify:** `! test -d docs/automations && ls .iago/_config/runbooks/automations/ | wc -l`
- **expected:** docs/automations does not exist; count is 2

### Task 5: Move `docs/patterns/*.md` → `.claude/rules/patterns/` and update `/industry-patterns` skill

- **files:** 8 files under `docs/patterns/`; `.claude/skills/industry-patterns/SKILL.md`
- **action:** `git mv docs/patterns/*.md .claude/rules/patterns/`. Then `rmdir docs/patterns`. Open `.claude/skills/industry-patterns/SKILL.md` and replace every occurrence of `docs/patterns/` with `.claude/rules/patterns/` (use `grep -n "docs/patterns" .claude/skills/industry-patterns/SKILL.md` first to enumerate). Also update `.claude/rules/available-skills.md` if it references the path.
- **verify:** `! test -d docs/patterns && ls .claude/rules/patterns/*.md | wc -l && ! grep -rn "docs/patterns" .claude/skills/industry-patterns/SKILL.md .claude/rules/available-skills.md && grep -q "rules/patterns" .claude/skills/industry-patterns/SKILL.md`
- **expected:** docs/patterns does not exist; 8 patterns present; ZERO references to old `docs/patterns/` AND ≥1 positive reference to new `.claude/rules/patterns/` (catches accidental wrong-casing or relative-path mistakes the negative grep misses)

### Task 6: Move `docs/IAGO-DASHBOARD.md` → `.iago/_config/runbooks/dashboard.md` (and fix internal cross-ref to ARCHITECTURE.md)

- **files:** `docs/IAGO-DASHBOARD.md`, `.iago/_config/runbooks/dashboard.md`
- **action:** Before moving: `grep -n "docs/ARCHITECTURE" docs/IAGO-DASHBOARD.md` — IAGO-DASHBOARD.md cross-references docs/ARCHITECTURE.md (stress-test finding). Edit IAGO-DASHBOARD.md to update any `docs/ARCHITECTURE.md` reference to the destination path Task 7 will resolve to (either `.iago/_config/architecture.md` if Task 7 moves it, or remove the link if Task 7 deletes it as dupe). Then `git mv docs/IAGO-DASHBOARD.md .iago/_config/runbooks/dashboard.md`. Sweep other references: `grep -rln "docs/IAGO-DASHBOARD" --include="*.md" --exclude-dir=_archive --exclude-dir=.worktrees .` and update each.
- **verify:** `! test -f docs/IAGO-DASHBOARD.md && test -f .iago/_config/runbooks/dashboard.md && ! grep -rln "docs/IAGO-DASHBOARD" --include="*.md" --exclude-dir=_archive --exclude-dir=.worktrees .`
- **expected:** old path gone; new path exists; zero stale references in live tree

### Task 7: Resolve `docs/ARCHITECTURE.md` (delete-if-dupe or move)

- **files:** `docs/ARCHITECTURE.md`, `docs/specs/iago-os-v2-vision.md` (read-only for comparison)
- **action:** Read both files. If `docs/ARCHITECTURE.md` content is substantially covered by `docs/specs/iago-os-v2-vision.md` (e.g., ≥80% of substantive paragraphs overlap), `git rm docs/ARCHITECTURE.md` — no need to preserve. Otherwise `git mv docs/ARCHITECTURE.md .iago/_config/architecture.md`. Write a 2-line note in the plan summary explaining which path was taken and why. Update any `grep -rln "docs/ARCHITECTURE" --include="*.md"` references.
- **verify:** `! test -f docs/ARCHITECTURE.md && (test -f .iago/_config/architecture.md || true)`
- **expected:** docs/ARCHITECTURE.md does not exist; either `.iago/_config/architecture.md` exists OR it was determined a dupe and deleted

### Task 8: Delete WORKFLOW/GITHUB-PIPELINE/SETUP/MANUAL after merge + update README dead links + final verification

- **files:** `docs/SETUP.md`, `docs/MANUAL.md`, `docs/WORKFLOW.md`, `docs/GITHUB-PIPELINE.md`, `README.md` (merge target AND has dead links to update), `.claude/rules/execution-pipeline.md` (merge target)
- **action:** Step A (merge unique content): For each of SETUP/MANUAL: read content; identify the 1-2 paragraphs not already in `README.md` `## Quick start` or `## Prerequisites`; APPEND unique paragraphs to README.md if any; `git rm docs/SETUP.md docs/MANUAL.md`. For each of WORKFLOW/GITHUB-PIPELINE: read; identify content not already in `.claude/rules/execution-pipeline.md`; append unique content if any; `git rm docs/WORKFLOW.md docs/GITHUB-PIPELINE.md`. Step B (CRITICAL — fix dead README links per stress-test): `grep -n "docs/SETUP\|docs/MANUAL\|docs/WORKFLOW\|docs/GITHUB-PIPELINE" README.md` to enumerate. README currently links these at lines ~125 and 493-501 (`## Documentation` section). For each link: either remove the link entirely (if content is now in the linked-to canonical home) or replace with link to canonical home (e.g., `docs/SETUP.md` → `README.md` quick-start anchor; `docs/WORKFLOW.md` → `.claude/rules/execution-pipeline.md`). Step C (final verification): `ls docs/*.md 2>/dev/null | wc -l` must equal 0 (specs/ subdir handled by Plan 03).
- **verify:** `! test -f docs/SETUP.md && ! test -f docs/MANUAL.md && ! test -f docs/WORKFLOW.md && ! test -f docs/GITHUB-PIPELINE.md && [ "$(ls docs/*.md 2>/dev/null | wc -l)" = "0" ] && ! grep -E "docs/(SETUP|MANUAL|WORKFLOW|GITHUB-PIPELINE)\.md" README.md`
- **expected:** all four files deleted; zero MD files at `docs/` root; README has zero links to the deleted files

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-25
**Reviewer:** analyst (opus, read-only)

### Critical (all fixed in this plan revision)
- **C1: archive/research file count was wrong (22 vs disk's 28).** Audit §1.4 said 22; disk has 27 DECISION-*.md files + SPRINT-STATUS.md = 28. Original Task 2 verify would fail. **Fixed:** Task 2 expected counts now `9, 28, 2`; Files table updated.
- **C2: README.md retains 4 dead links after Task 8 deletes SETUP/MANUAL/WORKFLOW/GITHUB-PIPELINE.** README lines ~125 and 493-501 link to the deleted files. Original Task 8 didn't address. **Fixed:** Task 8 now has explicit Step B "fix dead README links" with enumerate-and-replace instruction; final verify added `! grep -E "docs/(SETUP|MANUAL|WORKFLOW|GITHUB-PIPELINE)\.md" README.md`.
- **C3: `/industry-patterns` SKILL.md uses runtime Read of `docs/patterns/{domain}.md` path — negative grep can pass while path is silently broken.** **Fixed:** Task 5 verify adds positive `grep -q "rules/patterns"` alongside negative grep, catching wrong-casing or relative-path mistakes.

### Important (fixed in this plan revision)
- **I1: docs/IAGO-DASHBOARD.md ↔ docs/ARCHITECTURE.md cross-reference broken after Task 6.** **Fixed:** Task 6 now explicitly reads + updates IAGO-DASHBOARD.md's internal reference to ARCHITECTURE.md before moving.
- **I2: `git mv src dst` directory-into-existing-dir nests improperly.** **Fixed:** Task 2 now uses glob form (`git mv docs/archive/plans/*` ...) after `mkdir -p` of leaf, avoiding the nesting trap.
- **I3: stale-ref grep gap (4 deleted root MDs not in final sweep).** **Fixed:** final Verification grep includes SETUP|MANUAL|WORKFLOW|GITHUB-PIPELINE patterns + excludes `_archive` and `.worktrees` for clean signal.

### Minor (informational)
- Tasks 2-3 cannot be collapsed (single `git mv docs/archive .iago/_archive/2026-04-historical` would lose the plans/research/specs sub-naming the archive convention requires).
- Task 7 ARCHITECTURE.md decision (dupe-vs-move) requires judgment but is well-bounded and audit-trailed in the plan-summary note.

## Verification

After all 8 tasks complete:

```bash
ls docs/*.md 2>/dev/null | wc -l                             # 0
test -d .iago/_archive/plans/2026-04-historical              # exit 0
test -d .iago/_archive/research/2026-04-historical           # exit 0
test -d .iago/_archive/research/2026-04-research             # exit 0
test -d .iago/_archive/specs/2026-04-historical              # exit 0
test -d .iago/_config/runbooks/automations                   # exit 0
test -d .claude/rules/patterns                               # exit 0
ls .claude/rules/patterns/*.md | wc -l                       # 8
test -f .iago/_config/runbooks/dashboard.md                  # exit 0
! grep -rln "docs/patterns\|docs/IAGO-DASHBOARD\|docs/automations\|docs/archive\|docs/research\|docs/SETUP\|docs/MANUAL\|docs/WORKFLOW\|docs/GITHUB-PIPELINE" --include="*.md" --exclude-dir=_archive --exclude-dir=.worktrees .  # exit 0 (no stale refs to any deleted/moved doc)
! test -d docs/archive && ! test -d docs/research && ! test -d docs/automations && ! test -d docs/patterns         # exit 0
```

All commands exit as expected. After this plan, only `docs/specs/` remains as a subdirectory of `docs/` (Plan 03 handles it).
