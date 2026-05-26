# feature-mwp-restructure-docs — workstream brief

**Created:** 2026-05-25
**Source audit:** `.iago/research/2026-05-25-mwp-restructure-audit.md`
**Sibling workstreams (NOT planned yet):** `feature-mwp-restructure-code/`, `feature-mwp-restructure-clients/` — both deferred until v2 VPS cutover (tonight 2026-05-25 20:00 US/Mexico) stabilizes (target re-plan: 2026-05-29 morning).

## Goal

Land the **doc-only** half of the MWP restructure in parallel with v2 cutover. Zero risk to pipeline execution, daemon startup, hook chain, or scripts/. Every task in every plan in this folder touches only `.md` files, creates new files, or moves files within doc/spec namespaces — nothing that the running pipeline, the cutover, or the v2 daemon depends on at execution time.

## Why this ships separately from code + clients

Per audit §7.1 (cutover collision) and §9 (3-folder split rationale):

| Risk class | Folder | Cutover gate |
|---|---|---|
| Doc-only (this folder) | `feature-mwp-restructure-docs/` | NONE — ship today |
| Code-touching (`.iago/` physical split, scripts/ reshape, mcp-servers/ move) | `feature-mwp-restructure-code/` (NOT YET PLANNED) | POST-CUTOVER (target 2026-05-29) |
| Per-client shells (din, palazuelos, rsf — repo-is-client clients SKIPPED) | `feature-mwp-restructure-clients/` (NOT YET PLANNED) | POST-CODE; one client per week |

## Plans in this folder

| Plan | Wave | Deps | Scope |
|---|---|---|---|
| 01-claude-md-trim | 1 | — | CLAUDE.md → **≤70 lines** (reserves 10-line headroom for Plan 04) + drop-in `## Doc routing` from mwp-routing-rule spec + extract Tech Stack / Output Style / Memory Architecture / Code Standards to `.claude/rules/{stack,output-style,memory}.md` (Code Standards collapses to 1-line pointer to existing path-scoped rules) + README.md → public-only trim |
| 02-docs-folder-consolidation | 2 | 01 | docs/ collapsed per audit §1.4 — archive/research/automations/patterns moved; ARCHITECTURE/SETUP/MANUAL/WORKFLOW/GITHUB-PIPELINE/IAGO-DASHBOARD merged or relocated; README dead-link cleanup for the 4 deleted MDs; zero `.md` files at `docs/` root |
| 03-roadmap-and-project-md | **3** | **01, 02** | `.iago/ROADMAP.md` + `.iago/PROJECT.md` created; 3 active specs (v2-vision, v2-master-prompt, sentry-integration) → `.iago/_config/specs/` (sweeps ~354 live cross-refs); 7 shipped/superseded specs → `.iago/_archive/specs/2026-04-historical/` (joining Plan 02's 2 archived specs there) |
| 04-runtime-claude-md | 2 | 01 | `runtime/CLAUDE.md` Layer 0 declaration (with pre-flight v2-vision path detection so it works whether Plan 03 ran first or not) + Workspace map (≤10 lines, fits exactly in Plan 01's reserved headroom) + register `runtime/` and `mcp-servers/` as Level B sub-workspaces in root `.iago/CONTEXT.md` |

**Wave 1:** Plan 01 alone. CLAUDE.md trim must land first; budget revised to ≤70 lines (not ≤80) to reserve 10-line headroom for Plan 04's append.
**Wave 2:** Plans 02 and 04 in parallel (Plan 02 = docs/, Plan 04 = runtime/CLAUDE.md + workspace map; no file overlap).
**Wave 3:** Plan 03 (depends on Plan 02 — both write to `.iago/_archive/specs/2026-04-historical/`; sequential to avoid race + collision on docs/specs/ deletion ordering).

Wave change from initial plan: original had Plans 02/03/04 all in wave 2 parallel; stress test (Plan 03 §C-1) caught the wave-2 race between Plans 02 and 03 over the shared archive directory and Plan 02's deletion of `docs/` interfering with Plan 03's `docs/specs/` cleanup. Plan 04 stays wave 2 (no file overlap with Plan 02 — Plan 04 touches CLAUDE.md, .iago/CONTEXT.md, runtime/, mcp-servers/; Plan 02 touches docs/ and README.md).

## Inputs (audit references)

- §1 — repo inventory with per-file Layer classification
- §1.4 — `docs/` consolidation target paths
- §3 — duplication map (which sections of CLAUDE.md/README.md to delete because they live in `.claude/rules/`)
- §5 — cross-references that break (none in doc-only scope; code-touching breaks live in code folder)
- §6 — orphans (`docs/archive/`, shipped specs)
- §7.1 — cutover gate (this folder is safe; code/clients folders are not)
- §10.5 — Santiago's approved decisions (7-Q matrix)
- `docs/specs/iago-os-mwp-routing-rule.md` lines 40-63 — drop-in content for CLAUDE.md `## Doc routing` section
- `docs/specs/iago-os-roadmap.md` — source content for `.iago/ROADMAP.md`
- `templates/internal-project/.iago/PROJECT.md.template` — scaffold for `.iago/PROJECT.md`

## Acceptance for the whole folder (run after all 4 plans ship)

- `wc -l CLAUDE.md` ≤ 80
- `wc -l README.md` ≤ 220
- `ls docs/*.md` empty (or `docs/` directory deleted)
- `test -f .iago/ROADMAP.md && test -f .iago/PROJECT.md` pass
- `test -f runtime/CLAUDE.md` pass
- `grep -c "Doc routing" CLAUDE.md` ≥ 1
- `.claude/rules/{stack,output-style,memory,patterns}.md` (or `patterns/`) all exist
- Pipeline still runs: `scripts/execute-pipeline.sh --help` exits 0 (smoke test)
- Hooks still fire: any edit triggers `.iago/hooks/post-edit-format.mjs` (visible in tool output)
- No paths referenced by `execute-pipeline.sh`, hooks, or skills were moved

## Out of scope (defer to code folder)

- Any change to `scripts/`, `.iago/hooks/`, `.claude/settings.json`
- Any change to `.iago/{plans,summaries,reviews,runs,logs,pipeline-runs}/` paths
- Any change to `mcp-servers/` location
- Any change to `runtime/` internals (only `runtime/CLAUDE.md` creation, no moves)
- Any change to `clients/` (defer to clients folder)
- Any change to `.iago/CONTEXT.md` folder map beyond Layer-B sub-workspace registration (the `_config/`/`product/`/`state/`/`_archive/` physical layout is a code-folder concern even though `_archive/` gets populated here)
- Any change to root `package.json` content

## Pipeline expectations

This folder ships through the standard `/iago-execute feature-mwp-restructure-docs` pipeline (8 stages: stress → impl → build gate → review → codex → fix → PR → tag @claude). One PR per plan, four PRs total. Plan 01 ships first; once merged, Plans 02/03/04 can dispatch in parallel.
