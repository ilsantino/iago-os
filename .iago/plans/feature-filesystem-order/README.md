# Filesystem order — roadmap

**Goal:** one naming grammar and one taxonomy across Santiago's machine, enforced by script rather than discipline, then the same logic applied to the Drive workspace.

**Standard:** `.iago/_config/runbooks/file-naming-standard.md` — `{YYYYMMDD}-{entity}-{descriptor}[-v{N}].{ext}`, lowercase kebab. Locked 2026-08-16.

**Scale (measured, P0):** **5,354 real files / 12.6 GB** — plus 148,798 build-artifact files (3.01 GB) sitting inside OneDrive that should not be there at all. The "151k files" in the first draft of this roadmap were `node_modules`.

---

## Sequencing principle

Order by **reversibility first, mass second**. Every phase proves the tooling on cheaper ground before it touches anything expensive. The 129k-file zone is phase 4, not phase 1, and it is not scoped until phase 0 has actually looked inside it.

The failure mode being designed against: a confident bulk rename across a cloud-synced tree, based on a taxonomy invented from top-level folder names, with no way back.

---

## Phases

### P0 — Inventory *(read-only, zero risk)*

Walk every zone and produce a real map: file count and total bytes by zone × type × age bucket, how many filenames already parse under the grammar, how many carry an inferable entity, how deep the trees go, how close paths run to the 260-char ceiling, and how many OneDrive files are cloud-only placeholders rather than local.

**Why first:** P3 and P4 cannot be scoped without it. Every number in this roadmap beyond top-level counts is currently unknown.
**Acceptance:** a committed inventory report; every subsequent phase's volume is quoted from it, not estimated.

### P1 — Tooling with rails *(no production moves)*

`scan` → plan JSON · `apply` → executes a plan, writing an NDJSON journal of every `old → new` · `undo` → reverses a journal. Dry-run is the default and `--apply` is explicit.

Rules enforced in code: never descend into `dev\`, `.git`, `node_modules`, `AppData`; never rename inside a git working tree; collision-safe suffixes; skip cloud-only placeholders rather than hydrating them; refuse any move that would exceed the path ceiling.

**Acceptance:** tests pass against a synthetic tree covering collisions, unicode names, already-conforming names, and a full `apply` → `undo` round trip that returns the tree byte-identical.

**DONE 2026-08-17** — `scripts/organize/organize.py` + `scripts/organize/test-organize.py` (62 assertions, all green), plan `01-tooling.md`. The round trip returns files *and* the directory set byte-identical, bucket dirs included.

### P2 — Downloads *(726 renameable files, fully reversible, nothing depends on it)*

Rename in place and bucket by type. **No cross-zone moves yet** — promoting keepers into OneDrive is P3's job, once the taxonomy exists to promote them into.

**Why here:** worst chaos-to-volume ratio on the disk, and the only zone where being wrong costs nothing. This is where the tooling earns trust on real data.

**Scoped by a real P1 scan, 2026-08-17** — 1,648 files, of which:

| | count | disposition |
|---|---|---|
| inside a git working tree | **911** | skipped by the tool; a separate decision (below) |
| already conforming | 11 | untouched |
| **renameable** | **726** | high 6 · medium 99 · **low 621** |

The 621 low-confidence proposals are almost all `no-entity` — the file simply does not say who it belongs to. `misc` is the honest label; the review is about promoting the ones that deserve a real entity, not about fixing errors.

**New finding — two code projects are living in Downloads**: `cortextos_probe` (863 files) and `tweetGPT` (48). Same disease P3b just cured in OneDrive. The tool correctly refuses to touch them; the call of move-to-`dev\` vs archive-and-drop is Santiago's, and it is what the 911 number is.

**Acceptance:** every file either conforms or is listed as ambiguous; journal replays clean; Santiago reviews the low-confidence list.

**DONE 2026-08-17** — `.iago/summaries/feature-filesystem-order-p2-downloads.md`. 388 renamed and bucketed across 3 journals; root went 387 loose files → 2 (both machine-managed); file count delta 0. 57 entity judgments: 46 promoted out of `misc`, 11 corrected where `extract_entity` took the first vocabulary token rather than the most specific one (`personal` beating `sentria` on a Spanish staff roster; `iago` beating `rsf`/`munet` on client deliverables).

**143 files deliberately not renamed.** `--bucket` flattens, and four work/source trees (`lis-discovery`, `CrewAI-Studio-main`, `_assets_build`, `CASA_discovery`) reference their own subdirectories — `out/schema.json`, `fb25`, `vba_modules/`, sibling `.ps1`. Same class as the Part B checkouts. `85b465d` fixed this for unpacked app payloads mid-run; these four are the residue.

~~**Blocked on a vocabulary call:** `allende` (17 files) and `installflow` (4) have a clear owner outside §4.~~ **RESOLVED 2026-08-17** — both added to §4 and to `ENTITIES`. `allende` is Cervecería Allende (proposals, pricing, churn analysis, contract); `installflow` is the OneEleven contract. This surfaced a gap: a file already named `…-misc-…` *conforms*, so a plain re-scan would never revisit it — extending the vocabulary could not reach the files it explained. `scan --upgrade-sentinel` re-derives sentinel-named files; **18 upgraded, 0 residual, undo verified reversible.** It also surfaced a defect: without filtering the sentinel out of the descriptor, the upgrade produced `20251229-allende-misc-prompts-cerveceria` — the placeholder demoted into the description rather than replaced.

**Part B — RESOLVED 2026-08-18: all three code trees deleted**, on Santiago's call, overriding the tweetGPT recommendation. `tweetGPT` and `CrewAI-Studio-main` were already hard-deleted by the time this ran — not in the Recycle Bin, not archived — so tweetGPT's 37 uncommitted Threads-port paths are unrecoverable. `cortextos_probe` was removed here after re-verifying it clean (0 dirty, 0 unpushed, 0 stashes); it re-clones from `grandamenium/cortextos` at `a89cee2`. Also removed the empty `iago_clip_whisper\` left by P2's moves; `Telegram Desktop\` was left alone as a live app download target.

**Downloads: 77,025 → 705 files (-99%), now 10.11 GB measured.** The three trees were 76,320 files but only ~2.25 GB — clutter and size are unrelated problems here. **6.5 GB of what remains is two client DB-discovery trees** (`lis-discovery` 4.5 GB, `CASA_discovery` 2.0 GB), whose cost is entirely a SQL Server ISO, a 2.4 GB `.bak` and a 2.0 GB Firebird `.GDB`. Real work product, never in scope for deletion, still excluded from renaming — and now the only prize left in this zone.

**⚠ Escalated 2026-08-18 — those two trees hold client production data.** `CASA.GDB` (1.95 GB) and `tripdb_FULL_*.bak` (2.25 GB) are full production dumps; the engagement's own `pii_scan.json` counts ~12.8 M PII hits inside `CASA.GDB`, including 1,059,960 government IDs, 149,783 RFCs and 38,273 credentials. Disk encryption is unverified. The renaming and deletion passes both stopped short of them for unrelated technical reasons, not because anything recognised them as sensitive. The value in those trees is ~6 MB of analysis output; the dumps are 80% of the bytes and all of the risk. → `.iago/research/2026-08-18-downloads-client-data-exposure.md`. **Nothing moved or deleted — Santiago's call.**

### P3 — Top-level taxonomy *(folders only, dozens of renames)*

Fix the top two levels of WORK and PERSONAL. Folder renames only — the files underneath keep their names until P4.

**Why folders first:** highest ratio of order gained to files touched, and OneDrive re-syncs a folder rename far more cheaply than 129k file renames.
**Blocked on:** the two open decisions below.
**Acceptance:** every top-level folder is in the entity vocabulary or the taxonomy; OneDrive reports sync healthy afterwards.

### ~~P4 — `iagoagency` tail (129k files)~~ — **DELETED by P0**

P0 found the mass was `node_modules`. Only 1,006 of those 129,043 files are real. There is no long haul. See `.iago/research/2026-08-16-filesystem-inventory.md`.

### P3b — Evict code from OneDrive *(the actual prize)*

Seven code projects are living inside OneDrive, outside `dev\`, dragging **148,798 artifact files and 3.01 GB** through continuous sync — 96% of the object count in those zones for none of the value, plus the file-lock stalls `node_modules` causes in a sync root.

Per project: keep → move the source to `dev\`; dead → archive source-only and drop the tree. Artifact directories are regenerable and are the one sanctioned carve-out from quarantine-first deletion, once the source is safe.

**Acceptance:** no `node_modules`, `.venv`, `dist`, `build`, `__pycache__` or `.next` remains under any OneDrive path; every surviving project is in `dev\` and still builds.

**DONE 2026-08-17** — `.iago/summaries/feature-filesystem-order-p3b-evict-code.md`. Source rescued to `dev\_archive\onedrive-20260817\` (1,072 files, git history intact) before anything was deleted; three of the seven had no git remote and existed nowhere else.

**Correction, 2026-08-17.** The "0 artifacts remaining" verification was wrong: it matched artifact folders **by name**, and an eighth project — `Cursor\TravelApp` — carried a virtualenv called `.venvTA`, which `.venv` does not match. 454 files / 6.6 MB survived the sweep. No source was lost (the tree held one `.lnk` and nothing else; `pyvenv.cfg` showed it was a leftover copy of a scratch venv). Removed, and the detection now keys on `pyvenv.cfg` — PEP 405 guarantees the marker, a name list guarantees nothing. Re-verified by marker: **0 virtualenvs, 0 `node_modules`, 0 artifact dirs anywhere under OneDrive. 2,849 files.**

### P2b — Reclaim *(deletion — quarantine first, always)*

Added 2026-08-16 at Santiago's request: remove what he never looks at or uses.

**Nothing is ever deleted directly.** Three stages, and stage 3 needs an explicit go each time:

1. **Identify** — candidates only, by deterministic rule.
2. **Quarantine** — move to `_trash\{YYYYMMDD}\`, preserving relative path, journaled like any other move. Fully reversible by `undo`.
3. **Purge** — hard-delete a quarantine batch after a hold period, on Santiago's explicit approval of that batch.

**Auto-quarantine categories** (deterministic, no judgment):

- Byte-identical duplicates — same size *and* same hash, keeping the copy with the shortest path; hashed only for locally-present files, never for cloud placeholders.
- Installers (`.exe`, `.msi`) older than 30 days.
- Archives whose extracted sibling folder exists.
- Partial downloads (`.part`, `.crdownload`, `.tmp`), zero-byte files, empty directories.
- Browser and thumbnail cache artefacts.

**Never auto-quarantine** — these go to a review list Santiago decides on, one by one:

- Anything under `dev\` or inside a git working tree.
- **SAT-relevant records** — invoices, receipts, `iagoag` attachments. Legally retained; renamed and refiled, never removed.
- Anything whose only evidence of being unused is "old". Age alone is not disuse.
- Photos and anything under `Pictures`.

**Acceptance:** a purge cannot happen without a prior quarantine batch and an explicit approval for that batch; `undo` restores a quarantine batch byte-identically.

**TOOLING DONE 2026-08-17** — `scripts/organize/reclaim.py` + `test-reclaim.py` (34 assertions). Quarantine journals in `organize.py`'s format, so `organize.py undo` restores a batch with machinery that already has a byte-identical round-trip test. Trash lives at `~\_trash\{stamp}\`, outside OneDrive, so the cloud quota is reclaimed at stage 2 while the safety net is intact. `purge` refuses a batch younger than 7 days, a path outside the trash, and any directory it did not create.

**Two rules the roadmap did not anticipate, both found by running it:**

- **Identical bytes under different names is a different finding.** `descripcion materias RSB.pdf` and `book DBAN.pdf` are one document filed under two meanings; which name survives is a judgment no hash can make. Only same-stem duplicates auto-quarantine — 19 of 51 were this case and now route to review.
- **Caches diverge from `organize.py`'s protected list.** A thumbnail cache is regenerable and *should* be deleted; `desktop.ini` holds a customisation someone chose and should not. Protection from renaming and protection from deletion are different questions.

**EXECUTED 2026-08-17** — `.iago/summaries/feature-filesystem-order-p2b-reclaim.md`. 3.30 GB reclaimed: 75,161 artifact files deleted outright (retired `CrewAI-Studio-main` and `tweetGPT`), 200 files / 898 MB quarantined and reversible until 2026-08-24. Downloads 77,025 → 1,739 files. 0 residual candidates; both batches verified restorable.

**First real scan (read-only, OneDrive zones): 63 candidates / 895 MB** — 2 stale installers (867 MB, `SPSS28_Win_x64.exe` alone is 840 MB), 31 duplicates, 27 partial downloads, 3 zero-byte. Plus 22 for review. Nothing has been quarantined: awaiting Santiago's go.

### P5 — `Documents` + `Pictures` *(re-scoped 2026-08-17 — much smaller than P0 thought)*

P0's "1,381 real files" was still counting a machine tree. A closer look:

| | files | what it is |
|---|---|---|
| `WindowsPowerShell\Modules` | **914** (900 `.dll`) | the **live** user-scope `PSModulePath` — a 219 MB installed `SqlServer` module |
| `RSB` | 334 | Rennes coursework |
| everything else | ~30 | root loose files, `TEC`, `GENESIS LAB`, `OneNote Notebooks` |

**The real document corpus in `Documents` is ~364 files, not 1,381** — and P0's "502 duplicate candidates, the densest dedup target on the machine" was mostly versioned DLLs sharing a size and a stem. That target does not exist either.

What is left is one coursework tree and thirty loose files. This is a small job, and `Pictures` (1,069 files, 3 dup candidates) wants date-based foldering rather than per-file renaming.

**Worth noting, not acting on:** the PowerShell module tree syncs 219 MB through OneDrive for a module that `Install-Module` rebuilds. It cannot simply be moved — the path follows the redirected `Documents` known folder — so reclaiming it means uninstalling the module, which is a separate call.

### P6 — Enforcement *(so it does not rot)*

Scheduled Downloads sweep per the retention rule; `lint-names` run on a schedule reporting drift. Without this, the whole project decays back within months and the work is wasted.

### P7 — Drive workspace

Same grammar, different mechanics — `workspace-mcp` against the Drive API, no local filesystem, different collision and permission semantics. Deliberately last: the convention should be proven locally before it is applied somewhere with sharing links that break.

---

## Hard constraints

1. **`dev\` is rename-frozen.** Claude Code derives project directories from the literal path (`C--Users-sanal-dev-iago-os`). Renaming a repo orphans every session transcript, the per-project memory directory, all worktrees, and the absolute hook paths in `~/.claude/settings.json`.
2. **OneDrive renames are re-uploads** and can drop version history. Batched, journaled, never swept in one pass.
3. **Path length.** 260-char default ceiling; `iagoagency` already runs deep.
4. **SAT-relevant records** (invoices, receipts, `iagoag` attachments) are legally retained — renamed, never deleted, never swept.
5. **Cloud-only files stay cloud-only.** Touching a placeholder forces a download; a naive walk over `iagoagency` could pull gigabytes.
6. **Machine-managed paths are out of scope, like `dev\`.** `WindowsPowerShell` is the live `PSModulePath`; `desktop.ini` drives folder customisation; a DLL is loaded by literal name. See §6 of the standard. Detect machine-generated trees by **marker file**, never by folder name — that is how `.venvTA` survived a sweep and how 134 DLLs nearly got renamed.

## Open decisions — RESOLVED 2026-08-18

Both were resolved by **reading the folders' contents instead of arbitrating their names**, which is the lesson: a folder name is a claim about ownership, not evidence of it. Sorting `Santiago DoDas` by its name would have filed the company's KYC records under `personal/`.

- **`Santiago DoDas`** (= *datos & documentos*) held a mix; split by content into `personal/` and `iago/`. No external share referenced it.
- **`iagoagency` vs `iago`** — resolved in favour of **`iago`** as both zone root and entity. `iagoag`/`iagoagency` remain aliases in `route.py`'s `DEST` so old names still route.

## Status

| Phase | State |
|---|---|
| Standard | **locked** 2026-08-16 |
| P0 inventory | **done** 2026-08-16 → `.iago/research/2026-08-16-filesystem-inventory.md` |
| P1 tooling | **DONE** 2026-08-17 — `scripts/organize/organize.py`, 62 assertions green, apply→undo byte-identical |
| P2 Downloads | **DONE** 2026-08-17 — 406 renamed + bucketed (388 + 18 sentinel upgrades), root 387 → 2 loose, count delta 0; 143 excluded (load-bearing trees). Part B closed 08-18: 3 code trees deleted, 77,025 → 705 files |
| P2b Reclaim | **DONE** 2026-08-17 — 3.30 GB reclaimed (2.40 GB deleted, 898 MB quarantined). Purge held until 2026-08-24. 21 items await judgment. |
| ⚠ Client data | **OPEN** 2026-08-18 — 2 Palazuelos production dumps (4.2 GB) in Downloads. Disk **is** BitLocker-encrypted. Dumps re-extract from archives, so ~5.3 GB is deletable — but version-control `clients/palazuelos/.iago` first (the one client subtree with no repo). → `clients/palazuelos/.iago/research/2026-08-18-erp-dumps-in-downloads.md` |
| P3 taxonomy | blocked on the two open decisions |
| P3b Evict code | **DONE** 2026-08-17 — OneDrive 151,395 → 2,849 files, 3.03 GB reclaimed; an 8th project (`.venvTA`, 454 files) was missed by name-matching and swept after |
| P4 | deleted by P0 |
| P5 Documents | **DONE** 2026-08-18 — `.iago/summaries/feature-filesystem-order-p5-route.md`. 483 files routed via the new `route.py`, 8.1 GB quarantined, `Downloads` 796 → 290 files, `Documents` 1,270 → 919 (all machine-managed), 100% conformance in all four zones. Ten credential files pulled out of synced folders into `~/.secure/`. |
| P5 Pictures | **DONE** 2026-08-19 — folded into `Screenshots/{YYYY}/{YYYY-MM}/` via the new `route.py datefold`, then renamed: **1,061/1,061 conforming**. `TranscodedWallpaper` protected, Feedback Hub skipped, 3 DIN assets and a Munet map routed out. |
| P6 enforcement | **DONE** 2026-08-19 — `scripts/organize/sweep.py` + `test-sweep.py`. Registered with Task Scheduler as "iaGO File Sweep", daily 09:00. Acts on high/medium-confidence renames and entity routing; reports low-confidence names, aged installers and per-zone drift. Never deletes. |
| Quarantine | **PURGED** 2026-08-19 on Santiago's approval — 589 files / **9.49 GB** across four batches. One new batch (`20260819-duplicates`, 21 files / 18.6 MB) holds until 2026-08-26. |
| P7 Drive | not scoped — the last phase. Same grammar, `workspace-mcp` against the Drive API. |
