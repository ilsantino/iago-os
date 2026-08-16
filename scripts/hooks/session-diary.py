"""Write a MemPalace diary entry at session end.

Called by the Stop hook. Reads THIS session's transcript, extracts a compact
summary, and writes it as a diary drawer (wing_claude / diary) — the same
collection `mempalace_diary_read` serves.

Usage:
  python session-diary.py            # Stop hook (reads payload on stdin)
  python session-diary.py < p.json   # manual, explicit payload
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

from lib_transcript import iter_assistant_blocks, parse_project_name, resolve_transcript

MAX_LINES = 200


def extract_summary(transcript_path, max_lines=MAX_LINES):
    """Compact one-line summary of what the session DID.

    Returns None when the transcript shows no tool activity — an entry naming
    only a date and a project is noise, and used to be all this hook produced.
    """
    if not transcript_path or not Path(transcript_path).exists():
        return None

    files_changed = set()
    tools_used = set()

    for btype, block in iter_assistant_blocks(transcript_path, max_entries=max_lines):
        if btype != "tool_use":
            continue
        tool = block.get("name", "")
        if tool:
            tools_used.add(tool)
        if tool in ("Edit", "Write", "NotebookEdit"):
            inp = block.get("input", {})
            if isinstance(inp, dict):
                fp = inp.get("file_path", "")
                if fp:
                    files_changed.add(Path(fp.replace("\\", "/")).name)

    if not tools_used:
        return None

    project = parse_project_name(transcript_path)
    date = datetime.now().strftime("%Y-%m-%d")

    parts = [f"SESSION:{date}|proj:{project}"]
    if files_changed:
        parts.append(f"files:{','.join(sorted(files_changed)[:10])}")
    parts.append(f"tools:{','.join(sorted(tools_used)[:8])}")

    return "|".join(parts)


def write_drawer(summary):
    """Append the summary to the palace collection the MCP diary tools read."""
    from mempalace.palace import get_collection

    palace_path = str(Path.home() / ".mempalace" / "palace")
    coll = get_collection(palace_path)

    now = datetime.now()
    entry_id = f"diary_wing_claude_{now.strftime('%Y%m%d_%H%M%S')}_{os.urandom(4).hex()}"
    coll.add(
        ids=[entry_id],
        documents=[summary],
        metadatas=[
            {
                "wing": "wing_claude",
                "room": "diary",
                "topic": "session-end",
                "timestamp": now.isoformat(),
                "agent": "claude",
                "source_file": "session-diary-hook",
            }
        ],
    )
    return entry_id


def main():
    transcript = resolve_transcript()
    summary = extract_summary(transcript)
    if not summary:
        return

    if os.environ.get("DIARY_DRY_RUN"):
        print(summary)
        return

    try:
        write_drawer(summary)
    except Exception as e:  # never block Claude on a memory-store failure
        print(f"diary write failed: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
