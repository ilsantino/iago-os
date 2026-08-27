---
phase: feature-mwp-restructure-clients
plan: 05
wave: 1
depends_on: []
context: .iago/research/2026-05-25-mwp-restructure-audit.md
created: 2026-05-25
source: feature
---

# Plan: feature-mwp-restructure-clients/05-rsf-shell

## Goal

Add MWP wrapper to `clients/rsf/` (Class C — research-heavy engagement, no inner repo): CLAUDE.md (Layer 0), CONTEXT.md (Layer 1), physical L3/L4 split inside minimal existing `clients/rsf/.iago/`, and gitignore `catalog.zip` (regenerable from `catalog/`). The `catalog/` (22 numbered MD deliverables + MATRIX + README) and `deep-research/` (5 dated research docs) stay at wrapper level — they ARE the deliverable surface for this engagement.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `clients/rsf/CLAUDE.md` | Layer 0 wrapper declaration |
| create | `clients/rsf/CONTEXT.md` | Layer 1 routing |
| create (dirs) | `clients/rsf/.iago/_config/`, `clients/rsf/.iago/product/`, `clients/rsf/.iago/_archive/` | physical L3/L4/archive split |
| create | `clients/rsf/.gitignore` | gitignore `catalog.zip` (regenerable) |
| move | `clients/rsf/.iago/{learnings, config.json}` → `clients/rsf/.iago/_config/{learnings, config.json}` | L3 factory artifacts |

## Tasks

### Task 1: Create `clients/rsf/CLAUDE.md` (Layer 0)

- **files:** `clients/rsf/CLAUDE.md`
- **action:** Write Layer 0 declaration (~30 lines). Title: `# clients/rsf/ — RSF (Red Sun Farms) Research + Catalog Engagement`. Paragraph: "Level B MWP sub-workspace inside iaGO-OS. Root workspace at `../../`. RSF is a high-tech greenhouse producer engagement — research + catalog deliverables, no app code, no inner repo. Two major deliverable surfaces at wrapper level: `catalog/` (22 numbered MD files cataloging AI opportunities across the value chain — climate-control, irrigation, pest detection, yield forecasting, etc., plus MATRIX.md cross-reference) and `deep-research/` (5+ dated research docs on specific topics — climate-RL state-of-art, demand-forecast landscape, FSMA204 KG patterns, LATAM pest transfer learning, shelf-life datasets)." Then `## Layer routing` table: L0=this file, L1=`./CONTEXT.md`, L3=`./.iago/_config/`, L4 product=`./.iago/product/` + `./catalog/` + `./deep-research/`. Then `## Hard rules`: (1) `catalog/` is the canonical deliverable artifact — numbered MD files (01-22) follow the value-chain order documented in `catalog/MATRIX.md`; new entries continue the numbering; (2) `deep-research/` follows `{YYYY-MM-DD}-{slug}.md` naming for new research drops; (3) `catalog.zip` is a regenerated archive — gitignored, never edit directly; (4) plans for RSF work live in `./.iago/product/plans/feature-{slug}/`, NOT in root `.iago/plans/`. Then `## Engagement context`: 1-line pointer to memory `project_rsf_relationship.md` + `project_rsf_poc_structure.md` (RSF funds costs only, iaGO contributes labor free; deliverables = system + case study + co-authored paper).
- **verify:** `test -f clients/rsf/CLAUDE.md && wc -l clients/rsf/CLAUDE.md && grep -q "catalog" clients/rsf/CLAUDE.md && grep -q "deep-research" clients/rsf/CLAUDE.md && grep -q "Level B" clients/rsf/CLAUDE.md`
- **expected:** file exists; 25-40 lines; both deliverable surfaces named

### Task 2: Create `clients/rsf/CONTEXT.md` (Layer 1)

- **files:** `clients/rsf/CONTEXT.md`
- **action:** Write Layer 1 routing (~30 lines). Title: `# clients/rsf/ — Workspace L1 Routing`. Section `## Doc-routing — where RSF artifacts go`: table: (1) Phase plan → `./.iago/product/plans/{NN-phase-slug}/{NN}.md`; (2) Feature plan → `./.iago/product/plans/feature-{slug}/{NN}.md`; (3) Execution summary → `./.iago/product/summaries/{plan-slug}.md`; (4) Catalog entry (numbered) → `./catalog/{NN}-{slug}.md` (continue from 22 — next would be 23); (5) MATRIX cross-reference update → `./catalog/MATRIX.md`; (6) Deep research → `./deep-research/{YYYY-MM-DD}-{slug}.md`; (7) ADR → `./.iago/_config/decisions/{YYYY-MM-DD}-{slug}.md`; (8) Context artifact (e.g., relationship updates, scope decisions) → `./.iago/_config/context/{YYYY-MM-DD}-{slug}.md`. Section `## Layer assignments`: small table. Section `## Sibling artifacts at wrapper level`: `catalog/` (22 numbered AI-opportunity catalog + MATRIX + README — Layer 4 deliverable), `deep-research/` (dated research drops — Layer 4 product), `README.md` (engagement overview — Layer 3 reference).
- **verify:** `test -f clients/rsf/CONTEXT.md && grep -q "^## Doc-routing" clients/rsf/CONTEXT.md && grep -q "catalog/MATRIX" clients/rsf/CONTEXT.md && grep -q "deep-research" clients/rsf/CONTEXT.md`
- **expected:** file exists; routing section + both deliverable surfaces present

### Task 3: Scaffold physical `.iago/{_config, product, _archive}/` dirs

- **files:** `clients/rsf/.iago/_config/`, `clients/rsf/.iago/_config/{context,decisions}/`, `clients/rsf/.iago/product/`, `clients/rsf/.iago/_archive/`
- **action:** `mkdir -p clients/rsf/.iago/_config/context clients/rsf/.iago/_config/decisions clients/rsf/.iago/product clients/rsf/.iago/_archive`. Add `clients/rsf/.iago/_config/README.md` (1-line "factory: stable across runs") and `clients/rsf/.iago/_archive/README.md` (1-line "archived plans/decisions from completed phases").
- **verify:** `test -d clients/rsf/.iago/_config/context && test -d clients/rsf/.iago/_config/decisions && test -d clients/rsf/.iago/product && test -d clients/rsf/.iago/_archive`
- **expected:** all dirs exist

### Task 4: Move existing `.iago/` factory contents to `_config/`

- **files:** `clients/rsf/.iago/{learnings, config.json}` → `clients/rsf/.iago/_config/{learnings, config.json}`
- **action:** `git mv clients/rsf/.iago/learnings clients/rsf/.iago/_config/learnings` (2 files per audit §11.5). `git mv clients/rsf/.iago/config.json clients/rsf/.iago/_config/config.json`. If `clients/rsf/.iago/hooks/` exists (audit noted rsf has hooks subdir), `git mv clients/rsf/.iago/hooks clients/rsf/.iago/_config/hooks`.
- **verify:** `test -d clients/rsf/.iago/_config/learnings && test -f clients/rsf/.iago/_config/config.json && [ "$(ls clients/rsf/.iago/_config/learnings/ | wc -l)" -ge "2" ]`
- **expected:** learnings/ moved with 2 files; config.json moved

### Task 5: Create `clients/rsf/.gitignore` (catalog.zip regenerable; guard against `git rm --cached` on untracked file)

- **files:** `clients/rsf/.gitignore`
- **action:** **Step A — write .gitignore with real newlines** (heredoc form, not literal `\n`):
  ```bash
  cat >> clients/rsf/.gitignore <<'EOF'
  # catalog.zip is regenerated from catalog/ (e.g., for client handoff) — not a source artifact
  catalog.zip
  EOF
  ```
  **Step B — conditionally untrack** (stress-test fix — `git rm --cached` on untracked file errors out): branch on tracked state:
  ```bash
  if git ls-files --error-unmatch clients/rsf/catalog.zip 2>/dev/null; then
    git rm --cached clients/rsf/catalog.zip
  else
    echo "catalog.zip already untracked — gitignore prevents future re-tracking"
  fi
  ```
- **verify:** `test -f clients/rsf/.gitignore && grep -q "^catalog\.zip$" clients/rsf/.gitignore && ! git ls-files --error-unmatch clients/rsf/catalog.zip 2>/dev/null`
- **expected:** gitignore exists with `catalog.zip` on its own line; catalog.zip is NOT in git index (either was never tracked, or was untracked by `git rm --cached`)

### Task 6: Verify catalog/ and deep-research/ untouched + state/ + project-meta disposition

- **files:** (verification only)
- **action:** **Step A (deliverables untouched):** confirm zero changes inside `clients/rsf/catalog/` and `clients/rsf/deep-research/` from this plan. Run `git diff --name-only HEAD -- clients/rsf/catalog/ clients/rsf/deep-research/` — must return empty. **Step B (file counts — stress-test correction):** `ls clients/rsf/catalog/*.md | wc -l` should be **≥24** (22 numbered + MATRIX + README = 24; previous floor of ≥23 had off-by-one); `ls clients/rsf/deep-research/*.md | wc -l` should be ≥6 (5 dated + README). **Step C (state/ + project-meta — stress-test fix):** `clients/rsf/.iago/state/active-client.json` stays at `.iago/state/` (runtime). `clients/rsf/.iago/{PROJECT.md, ROADMAP.md, STATE.md}` stay at `.iago/` root (project-meta visibility — minimal engagement does not warrant moving them). Any future `.iago/{plans, summaries, reviews, context}/` content gets added under `_config/` or `product/` per the new convention, but EXISTING empty subdirs (audit notes none exist for rsf besides hooks/) get cleaned naturally.
- **verify:** `[ -z "$(git diff --name-only HEAD -- clients/rsf/catalog/ clients/rsf/deep-research/)" ] && [ "$(ls clients/rsf/catalog/*.md 2>/dev/null | wc -l)" -ge "24" ] && [ "$(ls clients/rsf/deep-research/*.md 2>/dev/null | wc -l)" -ge "6" ] && test -f clients/rsf/.iago/state/active-client.json && test -f clients/rsf/.iago/STATE.md && test -f clients/rsf/.iago/PROJECT.md && test -f clients/rsf/.iago/ROADMAP.md`
- **expected:** zero diff in deliverable dirs; catalog has ≥24 MDs; deep-research has ≥6 MDs; state/active-client.json + STATE/PROJECT/ROADMAP.md at .iago/ root all preserved

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-25
**Reviewer:** analyst (opus, read-only)

### Important (all fixed in this plan revision)
- **Off-by-one in catalog count threshold** (≥23 should be ≥24 — disk has 22 numbered + MATRIX + README = 24). **Fixed:** Task 6 verify now uses `≥24`.
- **`git rm --cached` on untracked file errors out** (catalog.zip currently untracked). **Fixed:** Task 5 now has `git ls-files --error-unmatch` pre-check; only runs `git rm --cached` if file is tracked, else logs that gitignore alone suffices.
- **`state/`, `PROJECT.md`, `ROADMAP.md`, `STATE.md` disposition silently omitted.** **Fixed:** Task 6 Step C now explicitly verifies they stay in place at `.iago/` root and `.iago/state/`.
- **`.gitignore` heredoc syntax** — used same fix pattern as Plan 03 Task 3 (real newlines via `<<'EOF'`, not literal `\n`). **Fixed in Task 5.**

### Minor (acknowledged)
- CLAUDE.md `## Engagement context` should be a 1-line pointer to memory, NOT replicate content (frozen-snapshot rule). Implementer must heed during write — the plan instruction's parenthetical content is FOR THE PLAN AUTHOR's reference, not for inclusion in CLAUDE.md.
- CONTEXT.md "continue from 22 — next would be 23" presumes catalog growth; if scope was intentionally bounded at 22, this routing instruction creates a false signal. No blocker.
- `catalog.zip` could be deleted instead of gitignored; gitignore chosen to preserve any in-progress handoff copy.

## Verification

After all 6 tasks complete:

```bash
test -f clients/rsf/CLAUDE.md                                                    # exit 0
test -f clients/rsf/CONTEXT.md                                                   # exit 0
test -d clients/rsf/.iago/_config/learnings                                      # exit 0
test -f clients/rsf/.iago/_config/config.json                                    # exit 0
test -f clients/rsf/.gitignore                                                   # exit 0
grep -q "catalog\.zip" clients/rsf/.gitignore                                    # exit 0
test -d clients/rsf/catalog && [ "$(ls clients/rsf/catalog/*.md | wc -l)" -ge "23" ]   # exit 0
test -d clients/rsf/deep-research && [ "$(ls clients/rsf/deep-research/*.md | wc -l)" -ge "6" ]  # exit 0
test -d clients/rsf/.iago/_archive                                               # exit 0
```

All exit as expected.
