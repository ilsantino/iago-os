---
name: iago-execute
description: >-
  Use when executing implementation plans for a ROADMAP phase.
  Not when no plans exist for the phase (run /iago:plan first).
---

## Purpose

Execute plans for a phase via the cross-session pipeline script. Each plan goes
through: implement → build gate → review → codex adversarial → PR. Every step
is a separate `claude -p` session with fresh context — no token burn in the
orchestrator session.

## Preconditions

- `.iago/PROJECT.md` must exist.
- At least one `.iago/plans/{NN}-{slug}-*.md` must exist for the target phase.
  If not, STOP: "No plans found. Run `/iago:plan {slug}` first."
- `scripts/execute-pipeline.sh` must exist in the iago-os root.
- When invoking from a client project directory, set `IAGO_OS_ROOT` to the
  iago-os installation path (e.g., `export IAGO_OS_ROOT=~/dev/iago-os`).
  `git rev-parse --show-toplevel` resolves to the client root, not iago-os.

## Arguments

`/iago:execute {phase-slug}` — execute all plans for the phase.

`/iago:execute {phase-slug} --plan {plan-id}` — execute a single plan only
(e.g., `--plan 02b`). Useful for re-running a failed plan.

`/iago:execute {phase-slug} --n8n` — dispatch to n8n webhook instead of local
script. Requires `automation.n8n_webhook_url` in `.iago/config.json`.

If no phase-slug provided, read STATE.md for the current active phase.

## Steps

### 1. Load plans

Read all `.iago/plans/{NN}-{slug}-*.md` files for the target phase.
Sort by plan ID (alphabetical — 02a before 02b before 02c).

If `--plan` flag is set, filter to only that plan.

Display the plan list and ask for confirmation:
```
Found {N} plans for phase {slug}:
  02a — {title from plan frontmatter or first heading}
  02b — ...
  ...
Execute all? (y/n)
```

### 2. Resolve paths

```bash
# Dynamic resolution. Set IAGO_OS_ROOT env var, or auto-detect via git.
IAGO_ROOT="${IAGO_OS_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null)}"
if [[ -z "$IAGO_ROOT" || ! -f "$IAGO_ROOT/scripts/execute-pipeline.sh" ]]; then
  echo "ERROR: Cannot resolve iago-os root. Set IAGO_OS_ROOT env var." >&2; exit 1
fi
SCRIPT="$IAGO_ROOT/scripts/execute-pipeline.sh"
PROJECT_DIR="{cwd}"  # the client project directory (where .iago/ lives)
```

Verify the script exists: `test -f "$SCRIPT"`. If not, STOP with error.

### 3. Git sync

Before starting any plan:
```bash
cd "$PROJECT_DIR" && git checkout main && git pull origin main
```

This ensures we're on the latest main with no conflicts.

### 4. Execute plans sequentially

For each plan in order:

```bash
bash "$SCRIPT" --plan {plan_path} --project-dir "$PROJECT_DIR"
```

**Run this via the Bash tool.** Set timeout to 600000 (10 min). Run in background
if the user wants to do other work, otherwise foreground.

The script handles the FULL pipeline per plan:
1. **Implement** — `claude -p` session reads the plan and writes code
2. **Build gate** — `tsc --noEmit && vite build` (max 2 retries)
3. **Review** — `claude -p` session reviews the diff against the plan
4. **Codex adversarial** — `codex review` or `claude -p` adversarial check
5. **Create PR** — `claude -p` session stages, commits, pushes, creates PR via `gh`
5b. **Tag @claude** — haiku synthesizes review request, posts on PR
6. **Summary** — write pipeline results to `.iago/summaries/`

After the script completes, the review-fix loop runs async via GitHub Actions
(`claude-review-fix.yml`): Claude reviews → fixes → re-tags → max 5 rounds.

**Between plans:** Do NOT run `git checkout main && git pull`. The next plan
builds on the previous plan's commits. Plans are sequential — each plan's code
is available to the next.

**If a plan fails** (non-zero exit): STOP. Report the error. Do not continue
to the next plan. The user must investigate.

### 5. Report results

After all plans complete (or one fails):

```
Phase: {slug}
Plans executed: {N}/{total}
Status: {all passed | plan XX failed}

PRs created:
  - #{num} — {title} ({url})
  ...

Next: Review the PRs on GitHub, merge in order, then run
`/iago:verify {slug}` to verify the phase.
```

Update STATE.md:
- If all passed: Status → `executed`
- If one failed: Status → `executing (plan {XX} failed)`

### 6. n8n dispatch (if --n8n flag)

If `--n8n` flag is set:

1. Read `.iago/config.json` for `automation.n8n_webhook_url`.
2. For each plan, POST: `{ "phase": "{slug}", "plan_path": "{file}", "project_dir": "{cwd}" }`
3. Report: "Dispatched {N} plans to n8n. Monitor in dashboard."
4. STOP — n8n handles everything from here.

## Boundaries

- The orchestrator does NOT implement code — the script does via `claude -p`
- The orchestrator does NOT review code — the script does via `claude -p`
- The orchestrator does NOT dispatch agents — the script spawns sessions
- One script run per plan — never batch multiple plans
- PRs are never auto-merged — user reviews on GitHub
- If the script fails, STOP and escalate — do not retry without user input
