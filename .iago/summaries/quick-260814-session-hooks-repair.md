# Summary — session-capture hook repair

**Plan:** `.iago/plans/quick-260814-session-hooks-repair.md`
**PR:** [#101](https://github.com/ilsantino/iago-os/pull/101) — `fix/session-capture-hooks`
**Vehicle:** in-session, sequential. No pipeline (the surface is mostly `~/.claude/*` global config, which has no PR, no build gate, and nothing for a reviewer to diff).
**Date:** 2026-08-16

## What shipped

| Task | Outcome |
|---|---|
| Cleanup | `.worktrees/pattern-harvester` + empty `feat/pattern-harvester` removed; two stale pipeline locks (Jun 29, Aug 12) cleared |
| T1 fixture | `scripts/hooks/fixtures/transcript-nested.jsonl` — 46 entries, 10 nested `tool_use`, captured from real transcripts and scrubbed |
| T2 selection | All three hooks take `transcript_path` from the Stop payload; mtime scan demoted to no-stdin fallback |
| T3 schema | `session-obsidian.py` + `session-diary.py` read `message.content[]` via the shared reader the signals emitter already used |
| T4 placement | One auto-digest per day+project, rewritten in place; diverts to `sessions/_auto/` when a hand-written digest exists |
| T5 vendor | Hooks live in `scripts/hooks/`; `~/.claude/settings.json` points at them; global copies deleted; `setup-memory.sh` no longer reinstalls the broken template |
| T6 tests | 17 behavioral assertions + the existing aggregator suite, both wired into `validate-scripts` |
| T7 harvest | Backfill re-attributed the surviving transcripts; 18 candidates; 3 promoted to `brain/patterns/` |

Also fixed: `.iago/hooks/lib/transcript.mjs` carried both defects, so `context-persistence.mjs` had been snapshotting zero decisions and zero files on every compaction. Verified against the fixture: 0 → 2 files, 0 → 2 decisions.

## Evidence the fix was real

- **Red state:** the fixture holds 10 nested `tool_use` blocks and **0** top-level ones. The old parser counted top-level only, so `total_tool_calls` was always 0, always below `MIN_TOOL_CALLS = 5`, and `extract_session_data()` always returned `None`.
- **Corroboration:** no note anywhere in the vault carries the hook's own `*Auto-captured by stop hook*` marker. `session-obsidian.py` never wrote a single digest in its lifetime — the 125 → 43 → 6 → 3 per-month decline was Claude writing digests by hand, never hook output.

## Four inherited conclusions overturned

The 2026-08-12 session's diagnosis was checked rather than trusted, and most of it did not survive:

1. **Per-client hook config was never needed.** Global `settings.json` Stop hooks fire in every project — the queue already held `obsidian-brain` and `iago-workspaces` records. Zero client signals was the mtime mis-attribution alone.
2. **The digest decline was never hook output** (above). The fix adds a floor that never existed rather than restoring something that worked.
3. **`session-pattern-signals.py`'s parser was already correct** — only its selection was broken. T3 became "copy the working reader," not "write a parser."
4. **`session-diary.py` was writing entries**, just content-free ones: `SESSION:{date}|proj:{x}` and nothing else, under the wrong project.

## Found during execution — history cannot be re-attributed

Claude Code rotates transcripts. At harvest time: **37 transcripts on disk, 139 queue records, 119 pointing at a file that no longer exists.** The correct project for those records cannot be re-derived, so the fix applies going forward only.

- The queue stays 132 × `iago-os`. Both "cross-client" candidates (`obsidian-brain`, `iago-workspaces`) are not clients — **the harvester cannot yet answer "did I solve this for two clients?"**. That capability starts accruing now.
- Ghost records were kept, not pruned: their signal slugs are real evidence of recurrence; only the attribution is unverifiable.
- Worktree folding was therefore added to the aggregator's read path as well as the emitter.
- Worth considering next: have the emitter store the signal-bearing evidence in the record, so a rotated transcript stops taking the evidence with it.

## Harvest (T7)

Promoted to `brain/patterns/`, hub updated:

- `recover-workflow-verdict` — orchestrator dies mid-workflow → read the verdict from `journal.jsonl`, never re-run the stage
- `stress-test-plan` — adversarial pass over the plan document; bad plans fail on false premises, not on execution
- `survive-format-hook` — the post-edit formatter rewrites files after the tool returns; verify the committed tree

Skipped with reason: `idempotency-guard`, `optimistic-locking`, `dynamodb-single-table`, `hmac-signing`, `destructive-confirm-ux`, `security-pentest`, `preview-mode-auth-bypass`, `basic-auth-gate`, `acceptance-evidence`, `sync-before-work` — these are domain topics from Sentria/MUNET feature work rather than reusable execution shapes, and their transcripts are gone, so no evidence could be cited. Bumps deferred for the five signals that already have nodes; nothing new was learned about them this round.

## Out of scope, still open

- `github` MCP failing: `does not support dynamic client registration`
- The broader "standardize every folder, `.md`, and workflow for harness portability" goal
