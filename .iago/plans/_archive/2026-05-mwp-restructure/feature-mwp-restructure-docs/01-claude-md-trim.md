---
phase: feature-mwp-restructure-docs
plan: 01
wave: 1
depends_on: []
context: .iago/research/2026-05-25-mwp-restructure-audit.md
created: 2026-05-25
source: feature
---

# Plan: feature-mwp-restructure-docs/01-claude-md-trim

## Goal

Trim root `CLAUDE.md` from 215 lines to ≤80, embed the long-pending `## Doc routing` section from `docs/specs/iago-os-mwp-routing-rule.md` (drop-in spec written 2026-05-04, never executed), extract Tech Stack / Output Style / Memory Architecture into `.claude/rules/*.md`, and slim `README.md` to public-facing only (~220 lines). Closes the "Layer 0 bloat" finding from audit §3 (CLAUDE.md mixes all 5 MWP layers) and the duplication of skill catalog / workflow content across CLAUDE.md / README.md / `.claude/rules/available-skills.md`.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `.claude/rules/stack.md` | Tech Stack rule extracted from CLAUDE.md lines 12-19 |
| create | `.claude/rules/output-style.md` | Orchestrator output style extracted from CLAUDE.md lines 191-208 |
| create | `.claude/rules/memory.md` | Memory Architecture extracted from CLAUDE.md lines 96-132 |
| modify | `CLAUDE.md` | Add `## Doc routing` section between `## Architecture` and `## Workflow`; remove extracted sections; replace deleted content with 1-line pointers to rule files; trim to ≤80 lines |
| modify | `README.md` | Drop internal workflow / pipeline / agent-architecture content that duplicates CLAUDE.md or `.claude/rules/`; keep public-facing install + tech stack + ecosystem links only; trim to ≤220 lines |
| modify | `.claude/rules/available-skills.md` | Update self-reference text if any line points at the just-removed CLAUDE.md skill catalog |

## Tasks

### Task 1: Extract Tech Stack into `.claude/rules/stack.md`

- **files:** `.claude/rules/stack.md`, `CLAUDE.md` (read-only for source)
- **action:** Read CLAUDE.md lines 12-19 (the `## Tech Stack` section with bullets for Frontend / Backend / Agents / Testing / Tooling / Infra). Create `.claude/rules/stack.md` with: a top frontmatter block `---\nname: stack\ndescription: Authoritative tech stack — frontend, backend, agents, testing, tooling, infra. No alternatives.\n---`, then a `# Tech Stack` heading, then the bullets verbatim from CLAUDE.md. Add one sentence at top: "Stack fixed — no alternatives unless explicitly asked."
- **verify:** `wc -l .claude/rules/stack.md && grep -c "^-" .claude/rules/stack.md`
- **expected:** file is ≤15 lines; at least 6 bullet lines (one per stack layer)

### Task 2: Extract Output Style into `.claude/rules/output-style.md`

- **files:** `.claude/rules/output-style.md`, `CLAUDE.md` (read-only)
- **action:** Read CLAUDE.md lines 191-208 (`## Output Style (orchestrator sessions)`). Create `.claude/rules/output-style.md` with frontmatter `---\nname: output-style\ndescription: Orchestrator session response style — terse by default, full prose for security/irreversible/multi-step warnings.\n---` then the section content verbatim with `## Output Style` heading. Preserve the "drop / pattern / not-yes" examples and the "Pipeline agents excluded" line at end.
- **verify:** `wc -l .claude/rules/output-style.md && grep -c "Pipeline agents excluded" .claude/rules/output-style.md`
- **expected:** file is ≤30 lines; exclusion line present

### Task 3: Extract Memory Architecture into `.claude/rules/memory.md`

- **files:** `.claude/rules/memory.md`, `CLAUDE.md` (read-only)
- **action:** Read CLAUDE.md lines 96-132 (`## Memory Architecture` including 6-layer table, Retrieval Routing table, MemPalace Wings subsection, Frozen-snapshot rule). Create `.claude/rules/memory.md` with frontmatter `---\nname: memory\ndescription: Six-layer memory architecture — MEMORY.md, Obsidian, Graphify, MemPalace, MarkItDown, SQLite. Retrieval routing + frozen-snapshot rule for MEMORY.md.\n---` then the content with `# Memory Architecture` top heading. Preserve both tables and the Frozen-snapshot rule verbatim (the rule is load-bearing — see CLAUDE.md memory feedback `feedback_memory_no_reread.md`).
- **verify:** `wc -l .claude/rules/memory.md && grep -c "Frozen-snapshot" .claude/rules/memory.md`
- **expected:** file is ≤60 lines; Frozen-snapshot rule heading present

### Task 4: Add `## Doc routing` section to CLAUDE.md

- **files:** `CLAUDE.md`, `docs/specs/iago-os-mwp-routing-rule.md` (read-only source)
- **action:** Read `docs/specs/iago-os-mwp-routing-rule.md` **lines 41-63** (the INNER markdown content, NOT the wrapping ` ```markdown ` fence at line 40 nor the closing ` ``` ` at line 64). Insert lines 41-63 verbatim into `CLAUDE.md` immediately after the `## Architecture` section and before the `## Workflow` section (per spec acceptance criterion #2 — primes doc-creation reasoning before workflow steps fire). **Critical:** strip the outer code-fence delimiters; the `## Doc routing` heading at spec line 41 must appear as a top-level heading in CLAUDE.md, NOT nested inside a code block. **Note for Phase 3:** the inserted table references flat `.iago/{plans,summaries,context,runbooks,learnings}/` paths; Phase 3 (code restructure) will move these to `.iago/product/*` and `.iago/_config/*`. Add an inline HTML comment after the table: `<!-- paths reflect Phase 1 (Wave 1 docs) layout; update after feature-mwp-restructure-code/01 physical split ships -->`.
- **verify:** `grep -n "^## Doc routing" CLAUDE.md && grep -c "feature-{slug}" CLAUDE.md && ! grep -B1 "^## Doc routing" CLAUDE.md | grep -q '```'`
- **expected:** one match for `## Doc routing` heading; at least one line referencing the feature-plan path pattern; heading is NOT preceded by a code fence (confirms fence-stripped)

### Task 5: Trim CLAUDE.md to ≤70 lines (10-line headroom reserved for Plan 04 `## Workspace map` append)

- **files:** `CLAUDE.md`
- **action:** Remove the now-extracted sections (`## Tech Stack`, `## Output Style (orchestrator sessions)`, `## Memory Architecture` and its sub-sections including `### Retrieval Routing` and `### MemPalace Wings` and `### Frozen-snapshot rule`). For each removed section, leave a one-line pointer in the `## Rules` section near line 165: e.g., `- stack.md — tech stack (frontend/backend/agents/testing/tooling/infra)`, `- output-style.md — orchestrator response style (terse by default)`, `- memory.md — six-layer memory + retrieval routing + frozen-snapshot rule`. Also remove the `## Skills` section (178-186) entirely — `.claude/rules/available-skills.md` is the authoritative catalog and `## Rules` already points at it. Also compress `## Code Standards` (lines 22-32, 11 lines) to a 1-line pointer in `## Rules`: `- (code standards: see react-vite.md, aws-amplify.md, tdd.md, mcp-server-patterns.md path-scoped rules)` — all 11 bullets are duplicated in those path-scoped files. Per-section post-trim budget (must hit ≤70 total): header+prereq=4, Architecture=5, Doc routing (from Task 4)=22, Workflow=4, Execution Path table=8, Review Pipeline (pointer-only to execution-pipeline.md)=3, Verification=2, Search First=2, Agent Escalation=4, Execution Discipline=5, Rules (with new 5 pointers)=8, Agents=3. Total ≈ 70. If over, compress Doc routing's heuristic paragraph to 1 sentence (saves 2-3 lines). Strict ceiling ≤70 — Plan 04 needs the headroom.
- **verify:** `wc -l CLAUDE.md`
- **expected:** value is ≤70

### Task 6: Trim README.md to public-facing only

- **files:** `README.md`
- **action:** Remove or compress internal-workflow sections that duplicate CLAUDE.md or `.claude/rules/`: `## Working on the OS itself` (lines 129-146), `## Choosing the right mode` (147-159), `## The delivery pipeline` (160-214), `## Agent architecture` (215-322 — point at `.claude/rules/available-skills.md` instead with a 5-line summary), `## Memory stack (optional)` (324-343 — replace with 3-line pointer to `.claude/rules/memory.md`). Keep: project intro, `## What this is`, `## The 5 layers` (MWP-aligned, retains educational value), `## Quick start`, `## Folder structure` (REWRITE to match audit §1 target structure — top-level only, 20 lines max), `## Prerequisites`, `## Tech stack` (point at stack.md), `## Built on`, `## Documentation`, `## License`. Target ≤220 lines.
- **verify:** `wc -l README.md`
- **expected:** value is ≤220

### Task 7: Verify acceptance criteria + cross-reference integrity

- **files:** (verification only — read multiple paths)
- **action:** Run a verification sweep: (a) `wc -l CLAUDE.md README.md .claude/rules/stack.md .claude/rules/output-style.md .claude/rules/memory.md` — confirm sizes match targets; (b) `grep -rn "Tech Stack\|Output Style\|Memory Architecture" CLAUDE.md` returns only the 1-line pointers in `## Rules`, not the full sections; (c) `grep -n "^## " CLAUDE.md` outputs the trimmed section list with `## Doc routing` between Architecture and Workflow; (d) `grep -rn "scripts/review-checks\|\.iago/plans\|\.iago/summaries" CLAUDE.md README.md` — capture any path references for awareness (none should be moved by this plan; capture for audit trail to confirm the code folder doesn't break them); (e) confirm no `## Skills` heading remains in CLAUDE.md.
- **verify:** `wc -l CLAUDE.md && grep -c "^## " CLAUDE.md && ! grep -q "^## Skills" CLAUDE.md`
- **expected:** CLAUDE.md is ≤70 lines (≤80 hard ceiling after Plan 04 appends Workspace map); section count is 13-15; no `## Skills` heading present

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-25
**Reviewer:** analyst (opus, read-only)

### Critical (fixed in this plan revision)
- **Task 4 fence-stripping ambiguity** — original instruction said "insert lines 40-63" which includes the ` ```markdown ` and ` ``` ` code-fence delimiters; implementer would have embedded a code block instead of a top-level heading. **Fixed:** Task 4 now explicitly says "lines 41-63 (inner content)" and verify includes `! awk '...' | grep -q '```'` check.
- **Task 5 missing per-section budget** — original "target ≤80 lines" had no breakdown; implementer would have hit the cap by guessing. **Fixed:** Task 5 now lists exact per-section line allocations summing to ≈70; budget revised to ≤70 (was ≤80) to reserve 10-line headroom for Plan 04's `## Workspace map` append (resolves Plan 04's structural line-budget collision).
- **`## Code Standards` not listed in keep/remove** — implementer would have guessed. **Fixed:** Task 5 explicitly compresses Code Standards to a 1-line pointer (all 11 bullets duplicate path-scoped `.claude/rules/{react-vite,aws-amplify,tdd,mcp-server-patterns}.md`).

### Important (acknowledged, implementer must heed)
- **Doc routing table embeds Phase-1 paths that will be stale post-Phase-3.** Mitigation: Task 4 instructs adding HTML comment marking this for the Phase-3 implementer to update. Not blocking; comment is the signal.
- **Task 6 `## Folder structure` README rewrite scope is current-state, not target-state.** The audit §1 target structure does NOT exist until Phase-3 (code restructure) ships. Task 6 instruction stands: rewrite to match CURRENT pre-Phase-3 layout; a future README update will reflect Phase-3 outcome. README is public-facing; describing a future structure misleads external readers.

### Minor (informational)
- Tasks 1-3 are independent file-creates and could parallelize. Implementation may run them in any order; verifications stand.
- Original line ranges (12-19 for Tech Stack, 191-208 for Output Style, 96-132 for Memory Architecture) confirmed accurate against current CLAUDE.md.

## Verification

After all 7 tasks complete:

```bash
wc -l CLAUDE.md                                              # ≤ 70 (Plan 01 target; Plan 04 will append up to 10 lines → final ≤ 80)
wc -l README.md                                              # ≤ 220
test -f .claude/rules/stack.md                               # exit 0
test -f .claude/rules/output-style.md                        # exit 0
test -f .claude/rules/memory.md                              # exit 0
grep -q "^## Doc routing" CLAUDE.md                          # exit 0
! grep -q "^## Skills$" CLAUDE.md                            # exit 0 (no Skills section)
! grep -q "^## Tech Stack$" CLAUDE.md                        # exit 0
! grep -q "^## Output Style" CLAUDE.md                       # exit 0
! grep -q "^## Memory Architecture$" CLAUDE.md               # exit 0
grep -q "stack.md" CLAUDE.md                                 # exit 0 (pointer exists)
grep -q "memory.md" CLAUDE.md                                # exit 0
grep -q "output-style.md" CLAUDE.md                          # exit 0
```

All commands exit 0. Pipeline still runs: `bash -n scripts/execute-pipeline.sh` parses clean. Hooks still fire on any test edit.
