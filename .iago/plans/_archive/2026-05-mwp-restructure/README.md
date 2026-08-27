# 2026-05 — MWP restructure (superseded)

**Archived:** 2026-08-26 · **Superseded by:** `.iago/plans/feature-doc-standard/`

Three plan stacks from May 2026 that set out to restructure the repo along MWP
layer lines: `feature-mwp-restructure-docs/`, `-clients/`, `-code/`.

## What shipped and what did not

| Stack | Plan | State |
|---|---|---|
| docs | `01-claude-md-trim.md` | **shipped** — PR #77 |
| docs | `02-docs-folder-consolidation.md` | **shipped** — PR #79 |
| docs | `03-roadmap-and-project-md.md`, `04-runtime-claude-md.md` | never executed |
| clients | `01`–`05` (root registry, din / fulldata / palazuelos / rsf shells) | never executed |
| code | `01`–`03` (physical split, scripts restructure, cleanup) | never executed |

The root taxonomy those two merged PRs established is sound and MWP-aligned —
the 2026-08-26 audit (`.iago/research/2026-08-26-doc-standard-audit.md`) confirms
it. What failed was everything downstream: the client half never ran, so seven
clients carry seven different `.iago/` layouts, and nothing machine-checked the
schema, so the pipeline's own scratch accumulated at `.iago/` root.

`feature-doc-standard/` replaces all three. It keeps the layer model, drops the
per-stack numbering, and adds the thing that was missing: `scripts/organize/iago-lint.py`,
which computes conformance instead of asking a human to remember it.

## One file here is carry-forward, not dead history

**`feature-mwp-restructure-code/01-iago-physical-split.md` § "Stress-test BLOCK fix
(C1+C3)".** Read it before executing `feature-doc-standard/02-root-cleanse.md` Task 5.

It holds the atomic-Bash-call fix for moving `.iago/hooks/` → `.iago/_config/hooks/`:
`safety-guard.mjs` and `commit-quality.mjs` are `PreToolUse` hooks matched on `Bash`,
so the instant the `git mv` lands, the *next* Bash call resolves them from a path that
no longer exists — `MODULE_NOT_FOUND`, session dead, and the crashing call is the verify
step itself. The move and every settings rewrite must therefore happen inside **one**
Bash invocation: `PreToolUse` fires once from the old path (still valid), the whole
sequence runs, and the next call fires from the new path (valid, because the settings
were rewritten in the same call).

`feature-doc-standard` did not inherit that fix and re-derived it in stress. Archiving
this folder as "superseded, ignore" is exactly what would let the same hour be spent a
third time — hence this section.

Two claims in that section are **wrong** and were corrected on re-reading:

- `.claude/settings.json` is **not** config-protected. `.iago/hooks/config-protection.mjs`
  blocks `biome.json`, `biome.jsonc`, `tsconfig.json`, `.gitignore` and `Dockerfile` by
  exact name, plus eslint/prettier/vite/tailwind/postcss/`.env`/docker-compose patterns —
  `settings.json` is on neither list. The Edit tool works on it; the `sed -i` workaround
  the plan prescribes is unnecessary (though still harmless inside the one atomic call,
  which is required for the hook-path reason above, not for a protection reason).
- There are **8** hook `.mjs` files, not ≥9: `commit-quality`, `config-protection`,
  `context-persistence`, `post-edit-console-warn`, `post-edit-format`, `post-edit-typecheck`,
  `safety-guard`, `usage-tracker`. `lib/` holds four more modules, imported relatively.

## Do not execute these

An archived plan is never run without being re-stress-tested against the current
roadmap first. These three are worse than stale — `feature-doc-standard/README.md`
§2 changed the target tree (`_config/` gained `context/`, `decisions/`, `learnings/`,
`prompts/` and `hooks/`; `reviews/`, `logs/`, `runs/` and `pipeline-runs/` moved
under `state/`), so their move lists would now produce violations rather than fix
them. Read them as evidence of what was tried, not as instructions — with the one
carry-forward exception named above.

## On the roadmap pointer

The archive convention asks for a roadmap row. `.iago/ROADMAP.md` is the **iaGO-OS
v2 daemon** roadmap — phases 0 through 12 of a cutover off OpenClaw — and workspace
hygiene is not one of its phases. Rather than bend a delivery roadmap around a
maintenance workstream, `ROADMAP.md` now carries a short *Workspace hygiene*
section naming `feature-doc-standard/` and pointing here; the phase table itself
stays about the daemon.
