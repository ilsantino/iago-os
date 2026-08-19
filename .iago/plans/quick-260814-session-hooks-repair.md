# Quick plan — repair the session-capture hooks

**Date:** 2026-08-14
**Supersedes:** `quick-260812-pattern-harvester.md` (BLOCKED at stress, `wf_da0ecd7d-c9b`) — delete it with its worktree.
**Vehicle:** in-session, sequential. **Not** `/iago-quick`, not the pipeline. Most of the surface is `~/.claude/*` global config, which has no PR, no `tsc`/`vite` build gate, and nothing for a reviewer to diff. The repo half (T5, T6) is small enough to ride one commit.

## Goal

Make the session-capture layer tell the truth about which session it just watched, so the harvest layer above it is worth running. Nothing above the capture layer gets built here — it already exists.

---

## Ground truth (verified 2026-08-14, not inherited)

| Hook | Transcript selection | Transcript parsing | Net effect today |
|---|---|---|---|
| `session-pattern-signals.py` | **broken** — `latest_transcript()` (211-220) mtime-scans every project | **correct** — walks `message.content[]` (121-138) | Queue is live (138 records, written today 12:06) but attributed to whichever transcript was newest at Stop time |
| `session-obsidian.py` | **broken** — `find_latest_transcript()` (28-45), same scan | **broken** — tests top-level `entry["type"]=="tool_use"` (86) and `role=="assistant"` (118) | `total_tool_calls` is always 0 → always `< MIN_TOOL_CALLS` (5) → returns `None` → **no digest has ever been written** |
| `session-diary.py` | **broken** — `find_latest_transcript()` (15-33) | **broken** — same flat shape (57-67) | `extract_summary()` still returns a truthy `SESSION:{date}\|proj:{x}`, so entries **are** written — content-free (no files, no tools) and under the wrong project |

Evidence for the `session-obsidian.py` claim: **no note in the vault carries the hook's own `*Auto-captured by stop hook*` marker.** Every file in `sessions/` is Claude-authored prose in a different frontmatter shape (spot-checked `sessions/2026-08-12-rsf-flow-tool-i1.md`). The hook has produced nothing, ever.

### Four corrections to the 2026-08-12 conclusions

1. **Per-client hook config is not needed.** Global `~/.claude/settings.json` Stop hooks fire in *every* project — the queue already holds `obsidian-brain` and `iago-workspaces` records. Zero Sentria/MUNET/DIN/FullData/RSF signals is the mtime mis-attribution, not missing config. Fixing T2 fixes client capture.
2. **The digest decline (125 → 43 → 6 → 3 per month) was never hook output.** It is the decline of Claude writing digests in-session. This plan adds a floor that never existed; it does not restore something that used to work.
3. **Do not build a harvester.** `pattern-harvest-aggregate.py` (`MIN_SESSIONS=3` OR `MIN_DISTINCT_PROJECTS=2`) plus the `/pattern-harvest` skill are the consumer, installed and tested. The gap is operational — the skill has never been run.
4. **Do not write to `.iago/learnings/patterns.md`.** It is append-only, owned by `scripts/lib/learnings-writer.sh` under `.iago/learnings/.writer-contract.md`, and SDD injects its top-10 rows into every implementation prompt. Recurrence output belongs in Obsidian `brain/patterns/`.

---

## Cleanup (do first)

- `git worktree remove .worktrees/pattern-harvester` + `git branch -D feat/pattern-harvester` — branch sits at `31b76a0` with zero commits; only the superseded plan is untracked inside.
- `rmdir` two stale pipeline locks, both far past the 3h window: `.iago/state/.pipeline.lock.d` (Jun 29, owner `05b-evidence-checker-and-e2e`) and the one inside the harvester worktree (Aug 12).

---

## Tasks

### T1 — Capture a real transcript fixture *(deterministic)*

Copy a real session `.jsonl`, trimmed to ~80 lines and scrubbed of paths/secrets, to `scripts/hooks/fixtures/transcript-nested.jsonl`. Must contain ≥5 nested `tool_use` blocks, ≥1 assistant `text` block, and at least one each of `Edit`, `Write`, `Bash`, `mcp__*`.

**Never hand-author the shape.** The 2026-08-12 plan's fatal move was a test fixture in the obsolete flat form, which would have made a green suite over a parser that cannot read production data.

*Acceptance:* a one-line probe counts ≥5 blocks at `message.content[].type == "tool_use"` in the fixture.

### T2 — Fix transcript selection in all three hooks *(deterministic)*

**Verify the payload key empirically before writing any code:** wire a throwaway Stop hook that dumps raw stdin to a temp file, end a session, read it. Do not assume `transcript_path` exists or is spelled that way.

Then: read stdin once at start, take the transcript path from the payload, and keep the mtime scan **only** as the fallback when stdin is absent or unparseable (manual `--backfill` runs). Stdin parsing must never raise.

Sites: `session-obsidian.py:28`, `session-diary.py:15`, `session-pattern-signals.py:211` (`run_live` only — `--backfill` keeps iterating everything).

*Acceptance:* given a payload naming a transcript that is **not** the newest on disk, all three select the named one; given no stdin, all three fall back to newest without crashing.

### T3 — Fix the schema drift in `session-obsidian.py` + `session-diary.py` *(deterministic)*

Walk `entry["message"]["content"]` when `entry["type"] == "assistant"`; collect `tool_use` blocks (`name`, `input`) and `text` blocks. **Copy the reader `session-pattern-signals.py:121-138` already uses** — do not write a second one.

*Acceptance:* run against the T1 fixture → `total_tool_calls` ≥5, `files_edited`/`files_created` non-empty, `assistant_messages` non-empty, and a digest file actually lands in a temp vault dir.

### T4 — Keep the auto-digest out of the canonical one's way *(rule-based)*

Today `generate_digest_path()` would suffix `-02` next to a rich Claude-written digest, producing a thin near-duplicate. Instead: if a digest for today+project already exists, write to `sessions/_auto/{date}-{project}.md`. The in-session digest stays canonical; the hook is the floor for sessions that end without one. Add a line to `sessions/CONTEXT.md` so `_auto/` is not mistaken for the real thing.

*Acceptance:* with an existing digest present, the auto file lands in `_auto/` and the canonical file is byte-unchanged.

### T5 — Vendor the hooks **and** repoint `settings.json` in the same change *(deterministic)*

`scripts/hooks/{session-obsidian,session-diary,session-pattern-signals}.py` becomes the single source of truth. Rewrite the three `Stop` commands in `~/.claude/settings.json` to those repo absolute paths, then remove the orphaned `~/.claude/scripts/session-*.py`.

Decide and fully execute one option for `pattern-harvest-aggregate.py` + `test-pattern-harvest.py`: leave them in `~/.claude/scripts/` (the `/pattern-harvest` SKILL.md cites those paths) **or** move them and update the skill. No half-move.

Vendoring without the repoint is the whole reason the last plan's Task 2 had zero runtime effect. Edit protected config via Bash redirect, not the env var.

*Acceptance:* `python <repo>/scripts/hooks/session-obsidian.py < payload.json` runs clean; a real session end produces a digest; no unreferenced `session-*.py` left in `~/.claude/scripts/`.

### T6 — Tests + CI registration *(deterministic)*

`scripts/hooks/test-session-hooks.sh` — bash, no npm — fixture-driven, asserting T2/T3/T4. Idempotency asserted against a **frozen** fixture queue via `PATTERN_QUEUE_PATH`; never the live queue, which the Stop hook rewrites on every session end including the one running the tests.

`.github/workflows/validate.yml` enumerates test scripts **by name** — there is no auto-discovery. Add the new script to the `validate-scripts` `bash -n` list *and* give it a run step.

*Acceptance:* green locally and in CI.

### T7 — Run `/pattern-harvest` once, for real *(AI — the genuine 10%)*

After T2 and T5 land: `python scripts/hooks/session-pattern-signals.py --backfill` to re-attribute the 138 queued records, then run the skill. Promote or bump nodes in `brain/patterns/`, update its `CONTEXT.md`.

*Acceptance:* aggregate JSON lists candidates, and every cross-client candidate is dispositioned — promoted, bumped, or skipped with a stated reason.

---

## Out of scope

- Any Node reimplementation of the aggregator.
- Any write to `.iago/learnings/patterns.md`.
- Per-client `.claude/settings.json`.
- The `github` MCP auth failure (`does not support dynamic client registration`) — separate fix.
- The broader "standardize every folder, `.md`, and workflow for harness portability" goal. Capture has to be trustworthy before anything is built on top of it.

## Risks

- **Repo-as-hook-source:** if the checkout is mid-rebase or moved, hooks fail silently (async + timeout). Accepted — they are best-effort. The repoint is per-machine; Sebas's Mac keeps its own `settings.json`, so the Windows-absolute paths must not be committed as a shared assumption.
- **CRLF:** do not assert byte-identical file copies (`core.autocrlf` rewrites on checkout). Compare normalized hashes.
- **Live-queue race:** the Stop hook rewrites `pattern-harvest-queue.ndjson` wholesale on every session end. Any assertion against live state will flake.

## Found during execution — history cannot be re-attributed

Claude Code rotates transcripts. At harvest time there were **37 transcripts on disk against 139 queue records: 119 reference a transcript that no longer exists.** The mis-attribution fix therefore applies going forward only — the evidence needed to re-derive the correct project for the historical records is deleted, so `--backfill` can only rebuild the 37 survivors.

Consequences, all accepted rather than papered over:

- The queue's project column stays 132 × `iago-os`. The two "cross-client" candidates (`obsidian-brain`, `iago-workspaces`) are not clients, so **the harvester cannot yet answer "did I solve this for two clients?"** — that capability starts accruing from today, not retroactively.
- Ghost records are **not** deleted. Their signal slugs are still real historical evidence of recurrence; only their attribution is unverifiable. Deleting them would destroy the only trace of months of sessions to make a column look tidy.
- Worktree folding was added to the aggregator's read path as well as the emitter, since legacy records can never be rewritten by a backfill.
- Follow-up worth considering: have the emitter copy the signal-bearing evidence (not the transcript) into the record, so a rotated transcript no longer takes the evidence with it.
