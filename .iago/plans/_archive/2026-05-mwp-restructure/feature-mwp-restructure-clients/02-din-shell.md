---
phase: feature-mwp-restructure-clients
plan: 02
wave: 1
depends_on: []
context: .iago/research/2026-05-25-mwp-restructure-audit.md
created: 2026-05-25
source: feature
---

# Plan: feature-mwp-restructure-clients/02-din-shell

## Goal

Add MWP wrapper to `clients/din/` (Class B — wrapper iaGO + inner deliverable repo): CLAUDE.md (Layer 0), CONTEXT.md (Layer 1), physical L3/L4 split inside `clients/din/.iago/` (mirroring root convention), and rename the OneDrive-conflict-suffixed Excel file. Inner deliverable repo `clients/din/dinpro-app/` is OFF-LIMITS — no edits, no `git add` on its paths.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `clients/din/CLAUDE.md` | Layer 0 wrapper declaration |
| create | `clients/din/CONTEXT.md` | Layer 1 routing for din client work |
| create (dirs) | `clients/din/.iago/_config/`, `clients/din/.iago/product/`, `clients/din/.iago/_archive/` | physical L3/L4/archive split |
| move | `clients/din/.iago/{learnings, runbooks?}` → `clients/din/.iago/_config/` (if subdirs exist) | factory artifacts |
| move | `clients/din/.iago/{plans, summaries, reviews?}` → `clients/din/.iago/product/` (if subdirs exist) | product artifacts |
| move | `clients/din/DIN - BM 241016 (Manuel Sanchez's conflicted copy 2025-03-19).xlsx` → `clients/din/branding/DIN-BM-241016.xlsx` | resolve OneDrive conflict filename |

## Tasks

### Task 1: Create `clients/din/CLAUDE.md` (Layer 0)

- **files:** `clients/din/CLAUDE.md`
- **action:** Write Layer 0 declaration (~25 lines). Title: `# clients/din/ — DIN Pro Pricing Engagement (iaGO Wrapper)`. Paragraph: "Level B MWP sub-workspace inside iaGO-OS. Root workspace at `../../`. This wrapper holds iaGO-managed context (`.iago/`), branding assets (`branding/`), the original engagement brief (`PROMPT-DINpro-pricing-module.md`), and the source pricing spreadsheet (`branding/DIN-BM-241016.xlsx`). The actual deliverable lives in `dinpro-app/`, which is an INNER GIT REPO — iaGO PRs from iago-os MUST NOT edit any path under `dinpro-app/`." Then `## Layer routing` table: L0=this file, L1=`./CONTEXT.md`, L3=`./.iago/_config/` + `./branding/` + `./PROMPT-DINpro-pricing-module.md`, L4=`./.iago/product/` + `dinpro-app/` (inner repo, read-only context only). Then `## Hard rules`: 3 bullets — (1) inner-repo paths under `dinpro-app/` are owned by DIN's own commits; never `git add` them from iago-os PRs; (2) `branding/` assets are stable reference (Layer 3) — modify carefully; (3) plans for DIN work live in `./.iago/product/plans/{NN-phase-slug}/`, NOT in root `.iago/plans/`. Then `## Status`: 1-line pointer to `./.iago/STATE.md`.
- **verify:** `test -f clients/din/CLAUDE.md && wc -l clients/din/CLAUDE.md && grep -q "dinpro-app" clients/din/CLAUDE.md && grep -q "INNER GIT REPO" clients/din/CLAUDE.md`
- **expected:** file exists; 20-35 lines; inner-repo boundary explicit

### Task 2: Create `clients/din/CONTEXT.md` (Layer 1)

- **files:** `clients/din/CONTEXT.md`
- **action:** Write Layer 1 routing (~30 lines, mirror root `.iago/CONTEXT.md` shape). Title: `# clients/din/ — Workspace L1 Routing`. Section `## Doc-routing — where DIN-related artifacts live`: table with rows: (1) Phase plan → `./.iago/product/plans/{NN-phase-slug}/{NN}.md`; (2) Feature plan → `./.iago/product/plans/feature-{slug}/{NN}.md`; (3) Execution summary → `./.iago/product/summaries/{plan-slug}.md`; (4) Context / decision artifact → `./.iago/_config/context/{YYYY-MM-DD}-{slug}.md`; (5) Research → `./.iago/product/research/{YYYY-MM-DD}-{slug}.md`; (6) ADR → `./.iago/_config/decisions/{YYYY-MM-DD}-{slug}.md`; (7) Runbook → `./.iago/_config/runbooks/{slug}.md`; (8) Branding asset → `./branding/`; (9) Inner-deliverable-repo change → goes in `dinpro-app/`'s own PR (NOT here). Section `## Layer assignments — what each .iago/ subdir is`: small table (`_config/`=L3 factory, `product/`=L4 product, `state/`=runtime, `_archive/`=archived). Section `## Sibling artifacts at wrapper level`: `branding/` (L3 design system), `PROMPT-DINpro-pricing-module.md` (L3 original brief — stable reference), `dinpro-app/` (L4 inner deliverable repo — never edit from iago-os).
- **verify:** `test -f clients/din/CONTEXT.md && grep -q "^## Doc-routing" clients/din/CONTEXT.md && grep -q "^## Layer assignments" clients/din/CONTEXT.md`
- **expected:** file exists; routing + layer sections present

### Task 3: Scaffold physical `.iago/{_config, product, _archive}/` dirs

- **files:** `clients/din/.iago/_config/`, `clients/din/.iago/product/`, `clients/din/.iago/_archive/`
- **action:** `mkdir -p clients/din/.iago/_config clients/din/.iago/product clients/din/.iago/_archive`. Add a `clients/din/.iago/_config/README.md` (1-paragraph "factory: stable across runs; agents internalize as constraints; matches root `.iago/_config/` convention") and `clients/din/.iago/_archive/README.md` (1-paragraph "archived plans/decisions/research from completed phases").
- **verify:** `test -d clients/din/.iago/_config && test -d clients/din/.iago/product && test -d clients/din/.iago/_archive && test -f clients/din/.iago/_config/README.md`
- **expected:** all 3 dirs + 2 README files exist

### Task 4: Move L3 factory contents to `_config/`

- **files:** `clients/din/.iago/{learnings,context}/` (if they exist) → `clients/din/.iago/_config/{learnings,context}/`
- **action:** `git mv clients/din/.iago/learnings clients/din/.iago/_config/learnings` (file exists per audit §11.1: 2 files). `clients/din/.iago/context/` exists with 2 files (`01b-pricing-extended.md`, `02-simulation-shell.md`) → `git mv clients/din/.iago/context clients/din/.iago/_config/context`. If `clients/din/.iago/decisions/` or `clients/din/.iago/runbooks/` exist (per audit not present), skip. If `clients/din/.iago/config.json` exists, `git mv clients/din/.iago/config.json clients/din/.iago/_config/config.json`.
- **verify:** `test -d clients/din/.iago/_config/learnings && test -d clients/din/.iago/_config/context && [ "$(ls clients/din/.iago/_config/context/ | wc -l)" -ge "2" ]`
- **expected:** learnings/ and context/ moved; counts match audit (learnings=2 files, context=2 files)

### Task 5: Move L4 product contents to `product/`

- **files:** `clients/din/.iago/{plans,summaries}/` → `clients/din/.iago/product/{plans,summaries}/`
- **action:** `git mv clients/din/.iago/plans clients/din/.iago/product/plans` (subdir contains 3 phase folders with 5 plans each = 15 plan files per audit §11.1). `git mv clients/din/.iago/summaries clients/din/.iago/product/summaries` (2 files per audit). After moves: `ls clients/din/.iago/product/plans/` should show `01-pricing-core/`, `01b-pricing-extended/`, `02-simulation-shell/`.
- **verify:** `test -d clients/din/.iago/product/plans && [ "$(ls clients/din/.iago/product/plans/ | wc -l)" -ge "3" ] && test -d clients/din/.iago/product/summaries`
- **expected:** plans/ has ≥3 phase dirs (01-pricing-core, 01b-pricing-extended, 02-simulation-shell); summaries/ exists

### Task 6: Rename OneDrive-conflict-suffixed Excel file

- **files:** `clients/din/DIN - BM 241016 (Manuel Sanchez's conflicted copy 2025-03-19).xlsx` → `clients/din/branding/DIN-BM-241016.xlsx`
- **action:** **Pre-flight check** (stress-test safety): `test -f "clients/din/DIN - BM 241016 (Manuel Sanchez's conflicted copy 2025-03-19).xlsx" || exit 0`. If exists: `git mv "clients/din/DIN - BM 241016 (Manuel Sanchez's conflicted copy 2025-03-19).xlsx" clients/din/branding/DIN-BM-241016.xlsx`. The OneDrive "conflicted copy 2025-03-19" suffix is a sync artifact — the file IS the canonical pricing spreadsheet. New name drops the suffix; new location groups it with other branding/business reference assets.
- **verify:** `test -f clients/din/branding/DIN-BM-241016.xlsx && ! test -f "clients/din/DIN - BM 241016 (Manuel Sanchez's conflicted copy 2025-03-19).xlsx"`
- **expected:** new path exists; old conflict-named path gone

### Task 7: Verify inner repo untouched + document state/ disposition + empty-subdir handling

- **files:** (verification only — read git diff + state)
- **action:** **Step A (inner repo):** Confirm zero changes to `clients/din/dinpro-app/` from this plan. Run `git diff --name-only HEAD -- clients/din/dinpro-app/` — must return empty. Also confirm `clients/din/dinpro-app/.git` still exists. Additionally check inner-repo cleanliness (stress-test fix): `cd clients/din/dinpro-app && git status --porcelain` must produce empty output (no accidental commands ran inside the inner repo). **Step B (state/ stays put — stress-test fix):** `clients/din/.iago/state/` and its contents (`active-client.json` and `STATE.md` at `.iago/` root, `PROJECT.md` and `ROADMAP.md` at `.iago/` root) STAY IN PLACE — runtime/state/project-meta artifacts are NOT moved to `_config/` or `product/`. Per root `.iago/CONTEXT.md` convention, `state/` is runtime (gitignored except `STATE.md`); `PROJECT.md`/`ROADMAP.md`/`STATE.md` are project-meta files that stay at `.iago/` root for visibility. **Step C (empty subdirs — stress-test fix):** `clients/din/.iago/audits/`, `reviews/`, `runbooks/`, `specs/` are all currently empty directories. Leave them in place at `.iago/` root — they'll get populated as `product/` artifacts when activity resumes (the root .iago/ has these as L4 product per root CONTEXT.md, but for client-local .iago/ the convention is: empty top-level subdirs stay until first use, then migrate to `product/`).
- **verify:** `[ -z "$(git diff --name-only HEAD -- clients/din/dinpro-app/)" ] && test -d clients/din/dinpro-app/.git && test -f clients/din/.iago/STATE.md && test -f clients/din/.iago/PROJECT.md && test -f clients/din/.iago/ROADMAP.md && test -f clients/din/.iago/state/active-client.json`
- **expected:** inner repo clean and untouched; STATE.md/PROJECT.md/ROADMAP.md at `.iago/` root preserved; `state/active-client.json` preserved

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-25
**Reviewer:** analyst (opus, read-only)

### Important (fixed in this plan revision)
- **`state/` disposition silently omitted.** `clients/din/.iago/state/active-client.json` exists; original plan never addressed whether it moves to `_config/` or `product/` or stays. **Fixed:** Task 7 now explicitly documents that `state/` STAYS at `.iago/state/` (runtime convention from root `.iago/CONTEXT.md`) and verifies it's preserved.
- **`PROJECT.md`, `ROADMAP.md`, `STATE.md` at `.iago/` root unaddressed.** **Fixed:** Task 7 now explicitly documents they stay at `.iago/` root (project-meta visibility) and verifies presence.
- **Empty subdirs (`audits/`, `reviews/`, `runbooks/`, `specs/`) — fate unstated.** **Fixed:** Task 7 documents convention: empty subdirs stay until first use, then migrate to `product/`.
- **Inner-repo `git status` check missing from Task 7.** **Fixed:** Task 7 Step A adds `cd clients/din/dinpro-app && git status --porcelain` check (must be empty) — catches accidental commands run inside the inner repo.

### Minor (acknowledged)
- `git mv` partial-run safety: if `_config/learnings/` already exists from a prior partial run, `git mv` fails. Implementer should add `test -d ... || git mv` guards if re-running mid-failure.
- Xlsx rename single-file disk state confirmed; no competing canonical version to worry about.

## Verification

After all 7 tasks complete:

```bash
test -f clients/din/CLAUDE.md                                            # exit 0
test -f clients/din/CONTEXT.md                                           # exit 0
test -d clients/din/.iago/_config                                        # exit 0
test -d clients/din/.iago/product                                        # exit 0
test -d clients/din/.iago/product/plans/01-pricing-core                  # exit 0 (phase folder preserved through move)
test -f clients/din/branding/DIN-BM-241016.xlsx                          # exit 0
! test -f "clients/din/DIN - BM 241016 (Manuel Sanchez's conflicted copy 2025-03-19).xlsx"  # exit 0
[ -z "$(git diff --name-only HEAD -- clients/din/dinpro-app/)" ]         # exit 0 (inner repo untouched)
grep -q "INNER GIT REPO" clients/din/CLAUDE.md                           # exit 0 (boundary documented)
```

All exit as expected.
