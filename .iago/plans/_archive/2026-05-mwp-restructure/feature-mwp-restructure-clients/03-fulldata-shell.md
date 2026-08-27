---
phase: feature-mwp-restructure-clients
plan: 03
wave: 1
depends_on: []
context: .iago/research/2026-05-25-mwp-restructure-audit.md
created: 2026-05-25
source: feature
---

# Plan: feature-mwp-restructure-clients/03-fulldata-shell

## Goal

Add MWP wrapper to `clients/fulldata/` (Class C — data engagement; most-MWP-aligned client per audit §11.2). The existing `_inputs/_processing/out/0N_*/` numbered-stage layout IS already MWP-shaped — this plan canonicalizes it via CLAUDE.md + CONTEXT.md rather than introducing a competing `.iago/` skeleton. Cleanup: delete Excel temp file, gitignore log files. Inner deliverable repo `clients/fulldata/web-pricing-mock/` is OFF-LIMITS.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `clients/fulldata/CLAUDE.md` | Layer 0 wrapper declaration |
| create | `clients/fulldata/CONTEXT.md` | Layer 1 routing — canonicalizes existing `_inputs/_processing/out/0N_*/` as the per-stage MWP layout |
| create | `clients/fulldata/.gitignore` | gitignore `~$*.xlsx` Excel temp files + `_processing/scripts/*.log` |
| delete | `clients/fulldata/~$ops-hub.xlsx` | Excel temp/lock file (artifact of open Excel session) |

## Tasks

### Task 1: Create `clients/fulldata/CLAUDE.md` (Layer 0)

- **files:** `clients/fulldata/CLAUDE.md`
- **action:** Write Layer 0 declaration (~30 lines). Title: `# clients/fulldata/ — FullData Logistics Engagement (Data + Strategy)`. Paragraph: "Level B MWP sub-workspace inside iaGO-OS. Root workspace at `../../`. This is a **data + strategy engagement**, not a code-delivery engagement. The wrapper layout follows a **numbered-stage MWP convention** that predates iaGO scaffolding: `_inputs/` (source material from client) → `_processing/` (transcripts, scripts, intermediate analysis) → `out/0N_*/` (per-stage deliverables in execution order). Each `out/0N_*/` folder is a stage in the MWP sense — read-only inputs come from prior stages, products land in the current stage's folder. The `web-pricing-mock/` directory is an INNER GIT REPO (small demo deliverable for client) — iaGO PRs from iago-os MUST NOT edit any path under `web-pricing-mock/`." Then `## Layer routing` table mapping iaGO L0-L4 to this client's existing folders: L0=this file, L1=`./CONTEXT.md`, L2 (stage contracts — implicit in `out/0N_*/README.md` if present, else stage purpose lives in the folder name), L3 (reference)=`./_processing/fulldata-prompt-construction.md`, L4 (working artifacts)=`./_inputs/`, `./_processing/{transcripts,scripts}/`, `./out/0N_*/`. Then `## Hard rules`: (1) `web-pricing-mock/` is inner repo — never edit from iago-os; (2) DO NOT create a `.iago/plans/` skeleton — fulldata's stage layout IS its plan namespace; (3) when adding new stage outputs, follow the existing `out/0N_{name}/` numbering convention.
- **verify:** `test -f clients/fulldata/CLAUDE.md && wc -l clients/fulldata/CLAUDE.md && grep -q "web-pricing-mock" clients/fulldata/CLAUDE.md && grep -q "INNER GIT REPO" clients/fulldata/CLAUDE.md && grep -q "numbered-stage" clients/fulldata/CLAUDE.md`
- **expected:** file exists; 25-40 lines; inner-repo boundary explicit; numbered-stage convention named

### Task 2: Create `clients/fulldata/CONTEXT.md` (Layer 1 — canonicalize existing layout, **7 stages incl. branding**)

- **files:** `clients/fulldata/CONTEXT.md`
- **action:** Write Layer 1 routing (~40 lines). Title: `# clients/fulldata/ — Workspace L1 Routing (numbered-stage MWP convention)`. Paragraph: "This client uses a numbered-stage MWP layout that maps directly to the ICM paper's `01_research/`/`02_script/`/`03_production/` example, but expanded for a multi-stream data + strategy engagement." Then `## Stages` table: columns `Stage folder | Purpose | Inputs (from where) | Outputs (to where) | Last review`. **Rows (stress-test fix — 7 stages, was 6; `out/branding/` was missing):** (1) `out/00_inventory/` | discovery | `_inputs/` | `out/00_inventory/00_*.md` | (date); (2) `out/01_research/` | research | `_inputs/pdfs/` + `_processing/transcripts/` + `out/00_inventory/` | `out/01_research/{crosscheck,legal,market,partners,prompts,sources,validation}/` | (date); (3) `out/02_business/` | business decisions | `out/01_research/` | `out/02_business/{decisions,icp-research}/` | (date); (4) `out/02_executive/` | executive views | `out/02_business/` | `out/02_executive/` | (date); (5) `out/03_dev/` | development specs | `out/02_business/` | `out/03_dev/` | (date); (6) `out/03_meetings/` | meeting outputs | inputs/audios + transcripts | `out/03_meetings/` | (date); (7) `out/branding/` | brand assets (undated, parallel to numbered stages) | client materials | `out/branding/` | n/a. Then `## Doc routing — where new fulldata artifacts go`: (1) New source material → `_inputs/{audios,data-export,pdfs,videos}/`; (2) New transcript → `_processing/transcripts/`; (3) New analysis script → `_processing/scripts/`; (4) New research deliverable → `out/01_research/{subarea}/`; (5) New business decision/analysis → `out/02_business/{decisions|icp-research}/`; (6) New dev spec → `out/03_dev/`; (7) New meeting output → `out/03_meetings/`; (8) New brand asset → `out/branding/`; (9) Pre-iaGO legacy artifact → `out/0N_*/`_legacy_pre_iago/`. Then `## Sibling artifacts at wrapper level`: `ops-hub.xlsx` (canonical operations spreadsheet — Layer 3 reference for current operational state), `web-pricing-mock/` (inner deliverable repo — never edit from iago-os).
- **verify:** `test -f clients/fulldata/CONTEXT.md && grep -q "^## Stages" clients/fulldata/CONTEXT.md && grep -q "out/00_inventory" clients/fulldata/CONTEXT.md && grep -q "out/branding" clients/fulldata/CONTEXT.md && grep -q "web-pricing-mock" clients/fulldata/CONTEXT.md`
- **expected:** file exists; Stages section present; all 7 stage folders listed (incl. branding); inner-repo boundary present

### Task 3: Create `clients/fulldata/.gitignore` (use REAL newlines via heredoc, NOT literal `\n`)

- **files:** `clients/fulldata/.gitignore`
- **action:** **Stress-test fix — use a proper bash heredoc with real line breaks**, NOT `\n` escape sequences (which would render as literal backslash-n in the file and break the gitignore patterns). Check if `clients/fulldata/.gitignore` already exists. If yes, append the new patterns; if no, create. Use this exact heredoc form:
  ```bash
  cat >> clients/fulldata/.gitignore <<'EOF'
  # Excel temp/lock files (created when Excel opens a workbook)
  ~$*.xlsx
  ~$*.xls
  
  # Processing scripts run logs (regenerable; not source-of-truth)
  _processing/scripts/*.log
  
  # (web-pricing-mock/ has its own .gitignore as an inner repo — NOT inherited)
  EOF
  ```
  The single-quoted `'EOF'` heredoc preserves the literal `~$` (no variable expansion). After write, verify file has multiple lines (not a single line with `\n` literals).
- **verify:** `test -f clients/fulldata/.gitignore && grep -q "^~\$\*\.xlsx$" clients/fulldata/.gitignore && grep -q "^_processing/scripts/\*\.log$" clients/fulldata/.gitignore && [ "$(wc -l < clients/fulldata/.gitignore)" -ge "6" ]`
- **expected:** gitignore exists with both patterns on SEPARATE LINES (line count ≥6 confirms real newlines; literal `\n` would produce 1 line)

### Task 4: Delete `~$ops-hub.xlsx` Excel temp file

- **files:** `clients/fulldata/~$ops-hub.xlsx`
- **action:** `test -f "clients/fulldata/~\$ops-hub.xlsx" || exit 0`. Then `git rm "clients/fulldata/~\$ops-hub.xlsx"` (if tracked) OR `rm "clients/fulldata/~\$ops-hub.xlsx"` (if untracked). This file is created by Excel when `ops-hub.xlsx` is opened in a live Excel session — usually a transient artifact that should never be committed. New `.gitignore` from Task 3 prevents recurrence.
- **verify:** `! test -f "clients/fulldata/~\$ops-hub.xlsx"`
- **expected:** file deleted

### Task 5: Verify gitignore catches logs + remediate already-tracked logs

- **files:** `clients/fulldata/_processing/scripts/*.log`
- **action:** **Stress-test fix — run `git check-ignore` from REPO ROOT with full path** (running from `cd clients/fulldata` with relative path produces wrong semantic because git walks up to find `.git` and re-resolves):
  ```bash
  # Verify .gitignore rule fires for new files (from repo root, full path)
  git check-ignore -v clients/fulldata/_processing/scripts/install.log
  ```
  Expected output names `clients/fulldata/.gitignore` and the rule line. **If logs are ALREADY tracked** (committed before .gitignore added — likely since they predate this plan): the .gitignore alone does NOT untrack them. Untrack with:
  ```bash
  # Check tracked state
  git ls-files clients/fulldata/_processing/scripts/*.log
  # If output is non-empty, the files are tracked — untrack without deleting:
  git rm --cached clients/fulldata/_processing/scripts/*.log
  ```
  After this, future regenerations land untracked (caught by the .gitignore). Local copies stay on disk.
- **verify:** `git check-ignore -v clients/fulldata/_processing/scripts/install.log 2>&1 | grep -q "\.gitignore" && [ -z "$(git ls-files clients/fulldata/_processing/scripts/install.log)" ]`
- **expected:** gitignore rule fires; AND log file is no longer in git index (either was never tracked, or `git rm --cached` ran successfully)

### Task 6: Document existing `_legacy_pre_iago/` convention

- **files:** `clients/fulldata/out/01_research/_legacy_pre_iago/README.md` (create if missing)
- **action:** Check if `clients/fulldata/out/01_research/_legacy_pre_iago/README.md` exists. If not, create with ~10 lines: title `# _legacy_pre_iago/ — pre-iaGO engagement artifacts`. Paragraph: "Research and strategy artifacts produced before iaGO took over the FullData engagement. Preserved as historical context for stage 01_research. New research goes in sibling stage folders (`market/`, `legal/`, `partners/`, `sources/`, etc.), NOT here. When citing a `_legacy_pre_iago/` doc in new work, treat it as an external source — quote it, don't extend it." This makes the `_legacy_pre_iago/` convention explicit for future stage agents.
- **verify:** `test -f clients/fulldata/out/01_research/_legacy_pre_iago/README.md && grep -q "pre-iaGO" clients/fulldata/out/01_research/_legacy_pre_iago/README.md`
- **expected:** README exists; convention documented

### Task 7: Verify inner repo untouched

- **files:** (verification only)
- **action:** Confirm zero changes to `clients/fulldata/web-pricing-mock/` from this plan. Run `git diff --name-only HEAD -- clients/fulldata/web-pricing-mock/` — must return empty. Confirm `clients/fulldata/web-pricing-mock/.git` still exists.
- **verify:** `[ -z "$(git diff --name-only HEAD -- clients/fulldata/web-pricing-mock/)" ] && test -d clients/fulldata/web-pricing-mock/.git`
- **expected:** zero diff inside web-pricing-mock/; inner .git still present

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-25
**Reviewer:** analyst (opus, read-only)

### Important (all fixed in this plan revision)
- **`out/branding/` missing from Stages table** (disk has 7 stage folders, table listed only 6). **Fixed:** Task 2 now has 7 rows including `out/branding/` (undated, parallel to numbered stages).
- **Literal `\n` in here-doc would NOT expand to real newlines** — would have produced a broken single-line gitignore. **Fixed:** Task 3 now uses proper bash heredoc form (`cat >> ... <<'EOF' ... EOF`) with real line breaks; verify checks `wc -l` ≥6 (literal `\n` would produce 1 line).
- **`git check-ignore` with `cd` + relative path is semantically wrong** (git walks up to repo root and re-resolves). **Fixed:** Task 5 now runs from repo root with full path `clients/fulldata/_processing/scripts/install.log`.
- **Already-tracked log files lacked remediation path.** **Fixed:** Task 5 now has explicit `git ls-files` check + `git rm --cached` branch with verify (`git ls-files` must be empty after).

### Minor (acknowledged)
- `! test -d clients/fulldata/.iago` as permanent assertion: documented as enforcement for THIS plan only; future workflows may need `.iago/` for different reasons.
- `~$ops-hub.xlsx` locked-file scenario: if Excel has `ops-hub.xlsx` open, `rm` fails. Implementer surfaces clear error; no in-plan fallback.

## Verification

After all 7 tasks complete:

```bash
test -f clients/fulldata/CLAUDE.md                                                       # exit 0
test -f clients/fulldata/CONTEXT.md                                                      # exit 0
test -f clients/fulldata/.gitignore                                                      # exit 0
grep -q "~\$\*\.xlsx" clients/fulldata/.gitignore                                        # exit 0
grep -q "out/0N_" clients/fulldata/CONTEXT.md || grep -q "out/00_inventory" clients/fulldata/CONTEXT.md  # exit 0 (numbered-stage canon)
! test -f "clients/fulldata/~\$ops-hub.xlsx"                                             # exit 0
test -f clients/fulldata/out/01_research/_legacy_pre_iago/README.md                      # exit 0
[ -z "$(git diff --name-only HEAD -- clients/fulldata/web-pricing-mock/)" ]              # exit 0 (inner repo untouched)
! test -d clients/fulldata/.iago                                                         # exit 0 (NO competing .iago/ skeleton created)
```

All exit as expected. Critical sanity check: `! test -d clients/fulldata/.iago` — confirms we did NOT introduce a parallel `.iago/` namespace that would compete with the existing `out/0N_*/` MWP layout.
