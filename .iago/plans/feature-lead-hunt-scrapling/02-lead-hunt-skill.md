---
phase: feature-lead-hunt-scrapling
plan: 02
wave: 2
depends_on: [01]
context: inline
created: 2026-05-28
source: feature
---

# Plan: feature-lead-hunt-scrapling/02-lead-hunt-skill

## Goal

Ship `/lead-hunt` as a Claude Code skill that orchestrates Scrapling MCP for free lead discovery, emits a canonical Lead CSV with confidence scoring + `needs_apollo_validation` flag, and pairs with a runbook describing when to layer paid Apollo enrichment on top of the free output. Skill is iaGO-internal (used for client prospecting + high-value-target enrichment), not a client deliverable.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `.claude/skills/lead-hunt/SKILL.md` | Skill definition: purpose, args, steps, INLINE Lead schema + CSV spec, boundaries (single file per skill-authoring 150-line rule) |
| create | `.claude/skills/lead-hunt/eval.md` | Rubric-based skill-selection eval (required per `.claude/rules/skill-authoring.md` — `/lead-hunt` overlaps `/deep-research` and `/iago-quick`) |
| create | `.iago/_config/runbooks/lead-hunt.md` | Human runbook: when to run free-only, when to layer Apollo, validation/enrichment workflow, credit-budget heuristic |
| modify | `.claude/rules/available-skills.md` | Add `/lead-hunt` row to "Specialized" table |

## Tasks

### Task 1: Write `lead-hunt` SKILL.md (single file, schema inline)
- **files:** `.claude/skills/lead-hunt/SKILL.md`
- **action:** Single file, target 100-150 lines (under skill-authoring 150-line extraction threshold — no `references/` subdir). Frontmatter: `name: lead-hunt`, `description:` ≤2 sentences ending with anti-trigger "Not when scraping authenticated platforms (LinkedIn logueado, Apollo UI) or when volume >100 leads needs paid tooling — use Apollo directly." Body sections:
  - **Purpose** (3-5 lines)
  - **Arguments**: `--source {url}` (required), `--target-role "{phrase or regex}"` (optional, validated via `re.compile()` before use; malformed regex → STOP with error), `--max {N}` (default 50, hard ceiling 200 — anything above warns and clamps), `--output {csv_path}` (default `leads-{YYYY-MM-DD-HHMMSS}.csv` — full timestamp prevents collision; if path exists, append `-1`, `-2`, … not overwrite)
  - **Lead schema (inline)**: fields `name`, `title`, `company`, `company_domain`, `email`, `linkedin_url`, `source_url`, `confidence` (0-1 float), `needs_apollo_validation` (bool), `discovered_at` (ISO8601 UTC), `notes`
  - **Confidence rubric**: name + title + company + verifiable email-pattern → 0.8-1.0; name + company + inferred title → 0.5-0.7; name + company only → 0.2-0.4; `needs_apollo_validation = (confidence < 0.5) OR (email is None) OR (title is inferred)`
  - **Steps**:
    1. Validate args (regex compile, URL well-formed, output dir writable, max ≤200)
    2. Pick fetcher: `fetch` for static HTML (HEAD test → `Cloudflare` server header absent), `stealthy_fetch` for Cloudflare/anti-bot, `bulk_stealthy_fetch` ONLY when source returns a list-of-pages and `--max ≥ 10` (Scrapling's bulk variant handles internal pacing — single-call sequencing uses orchestrator-side `sleep 2` between calls; document this honestly: rate-limit is enforced by sequencing one MCP call at a time, NOT by Scrapling's internal config)
    3. Extract candidate contact blocks, structure into Lead records
    4. Score each per rubric
    5. **Dedupe** with normalization: lowercase + `strip()` + Unicode NFC normalize the dedup key. Key formula: `email_normalized OR (name_normalized + "|" + company_normalized)`. NFC handles `José`/`José` (composed vs decomposed) collisions; lowercase handles `JOSE`/`jose`; strip handles trailing whitespace
    6. Write CSV (UTF-8 no BOM, comma delimiter, RFC 4180 quoting via Python `csv.QUOTE_MINIMAL`, header row, ISO8601 dates with `Z` suffix)
    7. Print summary line: `Wrote N leads to {path}. M need Apollo validation (M/N = X%). Average confidence: Y.`
  - **Failure modes**:
    - Zero candidate blocks extracted → write empty CSV with header row + summary `Wrote 0 leads.` Do NOT error
    - All fetcher tiers return 403/blocked → STOP with explicit message naming the 3 attempts; do NOT write CSV
    - Scrapling MCP unreachable → STOP and direct user to Plan 01 verification
  - **Boundaries**: respect `robots.txt` (Scrapling does this by default unless overridden — do NOT override), max 200 leads/run absolute, never attempt logged-in LinkedIn (`linkedin.com/in/` URLs that require auth are out of scope; public profiles via Google cache only)
  - Link to runbook by relative path: `../../../.iago/_config/runbooks/lead-hunt.md`
- **verify:** `head -10 .claude/skills/lead-hunt/SKILL.md && wc -l .claude/skills/lead-hunt/SKILL.md && grep -c "^##" .claude/skills/lead-hunt/SKILL.md`
- **expected:** Frontmatter present; file is 100-150 lines; ≥6 `##` headings.

### Task 2: Write skill-selection eval
- **files:** `.claude/skills/lead-hunt/eval.md`
- **action:** Required per `.claude/rules/skill-authoring.md` because `/lead-hunt` overlaps `/deep-research` (research/prospecting) and `/iago-quick` (small-scope task). Template per the rule:
  - **Test cases** table (4 rows minimum): "I need contact info for 20 logistics CTOs in Mexico" → `/lead-hunt`; "I want background on the carbon-credit market for an investor pitch" → `/deep-research`; "Fix the typo in the lead-hunt readme" → `/iago-fast`; "Build a 3-task feature for CSV export tooling outside ROADMAP" → `/iago-quick`
  - **Rubric scoring** section per intent × candidate skill across 5 dimensions (Intent, Scope, Reversibility, Stack, Workflow phase), 0-2 each, expected skill must score ≥7 and be unique top scorer
  - **Pass criteria** copied from the skill-authoring template
- **verify:** `grep -c "^##\|^###" .claude/skills/lead-hunt/eval.md`
- **expected:** ≥4 `##`/`###` headings (Test cases, Rubric scoring, Pass criteria, plus per-intent subsections).

### Task 3: Write Apollo enrichment runbook
- **files:** `.iago/_config/runbooks/lead-hunt.md`
- **action:** Document the hybrid workflow per Santiago's call: Scrapling does discovery (free, volume), Apollo does validation + enrichment (paid, quirurgico). Sections:
  - **When to run free-only**: one-off prospect lookups, ≤50 leads, public sites, exploratory research
  - **When to layer Apollo**: active outreach campaign, need email-deliverability guarantee, role-validation for engagements ≥$5k value, when `needs_apollo_validation` rate >50% in the free-only output
  - **Apollo workflow on a CSV**: (1) import CSV to Apollo as a list, (2) bulk email-verify the rows that have an `email` value, (3) bulk people-search Apollo for rows where `needs_apollo_validation=true`, (4) enrich confirmed rows with direct dial + current cargo + current company tenure, (5) export back, merge into iaGO CRM (deduped on `linkedin_url` then `email_normalized`)
  - **Credit budget heuristic**: target ≤0.3 Apollo credits per usable lead by routing discovery through Scrapling first; if observed cost-per-lead exceeds 0.5 credits over 3 consecutive campaigns, audit which step is burning credits (usually: people-search on rows where Scrapling found nothing — those are often non-existent leads, not Apollo misses)
- **verify:** `grep -c "^##" .iago/_config/runbooks/lead-hunt.md`
- **expected:** Exactly 4 `##` sections.

### Task 4: Register `/lead-hunt` in skill catalog
- **files:** `.claude/rules/available-skills.md`
- **action:** Add a new row at the END of the "Specialized" table (after the `/agent-payment-x402` row). The "Specialized" table has 3 columns (`| Skill | What | When to use |`) — match the existing row style (skill name NOT backticked inside the cell, since existing Specialized rows like `/subagent-driven-development` don't backtick the skill name in the cell). Row content: `| /lead-hunt | Scrapling-MCP-backed lead discovery, emits canonical CSV with Apollo-validation flag | iaGO prospecting / quick enrichment of high-value targets (5-50 leads, public sites) |`. Do NOT add "investor outreach" to the use case (anti-trigger conflict: investor outreach needs email-deliverability guarantees → Apollo, not free scraper). Do NOT add to the "Quick Reference" top-of-file table.
- **verify:** `grep -c "/lead-hunt" .claude/rules/available-skills.md`
- **expected:** Exactly 1 match.

### Task 5: Smoke test on a designated public target
- **files:** `.iago/handoff/lead-hunt-smoke-test.md`
- **action:** Designated target: AMA (Asociación Mexicana de Agricultura Protegida) public member directory at `https://www.amhpac.org/socios/` (public, no auth, low-risk, relevant to Red Sun Farms vertical Santiago has insider access to). Dispatch `/lead-hunt --source https://www.amhpac.org/socios/ --target-role "director general OR CEO" --max 5`. Write findings to handoff file with these explicit PASS criteria — ALL must be true for PASS:
  - **P1**: Scrapling MCP responded to the first tool call (not unreachable)
  - **P2**: CSV file was created at the expected path with valid UTF-8 + header row + ≥1 data row
  - **P3**: At least 1 row has `confidence ≥ 0.4` (proves extraction worked, not just structural skeleton)
  - **P4**: Summary line printed with `needs_apollo_validation` count
  - **P5**: Total wall-clock ≤180s
  Anything else (rate-limit fallbacks, partial extractions, % needing Apollo) is OBSERVATIONAL not a failure. If target site is down, substitute with `https://www.amexcomp.com.mx/socios/` (Asociación Mexicana de Empaque) as backup. If MCP unreachable, STOP and revisit Plan 01 Task 3. If target itself blocks all 3 fetcher tiers, document and pick a different public-directory target — that proves the skill's failure path works correctly.
  **⚠ Note:** Both smoke-test URLs are external dependencies. P2/P3 PASS criteria (CSV with ≥1 data row, confidence ≥0.4) may fail if either site changes structure even when the skill itself is correct. If criteria fail on a re-run, verify the target site still renders member data before attributing failure to the skill.
- **verify:** `test -f .iago/handoff/lead-hunt-smoke-test.md && grep -c "^- P[1-5]:" .iago/handoff/lead-hunt-smoke-test.md`
- **expected:** File exists; exactly 5 `- P1:` through `- P5:` lines with PASS/FAIL/N/A verdicts.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-28

**CONTRADICTION (Critical, fixed inline):** Original plan extracted lead schema to `references/lead-schema.md` despite expected total ~100-120 lines being UNDER the 150-line extraction threshold in `.claude/rules/skill-authoring.md`. Fixed: schema now inline in SKILL.md; `references/` subdir dropped.

**CONTRADICTION (Critical, fixed inline):** `eval.md` was missing entirely. `skill-authoring.md` rubric-eval rule mandates it for skills overlapping existing ones — `/lead-hunt` overlaps `/deep-research` + `/iago-quick`. Added as Task 2.

**MISSING ACCEPTANCE CRITERIA (Critical, fixed inline):** Smoke test (Task 5) had no PASS/FAIL definition and no designated target. Fixed: 5 explicit PASS criteria (P1-P5) + designated AMHPAC target with backup AMEXCOMP target.

**PRECISION (Important, fixed inline):** Rate-limit mechanism was hand-wavy ("1 req/2s default") with no enforcement layer. Fixed: skill enforces via orchestrator-side single-call sequencing (one MCP call at a time with `sleep 2`), `bulk_*` variants only when ≥10-page lists where Scrapling's own pacing kicks in. Documented honestly.

**PRECISION (Important, fixed inline):** Dedupe key normalization undefined. Fixed: lowercase + strip + Unicode NFC normalize before key formation (handles José/José, JOSE/jose, trailing whitespace).

**PRECISION (Important, fixed inline):** CSV format unspecified. Fixed: UTF-8 no BOM, comma delimiter, RFC 4180 quoting via `csv.QUOTE_MINIMAL`, header row, ISO8601 UTC with `Z` suffix.

**EDGE CASE (Important, fixed inline):** Zero candidates / all fetchers blocked / `--max` no ceiling / regex malformed / CSV path collision — all addressed in Task 1's Failure modes + Arguments specs.

**CONTRADICTION (Important, fixed inline):** Catalog row's "investor outreach" use case conflicted with the SKILL.md anti-trigger about email-deliverability needs. Fixed: dropped "investor outreach" from catalog row.

**SIMPLER ALTERNATIVE (Deferred, not adopted):** Stress test suggested Task 5 (smoke test) be a post-condition note rather than a plan task. Decision: KEEP as plan task — Santiago explicitly asked for proof the hybrid workflow works on a real target. Designated target + explicit PASS criteria addresses the environment-dependency concern.

## Verification

After all tasks: `/lead-hunt` appears in `/help` or skill autocomplete; running with `--max 3` against the AMHPAC member directory used in Task 5's smoke test produces a CSV with rows scored per the inline rubric; runbook `.iago/_config/runbooks/lead-hunt.md` is referenced from the SKILL.md body and from the catalog row; `eval.md` passes its own pass criteria (every test case routes to its expected skill with no ties).
