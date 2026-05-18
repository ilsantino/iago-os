#!/usr/bin/env bash
# Tests for scripts/check-clean-tree.sh
#
# Builds isolated mktemp git repos per test case; asserts exit code + key
# stdout/stderr substrings. Mirrors the harness pattern from
# scripts/lib/pipeline-telemetry.test.sh.
#
# Run: bash scripts/check-clean-tree.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SUT="$SCRIPT_DIR/check-clean-tree.sh"

if [[ ! -x "$SUT" ]]; then
  chmod +x "$SUT" 2>/dev/null || true
fi
if [[ ! -f "$SUT" ]]; then
  echo "FAIL: SUT not found at $SUT" >&2
  exit 1
fi

PASS=0
FAIL=0
TMPS=()

cleanup() {
  local d
  for d in "${TMPS[@]}"; do
    [[ -n "$d" && -d "$d" ]] && rm -rf "$d" 2>/dev/null || true
  done
}
trap cleanup EXIT

mk_repo() {
  local d
  d=$(mktemp -d -t iago-clean-tree.XXXXXX)
  TMPS+=("$d")
  (
    cd "$d"
    git init -q -b main 2>/dev/null || git init -q
    git config user.email test@example.com
    git config user.name test
    # Always add an ignore entry for .iago/state/ so the warning doesn't
    # contaminate stderr-sensitive assertions.
    echo '.iago/state/' > .gitignore
    echo 'seed' > seed.txt
    git add seed.txt .gitignore
    git commit -q -m "init"
  )
  echo "$d"
}

assert_eq() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "  PASS  $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label (expected: '$expected', got: '$actual')"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local label="$1"
  local needle="$2"
  local haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "  PASS  $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label (expected to contain '$needle', got: '$haystack')"
    FAIL=$((FAIL + 1))
  fi
}

# ─── Test 1: truly clean returns 0 ────────────────────────────────────
test_truly_clean_returns_0() {
  local repo
  repo=$(mk_repo)
  local out exit_code=0
  out=$(bash "$SUT" --project-dir "$repo" 2>/dev/null) || exit_code=$?
  assert_eq "truly clean — exit code" "0" "$exit_code"
  assert_contains "truly clean — stdout CLEAN" "CLEAN" "$out"
}

# ─── Test 2: dirty uncommitted returns 1 ──────────────────────────────
test_dirty_uncommitted_returns_1() {
  local repo
  repo=$(mk_repo)
  echo "changed" >> "$repo/seed.txt"
  local out exit_code=0
  out=$(bash "$SUT" --project-dir "$repo" 2>/dev/null) || exit_code=$?
  assert_eq "dirty uncommitted — exit code" "1" "$exit_code"
  assert_contains "dirty uncommitted — stdout DIRTY" "DIRTY" "$out"
}

# ─── Test 3: worktree dir ignored in lenient mode ─────────────────────
test_worktree_dir_ignored_lenient() {
  local repo
  repo=$(mk_repo)
  mkdir -p "$repo/.claude/worktrees/agent-xyz"
  echo "wt" > "$repo/.claude/worktrees/agent-xyz/foo.txt"
  local out exit_code=0
  out=$(bash "$SUT" --project-dir "$repo" 2>/dev/null) || exit_code=$?
  assert_eq "worktree-dir lenient — exit code" "0" "$exit_code"
  assert_contains "worktree-dir lenient — stdout CLEAN" "CLEAN" "$out"
}

# ─── Test 4: worktree dir caught in strict mode ───────────────────────
test_worktree_dir_caught_strict() {
  local repo
  repo=$(mk_repo)
  mkdir -p "$repo/.claude/worktrees/agent-xyz"
  echo "wt" > "$repo/.claude/worktrees/agent-xyz/foo.txt"
  local out exit_code=0
  out=$(bash "$SUT" --project-dir "$repo" --strict 2>/dev/null) || exit_code=$?
  assert_eq "worktree-dir strict — exit code" "1" "$exit_code"
  assert_contains "worktree-dir strict — stdout DIRTY" "DIRTY" "$out"
}

# ─── Test 5: gitignored files pass ────────────────────────────────────
test_gitignored_files_pass() {
  local repo
  repo=$(mk_repo)
  (
    cd "$repo"
    echo "*.tmp" >> .gitignore
    git add .gitignore
    git commit -q -m "ignore tmp"
    echo "tmpdata" > foo.tmp
  )
  local out exit_code=0
  out=$(bash "$SUT" --project-dir "$repo" 2>/dev/null) || exit_code=$?
  assert_eq "gitignored — exit code" "0" "$exit_code"
  assert_contains "gitignored — stdout CLEAN" "CLEAN" "$out"
}

# ─── Test 6: .iago/state/ filtered in lenient mode ────────────────────
test_iago_state_dir_filtered_lenient() {
  local repo
  repo=$(mk_repo)
  mkdir -p "$repo/.iago/state/pipeline-runs"
  echo '{"type":"test"}' > "$repo/.iago/state/pipeline-runs/test.ndjson"
  local out exit_code=0
  # .iago/state/ is in .gitignore (added by mk_repo) so it's already
  # excluded by git's own untracked-files=normal. The lenient-filter line
  # is belt-and-suspenders; the test verifies the end-to-end outcome.
  out=$(bash "$SUT" --project-dir "$repo" 2>/dev/null) || exit_code=$?
  assert_eq ".iago/state lenient — exit code" "0" "$exit_code"
  assert_contains ".iago/state lenient — stdout CLEAN" "CLEAN" "$out"
}

# ─── Test 7: non-git repo returns 65 ──────────────────────────────────
test_non_git_repo_returns_65() {
  local d
  d=$(mktemp -d -t iago-no-git.XXXXXX)
  TMPS+=("$d")
  local out err exit_code=0
  err=$(bash "$SUT" --project-dir "$d" 2>&1 >/dev/null) || exit_code=$?
  assert_eq "non-git — exit code" "65" "$exit_code"
  assert_contains "non-git — stderr ERROR" "ERROR" "$err"
}

# ─── Test 8: no .gitignore coverage + untracked .iago/state → exit 1 ──
# Codex P1: previously this case warned and returned CLEAN, letting
# pipeline-state artifacts slip into a downstream `git add -A`. The fix
# hard-fails when .iago/state/ is not listed in .gitignore.
test_iago_state_no_gitignore_fails() {
  local d
  d=$(mktemp -d -t iago-no-ignore.XXXXXX)
  TMPS+=("$d")
  (
    cd "$d"
    git init -q -b main 2>/dev/null || git init -q
    git config user.email test@example.com
    git config user.name test
    # Deliberately omit the pipeline-state path from .gitignore (gitignore
    # exists but does not list it). Comment text must NOT contain the
    # substring `.iago/state/` or the grep guard in check-clean-tree.sh
    # would match the comment line and treat the dir as covered.
    echo 'node_modules/' > .gitignore
    echo 'seed' > seed.txt
    git add seed.txt .gitignore
    git commit -q -m "init"
    mkdir -p .iago/state/pipeline-runs
    echo '{"type":"test"}' > .iago/state/pipeline-runs/test.ndjson
  )
  local out err exit_code=0
  out=$(bash "$SUT" --project-dir "$d" 2>/dev/null) || exit_code=$?
  err=$(IAGO_CLEAN_TREE_QUIET=0 bash "$SUT" --project-dir "$d" 2>&1 >/dev/null) || true
  assert_eq "iago-state no-gitignore — exit code" "1" "$exit_code"
  assert_contains "iago-state no-gitignore — stdout DIRTY" "DIRTY" "$out"
  assert_contains "iago-state no-gitignore — stderr explains" ".iago/state/" "$err"
}

# ─── Test 9: --strict mode skips .gitignore-coverage gate ─────────────
# Strict mode does not filter .iago/state/ entries; it would catch the
# untracked file on its own. The gitignore-coverage check should not
# block strict-mode runs (which already expose every untracked path).
test_iago_state_no_gitignore_strict_passes_gate() {
  local d
  d=$(mktemp -d -t iago-strict-no-ignore.XXXXXX)
  TMPS+=("$d")
  (
    cd "$d"
    git init -q -b main 2>/dev/null || git init -q
    git config user.email test@example.com
    git config user.name test
    echo 'node_modules/' > .gitignore
    echo 'seed' > seed.txt
    git add seed.txt .gitignore
    git commit -q -m "init"
  )
  # No untracked .iago/state/ file — strict mode should report CLEAN
  # because the coverage gate is bypassed in strict mode.
  local out exit_code=0
  out=$(bash "$SUT" --project-dir "$d" --strict 2>/dev/null) || exit_code=$?
  assert_eq "strict no-coverage clean — exit code" "0" "$exit_code"
  assert_contains "strict no-coverage clean — stdout CLEAN" "CLEAN" "$out"
}

echo "Running scripts/check-clean-tree.sh tests:"
test_truly_clean_returns_0
test_dirty_uncommitted_returns_1
test_worktree_dir_ignored_lenient
test_worktree_dir_caught_strict
test_gitignored_files_pass
test_iago_state_dir_filtered_lenient
test_non_git_repo_returns_65
test_iago_state_no_gitignore_fails
test_iago_state_no_gitignore_strict_passes_gate

echo
TOTAL=$((PASS + FAIL))
echo "Result: $PASS/$TOTAL passed"
[[ $FAIL -eq 0 ]] || exit 1
exit 0
