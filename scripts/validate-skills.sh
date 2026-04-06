#!/usr/bin/env bash
set -euo pipefail

SKILLS_DIR=".claude/skills"
FAILED=0

for skill_file in "$SKILLS_DIR"/*/SKILL.md; do
  [ -f "$skill_file" ] || continue

  skill_name="$(basename "$(dirname "$skill_file")")"
  errors=""

  # Check (1): first line is "---" (YAML frontmatter start)
  first_line="$(head -1 "$skill_file")"
  if [ "$first_line" != "---" ]; then
    errors="${errors}missing frontmatter start, "
  fi

  # Check (2): file contains "name:"
  if ! grep -q "^name:" "$skill_file"; then
    errors="${errors}missing name:, "
  fi

  # Check (3): file contains "description:"
  if ! grep -q "^description" "$skill_file"; then
    errors="${errors}missing description:, "
  fi

  if [ -n "$errors" ]; then
    # Strip trailing ", "
    errors="${errors%, }"
    echo "FAIL: $skill_name ($errors)"
    FAILED=1
  else
    echo "OK: $skill_name"
  fi
done

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

exit 0
