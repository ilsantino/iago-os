---
phase: automation
plan: 01
wave: 1
depends_on: []
created: 2026-04-06
---

# Plan: automation-01 — /schedule integration for iaGO-OS

## Goal

Create reusable trigger templates and conventions for Claude Code's `/schedule`
feature so iaGO-OS projects get automated monitoring, review, and reporting
out of the box.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `.claude/skills/iago-schedule/SKILL.md` | Skill that sets up project triggers from templates |
| create | `docs/automations/trigger-templates.md` | Template library for common triggers |
| modify | `docs/MANUAL.md` | Add "Scheduled Automation" section |
| modify | `.claude/rules/available-skills.md` | Add /iago:schedule to catalog |
| modify | `README.md` | Mention trigger support in ecosystem section |

## Tasks

### Task 1: Create trigger templates doc
- **files:** `docs/automations/trigger-templates.md`
- **action:** Create a reference document with 6 ready-to-use trigger templates. Each template has: name, cron expression, prompt text, when to use it, and what it produces. Templates: (1) **Nightly code review** — runs `/code-review --against main` on the day's commits at 11pm. (2) **Weekly usage digest** — runs usage-report.sh across all client projects every Monday 9am. (3) **Stale handoff detector** — checks `.iago/state/HANDOFF.json` age daily at 8am, warns if >3 days old. (4) **Dependency audit** — runs `npm audit` weekly on Saturday, flags critical vulnerabilities. (5) **Learnings promotion check** — scans `.iago/learnings/patterns.md` for patterns at 5+ occurrences, suggests CLAUDE.md promotions. (6) **Build health monitor** — runs `npx tsc --noEmit` every 6 hours, alerts on regressions. Include the exact `RemoteTrigger` API body for each (create action with prompt and cron fields).
- **verify:** `test -f docs/automations/trigger-templates.md && grep -c "cron" docs/automations/trigger-templates.md`
- **expected:** File exists, 6+ cron references

### Task 2: Create /iago:schedule skill
- **files:** `.claude/skills/iago-schedule/SKILL.md`
- **action:** Create a skill that wraps Claude Code's `/schedule` native feature with iaGO-OS conventions. Arguments: `/iago:schedule {template-name}` to install a trigger from the templates doc, `/iago:schedule list` to show active triggers, `/iago:schedule create {cron} {prompt}` for custom triggers. The skill reads the template from `docs/automations/trigger-templates.md`, adapts paths for the current project (replacing `$PROJECT_DIR`), and calls `RemoteTrigger create` or `CronCreate` depending on whether the user wants persistent (survives sessions) or session-only. Precondition: RemoteTrigger auth must be configured for persistent triggers. Fallback: if auth fails, use `CronCreate` with `durable: true` and warn about 7-day expiry.
- **verify:** `test -f .claude/skills/iago-schedule/SKILL.md && grep -c "RemoteTrigger" .claude/skills/iago-schedule/SKILL.md`
- **expected:** File exists, references RemoteTrigger

### Task 3: Update MANUAL.md with scheduled automation section
- **files:** `docs/MANUAL.md`
- **action:** Add a new "## Scheduled Automation" section after the "Session Management" section in MANUAL.md. Content: explain that iaGO-OS supports automated triggers via Claude Code's `/schedule` feature. Two modes: (1) **Remote triggers** — persistent, survive session restarts, need auth setup. (2) **Session cron** — runs only while Claude Code is open, auto-expire after 7 days. Show example of installing a template: `/iago:schedule nightly-review`. Show example of custom trigger. Show how to list and manage triggers. Reference docs/automations/trigger-templates.md for the full template library.
- **verify:** `grep -c "Scheduled Automation" docs/MANUAL.md`
- **expected:** 1

### Task 4: Update skill catalog and README
- **files:** `.claude/rules/available-skills.md`, `README.md`
- **action:** In available-skills.md, add `/iago:schedule` to the Workflow (iaGO) section: `- /iago:schedule — Install trigger templates or create custom scheduled automations`. In README.md, add a row to the "Workflow — Project Setup" table: `/iago:schedule` | Install automated triggers (nightly review, usage digest, build health) from templates or create custom cron jobs | Setting up recurring automation for a project. Update the skill count from 31 to 32 in README heading and anywhere else it appears.
- **verify:** `grep "iago:schedule" .claude/rules/available-skills.md && grep "iago:schedule" README.md`
- **expected:** Both files contain the new skill reference

## Verification

After all tasks: `test -f .claude/skills/iago-schedule/SKILL.md && test -f docs/automations/trigger-templates.md && grep -c "iago:schedule" .claude/rules/available-skills.md && echo "PLAN-01 PASS"`

Expected: `PLAN-01 PASS`
