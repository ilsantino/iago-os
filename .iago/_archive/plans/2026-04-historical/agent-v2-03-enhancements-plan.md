# Plan: Agent v2 — Behavioral Enhancements (Routing + Parallel + Learnings)

## Source
Spec: docs/specs/agent-architecture-v2.md (Phases 4-6)

## Wave 1: Config + Learnings Infrastructure

Independent tasks — routing config and learnings directory have no dependencies on each other.

### Task 1: Add routing section to config.json
- **files:** `.iago/config.json`
- **action:** Add a `routing` section to the existing config.json with these fields: `"default_model": "auto"` (options: auto/sonnet/opus), `"security_critical": "opus"` (model for auth/payment/data-access tasks), `"retry_upgrade": true` (upgrade to opus on retry), `"review_matches_impl": true` (reviews use same model as implementation). Preserve all existing config fields. Add a comment-style description field for each routing option.
- **verify:** `node -e "const c = JSON.parse(require('fs').readFileSync('.iago/config.json','utf8')); console.log(c.routing ? 'OK' : 'MISSING')"`
- **expected:** `OK`

### Task 2: Create learnings directory and templates
- **files:** `.iago/learnings/patterns.md`, `.iago/learnings/project-conventions.md`
- **action:** Create `.iago/learnings/` directory. Create `patterns.md` with header and empty table: `## Review Patterns` followed by table with columns: #, Pattern, Occurrences, Last Seen, Source. No rows yet. Create `project-conventions.md` with header `## Project Conventions` and placeholder text: "Add project-specific conventions here. These are injected into agent context before each dispatch. Examples: date format, API response envelope structure, naming conventions not in CLAUDE.md."
- **verify:** `test -f .iago/learnings/patterns.md && test -f .iago/learnings/project-conventions.md && echo "OK"`
- **expected:** `OK`

## Wave 2: Skill Enhancements

Depend on Wave 1 (config.json routing section and learnings directory must exist).

### Task 3: Add smart routing to iago-execute dispatch flow
- **files:** `.claude/skills/iago-execute/SKILL.md`
- **action:** Add a new step between plan loading and dispatch (after step 1, before step 3a). Title: "Select model per plan." Logic: read `.iago/config.json` routing section. For each plan task, determine model: if plan specifies `profile:` with hardcoded model → use it. If `routing.default_model` is not "auto" → use that. Otherwise apply heuristics: task touches 4+ files → opus, task involves auth/payment/data-access keywords → `routing.security_critical` model, task is a retry → opus if `routing.retry_upgrade` is true, else sonnet. For reviews: if `routing.review_matches_impl` → match the model used for implementation. Add this routing logic clearly in the skill file.
- **verify:** `grep -q "routing" .claude/skills/iago-execute/SKILL.md && grep -q "security_critical" .claude/skills/iago-execute/SKILL.md && echo "OK"`
- **expected:** `OK`

### Task 4: Add smart routing to subagent-driven-development dispatch flow
- **files:** `.claude/skills/subagent-driven-development/SKILL.md`
- **action:** Add the same smart routing logic as Task 3 to subagent-driven-development. Before dispatching each task's profile, read config.json routing section and select model. Apply the same heuristics: 4+ files → opus, auth/payment → security_critical model, retry → upgrade, reviews match implementation. Add to step 2a (dispatch implementer section).
- **verify:** `grep -q "routing" .claude/skills/subagent-driven-development/SKILL.md && echo "OK"`
- **expected:** `OK`

### Task 5: Add parallel execution to iago-execute
- **files:** `.claude/skills/iago-execute/SKILL.md`
- **action:** Rewrite step 3 ("Execute plans") to support parallel dispatch within waves. New logic: 1) Group plans by wave number. 2) For each wave: read file lists from all plans, detect conflicts (two plans modifying same file). 3) Non-conflicting plans dispatch in parallel via concurrent Agent tool calls. Conflicting plans serialize automatically within the wave. 4) Cap at 5 concurrent dispatches per wave — batch into groups of 5 if more. 5) Collect all results before proceeding to reviews. 6) If any plan returns BLOCKED, pause remaining wave plans and escalate. 7) Proceed to next wave only when all current wave plans are DONE/DONE_WITH_CONCERNS. Add `--serial` flag that forces sequential execution (bypasses parallel logic). Update the step 3 header to "Execute plans (parallel within waves)".
- **verify:** `grep -q "parallel" .claude/skills/iago-execute/SKILL.md && grep -q "serial" .claude/skills/iago-execute/SKILL.md && echo "OK"`
- **expected:** `OK`

### Task 6: Add learnings injection to iago-execute dispatch
- **files:** `.claude/skills/iago-execute/SKILL.md`
- **action:** Add two behaviors to the dispatch flow. PRE-DISPATCH (before composing prompt in step 3a): read `.iago/learnings/patterns.md`, extract top 10 patterns by occurrence count (max 500 tokens). Read `.iago/learnings/project-conventions.md` (max 300 tokens). Inject both into the composed prompt between capability modules and the plan task. POST-REVIEW (after handling review response in step 3d): if reviewer found patterns that apply beyond the current task (recurring issues, project-specific conventions), extract them and append to `patterns.md`. De-duplicate: if pattern already exists, increment occurrence count and update Last Seen date instead of adding a new row. If any pattern reaches 5+ occurrences, add a note suggesting the user add it to CLAUDE.md or a rule file.
- **verify:** `grep -q "learnings" .claude/skills/iago-execute/SKILL.md && grep -q "patterns.md" .claude/skills/iago-execute/SKILL.md && echo "OK"`
- **expected:** `OK`

### Task 7: Add learnings injection to subagent-driven-development dispatch
- **files:** `.claude/skills/subagent-driven-development/SKILL.md`
- **action:** Add the same pre-dispatch learnings injection as Task 6: read patterns.md (top 10, 500 tokens) and project-conventions.md (300 tokens), inject into composed prompt. Add post-review pattern extraction: after step 4 (handle review findings), extract recurring patterns from findings and append to patterns.md with de-duplication.
- **verify:** `grep -q "learnings" .claude/skills/subagent-driven-development/SKILL.md && echo "OK"`
- **expected:** `OK`

### Task 8: Update iago-init to seed learnings directory
- **files:** `.claude/skills/iago-init/SKILL.md`
- **action:** Add a new step after "Scaffold directories" (step 1): "Seed learnings directory." Create `.iago/learnings/` if it doesn't exist. Create `patterns.md` with empty table header. Create `project-conventions.md` with a starter template that includes the project name and any conventions discovered during the init interview (e.g., if user mentions American English, date formats, API patterns — capture those as initial conventions). Add `.iago/learnings/` to the list of directories created by the state engine init() function.
- **verify:** `grep -q "learnings" .claude/skills/iago-init/SKILL.md && echo "OK"`
- **expected:** `OK`

## Verification
```bash
# Config has routing
node -e "const c = JSON.parse(require('fs').readFileSync('.iago/config.json','utf8')); console.log(JSON.stringify(c.routing, null, 2))"

# Learnings directory exists
ls .iago/learnings/

# Skills have all enhancements
grep -c "routing\|parallel\|learnings" .claude/skills/iago-execute/SKILL.md  # Should be 3+
grep -c "routing\|learnings" .claude/skills/subagent-driven-development/SKILL.md  # Should be 2+
grep -c "learnings" .claude/skills/iago-init/SKILL.md  # Should be 1+
```
