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
# brand-new untracked file, a deleted tracked file, an ignored runtime artifact, a
# gitignored secret the pipeline must never capture, and TRACKED config (.env.example,
# deploy.key) — the two shapes that separate "not preserved" from "not wiped".
make_repo() {
  local dir
  dir=$(mktemp -d)
  (
    cd "$dir" || exit 1
    git init -q
    git config user.email "test@iago.local"
    git config user.name "iago test"
    git config commit.gpgsign false
    printf 'ignored/\n.env\n' >.gitignore
    printf 'original\n' >kept.ts
    printf 'doomed\n' >removed.ts
    # Tracked, NON-secret config that the pre-2026-08-12 exclude list matched
    # (':!**/.env.*'): edits to it are real work and must reach the snapshot.
    printf 'API_URL=https://example.test\n' >.env.example
    # Tracked, GENUINE secret material (':!*.key'): can never reach the snapshot, so a
    # dirty one must abort the whole run instead of being restored away.
    printf 'KEY-MATERIAL\n' >deploy.key
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
    printf 'REGION=eu-west-1\n' >>.env.example
    printf 'registry=https://npm.example.test\n' >.npmrc
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
# Exact-path match: `.env.example` contains the substring ".env", so a substring assertion
# here would silently pass while the real secret sat in the ref.
assert_eq "snapshot excludes the secret" "absent" \
  "$(git -C "$REPO" diff --name-only "$CHECKPOINT" "wip/03-reporte-operacion" | grep -Fxq '.env' && echo present || echo absent)"
assert_eq "gitignored secret left untouched on disk" "SECRET=hunter2" "$(cat "$REPO/.env" 2>/dev/null)"
assert_not_contains "snapshot excludes gitignored state" "$SNAP_FILES" "ignored/state.json"

# Narrowed exclude list (2026-08-12): entries that routinely match TRACKED, non-secret
# config were destroying real work — excluded from the snapshot, then reverted/deleted by
# the restore, with `snapshot=...` + `clean` + rc 0 reported. Both shapes are pinned here.
assert_contains "snapshot keeps the tracked .env.example edit" "$SNAP_FILES" ".env.example"
# `git show <ref>:<path>` is unusable here: Git Bash rewrites a dotfile after the colon
# into a Windows path list. Read the content out of the diff instead — portable everywhere.
assert_contains "the .env.example edit is recoverable" \
  "$(git -C "$REPO" diff "$CHECKPOINT" "wip/03-reporte-operacion" -- .env.example)" "+REGION=eu-west-1"
assert_contains "snapshot keeps the untracked .npmrc" "$SNAP_FILES" ".npmrc"
assert_eq "tracked .env.example restored to the checkpoint" "API_URL=https://example.test" "$(cat "$REPO/.env.example")"
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

# ── 10. Fail-closed: a dirty path the snapshot CANNOT preserve is never wiped ──────────
# The worst shape of the pre-2026-08-12 bug: the attempt's ONLY dirty path is one the
# exclude list skips. `git add -A` staged nothing, so TREE equalled the checkpoint tree,
# SNAPSHOT stayed "none" — and the restore reverted the edit anyway while the script
# printed `snapshot=none` + `clean` and exited 0. "Cannot be preserved" must mean "not
# wiped": the script now refuses the whole operation before touching the worktree.
SECREPO=$(make_repo) || {
  echo "could not create unpreservable-path test repo"
  exit 1
}
SECCHECKPOINT=$(git -C "$SECREPO" rev-parse HEAD)
printf 'ROTATED-KEY\n' >>"$SECREPO/deploy.key"
BEFORE_SEC=$(git -C "$SECREPO" status --porcelain)
OUT12=$(cd "$SECREPO" && bash "$SUBJECT" "$SECCHECKPOINT" "secret-only" 2>&1)
RC12=$?
assert_eq "unpreservable-only tree exits non-zero" "0" "$([ "$RC12" -ne 0 ] && echo 0 || echo 1)"
assert_contains "unpreservable path is named" "$OUT12" "deploy.key"
assert_not_contains "unpreservable-only tree never reports a snapshot" "$OUT12" "snapshot="
assert_eq "unpreservable-only tree left untouched" "$BEFORE_SEC" "$(git -C "$SECREPO" status --porcelain)"
assert_contains "the unpreservable edit survives on disk" "$(cat "$SECREPO/deploy.key")" "ROTATED-KEY"
assert_eq "aborted run leaves no wip ref" "1" \
  "$(git -C "$SECREPO" show-ref --verify --quiet refs/heads/wip/secret-only && echo 0 || echo 1)"
rm -rf "$SECREPO"

# ── 11. Fail-closed: an UNTRACKED secret aborts before the sweep deletes it ────────────
# The untracked half of the same bug: `git ls-files --others` + `rm -f` deleted an
# untracked excluded file outright — no ref, no file, no way back.
UNTREPO=$(make_repo) || {
  echo "could not create untracked-secret test repo"
  exit 1
}
UNTCHECKPOINT=$(git -C "$UNTREPO" rev-parse HEAD)
dirty_it "$UNTREPO"
printf 'fake-key-material-for-tests\n' >"$UNTREPO/id_rsa"
BEFORE_UNT=$(git -C "$UNTREPO" status --porcelain)
OUT13=$(cd "$UNTREPO" && bash "$SUBJECT" "$UNTCHECKPOINT" "untracked-secret" 2>&1)
RC13=$?
assert_eq "untracked secret exits non-zero" "0" "$([ "$RC13" -ne 0 ] && echo 0 || echo 1)"
assert_contains "untracked secret is named" "$OUT13" "id_rsa"
assert_eq "untracked secret still on disk" "present" "$([ -e "$UNTREPO/id_rsa" ] && echo present || echo absent)"
assert_eq "untracked-secret abort left the whole tree untouched" "$BEFORE_UNT" "$(git -C "$UNTREPO" status --porcelain)"
assert_contains "the rest of the attempt survives the abort" "$(cat "$UNTREPO/kept.ts")" "half-written implementation"
assert_eq "untracked-secret abort leaves no wip ref" "1" \
  "$(git -C "$UNTREPO" show-ref --verify --quiet refs/heads/wip/untracked-secret && echo 0 || echo 1)"
rm -rf "$UNTREPO"

echo
echo "${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
