---
phase: feature-doc-standard
plan: 01
wave: 1
depends_on: []
context: .iago/plans/feature-doc-standard/README.md
created: 2026-08-26
revised: 2026-08-26
source: feature
---

# Plan: feature-doc-standard/01-grammar

## Goal

Build the tool that measures `.iago/` conformance, and make the scaffolders emit conforming workspaces — so P3 (root cleanse) and P4 (clients) have a machine-checkable target. No files move in this plan and nothing is auto-fixed; the linter ships in **report mode only**.

The standard is `.iago/plans/feature-doc-standard/README.md` §1–§7 — the source of truth. Copy its schema, its banned list (including the `_config/`/`_archive/` carve-out) and its lifecycle table rather than paraphrasing.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `.claude/rules/iago-workspace.md` | ≤ 10 lines: the schema is machine-enforced, here is the command |
| modify | `CLAUDE.md` | Register the new rule in the path-scoped-rules sentence |
| modify | `.iago/CONTEXT.md` | Reduce to true L1 routing + the 7-client registry |
| delete | `.iago/README.md` | Third competing routing table (also retires the stale `.iago/config` reference) |
| modify | `.iago/_config/runbooks/file-naming-standard.md` | §2 CODE zone points at this standard |
| modify | `templates/{client,internal}-project/.iago/**` | Scaffold the §2 schema, seed files not `.gitkeep` |
| modify | `scripts/new-client.sh`, `scripts/new-client.ps1`, `.claude/skills/iago-init/SKILL.md` | They `mkdir` the banned dirs at run time |
| create | `scripts/organize/test-iago-lint.py` | Tests, written first (RED) |
| create | `scripts/organize/iago-lint.py` | The linter — `check` only |
| move | `.iago/plans/feature-mwp-restructure-{docs,clients,code}/` | → `plans/_archive/2026-05-mwp-restructure/` |

## Tasks

### Task 1: Write the rule — short, and honest about how it loads
- **files:** `.claude/rules/iago-workspace.md`, `CLAUDE.md`
- **action:** Create the rule with frontmatter matching the shape of `.claude/rules/tdd.md` — the key is **`globs:`**, not `paths:` (all 7 path-scoped rules use `globs:`; no file in this repo uses `paths:`). Body is **≤ 10 lines**: the `.iago/` schema is machine-enforced by `python scripts/organize/iago-lint.py check`, run it before restructuring a workspace, the schema itself is in `.iago/plans/feature-doc-standard/README.md` §2. Do **not** restate the tree, the banned list or the lifecycle — `globs:` is inert in this build (nothing reads it), so every rule file loads in every session of every project, and a 45-line schema rule would cost ~900 always-on tokens to express what a script computes, which `.claude/rules/layer-triage.md` rule 1 forbids. Add `iago-workspace` to the path-scoped rules sentence at the end of root `CLAUDE.md`.
- **verify:** `sed '1,/^---$/d;1,/^---$/d' .claude/rules/iago-workspace.md | grep -c . ; head -5 .claude/rules/iago-workspace.md; grep -c "iago-workspace" CLAUDE.md`
- **expected:** Body is ≤ 10 non-blank lines; frontmatter uses `globs:`; `CLAUDE.md` mentions the rule once.

### Task 2: Collapse the three competing routing tables into one
- **files:** `.iago/CONTEXT.md`, `.iago/README.md`, `.iago/_config/runbooks/file-naming-standard.md`
- **action:** Rewrite `.iago/CONTEXT.md` as pure L1 routing: one paragraph naming the workspace, then a **Sub-workspaces** table with a row per client — `din`, `fulldata`, `iago`, `munet-web`, `palazuelos`, `rsf`, `sentria` — columns `Path | App repo | Planning repo | Inner repo?`, filled from the README's P1 status row and audit §4.1. Delete its "Doc-routing" and "Layer assignments" tables. Preserve the **L2 stage-contract** pointer in some form — `runtime/CONTEXT.md:4` reads "after L0 and L1 (`.iago/CONTEXT.md`)", so either keep a two-line pointer or state in the file that L2 stage contracts are retired and what replaces them. Then `git rm .iago/README.md` (this also retires the repo's only stale `.iago/config` reference, at `.iago/README.md:77`). Finally add one sentence to `file-naming-standard.md` §2's CODE row: `dev\` is frozen for the OneDrive *renaming* grammar and governed instead by this standard.
- **verify:** `test ! -f .iago/README.md && echo readme-gone; grep -c "Doc-routing\|Layer assignments" .iago/CONTEXT.md; grep -o "clients/[a-z-]*" .iago/CONTEXT.md | sort -u | wc -l; grep -ci "L2\|stage contract" .iago/CONTEXT.md; grep -rn "\.iago/config\([^.]\|$\)" --include="*.md" . | grep -v _archive | grep -v feature-doc-standard | wc -l`
- **expected:** README gone; `0` old tables; 7 distinct client paths; L2 disposition present (≥1); `0` stale bare `.iago/config` references left in the repo.

### Task 3: Make the scaffolders emit a conforming workspace
- **files:** `templates/client-project/.iago/`, `templates/internal-project/.iago/`, `scripts/new-client.sh`, `scripts/new-client.ps1`, `.claude/skills/iago-init/SKILL.md`
- **action:** Editing the templates alone is not enough — the banned dirs are created by code: `scripts/new-client.sh:126-131` does `mkdir -p .iago/context` and `.iago/reviews`; `scripts/new-client.ps1:80` lists `("context","plans","summaries","reviews","state","state/sessions")`; `iago-init/SKILL.md:25,39` documents and writes `learnings/`. Update all five so the emitted tree matches §2: `_config/{runbooks,context,decisions,learnings,prompts}`, `plans/`, `research/`, `summaries/`, `state/`. Ship a **real seed file** in each directory that must exist (e.g. `_config/learnings/patterns.md`) — never `.gitkeep`, which is a zero-byte file the linter reports. Move the existing `learnings/*` templates under `_config/learnings/`, add a `.gitignore.template` containing `state/`, and delete `DECISIONS.md.template` from both trees (decisions live in `_config/decisions/`).
- **verify:** `bash scripts/new-client.sh --dry-run 2>/dev/null || true; tmp=$(mktemp -d); bash scripts/new-client.sh lint-probe "$tmp" >/dev/null 2>&1; find "$tmp" -name ".iago" -type d | head -1; python scripts/organize/iago-lint.py check --root "$(find "$tmp" -name '.iago' -type d | head -1 | xargs dirname)"; echo "lint_exit=$?"; rm -rf "$tmp"`
- **expected:** The scaffolder produces a tree and `lint_exit=0` — a freshly scaffolded workspace has zero violations. (If `new-client.sh` cannot target a temp dir, scaffold into `.local/` and clean up; a `find` over the template tree alone does not prove what is emitted.)

### Task 4: Write the linter's tests first (RED)
- **files:** `scripts/organize/test-iago-lint.py`
- **action:** Write a suite in the style of `scripts/organize/test-organize.py`, importing the module via `importlib.util.spec_from_file_location("iago_lint", HERE / "iago-lint.py")` exactly as `test-organize.py:21-24` does — Python cannot `import iago-lint`. Cover one detection case per code: **W001** missing required file (the set is exactly `CONTEXT.md`, `PROJECT.md`, `ROADMAP.md`, `STATE.md`, `config.json`); **W002** banned dir at `.iago/` root; **W003** banned scratch *file* outside `state/`; **W004** zero-byte file; **W005** empty dir; **W006** `STATE.md` missing/stale `Updated:` measured against the newest file **excluding `state/`, `_archive/`, `__pycache__/`**; **W007** nested `.iago/` in an app repo holding non-`state/` content; **W008** `docs/` containing `plans|research|reviews`; **W009** a second `ROADMAP-*.md`; **W010** `README.md` at `.iago/` root. Add explicit negative fixtures proving `_config/`, `_archive/` and `plans/*/_archive/` are **never** flagged by W003, and that a `.gitkeep` is reported (W004) but carries no auto-fix. Define the `--json` record shape once — `{code, path, message, fix, severity}` — and assert on it, since plan 03 wires it into CI.
- **verify:** `python scripts/organize/test-iago-lint.py; echo "tests_exit=$?"`
- **expected:** `tests_exit=1` with a traceback (`FileNotFoundError` from `exec_module` before any assertion runs) — the RED step. Do **not** pipe this through `tail`: a pipe returns the pipe's status and hides the real exit code.

### Task 5: Implement the linter — report mode only (GREEN)
- **files:** `scripts/organize/iago-lint.py`
- **action:** Implement `check [--root PATH] [--all] [--json] [--exclude CODE]`, mirroring `organize.py`'s subcommand grammar. `--root PATH` scans **exactly one** workspace (default `.`); `--all` additionally scans `clients/*/.iago`. Print `CODE  path  message  → fix` per violation and exit 1 when any exist. Skip `state/`, `node_modules/`, `.git/`, `__pycache__/` and `_archive/` when walking. **Ship no `fix`/`undo` in this plan** — the README §7 says report mode only, and a naive W003 auto-fix would move the entire `_config/` tree into a gitignored directory. Where a fix destination is named in the message, it is the **nearest enclosing** `.iago/state/`, not the root's.
- **verify:** `python scripts/organize/test-iago-lint.py; echo "tests_exit=$?"; python scripts/organize/iago-lint.py check --root . ; echo "lint_exit=$?"`
- **expected:** `tests_exit=0` and the suite prints its all-assertions-passed line. `lint_exit=1` with a report that includes, at minimum: a W002 for each of `.iago/{context,decisions,hooks,learnings,prompts,runbooks,logs,reviews,runs,pipeline-runs}/`, a W006 on `.iago/STATE.md`, and ≥5 W004 for the existing `.gitkeep` files. That non-zero exit is success — it is the P3 worklist.

### Task 6: Archive the superseded May restructure plans
- **files:** `.iago/plans/feature-mwp-restructure-{docs,clients,code}/`
- **action:** `git mv` all three into `.iago/plans/_archive/2026-05-mwp-restructure/` with a `README.md` stating they are superseded by `feature-doc-standard/`, that docs/01 and docs/02 shipped as PRs #77 and #79 while the rest never executed, and that they must not be run without re-stress-testing. The archive convention calls for a roadmap pointer, but `.iago/ROADMAP.md` has no row for this work — add one, or drop the pointer framing and say why in the archive README.
- **verify:** `ls .iago/plans/ | grep -c mwp-restructure; ls .iago/plans/_archive/2026-05-mwp-restructure/; grep -ci "doc-standard\|mwp" .iago/ROADMAP.md`
- **expected:** `0` live mwp folders; the archive lists three folders plus `README.md`; the ROADMAP either mentions it or the archive README explains the omission.

## Verification

```bash
# Rule is short and uses the real frontmatter key
sed '1,/^---$/d;1,/^---$/d' .claude/rules/iago-workspace.md | grep -c .    # <= 10
grep -c "globs:" .claude/rules/iago-workspace.md                           # 1

# One routing table only
test ! -f .iago/README.md && echo readme-gone

# Linter green, and it reports the root's real state
python scripts/organize/test-iago-lint.py; echo "tests_exit=$?"            # 0
python scripts/organize/iago-lint.py check --root . ; echo "lint_exit=$?"  # 1 (the P3 worklist)

# A freshly scaffolded workspace is already conforming
# (see Task 3 verify — scaffold to a temp dir, lint it, expect 0)

# Superseded plans archived
ls .iago/plans/ | grep -c mwp-restructure                                  # 0

# Workflows/CI unaffected by this plan
node scripts/validate-workflows.mjs; echo "wf_exit=$?"                     # 0
```

**Expected:** all as annotated. Never pipe a test command through `head`/`tail` in a verify — the pipeline's build gate reads the exit status, and a pipe returns the pipe's, which is how a red suite gets reported as green.

## Notes for the implementer

- `python` on this machine is 3.12.10; `python3` is the MS Store stub and errors. Use `python`.
- `.claude/rules/tdd.md` globs only `.ts/.tsx/.js/.jsx/.mjs` and its coverage gate is vitest — neither applies to a `.py` script. The TDD substitute here is: tests written and failing first, then passing, with the assertion-count harness as the gate.
- There is no root `tsconfig.json` or `biome.json`, so `npx tsc --noEmit` and `npx biome check` are no-ops in this repo. Do not treat their output as a gate for this plan.

## Stress Test

**Verdict:** BLOCK on the 2026-08-26 draft → **PROCEED** after revision (this file).
**Date:** 2026-08-26 · analyst (opus), read-only, claims verified against the repo.

The reviewer checked six premises before judging. Two were false and changed the design.

**CONTRADICTIONS**
- *Critical — `paths:` frontmatter does not exist.* All 7 path-scoped rules use `globs:` (`tdd.md:4`, `react-vite.md:4`, …); no file uses `paths:`. **Fixed:** Task 1 specifies `globs:` and says to copy `tdd.md`'s frontmatter shape.
- *Critical — the rule's whole rationale was false.* `globs:` is **inert in this build** (`.iago/research/2026-05-30-config-optimization-action-plan.md:33,108` — "No loader/hook/settings reads `globs:`"), corroborated live: rules for react-vite/aws-amplify/tdd loaded in a session working only under `.iago/plans/`. A 45-line rule would load in every session of every project (~900 tokens) to state what a script computes — which `layer-triage.md` rule 1 forbids. **Fixed:** the rule is now ≤ 10 lines pointing at the linter; the schema lives in the README and `templates/`. README §7 rewritten to match.
- *Critical — Task 3 targeted a string that is not in the file.* `.claude/rules/execution-pipeline.md` contains no `.iago/config`; the repo's only occurrence was `.iago/README.md:77`, which Task 2 deletes. **Fixed:** that half is gone, folded into Task 2 (7 tasks → 6).
- *Critical — templates alone cannot make `/iago-init` conform.* The banned dirs are created by `new-client.sh:126-131`, `new-client.ps1:80` and `iago-init/SKILL.md:25,39`. **Fixed:** all five files are in Task 3, whose verify scaffolds to a temp dir and lints the **emitted** tree.
- *Critical — the standard banned its own required directories.* README §2's `_*` ban literally covered `_config/` and `_archive/`; a W003 auto-fix would have moved the whole `_config/` tree into gitignored `state/`. **Fixed in the README** with a named carve-out, plus a negative fixture in Task 4.
- *Critical — `fix --apply` contradicted the README* ("report mode only in this PR"), and `.gitkeep` scaffolding fought W004/W005. **Fixed:** `check` only; seed files instead of `.gitkeep`; `.gitkeep` reported with no auto-fix.
- *Important — the new rule was never registered* in `CLAUDE.md`'s rule list. **Fixed** in Task 1.

**EDGE CASES**
- *Important — the final verify was guaranteed red.* `git status --porcelain` emits `?? ` and ` M `; the `^(A|M|D|R)` allow-pattern matched neither, and `.iago/research/` was not in the allow-list. **Fixed:** dropped; the PR diff is the real evidence.
- *Important — the `.iago/config` grep matched `.iago/config.json`* (word boundary fires at the dot), so it would fail *after* a correct fix. **Fixed** with an explicit character-class check.
- *Important — the line-count gate counted frontmatter as body.* **Fixed:** strip both delimiters before counting.
- *Important — piping tests through `tail` masked exit codes*, the same failure as `sentria_npm_test_exits_zero_on_failure`. **Fixed:** every verify prints `tests_exit=$?` with no pipe.

**PRECISION** — two contradictory CLIs (subcommand vs bare `--root` in the README's acceptance lines) and `--root` colliding with default multi-workspace discovery. **Fixed:** `--root` scans exactly one workspace, `--all` adds the clients; README acceptance lines updated. W006's reference set now excludes `state/` and `_archive/`; W003's destination is the *nearest* `.iago/state/`.

**MISSING ACCEPTANCE** — W001's required-file set, the `--json` record shape, and a falsifiable expected output for `check --root .` were unspecified. **Fixed:** all three are written into Tasks 4 and 5, including a measured floor (W002 across 10 dirs, W006 on STATE.md, ≥5 W004).

**Considered, not adopted:** splitting into `01a-grammar` / `01b-linter`. Six tasks is within the cap, and the linter — the only risky part — is covered by the build gate.
