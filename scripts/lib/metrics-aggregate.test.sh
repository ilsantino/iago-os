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

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] || exit 1
