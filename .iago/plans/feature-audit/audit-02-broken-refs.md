---
phase: audit
plan: 02
wave: 1
depends_on: []
created: 2026-04-12
---

# Plan: audit-02 — Fix broken references and dead links

## Goal

Fix all Critical and Important documentation accuracy issues found in the
full repo audit. Every file path reference, model claim, skill count, and
template hook path must match reality.

## Findings Addressed

C1, C2, C3, I4, I5, I6, I10, I11, m6

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `templates/client-project/.claude/settings.json.template` | Remove context-monitor.mjs hook entry |
| modify | `templates/internal-project/.claude/settings.json.template` | Remove context-monitor.mjs hook entry |
| modify | `README.md` | Fix 3 dead docs/SKILLS.md links → .claude/rules/available-skills.md; update skill count 33→34; update dir tree |
| modify | `docs/IAGO-DASHBOARD.md` | Fix dead docs/SKILLS.md reference |
| modify | `.claude/skills/industry-patterns/SKILL.md` | Fix 4 domain→filename mappings |
| modify | `.claude/skills/iago-execute/SKILL.md` | Fix step 5b model haiku→sonnet; add step 0 to Purpose chain |
| modify | `CLAUDE.md` | Fix step 5b model claim haiku→sonnet; fix "Three layers"→"Four layers" |
| modify | `.claude/rules/available-skills.md` | Move /iago:schedule from Built-in to Workflow section |
| delete | 25 `.gitkeep` files in `.claude/skills/*/` | Remove stale gitkeep alongside existing SKILL.md |

## Tasks

### Task 1: Remove dead context-monitor hook from templates
- **files:** `templates/client-project/.claude/settings.json.template`, `templates/internal-project/.claude/settings.json.template`
- **action:** Delete the hook entry on line 51 that references `context-monitor.mjs` in both template files. This hook was removed from iago-os but templates still wire it — every scaffolded project breaks.
- **verify:** `grep -c "context-monitor" templates/client-project/.claude/settings.json.template templates/internal-project/.claude/settings.json.template`
- **expected:** Both return 0

### Task 2: Fix dead docs/SKILLS.md links in README and dashboard
- **files:** `README.md`, `docs/IAGO-DASHBOARD.md`
- **action:** In README.md:
  - Line 294: change `[docs/SKILLS.md](docs/SKILLS.md)` → `[.claude/rules/available-skills.md](.claude/rules/available-skills.md)`
  - Line 458: change `SKILLS.md` dir tree comment → `available-skills.md` (in .claude/rules/)
  - Line 518: change `[Skills Reference](docs/SKILLS.md)` → `[Skills Reference](.claude/rules/available-skills.md)`
  In docs/IAGO-DASHBOARD.md line 110: update the docs/SKILLS.md reference.
- **verify:** `grep -c "docs/SKILLS" README.md docs/IAGO-DASHBOARD.md`
- **expected:** Both return 0

### Task 3: Update skill count 33→34
- **files:** `README.md`
- **action:** Update all occurrences:
  - Line 6: badge `Skills-33` → `Skills-34`
  - Line 38: `33 Skills` → `34 Skills`
  - Line 227: `Skills (33)` → `Skills (34)`
  - Line 432: `# 33 skill definitions` → `# 34 skill definitions`
- **verify:** `grep -c "33" README.md | head -1` (should decrease) AND `grep "Skills-34\|34 Skills\|Skills (34)\|34 skill" README.md | wc -l`
- **expected:** 4 matches for "34"

### Task 4: Fix industry-patterns domain→file mapping
- **files:** `.claude/skills/industry-patterns/SKILL.md`, `docs/patterns/carrier-relationship-management.md`, `docs/patterns/production-scheduling.md`, `docs/patterns/quality-nonconformance.md`, `docs/patterns/returns-reverse-logistics.md`, `docs/patterns/logistics.md`
- **action:** Line 36 reads `docs/patterns/{domain}.md`. Four domains use short names that don't match filenames:
  - `carrier` → actual file is `carrier-relationship-management.md`
  - `production` → actual file is `production-scheduling.md`
  - `quality` → actual file is `quality-nonconformance.md`
  - `returns` → actual file is `returns-reverse-logistics.md`
  Rename the 4 files to match short domain names (simpler, less fragile). **Stress test note:** `docs/patterns/logistics.md:72` cross-references `carrier-relationship-management` — update that reference to `carrier` after rename.
- **verify:** For each domain in (carrier production quality returns): `test -f docs/patterns/{domain}.md && echo "OK" || echo "MISSING"` AND `grep "carrier-relationship-management" docs/patterns/logistics.md | wc -l` (should be 0)
- **expected:** All 4 return OK, no stale cross-references

## Stress Test

Reviewed by opus adversarial analyst on 2026-04-12. Verdict: **PROCEED_WITH_NOTES**.
- Task 4: logistics.md:72 cross-references carrier-relationship-management → must update after rename. Added to file list and verify.
- All other tasks verified against current file state (line numbers confirmed).

### Task 5: Fix model claims — step 5b is sonnet, not haiku
- **files:** `.claude/skills/iago-execute/SKILL.md`, `CLAUDE.md`
- **action:** In iago-execute/SKILL.md line 107: change "haiku synthesizes" → "sonnet synthesizes". In CLAUDE.md Model Routing section: change "Haiku for @claude tags" → "Sonnet for PR creation + @claude tags". Also in CLAUDE.md Pipeline section: fix "haiku" reference if present.
- **verify:** `grep -i "haiku" CLAUDE.md .claude/skills/iago-execute/SKILL.md`
- **expected:** No matches

### Task 6: Add stress test to iago-execute Purpose chain
- **files:** `.claude/skills/iago-execute/SKILL.md`
- **action:** The Purpose paragraph lists the pipeline as "implement → build gate → review → codex → fix → PR". Prepend "stress test →" to this chain to match the actual step 0.
- **verify:** `grep -c "stress" .claude/skills/iago-execute/SKILL.md`
- **expected:** At least 2 (one in Purpose, one in step list)

### Task 7: Fix CLAUDE.md minor issues
- **files:** `CLAUDE.md`
- **action:** Fix "Three layers" claim → count matches table rows (MEMORY.md, Obsidian, Graphify, MemPalace = 4 rows, but MEMORY.md is a file not a layer — verify intent and fix header to match).
- **verify:** Read the Memory Architecture section — header count matches table row count
- **expected:** Consistent

### Task 8: Move /iago:schedule in available-skills.md
- **files:** `.claude/rules/available-skills.md`
- **action:** `/iago:schedule` is listed under "Built-in (Claude Code native)" section. It has a custom SKILL.md at `.claude/skills/iago-schedule/SKILL.md` — it's an iaGO skill, not a native built-in. Move the entry to the "Workflow (iaGO)" section.
- **verify:** `grep -A1 "iago:schedule" .claude/rules/available-skills.md` — should appear under Workflow header
- **expected:** Entry under Workflow section, not under Built-in

### Task 9: Delete stale .gitkeep files from skill dirs
- **files:** 25 `.gitkeep` files in `.claude/skills/*/`
- **action:** For every skill directory that has BOTH a `.gitkeep` and a `SKILL.md`, delete the `.gitkeep`. Git tracks non-empty directories — the `.gitkeep` serves no purpose once `SKILL.md` exists.
- **verify:** `find .claude/skills -name ".gitkeep" -exec sh -c 'test -f "$(dirname {})/SKILL.md" && echo "STALE: {}"' \;`
- **expected:** No output (all stale gitkeeps removed)

## Verification

After all tasks:
```bash
grep -c "docs/SKILLS" README.md docs/IAGO-DASHBOARD.md && echo "FAIL: dead links remain" || echo "PASS: no dead links"
grep -c "context-monitor" templates/client-project/.claude/settings.json.template && echo "FAIL" || echo "PASS: template clean"
grep -i "haiku" CLAUDE.md .claude/skills/iago-execute/SKILL.md && echo "FAIL" || echo "PASS: model claims fixed"
grep "Skills-34" README.md && echo "PASS: count updated" || echo "FAIL: count stale"
```

Expected: All PASS
