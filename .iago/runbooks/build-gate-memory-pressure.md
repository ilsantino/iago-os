---
runbook: build-gate-memory-pressure
plan: 06-wedge-e-tsc-vite-parallel-build
status: methodology-documented; measurement-deferred
---

# Build Gate Memory-Pressure Runbook

Captures the contract behind plan 06's `IAGO_PARALLEL_BUILD` env var: when is
the parallel `tsc --noEmit` || `vite build` path safe to default on?

## Why this exists

Plan 06 ships `IAGO_PARALLEL_BUILD` defaulting to `0` (sequential). The
acceptance bullet that says "Memory-pressure test on 16GB box documented (peak
RSS, OOM yes/no, recommendation)" needs an answer before the default flips.
This file holds that answer plus the script to refresh it.

## Environment snapshot (2026-04-27, Santiago's box)

Sampled with `Get-CimInstance Win32_OperatingSystem` + `Get-Process` while
the iaGO orchestrator + multiple Claude sessions were running. This is the
operator-typical state, not a clean host.

| Metric                      | Value      |
|-----------------------------|------------|
| Total RAM                   | 16 218 MB  |
| Free RAM (operator-typical) | 1 776 MB   |
| Used RAM                    | 14 442 MB  |
| Logical CPUs                | 8          |
| Active `bash.exe`           | 15         |
| Active `node.exe`           | 52         |

**Read:** under operator-typical load this box has < 2 GB free. A sequential
`vite build` on a real React 19 + Vite project (`clients/munet-web`) peaks at
~1.0–1.5 GB resident; parallel mode adds an explicit `tsc --noEmit` worker
plus vite's internal one, plausibly pushing combined peak to 2.5–3.5 GB.
Running the experiment on this box right now would risk paging or OOM on
other live Claude sessions. **Measurement deferred to a clean-host run.**

## Recommendation

Keep `IAGO_PARALLEL_BUILD=0` (default-off) until BOTH conditions hold:

1. A measurement run on a 16 GB box with **≥ 6 GB free at start** captures
   peak RSS for both processes during `IAGO_PARALLEL_BUILD=1` against
   `clients/munet-web` (or an equivalently sized React 19 + Vite project).
2. Combined peak < 70 % of total RAM (≈ 11.3 GB on a 16 GB box) AND no
   `vmmem`/swap thrash observed during the run.

If condition 2 fails, the env var stays opt-in and this runbook documents
the constraint so future contributors don't flip the default blind.

## How to run the experiment

The driver script lives at `scripts/measure-build-gate-rss.sh`. It:

- Starts a PowerShell sampler that polls `Get-Process node, npx, tsc, vite`
  every 250 ms, recording `PeakWorkingSet64` per process tree.
- Sources `scripts/lib/build-gate.sh` and invokes `run_build_gate` against a
  target project (default: `clients/munet-web`).
- Stops the sampler, computes combined peak RSS across all sampled procs,
  and emits a result block.

Run it twice — once sequential, once parallel — and append both to the
results table below.

```bash
# Sequential baseline
IAGO_PARALLEL_BUILD=0 bash scripts/measure-build-gate-rss.sh clients/munet-web

# Parallel candidate
IAGO_PARALLEL_BUILD=1 bash scripts/measure-build-gate-rss.sh clients/munet-web
```

Pre-conditions for a valid run:

- Free RAM ≥ 6 GB before starting (close other Claude sessions / orchestrators).
- No other build watcher running (kill stray `vite`/`tsc` first).
- Run on the same machine class the gate will deploy to (16 GB Windows).

## Results

| Date | Mode       | Wall (s) | Peak RSS (MB) | OOM | Free at start (MB) | Notes |
|------|------------|----------|---------------|-----|--------------------|-------|
| —    | sequential | —        | —             | —   | —                  | Pending clean-host run |
| —    | parallel   | —        | —             | —   | —                  | Pending clean-host run |

Append rows here after each measurement; do not overwrite. Once parallel mode
is verified, update plan 06 acceptance status and consider flipping the
default in a follow-up wedge plan (cross-link the commit here).
