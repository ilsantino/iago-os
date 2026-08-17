# P3b — Evict code from OneDrive

**Date:** 2026-08-17 · **Roadmap:** `.iago/plans/feature-filesystem-order/README.md`
**Authorised by:** Santiago — "you can kill the code projects on onedrive."

## Result

| | before | after |
|---|---|---|
| Files under `OneDrive\` | 151,395 | **3,303** |
| Artifact files (`node_modules`, `.venv`, `dist`, …) | 149,207 | **0** |
| Reclaimed | — | **3.02 GB** |

Seven code projects removed from OneDrive; 56 further artifact directories swept from elsewhere in the tree.

## What "kill" was interpreted as, and why

Artifacts were deleted outright — they are regenerable by `npm install` / `pip install`, and copying 3 GB into a quarantine folder to protect data that rebuilds itself is theatre. That was the carve-out from the quarantine-first rule agreed in the roadmap.

**Source was not deleted.** All seven trees were copied out of OneDrive first, `.git` history included, to `C:\Users\sanal\dev\_archive\onedrive-20260817\` — 1,072 files, 165.8 MB. This satisfies the actual goal (nothing code-shaped left in OneDrive, no sync churn) at a cost of 166 MB, without an irreversible judgment call about whether a remote was current. Three of the seven had **no git at all** and existed nowhere else:

| project | source | git remote | last touched |
|---|---|---|---|
| CrewAI-Studio-main | 56 files | **none** | 2025-11-18 |
| pricingPRO | 39 files | **none** | 2025-08-21 |
| dintransfer_lp | 24 files | **none** | 2025-08-25 |
| ai-travel-agent-saas | 135 files | ilsantino/ai-travel-agent-saas | 2025-07-09 |
| sales-pipeline-app | 210 files | ilsantino/sales-pipeline-app | 2025-07-08 |
| ClaudeCodeTest | 96 files | ilsantino/claude-code-test | 2026-02-25 |
| genesis-lab | 512 files | ilsantino/genesis-lab | 2026-02-19 |

Had the trees been deleted on the strength of "they're probably on GitHub", those three would have been gone permanently.

## Order of operations

1. **Profile** — source vs artifact counts, git presence, remote URL, last-modified, per project.
2. **Rescue** — `copytree` excluding artifact dirs, `.git` retained.
3. **Verify** — every rescued tree non-empty; every git repo's `git log` resolves. Gate: no deletion until this passed.
4. **Delete** — the seven trees: 134,396 files / 2.83 GB in 141 s.
5. **Sweep** — 56 remaining artifact dirs: 14,811 files / 0.19 GB. `dist`/`build`/`out` only removed next to a project marker (`package.json`, `pyproject.toml`, …); `.git` never descended into.
6. **Confirm** — re-walk reports 0 artifact files remaining.

Journals: `_rescue-journal.json`, `_deletion-journal.json`, `_sweep-journal.json` in the archive directory.

## Follow-ups

- **The 3 GB is not reclaimed from the OneDrive cloud quota until the online recycle bin is emptied** — deletions sit there ~30 days. That is also the safety net, so leave it until the rescue is confirmed good, then empty it deliberately.
- The four projects with remotes could be dropped from `dev\_archive\` once Santiago confirms each remote is current; the three without must stay or be pushed somewhere first.
- `dev\_archive\` is a new directory, not a rename — the `dev\` rename-freeze is intact.

## Inventory delta

Real document corpus is now 4,943 files across the zones (was 5,354; the difference is the rescued project sources, now outside the zone list). Conformance to the naming grammar is unchanged at 1 file — P2 has not run yet.
