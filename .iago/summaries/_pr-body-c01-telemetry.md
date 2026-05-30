## What this does

Adds a synthetic per-pipeline `CLAUDE_CODE_SESSION_ID` fallback (generated in **parent shell scope** by `pipeline_init`) so every NDJSON telemetry record carries a non-empty `sessionId` even when the pipeline runs without an inherited Claude Code session. Also ships the `.iago/learnings/` write-path contract + helper that lets review-fix sessions persist short pattern notes for later promotion to CLAUDE.md.

## Why

Codex review caught a real bug during this plan's own pipeline run: the prior synthesis lived inside `run_claude`, which is called as `$(cd … && run_claude …)` — a subshell. An export inside the subshell never reaches the parent shell, so `stage_end` and `pipeline_finalize` emissions silently wrote `sessionId:""` into the NDJSON. Downstream aggregators (per-session rollups, recovery correlation) become untrustworthy. The fix moves synthesis to `pipeline_init` (parent scope), which guarantees every record sees the same id.

## What changed

- `scripts/lib/pipeline-telemetry.sh` — `pipeline_init` now synthesizes a `claude-{RUN_ID}-{ms}-{rand}` fallback in parent scope when env-unset, then captures it into `RUN_SESSION_ID`. Preserves real inherited `CLAUDE_CODE_SESSION_ID` unchanged.
- `scripts/lib/pipeline-telemetry.test.sh` — Test 6 rewritten: was "asserts sessionId empty when env unset" (the buggy old behavior); now asserts the parent-synth fallback is present, non-empty, matches `claude-YYYYMMDD-HHMMSS-…`, and appears on stage_start + stage_end + pipeline_finalize (≥3 records).
- `scripts/lib/learnings-writer.sh` (+ `.test.sh`) — small helper that lets review/codex-fix sessions append structured learnings notes; gated by a writer-contract markdown at `.iago/learnings/.writer-contract.md`.
- `scripts/execute-pipeline.sh` — wires the learnings writer into pipeline stage boundaries.
- `scripts/metrics-aggregate.mjs` — extended to project session-id-keyed rollups now that the id is guaranteed non-empty.
- `scripts/test-pipeline-helpers.sh` — added coverage for the new path.
- `.gitignore` — ignore the per-run NDJSON output dir.

## Verify

```bash
bash scripts/lib/pipeline-telemetry.test.sh  # 16/16 pass including the new regression
bash scripts/lib/learnings-writer.test.sh    # learnings writer tests
bash scripts/test-pipeline-helpers.sh        # broader helper suite
```

## Codex review history

- Round 1 (original pipeline run on this plan): flagged the subshell-scope bug as `[medium]`. The codex-fix session was tree-killed at the 900s timeout before applying the fix; this PR ships the manual fix landed against the exact recommendation in that review.
- Test 6's inversion (empty-string assertion → claude-* presence assertion) is the regression test Codex explicitly asked for ("add an integration test that verifies the NDJSON stage record, not only the child claude process environment").
