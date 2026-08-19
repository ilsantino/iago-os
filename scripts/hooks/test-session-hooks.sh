#!/usr/bin/env bash
# Behavioral tests for the Stop-hook family (scripts/hooks/*.py).
#
# Covers the two defects that made the whole capture layer lie:
#   - transcript SELECTION (mtime scan instead of the Stop payload)
#   - transcript SCHEMA    (flat `type:"tool_use"` instead of nested content)
# plus the auto-digest placement rule.
#
# No npm, no network. Everything runs against a frozen fixture and temp dirs —
# NEVER the live queue or the real vault, both of which the Stop hook rewrites
# under us on every assistant turn.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURE="$HERE/fixtures/transcript-nested.jsonl"
PASS=0
FAIL=0

PY="${PYTHON:-python}"
command -v "$PY" >/dev/null 2>&1 || PY=python3

# Git Bash hands MSYS paths to a native Windows python, which cannot read them.
to_native() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check() { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (want '$2', got '$1')"; fi; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PROJECTS="$WORK/projects"
# The "--worktrees-" suffix also exercises project-name folding: a worktree run
# must not read as a second distinct client in the harvest queue.
PROJ_DIR="$PROJECTS/C--Users-sanal-dev-iago-os--worktrees-probe"
mkdir -p "$PROJ_DIR"
cp "$FIXTURE" "$PROJ_DIR/sess-fixture.jsonl"

# A decoy that is strictly NEWER than the fixture and contains no tool activity.
# Any hook that still mtime-scans will pick this one and produce nothing.
printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"decoy, no tools here at all"}]}}' \
  > "$PROJ_DIR/sess-decoy.jsonl"
touch -t 203001010000 "$PROJ_DIR/sess-decoy.jsonl" 2>/dev/null || true

write_payload() {  # $1 = transcript path (native), $2 = dest
  "$PY" -c "import json,sys; json.dump({'session_id':'t','hook_event_name':'Stop','transcript_path':sys.argv[1]}, open(sys.argv[2],'w'))" "$1" "$2"
}

NATIVE_FIXTURE="$(to_native "$PROJ_DIR/sess-fixture.jsonl")"
write_payload "$NATIVE_FIXTURE" "$WORK/payload.json"
echo '{}' > "$WORK/empty.json"

export PATTERN_PROJECTS_DIR; PATTERN_PROJECTS_DIR="$(to_native "$PROJECTS")"
TODAY="$("$PY" -c 'import datetime;print(datetime.date.today().strftime("%Y-%m-%d"))')"

echo "T3 — nested-schema parsing produces a digest"
VAULT="$WORK/vault1"
OBSIDIAN_SESSIONS_DIR="$(to_native "$VAULT")" "$PY" "$HERE/session-obsidian.py" < "$WORK/payload.json" 2>/dev/null
DIGEST="$VAULT/$TODAY-iago-os.md"
if [ -f "$DIGEST" ]; then ok "digest written"; else bad "digest written"; fi
if grep -q "## Files Changed" "$DIGEST" 2>/dev/null; then ok "files extracted from nested blocks"; else bad "files extracted from nested blocks"; fi
if grep -qE "total calls" "$DIGEST" 2>/dev/null; then ok "tool calls counted"; else bad "tool calls counted"; fi
if grep -q "auto-captured" "$DIGEST" 2>/dev/null; then ok "carries the auto marker"; else bad "carries the auto marker"; fi

echo "T2 — the payload beats the newer decoy"
# The decoy is the newest file on disk. A digest at all proves the payload won,
# because the decoy has zero tool calls and would return before writing.
if [ -f "$DIGEST" ]; then ok "selected the payload transcript, not the newest"; else bad "selected the payload transcript, not the newest"; fi

echo "T2 — no payload falls back without crashing"
VAULT2="$WORK/vault2"
OBSIDIAN_SESSIONS_DIR="$(to_native "$VAULT2")" "$PY" "$HERE/session-obsidian.py" < "$WORK/empty.json" 2>/dev/null
check "$?" "0" "empty payload exits clean"

echo "T4 — auto-digest never clobbers a canonical one"
VAULT3="$WORK/vault3"; mkdir -p "$VAULT3"
CANON="$VAULT3/$TODAY-iago-os.md"
printf '%s\n' "# Session: hand written by Claude" "unique-canonical-marker" > "$CANON"
BEFORE="$("$PY" -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$(to_native "$CANON")")"
OBSIDIAN_SESSIONS_DIR="$(to_native "$VAULT3")" "$PY" "$HERE/session-obsidian.py" < "$WORK/payload.json" 2>/dev/null
AFTER="$("$PY" -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$(to_native "$CANON")")"
check "$AFTER" "$BEFORE" "canonical digest untouched"
if [ -f "$VAULT3/_auto/$TODAY-iago-os.md" ]; then ok "auto digest diverted to _auto/"; else bad "auto digest diverted to _auto/"; fi

echo "T5 — a hand-written digest that merely quotes the marker is not 'ours'"
VAULT5="$WORK/vault5"; mkdir -p "$VAULT5"
CANON5="$VAULT5/$TODAY-iago-os.md"
printf '%s\n' "# Session: hand written by Claude" \
  "This file documents the hook's own marker text, e.g. \"*Auto-captured by stop hook*\", inline." \
  > "$CANON5"
BEFORE5="$("$PY" -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$(to_native "$CANON5")")"
OBSIDIAN_SESSIONS_DIR="$(to_native "$VAULT5")" "$PY" "$HERE/session-obsidian.py" < "$WORK/payload.json" 2>/dev/null
AFTER5="$("$PY" -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$(to_native "$CANON5")")"
check "$AFTER5" "$BEFORE5" "canonical digest with an inline-quoted marker is untouched"
if [ -f "$VAULT5/_auto/$TODAY-iago-os.md" ]; then ok "auto digest diverted to _auto/ despite the quoted marker"; else bad "auto digest diverted to _auto/ despite the quoted marker"; fi

echo "T6 — a named-but-missing transcript path fails safe (no mtime fallback)"
PROJ_DIR6="$PROJECTS/C--Users-sanal-dev-fail-safe-probe"
mkdir -p "$PROJ_DIR6"
# Globally newest file on disk, WITH real tool activity — if resolve_transcript
# still fell back to a mtime scan on a missing named path, this is what it
# would misattribute the digest to.
cp "$FIXTURE" "$PROJ_DIR6/sess-real.jsonl"
touch -t 203201010000 "$PROJ_DIR6/sess-real.jsonl" 2>/dev/null || true
NATIVE_MISSING="$(to_native "$PROJ_DIR6/sess-gone.jsonl")"
write_payload "$NATIVE_MISSING" "$WORK/missing.json"
VAULT6="$WORK/vault6"
OBSIDIAN_SESSIONS_DIR="$(to_native "$VAULT6")" "$PY" "$HERE/session-obsidian.py" < "$WORK/missing.json" 2>/dev/null
MD_COUNT6="$(find "$VAULT6" -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
check "$MD_COUNT6" "0" "missing transcript_path wrote no digest (no mtime fallback to a different session)"

echo "T4 — repeat turns rewrite one file, they do not pile up"
OBSIDIAN_SESSIONS_DIR="$(to_native "$VAULT")" "$PY" "$HERE/session-obsidian.py" < "$WORK/payload.json" 2>/dev/null
COUNT="$(find "$VAULT" -maxdepth 1 -name "$TODAY-iago-os*.md" | wc -l | tr -d ' ')"
check "$COUNT" "1" "no -02 proliferation across turns"

echo "diary — summary carries real content, or nothing at all"
SUMMARY="$(DIARY_DRY_RUN=1 "$PY" "$HERE/session-diary.py" < "$WORK/payload.json" 2>/dev/null)"
case "$SUMMARY" in *"tools:"*) ok "diary lists tools" ;; *) bad "diary lists tools (got '$SUMMARY')" ;; esac
case "$SUMMARY" in *"files:"*) ok "diary lists files" ;; *) bad "diary lists files (got '$SUMMARY')" ;; esac
case "$SUMMARY" in *"proj:iago-os"*) ok "worktree folded to parent project" ;; *) bad "worktree folded to parent project (got '$SUMMARY')" ;; esac

NATIVE_DECOY="$(to_native "$PROJ_DIR/sess-decoy.jsonl")"
write_payload "$NATIVE_DECOY" "$WORK/decoy.json"
EMPTY_SUMMARY="$(DIARY_DRY_RUN=1 "$PY" "$HERE/session-diary.py" < "$WORK/decoy.json" 2>/dev/null)"
check "$EMPTY_SUMMARY" "" "tool-less session writes no diary entry"

echo "signals — queue upsert is idempotent against a frozen queue"
QUEUE="$WORK/queue.ndjson"
export PATTERN_QUEUE_PATH; PATTERN_QUEUE_PATH="$(to_native "$QUEUE")"
export PATTERN_MIN_HITS=1
"$PY" "$HERE/session-pattern-signals.py" < "$WORK/payload.json" 2>/dev/null
FIRST="$(cat "$QUEUE" 2>/dev/null)"
"$PY" "$HERE/session-pattern-signals.py" < "$WORK/payload.json" 2>/dev/null
SECOND="$(cat "$QUEUE" 2>/dev/null)"
LINES="$(printf '%s\n' "$SECOND" | grep -c . || true)"
check "$LINES" "1" "one record per session"
check "$SECOND" "$FIRST" "second run is a no-op"
case "$SECOND" in *'"project": "iago-os"'*|*'"project":"iago-os"'*) ok "queue project folded" ;; *) bad "queue project folded (got '$SECOND')" ;; esac
case "$SECOND" in *sess-fixture*) ok "queued the payload session" ;; *) bad "queued the payload session" ;; esac

echo
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ]
