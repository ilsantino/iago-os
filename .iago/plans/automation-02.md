---
phase: automation
plan: 02
wave: 2
depends_on: [automation-01]
created: 2026-04-06
---

# Plan: automation-02 — n8n cross-session orchestration pipeline

## Goal

Design and scaffold the n8n workflow that orchestrates the iaGO execute cycle
across multiple fresh Claude Code sessions — eliminating context accumulation
as the bottleneck. Each step (implement, build gate, review, codex review, fix)
runs in its own session with clean context.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `docs/automations/cross-session-pipeline.md` | Full n8n workflow specification |
| create | `n8n/README.md` | Setup guide for the n8n orchestration layer |
| create | `n8n/workflows/iago-execute-pipeline.json` | Exportable n8n workflow definition |
| create | `n8n/scripts/trigger-claude.sh` | Shell wrapper for invoking `claude -p` from n8n |
| create | `n8n/scripts/parse-agent-status.sh` | Extracts DONE/BLOCKED/NEEDS_CONTEXT from claude output |
| modify | `.claude/skills/iago-execute/SKILL.md` | Add `--n8n` flag for headless mode |
| modify | `docs/MANUAL.md` | Add "Cross-Session Orchestration" section |

## Tasks

### Task 1: Design the n8n workflow specification
- **files:** `docs/automations/cross-session-pipeline.md`
- **action:** Write the full workflow spec following the iago-n8n skill format. The workflow implements the iago-execute pipeline across sessions:

**Trigger:** Webhook (POST from `/iago:execute --n8n`) or manual trigger in n8n UI. Payload: `{ phase, plan_path, project_dir, config }`.

**Nodes:**
1. **Implement** — Execute node runs `claude -p "Execute this plan: {plan_content}" --project-dir {dir}`. Uses worktree isolation. Captures stdout + exit code.
2. **Parse status** — Code node extracts agent status (DONE/BLOCKED/NEEDS_CONTEXT) and git diff from output.
3. **Build gate** — Execute node runs `cd {dir} && npx tsc --noEmit && npx vite build`. Branch on exit code.
4. **Build fix loop** — If build fails, runs `claude -p "Fix these build errors: {stderr}"`. Max 2 retries via n8n retry logic. If still fails → Slack/email alert + stop.
5. **Review** — Execute node runs `claude -p "Review this diff against plan {plan_path}: {diff}"`. Fresh session, no implementation context.
6. **Parse review** — Code node extracts findings, categorizes Critical/Important/Minor.
7. **Review gate** — IF node: Critical findings → fix branch. No criticals → continue.
8. **Fix cycle** — Runs `claude -p "Fix these critical findings: {findings}"`. Back to build gate. Max 2 rounds via counter variable.
9. **Codex review** — Execute node runs `codex review {diff}` or `claude -p "/codex:adversarial-review"`. Fresh session.
10. **Parse codex** — Same pattern as review parse.
11. **PR creation** — Execute node runs `claude -p "Create PR for plan {plan}: {summary}"`. Captures PR URL.
12. **Notify** — HTTP Request node posts to Slack/webhook with: plan name, PR URL, finding counts, total duration.
13. **Error handler** — Global error workflow: captures any node failure, posts to Slack with context.

**State variables** (n8n workflow variables):
- `retry_count` (0-2, tracks fix attempts)
- `build_retry_count` (0-2, tracks build fix attempts)
- `findings` (array, accumulated review findings)
- `pr_url` (string, set by PR creation node)
- `total_start` (timestamp, for duration tracking)

**Data flow diagram:**
```
Webhook → Implement → Parse → Build Gate
    ↓ fail                    ↓ fail
  STOP                    Build Fix → Build Gate (max 2)
                              ↓ pass
                          Review → Parse → Review Gate
                              ↓ critical         ↓ clean
                          Fix Cycle → Build Gate  Codex Review
                          (max 2)                     ↓
                                                  Codex Gate
                                                  ↓ clean
                                                  Create PR → Notify
```

Include IAM permissions for each AWS service touched. Include environment variables needed (CLAUDE_API_KEY, PROJECT_DIR, GITHUB_TOKEN).

- **verify:** `test -f docs/automations/cross-session-pipeline.md && grep -c "Node" docs/automations/cross-session-pipeline.md`
- **expected:** File exists, 10+ node references

### Task 2: Create the shell wrappers
- **files:** `n8n/scripts/trigger-claude.sh`, `n8n/scripts/parse-agent-status.sh`
- **action:** Create `n8n/` directory and `n8n/scripts/` subdirectory. 

`trigger-claude.sh` accepts: `--prompt`, `--project-dir`, `--max-turns` (default 50), `--model` (default sonnet). It invokes `claude -p "$PROMPT" --project-dir "$DIR" --model "$MODEL" --max-turns "$MAX_TURNS" --output-format json 2>&1`. Captures exit code and stdout. Outputs JSON: `{ "exit_code": N, "output": "...", "duration_ms": N }`. Handles timeout (10 min default via `timeout` command).

`parse-agent-status.sh` accepts stdout from trigger-claude. Extracts: (1) agent status (grep for DONE|BLOCKED|NEEDS_CONTEXT|DONE_WITH_CONCERNS), (2) git diff (runs `git diff HEAD~1` in project dir), (3) findings (grep for Critical|Important|Minor). Outputs JSON: `{ "status": "DONE", "diff": "...", "findings": [...], "critical_count": N }`.

Both scripts should be POSIX-compatible (no bash-isms) for portability.

- **verify:** `bash -n n8n/scripts/trigger-claude.sh && bash -n n8n/scripts/parse-agent-status.sh && echo "PASS"`
- **expected:** `PASS`

### Task 3: Create exportable n8n workflow JSON
- **files:** `n8n/workflows/iago-execute-pipeline.json`
- **action:** Create the n8n workflow JSON that can be imported via n8n's "Import from file" feature. The JSON should implement the workflow designed in Task 1. Use Execute Command nodes for claude invocations (calling trigger-claude.sh), Code nodes for parsing, IF nodes for gates, and HTTP Request nodes for notifications. Set credential placeholders for: `CLAUDE_PROJECT_DIR`, `GITHUB_TOKEN`, `SLACK_WEBHOOK_URL` (all as n8n environment variables, not hardcoded). Include error handling workflow that catches any node failure. Set reasonable timeouts: 10 min for implementation, 5 min for review, 5 min for codex, 2 min for build gate.
- **verify:** `node -e "const w = JSON.parse(require('fs').readFileSync('n8n/workflows/iago-execute-pipeline.json', 'utf8')); console.log('nodes:', w.nodes?.length || 0); console.log(w.nodes?.length > 5 ? 'PASS' : 'FAIL');"`
- **expected:** `PASS` with 10+ nodes

### Task 4: Create n8n setup guide
- **files:** `n8n/README.md`
- **action:** Write a setup guide covering: (1) Prerequisites — n8n instance (self-hosted or cloud), Claude Code CLI installed on the n8n server, GitHub CLI authenticated, Node.js 20+. (2) Environment variables — `CLAUDE_PROJECT_DIR`, `GITHUB_TOKEN`, `SLACK_WEBHOOK_URL` (optional). (3) Import workflow — step-by-step for importing the JSON file. (4) Configure credentials — where to set up the env vars in n8n. (5) Test run — how to trigger manually from n8n UI. (6) Production setup — webhook URL for automated triggering from `/iago:execute --n8n`. (7) Troubleshooting — common issues (claude not in PATH, auth expired, timeout, worktree cleanup).
- **verify:** `test -f n8n/README.md && grep -c "Prerequisites" n8n/README.md`
- **expected:** File exists, 1+ Prerequisites reference

### Task 5: Add --n8n flag to iago-execute
- **files:** `.claude/skills/iago-execute/SKILL.md`
- **action:** Add a `--n8n` flag to iago-execute's Arguments section. When `--n8n` is set, instead of dispatching agents in-session, the skill: (1) Validates plans and wave structure as normal. (2) For each plan, constructs the webhook payload: `{ phase, plan_path, plan_content, project_dir, config }`. (3) Sends a POST to the n8n webhook URL (read from `.iago/config.json` field `automation.n8n_webhook_url`). (4) Reports: "Dispatched {N} plans to n8n pipeline. Monitor at {n8n_dashboard_url}." (5) Does NOT wait for completion — the n8n pipeline handles everything asynchronously. Add a note: "Requires n8n pipeline setup. See `n8n/README.md`."

Also add `automation` section to the config.json schema description: `"automation": { "n8n_webhook_url": "", "n8n_dashboard_url": "", "slack_webhook_url": "" }`.

- **verify:** `grep -c "n8n" .claude/skills/iago-execute/SKILL.md`
- **expected:** 3+ references to n8n

### Task 6: Update MANUAL.md with cross-session orchestration
- **files:** `docs/MANUAL.md`
- **action:** Add a "## Cross-Session Orchestration" section after the "Scheduled Automation" section (from Plan 01). Content: explain the problem (context accumulation during long execute cycles), the solution (n8n orchestrates fresh Claude Code sessions per step), the architecture diagram (from Task 1 data flow), how to set it up (reference n8n/README.md), how to trigger it (`/iago:execute phase --n8n`), and how to monitor (n8n dashboard + Slack notifications). Include a comparison table: single-session vs n8n pipeline (context usage, parallelism, review quality, setup complexity).
- **verify:** `grep -c "Cross-Session Orchestration" docs/MANUAL.md`
- **expected:** 1

## Verification

After all tasks: `test -f docs/automations/cross-session-pipeline.md && test -f n8n/workflows/iago-execute-pipeline.json && test -f n8n/scripts/trigger-claude.sh && grep "n8n" .claude/skills/iago-execute/SKILL.md && echo "PLAN-02 PASS"`

Expected: `PLAN-02 PASS`
