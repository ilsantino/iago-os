---
phase: feature-mwp-restructure-docs
plan: 03
wave: 3
depends_on: [01, 02]
context: .iago/research/2026-05-25-mwp-restructure-audit.md
created: 2026-05-25
source: feature
---

# Plan: feature-mwp-restructure-docs/03-roadmap-and-project-md

## Goal

Close the long-standing gap (audit §6 + §3.9): `templates/internal-project/.iago/` provides `PROJECT.md.template` and `ROADMAP.md.template`, but iago-os was never bootstrapped from its own template — neither file exists in the live `.iago/`. Source canonical content from `docs/specs/iago-os-roadmap.md` (308 lines) for ROADMAP and combine STATE.md + template scaffold for PROJECT. Then move 3 active specs (v2-vision, v2-master-prompt, sentry-integration) to `.iago/_config/specs/`; archive 7 shipped/superseded specs to `.iago/_archive/specs/2026-04-historical/`. After this plan: `docs/specs/` is empty and can be removed; `docs/` directory itself becomes a removal candidate (handled inline at end).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `.iago/_config/specs/` (dir) | new home for active specs |
| create | `.iago/ROADMAP.md` | canonical roadmap (sourced from docs/specs/iago-os-roadmap.md) |
| create | `.iago/PROJECT.md` | project context (scaffolded from template + STATE.md) |
| move | `docs/specs/iago-os-v2-vision.md` → `.iago/_config/specs/v2-vision.md` | active spec (525 L, last revised 2026-05-15) |
| move | `docs/specs/iago-os-v2-master-prompt.md` → `.iago/_config/specs/v2-master-prompt.md` | active spec (456 L) |
| move | `docs/specs/sentry-integration.md` → `.iago/_config/specs/sentry-integration.md` | active spec (336 L, revised 2026-05-20) |
| move | `docs/specs/iago-os-vision.md` → `.iago/_archive/specs/2026-04-historical/` | superseded by v2-vision |
| move | `docs/specs/iago-os-cleanup.md` → `.iago/_archive/specs/2026-04-historical/` | shipped PR #31 |
| move | `docs/specs/markitdown-integration.md` → `.iago/_archive/specs/2026-04-historical/` | shipped |
| move | `docs/specs/parallel-execution-wedges.md` → `.iago/_archive/specs/2026-04-historical/` | shipped |
| move | `docs/specs/hermes-agent-adoption.md` → `.iago/_archive/specs/2026-04-historical/` | absorbed into v2-vision |
| move | `docs/specs/iago-os-mwp-routing-rule.md` → `.iago/_archive/specs/2026-04-historical/` | content embedded in CLAUDE.md by Plan 01 |
| move | `docs/specs/feature-tool-surveillance.md` → `.iago/_archive/specs/2026-04-historical/` | shipped per STATE.md |
| move | `docs/specs/iago-os-roadmap.md` → `.iago/_archive/specs/2026-04-historical/` | superseded by .iago/ROADMAP.md created here |
| delete | `docs/specs/` (dir) | empty after all moves |
| delete | `docs/` (dir) | empty after Plan 02 + this plan |

## Tasks

### Task 1: Create `.iago/_config/specs/` directory

- **files:** `.iago/_config/specs/`
- **action:** `mkdir -p .iago/_config/specs`. Confirm `.iago/_archive/specs/2026-04-historical/` exists (created by Plan 02 Task 2 — this plan depends on Plan 02 indirectly through that directory existing; if running standalone, fall back to `mkdir -p .iago/_archive/specs/2026-04-historical`).
- **verify:** `test -d .iago/_config/specs && test -d .iago/_archive/specs/2026-04-historical`
- **expected:** both dirs exist, exit 0

### Task 2: Create `.iago/ROADMAP.md` from `docs/specs/iago-os-roadmap.md`

- **files:** `.iago/ROADMAP.md`, `docs/specs/iago-os-roadmap.md` (source, read-only here)
- **action:** Read `docs/specs/iago-os-roadmap.md` (308 lines). Copy content to `.iago/ROADMAP.md` with: (a) header section adapted — change reference paths inside content from `docs/specs/...` to `.iago/_config/specs/...` for any spec link that survives in `.iago/_config/specs/`; (b) update reference paths from `docs/specs/iago-os-vision.md` to `.iago/_archive/specs/2026-04-historical/iago-os-vision.md`; (c) add a frontmatter block at top: `---\nname: iago-os-roadmap\ndescription: Canonical roadmap for iaGO-OS — phases, success criteria, dependencies.\nupdated: 2026-05-25\nsource: derived from docs/specs/iago-os-roadmap.md (now archived)\n---`; (d) keep all phase definitions, success criteria, and sequencing rationale intact. Add a top-of-file note: "**This is the canonical ROADMAP.** Previous home `docs/specs/iago-os-roadmap.md` moved to `.iago/_archive/specs/2026-04-historical/` in plan feature-mwp-restructure-docs/03."
- **verify:** `test -f .iago/ROADMAP.md && wc -l .iago/ROADMAP.md && grep -c "^#" .iago/ROADMAP.md`
- **expected:** file exists; line count 300-320 (matches source ±10 for header changes); at least 8 headings preserved

### Task 3: Scaffold `.iago/PROJECT.md` from template + STATE.md

- **files:** `.iago/PROJECT.md`, `templates/internal-project/.iago/PROJECT.md.template` (read-only), `.iago/STATE.md` (read-only)
- **action:** Read `templates/internal-project/.iago/PROJECT.md.template`. Read current `.iago/STATE.md` (for current phase + tag + recent activity). Create `.iago/PROJECT.md` filling the template with iago-os-specific content: (a) Project name: iaGO-OS; (b) Vision: "Claude Code config layer for multi-client AI delivery + v2 multi-agent OS on VPS, Telegram-controlled"; (c) Stack: pointer to `.claude/rules/stack.md`; (d) Architecture: pointer to `.iago/_config/specs/v2-vision.md` for v2 daemon (this plan creates that path); (e) Constraints: pointer to root `CLAUDE.md` and `.claude/rules/`; (f) Current phase: copy from STATE.md header (`v2-phase-2-vps-bootstrap`); (g) Decision log: pointer to **`.iago/decisions/` (current path)**. Add inline note: "(decisions/ migrates to .iago/_config/decisions/ when feature-mwp-restructure-code/01 ships — this plan does NOT migrate decisions/.)". Stress-test correction: use the CURRENT decisions/ path, not the future _config/decisions/ path, to avoid a stale pointer until the code folder lands (which may be weeks away). Keep file ≤120 lines. Avoid duplicating ROADMAP.md content; PROJECT.md is vision/context, ROADMAP.md is phasing.
- **verify:** `test -f .iago/PROJECT.md && wc -l .iago/PROJECT.md`
- **expected:** file exists; ≤120 lines

### Task 4: Move 3 active specs to `.iago/_config/specs/` (354 live cross-refs — read policy below)

- **files:** `docs/specs/iago-os-v2-vision.md`, `docs/specs/iago-os-v2-master-prompt.md`, `docs/specs/sentry-integration.md`
- **action:** `git mv docs/specs/iago-os-v2-vision.md .iago/_config/specs/v2-vision.md`; `git mv docs/specs/iago-os-v2-master-prompt.md .iago/_config/specs/v2-master-prompt.md`; `git mv docs/specs/sentry-integration.md .iago/_config/specs/sentry-integration.md`. **Stress-test correction:** these 3 specs are referenced in **~354 places** across `.md` files (not just runtime/CONTEXT.md + .iago/CONTEXT.md as originally claimed). Reference hotspots: `.iago/CONTEXT.md`, `.iago/decisions/` (2 ADRs), `.iago/plans/feature-v2-phase-1-daemon/*.md` (7 plans), `.iago/plans/feature-phase-2-vps-bootstrap/*.md` (~7 plans), `runtime/CONTEXT.md`, `.iago/research/*.md` (multiple), `.iago/prompts/`, `.iago/summaries/`, `.claude/rules/aws-amplify.md`, multiple SKILL.md files. **Policy for in-flight plans (`.iago/plans/feature-v2-*/`, `.iago/plans/feature-phase-2-*/`):** update path STRINGS but do NOT alter task INTENT, verify COMMANDS, or expected output. Plan task bodies are historical execution contracts; the path-update is mechanical text substitution only. **Policy for completed/archived plans (`.iago/plans/_archive/*`, `docs/archive/*`):** leave path strings as-is — those are historical records of what the plan looked like at execution time. Sweep with: `grep -rln "docs/specs/iago-os-v2-vision\|docs/specs/iago-os-v2-master-prompt\|docs/specs/sentry-integration" --include="*.md" --exclude-dir=_archive --exclude-dir=.worktrees .` then `sed -i` over each result.
- **verify:** `test -f .iago/_config/specs/v2-vision.md && test -f .iago/_config/specs/v2-master-prompt.md && test -f .iago/_config/specs/sentry-integration.md && ! grep -rln "docs/specs/iago-os-v2-vision\|docs/specs/iago-os-v2-master-prompt\|docs/specs/sentry-integration" --include="*.md" --exclude-dir=_archive --exclude-dir=.worktrees .`
- **expected:** all 3 new files exist; zero live references (archived references and worktree copies excluded — they represent historical state)

### Task 5: Archive 7 shipped/superseded specs

- **files:** `docs/specs/iago-os-vision.md`, `docs/specs/iago-os-cleanup.md`, `docs/specs/markitdown-integration.md`, `docs/specs/parallel-execution-wedges.md`, `docs/specs/hermes-agent-adoption.md`, `docs/specs/iago-os-mwp-routing-rule.md`, `docs/specs/feature-tool-surveillance.md`
- **action:** `git mv` each to `.iago/_archive/specs/2026-04-historical/` preserving filename. For each archived file, prepend a header note (using a temp file + cat pattern, no Edit on a moved file): `> **Archived 2026-05-25** by feature-mwp-restructure-docs/03. Original path: docs/specs/{filename}. Reason: {reason}.` where {reason} is: iago-os-vision = "superseded by v2-vision"; iago-os-cleanup = "shipped PR #31"; markitdown-integration = "shipped"; parallel-execution-wedges = "shipped Phase 1b"; hermes-agent-adoption = "absorbed into v2-vision §AgentRuntime"; iago-os-mwp-routing-rule = "content embedded in root CLAUDE.md by Plan 01"; feature-tool-surveillance = "shipped per STATE.md".
- **verify:** `ls .iago/_archive/specs/2026-04-historical/*.md | wc -l`
- **expected:** value is **at least 7** (these 7 specs from Plan 03 PLUS the 2 specs from Plan 02 Task 2 = 9 expected total; stress-test correction — Plan 02 also populates this dir, so use `>= 7` not `== 7`)

### Task 6: Archive `docs/specs/iago-os-roadmap.md`

- **files:** `docs/specs/iago-os-roadmap.md`
- **action:** `git mv docs/specs/iago-os-roadmap.md .iago/_archive/specs/2026-04-historical/iago-os-roadmap.md`. Prepend header: `> **Archived 2026-05-25** by feature-mwp-restructure-docs/03. Canonical roadmap is now .iago/ROADMAP.md (created Plan 03 Task 2). Original path: docs/specs/iago-os-roadmap.md.`. Sweep cross-references and update to `.iago/ROADMAP.md` for any live citations; archived references (e.g., in `.iago/_archive/`) can keep the old path since they are themselves archived context.
- **verify:** `! test -f docs/specs/iago-os-roadmap.md && test -f .iago/_archive/specs/2026-04-historical/iago-os-roadmap.md && ! grep -rln "docs/specs/iago-os-roadmap" --include="*.md" --exclude-dir=_archive --exclude-dir=.worktrees .`
- **expected:** old path gone; archived file exists; zero live references (archived references AND worktree copies excluded — both are historical state)

### Task 7: Delete empty `docs/specs/` and `docs/` directories

- **files:** `docs/specs/`, `docs/`
- **action:** `ls docs/specs/` must be empty (all 11 specs moved by Tasks 4-6). Then `rmdir docs/specs`. Then `ls docs/` — if empty (Plan 02 deleted all root MDs and removed subdirs `archive/`, `research/`, `automations/`, `patterns/`), `rmdir docs`. If `docs/` still has content (e.g., Plan 02 left ARCHITECTURE.md as `.iago/_config/architecture.md`, in which case docs/ is empty), proceed with rmdir. If anything unexpected remains, STOP and report (do not `rm -rf`).
- **verify:** `! test -d docs/specs && (! test -d docs || ! test -e docs/)`
- **expected:** docs/specs gone; docs gone or only contains whatever Plan 02 explicitly preserved (none expected)

### Task 8: Verify all references resolve + STATE.md update awareness

- **files:** (verification only — read multiple paths)
- **action:** Run cross-reference sweep: `grep -rln "docs/specs/" --include="*.md" --exclude-dir=_archive .` should return zero hits (every live reference updated). `grep -rln "docs/" --include="*.md" --exclude-dir=_archive --exclude-dir=node_modules --exclude-dir=.iago .` may return some hits from files outside this plan's scope (e.g., README.md `## Documentation` section); audit each remaining hit and confirm it's intentional (e.g., README still pointing readers at `.iago/_archive/` or `.iago/_config/` is OK). Test that root `.iago/ROADMAP.md` and `.iago/PROJECT.md` exist and are non-empty. Confirm hooks and scripts unaffected: `bash -n scripts/execute-pipeline.sh` parses clean.
- **verify:** `test -f .iago/ROADMAP.md && test -f .iago/PROJECT.md && [ "$(wc -l < .iago/ROADMAP.md)" -gt "200" ] && [ "$(wc -l < .iago/PROJECT.md)" -gt "30" ] && ! grep -rln "docs/specs/" --include="*.md" --exclude-dir=_archive --exclude-dir=.worktrees .`
- **expected:** ROADMAP.md and PROJECT.md exist with substantive content; zero live references to docs/specs/ (archive + worktrees excluded)

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-25
**Reviewer:** analyst (opus, read-only)

### Critical (all fixed in this plan revision)
- **C-1: wave-2 parallel race with Plan 02 confirmed.** Original frontmatter declared `depends_on: [01]` but Task 1 needed `.iago/_archive/specs/2026-04-historical/` which Plan 02 Task 2 creates; Task 5 verify `== 7` would fail if Plan 02 also added 2 specs there (true — Plan 02 archives docs/archive/specs/* there, adding 2). **Fixed:** frontmatter now `depends_on: [01, 02]`, wave `2 → 3` (sequential after Plan 02); Task 5 expected now ≥7 (matches final verification block's `≥ 7`).
- **C-2: 354 live cross-refs to moving specs, not 2 as originally claimed.** Spec references live in in-flight plans (`feature-v2-*`, `feature-phase-2-*`), runbooks, decisions, summaries — updating in-flight plan files mid-execution is a semantic hazard. **Fixed:** Task 4 now has explicit policy: update path STRINGS in live plan files (mechanical text sub), do NOT alter task intent/verify/expected; leave archived plans' references as historical record.

### Important (fixed in this plan revision)
- **I-1: intra-plan order — ROADMAP.md content rewritten to point at iago-os-vision.md's archived path before Task 5 archives it.** Acknowledged in Task 2 instruction; archival happens in same PR so dangling-reference window is hours, not weeks. No fix needed beyond awareness.
- **I-2: `.worktrees/` not excluded from grep.** **Fixed:** all grep verify commands (Tasks 6, 8) now `--exclude-dir=_archive --exclude-dir=.worktrees`.
- **I-5: PROJECT.md decision-log path ambiguity.** **Fixed:** Task 3 now explicitly uses CURRENT `.iago/decisions/` path with inline note that it migrates to `_config/decisions/` when feature-mwp-restructure-code/01 ships. Avoids stale pointer until code folder lands.

### Minor (informational)
- m-1: line count "300-320" is fragile; documented as targeting source intact (308 + 7 line frontmatter overhead = 315).
- m-2: Task 5 doesn't verify archive headers were prepended (only count). Documented.
- m-3: ROADMAP.md `iago-os-vision.md` reference appears at 3 lines (3, 294, 301) — Task 2 (b) "rewrites references" covers all three; implementer should enumerate.

## Verification

After all 8 tasks complete:

```bash
test -f .iago/ROADMAP.md                                                          # exit 0
test -f .iago/PROJECT.md                                                          # exit 0
test -d .iago/_config/specs                                                       # exit 0
ls .iago/_config/specs/*.md | wc -l                                               # 3 (v2-vision, v2-master-prompt, sentry-integration)
ls .iago/_archive/specs/2026-04-historical/*.md | wc -l                           # ≥ 7 (this plan) + however many Plan 02 added
! test -d docs/specs                                                              # exit 0
(! test -d docs) || [ -z "$(ls -A docs)" ]                                        # exit 0 (docs gone or empty)
! grep -rln "docs/specs/" --include="*.md" --exclude-dir=_archive --exclude-dir=.worktrees .  # exit 0 (no live refs; archive + worktree historical refs excluded)
bash -n scripts/execute-pipeline.sh                                               # exit 0 (pipeline still parses)
```

All commands exit as expected.
