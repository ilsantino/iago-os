#!/usr/bin/env bash
# Capture a Claude Code PTY interaction into the golden-transcript JSONL
# format consumed by `prompt-parser.test.ts`. Manual one-shot per supported
# Claude Code version range — see ./README.md for the format spec and the
# re-capture procedure.
#
# Usage:
#   ./capture.sh <scenario> <cwd> [prompt]
#
#   scenario  one of: running | idle | exited
#   cwd       working directory to spawn `claude` in
#   prompt    (running scenario only) text to feed Claude after launch
#
# Output lands in ./claude-code-<scenario>.jsonl in this directory.

set -euo pipefail

scenario="${1:-}"
cwd="${2:-}"
prompt="${3:-}"

if [ -z "$scenario" ] || [ -z "$cwd" ]; then
	echo "usage: $0 <running|idle|exited> <cwd> [prompt]" >&2
	exit 2
fi

case "$scenario" in
	running|idle|exited) ;;
	*) echo "scenario must be running|idle|exited" >&2; exit 2 ;;
esac

here="$(cd "$(dirname "$0")" && pwd)"
out="$here/claude-code-${scenario}.jsonl"
raw="$(mktemp -t claude-capture-XXXXXX.log)"
trap 'rm -f "$raw"' EXIT

start_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }
t0=$(start_ms)

# shellcheck disable=SC2016
inner='cd "$0" && exec claude'

if [ "$scenario" = "running" ] && [ -n "$prompt" ]; then
	# feed the prompt then a SIGINT after ~3s so the capture closes deterministically
	( sleep 1; printf '%s\n' "$prompt"; sleep 3; printf '\x03' ) | \
		script -q "$raw" bash -c "$inner" "$cwd" >/dev/null 2>&1 || true
elif [ "$scenario" = "idle" ]; then
	( sleep 1; printf '\x03' ) | \
		script -q "$raw" bash -c "$inner" "$cwd" >/dev/null 2>&1 || true
else
	( sleep 1; printf '/exit\n' ) | \
		script -q "$raw" bash -c "$inner" "$cwd" >/dev/null 2>&1 || true
fi

# raw is a script(1) typescript: convert to JSONL lines tagged at offset 0..
python3 - "$raw" "$out" "$t0" <<'PY'
import json, sys, time
src, dst, t0 = sys.argv[1], sys.argv[2], int(sys.argv[3])
with open(src, "rb") as fh:
	data = fh.read().decode("utf-8", errors="replace")
now_ms = int(time.time() * 1000) - t0
with open(dst, "w", encoding="utf-8") as out:
	out.write(json.dumps({"at": 0, "kind": "stdout", "data": data}) + "\n")
	out.write(json.dumps({"at": now_ms, "kind": "exit", "data": 0}) + "\n")
PY

echo "captured -> $out"
