"""Self-contained test for lib_settings_hooks.sync_stop_diary_hook.

No pytest / no deps. Run:  python test-lib-settings-hooks.py
Exit 0 = pass.

Regression coverage for the bug where setup-memory.sh treated ANY Stop hook
mentioning "session-diary" as already-correct, so a hook still wired to the
old broken ~/.claude/scripts/session-diary.py path was never repointed to
the live scripts/hooks/session-diary.py copy on re-run.
"""

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from lib_settings_hooks import sync_stop_diary_hook

FAILURES = []


def check(cond, msg):
    if cond:
        print(f"  ok  - {msg}")
    else:
        print(f"  FAIL - {msg}")
        FAILURES.append(msg)


LIVE_COMMAND = 'python3 "/repo/scripts/hooks/session-diary.py"'
STALE_COMMAND = 'python3 "/home/user/.claude/scripts/session-diary.py"'


def stop_hook(command):
    return {"hooks": [{"type": "command", "command": command, "timeout": 10000, "async": True}]}


def main():
    print("no prior hook -> added")
    hooks = {}
    changed, status = sync_stop_diary_hook(hooks, LIVE_COMMAND)
    check(changed is True, "reports changed")
    check(status == "added", f"status is 'added' (got {status!r})")
    check(hooks["Stop"][0]["hooks"][0]["command"] == LIVE_COMMAND, "installed the live command")

    print()
    print("hook already correct -> unchanged (idempotent)")
    hooks = {"Stop": [stop_hook(LIVE_COMMAND)]}
    changed, status = sync_stop_diary_hook(hooks, LIVE_COMMAND)
    check(changed is False, "reports unchanged")
    check(status == "unchanged", f"status is 'unchanged' (got {status!r})")

    print()
    print("hook wired to the old broken path -> repointed, not skipped")
    hooks = {"Stop": [stop_hook(STALE_COMMAND)]}
    changed, status = sync_stop_diary_hook(hooks, LIVE_COMMAND)
    check(changed is True, "reports changed")
    check(status == "repointed", f"status is 'repointed' (got {status!r})")
    check(
        hooks["Stop"][0]["hooks"][0]["command"] == LIVE_COMMAND,
        "stale command rewritten to the live path",
    )

    print()
    print("stale hook but no live target available -> left alone, no crash")
    hooks = {"Stop": [stop_hook(STALE_COMMAND)]}
    changed, status = sync_stop_diary_hook(hooks, None)
    check(changed is False, "reports unchanged (nothing to repoint to)")
    check(
        hooks["Stop"][0]["hooks"][0]["command"] == STALE_COMMAND,
        "stale command left untouched rather than nulled out",
    )

    print()
    print("no prior hook and no live target -> reported, not installed")
    hooks = {}
    changed, status = sync_stop_diary_hook(hooks, None)
    check(changed is False, "reports unchanged")
    check(status == "missing-target", f"status is 'missing-target' (got {status!r})")
    check("Stop" not in hooks or not hooks["Stop"], "no hook installed")

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} assertion(s)")
        return 1
    print("PASSED: all assertions green")
    return 0


if __name__ == "__main__":
    sys.exit(main())
