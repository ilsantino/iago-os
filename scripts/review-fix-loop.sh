#!/usr/bin/env bash
set -euo pipefail

# iaGO-OS — Review-fix loop
#
# Usage: ./scripts/review-fix-loop.sh --pr 42 --project-dir /path/to/project
#
# Polls for @claude's review on a PR. If actionable comments are found,
# dispatches a fix session, builds, pushes, re-tags, and repeats.
# Exits when: approved, no findings, max rounds, poll timeout, or BLOCKED.
#
# Called by:
#   - execute-pipeline.sh (after PR creation)
#   - iago:prfix skill (for existing PRs)

PR_NUMBER=""
PROJECT_DIR=""
MAX_ROUNDS=5
POLL_INTERVAL=30
MAX_POLLS=30  # 30 × 30s = 15 min max wait per round
SKIP_INITIAL_TAG=false
SKIP_INITIAL_POLL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr) PR_NUMBER="$2"; shift 2 ;;
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --max-rounds) MAX_ROUNDS="$2"; shift 2 ;;
    --poll-interval) POLL_INTERVAL="$2"; shift 2 ;;
    --max-polls) MAX_POLLS="$2"; shift 2 ;;
    --skip-initial-tag) SKIP_INITIAL_TAG=true; shift ;;
    --skip-initial-poll) SKIP_INITIAL_POLL=true; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$PR_NUMBER" || -z "$PROJECT_DIR" ]]; then
  echo "Usage: review-fix-loop.sh --pr <number> --project-dir <dir>"
  exit 1
fi

log() { echo "[$(date '+%H:%M:%S')] [review-fix-loop] $1"; }

# ─── Resolve repo info ───────────────────────────────────────────────
OWNER_REPO=$(cd "$PROJECT_DIR" && gh repo view --json nameWithOwner -q '.nameWithOwner')
PR_AUTHOR=$(cd "$PROJECT_DIR" && gh pr view "$PR_NUMBER" --json author -q '.author.login')

log "Starting review-fix loop for PR #$PR_NUMBER ($OWNER_REPO)"

# ─── Tag @claude if this is a fresh invocation ────────────────────────
if [[ "$SKIP_INITIAL_TAG" != "true" ]]; then
  log "Tagging @claude for review on PR #$PR_NUMBER"
  (cd "$PROJECT_DIR" && gh pr comment "$PR_NUMBER" --body "@claude Please review this PR thoroughly.") || {
    log "ERROR: Failed to tag @claude. Exiting."
    exit 1
  }
fi

# For --skip-initial-poll, use epoch so first fetch gets ALL existing comments
if [[ "$SKIP_INITIAL_POLL" == "true" ]]; then
  TAG_TIMESTAMP="2000-01-01T00:00:00Z"
else
  TAG_TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
fi

# ─── Main loop ────────────────────────────────────────────────────────
fix_round=0
while true; do
  fix_round=$((fix_round + 1))

  if [[ $fix_round -gt $MAX_ROUNDS ]]; then
    log "WARNING: Max rounds ($MAX_ROUNDS) reached. Manual review required."
    exit 0
  fi

  # ── Poll for @claude response ──────────────────────────────────────
  # Skip polling on round 1 if --skip-initial-poll (prfix: comments already exist)
  if [[ $fix_round -eq 1 ]] && [[ "$SKIP_INITIAL_POLL" == "true" ]]; then
    log "Round 1 — skipping poll (comments already exist)"
    RESPONSE_FOUND=true
    LATEST_REVIEW_STATE=""
    LATEST_REVIEW_BODY=""
    NEW_INLINE_COUNT="1"  # force fetch
    NEW_ISSUE_COUNT="0"
  else

  log "Round $fix_round — polling for review response..."
  poll=0
  RESPONSE_FOUND=false

  while [[ $poll -lt $MAX_POLLS ]]; do
    sleep "$POLL_INTERVAL"
    poll=$((poll + 1))

    # Bail if PR was closed/merged
    PR_STATE=$(cd "$PROJECT_DIR" && gh pr view "$PR_NUMBER" --json state -q '.state' 2>/dev/null || echo "UNKNOWN")
    if [[ "$PR_STATE" == "MERGED" || "$PR_STATE" == "CLOSED" ]]; then
      log "PR #$PR_NUMBER is $PR_STATE — exiting loop"
      exit 0
    fi

    # Check for new reviews after our tag
    LATEST_REVIEW_STATE=$(cd "$PROJECT_DIR" && gh api "repos/$OWNER_REPO/pulls/$PR_NUMBER/reviews" \
      --jq "[.[] | select(.submitted_at > \"$TAG_TIMESTAMP\")] | sort_by(.submitted_at) | last | .state // empty" 2>/dev/null || echo "")

    LATEST_REVIEW_BODY=$(cd "$PROJECT_DIR" && gh api "repos/$OWNER_REPO/pulls/$PR_NUMBER/reviews" \
      --jq "[.[] | select(.submitted_at > \"$TAG_TIMESTAMP\")] | sort_by(.submitted_at) | last | .body // empty" 2>/dev/null || echo "")

    # Check for new inline review comments from non-author
    NEW_INLINE_COUNT=$(cd "$PROJECT_DIR" && gh api "repos/$OWNER_REPO/pulls/$PR_NUMBER/comments" \
      --jq "[.[] | select(.created_at > \"$TAG_TIMESTAMP\" and .user.login != \"$PR_AUTHOR\")] | length" 2>/dev/null || echo "0")

    # Check for new issue-level comments from non-author
    NEW_ISSUE_COUNT=$(cd "$PROJECT_DIR" && gh api "repos/$OWNER_REPO/issues/$PR_NUMBER/comments" \
      --jq "[.[] | select(.created_at > \"$TAG_TIMESTAMP\" and .user.login != \"$PR_AUTHOR\")] | length" 2>/dev/null || echo "0")

    if [[ -n "$LATEST_REVIEW_STATE" ]] || [[ "$NEW_INLINE_COUNT" -gt 0 ]] || [[ "$NEW_ISSUE_COUNT" -gt 0 ]]; then
      RESPONSE_FOUND=true
      log "Response received (review=$LATEST_REVIEW_STATE, inline=$NEW_INLINE_COUNT, issue=$NEW_ISSUE_COUNT)"
      break
    fi

    if (( poll % 5 == 0 )); then
      log "  poll $poll/$MAX_POLLS — waiting..."
    fi
  done

  if [[ "$RESPONSE_FOUND" != "true" ]]; then
    log "WARNING: No response after $((MAX_POLLS * POLL_INTERVAL))s. Stopping."
    exit 0
  fi

  # ── Check if approved / clean ──────────────────────────────────────
  if [[ "$LATEST_REVIEW_STATE" == "APPROVED" ]]; then
    log "PR #$PR_NUMBER APPROVED — done"
    exit 0
  fi

  # Clean review body with no inline comments = approved
  if [[ "$NEW_INLINE_COUNT" -eq 0 ]] && [[ -n "$LATEST_REVIEW_BODY" ]]; then
    if echo "$LATEST_REVIEW_BODY" | grep -qiE '(lgtm|looks good|no issues|approved|no concerns|clean)'; then
      if ! echo "$LATEST_REVIEW_BODY" | grep -qiE '(critical|important|must fix|should fix|error|bug|issue|problem|incorrect|wrong)'; then
        log "Review signals clean — done"
        exit 0
      fi
    fi
  fi

  fi  # end of skip-initial-poll else block

  # ── Fetch all actionable comments ──────────────────────────────────
  log "Fetching actionable comments..."

  INLINE_COMMENTS=$(cd "$PROJECT_DIR" && gh api "repos/$OWNER_REPO/pulls/$PR_NUMBER/comments" \
    --jq "[.[] | select(.created_at > \"$TAG_TIMESTAMP\" and .user.login != \"$PR_AUTHOR\")] | .[] | \"File: \(.path):\(.line // .original_line // \"?\")\nComment: \(.body)\n---\"" 2>/dev/null || echo "")

  ISSUE_COMMENTS=$(cd "$PROJECT_DIR" && gh api "repos/$OWNER_REPO/issues/$PR_NUMBER/comments" \
    --jq "[.[] | select(.created_at > \"$TAG_TIMESTAMP\" and .user.login != \"$PR_AUTHOR\")] | .[] | \"Comment: \(.body)\n---\"" 2>/dev/null || echo "")

  # If nothing actionable after all, skip
  if [[ -z "$INLINE_COMMENTS" ]] && [[ -z "$ISSUE_COMMENTS" ]] && [[ -z "$LATEST_REVIEW_BODY" ]]; then
    log "No actionable content found — done"
    exit 0
  fi

  # ── Fix session ────────────────────────────────────────────────────
  log "Dispatching fix session (round $fix_round)..."

  FIX_PROMPT="You are a PIPELINE FIX session spawned by review-fix-loop.sh.
The rule in CLAUDE.md that says 'NEVER implement a plan directly' does NOT apply to you — you ARE the pipeline.

FIX ALL THE ISSUES BELOW. DO NOT SKIP ANY, REGARDLESS OF SEVERITY.
Read each referenced file before editing. End with DONE or BLOCKED.

PR #$PR_NUMBER review comments:

Inline review comments:
${INLINE_COMMENTS:-"(none)"}

General review comments:
${ISSUE_COMMENTS:-"(none)"}

Review body:
${LATEST_REVIEW_BODY:-"(none)"}"

  FIX_EXIT=0
  FIX_OUTPUT=$(cd "$PROJECT_DIR" && claude -p "$FIX_PROMPT" \
    --model sonnet \
    --max-turns 50 \
    --allowedTools "Edit Write Read Glob Grep Bash" \
    --output-format text 2>&1) || FIX_EXIT=$?

  log "Fix session exit: $FIX_EXIT"
  echo "$FIX_OUTPUT"

  if echo "$FIX_OUTPUT" | tail -5 | grep -q "BLOCKED"; then
    log "ERROR: Fix session BLOCKED. Stopping."
    exit 1
  fi

  # ── Build gate ─────────────────────────────────────────────────────
  log "BUILD GATE — post-fix (round $fix_round)"
  build_ok=false
  for attempt in 1 2; do
    if (cd "$PROJECT_DIR" && npx tsc --noEmit 2>&1 && npx vite build 2>&1); then
      build_ok=true
      break
    else
      BUILD_ERRORS=$(cd "$PROJECT_DIR" && npx tsc --noEmit 2>&1 || true)
      cd "$PROJECT_DIR" && claude -p "You are a PIPELINE FIX session. Fix these build errors:

$BUILD_ERRORS" \
        --model sonnet --max-turns 20 \
        --allowedTools "Edit Write Read Glob Grep Bash" \
        --output-format text 2>&1 || true
    fi
  done

  if ! $build_ok; then
    log "ERROR: Build failed after fix (round $fix_round). Stopping."
    exit 1
  fi

  log "Build passed"

  # ── Commit, push, re-tag ───────────────────────────────────────────
  CURRENT_BRANCH=$(cd "$PROJECT_DIR" && git branch --show-current)
  (cd "$PROJECT_DIR" && git add -A && git commit -m "$(cat <<EOF
fix(review): address PR #$PR_NUMBER review comments (round $fix_round)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)") || log "WARNING: Nothing to commit"

  (cd "$PROJECT_DIR" && git push origin "$CURRENT_BRANCH") || {
    log "ERROR: Push failed. Stopping."
    exit 1
  }

  # Re-tag and reset timestamp for next cycle
  TAG_TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  (cd "$PROJECT_DIR" && gh pr comment "$PR_NUMBER" --body "@claude Please review again.") || log "WARNING: Failed to re-tag @claude"

  log "Round $fix_round complete — pushed and re-tagged"
done
