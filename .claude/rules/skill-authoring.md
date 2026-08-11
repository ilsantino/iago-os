---
description: >-
  Conventions for authoring skills in .claude/skills/ — references/ sub-docs
  and routing evals for overlapping skills.
globs:
  - ".claude/skills/**"
---

# Skill Authoring

## references/ sub-documents

- SKILL.md over ~150 lines, or with sub-procedures needed only in specific branches → extract to `references/{topic}.md` inside the skill folder, linked by relative path. SKILL.md stays self-sufficient for the common path; under ~100 lines inline everything.
- Reference files: first paragraph names the parent skill; filename matches the topic; NO `description:` frontmatter (only SKILL.md is dispatched).
- Exactly one `SKILL.md` per skill folder, consistent filename casing (Linux is case-sensitive).

## Routing eval for overlapping skills

When adding or re-describing a skill that overlaps an existing one, write `.claude/skills/{skill-name}/eval.md`: score each test intent × candidate skill 0-2 on Intent, Scope, Reversibility, Stack, Workflow-phase. Pass: the expected skill scores ≥7 AND is the unique top scorer; a tie ≥7 means sharpen a `Do NOT use when` anti-trigger until it breaks.
