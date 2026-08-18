# P3 (continued) — FIEL security, document identification, nomenclature

**Run:** 2026-08-18, operations · **Plan:** `.iago/plans/feature-filesystem-order/03-taxonomy.md`

## 1. FIEL — moved out of OneDrive

**Verdict: not safe where they were.** Both `.key` files are encrypted PKCS#8, so not plaintext — but the parameters decide the question, and they fail it:

| | |
|---|---|
| Scheme | PBES2 (`1.2.840.113549.1.5.13`) |
| Salt | 8 bytes |
| **KDF iterations** | **2,048** |

Current guidance for PBKDF2 is 600,000+. At 2,048, a consumer GPU tries on the order of 10 million passwords a second — a human-chosen password falls in hours, **offline, with no rate limit and nothing to detect the attempt.** In OneDrive, any compromise of the Microsoft account hands an attacker the file to grind at leisure. A FIEL signs tax filings, issues CFDIs and legally binds the company.

Moved to `C:\Users\sanal\.secure\fiel\` — outside every sync root, ACL rewritten with inheritance disabled and a single grant to `SURFACE_SAN\sanal` (no SYSTEM, no Administrators). Journal: `.local/organize/fiel-move.ndjson`.

```
.secure/fiel/iago-IAG250702682/       .key .cer .req   <- the company
.secure/fiel/personal-AACS000908IY9/  .zip             <- Santiago
```

**The trade, stated plainly: this folder is not backed up.** Losing a FIEL means an in-person SAT appointment to re-issue. `~/.secure/README.txt` says so and asks for an offline copy on encrypted media. The password must never be stored beside the key. No password or hint file was found near either bundle.

## 2. Documents identified by reading them

| file | what it actually was | disposition |
|---|---|---|
| `064f...jpg` x5 under `absara/` | **Privia** — a legal-AI product (Investigación Legal, Jurisprudencia, Revisión de Contratos), logged in as `santiago@iagoag.com` | to `iago/03-entregables/privia/`, renamed. **Not Absara at all.** |
| `Clasificación.xlsx` under `personal/03-finanzas/sat/` | a 1,007-entry **bottling-line downtime taxonomy** — envasadora, granel, cambio de color / fragancia. Not a tax document. | to `iago/01-clientes/_sin-atribuir/`. Client work; which client is unresolved. |
| `sol2051026736_resguardoSolicitud.pdf` | **UC3M** postgrad application receipt — Inteligencia Artificial Aplicada 2026-2027, 27.54 EUR | to `personal/02-educacion/`, named for what it is |
| `D65B75EB-...-793CCF52156E.pdf` | a **CFE electricity bill** — Sebas's proof of address | renamed `comprobante-domicilio-cfe-sebastian.pdf`, stays in KYC |
| `DiagnosticoParaLaAccion.docx` | a **Mexican policy paper 2024-2030** by Mtro. Mario A. Romo — third-party | quarantined |
| `career-project/*.md` | a headhunter prompt + honest candidate dossier | correct where it was |
| `Gemini_Generated_Image_*.png` | genuine iaGO GO logo variants | correct in `marca/` |
| `estadoCuenta_caratulaBancaria_dic.pdf` | scanned image, no text layer — a bank cover sheet in the Absara folder | **left in place, unresolved** |

## 3. Santiago / Sebastián — keep both, and why

Santiago offered to delete them. **They should stay in `iago/02-empresa/kyc/`.** They are not personal folders: they hold `LFPIORPI Personas Físicas` and `MF BENEFICIARIO CONTROLADOR SAT` — AML filings *the company* makes about its beneficial owners. Sebas's documents in particular are not Santiago's to file under `personal/`.

`kyc/santiago/INE.pdf` and `curp.pdf` are byte-identical to `personal/01-identidad/`. **That duplication is intentional and is being kept.** A KYC pack is handed to a bank or a notary as a unit; gutting it to save 600 KB breaks a compliance artifact to satisfy a dedup rule. This closes two of P2b's 18 different-name duplicates as "keep both, on purpose".

## 4. Nomenclature applied — 100% conformance

| zone | files | conforming |
|---|---|---|
| `personal/` | 135 | **100%** |
| `iago/` | 115 | **100%** |
| `din/` | 4 | **100%** |

248 renames, journals in `.local/organize/p3-applied-od-{personal,iago,din}.ndjson`, all three verified restorable (`occupied=0 failed=0`). New vocabulary: `absara`, `o11e`, `privia`. `ZONES` rewritten for the new layout.

### Two defects the run exposed

**The zone root was not evidence.** Every file under `personal/` derived `misc`, because the entity search only looked at folders *below* the root — so the folder that most clearly names the owner was the one folder ignored. Root now goes first in the search list, ordered so the deepest folder still wins.

**`SENTRIA.jpg` became `sentria-file.jpg`.** When a stem is nothing but the entity, the descriptor emptied and fell back to the literal word "file" — and two such files collide immediately. The containing folder is real information from the tree, so it is used instead: `sentria-brandingbot.jpg` and `sentria-images.jpg`.

Together these took low-confidence proposals from **109 to 3**. Both are regression-tested.

## Open

- `clasificacion-paros-linea-envasado.xlsx` — which client? Allende (brewery) and Absara (Sentria's operator) both plausible; "cambio de color / fragancia" argues against beer.
- `estadoCuenta_caratulaBancaria_dic.pdf` — whose bank cover sheet, iaGO's or Absara's?
- An offline backup of `~/.secure/fiel/`.
