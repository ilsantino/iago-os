#!/usr/bin/env bash
set -euo pipefail

# Usage: trigger-claude.sh --prompt "..." --project-dir /path [--max-turns 50] [--model sonnet]
# Outputs JSON: { "exit_code": N, "output": "...", "duration_ms": N }

PROMPT=""
PROJECT_DIR=""
MAX_TURNS=50
MODEL="sonnet"
TIMEOUT=600  # 10 minutes

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt) PROMPT="$2"; shift 2 ;;
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --max-turns) MAX_TURNS="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$PROMPT" || -z "$PROJECT_DIR" ]]; then
  echo '{"error": "Missing --prompt or --project-dir"}' >&2
  exit 1
fi

START_MS=$(date +%s%3N 2>/dev/null || python3 -c "import time; print(int(time.time()*1000))")

OUTPUT=$(timeout "$TIMEOUT" claude -p "$PROMPT" \
  --project-dir "$PROJECT_DIR" \
  --model "$MODEL" \
  --max-turns "$MAX_TURNS" \
  --output-format text 2>&1) || true

EXIT_CODE=$?
END_MS=$(date +%s%3N 2>/dev/null || python3 -c "import time; print(int(time.time()*1000))")
DURATION=$((END_MS - START_MS))

# Escape output for JSON
ESCAPED_OUTPUT=$(printf '%s' "$OUTPUT" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")

echo "{\"exit_code\": $EXIT_CODE, \"output\": $ESCAPED_OUTPUT, \"duration_ms\": $DURATION}"
