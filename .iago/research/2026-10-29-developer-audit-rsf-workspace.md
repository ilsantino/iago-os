# ~/Developer audit and RSF workspace redesign (2026-10-29)

Inspected: every folder in `~/Developer` (remote, branch, dirty files, unpushed commits on any branch, stash), GitHub
`bas-labs` and `ilsantino`, the migration staging copies of RSF, Drive `IAGO/Projects/RSF/` (every file at depth 3),
the `rsf` repo (CLAUDE, CONTEXT, STATE, FUENTES, the 28-oct registers) and the Claude memory keys under `~/.claude/projects`.
Two repos were cloned (additive) and a global gitignore for `.DS_Store` was set. **Executed 12:30 with Santiago's approval:** the six dormant clones moved to `~/.Trash` after a second zero-unpushed check; `ilsantino/recibia` created (private) and pushed; the 17 vault digests committed (`bb8151c`) and pushed; both `CLAUDE.md` maps updated. Still open: rsf push and rename, the Drive RSF moves (after 2-nov).

## 1 · What is in ~/Developer against the wanted list

Wanted (Santiago, 29-oct): bas-labs `scientia-web munet-web valorarrend-web vantek-web iago-web sentria rsf-flow-tool
iago-management academics`; ilsantino `iago-os obsidian-brain palazuelos`.

| Folder | Remote | State (29-oct 12:10) | Verdict |
|---|---|---|---|
| scientia-web, munet-web, valorarrend-web, vantek-web, iago-web, sentria, rsf-flow-tool | bas-labs | clean, pushed, on `iago-context-2026-10` (PRs open) | keep |
| iago-management | bas-labs | **cloned today** (118 commits, last 27-aug) | keep |
| academics | bas-labs | **cloned today** (262 commits, last 7-aug) | keep |
| iago-os | ilsantino | 1 untracked research file from another live session | keep |
| obsidian-brain | ilsantino | 17 untracked session digests (Stop hook output, never committed) | keep; commit the digests |
| palazuelos-erp-discovery | ilsantino | clean, pushed; 2 memory files | keep (= «palazuelos» on the list) |
| palazuelos-web | bas-labs | clean, pushed, 26 commits | keep (site code; not on the list, 6 MB) |
| **rsf** | ilsantino/**ws-rsf** | 3 commits unpushed, 3 `.DS_Store` untracked; **a Claude session is live in it today** | keep, see §2 |
| recibia | **no remote** | 3 commits exist only on this Mac | keep; create `ilsantino/recibia` and push |
| career-ops | santifer (personal) | clean, pushed, 146 MB | remove the clone |
| dinpro-pricing | ilsantino | clean, pushed; `.iago/` in git | remove the clone |
| fulldata-bot-asistente | ilsantino | clean, pushed; planning docs only; 4 memory files | remove the clone |
| iago-leadgen | ilsantino | clean, pushed, 3 commits | remove the clone |
| iago-workspaces | ilsantino | clean, pushed; non-code (MWP) | remove the clone |
| sentria-predictive-maintenance | ilsantino | clean, pushed, 4 commits | remove the clone |

"Remove the clone" is safe by verification: zero commits on any local branch that the remote lacks, zero stash, zero
uncommitted files. The `.iago/` folders travel in git. Claude memory for these repos stays where it is
(`~/.claude/projects/-Users-alvarez-Developer-<repo>/memory/`) and reattaches the moment the repo is cloned back to the same
path: `gh repo clone ilsantino/<repo> ~/Developer/<repo>`. Nothing from these repos belongs in Drive: they are git
history, not documents.

Uncloned and left alone: bas-labs `iago-studios`, `valideoai`, archived `install-flow-app`, `soy-jd-webapp`; ilsantino
`genesis-lab`, `fulldata-pricing-mock`.

## 2 · rsf and «ws-rsf»

There is **one** folder, `~/Developer/rsf`, and it is the clone of GitHub `ilsantino/ws-rsf`. No `ws-rsf` folder exists
on disk; the name shows up only as the remote, in GitHub, and in the migration staging (`~/migration-2026-10/workspaces/rsf`
= the 27-oct bundle restore at commit 361f249, older than the live HEAD; `~/migration-2026-10/extracted/development/development/rsf/`
= the Surface working copy, plus `rsf-dev`, the pre-GitHub copy of the flow tool).

It is not a duplicate of `Projects/RSF`. It is the engagement's working memory and build chain: 920 markdown files,
11 deliverable chains (`deliverables/<date>-<slug>/{1-fuentes,2-evidencia,3-analisis,4-entregado}`), `CONTEXT.md`,
`STATE.md`, `DECISIONS.md` (53 KB), `FUENTES.md` (the index of every client file in Drive by id), the registers of
28-oct, runbooks, and the versioned Claude memory (`_memory/claude/`, linked from `~/.claude/projects/-Users-alvarez-Developer-rsf/memory`).
Drive holds the client's originals and the sent copies; the repo holds what iaGO derived. The two were designed
as complements on 2026-09-07 and 2026-10-09 (rule: client material never copied to disk).

Why it lives in Developer although RSF has no code: it is git (history, diffs, branches), Claude reads it by path, and
Drive cannot hold a `.git` tree safely. It is the documented exception in both `CLAUDE.md` maps. Moving it into Drive
would break the memory link, the pipeline scripts and the live session.

Staging copies vs the live repo (rsync, ignoring generated files): 31 files exist only in staging. 1 Word lock file;
4 quote HTML chapters superseded by the renumbered chain committed 27-oct (`9e1252b`); 4 files in `recieved/` that are
byte copies of Drive `sessions/11/recibido/`; 22 copies and markdown conversions of RSF's manuals that the 9-oct cleanup
removed on purpose. `rsf-dev` vs `rsf-flow-tool`: 11 generated files (e2e screenshots, font binaries). Nothing to rescue;
the staging goes with Phase 5 as already planned.

Pending in the repo itself (its STATE.md, item 5): push `main` (3 commits since 27-oct, including last night's mockup v2
and the guion for today's 1:00 pm session). Recommended rename of the GitHub repo `ilsantino/ws-rsf` → `ilsantino/rsf`
so folder and repo carry the same name everywhere (GitHub redirects the old name; `git remote set-url` afterwards).

## 3 · Projects/RSF in Drive: what is there and what is wrong with it

Today (consolidated 28-oct): `sessions/00…13` each with `recibido/`, `enviado/`, `00-CONTEXTO`, transcript, recording;
`deliverables/` with `2026-09-30-paquete-sesiones/` split into six «Correo B / C / 3 / 4 / 5 / 6» folders;
`internal/2026-09-lectura-interna-sesiones/` (A guiones · B correos · C análisis · D tableros); `research/` (May ideas);
`admin/` (alta de proveedor); `meetings/` (3 Gemini notes, two of them duplicates of session 06).

Problems: received files are findable only if you remember which session they arrived in (the 20 cost workbooks are spread
over sessions 01, 06, 07, 08); the September package is filed by e-mail; the same quote exists in three places
(`00_PREVIO/enviado`, `deliverables/2026-08-03-cotizacion`, repo); drafts and sent versions sit side by side with
«(no usar)» in the name; what RSF actually received since October (8-oct package, 19-oct and 27-oct quotes) is only
inside `sessions/*/enviado/`.

## 4 · Proposed layout (by the work, not by the mail)

```
IAGO/Projects/RSF/
  README.md                      context pointer: repo, register, who is who (exists; rewrite)
  received/                      originals from RSF, never renamed, one copy each (Drive file ids unchanged)
    manuales-de-procedimientos/  7 manuals + PERFIL DE ANALISTA + MAPEO CALCULO RENTABILIDAD.png (from 00) · Manual de costos.docx (from 11)
    libros-de-costos/            COSTO DE PRODUCCIÓN jun/jul/ago × Agrícola/Berrysal/San Miguel, BERRYSAL JULIO, 1Costos por FG cliente (01, 08)
    cuentas-y-consumos/          Cuentasdegastos 6001-6030, EEJConsumos por orden, ETAPAS ORDEN DE PRODUCCION, IS SEM35 (01)
    rentabilidad/                Mapeos Rentabilidad.xlsx (03), Paso 1 Para Matriz, Calculos para Matriz, GANTT JULIO (06, 08)
    ventas-fletes-exportacion/   Reporte_Fletes, fletes Julio, transportes julio, ventas Exportación, Reporte de ventas, July AER, Mano de obra Empaque, Clasificación antidumping (06, 07, 08)
    observaciones-de-rsf/        the two annotated PDFs, the filled lista-de-funciones, Plataforma de costos 1.docx (11)
  working/                       iaGO-internal, never sent (today's internal/ moved as is)
    2026-09-lectura-interna-sesiones/   A guiones · B correos · C análisis de respaldo · D tableros, unchanged
  delivered/                     what RSF received, one folder per document family, every version kept, newest last
    2026-06-presentacion/        Presentacion.pdf + the three guiones (from deliverables/2026-06-30-presentacion)
    cotizaciones/                COT-001 2026-08-03 (docx, pdf, calculadora) · COT-RSF-002 2026-09-28 · 2026-10-16 (sent 19-oct) · 2026-10-27 (sent, current)
    2026-08-hallazgos-costeo/    Hallazgos de Costeo RSF.pdf (28-aug) · 20260828-rsf-rentabilidad-fg.pdf (1-sep)
    2026-09-paquete-sesiones/    the 13 numbered PDFs, the mockup html, the three XL files and the structures PDF, flat (no «Correo» folders)
    2026-10-propuesta-y-maqueta/ the 8-oct set: propuestas-y-fases, maqueta.html, maqueta-modulos.pdf, lista-de-funciones.xlsx, mapa-sesion-1.html, proceso-rsf.pdf
    _superseded/                 2026-09-23 drafts («_anterior-23sep»), kept for history, named so nobody opens them by mistake
  meetings/                      one folder per session, as sessions/ is today (00-CONTEXTO, transcript, recording), minus recibido/ and enviado/
    00_2026-07_previo … 13_2026-10-27_Revision-cotizacion, + 00a_2026-06-30 (the RSF | IAGO AG note now in meetings/), + 14_2026-10-29_Manual-y-Almacenes …
  admin/                         unchanged (alta de proveedor; sensitive)
  research/                      unchanged (2026-05 implementation ideas)
```

Context (memory, requirements, decisions, next steps) stays in the repo: `rsf/CONTEXT.md`, `STATE.md`, `DECISIONS.md`,
`PROCESS-AND-FINDINGS.md`. Drive's README points there; nothing is duplicated into Drive because Drive cannot version
markdown and Claude reads it from the repo.

Traceability (which mail or meeting a document came from, version, what it relates to) is the register that already
exists, `rsf/research/2026-10-28-audit-historico/register.md` (sessions and transcripts · received · sent, each row with
Gmail thread id, Drive location, on-disk copy, analysis that used it) with `email-register-historico.md` and
`email-register-2026-10.md` behind it. It moves to `rsf/REGISTER.md` (top level, next to FUENTES) and gains one column,
«Drive path after 2026-11», when the move is done. Mail is metadata in a table, not a folder level.

Versions: delivered documents keep their date prefix (`20261016-…`, `20261027-…`) and sit in the same folder, so the
newest is last and the history is visible; drafts never enter `delivered/`, they stay in the repo chain
(`3-analisis/`) or in `working/`. The repo's `4-entregado/` folders are the build output; after the move the binaries
are gitignored and the Drive `delivered/` copy is the authoritative sent file (decision already pending since 27-oct).

## 5 · Exact moves (all by Drive id through the connector; file ids never change, so FUENTES links keep working)

| # | From | To |
|---|---|---|
| D1 | `sessions/*/recibido/*` (6 folders, 44 files) | `received/<category>/` as listed in §4 |
| D2 | `sessions/00_PREVIO/enviado/RSF_COTIZACION_20260803.pdf` | trash (identical to `deliverables/2026-08-03-cotizacion/`) |
| D3 | `sessions/02/enviado/Hallazgos de Costeo RSF.pdf`, `sessions/05/enviado/` (same file), `sessions/06/enviado/20260828-rsf-rentabilidad-fg.pdf` | `delivered/2026-08-hallazgos-costeo/` (one copy of each) |
| D4 | `sessions/10b/enviado/*` (7 files) | `delivered/2026-10-propuesta-y-maqueta/` |
| D5 | `sessions/13/enviado/*` (2 quotes) | `delivered/cotizaciones/` |
| D6 | `deliverables/2026-09-30-paquete-sesiones/<Correo …>/*` (6 folders) | `delivered/2026-09-paquete-sesiones/` flat; the `6 · cotización 1` pair → `delivered/cotizaciones/`; `_anterior-23sep` → `delivered/_superseded/2026-09-23-paquete/` |
| D7 | `deliverables/2026-06-30-presentacion/`, `deliverables/2026-08-03-cotizacion/` | `delivered/2026-06-presentacion/`, `delivered/cotizaciones/` |
| D8 | `internal/` | `working/` (rename) |
| D9 | `sessions/` | `meetings/` (rename; id `1yHrYbf5D-3x4i3di1e4aAi-uRWNNJftt` unchanged); today's three notes in `meetings/` → `00a_2026-06-30…` and trash the two Dudas duplicates |
| D10 | repo `deliverables/*/4-entregado/*.{pdf,docx,xlsx,html}` not yet in Drive (reporte ejecutivo, descubrimiento de costeo, guiones, proceso consolidado 15-sep and 28-sep, netsuite-hoy, maqueta v2 once shown) | `delivered/<family>/`, then gitignore the binaries in the repo |
| R1 | `rsf/research/2026-10-28-audit-historico/register.md` | `rsf/REGISTER.md` (+ Drive-path column); FUENTES.md and the five `00-CONTEXTO` docs updated for the new paths |

Timing: **after the Mon 2-nov session**. Today 1:00 pm (Manual y Almacenes), Fri 30-oct and Mon 2-nov run on the current
FUENTES and registers; moving folders under a live engagement week buys nothing and risks a wrong link in a session.
D10's gitignore change is a repo commit the live RSF session should make, not this one.

## 6 · Also worth fixing

- `obsidian-brain`: 17 session digests untracked since 27-oct; the Stop hook writes them but nothing commits. Commit now
  and add a weekly `git add sessions/ && git commit` to the routine.
- `.DS_Store` keeps entering `git status` (rsf, rsf-flow-tool). Set today: `~/.gitignore_global` with `.DS_Store`, wired
  through `git config --global core.excludesfile`.
- `rsf-flow-tool` and `rsf` share the Drive folder but `rsf-flow-tool` has no `.iago/` and no memory key; fine while paused.
- `~/Developer/CLAUDE.md` map: update after the removals (rows for the removed repos become one line «dormant, on GitHub,
  reclone with …»), and the `rsf` row once the repo is renamed.
