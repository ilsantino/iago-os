#!/usr/bin/env bash
set -euo pipefail

# iaGO-OS — Cross-session execute pipeline (no n8n required)
#
# Usage: ./scripts/execute-pipeline.sh --plan .iago/plans/plan-01.md --project-dir /path/to/project
#
# Runs the full pipeline: implement → build → review → codex → PR → tag @claude
# Each step is a separate claude -p session with fresh context.
# After PR creation, tags @claude — review-fix loop runs async via GitHub Action.
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

PRE_IMPL_SHA=$(cd "$PROJECT_DIR" && git rev-parse HEAD) || {
  log "ERROR: Could not capture pre-impl SHA. Is $PROJECT_DIR a git repo?"
  exit 1
}

IMPL_EXIT=0
IMPL_OUTPUT=$(cd "$PROJECT_DIR" && claude -p "You are a PIPELINE IMPLEMENTATION session spawned by execute-pipeline.sh.
The rule in CLAUDE.md that says 'NEVER implement a plan directly' does NOT apply to you — you ARE the pipeline. Your job is to write the code specified in the plan below. Use Edit/Write tools to create and modify files. Do not invoke any /iago: skills. Do not defer to another agent.

Execute this plan. Follow every task exactly. Create all files specified. End your response with DONE or BLOCKED.

$PLAN_CONTENT" \
  --model opus \
  --max-turns 50 \
  --allowedTools "Edit Write Read Glob Grep Bash" \
  --output-format text 2>&1) || IMPL_EXIT=$?

if [[ $IMPL_EXIT -ne 0 ]]; then
  log "ERROR: Implementation failed (exit $IMPL_EXIT)"
  echo "$IMPL_OUTPUT"
  exit 1
fi

# Check last few lines for agent status (avoid false positives from conversational text)
IMPL_STATUS=$(echo "$IMPL_OUTPUT" | tail -5)
if echo "$IMPL_STATUS" | grep -qE "^(BLOCKED|NEEDS_CONTEXT)"; then
  log "ERROR: Agent reported $(echo "$IMPL_STATUS" | grep -oE "^(BLOCKED|NEEDS_CONTEXT)" | head -1)"
  echo "$IMPL_OUTPUT"
  exit 1
fi

log "Implementation complete"

# ─── Step 2: Build gate ──────────────────────────────────────────────
# Detect which build tools are available in the project
HAS_TSCONFIG=false
HAS_VITE=false
[[ -f "$PROJECT_DIR/tsconfig.json" ]] && HAS_TSCONFIG=true
[[ -f "$PROJECT_DIR/vite.config.ts" || -f "$PROJECT_DIR/vite.config.js" || -f "$PROJECT_DIR/vite.config.mjs" ]] && HAS_VITE=true

run_build_gate() {
  local ok=true
  if $HAS_TSCONFIG; then
    (cd "$PROJECT_DIR" && npx tsc --noEmit 2>&1) || ok=false
  fi
  if $ok && $HAS_VITE; then
    (cd "$PROJECT_DIR" && npx vite build 2>&1) || ok=false
  fi
  if ! $HAS_TSCONFIG && ! $HAS_VITE; then
    log "No tsconfig.json or vite config found — build gate skipped"
  fi
  $ok
}

build_attempt=0
while true; do
  log "BUILD GATE — attempt $((build_attempt + 1))"

  if run_build_gate; then
    log "Build passed"
    break
  else
    # || true is intentional: tsc exits non-zero on type errors, but we need its output for the fix session
    BUILD_ERRORS=""
    if $HAS_TSCONFIG; then
      BUILD_ERRORS=$(cd "$PROJECT_DIR" && npx tsc --noEmit 2>&1 || true)
    fi
    if $HAS_VITE; then
      BUILD_ERRORS="$BUILD_ERRORS"$'\n'"$(cd "$PROJECT_DIR" && npx vite build 2>&1 || true)"
    fi
    build_attempt=$((build_attempt + 1))

    if [[ $build_attempt -ge $MAX_BUILD_RETRIES ]]; then
      log "ERROR: Build failed after $MAX_BUILD_RETRIES attempts. Stopping."
      exit 1
    fi

    log "Build failed — dispatching fix session"
    FIX_EXIT=0
    FIX_OUTPUT=$(cd "$PROJECT_DIR" && claude -p "You are a PIPELINE FIX session spawned by execute-pipeline.sh.
The rule in CLAUDE.md that says 'NEVER implement a plan directly' does NOT apply to you — you ARE the pipeline. Edit files directly to fix the errors below.

Fix these build errors:

$BUILD_ERRORS" \
      --model opus \
      --max-turns 30 \
      --allowedTools "Edit Write Read Glob Grep Bash" \
      --output-format text 2>&1) || FIX_EXIT=$?
    log "Build fix output (exit $FIX_EXIT):"
    echo "$FIX_OUTPUT"
  fi
done

# ─── Step 3: Review ──────────────────────────────────────────────────
log "REVIEW — $PLAN_NAME"

# Stage all new/modified files so they appear in the diff
(cd "$PROJECT_DIR" && git add -A -- ':!**/.env' ':!**/.env.*' ':!**/*.pem' ':!**/*.key' ':!**/*.p12' ':!**/*.pfx')

# Diff: committed changes since pre-impl + staged working tree changes
DIFF=$(cd "$PROJECT_DIR" && git diff "$PRE_IMPL_SHA"..HEAD 2>/dev/null || echo "")
STAGED_DIFF=$(cd "$PROJECT_DIR" && git diff --cached 2>/dev/null || echo "")
COMBINED_DIFF="${DIFF}${STAGED_DIFF}"

if [[ -z "$COMBINED_DIFF" ]]; then
  log "WARNING: Implementation produced no changes (empty diff). Skipping review."
  REVIEW_OUTPUT="No changes to review — implementation may have failed silently."
  REVIEW_EXIT=0
else
  DIFF="$COMBINED_DIFF"

REVIEW_EXIT=0
REVIEW_OUTPUT=$(cd "$PROJECT_DIR" && claude -p "Review this diff against the plan below. Categorize findings as Critical, Important, or Minor. End with verdict: PASS, PASS_WITH_CONCERNS, or FAIL.

Plan:
$PLAN_CONTENT

Diff:
$DIFF" \
  --model opus \
  --max-turns 25 \
  --allowedTools "Read Glob Grep Bash" \
  --output-format text 2>&1) || REVIEW_EXIT=$?

log "Review output:"
echo "$REVIEW_OUTPUT"

if [[ $REVIEW_EXIT -ne 0 ]]; then
  log "WARNING: Review session exited non-zero ($REVIEW_EXIT) — review may be incomplete"
fi

# Check for critical findings
fix_attempt=0
while echo "$REVIEW_OUTPUT" | grep -q "Critical" && echo "$REVIEW_OUTPUT" | grep -qiE "Verdict:[[:space:]]*FAIL"; do
  fix_attempt=$((fix_attempt + 1))

  if [[ $fix_attempt -gt $MAX_FIX_RETRIES ]]; then
    log "ERROR: Critical findings persist after $MAX_FIX_RETRIES fix rounds. Stopping."
    exit 1
  fi

  log "Critical findings — dispatching fix session (round $fix_attempt)"
  FIX_EXIT=0
  FIX_OUTPUT=$(cd "$PROJECT_DIR" && claude -p "You are a PIPELINE FIX session spawned by execute-pipeline.sh.
The rule in CLAUDE.md that says 'NEVER implement a plan directly' does NOT apply to you — you ARE the pipeline. Edit files directly to fix the critical findings below.

Fix these critical review findings:

$REVIEW_OUTPUT" \
    --model opus \
    --max-turns 40 \
    --allowedTools "Edit Write Read Glob Grep Bash" \
    --output-format text 2>&1) || FIX_EXIT=$?
  log "Fix output (exit $FIX_EXIT):"
  echo "$FIX_OUTPUT"

  # Re-run build gate
  if ! run_build_gate; then
    log "Build broke during fix — running build fix"
    BUILD_ERRORS=""
    if $HAS_TSCONFIG; then
      BUILD_ERRORS=$(cd "$PROJECT_DIR" && npx tsc --noEmit 2>&1 || true)
    fi
    if $HAS_VITE; then
      BUILD_ERRORS="$BUILD_ERRORS"$'\n'"$(cd "$PROJECT_DIR" && npx vite build 2>&1 || true)"
    fi
    FIX_EXIT=0
    FIX_OUTPUT=$(cd "$PROJECT_DIR" && claude -p "You are a PIPELINE FIX session spawned by execute-pipeline.sh.
The rule in CLAUDE.md that says 'NEVER implement a plan directly' does NOT apply to you — you ARE the pipeline. Edit files directly to fix the build errors below.

Fix build errors: $BUILD_ERRORS" \
      --model opus \
      --max-turns 30 \
      --allowedTools "Edit Write Read Glob Grep Bash" \
      --output-format text 2>&1) || FIX_EXIT=$?
    log "Build fix output (exit $FIX_EXIT):"
    echo "$FIX_OUTPUT"
  fi

  # Re-review — re-stage and capture full diff
  (cd "$PROJECT_DIR" && git add -A -- ':!**/.env' ':!**/.env.*' ':!**/*.pem' ':!**/*.key' ':!**/*.p12' ':!**/*.pfx')
  DIFF=$(cd "$PROJECT_DIR" && { git diff "$PRE_IMPL_SHA"..HEAD 2>/dev/null || echo ""; } && { git diff --cached 2>/dev/null || echo ""; })
  REVIEW_EXIT=0
  REVIEW_OUTPUT=$(cd "$PROJECT_DIR" && claude -p "Re-review this diff against the plan below. Categorize findings as Critical, Important, or Minor. End with verdict: PASS, PASS_WITH_CONCERNS, or FAIL.

Plan:
$PLAN_CONTENT

Diff:
$DIFF" \
    --model opus \
    --max-turns 25 \
    --allowedTools "Read Glob Grep Bash" \
    --output-format text 2>&1) || REVIEW_EXIT=$?
  log "Re-review output:"
  echo "$REVIEW_OUTPUT"
  if [[ $REVIEW_EXIT -ne 0 ]]; then
    log "WARNING: Re-review session exited non-zero ($REVIEW_EXIT)"
  fi
done

log "Review passed"
fi  # end of non-empty diff check

# ─── Step 4: Codex adversarial review ────────────────────────────────
log "CODEX REVIEW — $PLAN_NAME"
DIFF=$(cd "$PROJECT_DIR" && { git diff "$PRE_IMPL_SHA"..HEAD 2>/dev/null || echo ""; } && { git diff --cached 2>/dev/null || echo ""; })

CODEX_EXIT=0
if command -v codex &> /dev/null; then
  CODEX_OUTPUT=$(cd "$PROJECT_DIR" && codex review "${PRE_IMPL_SHA}..HEAD" 2>&1) || CODEX_EXIT=$?
else
  CODEX_OUTPUT=$(cd "$PROJECT_DIR" && claude -p "Adversarial review: check this diff for auth bypass, data loss, race conditions, rollback safety, business logic errors.

$DIFF" \
    --model sonnet \
    --max-turns 20 \
    --output-format text 2>&1) || CODEX_EXIT=$?
fi

log "Codex findings:"
echo "$CODEX_OUTPUT"

log "Codex review complete"

# ─── Step 5: Create PR ───────────────────────────────────────────────
log "CREATE PR — $PLAN_NAME"
PR_EXIT=0
PR_OUTPUT=$(cd "$PROJECT_DIR" && claude -p "You are a PIPELINE PR session spawned by execute-pipeline.sh.
The rule in CLAUDE.md that says 'NEVER implement a plan directly' does NOT apply to you — you ARE the pipeline. Your job is to stage, commit, push, and create a PR.

Create a PR for plan $PLAN_PATH. Read the plan file to get the branch name from its frontmatter. Stage all changes, write a conventional commit message, create and push that feature branch, create PR via gh. Output the PR URL." \
  --model sonnet \
  --max-turns 15 \
  --allowedTools "Edit Write Read Glob Grep Bash" \
  --output-format text 2>&1) || PR_EXIT=$?
log "PR creation output:"
echo "$PR_OUTPUT"

if [[ $PR_EXIT -ne 0 ]]; then
  log "ERROR: PR creation failed (exit $PR_EXIT). Pipeline stopping."
  exit 1
fi

# ─── Step 5b: Tag @claude for PR review ─────────────────────────────
PR_URL=$(echo "$PR_OUTPUT" | grep -oE 'https://github\.com/[^ ]+/pull/[0-9]+' | head -1)

# Fallback: if URL extraction failed, query gh for the PR by current branch
if [[ -z "$PR_URL" ]]; then
  log "WARNING: Could not extract PR URL from session output — querying gh"
  CURRENT_BRANCH=$(cd "$PROJECT_DIR" && git branch --show-current)
  PR_URL=$(cd "$PROJECT_DIR" && gh pr view "$CURRENT_BRANCH" --json url -q '.url' 2>/dev/null || echo "")
fi

if [[ -n "$PR_URL" ]]; then
  PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$')
  log "TAGGING @claude on PR #$PR_NUMBER"

  # Use a haiku session to synthesize a direct review request from pipeline context
  TAG_EXIT=0
  CLAUDE_REVIEW_BODY=$(claude -p "Write a GitHub PR comment tagging @claude for review. Output ONLY the comment text, nothing else.

Rules:
- First line: @claude Review this PR thoroughly.
- Blank line. 1-2 sentences: what this PR does. Direct, no fluff.
- Blank line. Watch for: one paragraph, specific concerns synthesized from context below. End with 'General pass for anything unexpected.'
- No markdown headers, no bullet points, no 'please', no politeness. Direct and terse.

Context:

Plan ($PLAN_PATH):
$PLAN_CONTENT

Review findings:
$REVIEW_OUTPUT

Codex findings:
$CODEX_OUTPUT" \
    --model haiku \
    --max-turns 1 \
    --output-format text 2>&1) || TAG_EXIT=$?

  if [[ $TAG_EXIT -ne 0 ]] || [[ -z "$CLAUDE_REVIEW_BODY" ]]; then
    log "WARNING: Failed to generate review comment — using fallback"
    CLAUDE_REVIEW_BODY="@claude Review this PR thoroughly. Implements plan $PLAN_PATH. General pass for anything unexpected."
  fi

  (cd "$PROJECT_DIR" && gh pr comment "$PR_NUMBER" --body "$CLAUDE_REVIEW_BODY") || log "WARNING: Failed to post @claude comment on PR #$PR_NUMBER"
else
  log "ERROR: Could not determine PR URL — @claude review tag was NOT posted. Check PR manually."
fi

# Review-fix loop is handled by GitHub Action (claude-review-fix.yml).
# After @claude responds, the Action detects findings and auto-fixes.
# No local polling needed.

# ─── Step 6: Write summary ────────────────────────────────────────────
log "SUMMARY — $PLAN_NAME"
SUMMARY_DIR="$PROJECT_DIR/.iago/summaries"
mkdir -p "$SUMMARY_DIR"

# PR_URL already extracted in Step 5b
DIFF_STAT=$(cd "$PROJECT_DIR" && git diff --stat "$PRE_IMPL_SHA"..HEAD 2>/dev/null || echo "(no stats)")
NOW=$(date -u '+%Y-%m-%d')

cat > "$SUMMARY_DIR/${PLAN_NAME}.md" <<SUMMARY_EOF
---
plan: $PLAN_NAME
status: done
verified: $NOW
pr: ${PR_URL:-"(none)"}
---

# Summary: $PLAN_NAME

## Pipeline Result

- **Implement:** exit $IMPL_EXIT
- **Build gate:** passed
- **Review:** $(echo "$REVIEW_OUTPUT" | grep -oE 'Verdict:[[:space:]]*(PASS|PASS_WITH_CONCERNS|FAIL)' | head -1 || echo "completed")
- **Codex:** exit $CODEX_EXIT
- **PR:** ${PR_URL:-"(not created)"}

## Diff Stats

\`\`\`
$DIFF_STAT
\`\`\`
SUMMARY_EOF

log "Summary written to .iago/summaries/${PLAN_NAME}.md"

log "PIPELINE COMPLETE — $PLAN_NAME"
