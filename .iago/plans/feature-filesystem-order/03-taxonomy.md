# P3 — Taxonomy: split personal from work

**Feature:** `.iago/plans/feature-filesystem-order/` · **Supersedes** the two "open decisions" that were blocking P3 — both are answered below, from contents rather than from folder names.
**Nature:** operations. Folder moves first, file renames second.

## What the audit found

Read on 2026-08-18. Three zones, 419 files.

### `Santiago DoDas` (98 files) — "Datos & Documentos". 100% personal.

Identity (`DNI`, both passports, `INE`, `CURP`, `CSF`), education (RSB diploma + transcripts, TEC certificates, UC3M motivation letter), CVs in three languages, personal SAT, an investment-account onboarding pack, Spanish padrón municipal, a French course.

**There is not one work file in it.** The zone is correctly scoped and misnamed.

### `iagoagency` (221 files) — three unrelated things in one folder.

| what | where | files |
|---|---|---|
| **Client work** | `ABSARA/` `ALLENDE/` `o11e/` `Projects/` | ~110 |
| **Company records** | `SAT IAGO/` `Santiago/` `Sebastián/` `Formato Constitutivas` `documentacion/` logos | ~30 |
| **Learning library** | `Building Agents/` `LLM ACADEMY/` `n8n/` + 6 loose guides | ~35 |
| **Code that should not be here** | `Cursor/` | **53** |
| Empty directories | `Fran/` `Francisco/` `iagoagency/iagoagency/` `ProyectosSan/` `Cursor/Fullstack/` | 0 |

`Santiago/` and `Sebastián/` are **not** personal folders despite the names — they hold KYC/AML compliance documents (`LFPIORPI Personas Físicas`, `MF BENEFICIARIO CONTROLADOR SAT`) that the company files. They belong to the company, not to the person.

### There is no `iago` folder

The name exists only as an entity token in the standard and as `SAT IAGO/`. Nothing to reconcile — the question was really "what should the work root be called", and the answer is `iago`, matching §4.

---

## The two blocking decisions, answered

**1. `Santiago DoDas` → `personal`.** Nothing in it is shared work product — it is identity documents, diplomas and personal tax. A OneDrive rename does break any existing share link, and that cannot be checked from the filesystem. So: **reorganise the contents first under the existing name, rename the folder last, as its own step.** That decouples the only irreversible-ish part from everything else and makes it a 10-second undo if a link breaks.

**2. `iagoagency` → `iago`.** The vocabulary already says `iago`; the folder is the outlier. Renaming it costs nothing because the zone is being restructured anyway.

---

## Target structure

```
OneDrive/
  personal/                        ← Santiago DoDas + CFA + UDEMY + Biblia      (180 files)
    01-identidad/                  DNI, pasaportes, INE, CURP, CSF
    02-educacion/                  rsb/ tec/ uc3m/
    03-finanzas/                   banca-inversion/ sat/
    04-carrera/                    CVs, cartas, constancias laborales
    05-formacion/                  cfa/ udemy/ frances/ biblia/

  iago/                            ← iagoagency + DIN + Make.com               (~184 files)
    01-clientes/                   absara/ allende/ din/ o11e/
    02-empresa/
      legal/                       constitutivas, NDAs, convenios
      fiscal/                      SAT IAGO, estados de cuenta
      kyc/                         santiago/ sebastian/ francisco/
      marca/                       logos, banners
    03-entregables/                technical design documents
    04-comercial/                  propuestas, sales pipeline
    05-biblioteca/                 building-agents/ llm-academy/ n8n/ make/ guias/

  Documents/  Pictures/  Desktop/  ← FROZEN. Windows Known Folders.
```

**`Documents`, `Pictures` and `Desktop` cannot be renamed or moved.** They are Windows Known Folders redirected into OneDrive; the shell resolves them by literal path. Same class of hazard as `WindowsPowerShell` and `dev\` — see §6 of the standard.

Depth stays within the ≤4 cap. Numeric prefixes force sort order, per §3.

---

## Execution order — reversibility first, again

1. **Evict the last 53 code files.** `Cursor/` holds `santinosPortfolio` and `myFirstFrontEnd` (Vite/React source), `Agents/pythonTest/main.py`, and `TravelApp/iagoagency.lnk`. P3b targeted seven *named* projects and these were not among them. Rescue to `dev\_archive\` then delete, exactly as P3b did.
2. **Remove the 6 empty directories**, including `iagoagency/iagoagency`.
3. **Create the taxonomy** and move folders into it — journalled, `organize.py undo`-able.
4. **Fix the two misfilings** found in passing: `Sebastián/PACKING GENERAL - CARGAS LAS VEGAS 16496.xlsx` is o11e client work sitting in a KYC folder; `Estado_de_cuenta_0977_Diciembre_2025.pdf` is loose at the root and duplicates `SAT IAGO/EstadosCuenta2025/`.
5. **Rename files** to `{YYYYMMDD}-{entity}-{descriptor}` with `--hints` for the entity pass. New vocabulary needed: `absara`, `o11e`.
6. **Rename the two roots** last: `Santiago DoDas` → `personal`, `iagoagency` → `iago`.

## Acceptance

Every top-level folder is in the taxonomy; no client work under a company folder and none the other way; `lint` reports near-total conformance; file count delta 0; every step journalled and reversible; OneDrive reports sync healthy.

## Out of scope

`Documents`, `Pictures`, `Desktop` — frozen. The 18 different-name duplicates from P2b — they need judgment, and four of them (`INE`, `curp`) resolve themselves once the personal/company split exists.
