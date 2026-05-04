---
phase: feature-tool-surveillance
plan: 02
wave: 1
depends_on: []
context: docs/specs/feature-tool-surveillance.md
created: 2026-05-04
source: feature
---

# Plan: feature-tool-surveillance/02-source-grounded

## Goal

Extend `/deep-research` with the source-grounded answer pattern absorbed from notebooklm-skill research. Adds a typed source registry, an explicit corpus-isolation constraint, a source-router pre-step, and a citation convention for research artifacts. Pure rules + skill enhancement — no new tools.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `.claude/rules/source-grounded-answers.md` | Source registry shape + corpus-isolation policy + citation convention |
| modify | `.claude/skills/deep-research/SKILL.md` | Add source-router pre-step + emit source registry in artifact |
| modify | `.claude/skills/deep-research/SKILL.md` (artifact template section) | Citations reference registry by id; unsourced claims tagged `[unsourced]` |
| create | `scripts/lint-research-artifact.sh` | Optional citation-lint helper for research artifacts |

## Tasks

### Task 1: Create source-grounded-answers rule

- **files:** `.claude/rules/source-grounded-answers.md`
- **action:** Write a new rule file with three sections. (1) **Source registry shape**: define a typed metadata block emitted at the top of any research/citation artifact — `id` (short slug), `type` (web|doc|code|conversation|other), `uri` (URL or path), `fetched_at` (ISO date), `hash` (sha256 first 12 chars or "n/a" for live URLs), one-sentence summary. Show a YAML and a markdown example. (2) **Corpus-isolation policy**: when a skill is operating in source-grounded mode, the agent must answer ONLY from registry-listed sources — no weight-drawn answers, no claims without a registry citation. State the explicit failure mode: any unsourced claim must be tagged `[unsourced]` inline so the reader knows it's outside the registry. (3) **Source-router-before-answer**: before generating, the agent picks which subset of registry sources to query for the question and states the routing decision (e.g., "querying sources [s1, s3, s7] because they cover the architecture sub-question"). Cite source: notebooklm-skill research.
- **verify:** `test -f .claude/rules/source-grounded-answers.md && grep -c "registry\|corpus-isolation\|source-router\|\\[unsourced\\]" .claude/rules/source-grounded-answers.md`
- **expected:** File exists; grep count ≥4.

### Task 2: Add source-router pre-step to /deep-research

- **files:** `.claude/skills/deep-research/SKILL.md`
- **action:** Insert a new "Step 2.5 — Source router" between the existing Step 2 (dispatch research agent) and Step 3 (synthesize findings). The research agent emits a `## Source Registry` block with all fetched sources (one entry per source per the schema in `.claude/rules/source-grounded-answers.md`). Then the synthesis step states which registry ids are being queried for each sub-question and routes accordingly. Update the skill's `description` frontmatter to mention source-grounded output as a feature. Reference the new rule file.
- **verify:** `grep -c "Source Registry\|source-router\|source-grounded" .claude/skills/deep-research/SKILL.md`
- **expected:** Count ≥3.

### Task 3: Update research artifact template for citation discipline

- **files:** `.claude/skills/deep-research/SKILL.md`
- **action:** In the existing "Step 5 — Write research artifact" template, modify the artifact format so every claim cites a registry id inline (e.g., `According to [s2], DynamoDB ... [s2]`). Add an explicit `[unsourced]` tag rule for any claim not backed by a registry source. Update the example artifact to show 2-3 cited claims and one `[unsourced]` claim. Add a "Citation discipline" subsection right after the artifact template with the rule statement.
- **verify:** `grep -c "\\[s[0-9]\\]\\|\\[unsourced\\]\\|Citation discipline" .claude/skills/deep-research/SKILL.md`
- **expected:** Count ≥3.

### Task 4: Create citation-lint helper

- **files:** `scripts/lint-research-artifact.sh`
- **action:** Write a small bash script that takes a research artifact path as its argument and reports: (a) whether a `## Source Registry` block exists, (b) the count of registry entries, (c) the count of inline `[s<n>]` citations, (d) the count of `[unsourced]` tags. Output is informational, not a hard gate — exits 0 if the registry block exists, exits 1 otherwise. Document the script in the deep-research SKILL.md as an optional post-write check.
- **verify:** `bash scripts/lint-research-artifact.sh .iago/research/2026-05-04-integration-matrix.md; echo "exit=$?"`
- **expected:** Script runs without error (exit 0 or 1 acceptable since the matrix file does not yet have a registry block; failure mode for missing registry should be informative, not a crash).

## Verification

```bash
test -f .claude/rules/source-grounded-answers.md && \
grep -q "Source Registry" .claude/skills/deep-research/SKILL.md && \
grep -q "Citation discipline" .claude/skills/deep-research/SKILL.md && \
test -x scripts/lint-research-artifact.sh && \
echo OK
```

Expected: prints `OK`. Plus `tsc --noEmit` and `vite build` exit 0 (no TS impact).

Smoke test (manual): run `/deep-research` on a small question and confirm the output artifact has a `## Source Registry` block and at least one inline `[s<n>]` citation. Defer this to pipeline review or post-merge smoke run.
