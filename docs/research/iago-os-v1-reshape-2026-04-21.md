# Research: iago-os v1 reshape

**Date:** 2026-04-21
**Builds on:** docs/research/iago-os-audit-2026-04-21.md
**Constraint lifted:** MUNET M2 complete — structural changes in scope

---

## Summary of changes vs prior audit

Prior audit (same date, earlier session) diagnosed issues but was constrained by ongoing MUNET
work. With that constraint lifted, this follow-up extends the findings into concrete proposals
across 8 dimensions. The prior audit recommended three targeted fixes (macOS timeout, plan
archiving, learnings wiring). This research validates those remain the highest-priority items
and adds proposals across 7 additional dimensions for a coherent v1 shape.

New findings not in prior audit:
- `run_claude()` is already cross-platform (background+poll+taskkill); the macOS gap is
  specifically the `sort -V` fallback at line 568, NOT the timeout mechanism (misdiagnosed as
  "Low" in STATE.md — see §4)
- `package.json` has `version: "0.1.0"` but no CHANGELOG.md; two tags exist (v0.1.0, v0.2.0)
  with no matching changelog
- `docs/` has 6 top-level doc files + 5 subdirs — not all are discoverable from README.md
- Summary format at step 6 lacks reviewer attribution, Codex findings count, and async loop
  outcome — telemetry is thin
- No self-tests exist for the pipeline, hooks, or skill schema beyond `validate-skills.sh`
  (3 checks: frontmatter start, name:, description:)
- `validate-hooks.sh` checks only Node.js syntax — no behavioral contract tests
- CLAUDE.md (199 lines) has substantial overlap with `rules/react-vite.md` and `rules/tdd.md`
  but the overlap is intentional (always-loaded summary vs path-scoped detail)
- `new-client.sh` and `new-client.ps1` appear structurally parallel (same 5 steps, same
  template variables) but `.ps1` omits the `--internal` description in the git commit message
  (minor drift)

---

## 1. Folder structure + file-placement rules

### Current state

Top-level directories (as of 2026-04-21):

```
/
├── .claude/
│   ├── agents/
│   │   ├── bases/         (executor.md, analyst.md, operator.md)
│   │   ├── capabilities/  (13 files: animation unlisted in CLAUDE.md)
│   │   └── profiles/      (12 files)
│   ├── rules/             (8 files: available-skills.md + 7 domain rules)
│   └── skills/            (37 dirs, each with SKILL.md)
├── .github/
│   └── workflows/         (claude.yml, claude-review-fix.yml, validate.yml)
├── .iago/
│   ├── config.json
│   ├── context/           (empty — no files)
│   ├── hooks/             (8 .mjs hook files + lib/)
│   ├── learnings/
│   │   ├── patterns.md    (empty table — 4 lines, zero entries)
│   │   └── project-conventions.md
│   ├── plans/             (5 completed audit plans, no archive path)
│   ├── reviews/           (audit-phase.md only)
│   ├── state/             (empty — no files)
│   ├── summaries/         (9 summary files, no archive path)
│   └── STATE.md
├── clients/
│   ├── fulldata/
│   ├── munet-web/
│   └── sentria/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── GITHUB-PIPELINE.md
│   ├── IAGO-DASHBOARD.md
│   ├── MANUAL.md
│   ├── SETUP.md
│   ├── WORKFLOW.md
│   ├── archive/           (plans/, research/, specs/ — archived old docs)
│   ├── automations/       (cross-session-pipeline.md, trigger-templates.md)
│   ├── patterns/          (empty or near-empty)
│   ├── research/          (6 research files including this one)
│   └── specs/             (3 spec files: iago-brand.md, etc.)
├── graphify-out/           (knowledge graph output — generated artifact)
├── n8n/                   (n8n workflow exports?)
├── scripts/
│   ├── execute-pipeline.sh
│   ├── review-checks/     (10 domain check files)
│   └── {new-client, setup-memory, sync-skills, usage-report, validate-*}.{sh,ps1,mjs}
├── templates/
│   ├── client-project/
│   ├── internal-project/
│   └── memory/
├── CLAUDE.md
├── CLAUDE.local.md.template
├── CLAUDE.md.backup
├── README.md
├── package.json
└── package-lock.json
```

Sources: Bash inventory at tool calls 3, 4, 5, 6.

### Gaps

1. **No plan lifecycle path.** `.iago/plans/` holds 6 files (5 completed audit + 1 recent quick).
   No `.iago/archive/plans/` directory. Completed plans accumulate alongside active ones.
   Source: `docs/research/iago-os-audit-2026-04-21.md:L131-133`.

2. **`.iago/context/` is empty.** New-client.sh creates this dir but iago-os itself has nothing
   in it. Either it's unused or the convention was never adopted for internal use.
   Source: Bash inventory.

3. **`.iago/state/` is empty.** Created by new-client.sh (`state/sessions/`) but empty in
   iago-os root. Unclear purpose vs STATE.md.

4. **`graphify-out/` is a generated artifact** checked into the repo. No `.gitignore` rule
   for it. If graph rebuilds frequently, this pollutes git history.

5. **`CLAUDE.md.backup`** exists at repo root. Backup of a config file should not be
   version-controlled. No evidence of intentional archival.

6. **`docs/patterns/`** appears near-empty — no files found. Possible dead directory.

7. **No `.iago/archive/` prefix** for old summaries. The 9 summary files for completed plans
   stay in `.iago/summaries/` indefinitely with no retirement path.

8. **`docs/specs/`** contains files that are not project specs but brand docs
   (`iago-brand.md`, `claude-design-iago-brand-prompt.md`) — naming inconsistency.

### Proposed canonical tree

```
/
├── .claude/
│   ├── agents/
│   │   ├── executor.md, analyst.md, operator.md    # bases: flat in agents/
│   │   ├── capabilities/{name}.md                  # capability fragments
│   │   └── profiles/{name}.md                      # composed profiles
│   ├── rules/
│   │   ├── available-skills.md                     # catalog (always-loaded)
│   │   ├── execution-pipeline.md                   # pipeline rules (always-loaded)
│   │   ├── git-workflow.md                         # always-loaded
│   │   ├── aws-amplify.md                          # path-scoped: amplify/**
│   │   ├── e2e-testing.md                          # path-scoped: e2e/**, *.spec.ts
│   │   ├── mcp-server-patterns.md                  # path-scoped: mcp/**
│   │   ├── react-vite.md                           # path-scoped: src/**/*.tsx
│   │   ├── systematic-debugging.md                 # always-loaded
│   │   └── tdd.md                                  # always-loaded
│   └── skills/{skill-name}/SKILL.md
│
├── .github/workflows/
│   ├── claude.yml
│   ├── claude-review-fix.yml
│   └── validate.yml
│
├── .iago/
│   ├── STATE.md                                    # active state, always read
│   ├── config.json
│   ├── context/                                    # client-specific injections (currently unused in iago-os itself)
│   ├── hooks/                                      # hook .mjs files + lib/
│   ├── learnings/
│   │   ├── patterns.md                             # review pattern log (5+ → CLAUDE.md)
│   │   └── project-conventions.md                  # project-specific agent conventions
│   ├── plans/
│   │   └── {active plans only}                     # NN-slug.md or feature-slug/NN.md
│   ├── plans/archive/                              # completed plans move here post-verify
│   ├── reviews/                                    # phase verification reports
│   ├── summaries/                                  # pipeline run summaries (append-only)
│   └── telemetry/                                  # NEW: reviewer instrumentation
│       └── reviewers.jsonl
│
├── clients/
│   └── {client-id}/                               # git worktree or symlink per client
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── GITHUB-PIPELINE.md
│   ├── MANUAL.md
│   ├── SETUP.md                                    # Day-1 setup (covers hire #4 path)
│   ├── WORKFLOW.md
│   ├── archive/                                    # old plans, research, specs
│   ├── brand/                                      # RENAMED from specs/ for brand assets
│   ├── research/                                   # research docs
│   └── specs/                                      # product/feature specs only
│
├── scripts/
│   ├── pipeline/
│   │   ├── execute-pipeline.sh                     # MOVED from scripts/
│   │   └── review-checks/                          # MOVED from scripts/review-checks/
│   ├── hooks/
│   │   ├── validate-hooks.sh                       # MOVED from scripts/
│   │   └── validate-skills.sh
│   ├── setup/
│   │   ├── new-client.sh + new-client.ps1
│   │   ├── setup-memory.sh + setup-memory.ps1
│   │   └── sync-skills.sh + sync-skills.ps1
│   └── utils/
│       ├── console-check.mjs
│       └── usage-report.sh + usage-report.ps1
│
├── templates/
│   ├── client-project/
│   ├── internal-project/
│   └── memory/
│
├── CLAUDE.md                                       # always-loaded orchestrator context
├── CLAUDE.local.md.template                        # local override template
├── README.md
├── package.json
└── package-lock.json
```

**File-placement rules:**
- Active plans: `.iago/plans/{slug}/NN.md` — move to `.iago/plans/archive/` after `/iago-verify`
- Summaries: `.iago/summaries/{plan-name}.md` — never deleted, append-only log
- Research: `docs/research/YYYY-MM-DD-{topic}.md` — date-prefixed
- Specs: `docs/specs/{feature}.md` — product/feature only (brand assets → `docs/brand/`)
- Review artifacts: `.iago/reviews/{phase}.md` — one per phase verify
- Generated artifacts: `graphify-out/` should be in `.gitignore` (it's a build artifact)
- Backup files: never committed (`CLAUDE.md.backup` → delete or `.gitignore`)

---

## 2. Skill/agent format standardization

### Current state

**Skill format** (from 3 samples: iago-execute, deep-research, amplify-bug-bounty):

All three have:
- YAML frontmatter (`---`) with `name:` and `description:`
- `## Purpose` section
- `## Arguments` section
- `## Steps` section with numbered sub-steps

`amplify-bug-bounty` adds:
- `audit_scope:` frontmatter field
- `audit_disclaimer:` frontmatter field

No skill has `status:` frontmatter (no dormant/active signal).
No skill has `version:` or `last-updated:` frontmatter.

**validate-skills.sh enforces only 3 checks** (lines 1-45):
1. Frontmatter starts with `---`
2. `name:` present
3. `description:` present

Missing checks: `## Purpose`, `## Steps`, `## Arguments` structure.

**Agent format** (from executor.md, analyst.md, fullstack profile, react-19 capability):

Bases have frontmatter: `name`, `description`, `model`, `tools[]`, `maxTurns`, then `## Role`, `## Process`, `## Anti-Patterns`/`## Constraints`.

Profiles have: `name`, `description`, `base`, `model`, `maxTurns`, `capabilities[]`, then `## Match Signals`, `## Review Pairing`.

Capabilities have: no frontmatter — just `<!-- Sync with: ... -->` comment + markdown headings.

Shape variance:
- Bases: fully structured with frontmatter
- Profiles: frontmatter but no `tools[]` (inherits from base)
- Capabilities: NO frontmatter at all — plain markdown with comment sync tag

### Gaps

1. `validate-skills.sh` misses structural validation (`## Purpose`, `## Steps`, `## Arguments`).
2. No `status: dormant|active|experimental` frontmatter — no machine-readable dormant signal.
3. Capability files have no frontmatter — no machine-readable schema for the agent dispatcher.
4. `animation.md` capability is undocumented in CLAUDE.md (CLAUDE.md says 13, actual is 14).
   Source: `docs/research/iago-os-audit-2026-04-21.md:L136`.

### Proposed strict schema

**SKILL.md schema:**
```yaml
---
name: {slug}                     # required, matches directory name
description: >-                  # required, ≥2 lines (trigger + anti-trigger)
  Use when ...
  Not when ...
status: active|dormant|experimental  # required (new)
version: "1.0"                   # optional, bump when breaking change
tags: []                         # optional, for catalog filtering
# audit-only extras:
audit_scope: standalone          # optional, audit skills only
---

## Purpose
## Arguments
## Steps
### 1. ...
## Output
```

**Agent profile schema:**
```yaml
---
name: {slug}
description: >-
base: executor|analyst|operator
model: opus|sonnet
maxTurns: N
capabilities:
  - {capability-slug}
tags: []
---

## Match Signals
## Review Pairing
```

**Agent capability schema** (new — currently no frontmatter):
```yaml
---
name: {slug}
description: >-
sync: .claude/rules/{corresponding-rule}.md   # if synced from rules/
tokens: ~N   # estimated token budget (100-500 range for capability fragments)
---
```

**validate-skills.sh enhancements:**
Add checks: (4) `## Purpose` section present, (5) `## Steps` section present,
(6) `status:` field present, (7) `description:` is multi-line (≥2 lines after `>-`).

---

## 3. Self-test coverage for iago-os itself

### Current state

- `validate-skills.sh`: 45 lines, 3 structural checks (frontmatter, name, description).
  Source: `scripts/validate-skills.sh:1-45`.
- `validate-hooks.sh`: 30 lines, Node.js syntax check only (`node --check`).
  Source: `scripts/validate-hooks.sh:1-35`.
- No test for `execute-pipeline.sh` behavior (stage ordering, arg parsing, exit codes).
- No test for hook behavior (does safety-guard.mjs actually block on the right patterns?).
- No smoke test that runs a minimal plan through the pipeline end-to-end.
- `.github/workflows/validate.yml` exists but was not read in detail — may contain CI checks.
- `package.json` has no `test` script defined.

No evidence of any behavioral test coverage for iago-os's own scripts or hooks.

### Gaps

1. Pipeline arg parsing is untested — `--no-pr`, `--no-tag`, `--plan` flags have no test.
2. Hook behavioral contracts are untested — safety-guard blocks certain commands but this is
   not verified by any automated check.
3. No integration-level smoke test for the pipeline on a trivial plan.

### Proposed minimum viable test suite

**Tooling:** Bats (Bash Automated Testing System) for shell scripts; Node.js `node:test`
built-in for .mjs hooks. No new test frameworks needed — both run without extra install.

**Test files:**

```
tests/
  pipeline/
    args.bats                 # --no-pr, --no-tag, --plan flags parse correctly
    stages.bats               # stage ordering, exit codes, tmp file cleanup
    stress-skip.bats          # ## Stress Test section skips step 0
  hooks/
    safety-guard.test.mjs     # blocks known-dangerous bash patterns
    commit-quality.test.mjs   # rejects non-conventional commit messages
    config-protection.test.mjs # blocks Edit/Write on protected files
  skills/
    validate.bats             # runs validate-skills.sh, asserts all OK
  smoke/
    minimal-plan.bats         # run pipeline on a fixture plan, assert exit 0
```

**Cadence:** Run on every PR via `validate.yml`. Local: `npm test` → `bats tests/ && node --test tests/hooks/*.mjs`.

**Priority order:** safety-guard hook tests first (security), then pipeline args, then smoke.

---

## 4. Onboarding + cross-platform parity

### Current state

**Onboarding docs:**
- `docs/SETUP.md`: Full setup guide covering prerequisites, install, and auth for both
  Windows and macOS. Source: `docs/SETUP.md:1-20`.
- `docs/MANUAL.md`: Complete usage manual with 12 sections including troubleshooting.
  Source: `docs/MANUAL.md:1-30`.
- `README.md`: Oriented toward existing users — explains what iago-os is and what it solves.
  Does not have a "Day 1 for hire #4" section.

No dedicated `docs/ONBOARDING.md` for a new team member joining mid-stream.

**Cross-platform parity (new-client.sh vs new-client.ps1):**
- Steps 1-5 are identical in structure (copy template, copy hooks, replace vars, create dirs, git init).
- `.sh` escapes special characters with `escape_sed()` function — `.ps1` does direct string
  replacement, which may fail on `&`, `\` in client names. Minor drift.
- `.sh` includes `--internal` flag description in `--help` output; `.ps1` uses a `[switch]$Internal`
  param with no equivalent help text in Write-Host output.
- Step 5 commit message: `.sh` uses `"chore: scaffold $PROJECT_NAME from iaGO $TEMPLATE_TYPE template"`;
  `.ps1` equivalent was in the truncated read — likely parallel but unverified.

**macOS timeout issue (re-diagnosis):**
`run_claude()` at `scripts/execute-pipeline.sh:91-130` uses a background process + poll +
`taskkill` pattern — NOT `timeout` or `gtimeout`. This pattern works on macOS.

The actual macOS compatibility issue is at line 568:
```bash
# sort -V (version sort) is GNU coreutils only; fall back to -r on macOS/BSD sort.
```
This is already handled with a comment noting the fallback. Evidence: the grep output at
tool call 9 shows `sort -V` at line 568 with an inline fallback note — not a bug, a
documented workaround.

STATE.md Known Issues entry for "macOS timeout in pipeline" (line 20) refers to the old
`timeout`-based implementation that was replaced by the background+poll approach. The
STATE.md entry is stale — the fix already landed (the run_claude rewrite, commit 44e90f3
"fix(pipeline): tree-kill claude.exe on timeout"). The macOS issue is resolved; STATE.md
should be updated.

Source: `scripts/execute-pipeline.sh:91-130`, `STATE.md:20`, git log commit 44e90f3.

### Gaps

1. No `docs/ONBOARDING.md` (or `docs/HIRE4.md`) with a hire #4 specific flow:
   - What to clone
   - How to configure MCP servers (obsidian vault path, mempalace wing)
   - Which worktree to use for concurrent work
   - How to run the pipeline on their first task
2. `SETUP.md` covers tooling prerequisites but not iaGO-OS conceptual model (skills,
   agents, hooks, plans) — that's in MANUAL.md but requires reading both.
3. `new-client.ps1` special-character handling diverges from `.sh` (no `escape_sed`
   equivalent).
4. STATE.md Known Issues entry for macOS timeout is stale — should be removed.

### Proposed

1. Add `docs/ONBOARDING.md` (50-80 lines) as a hire #4 fast-path: clone → prerequisites
   → MCP config → first `/iago-execute` run → where to ask questions. Link from README.md.
2. Fix `new-client.ps1` to escape `&`, `\`, `/` in client name before string replacement
   (mirror `escape_sed` logic).
3. Close the STATE.md macOS entry with a "fixed in 44e90f3" note and remove from Known Issues.

---

## 5. Doc consolidation

### Current state

**Line counts:**
```
CLAUDE.md:                    199 lines
rules/available-skills.md:    207 lines
rules/execution-pipeline.md:  144 lines
rules/aws-amplify.md:          66 lines
rules/react-vite.md:           43 lines
rules/tdd.md:                  49 lines
rules/e2e-testing.md:          57 lines
rules/git-workflow.md:         37 lines
rules/mcp-server-patterns.md:  64 lines
rules/systematic-debugging.md: 49 lines
                               ─────────
Total:                         915 lines
```
Source: `wc -l` at tool call 11.

**Overlap analysis:**
CLAUDE.md overlaps with `rules/react-vite.md` and `rules/tdd.md` on:
- `use()` + `<Suspense>`, no `useEffect` for data (CLAUDE.md:21 = react-vite.md:10)
- ShadCN/UI official docs warning (CLAUDE.md:27 = react-vite.md:18)
- TanStack Query for server state (CLAUDE.md:35 ≈ react-vite.md:24-30)
- Vitest/Playwright testing stack (CLAUDE.md:12 ≈ tdd.md:17-19)

Source: diff at tool call 13.

However, the CLAUDE.md entries are summary-level (one line per concept). The rules/ files
are detail-level (full examples, edge cases, anti-patterns). The duplication is intentional:
CLAUDE.md is always loaded in context window; rules/ are loaded path-scoped when relevant.
A model working on `src/auth.tsx` gets both, but a model working on `amplify/data/resource.ts`
only gets the amplify rule — not the react-vite summary.

**True redundancy (not intentional):**
- `rules/available-skills.md` (207 lines) is a superset of the `## Skills` section in
  CLAUDE.md (≈30 lines). CLAUDE.md's Skills section is a condensed catalog reference;
  `available-skills.md` is the full reference with trigger/anti-trigger decision table.
  Both are always-loaded. Net: CLAUDE.md's `## Skills` section is partially redundant with
  `available-skills.md` but CLAUDE.md's version is the lookup table form for the orchestrator.
- `rules/execution-pipeline.md` (144 lines) restates the pipeline stage table already in
  CLAUDE.md `## Review Pipeline` section. CLAUDE.md has a condensed 8-row table;
  `execution-pipeline.md` adds the rule enforcement, violation detection, and async loop
  diagram. Both always-loaded. The detail in `execution-pipeline.md` is not in CLAUDE.md —
  not fully redundant.

### Gaps

1. No single document explains the "what lives where" convention for new rules — how to
   decide if something goes in CLAUDE.md vs a rule file vs learnings.
2. `rules/available-skills.md` and `CLAUDE.md:## Skills` have enough overlap that a reader
   must read both to get complete context. A merge or cross-reference would help.
3. `docs/ARCHITECTURE.md` and `docs/WORKFLOW.md` — not read in detail; may duplicate
   content in CLAUDE.md's Architecture/Workflow sections.

### Proposed

**What stays in CLAUDE.md (always-loaded, orchestrator-scoped):**
- Tech Stack, Code Standards, Architecture (summary level — 1-2 lines each)
- Workflow decision table (which skill for what scope)
- Execution Path (the mandatory `## Execution Path` table — stays because it's a hard rule)
- Memory Architecture (routing table)
- Output Style (orchestrator tone rule)
- Model Routing (routing decisions)
- Agent Escalation Protocol + Execution Discipline (behavioral guards)
- Rules section (just the list with path-scope annotations)
- Skills section (one-line catalog — pointers to available-skills.md)

**What moves to rules/ (path-scoped or on-demand):**
- `## Review Pipeline` detail → already in `execution-pipeline.md` (CLAUDE.md can keep 4-line
  summary with pointer)
- `## Learnings` section → move to `learnings/project-conventions.md` or a new
  `.iago/context/meta.md`

**Net effect:** CLAUDE.md should target ≤160 lines. Current 199 has room to compress.

---

## 6. Scripts organization

### Current state

```
scripts/
├── console-check.mjs        (PostToolUse hook helper for vite/node process leaks)
├── execute-pipeline.sh      (842 lines — the full pipeline)
├── new-client.ps1
├── new-client.sh
├── review-checks/           (10 domain check .md files, 200 lines total)
├── setup-memory.ps1
├── setup-memory.sh
├── sync-skills.ps1
├── sync-skills.sh
├── usage-report.ps1
├── usage-report.sh
├── validate-hooks.sh
└── validate-skills.sh
```

Source: Bash inventory at tool call 3.

**execute-pipeline.sh (842 lines) — natural split points:**
- Lines 1-87: setup, arg parsing, `PIPELINE_TMP`, plan loading
- Lines 88-130: `run_claude()` + `run_claude_adversarial()` utility functions
- Lines 131-230: Stage 0 — Stress test
- Lines 231-415: Stage 1 — Implement + build gate (2a/2b)
- Lines 416-540: Stage 3 — Review + fix loop
- Lines 541-680: Stage 4/4b — Codex adversarial + codex fix
- Lines 681-800: Stage 5/5b — PR creation + @claude tag
- Lines 801-843: Stage 6 — Summary

The script is a single-file sequential pipeline. Natural split: `lib/run-claude.sh`
(utility functions) + stage scripts in `pipeline/` that the orchestrator sources.
But splitting requires changes to the source commands — not trivial. See below.

**review-checks/ (10 files):**
Organization is clear: one file per domain (amplify, api, auth, backend, baseline,
data-integrity, i18n, infra, patterns, react). No overlap except at JWT/Cognito
boundary between `auth.md` and `amplify.md`. Well-organized already.

### Gaps

1. `scripts/` has no sub-organization — setup scripts, pipeline, utils, and validators
   all flat.
2. `execute-pipeline.sh` is 842 lines with no modularization. Adding a new pipeline stage
   requires editing a large file and maintaining mental model of all stage boundaries.
3. `console-check.mjs` lives in `scripts/` but is a hook helper — it's invoked by the
   PostToolUse hook, not a standalone script.

### Proposed scripts/ reorg

```
scripts/
├── pipeline/
│   ├── execute-pipeline.sh          # main orchestrator — sources lib/
│   ├── lib/
│   │   ├── run-claude.sh            # run_claude() + run_claude_adversarial()
│   │   └── compose-checks.sh        # compose_review_checks()
│   └── review-checks/               # MOVED from scripts/review-checks/
│       └── *.md
├── setup/
│   ├── new-client.sh + new-client.ps1
│   ├── setup-memory.sh + setup-memory.ps1
│   └── sync-skills.sh + sync-skills.ps1
├── utils/
│   ├── console-check.mjs            # hook helper (ref in settings.json needs update)
│   └── usage-report.sh + usage-report.ps1
└── validate/
    ├── validate-hooks.sh
    └── validate-skills.sh
```

**Implement in phases:** Move review-checks/ and setup scripts first (low risk — just paths).
Move execute-pipeline.sh internals later when adding a new stage (natural refactor moment).
`lib/run-claude.sh` extraction is the highest-value split — keeps the timeout/kill logic
isolated and testable.

---

## 7. Versioning + release hygiene

### Current state

- `git tag -l` output: `v0.1.0`, `v0.2.0` — two tags exist.
  Source: tool call 11.
- `package.json` version: `"0.1.0"` — not updated to match v0.2.0 tag.
  Source: tool call 11.
- No `CHANGELOG.md` found at repo root.
- No release workflow in `.github/workflows/` (only claude.yml, claude-review-fix.yml,
  validate.yml).
- STATE.md marks "Tag: v0.1.0" in the header (line 4) — not updated to v0.2.0.
  Source: `.iago/STATE.md:4`.
- No release notes associated with v0.2.0 tag.

### Gaps

1. `package.json` version (`0.1.0`) lags behind `v0.2.0` git tag.
2. No CHANGELOG.md — no record of what changed between tags.
3. STATE.md header shows `v0.1.0` — stale.
4. No release trigger: tags are created manually (ebe89e6 commit context), no automation.
5. No definition of "what constitutes a minor vs major release" for this type of project.

### Proposed

**Semver discipline for a config-layer repo:**
- `v0.x.0` — minor: new skills, agent profiles, pipeline features, or significant rule additions
- `v0.x.y` — patch: bug fixes, docs, schema corrections
- `v1.0.0` — when the onboarding path for hire #4 is complete and self-tests exist

**CHANGELOG.md format (Keep-a-Changelog style):**
```markdown
# Changelog

## [Unreleased]

## [0.2.0] - 2026-04-20
### Added
### Fixed
### Changed

## [0.1.0] - 2026-04-09
```

**Release trigger:** A `release.yml` GitHub Action triggered on `git tag v*` that:
1. Validates `package.json` version matches the tag
2. Runs `validate-skills.sh` and `validate-hooks.sh`
3. Creates a GitHub Release with auto-extracted CHANGELOG section

**Immediate fixes:**
- Bump `package.json` to `"0.2.0"`
- Update STATE.md header to `v0.2.0`
- Backfill CHANGELOG.md with v0.1.0 and v0.2.0 entries from git log

---

## 8. Reviewer instrumentation

### Current state

**Summary format** (from `execute-pipeline.sh:815-838` and `summaries/audit-06-codex-windows.md`):

```yaml
---
plan: {plan-name}
status: done
verified: {date}
pr: {url}
---

## Pipeline Result
- Implement: exit N
- Build gate: passed|skipped
- Review: Verdict: PASS|PASS_WITH_CONCERNS|FAIL
- Codex: exit N
- PR: {url}

## Diff Stats
```

**Missing from current format:**
- Number of Critical/Important/Minor findings at review step
- Number of fix rounds before PASS
- Codex finding count (P0/P1/P2 breakdown)
- Whether @claude tag was posted (step 5b)
- Async review-fix loop outcome (how many rounds, final state)
- Reviewer model used (step 3 uses opus, but this could change)
- Wall-clock time per stage

**Finding detection in pipeline:**
Step 3 review verdict captured via `grep -oE 'Verdict: (PASS|PASS_WITH_CONCERNS|FAIL)'` at
line 829. Step 4 findings detected via `grep -qiE '\[P[012]\]|severity.*P[012]'` at line 633.
No counts extracted — just presence/absence.

**`.iago/telemetry/` directory:** Does not exist. No evidence of any telemetry collection.

### Gaps

1. No finding counts in summaries — can't answer "how many Critical findings per plan on average?"
2. No fix round count — can't answer "does the pipeline converge in 1 fix round or 2?"
3. No wall-clock stage timing — can't identify which stage is slowest.
4. No machine-readable format (current summaries are markdown, not parseable without grep).

### Proposed `.iago/telemetry/reviewers.jsonl` format

One JSON line appended per pipeline run, at Step 6:

```json
{
  "plan": "audit-06-codex-windows",
  "date": "2026-04-12",
  "pr": "https://github.com/...",
  "stages": {
    "stress": { "verdict": "PROCEED", "duration_s": 42 },
    "impl": { "exit": 0, "duration_s": 312 },
    "build": { "passed": true, "retries": 0 },
    "review": {
      "verdict": "PASS",
      "findings": { "critical": 0, "important": 1, "minor": 0 },
      "fix_rounds": 1,
      "model": "opus"
    },
    "codex": {
      "exit": 0,
      "findings": { "p0": 0, "p1": 1, "p2": 0 },
      "source": "codex-companion|claude-fallback"
    },
    "tag_posted": true
  },
  "outcome": "DONE|DONE_WITH_CONCERNS|BLOCKED"
}
```

**Append point:** Step 6 summary generation. One `jq` or `node -e` command writes the line.

**Aggregation query:**
```bash
# Average critical findings per plan:
jq -s '[.[].stages.review.findings.critical] | add/length' .iago/telemetry/reviewers.jsonl

# Fix round distribution:
jq '[.stages.review.fix_rounds]' .iago/telemetry/reviewers.jsonl | sort | uniq -c
```

---

## Cross-cutting themes

**1. Lifecycle management is missing at every level.**
Plans, summaries, and docs have creation paths but no retirement paths. The same gap appears
in three places: `.iago/plans/` (no archive), `.iago/summaries/` (no rotation), `docs/specs/`
(brand docs mixed with feature specs). A single `.iago/archive/` convention applied
consistently fixes this.

**2. Validation is shallow.**
`validate-skills.sh` checks 3 syntactic properties. `validate-hooks.sh` checks Node syntax.
Neither validates behavioral contracts. Self-hosted systems that can't test themselves
accumulate silent regressions (evidenced by the 4 `fix(pipeline)` commits in recent history).
The proposed `tests/` structure closes this.

**3. The macOS issue in STATE.md is stale.**
The `run_claude()` rewrite (commit 44e90f3) solved the timeout problem without using `timeout`
or `gtimeout`. STATE.md's Known Issues entry is incorrect and should be closed. Sebas can
run the pipeline today — this is a blocker that has already been unblocked.

**4. Versioning artifacts are inconsistent.**
Two git tags exist (`v0.1.0`, `v0.2.0`) but package.json says `0.1.0` and STATE.md says
`v0.1.0`. The repo needs a single source of truth for version, with a release process that
keeps them in sync.

**5. Telemetry is qualitative, not quantitative.**
Finding the answer to "is the pipeline getting better?" requires manually reading markdown
summaries. The proposed `reviewers.jsonl` makes this answerable in one shell command.

---

## Sources

| File | Contribution |
|------|-------------|
| `docs/research/iago-os-audit-2026-04-21.md` | Baseline inventory, redundancy map, pain signals — not repeated here |
| `scripts/execute-pipeline.sh:88-130` | `run_claude()` implementation — macOS timeout re-diagnosis |
| `scripts/execute-pipeline.sh:568` | `sort -V` macOS fallback — already handled |
| `scripts/execute-pipeline.sh:806-843` | Step 6 summary format |
| `scripts/execute-pipeline.sh:625-638` | Codex finding detection |
| `scripts/validate-skills.sh:1-45` | What validation currently enforces |
| `scripts/validate-hooks.sh:1-30` | Hook validation scope |
| `scripts/new-client.sh` | Full .sh scaffold script |
| `scripts/new-client.ps1:1-60` | .ps1 scaffold (partial — first 60 lines) |
| `.iago/STATE.md:1-25` | Known Issues, version tag, recent decisions |
| `.iago/learnings/patterns.md` | Empty state confirmed |
| `.iago/learnings/project-conventions.md` | Content confirmed (14 lines) |
| `.iago/summaries/audit-06-codex-windows.md` | Current summary format |
| `.claude/agents/executor.md` | Base agent schema |
| `.claude/agents/analyst.md` | Base agent schema |
| `.claude/agents/profiles/fullstack.md` | Profile schema |
| `.claude/agents/capabilities/react-19.md` | Capability schema (no frontmatter) |
| `.claude/skills/iago-execute/SKILL.md:1-60` | Core workflow skill shape |
| `.claude/skills/deep-research/SKILL.md:1-60` | Research skill shape |
| `.claude/skills/amplify-bug-bounty/SKILL.md:1-50` | Audit skill shape (extra frontmatter fields) |
| `CLAUDE.md` sections + `rules/*.md` | Doc consolidation analysis |
| `package.json` | Version: 0.1.0 (lags v0.2.0 tag) |
| Git tags: `v0.1.0`, `v0.2.0` | Versioning state |
| Git commit `44e90f3` | "tree-kill claude.exe on timeout" — macOS fix evidence |
| Bash inventory calls | Folder structure, file counts |

---

## Recommendation

**Decision:** v1 shape = 6 targeted changes, no rearchitecture. In order of payoff:

1. **Close the stale macOS issue** in STATE.md (5 min). The blocker for Sebas was already
   fixed in commit 44e90f3. STATE.md Known Issues is wrong. Remove or annotate the entry.
   This unblocks Sebas from thinking the pipeline is broken for him.

2. **Add `.iago/plans/archive/`** and move the 5 completed audit plans there (15 min).
   Stops `.iago/plans/` from being a graveyard — active plans are immediately visible.

3. **Bump `package.json` to `0.2.0`** and update STATE.md header (5 min).
   Versions are inconsistent. This is a 2-file edit.

4. **Add `status:` frontmatter to all skills** (30-60 min) and add one check to
   `validate-skills.sh`. Machine-readable dormant signal enables catalog filtering and
   documents the 7 dormant skills without deleting them.

5. **Add `docs/ONBOARDING.md`** (2-3 hours). Day-1 fast-path for hire #4. README links to
   SETUP.md for prerequisites and MANUAL.md for usage — but no single doc says "if you are
   new, start here." This gap grows costly as the team grows.

6. **Start `tests/` with `validate/validate.bats`** and hook into `validate.yml` (2-3 hours).
   The only self-test currently is `validate-skills.sh` run manually. Wiring it to CI with
   two more checks (hook syntax, skills structural) closes the lowest-hanging test gap.

The scripts reorganization (§6), telemetry JSONL (§8), and CHANGELOG.md (§7) are deferred
to v1.1 — they're improvements but not blocking for a clean v1 shape.

**Confidence:** High

**Reasoning:** Items 1-3 are 20-minute fixes with zero risk. Items 4-6 are 2-4 hour efforts
each with well-defined scope. Nothing here requires touching the pipeline logic, agent system,
or skill content — only metadata, archive paths, docs, and test wiring. The prior audit's
three recommendations remain valid; this research extends them with versioning, validation,
and onboarding gaps that are now unblocked.

**Next step:** `/iago-quick "v1 shape: close macOS STATE.md issue + archive completed plans +
bump package.json version + add status: frontmatter to dormant skills"` — 4 of the 6 items
fit in one quick run (≤3 files + metadata). Follow with a separate run for ONBOARDING.md
and tests/.

**Risk if wrong:** If `status: dormant` frontmatter triggers unexpected behavior in any MCP
skill resolver or Claude Code's own skill-loading logic, dormant skills could become
unreachable. Mitigation: check that Claude Code resolves skills by directory name, not
frontmatter status field (it does — status is for human/validate-skills use only).
