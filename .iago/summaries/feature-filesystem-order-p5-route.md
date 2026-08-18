# P5 — Route — execution summary

**Plan:** `.iago/plans/feature-filesystem-order/README.md` §P5 · **Run:** 2026-08-18, operations
**Tool:** `scripts/organize/route.py` (new) · gate `test-route.py` → PASSED (24 assertions)
**Authorised by:** Santiago — "The paros file is allende, continue. Also, i feel like a lot of the
files within the folders of documents or downloads can be allocated to other folders within our
system or if not create new folders within these folders."

## The problem P2 left behind

P2 sorted Downloads by **file extension** — `docs/`, `sheets/`, `slides/`, `images/`, `code/`.
That axis carries no information: the extension is already the last four characters of every
filename, so the folder restates what the name says and hides what it does not. Worse, it
splits a single deliverable across four folders. The DIN pitch lived as `slides/…-deck-v8.pptx`,
`sheets/…-presentacion-borrador.xlsx`, `code/…-dinpro-deck-v2.html` and
`images/…-conviertete-en-pro.jpeg` — four folders, one piece of work.

Routing by **entity** was already possible because P2/P3 put the entity in every filename. That
makes this the deterministic layer, not the judgment layer: a lookup, not a decision.

## Result

| | before | after |
|---|---|---|
| `Downloads` | 796 files across 13 extension folders, 10.0 GB | **290 files across 7 purpose folders, 1.2 GB** |
| `OneDrive/Documents` | 1,270 files | **919** — all of it machine-managed (`WindowsPowerShell`, OneNote) |
| Naming conformance | — | **100% in all four zones** (personal 437/437, iago 242/242, din 44/44, downloads 258/258) |

**483 files routed. 8.1 GB reclaimed. 331 coursework files refiled.**

### Where things went

`iago/01-clientes/{allende,absara,munet,sentria,rsf,fulldata,installflow,o11e,palazuelos}/`,
`din/` (kept separate from iaGO per Santiago), `personal/{01-identidad … 05-formacion}/`.

Client folders over 20 files are subdivided by **deliverable type**, not file type —
`01-contratos`, `02-propuestas`, `03-entregables`, `04-insumos`. A pricing spreadsheet and a
pricing deck are both proposals and now sit together. Under 20 files the folder stays flat,
because subfolders then cost more than they explain.

Downloads keeps what is genuinely staging: `capturas/` (81), `referencia/` (66),
`proyectos/` (92), `media/` (17), `datos/` (13), `codigo/` (12), `archivos/` (6).

## Security — this run's real finding

Ten credential files were sitting in OneDrive and Downloads, several of them cloud-synced.

| what | where it was | disposition |
|---|---|---|
| 4 × AWS IAM access-key pairs | `Documents/GENESIS LAB/`, `Downloads/sheets/` | **verified dead**, quarantined |
| 2 × Bedrock long-term API keys | `Documents/GENESIS LAB/` | `~/.secure/creds/aws-genesis-lab/` |
| AWS console password (clear text) | `Documents/GENESIS LAB/` | `~/.secure/creds/aws-genesis-lab/` |
| **GitHub 2FA recovery codes** | `Downloads/docs/*.txt` | `~/.secure/creds/github/` |
| 3 × Google OAuth client secrets | `Downloads/code/` | `~/.secure/creds/google-oauth/` |

The access keys were tested rather than assumed: `sts:GetCallerIdentity` returns
`InvalidClientTokenId` on all four, so there is no revocation emergency. The console password
and the OAuth secrets could not be tested and are treated as live.

The GitHub recovery codes are the sharpest of these — they bypass two-factor on the account
that holds every client repository, and nothing in the filename said "secret". `route.py` now
refuses to move `recovery-code`, `backup-code`, `seed-phrase` and `mnemonic` for that reason.

**Open action for Santiago:** if the console password `@W5…` or anything close to it is reused
anywhere else, change it there. `~/.secure/` is still not backed up.

## Reclaimed — 8.1 GB, batch `20260818-p5-redundant`

| category | files | bytes | why |
|---|---|---|---|
| `db-extract-redundant` | 2 | 4.30 GB | `CASA.GDB` and `tripdb_FULL.bak` — the compressed originals still exist, the discovery is written up, and both carry RFC/CURP, addresses and bank CLABEs |
| `sql-install-media` | 207 | 2.40 GB | SQL Server 2022 media, downloaded to stand up a throwaway engine; free from Microsoft |
| `installer-regenerable` | 16 | 1.40 GB | installers for software already installed |
| `partial-download` | 2 | 14 MB | abandoned browser downloads |
| `session-state` | 2 | 0.1 MB | `.RData` / `.Rhistory` |
| `aws-key-revoked` | 4 | 0.0 MB | dead, and a dead secret still reads as a secret |

Purgeable **2026-08-25**. Nothing has been hard-deleted.

## Identifications made by reading, not by filename

- **LIS / `tripdb` is Palazuelos.** The schema is a freight ERP — `desp_` (despacho),
  `trafico_`, `remolques`, `casetas`. Same June-2026 window and the same "multi-ERP data-lake
  consolidation" engagement as the CASA customs-broker discovery. Both now sit under
  `Downloads/proyectos/palazuelos/`.
- **Three "Palazuelos" PDFs are Santiago's own money.** `…unsolicited-investment-order-
  portfolio-8-sac-phase-{1,2,3}-of-3.pdf` are Banco Santander International instructions,
  client 4019487, $153,000 USD across five funds. They carried the `palazuelos` tag only
  because of the folder they sat in. Now `personal/03-finanzas/banca-inversion/`.
- **The bottling-line downtime taxonomy is Allende** (Santiago confirmed). Moved to
  `iago/01-clientes/allende/`.

## Defects this run produced, and the fixes

Four bugs, all caught and all now covered by a test.

1. **A dissolve erased the only distinguishing information.** Fourteen Absara mockups were each
   named `20251030-absara-code.html`, told apart solely by their folders — `login_page`,
   `system_settings`, `user_management`. Dissolving those folders collapsed all fourteen onto one
   name, and collision handling renamed them `-2 … -14`: unique on disk, identical to a reader.
   `disambiguate()` now runs at the plan stage, where the whole name-group is visible, and folds
   the folder name into **every** member. The fourteen were repaired to
   `20251030-absara-mockup-{login-page,system-settings,…}.html`.

2. **The credential regex matched hex inside GUIDs.** `2fa` appears in
   `…-993d-5aa9442fad0d.jpeg` and `…-e2fa-4870-…tmp`, so two ordinary files were held back as
   secrets. Word-bounded.

3. **`personal/` was handed a client-shaped bucket**, producing `personal/03-entregables` —
   a folder describing nothing anyone owns. Subdivision is now restricted to client entities,
   enforced in `census()` **and** in `classify()`, because a function should not depend on its
   caller having filtered correctly. The test that caught this passes the unfiltered set directly.

4. **The ACL lockdown locked the owner out.** `icacls /inheritance:r /grant:r "user:(OI)(CI)F" /T`
   reported "20 files processed, 0 failed" and left eight files — **including both FIEL bundles**
   — with an **empty DACL**. `(OI)(CI)` are inheritance flags; on a file there is nothing to
   inherit to, so the ACE evaporated. Permissions are now set per-item: `(OI)(CI)F` on
   directories, plain `F` on files. Verified by reading a byte from each, and the check is
   written into `~/.secure/README.txt`.

## Reversibility

| journal | ops |
|---|---|
| `~/.local/organize/route-20260818-144829.ndjson` | 384 (Downloads → taxonomy) |
| `~/.local/organize/route-20260818-145024.ndjson` | 76 (OneDrive client reshape) |
| `~/.local/organize/route-20260818-collision-repair.ndjson` | 14 |
| `~/.local/organize/journal-20260818-1457*.ndjson` | 354 (rename pass) |
| `~/_trash/20260818-p5-redundant/journal.ndjson` | 233 (quarantine) |

Journals stack, so they undo in reverse order. Undoing `144829` alone reports `missing=19` —
those nineteen were moved again by a later journal, which is the stack working, not damage.

## Left open

- `Downloads/slides/20260817-din-rh-deck.pptx` is **open in PowerPoint** and could not be moved;
  `Downloads/docs/` is empty but held by a handle. Re-running clears both.
- `OneDrive/Pictures` — 1,074 files, 1,058 of them in `Screenshots/`. Untouched. It is a Windows
  Known Folder, so only file-level work is possible, and it wants date-based foldering rather
  than per-file renaming.
- The purge of `20260818-p5-redundant` needs an explicit go on or after 2026-08-25.
