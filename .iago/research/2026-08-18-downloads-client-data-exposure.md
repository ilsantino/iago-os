# Palazuelos production data in Downloads — what it is, and what it costs to keep

**Date:** 2026-08-18 · **Found during:** P2 Part B cleanup (`feature-filesystem-order`)
**Revised same day** after reading the vault and the client repo. The first version of this note assumed the two trees were irreplaceable work product of unknown ownership. Both assumptions were wrong; the corrected picture is below.
**Status:** one decision for Santiago, plus two overdue follow-ups that have nothing to do with filesystem order.

## Whose it is

`CASA_discovery\` and `lis-discovery\` are both **Palazuelos** — Fase 0 discovery of their three ERPs (SATO / CASA / LIS-TRIP). `CASA` is the customs agency's Firebird ERP; `LIS` is Trip Mexicana's SQL Server TMS, which is why the dump is called `tripdb`. Sources: `sessions/2026-06-24-palazuelos.md`, `sessions/2026-06-24-palazuelos-lis-discovery.md`.

`palazuelos` was already in the vocabulary — the scanner simply had no way to know these belonged to it. **Corrected:** the two source archives now read `20260617-palazuelos-tripdb-full-220002.rar` and `20260623-palazuelos-casa-gdb001.zip` (journal `journal-20260818-143421.ndjson`, reversible).

## What is actually there

| file | size | status |
|---|---|---|
| `CASA_discovery\CASA.GDB` | 1.95 GB | client-provided snapshot **copy**; original never touched |
| `lis-discovery\tripdb_FULL_*.bak` | 2.25 GB | extracted from the `.rar` |
| `lis-discovery\sqlmedia\*.iso` | 1.08 GB | vendor media, freely re-downloadable |

The engagement's own scan (`pii_scan.json`, 2026-06-24) counts ~12.8 M PII hits inside `CASA.GDB` — 5,321,881 financial · 3,553,261 address · 2,643,611 person_name · **1,059,960 government IDs** · **149,783 RFCs** · **38,273 credentials**. Counts only; no values were opened, and none appear in this document.

## Everything in those trees already exists somewhere safer

This is the finding that changes the decision. Verified, not assumed:

| in Downloads | also at | verified how |
|---|---|---|
| `CASA_discovery/out/*.json` (8) | `clients/palazuelos/.iago/research/discovery/casa/evidence/` | **sha256 identical** on `pii_scan`, `schema`, `rowcounts` |
| `CASA_discovery/*.py` (7) | `…/discovery/casa/scripts/` | present, same names |
| `CASA.GDB` | `archives\20260623-palazuelos-casa-gdb001.zip` (682 MB) | zip lists `CASA.GDB` at exactly 1.95 GB |
| `tripdb_FULL_*.bak` | `archives\20260617-palazuelos-tripdb-full-220002.rar` (226 MB) | documented single-file extraction; **not re-verified** (no rar reader available) |
| LIS inventory + catalog | `…/discovery/lis/` — `catalog.md`, `candidate-catalog.md`, 9 evidence JSON | present |

**Both discoveries are finished.** `clients/palazuelos/.iago/STATE.md` reads *"CASA y LIS listos; SATO superficie cerrada."* The June 24 note calling LIS "BLOCKED, Phases 2–9 not run" is eight weeks stale — the work was completed and committed afterwards.

So the 6.5 GB in Downloads contains **no unique deliverable**. What it contains is one disposable database copy, one re-extractable backup, a vendor ISO, a Firebird runtime, and a byte-identical duplicate of evidence that is already in the client repo.

## The decision

**Delete the two extracted dumps and the ISO; keep the two archives.** That reclaims **~5.3 GB**, removes the largest unencrypted PII surface on the machine, and loses nothing — the archives still hold both databases, and every analysis artefact is committed. If either database is ever needed again, it re-extracts.

Keeping them is also defensible; the point is that it should be a **choice**, which until now it was not. Nothing in the naming standard, the retention rule, or P2b classifies a production dump, so no rule protected these — this week's rename pass and deletion pass both stopped short of them for unrelated technical reasons, and a sweep aimed at freeing space would have taken the biggest files first.

Two things to do regardless:

- **Verify BitLocker on `C:`.** Needs elevation, so it needs Santiago: `! manage-bde -status C:`. It changes the severity of everything above.
- **Add a data class to the standard** — production dumps and PII-bearing extracts get an explicit location and retention, so the next one is not found by accident. `~/.secure/` (established today for the FIEL keys: outside every sync root, inheritance disabled, single ACL grant) is the obvious home, with the caveat already written into `~/.secure/README.txt` that it is not backed up.

## Two overdue items this surfaced

Neither is a filesystem problem. Both are older and more consequential.

1. **Palazuelos has plaintext passwords in their live production system.** `SISSEG_USUARI.CLAVE`, found 2026-06-24. The session note lists *"Avisar al cliente el hallazgo"* as a follow-up. **No record anywhere in the vault of that notification having happened** — no later session, meeting or daily mentions it. It may have been said verbally; if not, it is eight weeks old, it concerns the client's *live* system, and it is the kind of finding a client is entitled to hear promptly.
2. **`INSTALL-SQL-for-LIS.cmd` is not on the Desktop**, where the June note says it was staged for a double-click. It is only at `lis-discovery\INSTALL-SQL-for-LIS.cmd`. Harmless now that LIS is done, but worth knowing the documented resume path is broken if anyone follows that note.

## What was deliberately not done

No dump was moved, deleted or quarantined — that call is Santiago's, and quarantining into `_trash` would have been actively wrong, since it queues client production data for a purge. Only the two archive **filenames** changed, to record the owner the vault already knew. `pii_scan.json` was read for category counts only.
