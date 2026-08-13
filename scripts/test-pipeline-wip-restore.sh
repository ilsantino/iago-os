#!/usr/bin/env bash
# Behavioral tests for scripts/pipeline-wip-restore.sh.
#
# The script's whole job is to make a destructive step non-destructive, and it only
# ever runs on the failure path of a pipeline run — i.e. never during a normal day,
# which is exactly how a broken version would go unnoticed. So it is exercised here
# against real throwaway repos: real dirty states, real refs, real `git status`.
#
# Run:  bash scripts/test-pipeline-wip-restore.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBJECT="${SCRIPT_DIR}/pipeline-wip-restore.sh"

PASS=0
FAIL=0

ok() {
  PASS=$((PASS + 1))
  echo "PASS  $1"
}
bad() {
  FAIL=$((FAIL + 1))
  echo "FAIL  $1"
  [ $# -gt 1 ] && printf '      %s\n' "$2"
}
assert_eq() { # <name> <expected> <actual>
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$2] got [$3]"; fi
}
assert_contains() { # <name> <haystack> <needle>
  case "$2" in
  *"$3"*) ok "$1" ;;
  *) bad "$1" "[$2] does not contain [$3]" ;;
  esac
}
assert_not_contains() { # <name> <haystack> <needle>
  case "$2" in
  *"$3"*) bad "$1" "[$2] unexpectedly contains [$3]" ;;
  *) ok "$1" ;;
  esac
}

# A repo with one commit (the checkpoint) and a .gitignore, plus a dirty worktree that
# mirrors what a half-finished implement stage leaves behind: an edited tracked file, a
# brand-new untracked file, a deleted tracked file, an ignored runtime artifact, and a
# secret the pipeline must never capture.
make_repo() {
  local dir
  dir=$(mktemp -d)
  (
    cd "$dir" || exit 1
    git init -q
    git config user.email "test@iago.local"
    git config user.name "iago test"
    git config commit.gpgsign false
    printf 'ignored/\n' >.gitignore
    printf 'original\n' >kept.ts
    printf 'doomed\n' >removed.ts
    git add -A
    git commit -qm "checkpoint"
  ) || return 1
  echo "$dir"
}

dirty_it() {
  local dir="$1"
  (
    cd "$dir" || exit 1
    printf 'half-written implementation\n' >>kept.ts
    printf 'brand new component\n' >new-feature.ts
    rm removed.ts
    mkdir -p ignored
    printf 'runtime\n' >ignored/state.json
    printf 'SECRET=hunter2\n' >.env
  )
}

# ── 1. Happy path: partial work preserved, worktree restored ──────────────────────────
REPO=$(make_repo) || {
  echo "could not create test repo"
  exit 1
}
dirty_it "$REPO"
CHECKPOINT=$(git -C "$REPO" rev-parse HEAD)
OUT=$(cd "$REPO" && bash "$SUBJECT" "$CHECKPOINT" "03-reporte-operacion" 2>&1)
RC=$?

assert_eq "happy path exits 0" "0" "$RC"
assert_contains "happy path reports clean" "$OUT" "clean"
assert_contains "happy path names the wip ref" "$OUT" "snapshot=wip/03-reporte-operacion"
assert_eq "worktree is clean after restore" "" "$(git -C "$REPO" status --porcelain)"
assert_eq "tracked file restored to checkpoint" "original" "$(cat "$REPO/kept.ts")"
assert_eq "deleted tracked file restored" "doomed" "$(cat "$REPO/removed.ts")"
assert_eq "untracked orphan swept" "absent" "$([ -e "$REPO/new-feature.ts" ] && echo present || echo absent)"
assert_eq "gitignored runtime state preserved" "runtime" "$(cat "$REPO/ignored/state.json" 2>/dev/null)"
assert_eq "HEAD did not move" "$CHECKPOINT" "$(git -C "$REPO" rev-parse HEAD)"

# The recovery ref is the point of the whole exercise: every piece of the failed
# attempt must be reachable from it.
SNAP_FILES=$(git -C "$REPO" diff --name-status "$CHECKPOINT" "wip/03-reporte-operacion")
assert_contains "snapshot keeps the edited file" "$SNAP_FILES" "kept.ts"
assert_contains "snapshot keeps the new file" "$SNAP_FILES" "new-feature.ts"
assert_contains "snapshot records the deletion" "$SNAP_FILES" "D	removed.ts"
assert_contains "snapshot content is recoverable" \
  "$(git -C "$REPO" show "wip/03-reporte-operacion:kept.ts")" "half-written implementation"
assert_not_contains "snapshot excludes the secret" "$SNAP_FILES" ".env"
assert_not_contains "snapshot excludes gitignored state" "$SNAP_FILES" "ignored/state.json"
assert_eq "snapshot parent is the checkpoint" "$CHECKPOINT" "$(git -C "$REPO" rev-parse "wip/03-reporte-operacion^")"

# ── 2. A second failed attempt must not clobber the first snapshot ────────────────────
dirty_it "$REPO"
OUT2=$(cd "$REPO" && bash "$SUBJECT" "$CHECKPOINT" "03-reporte-operacion" 2>&1)
assert_eq "second attempt exits 0" "0" "$?"
assert_contains "second attempt gets its own ref" "$OUT2" "snapshot=wip/03-reporte-operacion-1"
assert_eq "first snapshot still reachable" "half-written implementation" \
  "$(git -C "$REPO" show "wip/03-reporte-operacion:kept.ts" | tail -1)"

# ── 3. Clean tree → nothing to preserve, still succeeds ───────────────────────────────
OUT3=$(cd "$REPO" && bash "$SUBJECT" "$CHECKPOINT" "03-reporte-operacion" 2>&1)
assert_eq "clean tree exits 0" "0" "$?"
assert_contains "clean tree snapshots nothing" "$OUT3" "snapshot=none"

# ── 4. Ref-name sanitation: a plan slug is not a valid ref by default ─────────────────
dirty_it "$REPO"
OUT4=$(cd "$REPO" && bash "$SUBJECT" "$CHECKPOINT" "feature/caja terminals~01" 2>&1)
assert_eq "unsafe slug exits 0" "0" "$?"
assert_contains "unsafe slug sanitized into a legal ref" "$OUT4" "snapshot=wip/feature-caja-terminals-01"
assert_eq "sanitized ref actually exists" "0" \
  "$(git -C "$REPO" show-ref --verify --quiet refs/heads/wip/feature-caja-terminals-01 && echo 0 || echo 1)"

# ── 5. Fail-closed: a bad checkpoint must not touch the worktree ──────────────────────
dirty_it "$REPO"
BEFORE=$(git -C "$REPO" status --porcelain)
OUT5=$(cd "$REPO" && bash "$SUBJECT" "0000000000000000000000000000000000000000" "x" 2>&1)
RC5=$?
assert_eq "unknown checkpoint exits 2" "2" "$RC5"
assert_contains "unknown checkpoint explains itself" "$OUT5" "not a commit"
assert_eq "worktree untouched on bad checkpoint" "$BEFORE" "$(git -C "$REPO" status --porcelain)"

OUT6=$(cd "$REPO" && bash "$SUBJECT" "$CHECKPOINT" 2>&1)
assert_eq "missing ref-base exits 2" "2" "$?"
assert_contains "missing ref-base prints usage" "$OUT6" "usage:"

# ── 6. Runs from a subdirectory (cwd must not narrow the sweep) ───────────────────────
mkdir -p "$REPO/nested/deep"
printf 'nested orphan\n' >"$REPO/nested/deep/orphan.ts"
printf 'edit\n' >>"$REPO/kept.ts"
OUT7=$(cd "$REPO/nested/deep" && bash "$SUBJECT" "$CHECKPOINT" "from-subdir" 2>&1)
assert_eq "subdirectory run exits 0" "0" "$?"
assert_eq "subdirectory run cleans the whole tree" "" "$(git -C "$REPO" status --porcelain)"
assert_contains "subdirectory run preserved the nested orphan" \
  "$(git -C "$REPO" diff --name-only "$CHECKPOINT" "wip/from-subdir")" "nested/deep/orphan.ts"

# ── 7. Fail-closed: HEAD moved past the checkpoint (agent committed anyway) ────────────
# The impl agent is told not to commit. If it does — and the illicit commit adds only a
# brand-new tracked file with nothing else dirty — `git status --porcelain` is empty, so
# without a guard the script would skip the snapshot entirely and silently succeed on
# top of the undisclosed commit. Simulate exactly that: commit a new file straight onto
# the checkpoint, then invoke the script with the (now stale) checkpoint sha.
printf 'undisclosed\n' >"$REPO/illicit.ts"
(cd "$REPO" && git add illicit.ts && git commit -qm "illicit commit the impl agent was told not to make")
OUT8=$(cd "$REPO" && bash "$SUBJECT" "$CHECKPOINT" "head-drift" 2>&1)
RC8=$?
assert_eq "HEAD drift exits non-zero" "1" "$RC8"
assert_contains "HEAD drift explains itself" "$OUT8" "has moved past the checkpoint"
assert_eq "HEAD drift leaves no wip ref" "1" \
  "$(git -C "$REPO" show-ref --verify --quiet refs/heads/wip/head-drift && echo 0 || echo 1)"
# Undo the illicit commit so later state matches what earlier tests assume.
(cd "$REPO" && git reset -q --hard "$CHECKPOINT")

# ── 8. Ref-name sanitation: internal ".." and a trailing ".lock" ──────────────────────
dirty_it "$REPO"
OUT9=$(cd "$REPO" && bash "$SUBJECT" "$CHECKPOINT" "feature..double-dot" 2>&1)
assert_eq "internal .. slug exits 0" "0" "$?"
assert_contains "internal .. collapsed to a single dot" "$OUT9" "snapshot=wip/feature.double-dot"
assert_eq "collapsed-dot ref actually exists" "0" \
  "$(git -C "$REPO" show-ref --verify --quiet refs/heads/wip/feature.double-dot && echo 0 || echo 1)"

dirty_it "$REPO"
OUT10=$(cd "$REPO" && bash "$SUBJECT" "$CHECKPOINT" "risky-plan.lock" 2>&1)
assert_eq "trailing .lock slug exits 0" "0" "$?"
assert_contains "trailing .lock stripped" "$OUT10" "snapshot=wip/risky-plan"
assert_eq "delocked ref actually exists" "0" \
  "$(git -C "$REPO" show-ref --verify --quiet refs/heads/wip/risky-plan && echo 0 || echo 1)"

rm -rf "$REPO"

# ── 9. Fail-closed: the snapshot write itself fails (D/F ref conflict), not just early
#      arg validation — proves the fail-closed ordering holds mid-run, before restore.
DFREPO=$(make_repo) || {
  echo "could not create D/F conflict test repo"
  exit 1
}
DFCHECKPOINT=$(git -C "$DFREPO" rev-parse HEAD)
(cd "$DFREPO" && git branch wip >/dev/null)
dirty_it "$DFREPO"
BEFORE_DF=$(git -C "$DFREPO" status --porcelain)
OUT11=$(cd "$DFREPO" && bash "$SUBJECT" "$DFCHECKPOINT" "df-conflict" 2>&1)
RC11=$?
# `set -e` propagates git's own exit code (128) when update-ref itself fails, not the
# script's custom `exit 1` — either way, non-zero is the property under test.
assert_eq "D/F ref conflict exits non-zero" "0" "$([ "$RC11" -ne 0 ] && echo 0 || echo 1)"
assert_eq "D/F ref conflict leaves the worktree untouched" "$BEFORE_DF" "$(git -C "$DFREPO" status --porcelain)"
assert_eq "D/F ref conflict does not move HEAD" "$DFCHECKPOINT" "$(git -C "$DFREPO" rev-parse HEAD)"
rm -rf "$DFREPO"

echo
echo "${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
