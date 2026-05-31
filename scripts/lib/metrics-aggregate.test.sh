#!/usr/bin/env bash
# Manual test for metrics-aggregate.mjs
# Run: bash scripts/lib/metrics-aggregate.test.sh
# Exits 0 with all OK; non-zero on any FAIL.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGGREGATOR="$SCRIPT_DIR/../metrics-aggregate.mjs"

if [[ ! -f "$AGGREGATOR" ]]; then
  echo "FAIL: aggregator not found at $AGGREGATOR"
  exit 1
fi

PASS=0
FAIL=0

ok()   { echo "OK:   $1"; PASS=$((PASS + 1)); }
nope() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

# ─── Test 1: filter — incomplete runs excluded ─────────────────────────────
# One complete run (has pipeline_finalize) and one incomplete (missing it).
# --last 1 must return the complete run's stage, not the incomplete run.
TMP1=$(mktemp -d)
RUNS_DIR="$TMP1/.iago/state/pipeline-runs"
mkdir -p "$RUNS_DIR"

# Complete run — has pipeline_finalize
cat > "$RUNS_DIR/20260101-000001-plan-complete.ndjson" <<'EOF'
{"type":"stage_start","stage":"implement","ts":"2026-01-01T00:00:01Z"}
{"type":"stage_end","stage":"implement","exit":"0","duration_ms":5000,"timed_out":false,"ts":"2026-01-01T00:00:06Z"}
{"type":"pipeline_finalize","plan":"plan","pipeline_exit":"0","duration_ms":5001,"ts":"2026-01-01T00:00:06Z"}
EOF

# Incomplete run — no pipeline_finalize (newer filename, would sort last)
cat > "$RUNS_DIR/20260101-000002-plan-incomplete.ndjson" <<'EOF'
{"type":"stage_start","stage":"review","ts":"2026-01-01T00:00:10Z"}
{"type":"stage_end","stage":"review","exit":"1","duration_ms":9000,"timed_out":false,"ts":"2026-01-01T00:00:19Z"}
EOF

OUTPUT=$(cd "$TMP1" && node "$AGGREGATOR" --last 1 2>&1) || true

if echo "$OUTPUT" | grep -q "implement"; then
  ok "filter: complete run (implement stage) present in output"
else
  nope "filter: implement stage missing — incomplete run may have displaced it"
  echo "  Output: $OUTPUT" >&2
fi

if echo "$OUTPUT" | grep -q "review"; then
  nope "filter: incomplete run (review stage) leaked into output"
else
  ok "filter: incomplete run correctly excluded"
fi

rm -rf "$TMP1"

# ─── Test 2: sort — older filename sorted before newer ─────────────────────
# Two complete runs with different filenames. --last 1 must return the newer one.
TMP2=$(mktemp -d)
RUNS_DIR="$TMP2/.iago/state/pipeline-runs"
mkdir -p "$RUNS_DIR"

cat > "$RUNS_DIR/20260101-000001-plan-older.ndjson" <<'EOF'
{"type":"stage_start","stage":"build_gate","ts":"2026-01-01T00:00:01Z"}
{"type":"stage_end","stage":"build_gate","exit":"0","duration_ms":1000,"timed_out":false,"ts":"2026-01-01T00:00:02Z"}
{"type":"pipeline_finalize","plan":"plan","pipeline_exit":"0","duration_ms":1001,"ts":"2026-01-01T00:00:02Z"}
EOF

cat > "$RUNS_DIR/20260101-000002-plan-newer.ndjson" <<'EOF'
{"type":"stage_start","stage":"create_pr","ts":"2026-01-01T00:00:10Z"}
{"type":"stage_end","stage":"create_pr","exit":"0","duration_ms":2000,"timed_out":false,"ts":"2026-01-01T00:00:12Z"}
{"type":"pipeline_finalize","plan":"plan","pipeline_exit":"0","duration_ms":2001,"ts":"2026-01-01T00:00:12Z"}
EOF

OUTPUT=$(cd "$TMP2" && node "$AGGREGATOR" --last 1 2>&1) || true

if echo "$OUTPUT" | grep -q "create_pr"; then
  ok "sort: newer run (create_pr) included when --last 1"
else
  nope "sort: newer run missing — sort order may be wrong"
  echo "  Output: $OUTPUT" >&2
fi

if echo "$OUTPUT" | grep -q "build_gate"; then
  nope "sort: older run (build_gate) leaked into --last 1 output"
else
  ok "sort: older run correctly excluded by --last 1"
fi

rm -rf "$TMP2"

# ─── Test 3: no complete runs — exits non-zero ─────────────────────────────
TMP3=$(mktemp -d)
RUNS_DIR="$TMP3/.iago/state/pipeline-runs"
mkdir -p "$RUNS_DIR"

cat > "$RUNS_DIR/20260101-000001-incomplete.ndjson" <<'EOF'
{"type":"stage_start","stage":"implement","ts":"2026-01-01T00:00:01Z"}
EOF

if (cd "$TMP3" && node "$AGGREGATOR" --last 1 >/dev/null 2>&1); then
  nope "no-complete-runs: aggregator should exit non-zero but exited 0"
else
  ok "no-complete-runs: aggregator exits non-zero when no complete runs"
fi

rm -rf "$TMP3"

# ─── Test 4: --last N respects the limit ───────────────────────────────────
TMP4=$(mktemp -d)
RUNS_DIR="$TMP4/.iago/state/pipeline-runs"
mkdir -p "$RUNS_DIR"

cat > "$RUNS_DIR/20260101-000001-plan-a.ndjson" <<'EOF'
{"type":"stage_start","stage":"stagea","ts":"2026-01-01T00:00:01Z"}
{"type":"stage_end","stage":"stagea","exit":"0","duration_ms":1000,"timed_out":false,"ts":"2026-01-01T00:00:02Z"}
{"type":"pipeline_finalize","plan":"plan","pipeline_exit":"0","duration_ms":1001,"ts":"2026-01-01T00:00:02Z"}
EOF

cat > "$RUNS_DIR/20260101-000002-plan-b.ndjson" <<'EOF'
{"type":"stage_start","stage":"stageb","ts":"2026-01-01T00:00:10Z"}
{"type":"stage_end","stage":"stageb","exit":"0","duration_ms":2000,"timed_out":false,"ts":"2026-01-01T00:00:12Z"}
{"type":"pipeline_finalize","plan":"plan","pipeline_exit":"0","duration_ms":2001,"ts":"2026-01-01T00:00:12Z"}
EOF

cat > "$RUNS_DIR/20260101-000003-plan-c.ndjson" <<'EOF'
{"type":"stage_start","stage":"stagec","ts":"2026-01-01T00:00:20Z"}
{"type":"stage_end","stage":"stagec","exit":"0","duration_ms":3000,"timed_out":false,"ts":"2026-01-01T00:00:23Z"}
{"type":"pipeline_finalize","plan":"plan","pipeline_exit":"0","duration_ms":3001,"ts":"2026-01-01T00:00:23Z"}
EOF

OUTPUT=$(cd "$TMP4" && node "$AGGREGATOR" --last 2 2>&1) || true
FOOTER=$(echo "$OUTPUT" | grep "runs aggregated" || echo "")
if echo "$FOOTER" | grep -q "2 runs aggregated"; then
  ok "--last 2: footer reports 2 runs aggregated"
else
  nope "--last 2: expected '2 runs aggregated', got: $FOOTER"
fi

rm -rf "$TMP4"

# ─── Test 5: by_session groups records by sessionId ────────────────────────
TMP5=$(mktemp -d)
RUNS_DIR="$TMP5/.iago/state/pipeline-runs"
mkdir -p "$RUNS_DIR"

cat > "$RUNS_DIR/20260517-000001-plan-s.ndjson" <<'EOF'
{"type":"stage_start","stage":"a","ts":"2026-05-17T00:00:01Z","sessionId":"s1"}
{"type":"stage_end","stage":"a","exit":"0","duration_ms":100,"timed_out":false,"sessionId":"s1","ts":"2026-05-17T00:00:02Z"}
{"type":"stage_start","stage":"b","ts":"2026-05-17T00:00:03Z","sessionId":"s1"}
{"type":"stage_start","stage":"c","ts":"2026-05-17T00:00:04Z","sessionId":"s2"}
{"type":"stage_end","stage":"c","exit":"0","duration_ms":200,"timed_out":false,"sessionId":"s2","ts":"2026-05-17T00:00:05Z"}
{"type":"pipeline_finalize","plan":"plan","pipeline_exit":"0","duration_ms":4000,"sessionId":"s1","ts":"2026-05-17T00:00:05Z"}
EOF

OUTPUT=$(cd "$TMP5" && node "$AGGREGATOR" --last 1 2>&1) || true
# Sort assertion safety per Stress I2 — assert presence of keys, not order.
if echo "$OUTPUT" | grep -E '^s1 ' | head -1 | grep -qE '\bs1\b'; then
  ok "by_session: s1 row present"
else
  nope "by_session: s1 row missing"
  echo "$OUTPUT" | sed 's/^/  /'
fi
if echo "$OUTPUT" | grep -E '^s2 ' | head -1 | grep -qE '\bs2\b'; then
  ok "by_session: s2 row present"
else
  nope "by_session: s2 row missing"
fi

rm -rf "$TMP5"

# ─── Test 6: legacy records bucket to _unsessioned ─────────────────────────
TMP6=$(mktemp -d)
RUNS_DIR="$TMP6/.iago/state/pipeline-runs"
mkdir -p "$RUNS_DIR"

# Legacy NDJSON — no sessionId field anywhere.
cat > "$RUNS_DIR/20260517-000002-plan-legacy.ndjson" <<'EOF'
{"type":"stage_start","stage":"implement","ts":"2026-05-17T00:00:01Z"}
{"type":"stage_end","stage":"implement","exit":"0","duration_ms":500,"timed_out":false,"ts":"2026-05-17T00:00:02Z"}
{"type":"pipeline_finalize","plan":"plan","pipeline_exit":"0","duration_ms":501,"ts":"2026-05-17T00:00:02Z"}
EOF

OUTPUT=$(cd "$TMP6" && node "$AGGREGATOR" --last 1 2>&1) || true
if echo "$OUTPUT" | grep -q '_unsessioned'; then
  ok "by_session: legacy records bucket to _unsessioned"
else
  nope "by_session: _unsessioned bucket missing on legacy records"
fi

rm -rf "$TMP6"

# ─── Test 7: mixed legacy + sessioned records populate both buckets ────────
TMP7=$(mktemp -d)
RUNS_DIR="$TMP7/.iago/state/pipeline-runs"
mkdir -p "$RUNS_DIR"

cat > "$RUNS_DIR/20260517-000003-plan-mixed.ndjson" <<'EOF'
{"type":"stage_start","stage":"a","ts":"2026-05-17T00:00:01Z","sessionId":"sess-mix"}
{"type":"stage_end","stage":"a","exit":"0","duration_ms":100,"timed_out":false,"sessionId":"sess-mix","ts":"2026-05-17T00:00:02Z"}
{"type":"stage_start","stage":"b","ts":"2026-05-17T00:00:03Z"}
{"type":"stage_end","stage":"b","exit":"0","duration_ms":200,"timed_out":false,"ts":"2026-05-17T00:00:04Z"}
{"type":"pipeline_finalize","plan":"plan","pipeline_exit":"0","duration_ms":4000,"ts":"2026-05-17T00:00:04Z"}
EOF

OUTPUT=$(cd "$TMP7" && node "$AGGREGATOR" --last 1 2>&1) || true
if echo "$OUTPUT" | grep -q '_unsessioned' && echo "$OUTPUT" | grep -q 'sess-mix'; then
  ok "by_session: mixed records populate both _unsessioned + sessioned buckets"
else
  nope "by_session: mixed records did not populate both buckets"
  echo "$OUTPUT" | sed 's/^/  /'
fi

rm -rf "$TMP7"

# ─── Test 8: new event kinds counted per session ───────────────────────────
TMP8=$(mktemp -d)
RUNS_DIR="$TMP8/.iago/state/pipeline-runs"
mkdir -p "$RUNS_DIR"

cat > "$RUNS_DIR/20260517-000004-plan-evk.ndjson" <<'EOF'
{"type":"stage_start","stage":"a","ts":"2026-05-17T00:00:01Z","sessionId":"sess-evk"}
{"type":"stage_end","stage":"a","exit":"0","duration_ms":10,"timed_out":false,"sessionId":"sess-evk","ts":"2026-05-17T00:00:02Z"}
{"type":"learnings_written","key":"k1","path":"p","mode":"fail-loud","err":"","ts":"2026-05-17T00:00:03Z","sessionId":"sess-evk"}
{"type":"learnings_write_failed","key":"k2","path":"p","mode":"fail-loud","err":"e","ts":"2026-05-17T00:00:04Z","sessionId":"sess-evk"}
{"type":"clean_tree_check","mode":"lenient","verdict":"clean","ts":"2026-05-17T00:00:05Z","sessionId":"sess-evk"}
{"type":"pipeline_finalize","plan":"plan","pipeline_exit":"0","duration_ms":4000,"sessionId":"sess-evk","ts":"2026-05-17T00:00:06Z"}
EOF

OUTPUT=$(cd "$TMP8" && node "$AGGREGATOR" --last 1 2>&1) || true
EVK_LINE=$(echo "$OUTPUT" | grep '^sess-evk ' | head -1 || echo "")
# Row format columns (right-padded): sessionId, starts, ends, inits,
# finalizes, failed_finalizes, total_ms, timeouts, stages,
# learnings_written, learnings_write_failed, learnings_written_to_fallback,
# clean_tree_check
if [[ -n "$EVK_LINE" ]]; then
  # Collapse runs of spaces to single spaces, split on space.
  read -r _sid _starts _ends _inits _fins _ff _ms _to _stages _lw _lf _lfb _ct <<<"$(echo "$EVK_LINE" | tr -s ' ')"
  if [[ "$_lw" == "1" && "$_lf" == "1" && "$_ct" == "1" ]]; then
    ok "by_session: new event kinds counted per session (lw=$_lw lf=$_lf ct=$_ct)"
  else
    nope "by_session: event counts wrong (lw=$_lw lf=$_lf ct=$_ct)"
  fi
else
  nope "by_session: sess-evk row missing"
fi

rm -rf "$TMP8"

# ─── Test 9: timed_out counted per session ────────────────────────────────
TMP9=$(mktemp -d)
RUNS_DIR="$TMP9/.iago/state/pipeline-runs"
mkdir -p "$RUNS_DIR"

cat > "$RUNS_DIR/20260517-000005-plan-to.ndjson" <<'EOF'
{"type":"stage_start","stage":"a","ts":"2026-05-17T00:00:01Z","sessionId":"sess-to"}
{"type":"stage_end","stage":"a","exit":"124","duration_ms":600000,"timed_out":true,"sessionId":"sess-to","ts":"2026-05-17T00:10:01Z"}
{"type":"stage_start","stage":"b","ts":"2026-05-17T00:10:02Z","sessionId":"sess-to"}
{"type":"stage_end","stage":"b","exit":"0","duration_ms":100,"timed_out":false,"sessionId":"sess-to","ts":"2026-05-17T00:10:03Z"}
{"type":"pipeline_finalize","plan":"plan","pipeline_exit":"1","duration_ms":600100,"sessionId":"sess-to","ts":"2026-05-17T00:10:03Z"}
EOF

OUTPUT=$(cd "$TMP9" && node "$AGGREGATOR" --last 1 2>&1) || true
TO_LINE=$(echo "$OUTPUT" | grep '^sess-to ' | head -1 || echo "")
if [[ -n "$TO_LINE" ]]; then
  read -r _sid _starts _ends _inits _fins _ff _ms _to _rest <<<"$(echo "$TO_LINE" | tr -s ' ')"
  if [[ "$_to" == "1" ]]; then
    ok "by_session: timed_out counted per session (=1)"
  else
    nope "by_session: timed_out count wrong (got $_to, expected 1)"
  fi
else
  nope "by_session: sess-to row missing"
fi

rm -rf "$TMP9"

# ─── Test 10: lifecycle records — finalize-only run still surfaces ─────────
# Regression for the Codex finding on PR #51: by_session previously dropped
# pipeline_init / pipeline_finalize records. A run that fails before any
# stage_end (or that finalizes with a non-zero exit) used to disappear from
# the operational rollup. Fixture: one run whose only lifecycle signal is a
# pipeline_init + non-zero pipeline_finalize. The session row MUST appear.
TMP10=$(mktemp -d)
RUNS_DIR="$TMP10/.iago/state/pipeline-runs"
mkdir -p "$RUNS_DIR"

cat > "$RUNS_DIR/20260517-000006-plan-lc.ndjson" <<'EOF'
{"type":"pipeline_init","plan":"plan","run_id":"r1","outer_session_id":"sess-lifecycle","ts":"2026-05-17T00:00:01Z"}
{"type":"pipeline_finalize","plan":"plan","pipeline_exit":"2","duration_ms":42,"sessionId":"sess-lifecycle","ts":"2026-05-17T00:00:02Z"}
EOF

OUTPUT=$(cd "$TMP10" && node "$AGGREGATOR" --last 1 2>&1) || true
LC_LINE=$(echo "$OUTPUT" | grep '^sess-lifecycle ' | head -1 || echo "")
if [[ -n "$LC_LINE" ]]; then
  read -r _sid _starts _ends _inits _fins _ff _rest <<<"$(echo "$LC_LINE" | tr -s ' ')"
  if [[ "$_inits" == "1" && "$_fins" == "1" && "$_ff" == "1" ]]; then
    ok "by_session: lifecycle-only run surfaces with init+finalize+failed counts (i=$_inits f=$_fins ff=$_ff)"
  else
    nope "by_session: lifecycle counts wrong (i=$_inits f=$_fins ff=$_ff, expected 1/1/1)"
  fi
else
  nope "by_session: sess-lifecycle row missing — finalize-only run dropped"
  echo "$OUTPUT" | sed 's/^/  /'
fi

rm -rf "$TMP10"

# ─── Test 11: orchestrator-less run — pipeline_init folds into the run's
# synthesized session, not split into _unsessioned (dual-adversarial #2/#6) ──
# An orchestrator-less run emits pipeline_init with an EMPTY outer_session_id
# while stage + finalize records carry the SYNTHESIZED sessionId. The init MUST
# bucket WITH the stages under the synthesized sid — not strand in a phantom
# _unsessioned row that splits the run across two rows.
TMP11=$(mktemp -d)
RUNS_DIR="$TMP11/.iago/state/pipeline-runs"
mkdir -p "$RUNS_DIR"

cat > "$RUNS_DIR/20260530-000001-plan-orchless.ndjson" <<'EOF'
{"type":"pipeline_init","plan":"plan","run_id":"r9","outer_session_id":"","ts":"2026-05-30T00:00:01Z"}
{"type":"stage_start","stage":"implement","sessionId":"claude-r9-orchless","ts":"2026-05-30T00:00:02Z"}
{"type":"stage_end","stage":"implement","exit":"0","duration_ms":1000,"timed_out":false,"sessionId":"claude-r9-orchless","ts":"2026-05-30T00:00:03Z"}
{"type":"pipeline_finalize","plan":"plan","pipeline_exit":"0","duration_ms":1001,"sessionId":"claude-r9-orchless","ts":"2026-05-30T00:00:03Z"}
EOF

OUTPUT=$(cd "$TMP11" && node "$AGGREGATOR" --last 1 2>&1) || true
OL_LINE=$(echo "$OUTPUT" | grep '^claude-r9-orchless ' | head -1 || echo "")
if [[ -n "$OL_LINE" ]]; then
  read -r _sid _starts _ends _inits _rest <<<"$(echo "$OL_LINE" | tr -s ' ')"
  if [[ "$_inits" == "1" && "$_starts" == "1" && "$_ends" == "1" ]]; then
    ok "by_session: orchestrator-less init folds into synthesized session (i=$_inits starts=$_starts ends=$_ends)"
  else
    nope "by_session: orchestrator-less run split (i=$_inits starts=$_starts ends=$_ends, expected 1/1/1)"
    echo "$OUTPUT" | sed 's/^/  /'
  fi
else
  nope "by_session: synthesized-session row missing — init may have stranded in _unsessioned"
  echo "$OUTPUT" | sed 's/^/  /'
fi
if echo "$OUTPUT" | grep -qE '^_unsessioned '; then
  nope "by_session: phantom _unsessioned row present — init was not folded (#2/#6)"
else
  ok "by_session: no phantom _unsessioned row (init folded into resolved session)"
fi

rm -rf "$TMP11"

# ─── Test 12: crashed run (pipeline_init, no pipeline_finalize) surfaces in
# by_session next to a complete run (dual-adversarial #7) ───────────────────
TMP12=$(mktemp -d)
RUNS_DIR="$TMP12/.iago/state/pipeline-runs"
mkdir -p "$RUNS_DIR"

# A complete run …
cat > "$RUNS_DIR/20260530-000001-plan-ok.ndjson" <<'EOF'
{"type":"pipeline_init","plan":"plan","run_id":"ok","outer_session_id":"sess-ok","ts":"2026-05-30T00:00:01Z"}
{"type":"stage_start","stage":"implement","sessionId":"sess-ok","ts":"2026-05-30T00:00:02Z"}
{"type":"stage_end","stage":"implement","exit":"0","duration_ms":1000,"timed_out":false,"sessionId":"sess-ok","ts":"2026-05-30T00:00:03Z"}
{"type":"pipeline_finalize","plan":"plan","pipeline_exit":"0","duration_ms":1001,"sessionId":"sess-ok","ts":"2026-05-30T00:00:03Z"}
EOF

# … and a crashed run: emitted pipeline_init, then died with no finalize.
cat > "$RUNS_DIR/20260530-000002-plan-crash.ndjson" <<'EOF'
{"type":"pipeline_init","plan":"plan","run_id":"crash","outer_session_id":"sess-crash","ts":"2026-05-30T00:01:01Z"}
{"type":"stage_start","stage":"implement","sessionId":"sess-crash","ts":"2026-05-30T00:01:02Z"}
EOF

OUTPUT=$(cd "$TMP12" && node "$AGGREGATOR" --last 5 2>&1) || true
CRASH_LINE=$(echo "$OUTPUT" | grep '^sess-crash ' | head -1 || echo "")
if [[ -n "$CRASH_LINE" ]]; then
  read -r _sid _starts _ends _inits _fins _rest <<<"$(echo "$CRASH_LINE" | tr -s ' ')"
  if [[ "$_inits" == "1" && "$_fins" == "0" ]]; then
    ok "by_session: crashed run (init, no finalize) surfaces (i=$_inits f=$_fins)"
  else
    nope "by_session: crashed run counts wrong (i=$_inits f=$_fins, expected 1/0)"
  fi
else
  nope "by_session: crashed run dropped from by_session (#7 regression)"
  echo "$OUTPUT" | sed 's/^/  /'
fi

rm -rf "$TMP12"

# ─── Test 13: all runs crashed (init, no finalize) — by_session still shows
# them on stdout AND the aggregator still exits non-zero (no complete runs,
# preserving the Test 3 contract) (dual-adversarial #7) ─────────────────────
TMP13=$(mktemp -d)
RUNS_DIR="$TMP13/.iago/state/pipeline-runs"
mkdir -p "$RUNS_DIR"

cat > "$RUNS_DIR/20260530-000001-plan-allcrash.ndjson" <<'EOF'
{"type":"pipeline_init","plan":"plan","run_id":"ac","outer_session_id":"sess-ac","ts":"2026-05-30T00:00:01Z"}
{"type":"stage_start","stage":"implement","sessionId":"sess-ac","ts":"2026-05-30T00:00:02Z"}
EOF

# stdout (by_session) must still carry the crashed run …
OUTPUT=$(cd "$TMP13" && node "$AGGREGATOR" --last 5 2>/dev/null) || true
if echo "$OUTPUT" | grep -qE '^sess-ac '; then
  ok "by_session: all-crashed window still surfaces crashed runs on stdout"
else
  nope "by_session: all-crashed window produced no crashed-run row"
  echo "$OUTPUT" | sed 's/^/  /'
fi
# … and the exit code must remain non-zero (no complete runs — stats contract).
if (cd "$TMP13" && node "$AGGREGATOR" --last 5 >/dev/null 2>&1); then
  nope "all-crashed: aggregator should still exit non-zero (no complete runs)"
else
  ok "all-crashed: aggregator exits non-zero while still printing by_session"
fi

rm -rf "$TMP13"

# ─── Test 14: absent/empty input is fail-closed by default, soft under
# --allow-empty (dual-adversarial Important: false-green on missing telemetry) ─
TMP14=$(mktemp -d)

# (a) Missing runs dir, no flag → exit non-zero (fail-closed).
if (cd "$TMP14" && node "$AGGREGATOR" --last 1 >/dev/null 2>&1); then
  nope "missing-dir: default should exit non-zero (fail-closed)"
else
  ok "missing-dir: default exits non-zero (fail-closed)"
fi

# (b) Missing runs dir + --allow-empty → exit 0 with 'no input files'.
OUTPUT=$(cd "$TMP14" && node "$AGGREGATOR" --last 1 --allow-empty 2>&1)
RC=$?
if [[ $RC -eq 0 ]] && echo "$OUTPUT" | grep -q "no input files"; then
  ok "missing-dir: --allow-empty exits 0 with 'no input files'"
else
  nope "missing-dir: --allow-empty should exit 0 + 'no input files' (rc=$RC)"
fi

# (c) Present-but-empty runs dir, no flag → exit non-zero (fail-closed).
mkdir -p "$TMP14/.iago/state/pipeline-runs"
if (cd "$TMP14" && node "$AGGREGATOR" --last 1 >/dev/null 2>&1); then
  nope "empty-dir: default should exit non-zero (fail-closed)"
else
  ok "empty-dir: default exits non-zero (fail-closed)"
fi

# (d) Empty runs dir + --allow-empty → exit 0.
if (cd "$TMP14" && node "$AGGREGATOR" --last 1 --allow-empty >/dev/null 2>&1); then
  ok "empty-dir: --allow-empty exits 0"
else
  nope "empty-dir: --allow-empty should exit 0"
fi

rm -rf "$TMP14"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] || exit 1
