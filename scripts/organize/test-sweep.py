"""Tests for sweep.py. Self-contained — `python test-sweep.py`.

A scheduled job is the one piece of this project nobody watches run, so the
tests are about restraint rather than capability: that a dry-run touches
nothing, that the job never deletes, and that a file it could not confidently
name is left where a human will trip over it instead of being filed away.
"""

import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import organize as org                                              # noqa: E402
import route                                                        # noqa: E402
import sweep as sw                                                  # noqa: E402

FAILURES = []


def check(name, condition, detail=""):
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}  {detail}")
        FAILURES.append(name)


class Sandbox:
    """Point the sweep at a throwaway tree instead of the real zones."""

    def __init__(self):
        self.tmp = Path(tempfile.mkdtemp())
        # Logs live outside the managed tree so a file-count assertion measures
        # what the sweep MOVED, not what it wrote about the move.
        self.logs = Path(tempfile.mkdtemp())
        self.downloads = self.tmp / "Downloads"
        self.downloads.mkdir(parents=True)
        self._saved = {}

    def __enter__(self):
        self._saved = {
            "zones": dict(org.ZONES),
            "act": list(sw.ACT_ZONES),
            "lint": list(sw.LINT_ZONES),
            "log": sw.LOG_DIR,
            "report": sw.REPORT,
            "history": sw.HISTORY,
            "onedrive": route.ONEDRIVE,
            "dl": route.DOWNLOADS,
        }
        org.ZONES.clear()
        org.ZONES["downloads"] = self.downloads
        sw.ACT_ZONES[:] = ["downloads"]
        sw.LINT_ZONES[:] = ["downloads"]
        sw.LOG_DIR = self.logs
        sw.REPORT = sw.LOG_DIR / "sweep-latest.md"
        sw.HISTORY = sw.LOG_DIR / "sweep-history.ndjson"
        route.ONEDRIVE = self.tmp / "OneDrive"
        route.DOWNLOADS = self.downloads
        return self

    def __exit__(self, *exc):
        org.ZONES.clear()
        org.ZONES.update(self._saved["zones"])
        sw.ACT_ZONES[:] = self._saved["act"]
        sw.LINT_ZONES[:] = self._saved["lint"]
        sw.LOG_DIR = self._saved["log"]
        sw.REPORT = self._saved["report"]
        sw.HISTORY = self._saved["history"]
        route.ONEDRIVE = self._saved["onedrive"]
        route.DOWNLOADS = self._saved["dl"]
        shutil.rmtree(self.tmp, ignore_errors=True)
        shutil.rmtree(self.logs, ignore_errors=True)

    def write(self, name, body="x"):
        path = self.downloads / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
        return path


def snapshot(root):
    return sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file())


def test_dry_run_changes_nothing():
    with Sandbox() as box:
        box.write("Some Loose File.txt")
        box.write("20260819-din-deck.pdf")
        before = snapshot(box.tmp)
        sw.sweep(False)
        check("dry-run leaves every file where it was",
              snapshot(box.tmp) == before,
              f"{before} -> {snapshot(box.tmp)}")


def test_unnameable_file_is_not_filed_away():
    """The failure this guards: a file the sweep would not rename still gets
    routed, landing in a tidy folder under a name nobody chose."""
    with Sandbox() as box:
        loose = box.write("Some Loose File.txt")
        sw.sweep(True)
        check("low-confidence file stays put where it is visible",
              loose.exists(), f"moved to {snapshot(box.tmp)}")


def test_confidently_named_file_is_routed():
    with Sandbox() as box:
        probe = box.write("20260819-din-deck.pdf")
        sw.sweep(True)
        landed = list((box.tmp / "OneDrive").rglob("20260819-din-deck.pdf"))
        check("entity-tagged file reaches its folder",
              not probe.exists() and len(landed) == 1,
              f"{snapshot(box.tmp)}")


def test_sweep_never_deletes():
    with Sandbox() as box:
        box.write("installers/old-thing.exe")
        box.write("20260819-din-deck.pdf")
        box.write("Some Loose File.txt")
        before = len(snapshot(box.tmp))
        sw.sweep(True)
        check("file count is preserved — nothing was destroyed",
              len(snapshot(box.tmp)) == before,
              f"{before} -> {len(snapshot(box.tmp))}")


def test_report_and_history_are_written():
    with Sandbox() as box:
        box.write("Some Loose File.txt")
        record, review, _ = sw.sweep(False)
        check("report file exists", sw.REPORT.is_file())
        text = sw.REPORT.read_text(encoding="utf-8")
        check("report names the file needing a human",
              "Some Loose File.txt" in text)
        check("report states the mode", "dry-run" in text)
        check("history line appended", sw.HISTORY.is_file())
        line = json.loads(sw.HISTORY.read_text(encoding="utf-8").splitlines()[-1])
        check("history records the review count",
              line["needs_review"] == len(review) == 1, line)


def test_lint_parses_thousands_separators():
    """organize.py prints `1,061/1,061`. A bare int() on that raises, and the
    original handler swallowed it — reporting a fully conforming zone as 0/0."""
    with Sandbox() as box:
        for i in range(3):
            box.write(f"2026081{i}-din-deck-{i}.pdf")
        conforming, total = sw.lint(box.downloads)
        check("lint returns real numbers", (conforming, total) == (3, 3),
              (conforming, total))

    class FakeResult:
        stdout = "  conforming 1,061/1,061 (100.0%)  violations 0"

    import re as _re
    match = _re.search(r"conforming\s+([\d,]+)/([\d,]+)", FakeResult.stdout)
    parsed = (int(match.group(1).replace(",", "")), int(match.group(2).replace(",", "")))
    check("thousands separators parse", parsed == (1061, 1061), parsed)


def test_unreadable_lint_is_loud_not_zero():
    """A parse failure must not look like an empty zone."""
    with Sandbox() as box:
        conforming, total = sw.lint(box.tmp / "does-not-exist")
        check("missing root reports unreadable, not 0/0",
              conforming is None, (conforming, total))
        sw.write_report({"ran": "2026-01-01T00:00:00", "mode": "dry-run",
                         "renamed": 0, "routed": 0},
                        [], [], {"ghost": (None, None)})
        check("report says it could not read the lint",
              "could not read lint output" in sw.REPORT.read_text(encoding="utf-8"))


def test_history_accumulates():
    with Sandbox() as box:
        box.write("20260819-din-deck.pdf")
        sw.sweep(False)
        sw.sweep(False)
        lines = sw.HISTORY.read_text(encoding="utf-8").strip().splitlines()
        check("two runs, two history lines", len(lines) == 2, len(lines))


def test_stale_installer_is_reported_not_touched():
    with Sandbox() as box:
        old = box.write("20250101-misc-setup.exe")
        import os
        ancient = old.stat().st_mtime - (sw.STALE_INSTALLER_DAYS + 10) * 86400
        os.utime(old, (ancient, ancient))
        found = sw.stale_installers()
        check("stale installer is found", len(found) == 1, found)
        check("stale installer still exists", old.exists())
        fresh = box.write("20260819-misc-new-setup.exe")
        check("fresh installer is not reported",
              all(Path(e["path"]) != fresh for e in sw.stale_installers()))


def main():
    for test in sorted(
        (v for k, v in globals().items() if k.startswith("test_")),
        key=lambda f: f.__code__.co_firstlineno,
    ):
        print(f"\n{test.__name__}")
        test()
    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} — " + ", ".join(FAILURES))
        sys.exit(1)
    print("all passed")


if __name__ == "__main__":
    main()
