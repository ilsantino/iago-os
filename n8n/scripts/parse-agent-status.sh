#!/usr/bin/env bash
set -euo pipefail

# Usage: parse-agent-status.sh --output "..." --project-dir /path
# Reads claude output, extracts status + diff + findings
# Outputs JSON: { "status": "DONE", "diff": "...", "findings": [...], "critical_count": N }

OUTPUT=""
PROJECT_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) OUTPUT="$2"; shift 2 ;;
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Extract agent status
STATUS="UNKNOWN"
for s in DONE_WITH_CONCERNS DONE NEEDS_CONTEXT BLOCKED; do
  if echo "$OUTPUT" | grep -q "$s"; then
    STATUS="$s"
    break
  fi
done

# Get git diff
DIFF=""
if [[ -n "$PROJECT_DIR" ]]; then
  DIFF=$(cd "$PROJECT_DIR" && git diff HEAD~1 2>/dev/null || echo "")
fi

# Count findings by severity
CRITICAL=$(echo "$OUTPUT" | grep -ci "critical" || true)
IMPORTANT=$(echo "$OUTPUT" | grep -ci "important" || true)
MINOR=$(echo "$OUTPUT" | grep -ci "minor" || true)

# Escape for JSON
ESCAPED_DIFF=$(printf '%s' "$DIFF" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")

echo "{\"status\": \"$STATUS\", \"diff\": $ESCAPED_DIFF, \"critical_count\": $CRITICAL, \"important_count\": $IMPORTANT, \"minor_count\": $MINOR}"
