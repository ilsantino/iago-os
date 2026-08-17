# P2 — Downloads

**Feature:** `.iago/plans/feature-filesystem-order/` · **Depends on:** P1 (done, `dc798aa`)
**Nature: an operations run, not a code change.** Do **not** route this through `/iago-execute`, `/iago-quick` or the review pipeline — there is no diff to review, no build to gate, and no PR to open. The deliverable is a reorganised Downloads folder plus a summary. The only code that runs is `scripts/organize/organize.py`, which already shipped with its tests.

**Risk:** low and bounded. Every move is journalled and reversible with one command. Nothing is deleted — deletion is P2b, and it is not in scope here.

---

## Scope, measured

A P1 scan on 2026-08-17 found 1,648 files in `C:\Users\sanal\Downloads`:

| | count | disposition |
|---|---|---|
| inside a git working tree | 911 | **Part B** — a decision, not a rename |
| already conforming | 11 | untouched |
| **renameable** | **726** | high 6 · medium 99 · low 621 |

Total 10.1 GB. 93 duplicate candidates and 236 files older than three years exist but are **P2b's** problem, not this one.

---

## Preconditions

```bash
cd C:/Users/sanal/dev/iago-os
python scripts/organize/test-organize.py     # must print PASSED
git log --oneline -1 -- scripts/organize/    # expect dc798aa or later
```

If the tests do not pass, stop. The whole point of P1 was that this run is reversible.

---

## Part A — the renames *(proceed without asking; fully reversible)*

### A1. Scan

```bash
python scripts/organize/organize.py scan --zone downloads --bucket \
  --out .local/organize/p2-plan.json
```

`--bucket` files each keeper into `docs/ sheets/ slides/ images/ video/ audio/ archives/ installers/ code/ other/` under `Downloads`. This stays inside the zone — **no cross-zone moves in P2.** Promoting keepers into OneDrive is P3's job and needs a taxonomy that does not exist yet.

### A2. Batch one — high and medium confidence

Earn trust on the 105 files whose entity is actually known before touching the tail.

```bash
python scripts/organize/organize.py apply .local/organize/p2-plan.json --confidence high,medium
python scripts/organize/organize.py apply .local/organize/p2-plan.json --confidence high,medium --apply
```

Dry-run first, always. Read the output. Then spot-check ~10 renamed files in Explorer and confirm they open.

### A3. The entity pass — the genuine AI 10%

621 proposals carry `no-entity`: the filename does not say who the file belongs to. `misc` is honest, but a good share of these are recoverable from context a script cannot see — `Unsolicited Investment Order Portfolio 8` is Palazuelos; a Munet ticket export is `munet`.

Read the low-confidence ops out of the plan JSON and classify what you can **from the filename, the sibling files, and the date**. Do not open file contents to classify — it is slow, and for OneDrive-backed paths it hydrates placeholders.

Write `.local/organize/p2-hints.json`, keyed by root-relative path:

```json
{
  "05.18.26 - Unsolicited Investment Order Portfolio 8 - SAC Phase 1 of 3.pdf": "palazuelos",
  "Boletos Munet.xlsx": "munet"
}
```

Only tokens already in §4 of `.iago/_config/runbooks/file-naming-standard.md` are accepted — the scan refuses anything else by design, because an ad-hoc entity is how a controlled vocabulary dies. If a genuinely new entity is needed, add it to the standard first, deliberately, and say so in the report.

**Leave the rest as `misc`.** Guessing an owner is worse than admitting there isn't one — `misc` still sorts, still lints, and can be fixed later.

Then re-scan with the hints and apply the remainder:

```bash
python scripts/organize/organize.py scan --zone downloads --bucket \
  --hints .local/organize/p2-hints.json --out .local/organize/p2-plan-2.json
python scripts/organize/organize.py apply .local/organize/p2-plan-2.json          # dry-run
python scripts/organize/organize.py apply .local/organize/p2-plan-2.json --apply
```

### A4. Verify

```bash
python scripts/organize/organize.py lint --zone downloads
python scripts/organize/inventory.py | head -20
```

Conformance should go from 11/737 to essentially all of it. File **count** must be unchanged — renaming never destroys or creates a file, so a changed count means something went wrong and the journal should be replayed backwards.

---

## Part B — the two code projects *(profile and report; do NOT act)*

`cortextos_probe` (863 files) and `tweetGPT` (48) are git checkouts living in Downloads. The tool refuses to touch anything inside a git working tree, which is correct — git tracks paths.

This is the same disease P3b just cured in OneDrive, and P3b's lesson applies: **three of the seven OneDrive projects had no git remote at all and existed nowhere else.** A delete-on-assumption would have destroyed them.

So: profile only. For each, report last commit date, remote URL (or its absence), whether the working tree is dirty, and size on disk. Then stop and let Santiago decide move-to-`dev\` vs archive-source-and-drop. Do not move, delete or push anything in Part B.

---

## Rollback

Every `--apply` writes `.local/organize/journal-{stamp}.ndjson`. To reverse one:

```bash
python scripts/organize/organize.py undo .local/organize/journal-{stamp}.ndjson          # dry-run
python scripts/organize/organize.py undo .local/organize/journal-{stamp}.ndjson --apply
```

Reverse batches newest-first. `undo` refuses to overwrite a file that has since reclaimed an old name, and reports it as `occupied` rather than clobbering it.

---

## Acceptance

1. `lint --zone downloads` reports near-total conformance; file count unchanged from 1,648.
2. Every executed batch has a journal, and a dry-run `undo` of the newest journal reports zero `failed` and zero `occupied`.
3. The entity pass is documented: how many were promoted out of `misc`, and on what evidence.
4. Part B is a written recommendation with the git facts attached — not an action taken.
5. Summary at `.iago/summaries/feature-filesystem-order-p2-downloads.md`, roadmap status table updated, one commit.

## Out of scope

Deletion, deduplication and the 236 files older than three years — all P2b, quarantine-first. Cross-zone moves — P3. Anything under `OneDrive\` — a different phase.
