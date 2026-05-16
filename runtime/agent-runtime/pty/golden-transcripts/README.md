# Golden transcripts — Shape 1 PTY Claude adapter

These captures freeze the exact stdout/stderr/exit byte sequences that
`prompt-parser.ts` matches against. Treat them as the load-bearing
artifact behind the fail-closed parse policy: if the patterns in
`prompt-parser.ts` ever drift from what Claude Code actually emits, the
adapter MUST detect it via the conformance tests and refuse to ship
rather than guess at runtime.

A capture is one canonical PTY interaction with the pinned Claude Code
version (see `../version-pin.ts` → `SUPPORTED_CLAUDE_CODE_VERSION_RANGE`).
Three captures live here:

| File | Scenario | Why |
|---|---|---|
| `claude-code-running.jsonl` | Spawn `claude`, send a prompt that triggers a tool call, capture ~3s of output | Anchors the `running` pattern |
| `claude-code-idle.jsonl` | Spawn `claude`, observe the initial idle prompt with no input, ~1s | Anchors the `idle` pattern |
| `claude-code-exited.jsonl` | Spawn `claude`, send `/exit` (or the canonical exit command for the pinned version), capture until the exit code event | Anchors the `exited` pattern |

## Format

Each `.jsonl` file is a sequence of newline-delimited JSON objects:

```json
{ "at": 0, "kind": "stdout", "data": "...\u001b[32m> \u001b[0m" }
{ "at": 142, "kind": "stdout", "data": "Human: " }
{ "at": 1820, "kind": "exit", "data": 0 }
```

| Field | Type | Meaning |
|---|---|---|
| `at` | number (ms) | Wall-clock offset since the spawn started; first event is 0 |
| `kind` | `"stdout" \| "stderr" \| "exit"` | Event class |
| `data` | string \| number | UTF-8 string for stdout/stderr; numeric exit code for `exit` |

Format invariants:

- One event per line. No trailing comma.
- `at` monotonically non-decreasing.
- A capture ends with exactly one `exit` event when the subprocess
  terminated. Captures that intentionally stop earlier (e.g., the `idle`
  scenario, where we kill the PTY after observing the prompt) MAY omit the
  trailing `exit` event — the parser tests treat the lack of an `exit`
  line as "still alive at end of capture".
- ANSI escape codes are preserved verbatim; Claude Code emits them and the
  parser matches against the rendered byte stream.

## Capture procedure

The captures are produced by `capture.sh` co-located in this directory.
It is a thin bash script wrapping `script` (Linux/macOS) or PowerShell
`Start-Transcript` (Windows fallback) and emitting the JSONL shape above.

```bash
# Linux / macOS / WSL
./capture.sh running ~/path/to/cwd "Read README.md"
./capture.sh idle ~/path/to/cwd
./capture.sh exited ~/path/to/cwd

# Windows PowerShell (run from this directory)
pwsh ./capture.ps1 running C:\path\to\cwd "Read README.md"
```

The script writes to `claude-code-<scenario>.jsonl`. Commit the resulting
files. Re-capture is a manual one-shot per supported Claude Code version
range — do NOT regenerate on every CI run.

## Placeholder policy

The three `.jsonl` files MAY ship empty in the initial PR if Santiago has
not captured against the pinned version yet. The test suite handles this
via `it.skipIf(!hasContent("claude-code-<scenario>.jsonl"))` — empty
transcripts skip the golden-vs-parser tests but do NOT fail the build.
The parser branches are still covered by the synthetic inline fixtures in
`prompt-parser.test.ts` so the 80% line-coverage floor holds either way.

When transcripts are populated, the matching parser tests start running
automatically; if a pattern in `prompt-parser.ts` no longer matches its
golden file, the test suite will surface the regression before the PR
merges.

## Re-capture command

```bash
# from this directory
./capture.sh running ~/dev/iago-os "Read package.json"
./capture.sh idle ~/dev/iago-os
./capture.sh exited ~/dev/iago-os
```

Bump `SUPPORTED_CLAUDE_CODE_VERSION_RANGE` in `../version-pin.ts` AFTER
recapture lands and the conformance tests pass against the new
transcripts.
