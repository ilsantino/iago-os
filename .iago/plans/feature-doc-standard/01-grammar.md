---
phase: feature-doc-standard
plan: 01
wave: 1
depends_on: []
context: .iago/plans/feature-doc-standard/README.md
created: 2026-08-26
source: feature
---

# Plan: feature-doc-standard/01-grammar

## Goal

Write the workspace grammar down once — as an auto-loading path-scoped rule, as the scaffolding templates, and as a linter that can check it — so P3 (root cleanse) and P4 (clients) have a machine-checkable target instead of a prose intention. No files move in this plan; it only creates the standard and the tool that measures conformance.

The standard is defined in `.iago/plans/feature-doc-standard/README.md` §1–§7. That README is the source of truth: copy its schema, its banned list and its lifecycle table verbatim rather than paraphrasing.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `.claude/rules/iago-workspace.md` | The rule; path-scoped, auto-loads on `.iago/`, `docs/`, `CLAUDE.md` edits |
| modify | `.iago/CONTEXT.md` | Reduce to true L1 routing + the 7-client registry; drop the competing doc-routing table |
| delete | `.iago/README.md` | Third competing routing table; `CONTEXT.md` is the entry point |
| modify | `.claude/rules/execution-pipeline.md` | `.iago/config` → `.iago/config.json` (the referenced file does not exist) |
| modify | `.iago/_config/runbooks/file-naming-standard.md` | §2 CODE zone points at this standard instead of only saying "frozen" |
| modify | `templates/client-project/.iago/**` | Scaffold the §2 schema so `/iago-init` produces conforming trees |
| modify | `templates/internal-project/.iago/**` | Same |
| create | `scripts/organize/test-iago-lint.py` | Test suite, written first (RED) |
| create | `scripts/organize/iago-lint.py` | The linter |
| move | `.iago/plans/feature-mwp-restructure-{docs,clients,code}/` | → `.iago/plans/_archive/2026-05-mwp-restructure/` |

## Tasks

### Task 1: Write the workspace rule
- **files:** `.claude/rules/iago-workspace.md`
- **action:** Create the rule with YAML frontmatter `paths: ["**/.iago/**", "**/docs/**", "**/CLAUDE.md"]`, then the §2 `.iago/` tree, the "banned at `.iago/` root" mapping table, the §3 `docs/` = human-facing rule, and the §6 lifecycle table — all copied from the feature README. Do NOT restate the doc-routing table that already lives in root `CLAUDE.md` (council decision 2026-05-04: routing must auto-load unconditionally; this rule is path-scoped and fires on edit, which is the right trigger for schema rules and the wrong one for routing). Keep the body at or under 45 lines.
- **verify:** `head -5 .claude/rules/iago-workspace.md && awk 'f{c++} /^---$/{f=1} END{print "body lines:", c}' .claude/rules/iago-workspace.md && grep -c "doc routing\|Doc routing" .claude/rules/iago-workspace.md`
- **expected:** Frontmatter shows the three `paths:` globs; body lines ≤ 45; the routing-table grep prints `0`.

### Task 2: Collapse the three competing routing tables into one
- **files:** `.iago/CONTEXT.md`, `.iago/README.md`
- **action:** Rewrite `.iago/CONTEXT.md` as pure L1 routing (≤ 300 tokens): one paragraph naming the workspace, then a "Sub-workspaces" table with a row per client — `din`, `fulldata`, `iago`, `munet-web`, `palazuelos`, `rsf`, `sentria` — with columns `Path | App repo | Planning repo | Inner repo?`, filled from the feature README's P1 status row and audit §4.1. Delete its "Doc-routing — where canonical specs live" table and its "Layer assignments" table (the rule from Task 1 now owns the schema). Then `git rm .iago/README.md`.
- **verify:** `test ! -f .iago/README.md && grep -c "^| " .iago/CONTEXT.md && grep -o "clients/[a-z-]*" .iago/CONTEXT.md | sort -u | wc -l && wc -w .iago/CONTEXT.md`
- **expected:** `README.md` gone; the client table has 7 data rows plus a header; 7 distinct `clients/*` paths; word count under ~230 (≈300 tokens).

### Task 3: Fix the two stale cross-references
- **files:** `.claude/rules/execution-pipeline.md`, `.iago/_config/runbooks/file-naming-standard.md`
- **action:** In `execution-pipeline.md` replace the reference to `.iago/config` with `.iago/config.json` (the bare path does not exist on disk). In `file-naming-standard.md` §2, extend the CODE row so it reads that `dev\` is frozen for the OneDrive *renaming* grammar and governed instead by `.claude/rules/iago-workspace.md` — add one sentence, do not restructure the table.
- **verify:** `grep -n "\.iago/config\b" .claude/rules/execution-pipeline.md; grep -c "iago-workspace" .iago/_config/runbooks/file-naming-standard.md`
- **expected:** First grep prints nothing (no bare `.iago/config` left); second prints `1` or more.

### Task 4: Make the scaffolding produce a conforming tree
- **files:** `templates/client-project/.iago/CONTEXT.md.template`, `templates/internal-project/.iago/CONTEXT.md.template`
- **action:** Update both template trees to the §2 schema: ensure `_config/` (with `runbooks/`, `context/`, `decisions/`, `learnings/`, `prompts/`), `plans/`, `research/`, `summaries/`, `state/` exist as scaffolded paths, move the existing `learnings/*` templates under `_config/learnings/`, add a `.gitignore.template` containing `state/`, and rewrite each `CONTEXT.md.template` as L1 routing only. Delete `DECISIONS.md.template` from both (decisions live in `_config/decisions/` per the schema).
- **verify:** `for t in client internal; do echo "-- $t"; find templates/$t-project/.iago -type f | sort; done`
- **expected:** Both trees list `CONTEXT.md.template`, `PROJECT.md.template`, `ROADMAP.md.template`, `STATE.md.template`, `config.json.template`, `.gitignore.template` and `_config/learnings/*`; no `DECISIONS.md.template`; no top-level `learnings/`.

### Task 5: Write the linter's tests first (RED)
- **files:** `scripts/organize/test-iago-lint.py`
- **action:** Write a test suite in the style of `scripts/organize/test-organize.py` (same assertion-counting harness, temp-dir fixtures) covering one detection case per rule code: W001 missing required file, W002 banned dir at `.iago/` root, W003 banned file pattern outside `state/`, W004 zero-byte file, W005 empty dir, W006 `STATE.md` missing or stale `Updated:` (> 14 days behind the newest file under `.iago/`), W007 nested `.iago/` in an app repo holding non-`state/` content, W008 `docs/` containing `plans|research|reviews`, W009 a second `ROADMAP-*.md`, W010 `README.md` at `.iago/` root. Add fixture-based tests that `--fix --apply` repairs exactly W003/W004/W005 and leaves the rest, and that `undo` restores the tree byte-identically.
- **verify:** `python scripts/organize/test-iago-lint.py 2>&1 | tail -3`
- **expected:** The suite runs and FAILS (module `iago-lint` not found or assertions red) — this is the RED step and is the correct outcome here.

### Task 6: Implement the linter (GREEN)
- **files:** `scripts/organize/iago-lint.py`
- **action:** Implement the linter mirroring `organize.py`'s command grammar — `check [--root PATH] [--json]` reporting every violation as `CODE  path  message  → fix`, exiting 1 when any are found; `fix [--root PATH] --apply` applying only the safe repairs (W003 move to `state/`, W004 delete, W005 remove empty dir) and writing a journal; `undo JOURNAL --apply` restoring from it. Default `--root` discovers `.iago/` at the repo root plus every `clients/*/.iago`. Never touch anything under `state/`, `node_modules/`, `.git/` or `_archive/`.
- **verify:** `python scripts/organize/test-iago-lint.py 2>&1 | tail -3 && python scripts/organize/iago-lint.py check --root . ; echo "exit=$?"`
- **expected:** Test suite reports all assertions passed; `check` prints the root's current violations (P3's worklist) and exits 1.

### Task 7: Archive the superseded May restructure plans
- **files:** `.iago/plans/feature-mwp-restructure-docs/`, `.iago/plans/feature-mwp-restructure-clients/`, `.iago/plans/feature-mwp-restructure-code/`
- **action:** `git mv` all three folders into `.iago/plans/_archive/2026-05-mwp-restructure/` and add a `README.md` there stating they are superseded by `feature-doc-standard/`, that plans docs/01 and docs/02 shipped as PRs #77 and #79 while the rest never executed, and that they must not be run without re-stress-testing (per the archive convention in `.claude/rules/execution-pipeline.md`).
- **verify:** `ls .iago/plans/ | grep -c mwp-restructure; ls .iago/plans/_archive/2026-05-mwp-restructure/`
- **expected:** First command prints `0`; the archive dir lists the three folders plus `README.md`.

## Verification

```bash
# Rule exists, is path-scoped, and does not duplicate routing
head -5 .claude/rules/iago-workspace.md
# One routing table only
test ! -f .iago/README.md && grep -c "Doc-routing" .iago/CONTEXT.md   # -> 0
# Linter is green and can measure the repo
python scripts/organize/test-iago-lint.py 2>&1 | tail -2
python scripts/organize/iago-lint.py check --root . | tail -20
# Superseded plans archived
ls .iago/plans/ | grep -c mwp-restructure                             # -> 0
# Nothing moved yet outside plans/_archive
git status --porcelain | grep -vE "^(A|M|D|R).*(\.claude/rules|\.iago/(CONTEXT|README)|templates/|scripts/organize/|\.iago/plans/)" | wc -l   # -> 0
```

**Expected:** all green; `iago-lint.py check` exits 1 listing the root violations that plan 02 will clear. A non-zero exit here is success, not failure — the linter is reporting the mess it was built to find.
