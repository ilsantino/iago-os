# feature-mwp-restructure-clients — workstream brief

**Created:** 2026-05-25
**Source audit:** `.iago/research/2026-05-25-mwp-restructure-audit.md` §11 (added 2026-05-25 after deep client walk)
**Sibling workstreams:** `feature-mwp-restructure-docs/` (4 plans, written 2026-05-25, awaiting /iago-execute); `feature-mwp-restructure-code/` (NOT YET WRITTEN, post-cutover)

## Goal

Apply MWP shell to each client wrapper that iago-os PR can touch (4 of 6 clients). Register all 6 clients (including the 2 inner-repo clients) in root `.iago/CONTEXT.md` as Level B sub-workspaces with explicit inner-repo annotations so future PRs cannot accidentally cross the boundary. Inner-repo clients (munet-web, sentria) get REGISTRY-ONLY treatment from iago-os; their own MWP work happens in separate PRs inside those repos.

## Inner-repo boundary (hard rule — memory `feedback_inner_repo_check.md`)

| Client | Wrapper editable from iago-os? | Why |
|---|---|---|
| din | YES | `clients/din/dinpro-app/.git` is inner sub-path; wrapper is regular dir |
| fulldata | YES | `clients/fulldata/web-pricing-mock/.git` is inner sub-path; wrapper is regular dir |
| palazuelos | YES | no inner repo |
| rsf | YES | no inner repo |
| **munet-web** | **NO** | `clients/munet-web/.git` is at wrapper — entire client tree is inner repo |
| **sentria** | **NO** | `clients/sentria/.git` is at wrapper — entire client tree is inner repo |

**Hard rule:** never `git add -f` paths inside `clients/munet-web/` or `clients/sentria/`. Never commit changes from iago-os PR into those trees. Plans 02-05 add wrapper files (CLAUDE.md, CONTEXT.md, etc.) ONLY for clients where wrapper is editable.

## Plans in this folder

| Plan | Wave | Deps | Scope |
|---|---|---|---|
| 01-register-clients-in-root-context | **2** | **docs/04-runtime-claude-md** (hard dep — fixed after stress test caught soft-vs-hard contradiction) | Update root `.iago/CONTEXT.md` Level B sub-workspaces table — restructure header from 4 cols (docs/04 creates) to 5 cols (adding `Inner repo?` between Type and Layer 0 declaration), update existing runtime/+mcp-servers/ rows to 5-col schema, replace `clients/{name}/` placeholder with 6 explicit per-client rows in alphabetical order |
| 02-din-shell | 1 | — | din wrapper: CLAUDE.md + CONTEXT.md + .iago physical L3/L4 split (`_config/`, `product/`, `_archive/`) + rename `DIN - BM 241016 (Manuel Sanchez's conflicted copy 2025-03-19).xlsx` → `branding/DIN-BM-241016.xlsx` + document state/+PROJECT/ROADMAP/STATE.md stay-put |
| 03-fulldata-shell | 1 | — | fulldata wrapper: CLAUDE.md + CONTEXT.md (canonicalize existing `_inputs/_processing/out/0N_*/` numbered-stage as L1 routing; **7 stages incl. branding**; NO competing `.iago/` skeleton) + delete `~$ops-hub.xlsx` + add gitignore for `~$*.xlsx` + `_processing/scripts/*.log` + untrack-if-tracked logs |
| 04-palazuelos-shell | 1 | — | palazuelos wrapper: CLAUDE.md + CONTEXT.md + .iago physical L3/L4 split + move loose `session-2026-05-04-palazuelos.md` to `.iago/_config/context/2026-05-04-palazuelos-session.md` + document state/+PROJECT/ROADMAP/STATE.md stay-put |
| 05-rsf-shell | 1 | — | rsf wrapper: CLAUDE.md + CONTEXT.md + .iago physical L3/L4 split + add gitignore for `catalog.zip` (deliverable catalog/ stays tracked; **untrack-if-tracked guard**) + document state/+PROJECT/ROADMAP/STATE.md stay-put |

**Wave structure (revised after stress tests):**
- **Wave 1:** Plans 02, 03, 04, 05 — four wrapper plans, each touches a different client subtree, zero file overlap, fully parallel.
- **Wave 2:** Plan 01 — registry update. Depends on `feature-mwp-restructure-docs/04-runtime-claude-md` having shipped (that plan creates the `## Level B sub-workspaces` section in root `.iago/CONTEXT.md`; this plan UPDATES it to add `Inner repo?` column and 6 per-client rows). Hard dependency to avoid concurrent-modification race on root `.iago/CONTEXT.md`.

## Pre-flight dependency

`feature-mwp-restructure-docs/04-runtime-claude-md` must merge before Plan 01 here dispatches. Plans 02-05 are fully independent and can dispatch immediately after this folder is approved (no docs-folder dependency).

## Acceptance for the whole folder

```bash
# Plan 01 — registry
grep -q "clients/din/" .iago/CONTEXT.md
grep -q "clients/munet-web/" .iago/CONTEXT.md
grep -q "inner repo" .iago/CONTEXT.md   # boundary annotation present

# Plans 02-05 — wrapper shells
for c in din fulldata palazuelos rsf; do
  test -f "clients/$c/CLAUDE.md" && test -f "clients/$c/CONTEXT.md"
done

# Plan 02 — din xlsx rename
test -f clients/din/branding/DIN-BM-241016.xlsx
! test -f "clients/din/DIN - BM 241016 (Manuel Sanchez's conflicted copy 2025-03-19).xlsx"

# Plan 03 — fulldata cleanup
! test -f clients/fulldata/~\$ops-hub.xlsx
grep -q "~\$\*\.xlsx" .gitignore  # or per-client .gitignore

# Plan 04 — palazuelos move
! test -f clients/palazuelos/session-2026-05-04-palazuelos.md
test -f clients/palazuelos/.iago/context/2026-05-04-palazuelos-session.md

# Plan 05 — rsf gitignore
grep -q "catalog.zip" clients/rsf/.gitignore || grep -q "clients/rsf/catalog.zip" .gitignore

# Inner repos untouched
! test -d clients/munet-web/.git/index.lock  # not actively modified
! test -d clients/sentria/.git/index.lock
git diff --name-only HEAD~5..HEAD -- clients/munet-web/ clients/sentria/ | wc -l  # 0 changes from iago-os PRs
```

## Out of scope (defer to other repos / future PRs)

- **munet-web internal MWP work** — scratch file gitignore, docs/ consolidation, standardization with root iaGO conventions. Belongs in munet-web's own PR.
- **sentria internal MWP work** — nested `clients/sentria/clients/sentria-ayuda-deep-wt/` cleanup, `Branding/` casing, `.cursorrules` audit, docs/ cleanup. Belongs in sentria's own PR.
- **fulldata web-pricing-mock/ inner repo** — its own PR.
- **din dinpro-app/ inner repo** — its own PR.
- **`.iago/_config/` and `.iago/product/` physical split inside each client's `.iago/`** — done by Plans 02-05 here but ONLY for the 4 editable clients. For inner-repo clients, that split happens in their own PR.

## Pipeline expectations

Each plan ships through `/iago-execute feature-mwp-restructure-clients` standard 8-stage pipeline. All 5 plans dispatch in parallel as wave 1. Five PRs result (one per plan). Should complete within one work session.

**Timing:** post-cutover (target 2026-05-29 onward). Lower urgency than docs folder; can also stagger — ship Plan 01 (registry) alone, then 02-05 as needed.
