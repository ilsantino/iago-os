# iaGO-OS Cross-Session Orchestration Pipeline

n8n workflow specification for executing the iaGO pipeline across fresh Claude Code sessions.
Each step gets clean context — no accumulation.

---

## Problem

Long execute cycles accumulate context. A single session implementing 3 plans, reviewing each,
and handling fix cycles hits 90% context fast. The review agent carries implementation noise.
The fix agent carries everything. Quality degrades as context fills.

## Solution

n8n orchestrates the same pipeline (`implement → build → review → codex → codex fix → PR`) across
independent `claude -p` invocations. Each invocation starts with a fresh context budget
dedicated to its specific task.

---

## Trigger

**Webhook POST** to `/webhook/iago-execute`

**Payload:**
```json
{
  "phase": "string",
  "plan_path": "string",
  "project_dir": "string"
}
```

Example:
```bash
curl -X POST http://localhost:5678/webhook/iago-execute \
  -H "Content-Type: application/json" \
  -d '{"phase":"phase-1","plan_path":".iago/plans/01-phase-1-01.md","project_dir":"/path/to/project"}'
```

---

## Node Definitions (13 Nodes)

### Node 1: Receive Plan (Webhook)

**Type:** `n8n-nodes-base.webhook`

Accepts POST with plan details. Validates that `phase`, `plan_path`, and `project_dir` are
all present. Rejects with 400 if any are missing.

**Output fields passed downstream:**
- `phase` — phase slug
- `plan_path` — relative path to plan file
- `project_dir` — absolute project directory

---

### Node 2: Implement (Execute Command)

**Type:** `n8n-nodes-base.executeCommand`

**Timeout:** 600000ms (10 minutes)

**Command:**
```bash
./n8n/scripts/trigger-claude.sh \
  --prompt "Execute plan: $(cat $PLAN_PATH)" \
  --project-dir $DIR \
  --max-turns 50
```

Where `$PLAN_PATH` and `$DIR` are substituted from the webhook payload via n8n expressions:
- `={{ $json.plan_path }}`
- `={{ $json.project_dir }}`

Full command in n8n expression:
```
={{ "cd " + $json.project_dir + " && " + $env.N8N_IAGO_SCRIPTS + "/trigger-claude.sh --prompt \"Execute plan: $(cat " + $json.plan_path + ")\" --project-dir " + $json.project_dir + " --max-turns 50" }}
```

**Output:** JSON from `trigger-claude.sh` — `{ "exit_code": N, "output": "...", "duration_ms": N }`

---

### Node 3: Parse Implementation (Code)

**Type:** `n8n-nodes-base.code`

Extracts agent status from the implementation output and captures the git diff.

**Logic:**
1. Call `parse-agent-status.sh` with the claude output and project dir.
2. Parse result into structured fields: `status`, `diff`, `critical_count`, `important_count`, `minor_count`.
3. If `status` is `BLOCKED` or `NEEDS_CONTEXT`, set a flag to skip to the Notify node.

**Code (JavaScript):**
```js
const output = $json.output || "";
const projectDir = $("Receive Plan").item.json.project_dir;
const { execSync } = require("child_process");

const escapedOutput = output.replace(/'/g, "'\\''");
const result = execSync(
  `${process.env.N8N_IAGO_SCRIPTS}/parse-agent-status.sh --output '${escapedOutput}' --project-dir '${projectDir}'`
).toString();

return [{ json: JSON.parse(result) }];
```

---

### Node 4: Build Gate (Execute Command)

**Type:** `n8n-nodes-base.executeCommand`

**Timeout:** 120000ms (2 minutes)

**Command:**
```
={{ "cd " + $("Receive Plan").item.json.project_dir + " && npx tsc --noEmit && npx vite build 2>&1; echo \"EXIT:$?\"" }}
```

Captures both stdout/stderr combined, appends `EXIT:N` at the end so the next node can
extract the exit code from the output string.

---

### Node 5: Build Failed? (IF)

**Type:** `n8n-nodes-base.if`

**Condition:** Check if the build output contains `EXIT:0`.
- If NOT present (build failed) → route to Node 6 (Fix Build)
- If present → route to Node 7 (Review)

**Expression:**
```
={{ !$json.stdout.includes("EXIT:0") }}
```

---

### Node 6: Fix Build (Execute Command)

**Type:** `n8n-nodes-base.executeCommand`

**Timeout:** 600000ms (10 minutes)

Dispatches a fresh Claude session to fix the build errors. Tracked by `build_retry_count`
workflow variable (max 2 retries — after 2 failures, routes to error handler).

**Command:**
```
={{ $env.N8N_IAGO_SCRIPTS + "/trigger-claude.sh --prompt \"Fix build errors in " + $("Receive Plan").item.json.project_dir + ": " + $json.stdout + "\" --project-dir " + $("Receive Plan").item.json.project_dir + " --max-turns 30" }}
```

**Retry routing:** After fix, loops back to Node 4 (Build Gate). If `build_retry_count >= 2`,
routes to error handler instead.

---

### Node 7: Review (Execute Command)

**Type:** `n8n-nodes-base.executeCommand`

**Timeout:** 300000ms (5 minutes)

Dispatches a fresh Claude session to review the diff against the plan.

**Command:**
```
={{ $env.N8N_IAGO_SCRIPTS + "/trigger-claude.sh --prompt \"Review this diff against plan " + $("Receive Plan").item.json.plan_path + ": " + $("Parse Implementation").item.json.diff + "\" --project-dir " + $("Receive Plan").item.json.project_dir + " --max-turns 25" }}
```

---

### Node 8: Parse Review (Code)

**Type:** `n8n-nodes-base.code`

Extracts findings from the review output. Counts Critical, Important, and Minor findings.

**Code (JavaScript):**
```js
const output = $json.output || "";
const lines = output.split("\n");

const findings = lines.filter(l =>
  /\*\*(Critical|Important|Minor)\*\*/i.test(l)
);

const critical_count = findings.filter(l => /Critical/i.test(l)).length;
const important_count = findings.filter(l => /Important/i.test(l)).length;
const minor_count = findings.filter(l => /Minor/i.test(l)).length;

return [{ json: { findings, critical_count, important_count, minor_count, raw_review: output } }];
```

---

### Node 9: Critical Findings? (IF)

**Type:** `n8n-nodes-base.if`

**Condition:** `critical_count > 0`

- Yes → Node 10 (Fix Critical)
- No → Node 11 (Codex Review)

**Expression:**
```
={{ $json.critical_count > 0 }}
```

---

### Node 10: Fix Critical (Execute Command)

**Type:** `n8n-nodes-base.executeCommand`

**Timeout:** 600000ms (10 minutes)

Dispatches a fresh Claude session with the critical findings for fixes. Tracked by
`retry_count` workflow variable (max 2 rounds — routes to error handler after 2 failures).
After fix, loops back to Node 4 (Build Gate).

**Command:**
```
={{ $env.N8N_IAGO_SCRIPTS + "/trigger-claude.sh --prompt \"Fix these critical findings in " + $("Receive Plan").item.json.project_dir + ": " + JSON.stringify($("Parse Review").item.json.findings.filter(f => /Critical/i.test(f))) + "\" --project-dir " + $("Receive Plan").item.json.project_dir + " --max-turns 40" }}
```

---

### Node 11: Codex Review (Execute Command)

**Type:** `n8n-nodes-base.executeCommand`

**Timeout:** 300000ms (5 minutes)

Runs the cross-model adversarial review. Targets auth bypass, data loss, race conditions,
rollback safety, and business logic errors.

**Command (if Codex CLI is available):**
```
={{ "cd " + $("Receive Plan").item.json.project_dir + " && codex review --diff \"" + $("Parse Implementation").item.json.diff + "\"" }}
```

**Fallback (trigger-claude with adversarial prompt):**
```
={{ $env.N8N_IAGO_SCRIPTS + "/trigger-claude.sh --prompt \"Adversarial review of this diff — check for auth bypass, data loss, race conditions, rollback safety, business logic errors: " + $("Parse Implementation").item.json.diff + "\" --project-dir " + $("Receive Plan").item.json.project_dir + " --max-turns 20" }}
```

---

### Node 12: Create PR (Execute Command)

**Type:** `n8n-nodes-base.executeCommand`

**Timeout:** 120000ms (2 minutes)

Dispatches a fresh Claude session to stage, commit, and create the PR.

**Command:**
```
={{ $env.N8N_IAGO_SCRIPTS + "/trigger-claude.sh --prompt \"Create PR for plan " + $("Receive Plan").item.json.plan_path + " — stage changes, write conventional commit, push branch, create PR via gh, output the PR URL\" --project-dir " + $("Receive Plan").item.json.project_dir + " --max-turns 15" }}
```

Captures the PR URL from the output (Claude will output it as part of its response).

---

### Node 13: Notify (HTTP Request)

**Type:** `n8n-nodes-base.httpRequest`

**Method:** POST

**URL:** `={{ $env.SLACK_WEBHOOK_URL }}`

**Body:**
```json
{
  "text": "iaGO Pipeline Complete",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Plan:* `{{ $('Receive Plan').item.json.plan_path }}`\n*PR:* {{ $('Create PR').item.json.output }}\n*Critical:* {{ $('Parse Review').item.json.critical_count }} | *Important:* {{ $('Parse Review').item.json.important_count }} | *Minor:* {{ $('Parse Review').item.json.minor_count }}\n*Duration:* {{ Math.round(($('Implement').item.json.duration_ms + $('Review').item.json.duration_ms) / 60000) }} min"
      }
    }
  ]
}
```

---

## Error Handler (Separate Workflow)

A second n8n workflow listens for errors from the main pipeline.

**Trigger:** Workflow Error trigger

**Action:** POST to Slack webhook with:
- Node name where failure occurred
- Error message
- Plan path and phase from the execution context
- Timestamp

**Slack message format:**
```
Pipeline FAILED
Node: {node_name}
Error: {error_message}
Plan: {plan_path}
Phase: {phase}
Time: {timestamp}
```

---

## Data Flow

```
Webhook (Node 1)
    ↓
Implement (Node 2) — fresh session, full context budget
    ↓
Parse Implementation (Node 3) — extract status + diff
    ↓
Build Gate (Node 4)
    ↓ fail                    ↓ pass
Fix Build (Node 6)       Review (Node 7) — fresh session, only diff + plan
max 2 retries               ↓
→ Build Gate (Node 4)   Parse Review (Node 8)
                            ↓
                    Critical Findings? (Node 9)
                    ↓ yes                    ↓ no
              Fix Critical (Node 10)    Codex Review (Node 11) — cross-model
              max 2 rounds               ↓
              → Build Gate (Node 4)    Create PR (Node 12) — fresh session
                                            ↓
                                       Notify (Node 13) — Slack
```

---

## Workflow Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `retry_count` | number | 0 | Fix cycle counter — incremented on each critical fix round |
| `build_retry_count` | number | 0 | Build fix counter — incremented on each build fix attempt |
| `findings` | array | [] | Accumulated review findings across all rounds |
| `pr_url` | string | "" | Set by Node 12 (Create PR) — used in Notify |
| `start_time` | number | Date.now() | Milliseconds timestamp — set at Node 1 for duration calculation |

---

## Environment Variables

Set these in n8n: **Settings → Environment Variables**

| Variable | Required | Description |
|---|---|---|
| `CLAUDE_PROJECT_DIR` | Yes | Default project root path (can be overridden per-trigger) |
| `GITHUB_TOKEN` | Yes | GitHub PAT for PR creation via `gh` CLI |
| `SLACK_WEBHOOK_URL` | No | Slack incoming webhook URL for notifications |
| `N8N_IAGO_SCRIPTS` | Yes | Absolute path to `n8n/scripts/` directory on the n8n server |

---

## Prerequisites

No IAM roles required — n8n runs locally or on a VPS. The server running n8n must have:

- **Claude Code CLI** — authenticated (`claude auth` or `ANTHROPIC_API_KEY` env var)
- **GitHub CLI** (`gh`) — authenticated (`gh auth login`)
- **Node.js 20+** — required for build commands
- **Project cloned** — at the path specified in `project_dir`
- **n8n/scripts/ accessible** — `trigger-claude.sh` and `parse-agent-status.sh` must be executable

---

## Node Positioning (Visual Layout)

Nodes positioned for left-to-right readability when imported:

| Node | X | Y |
|---|---|---|
| Receive Plan | 0 | 300 |
| Implement | 200 | 300 |
| Parse Implementation | 400 | 300 |
| Build Gate | 600 | 300 |
| Build Failed? | 800 | 300 |
| Fix Build | 1000 | 450 |
| Review | 1000 | 300 |
| Parse Review | 1200 | 300 |
| Critical Findings? | 1400 | 300 |
| Fix Critical | 1600 | 450 |
| Codex Review | 1600 | 300 |
| Create PR | 1800 | 300 |
| Notify | 2000 | 300 |
