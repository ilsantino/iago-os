# GitHub Pipeline Setup

Step-by-step guide for enabling the iaGO review-fix loop on any GitHub repo.
This powers the async PR review cycle: pipeline creates PR → tags @claude →
Claude reviews → fixes findings → re-reviews → posts summary → you merge.

## What You Need

Two GitHub secrets on the target repo:

| Secret | What it does | Who provides it |
|--------|-------------|-----------------|
| `CLAUDE_CODE_OAUTH_TOKEN` | Authenticates Claude Code in GitHub Actions | Anthropic (your Claude plan) |
| `GH_PAT` | Posts cross-workflow signal comments | GitHub (your personal access token) |

**Why two tokens?** GitHub's built-in `GITHUB_TOKEN` cannot trigger other workflows.
The review-fix loop is two workflows chained together: `claude.yml` (review) →
`claude-review-fix.yml` (fix). The signal comment that chains them **must** come
from a Personal Access Token, not the default token.

## Step 1: Get CLAUDE_CODE_OAUTH_TOKEN

This token lets the GitHub Action run Claude Code on your behalf.

### Option A: From Anthropic Console (recommended)

1. Go to **https://console.anthropic.com**
2. Sign in with the account that has your Claude Max or Team subscription
3. Navigate to **Settings → Claude Code**
4. Under **OAuth tokens**, click **Create token**
5. Name it something like `github-actions-"orgname"`
6. Copy the token — you won't see it again

### Option B: From Claude Code CLI

```bash
# If already authenticated locally:
claude auth status
# Shows your current auth method and account

# To generate a new token:
claude auth token
# Outputs a token string — copy it
```

### Where to add it

You can add this at **org level** (covers all repos) or **repo level** (one repo at a time).

#### Org level (recommended — set once, works everywhere)

1. Go to **https://github.com/organizations/bas-labs/settings/secrets/actions**
   - You need **org admin** access for this page
2. Click **New organization secret**
3. Name: `CLAUDE_CODE_OAUTH_TOKEN`
4. Value: paste the token from Step 1
5. Repository access: select **All repositories** (or choose specific repos)
6. Click **Add secret**

#### Repo level (one repo at a time)

1. Go to `https://github.com/bas-labs/{repo-name}/settings/secrets/actions`
   - You need **admin** access to the repo
2. Click **New repository secret**
3. Name: `CLAUDE_CODE_OAUTH_TOKEN`
4. Value: paste the token from Step 1
5. Click **Add secret**

## Step 2: Create GH_PAT (GitHub Personal Access Token)

This token lets workflows post comments that trigger other workflows.

### Create the token

1. Go to **https://github.com/settings/tokens?type=beta**
   - This is your **personal** settings, not the org's
   - Use Fine-grained tokens (the `?type=beta` param takes you there)
2. Click **Generate new token**
3. Fill in:
   - **Token name:** `iago-review-loop` (or whatever you want)
   - **Expiration:** 90 days (set a calendar reminder to rotate)
   - **Resource owner:** `bas-labs` (the org that owns your repos)
   - **Repository access:** select **All repositories** (or pick specific ones)
   - **Permissions → Repository permissions:**
     - `Contents`: **Read and write** (fix agent needs to push commits)
     - `Issues`: **Read and write** (signal comments are posted on issues)
     - `Pull requests`: **Read and write** (fix agent reads PR diff, posts comments)
     - `Metadata`: **Read-only** (auto-selected, required)
   - All other permissions: leave as **No access**
4. Click **Generate token**
5. **Copy the token immediately** — you will NOT see it again

### Alternative: Classic token (simpler but broader)

1. Go to **https://github.com/settings/tokens**
2. Click **Generate new token (classic)**
3. Fill in:
   - **Note:** `iago-review-loop`
   - **Expiration:** 90 days
   - **Scopes:** check `repo` (full control of private repositories)
4. Click **Generate token**
5. Copy the token

Fine-grained is more secure (least privilege). Classic is easier (one checkbox).
Both work.

### Add GH_PAT to each repo

Unlike `CLAUDE_CODE_OAUTH_TOKEN`, **GH_PAT should be a repo-level secret** (not org-level).
This is because the PAT is tied to your personal account, and you may want different
PATs per repo or team member.

1. Go to `https://github.com/bas-labs/{repo-name}/settings/secrets/actions`
2. Click **New repository secret**
3. Name: `GH_PAT`
4. Value: paste the token from above
5. Click **Add secret**

Repeat for each repo that needs the review-fix loop.

## Step 3: Add Workflow Files

If you scaffolded the project with `/iago:scaffold` or `new-client.sh`, the
workflow files are already there. Otherwise, copy them manually:

```bash
# From iago-os root:
mkdir -p /path/to/client-repo/.github/workflows

cp templates/client-project/.github/workflows/claude.yml \
   /path/to/client-repo/.github/workflows/

cp templates/client-project/.github/workflows/claude-review-fix.yml \
   /path/to/client-repo/.github/workflows/
```

**Push to the default branch (usually `main`).** The `issue_comment` trigger
only fires if the workflow file exists on the default branch. If you put it on
a feature branch, nothing will happen.

```bash
cd /path/to/client-repo
git add .github/workflows/
git commit -m "ci: add iaGO review-fix loop workflows"
git push origin main
```

## Step 4: Add CI Review Rules to CLAUDE.md

The GitHub Action reads the repo's `CLAUDE.md` for review instructions. Add a
`## CI Review Rules` section. Minimum viable version:

```markdown
## CI Review Rules

When reviewing PRs (triggered by @claude), follow these rules:

### Output
- Report ONLY actionable findings (things that need to change)
- Do NOT list files/functions that are correct — no "clean" confirmations
- If everything is clean, just say "No issues found" and stop
- Categorize findings as **Critical**, **Important**, or **Minor**
- NEVER dismiss a finding as "acceptable" or "carry-over"
- End with a verdict: **PASS**, **PASS_WITH_CONCERNS**, or **FAIL**

### Re-Review (when previous review comments exist)
- Check if previously flagged findings have been resolved
- Report only: (1) findings that are STILL unresolved, (2) NEW findings
- Do NOT re-report findings that were fixed
- If all previous findings are resolved and no new ones, verdict is PASS

Be concise. Findings only. No filler.
```

Customize the Critical rules per project (e.g., multi-tenancy violations for
Sentria, payment flow issues for Munet).

## Verification

After setup, test the full loop:

1. Create a test branch and PR:
   ```bash
   git checkout -b test/review-loop
   echo "// test" >> src/test-file.ts
   git add src/test-file.ts
   git commit -m "test: verify review loop"
   git push -u origin test/review-loop
   gh pr create --title "test: verify review loop" --body "Testing iaGO pipeline"
   ```

2. Tag @claude on the PR:
   ```bash
   gh pr comment test/review-loop --body "@claude Review this PR."
   ```

3. Watch the Actions tab: `https://github.com/bas-labs/{repo}/actions`
   - `Claude Code` workflow should fire (review)
   - After it finishes, `Claude Review Fix Loop` should fire (fix)
   - If clean, a summary comment appears. If not, the loop continues.

4. Clean up:
   ```bash
   gh pr close test/review-loop --delete-branch
   ```

If the `Claude Code` workflow fires but `Claude Review Fix Loop` does not, the
`GH_PAT` secret is missing or doesn't have the right permissions.

## Troubleshooting

### "Resource not accessible by integration"

The `GITHUB_TOKEN` doesn't have write permissions. Check that your workflow has:

```yaml
permissions:
  contents: write
  pull-requests: write
  issues: write
  id-token: write
```

### Review works but fix loop never starts

The signal comment (`[claude-review-complete]`) must be posted via `GH_PAT`,
not `GITHUB_TOKEN`. Comments from `GITHUB_TOKEN` cannot trigger other workflows.
Verify `GH_PAT` is set and has `Issues: Read and write` permission.

### "claude-code-action" fails with auth error

`CLAUDE_CODE_OAUTH_TOKEN` is missing or expired. Check:
- Repo settings → Secrets → verify the secret exists
- If org-level, verify the repo is in the secret's repository access list
- Token may have expired — regenerate from Anthropic Console

### Fix agent can't push commits

`GH_PAT` needs `Contents: Read and write` permission. The `checkout` step in
`claude-review-fix.yml` uses `GH_PAT` as the token, so pushes authenticate
through it.

### Workflows don't fire at all

`issue_comment` workflows **must exist on the default branch**. If you added
them on a feature branch, they won't trigger until merged to main.

### Loop runs more than expected

The loop is capped at 5 rounds. If it's hitting max rounds repeatedly, the
CI Review Rules in `CLAUDE.md` may be too strict or the findings are
genuinely hard to auto-fix. Check the PR comments for the pattern.

## Token Rotation

GH_PATs expire. Set a calendar reminder for the expiration date.

To rotate:
1. Create a new token (same steps as above)
2. Update the `GH_PAT` secret on each repo
3. Delete the old token from https://github.com/settings/tokens

`CLAUDE_CODE_OAUTH_TOKEN` rotation depends on your Anthropic plan. Check
console.anthropic.com for token management.

## Quick Reference

| What | Where |
|------|-------|
| Create GH_PAT | https://github.com/settings/tokens?type=beta |
| Add repo secret | `https://github.com/bas-labs/{repo}/settings/secrets/actions` |
| Add org secret | https://github.com/organizations/bas-labs/settings/secrets/actions |
| Claude Code OAuth | https://console.anthropic.com → Settings → Claude Code |
| Workflow templates | `templates/client-project/.github/workflows/` |
| Munet workflows | `clients/munet-web/.github/workflows/` (live reference) |
| Pipeline script | `scripts/execute-pipeline.sh` (local pipeline, not GitHub) |
