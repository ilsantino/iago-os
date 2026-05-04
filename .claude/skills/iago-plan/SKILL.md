---
name: iago-plan
description: >-
  Use when creating implementation plans on disk. Two modes: (1) /iago-plan {phase-slug}
  for ROADMAP phases, (2) /iago-plan --feature "description" or --feature path/to/file
  for standalone features from a prompt, spec, PDF, or markdown file.
  Do NOT use when the task is trivial (≤3 files, obvious — use /iago-fast),
  when scope is 1-3 tasks and you intend to execute immediately without persisting a plan
  (use /iago-quick), or when plans already exist on disk for the target phase
  (use /iago-execute).
---

## Purpose

Create implementation plans with 2-8 concrete tasks each. Every task has exact
file paths, a specific action, a verify command, and expected output. No placeholders.

Works in two modes:
1. **Phase mode** — break a ROADMAP phase into plans
2. **Feature mode** — plan a standalone feature from a description or file

## Modes

### Phase mode (default)

`/iago-plan {phase-slug}`

Plans a phase from ROADMAP.md. Requires `.iago/PROJECT.md` and `.iago/ROADMAP.md`.
If no slug provided, suggests the next `pending` or `active` phase from ROADMAP.md.

### Feature mode

`/iago-plan --feature "add user dashboard with role-based views"`
`/iago-plan --feature docs/specs/auth-flow.md`
`/iago-plan --feature path/to/client-requirements.pdf`

Plans a standalone feature. Input is either:
- **Inline prompt** — a quoted description of what to build
- **File path** — a `.md`, `.pdf`, or `.txt` file containing a spec, requirements doc, or brief

No ROADMAP.md required. Uses CLAUDE.md + PROJECT.md (if exists) for context.

## Preconditions

**Phase mode:**
- `.iago/PROJECT.md` must exist. If not, STOP: "Run `/iago-init` first."
- `.iago/ROADMAP.md` must exist and contain the target phase.
- `.iago/context/{NN}-{slug}.md` should exist (soft gate). If missing, warn:
  "No context artifact for this phase. Run `/iago-discuss {slug}` first, or continue without it."

**Feature mode:**
- `.iago/PROJECT.md` should exist (soft gate). If missing, use CLAUDE.md as context.
- If `--feature` value is a file path, the file must exist and be readable.
  Supported: `.md`, `.pdf`, `.txt`. For PDF, use the Read tool with `pages` param.
- If the file has an `## Open Questions` section with unresolved items, warn and
  ask whether to proceed or resolve first.

## Arguments

`/iago-plan {phase-slug}` — phase mode
`/iago-plan --feature "description"` — feature mode with inline prompt
`/iago-plan --feature path/to/file` — feature mode with file input

Optional flags (all modes):
- `--research` — dispatch `research` profile to investigate codebase before planning
- `--no-stress` — skip the stress-test step (step 7); pipeline step 0 will run it instead
- `--discuss` — run inline clarification before planning (feature mode only)

## Steps

### 1. Load context

**Phase mode** — read:
- `.iago/PROJECT.md` — vision, constraints, stack, architecture decisions
- `.iago/ROADMAP.md` — phase goal and success criteria
- `.iago/context/{NN}-{slug}.md` — decisions from discuss phase (if exists)
- `.iago/STATE.md` — current position, blockers
- `.iago/config.json` — `planning.max_tasks_per_plan` (default: 8)

**Feature mode (inline prompt)** — read:
- `.iago/PROJECT.md` (if exists) — project context
- `.iago/STATE.md` (if exists) — current position
- `.iago/config.json` (if exists) — planning config
- The user's prompt IS the requirement. Extract: what to build, constraints, acceptance criteria.

**Feature mode (file path)** — read:
- The input file (`.md`, `.pdf`, `.txt`) — this is the primary source of truth
- `.iago/PROJECT.md` (if exists) — project context
- `.iago/STATE.md` (if exists) — current position

### 1b. Optional discuss (`--discuss` flag, feature mode only)

If `--discuss` is set:
- Surface 2-4 quick decisions based on the input (data model, API shape, UI behavior, edge cases)
- Keep it conversational — do NOT write a context artifact
- Capture decisions inline for the plan

### 2. Optional research

If `--research` flag is set, dispatch the `research` profile:
- Question: "Scan the codebase for existing implementations related to {goal}.
  Report: relevant files, patterns in use, dependencies, potential conflicts."
- Use findings to inform plan structure.

### 3. Decompose into plans

Break the feature/phase into plans. Each plan is a coherent unit of work:
- 2-8 tasks per plan (from `config.planning.max_tasks_per_plan`)
- If more than 8 tasks needed, split into multiple plans
- Assign wave numbers: wave 1 = no dependencies, wave 2+ = depends on earlier plans
- Declare `depends_on` for cross-plan dependencies

### 4. Write each task

For every task in every plan:

- **files:** Exact file paths (1-3 per task)
- **action:** Specific instruction a fresh-context agent can execute. Max 3 sentences. No placeholders.
- **verify:** Exact shell command to confirm the task is done
- **expected:** What the verify command produces when correct

### 5. Self-review (mandatory)

Before writing plan files, check:

| Check | Action if Failed |
|-------|-----------------|
| Context coverage — every discuss decision is addressed | Add missing tasks |
| Placeholder scan — no "TBD", "TODO", "implement later", "similar to Task N" | Replace with specifics |
| File consistency — files in tasks match files in plan header | Fix mismatches |
| Verify commands — every task has a runnable verify command | Add missing commands |
| Wave sanity — wave 1 plans have no `depends_on` | Fix wave assignments |
| Task count — no plan exceeds `max_tasks_per_plan` | Split the plan |

### 6. Write plan files

Plans are organized in **folders** within `.iago/plans/`:

**Phase mode:** `.iago/plans/{NN}-{slug}/01-{name}.md`, `02-{name}.md`, etc.
**Feature mode:** `.iago/plans/feature-{slug}/01-{name}.md`, `02-{name}.md`, etc.

Create the folder if it doesn't exist. Derive `{slug}` from the feature description
or spec filename (kebab-case, max 30 chars).

Each plan file follows this format:

```markdown
---
phase: {NN}-{slug} OR feature-{slug}
plan: {PP}
wave: {N}
depends_on: [{plan IDs or empty}]
context: {context artifact path OR input file path OR "inline"}
created: {YYYY-MM-DD}
source: {phase|feature}
---

# Plan: {phase}/{PP}-{name}

## Goal

{1-2 sentences: what this plan achieves.}

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | {path} | {why} |
| modify | {path} | {why} |

## Tasks

### Task 1: {name}
- **files:** `{path}`
- **action:** {Specific implementation instruction. ≤3 sentences.}
- **verify:** `{exact shell command}`
- **expected:** {What the verify command produces when correct}

## Verification

{After all tasks: aggregate verify command + expected result.}
```

### Example folder structures

**Phase mode** — ROADMAP phase `01-auth`:
```
.iago/plans/01-auth/
  01-cognito-setup.md
  02-login-page.md
  03-token-refresh.md
```

**Feature mode** — standalone feature "payment flow":
```
.iago/plans/feature-payment-flow/
  01-stripe-integration.md
  02-checkout-ui.md
```

### 7. Stress-test each plan

After writing all plan files, stress-test each one:

For each plan, dispatch an `analyst` agent (opus) with read-only tools
(`Read`, `Glob`, `Grep`). The agent reviews the PLAN across 5 dimensions:

1. **PRECISION** — Vague requirements, ambiguous scope, unspecified behavior
2. **EDGE CASES** — Inputs, states, or sequences that would break the approach
3. **CONTRADICTIONS** — Conflicts with codebase patterns, CLAUDE.md, or architecture
4. **SIMPLER ALTERNATIVES** — Clearly better approach (not just different)
5. **MISSING ACCEPTANCE CRITERIA** — Gaps that force the implementer to guess

Agent must end with exactly one verdict:
- `VERDICT: PROCEED` — no significant issues
- `VERDICT: PROCEED_WITH_NOTES` — proceed with awareness
- `VERDICT: BLOCK` — critical flaw, plan needs revision

After each stress test, append a `## Stress Test` section to the plan file
(before `## Verification`):

```markdown
## Stress Test

**Verdict:** {verdict}
**Date:** {YYYY-MM-DD}

{Findings grouped by dimension. Skip empty dimensions.}
```

If verdict is BLOCK: warn the user, but still write the plan. User decides
whether to revise before `/iago-execute`. The pipeline's step 0 will see the
section and skip re-testing.

### 8. Update STATE.md

**Phase mode:**
- Phase: `{NN}-{slug}` | Status: `planning`
- Log: "{N} plans created for phase {NN}-{slug}"

**Feature mode:**
- Log to the Quick Tasks table:

| Date | Mode | Description | Plans |
|------|------|-------------|-------|
| {today} | plan | {description} | {N} plans |

## Output

After completion, display:
1. Plan count and wave structure
2. Task count per plan
3. Any concerns from self-review
4. Stress-test verdicts per plan (unless `--no-stress`)
5. **Phase mode:** "Run `/iago-execute {phase-slug}` to begin implementation."
6. **Feature mode:** "Run `/iago-execute feature-{slug}` to begin implementation."

## Boundaries

- Never implement code — plans only
- Never modify ROADMAP.md scope
- If the phase is too large to plan (>4 plans, >24 tasks), recommend splitting in ROADMAP.md
- Plans must be executable by a fresh-context agent (via executor profile) with no additional context
