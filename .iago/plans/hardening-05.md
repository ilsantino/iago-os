---
phase: hardening
plan: 05
wave: 2
depends_on: [hardening-02]
created: 2026-04-06
---

# Plan: hardening-05 — Add CI pipeline

## Goal

Add a GitHub Actions workflow that validates hooks, skills, and scripts on every
push and PR. iaGO-OS enforces CI on client projects but has none itself — fix that.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `.github/workflows/validate.yml` | CI pipeline definition |
| create | `scripts/validate-hooks.sh` | Hook syntax validation script |
| create | `scripts/validate-skills.sh` | Skill frontmatter validation script |

## Tasks

### Task 1: Create hook validation script
- **files:** `scripts/validate-hooks.sh`
- **action:** Create a bash script that runs `node --check` on every `.mjs` file in `.iago/hooks/` and `.iago/hooks/lib/`. This catches syntax errors without executing the hooks. Exit 0 if all pass, exit 1 if any fail. Print the file name and result for each.
- **verify:** `bash scripts/validate-hooks.sh; echo "exit: $?"`
- **expected:** All hooks pass syntax check, exit code 0

### Task 2: Create skill validation script
- **files:** `scripts/validate-skills.sh`
- **action:** Create a bash script that checks every `.claude/skills/*/SKILL.md` file for: (1) YAML frontmatter exists (starts with `---`), (2) `name:` field is present, (3) `description:` field is present. Report any skill missing these required fields. Exit 0 if all pass.
- **verify:** `bash scripts/validate-skills.sh; echo "exit: $?"`
- **expected:** All skills pass validation, exit code 0

### Task 3: Create GitHub Actions workflow
- **files:** `.github/workflows/validate.yml`
- **action:** Create a workflow triggered on push to main and on pull_request. Jobs: (1) `validate-hooks` — checkout, setup Node 20, run `npm install`, run `scripts/validate-hooks.sh`. (2) `validate-skills` — checkout, run `scripts/validate-skills.sh`. (3) `validate-scripts` — checkout, run `bash -n scripts/*.sh` to syntax-check all bash scripts. All three jobs run in parallel on `ubuntu-latest`.
- **verify:** `test -f .github/workflows/validate.yml && echo "PASS"`
- **expected:** `PASS`

### Task 4: Run validation locally
- **files:** All validation scripts
- **action:** Run all three validation scripts locally to confirm they pass before pushing. Fix any issues they find (there shouldn't be any after Plans 01-03, but verify).
- **verify:** `bash scripts/validate-hooks.sh && bash scripts/validate-skills.sh && bash -n scripts/*.sh && echo "PLAN-05 PASS"`
- **expected:** `PLAN-05 PASS`

## Verification

After all tasks: `bash scripts/validate-hooks.sh && bash scripts/validate-skills.sh && bash -n scripts/*.sh && echo "PLAN-05 PASS"`

Expected: `PLAN-05 PASS`
