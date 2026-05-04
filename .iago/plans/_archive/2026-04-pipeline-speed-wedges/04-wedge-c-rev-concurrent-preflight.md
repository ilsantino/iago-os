> ARCHIVED 2026-05-04 — superseded by docs/specs/iago-os-roadmap.md (Wave 1/2 wedge alphabet replaces these execution patterns).

---
plan: 04-wedge-c-rev-concurrent-preflight
phase: feature-pipeline-speed-wedges
status: ready
spec: docs/specs/parallel-execution-wedges.md
wave: 2
depends_on: 01-measurement-protocol
---

# Plan 04 — Wedge C-rev — Concurrent Preflight During Implementation

## Goal

Run cheap read-only preflight checks (lint baseline, dependency audit, schema lints) in a background process while stage 1 IMPLEMENT is running. These checks don't depend on the diff (which doesn't exist yet) but warm caches and surface pre-existing issues that would otherwise interrupt the implementer mid-flight.

## Approach

In `scripts/execute-pipeline.sh`, after stage 0 (stress test) and before stage 1 (IMPLEMENT), spawn a background worker:

```bash
( bash "$SCRIPT_DIR/preflight.sh" --project-dir "$PROJECT_DIR" > "$PIPELINE_TMP/preflight.log" 2>&1 ) &
PREFLIGHT_PID=$!
```

Stage 1 IMPLEMENT runs in the foreground unchanged.

After IMPLEMENT completes (success path), reap the preflight worker:

```bash
wait "$PREFLIGHT_PID" || PREFLIGHT_EXIT=$?
```

If preflight exited with findings (lint failures, dep audit warnings), prepend them to the build-gate stage as advisory notes — they don't block; the build gate still has authority over pass/fail.

`scripts/preflight.sh` runs (when applicable):
- `npx biome check .` — lint baseline (read-only).
- `npm audit --json` — dependency audit.
- For Amplify projects: `amplify schema lint` if available.

All checks read-only. No side effects on the working tree.

## Tasks

1. Create `scripts/preflight.sh` with the three checks above. Each check is wrapped so failure of one does not abort the others; preflight always exits 0 unless catastrophic. Findings are emitted to stdout in a structured format.
2. Modify `scripts/execute-pipeline.sh` to spawn preflight before stage 1 and reap after stage 1.
3. Pass preflight findings to stage 2 BUILD GATE and stage 3 REVIEW as context (advisory only).
4. Telemetry: emit `stage_start preflight` / `stage_end preflight` for the background worker, capturing wall time and finding count.

## Acceptance

- Pipeline run on any plan: preflight log file exists in `$PIPELINE_TMP` after the run.
- A plan that introduces a lint error: review session sees the preflight finding alongside its own findings.
- Preflight failure (e.g., `npm audit` network error) does NOT abort the pipeline — stage 1 IMPLEMENT continues independently.
- Preflight wall time is fully overlapped with stage 1 IMPLEMENT in the telemetry data (preflight ends ≤ implement ends).

## Out of Scope

- Running preflight checks on the post-implementation diff (that's already covered by build gate + review).
- Auto-fixing lint baseline issues — preflight is observational only.

## Stress Test

**VERDICT: PROCEED_WITH_NOTES**

### Important

1. **Concurrent `npm audit` against a mutating `node_modules/`.** IMPLEMENT session can run `npm install` (some plans add deps). `npm audit` reading the same tree concurrently produces corrupt output or wrong exit code. Either skip audit when plan adds deps, or label findings as "may be unreliable during dep-mutation." Pipeline must not abort on audit failure.

2. **Scope bleed into build-gate fix session.** Build-gate fix prompt currently says "edit files to fix the errors below." If preflight findings are prepended raw, the fixer interprets pre-existing lint debt as in-scope errors. Violates CLAUDE.md "only what the plan specifies." Mitigation: label preflight findings explicitly as "pre-existing baseline, not introduced by this plan; do not fix unless overlapping with explicit build errors."

3. **Telemetry in background subshell.** `( bash preflight.sh ) &` does not inherit the parent's run-id state. Plan 01's telemetry helper must be sourced inside `preflight.sh` and `$PIPELINE_RUN_ID` exported as env var from the parent before forking. Document in Task 4.

4. **Acceptance criterion "preflight ends ≤ implement ends" is untestable.** On a fast project with cold network, preflight outlasts IMPLEMENT. Replace with: "preflight log file exists; preflight wall time recorded; pipeline total wall time does not increase relative to plan-01 baseline."

### Minor

5. **Sequential alternative may be sufficient.** Running preflight before stage 1 (no parallelism) costs ~30-60s but eliminates concurrent-edit hazards entirely. Without plan-01 baseline showing IMPLEMENT > 60s on representative plans, the parallelism complexity is unjustified. Implementers should defer this plan until plan-01 data justifies it.

6. **`amplify schema lint` detection unspecified.** Plan says "if available" — define detection (which command, exit codes for not-found vs error).

7. **Structured output format for preflight findings undefined.** Two implementers will write different formats; downstream consumers parse differently.
