"""Write an Obsidian session digest at session end.

Called by the Stop hook. Reads THIS session's transcript, extracts a structured
summary, and writes a markdown file to the Obsidian vault sessions/ directory.

Lightweight — no LLM call. Captures project, files changed, tools used, and
key actions. This is a FLOOR, not a replacement for the rich digest Claude
writes in-session: when a canonical digest for today already exists, the
auto-digest goes to `sessions/_auto/` and never touches it.

Usage:
  python session-obsidian.py            # Stop hook (reads payload on stdin)
  python session-obsidian.py < p.json   # manual, explicit payload
"""

import json
import os
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

from lib_transcript import iter_assistant_blocks, parse_project_name, resolve_transcript

VAULT_SESSIONS = Path(
    os.environ.get(
        "OBSIDIAN_SESSIONS_DIR",
        str(Path.home() / "dev" / "obsidian-brain" / "sessions"),
    )
)

# Minimum actions to warrant a digest (skip trivial sessions)
MIN_TOOL_CALLS = 5

# How many transcript lines to look back over.
MAX_LINES = 500


def extract_session_data(transcript_path, max_lines=MAX_LINES):
    """Extract structured data from the transcript's assistant turns."""
    if not transcript_path or not Path(transcript_path).exists():
        return None

    files_edited = set()
    files_created = set()
    files_read = set()
    tools_used = Counter()
    bash_commands = []
    mcp_tools = []
    assistant_messages = []
    total_tool_calls = 0

    for btype, block in iter_assistant_blocks(transcript_path, max_entries=max_lines):
        if btype == "text":
            text = block.get("text", "")
            if text and len(text) > 20:
                assistant_messages.append(text[:300])
            continue

        if btype != "tool_use":
            continue

        tool = block.get("name", "")
        if tool:
            tools_used[tool] += 1
            total_tool_calls += 1

        inp = block.get("input", {})
        if not isinstance(inp, dict):
            continue

        if tool == "Edit":
            fp = inp.get("file_path", "")
            if fp:
                files_edited.add(normalize_path(fp))

        elif tool == "Write":
            fp = inp.get("file_path", "")
            if fp:
                files_created.add(normalize_path(fp))

        elif tool == "Read":
            fp = inp.get("file_path", "")
            if fp:
                files_read.add(normalize_path(fp))

        elif tool == "Bash":
            cmd = inp.get("command", "")
            if cmd and len(cmd) < 200:
                bash_commands.append(cmd)

        elif tool.startswith("mcp__"):
            mcp_tools.append(tool)

    if total_tool_calls < MIN_TOOL_CALLS:
        return None

    return {
        "files_edited": files_edited,
        "files_created": files_created,
        "files_read": files_read,
        "tools_used": tools_used,
        "bash_commands": bash_commands,
        "mcp_tools": mcp_tools,
        "assistant_messages": assistant_messages,
        "total_tool_calls": total_tool_calls,
    }


def normalize_path(fp):
    """Normalize file path to relative project path."""
    fp = fp.replace("\\", "/")
    for prefix in ["C:/Users/sanal/dev/", "/c/Users/sanal/dev/"]:
        if fp.startswith(prefix):
            fp = fp[len(prefix):]
            break
    return fp


def extract_topics(assistant_messages):
    """Extract key topics from assistant messages."""
    topics = set()
    patterns = [
        (r"(?:plan|PR|pull request)\s*#?\d+", "plan/PR work"),
        (r"pipeline|execute|review", "pipeline execution"),
        (r"debug|fix|error|bug", "debugging/fixes"),
        (r"refactor", "refactoring"),
        (r"test|spec|e2e", "testing"),
        (r"deploy|amplify|sandbox", "deployment"),
        (r"obsidian|vault|session|digest", "knowledge management"),
        (r"graphify|graph|wiki", "knowledge graph"),
        (r"mempalace|diary|memory", "memory system"),
    ]

    combined = " ".join(assistant_messages[:20]).lower()
    for pattern, topic in patterns:
        if re.search(pattern, combined):
            topics.add(topic)

    return topics


def detect_git_activity(project_name):
    """Check git log for today's commits in the project."""
    import subprocess

    today = datetime.now().strftime("%Y-%m-%d")
    project_dirs = [
        Path.home() / "dev" / project_name,
        Path.home() / "dev" / "iago-os" / "clients" / project_name,
        Path.home() / "dev" / "iago-os",
    ]

    for project_dir in project_dirs:
        if not (project_dir / ".git").exists():
            continue
        try:
            result = subprocess.run(
                ["git", "log", f"--since={today}", "--format=%h %s"],
                cwd=str(project_dir),
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip().splitlines()
        except Exception:
            continue

    return []


def resolve_digest_path(project_name):
    """Where today's auto-digest goes.

    The Stop hook fires on EVERY assistant turn, and Claude often writes a far
    richer digest for the same day by hand. So: one auto file per day+project,
    rewritten in place; and if a canonical digest already exists at the top
    level, the auto file moves to `_auto/` rather than shouldering in beside it
    as `-02`.
    """
    today = datetime.now().strftime("%Y-%m-%d")
    canonical = VAULT_SESSIONS / f"{today}-{project_name}.md"

    if canonical.exists() and not is_auto_digest(canonical):
        return VAULT_SESSIONS / "_auto" / f"{today}-{project_name}.md"

    return canonical


AUTO_MARKER = "*Auto-captured by stop hook*"


def is_auto_digest(path):
    """True when this file is one of ours (safe to overwrite)."""
    try:
        return AUTO_MARKER in path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False


def write_digest(project_name, data):
    """Write the session digest to the Obsidian vault."""
    today = datetime.now().strftime("%Y-%m-%d")
    path = resolve_digest_path(project_name)
    path.parent.mkdir(parents=True, exist_ok=True)

    topics = extract_topics(data["assistant_messages"])
    git_commits = detect_git_activity(project_name)

    lines = [
        "---",
        f"tags: [session, {project_name}, auto-captured]",
        f"project: {project_name}",
        f"date: {today}",
        "---",
        "",
        f"# Session: {project_name} — {today}",
        "",
        AUTO_MARKER,
        "",
    ]

    if topics:
        lines.append(f"**Topics:** {', '.join(sorted(topics))}")
        lines.append("")

    if git_commits:
        lines.append("## Commits")
        lines.append("")
        for commit in git_commits[:15]:
            lines.append(f"- `{commit}`")
        lines.append("")

    if data["files_edited"] or data["files_created"]:
        lines.append("## Files Changed")
        lines.append("")
        if data["files_created"]:
            for f in sorted(data["files_created"])[:15]:
                lines.append(f"- **new** `{f}`")
        if data["files_edited"]:
            for f in sorted(data["files_edited"])[:15]:
                lines.append(f"- **edit** `{f}`")
        lines.append("")

    if data["tools_used"]:
        top_tools = data["tools_used"].most_common(8)
        tool_str = ", ".join(f"{t}({n})" for t, n in top_tools)
        lines.append(f"**Tools:** {tool_str} — {data['total_tool_calls']} total calls")
        lines.append("")

    mcp_unique = set(data["mcp_tools"])
    if mcp_unique:
        lines.append(f"**MCP:** {', '.join(sorted(mcp_unique))}")
        lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def main():
    transcript = resolve_transcript()
    if not transcript:
        return

    project_name = parse_project_name(transcript)
    data = extract_session_data(transcript)

    if not data:
        return  # Session too short

    path = write_digest(project_name, data)
    if path:
        print(f"Session digest written: {path}", file=sys.stderr)


if __name__ == "__main__":
    main()
