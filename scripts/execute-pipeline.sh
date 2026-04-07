#!/usr/bin/env bash
set -euo pipefail

# iaGO-OS — Cross-session execute pipeline (no n8n required)
#
# Usage: ./n8n/scripts/execute-pipeline.sh --plan .iago/plans/plan-01.md --project-dir /path/to/project
#
# Runs the full pipeline: implement → build → review → codex → PR
# Each step is a separate claude -p session with fresh context.
# No n8n needed — just bash.

PLAN_PATH=""
PROJECT_DIR=""
MAX_BUILD_RETRIES=2
MAX_FIX_RETRIES=2
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --plan) PLAN_PATH="$2"; shift 2 ;;
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$PLAN_PATH" || -z "$PROJECT_DIR" ]]; then
  echo "Usage: execute-pipeline.sh --plan <plan-path> --project-dir <dir>"
  exit 1
fi

if [[ ! -f "$PROJECT_DIR/$PLAN_PATH" ]]; then
  echo "ERROR: Plan file not found: $PROJECT_DIR/$PLAN_PATH"
  exit 1
fi

PLAN_CONTENT=$(cat "$PROJECT_DIR/$PLAN_PATH")
PLAN_NAME=$(basename "$PLAN_PATH" .md)

log() { echo "[$(date '+%H:%M:%S')] $1"; }

# ─── Step 1: Implement ───────────────────────────────────────────────
log "IMPLEMENT — $PLAN_NAME"
claude -p "Execute this plan. Follow every task exactly. End with DONE or BLOCKED.

$PLAN_CONTENT" \
  --project-dir "$PROJECT_DIR" \
  --model sonnet \
  --max-turns 50 > /dev/null 2>&1 || true

log "Implementation complete"

# ─── Step 2: Build gate ──────────────────────────────────────────────
build_attempt=0
while true; do
  log "BUILD GATE — attempt $((build_attempt + 1))"

  if cd "$PROJECT_DIR" && npx tsc --noEmit 2>&1 && npx vite build 2>&1; then
    log "Build passed"
    break
  else
    BUILD_ERRORS=$(cd "$PROJECT_DIR" && npx tsc --noEmit 2>&1 || true)
    build_attempt=$((build_attempt + 1))

    if [[ $build_attempt -ge $MAX_BUILD_RETRIES ]]; then
      log "ERROR: Build failed after $MAX_BUILD_RETRIES attempts. Stopping."
      exit 1
    fi

    log "Build failed — dispatching fix session"
    claude -p "Fix these build errors:

$BUILD_ERRORS" \
      --project-dir "$PROJECT_DIR" \
      --model sonnet \
      --max-turns 30 > /dev/null 2>&1 || true
  fi
done

# ─── Step 3: Review ──────────────────────────────────────────────────
log "REVIEW — $PLAN_NAME"
DIFF=$(cd "$PROJECT_DIR" && git diff HEAD~1 2>/dev/null || echo "no diff available")

REVIEW_OUTPUT=$(claude -p "Review this diff against the plan. Categorize findings as Critical, Important, or Minor. End with verdict: PASS, PASS_WITH_CONCERNS, or FAIL.

Plan: $PLAN_PATH

Diff:
$DIFF" \
  --project-dir "$PROJECT_DIR" \
  --model sonnet \
  --max-turns 25 2>&1) || true

# Check for critical findings
fix_attempt=0
while echo "$REVIEW_OUTPUT" | grep -qi "critical" && echo "$REVIEW_OUTPUT" | grep -qi "FAIL"; do
  fix_attempt=$((fix_attempt + 1))

  if [[ $fix_attempt -gt $MAX_FIX_RETRIES ]]; then
    log "ERROR: Critical findings persist after $MAX_FIX_RETRIES fix rounds. Stopping."
    exit 1
  fi

  log "Critical findings — dispatching fix session (round $fix_attempt)"
  claude -p "Fix these critical review findings:

$REVIEW_OUTPUT" \
    --project-dir "$PROJECT_DIR" \
    --model sonnet \
    --max-turns 40 > /dev/null 2>&1 || true

  # Re-run build gate
  if ! (cd "$PROJECT_DIR" && npx tsc --noEmit 2>&1 && npx vite build 2>&1); then
    log "Build broke during fix — running build fix"
    BUILD_ERRORS=$(cd "$PROJECT_DIR" && npx tsc --noEmit 2>&1 || true)
    claude -p "Fix build errors: $BUILD_ERRORS" \
      --project-dir "$PROJECT_DIR" \
      --model sonnet \
      --max-turns 30 > /dev/null 2>&1 || true
  fi

  # Re-review
  DIFF=$(cd "$PROJECT_DIR" && git diff HEAD~1 2>/dev/null || echo "no diff")
  REVIEW_OUTPUT=$(claude -p "Review this diff. Categorize as Critical/Important/Minor. Verdict: PASS/PASS_WITH_CONCERNS/FAIL.

Diff:
$DIFF" \
    --project-dir "$PROJECT_DIR" \
    --model sonnet \
    --max-turns 25 2>&1) || true
done

log "Review passed"

# ─── Step 4: Codex adversarial review ────────────────────────────────
log "CODEX REVIEW — $PLAN_NAME"
if command -v codex &> /dev/null; then
  cd "$PROJECT_DIR" && codex review 2>&1 || true
else
  claude -p "Adversarial review: check this diff for auth bypass, data loss, race conditions, rollback safety, business logic errors.

$DIFF" \
    --project-dir "$PROJECT_DIR" \
    --model sonnet \
    --max-turns 20 > /dev/null 2>&1 || true
fi

log "Codex review complete"

# ─── Step 5: Create PR ───────────────────────────────────────────────
log "CREATE PR — $PLAN_NAME"
claude -p "Create a PR for plan $PLAN_PATH. Stage changes, write a conventional commit message, push a feature branch, create PR via gh. Output the PR URL." \
  --project-dir "$PROJECT_DIR" \
  --model sonnet \
  --max-turns 15 2>&1 || true

log "PIPELINE COMPLETE — $PLAN_NAME"
