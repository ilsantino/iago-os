"""Shared transcript access for the Stop-hook family.

Two defects used to be copy-pasted across every Stop hook; both live here now
so there is exactly one place to fix them.

1. **Transcript selection.** Each hook scanned every project dir and took the
   globally newest `.jsonl`. During a pipeline run — which spawns subagent
   transcripts constantly — that is almost never the session that just stopped,
   so sessions were mis-attributed or dropped. The Stop payload carries
   `transcript_path`; that is authoritative. The mtime scan survives only as a
   fallback for manual runs with no stdin.

2. **Entry schema.** Real transcript lines are
   `{"type": "assistant", "message": {"role": "assistant", "content": [ ... ]}}`
   with `tool_use` / `text` / `thinking` blocks nested inside `content`. Hooks
   that tested a top-level `entry["type"] == "tool_use"` matched nothing at all.

Usage: `from lib_transcript import resolve_transcript, iter_assistant_blocks`
(this file sits beside the hook scripts, so it imports without path setup).
"""

import json
import os
import sys
from pathlib import Path

__all__ = [
    "read_hook_payload",
    "projects_dir",
    "iter_transcripts",
    "newest_transcript",
    "resolve_transcript",
    "iter_assistant_blocks",
    "parse_project_name",
]


def read_hook_payload():
    """Parse the hook's stdin JSON payload.

    Returns {} when stdin is a terminal (manual run), empty, or unparseable.
    Never raises — a hook must not die on its own input.
    """
    try:
        stream = sys.stdin
        if stream is None or stream.isatty():
            return {}
        raw = stream.read()
    except Exception:
        return {}

    if not raw or not raw.strip():
        return {}

    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return {}

    return data if isinstance(data, dict) else {}


def projects_dir():
    """Root of the Claude Code transcript store (env-overridable for tests)."""
    return Path(
        os.environ.get(
            "PATTERN_PROJECTS_DIR", str(Path.home() / ".claude" / "projects")
        )
    )


def iter_transcripts(root=None):
    """Yield every transcript JSONL under the projects dir."""
    root = root or projects_dir()
    if not root.exists():
        return
    for d in root.iterdir():
        if not d.is_dir():
            continue
        for f in d.glob("*.jsonl"):
            yield f


def newest_transcript(root=None):
    """Globally newest transcript. Fallback only — see module docstring."""
    latest, latest_mtime = None, -1.0
    for f in iter_transcripts(root):
        try:
            mtime = f.stat().st_mtime
        except OSError:
            continue
        if mtime > latest_mtime:
            latest, latest_mtime = f, mtime
    return latest


def resolve_transcript(payload=None, root=None):
    """The transcript THIS hook run is about.

    `payload` may be passed in when the caller already consumed stdin (it can
    only be read once). Pass {} to force the fallback.
    """
    if payload is None:
        payload = read_hook_payload()

    path = payload.get("transcript_path") if isinstance(payload, dict) else None
    if isinstance(path, str) and path.strip():
        candidate = Path(path)
        try:
            if candidate.exists():
                return candidate
        except OSError:
            pass

    return newest_transcript(root)


def iter_assistant_blocks(path, max_entries=None):
    """Yield (block_type, block) for each content block of each assistant entry.

    Callers filter by block type. `thinking` blocks are yielded too — the
    signal extractor deliberately drops them, the digest writer never asks.
    """
    if not path:
        return
    try:
        raw = Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return

    lines = raw.splitlines()
    if max_entries is not None:
        lines = lines[-max_entries:]

    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            continue
        if not isinstance(entry, dict) or entry.get("type") != "assistant":
            continue
        content = entry.get("message", {}).get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict):
                yield block.get("type"), block


def parse_project_name(transcript_path):
    """Human-readable project/client name from the transcript's parent dir.

    Worktree checkouts are folded back onto their parent project so a signal
    from `iago-os--worktrees-foo` does not read as a second distinct client.
    """
    name = Path(transcript_path).parent.name
    name = name.replace("C--Users-sanal-dev-", "").replace("C--Users-sanal-", "")
    if "clients-" in name:
        name = name.split("clients-")[-1]
    if "--worktrees-" in name:
        name = name.split("--worktrees-")[0]
    return name or "unknown"
