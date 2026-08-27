"""Self-contained tests for iago-lint.py. No pytest, no deps.

Run:  python test-iago-lint.py       Exit 0 = pass.

Everything happens in a temp tree; no real workspace is ever read or touched.
The tests that matter are the negative ones: `_config/`, `_archive/` and
`plans/*/_archive/` are *required* by the schema, and a linter that reports
them as scratch would propose moving the entire config tree into a gitignored
directory. Those three are asserted silent in every relevant code.

The linter is report-only in this plan. `test_no_fix_surface` is the guard.
"""

import datetime
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

try:                                  # em dashes and § survive a redirected stdout
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("iago_lint", HERE / "iago-lint.py")
lint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lint)

FAILURES = []


def check(cond, msg):
    if cond:
        print(f"  ok   - {msg}")
    else:
        print(f"  FAIL - {msg}")
        FAILURES.append(msg)


# --------------------------------------------------------------------------
# fixtures
# --------------------------------------------------------------------------

def write_file(root, relpath, content=b"x", mtime=None):
    path = Path(root) / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


def days_ago(n):
    return (datetime.date.today() - datetime.timedelta(days=n)).isoformat()


def conforming(tmp, updated=None):
    """The minimal workspace that MUST lint clean. Every other fixture starts here."""
    root = Path(tmp)
    updated = updated or days_ago(0)
    write_file(root, ".iago/CONTEXT.md", b"# CONTEXT\n\nrouting.\n")
    write_file(root, ".iago/PROJECT.md", b"# PROJECT\n")
    write_file(root, ".iago/ROADMAP.md", b"# ROADMAP\n")
    write_file(root, ".iago/STATE.md",
               f"# State\n\n> **Tag:** v0.1.0 | **Updated:** {updated}\n".encode())
    write_file(root, ".iago/config.json", b'{"project":{"name":"probe"}}\n')
    write_file(root, ".iago/_config/learnings/patterns.md", b"| # | Pattern |\n")
    write_file(root, ".iago/plans/feature-x/README.md", b"# feature-x\n")
    write_file(root, ".iago/research/2026-08-26-probe.md", b"# probe\n")
    write_file(root, ".iago/summaries/feature-x-01.md", b"# summary\n")
    return root


def age_iago(root, days):
    """Push every file under .iago/ back N days, so only new files look new."""
    stamp = (datetime.datetime.now() - datetime.timedelta(days=days)).timestamp()
    for current, _dirnames, filenames in os.walk(Path(root) / ".iago"):
        for name in filenames:
            os.utime(Path(current) / name, (stamp, stamp))


def codes(findings):
    return sorted(f["code"] for f in findings)


def by_code(findings, code):
    return [f for f in findings if f["code"] == code]


# --------------------------------------------------------------------------
# the clean baseline
# --------------------------------------------------------------------------

def test_conforming_workspace_is_silent():
    print("\nconforming baseline")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        findings = lint.check_workspace(root)
        check(findings == [], f"a schema-conforming workspace reports nothing (got {codes(findings)})")


# --------------------------------------------------------------------------
# W001 — required files
# --------------------------------------------------------------------------

def test_w001_required_file_set():
    print("\nW001 — missing required file")
    check(tuple(lint.REQUIRED_FILES) ==
          ("CONTEXT.md", "PROJECT.md", "ROADMAP.md", "STATE.md", "config.json"),
          "the required set is exactly CONTEXT/PROJECT/ROADMAP/STATE/config.json")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        (root / ".iago" / "PROJECT.md").unlink()
        findings = lint.check_workspace(root)
        w001 = by_code(findings, "W001")
        check(len(w001) == 1, f"exactly one W001 for one missing file (got {len(w001)})")
        check(w001 and w001[0]["path"] == ".iago/PROJECT.md", "W001 names the missing file")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        for name in lint.REQUIRED_FILES:
            (root / ".iago" / name).unlink()
        findings = lint.check_workspace(root)
        # STATE.md gone also means no Updated: to read — W006 must not double-report it.
        check(len(by_code(findings, "W001")) == 5, "one W001 per missing required file")
        check(by_code(findings, "W006") == [],
              "a missing STATE.md is W001 only — W006 does not pile on")


# --------------------------------------------------------------------------
# W002 — banned directory at .iago/ root
# --------------------------------------------------------------------------

def test_w002_banned_root_dir():
    print("\nW002 — banned dir at .iago/ root")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        write_file(root, ".iago/reviews/pr12-opus.md", b"review\n")
        findings = lint.check_workspace(root)
        w002 = by_code(findings, "W002")
        check(len(w002) == 1 and w002[0]["path"] == ".iago/reviews",
              "reviews/ at .iago/ root is W002")
        check(w002 and "state" in w002[0]["fix"], "the fix names state/ as reviews/'s home")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        for name in ("context", "runbooks", "decisions", "learnings", "prompts", "hooks"):
            write_file(root, f".iago/{name}/thing.md", b"x\n")
        findings = by_code(lint.check_workspace(root), "W002")
        check(len(findings) == 6, f"all six _config/ escapees are W002 (got {len(findings)})")
        check(all("_config" in f["fix"] for f in findings),
              "each one's fix points under _config/")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        write_file(root, ".iago/plans/feature-x/context/brief.md", b"x\n")
        check(by_code(lint.check_workspace(root), "W002") == [],
              "the ban is scoped to .iago/ ROOT — plans/feature-x/context/ is fine")


def test_w002_never_flags_the_required_underscore_dirs():
    print("\nW002 — carve-out")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        write_file(root, ".iago/_config/runbooks/deploy.md", b"# deploy\n")
        write_file(root, ".iago/_archive/2026-05-old/decision.md", b"# old\n")
        write_file(root, ".iago/plans/_archive/2026-05-thing/01.md", b"# archived\n")
        findings = lint.check_workspace(root)
        check(by_code(findings, "W002") == [],
              "_config/, _archive/ and plans/_archive/ are required, never W002")
        check(findings == [], f"the whole carve-out tree is silent (got {codes(findings)})")


# --------------------------------------------------------------------------
# W003 — scratch files outside state/
# --------------------------------------------------------------------------

def test_w003_scratch_files():
    print("\nW003 — scratch file outside state/")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        write_file(root, ".iago/_scratch-pr368-body.md", b"draft\n")
        write_file(root, ".iago/tmp-diff.txt", b"diff\n")
        write_file(root, ".iago/summaries/dispatch-01.log", b"log\n")
        write_file(root, ".iago/amplify_outputs.bak", b"bak\n")
        findings = by_code(lint.check_workspace(root), "W003")
        paths = sorted(f["path"] for f in findings)
        check(paths == [".iago/_scratch-pr368-body.md", ".iago/amplify_outputs.bak",
                        ".iago/summaries/dispatch-01.log", ".iago/tmp-diff.txt"],
              f"_*, tmp*, *.log and *.bak are all W003 (got {paths})")
        check(all(".iago/state" in f["fix"] for f in findings),
              "every W003 fix names a .iago/state/ destination")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        write_file(root, ".iago/state/_scratch-pr368-body.md", b"draft\n")
        write_file(root, ".iago/state/pipeline-runs/run.log", b"log\n")
        write_file(root, ".iago/state/tmp-diff.txt", b"diff\n")
        check(lint.check_workspace(root) == [],
              "the same names inside state/ are the point of state/ — silent")


def test_w003_never_flags_the_underscore_directories():
    print("\nW003 — the carve-out that would move _config/ into state/")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        write_file(root, ".iago/_config/context/voice.md", b"# voice\n")
        write_file(root, ".iago/_config/prompts/review.md", b"# prompt\n")
        write_file(root, ".iago/_archive/2026-05-specs/api.md", b"# api\n")
        write_file(root, ".iago/plans/feature-x/_archive/01-old.md", b"# old\n")
        findings = lint.check_workspace(root)
        check(by_code(findings, "W003") == [],
              "no W003 anywhere in _config/, _archive/ or plans/*/_archive/")
        check(findings == [], f"the carve-out tree is entirely silent (got {codes(findings)})")


def test_nearest_state_dir():
    print("\nW003 — destination is the NEAREST .iago/state/")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / ".iago" / "summaries").mkdir(parents=True)
        (root / "app" / ".iago" / "summaries").mkdir(parents=True)
        outer = lint.nearest_state_dir(root / ".iago" / "summaries" / "run.log")
        inner = lint.nearest_state_dir(root / "app" / ".iago" / "summaries" / "run.log")
        check(outer == root / ".iago" / "state", "a root-workspace file resolves to the root state/")
        check(inner == root / "app" / ".iago" / "state",
              "a nested-workspace file resolves to ITS state/, not the root's")
        check(lint.nearest_state_dir(root / "loose.log") is None,
              "a file under no .iago/ has no state/ destination")


# --------------------------------------------------------------------------
# W004 — zero-byte files
# --------------------------------------------------------------------------

def test_w004_zero_byte():
    print("\nW004 — zero-byte file")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        write_file(root, ".iago/research/2026-08-01-empty.md", b"")
        findings = by_code(lint.check_workspace(root), "W004")
        check(len(findings) == 1 and findings[0]["path"] == ".iago/research/2026-08-01-empty.md",
              "an empty file is W004")
        check(findings and findings[0]["fix"], "a plain zero-byte file gets a fix")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        write_file(root, ".iago/plans/.gitkeep", b"")
        findings = by_code(lint.check_workspace(root), "W004")
        check(len(findings) == 1 and findings[0]["path"] == ".iago/plans/.gitkeep",
              ".gitkeep is reported as W004")
        check(findings and findings[0]["fix"] is None,
              ".gitkeep carries NO auto-fix — deleting it removes a scaffolded directory")
        check(findings and "seed" in findings[0]["message"],
              "the .gitkeep message names the real remedy (a seed file)")


# --------------------------------------------------------------------------
# W005 — empty directories
# --------------------------------------------------------------------------

def test_w005_empty_dir():
    print("\nW005 — empty directory")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        (root / ".iago" / "_config" / "decisions").mkdir(parents=True)
        findings = by_code(lint.check_workspace(root), "W005")
        check(len(findings) == 1 and findings[0]["path"] == ".iago/_config/decisions",
              "an empty directory is W005")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        (root / ".iago" / "state" / "sessions").mkdir(parents=True)
        (root / ".iago" / "_archive").mkdir(parents=True)
        check(lint.check_workspace(root) == [],
              "empty state/ and _archive/ subtrees are skipped, not reported")


# --------------------------------------------------------------------------
# W006 — STATE.md staleness
# --------------------------------------------------------------------------

def test_w006_state_staleness():
    print("\nW006 — STATE.md Updated:")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp, updated=days_ago(30))
        write_file(root, ".iago/research/2026-08-26-fresh.md", b"# fresh\n")
        findings = by_code(lint.check_workspace(root), "W006")
        check(len(findings) == 1 and findings[0]["path"] == ".iago/STATE.md",
              "Updated: 30 days behind the newest file is W006")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp, updated=days_ago(30))
        age_iago(root, 30)
        check(by_code(lint.check_workspace(root), "W006") == [],
              "Updated: level with the newest file is clean")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp, updated=days_ago(30))
        age_iago(root, 30)
        write_file(root, ".iago/state/pipeline-runs/run.ndjson", b"{}\n")
        write_file(root, ".iago/_archive/2026-01-old/note.md", b"old\n")
        write_file(root, ".iago/__pycache__/x.pyc", b"\x00\x01")
        check(by_code(lint.check_workspace(root), "W006") == [],
              "state/, _archive/ and __pycache__/ do not count as 'newest file'")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        write_file(root, ".iago/STATE.md", b"# State\n\nno date line here\n")
        findings = by_code(lint.check_workspace(root), "W006")
        check(len(findings) == 1 and "Updated:" in findings[0]["message"],
              "a STATE.md with no Updated: line is W006")
    check(lint.STALE_DAYS == 14, "the staleness window is the 14 days the lifecycle table names")


# --------------------------------------------------------------------------
# W007 — nested .iago/ in an app repo
# --------------------------------------------------------------------------

def test_w007_nested_iago():
    print("\nW007 — nested .iago/ in an app repo")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        write_file(root, "app/.iago/plans/01-thing.md", b"# plan\n")
        write_file(root, "app/.iago/summaries/01-thing.md", b"# summary\n")
        findings = by_code(lint.check_workspace(root), "W007")
        check(len(findings) == 1 and findings[0]["path"] == "app/.iago",
              "a nested .iago/ holding plans is W007, reported once for the tree")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        (root / "app" / ".iago" / "state" / ".pipeline.lock.d").mkdir(parents=True)
        write_file(root, "app/.iago/state/lock", b"pid\n")
        check(by_code(lint.check_workspace(root), "W007") == [],
              "a nested .iago/ holding only state/ is the sanctioned lock location")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        write_file(root, "clients/acme/.iago/PROJECT.md", b"# acme\n")
        check(by_code(lint.check_workspace(root), "W007") == [],
              "clients/* are registered sub-workspaces, not nested app .iago/ trees")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        write_file(root, "templates/client-project/.iago/PROJECT.md.template", b"# {{X}}\n")
        check(by_code(lint.check_workspace(root), "W007") == [],
              "templates/*/.iago is the scaffolder's source — the EMITTED tree is what lints")


# --------------------------------------------------------------------------
# W008 — docs/ holding a second plan system
# --------------------------------------------------------------------------

def test_w008_docs_holds_planning():
    print("\nW008 — docs/ holding plans|research|reviews")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        write_file(root, "docs/plans/pagos-v0/01.md", b"# plan\n")
        write_file(root, "docs/research/spike.md", b"# spike\n")
        write_file(root, "docs/architecture.md", b"# arch\n")
        findings = by_code(lint.check_workspace(root), "W008")
        paths = sorted(f["path"] for f in findings)
        check(paths == ["docs/plans", "docs/research"],
              f"only the planning subtrees are W008 (got {paths})")
        check(all("_archive" in f["fix"] for f in findings),
              "the fix routes them to plans/_archive/, per §3")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        write_file(root, "docs/api.md", b"# api\n")
        write_file(root, "docs/specs/vision.md", b"# vision\n")
        check(by_code(lint.check_workspace(root), "W008") == [],
              "a human-facing docs/ tree is exactly what docs/ is for")


# --------------------------------------------------------------------------
# W009 / W010 — one roadmap, no README
# --------------------------------------------------------------------------

def test_w009_second_roadmap():
    print("\nW009 — a second ROADMAP")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        write_file(root, ".iago/ROADMAP-flow-tool.md", b"# second\n")
        findings = by_code(lint.check_workspace(root), "W009")
        check(len(findings) == 1 and findings[0]["path"] == ".iago/ROADMAP-flow-tool.md",
              "ROADMAP-*.md beside ROADMAP.md is W009")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        write_file(root, ".iago/plans/feature-x/ROADMAP-draft.md", b"# draft\n")
        check(by_code(lint.check_workspace(root), "W009") == [],
              "the one-roadmap rule is scoped to .iago/ root")


def test_w010_readme_at_iago_root():
    print("\nW010 — README.md at .iago/ root")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        write_file(root, ".iago/README.md", b"# third routing table\n")
        findings = by_code(lint.check_workspace(root), "W010")
        check(len(findings) == 1 and findings[0]["path"] == ".iago/README.md",
              "README.md at .iago/ root is W010 — CONTEXT.md is the entry")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        check(by_code(lint.check_workspace(root), "W010") == [],
              "plans/feature-x/README.md is the per-feature brief, not a violation")


# --------------------------------------------------------------------------
# the record shape plan 03 wires into CI
# --------------------------------------------------------------------------

def test_finding_record_shape():
    print("\nrecord shape")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp, updated=days_ago(40))
        (root / ".iago" / "PROJECT.md").unlink()
        write_file(root, ".iago/reviews/pr1.md", b"r\n")
        write_file(root, ".iago/_scratch.md", b"s\n")
        write_file(root, ".iago/research/empty.md", b"")
        (root / ".iago" / "_config" / "prompts").mkdir(parents=True)
        write_file(root, "app/.iago/plans/01.md", b"p\n")
        write_file(root, "docs/reviews/pr1.md", b"r\n")
        write_file(root, ".iago/ROADMAP-two.md", b"r\n")
        write_file(root, ".iago/README.md", b"r\n")
        findings = lint.check_workspace(root)

        check(set(codes(findings)) == {f"W{n:03d}" for n in range(1, 11)},
              f"the fixture trips all ten codes (got {sorted(set(codes(findings)))})")
        keys = {tuple(sorted(f.keys())) for f in findings}
        check(keys == {("code", "fix", "message", "path", "severity")},
              f"every record is exactly {{code, path, message, fix, severity}} (got {keys})")
        check(all(isinstance(f["code"], str) and f["code"] in lint.CODES for f in findings),
              "every code is a declared code")
        check(all(isinstance(f["path"], str) and "\\" not in f["path"] for f in findings),
              "paths are workspace-relative with forward slashes")
        check(all(isinstance(f["message"], str) and f["message"] for f in findings),
              "every message is a non-empty string")
        check(all(f["fix"] is None or isinstance(f["fix"], str) for f in findings),
              "fix is a string, or None when there is no safe automatic remedy")
        check(all(f["severity"] in ("error", "warning") for f in findings),
              "severity is error or warning")
        check(json.loads(json.dumps(findings)) == findings,
              "the record set round-trips through JSON — plan 03 can pipe it")


def test_exclude_filters_a_code():
    print("\n--exclude")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        write_file(root, ".iago/plans/.gitkeep", b"")
        write_file(root, ".iago/reviews/pr1.md", b"r\n")
        full = lint.check_workspace(root)
        filtered = lint.check_workspace(root, exclude={"W004"})
        check("W004" in codes(full) and "W004" not in codes(filtered),
              "--exclude W004 drops exactly that code")
        check(len(full) - len(filtered) == len(by_code(full, "W004")),
              "nothing else is dropped with it")


def test_find_workspaces():
    print("\nworkspace discovery")
    with tempfile.TemporaryDirectory() as tmp:
        root = conforming(tmp)
        conforming(root / "clients" / "acme")
        conforming(root / "clients" / "beta")
        check(lint.find_workspaces(root, scan_all=False) == [Path(root)],
              "--root scans exactly one workspace")
        found = lint.find_workspaces(root, scan_all=True)
        check(found == [Path(root), root / "clients" / "acme", root / "clients" / "beta"],
              f"--all adds the client sub-workspaces in order (got {found})")


def test_refuses_a_non_workspace():
    print("\nrefusal")
    with tempfile.TemporaryDirectory() as tmp:
        raised = False
        try:
            lint.check_workspace(Path(tmp))
        except SystemExit as exc:
            raised = "REFUSED" in str(exc)
        check(raised, "a directory with no .iago/ is REFUSED, never reported as clean")


def test_no_fix_surface():
    print("\nreport mode only")
    parser = lint.build_parser()
    sub = [a for a in parser._actions if a.dest == "command"]
    names = sorted(sub[0].choices) if sub else []
    check(names == ["check"], f"`check` is the only subcommand in this plan (got {names})")
    check(not any(hasattr(lint, n) for n in ("apply_fixes", "fix", "undo")),
          "no fix/undo surface exists yet — a naive W003 fix would move _config/ into state/")


# --------------------------------------------------------------------------

def main():
    for test in (test_conforming_workspace_is_silent,
                 test_w001_required_file_set,
                 test_w002_banned_root_dir,
                 test_w002_never_flags_the_required_underscore_dirs,
                 test_w003_scratch_files,
                 test_w003_never_flags_the_underscore_directories,
                 test_nearest_state_dir,
                 test_w004_zero_byte,
                 test_w005_empty_dir,
                 test_w006_state_staleness,
                 test_w007_nested_iago,
                 test_w008_docs_holds_planning,
                 test_w009_second_roadmap,
                 test_w010_readme_at_iago_root,
                 test_finding_record_shape,
                 test_exclude_filters_a_code,
                 test_find_workspaces,
                 test_refuses_a_non_workspace,
                 test_no_fix_surface):
        test()

    print()
    if FAILURES:
        print(f"FAILED  {len(FAILURES)}")
        for failure in FAILURES:
            print(f"  - {failure}")
        return 1
    print("PASSED  all assertions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
