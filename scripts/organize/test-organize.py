"""Self-contained tests for organize.py. No pytest, no deps.

Run:  python test-organize.py       Exit 0 = pass.

Everything happens in a temp tree; the real zones are never touched. The test
that matters is `test_round_trip`: apply -> undo must return the tree
byte-identical, manifest and directory set included.
"""

import hashlib
import importlib.util
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("organize", HERE / "organize.py")
org = importlib.util.module_from_spec(spec)
spec.loader.exec_module(org)

FAILURES = []


def check(cond, msg):
    if cond:
        print(f"  ok   - {msg}")
    else:
        print(f"  FAIL - {msg}")
        FAILURES.append(msg)


def write_file(root, relpath, content=b"x", mtime=None):
    path = Path(root) / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


def manifest(root):
    """relpath -> sha256 for every file, plus the set of directory relpaths."""
    files, dirs = {}, set()
    for current, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(current, root)
        if rel_dir != ".":
            dirs.add(rel_dir.replace("\\", "/"))
        for name in filenames:
            full = Path(current) / name
            rel = os.path.relpath(full, root).replace("\\", "/")
            files[rel] = hashlib.sha256(full.read_bytes()).hexdigest()
    return files, dirs


# --------------------------------------------------------------------------
# pure functions
# --------------------------------------------------------------------------

def test_slugify():
    print("\nslugify")
    check(org.slugify("Presentación FINAL") == "presentacion-final", "accents folded to ascii")
    check(org.slugify("Año  Nuevo!!") == "ano-nuevo", "n-tilde -> n, punctuation collapsed")
    check(org.slugify("a__b..c  d") == "a-b-c-d", "separators normalised")
    check(org.slugify("---") == "", "punctuation-only -> empty")


def test_extract_date():
    print("\nextract_date")
    check(org.extract_date("20250301-report")[0] == "20250301", "compact yyyymmdd")
    check(org.extract_date("Screenshot 2025-03-01 at 10.32")[0] == "20250301", "dashed yyyy-mm-dd")
    check(org.extract_date("acta_2025_03_01")[0] == "20250301", "underscored yyyy_mm_dd")
    check(org.extract_date("factura 25-03-2025")[0] == "20250325", "dd-mm-yyyy when day > 12")
    check(org.extract_date("05.18.26 - order")[0] == "20260518",
          "mm.dd.yy resolved because 18 cannot be a month")
    check(org.extract_date("18.05.26 - order")[0] == "20260518", "dd.mm.yy resolved the same way")
    check(org.extract_date("factura 03-04-2025")[0] is None,
          "ambiguous dd-mm vs mm-dd is refused, not guessed")
    check(org.extract_date("factura 03-04-2025")[2] is True, "the ambiguity is reported")
    check("03-04-2025" not in org.extract_date("factura 03-04-2025")[1],
          "ambiguous date is still stripped, so it does not duplicate into the descriptor")
    check(org.extract_date("20259901-x")[0] is None, "impossible date rejected")
    check(org.extract_date("informe sin fecha")[0] is None, "no date -> None")
    check(org.extract_date("informe sin fecha")[2] is False, "no date is not 'ambiguous'")
    check("20250301" not in org.extract_date("20250301-rsf-informe")[1],
          "matched date removed from the stem")


def test_extract_version():
    print("\nextract_version")
    check(org.extract_version("propuesta v2")[0] == 2, "trailing v2")
    check(org.extract_version("propuesta-v10-draft")[0] == 10, "mid-stem v10")
    check(org.extract_version("propuesta v1 rev v3")[0] == 3, "last version token wins")
    check(org.extract_version("archivo-vertical")[0] is None, "'vertical' is not a version token")
    check(org.extract_version("informe")[0] is None, "no version -> None")


def test_extract_entity():
    print("\nextract_entity")
    check(org.extract_entity("propuesta rsf comercial", []) == ("rsf", "filename"), "entity in stem")
    check(org.extract_entity("informe", ["clients", "munet"]) == ("munet", "path"), "entity from path")
    check(org.extract_entity("propuesta", []) == ("misc", None), "sentinel when unknown")
    check(org.extract_entity("iago-os roadmap", [])[0] == "iago-os", "multi-token entity")


def test_derive_name():
    print("\nderive_name")
    fixed_mtime = 1740787200.0                       # 2025-03-01 local

    result = org.derive_name("Propuesta Comercial RSF v2.pdf", fixed_mtime, [])
    check(result["name"].endswith("-rsf-propuesta-comercial-v2.pdf"), "version repositioned to suffix")
    check(result["confidence"] == "medium", "date from mtime -> medium confidence")

    result = org.derive_name("20250301-rsf-Informe.PDF", fixed_mtime, [])
    check(result["name"] == "20250301-rsf-informe.pdf", "case normalised, extension lowered")
    check(result["confidence"] == "high", "date and entity both from filename -> high")

    result = org.derive_name("Presentación FINAL v2 (1).pptx", fixed_mtime, [])
    check("final" in result["name"], "'FINAL' kept in the descriptor, never silently dropped")
    check("copy-marker" in result["flags"], "windows copy marker flagged")
    check("(1)" not in result["name"], "copy marker stripped from the name")

    result = org.derive_name("IMG_1234.jpg", fixed_mtime, [])
    check(result["confidence"] == "low", "degenerate stem -> low confidence")
    check("degenerate-stem" in result["flags"], "degenerate stem flagged for review")

    result = org.derive_name("informe.pdf", fixed_mtime, ["clients", "munet"])
    check(result["entity"] == "munet" and result["entity_source"] == "path", "entity inherited from path")

    result = org.derive_name("---.pdf", fixed_mtime, [])
    check("empty-descriptor" in result["flags"], "empty descriptor flagged")
    check(result["name"].endswith("-misc-file.pdf"), "empty descriptor falls back to 'file'")

    long_name = "a" * 200 + ".pdf"
    result = org.derive_name(long_name, fixed_mtime, [])
    check(len(os.path.splitext(result["name"])[0]) <= 8 + 1 + 4 + 1 + org.MAX_DESCRIPTOR,
          "descriptor truncated at the cap")


def test_is_conforming():
    print("\nis_conforming")
    check(org.is_conforming("20250301-rsf-propuesta-comercial"), "dated form conforms")
    check(org.is_conforming("20250301-rsf-propuesta-v2"), "versioned form conforms")
    check(org.is_conforming("rsf-contrato-marco"), "undated reference form is legal")
    check(not org.is_conforming("propuesta-comercial"), "no entity -> not conforming")
    check(not org.is_conforming("20250301-rsf"), "entity with no descriptor -> not conforming")
    check(not org.is_conforming("Propuesta RSF"), "spaces and caps -> not conforming")
    check(org.is_conforming("20250301-misc-algo"), "the misc sentinel conforms")


def test_guards():
    print("\nguards")
    ok, why = org.name_is_legal("nul.pdf")
    check(not ok and why == "reserved-name", "windows reserved device name refused")
    check(not org.name_is_legal("informe.pdf ")[0], "trailing space refused")
    check(org.name_is_legal("20250301-rsf-informe.pdf")[0], "normal name allowed")

    class FakeStat:
        def __init__(self, attrs):
            self.st_file_attributes = attrs

    for bit, label in ((0x1000, "OFFLINE"), (0x40000, "RECALL_ON_OPEN"),
                       (0x400000, "RECALL_ON_DATA_ACCESS")):
        check(org.is_placeholder(FakeStat(bit)), f"placeholder detected via {label}")
    check(not org.is_placeholder(FakeStat(0x20)), "ordinary archive-bit file is not a placeholder")

    check(org.under_frozen_zone(Path.home() / "dev" / "iago-os" / "x.txt"),
          "dev\\ is refused (rename-frozen code zone)")
    check(not org.under_frozen_zone(Path.home() / "Downloads" / "x.txt"), "Downloads is not frozen")


# --------------------------------------------------------------------------
# tree-level
# --------------------------------------------------------------------------

def test_scan_skips():
    print("\nscan — skips")
    with tempfile.TemporaryDirectory() as tmp:
        write_file(tmp, "20250301-rsf-informe.pdf")
        write_file(tmp, "repo/.git/config")
        write_file(tmp, "repo/notes.txt")
        write_file(tmp, "node_modules/pkg/index.js")
        write_file(tmp, "Propuesta RSF.pdf")

        plan = org.scan(tmp)
        reasons = {Path(s["path"]).name: s["reason"] for s in plan["skipped"]}
        proposed = {Path(o["src"]).name for o in plan["ops"]}

        check(reasons.get("20250301-rsf-informe.pdf") == "already-conforming",
              "already-conforming file produces no op")
        check(reasons.get("notes.txt") == "inside-git-worktree", "nested git worktree skipped")
        check("index.js" not in proposed and "index.js" not in reasons,
              "node_modules never descended into")
        check("Propuesta RSF.pdf" in proposed, "non-conforming file is proposed")


def test_scan_refuses_frozen_and_repo():
    print("\nscan — refusals")
    with tempfile.TemporaryDirectory() as tmp:
        write_file(tmp, ".git/config")
        write_file(tmp, "doc.pdf")
        try:
            org.scan(tmp)
            check(False, "scanning a git working tree is refused")
        except SystemExit as exc:
            check("git working tree" in str(exc), "scanning a git working tree is refused")


def test_collision():
    print("\ncollision")
    with tempfile.TemporaryDirectory() as tmp:
        stamp = 1740787200.0
        write_file(tmp, "Informe RSF.pdf", b"one", mtime=stamp)
        write_file(tmp, "informe_rsf.pdf", b"two", mtime=stamp)
        plan = org.scan(tmp)
        names = sorted(Path(o["dst"]).name for o in plan["ops"])
        check(len(names) == 2, "both files proposed")
        check(sum(1 for n in names if n.endswith("-2.pdf")) == 1,
              f"exactly one target suffixed: {names}")
        check(names[0] != names[1], "targets are distinct")

        org.apply_plan(plan, True, journal_path=Path(tmp) / "j.ndjson")
        on_disk = sorted(p.name for p in Path(tmp).glob("*.pdf"))
        check(len(on_disk) == 2, "both files survive apply — neither clobbered")
        contents = sorted((Path(tmp) / n).read_bytes() for n in on_disk)
        check(contents == [b"one", b"two"], "both payloads intact after collision handling")


def test_case_only_rename():
    print("\ncase-only rename")
    with tempfile.TemporaryDirectory() as tmp:
        write_file(tmp, "20250301-rsf-Informe.pdf", b"payload")
        plan = org.scan(tmp)
        check(len(plan["ops"]) == 1, "case difference alone still produces an op")
        org.apply_plan(plan, True, journal_path=Path(tmp) / "j.ndjson")
        names = [p.name for p in Path(tmp).glob("*.pdf")]
        check(names == ["20250301-rsf-informe.pdf"], f"case fixed on disk: {names}")
        check((Path(tmp) / names[0]).read_bytes() == b"payload", "payload intact")


def test_path_ceiling():
    print("\npath ceiling")
    with tempfile.TemporaryDirectory() as tmp:
        write_file(tmp, "Propuesta Comercial Muy Larga Para RSF.pdf")
        original = org.MAX_PATH
        try:
            org.MAX_PATH = len(tmp) + 10
            plan = org.scan(tmp)
        finally:
            org.MAX_PATH = original
        reasons = [s["reason"] for s in plan["skipped"]]
        check(len(plan["ops"]) == 0, "no op proposed past the ceiling")
        check(any(r.startswith("path-too-long") for r in reasons),
              "over-long target refused, not truncated")


def test_dry_run_changes_nothing():
    print("\ndry run")
    with tempfile.TemporaryDirectory() as tmp:
        write_file(tmp, "Propuesta RSF.pdf", b"a")
        write_file(tmp, "Acta DIN.docx", b"b")
        before = manifest(tmp)
        plan = org.scan(tmp)
        results, journal = org.apply_plan(plan, False)
        check(journal is None, "dry run writes no journal")
        check(results["ok"] == 2, "dry run reports what it would do")
        check(manifest(tmp) == before, "dry run leaves the tree byte-identical")


def test_stale_file_skipped():
    print("\nstaleness")
    with tempfile.TemporaryDirectory() as tmp:
        target = write_file(tmp, "Propuesta RSF.pdf", b"original")
        plan = org.scan(tmp)
        target.write_bytes(b"changed after the scan")
        results, _ = org.apply_plan(plan, True, journal_path=Path(tmp) / "j.ndjson")
        check(results["stale"] == 1 and results["ok"] == 0,
              "a file modified between scan and apply is not renamed")
        check(target.exists(), "the modified file is left where it was")


def test_round_trip():
    print("\nROUND TRIP — apply then undo")
    with tempfile.TemporaryDirectory() as tmp:
        tree = Path(tmp) / "zone"
        stamp = 1740787200.0
        write_file(tree, "Propuesta Comercial RSF v2.pdf", b"one", mtime=stamp)
        write_file(tree, "Screenshot 2025-03-01 at 10.32.11.png", b"two", mtime=stamp)
        write_file(tree, "Presentación FINAL (1).pptx", b"three", mtime=stamp)
        write_file(tree, "IMG_1234.jpg", b"four", mtime=stamp)
        write_file(tree, "20250301-rsf-informe.pdf", b"five", mtime=stamp)
        write_file(tree, "sub/Acta DIN 25-03-2025.docx", b"six", mtime=stamp)
        write_file(tree, "sub/Año Nuevo.txt", b"seven", mtime=stamp)
        write_file(tree, "instalador.exe", b"eight", mtime=stamp)

        before_files, before_dirs = manifest(tree)
        journal_path = Path(tmp) / "journal.ndjson"

        plan = org.scan(tree, bucket=True)
        check(plan["counts"]["ops"] >= 7, f"scan proposed {plan['counts']['ops']} ops")

        results, _ = org.apply_plan(plan, True, journal_path=journal_path)
        check(results["ok"] == plan["counts"]["ops"], f"all ops applied: {results}")

        after_files, after_dirs = manifest(tree)
        check(after_files != before_files, "the tree actually changed")
        check(sorted(after_files.values()) == sorted(before_files.values()),
              "every payload survived the move — no file lost or clobbered")
        check("docs" in after_dirs and "images" in after_dirs, "bucket directories created")

        undo_results = org.undo(journal_path, True)
        check(undo_results["ok"] == results["ok"],
              f"undo restored every move: {undo_results}")
        check(undo_results["failed"] == 0 and undo_results["occupied"] == 0,
              "undo hit no conflicts")

        restored_files, restored_dirs = manifest(tree)
        check(restored_files == before_files, "FILES byte-identical after undo")
        check(restored_dirs == before_dirs,
              f"DIRECTORIES identical after undo (bucket dirs removed): "
              f"{sorted(restored_dirs ^ before_dirs)}")


def test_journal_is_source_of_truth():
    print("\njournal")
    with tempfile.TemporaryDirectory() as tmp:
        write_file(tmp, "Propuesta RSF.pdf", b"a")
        journal_path = Path(tmp) / "j.ndjson"
        plan = org.scan(tmp)
        org.apply_plan(plan, True, journal_path=journal_path)

        lines = [json.loads(line) for line in journal_path.read_text(encoding="utf-8").splitlines()]
        check(lines[0]["type"] == "header", "journal opens with a header record")
        check(lines[0]["ops_planned"] == len(plan["ops"]), "header records the planned count")
        moves = [r for r in lines if r.get("op") == "rename"]
        check(len(moves) == 1 and moves[0]["status"] == "ok", "one ok rename recorded")
        check(os.path.exists(moves[0]["dst"]), "journal dst matches what is on disk")


def test_undo_refuses_when_occupied():
    print("\nundo — conflict")
    with tempfile.TemporaryDirectory() as tmp:
        write_file(tmp, "Propuesta RSF.pdf", b"a")
        journal_path = Path(tmp) / "j.ndjson"
        plan = org.scan(tmp)
        org.apply_plan(plan, True, journal_path=journal_path)
        write_file(tmp, "Propuesta RSF.pdf", b"something new took the old name")

        results = org.undo(journal_path, True)
        check(results["occupied"] == 1 and results["ok"] == 0,
              "undo refuses to overwrite a file that reclaimed the original name")
        check((Path(tmp) / "Propuesta RSF.pdf").read_bytes() == b"something new took the old name",
              "the occupying file is left untouched")


def main():
    for test in (test_slugify, test_extract_date, test_extract_version, test_extract_entity,
                 test_derive_name, test_is_conforming, test_guards, test_scan_skips,
                 test_scan_refuses_frozen_and_repo, test_collision, test_case_only_rename,
                 test_path_ceiling, test_dry_run_changes_nothing, test_stale_file_skipped,
                 test_round_trip, test_journal_is_source_of_truth, test_undo_refuses_when_occupied):
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
