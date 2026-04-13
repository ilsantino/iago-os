> **Status:** SUPERSEDED by `scripts/execute-pipeline.sh`
> The bash pipeline handles all stages without n8n. This doc is retained
> as reference for the n8n approach if needed in future.

# iaGO-OS x n8n — Cross-Session Orchestration

## What This Does

Runs the iaGO execute pipeline (implement → build → review → codex → codex fix → PR) across
multiple fresh Claude Code sessions. Each step gets clean context — no accumulation.

Single-session problem: implement 3 plans + review + fix cycles hits 90% context fast.
The review agent carries implementation noise. Fix agents carry everything. Quality degrades.

n8n solution: each `claude -p` invocation starts fresh, dedicated to exactly one task.

## Prerequisites

- n8n instance (self-hosted or cloud)
- Claude Code CLI installed and authenticated on the n8n server
- GitHub CLI (`gh`) authenticated on the n8n server
- Node.js 20+ on the n8n server
- Project cloned on the n8n server

## Quick Start

### 1. Start n8n (if self-hosted)

```bash
npx n8n
# Opens at http://localhost:5678
```

Or use the official Docker image:

```bash
docker run -it --rm --name n8n -p 5678:5678 n8nio/n8n
```

### 2. Set environment variables in n8n

Settings → Environment Variables:

| Variable | Value |
|---|---|
| `CLAUDE_PROJECT_DIR` | `/path/to/your/project` |
| `GITHUB_TOKEN` | `ghp_...` |
| `SLACK_WEBHOOK_URL` | `https://hooks.slack.com/...` (optional) |
| `N8N_IAGO_SCRIPTS` | `/path/to/iago-os/n8n/scripts` |

### 3. Make scripts executable

On the n8n server:

```bash
chmod +x /path/to/iago-os/n8n/scripts/trigger-claude.sh
chmod +x /path/to/iago-os/n8n/scripts/parse-agent-status.sh
```

### 4. Import the workflow

Workflows → Import from File → select `n8n/workflows/iago-execute-pipeline.json`

### 5. Activate the workflow

Toggle the workflow to Active. It is now listening for webhook POSTs at:
`http://localhost:5678/webhook/iago-execute`

### 6. Trigger from iaGO

Inside Claude Code:

```
/iago:execute phase-1 --n8n
```

Or trigger manually via curl:

```bash
curl -X POST http://localhost:5678/webhook/iago-execute \
  -H "Content-Type: application/json" \
  -d '{
    "phase": "phase-1",
    "plan_path": ".iago/plans/01-phase-1-01.md",
    "project_dir": "/path/to/project"
  }'
```

## Workflow Architecture

```
Webhook
    ↓
Implement (fresh session, full context budget)
    ↓
Parse Implementation (extract status + git diff)
    ↓
Build Gate (tsc --noEmit + vite build)
    ↓ fail                    ↓ pass
Fix Build (max 2)         Review (fresh session, only diff + plan)
→ Build Gate                  ↓
                          Parse Review (count Critical/Important/Minor)
                              ↓
                      Critical Findings?
                      ↓ yes               ↓ no
                Fix Critical (max 2)  Codex Review (adversarial, cross-model)
                → Build Gate               ↓
                                      Create PR (fresh session)
                                           ↓
                                      Notify (Slack)
```

## Monitoring

- n8n dashboard: execution history, timing, node-by-node status
- Slack notifications (if configured): PR URL, finding counts, duration
- Each execution logged end-to-end with timestamps

## `.iago/config.json` Setup

Add the webhook URL so `/iago:execute --n8n` knows where to POST:

```json
{
  "automation": {
    "n8n_webhook_url": "http://localhost:5678/webhook/iago-execute"
  }
}
```

## Troubleshooting

### `claude: command not found`

The n8n server process does not have Claude Code CLI in its PATH. Add it:

In n8n Settings → Environment Variables, add:
```
PATH=/usr/local/bin:/home/your-user/.local/bin:$PATH
```

Or use the full path in `trigger-claude.sh`:

```bash
OUTPUT=$(timeout "$TIMEOUT" /usr/local/bin/claude -p "$PROMPT" ...)
```

### Auth expired

Claude Code requires active authentication. Re-run `claude auth` on the server, or set
`ANTHROPIC_API_KEY` as an environment variable in n8n Settings → Environment Variables.

For GitHub CLI: run `gh auth login` on the server, or set `GITHUB_TOKEN` in n8n env vars.

### Timeout on large plans

The Implement node defaults to 600s (10 minutes). For large plans, increase the timeout
in the workflow node settings. Maximum recommended: 900s.

### Build gate always fails

The `npx tsc --noEmit && npx vite build` command requires the project to have
`typescript` and `vite` in `node_modules`. Ensure `npm install` was run in the project
directory on the n8n server.

### Worktree cleanup after cancelled run

If a run is cancelled mid-flight, the git branch may be in a dirty state:

```bash
cd /path/to/project
git stash
git checkout main
```

### n8n loop prevention

The Fix Build and Fix Critical nodes loop back to Build Gate. n8n does not have built-in
loop counters — use a workflow variable (`build_retry_count`, `retry_count`) to track
retries and route to the error handler after 2 failures. See the workflow JSON for the
IF node conditions.
