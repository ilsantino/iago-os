# P0 — Inventory

**Feature:** `.iago/plans/feature-filesystem-order/`
**Risk:** none. Read-only. No file is created, renamed, moved, or opened for content.
**Layer:** 60 — deterministic. One script, one report, no LLM in the loop.

## Why this is first

Every volume number in the roadmap past top-level counts is currently unknown. `iagoagency` is 129,043 files and I have no idea what they are — they could be 400 documents and 128,000 asset-bundle leaves, which would make per-file renaming meaningless and turn P4 into a foldering job instead. Scoping P4 now would be inventing a taxonomy from folder names, which is the exact failure this project has already hit once.

## Task

`scripts/organize/inventory.py` — walks the zones and emits a report.

Per zone (`Downloads`, `OneDrive\iagoagency`, `OneDrive\Documents`, `OneDrive\Pictures`, `OneDrive\{Santiago DoDas, CFA, UDEMY, DIN, Biblia, Make.com}`, `C:\Users\sanal` top level, `Desktop`):

| Dimension | Why it is needed |
|---|---|
| count + bytes by extension | separates document zones from asset zones |
| count by age bucket (≤30d, ≤1y, ≤3y, older) | decides what is live vs archive |
| how many names already parse as `{YYYYMMDD}-{entity}-…` | the starting conformance rate |
| how many names carry an inferable entity token | how big the ambiguous tail really is |
| directory depth histogram + longest full path | the 260-char ceiling is a real constraint here |
| count of cloud-only placeholders vs locally-present | a naive walk could pull gigabytes; P4 must not |
| duplicate candidates by (size, name-stem) | how much of the 129k is copies |
| top 30 largest directories by file count | where the mass actually sits |

### Must not

- Descend into `dev\`, `.git`, `node_modules`, `AppData`, `$Recycle.Bin`, `OneDrive - Rennes School of Business`.
- **Open any file.** Attributes and `os.stat` only — reading content hydrates OneDrive placeholders.
- Write anything outside the report path.

### Implementation notes

- Detect placeholders via the Windows attribute bits (`FILE_ATTRIBUTE_RECALL_ON_OPEN` / `RECALL_ON_DATA_ACCESS` / `OFFLINE`), not by trying to read.
- `os.scandir` throughout — `Path.rglob` over 129k entries on a synced tree is slow and stats twice.
- Tolerate `PermissionError` and long paths per entry; a single unreadable directory must not abort the walk.
- Deterministic output ordering so two runs diff cleanly.

## Acceptance

1. Runs to completion over every in-scope zone without touching a file's content.
2. Report committed to `.iago/research/2026-08-16-filesystem-inventory.md`, with the raw JSON beside it.
3. Placeholder count is reported and is > 0 for at least one OneDrive zone, proving detection works rather than silently reporting zero.
4. Re-running produces a byte-identical report on an unchanged tree.
5. Every P2–P5 volume in the roadmap can then be quoted from this report rather than estimated.

## Out of scope

Any rename, move, or deletion. Any proposal of new names — that is P1's `scan`.
