"""Stop-hook wiring for ~/.claude/settings.json, shared by setup-memory.sh.

Extracted so the "does an existing hook already point at the live copy"
check is a plain function `setup-memory.sh` can test, not logic buried in a
bash heredoc. The bug this replaced: a substring match on "session-diary"
matched the OLD broken `~/.claude/scripts/session-diary.py` path just as
happily as the new `scripts/hooks/session-diary.py` one, so re-running
`setup-memory.sh` on a machine that already had the hook wired left it
silently pointed at the stale, orphaned copy forever.
"""

__all__ = ["sync_stop_diary_hook"]


def sync_stop_diary_hook(hooks, diary_command):
    """Ensure exactly one Stop hook is wired to `diary_command`.

    `hooks` is the settings.json `hooks` dict (mutated in place). Any
    existing Stop hook whose command mentions "session-diary" but points
    somewhere other than `diary_command` is repointed rather than trusted —
    presence alone doesn't mean it's correct. `diary_command` may be None
    when the live diary script isn't available; in that case a missing hook
    is reported but not installed.

    Returns (changed: bool, status: str) with status one of:
      "added"       — no prior diary hook existed, one was appended
      "repointed"   — a stale diary hook's command was rewritten in place
      "unchanged"   — an existing diary hook already pointed at diary_command
      "missing-target" — no diary hook exists and diary_command is None
    """
    stop_hooks = hooks.setdefault("Stop", [])

    diary_entries = [
        next(iter(h.get("hooks", [])), {})
        for h in stop_hooks
        if isinstance(h, dict) and "hooks" in h
        and "session-diary" in str(next(iter(h.get("hooks", [])), {}).get("command", ""))
    ]

    if diary_entries:
        if diary_command is None:
            # Nothing live to repoint to — leave the existing (possibly
            # stale) entry alone rather than blanking its command out.
            return False, "unchanged"
        changed = False
        for inner in diary_entries:
            if inner.get("command") != diary_command:
                inner["command"] = diary_command
                changed = True
        return changed, ("repointed" if changed else "unchanged")

    if diary_command is None:
        return False, "missing-target"

    stop_hooks.append({
        "hooks": [{
            "type": "command",
            "command": diary_command,
            "timeout": 10000,
            "async": True,
        }],
    })
    return True, "added"
