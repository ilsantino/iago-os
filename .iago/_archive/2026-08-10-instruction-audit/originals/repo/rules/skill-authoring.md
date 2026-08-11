# Skill Authoring

Two conventions for keeping the iaGO skill catalog scannable and the
orchestrator's routing behavior measurable.

## 1. references/ sub-document pattern

Source: kepano (obsidian-skills repo).

When a `SKILL.md` exceeds ~150 lines or contains multiple complex sub-procedures
that the agent only needs in specific branches, extract those sub-procedures into
`references/{topic}.md` files inside the skill folder. The primary `SKILL.md`
links to them via relative paths (`see [voting record schema](references/voting.md)`)
and stays scannable.

Layout:

```
.claude/skills/{skill-name}/
  SKILL.md                  # primary doc — purpose, args, steps, boundaries
  references/
    {topic-a}.md            # detailed sub-procedure A
    {topic-b}.md            # detailed sub-procedure B
```

Rules:

- The `SKILL.md` must be self-sufficient for the common path. Only branch into
  `references/` for edge cases, complex schemas, or long examples.
- Reference files must declare their parent skill in their first paragraph so
  they remain interpretable if the agent reads them in isolation.
- A reference file's filename matches the topic it covers (`voting-record.md`,
  not `notes.md`).
- Do NOT add a frontmatter `description:` block to reference files — only the
  primary `SKILL.md` is dispatched. Reference files are sub-docs, not skills.
- A skill folder may contain at most one `SKILL.md` (case-sensitive on Linux,
  case-insensitive on Windows — keep filename consistent across the catalog).

When to extract:

- The skill grows past ~150 lines.
- A sub-procedure has its own example block and would push the primary doc
  out of "scannable in 30 seconds" territory.
- The same procedure is referenced from more than one decision branch in the
  skill — extract once, link from both.

When NOT to extract:

- The skill is under ~100 lines. Inline everything.
- The sub-content is a one-line definition. Inline it.
- The reference would only be loaded when the orchestrator uses the skill —
  in that case, the primary doc already gives full context.

## 2. Rubric-based skill-selection eval

Source: agent-browser (`SKILL.md` evaluation harness).

When adding a new skill that overlaps with an existing one (e.g., another
"plan-something" or "fix-something" skill), write a 5-point rubric eval to
verify the orchestrator routes intent → skill correctly. The rubric scores
candidate skills against an intent across 5 dimensions:

| Dimension | Question | Score |
|-----------|----------|-------|
| **Intent** | Does the skill's purpose match what the user wants to do? | 0-2 |
| **Scope** | Does the skill's task-size fit the request (trivial / small / multi-task / phase)? | 0-2 |
| **Reversibility** | Does the skill's commit/PR posture match the user's risk tolerance? | 0-2 |
| **Stack** | Does the skill apply to the project's stack (React/Vite vs. Lambda vs. n8n)? | 0-2 |
| **Workflow phase** | Does the skill belong in the current phase (init / plan / execute / verify)? | 0-2 |

Total /10. The correct skill scores ≥7. If two skills tie ≥7, that's the
overlap signal — refine the `Do NOT use when` anti-trigger on at least one
of them until the tie breaks.

### When to run an eval

- Adding a new skill that even partially overlaps an existing one.
- A user repeatedly invokes a sub-optimal skill ("they keep using
  `/iago-quick` when `/iago-fast` is the better fit").
- A skill's `description:` frontmatter is being rewritten — re-eval to
  confirm the change preserves correct routing.

### Eval template

Place evals at `.claude/skills/{skill-name}/eval.md`. Template:

```markdown
# Eval: {skill-name}

## Test cases

| Intent | Expected skill | Notes |
|--------|----------------|-------|
| "I want to fix a typo in a single file." | /iago-fast | Trivial |
| "I want to add a 3-task feature outside ROADMAP." | /iago-quick | Small, standalone |
| "I want to plan and execute Phase 2 of the M2 ROADMAP." | /iago-plan + /iago-execute | Phase-scoped |

## Rubric scoring (per intent × candidate skill)

For each test case, score every candidate skill across the 5 dimensions
(Intent, Scope, Reversibility, Stack, Workflow phase) and surface the
top scorer. The expected skill must score ≥7 AND be the unique top scorer.

## Pass criteria

- Every test case routes to the expected skill (no ties at the top).
- No skill scores ≥7 on a test case where it is not the expected skill.
```

Re-run the eval after any change to a skill's `description:` frontmatter, to
the high-confusion `Do NOT use when` anti-triggers, or after adding/removing
skills in the catalog.
