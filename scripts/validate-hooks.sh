#!/usr/bin/env bash
set -euo pipefail

HOOKS_DIR=".iago/hooks"
FAILED=0

check_file() {
  local file="$1"
  if node --check "$file" 2>/dev/null; then
    echo "OK: $file"
  else
    echo "FAIL: $file"
    FAILED=1
  fi
}

for file in "$HOOKS_DIR"/*.mjs; do
  [ -f "$file" ] && check_file "$file"
done

for file in "$HOOKS_DIR/lib"/*.mjs; do
  [ -f "$file" ] && check_file "$file"
done

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

exit 0
