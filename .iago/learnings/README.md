# `.iago/learnings/`

Curated patterns + project conventions surfaced from pipeline reviews,
post-mortems, and execution sessions. Promoted to `CLAUDE.md` once a pattern
hits 5+ occurrences (per `CLAUDE.md` § Learnings).

This directory exists so reviewers + the orchestrator have a shared place to
record "we hit this before — here's how to handle it" without polluting the
top-level `CLAUDE.md` until the pattern earns its keep.

Implementation details for the writer live in `.writer-contract.md` (dotfile,
hidden by default). This README is the user-facing overview; that contract
is the authoritative source-of-truth for `scripts/lib/learnings-writer.sh`.

## Files

| File | Purpose |
|------|---------|
| `patterns.md` | Append-only catalog of review patterns + per-pattern occurrence rows |
| `project-conventions.md` | Project-specific conventions injected into agent context (300-token cap) |
| `.writer-contract.md` | Hidden — technical contract for implementers of the writer helper |
| `README.md` | This file — user-facing overview, fail-mode matrix, env-var reference |

## Writing entries

### Manual

Append a section to `patterns.md`:

```markdown
## 2026-05-17T03:00:00Z — pattern-key

Body text. Why it matters. What to do next time.
```

### Scripted (preferred — fail-loud)

```bash
. scripts/lib/learnings-writer.sh
PROJECT_DIR=$(pwd) learnings_write "pattern-key" "$markdown_body"
```

The scripted path is preferred because it (a) emits NDJSON telemetry events,
(b) fails loudly on write errors instead of silently dropping the entry, and
(c) has an opt-in fallback path for sandboxed reviewers.

## Fail modes

The writer reads its behavior from three env vars. Defaults are designed for
the iaGO pipeline (Garry-impressed completeness standard — silent failure is
the bug).

| Env var | Default | Effect |
|---------|---------|--------|
| `LEARNINGS_WRITE_MODE` | `fail-loud` | `fail-loud` → return 1 + stderr + telemetry `learnings_write_failed` event on any write error. `fallback` → if primary write fails, write to `LEARNINGS_FALLBACK_DIR/learnings-fallback-{ts}-{pid}.md` and return 0. |
| `LEARNINGS_FALLBACK_DIR` | `$PROJECT_DIR/.iago/logs` | Where fallback writes land. Files are gitignored under the standard `.iago/state/` + `.iago/logs/` rules. |
| `PROJECT_DIR` | `.` (current dir) | Derives `$PROJECT_DIR/.iago/learnings/patterns.md` as the primary target. Always set this explicitly when calling from automation. |

### Return codes

| Code | Meaning |
|------|---------|
| 0    | Primary write succeeded, OR fallback write succeeded (mode=fallback). |
| 1    | Fail-loud mode and the write failed; OR both primary + fallback failed. |
| 64   | Usage error (missing args). |

## Telemetry events

When the caller has sourced `scripts/lib/pipeline-telemetry.sh` and `RUN_FILE`
is set + writable, the writer appends one NDJSON record per call:

```jsonc
{"type":"learnings_written","key":"pattern-key","path":"<target>","mode":"fail-loud","err":"","ts":"<iso>","sessionId":"..."}
{"type":"learnings_write_failed","key":"pattern-key","path":"<target>","mode":"fail-loud","err":"<stderr>","ts":"<iso>","sessionId":"..."}
{"type":"learnings_written_to_fallback","key":"pattern-key","path":"<fb-path>","mode":"fallback","err":"<primary err>","ts":"<iso>","sessionId":"..."}
```

`sessionId` carries `$CLAUDE_CODE_SESSION_ID` read at emission time — same
contract as the rest of `scripts/lib/pipeline-telemetry.sh`. Aggregator
projects these events into the `by_session` table emitted by
`scripts/metrics-aggregate.mjs` (Plan 03 Task 2).

## Promotion to CLAUDE.md

Per `CLAUDE.md` § Learnings: a pattern earns CLAUDE.md status once it has
been observed **5 or more times** across review sessions.

Procedure:

1. Reviewer counts occurrences in `patterns.md` (manual `grep -c` against
   the pattern-key heading).
2. At ≥5, reviewer opens a draft CLAUDE.md edit promoting the rule and links
   the patterns.md anchor in the PR body.
3. Santiago reviews + approves the CLAUDE.md addition. Promotion is never
   automatic — the bar for adding to always-loaded context is intentionally
   high (every CLAUDE.md line costs context budget on every session).
4. After merge, the patterns.md rows stay (they're history); the new
   CLAUDE.md rule supersedes them as the active guidance.

## See also

- `scripts/lib/learnings-writer.sh` — the writer helper itself
- `scripts/lib/learnings-writer.test.sh` — happy + sad + edge path coverage
- `.writer-contract.md` — technical contract (dotfile, in this directory)
- `scripts/lib/pipeline-telemetry.sh` — telemetry helper sourced alongside
- `scripts/metrics-aggregate.mjs` — downstream consumer of the events
