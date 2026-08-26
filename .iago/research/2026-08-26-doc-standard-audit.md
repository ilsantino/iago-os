# Doc-standard audit — `dev\`, iago-os root, `clients/*`

**Date:** 2026-08-26 · **Scope:** everything under `C:\Users\sanal\dev\` · **Method:** four parallel read-only surveys (iago-os root, `clients/*`, `dev/*`, MWP paper extraction) + transcript forensics for the garbage items · **Plan:** `.iago/plans/feature-doc-standard/README.md`

This is the evidence file. The verdict, the standard and the phases live in the plan.

---

## 0. Garbage triage — resolved today

| Item | What it was | Origin | Action |
|---|---|---|---|
| `iago-os/C:Userssanaldeviago-os.iagostate/` | empty dir, 2026-06-16 | deprecated `scripts/execute-pipeline.sh` line 137 built `$PROJECT_DIR/.iago/state/...` from a Windows path; `\` stripped and `:` mapped to Cygwin's private-use U+F03A. Invisible to `ls` by typed name — only `Get-ChildItem` objects + `-LiteralPath` can touch it | **deleted** |
| `iago-os/C:Userssanaldeviago-os.iagostate.pipeline.lock.d/` | empty dir, same bug | same | **deleted** |
| `clients/.baseline-sentria/` | 2 MB lockfile + `node_modules` + `src/` snapshot, no `.git`, 2026-08-11 | a pipeline review subagent (sentria PR #366, wf `94c924b2`) ran `git worktree add --detach ../.baseline-sentria HEAD` to run suites against untouched HEAD; its "Remove baseline worktree" step failed on Windows and the tree survived. Every file is in `bas-labs/sentria` history | **deleted**; `git worktree prune` run (5 stale entries in `sentria/.git/worktrees/` still locked — see §6) |

---

## 1. What MWP prescribes — and what it leaves to us

Source: *Interpretable Context Methodology: Folder Structure as Agent Architecture* (Van Clief & McDermott, Eduba). Extracted in full; the paper is 1,530 lines.

**It prescribes:** five context layers (L0 `CLAUDE.md` ≈800 tok · L1 `CONTEXT.md` ≈300 · L2 stage `CONTEXT.md` 200–500 · L3 reference 500–2k · L4 working artifacts), the L3/L4 split (*"internalize as constraints"* vs *"process as input"*; *"the recipe"* vs *"the ingredients"*), numbered `NN_slug/` stages with an Inputs/Process/Outputs contract, human review at every stage boundary, *"edit the source, not the output"*, and `_config/` + `shared/` + per-stage `references/` as L3 homes.

**It does not prescribe:** any metadata/frontmatter, file naming beyond `NN_slug`, a lifecycle (archive/delete/staleness), where scripts or source material live, non-pipeline doc types (decisions, plans, runbooks, research have *no place* in MWP), ownership or review cadence, or how many workspaces sit side by side.

**Consequence:** MWP is a workflow-execution protocol, not a documentation taxonomy. We take its layer model, its L3/L4 discipline and its routing files; the taxonomy, lifecycle and naming are ours to define — which is exactly what PRs #58/#77/#79 already did for the iago-os root in May. The job now is to finish that for clients and to make it *stick*.

---

## 2. Previous passes and why they did not stick

| When | What | Shipped? |
|---|---|---|
| 2026-04-28 | `research/2026-04-28-mwp-restructure-audit.md` | → PR #33 (Wave A dormant-zone cleanup), #58 (`.iago/` L3/L4), #77 (CLAUDE.md trim + doc-routing table), #79 (`docs/` collapse) |
| 2026-05-25 | `research/2026-05-25-mwp-restructure-audit.md` → three workstreams: `feature-mwp-restructure-docs/` (4 plans), `-clients/` (5 plans), `-code/` (3 plans) | docs 01+02 only. **docs 03/04, clients 01–05, code 01–03 never executed** — clients/01 was hard-gated on docs/04, so the whole client chain stalled |
| 2026-08-10 | instruction audit (`_archive/2026-08-10-instruction-audit/`) | rules, not files. −202/519 rules |
| 2026-08-16→20 | `feature-filesystem-order/` P0–P8 | OneDrive / Downloads / home root. `dev\` was declared **rename-frozen and out of scope** (`file-naming-standard.md` §2) — the freeze is about code, and it is why nothing under `dev\` got touched |

**Root causes, in order of weight:**

1. **No enforcement.** Nothing checks `.iago/` conformance anywhere. OneDrive got `sweep.py` + a daily task; `dev\` got nothing.
2. **The pipeline itself generates rot** — `_scratch-*.md`, `_pr-body-*.md`, `_dispatch-*.log` land in `.iago/` root and `summaries/`; reviewers create `../.baseline-*` worktrees outside `.worktrees/`; merged worktrees are never pruned (§6).
3. **Three competing routing tables** — `CLAUDE.md` (canonical, auto-loads) vs `.iago/CONTEXT.md` (2026-05-30, says runbooks live in `.iago/runbooks/`) vs `.iago/README.md` (2026-05-18, directory map missing `_config/`, `summaries/`, `_archive/`, `handoff/`, `hooks/`, `runs/`, `pipeline-runs/`). Both `.iago/runbooks/` (2 files) and `.iago/_config/runbooks/` (6 files) are live.
4. **Dependency chains** — the May client plans could not start until a docs plan shipped, and it never did.
5. **Stale plans** — the May client plans describe May's clients. Since then palazuelos got a repo, iago and rsf grew `.iago/.git` planning repos, sentria and munet grew `docs/` plan trees.

---

## 3. iago-os root — findings

| # | Finding | Evidence |
|---|---|---|
| R1 | `research/`: **41 of 45 files older than 60 days**; 8 non-conforming names (`_summary.md`, `team-{1..5}-*.md`, `codex-stall-diagnosis-2026-04-28.md`, `iago-os-adversarial-review-2026-05.md`, `munet-web-playbook.md`); 2 identical-slug audits both live (04-28 / 05-25); ≥8 whose subject shipped (pr84, gate-hardening, daemon-durability, config-optimization, orphan-recovery, plan-state-reorg) | agent survey |
| R2 | `plans/`: **26 of 29 feature dirs stale**, incl. shipped ones (`feature-gate-hardening` #96/#97, `feature-pipeline-efficiency` #93, `feature-v2-per-agent-bots` #85, `feature-pr84-*` #84); `feature-lead-hunt-scrapling/` **empty since 05-28**; `feature-pipeline-speed-wedges/` exists live **and** in `plans/_archive/2026-04-…` | |
| R3 | `docs/`: **7 empty dirs** (`archive/{plans,research,specs}`, `automations`, `patterns`, `research`); 11 specs of which 6 are v1-era / superseded by `iago-os-v2-vision.md` + `ROADMAP.md` (`iago-os-cleanup`, `iago-os-vision`, `iago-os-roadmap`, `parallel-execution-wedges`, `feature-tool-surveillance`, `hermes-agent-adoption`); `markitdown-integration.md` has frontmatter and no title | |
| R4 | `STATE.md` header `Updated: 2026-07-01`, body's newest row 2026-08-12; zero mention of filesystem-order P0–P8 or the instruction audit. `ROADMAP.md` still marks daemon-recovery-hardening 🔄 IN FLIGHT (shipped + archived 06-17) and links a **missing** file. `PROJECT.md` has no `Updated:` | |
| R5 | Broken link: `feature-filesystem-order/README.md` → `research/2026-08-18-downloads-client-data-exposure.md` (only the palazuelos copy exists). `graphify-out/` has `cache/` only — global CLAUDE.md points at `graphify-out/wiki/index.md` which does not exist here (it lives in the vault) | |
| R6 | `.iago/state/` (gitignored) holds **decision-bearing docs**: `2026-05-10-orphan-playbook-recovery.md` (50 KB, duplicate of `research/munet-web-playbook.md`), `phase-1-kickoff-prompt.md` (19 KB), 6 PR-body `.md`, `costs.jsonl` (262 KB, dead since 04-12) | |
| R7 | `summaries/` mixes 45 `.md` with 9 `_dispatch-*.log` + 3 `_pr-body-*.md`. `reviews/` (136 files, May) not gitignored. `logs/`, `runs/`, `pipeline-runs/` = pure run artifacts | |
| R8 | `.worktrees/`: **7 worktrees for merged branches** (`caja-exec`, `pr100-fix`, `pr368-learnings`, `review-bilingual`, `review-contract`, `vps-cutover`, `pr100-gate`); `.claude/worktrees/agent-a814c32f/` since 05-16 | `git worktree list` |
| R9 | Loose: `.inbox-domains.tsv` (root, 06-29, unreferenced); 2 untracked research docs (08-19 gta6, 08-24 onepager) | `git status` |
| R10 | `scripts/execute-pipeline.sh` (deprecated per rules) still present with its libs `scripts/lib/{adversarial-verdict,build-gate,env-validation,pipeline-telemetry}.sh` and 5 test scripts; referenced in `execution-pipeline.md`, two SKILL.md files and `execute-pipeline.js` (as "replaced") | grep |
| R11 | Routing-table destinations that exist but are dead: `.iago/context/` (1 file, 05-04), `.iago/learnings/patterns.md` (660 B, one entry). Referenced but wrong: `.iago/config` (file is `config.json`) | |

---

## 4. `clients/*` — findings

All of `clients/` is gitignored by iago-os. Eight entries at survey time (seven after today's deletion).

### 4.1 Shape and versioning

| Client | Layout | App repo | `.iago/` versioned where? | `.iago/` has | `docs/` | Wrapper `CLAUDE.md` | STATE `Updated:` |
|---|---|---|---|---|---|---|---|
| din | wrapper + `dinpro-app/` | `ilsantino/dinpro-pricing` (05-27) | **nowhere** | PROJECT/ROADMAP/STATE/config + `specs/ audits/ context/ runbooks/ reviews/ state/ learnings/` | `dinpro-app/docs` (2) | no | 2026-08-10 |
| fulldata | wrapper + 4 inner repos | onetuweb ×2, ilsantino ×2 | **nowhere** | `research/` only — **no PROJECT/ROADMAP/STATE/config** | — | only in `fulldata-bot-asistente/.claude/` | none |
| iago | wrapper + `iago-web/` + `iago-web-wt/` | `bas-labs/iago-web` (08-19) | `clients/iago/.iago/.git` — **no remote** | PROJECT/ROADMAP/STATE; `context/ state/ summaries/` all **empty** (14 plans, 0 summaries) | worktree only | app only (+ `AGENTS.md` + `PROJECT_RULES.md`) | 2026-08-25 |
| munet-web | folder **is** the repo | `bas-labs/munet-web` (08-13) | app repo tracks **4** files of `.iago/` | fullest set: `_config/ assets/ audits/ context/ plans/ research/ reviews/ runbooks/ specs/ state/ summaries/ workflows/` | **43** md — `docs/plans/{dashboard-refactor,pagos-v0,panel-1.0}` + `docs/playbook/{spine,parallel}` = second plan system | root | **no `Updated:` line**; narrative stops 04-28, header says BLOCKED on a hotfix from April |
| palazuelos | folder **is** the repo (no app) | `ilsantino/palazuelos-erp-discovery` (08-19, 1 commit) | in the repo (63 files) ✅ | PROJECT/ROADMAP/STATE/config; `context/ hooks/ plans/ reviews/ state/sessions/ summaries/` all **empty** | — | no | **2026-06-28** (research is 08-18) |
| rsf | wrapper + `flow-tool/` | `bas-labs/rsf-flow-tool` (08-26) | `clients/rsf/.iago/.git` — **no remote** (self-documented as SPOF) | PROJECT/README/ROADMAP/**ROADMAP-flow-tool**/STATE/config + `_config/runbooks/ context/ learnings/ plans/ research/(40)` | — (`catalog/ deep-research/ discovery/ entregables/ proposals/ source-materials/` instead) | app only | 2026-08-25 |
| sentria | folder **is** the repo | `bas-labs/sentria` (08-26) | app repo tracks **1** file of `.iago/` — **110 plans + 11 research + 11 summaries unversioned** | STATE only — **no PROJECT/ROADMAP/config**; `_archive/ _config/runbooks/ context/ pipeline-runs/ plans/ research/ reviews/ specs/ state/ summaries/` | **185** md across 30 sub-dirs, incl. `docs/plans/feature-organigrama-editor` and `docs/{turnos,initiatives/turnos-*}` overlapping `.iago/plans/feature-turnos-*` by name | root | 2026-08-26 |

**The headline:** roughly **400 planning documents across six clients exist only on this laptop.** Only palazuelos's `.iago/` is on a remote. sentria (~140 files under `.iago/`) and munet (~200) look versioned because the folder is a repo — they are not; the app repos gitignore `.iago/` (per `feedback_new_inner_repo_iago_exclude`).

### 4.2 Schema drift

Seven clients, seven `.iago/` layouts. Directories that exist in some clients and nowhere in the root schema: `specs/` (din, munet, sentria), `audits/` (din, munet), `assets/` (munet), `workflows/` (munet), `hooks/` (palazuelos, rsf — empty), bare `runbooks/` (din, munet) beside `_config/runbooks/` (munet, rsf, sentria), `context/` at root (din, munet, rsf, sentria, palazuelos) vs `_config/context/`, `state/sessions/` (palazuelos, rsf — empty). `learnings/patterns.md` in din and rsf is the same file (md5 `a8e8f5e…`).

### 4.3 Per-client rot (concrete, for P4)

**din** — nested second `.iago/` in `dinpro-app/` (2 plans, 1 summary); `marketing/deck/out/` ≡ `marketing/deck/exports/` (3 md5-identical pairs); empty `audits/ reviews/ runbooks/`; `dist/`, `dist-app/`, `test-results/`; loose `PROMPT-DINpro-pricing-module.md`; `DIN - BM 241016 (Manuel Sanchez's conflicted copy 2025-03-19).xlsx` at root.

**fulldata** — `.iago/` is a stub; 7 scratch `.txt` fragments at `Fulldata/` root (`buttons_container.txt`, `part1.txt`, …); `_pentest/` holds **5 auth-token files** (`tok_adminA.txt`, `tok_pwnedsuper.txt`, …) + 4 logs; `Fulldata-back/vendor/` checked in; `knowledge.md` duplicated in `Fulldata/` and `fulldata-bot-asistente/workspace/`; `reports/remediacion-fulldata.{md,docx}`; four READMEs in `Fulldata-back/`. The bot workspace (`fulldata-bot-asistente/workspace/0{0..5}_*/CONTEXT.md`) is a proper MWP stage pipeline — keep as is.

**iago** — planning repo without remote; `context/ state/ summaries/` empty; `iago-web/.iago/state/.pipeline.lock.d/` (nested empty `.iago`); worktree `iago-web-wt/soluciones-tokens/` carries `README.md` + `PROJECT_RULES.md` md5-identical to the repo's; `dist/`, `dev-dist/`.

**munet-web** — **5 zero-byte files** in `.iago/context/` (`01-payments-architecture.md` … `05-public-ux-panel-alignment.md`); scratch at `.iago/` root (`_prev-review.txt`, `_review-checks.md`, `_review-diff.txt`, `tmp-diff.txt`, `tmp-review-checks.md`); 5 pipeline `.log` in `summaries/`; flat-vs-nested duplicates (`M2-panel-munet-04b.md` beside `M2/M2-panel-munet-01.md`; `quick-260428-*.md` beside `quick/`; `01.md` beside `01-foundation.md`); `plans/_archive/` 2 files; 6 empty dirs; 11 worktrees, 4 empty; `dist/`; `.local/` ad-hoc; client PDFs named `MUNET_Requerimientos_Fase1.docx (1).pdf`, `MUNET_Propuesta_FIMUNET.docx.pdf`.

**palazuelos** — 4 session logs loose at root (`session-2026-05-04-palazuelos.md` … `session-2026-06-24-palazuelos-02.md`) while `.iago/state/sessions/` is empty; 6 empty dirs; `transcription1/transcribe.log`; `deliverables/_build/shots*/`; STATE 7 weeks behind its own research. Open since 08-18: 4.2 GB of production ERP dumps in Downloads (`research/2026-08-18-erp-dumps-in-downloads.md`).

**rsf** — planning repo without remote; two roadmaps (`ROADMAP.md`, `ROADMAP-flow-tool.md`); `research/` pairs summary `.md` + same-name dir ×3 (fine, codify it); `entregables/ejecutivo/` ships the same `.docx` in `fuente/` and `salida/`; `catalog.zip` beside `catalog/`; 5 empty dirs; nested empty `flow-tool/.iago/state/`; `dist/`, `test-results/`.

**sentria** — 6 `_scratch-*` files at `.iago/` root (`_scratch-pr207-body.md`, `_scratch-pr368-cut-baseline.md`, `_scratch-probe.txt`, …); three `_archive` trees (`.iago/_archive/2026-05-18-post-pr142/`, `.iago/plans/_archive/`, `docs/_archive/`) with 6 md5-identical pairs inside the first; prod-report PDFs duplicated `.local/prod-report/` ↔ `docs/reports/`; `Reporte-Operacion-Absara-2026-08-08-a-08-19.pdf` in two `docs/` dirs; `amplify_outputs.sandbox.bak.json`, `.dev.log`, `dist/`; `.local/` with 7 raw dumps + 2 timestamped backup dirs; 3 pipeline logs in `.iago/pipeline-runs/`; 11 empty dirs incl. 4 empty `amplify/functions/*`; boilerplate Vite `README.md`; `summaries/01.md` beside `01-schema-resolver-shim.md`; 7 worktrees.

---

## 5. `dev\` — findings

| Entry | State | Finding |
|---|---|---|
| `.aws/` | 2 files | **plaintext credentials outside `~/.aws`**: `credentials` (0 profiles, 03-23) and `credentials.txt` (1 profile, 04-06, hash differs from `~/.aws/credentials` 04-13) — possibly a rotated key that was never revoked |
| `.tmp.driveupload/` | **17,686 files / 603 MB**, 6 written in the last 24 h | Google Drive for desktop upload staging. No Drive process was running at check time, yet the folder is still being written — something is backing up `dev\` to Drive. Same failure class P3b evicted from OneDrive |
| `MWP/` | 22 files / 22.5 MB | 6 PDFs (the methodology + Clief notes) ✓; 4 starter `.md` (`workflow-starter-{code-project,client-management,content-pipeline}.md`, `animation-spec-templates.md`) that belong with `iago-workspaces/`; `ui_files/` is unrelated GENESIS-LAB Streamlit code (→ `_archive/onedrive-20260817/genesis-lab/`); 3 zips |
| `_archive/onedrive-20260817/` | 420 files | deliberate quarantine ✓; contains `CrewAI-Studio-main/` (3rd-party download) and `dintransfer_lp/` (superseded by `clients/din/dinpro-app`) |
| `obsidian-brain/` | git, **no remote, 180 dirty files**, last commit 05-20 | the second brain has no backup. `2026-05-20.md` orphaned at root |
| `obsidian-brain-backups/` | 1 tarball, 05-20 | one-off pre-reorg blob |
| `iago-workspaces/` | git, **no remote**, 3 untracked | MWP non-code workspaces; ~10 empty scaffold dirs |
| `career-ops/` | git ✓ remote | `data/pipeline.md.pre-reconcile.bak`, untracked batch state — personal, out of scope except the `.bak` |
| `iago-leadgen/` | git ✓ remote | no `.iago/` or `CLAUDE.md`; `leads-2026-05-29-001039.csv` at root; empty `tests/fixtures/` |
| `sentria-predictive-maintenance/` | git ✓ remote, clean | skeleton: 9 empty dirs; the only client repo outside `iago-os/clients/` |
| `pr-body-a3.md`, `pr-body-a4.md` | 05-30 | scratch PR bodies for iago-os PRs that shipped |

---

## 6. Pipeline behaviors that manufacture rot (fix at the source or the cleanse repeats)

1. **Reviewer worktrees outside `.worktrees/`** — `git worktree add --detach ../.baseline-{repo} HEAD`, cleanup fails on Windows (locked `node_modules`), `.git` file removed but tree left. Not in any workflow prompt (grep) — emergent agent behavior. Fix: reviewer/verify prompts get an explicit rule: worktrees only under `<repo>/.worktrees/`, removal via `git worktree remove --force` + existence check, never `../`.
2. **Scratch written into `.iago/`** — `_scratch-pr*-body.md`, `_scratch-probe.txt` (sentria), `_prev-review.txt`, `tmp-diff.txt` (munet), `_pr-body-*.md`, `_dispatch-*.log` (root `summaries/`). Fix: every pipeline temp path → `.iago/state/` (gitignored); lint fails on `_*`/`tmp*`/`*.log`/`*.txt` anywhere else under `.iago/`.
3. **Deprecated bash pipeline** — the mangled-path bug of §0. `scripts/execute-pipeline.sh` + 4 libs + 5 tests + `metrics-aggregate.mjs` reference. Delete the script and its exclusive libs/tests; keep whatever `metrics-aggregate.mjs` actually imports.
4. **Worktrees never pruned** — 7 (iago-os), 7 registered + 5 locked stale entries (sentria: `catalogo-incidencias-unificado`, `hard-delete-entities`, `pr-184`, `pr-185`, `turnos-hardening` — `Permission denied` on prune, read-only attribute or open handle), 11 incl. 4 empty (munet). `git-workflow.md` prunes branches, not worktrees.
5. **`.iago/state/` as dumping ground** — decision docs in a gitignored dir are invisible to review and unbacked. Fix: lint flags any `.md` > 4 KB under `state/` that is not a session/handoff.
6. **Session logs at client root** (palazuelos) — the Stop hook writes digests to the vault; nothing routes in-repo copies.
