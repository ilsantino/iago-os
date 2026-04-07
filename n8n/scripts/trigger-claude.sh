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

START_MS=$(date +%s%3N 2>/dev/null || node -e "process.stdout.write(String(Date.now()))")

# Resolve timeout command (GNU timeout vs macOS gtimeout)
TIMEOUT_ARGS=()
if command -v timeout &>/dev/null; then
  TIMEOUT_ARGS=(timeout "$TIMEOUT")
elif command -v gtimeout &>/dev/null; then
  TIMEOUT_ARGS=(gtimeout "$TIMEOUT")
fi

EXIT_CODE=0
if [[ ${#TIMEOUT_ARGS[@]} -gt 0 ]]; then
  OUTPUT=$(cd "$PROJECT_DIR" && "${TIMEOUT_ARGS[@]}" claude -p "$PROMPT" \
    --model "$MODEL" \
    --max-turns "$MAX_TURNS" \
    --output-format text 2>&1) || EXIT_CODE=$?
else
  OUTPUT=$(cd "$PROJECT_DIR" && claude -p "$PROMPT" \
    --model "$MODEL" \
    --max-turns "$MAX_TURNS" \
    --output-format text 2>&1) || EXIT_CODE=$?
fi
END_MS=$(date +%s%3N 2>/dev/null || node -e "process.stdout.write(String(Date.now()))")
DURATION=$((END_MS - START_MS))

# Escape output for JSON (use node — it's a stack requirement, python3 is not)
ESCAPED_OUTPUT=$(printf '%s' "$OUTPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(d)))")

echo "{\"exit_code\": $EXIT_CODE, \"output\": $ESCAPED_OUTPUT, \"duration_ms\": $DURATION}"
