# File & folder naming standard — Santiago's machine

**Status:** draft v1, 2026-08-16. Scope: `C:\Users\sanal` and everything under it.
**Purpose:** one grammar, machine-enforceable, so the filesystem stays ordered without anyone maintaining it by hand.

---

## 1. Evidence this is designed against

Measured 2026-08-16, not estimated:

| Zone | Dirs | Files | Note |
|---|---|---|---|
| `OneDrive\iagoagency` | — | **129,043** | the mass; everything else is rounding |
| `OneDrive\Documents` | — | 22,142 | `Documents` is redirected here; the local folder is empty |
| `OneDrive\Pictures` | — | 1,069 | |
| `Downloads` | 8 | 387 loose | 102 pdf · 58 png · 32 pptx · 27 docx · 26 md · 24 xlsx · 21 mp4 · 15 exe |
| `OneDrive\Santiago DoDas` | — | 128 | |
| `OneDrive\CFA` / `UDEMY` / `DIN` / `Biblia` / `Make.com` | — | 53 / 25 / 5 / 4 / 11 | |
| `OneDrive - Rennes School of Business` | 4 | 12 | school tenant, separate account |
| `dev` | 9 | — | code; **rename-frozen** |
| `C:\Users\sanal` top level | 52 | 38 loose | mostly application droppings |

**Consequence:** 151k+ files means no hand-sorting. Any rule that a script cannot check is a rule that will rot.

---

## 2. Zones — different rules, deliberately

The mistake to avoid is one convention over the whole disk. Four zones, four rulesets:

| Zone | Path | Rule |
|---|---|---|
| **CODE** | `dev\` | **Frozen.** Git + existing repo conventions. No renaming, ever — see §6. |
| **WORK** | `OneDrive\iagoagency` | Full standard. Client-first taxonomy. The main event. |
| **PERSONAL** | `OneDrive\{Santiago DoDas, CFA, UDEMY, Biblia, Pictures}` | Full standard, lighter taxonomy. |
| **TRANSIENT** | `Downloads`, `Desktop`, `C:\Users\sanal` loose files | Staging only. Nothing lives here. Retention rule, not a taxonomy. |

`OneDrive - Rennes School of Business` is a separate tenant — leave it alone.

---

## 3. The grammar

```
{YYYYMMDD}-{entity}-{descriptor}[-v{N}].{ext}
```

**DECIDED 2026-08-16 (Santiago):** compact `YYYYMMDD` date, lowercase kebab-case, hyphen-only separators. No spaces, no underscores, no accents, no `&`.

The compact date costs nothing here: the ISO-dashed form is used by the vault and `.iago/`, but both live under `dev\`, which is rename-frozen and out of scope. There is no zone where the two formats meet.

| Field | Rule |
|---|---|
| `YYYYMMDD` | The date the document **is of**, not when it was saved. Always the first 8 chars, so it is positionally parseable and sorts chronologically. Omit entirely when the document has no meaningful date (contracts, reference material) and lead with `entity`. |
| `entity` | One token from the controlled vocabulary in §4. Never invented ad hoc. |
| `descriptor` | 2–5 words, kebab. Says what the thing *is*, not what it is *about*: `propuesta-comercial`, not `cosas-del-cliente`. |
| `v{N}` | Only when versions genuinely coexist. Integer, no `v1.2`, no `-final`, no `-FINAL-real`. If there is one live version, there is no suffix. |

**Examples**

```
2026-08-16-rsf-propuesta-comercial-v2.pdf
2026-08-12-munet-caja-hardware-test.xlsx
2026-07-30-din-transcripcion-junta.md
rsf-contrato-marco.pdf                      ← undated: reference document
sentria-manual-operador-v3.pdf
```

**Anti-patterns, all currently present on disk**

```
WhatsApp Video 2026-07-30 at 10.26.08 AM.mp4    → 2026-07-30-din-video-junta-01.mp4
Documento sin título (3).docx                   → dated + named, or deleted
propuesta final FINAL v2 (copia).pdf            → one file, one version number
```

### Folders

Folders carry **taxonomy**, never dates and never versions. Same casing rule. Depth ≤ 4 below a zone root — path length is a live constraint at 129k files (§6).

**Never by file extension.** The extension is already the last four characters of the name, so a `docs/ sheets/ slides/ images/` split restates what the name says and hides what it does not — and it scatters one deliverable across four folders. Group by *what a file is to the work*: `01-contratos`, `02-propuestas`, `03-entregables`, `04-insumos`. A pricing spreadsheet and a pricing deck are both proposals.

**Subdivide only past ~20 files** (`SUBDIVIDE_AT` in `route.py`). Below that, subfolders cost more than they explain. And only *client* folders take the deliverable shape — `personal/` is organised by life area, and bucketing it the same way produced `personal/03-entregables`, a folder describing nothing anyone owns.

**Dissolving a folder can destroy information.** Fourteen Absara mockups were each named `20251030-absara-code.html` and told apart *only* by their folders (`login_page`, `system_settings`, …). Flattening them collapsed all fourteen onto one name; suffixing `-2 … -14` restored uniqueness but not meaning. Before dissolving, fold the folder name into the descriptor — `route.py disambiguate()` does this at plan stage for every member of a colliding group, not just the losers.

```
iagoagency/
  clients/
    rsf/
      01-comercial/        ← numeric prefixes only to force sort order
      02-entregables/
      03-operacion/
    munet/
    sentria/
  interno/
    finanzas/
    legal/
    marketing/
  archivo/{YYYY}/          ← the one place a year appears in a folder name
```

---

## 4. Entity vocabulary (controlled — extend deliberately, never ad hoc)

**Clients / orgs:** `rsf` · `munet` · `sentria` · `din` · `fulldata` · `palazuelos` · `allende` · `absara` · `o11e` · `privia`
**Own:** `iago` (the agency itself) · `iago-os` (the product) · `installflow`
**Personal:** `personal` · `familia` · `cfa` · `uc3m` · `rennes`
**Sentinel:** `misc` — an honest "no owner in the filename", not a failure. It sorts, it lints, and it is upgradable.

Adding an entity means adding it here first, and in `ENTITIES` in `organize.py` — the linter refuses a hint outside the vocabulary, because an ad-hoc entity is how a controlled vocabulary dies.

**Extending §4 reaches backwards.** `organize.py scan --upgrade-sentinel` re-derives files already named `…-misc-…` and proposes the real owner where the new vocabulary now explains it. A file named under the sentinel is not finished — it is waiting. Added 2026-08-17 with `allende` and `installflow`, which upgraded 18 files in one pass.

Two entities were added on 2026-08-17: **`allende`** (Cervecería Allende — proposals, pricing, churn analysis, contract) and **`installflow`** (the OneEleven contract and improvement structure).

**An entity tag is a claim, not proof.** Three PDFs tagged `palazuelos` turned out to be Santiago's own Banco Santander portfolio instructions; they carried the tag only because of the folder they sat in when P2 derived it. Where reading a file contradicts its tag, correct it in `OVERRIDE` in `route.py` — one readable place that records *why*, rather than a silent rename.

---

## 5. Retention rule for TRANSIENT

`Downloads` is a staging area with a clock, not a folder:

1. Anything worth keeping gets renamed to the standard and **moved to its zone within 7 days**.
2. Installers (`.exe`, `.msi`) and archives that were already extracted: delete at 30 days.
3. Everything untouched at 90 days moves to `archivo/{year}/downloads-sweep/` — never deleted silently.

This is a scheduled script (§7), not a habit. Habits do not survive 387 loose files.

---

## 6. Hard constraints — the things that break if ignored

1. **`dev\` is rename-frozen.** Claude Code derives its project directories from the literal path (`C--Users-sanal-dev-iago-os`). Renaming a repo folder orphans every session transcript, the per-project memory directory, all git worktrees, and absolute paths written into `~/.claude/settings.json` (the Stop hooks now point at `dev\iago-os\scripts\hooks\`). Nothing under `dev\` gets renamed as part of this project.
2. **Bulk renaming inside OneDrive is not free.** A rename re-uploads the file and can drop its version history. 129k files cannot be swept in one pass — see the phasing in §7.
3. **Path length.** Windows caps at 260 chars by default and `iagoagency` already runs deep. This is why the standard is lowercase (shorter than ALL CAPS in practice once compounds appear) and caps folder depth at 4.
4. **Never rename inside a git working tree**, including `.iago/` and any client repo — git tracks paths.
5. **SAT-relevant records** (invoices, receipts, `iagoag` email attachments) are legally retained. They get renamed, never deleted, never "swept".
6. **Machine-managed paths are out of scope, like `dev\`.** Some names are an interface, not a description — something resolves them by literal string and no rename updates the reference. Found on disk 2026-08-17, all inside the zones:

   | Path | Resolved by | Breaks if renamed |
   |---|---|---|
   | `OneDrive\Documents\WindowsPowerShell\Modules` | first entry in `$env:PSModulePath` | `Import-Module` — holds a live 219 MB `SqlServer` install |
   | `desktop.ini` | Windows Explorer | folder icon, localised display name |
   | `*.dll` `*.sys` `*.ocx` `*.pdb` `*.manifest` `*.config` | import tables, manifests | the application that loads them |
   | `OneNote Notebooks`, `Custom Office Templates` | OneNote / Office | the app's own store |
   | dotfiles (`.RData`, `.Rhistory`) | their tool, by convention | that tool's state |

7. **Secrets move by hand, never by tool.** `route.py` refuses to relocate anything matching `CREDENTIAL` so that moving a secret is always a decision somebody made on purpose. The pattern covers the non-obvious cases too: `recovery-code`, `backup-code`, `seed-phrase`, `mnemonic` — a GitHub 2FA recovery set was found in `Downloads` as a plain `.txt`, and nothing in its name said "secret". Word-bound the short tokens: unbounded `2fa` matches hex inside a GUID.

8. **`(OI)(CI)` on a file yields an empty DACL.** `icacls <dir> /inheritance:r /grant:r "user:(OI)(CI)F" /T` reports success and silently locks the owner out of every *file* it touched — the flags are inheritance directives, and a file has nothing to inherit to. It cost read access to both FIEL bundles on 2026-08-18. Set permissions per item: `(OI)(CI)F` on directories, plain `F` on files. Verify, never assume:

   ```powershell
   Get-ChildItem ~\.secure -Recurse -Force |
     Where-Object { (Get-Acl $_.FullName).Access.Count -eq 0 }
   ```

   `organize.py` enforces this in code: protected names and extensions, application-managed folders in `SKIP_DIRS`, and `looks_like_app_payload()` — a **majority** test that prunes an unpacked-application subtree whole while leaving a download folder that merely contains some installers alone.

---

## 7. Enforcement — 60 / 30 / 10

The standard is worthless as prose. It ships as three layers:

| Layer | What | Form |
|---|---|---|
| **60 deterministic** | `lint-names` — walk a zone, report every path violating §3, exit non-zero. Then `apply-names --dry-run` proposing renames, `--commit` executing them with a reversible journal. | script |
| **30 rule-based** | Scheduled Downloads sweep implementing §5. | scheduled task |
| **10 AI** | Classifying the genuinely ambiguous tail — files whose entity or descriptor cannot be derived from name, path, or content. | on demand, in batches |

**Phasing** — deliberately not "rename everything":

1. Fix the **top two levels** of each zone (folders only, ~dozens of renames, high value, near-zero risk).
2. Turn on `lint-names` and the Downloads sweep so **new** files are born correct.
3. Migrate the tail by client, one at a time, `--dry-run` reviewed before `--commit`, with the rename journal kept for rollback.

Order of attack follows mass, not alphabet: `Downloads` (worst ratio of chaos to volume) → `iagoagency` top levels → `Documents` → the long tail.

---

## 8. Open decisions

- **Casing.** This standard says lowercase-kebab. Santiago's original sketch proposed ALL CAPS. Lowercase wins on path length, scan-ability in long lists, and consistency with `dev\` and the vault — but the call is his, and flipping it is a find/replace here plus a constant in the linter, not a redesign.
- **`Santiago DoDas`** (128 files) — the folder name itself violates the standard. Rename to `santiago-dodas`, or is it referenced by an external sync/share that would break?
- **`iagoagency` vs `iago`** as the zone root name — currently inconsistent with the entity vocabulary.
