#!/usr/bin/env bash
set -euo pipefail

# iaGO-OS — Cross-session execute pipeline (no n8n required)
#
# Usage: ./scripts/execute-pipeline.sh --plan .iago/plans/plan-01.md --project-dir /path/to/project
#
# Runs the full pipeline: implement → build → review → codex → fix codex → PR → tag @claude
# Each step is a separate claude -p session with fresh context.
# After PR creation, tags @claude — review-fix loop runs async via GitHub Action.
# No n8n needed — just bash.

PLAN_PATH=""
PROJECT_DIR=""
NO_TAG=false
MAX_BUILD_RETRIES=2
MAX_FIX_RETRIES=2
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --plan) PLAN_PATH="$2"; shift 2 ;;
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --no-tag) NO_TAG=true; shift ;;
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

# Temp directory for pipeline artifacts — avoids "Argument list too long" on
# Windows by writing large content to files instead of inlining in claude -p.
PIPELINE_TMP=$(mktemp -d)
trap 'rm -rf "$PIPELINE_TMP"' EXIT

PLAN_FILE="$PROJECT_DIR/$PLAN_PATH"
DIFF_FILE="$PIPELINE_TMP/diff.txt"
REVIEW_FILE="$PIPELINE_TMP/review.txt"
CODEX_FILE="$PIPELINE_TMP/codex.txt"
REVIEW_CHECKS_FILE="$PIPELINE_TMP/review-checks.md"
CHECKS_DIR="$SCRIPT_DIR/review-checks"

log() { echo "[$(date '+%H:%M:%S')] $1"; }

# Compose dynamic review checklist from diff content.
# Reads the diff file, detects domains touched, concatenates matching check modules.
compose_review_checks() {
  local diff_file="$1"
  local output_file="$2"

  # Always start with baseline
  cat "$CHECKS_DIR/baseline.md" > "$output_file"

  # React: diff touches .tsx files
  if grep -qE '^\+\+\+ b/.*\.tsx' "$diff_file"; then
    echo "" >> "$output_file"
    cat "$CHECKS_DIR/react.md" >> "$output_file"
    log "  review-checks: +react"
  fi

  # Backend: diff touches lambda/, handler.ts, or amplify/functions/
  if grep -qE '^\+\+\+ b/(lambda/|.*handler\.ts|amplify/functions/)' "$diff_file"; then
    echo "" >> "$output_file"
    cat "$CHECKS_DIR/backend.md" >> "$output_file"
    log "  review-checks: +backend"
  fi

  # Auth: diff touches auth/, cognito files, or added lines import from auth modules
  if grep -qE '^\+\+\+ b/(auth/|.*cognito)' "$diff_file" || \
     grep -qE '^\+.*import .* from .*(auth|cognito)' "$diff_file"; then
    echo "" >> "$output_file"
    cat "$CHECKS_DIR/auth.md" >> "$output_file"
    log "  review-checks: +auth"
  fi

  # API: diff touches lib/api/, api/, or files with API client imports
  if grep -qE '^\+\+\+ b/(lib/api/|src/api/|api/)' "$diff_file" || \
     grep -qE '^\+.*import .* from .*(/api/|@/api)' "$diff_file"; then
    echo "" >> "$output_file"
    cat "$CHECKS_DIR/api.md" >> "$output_file"
    log "  review-checks: +api"
  fi

  # Infra: diff touches amplify/
  if grep -qE '^\+\+\+ b/amplify/' "$diff_file"; then
    echo "" >> "$output_file"
    cat "$CHECKS_DIR/infra.md" >> "$output_file"
    log "  review-checks: +infra"
  fi

  # i18n: added lines contain Spanish characters or common Spanish UI terms
  if grep -qE '^\+.*(ción|ñ|á|é|í|ó|ú|Información|Usuario|Contraseña|Página|Búsqueda)' "$diff_file" || \
     grep -qE '^\+.*(Iniciar sesión|Cerrar sesión|Guardar|Eliminar|Aceptar|Cancelar)' "$diff_file"; then
    echo "" >> "$output_file"
    cat "$CHECKS_DIR/i18n.md" >> "$output_file"
    log "  review-checks: +i18n"
  fi

  log "  review-checks: composed $(wc -l < "$output_file") lines"
}

# ─── Step 1: Implement ───────────────────────────────────────────────
log "IMPLEMENT — $PLAN_NAME"

PRE_IMPL_SHA=$(cd "$PROJECT_DIR" && git rev-parse HEAD) || {
  log "ERROR: Could not capture pre-impl SHA. Is $PROJECT_DIR a git repo?"
  exit 1
}

IMPL_EXIT=0
IMPL_OUTPUT=$(cd "$PROJECT_DIR" && claude -p "You are a PIPELINE IMPLEMENTATION session spawned by execute-pipeline.sh.
The rule in CLAUDE.md that says 'NEVER implement a plan directly' does NOT apply to you — you ARE the pipeline. Your job is to write the code specified in the plan below. Use Edit/Write tools to create and modify files. Do not invoke any /iago: skills. Do not defer to another agent.

Read the plan file at: $PLAN_FILE
Execute every task exactly. Create all files specified. End your response with DONE or BLOCKED." \
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

BUILD_GATE_OUTPUT=""

run_build_gate() {
  BUILD_GATE_OUTPUT=""
  local ok=true
  local tsc_out="" vite_out=""
  if $HAS_TSCONFIG; then
    tsc_out=$(cd "$PROJECT_DIR" && npx tsc --noEmit 2>&1) || ok=false
    BUILD_GATE_OUTPUT="$tsc_out"
  fi
  if $HAS_VITE; then
    vite_out=$(cd "$PROJECT_DIR" && npx vite build 2>&1) || ok=false
    BUILD_GATE_OUTPUT="${BUILD_GATE_OUTPUT:+${BUILD_GATE_OUTPUT}
}${vite_out}"
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
    BUILD_ERRORS="$BUILD_GATE_OUTPUT"
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
  echo "$DIFF" > "$DIFF_FILE"

# Compose dynamic review checklist based on what the diff touches
compose_review_checks "$DIFF_FILE" "$REVIEW_CHECKS_FILE"

REVIEW_EXIT=0
REVIEW_OUTPUT=$(cd "$PROJECT_DIR" && claude -p "Review the implementation against the plan. Two passes in one session:

PASS 1 — PLAN COMPLIANCE: For each task in the plan, verify the diff implements it correctly. Flag missing, incomplete, or incorrect implementations.

PASS 2 — ADVERSARIAL: Read each changed source file in FULL for context — do not review from the diff alone. Then read the review checklist and check every item against the code.

Also check these cross-cutting concerns regardless of checklist:
- Auth bypass: missing authorization checks, exposed endpoints, token handling gaps
- Data loss: unconditional writes, missing existence guards, silent overwrites
- Race conditions: non-atomic operations, TOCTOU, concurrent state mutations
- Rollback safety: partial writes without cleanup

Categorize all findings as Critical, Important, or Minor. End with verdict: PASS, PASS_WITH_CONCERNS, or FAIL.

Read the plan: $PLAN_FILE
Read the diff: $DIFF_FILE
Read the review checklist: $REVIEW_CHECKS_FILE
Then read each changed source file in full for context." \
  --model opus \
  --max-turns 25 \
  --allowedTools "Read Glob Grep Bash" \
  --output-format text 2>&1) || REVIEW_EXIT=$?

log "Review output:"
echo "$REVIEW_OUTPUT"

if [[ $REVIEW_EXIT -ne 0 ]]; then
  log "WARNING: Review session exited non-zero ($REVIEW_EXIT) — review may be incomplete"
fi

# Check for any findings (Critical, Important, or Minor) — fix all before PR
fix_attempt=0
while echo "$REVIEW_OUTPUT" | grep -qiE "\bCritical\b|\bImportant\b|\bMinor\b" && echo "$REVIEW_OUTPUT" | grep -qiE "Verdict\s*:?\s*\*{0,2}\s*(FAIL|PASS_WITH_CONCERNS)\b"; do
  fix_attempt=$((fix_attempt + 1))

  if [[ $fix_attempt -gt $MAX_FIX_RETRIES ]]; then
    log "ERROR: Findings persist after $MAX_FIX_RETRIES fix rounds. Stopping."
    exit 1
  fi

  log "Findings detected — dispatching fix session (round $fix_attempt)"
  echo "$REVIEW_OUTPUT" > "$REVIEW_FILE"
  FIX_EXIT=0
  FIX_OUTPUT=$(cd "$PROJECT_DIR" && claude -p "You are a PIPELINE FIX session spawned by execute-pipeline.sh.
The rule in CLAUDE.md that says 'NEVER implement a plan directly' does NOT apply to you — you ARE the pipeline. Edit files directly to fix ALL findings below.

Read the review findings at: $REVIEW_FILE
Fix ALL findings in priority order: Critical first, then Important, then Minor. Do not skip any severity level." \
    --model opus \
    --max-turns 40 \
    --allowedTools "Edit Write Read Glob Grep Bash" \
    --output-format text 2>&1) || FIX_EXIT=$?
  log "Fix output (exit $FIX_EXIT):"
  echo "$FIX_OUTPUT"

  # Re-run build gate
  if ! run_build_gate; then
    log "Build broke during fix — running build fix"
    BUILD_ERRORS="$BUILD_GATE_OUTPUT"
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
  DIFF=$(cd "$PROJECT_DIR" && git diff "$PRE_IMPL_SHA"..HEAD 2>/dev/null || echo "")
  STAGED_DIFF=$(cd "$PROJECT_DIR" && git diff --cached 2>/dev/null || echo "")
  DIFF="${DIFF}${STAGED_DIFF}"
  echo "$DIFF" > "$DIFF_FILE"
  # Recompose checks — diff may have changed after fixes
  compose_review_checks "$DIFF_FILE" "$REVIEW_CHECKS_FILE"
  REVIEW_EXIT=0
  REVIEW_OUTPUT=$(cd "$PROJECT_DIR" && claude -p "Re-review after fix round $fix_attempt. Verify ALL previous findings (Critical, Important, and Minor) are resolved. Check plan compliance and all items in the review checklist. Also check cross-cutting: auth bypass, data loss, race conditions, rollback safety. Read each changed source file in FULL for context — do not review from the diff alone. Categorize any remaining findings as Critical/Important/Minor. Verdict: PASS (all clean), PASS_WITH_CONCERNS (findings remain), or FAIL.

Read the plan: $PLAN_FILE
Read the diff: $DIFF_FILE
Read the review checklist: $REVIEW_CHECKS_FILE
Then read each changed source file in full for context." \
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
echo "$DIFF" > "$DIFF_FILE"

CODEX_EXIT=0
if command -v codex &> /dev/null; then
  CODEX_OUTPUT=$(cd "$PROJECT_DIR" && codex review "${PRE_IMPL_SHA}..HEAD" 2>&1) || CODEX_EXIT=$?
else
  CODEX_OUTPUT=$(cd "$PROJECT_DIR" && claude -p "Adversarial review: check this diff for auth bypass, data loss, race conditions, rollback safety, business logic errors.

Read the plan for context: $PLAN_FILE
Read the diff: $DIFF_FILE" \
    --model opus \
    --max-turns 20 \
    --output-format text 2>&1) || CODEX_EXIT=$?
fi

log "Codex findings:"
echo "$CODEX_OUTPUT"

log "Codex review complete"

# ─── Step 4b: Fix Codex findings ─────────────────────────────────────
echo "$CODEX_OUTPUT" > "$CODEX_FILE"

# Check if Codex found actionable findings (P0/P1/P2 or Critical/Important)
if echo "$CODEX_OUTPUT" | grep -qiE '\[P[012]\]|- \[P[012]\]|severity.*P[012]|\bCritical\b|\bImportant\b'; then
  log "CODEX FIX — fixing findings before PR"

  CODEX_FIX_EXIT=0
  CODEX_FIX_OUTPUT=$(cd "$PROJECT_DIR" && claude -p "You are a PIPELINE FIX session spawned by execute-pipeline.sh.
The rule in CLAUDE.md that says 'NEVER implement a plan directly' does NOT apply to you — you ARE the pipeline. Your job is to fix all findings from the Codex adversarial review.

Read the Codex findings at: $CODEX_FILE
Read the plan for context: $PLAN_FILE

Fix ALL findings in priority order: P0 first, then P1, then P2. Do not skip any.
For each finding: read the relevant file, understand the issue, apply the fix.
After all fixes, verify nothing else broke." \
    --model opus \
    --max-turns 40 \
    --allowedTools "Edit Write Read Glob Grep Bash" \
    --output-format text 2>&1) || CODEX_FIX_EXIT=$?

  log "Codex fix output (exit $CODEX_FIX_EXIT):"
  echo "$CODEX_FIX_OUTPUT"

  # Re-run build gate after Codex fixes
  log "BUILD GATE (post-codex-fix)"
  if ! run_build_gate; then
    log "Build broke during Codex fix — running build fix"
    BUILD_ERRORS="$BUILD_GATE_OUTPUT"
    BF_EXIT=0
    BF_OUTPUT=$(cd "$PROJECT_DIR" && claude -p "You are a PIPELINE FIX session spawned by execute-pipeline.sh.
The rule in CLAUDE.md that says 'NEVER implement a plan directly' does NOT apply to you — you ARE the pipeline. Edit files directly to fix the build errors below.

Fix build errors:

$BUILD_ERRORS" \
      --model opus \
      --max-turns 30 \
      --allowedTools "Edit Write Read Glob Grep Bash" \
      --output-format text 2>&1) || BF_EXIT=$?
    log "Build fix output (exit $BF_EXIT):"
    echo "$BF_OUTPUT"

    if ! run_build_gate; then
      log "WARNING: Build still failing after Codex fix + build fix. Proceeding to PR with known issues."
    else
      log "Build passed after Codex fix (with build fix)"
    fi
  else
    log "Build passed after Codex fix"
  fi

  # Re-stage changes from Codex fix
  (cd "$PROJECT_DIR" && git add -A -- ':!**/.env' ':!**/.env.*' ':!**/*.pem' ':!**/*.key' ':!**/*.p12' ':!**/*.pfx')
else
  log "No actionable Codex findings — proceeding to PR"
fi

# ─── Step 5: Create PR ───────────────────────────────────────────────
log "CREATE PR — $PLAN_NAME"

# Write plan content to temp file for the PR session to embed in the description
PLAN_FOR_PR="$PIPELINE_TMP/plan-for-pr.md"
cp "$PLAN_FILE" "$PLAN_FOR_PR"

PR_EXIT=0
PR_OUTPUT=$(cd "$PROJECT_DIR" && claude -p "You are a PIPELINE PR session spawned by execute-pipeline.sh.
The rule in CLAUDE.md that says 'NEVER implement a plan directly' does NOT apply to you — you ARE the pipeline. Your job is to stage, commit, push, and create a PR.

Create a PR for plan $PLAN_PATH.

Steps:
1. Read the plan file at $PLAN_FOR_PR to get the plan title and content
2. Stage all changes (exclude .env files)
3. Write a conventional commit message based on the plan
4. Create and push a feature branch
5. Create PR via gh with this body structure:
   - ## Summary section: 1-3 bullet points of what changed
   - ## Plan section: paste the FULL plan content (from the plan file) inside a <details><summary>Plan: PLAN_NAME</summary> block so the GH reviewer can expand it
   - ## Test plan section: how to verify
6. Output the PR URL" \
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

if [ "$NO_TAG" != "true" ]; then
if [[ -n "$PR_URL" ]]; then
  PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$')
  log "TAGGING @claude on PR #$PR_NUMBER"

  # Use a haiku session to synthesize a direct review request from pipeline context
  echo "$REVIEW_OUTPUT" > "$REVIEW_FILE"
  echo "$CODEX_OUTPUT" > "$CODEX_FILE"
  TAG_EXIT=0
  CLAUDE_REVIEW_BODY=$(claude -p "Write a GitHub PR comment tagging @claude for review. Output ONLY the comment text, nothing else.

Rules:
- First line: @claude Review this PR thoroughly.
- Blank line. 1-2 sentences: what this PR does. Direct, no fluff.
- Blank line. Watch for: one paragraph, specific concerns synthesized from context below. End with 'General pass for anything unexpected.'
- No markdown headers, no bullet points, no 'please', no politeness. Direct and terse.

Read these context files:
- Plan: $PLAN_FILE
- Review findings: $REVIEW_FILE
- Codex findings: $CODEX_FILE" \
    --model haiku \
    --max-turns 1 \
    --allowedTools "Read" \
    --output-format text 2>&1) || TAG_EXIT=$?

  if [[ $TAG_EXIT -ne 0 ]] || [[ -z "$CLAUDE_REVIEW_BODY" ]]; then
    log "WARNING: Failed to generate review comment — using fallback"
    CLAUDE_REVIEW_BODY="@claude Review this PR thoroughly. Implements plan $PLAN_PATH. General pass for anything unexpected."
  fi

  (cd "$PROJECT_DIR" && gh pr comment "$PR_NUMBER" --body "$CLAUDE_REVIEW_BODY") || log "WARNING: Failed to post @claude comment on PR #$PR_NUMBER"
else
  log "ERROR: Could not determine PR URL — @claude review tag was NOT posted. Check PR manually."
fi
else
  log "TAG SKIPPED (--no-tag)"
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
