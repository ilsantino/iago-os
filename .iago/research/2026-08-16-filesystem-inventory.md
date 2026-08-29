# P0 — filesystem inventory

**Date:** 2026-08-16 · **Method:** `scripts/organize/inventory.py`, read-only, stat + attributes only, no file opened.
**Plan:** `.iago/plans/feature-filesystem-order/00-inventory.md`

## Headline: the 151k-file problem does not exist

The top-level counts that shaped the original roadmap were counting dependency folders.

| | files | size |
|---|---|---|
| **Real documents, all zones** | **5,354** | 12.6 GB |
| Build artifacts inside OneDrive | 148,798 | 3.01 GB |

`OneDrive\iagoagency` reports 129,043 files. **1,006 of them are real.** The other 128,037 are `node_modules`, `dist`, `build`, `.venv`, `__pycache__`, `.next`. `OneDrive\Documents` reports 22,142; **1,381 are real**, and 20,295 sit inside a single `.venv`.

So the document corpus that actually needs a naming convention is roughly five thousand files, not a hundred and fifty thousand. P4 as written — "the 129k tail, client by client, the long haul" — is scoping work that does not exist. It is deleted.

## The finding that matters more than naming

**Seven code projects are living inside OneDrive**, outside `dev\`:

```
OneDrive\iagoagency\Cursor\CrewAI-Studio-main
OneDrive\iagoagency\Cursor\Front End\pricingPRO
OneDrive\iagoagency\Cursor\Fullstack\ai-travel-agent-saas
OneDrive\iagoagency\Cursor\Fullstack\dintransfer_lp
OneDrive\iagoagency\Cursor\Fullstack\sales-pipeline-app
OneDrive\iagoagency\ProyectosSan\ClaudeCodeTest
OneDrive\Documents\proyectos-san\genesis-lab
```

Consequences being paid right now:

- **148,798 files and 3.01 GB are being continuously synced for nothing.** Every `npm install` rewrites thousands of files that OneDrive then uploads.
- `node_modules` in a sync root is a known source of file-lock conflicts and sync stalls — OneDrive holds handles on files the toolchain wants to replace.
- It is 96% of the object count in those two zones, for 0% of the value.

This is the single largest, safest reclaim available on the machine and it is almost entirely regenerable data.

## Per-zone

| zone | files | size | dup candidates | >3y | longest path |
|---|---|---|---|---|---|
| downloads | 1,648 | **10.1 GB** | 93 | 236 | 137 |
| od-documents | 1,381 | 1.6 GB | **502** | 329 | 183 |
| od-pictures | 1,069 | 228 MB | 3 | 4 | 95 |
| od-iagoagency | 1,006 | 133 MB | 63 | 0 | 136 |
| od-santiago-dodas | 128 | 153 MB | 2 | 0 | 155 |
| od-cfa | 53 | 302 MB | 0 | 0 | 100 |
| od-desktop | 26 | 439 KB | 0 | 7 | 84 |
| od-udemy | 25 | 96 MB | 0 | 0 | 121 |
| od-make / od-din / od-biblia | 20 | 79 MB | 0 | 0 | 131 |
| desktop-local / documents-local | 4 | 90 KB | 0 | 0 | 60 |
| od-attachments | 0 | — | — | — | — |

Zero walk errors. Figures exclude the artifact directories quantified above.

## Other results

- **Conformance to the grammar: 1 file out of 5,354 (0.02%).** Entity inferable from the filename: 145 (2.71%). Effectively a greenfield — nothing to preserve, and the ambiguous tail is nearly the whole corpus.
- **`Downloads` is the real bytes problem**, not `iagoagency`: 10.1 GB across 1,648 files, 236 of them older than three years.
- **`od-documents` has 502 duplicate candidates against 1,381 files** — 36% of that zone shares a size and a stem with another file. The highest-density dedup target on the machine.
- **Path length is not a live constraint.** Longest real path is 183 chars against the 260 ceiling. The depth cap in the standard can be relaxed if it ever gets in the way.
- **Almost nothing is cloud-only: 1 placeholder in 5,354 files.** Everything is hydrated locally, so ~15.6 GB of OneDrive is occupying local disk. Detection is confirmed working (non-zero), which was the acceptance criterion.

## What this does to the roadmap

| Was | Now |
|---|---|
| P4 — `iagoagency` 129k tail, client by client | **deleted** — the mass was `node_modules` |
| — | **new P3b — evict code from OneDrive**: 7 projects, 148,798 files, 3.01 GB |
| P2 Downloads as a low-stakes warm-up | still first, but it is also the biggest *bytes* target |
| P5 Documents (22k) | 1,381 real files, and a 36% duplicate rate — becomes a dedup job |

The whole naming project is now small enough to complete in a couple of focused passes. The reclaim and the eviction are where the actual value is.

## Decisions this surfaces

1. **The seven projects** — which move to `dev\`, and which are dead experiments to archive as source-only? Per-project call; I can list last-modified dates to help.
2. **Artifact directories** — `node_modules` / `.venv` / `dist` / `build` are regenerable. Straight deletion is defensible and reclaims 148,798 files immediately; quarantining them first costs a 3 GB copy for data that `npm install` rebuilds. Recommend deleting directly *once the source trees are safe*, as the one carve-out from the quarantine-first rule.
3. Still open from before: `Santiago DoDas` rename safety, and `iagoagency` vs `iago` as the zone root name.
