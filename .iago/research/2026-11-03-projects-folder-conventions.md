# Drive `IAGO/Projects/` — what `iago-workspaces` (MWP) adds, and the gap per project

Date: 2026-11-03. Scope: the 11 live project folders and `_archive/` under `My Drive/IAGO/Projects/`,
read against `ilsantino/iago-workspaces` (main, 2026-10-28) and the 2026-10-28 filesystem audit.
Companion: Drive `IAGO/README.md`, `~/Developer/CLAUDE.md`,
`~/Developer/iago-os/.iago/research/2026-10-28-filesystem-architecture.md`.
Nothing was created, moved or renamed in Drive for this report.

## 1. Verdict

The folder *taxonomy* in `Projects/` is right and should not change: by-kind folders
(`received/ deliverables/ meetings/ research/ media/ brand/ admin/`, `clients/<C>/` for products),
dated subfolders, status in the repo, one README per project. The 2026-10-28 audit already
rejected the alternative and the repo itself retired its `consulting-practice/` stub on 2026-10-27
with the note that client work lives in each repo's `.iago/` plus Drive `Projects/`.

What `iago-workspaces` adds is not structure but **three disciplines** the Drive folders lack today:

1. **A router, not a description.** MWP's L2 `CONTEXT.md` answers "I want X → open Y", states
   *inputs → output*, *done looks like* and *what NOT to do*. The 11 project READMEs describe folders
   in three different styles and never route. Fix: one README template with a routing table.
2. **An auto-loaded map.** Claude Code is being opened directly in Drive project folders
   (`Projects/RSF`, `Projects/Valorarrend` are in the recent-folders list), where no `CLAUDE.md`
   exists, so the README is never loaded and the "write by id, never through the mount" rule is
   not in context. Fix: a 10-line `CLAUDE.md` per project folder that points at the README and the repo.
3. **Named conventions, enforced at the leaf.** MWP fixes the filename pattern per stage.
   Here the dated-folder rule is followed in `deliverables/` (41/41) and broken almost everywhere
   else: `meetings/` are raw Google Meet names with EN/ES duplicates, `research/` has 20 loose files
   and 7 undated folders, build sources (`_src/`, `.py`) sit in Drive for two projects.

What must **not** be imported from the repo: numbered pipeline stages (`01_idea … 05_distribute`) and
`_config/` folders. Those model a production line; a project folder models an exchange with a
client. The deliverable chain (`1-fuentes … 4-entregado`) already lives in the repos.

## 2. The standard, written down once

### 2.1 Folder set (unchanged, now with definitions and two additions)

| Folder | Holds | Subfolder rule |
|---|---|---|
| `received/` | What the client or a vendor sent, as sent. Orange. | `YYYY-MM-DD-slug/` per batch, or `hardware/`, `site-snapshot/` for non-document material |
| `deliverables/` | The copy the client received. Blue. Built in the repo, never edited here. | `YYYY-MM[-DD]-slug/`; one `README.md` index at the top (Sentria has it; nine do not) |
| `meetings/` | Gemini notes and recordings filed from Google Meet | flat files `YYYY-MM-DD-slug-notes-es.gdoc` / `-recording.mp4`; a folder only when Meet produced one |
| `research/` | Business and pre-sales research, PRDs, memos (documents, not images) | `YYYY-MM-slug/`; loose files only `README.md` |
| `internal/` **(promote from RSF to standard)** | iaGO-only working material the client never sees: cost structures, reading packs, scripts, contract technical references | `YYYY-MM-slug/` |
| `media/` | Visual material: `assets/` (stock, logos received), `captures/` (site screenshots, probes), `demos/`, `_source/` (crawls) | kind folders, dated inside when a batch |
| `brand/` | The client's or product's identity as approved | `logo/ palette/ typography.md`; explorations in `YYYY-MM-explorations/` |
| `admin/` | iaGO paperwork sent to the client (CSF, alta de proveedor). Sensitive. | `YYYY-MM-slug/` |
| `clients/<Client>/` | Products with several clients: the same set one level down | same rules |
| `sessions/` **(RSF only, exempt)** | Client session packs indexed by `rsf/FUENTES.md` | keeps `NN_YYYY-MM-DD_slug` |

`business/` (Munet) is `internal/`. `media/research/` (six projects) is `media/captures/`.

### 2.2 File naming

- Dated folders: `YYYY-MM-slug` or `YYYY-MM-DD-slug`, lowercase, hyphens, no spaces, no accents.
- Meeting files: `YYYY-MM-DD-slug-notes-es.gdoc`, `-notes-en.gdoc`, `-recording.mp4`, `-transcript.gdoc`.
  Keep one language per meeting: Spanish when the meeting was in Spanish; the English Gemini twin goes to the trash.
- Markdown uploaded as a Google Doc loses its `.md`: `kit-operativo.md.gdoc` → `kit-operativo.gdoc`.
- Never `(1)`, `Copia de`, `conflicted copy`: rename to the real version or trash the duplicate.
- Old versions: `_old/` or `_anterior-YYYY-MM/` inside the same folder, never deleted (existing rule).
- No `_src/`, `build.py`, `md2html.py` in Drive: sources live in the repo (`<repo>/.iago/` or `docs/`).

### 2.3 `Projects/<P>/README.md` template (MWP L2 shape)

```markdown
# <Project> — <one line: what it is, who the client is>

Code and status: `~/Developer/<repo>` (GitHub <org>/<repo>) → `.iago/STATE.md`.   ← or "no repo: STATE.md here"
Drive folder id: <id>. Writes go through the Drive connector by id, never through the Finder mount.

## I want to … → open

| Need | Open |
|---|---|
| The last thing we sent the client | `deliverables/README.md` (index), then the dated folder |
| What the client sent us | `received/` |
| What was said in a meeting | `meetings/YYYY-MM-DD-…-notes-es.gdoc` |
| Pre-sales / business research | `research/` |
| iaGO-only working notes | `internal/` |
| Logo, palette, fonts | `brand/` |
| Paperwork we sent (CSF, alta) | `admin/` |

## Folders

<one row per folder that exists, with the dated subfolders listed>

## Done looks like

A deliverable is "done" when its PDF/PPTX is in `deliverables/YYYY-MM-slug/`, the index README has the row
(date, sent to, channel, version) and the repo STATE.md records the send.

## What NOT to do

- Do not edit deliverables here; rebuild in the repo and re-export.
- Do not copy `received/` or `sessions/` material into the repo.
- Do not file in Drive what belongs in `.iago/` (plans, runbooks, technical research).

## Log

<consolidation history lines, newest first>
```

### 2.4 `Projects/<P>/CLAUDE.md` (new, 10 lines, identical shape in every project)

```markdown
# <Project> (Drive project folder) — read README.md first

This is the client-material folder, not the code. Code, plans and STATE: `~/Developer/<repo>`.
Rules: `~/Developer/CLAUDE.md` (map) and Drive `IAGO/README.md`.
Create, move or rename files here through the Drive connector by id (`<folder id>`), never through this mount.
English on disk; Spanish only in what the client receives.
```

The template and the CLAUDE.md stub belong in `iago-os/templates/` (versioned), linked from `Projects/README.md`.

## 3. Gap per project

Legend: ✔ conforms · ✘ gap · — folder absent (fine if README says so).

| Project | README style | deliverables | meetings | research | media | Other gaps |
|---|---|---|---|---|---|---|
| **Credito** | table + STATE (closest to template) | ✔ 1 dated, has README; `md2html.py` inside ✘ | — (documented) | ✔ 2 dated | — | `STATE.md` here is the documented exception (no repo) |
| **DIN** | consolidated notes | ✔ 4 dated, no index | ✘ 4 loose raw names, 2 recordings unnamed | ✘ 4 loose docs + undated `DIN (2024-25)` shortcut | ✘ `media/research` | `received/` file is a "conflicted copy" ✘ |
| **Fulldata** | consolidated notes | ✔ 7 dated, no index | ✘ 7 loose + 1 Meet folder; 2 EN/ES pairs | ✘ 2 loose docs, `bot-asistente-notes/`, `scripts/` undated | ✘ `media/research` | — |
| **Munet** | table | ✔ 4 dated; `(1).docx` duplicate ✘ | — (README promises it; nothing filed yet) | ✘ 7 loose docs, all internal notes (`.md.gdoc` names) | — | `business/` → `internal/` ✘ |
| **Palazuelos** | consolidated notes | — (README says "Here: received/, meetings/" but neither `received/` nor `deliverables/` exists) ✘ | ✘ 5 loose; 1 EN/ES pair | ✘ 3 loose (financial model, discovery note twice: .md and .gdoc) | — | README drift ✘ |
| **RSF** | table (best README) | ✔ 4 dated, no index | ✘ 3 loose; 1 EN/ES pair (the `sessions/NN/` copies are the indexed ones) | ✔ 1 dated; ideas folder has a `(1).pdf` duplicate ✘ | — | `internal/research` undated ✘; `sessions/` exempt ✔ |
| **Recibia** | one-liner | ✘ 14 loose files, `_src/` (10 build scripts), `_assets/` (QA frames, cache) in Drive | — | — | `media/assets` ✔ | repo `~/Developer/recibia` has no `.iago/`; sources have no home there yet |
| **Scientia** | one-liner | ✔ 3 dated, 2 with README | — (none filed; no Meet notes exist for it) | — | ✘ `media/research`, `media/_archive` | — |
| **Sentria** | consolidated notes | ✔ 6 dated **with index README** (the model) | ✘ 12 loose + 3 Meet folders; 3 EN/ES pairs | ✘ 3 undated folders + loose `to-do.gsheet` (task sheets are `internal/`) | ✘ `media/research` (15 capture folders, dated inside ✔) | `clients/Absara`, `Vaqueras` ✔ |
| **Valorarrend** | one-liner | ✔ 5 dated, 1 with README; `ad-budget-simulation.py` inside ✘ | ✘ 1 loose + 2 Meet folders | — | ✘ `media/research`, `media/_config/scripts` (scripts in Drive) | `brand/` ✔ (has README) |
| **Vantek** | one-liner | ✔ 6 dated, 2 with README; `_src/` ×3 and `build.py` in Drive ✘ | — | — | ✘ `media/research`, `media/_source` ✔ | `received/site-snapshot` ✔ |
| **_archive** | one README | untouched by design ✔ | | | | 5 `(1)`/`Copia de` duplicates; leave, archive is frozen |

Counts across live projects: 32 loose meeting files, 7 EN/ES duplicate pairs, 20 loose research files,
7 undated research folders, 4 projects with build sources in Drive, 9 of 10 `deliverables/` without an index,
3 `(1)` duplicates outside `_archive`, 1 README that describes folders that do not exist (Palazuelos).

## 4. What to execute, in order

**Phase A — Claude, through the Drive connector by id, no deletions (≈ 1 session):**

1. Write `CLAUDE.md` (§2.4) into the 11 project folders.
2. Rewrite the 11 `README.md` on the §2.3 template; fix Palazuelos (folders that exist: `research/`, `meetings/`).
3. Add `deliverables/README.md` index to the nine projects without one, one row per dated folder
   (date · what · sent to · channel · version), copying Sentria's shape.
4. Rename meeting files to `YYYY-MM-DD-slug-notes-es` (32 files, 6 Meet folders) and recordings to `-recording`.
   DIN's two recordings get a date in the name.
5. `research/`: create dated folders and move the loose files
   (DIN `2026-07-openclaw-prd/`, `2026-05-pricing-module-prompt/`; Fulldata `2026-05-bot-asistente-notes/`,
   `2026-05-demo-scripts/`; Palazuelos `2026-05-erp-discovery/`; Sentria `2026-01-technical-docs/`,
   `2026-03-whatsapp-templates/`). Dates from the Drive `createdTime`, confirmed per file at execution.
6. Rename `media/research/` → `media/captures/` in six projects; `Munet/business/` → `internal/`;
   Munet's seven research docs → `internal/2026-06-notas-operacion/`; Sentria `to-do.gsheet`,
   `research/tasks-2026/` → `internal/`; strip `.md` from `.md.gdoc` names.
7. Recibia: group the 14 loose deliverables into `2026-10-pitch-deck/`, `2026-10-deck-v2/`,
   `2026-10-storyboard-usuarios/`, `2026-10-business-case/` (all share the 2026-10-27 upload date; the real send
   dates come from the repo STATE and are confirmed at execution).
8. Put the template and the CLAUDE.md stub in `iago-os/templates/drive-project/`, link from `Projects/README.md`,
   and add §2.2 to Drive `IAGO/README.md`.

**Phase B — Santiago decides (deletions or repo moves):**

- Trash the 7 English Gemini twins (Fulldata ×2, Sentria ×3, RSF ×1, Palazuelos ×1) and the 3 `(1)` duplicates
  (Munet propuesta DOCX, Munet `_old` budget, RSF ideas PDF). Rename DIN's "conflicted copy" workbook to
  `2024-10-16-bm-241016.xlsx` after confirming it is the only copy.
- Move build sources out of Drive into the repo: Recibia `_src/`, `_assets/` → `~/Developer/recibia/.iago/deliverables/`
  (create `.iago/` there first); Vantek `_src/` ×3 and `build.py` → `vantek-web/.iago/deliverables/`;
  Valorarrend `ad-budget-simulation.py`, `media/_config/scripts` → `valorarrend-web/.iago/`;
  Credito `md2html.py` stays until the repo exists.
- Confirm `internal/` as a standard folder (it changes `~/Developer/CLAUDE.md` "Where a new file goes" and Drive `IAGO/README.md`).

**Not recommended:** numbered stage folders in Drive, `_config/` per project, a second STATE file in Drive,
renaming RSF `sessions/`, touching `_archive/`.

## 5. Phase A executed 2026-11-03 (evening), through the Drive connector by id

Nothing deleted or trashed. The Finder mount showed every change within a minute.

- `CLAUDE.md` created in the 11 project folders; `README.md` rewritten in all 11 on the §2.3 shape (content overwritten through the mount, ids unchanged); `Projects/README.md` rewritten as the conventions page; `IAGO/README.md` got the pointer line.
- `deliverables/README.md` index created in the nine projects that lacked one (Sentria already had it).
- Meetings: 32 flat Gemini files and 6 Meet folders (with their inner notes) renamed `YYYY-MM-DD-slug-notes-es|en` / `-recording`; DIN's two recordings dated from their Drive `createdTime`.
- Research: DIN `2026-03-openclaw-prd/`, `2026-05-pricing-module-notes/`; Fulldata `2026-04-ideas-implementacion/`, `2026-05-bot-asistente-notes/`, `2026-05-demo-scripts/`; Palazuelos `2026-05-erp-discovery/`; Sentria `2026-01-technical-docs/`, `2026-01-whatsapp-templates/`. The DIN `(2024-25)` shortcut to the gmail archive stays loose by design.
- `internal/`: Munet `business/` renamed and its files plus the seven research docs filed into `2026-03-arquitectura-pagos/`, `2026-04-mejoras-producto/`, `2026-06-costeo-y-contrato/`; Sentria `internal/tasks-2026/` (task workbooks + `to-do` sheet).
- `media/research/` → `media/captures/` in DIN, Fulldata, Scientia, Sentria, Valorarrend, Vantek.
- `.md` suffix stripped from 36 Google Docs (Munet 5, DIN 1, Palazuelos 1, Fulldata 6, RSF implementation-ideas 23).
- Recibia: 14 loose deliverables grouped into `2026-10-pitch-deck/`, `2026-10-deck-v2/`, `2026-10-storyboard-usuarios/`, `2026-10-business-case/` (dated by the 2026-10-26 rebuild recorded in `recibia/STATE.md`).
- Template in `iago-os/templates/drive-project/` (README, CLAUDE.md, deliverables index); `home/developer/CLAUDE.md` row updated (the live `~/Developer/CLAUDE.md` is re-wired by `home/install-mac.sh`).

**Could not do:** «Cambios estéticos (y lowkey funcionales) MUNET» is owned by francisco@ and the connector may not move it; it stays in `Munet/research/` until Francisco moves it to `internal/2026-04-mejoras-producto/`.

**Phase B still open (Santiago):** the 7 English Gemini twins, the 3 `(1)` duplicates, DIN's "conflicted copy" workbook, build sources (`_src/`, `.py`, `media/_config/scripts`) out of Drive and into the repos, and confirming `internal/` as standard in `~/Developer/CLAUDE.md`.
