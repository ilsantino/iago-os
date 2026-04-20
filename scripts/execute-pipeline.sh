#!/usr/bin/env bash
set -euo pipefail

# iaGO-OS — Cross-session execute pipeline (no n8n required)
#
# Usage: ./scripts/execute-pipeline.sh --plan .iago/plans/plan-01.md --project-dir /path/to/project
#
# Runs the full pipeline: stress test → implement → build → review → codex → fix codex → PR → tag @claude
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
LOCK_DIR=""
trap 'rm -rf "$PIPELINE_TMP"; [[ -n "${LOCK_DIR:-}" && -f "${LOCK_DIR}/pid" && "$(cat "${LOCK_DIR}/pid" 2>/dev/null)" == "$$" ]] && rm -rf "$LOCK_DIR"' EXIT

# ─── Per-project pipeline lock ───────────────────────────────────────
# Prevents concurrent pipelines on the same project-dir — use a separate
# worktree for parallel work (see iago-wt shell helper). Lock is a
# directory (atomic mkdir) holding the owner PID; liveness-checked on
# collision so crashed pipelines don't block retries.
LOCK_DIR="$PROJECT_DIR/.iago/state/.pipeline.lock.d"
mkdir -p "$PROJECT_DIR/.iago/state"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  LOCK_PID=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")
  LOCK_PLAN=$(cat "$LOCK_DIR/plan" 2>/dev/null || echo "unknown")
  LOCK_STARTED=$(cat "$LOCK_DIR/started" 2>/dev/null || echo "unknown")
  if [[ -n "$LOCK_PID" ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "ERROR: Another pipeline is already running in this project-dir." >&2
    echo "  Holder PID:  $LOCK_PID" >&2
    echo "  Plan:        $LOCK_PLAN" >&2
    echo "  Started:     $LOCK_STARTED" >&2
    echo "  Project-dir: $PROJECT_DIR" >&2
    echo "" >&2
    echo "Use an isolated worktree for parallel work (iago-wt <slug>)." >&2
    LOCK_DIR=""  # don't let EXIT trap clean up someone else's lock
    exit 1
  fi
  echo "WARNING: Removing stale pipeline lock (PID $LOCK_PID not running)" >&2
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" || { echo "ERROR: Lock acquisition failed after stale cleanup" >&2; LOCK_DIR=""; exit 1; }
fi
echo "$$" > "$LOCK_DIR/pid"
echo "$PLAN_PATH" > "$LOCK_DIR/plan"
date -u +%Y-%m-%dT%H:%M:%SZ > "$LOCK_DIR/started"

PLAN_FILE="$PROJECT_DIR/$PLAN_PATH"
DIFF_FILE="$PIPELINE_TMP/diff.txt"
REVIEW_FILE="$PIPELINE_TMP/review.txt"
CODEX_FILE="$PIPELINE_TMP/codex.txt"
STRESS_FILE="$PIPELINE_TMP/stress.txt"
STRESS_FINDINGS="$PIPELINE_TMP/stress-findings.txt"
REVIEW_CHECKS_FILE="$PIPELINE_TMP/review-checks.md"
CHECKS_DIR="$SCRIPT_DIR/review-checks"

log() { echo "[$(date '+%H:%M:%S')] $1"; }

run_claude() {
  local timeout_secs="$1"; shift
  timeout "$timeout_secs" claude "$@"
  local exit_code=$?
  if [[ $exit_code -eq 124 ]]; then
    log "ERROR: claude session timed out after ${timeout_secs}s"
    return 1
  fi
  return $exit_code
}

# Compose review checklist — loads ALL domain modules.
# The reviewer LLM decides which domains are relevant based on diff + plan.
compose_review_checks() {
  local diff_file="$1"
  local output_file="$2"

  # Concatenate ALL check modules — the reviewer LLM decides which apply.
  # Baseline first, then domain modules alphabetically.
  cat "$CHECKS_DIR/baseline.md" > "$output_file"
  for module in "$CHECKS_DIR"/*.md; do
    [[ "$(basename "$module")" == "baseline.md" ]] && continue
    echo "" >> "$output_file"
    cat "$module" >> "$output_file"
  done

  log "  review-checks: all modules loaded ($(wc -l < "$output_file") lines)"
}

# ─── Step 0: Stress Test ─────────────────────────────────────────────
# Skip if plan already has a "## Stress Test" section (tested during /iago-plan or /iago-stress)
if grep -q '## Stress Test' "$PLAN_FILE"; then
  log "STRESS TEST — skipped (plan already stress-tested)"
else
  log "STRESS TEST — $PLAN_NAME"

  STRESS_EXIT=0
  STRESS_OUTPUT=$(cd "$PROJECT_DIR" && run_claude 600 -p "You are a PIPELINE STRESS TEST session. Your job is to adversarially review a PLAN — not code. Find flaws in the approach BEFORE implementation begins.

Read the plan: $PLAN_FILE
Read CLAUDE.md for project conventions.
Read any source files referenced in the plan to understand existing code.

Check these dimensions:

1. PRECISION — Could two developers read this plan and write meaningfully different code? Flag vague requirements, ambiguous scope, unspecified behavior. Quote the vague line and state what's missing.

2. EDGE CASES — What inputs, states, or sequences would break the proposed approach? Think about: empty/null data, concurrent access, error paths, boundary values, first-use vs returning-user, network failures.

3. CONTRADICTIONS — Does the plan conflict with patterns already in the codebase, rules in CLAUDE.md, or architectural decisions? Read the relevant source files to verify.

4. SIMPLER ALTERNATIVES — Is there a fundamentally different approach that achieves the same goal with less complexity, fewer files, or better alignment with existing patterns? Only flag if the alternative is clearly better, not just different.

5. MISSING ACCEPTANCE CRITERIA — How would you verify the implementation works? If the plan doesn't specify, the implementer will guess. Flag gaps.

Output format:
- List findings grouped by dimension (skip dimensions with no findings)
- For each finding: quote the relevant plan text, state the issue, suggest a fix
- After all findings, emit a structured block with these exact delimiters (exactly once, at the end of your response):

---FINDINGS START---
1. [finding summary — one line per finding, numbered]
---FINDINGS END---
Emit this block exactly once, at the end of your response. Do not use these delimiters anywhere else in your output.

This block is machine-parsed. Every finding MUST appear as a numbered line inside the delimiters, even if already described above. If you have no findings, emit the delimiters with no lines between them.

- End with exactly one verdict line:

VERDICT: PROCEED — no significant issues found
VERDICT: PROCEED_WITH_NOTES — issues found but implementation can proceed with awareness
VERDICT: BLOCK — critical flaw that would make implementation fundamentally wrong

Output the verdict line as plain text — no markdown bold, no backticks, no headers." \
    --model opus \
    --max-turns 15 \
    --allowedTools "Read Glob Grep" \
    --output-format text 2>&1) || STRESS_EXIT=$?

  log "Stress test output:"
  echo "$STRESS_OUTPUT"

  # Extract verdict
  STRESS_VERDICT=$(echo "$STRESS_OUTPUT" | sed 's/\*//g' | grep -oE 'VERDICT:\s*(PROCEED|PROCEED_WITH_NOTES|BLOCK)' | tail -1 | sed 's/VERDICT:\s*//')

  if [[ "$STRESS_VERDICT" == "BLOCK" ]]; then
    log "ERROR: Stress test BLOCKED the plan. Review findings above and revise the plan."
    exit 1
  fi

  if [[ "$STRESS_VERDICT" == "PROCEED_WITH_NOTES" ]]; then
    log "Stress test passed with notes — forwarding to implementation session"
    echo "$STRESS_OUTPUT" > "$STRESS_FILE"
  fi

  if [[ -z "$STRESS_VERDICT" ]]; then
    log "WARNING: Could not extract stress test verdict — proceeding with caution"
    echo "$STRESS_OUTPUT" > "$STRESS_FILE"
  fi

  # Extract structured findings between delimiters into a separate file
  if [[ -f "$STRESS_FILE" ]]; then
    EXTRACTED=$(sed -n '/^[[:space:]]*---FINDINGS START---[[:space:]]*$/,/^[[:space:]]*---FINDINGS END---[[:space:]]*$/{ /---FINDINGS/d; p; }' "$STRESS_FILE")
    if [[ -n "$EXTRACTED" ]]; then
      echo "$EXTRACTED" > "$STRESS_FINDINGS"
      log "Stress findings extracted ($(wc -l < "$STRESS_FINDINGS") lines)"
    else
      log "WARNING: Could not extract structured findings (delimiters not found) — using full stress output"
      cp "$STRESS_FILE" "$STRESS_FINDINGS"
    fi
  fi
fi

# ─── Step 1: Implement ───────────────────────────────────────────────
log "IMPLEMENT — $PLAN_NAME"

PRE_IMPL_SHA=$(cd "$PROJECT_DIR" && git rev-parse HEAD) || {
  log "ERROR: Could not capture pre-impl SHA. Is $PROJECT_DIR a git repo?"
  exit 1
}

# Build impl prompt — include stress test notes if they exist
IMPL_STRESS_CONTEXT=""
if [[ -f "$STRESS_FINDINGS" ]]; then
  IMPL_STRESS_CONTEXT="
MANDATORY: Read the stress-test findings at: $STRESS_FINDINGS
These are REQUIREMENTS, not suggestions. For each finding you MUST either:
1. Implement a fix that addresses the concern, OR
2. Add a code comment explaining why the concern does not apply to this implementation
Do not silently ignore any finding. The reviewer will check each one."
fi

IMPL_EXIT=0
IMPL_OUTPUT=$(cd "$PROJECT_DIR" && run_claude 1800 -p "You are a PIPELINE IMPLEMENTATION session spawned by execute-pipeline.sh.
The rule in CLAUDE.md that says 'NEVER implement a plan directly' does NOT apply to you — you ARE the pipeline. Your job is to write the code specified in the plan below. Use Edit/Write tools to create and modify files. Do not invoke any /iago- skills. Do not defer to another agent.

Read the plan file at: $PLAN_FILE${IMPL_STRESS_CONTEXT}
Execute every task exactly. Create all files specified. End your response with DONE or BLOCKED." \
  --model opus \
  --max-turns "${IAGO_IMPL_MAX_TURNS:-80}" \
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
    BUILD_ERRORS_FILE="$PIPELINE_TMP/build-errors.txt"
    echo "$BUILD_ERRORS" > "$BUILD_ERRORS_FILE"
    FIX_EXIT=0
    FIX_OUTPUT=$(cd "$PROJECT_DIR" && run_claude 600 -p "You are a PIPELINE FIX session spawned by execute-pipeline.sh.
The rule in CLAUDE.md that says 'NEVER implement a plan directly' does NOT apply to you — you ARE the pipeline. Edit files directly to fix the errors below.

Read the build errors at: $BUILD_ERRORS_FILE" \
      --model opus \
      --max-turns 30 \
      --allowedTools "Edit Write Read Glob Grep Bash" \
      --output-format text 2>&1) || FIX_EXIT=$?
    log "Build fix output (exit $FIX_EXIT):"
    echo "$FIX_OUTPUT"
  fi
done

# ─── Step 2b: Console gate ───────────────────────────────────────────
# Catches runtime console errors/warnings via Playwright (zero token cost).
# Skipped if project has no Vite config or Playwright is not installed.
MAX_CONSOLE_RETRIES=2
CONSOLE_ERRORS_FILE="$PIPELINE_TMP/console-errors.json"

if $HAS_VITE; then
  console_attempt=0
  console_passed=false

  while [[ $console_attempt -lt $MAX_CONSOLE_RETRIES ]]; do
    log "CONSOLE GATE — attempt $((console_attempt + 1))"

    CONSOLE_EXIT=0
    CONSOLE_OUTPUT=$(cd "$PROJECT_DIR" && node "$SCRIPT_DIR/console-check.mjs" --project-dir "$PROJECT_DIR" 2>&1) || CONSOLE_EXIT=$?

    # Exit 0 = clean, exit 2 = skipped (no playwright), exit 1 = errors found
    if [[ $CONSOLE_EXIT -eq 0 ]]; then
      log "Console gate passed — no runtime errors"
      console_passed=true
      break
    elif [[ $CONSOLE_EXIT -eq 2 ]]; then
      log "Console gate skipped (Playwright not available or preview failed)"
      console_passed=true
      break
    else
      echo "$CONSOLE_OUTPUT" > "$CONSOLE_ERRORS_FILE"
      log "Console gate found errors:"
      echo "$CONSOLE_OUTPUT"
      console_attempt=$((console_attempt + 1))

      if [[ $console_attempt -ge $MAX_CONSOLE_RETRIES ]]; then
        log "WARNING: Console gate failed after $MAX_CONSOLE_RETRIES attempts — proceeding to review (errors will surface there)"
        break
      fi

      log "Dispatching console fix session"
      CFIX_EXIT=0
      CFIX_OUTPUT=$(cd "$PROJECT_DIR" && run_claude 600 -p "You are a PIPELINE FIX session spawned by execute-pipeline.sh.
The rule in CLAUDE.md that says 'NEVER implement a plan directly' does NOT apply to you — you ARE the pipeline. Edit files directly to fix the console errors below.

These are browser console errors/warnings captured by Playwright after navigating the app routes. Fix the root causes — do not suppress with try/catch or console filtering.

Read the console errors at: $CONSOLE_ERRORS_FILE
Read the plan for context at: $PLAN_FILE" \
        --model opus \
        --max-turns 30 \
        --allowedTools "Edit Write Read Glob Grep Bash" \
        --output-format text 2>&1) || CFIX_EXIT=$?
      log "Console fix output (exit $CFIX_EXIT):"
      echo "$CFIX_OUTPUT"

      # Re-run build gate after fix (fix might have broken the build)
      log "BUILD GATE (post-console-fix)"
      if ! run_build_gate; then
        log "ERROR: Build broke during console fix. Stopping."
        exit 1
      fi
    fi
  done
else
  log "CONSOLE GATE — skipped (no Vite config)"
fi

# ─── Step 3: Review ──────────────────────────────────────────────────
log "REVIEW — $PLAN_NAME"

# Stage all new/modified files so they appear in the diff
(cd "$PROJECT_DIR" && git add -A -- ':!**/.env' ':!**/.env.*' ':!**/*.pem' ':!**/*.key' ':!**/*.p12' ':!**/*.pfx')

# Diff: committed changes since pre-impl + staged working tree changes
DIFF=$(cd "$PROJECT_DIR" && git diff "$PRE_IMPL_SHA"..HEAD 2>/dev/null || echo "")
STAGED_DIFF=$(cd "$PROJECT_DIR" && git diff --cached 2>/dev/null || echo "")
COMBINED_DIFF="${DIFF}${STAGED_DIFF}"

if [[ -z "$COMBINED_DIFF" ]]; then
  log "WARNING: Implementation produced no changes (empty diff). No changes to review."
  exit 1
else
  DIFF="$COMBINED_DIFF"
  echo "$DIFF" > "$DIFF_FILE"

# Compose dynamic review checklist based on what the diff touches
compose_review_checks "$DIFF_FILE" "$REVIEW_CHECKS_FILE"

# NOTE: Stress test enforcement is embedded in the review prompt (not the checklist file)
# because it requires conditional file references ($STRESS_FINDINGS / $STRESS_FILE) that
# are pipeline-runtime values — the static checklist has no access to these paths.

# Build stress enforcement block — only included when a stress file actually exists
STRESS_ENFORCEMENT_BLOCK=""
if [[ -f "$STRESS_FINDINGS" ]] || [[ -f "$STRESS_FILE" ]]; then
  STRESS_ENFORCEMENT_BLOCK="
STRESS TEST ENFORCEMENT: If a stress-test findings file exists, read it. For each finding, verify the implementation either:
(a) addresses the concern in code, or
(b) has a code comment justifying why it doesn't apply.
Flag any unaddressed stress-test finding as Important."
fi

REVIEW_EXIT=0
REVIEW_OUTPUT=$(cd "$PROJECT_DIR" && run_claude 900 -p "Review the implementation against the plan. Three passes in one session:

PASS 1 — PLAN COMPLIANCE: For each task in the plan, verify the diff implements it correctly. Flag missing, incomplete, or incorrect implementations.

PASS 2 — DOMAIN ROUTING: Read the review checklist — it contains ALL domain modules (react, backend, auth, api, infra, i18n). Based on the diff and plan, identify which domains are RELEVANT to these changes. State which domains you selected and why. Skip domains that do not apply — do not force-fit checks.

PASS 3 — ADVERSARIAL: Read each changed source file in FULL for context — do not review from the diff alone. Apply the checks from your selected domains thoroughly. Also check these cross-cutting concerns REGARDLESS of domain selection:
- Auth bypass: missing authorization checks, exposed endpoints, token handling gaps
- Data loss: unconditional writes, missing existence guards, silent overwrites
- Race conditions: non-atomic operations, TOCTOU, concurrent state mutations
- Rollback safety: partial writes without cleanup

SEVERITY FLOORS: Some checks in the modules have minimum severity levels (marked ALWAYS Critical or ALWAYS Important). You MUST NOT downgrade these below the stated floor. Other findings use your judgment.$STRESS_ENFORCEMENT_BLOCK

Categorize all findings as Critical, Important, or Minor. End with verdict: PASS, PASS_WITH_CONCERNS, or FAIL.

Read the plan: $PLAN_FILE
Read the diff: $DIFF_FILE
Read the review checklist: $REVIEW_CHECKS_FILE$(if [[ -f "$STRESS_FINDINGS" ]]; then echo "
Read stress-test findings: $STRESS_FINDINGS"; fi)
Then read each changed source file in full for context." \
  --model opus \
  --max-turns "${IAGO_REVIEW_MAX_TURNS:-35}" \
  --allowedTools "Read Glob Grep Bash" \
  --output-format text 2>&1) || REVIEW_EXIT=$?

log "Review output:"
echo "$REVIEW_OUTPUT"

if [[ $REVIEW_EXIT -ne 0 ]]; then
  log "WARNING: Review session exited non-zero ($REVIEW_EXIT) — review may be incomplete"
fi

# Check for any findings (Critical, Important, or Minor) — fix all before PR
fix_attempt=0
while echo "$REVIEW_OUTPUT" | grep -qiE "Verdict\s*:?\s*\*{0,2}\s*(FAIL|PASS_WITH_CONCERNS)\b"; do
  fix_attempt=$((fix_attempt + 1))

  if [[ $fix_attempt -gt $MAX_FIX_RETRIES ]]; then
    log "ERROR: Findings persist after $MAX_FIX_RETRIES fix rounds. Stopping."
    exit 1
  fi

  log "Findings detected — dispatching fix session (round $fix_attempt)"
  echo "$REVIEW_OUTPUT" > "$REVIEW_FILE"
  FIX_EXIT=0
  FIX_OUTPUT=$(cd "$PROJECT_DIR" && run_claude 900 -p "You are a PIPELINE FIX session spawned by execute-pipeline.sh.
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
    BUILD_ERRORS_FILE="$PIPELINE_TMP/build-errors.txt"
    echo "$BUILD_ERRORS" > "$BUILD_ERRORS_FILE"
    FIX_OUTPUT=$(cd "$PROJECT_DIR" && run_claude 600 -p "You are a PIPELINE FIX session spawned by execute-pipeline.sh.
The rule in CLAUDE.md that says 'NEVER implement a plan directly' does NOT apply to you — you ARE the pipeline. Edit files directly to fix the build errors below.

Read the build errors at: $BUILD_ERRORS_FILE" \
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
  REVIEW_OUTPUT=$(cd "$PROJECT_DIR" && run_claude 900 -p "Re-review after fix round $fix_attempt. Verify ALL previous findings (Critical, Important, and Minor) are resolved.

DOMAIN ROUTING: The review checklist contains ALL domain modules. Based on the diff and plan, identify which domains are relevant. Apply only those checks — do not force-fit irrelevant domains.

SEVERITY FLOORS: Some checks have minimum severity levels (marked ALWAYS Critical or ALWAYS Important). You MUST NOT downgrade these below the stated floor.

Also check cross-cutting regardless of domain: auth bypass, data loss, race conditions, rollback safety. Read each changed source file in FULL for context — do not review from the diff alone. Categorize any remaining findings as Critical/Important/Minor. Verdict: PASS (all clean), PASS_WITH_CONCERNS (findings remain), or FAIL.$STRESS_ENFORCEMENT_BLOCK

Read the plan: $PLAN_FILE
Read the diff: $DIFF_FILE
Read the review checklist: $REVIEW_CHECKS_FILE$(if [[ -f "$STRESS_FINDINGS" ]]; then echo "
Read stress-test findings: $STRESS_FINDINGS"; fi)
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

# Claude adversarial fallback — shared by all non-Codex paths
run_claude_adversarial() {
  run_claude 600 -p "Adversarial review: check this diff for auth bypass, data loss, race conditions, rollback safety, business logic errors.

Read the plan for context: $PLAN_FILE
Read the diff: $DIFF_FILE" \
    --model opus \
    --max-turns 20 \
    --allowedTools "Read Glob Grep" \
    --output-format text 2>&1
}

# Resolve codex-companion path — prefer stable marketplace, fall back to versioned cache
CODEX_COMPANION=""
_companion_stable="$HOME/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs"
if [[ -f "$_companion_stable" ]]; then
  CODEX_COMPANION="$_companion_stable"
else
  # Sort in reverse to prefer the newest (highest) version directory
  while IFS= read -r _companion_cached; do
    if [[ -f "$_companion_cached" ]]; then
      CODEX_COMPANION="$_companion_cached"
      break
    fi
  done < <(printf '%s\n' "$HOME"/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs | sort -rV)
fi

CODEX_EXIT=0
CODEX_OUTPUT=""
USED_CODEX=false
USED_CLAUDE_FALLBACK=false

if command -v node &> /dev/null && [[ -n "$CODEX_COMPANION" ]]; then
  log "Running codex-companion adversarial-review (GPT-5.4)"
  CODEX_OUTPUT=$(cd "$PROJECT_DIR" && node "$CODEX_COMPANION" adversarial-review --base "$PRE_IMPL_SHA" --wait 2>&1) || CODEX_EXIT=$?
  USED_CODEX=true
elif command -v codex &> /dev/null; then
  log "Running codex review (GPT-5.4) — companion plugin not found, using raw CLI"
  CODEX_OUTPUT=$(cd "$PROJECT_DIR" && codex review "${PRE_IMPL_SHA}..HEAD" 2>&1) || CODEX_EXIT=$?
  USED_CODEX=true
fi

# Fallback: Claude adversarial if Codex not used or failed at runtime
if [[ "$USED_CODEX" != "true" ]]; then
  CODEX_OUTPUT=$(cd "$PROJECT_DIR" && run_claude_adversarial) || CODEX_EXIT=$?
  USED_CLAUDE_FALLBACK=true
elif [[ $CODEX_EXIT -ne 0 ]]; then
  log "WARNING: Codex review failed (exit $CODEX_EXIT)"
  log "Codex raw output: $CODEX_OUTPUT"
  # If output contains actual findings, keep them despite non-zero exit
  if echo "$CODEX_OUTPUT" | grep -qiE '\[P[012]\]|\bCritical\b|\bImportant\b|\[high\]|\[medium\]|^Verdict: needs-attention'; then
    log "Codex failed but produced findings — keeping findings"
    CODEX_EXIT=0
  else
    log "No findings in Codex output — falling back to Claude adversarial"
    CODEX_EXIT=0
    CODEX_OUTPUT=$(cd "$PROJECT_DIR" && run_claude_adversarial) || CODEX_EXIT=$?
    USED_CLAUDE_FALLBACK=true
  fi
fi

log "Codex findings:"
echo "$CODEX_OUTPUT"

if [[ $CODEX_EXIT -ne 0 ]]; then
  log "WARNING: Adversarial review failed (exit $CODEX_EXIT)"
  CODEX_OUTPUT="Adversarial review unavailable (exit $CODEX_EXIT). No cross-model findings."
fi

log "Codex review complete"

# ─── Step 4b: Fix Codex findings ─────────────────────────────────────
echo "$CODEX_OUTPUT" > "$CODEX_FILE"

# Check if Codex found actionable findings.
# When Claude fallback ran, skip \bCritical\b|\bImportant\b — prose like "No Critical issues found"
# would spuriously trigger a fix session reading clean output (false positive, ~40 wasted turns).
_codex_word_patterns='\bCritical\b|\bImportant\b'
_has_findings=false
if echo "$CODEX_OUTPUT" | grep -qiE '\[P[012]\]|- \[P[012]\]|severity.*P[012]|\[high\]|\[medium\]|^Verdict: needs-attention'; then
  _has_findings=true
elif [[ "$USED_CLAUDE_FALLBACK" != "true" ]] && echo "$CODEX_OUTPUT" | grep -qiE "$_codex_word_patterns"; then
  _has_findings=true
fi
if [[ "$_has_findings" == "true" ]]; then
  log "CODEX FIX — fixing findings before PR"

  CODEX_FIX_EXIT=0
  CODEX_FIX_OUTPUT=$(cd "$PROJECT_DIR" && run_claude 900 -p "You are a PIPELINE FIX session spawned by execute-pipeline.sh.
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
    BUILD_ERRORS_FILE="$PIPELINE_TMP/build-errors.txt"
    echo "$BUILD_ERRORS" > "$BUILD_ERRORS_FILE"
    BF_OUTPUT=$(cd "$PROJECT_DIR" && run_claude 600 -p "You are a PIPELINE FIX session spawned by execute-pipeline.sh.
The rule in CLAUDE.md that says 'NEVER implement a plan directly' does NOT apply to you — you ARE the pipeline. Edit files directly to fix the build errors below.

Read the build errors at: $BUILD_ERRORS_FILE" \
      --model opus \
      --max-turns 30 \
      --allowedTools "Edit Write Read Glob Grep Bash" \
      --output-format text 2>&1) || BF_EXIT=$?
    log "Build fix output (exit $BF_EXIT):"
    echo "$BF_OUTPUT"

    if ! run_build_gate; then
      log "ERROR: Build still failing after Codex fix. Stopping pipeline."
      exit 1
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
PR_OUTPUT=$(cd "$PROJECT_DIR" && run_claude "${IAGO_PR_TIMEOUT:-600}" -p "You are a PIPELINE PR session spawned by execute-pipeline.sh.
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

  # Sonnet synthesizes a context-rich review request from plan + diff
  TAG_EXIT=0
  CLAUDE_REVIEW_BODY=$(cd "$PROJECT_DIR" && run_claude 120 -p "Write a GitHub PR comment tagging @claude for review. Output ONLY the comment text, nothing else.

Structure (follow exactly):
1. First line: @claude Review this PR thoroughly.
2. Blank line. Context: 2-3 sentences summarizing what this PR implements and why (synthesize from the plan). Tell the reviewer the full plan is embedded in the PR description under the Plan section.
3. Blank line. Focus areas: based on the diff, name the specific domains touched (auth, API, React components, backend, infra, i18n) and what patterns to watch for in each. Be concrete — 'auth token refresh flow in useAuth hook' not 'auth stuff.' Reference specific files or functions from the diff.
4. Blank line. Edge cases: any scenarios the local pipeline could not fully verify — integration effects across modules, runtime behavior under load, UX states (empty, error, loading), concurrency.
5. Blank line. End with: General pass for anything unexpected.

No markdown headers. No bullet points. No pleasantries. Direct and terse. Keep the entire comment under 300 words.

Read these context files:
- Plan: $PLAN_FILE
- Diff: $DIFF_FILE" \
    --model sonnet \
    --max-turns 3 \
    --allowedTools "Read" \
    --output-format text 2>&1) || TAG_EXIT=$?

  if [[ $TAG_EXIT -ne 0 ]] || [[ -z "$CLAUDE_REVIEW_BODY" ]]; then
    log "WARNING: Failed to generate review comment — using fallback"
    CLAUDE_REVIEW_BODY="@claude Review this PR thoroughly. Implements plan $PLAN_PATH. Full plan embedded in PR description under Plan section. General pass for anything unexpected."
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
