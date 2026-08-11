---
name: Never skip review pipeline
description: All plan execution MUST go through the 3-stage review pipeline via skill invocation — never implement directly
type: feedback
---

NEVER implement a plan by reading it and editing files directly. ALL implementation must go through the execution skill (/iago:execute, /iago:quick, or /subagent-driven-development) which orchestrates the mandatory 3-stage review pipeline: (1) spec review, (2) quality review, (3) Codex adversarial review.

**Why:** On 2026-04-06, Plans 01-04 of MUNET Phase 1 were implemented without the review pipeline. Claude read the plans, implemented directly, ran `npm run build`, and created PRs — skipping all review stages. The client (Sebas) found numerous errors during GitHub review. No `.iago/summaries/`, `.iago/reviews/`, or `.iago/learnings/` artifacts were produced, proving the pipeline never ran.

**How to apply:** When the user says "execute plan X" or similar, the FIRST action must be invoking the Skill tool to load the execution skill. Not reading the plan. Not creating tasks. Not editing files. If you catch yourself implementing code from a plan without having invoked the skill, STOP immediately and invoke it. The rule is now codified in CLAUDE.md and `.claude/rules/execution-pipeline.md`.
