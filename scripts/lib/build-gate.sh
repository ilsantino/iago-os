#!/usr/bin/env bash
# Build gate helper — sourced by execute-pipeline.sh.
# Runs `tsc --noEmit` and `vite build` either sequentially (default) or in
# parallel (when IAGO_PARALLEL_BUILD=1).
#
# Bash floor: 5.1+ — multi-process `wait` semantics relied on by the parallel
# path are well-defined from 5.1 onward. Git Bash on Windows ships 5.2.
#
# Inputs (set by caller before invoking run_build_gate):
#   PROJECT_DIR     — repo path to cd into for the build commands
#   PIPELINE_TMP    — tmp dir for per-process stdout/stderr captures
#   HAS_TSCONFIG    — "true" if tsconfig.json exists in $PROJECT_DIR
#   HAS_VITE        — "true" if vite.config.{ts,js,mjs} exists in $PROJECT_DIR
#
# Optional inputs (env vars):
#   IAGO_PARALLEL_BUILD — "1" enables parallel mode, anything else (default
#                         "0") keeps sequential. Default-off because two
#                         concurrent TypeScript processes can pressure memory
#                         on 16GB Windows boxes; see plan 06 for the mitigation
#                         contract (the env var IS the mitigation — once a
#                         memory-pressure run on a 16GB box documents headroom
#                         the default may flip).
#
# Outputs (globals set by run_build_gate):
#   BUILD_GATE_OUTPUT   — combined, labeled stdout/stderr from both commands
#   BUILD_GATE_TSC_MS   — wall time for tsc (0 if HAS_TSCONFIG=false)
#   BUILD_GATE_VITE_MS  — wall time for vite (0 if HAS_VITE=false)
#   BUILD_GATE_MODE     — "parallel" or "sequential" — which path actually ran
#
# Returns 0 if both required commands succeed; non-zero otherwise.

# Millisecond timestamp helper. Falls back to second resolution if the date
# implementation lacks %3N (rare; Git Bash on Windows has it).
__build_gate_now_ms() {
  if date -u +%s%3N 2>/dev/null | grep -qE '^[0-9]+$'; then
    date -u +%s%3N
  else
    echo "$(($(date -u +%s) * 1000))"
  fi
}

# Best-effort kill of a process tree. Used to reap a survivor when the parallel
# gate decides the build has already failed; without this the next retry would
# stack a fresh vite N+2 on top of vite N+1 still consuming memory.
__build_gate_kill_tree() {
  local pid="$1"
  [[ -z "$pid" ]] && return 0
  kill -0 "$pid" 2>/dev/null || return 0
  if command -v taskkill >/dev/null 2>&1; then
    taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
  fi
  kill -9 "$pid" 2>/dev/null || true
}

# Allow tests to override the actual commands without touching PATH.
: "${IAGO_BUILD_GATE_TSC_CMD:=npx tsc --noEmit}"
: "${IAGO_BUILD_GATE_VITE_CMD:=npx vite build}"

run_build_gate() {
  BUILD_GATE_OUTPUT=""
  BUILD_GATE_TSC_MS=0
  BUILD_GATE_VITE_MS=0
  BUILD_GATE_MODE="sequential"

  local has_tsc=false has_vite=false
  [[ "${HAS_TSCONFIG:-false}" == "true" ]] && has_tsc=true
  [[ "${HAS_VITE:-false}" == "true" ]] && has_vite=true

  if ! $has_tsc && ! $has_vite; then
    return 0
  fi

  local tsc_out="${PIPELINE_TMP:-/tmp}/build-gate-tsc.out"
  local vite_out="${PIPELINE_TMP:-/tmp}/build-gate-vite.out"
  : > "$tsc_out"
  : > "$vite_out"

  local tsc_exit=0 vite_exit=0
  local tsc_start=0 tsc_end=0 vite_start=0 vite_end=0

  if [[ "${IAGO_PARALLEL_BUILD:-0}" == "1" ]]; then
    BUILD_GATE_MODE="parallel"
    local tsc_pid="" vite_pid=""

    # Subshells `( cd ... && cmd )` are intentional — they isolate the cd from
    # the caller's working dir. Do not collapse into bare `cd ... && cmd &`.
    if $has_tsc; then
      tsc_start=$(__build_gate_now_ms)
      ( cd "$PROJECT_DIR" && eval "$IAGO_BUILD_GATE_TSC_CMD" > "$tsc_out" 2>&1 ) &
      tsc_pid=$!
    fi
    if $has_vite; then
      vite_start=$(__build_gate_now_ms)
      ( cd "$PROJECT_DIR" && eval "$IAGO_BUILD_GATE_VITE_CMD" > "$vite_out" 2>&1 ) &
      vite_pid=$!
    fi

    # Wait whichever process finishes FIRST — that's the only correct way to
    # detect a fast-failing leg while the other is still running. A naive
    # `wait $tsc_pid; wait $vite_pid` would block on whichever PID was named
    # first, missing a fast-failing second process. `wait -n -p var pids...`
    # (bash 5.1+) returns the PID that exited via `var` and that PID's exit
    # status as the wait return.
    local tsc_done=false vite_done=false
    [[ -z "$tsc_pid" ]] && tsc_done=true
    [[ -z "$vite_pid" ]] && vite_done=true
    while ! $tsc_done || ! $vite_done; do
      local pending=()
      $tsc_done || pending+=("$tsc_pid")
      $vite_done || pending+=("$vite_pid")
      local finished_pid="" rc=0
      wait -n -p finished_pid "${pending[@]}" || rc=$?
      if [[ "$finished_pid" == "$tsc_pid" ]]; then
        tsc_done=true
        tsc_exit=$rc
        tsc_end=$(__build_gate_now_ms)
        if [[ $rc -ne 0 ]] && ! $vite_done; then
          __build_gate_kill_tree "$vite_pid"
        fi
      elif [[ "$finished_pid" == "$vite_pid" ]]; then
        vite_done=true
        vite_exit=$rc
        vite_end=$(__build_gate_now_ms)
        if [[ $rc -ne 0 ]] && ! $tsc_done; then
          __build_gate_kill_tree "$tsc_pid"
        fi
      else
        # Defensive — `wait -n -p` should always set finished_pid on bash 5.1+.
        # If it doesn't, fall back to single-wait so we don't loop forever.
        # We still honor kill-on-fail: if tsc fails fast in this branch we kill
        # vite before waiting on it, matching the primary path's intent.
        if ! $tsc_done; then
          wait "$tsc_pid" || tsc_exit=$?
          tsc_done=true
          tsc_end=$(__build_gate_now_ms)
          if [[ $tsc_exit -ne 0 ]] && ! $vite_done; then
            __build_gate_kill_tree "$vite_pid"
          fi
        fi
        if ! $vite_done; then
          wait "$vite_pid" || vite_exit=$?
          vite_done=true
          vite_end=$(__build_gate_now_ms)
          if [[ $vite_exit -ne 0 ]] && ! $tsc_done; then
            __build_gate_kill_tree "$tsc_pid"
          fi
        fi
      fi
    done
  else
    if $has_tsc; then
      tsc_start=$(__build_gate_now_ms)
      ( cd "$PROJECT_DIR" && eval "$IAGO_BUILD_GATE_TSC_CMD" > "$tsc_out" 2>&1 ) || tsc_exit=$?
      tsc_end=$(__build_gate_now_ms)
    fi
    if $has_vite; then
      vite_start=$(__build_gate_now_ms)
      ( cd "$PROJECT_DIR" && eval "$IAGO_BUILD_GATE_VITE_CMD" > "$vite_out" 2>&1 ) || vite_exit=$?
      vite_end=$(__build_gate_now_ms)
    fi
  fi

  # Assemble output defensively from the files. Always concat whatever exists,
  # even on partial failure — the fix session needs both error streams. The
  # `# --- tsc --noEmit ---` / `# --- vite build ---` headers let the fixer
  # tell which output is which when both fail.
  local parts=""
  if $has_tsc; then
    parts="# --- tsc --noEmit ---
$(cat "$tsc_out" 2>/dev/null)"
  fi
  if $has_vite; then
    if [[ -n "$parts" ]]; then
      parts="$parts
# --- vite build ---
$(cat "$vite_out" 2>/dev/null)"
    else
      parts="# --- vite build ---
$(cat "$vite_out" 2>/dev/null)"
    fi
  fi
  BUILD_GATE_OUTPUT="$parts"

  if $has_tsc; then
    BUILD_GATE_TSC_MS=$((tsc_end - tsc_start))
  fi
  if $has_vite; then
    BUILD_GATE_VITE_MS=$((vite_end - vite_start))
  fi

  [[ $tsc_exit -eq 0 && $vite_exit -eq 0 ]]
}
