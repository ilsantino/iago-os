# Trigger Templates

Ready-to-use scheduled automation templates for iaGO-OS projects. Install via `/iago:schedule {template-name}` or create custom triggers with `/iago:schedule create`.

---

## 1. nightly-review

**Description:** Runs a code review against today's commits every weeknight. Catches regressions and style drift before the next morning.

**cron:** `"43 22 * * 1-5"` (10:43pm, Monday–Friday)

**Prompt:**
```
Run /code-review --against main for today's commits. Report findings.
```

**When to use:** Active development phases where multiple commits land daily.

**Produces:** Review findings with Critical/Important/Minor severity in terminal output.

**RemoteTrigger API body:**
```json
{
  "schedule": "43 22 * * 1-5",
  "prompt": "Run /code-review --against main for today's commits. Report findings.",
  "project_directory": "$PROJECT_DIR"
}
```

---

## 2. usage-digest

**Description:** Generates a weekly summary of skill usage, agent dispatches, and session activity every Monday morning.

**cron:** `"17 9 * * 1"` (9:17am, Monday)

**Prompt:**
```
Run ./scripts/usage-report.sh and summarize: top skills used, agent dispatch count, session count for the past week.
```

**When to use:** Ongoing projects — track team productivity and identify which parts of the workflow are getting the most use.

**Produces:** Usage summary with skill invocations, dispatch counts, and session durations.

**RemoteTrigger API body:**
```json
{
  "schedule": "17 9 * * 1",
  "prompt": "Run ./scripts/usage-report.sh and summarize: top skills used, agent dispatch count, session count for the past week.",
  "project_directory": "$PROJECT_DIR"
}
```

---

## 3. stale-handoff

**Description:** Checks daily whether a paused session has gone stale. Warns when HANDOFF.json is older than 3 days so paused work doesn't get forgotten.

**cron:** `"23 8 * * *"` (8:23am, daily)

**Prompt:**
```
Check if .iago/state/HANDOFF.json exists and is older than 3 days. If so, warn that paused work may be going stale. If no HANDOFF.json, report all clear.
```

**When to use:** Any project where context switching is common. Prevents forgotten pause states from becoming stale blockers.

**Produces:** Warning with HANDOFF.json age and paused task summary, or "all clear" if no pause state exists.

**RemoteTrigger API body:**
```json
{
  "schedule": "23 8 * * *",
  "prompt": "Check if .iago/state/HANDOFF.json exists and is older than 3 days. If so, warn that paused work may be going stale. If no HANDOFF.json, report all clear.",
  "project_directory": "$PROJECT_DIR"
}
```

---

## 4. dependency-audit

**Description:** Runs npm audit every Saturday morning and reports any critical or high severity vulnerabilities with fix suggestions.

**cron:** `"41 10 * * 6"` (10:41am, Saturday)

**Prompt:**
```
Run npm audit in the project root. Report any critical or high severity vulnerabilities. Suggest fixes.
```

**When to use:** Any project with npm dependencies. Especially important before client releases or during extended low-activity periods.

**Produces:** Vulnerability report listing severity, affected packages, and recommended remediation.

**RemoteTrigger API body:**
```json
{
  "schedule": "41 10 * * 6",
  "prompt": "Run npm audit in the project root. Report any critical or high severity vulnerabilities. Suggest fixes.",
  "project_directory": "$PROJECT_DIR"
}
```

---

## 5. learnings-promotion

**Description:** Reviews accumulated learnings every Friday morning and identifies patterns that have crossed the 5-occurrence threshold for promotion to CLAUDE.md.

**cron:** `"7 9 * * 5"` (9:07am, Friday)

**Prompt:**
```
Read .iago/learnings/patterns.md. Find any patterns with 5+ occurrences. For each, recommend whether to promote to CLAUDE.md as a permanent rule. If no patterns qualify, report that.
```

**When to use:** After several weeks of active execution, when the learnings file has accumulated enough data to surface meaningful patterns.

**Produces:** Promotion recommendations listing qualifying patterns, occurrence counts, and suggested CLAUDE.md rule text.

**RemoteTrigger API body:**
```json
{
  "schedule": "7 9 * * 5",
  "prompt": "Read .iago/learnings/patterns.md. Find any patterns with 5+ occurrences. For each, recommend whether to promote to CLAUDE.md as a permanent rule. If no patterns qualify, report that.",
  "project_directory": "$PROJECT_DIR"
}
```

---

## 6. build-health

**Description:** Runs typecheck and lint every 6 hours to catch regressions as they happen rather than at the end of a session.

**cron:** `"33 */6 * * *"` (every 6 hours at :33 past the hour)

**Prompt:**
```
Run npx tsc --noEmit and npx biome check. Report any errors or regressions since last check.
```

**When to use:** Active development phases with multiple contributors or long-running sessions. Catches drift early.

**Produces:** Build status report with TypeScript errors and Biome lint findings, or "clean" confirmation.

**RemoteTrigger API body:**
```json
{
  "schedule": "33 */6 * * *",
  "prompt": "Run npx tsc --noEmit and npx biome check. Report any errors or regressions since last check.",
  "project_directory": "$PROJECT_DIR"
}
```

---

## Notes

### RemoteTrigger vs Session Cron

- **RemoteTrigger** (persistent): triggers survive session end, require RemoteTrigger authentication, run in fresh Claude Code sessions
- **Session cron** (`/schedule` built-in): active only while the current Claude Code session is running, 7-day auto-expiry

Use RemoteTrigger for any automation you want to run unattended. Use session cron for monitoring tasks during an active session only.

### Variable Substitution

Replace `$PROJECT_DIR` with the absolute path to your project directory when calling the RemoteTrigger API directly. When using `/iago:schedule`, the skill resolves this automatically from the current working directory.
