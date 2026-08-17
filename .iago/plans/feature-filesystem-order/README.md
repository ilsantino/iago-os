# Filesystem order — roadmap

**Goal:** one naming grammar and one taxonomy across Santiago's machine, enforced by script rather than discipline, then the same logic applied to the Drive workspace.

**Standard:** `.iago/_config/runbooks/file-naming-standard.md` — `{YYYYMMDD}-{entity}-{descriptor}[-v{N}].{ext}`, lowercase kebab. Locked 2026-08-16.

**Scale (measured, P0):** **5,354 real files / 12.6 GB** — plus 148,798 build-artifact files (3.01 GB) sitting inside OneDrive that should not be there at all. The "151k files" in the first draft of this roadmap were `node_modules`.

---

## Sequencing principle

Order by **reversibility first, mass second**. Every phase proves the tooling on cheaper ground before it touches anything expensive. The 129k-file zone is phase 4, not phase 1, and it is not scoped until phase 0 has actually looked inside it.

The failure mode being designed against: a confident bulk rename across a cloud-synced tree, based on a taxonomy invented from top-level folder names, with no way back.

---

## Phases

### P0 — Inventory *(read-only, zero risk)*

Walk every zone and produce a real map: file count and total bytes by zone × type × age bucket, how many filenames already parse under the grammar, how many carry an inferable entity, how deep the trees go, how close paths run to the 260-char ceiling, and how many OneDrive files are cloud-only placeholders rather than local.

**Why first:** P3 and P4 cannot be scoped without it. Every number in this roadmap beyond top-level counts is currently unknown.
**Acceptance:** a committed inventory report; every subsequent phase's volume is quoted from it, not estimated.

### P1 — Tooling with rails *(no production moves)*

`scan` → plan JSON · `apply` → executes a plan, writing an NDJSON journal of every `old → new` · `undo` → reverses a journal. Dry-run is the default and `--apply` is explicit.

Rules enforced in code: never descend into `dev\`, `.git`, `node_modules`, `AppData`; never rename inside a git working tree; collision-safe suffixes; skip cloud-only placeholders rather than hydrating them; refuse any move that would exceed the path ceiling.

**Acceptance:** tests pass against a synthetic tree covering collisions, unicode names, already-conforming names, and a full `apply` → `undo` round trip that returns the tree byte-identical.

### P2 — Downloads *(387 files, fully reversible, nothing depends on it)*

Rename in place and bucket by type. **No cross-zone moves yet** — promoting keepers into OneDrive is P3's job, once the taxonomy exists to promote them into.

**Why here:** worst chaos-to-volume ratio on the disk, and the only zone where being wrong costs nothing. This is where the tooling earns trust on real data.
**Acceptance:** every file either conforms or is listed as ambiguous; journal replays clean; Santiago reviews the ambiguous list.

### P3 — Top-level taxonomy *(folders only, dozens of renames)*

Fix the top two levels of WORK and PERSONAL. Folder renames only — the files underneath keep their names until P4.

**Why folders first:** highest ratio of order gained to files touched, and OneDrive re-syncs a folder rename far more cheaply than 129k file renames.
**Blocked on:** the two open decisions below.
**Acceptance:** every top-level folder is in the entity vocabulary or the taxonomy; OneDrive reports sync healthy afterwards.

### ~~P4 — `iagoagency` tail (129k files)~~ — **DELETED by P0**

P0 found the mass was `node_modules`. Only 1,006 of those 129,043 files are real. There is no long haul. See `.iago/research/2026-08-16-filesystem-inventory.md`.

### P3b — Evict code from OneDrive *(the actual prize)*

Seven code projects are living inside OneDrive, outside `dev\`, dragging **148,798 artifact files and 3.01 GB** through continuous sync — 96% of the object count in those zones for none of the value, plus the file-lock stalls `node_modules` causes in a sync root.

Per project: keep → move the source to `dev\`; dead → archive source-only and drop the tree. Artifact directories are regenerable and are the one sanctioned carve-out from quarantine-first deletion, once the source is safe.

**Acceptance:** no `node_modules`, `.venv`, `dist`, `build`, `__pycache__` or `.next` remains under any OneDrive path; every surviving project is in `dev\` and still builds.

**DONE 2026-08-17** — `.iago/summaries/feature-filesystem-order-p3b-evict-code.md`. Source rescued to `dev\_archive\onedrive-20260817\` (1,072 files, git history intact) before anything was deleted; three of the seven had no git remote and existed nowhere else.

### P2b — Reclaim *(deletion — quarantine first, always)*

Added 2026-08-16 at Santiago's request: remove what he never looks at or uses.

**Nothing is ever deleted directly.** Three stages, and stage 3 needs an explicit go each time:

1. **Identify** — candidates only, by deterministic rule.
2. **Quarantine** — move to `_trash\{YYYYMMDD}\`, preserving relative path, journaled like any other move. Fully reversible by `undo`.
3. **Purge** — hard-delete a quarantine batch after a hold period, on Santiago's explicit approval of that batch.

**Auto-quarantine categories** (deterministic, no judgment):

- Byte-identical duplicates — same size *and* same hash, keeping the copy with the shortest path; hashed only for locally-present files, never for cloud placeholders.
- Installers (`.exe`, `.msi`) older than 30 days.
- Archives whose extracted sibling folder exists.
- Partial downloads (`.part`, `.crdownload`, `.tmp`), zero-byte files, empty directories.
- Browser and thumbnail cache artefacts.

**Never auto-quarantine** — these go to a review list Santiago decides on, one by one:

- Anything under `dev\` or inside a git working tree.
- **SAT-relevant records** — invoices, receipts, `iagoag` attachments. Legally retained; renamed and refiled, never removed.
- Anything whose only evidence of being unused is "old". Age alone is not disuse.
- Photos and anything under `Pictures`.

**Acceptance:** a purge cannot happen without a prior quarantine batch and an explicit approval for that batch; `undo` restores a quarantine batch byte-identically.

### P5 — `Documents` (22k) + `Pictures` (1k)

Same machinery, lower stakes than P4. Pictures likely wants date-based foldering rather than per-file renaming.

### P6 — Enforcement *(so it does not rot)*

Scheduled Downloads sweep per the retention rule; `lint-names` run on a schedule reporting drift. Without this, the whole project decays back within months and the work is wasted.

### P7 — Drive workspace

Same grammar, different mechanics — `workspace-mcp` against the Drive API, no local filesystem, different collision and permission semantics. Deliberately last: the convention should be proven locally before it is applied somewhere with sharing links that break.

---

## Hard constraints

1. **`dev\` is rename-frozen.** Claude Code derives project directories from the literal path (`C--Users-sanal-dev-iago-os`). Renaming a repo orphans every session transcript, the per-project memory directory, all worktrees, and the absolute hook paths in `~/.claude/settings.json`.
2. **OneDrive renames are re-uploads** and can drop version history. Batched, journaled, never swept in one pass.
3. **Path length.** 260-char default ceiling; `iagoagency` already runs deep.
4. **SAT-relevant records** (invoices, receipts, `iagoag` attachments) are legally retained — renamed, never deleted, never swept.
5. **Cloud-only files stay cloud-only.** Touching a placeholder forces a download; a naive walk over `iagoagency` could pull gigabytes.

## Open decisions (block P3)

- **`Santiago DoDas`** — the name breaks the standard, but is it referenced by an external share or sync link that would break on rename?
- **`iagoagency` vs `iago`** — the zone root and the entity vocabulary currently disagree.

## Status

| Phase | State |
|---|---|
| Standard | **locked** 2026-08-16 |
| P0 inventory | **done** 2026-08-16 → `.iago/research/2026-08-16-filesystem-inventory.md` |
| P1 tooling | not started |
| P2 Downloads | scoped: 1,648 files / 10.1 GB / 93 dup candidates / 236 older than 3y |
| P2b Reclaim | scoped: artifacts 148,798 files + 502 dup candidates in od-documents |
| P3 taxonomy | blocked on the two open decisions |
| P3b Evict code | **DONE** 2026-08-17 — OneDrive 151,395 -> 3,303 files, 3.02 GB reclaimed, 0 artifacts left |
| P4 | deleted by P0 |
| P5 Documents | 1,381 real files, 36% duplicate rate |
| P6 enforcement / P7 Drive | not scoped |
