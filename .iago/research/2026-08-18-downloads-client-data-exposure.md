# Client production data is sitting in Downloads

**Date:** 2026-08-18 · **Found during:** P2 Part B cleanup (`feature-filesystem-order`)
**Status:** needs a decision from Santiago. Nothing was moved, deleted or quarantined.

## What is there

Two client database-discovery engagements live in `C:\Users\sanal\Downloads`, and both include **full production data**, not just analysis:

| file | size | what |
|---|---|---|
| `CASA_discovery\CASA.GDB` | **1.95 GB** | Firebird production database |
| `lis-discovery\tripdb_FULL_20260617_220002.bak` | **2.25 GB** | SQL Server full backup |
| `lis-discovery\sqlmedia\SQLServer2022-x64-ENU-Dev.iso` | 1.08 GB | vendor installer, not client data |

The engagement's **own** PII scan (`CASA_discovery/out/pii_scan.json`, generated 2026-06-24 by `pii_scan.py`) reports what is inside `CASA.GDB` — counts only, values not read:

| category | hits |
|---|---|
| financial | 5,321,881 |
| address | 3,553,261 |
| person_name | 2,643,611 |
| gov_id_license | **1,059,960** |
| tax_id_rfc | **149,783** |
| contact | 53,048 |
| credential | **38,273** |

~12.8 M hits. The RFC and government-ID volumes put this squarely under **LFPDPPP**; `credential` hits mean the dump may also carry application secrets.

`tripdb_*.bak` has not been scanned. Same assumption should apply until proven otherwise.

## Why this is worth raising now

Not because anything leaked — there is no evidence of that. Because of **where** it is:

1. `Downloads` was, until 2026-08-17, the least-governed folder on the machine — 387 loose files, no retention, no review.
2. It was the target of a bulk rename this week, and of a deletion pass. Both stopped short of these trees for unrelated technical reasons (their directory structure is load-bearing), **not** because anything recognised them as sensitive. A `rm -rf` aimed at "the junk in Downloads" would have taken them, and one aimed at freeing space would have taken them first — they are the largest things there.
3. Disk encryption could **not** be verified (BitLocker status needs admin). Unknown, not assumed-safe.
4. Nothing in the retention rule, the naming standard, or P2b covers "client production data". They are not classified, so no rule protects them.

## The cost is entirely the dumps

| | files | size |
|---|---|---|
| `CASA_discovery` | 48 | 1.97 GB |
| `lis-discovery` | 229 | 4.60 GB |
| **of which dumps + ISO** | 3 | **5.28 GB (80%)** |
| **analysis outputs worth keeping** | 14 | **~6 MB** |

The value — `out/*.json`, `_work/inv/*.csv`, `CASA_discovery_report.md` — is about **6 MB**. The risk and the 5.28 GB are the same three files.

## Recommendation

**Separate the two questions, and answer the data one first.**

1. **Is the engagement over?** If yes, the dumps have no reason to exist. Quarantine them (P2b's `_trash` path, reversible) and keep the ~6 MB of outputs. That removes the exposure *and* 5.28 GB in one move.
2. **If either engagement is live**, the dumps do not belong in `Downloads` regardless. They want an encrypted location outside the sweep path, and the client agreement should be checked for whether holding a full production copy locally is permitted at all.
3. **Either way**, confirm BitLocker on `C:` — one admin command, and it changes the severity of every other item here.
4. **Then** add a data class to the standard: production dumps and PII-bearing extracts get an explicit location and retention, so the next one is not discovered by accident.

The ISO is a separate, trivial call — 1.08 GB of freely re-downloadable vendor media.

## What was deliberately not done

No file was moved, renamed, deleted or quarantined. These trees are client work product and a data-protection question, not filesystem clutter, and the call is Santiago's. `pii_scan.json` was read for category counts only; no values were opened, and no PII appears in this document or in any transcript.
