---
phase: feature-pipeline-speed-wedges
plan: 04
wave: 4
depends_on: ["01-measurement-protocol", "03-wedge-d-review-codex-concurrent"]
context: docs/specs/parallel-execution-wedges.md
created: 2026-04-27
revised: 2026-04-27
source: feature
---

# Plan: feature-pipeline-speed-wedges/04-wedge-c-rev-preflight-during-impl

## Goal

Run I/O-bound prep work concurrently with Step 1 (Implement) so prep latency is removed from the critical path. **Framing: this plan ships preflight infrastructure for Wedge A+ to consume.** Today's actually-consumed output (codex companion path resolution) saves <1 second. The plan/CLAUDE.md snapshots are scaffolding for Wedge A+ teammate prompts. The skeleton justification is the real motivation; the spec's "30s-2min" estimate applies to source-file pre-reads which are deferred to Wedge A+.

## Design decisions (post-revision)

- **Initialize `PREFLIGHT_PID=""` unconditionally** so `set -u` doesn't crash on the wait fence when preflight is disabled.
- **EXIT trap kills preflight before tmp cleanup** — avoids NTFS torn-write on Windows when pipeline aborts mid-impl.
- **Log warning on preflight cache miss** so cache misses are observable.
- **`IAGO_DISABLE_PREFLIGHT` accepts only literal `true`** — explicit comparison.
- **Drop "baseline diff" preflight op** — git range was ambiguous and added no value.
- **`compose_review_checks` exclusion comment uses the real reason** — protects future implementers from mis-reading source code.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `scripts/execute-pipeline.sh` | Launch preflight tasks as background jobs at the start of Step 1 |
| modify | `.claude/rules/execution-pipeline.md` | Note the concurrent preflight in the pipeline diagram |

## Tasks

### Task 1: Document preflight scope (positive list)

- **files:** `scripts/execute-pipeline.sh`
- **action:** Add a comment block at the top of Step 1 listing what preflight ships today:
  ```bash
  # PREFLIGHT-SAFE ops (run concurrent with implement):
  #   1. Resolve $CODEX_COMPANION path (cache to $PIPELINE_TMP/preflight/codex-companion.path)
  #   2. Snapshot CLAUDE.md content (cache to $PIPELINE_TMP/preflight/claude-md.snapshot)
  #   3. Snapshot plan file content (cache to $PIPELINE_TMP/preflight/plan.snapshot)
  #
  # NOT preflight-safe:
  #   compose_review_checks: takes a diff file as input. The diff doesn't exist
  #   until post-impl. Note: today the diff arg is unused (function concatenates
  #   all $CHECKS_DIR/*.md regardless), but diff-driven module selection is
  #   planned. Caching here would mask future correctness.
  #
  # Snapshots 2-3 exist for Wedge A+ teammate prompts; Plan 04 itself only
  # consumes #1 (saves <1 second). The skeleton lands now so Wedge A+ doesn't
  # need to re-architect Step 1.
  ```
- **verify:** `grep -n "PREFLIGHT-SAFE\|compose_review_checks: takes a diff" scripts/execute-pipeline.sh`
- **expected:** Both markers present

### Task 2: Implement preflight launcher

- **files:** `scripts/execute-pipeline.sh`
- **action:** Define `launch_preflight()`:
  ```bash
  PREFLIGHT_PID=""    # initialized unconditionally for set -u safety
  PREFLIGHT_DIR=""

  launch_preflight() {
    [[ "${IAGO_DISABLE_PREFLIGHT:-false}" == "true" ]] && return 0
    PREFLIGHT_DIR="$PIPELINE_TMP/preflight"
    mkdir -p "$PREFLIGHT_DIR" 2>/dev/null || return 0
    (
      # 1. Resolve codex-companion path
      local stable="$HOME/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs"
      if [[ -f "$stable" ]]; then
        echo "$stable" > "$PREFLIGHT_DIR/codex-companion.path"
      else
        local sort_flag="-rV"
        sort -V /dev/null 2>/dev/null || sort_flag="-r"
        for c in $(printf '%s\n' "$HOME"/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs 2>/dev/null | sort "$sort_flag"); do
          [[ -f "$c" ]] && { echo "$c" > "$PREFLIGHT_DIR/codex-companion.path"; break; }
        done
      fi
      # 2. CLAUDE.md snapshot
      [[ -f "$PROJECT_DIR/CLAUDE.md" ]] && cp "$PROJECT_DIR/CLAUDE.md" "$PREFLIGHT_DIR/claude-md.snapshot" 2>/dev/null
      # 3. Plan snapshot
      [[ -f "$PLAN_FILE" ]] && cp "$PLAN_FILE" "$PREFLIGHT_DIR/plan.snapshot" 2>/dev/null
    ) &
    PREFLIGHT_PID=$!
  }
  ```
- **verify:** `grep -n "launch_preflight\|PREFLIGHT_PID=\"\"" scripts/execute-pipeline.sh | head -5`
- **expected:** Both identifiers present (unconditional `PREFLIGHT_PID=""` init + function definition)

### Task 3: Wire launcher into Step 1; safe wait fence

- **files:** `scripts/execute-pipeline.sh`
- **action:** Call `launch_preflight` immediately before the impl `run_claude` invocation (around line 244). After implement completes, fence on preflight with a `set -u`-safe guard:
  ```bash
  if [[ -n "${PREFLIGHT_PID:-}" ]]; then
    wait "$PREFLIGHT_PID" 2>/dev/null || true
  fi
  ```
  This handles both the running-and-finished case and the disabled case (`PREFLIGHT_PID=""` skipped entirely).
- **verify:** `grep -n 'launch_preflight$\|wait "\$PREFLIGHT_PID"' scripts/execute-pipeline.sh`
- **expected:** Both calls present

### Task 4: Use preflight outputs in Step 4 with cache-miss logging

- **files:** `scripts/execute-pipeline.sh`
- **action:** Replace the existing `CODEX_COMPANION` resolution block (lines 561-577) with the cache-first version. **Do NOT use a `# ... existing resolution block (unchanged) ...` placeholder — write the full block inline.** The full replacement:
  ```bash
  CODEX_COMPANION=""
  # Cache hit (preflight)
  if [[ -n "${PREFLIGHT_DIR:-}" && -f "$PREFLIGHT_DIR/codex-companion.path" ]]; then
    CODEX_COMPANION="$(cat "$PREFLIGHT_DIR/codex-companion.path")"
    if [[ ! -f "$CODEX_COMPANION" ]]; then
      log "WARNING: preflight codex-companion.path stale, re-resolving"
      CODEX_COMPANION=""
    fi
  fi
  # Cache miss — fall through to inline resolution
  if [[ -z "$CODEX_COMPANION" ]]; then
    log "WARNING: preflight cache miss for codex-companion.path, resolving inline"
    _companion_stable="$HOME/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs"
    if [[ -f "$_companion_stable" ]]; then
      CODEX_COMPANION="$_companion_stable"
    else
      _sort_version_flag="-rV"
      sort -V /dev/null 2>/dev/null || _sort_version_flag="-r"
      while IFS= read -r _companion_cached; do
        if [[ -f "$_companion_cached" ]]; then
          CODEX_COMPANION="$_companion_cached"
          break
        fi
      done < <(printf '%s\n' "$HOME"/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs | sort "$_sort_version_flag")
    fi
  fi
  ```
  Plan/CLAUDE.md snapshots are not consumed by this plan — they exist for Wedge A+. Don't reference them from Step 3 or Step 4.
- **verify:** `grep -n "preflight/codex-companion.path\|preflight cache miss" scripts/execute-pipeline.sh`
- **expected:** Both patterns present

### Task 5: EXIT trap kills preflight before tmp cleanup

- **files:** `scripts/execute-pipeline.sh`
- **action:** Update the existing trap (line 48) so it kills the preflight subshell BEFORE removing `$PIPELINE_TMP`. This avoids NTFS torn-write when pipeline aborts mid-impl. Move trap registration to AFTER `PREFLIGHT_PID=""` initialization so the variable is always defined:
  ```bash
  trap '
    emit_metrics_safe || true
    [[ -n "${PREFLIGHT_PID:-}" ]] && kill "$PREFLIGHT_PID" 2>/dev/null || true
    rm -rf "$PIPELINE_TMP"
    [[ -n "${LOCK_DIR:-}" && -f "${LOCK_DIR}/pid" && "$(cat "${LOCK_DIR}/pid" 2>/dev/null)" == "$$" ]] && rm -rf "$LOCK_DIR"
  ' EXIT
  ```
  **The trap MUST call `emit_metrics_safe` first** (Plan 01 dependency). Order: emit metrics → kill preflight → rm tmp → release lock. Plan 01's Task 4 defines `emit_metrics_safe`. If Plan 01 hasn't shipped yet, `emit_metrics_safe || true` is a no-op (function not defined — bash logs to stderr but `|| true` keeps trap running).
- **verify:** `grep -n 'kill "\$PREFLIGHT_PID"' scripts/execute-pipeline.sh`
- **expected:** ≥ 1 match in trap body

### Task 6: Add preflight stage to metrics with real exit code

- **files:** `scripts/execute-pipeline.sh`
- **action:** Wrap `launch_preflight` with `stage_start PREFLIGHT` before the call. Capture the preflight exit code via the wait fence:
  ```bash
  PREFLIGHT_EXIT=0
  if [[ -n "${PREFLIGHT_PID:-}" ]]; then
    wait "$PREFLIGHT_PID" 2>/dev/null || PREFLIGHT_EXIT=$?
  fi
  stage_end PREFLIGHT "$PREFLIGHT_EXIT"
  ```
  Pass the actual exit code, NOT a hardcoded `0` — Plan 01 telemetry must reflect real preflight outcomes. Even though the pipeline doesn't abort on preflight failure (the resolution block falls through), the metrics record should distinguish a successful preflight from a silent failure for diagnostic purposes. When `IAGO_DISABLE_PREFLIGHT=true`, call `stage_skip PREFLIGHT` instead.
- **verify:** `grep -n "stage_start PREFLIGHT\|stage_end PREFLIGHT\|stage_skip PREFLIGHT" scripts/execute-pipeline.sh`
- **expected:** All three calls present

### Task 7: Document concurrent prep in pipeline rules

- **files:** `.claude/rules/execution-pipeline.md`
- **action:** Update the pipeline-stages diagram: under Step 1 IMPLEMENT, add a sub-line `(concurrent: PREFLIGHT — companion path, snapshots)`. Add one paragraph: "Preflight runs I/O-bound prep concurrent with implement. Outputs are advisory; consumers fall through to inline resolution on cache miss with a WARNING log. Set `IAGO_DISABLE_PREFLIGHT=true` to skip entirely. Today's saving is sub-second; the skeleton exists for Wedge A+ to extend with source-file pre-reads."
  Use Bash shell-redirect (file is hook-protected).
- **verify:** `grep -n 'PREFLIGHT\|IAGO_DISABLE_PREFLIGHT' .claude/rules/execution-pipeline.md`
- **expected:** ≥ 2 matches

## Stress Test

**Verdict:** PROCEED_WITH_NOTES (revised)
**Date:** 2026-04-27 (re-stress after revision)

Critical findings from the previous round are addressed inline:
- **Trap omitted `emit_metrics_safe`** → fixed in Task 5 (trap now calls `emit_metrics_safe || true` first).
- **Cache-miss fallback used a `# ... existing block ...` placeholder** → fixed in Task 4 (full inline replacement block written out).
- **`stage_end PREFLIGHT 0` hardcoded zero** → fixed in Task 6 (now captures real `PREFLIGHT_EXIT` via the wait fence).

### Important

- **`PREFLIGHT_DIR` global initialization required before trap registration.** Task 2 sets `PREFLIGHT_PID=""` and `PREFLIGHT_DIR=""` at script top; the trap (Task 5) references `PREFLIGHT_PID`. Order matters: declare-then-trap-register, not the reverse.

### Minor

- Skeleton-justification framing is now explicit in the Goal section ("saves <1s today; lays the foundation for Wedge A+"). Honest tradeoff documented.

## Verification

```
grep -q "launch_preflight" scripts/execute-pipeline.sh \
  && grep -q 'PREFLIGHT_PID=""' scripts/execute-pipeline.sh \
  && grep -q "preflight/codex-companion.path" scripts/execute-pipeline.sh \
  && grep -q 'kill "\$PREFLIGHT_PID"' scripts/execute-pipeline.sh \
  && grep -q "stage_start PREFLIGHT" scripts/execute-pipeline.sh \
  && grep -q "PREFLIGHT" .claude/rules/execution-pipeline.md \
  && echo "Plan 04 verified"
```

Expected: `Plan 04 verified`. Field tests (REQUIRED): (a) run with `IAGO_DISABLE_PREFLIGHT=true`; pipeline completes successfully and step 4 falls back to inline companion resolution with a `WARNING: preflight cache miss` log; (b) kill the pipeline mid-impl; confirm no orphaned preflight subshell remains (`ps -ef | grep preflight` shows nothing).
