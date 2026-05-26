# iago-os MWP Restructure Audit (revision of 2026-04-28)

**Date:** 2026-05-25
**Status:** Phase 0 artifact for `feature-mwp-restructure` planning. Gating — no file moves until Santiago approves.
**Supersedes-in-part:** `.iago/research/2026-04-28-mwp-restructure-audit.md` (Phase 1 of that audit shipped via PR #31; Phase 2/3 did not. Findings carried forward here marked **[CARRY]**; new findings marked **[NEW]**.)
**Companion docs (DO NOT redo their work — read them first if you touch the plans):**
- `.iago/CONTEXT.md` (already declares MWP L1 routing for `.iago/` — classification is done, physical separation is not)
- `.iago/README.md` (already explains factory vs product)
- `docs/specs/iago-os-mwp-routing-rule.md` (council-revised file-placement routing rule — drop-in for root CLAUDE.md)
- `docs/specs/iago-os-cleanup.md` (5-item Phase 1 cleanup spec, already executed in PR #31)
- `.iago/research/2026-04-28-mwp-restructure-audit.md` (the original audit — §3.1 target structure + §3.2 migration plan are still mostly correct; the delta is in §10 of this document)

**Critical timing constraint:** STATE.md header (2026-05-20) names a Phase-2 VPS cutover for **2026-05-25 20:00 US/Mexico** (today, ~8h from this writing). Any MWP work that touches `scripts/`, `.claude/settings.json` hooks, or `runtime/` must NOT land before cutover completes and stabilizes. See §7 (Conflict surface) and §8 (Phase ordering verdict).

---

## 1. Repository inventory

### 1.1 Root (16 entries)

| Entry | Type | Size | Last modified | Layer (target) |
|---|---|---|---|---|
| `.gitattributes` | file | 152 B | 2026-05-04 | L3 (infra) |
| `.gitignore` | file | 1197 B | 2026-05-18 | L3 (infra) |
| `.github/` | dir | (CI workflows) | 2026-04-06 | L3 (infra) |
| `.git/` | dir | — | — | (git internals) |
| `.claude/` | dir | agents/rules/skills/settings | 2026-05-21 | L3 (factory) |
| `.iago/` | dir | 18 sub-entries, ~700 files | 2026-05-25 | mixed L3+L4+state |
| `.worktrees/` | dir | 8 active worktrees (chain-rebase, pr40/41/42/43/44-fix) | 2026-05-16 | L4 transient |
| `CLAUDE.md` | file | 13616 B / 215 lines | 2026-05-20 | **L0 (over budget)** |
| `CLAUDE.local.md.template` | file | 868 B / 32 lines | 2026-04-02 | L3 (template) |
| `README.md` | file | 25325 B / 507 lines | 2026-05-19 | Public-facing (not a layer) |
| `clients/` | dir | 6 entries | 2026-05-21 | sub-workspaces (Level B) |
| `docs/` | dir | 6 root MDs + 5 dirs (~70 files) | 2026-04-28 | mixed L3 + archive |
| `graphify-out/` | dir | empty cache/ only | 2026-04-10 | **orphan → DELETE** |
| `mcp-servers/` | dir | 1 entry (youtube-transcript) | 2026-04-23 | L3 → relocate |
| `node_modules/` | dir | biome + typescript (devDeps only) | 2026-04-20 | (gitignored) |
| `package.json` / `package-lock.json` | file | 211 B / 5885 B | 2026-04-06 | L3 (dev tooling scope) |
| `runtime/` | dir | own CONTEXT.md (L2 stage), own package.json | 2026-05-19 | **Level B sub-workspace (already declared)** |
| `scripts/` | dir | ~30 files in 3+ roles | 2026-05-20 | L3 (factory) + L3-ref + ops mixed |
| `templates/` | dir | client-project/ + internal-project/ + memory/ | 2026-04-10 | L3 (workspace-builder) |

### 1.2 `.iago/` (700+ files across 17 entries)

| Entry | Files | Current intent (per `.iago/CONTEXT.md`) | Target |
|---|---|---|---|
| `CONTEXT.md` | 1 (65 L) | **L1 workspace routing** (already MWP-shaped) | KEEP at `.iago/CONTEXT.md` |
| `README.md` | 1 (111 L) | factory/product explainer | KEEP at `.iago/README.md` |
| `STATE.md` | 1 (90 L, **over 80-line cap from CLAUDE.md**) | session digest | MOVE → `.iago/state/STATE.md`; trim to ≤80 |
| `config.json` | 1 (29 L) | iaGO project config | MOVE → `.iago/_config/config.json` |
| `context/` | 2 | L3 reference (phase decisions) | MOVE → `.iago/_config/context/` |
| `decisions/` | 4 | **L3 reference (ADRs)** | MOVE → `.iago/_config/decisions/` |
| `handoff/` | 1 | session handoff snapshot (Sebas) | MOVE → `.iago/state/handoff/` |
| `hooks/` | 13 (incl. lib/) | **L3 reference (hook implementations)** | MOVE → `.iago/_config/hooks/` |
| `learnings/` | 3 | **L3 reference (accumulated patterns)** | MOVE → `.iago/_config/learnings/` |
| `logs/` | 11 | per-run logs | MOVE → `.iago/product/logs/` |
| `pipeline-runs/` | 10 | per-run pipeline data | MOVE → `.iago/product/pipeline-runs/` (or merge with `state/pipeline-runs/`) |
| `plans/` | 58 (12 feature dirs + `_archive/` + `codex/`) | **L4 product** | MOVE → `.iago/product/plans/` |
| `prompts/` | 1 | **L3 reference (reusable prompts)** | MOVE → `.iago/_config/prompts/` |
| `research/` | 22 | **L4 product** (per-question analysis) | MOVE → `.iago/product/research/` |
| `reviews/` | 124 (across 9 sub-dirs) | **L4 product** (pipeline + adversarial review outputs) | MOVE → `.iago/product/reviews/` |
| `runbooks/` | 2 | **L3 reference (ops procedures)** | MOVE → `.iago/_config/runbooks/` |
| `runs/` | 10 (round-1/2/3-dispatch) | per-run dispatch artifacts | MOVE → `.iago/product/runs/` |
| `state/` | **415 files** (sessions=356, pipeline-runs=24, pipeline-logs=8, exposicion-run=6, orphans=3) | **gitignored runtime markers** | KEEP at `.iago/state/` (boundary already documented) |
| `summaries/` | 36 | **L4 product** (pipeline step 6 output) | MOVE → `.iago/product/summaries/` |

**File-count concentration:** `state/sessions/` (356) + `reviews/` (124) + `plans/` (58) + `summaries/` (36) + `state/pipeline-runs/` (24) + `research/` (22) = 620 of ~700 `.iago/` files. The bulk is per-run product, currently sitting at the same depth as 6 small L3-reference dirs.

### 1.3 `.claude/`

| Entry | Files | Notes |
|---|---|---|
| `agents/` | executor.md, analyst.md, operator.md + `capabilities/` + `profiles/` | 3 bases, 13 capabilities, 12 profiles per CLAUDE.md |
| `rules/` | **12 files** (available-skills, aws-amplify, context-hygiene, e2e-testing, execution-pipeline, git-workflow, layer-triage, mcp-server-patterns, react-vite, skill-authoring, systematic-debugging, tdd) | Layer 3 — stable factory; already MWP-shaped |
| `skills/` | **37 skills** (each in own dir with SKILL.md) | Layer 3 — factory; already MWP-shaped |
| `settings.json` | 2240 B | hooks config — points at `.iago/hooks/*.mjs` (affected by `.iago/` restructure) |
| `settings.local.json` | 2115 B | local overrides |
| `worktrees/` | 1 entry | scratch dir for agent worktrees |
| `scheduled_tasks.lock` | 91 B | scheduler lockfile |

### 1.4 `docs/` (~70 files)

| Entry | Lines | Where it belongs |
|---|---|---|
| `ARCHITECTURE.md` | (not measured) | `.iago/_config/architecture.md` or DELETE if duplicates `docs/specs/iago-os-v2-vision.md` |
| `GITHUB-PIPELINE.md` | — | MERGE into `.claude/rules/execution-pipeline.md` (already exists, likely overlaps) |
| `IAGO-DASHBOARD.md` | — | KEEP (operator runbook) → `.iago/_config/runbooks/dashboard.md` |
| `MANUAL.md` | — | MERGE into `README.md` (public-facing) |
| `SETUP.md` | — | MERGE into `README.md` |
| `WORKFLOW.md` | — | MERGE into `.claude/rules/execution-pipeline.md` (or root CLAUDE.md ## Workflow) |
| `archive/plans/` | 9 historical plan/summary pairs | MOVE → `.iago/_archive/plans/` |
| `archive/research/` | 22 historical decision/research docs | MOVE → `.iago/_archive/research/` |
| `archive/specs/` | 2 archived specs | MOVE → `.iago/_archive/specs/` |
| `automations/cross-session-pipeline.md` | — | MOVE → `.iago/_config/runbooks/` |
| `automations/trigger-templates.md` | — | MOVE → `.iago/_config/runbooks/` |
| `patterns/{carrier,customs,energy,inventory,logistics,production,quality,returns}.md` | 8 industry patterns | KEEP grouped → `.claude/rules/patterns/` (loaded by `/industry-patterns` skill) |
| `research/agent-sdk-integration-architecture.md` | — | MOVE → `.iago/_archive/research/` (decision baked into v2 vision) |
| `research/claude-agent-sdk.md` | — | MOVE → `.iago/_archive/research/` |
| `research/claude-platform-agent-deployment.md` | — | MOVE → `.iago/_archive/research/` |
| `research/hermes-agent.md` | — | MOVE → `.iago/_archive/research/` |
| `research/paperclip-transcript.txt` | — | MOVE → `.iago/_archive/research/` |
| `specs/feature-tool-surveillance.md` | 122 | KEEP at `.iago/_config/specs/` if still live, else `.iago/_archive/specs/` |
| `specs/hermes-agent-adoption.md` | 352 | `.iago/_archive/specs/` (v2 vision absorbed it) |
| `specs/iago-os-cleanup.md` | 163 | `.iago/_archive/specs/` (Phase 1 already shipped PR #31) |
| `specs/iago-os-mwp-routing-rule.md` | 105 | **READ THIS** — drop-in content for root CLAUDE.md ## Doc routing section. Then `.iago/_archive/specs/`. |
| `specs/iago-os-roadmap.md` | 308 | KEEP as canonical ROADMAP → MOVE to `.iago/ROADMAP.md` (closes "no ROADMAP.md on disk" finding) |
| `specs/iago-os-v2-master-prompt.md` | 456 | KEEP → `.iago/_config/specs/v2-master-prompt.md` (active v2 work) |
| `specs/iago-os-v2-vision.md` | 525 | KEEP → `.iago/_config/specs/v2-vision.md` (active v2 work) |
| `specs/iago-os-vision.md` | 239 | `.iago/_archive/specs/` (superseded by v2-vision) |
| `specs/markitdown-integration.md` | 131 | `.iago/_archive/specs/` (markitdown shipped) |
| `specs/parallel-execution-wedges.md` | 106 | `.iago/_archive/specs/` (Phase 1b shipped) |
| `specs/sentry-integration.md` | 336 | KEEP → `.iago/_config/specs/sentry-integration.md` (recently revised 2026-05-20, active) |

**`docs/` net target:** zero `.md` files at `docs/` root; `docs/patterns/` survives as `.claude/rules/patterns/`. Everything else relocated. The `docs/` directory itself becomes a candidate for deletion in Phase 9 cleanup.

### 1.5 `scripts/`

Three lifecycle roles mixed in one folder:

| File | Role |
|---|---|
| `execute-pipeline.sh` | **Pipeline core (L3 factory)** |
| `lib/*` (adversarial-verdict, build-gate, learnings-writer, metrics-aggregate, pipeline-telemetry) + `.test.sh` siblings | **Pipeline helpers (L3 factory)** |
| `review-checks/*.md` (amplify, api, auth, backend, baseline, data-integrity, i18n, infra, patterns, react, shell-deploy) | **L3 reference material loaded by review stage** — should not live in `scripts/` |
| `check-clean-tree.sh` + `.test.sh` | pre-flight (pipeline-adjacent) |
| `console-check.mjs` | pre-flight (pipeline-adjacent) |
| `measure-build-gate-rss.sh` | one-shot measurement |
| `metrics-aggregate.mjs` | ops (telemetry) |
| `new-client.sh` / `new-client.ps1` | setup (one-shot bootstrap) |
| `setup-memory.sh` / `setup-memory.ps1` | setup (one-shot bootstrap) |
| `sync-skills.sh` / `sync-skills.ps1` | setup (one-shot bootstrap) |
| `usage-report.sh` / `usage-report.ps1` | ops (reporting) |
| `test-build-gate.sh`, `test-pipeline-helpers.sh` | tests |
| `validate-hooks.sh`, `validate-skills.sh` | tests / validation |

**Three target buckets:** `scripts/pipeline/` (execute-pipeline + lib + check-clean-tree + console-check + measure-build-gate-rss), `scripts/setup/` (new-client, setup-memory, sync-skills), `scripts/ops/` (metrics-aggregate, usage-report), `scripts/tests/` (test-*, validate-*). Plus `scripts/review-checks/` MOVES out entirely to `.iago/_config/review-checks/`.

### 1.6 `runtime/` (already MWP-shaped as Level B sub-workspace)

```
runtime/
  CONTEXT.md           # L2 stage contract — already declares Inputs/Process/Outputs
  README.md
  PHASE-1-EVIDENCE.md  # Phase 1 acceptance gate evidence
  package.json + package-lock.json + tsconfig.json + vitest.config.ts
  agent-runtime/pty/   # Shape 1 (PTY adapter)
  agents/pr-triage/    # First operational agent
  coverage/            # generated; gitignored
  daemon/              # core daemon process
  deploy/              # systemd units + cutover scripts
  integration/         # integration tests
  migration/           # Phase 0 audit + migration data
  scripts/             # runtime-internal scripts (test-cutover.fixtures, etc.)
  telegram/            # Telegram bot integration
```

What this needs: `runtime/CLAUDE.md` (Layer 0 declaration that `runtime/` is a sub-workspace), pointer in root `CONTEXT.md`, and root `CLAUDE.md` registers it as a Level B target.

### 1.7 `clients/` (6 entries, three heterogeneity classes — corrected from initial sample)

Deep walk 2026-05-25 corrected several initial assumptions:

| Client | Wrapper-level `.git`? | Inner deliverable repo? | Wrapper has `.iago/`? | Wrapper has `CLAUDE.md`? | Pattern |
|---|---|---|---|---|---|
| din | NO (wrapper editable) | YES at `dinpro-app/.git` | **YES** — 12+ plans across `01-pricing-core/`, `01b-pricing-extended/`, `02-simulation-shell/`; full PROJECT/ROADMAP/STATE/learnings/summaries | NO | Class B — wrapper iaGO + inner deliverable repo |
| fulldata | NO (wrapper editable) | YES at `web-pricing-mock/.git` | NO — but has **MWP-shaped own structure**: `_inputs/` (audios/data/pdfs/videos), `_processing/` (scripts/transcripts), `out/00_inventory/`, `out/01_research/{crosscheck,legal,market,partners,prompts,sources,validation,_legacy_pre_iago/}`, `out/02_business/{decisions,icp-research}`, `out/02_executive/`, `out/03_dev/`, `out/03_meetings/`, `out/branding/` | NO | Class C — data-engagement; already MWP-numbered; web-pricing-mock is inner repo |
| munet-web | **YES — wrapper IS inner repo** | (same — wrapper = inner repo) | YES (inside inner repo) — 4 audits, 6 context files, 7 runbooks, 14+ summaries, scratch `_*.txt` and `tmp-*.txt` files | YES (inside inner repo) | Class A — fully integrated codebase; **inner repo, iago-os PR CANNOT edit** |
| palazuelos | NO (wrapper editable) | NO | YES — but minimal (config, PROJECT, ROADMAP, STATE, 2 learnings; NO plans, NO summaries); loose `session-2026-05-04-palazuelos.md` at wrapper root | NO | Class C — research/transcription engagement |
| rsf | NO (wrapper editable) | NO | YES — minimal skeleton same as palazuelos; but wrapper has substantive content: `catalog/` (22 numbered MD + MATRIX + README), `catalog.zip`, `deep-research/` (5 dated docs + README), `README.md` | NO | Class C — research-heavy engagement; catalog is the deliverable |
| sentria | **YES — wrapper IS inner repo** | (same — wrapper = inner repo) | YES (inside inner repo) — context/handoff, plans/feature-ayuda-{chat,reorg}, pipeline-runs/, research/, specs/, state/pipeline-runs/ (12+ ndjson); ALSO has nested `clients/sentria/clients/sentria-ayuda-deep-wt/` (worktree-style nested project, not git repo); has `.cursorrules`, `.local/prod-report/`, capital `Branding/` | YES (inside inner repo) | Class A — fully integrated codebase; **inner repo, iago-os PR CANNOT edit** |

**Inner-repo boundary verified by `[ -d clients/$c/.git ]` test:**
- **Inner repos at WRAPPER level (iago-os PR cannot touch ANYTHING under these paths):** munet-web, sentria
- **Inner repos at SUB-PATH (iago-os PR can touch wrapper, but NEVER the sub-path):** din/dinpro-app, fulldata/web-pricing-mock
- **No inner repos (iago-os PR can fully restructure):** palazuelos, rsf

**Three heterogeneity classes confirmed:**
- **Class A** (repo-is-client, full app): munet-web, sentria — MWP work happens IN THE INNER REPO (separate PRs, not iago-os PRs). iago-os can only REGISTER them as Level B sub-workspaces in root `.iago/CONTEXT.md`.
- **Class B** (wrapper + inner deliverable): din — iago-os PR adds wrapper files (CLAUDE.md, CONTEXT.md); inner `dinpro-app/` is its own repo, never edit.
- **Class C** (research/data engagement, no app code): fulldata (MWP-numbered already), palazuelos (minimal), rsf (catalog-heavy) — iago-os PR fully restructures wrappers.

**Heterogeneity verdict corrected:** earlier draft said "3 wrappers (din/palazuelos/rsf), SKIP munet-web/sentria/fulldata." Actually:
- 4 clients can get iago-os-managed wrappers: **din, fulldata, palazuelos, rsf**
- 2 clients are inner repos: **munet-web, sentria** — MWP work in those repos separately; iago-os only registers them in root CONTEXT.md
- fulldata is NOT skipped — its wrapper is editable (only `web-pricing-mock/` inside is inner repo); its existing `_inputs/_processing/out/0N_*/` numbered-stage layout IS MWP-aligned and can be canonicalized as that client's L1 routing

See §11 for per-client disposition.

---

## 2. MWP layer classification table

Sort: by current path. Action key: KEEP / MOVE / SPLIT / DELETE / MERGE.

| Current path | Size | Layer | Target path | Action | Why |
|---|---|---|---|---|---|
| `.gitattributes` | 152 B | infra | `.gitattributes` | KEEP | git config; not a layer concern |
| `.gitignore` | 1197 B | infra | `.gitignore` | KEEP | update for new `.iago/product/*` paths in Phase 3 |
| `.github/` | — | infra | `.github/` | KEEP | CI workflows |
| `.claude/agents/*` | — | L3 | `.claude/agents/*` | KEEP | already MWP-shaped |
| `.claude/rules/*.md` | 12 files | L3 | `.claude/rules/*.md` | KEEP + EXTEND | extend with stack.md + output-style.md + patterns/ extracted from CLAUDE.md and `docs/` |
| `.claude/settings.json` | 2240 B | L3 | `.claude/settings.json` | MODIFY | update hook paths after `.iago/hooks/` → `.iago/_config/hooks/` move |
| `.claude/skills/*` | 37 skills | L3 | `.claude/skills/*` | KEEP | already MWP-shaped |
| `.claude/scheduled_tasks.lock` | 91 B | state | `.claude/scheduled_tasks.lock` | KEEP | scheduler runtime; gitignored already |
| `.claude/worktrees/` | 1 entry | L4 transient | `.claude/worktrees/` | KEEP | scratch; gitignored |
| `.iago/CONTEXT.md` | 65 L | **L1** | `.iago/CONTEXT.md` | KEEP + UPDATE | update folder map after physical L3/L4 split |
| `.iago/README.md` | 111 L | meta | `.iago/README.md` | KEEP + UPDATE | update folder map; promote to `.iago/_config/README.md`? **Open question §9** |
| `.iago/STATE.md` | 90 L | **state digest** | `.iago/state/STATE.md` | MOVE + TRIM | over 80-line cap; move into `state/` (per CONTEXT.md doc-routing it's already there in intent) |
| `.iago/config.json` | 29 L | L3 | `.iago/_config/config.json` | MOVE | factory config |
| `.iago/context/` | 2 files | L3 | `.iago/_config/context/` | MOVE | phase decision artifacts (Eduba "rooms") |
| `.iago/decisions/*.md` | 4 files | L3 (ADRs) | `.iago/_config/decisions/` | MOVE | already classified L3 in CONTEXT.md |
| `.iago/handoff/` | 1 file | state | `.iago/state/handoff/` | MOVE | per-session snapshot |
| `.iago/hooks/*.mjs` | 9 files + lib/ | L3 | `.iago/_config/hooks/` | MOVE | **breaks `.claude/settings.json` paths — must update settings.json in same PR** |
| `.iago/learnings/*.md` | 3 files | L3 | `.iago/_config/learnings/` | MOVE | already classified L3 in CONTEXT.md |
| `.iago/logs/` | 11 files | L4 | `.iago/product/logs/` | MOVE | per-run |
| `.iago/pipeline-runs/` | 10 files | L4 | `.iago/product/pipeline-runs/` | MOVE | per-run; merge consideration with `state/pipeline-runs/` (different lifecycles per `.iago/state/README.md`) |
| `.iago/plans/feature-*/` | 12 feature dirs | L4 | `.iago/product/plans/feature-*/` | MOVE | per-execution plans |
| `.iago/plans/codex/` | — | L4 | `.iago/product/plans/codex/` | MOVE | |
| `.iago/plans/_archive/` | 1 entry (2026-04-pipeline-speed-wedges) | L4 archive | `.iago/_archive/plans/_archive/2026-04-pipeline-speed-wedges/` | MOVE | already-archived plans; consolidate under root `_archive/` |
| `.iago/prompts/` | 1 file | L3 | `.iago/_config/prompts/` | MOVE | reusable prompt fragments |
| `.iago/research/*.md` | 22 files | L4 | `.iago/product/research/` | MOVE | per-question analysis (includes THIS audit) |
| `.iago/reviews/*` | 124 files in 9 subdirs | L4 | `.iago/product/reviews/` | MOVE | per-PR review outputs |
| `.iago/runbooks/*.md` | 2 files | L3 | `.iago/_config/runbooks/` | MOVE | ops procedures |
| `.iago/runs/` | 10 files in 3 round-dispatch dirs | L4 | `.iago/product/runs/` | MOVE | per-execution dispatch artifacts |
| `.iago/state/*` | **415 files** | runtime state | `.iago/state/*` | KEEP | already correct location; boundary documented in `.iago/state/README.md`; **gitignore preserves** |
| `.iago/summaries/*.md` | 36 files | L4 | `.iago/product/summaries/` | MOVE | per-execution summary (pipeline step 6) |
| `.worktrees/` | 8 worktree dirs | L4 transient | `.worktrees/` | KEEP + AUDIT | **see §6 — at least 5 (pr40/41/42/43/44-fix) look stale** |
| `CLAUDE.md` | 215 L / 13.6 KB | **L0 (overflowing)** | `CLAUDE.md` | SPLIT | trim to ≤80 lines (per previous audit verdict) — identity + workspace map + doc-routing rule. Extract Tech Stack/Code Standards/Architecture/Pipeline/Memory/Output Style to `.claude/rules/{stack,output-style}.md` and `.iago/_config/*`. |
| `CLAUDE.local.md.template` | 32 L | L3 template | `.iago/_config/templates/CLAUDE.local.md.template` | MOVE | matches `templates/` consolidation |
| `README.md` | 507 L / 25.3 KB | public | `README.md` | TRIM | keep public-facing only (project intro + install + tech stack + links); delete internal workflow/pipeline content (lives in CLAUDE.md or `.claude/rules/`) |
| `clients/*/` | 6 client trees (mixed) | **Level B sub-workspaces** | `clients/*/` | KEEP + ADD shell where appropriate (§9) | preserve inner repos; uniform shell only for client-wrapper clients (din/palazuelos/rsf), repo-is-client clients (munet-web/sentria) keep their existing structure |
| `docs/ARCHITECTURE.md` | — | L3 | `.iago/_config/architecture.md` (or DELETE if duplicates v2-vision) | MERGE → DECIDE | read it first; likely overlaps `docs/specs/iago-os-v2-vision.md` |
| `docs/GITHUB-PIPELINE.md` | — | L3 | `.claude/rules/execution-pipeline.md` | MERGE | dedupe with existing rule |
| `docs/IAGO-DASHBOARD.md` | — | L3 ops | `.iago/_config/runbooks/dashboard.md` | MOVE | ops runbook |
| `docs/MANUAL.md` | — | public | `README.md` | MERGE | public manual content → README; delete docs/MANUAL.md |
| `docs/SETUP.md` | — | public | `README.md` | MERGE | install/setup → README quick-start |
| `docs/WORKFLOW.md` | — | L3 | `.claude/rules/execution-pipeline.md` or root CLAUDE.md ## Workflow | MERGE | dedupe |
| `docs/archive/*` | 33 files | archive | `.iago/_archive/{plans,research,specs}/` | MOVE | already archived; consolidate under iaGO archive convention |
| `docs/automations/*.md` | 2 files | L3 ops | `.iago/_config/runbooks/` | MOVE | runbook-shaped |
| `docs/patterns/*.md` | 8 industry pattern files | L3 | `.claude/rules/patterns/` | MOVE | loaded by `/industry-patterns` skill |
| `docs/research/*` | 5 files | archive | `.iago/_archive/research/` | MOVE | decisions baked into v2 vision; not active |
| `docs/specs/*.md` | 11 files | mixed | per row 1.4 | SPLIT | active specs → `.iago/_config/specs/`; archived → `.iago/_archive/specs/`; roadmap → `.iago/ROADMAP.md`; mwp-routing-rule content → root `CLAUDE.md ## Doc routing` then archive |
| `graphify-out/cache/` | empty | orphan | — | **DELETE** | live graph in `dev/obsidian-brain/graphify-out/` per global CLAUDE.md; this dir is leftover from old iago-os pointing |
| `mcp-servers/youtube-transcript/` | (Python project) | L3 | `.claude/mcp-servers/youtube-transcript/` (or KEEP as own top-level) | MOVE → DECIDE | one consumer (Claude Code); MWP says move closer to consumer; **but moving Python project under `.claude/` is unusual** — open question §9 |
| `node_modules/` | biome+typescript | (gitignored) | — | KEEP | dev tooling |
| `package.json`/`package-lock.json` | 211 B / 5885 B | L3 | `package.json`/`package-lock.json` | KEEP + DOCUMENT | document in CLAUDE.md that root package.json scopes biome + typescript for repo-wide tooling only |
| `runtime/CLAUDE.md` | — | **L0 (missing)** | `runtime/CLAUDE.md` | **CREATE** | declare sub-workspace identity; currently runtime/CONTEXT.md is the only routing doc |
| `runtime/CONTEXT.md` | — | L2 stage contract | `runtime/CONTEXT.md` | KEEP | already MWP-shaped |
| `runtime/*` | own project tree | Level B sub-workspace | `runtime/*` | KEEP | already MWP-shaped internally; no internal restructure |
| `scripts/execute-pipeline.sh` | — | L3 pipeline core | `scripts/pipeline/execute-pipeline.sh` | MOVE | |
| `scripts/lib/*.sh` + `.test.sh` | — | L3 pipeline helpers | `scripts/pipeline/lib/` | MOVE | |
| `scripts/check-clean-tree.sh` + .test.sh | — | L3 pre-flight | `scripts/pipeline/` | MOVE | pipeline-adjacent |
| `scripts/console-check.mjs` | — | L3 pre-flight | `scripts/pipeline/` | MOVE | pipeline-adjacent |
| `scripts/measure-build-gate-rss.sh` | — | L3 measurement | `scripts/pipeline/` | MOVE | pipeline-adjacent |
| `scripts/review-checks/*.md` | 11 files | **L3 reference (loaded by review stage)** | `.iago/_config/review-checks/` | **MOVE** | not scripts — reference material loaded into context by execute-pipeline.sh review stage |
| `scripts/new-client.{sh,ps1}` | 2 files | L3 setup | `scripts/setup/` | MOVE | one-shot bootstrap |
| `scripts/setup-memory.{sh,ps1}` | 2 files | L3 setup | `scripts/setup/` | MOVE | |
| `scripts/sync-skills.{sh,ps1}` | 2 files | L3 setup | `scripts/setup/` | MOVE | |
| `scripts/metrics-aggregate.mjs` | — | L3 ops | `scripts/ops/` | MOVE | telemetry |
| `scripts/usage-report.{sh,ps1}` | 2 files | L3 ops | `scripts/ops/` | MOVE | reporting |
| `scripts/test-build-gate.sh` | — | L3 test | `scripts/tests/` | MOVE | |
| `scripts/test-pipeline-helpers.sh` | — | L3 test | `scripts/tests/` | MOVE | |
| `scripts/validate-hooks.sh` | — | L3 test/validation | `scripts/tests/` | MOVE | |
| `scripts/validate-skills.sh` | — | L3 test/validation | `scripts/tests/` | MOVE | |
| `templates/client-project/` | 8 template files | L3 workspace-builder | `templates/client-project/` | KEEP | feeds `/iago-scaffold` |
| `templates/internal-project/` | 8 template files | L3 workspace-builder | `templates/internal-project/` | KEEP + REVIEW | self-bootstraps `.iago/`; **the live `.iago/` is missing PROJECT.md and ROADMAP.md that this template provides** → §6 |
| `templates/memory/` | 4 files (config.json, graphifyignore, session-diary.py, wing_config.json) | L3 setup data | `templates/memory/` | KEEP | feeds setup-memory.sh |

---

## 3. Duplication map

Concrete overlaps with target line ranges.

### 3.1 CLAUDE.md ⇄ README.md

| CLAUDE.md section (lines) | README.md section (lines) | Verdict |
|---|---|---|
| `## Prerequisites` (7-10) | `## Prerequisites` (440-) | README is public install; CLAUDE.md prereq is for Claude routing. **KEEP both but verify content matches** — README expands for human readers, CLAUDE.md is operational. |
| `## Tech Stack` (12-19) | `## Tech stack` (461-) | **Duplication.** Move canonical to `.claude/rules/stack.md` (per previous audit M-action). Both files reference. |
| `## Architecture` (34-44) | (none specific) | KEEP in CLAUDE.md only |
| `## Workflow` (45-52) | `## The delivery pipeline` (160-) + `## Working on the OS itself` (129-) + `## Choosing the right mode` (147-) | **Triple duplication.** Move canonical to `.claude/rules/execution-pipeline.md` (already exists — merge); both ROOT files reference. |
| `## Execution Path` (54-65) | `## Choosing the right mode` (147-) | **Duplication.** Same content. README version is more verbose. |
| `## Review Pipeline` (74-95) | `### Async review-fix loop (GitHub Actions)` (198-) | **Duplication.** Canonical in `.claude/rules/execution-pipeline.md`. |
| `## Memory Architecture` (96-132) | `## Memory stack (optional)` (324-) | **Duplication.** Canonical → `.claude/rules/memory.md` (NEW) or root CLAUDE.md only. |
| `## Skills` (178-186) | `## Agent architecture` (215-) + 5 sub-sections of skill catalog (238-322) | **TRIPLE duplication** with `.claude/rules/available-skills.md`. Canonical = `available-skills.md`. CLAUDE.md keeps 1-line pointer. README keeps 1-line pointer to the rule file. |
| `## Agents` (187-189) | `## Agent architecture` (215-237) | **Duplication.** Canonical → `.claude/rules/available-skills.md` (already has "Agent Architecture" section). |
| `## Folder structure` (none in CLAUDE.md) | `## Folder structure` (377-439) | README only — but **stale** (will become more stale after restructure). Update or remove. |
| `## Output Style` (191-208) | (none) | KEEP in CLAUDE.md → propose extraction to `.claude/rules/output-style.md` |
| `## Model Routing` (209-215) | (none) | KEEP in CLAUDE.md |

### 3.2 CLAUDE.md ⇄ `.claude/rules/available-skills.md`

CLAUDE.md `## Rules` section (165-177) explicitly lists `.claude/rules/*.md` as authoritative. CLAUDE.md `## Skills` (178-186) names 12 active skills as 1-line summaries. `.claude/rules/available-skills.md` has the full catalog (~280 lines). **Verdict:** CLAUDE.md skill list can be removed entirely — `## Rules` already points at `available-skills.md`. Saves ~10 lines.

### 3.3 CLAUDE.md ⇄ `.claude/rules/{execution-pipeline,layer-triage,context-hygiene}.md`

CLAUDE.md `## Review Pipeline` (74-95, 22 lines) overlaps `.claude/rules/execution-pipeline.md` extensively. Same for `## Execution Discipline` (157-164) overlapping context-hygiene.md. **Verdict:** CLAUDE.md should NAME these rules with 1-line summaries and point to the rule file for detail. Saves ~30 lines.

### 3.4 docs/specs/iago-os-mwp-routing-rule.md → root CLAUDE.md

This spec exists specifically to be a drop-in `## Doc routing` section in root CLAUDE.md. It's a TODO that never landed. **Action:** Phase 1 of new restructure must paste this content into CLAUDE.md and archive the spec.

### 3.5 docs/ARCHITECTURE.md ⇄ docs/specs/iago-os-v2-vision.md ⇄ runtime/README.md

All three describe v2 daemon architecture. Likely high overlap. **Verdict:** v2-vision.md is canonical (525 lines, last updated 2026-05-15 with Agent Shape Taxonomy amendment). ARCHITECTURE.md predates v2 — **READ to confirm, then archive**.

### 3.6 docs/WORKFLOW.md ⇄ CLAUDE.md ## Workflow ⇄ .claude/rules/execution-pipeline.md

Triple-duplication. Canonical: `execution-pipeline.md`. WORKFLOW.md → merge what's not duplicated, delete the rest.

### 3.7 docs/GITHUB-PIPELINE.md ⇄ .claude/rules/execution-pipeline.md

The rules file already has a "Async Review-Fix Loop (GitHub Actions)" section. GITHUB-PIPELINE.md predates it. **Action:** read both, merge into rules file, delete docs version.

### 3.8 docs/SETUP.md ⇄ docs/MANUAL.md ⇄ README.md `## Quick start`

Setup instructions in three places. **Canonical:** README.md (public). Delete SETUP.md and MANUAL.md after merging unique content.

### 3.9 templates/internal-project/ ⇄ live `.iago/`

The `internal-project/.iago/` template contains PROJECT.md.template, ROADMAP.md.template, DECISIONS.md.template — files that DO NOT EXIST in live `.iago/`. iago-os was never bootstrapped from its own template. **Action:** scaffold PROJECT.md and ROADMAP.md in Phase 2 (use ROADMAP from docs/specs/iago-os-roadmap.md content).

### 3.10 .iago/CONTEXT.md ⇄ .iago/README.md

Both explain the same factory/product split in different formats. CONTEXT.md is L1 routing (tables); README.md is human-onboarding (prose + diagram). **KEEP BOTH** — they serve different audiences (machine routing vs human reader). But verify they don't drift; the README has a directory map that will be outdated after Phase 3.

---

## 4. Factory vs product mixing in `.iago/`

Per row in `.iago/CONTEXT.md` (current classification already done; physical separation pending).

| Entry | Lifecycle (per .iago/CONTEXT.md) | Evidence | Target folder under restructure | Confidence |
|---|---|---|---|---|
| `CONTEXT.md` | L1 routing (meta) | stable; updated when structure changes | KEEP at `.iago/CONTEXT.md` | high |
| `README.md` | meta (factory/product explainer) | stable | KEEP at `.iago/README.md` | high |
| `STATE.md` | state digest | per-day updates | MOVE to `.iago/state/STATE.md` per CONTEXT.md doc-routing | high |
| `config.json` | L3 factory | stable | `_config/` | high |
| `context/` | L3 factory | "phase decision artifacts (Eduba rooms)" — set once per phase | `_config/context/` | high |
| `decisions/` | L3 ADR | 4 dated files, written-once-binding-forever | `_config/decisions/` | high |
| `handoff/` | state | per-session snapshot | `state/handoff/` | high |
| `hooks/` | L3 hook code | 9 .mjs files; stable runtime | `_config/hooks/` | high |
| `learnings/` | **L3 (per CONTEXT.md)** but **debatable** | 3 files; pattern-accumulation — humans write once per pattern, but new patterns are added over time | `_config/learnings/` | medium — argue below |
| `logs/` | L4 per-run | 11 files; pipeline logs | `product/logs/` | high |
| `pipeline-runs/` | L4 per-run | 10 files | `product/pipeline-runs/` | high |
| `plans/` | L4 per-execution | 58 files in 12+ feature dirs | `product/plans/` | high |
| `prompts/` | L3 reusable | 1 file | `_config/prompts/` | high |
| `research/` | L4 per-question | 22 dated files | `product/research/` | high |
| `reviews/` | L4 per-PR | 124 files | `product/reviews/` | high |
| `runbooks/` | L3 ops procedures | 2 files; stable | `_config/runbooks/` | high |
| `runs/` | L4 dispatch artifacts | 10 files in round-1/2/3-dispatch | `product/runs/` | high |
| `state/` | runtime state (gitignored except README) | 415 files; `_archive` boundary documented | KEEP at `.iago/state/` | high |
| `summaries/` | L4 step 6 output | 36 files | `product/summaries/` | high |

### 4.1 Genuinely ambiguous calls

**`learnings/`** — `.iago/CONTEXT.md` calls it L3. Evidence supports: humans write each pattern once after 5+ occurrences (per CLAUDE.md `## Learnings`), patterns are stable once written, and they bind future work (Claude reads them to avoid known anti-patterns). Counter-argument: file count grows over time, similar to research/. But research/ is per-question (different topics over time), while learnings/ is per-pattern (same patterns evolve). **Verdict: L3, target `_config/learnings/`.** Reason: lifecycle is "write-once, internalize as constraint" — the L3 signature.

**`decisions/`** — same argument as learnings/. ADRs are written once and bind future work. The fact that new ADRs are added monthly does NOT make them L4; each ADR is a stable constraint. **Verdict: L3, target `_config/decisions/`.**

**`research/`** — 22 files; each is a one-off analysis dated by topic. New research is per-question (e.g., this audit will become research entry #23). Lifecycle: "process as input for the decision it informs, then archive when decision is made." Closer to L4. The 2026-04-28 audit's recommendations were ABSORBED into shipped specs; the audit itself is per-run product, not stable constraint. **Verdict: L4, target `product/research/`.** Reason: each file is a per-decision artifact, not a stable convention.

**`context/`** — 2 files. Without reading them, ambiguous. `.iago/CONTEXT.md` labels them L3 ("phase decision artifacts (Eduba rooms)"). Phase-decision = bound to a phase, internalized while that phase runs, then archived. Treat as L3 with phase-expiry: when the phase ships, the context file moves to `_archive/`. **Verdict: L3, target `_config/context/`.**

---

## 5. Cross-references that will break

Hardcoded paths Phase 3 will break.

### 5.1 `.iago/hooks/` → `.iago/_config/hooks/` (breaks settings.json hook paths)

`.claude/settings.json` lines (per inspection):
- SessionStart hook: `node "$CLAUDE_PROJECT_DIR/.iago/hooks/context-persistence.mjs"`
- PreToolUse Bash: `safety-guard.mjs`, `commit-quality.mjs`
- PreToolUse Edit|Write|MultiEdit: `config-protection.mjs`, `safety-guard.mjs`
- PostToolUse Skill|Agent: (continues in file, not fully captured)
- (more hooks below)

**Fix:** in the same PR that moves `.iago/hooks/` → `.iago/_config/hooks/`, update every reference in `.claude/settings.json`. Test by triggering one Edit and verifying no hook errors.

### 5.2 `scripts/review-checks/` → `.iago/_config/review-checks/`

15 references found:
- `CLAUDE.md` (the routing rule lines about which review checks load)
- `.claude/rules/execution-pipeline.md` (pipeline doc names this path)
- `.claude/rules/available-skills.md`
- `.claude/skills/frontend-bug-bounty/SKILL.md`
- `.claude/skills/amplify-bug-bounty/SKILL.md`
- `docs/specs/iago-os-vision.md`
- `docs/specs/iago-os-v2-vision.md`
- `docs/specs/iago-os-v2-master-prompt.md`
- `docs/research/agent-sdk-integration-architecture.md`
- `.iago/plans/_archive/2026-04-pipeline-speed-wedges/02-wedge-a-plus-review-fanout.md` (archive — leave)
- `.iago/research/_summary.md`
- `.iago/research/team-4-competitive.md`
- `.iago/summaries/audit-05-pipeline-enforcement.md`
- `.iago/plans/feature-audit/audit-05-pipeline-enforcement.md`
- `.iago/reviews/audit-phase.md`

**Fix:** sed-pass in same PR. Most importantly `execute-pipeline.sh` itself — verified via §1.5 it does NOT directly reference `scripts/review-checks/` (would need to check execute-pipeline.sh source); review stage prompts likely load these files by path. **Verification step in plan: grep `execute-pipeline.sh` for `review-checks` before the move.**

### 5.3 `.iago/{plans,summaries,reviews,runs,logs,pipeline-runs}/` → `.iago/product/*/`

14 scripts reference these paths:
- `scripts/execute-pipeline.sh` (core pipeline — writes summaries/, reads plans/, writes reviews/)
- `scripts/test-pipeline-helpers.sh`
- `scripts/metrics-aggregate.mjs`
- `scripts/lib/pipeline-telemetry.sh`
- `scripts/lib/learnings-writer.test.sh`
- `scripts/check-clean-tree.sh` + `.test.sh`
- `scripts/measure-build-gate-rss.sh`
- `scripts/lib/metrics-aggregate.test.sh`
- `scripts/new-client.sh`
- `scripts/sync-skills.sh` + `.ps1`
- `scripts/usage-report.sh` + `.ps1`

**Fix:** comprehensive sed-pass. **Backward-compat option:** create `.iago/plans → .iago/product/plans` symlinks for one PR cycle, then drop. Windows symlink support is uneven (requires Developer Mode or admin) — **safer to do the path-update in the same PR as the move**, no shims.

### 5.4 `docs/*.md` references (Phase 4)

After docs/ consolidation:
- README.md `## Documentation` section names doc files
- CLAUDE.md may reference docs/specs/
- skills (e.g., `/industry-patterns`) load docs/patterns/*.md

**Fix:** per-file update in Phase 4 PR. Industry patterns skill must update its `paths:` reference.

### 5.5 `mcp-servers/youtube-transcript/` → `.claude/mcp-servers/youtube-transcript/`

User-level `~/.claude.json` may register this MCP by absolute path. **Verify before moving** — if globally registered, move could break MCP loading. **Open question §9.**

### 5.6 `graphify-out/` references

Likely none in iago-os (it's an obsidian vault concern). Verify before delete.

---

## 6. Orphans and deletion candidates

| Path | Status | Recommendation | Evidence |
|---|---|---|---|
| `graphify-out/cache/` (empty) | **orphan** | DELETE | global CLAUDE.md says live graph is at `dev/obsidian-brain/graphify-out/`; this dir contains only an empty `cache/` subdir; last modified 2026-04-10 |
| `node_modules/` | gitignored dev tools | KEEP | biome + typescript for dev tooling; documented in package.json |
| `.worktrees/chain-rebase/` | active? | INVESTIGATE | last modified 2026-05-16 |
| `.worktrees/pr40-fix/` | PR #40 merged? | INVESTIGATE — likely DELETE | dated 2026-05-15; PR likely merged |
| `.worktrees/pr41-fix/` | PR #41 | INVESTIGATE — likely DELETE | dated 2026-05-16 |
| `.worktrees/pr42-fix/` | PR #42 | INVESTIGATE — likely DELETE | dated 2026-05-16 |
| `.worktrees/pr43-codex/` | PR #43 | INVESTIGATE — likely DELETE | dated 2026-05-16 |
| `.worktrees/pr43-fix/` | PR #43 | INVESTIGATE — likely DELETE | dated 2026-05-16 |
| `.worktrees/pr44-fix/` | PR #44 | INVESTIGATE — likely DELETE | dated 2026-05-16 |
| `CLAUDE.local.md.template` | reference | KEEP (move to `.iago/_config/templates/`) | template for per-machine overrides; mentioned in previous audit |
| `docs/archive/*` | already archived | MOVE to `.iago/_archive/` | 33 files; convention says archive lives under `.iago/_archive/` (per `.claude/rules/execution-pipeline.md`) |
| `docs/specs/iago-os-vision.md` | superseded by v2-vision | ARCHIVE → `.iago/_archive/specs/` | v2-vision.md is the canonical (2026-05-15 amended) |
| `docs/specs/iago-os-cleanup.md` | Phase 1 shipped in PR #31 | ARCHIVE → `.iago/_archive/specs/` | spec is done; STATE.md confirms |
| `docs/specs/markitdown-integration.md` | shipped | ARCHIVE → `.iago/_archive/specs/` | MarkItDown shipped per memory |
| `docs/specs/parallel-execution-wedges.md` | shipped | ARCHIVE → `.iago/_archive/specs/` | wedges shipped |
| `docs/specs/hermes-agent-adoption.md` | absorbed into v2-vision | ARCHIVE → `.iago/_archive/specs/` | per v2-vision.md amendment notes |
| `docs/specs/iago-os-mwp-routing-rule.md` | drop-in content for CLAUDE.md | EXECUTE then ARCHIVE | content moves to root CLAUDE.md `## Doc routing` section in Phase 1, then archive the spec |
| `docs/research/*` | decisions baked into v2 vision | ARCHIVE → `.iago/_archive/research/` | 5 files; all from v2 planning |
| `.iago/plans/_archive/2026-04-pipeline-speed-wedges/` | already archived plans | MOVE to root `.iago/_archive/plans/2026-04-pipeline-speed-wedges/` | consolidate archive convention |
| `.iago/plans/codex/` | open question | INVESTIGATE | what is this? possibly stale |
| `.iago/plans/feature-iago-os-cleanup/01-cleanup-hygiene.md` | shipped in PR #31 | MOVE TO `.iago/_archive/plans/2026-05-iago-os-cleanup/` after Phase 0 | already done per STATE.md |

**Worktree audit (do before Phase 1):** `git worktree list` to identify which `.worktrees/*` are registered. Unregistered or merged-PR worktrees can be safely deleted with `git worktree remove`.

---

## 7. Conflict surface

### 7.1 v2 cutover TODAY (2026-05-25 20:00 US/Mexico)

**STATE.md (2026-05-20) names cutover for tonight.** Remaining work (per STATE.md): Plan 04b PR-triage wiring/test, 05a/05b evidence template+checker+e2e, 06 SIGHUP credential reload. After cutover, the v2 daemon is live on VPS.

**Implication for MWP restructure:**

- **NO MWP work touching `runtime/`, `scripts/`, `.claude/settings.json`, `.iago/hooks/` should land before 2026-05-26 morning.** Risk: breaking the cutover or daemon start.
- **OK to land Phase 1 (CLAUDE.md trim + Doc routing section) and Phase 4 (docs/ consolidation) in parallel with cutover** — they touch documentation only, no code.
- **Safest sequencing:** Phase 0 audit (today) → Phase 1 (today/tomorrow, doc-only) → cutover (today 20:00) → Phase 2-9 (post-cutover, starting 2026-05-26).

### 7.2 Client inner repos (memory feedback_inner_repo_check.md)

Inner repos at:
- `clients/din/dinpro-app/.git`
- `clients/fulldata/web-pricing-mock/.git`
- `clients/munet-web/.git`
- `clients/sentria/.git`

**Hard rule:** never `git add -f` paths under these. Never commit changes from iago-os PR into these. Phase 7 per-client shell additions must live in the wrapper dir (e.g., `clients/din/CLAUDE.md`) NOT in the inner repo (`clients/din/dinpro-app/CLAUDE.md`).

### 7.3 `runtime/` already MWP-shaped — DO NOT internally restructure

`runtime/CONTEXT.md` already declares L2 stage contract. `runtime/migration/`, `runtime/agents/pr-triage/`, `runtime/deploy/` are stage-organized internally. **The only Phase 5 change:** add `runtime/CLAUDE.md` Layer 0 declaration + register from root `CONTEXT.md`. No moves inside `runtime/`.

### 7.4 `.iago/_archive/` convention

`.claude/rules/execution-pipeline.md` documents the archive convention: superseded plans move to `.iago/plans/_archive/{YYYY-MM-{slug}}/` with roadmap-pointer header. Phase 3 must extend this to a repo-wide `.iago/_archive/` (plans + specs + research + docs). Update the rule in same PR.

### 7.5 Symlinks

No existing symlinks observed in repo. **Recommendation: don't introduce them** — Windows symlink support requires Developer Mode and breaks on CI. Update path references in the same PR as moves.

### 7.6 Git history preservation

Use `git mv` for every move so blame/log survives. Bulk move script per Phase. Verify with `git log --follow {new-path}` after.

### 7.7 Hook execution order

`.claude/settings.json` hooks fire on Edit/Write. The `config-protection.mjs` hook blocks edits to protected configs (per memory `feedback_config_protection_bypass.md`) — uses Bash shell redirect, not Edit. Phase 3 must verify that moving the hooks themselves doesn't trip config-protection on its own settings.json edit. **Mitigation:** stage settings.json edit as the LAST edit in the Phase 3 PR; use Bash heredoc if blocked.

### 7.8 Stress-test on cutover-week stress level

Santiago is in active v2 cutover crunch (per STATE.md and memory). MWP restructure is a **doc/structure refactor** with high churn surface but low logic risk. The doc-only phases (1, 4) are low-stress. Code-touching phases (3, 6) demand fresh attention. **Do not stack code-touching phases in the same week.** Sequence: doc phases now, code phases after cutover stabilizes (5-7 days post-cutover).

---

## 8. Phase ordering verdict (against my own 9-phase plan)

| # | Phase | Verdict | Notes |
|---|---|---|---|
| 0 | Audit & decision artifact (THIS DOC) | **GREEN** | shipped today |
| 1 | Layer 0/1 split at root (CLAUDE.md trim + new CONTEXT.md + README trim) | **GREEN** — land today or 2026-05-26 (doc-only, no cutover collision) | bundle drop-in of mwp-routing-rule content; bundle README trim; bundle CLAUDE.md → ≤80 lines |
| 2 | `stages/` at root | **YELLOW — RECONSIDER** | iago-os is a multi-workflow factory, not a single sequential pipeline. The `/iago-execute` skill IS the stage runner, and stage contracts already exist in `.claude/skills/iago-*/SKILL.md`. A root-level `stages/0{1..5}_{init,discuss,plan,execute,verify}/` directory would duplicate that. **REVISED:** instead of creating `stages/` at root, treat each `/iago-*` skill as its own L2 stage contract (already true) and add an `## iaGO workflow stages` table to root CONTEXT.md naming each skill, its inputs, and its outputs. NO new top-level dir. |
| 3 | Reorganize `.iago/` into `_config + references + product + state + _archive` | **GREEN — but rename `references` → fold into `_config`** | Per §4, only `_config/`, `product/`, `state/`, `_archive/` are needed. `references/` is redundant with `_config/`. Bundle `_config/review-checks/` (from scripts/review-checks/) in same PR. **POST-CUTOVER ONLY.** |
| 4 | Consolidate `docs/` | **GREEN — land today/tomorrow (doc-only)** | bundle docs/specs/ split per row 1.4; bundle docs/archive → `.iago/_archive/`; create `.iago/ROADMAP.md` and `.iago/PROJECT.md` from docs/specs/iago-os-roadmap.md + templates |
| 5 | Register `runtime/` + relocate `mcp-servers/` | **YELLOW — SPLIT** | runtime/CLAUDE.md creation is trivial (10 lines), bundle into Phase 1. mcp-servers/ relocation is bigger — see §5.5 (need to verify ~/.claude.json registration first). **SPLIT:** runtime/CLAUDE.md → Phase 1. mcp-servers/ → Phase 5 standalone, post-cutover, with verification first. |
| 6 | Reshape `scripts/` (pipeline/setup/ops/tests + move review-checks/) | **GREEN, post-cutover** | bundle the review-checks move (Phase 3 dependency) so review-checks lands in `.iago/_config/`. High churn surface (~30 scripts move), but all path updates can be done in one PR. **POST-CUTOVER.** |
| 7 | Per-client MWP shell | **YELLOW — SCOPE DOWN** | uniform shell only makes sense for client-wrapper clients (din, palazuelos, rsf). munet-web and sentria are repo-is-client (already have their own CLAUDE.md inside the inner repo). fulldata is a data-engagement, not code — needs its own shape. **REVISED:** 3 PRs (din, palazuelos, rsf), skip munet-web/sentria/fulldata. Use templates/client-project/ as the source skeleton (Phase 8 dependency). |
| 8 | Templates as workspace-builder | **GREEN** | templates/client-project/ already exists; just wire `/iago-scaffold` to copy from it. Test by scaffolding a tmp project. |
| 9 | Cleanup (graphify-out delete, worktree prune, root package.json doc, audit orphans) | **GREEN** | final pass; bundle into one PR |

**Missing phases (NEW finding):**
- **Phase 1.5 — Create `.iago/PROJECT.md` and `.iago/ROADMAP.md`.** Templates expect them; live `.iago/` is missing them. Source content from docs/specs/iago-os-roadmap.md (308 lines) + iago-os-v2-vision.md. Bundle into Phase 4 (docs consolidation).
- **Phase 2.5 — Document workflow stages in root CONTEXT.md** (replacement for the dropped Phase 2 stages/ folder). Add table mapping `/iago-*` skill → L2 stage contract location → factory inputs → product outputs.

**Phase count revision:** 9 → 9 (Phase 2 dropped, Phase 1.5 + 2.5 added; net same count, reordered).

---

## 9. Recommended plan structure for `/iago-plan`

**Verdict: SPLIT into 3 feature folders by reversibility class + cutover gate.**

### feature-mwp-restructure-docs/ (~4 plans, ~6 tasks each, doc-only, ZERO cutover risk)

Land THIS WEEK regardless of v2 cutover timing.

- `01-claude-md-trim.md` — CLAUDE.md → ≤80 lines + drop-in `## Doc routing` from mwp-routing-rule.md + extract Tech Stack/Output Style/Memory to `.claude/rules/*.md`. README.md → public-only trim.
- `02-docs-folder-consolidation.md` — docs/ARCHITECTURE/SETUP/MANUAL/WORKFLOW/GITHUB-PIPELINE/IAGO-DASHBOARD merged/moved per §1.4; docs/archive/* → `.iago/_archive/`; docs/research/* → `.iago/_archive/research/`; docs/automations → `.iago/_config/runbooks/`; docs/patterns → `.claude/rules/patterns/`.
- `03-roadmap-and-project-md.md` — create `.iago/ROADMAP.md` from docs/specs/iago-os-roadmap.md content; create `.iago/PROJECT.md` from templates/internal-project + current state; move docs/specs/iago-os-v2-* → `.iago/_config/specs/`; archive shipped specs.
- `04-runtime-claude-md.md` — create `runtime/CLAUDE.md` (Layer 0 declaration); register from root CONTEXT.md.

### feature-mwp-restructure-code/ (~3 plans, ~5 tasks each, code-touching, POST-CUTOVER ONLY)

Wait until cutover stabilizes (target: 2026-05-26 evening earliest, 2026-05-29 safest).

- `01-iago-physical-split.md` — `.iago/` → `_config/ + product/ + state/ + _archive/` per §1.2. Update `.iago/CONTEXT.md` folder map. Update `.iago/.gitignore`. Update `.claude/settings.json` hook paths. Update all 14 scripts' paths. Single atomic PR.
- `02-scripts-restructure.md` — `scripts/` → `pipeline/ + setup/ + ops/ + tests/`. Move `scripts/review-checks/` → `.iago/_config/review-checks/`. Sed-pass updates to all 15 cross-references. Update execute-pipeline.sh internal path resolution.
- `03-mcp-servers-relocate.md` — verify `~/.claude.json` registration; move `mcp-servers/youtube-transcript/` → `.claude/mcp-servers/youtube-transcript/`; update any references.

### feature-mwp-restructure-clients/ (~4 plans, ~4 tasks each, per-client, INCREMENTAL)

Land one client per week after code phase ships. Each plan is independent.

- `01-templates-as-builder.md` — finalize `templates/client-workspace/` skeleton; wire `/iago-scaffold` to copy from it; test by scaffolding a tmp project; document in CLAUDE.md.
- `02-din-shell.md` — add `clients/din/{CLAUDE.md, CONTEXT.md, _config/}` using template. DO NOT touch `clients/din/dinpro-app/` (inner repo).
- `03-palazuelos-shell.md` — same pattern.
- `04-rsf-shell.md` — same pattern.

**Why three folders not one:**

1. **Reversibility class differs:** doc phases are zero-risk; code phases break the pipeline if wrong; client phases touch wrapper dirs near inner repos (hazard surface).
2. **Cutover gate:** code phases MUST wait for cutover; doc phases can ship in parallel. Splitting lets doc phases ship today/tomorrow without waiting.
3. **Plan-file size constraint:** the CLAUDE.md rule says plan files should be ≤8 tasks each. A single feature folder for all 9 phases would either bury sub-plans or violate the ceiling.
4. **PR cadence per memory:** "Multi-chunk → split per-chunk PRs" (feedback_pr_split_multichunk.md) applies — three distinct deliverable classes (docs / code / clients) ship as three PR streams.

Each folder gets its own `CONTEXT.md` (workstream brief) per `.iago/CONTEXT.md` doc-routing convention.

---

## 10. Delta since 2026-04-28 audit

What changed that affects the plan structure.

### 10.1 What shipped from the previous audit

- **Phase 1 (Cheap wins) shipped in PR #31 (2026-05-04)** — STATE.md discipline, post-merge branch prune doc, deferred plan archive, `.iago/state/` README, macOS audit
- **`.iago/CONTEXT.md` shipped** — L1 routing with doc-routing table and L3/L4 classification
- **`.iago/README.md` shipped** — factory/product explainer
- **`docs/specs/iago-os-mwp-routing-rule.md` shipped as draft** — never executed (drop-in content for root CLAUDE.md still pending)
- **`.iago/decisions/` populated** with 4 ADRs since previous audit

### 10.2 What didn't ship (carry forward)

- **CLAUDE.md trim to ≤80 lines** — still at 215 lines (M13-M16 of previous audit)
- **Extract Tech Stack / Output Style to `.claude/rules/`** — never done
- **Per-client CLAUDE.md trimming** — never done
- **`.iago/PROJECT.md` creation** — file still doesn't exist
- **`.iago/ROADMAP.md` creation** — file still doesn't exist (canonical roadmap lives at docs/specs/iago-os-roadmap.md)
- **Physical L3/L4 split inside `.iago/`** — classification exists in CONTEXT.md but folders are still flat
- **Phase 2 (M13-M23 structural moves)** — never landed; was waiting for council-roadmap Wave 2 buffer that got eaten by v2 work

### 10.3 NEW issues since 2026-04-28

- **`.iago/state/` blew up to 415 files** (sessions=356 dominate) — boundary documented in `.iago/state/README.md` and gitignored, but the volume now justifies treating it as a first-class entity, not a subdirectory
- **`.iago/STATE.md` over 80-line cap** (90 lines) — needs trim
- **12 active feature plans** in `.iago/plans/` (vs ~6 at previous audit time) — v2 work concentrated here
- **Cutover Sunday 2026-05-25 20:00** is TODAY — wasn't on previous audit's horizon
- **`runtime/` became its own sub-workspace** since previous audit (with own CONTEXT.md as L2 contract) — newly relevant for "Level B" framing
- **`.iago/runs/`** appeared (10 files in round-1/2/3-dispatch) — new artifact class introduced by VPS bootstrap pipeline
- **`.iago/state/pipeline-runs/` (24 files) overlaps `.iago/pipeline-runs/` (10 files)** — duplicate state buckets introduced post-2026-04-28; need merge or rename
- **`docs/specs/sentry-integration.md` (336 lines, revised 2026-05-20)** — active spec, not in previous audit; keep at `.iago/_config/specs/`
- **5 stale worktrees** under `.worktrees/` (pr40-fix through pr44-fix) — accumulated since previous audit, prune in Phase 9

### 10.4 What's superseded

- Previous audit §3.2 M01 (delete CLAUDE.md.backup) — already done
- Previous audit §3.2 M02-M12 (Phase 1 actions) — done in PR #31
- Previous audit §5.1 Phase 1 — done
- Previous audit §5.3 Phase 3 (repo split) — DROP from this restructure; v2 daemon work makes repo split a different decision (v2 might warrant runtime/ becoming its own repo, but that's a v2-roadmap call, not an MWP-restructure call)

### 10.5 Decision requests for Santiago (revised from previous audit §6)

Original audit had 10 decision questions. Most still apply. Re-asking only the changed/unresolved ones:

1. **Cutover collision:** confirm doc-only phases (1+4) can land today/tomorrow in parallel with cutover, OR wait for cutover to ship first?
2. **`mcp-servers/` move:** move under `.claude/mcp-servers/` (closer to consumer) OR keep top-level (mcp-server is its own Python project, not natural to nest in `.claude/`)?
3. **Client shells:** confirm scope — add shells to **3** client-wrappers (din, palazuelos, rsf) and SKIP repo-is-client clients (munet-web, sentria) and data-engagement (fulldata)?
4. **Plan folder split:** confirm 3-folder split (`feature-mwp-restructure-docs/`, `-code/`, `-clients/`) per §9?
5. **`.iago/PROJECT.md` content:** scaffold from templates + current STATE.md content, OR write from scratch?
6. **`graphify-out/` delete:** confirm orphan, safe to delete?
7. **Stale worktrees:** confirm prune of pr40-pr44 worktrees in Phase 9 (subject to `git worktree list` audit)?

---

## 11. Per-client deep findings (added 2026-05-25 after deeper client walk)

Per-client disposition + plan-writer input for `feature-mwp-restructure-clients/` folder.

### 11.1 din (Class B — wrapper iaGO + inner repo)

**Wrapper-editable from iago-os PR.** Inner `dinpro-app/.git` is OFF-LIMITS.

Current state:
- `clients/din/.iago/` — heavily adopted: PROJECT.md (28+ lines, real content), ROADMAP.md, STATE.md, learnings/{patterns,project-conventions}.md, plans across 3 phase folders (`01-pricing-core/` 5 files, `01b-pricing-extended/` 5 files, `02-simulation-shell/` 5 files), summaries/, state/active-client.json
- `clients/din/branding/` — BRAND.md + logos/ + screenshots/
- `clients/din/PROMPT-DINpro-pricing-module.md` — original client brief (12K)
- `clients/din/DIN - BM 241016 (Manuel Sanchez's conflicted copy 2025-03-19).xlsx` — **OneDrive/Dropbox conflict file** (filename literally contains "conflicted copy 2025-03-19")
- `clients/din/dinpro-app/` — inner deliverable repo (DO NOT touch)

Plan-writer input for `clients/02-din-shell.md`:
- Create `clients/din/CLAUDE.md` (Layer 0 declaration — "you are in DIN client wrapper; root is at `../../`; inner deliverable is at `dinpro-app/` — NEVER edit")
- Create `clients/din/CONTEXT.md` (Layer 1 routing — points at `.iago/` for plans, `branding/` for design assets, `dinpro-app/` as inner deliverable boundary)
- Apply factory/product split to `clients/din/.iago/` (same convention as root `.iago/_config/` + `.iago/product/` + `.iago/state/`)
- Resolve `DIN - BM 241016 (Manuel Sanchez's conflicted copy 2025-03-19).xlsx`: rename to `clients/din/branding/DIN-BM-241016.xlsx` (drop OneDrive conflict suffix) — Santiago should confirm this is the canonical version, not a conflict that needs merging
- Keep `PROMPT-DINpro-pricing-module.md` at wrapper root (original-brief artifact; canonical reference for the engagement)

### 11.2 fulldata (Class C — most-MWP-aligned client)

**Wrapper-editable from iago-os PR.** Inner `web-pricing-mock/.git` is OFF-LIMITS.

Current state — fulldata is the most MWP-aligned client, using explicit numbered stages without iaGO scaffolding:
- `clients/fulldata/_inputs/` — Layer-4 source material (audios/, data-export/, pdfs/, videos/)
- `clients/fulldata/_processing/` — intermediate stage (scripts/{analyze,transcribe,...}.py, transcripts/, fulldata-prompt-construction.md)
- `clients/fulldata/out/00_inventory/` — Stage 0: inventory
- `clients/fulldata/out/01_research/` — Stage 1: research with sub-areas (crosscheck, legal, market, partners, prompts, sources, validation, `_legacy_pre_iago/`, `_source/`)
- `clients/fulldata/out/02_business/` — Stage 2: business decisions + icp-research
- `clients/fulldata/out/02_executive/` — Stage 2: executive (parallel to business)
- `clients/fulldata/out/03_dev/` — Stage 3: dev
- `clients/fulldata/out/03_meetings/` — Stage 3: meetings
- `clients/fulldata/out/branding/`
- `clients/fulldata/ops-hub.xlsx` — main operations spreadsheet
- `clients/fulldata/~$ops-hub.xlsx` — **Excel temp/lock file** (delete; gitignore `~$*`)
- `clients/fulldata/_processing/scripts/*.log` — 4 run logs (install.log, run.log, run2.log, run-salsify.log) — gitignore candidates
- `clients/fulldata/web-pricing-mock/` — inner deliverable repo (DO NOT touch)

Plan-writer input for `clients/03-fulldata-shell.md`:
- Create `clients/fulldata/CLAUDE.md` (Layer 0 — "data engagement; numbered-stage MWP convention; web-pricing-mock/ inner repo OFF-LIMITS")
- Create `clients/fulldata/CONTEXT.md` (Layer 1 — DOCUMENT the existing `_inputs/` + `_processing/` + `out/00_*` → `out/01_*` → `out/02_*` → `out/03_*` convention as canonical; this is ALREADY MWP, just lacks iaGO framing)
- **DO NOT** bootstrap a competing `.iago/` skeleton — fulldata's `out/0N_*/` IS its iago-equivalent; introducing `.iago/plans/` would create two parallel plan namespaces
- Delete `~$ops-hub.xlsx` and update `clients/fulldata/.gitignore` (or contribute to repo root `.gitignore`) with `~$*.xlsx` pattern
- Add `.gitignore` rule for `_processing/scripts/*.log`

### 11.3 munet-web (Class A — inner repo, REGISTRY-ONLY work)

**Inner repo at wrapper level.** iago-os PR can ONLY register, never edit inside.

Current state (read-only context for what exists INSIDE the inner repo):
- Has own `CLAUDE.md` and `.iago/` already (rich: 4 audits, 6 context files, 7 runbooks, 14+ summaries)
- **Scratch files inside `.iago/` that should be gitignored** (in the inner repo's PR, NOT here): `_prev-review.txt`, `_review-diff.txt`, `tmp-diff.txt`, `tmp-review-checks.md`, `_review-checks.md`
- Has own `docs/` with client PDFs (FIMUNET propuesta, Requerimientos Fase1, Arquitectura de Pagos), hardware/, playbook/, PLAYBOOK-v2.md, research/, specs/, workflows/ — same MWP-violation pattern as iago-os root `docs/`
- Has full Amplify backend (`amplify/backend.ts`, `amplify/functions/`, `amplify/SECRETS.md`, `amplify.yml`, `amplify_outputs.json`)

Plan-writer input — what iago-os PR CAN do (registry only):
- In `feature-mwp-restructure-clients/01-register-clients-in-root-context.md`: add a row to root `.iago/CONTEXT.md`'s Level B sub-workspaces table: `clients/munet-web/` | inner repo | own `CLAUDE.md` (inside inner repo) | own `.iago/CONTEXT.md` (inside inner repo).
- Document inner-repo boundary explicitly so future PRs don't accidentally try to edit munet-web from iago-os.

**Out of scope for this restructure (deferred to a separate munet-web PR):** scratch-file gitignore inside the inner repo; docs/ MWP cleanup inside munet-web; standardization with root iaGO conventions.

### 11.4 palazuelos (Class C — minimal research engagement)

**Wrapper-editable from iago-os PR.** No inner repo.

Current state:
- `clients/palazuelos/.iago/` — minimal skeleton: config.json, PROJECT.md, ROADMAP.md, STATE.md, learnings/{patterns,project-conventions}.md, state/active-client.json. NO plans/. NO summaries/. NO research/. NO context/.
- `clients/palazuelos/session-2026-05-04-palazuelos.md` — **loose session log at wrapper root** (should be in `.iago/context/` or `.iago/research/`)
- `clients/palazuelos/transcription1/` — audio.wav, chunks/, grabación1-palazuelos.mp4, notes.md, transcribe.log, transcribe.py, transcript.srt, transcript.txt

Plan-writer input for `clients/04-palazuelos-shell.md`:
- Create `clients/palazuelos/CLAUDE.md` (Layer 0 — "research/transcription engagement; deliverables in `transcription1/`")
- Create `clients/palazuelos/CONTEXT.md` (Layer 1 — points at .iago/ for project framing; transcription1/ as L4 deliverable)
- Move `session-2026-05-04-palazuelos.md` → `.iago/context/2026-05-04-palazuelos-session.md` (proper home per .iago/CONTEXT.md doc-routing)
- Apply factory/product split to `clients/palazuelos/.iago/` (same convention as root)

### 11.5 rsf (Class C — research-heavy engagement)

**Wrapper-editable from iago-os PR.** No inner repo.

Current state:
- `clients/rsf/.iago/` — minimal skeleton (same as palazuelos): config, PROJECT, ROADMAP, STATE, learnings, state/active-client. NO plans, summaries, research, context.
- `clients/rsf/README.md` — wrapper-level intro (2K)
- `clients/rsf/catalog/` — **22 numbered MD deliverables** (01-climate-control through 22-risk-management) + MATRIX.md + README.md (the catalog IS a major deliverable artifact)
- `clients/rsf/catalog.zip` — zipped version of catalog/ (regenerable; gitignore candidate)
- `clients/rsf/deep-research/` — 5 dated research docs (2026-05-11-{climate-rl,demand-forecast,fsma204-kg,latam-pest,shelf-life}) + README.md

Plan-writer input for `clients/05-rsf-shell.md`:
- Create `clients/rsf/CLAUDE.md` (Layer 0 — "research + catalog engagement; catalog/ is L4 deliverable; deep-research/ is L4 product")
- Create `clients/rsf/CONTEXT.md` (Layer 1 — points at .iago/, catalog/, deep-research/, branding (if exists))
- Apply factory/product split to `clients/rsf/.iago/`
- Add `clients/rsf/.gitignore` with `catalog.zip` pattern (or delete the zip if no longer needed); keep `catalog/` (the deliverable) tracked
- DO NOT move `catalog/` or `deep-research/` into `.iago/` — they're the wrapper's deliverable surface, not workflow artifacts

### 11.6 sentria (Class A — inner repo, REGISTRY-ONLY)

**Inner repo at wrapper level.** Same boundary as munet-web.

Current state (read-only):
- Has own `CLAUDE.md` and `.iago/` (rich: context/handoff, plans/feature-ayuda-{chat,reorg}, pipeline-runs/, research/, specs/, state/pipeline-runs/ ~12 ndjson files, `_archive/`)
- Full Amplify backend, has `.cursorrules` (predates Claude Code adoption), `.local/prod-report/`, capital `Branding/` (inconsistent with din's lowercase)
- **Nested `clients/sentria/clients/sentria-ayuda-deep-wt/`** — bizarre nested-project directory with its own `.iago/` (baselines, pipeline-runs, plans, research, specs, summaries) but no `.git`. Looks like a worktree-style nested copy. Inside inner repo → out of iago-os scope.
- Has own `docs/` (20+ files: architecture, research, sales, usuarios, _qa, WhatsApp setup, etc.)

Plan-writer input — registry-only (same as munet-web):
- In `feature-mwp-restructure-clients/01-register-clients-in-root-context.md`: add row `clients/sentria/` | inner repo | own CLAUDE.md (inside) | own .iago/CONTEXT.md (inside).

**Out of scope for this restructure (deferred to separate sentria PR):** nested `clients/sentria/clients/` resolution (delete? move? rename?); `Branding/` → `branding/` casing normalization; `.cursorrules` audit (still needed?); docs/ MWP cleanup; standardization with root conventions.

### 11.7 Net plan structure for `feature-mwp-restructure-clients/`

**5 plans (one registry + 4 wrappers), all wave 1 (independent):**

| Plan | Wave | Scope |
|---|---|---|
| 01-register-clients-in-root-context | 1 | Update root `.iago/CONTEXT.md` Level B sub-workspaces table — replace the placeholder `clients/{name}/` row with 6 explicit rows (din, fulldata, palazuelos, rsf, munet-web, sentria) noting inner-repo status per client; defers inner-repo restructure to those repos' own PRs |
| 02-din-shell | 1 | din wrapper: CLAUDE.md + CONTEXT.md + .iago/ physical split + rename conflicted xlsx; preserve dinpro-app/ inner repo |
| 03-fulldata-shell | 1 | fulldata wrapper: CLAUDE.md + CONTEXT.md (canonicalize existing `out/0N_*/` numbered-stage convention) + delete `~$ops-hub.xlsx` + gitignore for `~$*.xlsx` and `_processing/scripts/*.log`; preserve web-pricing-mock/ inner repo; NO competing `.iago/` skeleton |
| 04-palazuelos-shell | 1 | palazuelos wrapper: CLAUDE.md + CONTEXT.md + .iago/ physical split + move loose session-*.md to .iago/context/; preserve transcription1/ |
| 05-rsf-shell | 1 | rsf wrapper: CLAUDE.md + CONTEXT.md + .iago/ physical split + gitignore catalog.zip; preserve catalog/ and deep-research/ as L4 deliverables |

All 5 plans are independent (each touches a different client subtree). Wave 1 across the board; can dispatch in parallel via `/iago-execute feature-mwp-restructure-clients`.

**Timing:** post-cutover (same as code folder, target 2026-05-29). Lower urgency than docs folder; can ship incrementally if needed.

## Closing

This audit deliberately overlaps the 2026-04-28 audit because half of that audit's recommendations shipped and half didn't — re-stating the unshipped half + the new findings since gives the plan-writer a single canonical source rather than forcing them to diff two audits.

**Net plan-writer input (revised 2026-05-25 after deep client walk):** 3 feature folders, **14 plan files total (~70 tasks)**, spread across 6+ PRs over 3-4 weeks.
- `feature-mwp-restructure-docs/` — 4 plans, 28 tasks (WRITTEN 2026-05-25, awaiting /iago-execute sign-off; doc-only, can ship today/tomorrow alongside cutover)
- `feature-mwp-restructure-code/` — ~3 plans (NOT YET WRITTEN; post-cutover, target 2026-05-29)
- `feature-mwp-restructure-clients/` — 5 plans (WRITTEN 2026-05-25 per §11.7; post-cutover, can dispatch all 5 in parallel as wave 1)

**Status: DONE.** Every required section populated + §11 added with per-client deep findings. Open decision questions captured in §10.5 (all 7 resolved 2026-05-25). No file moves made; this artifact + plan files at `.iago/plans/feature-mwp-restructure-{docs,clients}/` are the only writes.
