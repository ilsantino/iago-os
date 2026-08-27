---
phase: feature-mwp-restructure-clients
plan: 01
wave: 2
depends_on: [feature-mwp-restructure-docs/04-runtime-claude-md]
context: .iago/research/2026-05-25-mwp-restructure-audit.md
created: 2026-05-25
source: feature
---

# Plan: feature-mwp-restructure-clients/01-register-clients-in-root-context

## Goal

Update root `.iago/CONTEXT.md` Level B sub-workspaces table — replace the placeholder `clients/{name}/` row (added by `feature-mwp-restructure-docs/04-runtime-claude-md` Plan 04 Task 3) with **6 explicit per-client rows alphabetically by path**, each annotated with inner-repo status so future PRs cannot accidentally cross the boundary. This is a documentation-only registry update; touches root `.iago/CONTEXT.md` only.

**Hard dependency on docs/04** (stress-test fix to original "soft dependency" framing): docs/04 creates the `## Level B sub-workspaces` section with a 4-column schema (`Path | Type | Layer 0 declaration | Layer 2 stage contract`); this plan EXPANDS to 5 columns by adding `Inner repo?` between Type and Layer 0 declaration. Re-frames every existing row (runtime/, mcp-servers/) into the 5-column schema BEFORE appending client rows. Cannot run without docs/04 because the section must exist with known column structure.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `.iago/CONTEXT.md` | Expand Level B sub-workspaces table to 6 per-client rows + add inner-repo column |

## Tasks

### Task 1: Verify docs/04 hard dependency (Level B section exists)

- **files:** `.iago/CONTEXT.md`
- **action:** Hard dependency per frontmatter `depends_on: [feature-mwp-restructure-docs/04-runtime-claude-md]`. Check `grep -q "^## Level B sub-workspaces" .iago/CONTEXT.md`. If section doesn't exist, docs/04 hasn't merged — STOP with error "feature-mwp-restructure-docs/04-runtime-claude-md must ship first" (do NOT attempt to create the section from scratch — original draft had this as a "soft dependency" with creation fallback, but stress-test corrected to hard dep to avoid concurrent-modification races with docs/04's own CONTEXT.md edit).
- **verify:** `grep -q "^## Level B sub-workspaces" .iago/CONTEXT.md`
- **expected:** exit 0 (section present); if exit 1, plan is blocked on docs/04

### Task 2: Expand table to 5 columns and append 6 alphabetical per-client rows

- **files:** `.iago/CONTEXT.md`
- **action:** **Step A (stress-test fix — column migration):** find the `## Level B sub-workspaces` table created by docs/04 with header `Path | Type | Layer 0 declaration | Layer 2 stage contract`. Rewrite the header to 5 columns: `Path | Type | Inner repo? | Layer 0 declaration | Notes`. For each EXISTING row (runtime/, mcp-servers/, and the `clients/{name}/` placeholder), add the two new cells: `runtime/` gets `Inner repo? = NO` and `Notes = v2 daemon; PHASE-1-EVIDENCE.md at runtime/PHASE-1-EVIDENCE.md`; `mcp-servers/youtube-transcript/` gets `Inner repo? = NO` and `Notes = Python project; registered globally via ~/.claude.json`; delete the `clients/{name}/` placeholder row entirely. **Step B (append client rows alphabetically by path):** add 6 rows in this exact order — (1) `clients/din/` | wrapper + inner-deliverable | YES at `dinpro-app/` | `clients/din/CLAUDE.md` (added by feature-mwp-restructure-clients/02) | Class B; wrapper editable, inner repo OFF-LIMITS; (2) `clients/fulldata/` | data engagement | YES at `web-pricing-mock/` | `clients/fulldata/CLAUDE.md` (added by feature-mwp-restructure-clients/03) | Class C; existing `_inputs/_processing/out/0N_*/` IS its MWP layout; (3) `clients/munet-web/` | inner repo (entire wrapper) | **YES at wrapper** | own `CLAUDE.md` inside inner repo | **iago-os PR CANNOT edit anything under this path**; standardization in munet-web's own PRs; (4) `clients/palazuelos/` | research/transcription | NO | `clients/palazuelos/CLAUDE.md` (added by feature-mwp-restructure-clients/04) | Class C; minimal-activity; (5) `clients/rsf/` | research + catalog | NO | `clients/rsf/CLAUDE.md` (added by feature-mwp-restructure-clients/05) | Class C; catalog/ is L4 deliverable; (6) `clients/sentria/` | inner repo (entire wrapper) | **YES at wrapper** | own `CLAUDE.md` inside inner repo | **iago-os PR CANNOT edit anything under this path**; same constraint as munet-web. **Step C (column-count integrity check):** count pipes in each row of the table — every row including header must have exactly 6 pipes (5 columns plus leading + trailing).
- **verify:** `grep -c "^| clients/" .iago/CONTEXT.md && grep -c "inner repo" .iago/CONTEXT.md && awk '/^## Level B sub-workspaces/{f=1; next} /^## /{f=0} f && /^\|/ {n=gsub(/\|/,"&"); if(n!=6) {print "ROW WITH WRONG PIPE COUNT:", $0; exit 1}}' .iago/CONTEXT.md`
- **expected:** ≥6 client rows starting with `^| clients/`; ≥3 "inner repo" annotations; awk exits 0 (every row in the table has exactly 6 pipes = 5 columns)

### Task 3: Add hard-rule reminder paragraph

- **files:** `.iago/CONTEXT.md`
- **action:** Below the expanded table, add a paragraph: "**Hard rule (memory `feedback_inner_repo_check.md`):** never `git add -f` any path under `clients/munet-web/` or `clients/sentria/` from an iago-os PR. Inner-repo clients standardize MWP conventions in their own repos via their own PRs. Wrapper-level changes (CLAUDE.md, CONTEXT.md, `.iago/` physical split) for the 4 editable clients ship via `feature-mwp-restructure-clients/02-05`."
- **verify:** `grep -q "feedback_inner_repo_check" .iago/CONTEXT.md && grep -q "git add -f" .iago/CONTEXT.md`
- **expected:** rule reminder present with explicit memory reference

### Task 4: Sanity-check no file moves happened

- **files:** (verification only)
- **action:** Confirm this plan ONLY modified `.iago/CONTEXT.md`. Run `git status --short .iago/CONTEXT.md` and `git diff --stat --name-only HEAD` to confirm only one file changed. No client directories touched.
- **verify:** `[ "$(git diff --name-only HEAD | wc -l)" = "1" ] && git diff --name-only HEAD | grep -q ".iago/CONTEXT.md"`
- **expected:** exactly 1 file changed; it's `.iago/CONTEXT.md`

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-25
**Reviewer:** analyst (opus, read-only)

### Important (fixed in this plan revision)
- **Column mismatch between docs/04 (4 columns) and this plan (5 columns)** would have produced a malformed table. **Fixed:** Task 2 Step A now explicitly rewrites the header to 5 columns + adds Inner repo? and Notes cells to existing rows (runtime/, mcp-servers/) BEFORE appending client rows. Task 2 Step C adds a pipe-count integrity check (every row must have exactly 6 pipes).
- **Soft-dependency / hard-STOP contradiction.** Original frontmatter said `depends_on: []` (wave 1, parallel-capable) but Task 1 had hard exit-1 STOP if docs/04 hadn't shipped. **Fixed:** frontmatter now `depends_on: [feature-mwp-restructure-docs/04-runtime-claude-md]`, wave bumped 1 → 2, Goal section explicitly names the hard dep + reasoning (avoid concurrent-mod race on `.iago/CONTEXT.md`).
- **Row ordering not specified.** **Fixed:** Task 2 now mandates alphabetical-by-path order; verify can be re-derived from the table by parsing the path column.

### Minor (acknowledged)
- Task 4 single-file diff check is point-in-time (uses unstaged diff). Documented as known limitation; not exploited by any failure mode here.
- Could merge this into docs/04 to save a PR cycle, but separation-of-concerns (docs folder vs clients folder) is worth the cycle.

## Verification

After all 4 tasks complete:

```bash
grep -q "^## Level B sub-workspaces" .iago/CONTEXT.md                    # exit 0
[ "$(grep -c "^| clients/" .iago/CONTEXT.md)" -ge "6" ]                  # ≥6 client rows
grep -q "feedback_inner_repo_check" .iago/CONTEXT.md                     # exit 0
grep -q "munet-web/" .iago/CONTEXT.md                                    # exit 0
grep -q "sentria/" .iago/CONTEXT.md                                      # exit 0
grep -q "din/" .iago/CONTEXT.md                                          # exit 0
[ "$(git diff --name-only HEAD | wc -l)" = "1" ]                         # only .iago/CONTEXT.md
```

All exit as expected. Single-file edit; zero risk to pipeline or clients.
