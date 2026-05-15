# `.iago/logs/`

Pipeline run logs and debug artifacts. **Gitignored** (`.gitignore` allowlists only this README).

## What lives here

- `pipeline-wedge-*.log` — `scripts/execute-pipeline.sh` stdout/stderr captures from wedge work
- `pipeline-<plan-slug>-<timestamp>.log` — per-plan execution captures
- Any ad-hoc debug log relevant to one execution

## Retention

Local-only. Safe to delete at any time. Pipeline telemetry that needs to survive lives at `.iago/state/pipeline-runs/` (also gitignored) and is queryable via aggregator scripts.

## Why not `.iago/state/`

`.iago/state/` is for session-specific runtime markers, PR-body workarounds, and pipeline-run metadata. `.iago/logs/` is for raw log output. Different lifecycle: state files inform the *next* pipeline run; log files document *prior* runs.
