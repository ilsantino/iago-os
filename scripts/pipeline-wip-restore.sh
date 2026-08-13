#!/usr/bin/env bash
# Preserve-then-restore for a FAILED pipeline attempt.
#
# The execute-pipeline implement stage retries at most once, and before the retry it
# resets the worktree to the pre-implementation checkpoint (a blind retry on a
# half-edited tree makes the agent duplicate or contradict its own work, and the
# untracked orphans a dead attempt leaves behind would be swept into the PR by the
# Commit stage's `git add -A`). Restoring alone THROWS AWAY however much real work
# the failed attempt had already done — on 2026-08-11 that was 60 minutes of it.
#
# So: snapshot first, restore second.
#   1. Commit the dirty worktree (tracked edits + untracked files, secrets excluded)
#      into a `wip/<slug>` branch ref WITHOUT moving HEAD, the index, or the worktree.
#   2. Only then restore the worktree to the checkpoint.
#
# Recover the lost attempt with any of:
#   git log --stat wip/<slug>            # what the attempt had written
#   git diff <checkpoint> wip/<slug>     # the partial diff
#   git checkout wip/<slug> -- .         # put it back on top of the checkpoint
#
# FAIL-CLOSED: if the snapshot cannot be written — or cannot cover every dirty path — the
# script exits non-zero BEFORE restoring anything. "Cannot be preserved" always means "not
# wiped": a dirty path that matches the secret-exclude list aborts the whole operation
# rather than being restored away with no recovery ref.
#
# Usage (run anywhere inside the target repo):
#   bash scripts/pipeline-wip-restore.sh <checkpoint-sha> <wip-ref-base>
#
# Prints  snapshot=<ref> (<sha>) | snapshot=none  then  clean  on success.
# Tested by scripts/test-pipeline-wip-restore.sh.
set -euo pipefail

CHECKPOINT="${1:-}"
REF_BASE="${2:-}"
if [ -z "$CHECKPOINT" ] || [ -z "$REF_BASE" ]; then
  echo "usage: pipeline-wip-restore.sh <checkpoint-sha> <wip-ref-base>" >&2
  exit 2
fi

# Every git command below assumes the repo root (the `git add -A -- .` pathspec and
# the untracked sweep are both cwd-relative — from a subdirectory they would silently
# cover only part of the tree).
cd "$(git rev-parse --show-toplevel)"

if ! git rev-parse --verify --quiet "${CHECKPOINT}^{commit}" >/dev/null; then
  echo "ERROR: checkpoint '${CHECKPOINT}' is not a commit in this repo" >&2
  exit 2
fi

# The impl agent is instructed not to commit, but nothing enforces that. If it commits
# ONLY brand-new tracked files (no edits to pre-existing tracked paths, no other dirty
# state), `git status --porcelain` below is empty, the snapshot step is skipped
# entirely, and `git checkout <checkpoint> -- .` does not delete paths absent from the
# checkpoint — so those new files stay committed on HEAD and the script would report
# clean/exit 0 while the retry silently runs on top of an undisclosed commit. Catch it
# here, before anything else runs.
HEAD_SHA=$(git rev-parse HEAD)
CHECKPOINT_SHA=$(git rev-parse "${CHECKPOINT}^{commit}")
if [ "$HEAD_SHA" != "$CHECKPOINT_SHA" ]; then
  echo "ERROR: HEAD ($HEAD_SHA) has moved past the checkpoint ($CHECKPOINT_SHA) — refusing to run on an unexpected commit" >&2
  exit 1
fi

# git check-ref-format is strict: keep only characters that are always legal in a ref
# component, then trim leading/trailing separators (a plan named ".."" or "-x-" would
# otherwise produce an unusable ref). Two more rules `tr`+trim alone don't cover: no
# internal ".." anywhere (collapse repeated dots to one), and a ref cannot end in
# ".lock" (strip a trailing .lock, case-insensitive, after the dot-collapse so a name
# like "foo..lock" is still caught).
SLUG=$(printf '%s' "$REF_BASE" | tr -c 'A-Za-z0-9._-' '-' | sed 's/^[-.]*//; s/[-.]*$//' | sed 's/\.\.\+/./g' | sed -E 's/\.[Ll][Oo][Cc][Kk]$//')
[ -n "$SLUG" ] || SLUG="attempt"

# ── Secret material, the ONE list this script keeps ───────────────────────────────────
# Narrowed on 2026-08-12 to material that is genuinely unrecoverable if it lands in a
# long-lived ref. Entries that routinely match TRACKED, non-secret config (`.env.*` — it
# matches `.env.example` — plus `.npmrc` and `.envrc`) were REMOVED: skipping them in the
# snapshot while the restore below still reverted/deleted them destroyed real work with no
# recovery ref. Kept in lockstep with execute-pipeline.js's SECRET_EXCLUDES (and
# dual-adversarial-fix.js's copy); the drift guard in
# .claude/workflows/execute-pipeline.test.mjs fails if any copy diverges.
SECRET_PATTERNS=(
  '.env' '*.pem' '*.key' '*.p12' '*.pfx' '*.p8' '*.jks'
  'credentials.json' 'service-account*.json'
  'id_rsa' 'id_dsa' 'id_ecdsa' 'id_ed25519' '.netrc'
  '.iago/state/**'
)
SECRET_EXCLUDES=()
SECRET_MATCHES=()
for p in "${SECRET_PATTERNS[@]}"; do
  # Both root (`:!.env`) and nested (`:!**/.env`) forms are required: in default pathspec
  # mode `**/.env` does NOT match a top-level `.env`. SECRET_MATCHES is the same list in
  # POSITIVE form — what the fail-closed guard below looks for.
  SECRET_EXCLUDES+=(":!${p}" ":!**/${p}")
  SECRET_MATCHES+=("${p}" "**/${p}")
done

# ── FAIL-CLOSED GUARD: never wipe what the snapshot cannot keep ───────────────────────
# The snapshot skips SECRET_PATTERNS, but the restore at the bottom reverts EVERY tracked
# path and deletes EVERY untracked one — secrets included. So a dirty excluded path used to
# be destroyed outright while the script printed `snapshot=...` + `clean` and exited 0.
# Refuse the whole operation instead and let a human deal with the secret. (Gitignored
# paths never appear here: `git status` skips them and neither half of this script touches
# them, so an ignored `.env` is not affected.)
UNPRESERVABLE=$(git status --porcelain --no-renames -- "${SECRET_MATCHES[@]}")
if [ -n "$UNPRESERVABLE" ]; then
  echo "ERROR: these dirty paths are excluded from the snapshot as secret material and would be destroyed by the restore:" >&2
  printf '%s\n' "$UNPRESERVABLE" >&2
  echo "Nothing was touched. Commit, move, or gitignore them, then re-run." >&2
  exit 1
fi

SNAPSHOT="none"

if [ -n "$(git status --porcelain)" ]; then
  # `git add -A` already skips gitignored paths, but a repo that forgot to ignore a
  # secret must not leak one into a long-lived ref — same exclude list the Commit
  # stage uses.
  if ! ADD_ERR=$(git add -A -- . "${SECRET_EXCLUDES[@]}" 2>&1); then
    # ONE tolerated failure: git exits 1 when a wildcard-free exclude pathspec names a
    # file that is gitignored AND present (`:!.env` + a real, ignored `.env` — the
    # everyday case in any real repo). It stages everything else correctly, and the two
    # post-conditions below are what actually gate the snapshot. Any other add failure is
    # fatal HERE, before the restore.
    case "$ADD_ERR" in
    *"are ignored by one of your .gitignore files"*) : ;;
    *)
      git reset -q
      echo "ERROR: git add failed while building the snapshot — refusing to restore:" >&2
      printf '%s\n' "$ADD_ERR" >&2
      exit 1
      ;;
    esac
  fi
  # Post-condition 1: no secret path may have reached the index.
  STAGED_SECRETS=$(git diff --cached --name-only -- "${SECRET_MATCHES[@]}")
  if [ -n "$STAGED_SECRETS" ]; then
    git reset -q
    echo "ERROR: secret paths reached the snapshot index — refusing to write the ref:" >&2
    printf '%s\n' "$STAGED_SECRETS" >&2
    exit 1
  fi
  TREE=$(git write-tree)
  # Put the index back immediately. `git reset` with NO commit argument is a mixed
  # reset against HEAD: it rewrites the index only — HEAD, the branch, and the
  # worktree are untouched. The tree object written above survives in the object DB.
  git reset -q

  # Post-condition 2: a DIRTY worktree whose staged tree equals the checkpoint means the
  # snapshot captured nothing — a half-failed `git add`, or churn (mode bits, line
  # endings) the ref cannot represent. Either way the restore would wipe the worktree
  # with no recovery ref, so abort instead. (A CLEAN worktree never gets here: `snapshot=none`
  # stays reserved for the nothing-to-preserve case handled by the enclosing `if`.)
  if [ "$TREE" = "$(git rev-parse "${CHECKPOINT}^{tree}")" ]; then
    echo "ERROR: the worktree is dirty but the snapshot tree is identical to the checkpoint — nothing could be preserved, so the restore is refused:" >&2
    git status --porcelain >&2
    exit 1
  fi
  REF="refs/heads/wip/${SLUG}"
  N=1
  while git show-ref --verify --quiet "$REF"; do
    REF="refs/heads/wip/${SLUG}-${N}"
    N=$((N + 1))
  done
  # commit-tree writes a real commit whose parent is the checkpoint, so the ref is a
  # normal branch: log it, diff it, cherry-pick it. update-ref creates it without
  # checking it out. If either fails (e.g. a D/F conflict with an existing `wip`
  # branch), `set -e` aborts HERE — before the restore — leaving the work on disk.
  SNAP=$(git commit-tree "$TREE" -p "$CHECKPOINT" -m "wip(pipeline): partial work from a failed attempt (${SLUG})")
  git update-ref "$REF" "$SNAP"
  SNAPSHOT="${REF#refs/heads/} (${SNAP})"
fi

# Restore: tracked files back to the checkpoint, then remove the untracked (non-ignored)
# files the failed attempt created — `git checkout <sha> -- .` only reverts tracked paths.
# --exclude-standard keeps gitignored runtime state (.iago/state) intact. Portable
# NUL-safe sweep: no `xargs -r`, which is GNU-only and absent on macOS/BSD.
git checkout "$CHECKPOINT" -- .
git ls-files --others --exclude-standard -z | while IFS= read -r -d '' f; do rm -f "$f"; done

echo "snapshot=${SNAPSHOT}"

REMAINING="$(git status --porcelain)"
if [ -n "$REMAINING" ]; then
  echo "ERROR: worktree not clean after restore:" >&2
  printf '%s\n' "$REMAINING" >&2
  exit 1
fi

echo "clean"
