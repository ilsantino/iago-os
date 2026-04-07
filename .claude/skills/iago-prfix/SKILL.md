---
name: iago-prfix
description: >-
  Use after a PR review to fix all review comments on the current branch's PR.
  Delegates to review-fix-loop.sh which fixes, builds, pushes, tags @claude,
  and loops until approved or max rounds reached.
---

## Purpose

Fix every review comment on this branch's open PR to main. Delegates to
`scripts/review-fix-loop.sh` which runs a self-healing loop: fix all comments →
build gate → push → tag @claude → poll for response → repeat until approved.

## Arguments

`/iago:prfix` — fix all comments on the current branch's PR.

Optional:
- `{pr-number}` — target a specific PR (e.g., `/iago:prfix 42`). Defaults to
  the open PR for the current branch.
- `{pr-number} {pr-number} ...` — fix multiple PRs sequentially
  (e.g., `/iago:prfix 42 43 45`).
- `--all` — find and fix all open PRs in the repo that have unresolved review
  comments (e.g., `/iago:prfix --all`).

## Preconditions

- `gh` CLI must be authenticated.
- If no PR numbers given and no `--all` flag: must be on a feature branch with
  an open PR to main.
- Working tree should be clean. If dirty, ask user to commit or stash first.

## Steps

### 1. Identify the PR(s)

**Single PR (default):**
```bash
# If pr-number provided, use it. Otherwise detect from current branch:
gh pr view --json number,url,headRefName,baseRefName
```

If no open PR found, STOP: "No open PR found for this branch."

**Multiple PRs (explicit numbers):**
```bash
# Validate each PR exists and is open
gh pr view {number} --json number,url,headRefName,baseRefName
```

**All PRs (`--all` flag):**
```bash
# List all open PRs with review comments
gh pr list --state open --json number,url,headRefName,baseRefName,reviewDecision
```

Filter to PRs that have `CHANGES_REQUESTED` or unresolved review comments.
If zero qualifying PRs found, STOP: "No open PRs with review comments found."

Display the list and ask for confirmation before proceeding:
```
Found {N} PRs with review comments:
  #42 — feat/auth-flow (3 comments)
  #45 — fix/dynamo-ttl (1 comment)
Fix all? (y/n)
```

### 2. Multi-PR sequencing

When processing multiple PRs, run the loop **sequentially per PR**:

1. Checkout the PR's branch: `git checkout {headRefName} && git pull origin {headRefName}`
2. Run step 3 for that PR.
3. Move to the next PR.

### 3. Run review-fix-loop.sh

For each PR, delegate to the review-fix loop script. Use `--skip-initial-poll`
because the review comments already exist — skip straight to fixing.
Use `--skip-initial-tag` because we don't need to tag @claude first (the review
already happened).

```bash
bash scripts/review-fix-loop.sh \
  --pr {pr-number} \
  --project-dir {project-dir} \
  --skip-initial-poll \
  --skip-initial-tag
```

The script handles the entire cycle:
1. **Round 1:** Fetch existing comments → fix session → build gate → push → tag @claude
2. **Round 2+:** Poll for @claude response → if issues → fix → build → push → re-tag
3. **Exit:** When approved, clean review, max rounds (5), or BLOCKED

**Do NOT implement fixes directly.** The script does it.

### 4. Report results

After the loop exits, report:
1. PR URL
2. Number of fix rounds completed
3. Final status (approved / max rounds / blocked / timeout)

## Output

Display:
1. PR(s) processed
2. Rounds per PR
3. Final status per PR
4. PR URLs

## Boundaries

- ALL comments are fixed. Zero tolerance for skipping.
- The orchestrator does NOT implement fixes directly — the loop script does.
- Never close or resolve review threads programmatically — let the reviewer do it.
- If the loop script fails, STOP and report. Do not retry without user input.
- The loop has built-in safety limits: max 5 rounds, 15-min poll timeout per round.
