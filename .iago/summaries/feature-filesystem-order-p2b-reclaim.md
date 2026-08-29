# P2b — Reclaim — execution summary

**Plan:** `.iago/plans/feature-filesystem-order/README.md` §P2b · **Run:** 2026-08-17, operations
**Tool:** `scripts/organize/reclaim.py` · gate `test-reclaim.py` → PASSED (34 assertions)
**Authorised by:** Santiago — "CrewAI i dont need it anymore, tweetgpt can go as well. quarantine the 895mb."

## Result

**3.30 GB reclaimed. 898 MB of it still reversible for 7 days. Nothing purged.**

| | files | bytes | reversible until |
|---|---|---|---|
| Deleted outright — regenerable artifacts | 75,161 | **2.40 GB** | — |
| Quarantined — OneDrive candidates | 63 | 895.4 MB | 2026-08-24 |
| Quarantined — retired project source | 137 | 3.0 MB | 2026-08-24 |
| **Total** | **75,361** | **3.30 GB** | |

`Downloads` 77,025 → **1,739 files**. `OneDrive` 2,849 → **2,787 files / 1.77 GB**.

## Retired projects

Santiago retired both. Artifacts were deleted outright — `venv` and `node_modules` rebuild from a lockfile, and copying 2.4 GB into quarantine to protect data that regenerates is theatre. **Source was quarantined, not deleted**, because it is 3 MB and the P3b lesson still stands.

| project | git | source | artifacts deleted |
|---|---|---|---|
| `CrewAI-Studio-main` | **no `.git` at all** — a zip extraction | 61 files | `venv` 69,994 files / 2.29 GB |
| `tweetGPT` | remote `yaroslav-n/tweetGPT`, **37 dirty paths** | 48 + 28 `.git` | `node_modules` 5,167 files / 0.11 GB |

The earlier note that `tweetGPT` was "on no remote" was wrong — it has one. What is genuinely unique is the 37 uncommitted modifications, an unfinished Threads port. Those are inside the quarantined source; re-cloning the remote would not bring them back. That is the reason the source went to quarantine rather than to `rm`.

## OneDrive quarantine — 63 candidates, 895.4 MB

| category | files | bytes |
|---|---|---|
| installer-stale | 2 | **867.3 MB** |
| duplicate (same name) | 31 | 23.1 MB |
| partial-download | 27 | 4.9 MB |
| zero-byte | 3 | 0 B |

`SPSS28_Win_x64.exe` alone is 840 MB — one file, 94% of the batch.

Re-scan after the run: **0 residual candidates.** Dry-run `undo` on both batches: `restored=63` and `restored=137`, `occupied=0 failed=0` on each.

## Held back for judgment — 21 items

Deliberately not quarantined. **18 are byte-identical files under different names**, which is a filing decision, not a deletion:

- **Two are misfiled, not duplicated.** `timeSeriesAnalysis_Syllabus.pdf` and `programmingForDataAnalytics_Syllabus.pdf` are the same bytes — one of them is the wrong syllabus under the right name. Same for `beer.csv` / `aus_production.csv`. Deleting either would keep the error and destroy the evidence of it.
- **Four are cross-zone identity documents** — `INE.pdf` and `curp.pdf` exist in both `iagoagency\Santiago\` and `Santiago DoDas\Documentos Identidad\`. Which zone owns them is a **P3 taxonomy** question.
- The rest are ABSARA branding screenshots duplicated across export folders, and RSB coursework.

Remaining 3: 2 machine-managed, 1 on a SAT-relevant path (`Estado_de_cuenta_0977_Diciembre_2025`) — legally retained, never swept.

## Fixes this run produced

- **`.Rproj.user` added to `SKIP_DIRS`.** RStudio session state surfaced as five "duplicates" with hash-named files. Same class as `.venv` — machine-generated, not documents.
- Confirmed the different-name rule earns its place: without it, 18 files would have been auto-quarantined and two misfilings silently buried.

## Next

- **Purge is refused until 2026-08-24** (7-day hold). It needs an explicit per-batch go from Santiago; `reclaim.py list` shows when each becomes purgeable.
- `dev\_archive\onedrive-20260817\CrewAI-Studio-main` (56 files) still holds the P3b rescue copy. Left in place — `reclaim.py` refuses to operate under `dev\`, and bypassing that guard for 2 MB is not worth it.
- The 18 different-name pairs need one pass of Santiago's judgment, ideally alongside P3.
