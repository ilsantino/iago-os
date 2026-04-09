---
phase: quick
plan: quick-260409-review-control
wave: 1
depends_on: []
created: 2026-04-09
branch: fix/pipeline-review-hardening
base: main
---

# Quick: Review pipeline control flags

## Goal

Add `--review`/`--no-review` flags to `/iago:execute` and `/iago:quick` skills,
`--no-tag` flag to the pipeline script, and write comprehensive PR review pipeline
setup documentation. Spec: `docs/specs/review-pipeline-control.md`.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `scripts/execute-pipeline.sh` | Add `--no-tag` flag, skip step 5b when set |
| modify | `.claude/skills/iago-execute/SKILL.md` | Parse `--no-review` flag, pass `--no-tag` to script |
| modify | `.claude/skills/iago-quick/SKILL.md` | Parse `--review` flag, omit `--no-tag` when present |
| modify | `.claude/rules/execution-pipeline.md` | Document `--no-tag` and skill flag behavior |
| modify | `CLAUDE.md` | Update Review Pipeline section with flag info |
| create | `docs/pr-review-pipeline.md` | Full setup guide: secrets, workflows, rules, troubleshooting |

## Tasks

### Task 1: Add --no-tag flag to pipeline script

- **files:** `scripts/execute-pipeline.sh`
- **action:** Add `--no-tag` to the arg parser (line 19-24). Initialize `NO_TAG=false`. When `--no-tag` is passed, set `NO_TAG=true`. Wrap step 5b (lines 296-332, the @claude tagging block) in `if [ "$NO_TAG" != "true" ]; then ... else log "TAG SKIPPED (--no-tag)"; fi`. Do not touch any other step.
- **verify:** `bash -n scripts/execute-pipeline.sh && echo "syntax ok"`
- **expected:** "syntax ok" — script parses without error

### Task 2: Update skill files with --review/--no-review flags

- **files:** `.claude/skills/iago-execute/SKILL.md`, `.claude/skills/iago-quick/SKILL.md`
- **action:**
  For **iago-execute**:
  - Add `--no-review` to the Arguments section. Description: "Skip @claude tagging after PR creation. Local pipeline still runs (build gate, review, codex). You can manually trigger the async loop later with `/iago:prfix`."
  - In Step 4, update the `bash` invocation example: if `--no-review` is passed, append `--no-tag` to the script call. Show both forms:
    ```
    # Default (auto-review):
    bash "$SCRIPT" --plan {plan_path} --project-dir "$PROJECT_DIR"
    # With --no-review:
    bash "$SCRIPT" --plan {plan_path} --project-dir "$PROJECT_DIR" --no-tag
    ```

  For **iago-quick**:
  - Add `--review` to the Optional flags list. Description: "Tag @claude on PR for async review-fix loop. Default: off (PR created but not auto-reviewed)."
  - In Step 4, update the pipeline invocation: default adds `--no-tag`, but if `--review` is passed, omit `--no-tag`. Show both forms:
    ```
    # Default (no auto-review):
    bash scripts/execute-pipeline.sh --plan {path} --project-dir {dir} --no-tag
    # With --review:
    bash scripts/execute-pipeline.sh --plan {path} --project-dir {dir}
    ```
- **verify:** `grep -c "\-\-no-review\|--review\|--no-tag" .claude/skills/iago-execute/SKILL.md .claude/skills/iago-quick/SKILL.md`
- **expected:** Both files contain the new flag references

### Task 3: Write docs and update rules

- **files:** `docs/pr-review-pipeline.md`, `.claude/rules/execution-pipeline.md`, `CLAUDE.md`
- **action:**
  **Create `docs/pr-review-pipeline.md`** — comprehensive setup guide covering:
  1. **Overview** — what the pipeline does (local stages + async loop)
  2. **Prerequisites** — GitHub repo, Claude Code OAuth token, GH_PAT, `gh` CLI
  3. **Secrets setup** — `CLAUDE_CODE_OAUTH_TOKEN` (from Anthropic), `GH_PAT` (GitHub PAT with repo + workflow scopes). Where to add them (Settings → Secrets → Actions)
  4. **Workflow files** — `claude.yml` (trigger: @claude mention, runs Claude Code Action, posts signal comment via GH_PAT) and `claude-review-fix.yml` (trigger: [claude-review-complete] signal, checks findings, fixes, re-tags). Brief description of each, with a note to see the actual files for full config
  5. **CLAUDE.md review rules** — what to add to the client project's CLAUDE.md for the CI review sessions (e.g., "CI Review Rules" section)
  6. **Control flags** — `--no-review` on `/iago:execute`, `--review` on `/iago:quick`, `--no-tag` on the script. Table showing default behavior per skill
  7. **Manual trigger** — `/iago:prfix` to tag @claude on any existing PR
  8. **Troubleshooting** — common issues: GH_PAT missing/expired, CLAUDE_CODE_OAUTH_TOKEN invalid, workflow not triggering (issue_comment runs from main), loop stuck (check round count), Claude Code Action silently failing (check allowedTools)
  9. **Architecture diagram** — ASCII flow showing: pipeline script → PR → @claude tag → claude.yml → signal → claude-review-fix.yml → fix → re-tag → loop

  **Update `.claude/rules/execution-pipeline.md`:**
  - Add a "### Control Flags" section after "### Pipeline Stages" that documents:
    - `--no-tag` on the script (skips step 5b)
    - Default behavior per skill: execute = auto-review, quick = manual review
    - `/iago:prfix` as the manual trigger path

  **Update `CLAUDE.md`:**
  - In the "## Review Pipeline" section, add one line about the control flags and defaults. Keep it brief (the rule doc has details).
- **verify:** `test -f docs/pr-review-pipeline.md && grep -c "no-tag\|no-review\|--review" .claude/rules/execution-pipeline.md CLAUDE.md`
- **expected:** File exists, both rules and CLAUDE.md reference the flags
