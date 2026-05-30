# runtime/ — iaGO-OS v2 Daemon Sub-Workspace

This is a Level B MWP sub-workspace inside the iaGO-OS repo. The root workspace is at `../`. Open root `CLAUDE.md` for global iaGO-OS rules; this file scopes context to v2 daemon work only.

## Layer routing

| Layer | Location | Role |
|---|---|---|
| L0 | `runtime/CLAUDE.md` (this file) | sub-workspace declaration |
| L1 | `../.iago/CONTEXT.md` | workspace routing — runtime/ registered as Level B sub-workspace there |
| L2 | `runtime/CONTEXT.md` | v2 daemon stage contract: Inputs / Process / Outputs |
| L3 | `../docs/specs/iago-os-v2-vision.md` | active spec |
| L4 | `runtime/migration/`, `runtime/agents/`, `runtime/daemon/`, `runtime/deploy/` | per-phase product |

## When working in this sub-workspace

1. Plans live at `../.iago/plans/feature-v2-*` and `feature-phase-*`, not under `runtime/`.
2. Summaries live at `../.iago/summaries/`.
3. v2 build follows root `CLAUDE.md` execution-pipeline rules unchanged.

## Status

See `runtime/PHASE-1-EVIDENCE.md` for current phase evidence and `../.iago/STATE.md` for the active status digest.
