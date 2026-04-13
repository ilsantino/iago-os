---
phase: audit
plan: 03
wave: 1
depends_on: []
created: 2026-04-12
---

# Plan: audit-03 — Fix config conflicts, CI gaps, and missing docs

## Goal

Reconcile config.json with actual pipeline behavior, add execute-pipeline.sh
to CI validation, and document stress test (stage 0) in MANUAL.md and
ARCHITECTURE.md.

## Findings Addressed

I1, I7, I8

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `.iago/config.json` | Fix routing.default_model and review.mode to match reality |
| modify | `.github/workflows/validate.yml` | Add execute-pipeline.sh to bash -n validation |
| modify | `docs/MANUAL.md` | Add stress test (pipeline stage 0) documentation |
| modify | `docs/ARCHITECTURE.md` | Add stress test mention to pipeline section |

## Tasks

### Task 1: Fix config.json conflicts
- **files:** `.iago/config.json`
- **action:** Read the file. Fix these conflicts:
  - `routing.default_model`: currently "sonnet". CLAUDE.md says opus for orchestrator + impl. Check if execute-pipeline.sh reads this value — if it doesn't (script hardcodes `--model opus`), update config to match the script's actual behavior (opus). If the script reads config, leave as-is and note.
  - `review.mode`: currently "single". Pipeline always runs three-pass review (plan compliance + domain routing + adversarial). Update to "three-pass" or document that this field is aspirational/unused.
  - Grep `scripts/execute-pipeline.sh` for "config.json" to determine if the script reads config at all. If it doesn't, add a comment in config.json noting these are defaults for future tooling, not currently read by the pipeline.
- **verify:** `node -e "const c = JSON.parse(require('fs').readFileSync('.iago/config.json')); console.log(c.routing?.default_model, c.review?.mode);"`
- **expected:** Values match actual pipeline behavior

### Task 2: Add execute-pipeline.sh to CI validation
- **files:** `.github/workflows/validate.yml`
- **action:** Line 33 runs `bash -n` on 5 scripts but omits `execute-pipeline.sh` — the most complex script in the repo. Add `scripts/execute-pipeline.sh` to the list.
- **verify:** `grep "execute-pipeline" .github/workflows/validate.yml`
- **expected:** 1 match in the bash -n line

### Task 3: Document stress test in MANUAL.md
- **files:** `docs/MANUAL.md`
- **action:** Search for the pipeline section (likely "## Execution Pipeline" or "## Pipeline"). Add stage 0 (Stress Test) documentation:
  - What it does: opus adversarial review of the plan itself (max 15 turns)
  - What it checks: precision gaps, edge cases, contradictions, simpler alternatives, missing acceptance criteria
  - Outcomes: PROCEED → continue, PROCEED_WITH_NOTES → notes forwarded to impl, BLOCK → pipeline stops
  - Skip condition: plan already has `## Stress Test` section (from /iago:plan or /iago:stress)
  Keep consistent with `.claude/rules/execution-pipeline.md` description.
- **verify:** `grep -c "Stress Test\|stress test\|stage 0\|step 0" docs/MANUAL.md`
- **expected:** At least 2 matches

### Task 4: Add stress test mention in ARCHITECTURE.md
- **files:** `docs/ARCHITECTURE.md`
- **action:** Find the pipeline section. Add step 0 (Stress Test) to the stage list if missing. Keep it brief — ARCHITECTURE.md is an overview, not a manual.
- **verify:** `grep -c "stress" docs/ARCHITECTURE.md`
- **expected:** At least 1 match

## Verification

After all tasks:
```bash
grep "execute-pipeline" .github/workflows/validate.yml && echo "PASS: CI covers pipeline script"
grep -c "stress" docs/MANUAL.md docs/ARCHITECTURE.md
node -e "const c = JSON.parse(require('fs').readFileSync('.iago/config.json')); console.log('model:', c.routing?.default_model, 'review:', c.review?.mode);"
```

Expected: CI includes execute-pipeline, both docs mention stress, config values match reality

## Stress Test

Reviewed by opus adversarial analyst on 2026-04-12. Verdict: **PROCEED**.
- execute-pipeline.sh does NOT read config.json (confirmed via grep). Config fixes are for correctness/documentation, not behavioral.
- All tasks well-scoped with clear verification commands.
