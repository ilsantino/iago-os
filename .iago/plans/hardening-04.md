---
phase: hardening
plan: 04
wave: 2
depends_on: []
created: 2026-04-06
---

# Plan: hardening-04 — Consolidate skills

## Goal

Reduce 41 skills to ~34 honest skills by consolidating 8 aspirational industry
skills into reference docs, merging 3 redundant skill pairs, and updating all
counts across documentation.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `docs/patterns/` | New directory for industry pattern reference docs |
| move | `.claude/skills/{8 industry skills}/SKILL.md` | Move to `docs/patterns/{domain}.md` |
| create | `.claude/skills/industry-patterns/SKILL.md` | Single parameterized skill replacing 8 |
| modify | `.claude/skills/content-engine/SKILL.md` | Absorb article-writing as `--formats blog` mode |
| delete | `.claude/skills/article-writing/` | Merged into content-engine |
| modify | `.claude/skills/deep-research/SKILL.md` | Absorb market-research as `--focus market` mode |
| delete | `.claude/skills/market-research/` | Merged into deep-research |
| modify | `.claude/skills/iago-agents/SKILL.md` | Absorb enterprise-agent-ops as `--scope operational` mode |
| delete | `.claude/skills/enterprise-agent-ops/` | Merged into iago-agents |
| modify | `.claude/rules/available-skills.md` | Update skill catalog with new counts |
| modify | `README.md` | Update skill counts and tables |
| modify | `docs/SKILLS.md` | Update full skill reference |
| modify | `CLAUDE.md` | Update skill count |

## Tasks

### Task 1: Move 8 industry skills to docs/patterns/
- **files:** `docs/patterns/`, `.claude/skills/carrier-relationship-management/`, `.claude/skills/customs/`, `.claude/skills/energy/`, `.claude/skills/inventory/`, `.claude/skills/logistics/`, `.claude/skills/production-scheduling/`, `.claude/skills/quality-nonconformance/`, `.claude/skills/returns-reverse-logistics/`
- **action:** Create `docs/patterns/` directory. For each of the 8 industry skills: read their SKILL.md, strip the YAML frontmatter, and write the content to `docs/patterns/{domain}.md` (e.g., `docs/patterns/logistics.md`). Keep healthcare-phi-compliance as a standalone skill — it has real implementation patterns. Then delete the 8 skill directories from `.claude/skills/`.
- **verify:** `ls docs/patterns/*.md | wc -l && ls .claude/skills/carrier-relationship-management 2>/dev/null; echo $?`
- **expected:** 8 pattern files, and the old skill directory returns non-zero (deleted)

### Task 2: Create /industry-patterns parameterized skill
- **files:** `.claude/skills/industry-patterns/SKILL.md`
- **action:** Create a single skill that accepts `--domain {logistics|inventory|customs|energy|carrier|production|quality|returns}` flag. The skill reads the corresponding `docs/patterns/{domain}.md` file and applies those DynamoDB schemas, API patterns, and conventions to the current task. Precondition: the patterns directory must exist. The skill is advisory — it injects domain knowledge, it doesn't implement code.
- **verify:** `test -f .claude/skills/industry-patterns/SKILL.md && echo "PASS"`
- **expected:** `PASS`

### Task 3: Merge article-writing into content-engine
- **files:** `.claude/skills/content-engine/SKILL.md`, `.claude/skills/article-writing/`
- **action:** Add `--formats blog` mode to content-engine that produces only a blog post (equivalent to what article-writing does today). Update the description and arguments to mention this mode. The default remains all formats. Then delete the `.claude/skills/article-writing/` directory. Update the content-engine description to mention it replaces article-writing.
- **verify:** `test -f .claude/skills/content-engine/SKILL.md && test ! -d .claude/skills/article-writing && echo "PASS"`
- **expected:** `PASS`

### Task 4: Merge market-research into deep-research
- **files:** `.claude/skills/deep-research/SKILL.md`, `.claude/skills/market-research/`
- **action:** Add `--focus market` mode to deep-research that applies market-research's structure (TAM/SAM/SOM, competitive landscape, trend identification). Update description and arguments. Delete `.claude/skills/market-research/` directory.
- **verify:** `test -f .claude/skills/deep-research/SKILL.md && test ! -d .claude/skills/market-research && echo "PASS"`
- **expected:** `PASS`

### Task 5: Merge enterprise-agent-ops into iago-agents
- **files:** `.claude/skills/iago-agents/SKILL.md`, `.claude/skills/enterprise-agent-ops/`
- **action:** Add `--scope operational` mode to iago-agents that applies enterprise-agent-ops's operational concerns (topology, runbooks, monitoring). The default `--scope client` keeps current behavior (client deliverable design). Delete `.claude/skills/enterprise-agent-ops/` directory.
- **verify:** `test -f .claude/skills/iago-agents/SKILL.md && test ! -d .claude/skills/enterprise-agent-ops && echo "PASS"`
- **expected:** `PASS`

### Task 6: Update all documentation counts
- **files:** `.claude/rules/available-skills.md`, `README.md`, `docs/SKILLS.md`, `CLAUDE.md`, `HANDOFF.md`
- **action:** Update the skill count from 41 to 34 across all files. Remove the deleted skills from available-skills.md catalog, update the README skills tables (remove the 3 merged skills, replace 8 industry rows with single industry-patterns entry), update SKILLS.md reference (remove 11 old entries, add 1 industry-patterns + 3 updated entries), update CLAUDE.md skill summary line.
- **verify:** `grep -c "34" README.md && grep "industry-patterns" .claude/rules/available-skills.md`
- **expected:** README mentions 34 skills, available-skills.md contains industry-patterns

## Verification

After all tasks: `ls .claude/skills/ | wc -l` (should be 34) AND `ls docs/patterns/ | wc -l` (should be 8) AND `echo "PLAN-04 PASS"`

Expected: 34 skills, 8 patterns, `PLAN-04 PASS`
