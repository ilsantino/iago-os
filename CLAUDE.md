# iaGO-OS

3-person AI consultancy (CEO Santiago/Windows, CTO Sebas/Mac). Stack fixed — `.claude/rules/stack.md`. Backend: AWS Amplify Gen 2 ONLY — never raw CloudFormation/CDK/SAM/Serverless (details: `.claude/rules/aws-amplify.md`).

## Doc routing — where new docs go
Consult before any Write to a `.md` path. Heuristic: name the doc's primary reader (Claude in this repo / Claude in a client subtree / human via GitHub) — that names the location.

| Doc type | Location |
|---|---|
| Feature plan (multi-task) | `.iago/plans/feature-{slug}/{NN}.md` |
| Phase plan (ROADMAP) | `.iago/plans/{phase-slug}-{NN}.md` |
| Quick-fix plan | `.iago/plans/quick-{YYMMDD}-{slug}.md` |
| Execution summary | `.iago/summaries/{plan-slug}.md` |
| Phase decision artifact | `.iago/context/{YYYY-MM-DD}-{slug}.md` |
| Research / brainstorm / audit | `.iago/research/{YYYY-MM-DD}-{slug}.md` |
| Ops runbook (repeatable how-to) | `.iago/_config/runbooks/{slug}.md` |
| Recurring review pattern | `.iago/learnings/patterns.md` (append) |
| Client-specific (any of the above) | `clients/{name}/.iago/{same-taxonomy}/` |
| Public-facing iaGO-OS docs | `README.md` |
| Domain-skill reference | `.claude/skills/industry-patterns/references/{domain}.md` |
| Phase-cycle artifact (vision / roadmap) | `docs/specs/` (paired with `.iago/research/`) |
| Superseded plan | `.iago/plans/_archive/{YYYY-MM-{slug}}/` (with roadmap pointer) |
| Superseded doc (decision-bearing) | `.iago/_archive/` |
| Superseded doc (no future value) | DELETE |

## Workflow
Phases: init → discuss → plan (+stress) → execute → verify, via `/iago-*` skills. STATE.md ≤ 80 lines; overflow → PROJECT.md.

## Execution Path
**NEVER implement a plan/spec/task by editing code directly.** Invoke the matching skill (user says "execute plan X" → invoke skill, not read/decompose):

| Scope | Skill |
|-------|-------|
| ROADMAP phase | `/iago-execute {slug}` |
| Standalone 1-3 tasks | `/iago-quick {desc}` |
| Multi-task plan outside ROADMAP | `/subagent-driven-development` |
| Trivial (≤3 files, obvious) | `/iago-fast {desc}` — only path that skips review |

Pipeline contract: `.claude/rules/execution-pipeline.md`.

## Agent Escalation
Every subagent ends with one status: **DONE** / **DONE_WITH_CONCERNS** (issues listed) / **NEEDS_CONTEXT** (state missing info) / **BLOCKED** (state blocker).

## Execution Discipline
During execution: only what the plan specifies; auto-fix bugs/imports/blockers; ASK before architectural changes. 3 failed fixes on the same issue → STOP, escalate; no 4th attempt without new information — consider `/codex:rescue` for a cross-model second opinion.

## Agents & Models
Agent defs in `.claude/agents/`. Hub-and-spoke: only the orchestrator dispatches. Model routing: orchestrator = session model (Fable); workflow legs — impl/review/fix/debug → Opus (keep existing pins), PR/commit/tag/mechanical → Sonnet; cross-model adversarial review → Codex GPT-5.5 (pinned in `~/.codex/config.toml`). Never blanket-inherit the session model for every leg.

Path-scoped rules in `.claude/rules/` (tdd, react-vite, aws-amplify, e2e-testing, mcp-server-patterns, layer-triage, skill-authoring) auto-load on matching paths; the rest auto-load every session.
