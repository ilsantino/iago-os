# feature-doc-standard — one workspace grammar for iago-os and every client

**Created:** 2026-08-26 · **Audit (evidence):** `.iago/research/2026-08-26-doc-standard-audit.md` · **Method:** MWP layers (`dev/MWP/Interpretable_Context_Methdology_.pdf`) + the locked naming grammar (`.iago/_config/runbooks/file-naming-standard.md`) · **Supersedes:** `feature-mwp-restructure-{docs,clients,code}/` (archive on P2 merge) · **Sibling:** `feature-filesystem-order/` (OneDrive/home; this plan covers the `dev\` zone it declared frozen)

## Verdict

The mess is not a taxonomy problem — the root taxonomy from May (#58/#77/#79) is sound and MWP-aligned. It is three things: (1) the client half of that work never shipped, so seven clients have seven `.iago/` layouts and two of them run parallel plan trees in `docs/`; (2) nothing enforces the schema, so the pipeline's own scratch and worktrees accumulate; (3) **~400 planning docs across six clients exist only on this laptop** — the tidy-up matters less than the fact that `rsf/.iago` (40 research files) or `sentria/.iago` (110 plans) would vanish with a dead SSD.

So the order is: **back it up → write the grammar once → clean the root → clean each client → turn on the linter → tidy `dev\`.** Backups first, because every later phase moves files in exactly the trees that have no remote.

MWP's contribution is the layer model and the L3/L4 discipline, not numbered stages. Stages stay where a workflow really is a pipeline (`fulldata-bot-asistente/workspace/0N_*`, `iago-workspaces/`); client engagements are not pipelines and get the workspace schema below.

---

## The standard (v1 — locked unless vetoed)

### 1. Layers → files

| MWP layer | File | Budget | Rule |
|---|---|---|---|
| L0 identity | `CLAUDE.md` (repo root; client wrapper root; app root) | ≤ 800 tok | who am I, stack, hard rules, routing table. Auto-loads — the **only** place a "where does X go" table may live |
| L1 routing | `.iago/CONTEXT.md` | ≤ 300 tok | what is in this workspace and which sub-workspaces exist (for the root: the client registry with inner-repo annotations). No content, no duplicate routing tables |
| L3 reference | `.iago/PROJECT.md`, `.iago/ROADMAP.md`, `.iago/_config/**` | stable | configured once, edited rarely, internalized as constraints |
| L4 product | `.iago/plans/`, `research/`, `summaries/`, `state/` | per run | processed as input, dated, archivable |
| L4 digest | `.iago/STATE.md` | ≤ 80 lines | `Updated:` line mandatory; bumped on every commit touching `.iago/` |

### 2. The `.iago/` schema — identical for iago-os root and every client

```
.iago/
  CONTEXT.md            L1  required
  PROJECT.md            L3  required — what/why/architecture/constraints
  ROADMAP.md            L3  required — ONE roadmap; phase tables, not prose
  STATE.md              L4  required — ≤ 80 lines, `Updated: YYYY-MM-DD`
  config.json               required
  _config/              L3  runbooks/  context/  decisions/  learnings/  prompts/  hooks/
  plans/                L4  feature-{slug}/{README.md, SPEC.md?, NN-{slug}.md}  quick-{YYMMDD}-{slug}.md  _archive/{YYYY-MM-{slug}}/
  research/             L4  YYYY-MM-DD-{slug}.md  [+ YYYY-MM-DD-{slug}/ for multi-leg passes]
  summaries/            L4  {plan-slug}.md only — written by the pipeline
  state/                L4  gitignored — sessions/  pipeline-runs/  reviews/  locks, logs, scratch
  _archive/                 superseded but decision-bearing, with a README pointer
```

**Banned at `.iago/` root** (each has one home): `specs/` → `plans/feature-x/SPEC.md` (per-feature) or `_config/context/` (stable framing) · `audits/` → `research/` · `reviews/`, `logs/`, `runs/`, `pipeline-runs/` → `state/` · `context/`, `runbooks/`, `decisions/`, `learnings/`, `prompts/`, `hooks/` → under `_config/` · `assets/`, `workflows/`, `handoff/` → `_config/context/` · a second `ROADMAP-*.md` → merge · `README.md` → delete (CONTEXT.md is the entry).

**Banned anywhere under `.iago/` except `state/`** — scratch **files** only: `_*`, `tmp*`, `*.log`, `*.txt`, `*.bak`, zero-byte files, empty dirs, nested `.iago/` inside an app repo (only `state/` may exist there, for locks).

> **Named directory exceptions to the `_*` rule:** `_config/`, `_archive/` and `plans/*/_archive/` are *required* by the tree above. The underscore prefix marks them as not-per-run; the ban targets underscore-prefixed **files** (`_scratch-pr368-body.md`, `_prev-review.txt`), never these three directories. A linter that does not carve them out will move the entire `_config/` tree into a gitignored directory.

> **Empty dirs vs. scaffolding:** because git cannot track an empty directory and `.gitkeep` is itself a zero-byte file, the templates ship a **real seed file** in each directory that must exist (e.g. `_config/learnings/patterns.md`) rather than a `.gitkeep`. `.gitkeep` is a reportable finding with **no auto-fix** — deleting one silently removes a directory the scaffolder depends on.

### 3. `docs/` in app repos = human-facing only

`docs/` is for Sebas, the client and GitHub: architecture, API, deployment, integration guides, client-visible specs, delivered PDFs/DOCX. **Never** plans, research, reviews, QA checklists, session notes, PR bodies. One plan system per project — `.iago/plans/`. Existing `docs/plans/**`, `docs/playbook/**`, `docs/research/**` and per-feature review dirs move to `.iago/plans/_archive/2026-08-docs-migration/{dir}/` in one move with a pointer README; nothing inside gets polished.

### 4. Versioning — `.iago/` is always its own repo with a private remote

- App repos gitignore `.iago/` (already the rule: `feedback_new_inner_repo_iago_exclude`). `.iago/` gets its own `.git` at `clients/{client}/.iago/` — nested inside the app repo when the client folder *is* the app (sentria, munet-web), beside it otherwise (din, fulldata, iago, rsf). Same path either way, so no memory/rule/hook path changes.
- Remote: `bas-labs/{client}-planning`, private. Sebas is CTO; the planning folder is the engagement's memory. palazuelos keeps `ilsantino/palazuelos-erp-discovery` (whole folder, no app).
- Exceptions: iago-os root `.iago/` stays tracked in iago-os (it *is* the workspace). `iago-workspaces` and `obsidian-brain` get remotes under the same rule.

### 5. Naming

ISO-dashed dates inside `dev\` (`YYYY-MM-DD-{slug}.md`), lowercase kebab, English file and dir names regardless of content language (rsf and sentria write Spanish content — fine). The compact `YYYYMMDD` grammar stays for OneDrive zones; the two never meet (`file-naming-standard.md` §3). Deliverables that leave the repo (PDF/DOCX to a client) follow the OneDrive grammar because that is where they end up.

### 6. Lifecycle

| Artifact | Create | Close | Archive / delete |
|---|---|---|---|
| plan `feature-x/` | `/iago-plan` | summary exists for every `NN` | → `plans/_archive/YYYY-MM-x/` 60 days after last summary |
| `quick-*.md` | `/iago-quick` | summary exists | delete after 60 days (summary is the record) |
| research | any session | — | superseded → delete; decision-bearing → `_archive/` |
| STATE.md | — | — | lint reports if `Updated:` is > 14 days older than the newest file under `.iago/` **excluding `state/`, `_archive/`, `__pycache__/` and untracked files** — `state/` is written by every pipeline run, so counting it makes STATE.md permanently stale |
| ROADMAP/PROJECT | init | — | rewritten, never archived |
| session digests | Stop hook → vault | — | in-repo copy only as `research/YYYY-MM-DD-session-{slug}.md` and only if decision-bearing |
| worktrees | pipeline | PR merged | pruned in the same post-merge routine as branches |

### 7. Where the standard lives and how it is enforced

- **The linter is the enforcement, not a rule file.** Path-scoping in `.claude/rules/` uses `globs:` (not `paths:`) and **`globs:` is inert in this build** — no loader reads it, so every rule file loads unconditionally in every session of every project. A 45-line schema rule would therefore cost ~900 always-on tokens everywhere to express a constraint that is fully computable, which is exactly what `.claude/rules/layer-triage.md` rule 1 forbids ("one computable right answer → script"). So: `.claude/rules/iago-workspace.md` is **≤ 10 lines** — it says the `.iago/` schema is machine-enforced, names `scripts/organize/iago-lint.py check`, and points at this README. The schema itself lives here and in `templates/`. The routing table stays in `CLAUDE.md` (council decision 2026-05-04).
- **Templates + scaffolders:** `templates/{client,internal}-project/` rewritten to §2 — and `scripts/new-client.sh`, `scripts/new-client.ps1` and `.claude/skills/iago-init/SKILL.md` with them. Those three `mkdir` the banned dirs (`context/`, `reviews/`, top-level `learnings/`) at run time, so editing the template tree alone leaves `/iago-init` emitting non-conforming workspaces.
- **Linter:** `scripts/organize/iago-lint.py`. `check --root PATH` scans exactly one workspace (default `.`); `--all` adds `clients/*/.iago`. Reports every §2/§3/§6 violation with its fix and exits 1 when any are found. **P2 ships `check` only** — `fix --apply`/`undo` are deferred to P5, once the report has been read against real trees and the safe-fix set is known to be safe. Tests first (`test-iago-lint.py`), imported via `importlib.util.spec_from_file_location` exactly as `test-organize.py` does (Python cannot `import iago-lint`). Journals land in the nearest `.iago/state/`.
- **Where it runs:** daily "iaGO File Sweep" (report), and `validate.yml`'s `validate-scripts` job on iago-os PRs — **advisory (`continue-on-error: true`) for its first week**, then blocking once a full week of PRs is clean. W006 (STATE staleness) is excluded in CI: `actions/checkout` gives every file the same mtime, so "newest file under `.iago/`" is always *now* and the rule would fire on every PR forever. The job uses `python`, not `python3` — `python3` is the MS Store stub on this machine.
- **Pipeline fixes** so rot stops at the source (audit §6): worktree placement rule in reviewer prompts; all stage temp paths → `.iago/state/`; worktree prune in post-merge; delete the deprecated bash pipeline.

---

## Phases

Layer marks: **D** deterministic (script/file op) · **R** rule/CI · **A** judgment.

### P0 — Garbage ✅ 2026-08-26
The two `C:Users…` dirs and `clients/.baseline-sentria` deleted; sentria worktrees pruned (5 locked entries remain — P5).

### P1 — Safety net *(1 session, before anything moves)*
1. **D** `dev/.aws/credentials*` → `~/.secure/aws-old/`; **A** Santiago checks IAM for the 04-06 key and revokes if live.
2. **D** Commit `obsidian-brain` (180 dirty files), create private remotes and push: `obsidian-brain`, `iago-workspaces`, `clients/iago/.iago`, `clients/rsf/.iago`.
3. **D** `git init` + first commit + private remote for `clients/{din,fulldata,sentria,munet-web}/.iago`; `git rm --cached` the 1 (sentria) + 4 (munet) `.iago/` files the app repos track and add `.iago/` to their `.gitignore` (app-repo PRs, 2 lines each).
4. **D** `.gitignore` in every planning repo: `state/`.
**Acceptance:** `for c in clients/*/.iago; do git -C $c remote get-url origin; done` prints 7 URLs; `git -C dev/obsidian-brain status --porcelain | wc -l` = 0.

### P1b — Deliverables have no remote either *(found during P4, 1 session)*

P1 backed up every `.iago/`. It did **not** cover the sibling trees in the wrapper-style clients, which no git repo touches at all:

| Client | Unversioned | Size |
|---|---|---|
| din | `marketing/` (88 files — deck sources, builds, dated exports), `branding/` (8) | 128 MB |
| rsf | `discovery/` (58), `catalog/` (24), `deep-research/` (6), plus `entregables/`, `proposals/`, `source-materials/` | 17 MB+ |
| fulldata | `reports/` (6 — incl. the client-facing remediation deliverable), `_pentest/` (15) | 4 MB |

These are **client-facing deliverables**: executive reports, decks that were actually sent, the RSF catalogue. A dead SSD loses them exactly as it would have lost the planning docs.

Not a straight `git add` — din's 128 MB is mostly regenerable render output. Per client: gitignore the build dirs (`marketing/deck/out/`, `png/`), commit sources and the dated `exports/`, then push to the existing `{client}-planning` remote. **A judgment call per tree, so it gets its own pass rather than being improvised mid-cleanse.** `_pentest/` is excluded — it holds session tokens pending the revoke-or-dead call.

### P2 — The grammar *(1–2 sessions, iago-os PR)*
1. **A** `.claude/rules/iago-workspace.md`; rewrite `.iago/CONTEXT.md` to pure L1 with the 7-row client registry (inner-repo column, the May plan 01); delete `.iago/README.md`; fix `execution-pipeline.md` (`.iago/config` → `config.json`); add a CODE-zone line to `file-naming-standard.md` §2 pointing here.
2. **D** Templates rewritten to §2.
3. **D** `iago-lint.py` + tests (RED first). Report mode only in this PR.
4. **D** Archive `feature-mwp-restructure-{docs,clients,code}/` → `plans/_archive/2026-05-mwp-restructure/` with pointer.
**Acceptance:** `python scripts/organize/iago-lint.py --root .` runs and lists the root violations P3 will fix; tests green; rule file ≤ 45 lines.

### P3 — iago-os root cleanse *(1 session, iago-os PR — mostly `git mv`/`git rm`)*
From audit §3: delete the 7 empty `docs/` dirs and `feature-lead-hunt-scrapling/`; 6 superseded specs → `.iago/_archive/2026-08-v1-specs/`; `plans/`: 22 shipped/stale feature dirs → `plans/_archive/2026-0M-{slug}/` (keep `filesystem-order`, `skill-routing`, `caja-terminals`, `phase-2-vps-bootstrap`, `daemon-durability-hardening`, `doc-standard`), drop the duplicate `pipeline-speed-wedges`; `research/`: rename the 8 non-conforming files, delete the 04-28 audit duplicate and the ≥8 shipped-subject files, or `_archive/` if decision-bearing; `.iago/runbooks/*` → `_config/runbooks/`; `handoff/`, `context/`, `decisions/`, `learnings/`, `prompts/`, `hooks/` → under `_config/` (**hooks move = `settings.json` path update in the same commit + smoke test, per the May code plan**); `summaries/*.log`, `_pr-body-*` → delete; `reviews/`, `logs/`, `runs/`, `pipeline-runs/` → `state/` (gitignored); `.iago/state/` decision docs → `research/` or delete; `.inbox-domains.tsv` → delete; fix STATE.md/ROADMAP.md/PROJECT.md `Updated:` + the two broken links; prune the 7 worktrees; commit the 2 untracked research files.
**Acceptance:** `iago-lint.py --root .` = 0 violations; pipeline smoke (`/iago-fast` on a doc) still fires hooks.

### P4 — Clients, one at a time, cheapest first *(4–5 sessions, inline — these trees are not iago-os PRs)*
Order: palazuelos → din → fulldata → iago → rsf → munet-web → sentria. Each: `iago-lint.py --root clients/{c}` → apply §2 (move banned dirs, delete empties/zero-bytes/scratch, merge roadmaps, session logs → `research/` or delete) → wrapper `CLAUDE.md` (≤ 30 lines: identity, inner repos + boundary, routing) → STATE `Updated:` → commit to the planning repo. App-repo changes (docs/ triage, `.gitignore`, `dist/` untrack, `amplify_outputs*.bak`) go as one PR per app repo.
- **A** sentria (185) and munet (43) `docs/` triage: produce a keep/move/delete manifest first (route.py pattern), Santiago approves, then apply in one move.
- **D** dedupes from audit §4.3 (din deck `out/`≡`exports/`, sentria `_archive` pairs and PDF pairs, rsf `entregables` docx, `patterns.md` din≡rsf, fulldata `knowledge.md`).
- **A** fulldata `_pentest/tok_*.txt`: revoke-or-confirm-dead, then delete (do NOT touch prod — `project_fulldata_pentest`).
**Acceptance per client:** lint = 0; planning repo pushed; STATE `Updated:` = commit date.

### P5 — Enforcement live *(1 session, iago-os PR)*
`iago-lint.py` into `sweep.py` (report) and `validate.yml` (root, fail); reviewer prompt worktree rule + `git worktree remove --force` verification in `execute-pipeline.js` / `dual-adversarial.js`; all stage temp paths → `.iago/state/`; worktree prune added to the post-merge routine in `git-workflow.md`; delete `scripts/execute-pipeline.sh` + exclusive libs/tests (verify `metrics-aggregate.mjs` imports first); unlock and prune the 5 sentria stale entries (`attrib -r` on `.git/worktrees/*`).
**Acceptance:** a PR that adds `.iago/_scratch-x.md` fails CI; a pipeline run leaves nothing new outside `state/`.

### P6 — `dev\` root *(0.5 session)*
**A** Santiago: confirm whether Google Drive for desktop backs up `dev\`; if yes remove it from the backup set (the OneDrive lesson, P3b). Then **D**: delete `.tmp.driveupload/` (603 MB), `pr-body-a{3,4}.md`, `obsidian-brain-backups/` tarball, `MWP/{files,llm-council,workspace-blueprint}.zip` after an unpack-check; `MWP/ui_files/` → `_archive/onedrive-20260817/genesis-lab/`; `MWP/*.md` → `iago-workspaces/_blueprints/`; `_archive/…/{CrewAI-Studio-main,dintransfer_lp}` → delete; `obsidian-brain/2026-05-20.md` → `daily/`; empty skeleton dirs in `sentria-predictive-maintenance`, `iago-leadgen`, `iago-workspaces`; `career-ops/data/*.bak`.
**Acceptance:** `dev\` root = repos + `MWP/` + `_archive/`, nothing loose.

### P7 — later, not scoped
Vault ↔ `clients/` alignment (`allende`, `drb`, `installflow`, `tenet` have vault hubs and no repo; `iago`, `munet-web`, `palazuelos` the reverse). `sentria-predictive-maintenance` → `clients/sentria-pm/`? Decide when it has code.

---

## Execution path

- P2, P3, P5 are iago-os changes → `/iago-plan --feature .iago/plans/feature-doc-standard/README.md` writes three plans (`01-grammar`, `02-root-cleanse`, `03-enforcement`) → `/iago-execute`. The lint script is TDD (`tdd.md`).
- P1, P4, P6 are file ops in other repos / untracked trees → inline, per `feedback_inline_impl_over_pipeline` (the map above is the hands); one gate at the end of each = `iago-lint.py` clean + planning repo pushed.
- Never `git add -f` inside `clients/`; app-repo changes are PRs to those repos (`feedback_clients_separate_repo`). sentria PRs base `sentria-qc`, iago-web PRs base `iago-web-qc`.

## Decisions

1. ~~Planning remote org~~ — **RESOLVED 2026-08-26: `bas-labs`.** Six private planning repos created and pushed (see P1). Personal trees (`obsidian-brain`, `iago-workspaces`) went to `ilsantino` instead — the vault holds personal and family-finance notes and must not sit in the org Sebas can read.
2. ~~Is `dev\` in a Drive backup set?~~ — **RESOLVED 2026-08-26: yes.** Google Drive for desktop v130.0.2.0 is installed and was updated 2026-08-25; `HKCU\Software\Google\DriveFS` carries a `machine_root_doc_id`, i.e. the "back up this computer's folders" feature is configured. That is what writes `dev/.tmp.driveupload` (603 MB, 17,686 files). **This is the OneDrive pathology of P3b repeating on a second provider** — `node_modules`, `.git` and `dist/` trees dragged through continuous sync. → **ACTION FOR SANTIAGO (blocks P6):** Drive preferences → *My Computer* → remove `dev` from the backed-up folders. Deleting the cache before that just triggers a 17k-file re-upload, so it is held deliberately.
3. ~~Loose AWS keys~~ — **RESOLVED 2026-08-26: both dead.** `dev/.aws/credentials` and `credentials.txt` each carried an `AKIAYPBR…` key; both return `InvalidClientTokenId` from `sts get-caller-identity`. Moved to `~/.secure/aws-old/` with a note rather than deleted. **Still open:** fulldata `_pentest/tok_*.txt` (5 files) — app-session tokens, not AWS; confirm dead before P4 deletes them.
4. **OPEN** — sentria/munet `docs/` deletion manifest: you approve it when P4 produces it.

## Status

| Phase | State |
|---|---|
| P0 garbage | **DONE** 2026-08-26 |
| P1 safety net | **DONE** 2026-08-26 — 9 trees now have remotes, all clean. 6 client planning repos under `bas-labs/{din,fulldata,sentria,munet,iago-web,rsf}-planning`; `ilsantino/{obsidian-brain,iago-workspaces}`; palazuelos already had one. Dead AWS keys quarantined. **Deferred to P4:** untracking the 5 stale `.iago/` files still tracked by the sentria (1) and munet (4) app repos — batched with those repos' other cleanup so it costs one PR each, not two |
| P2 grammar | **IN FLIGHT** — `/iago-plan --feature` → `/iago-execute` |
| P3 root cleanse | after P2 |
| P1b deliverables | **NEW** — found during P4; din/rsf/fulldata sibling trees have no remote |
| P4 clients | **2 of 7 done** — palazuelos + din adopted the schema and pushed. Next: fulldata, iago, rsf, munet-web, sentria |
| P5 enforcement | after P3 |
| P6 dev root | **blocked on one action:** remove `dev` from the Drive backup set (decision 2) |
| P7 | not scoped |
