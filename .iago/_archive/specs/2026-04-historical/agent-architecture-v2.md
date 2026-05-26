# Spec: Agent Architecture v2

## Problem

The current 11-agent hub-and-spoke architecture has three reviewer agents doing one job, an implementer that duplicates the tdd-guide, hardcoded Sonnet routing regardless of task complexity, serial-only execution in the main workflow, and no cross-session learning. Agents are role-based (fixed prompts, fixed tools) when they should be capability-based (composed per task). These aren't bugs — they're design limitations that will compound as client projects scale.

## Solution

Redesign agent dispatch from role-based to capability-based. Replace 11 fixed agents with 3 base agents + 12 capability modules + 12 agent profiles. Add intelligent model routing, parallel execution in `/iago:execute`, and feedback loops that make agents smarter over the life of a project.

The hub-and-spoke model stays — agents still don't spawn agents. What changes is how the orchestrator assembles and dispatches them.

## Scope

### In Scope

- Replace 11 role-based agents with 3 base agents (executor, analyst, operator)
- Create 12 capability modules (prompt fragments for React, DynamoDB, security, TDD, etc.)
- Create 12 agent profiles (pre-composed base + capabilities combinations)
- Profile matching: orchestrator selects profile based on task analysis
- Smart model routing: `model: opus | sonnet | auto` per profile dispatch
- Parallel agent dispatch within waves in `/iago:execute`
- `.iago/learnings/` feedback loop: extract review patterns, inject into future dispatches
- Composition logging in `.iago/state/usage-log.jsonl`
- Update all skills that dispatch agents
- Update README, ARCHITECTURE.md, CLAUDE.md

### Out of Scope

- Changing the hub-and-spoke model — agents still don't spawn agents
- Fully dynamic composition (arbitrary capability combinations at runtime) — profiles are the primary path, custom composition is the escape hatch
- Changing hook architecture or state engine
- Codex plugin changes
- New workflow skills

## Technical Approach

### 1. Base Agents (3)

Replace all 11 agent files with 3 base agents that define tool access tiers. Base agent prompts are minimal — just the tool contract, escalation protocol, and output format. All domain intelligence comes from capability modules injected via the dispatch prompt.

#### `executor.md`
```yaml
---
name: executor
description: >-
  Base agent for tasks that produce code. Receives capability modules
  and task instructions via dispatch prompt.
model: sonnet  # overridden per dispatch
tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - Bash
  - Notebook
maxTurns: 25
---
```

Prompt contains:
- Tool usage contract (search before creating, verify after writing)
- Escalation protocol (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED)
- Output format template (files changed, verification, status)
- Anti-patterns list (no `any`, no `export default`, no `useEffect` for data, no hardcoded secrets)
- "Follow the capability instructions and task plan exactly. Do not add features beyond what is specified."

#### `analyst.md`
```yaml
---
name: analyst
description: >-
  Base agent for read-only analysis tasks. Reviews, modeling,
  diagnostics. Cannot edit files.
model: sonnet  # overridden per dispatch
tools:
  - Read
  - Glob
  - Grep
  - Bash
maxTurns: 15
---
```

Prompt contains:
- Read-only contract ("never edit source files — all findings must be explicit")
- Escalation protocol
- Output format template (findings by severity, diagnostics, verdict)
- "Analyze based on the capability instructions. Rate all findings by severity: Critical, Important, Minor."

#### `operator.md`
```yaml
---
name: operator
description: >-
  Base agent for tasks that need external data sources or heavy CLI
  operations. Research, content, infrastructure.
model: sonnet  # overridden per dispatch
tools:
  - Read
  - Glob
  - Grep
  - Bash
  - WebSearch
  - WebFetch
maxTurns: 20
---
```

Prompt contains:
- External access contract (cite sources, cross-reference, distinguish fact from inference)
- Escalation protocol
- Output format template (findings, sources, recommendation)
- Safety: `--dry-run` before destructive infra ops, confirm before production changes

### 2. Capability Modules (12)

Stored in `.claude/agents/capabilities/`. Each module is a self-contained prompt fragment (200-400 tokens) that adds domain knowledge to a base agent. Modules are **additive** — they never contradict each other or the base agent.

| Module | Tokens | What it adds |
|--------|--------|-------------|
| `react-19.md` | ~350 | `use()` + Suspense, ShadCN/UI install + customize, TanStack Query keys + mutations, error boundaries, `useTransition`, `useOptimistic`, `ref` as prop |
| `dynamodb.md` | ~300 | Single-table design, pk/sk encoding, DocumentClient typed helpers, batch limits, TTL, GSI strategy (max 5), consistent reads |
| `lambda.md` | ~250 | Thin handler pattern, domain logic modules, ESM, cold start mitigation, env vars for config, timeout defaults |
| `cognito.md` | ~200 | JWT validation in API Gateway (not Lambda), user pools, custom attributes, pre-signup triggers, token refresh |
| `tdd.md` | ~400 | Full RED-GREEN-REFACTOR cycle, rationalization prevention table, coverage rules (80% per feature), test file placement, skip policy |
| `security.md` | ~350 | OWASP + AWS checklist: no hardcoded secrets, Cognito JWT in authorizer, no cross-tenant DynamoDB access, no dangerouslySetInnerHTML, Zod validation, no wildcard CORS, no leaked internals |
| `e2e.md` | ~300 | Playwright patterns, selector priority (data-testid > roles > text), no CSS/XPath, storageState for auth, no waitForTimeout, Suspense boundary waits |
| `review-spec.md` | ~250 | Spec compliance checklist: compare against plan tasks, verify file paths match, verify actions completed, verify tests exist for new behavior, gating logic (Critical → stop) |
| `review-quality.md` | ~300 | Quality checklist: performance (unnecessary re-renders, N+1 queries), security (OWASP), maintainability (naming, complexity, duplication), React/DynamoDB/Lambda specific checks |
| `content.md` | ~250 | Article structure, tone matching, citation rules, client brand voice, draft-ready output, factual claims sourced |
| `infra.md` | ~300 | AWS CLI patterns, Amplify Gen 2 (`defineBackend`, `defineAuth`, `defineData`, `defineFunction`), CDK constructs, SES v2, `--dry-run` first |
| `forms.md` | ~200 | React Hook Form + Zod schema → infer type → `useForm<T>()`, Controller for ShadCN, server errors → `setError()` |

#### Module Rules
- Modules are additive — they provide instructions, not prohibitions (anti-patterns live in base agents)
- No module may exceed 400 tokens
- No module may reference another module (they're independent fragments)
- Each module must be self-contained — no "see also" or "as described in..."
- Modules are versioned with the rest of `.claude/agents/`

### 3. Agent Profiles (12)

Stored in `.claude/agents/profiles/`. Each profile is a pre-composed combination of base + capabilities + model routing + maxTurns. Profiles are the **primary dispatch path** — custom composition is the escape hatch.

| Profile | Base | Capabilities | Model | maxTurns | Replaces |
|---------|------|-------------|-------|----------|----------|
| `fullstack` | executor | react-19, dynamodb, lambda, tdd, forms | auto | 25 | implementer (multi-layer) |
| `frontend` | executor | react-19, tdd, forms | auto | 25 | implementer (frontend) |
| `backend` | executor | dynamodb, lambda, cognito, tdd | auto | 25 | implementer (backend) |
| `review-single` | analyst | security, review-spec, review-quality | auto | 15 | code-reviewer |
| `review-full` | analyst | security, review-spec, review-quality | auto | 18 | spec-reviewer + code-quality-reviewer |
| `security-audit` | analyst | security, cognito, review-quality | opus | 18 | code-reviewer (security-critical) |
| `research` | operator | (dynamic — topic-based) | sonnet | 20 | researcher |
| `e2e` | executor | e2e, react-19 | sonnet | 25 | e2e-runner |
| `infra` | operator | infra | sonnet | 20 | infra-runner |
| `schema` | analyst | dynamodb | sonnet | 15 | data-modeler |
| `content` | operator | content | sonnet | 20 | content-writer |
| `debug` | executor | (dynamic — error-based) | auto | 20 | build-error-resolver |

#### Profile File Format

```markdown
---
name: fullstack
description: >-
  Full-stack implementation tasks spanning React frontend and
  DynamoDB/Lambda backend. Use for tasks that touch both layers.
base: executor
model: auto
maxTurns: 25
capabilities:
  - react-19
  - dynamodb
  - lambda
  - tdd
  - forms
---

## Match Signals

Dispatch this profile when:
- Task touches files in both `src/` and `amplify/`
- Task description mentions frontend + backend coordination
- Plan specifies full-stack implementation

## Review Pairing

After this profile completes, dispatch `review-single` or `review-full`
depending on `review.mode` in config.json.
```

#### Dynamic Profiles (research, debug)

The `research` and `debug` profiles have dynamic capabilities — the orchestrator selects relevant modules based on the task:

**Research:** If researching React patterns → inject `react-19.md`. If researching DynamoDB → inject `dynamodb.md`. If general → no capability modules (base operator is sufficient).

**Debug:** If TypeScript error → inject relevant stack module. If build error → inject `lambda.md` or `react-19.md` based on file path. If test failure → inject `tdd.md` + relevant stack module.

### 4. Orchestrator Dispatch Flow

When a skill needs to dispatch an agent, the orchestrator follows this sequence:

```
1. READ plan task (files, action, description, tags)
2. MATCH profile
   a. Explicit: task specifies `profile: fullstack` → use it
   b. Heuristic:
      - Files in src/ + amplify/ → fullstack
      - Files only in src/features/ → frontend
      - Files only in amplify/ → backend
      - Task type = review → review-single or review-full (from config)
      - Task type = research → research
      - Task type = e2e → e2e
      - Task type = infra → infra
      - Task type = content → content
   c. Fallback: fullstack (most capable, slightly less focused)
3. SELECT model
   a. Profile specifies opus → opus
   b. Profile specifies sonnet → sonnet
   c. Profile specifies auto:
      - Task touches 4+ files → opus
      - Task involves auth/payment/data-access → opus
      - Task is a retry (previous attempt failed) → opus
      - Single-file additive change → sonnet
      - Default → sonnet
4. COMPOSE prompt
   a. Read base agent prompt
   b. Read each capability module in profile
   c. Read .iago/learnings/patterns.md (top 10 patterns, max 500 tokens)
   d. Read .iago/learnings/project-conventions.md (max 300 tokens)
   e. Concatenate: base + capabilities + learnings + plan task + project context
5. DISPATCH via Agent tool
   - subagent_type: profile's base agent (executor, analyst, operator)
   - model: selected model (opus or sonnet)
   - prompt: composed prompt
6. LOG to .iago/state/usage-log.jsonl
   {
     "event": "agent_dispatched",
     "profile": "fullstack",
     "base": "executor",
     "capabilities": ["react-19", "dynamodb", "lambda", "tdd", "forms"],
     "model": "opus",
     "task": "create-user-profile",
     "plan": "02-implement-01"
   }
```

### 5. Smart Model Routing

Model selection is built into the dispatch flow (step 3 above). Configuration lives in `.iago/config.json`:

```json
{
  "routing": {
    "default_model": "auto",
    "security_critical": "opus",
    "retry_upgrade": true,
    "review_matches_impl": true
  }
}
```

- `default_model`: baseline for `auto` profiles. `"sonnet"` = always sonnet, `"opus"` = always opus, `"auto"` = heuristic
- `security_critical`: model for tasks tagged with auth/payment/data-access
- `retry_upgrade`: if true, failed tasks retry on opus (even if originally dispatched on sonnet)
- `review_matches_impl`: if true, reviews use the same model as the implementation they're reviewing

Reviewer routing:
- Reviews of opus-implemented code → opus (if `review_matches_impl`)
- `security-audit` profile → always opus (hardcoded in profile)
- Standard reviews → follows `default_model`

### 6. Parallel Execution in `/iago:execute`

Current flow:
```
wave 1: plan-01 → review → plan-02 → review → plan-03 → review
wave 2: plan-04 → review (depends on wave 1)
```

New flow:
```
wave 1: [plan-01, plan-02, plan-03] dispatched in parallel → reviews in parallel
wave 2: plan-04 → review (waits for wave 1 completion)
```

Implementation:
- Parse wave numbers from plan filenames (already exist: `{NN}-{slug}-{PP}.md`)
- Group plans by wave
- **File conflict detection**: read file lists from each plan in a wave. If two plans modify the same file, serialize them (dispatch sequentially within the wave). Non-conflicting plans dispatch in parallel.
- Dispatch all non-conflicting plans in same wave using concurrent Agent tool calls
- Collect results, dispatch reviews (also in parallel for independent plans)
- If any plan in wave returns BLOCKED, pause remaining wave plans and escalate
- Proceed to next wave only when all current wave plans are DONE/DONE_WITH_CONCERNS

Add `--serial` flag to force sequential execution (for debugging or CI).

Guard rail: cap at **5 concurrent dispatches** per wave. If a wave has more than 5 non-conflicting plans, batch them in groups of 5.

### 7. Feedback Loops (`.iago/learnings/`)

Directory structure:
```
.iago/learnings/
  patterns.md             # Accumulated patterns from review findings
  project-conventions.md  # Project-specific conventions (manually editable)
```

**After each review cycle**, the orchestrator:
1. Reads reviewer findings
2. Extracts patterns that apply beyond the current task
3. Appends to `patterns.md` with date and source
4. De-duplicates: if a pattern already exists, increment its occurrence count

**Before each agent dispatch**, the orchestrator:
1. Reads `patterns.md` (top 10 by occurrence count, max 500 tokens)
2. Reads `project-conventions.md` (max 300 tokens)
3. Injects into the composed prompt between capabilities and plan task

Format for `patterns.md`:
```markdown
## Review Patterns

| # | Pattern | Occurrences | Last Seen | Source |
|---|---------|-------------|-----------|--------|
| 1 | Always add error boundaries at feature route level | 3 | 2026-04-04 | 02-implement-01 |
| 2 | DynamoDB attributes use camelCase in this project | 2 | 2026-04-03 | 01-schema-02 |
```

`project-conventions.md` is seeded during `/iago:init` and manually editable. Captures conventions not in CLAUDE.md but specific to the project (e.g., "client uses American English", "date format is MM/DD/YYYY", "all API responses wrap in `{ data, error }` envelope").

**Pattern promotion**: if a pattern reaches 5+ occurrences, the orchestrator suggests adding it to CLAUDE.md or a rule file (where it becomes permanent, not just a learning).

### 8. Bulletproofing

#### Prompt Composition Conflicts
- Every capability module is reviewed against every other for conflicts before release
- Modules are additive instructions, never prohibitions (anti-patterns live in base agents)
- Cap at **6 capability modules per dispatch** — keeps composed prompt under 2500 tokens
- Each profile is smoke-tested: dispatch with a simple task, verify output quality

#### Debugging Compositions
- Every dispatch logged to `usage-log.jsonl` with full composition details (profile, base, capabilities, model, task)
- Profile pinning: plan tasks can specify `profile: fullstack` to force a specific composition
- Replay: orchestrator can re-dispatch the exact same composition with `--verbose`

#### Profile Matching Errors
- Explicit profile in plan task always wins over heuristic matching
- File path heuristics as primary signal (most reliable)
- Fallback profile: `fullstack` (most capable, handles any implementation task)
- Agent self-report: if dispatched agent discovers it needs a capability it doesn't have, returns `NEEDS_CONTEXT: "missing DynamoDB patterns"` → orchestrator re-dispatches with correct profile

#### Untested Combinations
- Only the 12 named profiles are supported configurations
- Custom compositions (orchestrator picks capabilities ad-hoc) are logged as `"profile": "custom"` and flagged for review
- If a custom composition is used 3+ times, promote it to a named profile

#### Context Window Budget
- Base agent prompt: ~300 tokens
- Capability modules: max 6 × 400 = 2400 tokens
- Learnings: max 800 tokens (500 patterns + 300 conventions)
- Plan task + project context: ~1000 tokens
- **Total overhead: ~4500 tokens** — leaves 95%+ of context for actual work

### 9. File Changes Summary

**Delete:**
- `.claude/agents/implementer.md`
- `.claude/agents/code-reviewer.md`
- `.claude/agents/spec-reviewer.md`
- `.claude/agents/code-quality-reviewer.md`
- `.claude/agents/researcher.md`
- `.claude/agents/tdd-guide.md`
- `.claude/agents/build-error-resolver.md`
- `.claude/agents/e2e-runner.md`
- `.claude/agents/content-writer.md`
- `.claude/agents/infra-runner.md`
- `.claude/agents/data-modeler.md`

**Create:**
- `.claude/agents/executor.md` (base agent)
- `.claude/agents/analyst.md` (base agent)
- `.claude/agents/operator.md` (base agent)
- `.claude/agents/capabilities/react-19.md`
- `.claude/agents/capabilities/dynamodb.md`
- `.claude/agents/capabilities/lambda.md`
- `.claude/agents/capabilities/cognito.md`
- `.claude/agents/capabilities/tdd.md`
- `.claude/agents/capabilities/security.md`
- `.claude/agents/capabilities/e2e.md`
- `.claude/agents/capabilities/review-spec.md`
- `.claude/agents/capabilities/review-quality.md`
- `.claude/agents/capabilities/content.md`
- `.claude/agents/capabilities/infra.md`
- `.claude/agents/capabilities/forms.md`
- `.claude/agents/profiles/fullstack.md`
- `.claude/agents/profiles/frontend.md`
- `.claude/agents/profiles/backend.md`
- `.claude/agents/profiles/review-single.md`
- `.claude/agents/profiles/review-full.md`
- `.claude/agents/profiles/security-audit.md`
- `.claude/agents/profiles/research.md`
- `.claude/agents/profiles/e2e.md`
- `.claude/agents/profiles/infra.md`
- `.claude/agents/profiles/schema.md`
- `.claude/agents/profiles/content.md`
- `.claude/agents/profiles/debug.md`
- `.iago/learnings/patterns.md` (empty template)
- `.iago/learnings/project-conventions.md` (empty template)

**Modify:**
- `.claude/skills/iago-execute/SKILL.md` — profile-based dispatch, parallel execution, learnings injection
- `.claude/skills/subagent-driven-development/SKILL.md` — profile-based dispatch, learnings injection
- `.claude/skills/code-review/SKILL.md` — dispatch `review-single` or `review-full` profile
- `.claude/skills/iago-init/SKILL.md` — seed `.iago/learnings/` directory and `project-conventions.md`
- `CLAUDE.md` — update architecture section (3 bases + 12 capabilities + 12 profiles), model routing, learnings
- `README.md` — update Agent Architecture section (diagrams, catalog, profiles)
- `docs/ARCHITECTURE.md` — full architecture rewrite for capability-based model
- `.claude/rules/available-skills.md` — update agent catalog to profiles
- `templates/client-project/` — add `.iago/learnings/` to template, update `.claude/agents/`
- `templates/internal-project/` — same as above
- `.iago/config.json` schema — add `routing` section

## Delivery Path

### Phase 1: Capability Modules (2 days)
- Extract domain knowledge from current 11 agent files into 12 capability modules
- Each module: self-contained, 200-400 tokens, additive, no cross-references
- Review all modules for conflicts with each other
- **Deliverable:** 12 capability module files in `.claude/agents/capabilities/`

### Phase 2: Base Agents (1-2 days)
- Create 3 base agents (executor, analyst, operator)
- Extract common patterns from current agents into base prompts
- Escalation protocol, output format, anti-patterns in base
- **Deliverable:** 3 base agent files, minimal and stable

### Phase 3: Profiles + Dispatch (2-3 days)
- Create 12 profile definitions with base + capabilities + model + match signals
- Implement profile matching logic in orchestrator dispatch (file path heuristics, explicit pinning, fallback)
- Implement prompt composition: base + capabilities + learnings + task
- Add composition logging to usage-log.jsonl
- **Deliverable:** Profile-based dispatch working end-to-end

### Phase 4: Smart Routing (1-2 days)
- Add `routing` section to `.iago/config.json` schema
- Implement auto model selection (4+ files → opus, auth → opus, retry → upgrade)
- Implement `review_matches_impl` logic
- **Deliverable:** Tasks route to Opus or Sonnet based on complexity and config

### Phase 5: Parallel Execution (1-2 days)
- Update `/iago:execute` to dispatch same-wave plans concurrently
- Implement file conflict detection (serialize conflicting plans)
- Cap at 5 concurrent dispatches
- Add `--serial` flag
- **Deliverable:** Independent plans execute in parallel, conflicts auto-serialized

### Phase 6: Feedback Loops (1-2 days)
- Create `.iago/learnings/` directory structure
- Implement post-review pattern extraction in orchestrator
- Implement pre-dispatch learnings injection (top 10 patterns, 500 token cap)
- Seed `project-conventions.md` during `/iago:init`
- Implement pattern promotion (5+ occurrences → suggest CLAUDE.md addition)
- Update templates
- **Deliverable:** Review patterns accumulate and inform future dispatches

### Phase 7: Cleanup + Documentation (1-2 days)
- Delete all 11 old agent files
- Update CLAUDE.md, README.md, ARCHITECTURE.md, available-skills.md
- Update Mermaid diagrams in README
- Sync templates
- Smoke test all 12 profiles
- **Deliverable:** Clean architecture, accurate docs, all profiles verified

**Total: ~2 weeks**

## Migration Strategy

The old and new architectures can't coexist — agent files are either role-based or capability-based. The migration is:

1. **Phase 1-2** can be developed alongside existing agents (capabilities extracted, bases created, old agents still active)
2. **Phase 3** is the cutover — when profiles and dispatch logic are ready, delete old agents and switch all skills to profile-based dispatch
3. **Phase 4-6** are enhancements on top of the new architecture
4. **Phase 7** is cleanup

If the cutover in Phase 3 reveals issues, the old agent files are in git history — `git checkout HEAD~1 -- .claude/agents/` restores them instantly.

## Open Questions

1. **Should `research` and `debug` profiles support fully dynamic capability selection, or should we pre-define variants (e.g., `research-frontend`, `research-backend`, `debug-typescript`, `debug-build`)?** Recommendation: start with dynamic (orchestrator selects capabilities based on task), promote to named variants if patterns emerge.

2. **Should model routing be configurable per-project in `config.json`?** Recommendation: yes. Add `routing` section. Some projects may want all-Opus (complex enterprise) or all-Sonnet (cost-conscious).

3. **Should learnings persist across projects or stay project-scoped?** Recommendation: project-scoped. Global learnings belong in CLAUDE.md or rules/. Cross-project noise would degrade quality.

4. **Max parallel agents per wave?** Recommendation: 5. More than that risks orchestrator context pressure and makes output harder to review.

5. **Should profiles be shareable between iaGO-OS projects via `sync-skills.sh`?** Recommendation: yes — profiles, capabilities, and bases are part of `.claude/agents/` which already syncs.

6. **How do we handle the transition in `settings.json`?** The settings reference agent names in the `agents` block. New base agent names (executor, analyst, operator) replace old names. Skills reference profiles, not agents directly. Settings only need to know about the 3 base agents.
