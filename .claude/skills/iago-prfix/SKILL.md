---
name: iago-prfix
description: >-
  Use after a PR review to fix all review comments on the current branch's PR.
  Fetches comments via gh, dispatches parallel agents to fix, verifies, runs
  tests/linter, commits, pushes, and tags @claude for re-review.
---

## Purpose

Fix every review comment on this branch's open PR to main. No comment is skipped
regardless of severity. After all fixes are verified and pushed, request another
review from Claude.

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

### 1b. Multi-PR sequencing

When processing multiple PRs, execute steps 2–7 **sequentially per PR**:

1. Checkout the PR's branch: `git checkout {headRefName} && git pull origin {headRefName}`
2. Run steps 2–7 for that PR.
3. Move to the next PR.

Each PR is an independent cycle — one plan, one pipeline run, one push, one
re-review comment. Do not batch comments from different PRs into one plan.

### 2. Fetch all review comments

```bash
# Get PR review comments (inline code comments from reviewers)
gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate

# Get PR issue-level comments (general review comments)
gh api repos/{owner}/{repo}/issues/{number}/comments --paginate

# Get PR reviews with body text
gh api repos/{owner}/{repo}/pulls/{number}/reviews --paginate
```

Parse all comments. Extract for each:
- **body** — the reviewer's comment text
- **path** — file path (for inline comments)
- **line / original_line** — line number
- **diff_hunk** — surrounding code context
- **user** — who left it (skip bot noise, keep reviewer feedback)

Filter out:
- Comments that are pure acknowledgments ("LGTM", "looks good", etc.)
- Comments from the PR author themselves (self-comments are not review findings)
- Already-resolved comment threads (if the API indicates resolution)

Build a deduplicated list of actionable review findings.

If zero actionable comments found, STOP: "No actionable review comments found."

### 3. Assess scope and route

Count the number of unique files affected and total findings.

| Condition | Route |
|-----------|-------|
| ≤3 files, ≤5 findings, all obvious fixes | Write a quick plan, run via `/iago:quick` |
| >3 files OR >5 findings OR any architectural concern | Write a plan, run via `/iago:execute` |

**Both routes go through the 3-stage review pipeline. There is no skip path.**

### 4. Create the plan

Write `.iago/plans/quick-{YYMMDD}-pr-fix.md` (for quick route) or
`.iago/plans/{NN}-pr-fix-{slug}.md` (for execute route):

```markdown
---
phase: pr-fix
plan: {plan-id}
wave: 1
depends_on: []
created: {YYYY-MM-DD}
branch: {current-branch}
base: main
pr: {pr-number}
---

# PR Fix: Address all review comments on #{pr-number}

## Goal

Fix every review comment on PR #{pr-number}. No comment is skipped regardless
of severity.

## PR Prompt

**FIX ALL THE ISSUES. DO NOT SKIP ANY, REGARDLESS OF SEVERITY.**
Determine whether to use iago-execute or iago-quick based on scope, but the fix
MUST go through the 3-stage review pipeline. Once done, tag @claude in a comment
for another review — just tag and ask for review, nothing else.

## Review Comments

{For each comment, include:}

### Comment {N}: [{file}:{line}]
- **Reviewer:** {user}
- **File:** `{path}`
- **Line:** {line}
- **Comment:** {body}
- **Context:**
  ```
  {diff_hunk or surrounding code}
  ```
- **Required fix:** {what needs to change based on the comment}

## Files

| Action | Path | Purpose |
|--------|------|---------|
{table of files to modify}

## Tasks

{One task per comment or group of related comments in the same file}

### Task {N}: Fix {short description}
- **files:** `{path}`
- **action:** {specific instruction derived from the review comment}
- **verify:** `{verification command}`
- **expected:** {expected output}
```

### 5. Execute via pipeline

**For quick route:**
```bash
bash scripts/execute-pipeline.sh \
  --plan .iago/plans/quick-{YYMMDD}-pr-fix.md \
  --project-dir {project-dir}
```

**For execute route:**
Invoke `/iago:execute` with the plan.

The pipeline handles: implement → build gate → review → codex adversarial → PR.

**Do NOT implement fixes directly.** The pipeline does it.

### 6. Post-pipeline verification

After the pipeline completes successfully:

1. Read every file that was changed.
2. Cross-check each original review comment against the changes.
3. Confirm every single comment was addressed — no exceptions.
4. If anything was missed:
   - Fix it directly (inline, since the pipeline already ran).
   - Run verification: `npx tsc --noEmit`, `npx vitest run`, `npx biome check`.
   - Amend the commit or create a follow-up commit.
   - Push.

### 7. Push and request re-review

```bash
# Push if not already pushed by the pipeline
git push origin {branch}

# Tag @claude requesting another review — nothing else
gh pr comment {pr-number} --body "@claude Please review again."
```

The comment MUST be exactly a tag and a review request. No summaries, no lists
of changes, no extra context. Just tag and ask.

## Output

Display:
1. Number of review comments found
2. Route chosen (quick / execute)
3. Pipeline result (pass/fail)
4. Verification: all comments addressed (yes/no, with details if no)
5. PR URL

## Boundaries

- ALL comments are fixed. Zero tolerance for skipping.
- Fixes MUST go through the 3-stage review pipeline (no `/iago:fast` bypass).
- The orchestrator does NOT implement fixes directly — the pipeline does.
- Post-pipeline catch-up fixes (step 6) are the ONLY exception to inline editing.
- Never close or resolve review threads programmatically — let the reviewer do it.
- If the pipeline fails, STOP and report. Do not retry without user input.
