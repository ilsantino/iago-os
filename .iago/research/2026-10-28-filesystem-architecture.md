# Filesystem and information architecture — audit, decisions, migration plan

Date: 2026-10-28. Scope: the new Mac (`alvarez`), both Google Drive accounts, the old iaGO backup, the Claude Code memory.
Companion: Drive `IAGO/README.md` (the one-page navigation guide), `~/Developer/CLAUDE.md` (repo ↔ project map).

## 1. Verdict

The architecture built on 27–28 Oct is already the one to keep. What was missing was not structure but *legibility*: Finder had
twelve Favorites (three nested Drive entries plus `rsf`/`RSF` and `munet-web`/`Munet` pairs), the Drive root still showed nine
folders beside `IAGO/`, and the migration memory lived under a throw-away session key. Those are fixed or planned below.
No folder was created, moved or deleted in Drive this session.

## 2. Authoritative architecture (real paths)

| Place | Finder Favorite | Absolute path | What lives there |
|---|---|---|---|
| Code | **Developer** | `/Users/alvarez/Developer/<repo>/` | One folder per GitHub repo, flat, named as on GitHub. Development context in `<repo>/.iago/` (STATE, plans, research, runbooks). |
| Project documents | **Projects** | `/Users/alvarez/Library/CloudStorage/GoogleDrive-santiago@iagoag.com/My Drive/IAGO/Projects/<Project>/` | `received/`, `deliverables/YYYY-MM[-DD]-slug/`, `meetings/`, `research/`, `media/`, `brand/`, `admin/`; `clients/<Client>/` when a product serves several clients (Sentria). |
| Company | **IAGO** | `…/My Drive/IAGO/` | `Company/` (brand, web deliverables, templates, methodology, products; fiscal and legal to come), `Content/`, `Reference/`, `Backups/`, and `Projects/`. |
| Personal | **Personal** | `/Users/alvarez/Library/CloudStorage/GoogleDrive-sanalvcham@gmail.com/My Drive/` | The personal Google account. Business material never goes there. |
| Inbox | **Downloads** | `/Users/alvarez/Downloads/` | Transit only. Nothing lives there. |

Conventions that make the two worlds readable side by side:

- lowercase = repo (`rsf`, `munet-web`, `sentria`); Capitalized = Drive project folder (`RSF`, `Munet`, `Sentria`).
- The repo builds, Drive holds the sent copy. A deliverable's chain (`1-fuentes` … `4-entregado`) stays in the repo; the PDF the client received is in `Projects/<P>/deliverables/`.
- Status is written once, in the repo (`<repo>/.iago/STATE.md`; RSF: `rsf/CONTEXT.md` → `STATE.md`). Each `Projects/<P>/README.md` points back to that repo.
- Drive writes (create, move, rename) go through the Drive connector by id, never through the mount (a stale mount listing created a duplicate folder on 28 Oct).

### Deviations from the proposal, and why

| Proposed | Kept instead | Reason |
|---|---|---|
| `Development/ilsantino/…`, `Development/bas-labs/…` | `~/Developer/` flat (21 repos) | The org is in the map and in `git remote`; an extra level adds a click to every path and nothing to findability. `Developer` keeps the macOS folder icon. |
| `Projects/` and `IAGO/` as Drive-root siblings | `IAGO/Projects/` inside `IAGO/`; both get a Favorite | One share to Sebas and Francisco covers the company; every path written on 27–28 Oct (11 READMEs, 9 open PRs, RSF CONTEXT/STATE/FUENTES, memory) stays valid. From Finder the two Favorites behave exactly as proposed. |
| `Projects/<P>/Context/{PROJECT,DECISIONS,NEXT-STEPS}.md` | `Projects/<P>/README.md` + `<repo>/.iago/STATE.md` | Two status files drift. RSF is the one exception (its repo *is* the documentation workspace: CONTEXT, STATE, DECISIONS, FUENTES). |
| `Received/ Delivered/ Working/ Mockups/` | `received/ deliverables/ research/ media/ brand/ meetings/ admin/` | Already populated this way across 11 projects; mockups are deliverables (`Sentria/deliverables/2026-10-landing-mockup`). |
| `IAGO/Corporate & Fiscal, Brand, Shared Resources` | `IAGO/Company/{brand,fiscal*,legal*,web,templates,methodology,products}` | Same intent, one level deeper so `IAGO/` also holds Content, Reference, Backups. `*` = to be created when the first file arrives. |

## 3. Finder (done)

Favorites now: **Developer · Projects · IAGO · Personal · Downloads · Applications · Desktop**. Removed: `My Drive` (still under Locations → Google Drive),
`Documents` (empty), `rsf`, `RSF`, `munet-web`, `Munet`. Path bar and status bar on; new windows open at `~/Developer`.
Tool: `~/Developer/iago-os/home/finder-sidebar.py` (`list` / `add "Name" /path --first` / `remove "Name"`), works without Full Disk Access.

What each thing in Finder actually is:

| Item | Kind | Verdict |
|---|---|---|
| `~/Developer/rsf` vs `IAGO/Projects/RSF` | two physical folders, different content (workspace repo vs client material) | Both authoritative, by convention (lowercase/Capitalized). |
| `~/santiago@iagoag.com - Google Drive`, `~/sanalvcham@gmail.com - Google Drive` | symlinks made by Drive for desktop → `~/Library/CloudStorage/…` | Keep; they are what Finder shows under Locations. |
| Desktop: Claude, Google Chrome, Google Drive, WhatsApp | macOS alias files to apps | Cosmetic; delete if unwanted. |
| `Drive/.shortcut-targets-by-id/` | where Drive shortcuts resolve | Empty today: no shortcuts exist, so "Shared with me" folders (francisco@'s fiscal folder) are invisible in Finder. |
| `Drive/.Encrypted`, `.tmp/276/RSF` | Drive internals | Ignore. |

Navigation:

```
Finder → Projects → RSF → sessions/11_2026-10-16_…/recibido/Manual de costos.docx
Finder → Projects → RSF → deliverables/2026-09-30-paquete-sesiones/
Finder → Projects → Sentria → clients/Absara/deliverables/2026-09-csv-incidencias/
Finder → Projects → Munet → received/hardware/nextep-ne511/
Finder → IAGO → Company/brand/2026-09-logo-final/png-transparent/   (the only logo source)
Finder → Developer → rsf → CONTEXT.md        (RSF status, decisions, source index)
Finder → Developer → munet-web → .iago/STATE.md   (⌘⇧. shows dot-folders)
```

## 4. The old iaGO backup → where its content lives now

`iaGO-backup/<project>/` = `workspace.bundle` (git history of the old planning repo) + `workspace-files/` (browsable copy, 21 Oct). Compared file by
file (name + size) against `IAGO/` and `~/Developer/`:

| Backup | Files | Found in Drive `IAGO/` | Found in a repo `.iago/` | Only in backup | What the "only in backup" is |
|---|---|---|---|---|---|
| sentria | 1292 | 500 | 143 | 649 | `state/terminal-*` session logs (566, never meant for the repo); older versions of plans |
| rsf | 1404 | 45 | 1058 | 301 | older versions of files now in `~/Developer/rsf` (git has the history) |
| scientia | 1105 | 615 | 55 | 435 | `research/_work` image candidates (386), `_config/runbooks` |
| valorarrend | 1686 | 1402 | 37 | 247 | `research/_reports` screenshots (214) |
| vantek | 554 | 250 | 266 | 38 | generated assets; 10 deck source images (`_src/assets`) |
| iago-web | 488 | 71 | 26 | 391 | frame renders of contact-kit, video library, animations (generated); **6 ProRes 4444 alpha masters of the logo reveal** |
| din | 59 | 37 | 18 | 4 | roadmap.md, videos-produccion.md |
| fulldata | 42 | 22 | 7 | 13 | security audit docs — present in `fulldata-bot-asistente/.iago/research/2026-06-fulldata-seguridad/` (different size, newer) |
| dany, credito | 66, 23 | 15, 18 | — | 51, 5 | raw crawl output of the portal audit; memo companions. Both projects archived whole in `Projects/_archive/` |
| munet | 29 | 0 | 23 | 6 | older STATE/ROADMAP; repo `.iago/` is newer |
| palazuelos | 2 | — | — | 2 | ERP dumps (client data). Stay in Drive, referenced from `Projects/Palazuelos/README.md` |
| recibia | 2 | — | — | 2 | 27 Oct tar of the folder now at `~/Developer/recibia` |
| career-ops | 2 | — | — | 2 | bundles; repo cloned at `~/Developer/career-ops` |

Verdict: the backup is a *snapshot*, not a second home. Everything live was extracted to its destination on 27–28 Oct; what remains only there is
generated output, raw dumps or superseded versions, except the six ProRes masters (item A4). Keep the whole folder as cold storage under `IAGO/Backups/`.

## 5. Drive root reconciliation

| Today at `My Drive/` | Decision |
|---|---|
| `IAGO/` | The business root. Stays. |
| `Google Meet/` (48 Gemini note docs, 3 recordings, 7 dated folders) | File into `Projects/<P>/meetings/` (table in A3); unknowns to `Reference/_triage/meetings/`; then the folder empties and Meet keeps creating new ones there — file them monthly. |
| `iaGO-backup/`, `migration-2026-10/` | Move into `IAGO/Backups/` (A1). Delete later (Phase 5). |
| `ASUNTOS SAN`, `PROYECTOS SAN`, `GABC`, `KASHIO`, `PERSONAL - ENCRYPTED BACKUP` | Personal/career material in the work account (CVs, master's applications, interview prep, book club, the encrypted personal archive). Group under `My Drive/Personal/` (A2). They stay in this account because Google Docs cannot be moved across accounts without re-creating them. |
| `Other computers/My laptop/dev` | Stale Apr–May sync of `~/dev` from the Surface; every item has a newer home (GitHub, vault, Drive). Remove in Drive preferences (A8). |
| `Shared with me` → «Información fiscal» (owner francisco@, Santiago writer): `SAT/`, `Documentos/`, CSF, opinión de cumplimiento | Authoritative fiscal folder is Francisco's. Add a Drive shortcut inside `IAGO/Company/fiscal/` so it shows in Finder (A6). The CSF copies in `Projects/RSF/admin/…` and `Projects/Sentria/admin/…` are *sent* packages and stay where they are. |

## 6. Specific resources

- **iago-web brand.** `origin/main` has no `public/brand/` and no `docs/BRAND.md`; the Señal rebrand is on `feat/rebrand` (32 commits ahead, sub-PRs #104–#121 merged *into that branch*) and is unmerged. PR #122 (signature gif) is open to main. **Approved assets** = Drive `IAGO/Company/brand/2026-09-logo-final/` (wordmark, horizontal, stacked; light/dark; JPG + PNG; `_source/build-logos.py`). **Proposed/rejected** = the lockup SVGs under `feat/rebrand:public/brand/logo/` (lockup-02 rejected 16 Oct). PR #123 (dev context) targets the retired `iago-web-qc` branch and must be retargeted to main on GitHub.
- **RSF.** Repo `~/Developer/rsf` (ws-rsf) is the workspace: `CONTEXT.md` → `STATE.md` → `DECISIONS.md` → `PROCESS-AND-FINDINGS.md`; `FUENTES.md` indexes Drive `Projects/RSF/sessions/` (id unchanged since the move). Memory inside the repo (`_memory/claude/`, 22 files, symlinked into the Claude key). No overlap with Sentria. Pending from its own STATE: copy `deliverables/*/4-entregado/*.pdf` to Drive after the 29 Oct session; Obsidian hub rewrite; delete the `_BORRAR…` duplicate.
- **Sentria.** Repo `.iago/STATE.md` (65 KB, feature table) + `Projects/Sentria/{deliverables,clients/Absara,clients/Vaqueras,research,brand,media,admin}`. The Absara incidents export sitting in Downloads (28 Oct) belongs in `clients/Absara/deliverables/2026-10-csv-incidencias/` (A5).
- **Munet.** `munet-web/.iago/STATE.md` (updated today; sandbox `munet-demo` deployed) + `Projects/Munet/{deliverables,business,received/hardware,research}`. `~/Downloads/munet-mac-bundle-20261028/workspace/` is an older copy of `.iago/` (repo wins; STATE/ROADMAP/runbooks differ) plus printer tools now in `.iago/runbooks/assets/reactivate-demo/` and `Projects/Munet/received/hardware/nextep-ne511/` → delete after A5 check.
- **Personal.** Two personal places exist and cannot be merged: the gmail account (Favorite **Personal**: 228 loose files at its root, `Personal/`, `Personal Docs/`, `Situación Chubb/`, photos) and the career/personal folders in the work account (A2). The Surface's OneDrive `personal/` (677 files) exists only as the encrypted tar; decrypt it into the gmail Drive when the passphrase is in 1Password.
- **Misplaced inside Developer.** Nothing material: `sentria/public/Documentacion-Sentria.pdf` is served by the app; `dinpro-pricing/dist/pricing-model.xlsx` is build output (sent copy in `Projects/DIN/deliverables/2026-05-pricing-model`); `palazuelos-erp-discovery/research/*transcript.txt` is a documentation repo by design. Eight `.iago/README-workspace.md` files still said `My Drive/iaGO/` → corrected to `IAGO/` today (uncommitted, on the `iago-context-2026-10` branches). Six STATE/PROJECT files still cite `C:\development` paths in history sections; harmless.

## 7. Memory and continuity

| Project | Human + Claude entry point | Memory | Gap |
|---|---|---|---|
| RSF | `~/Developer/rsf/CONTEXT.md` | `rsf/_memory/claude/` (in git) | Obsidian `clients/rsf` hub stale (frozen folder; rewrite pending) |
| Munet | `munet-web/.iago/STATE.md` | `~/.claude/projects/-Users-alvarez-Developer-munet-web/memory` (2 files) | a second planning system in `munet-web/docs/` (noted in STATE) |
| Sentria | `sentria/.iago/STATE.md` | …`-sentria/memory` (16 files) | none |
| Vantek, Valorarrend, Scientia, DIN, Fulldata, Palazuelos, Recibia, iago-web | `<repo>/.iago/STATE.md` | per-repo keys, populated | none |
| Cross-project | `~/Developer/CLAUDE.md`, `~/.claude/CLAUDE.md` | `~/.claude/projects/-Users-alvarez-Developer/memory` | **fixed today**: the 27–28 Oct migration memory was keyed to a scratch session (deleted with it); merged into the Developer key with [[filesystem-architecture-2026-10]] |
| Study/personal (formación, payment-network) | — | `~/migration-2026-10/parked-memory/` | parked; restore when those folders exist on the Mac |

Obsidian vault: `clients/` and `meetings/` frozen since 27 Oct; `sessions/` digests continue via the Stop hook. MemPalace and Graphify not installed (data present).

## 8. Done this session

1. Finder Favorites rebuilt to the five-entry set; path bar on; new windows open at Developer. Script kept in `iago-os/home/finder-sidebar.py`.
2. `~/Developer/CLAUDE.md` and the global `CLAUDE.md` (both copies) gained the Finder and Personal lines.
3. Eight `.iago/README-workspace.md` files: `My Drive/iaGO/` → `My Drive/IAGO/`.
4. Memory: migration memory merged into the Developer key (newer state wins), profile updated with accounts, new `filesystem-architecture-2026-10` memory, index updated.
5. Drive `IAGO/README.md` created (navigation one-pager; also for Sebas and Francisco).
6. This report.

## 9. Approval list — A1–A5 executed 2026-10-28 (evening), A6–A11 remain Santiago's

**Executed through the Drive connector by id (moves keep ids and links; nothing deleted in Drive):**

- **A1 done** — `iaGO-backup/` and `migration-2026-10/` now live in `IAGO/Backups/` (ids unchanged).
- **A2 done** — `My Drive/Personal/` created (`10OmbM3Bki1WVDPK4R56qrCF88YaXnvC1`); ASUNTOS SAN, PROYECTOS SAN, GABC, KASHIO and «PERSONAL - ENCRYPTED BACKUP» moved into it.
- **A3 done** — 48 Gemini notes, 3 recordings and 7 dated Meet folders filed per the table below. Created with content: `Sentria/meetings` (`1Rw2NQooAg0trP8h62ws4If1ttadV2hm7`), `RSF/meetings` (`1Qz81w4q74qrISjAlZkz1-s5xzYoINsW1`), `Fulldata/meetings` (`1hwjd_XmE9oufC5bxnpXnSk-hwvfSMRai`), `Valorarrend/meetings` (`1WZ7YGUoiYr8ggZxnfCbNYBd7aDMS5TDj`), `Company/meetings` (`1mSm-VVrqSjLiKWsCQXfomUQhDhOjVNjX`), `Reference/_triage/meetings` (`12Bp5lsvp2BT40ZPAkxUew8yjoIWcJUqz`). `Google Meet/MEET RECORDINGS/` is now empty and stays (Meet writes new notes there; file them monthly).
- **A4 done** — six ProRes 4444 masters copied next to their renders in `Company/brand/2026-09-logo-reveal/{horizontal,stacked,wordmark}/`; the 10 missing deck images (`zona-*`, `escenario-*`, `suite`, `detalle`) copied into `Projects/Vantek/deliverables/2026-10-vantek-presentacion/_src/assets/`.
- **A5 done** — Absara incidents export is in `Sentria/clients/Absara/deliverables/2026-10-csv-incidencias/` (`1Uh7WvQb3ltynkZoymLG9ovkqu-HJqOQx`; the Downloads copy removed). `munet-mac-bundle-20261028/` moved to the Trash after checking: `printer-driver-zip` identical to `Projects/Munet/received/hardware/nextep-ne511`, `printer-demo` identical to `munet-web/.iago/research/2026-07-08-printer-demo-prototype`, `workspace/` older than the repo `.iago/` (only unique file: `make-transfer-bundle.ps1`, the Surface-side packer). `il-santino_accessKeys.csv` is still in Downloads: 1Password, then shred (Santiago).

**Evening pass 2 (2026-10-28):** A7 done for what Claude may do (iago-web #123 retargeted to `main`, munet-web #201 closed; merges stay Santiago's). A9 placed: the CV and the book-club recap moved to `My Drive/Personal/` with real titles, the AI-logo-prompt sheet trashed; «Control Assets - Entorno Lab» (gsheet + xlsx) and the 29-May screen recording stay in `_triage` (project unknown). RSF: five of the seven Gemini duplicates in `RSF/meetings/` trashed (the indexed `sessions/NN/` copies stay); the two «Dudas Rentabilidad FG» copies were refused by the permission classifier and remain. A10 (share `IAGO/` with sebastian@iagoag.com and francisco@iagoag.com) refused by the classifier: Santiago shares, or allows `share_file`. A6 needs Drive web (Chrome extension not connected). Colour scheme applied: Drive folder colours by kind + Finder tags on the repos (see `~/Developer/CLAUDE.md`, Finder section).

**Original list, kept for the record:**

Executable by Claude through the Drive connector on a "yes" (moves keep ids and links):

- **A1** Move `iaGO-backup/` (`1BSkj3cv8atBFkRKIVSqnHlRoMcASo3s7`) and `migration-2026-10/` (`1Q317SdJPJHallyPtdF3BmZw6GEi2lU6M`) into `IAGO/Backups/`.
- **A2** Create `My Drive/Personal/` (work account) and move into it: `ASUNTOS SAN` (`1gnW63dyTOePP7XPHbgQCOIXSFNb36v5x`), `PROYECTOS SAN` (`1kwBvkPP1K0yjyxtefzipLA5s88_pWTHq`), `GABC` (`19iWXf5jehIFvVcx3ImvXpyMZ3djkj3R9`), `KASHIO` (`1nEgVZmIHlJ_K1RVAfrvJBbOIZxUvly6B`), `PERSONAL - ENCRYPTED BACKUP` (`1OSI_tB_E4jrlI26phvk5T6lgeAe7UNqz`).
- **A3** File `Google Meet/` into `Projects/<P>/meetings/` (folders created only where a file goes):

  | Destination | Items |
  |---|---|
  | `Sentria/meetings/` | Actualización SENTRIA 03-09 · DEMO SENTRIA 06-07 · DEMO SENTRIA 11-08 (EN, ES) · Presentación SENTRIA telegram 22-04 (EN, ES) · Roadmap SENTRIA-ABSARA 29-01 · SENTRIA Avances 05-05 · SENTRIA DEMO ABSARA 20-11-2025 · Sesión pre-demo 19-03 · Fulldata & Sentria 29-05 (EN, ES) · folders «ABSARA - SENTRIA 25-09», «Catch up SENTRIA 23-10», «VAQUERAS - DEMO SENTRIA 01-10» |
  | `RSF/meetings/` | Dudas Rentabilidad FG 01-09 (EN, ES) · Jorge, Atania, Juan Manuel 24-08 and 25-08 · Proceso precio retorno 02-09 · RSF \| IAGO AG 30-06 · Vero 26-08 and 27-08 (likely duplicates of the notes already inside `sessions/NN/`; Santiago decides which copy stays) |
  | `Fulldata/meetings/` | FULLDATA-PEDRI 11-05 (EN, ES) · FullData Actualización 25-05 · FullData \| DUPACK 27-05 · fulldata - victor 21-05 · Razones Sociales & Estrategias 22-05 (EN, ES) · folder «FullData - TSM 23-09» |
  | `DIN/meetings/` | DIN DEMO 2 notes + recording (245 MB) 29-01 · DIN DEMO 3 recording (359 MB) |
  | `Palazuelos/meetings/` | CASA + LIS 12-06 · LIS \| Palazuelos 29-05 · SATO \| PALAZUELOS 28-05 (EN, ES) |
  | `Valorarrend/meetings/` | LP VALORARREND 10-09 · folders «ValorArrend - IAGO 23-09», «Valorarrend - iaGO: SEO 20-10» |
  | `_archive/Installflow/` | Demo INSTALLFLOW 13-01 |
  | `_archive/Cerveceria-Allende/` | Hallazgos Allende 21-01 · Siguientes pasos Allende 24-02 |
  | `_archive/Privia/` | IAGO & DRB 15-10-2025 |
  | `Company/meetings/` (new) | IAGO & TENET 14-10-2025 · Intro IAGO 18-09-2025 · juntish en cortish 21-10-2025 |
  | `Reference/_triage/meetings/` | «La reunión se inició…» ×5 (2025-10-23, 2025-12-24, 2026-01-10, 2026-01-14, 2026-01-21) · «Meeting started» 2026-05-29 and 2026-08-24 (EN, ES) · «Meeting with Santiago Alvarez» 19-03 (EN, ES) · recording `cdq-pfem-ekr` 2026-01-21 (583 MB) · folder «fdj-gfaf-kug 23-09» |

- **A4** Copy the six ProRes 4444 alpha masters (`iaGO-backup/iago-web/workspace-files/deliverables/2026-09-logo-reveal/{horizontal,stacked,wordmark}/*-prores4444.mov`) into `IAGO/Company/brand/2026-09-logo-reveal/` next to their mp4/webm renders; and the 10 deck source images from `iaGO-backup/vantek/…/2026-10-vantek-presentacion/_src/assets/` into `Projects/Vantek/deliverables/2026-10-vantek-presentacion/_src/` if missing.
- **A5** Downloads: `Incidencias Absara 2026-09-28 a 2026-10-28.xlsx` → `Projects/Sentria/clients/Absara/deliverables/2026-10-csv-incidencias/`; `munet-mac-bundle-20261028/` → delete (repo `.iago/` is newer); `il-santino_accessKeys.csv` → 1Password, then shred (Santiago).

Santiago only (no API for it):

- **A6** Drive web → Shared with me → «Información fiscal» → Organize → Add shortcut → `IAGO/Company/` (create `fiscal/` there first, or drop the shortcut directly in `Company/`).
- **A7** GitHub: retarget iago-web #123 to `main`; close munet-web #201; review and merge the nine `iago-context-2026-10` PRs; merge iago-web #122; decide `feat/rebrand` with Sebas.
- **A8** Phase 5, after A1 and the secrets decrypt: remove `Other computers/My laptop` in Drive preferences; delete local `~/migration-2026-10/` (15 GB); empty Drive trash when the 30 days pass.
- **A9** Place or trash the six items in `Reference/_triage/` and `Content/iago-live/Untitled document`.
- **A10** Share `IAGO/` with sebastian@ and francisco@.
- **A11** `git add` + commit the eight README fixes on each `iago-context-2026-10` branch (or let the PR review absorb them).

## 10. Gaps and open points

- The gmail Drive root holds 228 loose files (DIN-era docs, Chubb claim, personal letters). Out of scope here; worth one pass into `Personal Docs/` and a `DIN (2024-25)/` folder when there is time.
- RSF Gemini notes may exist twice (Meet folder and `sessions/NN/`); A3 moves them next to each other so the duplicate is obvious.
- `Projects/Sentria`, `RSF`, `Munet` READMEs promise a `meetings/` folder that does not exist yet; A3 creates it with content.
- Nothing in this architecture covers e-mail attachments: the rule stays "received by mail → `Projects/<P>/received/`", applied by hand.
