---
phase: feature-tool-surveillance
plan: 04
wave: 2
depends_on: [01]
context: docs/specs/feature-tool-surveillance.md
created: 2026-05-04
source: feature
---

# Plan: feature-tool-surveillance/04-what-skill

## Goal

Build a `/what-skill` discovery skill that takes a natural-language intent and recommends the top 3 matching skills with confidence scores and explicit invocation hints. NEVER auto-invokes — pure recommendation. Solves the discoverability problem the council flagged without crossing the determinism boundary.

Depends on Plan 01 Task 4 (skill frontmatter audit) — `/what-skill` reads the `description` frontmatter blocks; if Plan 01 hasn't filled them, results will be sparse.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `.claude/skills/what-skill/SKILL.md` | New skill: scan skill frontmatter, rank by intent match, recommend |
| modify | `.claude/rules/available-skills.md` | Add `/what-skill` to the quick-reference table |

## Tasks

### Task 1: Create /what-skill SKILL.md

- **files:** `.claude/skills/what-skill/SKILL.md`
- **action:** Write a new skill file. Frontmatter: `name: what-skill`, `description: Recommend matching skills for a natural-language intent. Use when unsure which slash-command to invoke. NEVER auto-invokes — always recommends only.`. Body has these sections: (1) Purpose: solve discoverability for the 50+ skill catalog without auto-dispatch. (2) Arguments: `/what-skill "I want to ..."`. (3) Steps: scan all `.claude/skills/*/SKILL.md` files (and `council/skill.md`), extract `description` frontmatter, score each against the user intent on a simple match rubric (intent overlap + scope match + reversibility match), return top 3 with confidence scores (high/medium/low). (4) Output format: top 3 ranked candidates, each with one-line description + explicit invocation hint (`Invoke with: /<skill-name> ...`). (5) Hard ceiling rule (in bold): NEVER auto-invoke any skill. NEVER suggest a write/commit/push skill (`/iago-execute`, `/iago-quick`, `/iago-fast`, `/iago-prfix`) without an explicit confirmation note: "This skill will modify your repo and may create a PR — confirm before invoking."
- **verify:** `test -f .claude/skills/what-skill/SKILL.md && grep -q "^name: what-skill" .claude/skills/what-skill/SKILL.md && grep -q "NEVER auto-invoke" .claude/skills/what-skill/SKILL.md`
- **expected:** File exists; frontmatter has correct name; ceiling rule present.

### Task 2: Define the scoring rubric in detail

- **files:** `.claude/skills/what-skill/SKILL.md` (extend the file from Task 1)
- **action:** Inside the Steps section, define the scoring rubric concretely as a 5-point scale (matches user intent / matches scope / matches reversibility / matches stack / matches workflow phase) — this is the same rubric defined in `.claude/rules/skill-authoring.md` (created in Plan 01 Task 7). Reference that rule rather than duplicating. Add a brief example: input `"I want to ship a small fix"` → top-1 `/iago-fast` (high), top-2 `/iago-quick` (medium), top-3 `/iago-execute` (low — flagged as scope-mismatch with confirmation note).
- **verify:** `grep -c "rubric\|matches user intent\|confidence" .claude/skills/what-skill/SKILL.md`
- **expected:** Count ≥3.

### Task 3: Codify the safety carve-outs

- **files:** `.claude/skills/what-skill/SKILL.md` (extend further)
- **action:** Add a "Safety carve-outs" subsection listing the skills that REQUIRE the confirmation note when recommended: `/iago-execute`, `/iago-quick`, `/iago-fast`, `/iago-prfix`, `/iago-pause` (any skill that creates commits, PRs, or modifies STATE). For each, include a one-sentence reason. Also list skills that are SAFE to recommend without the confirmation note (read-only / planning / research): `/deep-research`, `/brainstorming`, `/iago-plan`, `/iago-stress`, `/iago-discuss`, `/code-review`, `/council`, `/what-skill` itself.
- **verify:** `grep -c "Safety carve-outs\|confirmation note\|safe to recommend" .claude/skills/what-skill/SKILL.md`
- **expected:** Count ≥3.

### Task 4: Add /what-skill to available-skills.md quick-reference

- **files:** `.claude/rules/available-skills.md`
- **action:** In the "Quick Reference — What Do I Run?" table near the top, add a new row: `Not sure which skill to run | /what-skill | /what-skill "I want to ship a small fix"`. In the "Design and Research" sub-table further down, add a row for `/what-skill` with When-to-use and When-NOT-to-use columns matching the format of surrounding entries.
- **verify:** `grep -c "what-skill" .claude/rules/available-skills.md`
- **expected:** Count ≥2 (one in quick-reference, one in detailed table).

### Task 5: Smoke test on representative intents

- **files:** No file edits — verification only
- **action:** Run `/what-skill` against each of these 5 representative intents and record the top-1 candidate plus confidence score: (a) `"I want to ship a small fix"` → expect /iago-fast top-1, (b) `"I want to research a library"` → expect /deep-research top-1, (c) `"I want to plan a phase"` → expect /iago-plan top-1, (d) `"I want to review a PR"` → expect /code-review or /iago-prfix top-1, (e) `"I want to explore a feature"` → expect /brainstorming top-1. Acceptance: top-1 matches expectation in ≥4 of 5 intents. If <4, dispatch a fix session to refine the rubric or per-skill descriptions.
- **verify:** Manual — run each `/what-skill "..."` invocation and record results in a brief log appended to `.iago/summaries/2026-05-04-what-skill-smoke.md`.
- **expected:** Smoke summary file exists with 5 entries; ≥4 match expected top-1.

## Verification

```bash
test -f .claude/skills/what-skill/SKILL.md && \
grep -q "NEVER auto-invoke" .claude/skills/what-skill/SKILL.md && \
grep -q "Safety carve-outs" .claude/skills/what-skill/SKILL.md && \
grep -q "what-skill" .claude/rules/available-skills.md && \
echo OK
```

Expected: prints `OK`. Smoke summary file exists with ≥4/5 top-1 matches. `tsc --noEmit` and `vite build` exit 0 (no TS impact).

## Notes

- This skill explicitly does NOT use Claude Code's auto-dispatch — it is invoked by the user typing `/what-skill ...`. The output is a recommendation list, never an action. This is the council-mandated separation: kepano's frontmatter is metadata for discovery, not a trigger for execution.
