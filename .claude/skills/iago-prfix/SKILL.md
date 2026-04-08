---
name: iago-prfix
description: >-
  Use after a PR review to fix all review comments on the current branch's PR.
  Tags @claude on the PR, which triggers the GitHub Action review-fix loop.
---

## Purpose

Fix every review comment on this branch's open PR to main. Tags @claude for a
REVIEW (not fix) — `claude.yml` reviews, then `claude-review-fix.yml` handles
the automated fix → build → push → re-review loop (max 5 rounds).

## Arguments

`/iago:prfix` — fix all comments on the current branch's PR.

Optional:
- `{pr-number}` — target a specific PR (e.g., `/iago:prfix 42`).
- `{pr-number} {pr-number} ...` — fix multiple PRs sequentially.
- `--all` — find and fix all open PRs with unresolved review comments.

## Preconditions

- `gh` CLI must be authenticated.
- If no PR numbers given and no `--all` flag: must be on a feature branch with
  an open PR to main.
- The repo must have `.github/workflows/claude-review-fix.yml` installed.

## Steps

### 1. Identify the PR(s)

**Single PR (default):**
```bash
gh pr view --json number,url,headRefName,baseRefName
```

If no open PR found, STOP: "No open PR found for this branch."

**Multiple PRs (explicit numbers):**
```bash
gh pr view {number} --json number,url,headRefName,baseRefName
```

**All PRs (`--all` flag):**
```bash
gh pr list --state open --json number,url,headRefName,baseRefName,reviewDecision
```

Filter to PRs that have `CHANGES_REQUESTED` or unresolved review comments.

### 2. Tag @claude on each PR

For each PR, post a comment that triggers `claude.yml` to REVIEW:

```bash
gh pr comment {number} --body "@claude Review this PR. Check all existing review comments and whether they have been addressed. Flag any unresolved findings. General pass for anything unexpected."
```

The review-fix loop handles everything after:
1. `claude.yml` reviews → posts findings → signals `[claude-review-complete]`
2. `claude-review-fix.yml` fixes all findings → pushes → re-tags @claude
3. `claude.yml` re-reviews → if clean, posts summary → human merges
4. If still findings → loop repeats (max 5 rounds)

### 3. Report

Display:
1. PR(s) tagged
2. PR URLs
3. "Review-fix loop running on GitHub Actions. Check PR for progress."

## Boundaries

- ALL comments are fixed. Zero tolerance for skipping.
- The orchestrator does NOT implement fixes directly — the Action does.
- Never close or resolve review threads programmatically.
- The loop has built-in safety limits: max 5 rounds.
