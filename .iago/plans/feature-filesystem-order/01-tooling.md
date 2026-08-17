# P1 — Tooling with rails

**Feature:** `.iago/plans/feature-filesystem-order/`
**Risk:** none in this phase. Dry-run is the default; `--apply` is explicit. No production tree is touched by P1 itself — P1 only builds the instrument that P2 will point at Downloads.
**Layer:** 60 — deterministic. Name derivation is pure string work over `stat()` metadata. No LLM in the loop; the AI 10% is the ambiguous-tail review in P2, not this.

## Why this exists

P2 renames 1,648 files in one pass. Doing that with `ren` in a loop is a one-way door: no record of what the old name was, no way back, and the first collision silently clobbers a file. Every phase after P2 is larger. The instrument has to be trustworthy before it is pointed at anything.

The failure this is designed against: a bulk rename that half-completes, leaving a tree where nobody can tell which files were touched.

## Deliverable

`scripts/organize/organize.py` — four subcommands.

| Command | Does | Default |
|---|---|---|
| `scan` | walks a root, derives a proposed name per file, writes a plan JSON | read-only always |
| `apply` | executes a plan, writing an NDJSON journal of every move actually made | **dry-run**; needs `--apply` |
| `undo` | reverses a journal, newest op first | **dry-run**; needs `--apply` |
| `lint` | reports non-conforming names, exits non-zero if any | read-only always |

### Name derivation — information-preserving

The tool **never invents a descriptor.** The original stem is normalised, not replaced:

```
Presentación FINAL v2 (1).pptx   →   20250301-misc-presentacion-final-v2.pptx
```

Date, entity and version are *extracted and repositioned*; everything left over becomes the descriptor, slugified. This makes every rename semantically reversible by eye, not just by journal — which matters when Santiago reviews 1,648 rows.

- **Date** — from the filename if one parses there, else file mtime. `dd-mm-yyyy` is accepted only when the day is >12 and therefore unambiguous; otherwise the tool falls back to mtime rather than guessing between day-first and month-first.
- **Entity** — a token from the §4 vocabulary found in the stem, else in the path, else the sentinel `misc`. `misc` is not a failure; it is an honest label that still sorts and still lints.
- **Version** — a standalone `v{N}` token moved to the suffix. `final`, `def`, `copia` are **kept in the descriptor**, never silently dropped: they are information, and deciding they mean "v2" is a judgment call a script may not make.
- **Confidence** — `high` (date and entity both from the filename), `medium` (one derived), `low` (`misc` entity, or a degenerate stem like `img-1234` / `documento-sin-titulo`). The `low` set is P2's review list.

### Rails enforced in code, not in the prompt

1. **`dev\` is refused outright** — rename-frozen; renaming a repo orphans transcripts, memory dirs, worktrees and hook paths.
2. **Never rename inside a git working tree** — walks up from each file looking for `.git`, result cached per directory.
3. **Skip** `.git`, `node_modules`, `AppData`, `$Recycle.Bin`, `.venv`, `__pycache__`, `OneDrive - Rennes School of Business` (separate tenant).
4. **Cloud-only placeholders are skipped, never hydrated** — attribute-bit check, same as P0. A rename would force a download.
5. **Collision-safe** — `-2`, `-3` suffixes, resolved both against the existing tree *and* against other targets in the same plan. Re-checked at apply time, because the tree can change between scan and apply; the journal records the name actually used, so the journal — not the plan — is the source of truth for undo.
6. **Path ceiling** — any target resolving past 255 chars is refused, not truncated.
7. **Case-only renames go through a temp name** — NTFS is case-insensitive, so `Foo.txt` → `foo.txt` is a two-step or it fails.
8. **Windows reserved names** (`CON`, `NUL`, `COM1`…) and trailing dots/spaces are refused.
9. **Staleness check** — an op is skipped if the file's size or mtime changed since the scan. Never rename something that moved under you.
10. **Journal is flushed and fsynced per line** — a crash mid-run leaves a complete record of everything done up to that point, which is exactly when the record matters most.

Plans and journals go to `.local/organize/` — untracked, machine-specific, and on disk where `undo` can find them.

## Acceptance

Tests in `scripts/organize/test-organize.py`, no deps, run directly, exit 0 = pass:

1. Date from filename; date from mtime fallback; ambiguous `dd-mm-yyyy` falls back rather than guessing.
2. Entity from stem; entity from path; `misc` sentinel with `low` confidence.
3. Accents and unicode normalise to ascii kebab.
4. An already-conforming name produces no op — including the legal undated form.
5. Two distinct files deriving the same target get `-2`; the original is untouched.
6. Case-only rename completes.
7. A target past the path ceiling is refused, and a Windows reserved name is refused.
8. A file inside a git working tree is skipped; `dev\` is refused.
9. Placeholder attribute logic returns true for each of the three OneDrive bits.
10. Dry-run leaves the tree byte-identical.
11. A file modified between scan and apply is skipped as stale.
12. **`apply` → `undo` returns the tree byte-identical** — full manifest of relpath → sha256, plus the directory set, compared before and after.

Test 12 is the one that matters. Everything else is a detail; that one is the reason the phase exists.

## Out of scope

Deletion of any kind — that is P2b, quarantine-first. Cross-zone moves — that is P3, once there is a taxonomy to move things into. Any run against a real zone — that is P2.
