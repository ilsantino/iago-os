# PR Review Pipeline — Setup Guide

## Overview

The iaGO review pipeline runs in two phases:

1. **Local pipeline** (`scripts/execute-pipeline.sh`) — implement → build gate →
   review → codex adversarial → codex fix → create PR → tag @claude → summary.
   Each step is a separate `claude -p` session with fresh context.

2. **Async review-fix loop** (GitHub Actions) — triggered by the @claude tag on
   the PR. Claude Code Action reviews, posts findings, a fix workflow applies
   fixes and re-tags. Loops until clean or max 5 rounds.

The local pipeline runs on every plan execution. The async loop is opt-in for
`/iago:quick` (pass `--review`) and automatic for `/iago:execute` (suppress with
`--no-review`).

## Prerequisites

- GitHub repository with Actions enabled
- `gh` CLI installed and authenticated (`gh auth login`)
- Claude Code CLI installed (`claude` command available)
- Codex CLI (optional — falls back to `claude -p` for adversarial review)

## Secrets Setup

Add these secrets in your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**.

### CLAUDE_CODE_OAUTH_TOKEN

OAuth token for the Claude Code GitHub Action. Obtained from Anthropic.

1. Visit the Anthropic Console
2. Generate an OAuth token for Claude Code
3. Add as repo secret: `CLAUDE_CODE_OAUTH_TOKEN`

### GH_PAT

GitHub Personal Access Token. Required for the review-fix loop to post comments
and re-tag @claude (the default `GITHUB_TOKEN` cannot trigger workflows).

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Create token with scopes:
   - `repo` — full repository access (read/write)
   - `workflow` — update GitHub Actions workflows
3. Add as repo secret: `GH_PAT`

**Important:** If using fine-grained tokens, grant the token access to the
specific repository, with Read & Write permissions for: Contents, Issues,
Pull requests, and Workflows.

## Workflow Files

Two GitHub Actions workflows power the async loop. Both live in `.github/workflows/`.

### claude.yml — Review Trigger

- **Trigger:** `issue_comment` — fires when @claude is mentioned in a PR comment
- **What it does:** Runs the Claude Code Action to review the PR
- **Output:** Posts a review comment with findings, then posts a
  `[claude-review-complete]` signal comment (via `GH_PAT`)
- **Guards:** Skips if PR is merged/closed (`state == open` check)

### claude-review-fix.yml — Fix Loop

- **Trigger:** `issue_comment` — fires on the `[claude-review-complete]` signal
- **What it does:**
  1. Parses findings from the review comment
  2. Checks round count (max 5)
  3. If findings exist: dispatches a fix agent, commits, pushes, re-tags @claude
  4. If clean: posts a summary comment — human reviews and merges
  5. If max rounds: posts a notice — manual review required
- **Guards:** Skips merged/closed PRs, checks round count before fixing

See the actual workflow files for full configuration — they contain allowedTools
lists, model selection, and prompt construction.

## CLAUDE.md Review Rules

For the CI review sessions (which run with their own CLAUDE.md context), add a
section to the client project's CLAUDE.md:

```markdown
## CI Review Rules

- Review the full diff against the PR description
- Categorize findings: Critical (must fix), Important (should fix), Minor (nit)
- Critical: security vulnerabilities, data loss, auth bypass, broken functionality
- Important: missing error handling, performance issues, incomplete implementation
- Minor: naming, formatting, documentation gaps
- End with verdict: PASS, PASS_WITH_CONCERNS, or FAIL
- Never dismiss findings — report with severity, the fix loop handles prioritization
```

This ensures the Claude Code Action sessions use consistent review criteria.

## Control Flags

| Skill | Flag | Default behavior | Effect |
|-------|------|-----------------|--------|
| `/iago:execute` | `--no-review` | Auto-tags @claude on PR | Skips @claude tag; PR created but async loop not triggered |
| `/iago:quick` | `--review` | No @claude tag (PR only) | Tags @claude on PR; enables async review-fix loop |
| Pipeline script | `--no-tag` | Tags @claude (step 5b) | Skips step 5b entirely |

**Relationship:** `--no-review` on `/iago:execute` passes `--no-tag` to the
pipeline script. `--review` on `/iago:quick` omits the default `--no-tag`.

## Manual Trigger

To trigger the async review-fix loop on any existing PR:

```
/iago:prfix
```

This tags @claude on the current branch's PR, which triggers `claude.yml` →
`claude-review-fix.yml` → fix loop. Works on any PR regardless of how it was
created.

## Troubleshooting

### GH_PAT missing or expired

**Symptom:** Review-fix loop doesn't trigger after @claude review completes.
The signal comment (`[claude-review-complete]`) is not posted.

**Fix:** Regenerate the PAT and update the repo secret. Check token expiry date.

### CLAUDE_CODE_OAUTH_TOKEN invalid

**Symptom:** `claude.yml` workflow fails with authentication error.

**Fix:** Regenerate the OAuth token from Anthropic Console and update the repo
secret.

### Workflow not triggering

**Symptom:** @claude comment posted but no workflow runs.

**Fix:** `issue_comment` workflows run from the **default branch** (main). If
the workflow file only exists on a feature branch, it won't fire. Merge the
workflow files to main first.

### Loop stuck (not progressing)

**Symptom:** Same findings appear round after round.

**Fix:** Check the round count in the workflow logs. If the fix agent isn't
resolving findings, the loop will cap at 5 rounds and post a notice. Review
manually at that point.

### Claude Code Action silently failing

**Symptom:** Workflow runs but no review comment appears.

**Fix:** Check the `allowedTools` list in the workflow. The Claude Code Action
needs specific tools allowed (Read, Glob, Grep, Bash for review; Edit, Write
additionally for fix). Also check that the model parameter is valid.

### PR not created

**Symptom:** Pipeline completes but no PR URL in output.

**Fix:** Ensure `gh` CLI is authenticated (`gh auth status`). Check that the
branch was pushed (`git log --oneline origin/{branch}`). The pipeline logs
show the PR creation step output.

## Architecture Diagram

```
Local Pipeline (execute-pipeline.sh)
═══════════════════════════════════════════════════════════

  IMPLEMENT ─► BUILD GATE ─► REVIEW ─► CODEX ─► CODEX FIX ─► CREATE PR
  (opus)       (tsc+vite)    (opus)    (codex/   (opus)       (sonnet)
                              plan +    opus)    +rebuild
                              adv      plan +    if findings
                              fix ALL   diff
                              locally
                                                                │
                                          ┌─────────────────────┘
                                          ▼
                                    TAG @claude ──────────┐
                                    (haiku)               │
                                          │               │
                                          ▼               │ --no-tag
                                      SUMMARY             │ skips this
                                                          │
                                                          │
Async Review-Fix Loop (GitHub Actions)    ◄───────────────┘
═══════════════════════════════════════════════════════════

  @claude tag on PR
       │
       ▼
  claude.yml ── Claude Code Action reviews PR
       │
       ▼
  Posts [claude-review-complete] signal (via GH_PAT)
       │
       ▼
  claude-review-fix.yml
       │
       ├── CLEAN ──────────► post summary ──► human merges
       │
       ├── MAX ROUNDS (>5) ► post notice ──► manual review
       │
       └── FINDINGS ──► fix agent ──► commit + push
                                         │
                                         ▼
                                    re-tag @claude
                                         │
                                         └──► loops back to claude.yml
```
