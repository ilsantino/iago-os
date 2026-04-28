# Parallel Execution Wedges — iaGO Pipeline Speed

**Status:** Draft, reconstructed 2026-04-27 from `sessions/2026-04-27-iago-os-pipeline-speed.md` (Obsidian)
**Owner:** Santiago (CEO), iago-os core
**Constraint:** Never sacrifice quality for speed. Every wedge must be quality-preserving or quality-improving.

## Problem

`scripts/execute-pipeline.sh` is fully sequential: stress → impl → build → review → codex → fix → PR. End-to-end wall time is 25-50 min per plan, dominated by long `claude -p` sessions in stages 1, 3, 4, 4b. Multi-plan phases multiply this. We have no measurements of where the time actually goes.

## Approach

Five parallelization wedges, all preserving the existing review/build/codex quality gates. Plus a measurement protocol (plan 01) shipped first standalone — telemetry data drives wave-2 priorities.

Two parallelism primitives in play:
- **Shell-level concurrent** — bash `&` + `wait`. Used when both branches are read-only on the same diff (Review + Codex) or independent processes (tsc + vite). No coordination needed.
- **Anthropic agent teams** — `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, in-process mode (Windows-compatible; split-pane display is a separate Windows-broken thing). Used when teammates need real-time mailbox messaging for seam findings or file-ownership coordination.

`claude-peers-mcp` was evaluated and **cut permanently**. Anthropic's agent-teams provides the same primitive officially without the three Windows blockers (broker startup, SQLite locks, repo-scope worktree handling).

## Plans

| # | Plan | Wedge | Wave | Path |
|---|------|-------|------|------|
| 01 | measurement-protocol | — | 1 (ship first) | `.iago/plans/feature-pipeline-speed-wedges/01-measurement-protocol.md` |
| 02 | wedge-a-plus-review-fanout | A+ | 2 (deferred) | `.iago/plans/feature-pipeline-speed-wedges/_deferred/02-...md` |
| 03 | wedge-b-revived-multi-plan-parallel | B-rev | 2 (deferred) | `.iago/plans/feature-pipeline-speed-wedges/_deferred/03-...md` |
| 04 | wedge-c-rev-concurrent-preflight | C-rev | 2 (deferred) | `.iago/plans/feature-pipeline-speed-wedges/_deferred/04-...md` |
| 05 | wedge-d-review-codex-concurrent | D | 2 (deferred) | `.iago/plans/feature-pipeline-speed-wedges/_deferred/05-...md` |
| 06 | wedge-e-tsc-vite-parallel-build | E | 2 (deferred) | `.iago/plans/feature-pipeline-speed-wedges/_deferred/06-...md` |

Plan 01 ships standalone via `/iago-execute --plan 01-measurement-protocol`. Wave-2 plans are intentionally placed under `_deferred/` so `/iago-execute feature-pipeline-speed-wedges` (without `--plan`) does NOT auto-load them — the skill globs `feature-{slug}/*.md` non-recursively. Two of the wave-2 plans (02 and 05) carry `VERDICT: BLOCK` from stress testing and must be revised before they're moved back. After plan 01 merges, run `node scripts/metrics-aggregate.mjs --last 5` for a baseline; wave-2 priority is set from that data.

## Plan 01 — Measurement Protocol

**Goal:** Per-stage telemetry on every pipeline run. Never zero data; trap-emit final record even on failure.

**Adds:**
- `scripts/lib/pipeline-telemetry.sh` — sourced helpers: `stage_start`, `stage_end`, `pipeline_init`, `pipeline_finalize`. Emits NDJSON records to `.iago/state/pipeline-runs/{run-id}.ndjson`.
- `scripts/metrics-aggregate.mjs` — Node script. `--last N` reads the N most-recent run files (filter complete-records → sort by timestamp → take last N), prints mean/p50/p95 stage durations + timeout-hit rate.
- Hooks in `scripts/execute-pipeline.sh`:
  - `PIPELINE_STARTED` flag set immediately after argument parsing, BEFORE any `log` or `stage_start` call.
  - `pipeline_init` call right after `PIPELINE_STARTED=true`.
  - `stage_start <name>` / `stage_end <name>` wrapping each labeled stage (STRESS TEST, IMPLEMENT, BUILD GATE, CONSOLE GATE, REVIEW, CODEX REVIEW, CODEX FIX, CREATE PR, TAG, SUMMARY).
  - Trap `EXIT` calls `pipeline_finalize` with the captured `$?` value as `pipeline_exit`. On normal exit pipeline_exit=0; on any failure pipeline_exit≠0. The existing trap on line 48 must be extended (do not replace — it cleans `PIPELINE_TMP` and `LOCK_DIR`).
- `run_claude` timeout signaling: when `taskkill` fires (line 105-114), set `LAST_RUN_TIMED_OUT=true` global before returning. Caller stages (IMPLEMENT, REVIEW, CODEX) read this flag in their `stage_end` call to record `timed_out:true`. Reset to `false` at every `stage_start`. This is needed because `run_claude` is called synchronously via `$(run_claude ...)` for those stages — the parent shell sees only the subshell return code, not internal state.

**Acceptance:**
- Real run: every labeled stage produces one `stage_start` + matching `stage_end` record; `pipeline_finalize` writes a single closing record with `pipeline_exit:0`.
- Failure run: artificial build failure (e.g., temporary `tsc --noEmit` syntax error in a fixture file) — trap-emitted closing record exists with `pipeline_exit:1`; partial stage records present for stages that ran.
- Timeout run: a stage hits `run_claude` timeout — its `stage_end` record contains `timed_out:true`.
- `node scripts/metrics-aggregate.mjs --last 5` over 5 runs prints stage table with p50/p95 columns and timeout-hit count per stage. Order: filter (only complete `pipeline_finalize` records) → sort by start-timestamp ascending → take last N.
- No regression: existing pipeline behavior unchanged (same exit codes, same artifacts in `.iago/summaries/`).

**Out of scope:**
- No dashboard. Stdout table from aggregator is enough for wave-2 priority decisions.
- No alerting. Manual run when wanted.

## Plans 02–06 — Brief Specs

### Plan 02 — Wedge A+ (review fan-out)

Stage 3 review currently makes one opus session do plan-compliance + domain routing + adversarial in one shot. Often hits 900s. Split into 3 lens teammates in parallel under agent-teams mailbox: (1) plan-compliance, (2) domain-routing, (3) adversarial cross-cutting. Real-time seam coordination via mailbox (e.g., `[lens-3] auth bypass at line 84 — investigate rate-limiting seam` → `[lens-2] api domain confirms rate-limit at handler.ts:42`). Synthesis pass merges findings.

**Fallback:** if `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` not set or unavailable, fan out shell-level (3 concurrent `claude -p` sessions sharing checks file), then run a synthesis pass that resolves duplicate findings. Both code paths maintained — pruning decision deferred until agent-teams is GA.

### Plan 03 — Wedge B-revived (multi-plan parallel)

When `/iago-execute` runs N plans for a phase, currently sequential. With agent-teams + mailbox, run plans concurrently: each teammate is one plan, mailbox announces file ownership ("teammate B claims `package.json`"), conflicts resolved by lead-elected order. Each plan still gets its own full pipeline. Requires per-plan worktrees (already supported via `iago-wt` shell helper).

### Plan 04 — Wedge C-rev (concurrent preflight)

While stage 1 IMPLEMENT runs, run preflight read-only checks in parallel: lint baseline, dependency audit, schema lints. Free I/O parallelism — these don't read the diff (which doesn't exist yet) but can warm caches and surface pre-existing issues that would otherwise interrupt the implementer.

### Plan 05 — Wedge D (Review || Codex concurrent)

Stages 3 (REVIEW) and 4 (CODEX REVIEW) both read-only on the same diff. Run them shell-level concurrent with `&` + `wait`. No coordination — they produce separate findings files; the existing fix-loop logic handles each. No agent-teams needed.

### Plan 06 — Wedge E (tsc || vite parallel build)

`run_build_gate` runs `tsc --noEmit` then `vite build`. Vite already runs its own internal tsc; running them concurrently shaves the tsc-only time. Risk: two TS processes contend for memory on smaller Windows machines. Acceptance must include a memory-pressure run on a 16GB box before shipping.

## Quality Gates Preserved

| Gate | Plan touches it? | How |
|------|-----------------|-----|
| Stress test (step 0) | No | unchanged |
| Build gate (step 2) | Plan 06 only | parallelize, both must still pass |
| Console gate (step 2b) | No | unchanged |
| Review (step 3) | Plan 02 | fan-out + synthesis preserves all checks |
| Codex (step 4) | Plan 05 | run concurrent with review, same Codex |
| Codex fix (step 4b) | No | unchanged |
| PR + tag (steps 5, 5b) | No | unchanged |

## Open Questions Deferred to Wave 2

1. Mailbox protocol message types for A+ (5-10 max) — define before plan 02 implementation.
2. B-revived queue-write conflict resolution: wait / propose-alternate / escalate-to-lead.
3. Wedge E memory-pressure verification on 16GB Windows.
4. Fork-and-join vs agent-teams: maintain both indefinitely or prune one once agent-teams is GA.

## Implementation Order

Wave 1 (now): plan 01 only. Ship, merge, capture baseline (`metrics-aggregate.mjs --last 5`).

Wave 2 (after baseline): pick highest-impact wedge from data. Hypothesis: D (Review || Codex) is biggest single win (saves ~600s per run with zero new failure modes). A+ second if review timeouts >30%.
