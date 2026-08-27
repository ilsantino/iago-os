---
phase: feature-mwp-restructure-docs
plan: 04
wave: 2
depends_on: [01]
context: .iago/research/2026-05-25-mwp-restructure-audit.md
created: 2026-05-25
source: feature
---

# Plan: feature-mwp-restructure-docs/04-runtime-claude-md

## Goal

Register `runtime/` as a Level B sub-workspace per audit §1.6 + §10.5 Q2. `runtime/` already has its own `CONTEXT.md` (L2 stage contract) and is internally MWP-shaped. What's missing: a Layer 0 declaration (`runtime/CLAUDE.md`) that tells Claude Code "you are in a sub-workspace; here's where things live; the root workspace is at `../`". Also explicitly document the `mcp-servers/` keep-at-top-level decision (audit §10.5 Q2 = NO move) in the root workspace map. Smallest plan in this folder (5 tasks).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/CLAUDE.md` | Layer 0 sub-workspace declaration (~30 lines) |
| modify | `.iago/CONTEXT.md` | add Level B sub-workspace registry table (`runtime/`, `mcp-servers/`); note Layer-B convention |
| modify | `CLAUDE.md` (root) | append `## Workspace map` section listing root + sub-workspaces (built on Plan 01's trim) |
| create (optional) | `mcp-servers/CLAUDE.md` | document mcp-servers/ as known top-level Python project; ~15 lines |

## Tasks

### Task 1: Verify Plan 01 shipped + CLAUDE.md has reserved headroom

- **files:** `CLAUDE.md`
- **action:** Check `wc -l CLAUDE.md` ≤ **70** (Plan 01's revised acceptance, set to ≤70 specifically to reserve 10-line headroom for this plan's `## Workspace map` append). If CLAUDE.md is over 70 lines, STOP — Plan 01 either hasn't merged or didn't hit the trim target. Plan 04 cannot satisfy its own ≤80 final ceiling without that headroom (stress-test finding: the original ≤80 + ≤10 append = ≤90 is structurally guaranteed to fail).
- **verify:** `[ "$(wc -l < CLAUDE.md)" -le "70" ]`
- **expected:** exit 0 (CLAUDE.md is ≤70 lines from Plan 01's revised trim)

### Task 2: Create `runtime/CLAUDE.md` Layer 0 declaration (with pre-flight v2-vision path detection)

- **files:** `runtime/CLAUDE.md`
- **action:** **Pre-flight path detection** (stress-test fix — avoid silently writing a dead L3 reference): run `if test -f .iago/_config/specs/v2-vision.md; then V2_VISION_PATH="../.iago/_config/specs/v2-vision.md"; elif test -f docs/specs/iago-os-v2-vision.md; then V2_VISION_PATH="../docs/specs/iago-os-v2-vision.md"; else echo "ERROR: v2-vision spec not found at either path" && exit 1; fi`. Use `$V2_VISION_PATH` in the file content. Write `runtime/CLAUDE.md` (~30 lines). Content: title `# runtime/ — iaGO-OS v2 Daemon Sub-Workspace`. Paragraph: "This is a Level B MWP sub-workspace inside the iaGO-OS repo. The root workspace is at `../`. Open root `CLAUDE.md` for global iaGO-OS rules; this file scopes context to v2 daemon work only." Then `## Layer routing` table: L0 = `runtime/CLAUDE.md` (this file), L1 = `../.iago/CONTEXT.md` (workspace routing — runtime/ registered as Level B sub-workspace there), L2 = `runtime/CONTEXT.md` (v2 daemon stage contract: Inputs/Process/Outputs), L3 = `$V2_VISION_PATH` (active spec — uses detected path), L4 = `runtime/migration/`, `runtime/agents/`, `runtime/daemon/`, `runtime/deploy/` (per-phase product). Then `## When working in this sub-workspace`: 3 rules — (1) plans at `../.iago/plans/feature-v2-*` and `feature-phase-*`, not under runtime/; (2) summaries at `../.iago/summaries/`; (3) v2 build follows root CLAUDE.md execution-pipeline rules unchanged. Then `## Status`: 1 line referencing `runtime/PHASE-1-EVIDENCE.md` and `../.iago/STATE.md`.
- **verify:** `test -f runtime/CLAUDE.md && wc -l runtime/CLAUDE.md && grep -E "(\.\./\.iago/_config/specs/v2-vision\.md|\.\./docs/specs/iago-os-v2-vision\.md)" runtime/CLAUDE.md`
- **expected:** file exists; 20-40 lines; contains a valid v2-vision reference (either current or post-Plan-03 path — whichever existed at write time)

### Task 3: Register `runtime/` and `mcp-servers/` in `.iago/CONTEXT.md`

- **files:** `.iago/CONTEXT.md`
- **action:** Add a new section `## Level B sub-workspaces` to `.iago/CONTEXT.md` (after the existing `## Layer assignments` section). Content: a table with columns `Path | Type | Layer 0 declaration | Layer 2 stage contract`. Rows: (a) `runtime/` | v2 daemon | `runtime/CLAUDE.md` | `runtime/CONTEXT.md`; (b) `mcp-servers/youtube-transcript/` | Python MCP server | `mcp-servers/CLAUDE.md` (created in Task 5) | own README.md (Python project, no separate stage contract needed); (c) `clients/{name}/` | per-client workspaces | future — feature-mwp-restructure-clients/ | per-client. Add one sentence above the table: "Level B sub-workspaces have their own `CLAUDE.md` declaring sub-workspace identity. The root iaGO-OS workspace is at the repo root; sub-workspaces inherit from it via the `../` path."
- **verify:** `grep -q "^## Level B sub-workspaces" .iago/CONTEXT.md && grep -q "runtime/CLAUDE.md" .iago/CONTEXT.md`
- **expected:** new section heading present; runtime reference present

### Task 4: Append `## Workspace map` to root CLAUDE.md (must fit in ≤10-line headroom)

- **files:** `CLAUDE.md`
- **action:** **Pre-flight headroom check (stress-test fix):** `HEADROOM=$((80 - $(wc -l < CLAUDE.md)))`. If `$HEADROOM < 5` STOP and report — Plan 01 over-trimmed allocation. Expected `$HEADROOM = 10` (Plan 01 trims to ≤70, ceiling is 80). Write the `## Workspace map` section to exactly `$HEADROOM` lines (or fewer). Append after the existing trimmed sections from Plan 01; before `## Model Routing` if present, otherwise at end. Target content (≤10 lines): heading + "This repo hosts the iaGO-OS meta-workspace + Level B sub-workspaces. See `.iago/CONTEXT.md` `## Level B sub-workspaces` for registry." + bullet list: "- `runtime/` — v2 daemon (own CLAUDE.md)" / "- `mcp-servers/youtube-transcript/` — Python MCP (top-level per audit §10.5 Q2 = KEEP; standalone project, own deps)" / "- `clients/{name}/` — per-client; some are inner git repos, never edit from iago-os PRs (see memory `feedback_inner_repo_check.md`)." Strict ceiling: final `wc -l CLAUDE.md` MUST be ≤80. **Do NOT silently trim Architecture or other sections to compensate** — if you cannot fit within `$HEADROOM`, STOP and report so Plan 01's budget can be revisited.
- **verify:** `grep -q "^## Workspace map" CLAUDE.md && [ "$(wc -l < CLAUDE.md)" -le "80" ] && grep -q "runtime/" CLAUDE.md && grep -q "mcp-servers" CLAUDE.md`
- **expected:** section present; CLAUDE.md ≤80 lines (hard ceiling); both sub-workspace examples mentioned

### Task 5: Create `mcp-servers/CLAUDE.md` (decision §10.5 Q2 resolved 2026-05-25 = KEEP top-level)

- **files:** `mcp-servers/CLAUDE.md`
- **action:** **Note on §10.5 Q2 status:** stress-test analyst flagged this as "unresolved." It IS resolved — Santiago approved "KEEP top-level" in conversation 2026-05-25 after reading the audit's §10.5 decision matrix. The audit phrases §10.5 as questions for legibility; all 7 received explicit approval. This task proceeds on KEEP. Write `mcp-servers/CLAUDE.md` (~15 lines). Content: title `# mcp-servers/ — MCP servers hosted in iaGO-OS`. Paragraph: "This directory holds standalone MCP servers built by iaGO-OS. Currently: `youtube-transcript/` (Python). MCP servers stay at the top level (not under `.claude/`) per audit §10.5 Q2 decision (2026-05-25): they are independent projects with own dependencies, tests, and registration semantics. The youtube-transcript MCP is registered globally via `~/.claude.json` — do not move it without re-registering." End with 2-line rule: "When adding a new MCP server: create `mcp-servers/{name}/` as its own project (own `package.json` or `pyproject.toml`, own tests). Register globally; iaGO-OS does not auto-load them."
- **verify:** `test -f mcp-servers/CLAUDE.md && wc -l mcp-servers/CLAUDE.md && grep -q "KEEP top-level" mcp-servers/CLAUDE.md`
- **expected:** file exists; 10-25 lines; explicit decision recorded

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-25
**Reviewer:** analyst (opus, read-only)

### Critical (fixed in this plan revision)
- **Line-budget collision was structurally guaranteed.** Original Task 4 appended ≤10 lines to an exactly-80-line CLAUDE.md (Plan 01's old budget) and offered an under-specified "trim Architecture by 1-2 lines" compensation. ≤80 + ≤10 = ≤90, always over budget. **Fixed:** Plan 01 budget revised to ≤70 (reserves 10-line headroom). Task 1 now verifies `wc -l ≤ 70` not ≤80. Task 4 now does pre-flight `$HEADROOM = 80 - $(wc -l)` calculation and explicitly forbids silent compensation trims of other sections — if headroom insufficient, STOP and report.

### Important (fixed in this plan revision)
- **Task 2 path-fallback was prose-only, no pre-condition check.** If Plan 03 had moved v2-vision.md but the implementer used the old path, runtime/CLAUDE.md would silently point at a dead L3 reference. **Fixed:** Task 2 now does explicit `if test -f ... else if test -f ... else exit 1` path detection before writing; verify confirms a valid v2-vision reference exists in the output.
- **§10.5 Q2 mcp-servers KEEP-vs-MOVE was "unresolved" per analyst — actually RESOLVED in conversation 2026-05-25.** **Fixed:** Task 5 explicitly notes the §10.5 decision provenance + "Santiago approved KEEP top-level"; verify checks the decision text is recorded in mcp-servers/CLAUDE.md (catches accidental MOVE drift in a re-run).

### Minor (informational)
- Task 2 verify is a range check (20-40 lines) not a content check; non-functional filler could pass. Implementer should write substantive content per the action description.
- Nested CLAUDE.md auto-load semantics (root + nested both load, not replace) confirmed per Anthropic memory docs. No edge case.
- `mcp-servers/CLAUDE.md` adds marginal value for single-server directory — minor over-engineering, but cheap to write and pays off when a second MCP server is added.

## Verification

After all 5 tasks complete:

```bash
test -f runtime/CLAUDE.md                                              # exit 0
test -f mcp-servers/CLAUDE.md                                          # exit 0
grep -q "Level B sub-workspaces" .iago/CONTEXT.md                      # exit 0
grep -q "^## Workspace map" CLAUDE.md                                  # exit 0
[ "$(wc -l < CLAUDE.md)" -le "80" ]                                    # exit 0 (Plan 01 ≤70 + this plan ≤10 = ≤80 hard ceiling)
grep -q "runtime/CLAUDE.md" .iago/CONTEXT.md                           # exit 0
grep -q "mcp-servers" CLAUDE.md                                        # exit 0 (workspace map mentions it)
grep -qE "v2-vision\.md" runtime/CLAUDE.md                             # exit 0 (Task 2 pre-flight resolved a valid path)
```

All commands exit as expected. No code paths touched; pipeline unaffected.
