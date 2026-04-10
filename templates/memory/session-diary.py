"""Write a MemPalace diary entry at session end.

Called by the Claude Code stop hook. Reads the latest transcript,
extracts a compact summary, and writes it as a diary entry in the
MemPalace ChromaDB collection.

Platform-agnostic: works on Windows (Git Bash / PowerShell) and macOS/Linux.

Usage: python ~/.claude/scripts/session-diary.py
"""

import json
import os
import sys
from pathlib import Path
from datetime import datetime


def find_latest_transcript():
    """Find the most recent JSONL transcript file."""
    projects_dir = Path.home() / ".claude" / "projects"
    if not projects_dir.exists():
        return None

    latest = None
    latest_mtime = 0

    for d in projects_dir.iterdir():
        if not d.is_dir():
            continue
        for f in d.glob("*.jsonl"):
            mtime = f.stat().st_mtime
            if mtime > latest_mtime:
                latest_mtime = mtime
                latest = f

    return latest


def extract_summary(transcript_path, max_lines=200):
    """Extract key topics from the transcript."""
    if not transcript_path or not transcript_path.exists():
        return None

    lines = transcript_path.read_text(encoding="utf-8", errors="replace").splitlines()

    files_changed = set()
    tools_used = set()

    for line in lines[-max_lines:]:
        try:
            entry = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            continue

        msg_type = entry.get("type", "")

        if msg_type == "tool_use":
            tool = entry.get("name", "")
            if tool:
                tools_used.add(tool)

        if msg_type == "tool_use" and entry.get("name") in ("Edit", "Write"):
            inp = entry.get("input", {})
            fp = inp.get("file_path", "")
            if fp:
                files_changed.add(Path(fp).name)

    # Derive project name from transcript directory
    proj_name = transcript_path.parent.name
    # Normalize common path prefixes across platforms
    for prefix in ("C--Users-", "/Users/", "/home/"):
        if proj_name.startswith(prefix.replace("/", "-").replace("\\", "-")):
            # Strip the user-specific path prefix
            parts = proj_name.split("-dev-", 1)
            if len(parts) > 1:
                proj_name = parts[1]
            break

    date = datetime.now().strftime("%Y-%m-%d")

    parts = [f"SESSION:{date}|proj:{proj_name}"]
    if files_changed:
        parts.append(f"files:{','.join(list(files_changed)[:10])}")
    if tools_used:
        parts.append(f"tools:{','.join(sorted(tools_used)[:8])}")

    return "|".join(parts)


def write_diary(summary):
    """Write diary entry to the MemPalace ChromaDB collection."""
    palace_path = str(Path.home() / ".mempalace" / "palace")

    if not Path(palace_path).exists():
        print("mempalace palace not found, skipping diary write", file=sys.stderr)
        return False

    try:
        from mempalace.palace import get_collection
        coll = get_collection(palace_path)

        now = datetime.now()
        entry_id = f"diary_wing_claude_{now.strftime('%Y%m%d_%H%M%S')}_{os.urandom(4).hex()}"
        coll.add(
            ids=[entry_id],
            documents=[summary],
            metadatas=[{
                "wing": "wing_claude",
                "room": "diary",
                "topic": "session-end",
                "timestamp": now.isoformat(),
                "agent": "claude",
                "source_file": "session-diary-hook",
            }],
        )
        return True
    except ImportError:
        # Fallback: write via CLI
        import subprocess
        result = subprocess.run(
            [sys.executable, "-m", "mempalace", "hook"],
            input=json.dumps({
                "type": "diary_write",
                "agent_name": "claude",
                "entry": summary,
                "topic": "session-end",
            }),
            capture_output=True, text=True, timeout=10,
        )
        return result.returncode == 0
    except Exception as e:
        print(f"diary write failed: {e}", file=sys.stderr)
        return False


def main():
    transcript = find_latest_transcript()
    summary = extract_summary(transcript)

    if not summary:
        return

    write_diary(summary)


if __name__ == "__main__":
    main()
