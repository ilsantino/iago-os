# P3 — Taxonomy — execution summary

**Plan:** `.iago/plans/feature-filesystem-order/03-taxonomy.md` · **Run:** 2026-08-18, operations
**Authorised by:** Santiago — "learning library can be deleted, the code that shouldn't be there as well, we can delete empty dirs, and just organize the company records and client work. Din is separate to iago, and anything make.com can be deleted."

## Result

**OneDrive is now three named zones plus the three frozen Windows folders.**

| before | after |
|---|---|
| 12 top-level folders, no split between personal and work | `personal/` · `iago/` · `din/` + frozen `Documents/` `Pictures/` `Desktop/` |
| 2,849 files | **2,633 files / 1.72 GB** |

```
personal/  140 files          iago/  118 files            din/  5 files
  01-identidad        9         01-clientes      85         Contrato    1
  02-educacion       19           absara         54         Flujos      3
  03-finanzas        12           allende        20
  04-carrera         14           o11e           11
  05-formacion       85         02-empresa       27
    cfa 53 · udemy 25             fiscal  8 · kyc 11
    biblia 4 · frances 2          legal 1 · marca 7
                                03-entregables    3
                                04-comercial      3
```

`din` is its own root, not a client under `iago` — Santiago's call, and the contents agree: it holds an employment contract, not client deliverables.

## Removed — 196 files, all quarantined, none hard-deleted

| what | files |
|---|---|
| Learning library — `Building Agents/` `LLM ACADEMY/` `n8n/` `Make.com/` + 6 loose guides | 61 |
| Code still in OneDrive — `Cursor/` (santinosPortfolio, myFirstFrontEnd, pythonTest) | 53 |
| Browser "Save page" resource folder inside `Banca Inversión/` | 41 |
| Empty directories and file-free trees | 26 dirs |

Batch `20260818-library-and-code`, 155 files / 49.2 MB, **restorable until 2026-08-25.**

The `Cursor/` files are P3b's real residue: that phase targeted seven *named* projects rather than a pattern, so two Vite/React source trees and a scratch `main.py` survived it.

## Two ambiguous deletions, flagged

`Installation Guide.pdf` and `Operations Blueprint v2.pdf` were counted in the learning library, but either could be an iaGO asset rather than course material. They are in quarantine, not deleted — if they matter, pull them back before the hold expires.

## Misfilings fixed

- `Sebastián/PACKING GENERAL - CARGAS LAS VEGAS 16496.xlsx` — o11e client work sitting in a KYC folder → `01-clientes/o11e/`.
- `Estado_de_cuenta_0977_Diciembre_2025.pdf` — loose at the root, duplicating `SAT IAGO/EstadosCuenta2025/` → `02-empresa/fiscal/`.

`Santiago/` and `Sebastián/` were **not** personal folders despite the names — they hold `LFPIORPI Personas Físicas` and `MF BENEFICIARIO CONTROLADOR SAT`, KYC/AML filings the company makes. They landed in `iago/02-empresa/kyc/`. Sorting by folder name would have filed them under `personal/`.

## Reversibility — and the ordering it imposes

| journal | ops |
|---|---|
| `.local/organize/p3-taxonomy.ndjson` | 36 folder/file moves |
| `.local/organize/p3-roots.ndjson` | 3 root renames |

**Undo newest-first: `p3-roots` before `p3-taxonomy`.** The taxonomy journal records paths under `Santiago DoDas\` and `iagoagency\`, which no longer exist once the roots are renamed — a dry-run of it alone reports `missing=36`. That is ordering, not damage: reverse the root renames first and the paths resolve.

## Bug found and fixed: the manifest under-reported a reused batch

Quarantining twice into the same batch stamp appended correctly to the journal but **overwrote `_manifest.json`** with only the second call's ops. `reclaim.py list` reported 41 files where 155 were held — and `purge` reads the same manifest, so it would have understated what it was about to destroy while deleting all of it.

`write_manifest()` now rebuilds the manifest from the journal, which was always the stated source of truth. The affected batch was regenerated: 41 → 155. Regression test asserts the manifest counts both calls and matches the files actually on disk.

## Next

- **Rename the files** to `{YYYYMMDD}-{entity}-{descriptor}`. New vocabulary needed: `absara`, `o11e`.
- **Move the FIEL keys out of OneDrive** — see the security note in the plan. Not touched.
- Purge for all three batches unlocks 2026-08-24/25 and needs a per-batch go.
