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

if cd "$TMP3" && node "$AGGREGATOR" --last 1 >/dev/null 2>&1; then
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

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] || exit 1
