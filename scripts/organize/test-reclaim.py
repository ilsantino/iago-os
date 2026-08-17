"""Self-contained tests for reclaim.py. No pytest, no deps.

Run:  python test-reclaim.py       Exit 0 = pass.

The trash root is redirected into a temp dir, so a bug here can never touch the
real quarantine. The tests that matter are the refusals: purge must refuse a
young batch, refuse anything outside the trash, and refuse a directory it did
not create.
"""

import hashlib
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location("reclaim", HERE / "reclaim.py")
rec = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rec)
org = rec.org

FAILURES = []


def check(cond, msg):
    if cond:
        print(f"  ok   - {msg}")
    else:
        print(f"  FAIL - {msg}")
        FAILURES.append(msg)


def write_file(root, relpath, content=b"x", age_days=None):
    path = Path(root) / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    if age_days is not None:
        when = Path(root).stat().st_mtime - age_days * 86400
        os.utime(path, (when, when))
    return path


def manifest(root):
    files = {}
    for current, _, filenames in os.walk(root):
        for name in filenames:
            full = Path(current) / name
            rel = os.path.relpath(full, root).replace("\\", "/")
            files[rel] = hashlib.sha256(full.read_bytes()).hexdigest()
    return files


def test_categories():
    print("\ncategories")
    with tempfile.TemporaryDirectory() as tmp:
        write_file(tmp, "a/report.pdf", b"unique content here")
        write_file(tmp, "a/report (1).pdf", b"unique content here")         # duplicate
        write_file(tmp, "b/deep/report.pdf", b"unique content here")        # duplicate
        write_file(tmp, "empty.txt", b"")                                   # zero-byte
        write_file(tmp, "movie.mp4.crdownload", b"partial")                 # partial
        write_file(tmp, "setup.exe", b"installer", age_days=90)             # stale installer
        write_file(tmp, "fresh-setup.exe", b"installer2", age_days=2)       # too new
        write_file(tmp, "Thumbs.db", b"cache")                              # cache
        write_file(tmp, "bundle.zip", b"archived")
        Path(tmp, "bundle").mkdir()                                         # extracted sibling
        write_file(tmp, "keeper.pdf", b"something else entirely")

        plan = rec.scan([tmp])
        by_path = {Path(c["path"]).name: c["category"] for c in plan["candidates"]}

        check(by_path.get("empty.txt") == "zero-byte", "zero-byte file identified")
        check(by_path.get("movie.mp4.crdownload") == "partial-download", "partial download identified")
        check(by_path.get("setup.exe") == "installer-stale", "installer older than 30d identified")
        check("fresh-setup.exe" not in by_path, "a recent installer is left alone")
        check(by_path.get("Thumbs.db") == "cache-artifact", "cache artifact identified")
        check(by_path.get("bundle.zip") == "archive-already-extracted",
              "archive with an extracted sibling identified")
        check("keeper.pdf" not in by_path, "an ordinary unique document is never a candidate")

        duplicates = [c for c in plan["candidates"] if c["category"] == "duplicate"]
        check(len(duplicates) == 2, f"two of the three identical files quarantined, one kept: {len(duplicates)}")
        keepers = {c["keeper"] for c in duplicates}
        check(len(keepers) == 1, "both duplicates point at the same keeper")
        check(Path(list(keepers)[0]).name == "report.pdf",
              "keeper is the shallowest path, tie-broken on the shortest name")
        check(all(Path(k).exists() for k in keepers), "the keeper is not itself a candidate")


def test_duplicate_name_judgment():
    print("\nduplicates — same bytes, different names")
    with tempfile.TemporaryDirectory() as tmp:
        write_file(tmp, "food_info.csv", b"identical payload A")
        write_file(tmp, "sub/food_info(1).csv", b"identical payload A")
        write_file(tmp, "materias RSB.pdf", b"identical payload B")
        write_file(tmp, "sub/book DBAN.pdf", b"identical payload B")

        plan = rec.scan([tmp])
        quarantined = {Path(c["path"]).name for c in plan["candidates"]}
        review = {Path(r["path"]).name: r["protected_by"] for r in plan["review"]}

        check("food_info(1).csv" in quarantined,
              "a copy-marked duplicate of the same name is auto-quarantined")
        check("book DBAN.pdf" in review or "materias RSB.pdf" in review,
              "identical bytes under different names goes to review")
        check("different-filenames" in review.values(),
              "the reason names the judgment: which name survives is not a hash question")
        check(not any(n.endswith(".pdf") for n in quarantined),
              "neither differently-named copy is deleted automatically")


def test_virtualenv_detection():
    print("\nvirtualenv detection")
    with tempfile.TemporaryDirectory() as tmp:
        # Named .venvTA, not .venv — a name match would miss this, as it did.
        write_file(tmp, ".venvTA/pyvenv.cfg", b"home = C:/Python")
        write_file(tmp, ".venvTA/Scripts/python.exe", b"bin", age_days=90)
        write_file(tmp, ".venvTA/Scripts/pip.exe", b"bin2", age_days=90)
        write_file(tmp, "report.pdf", b"real document")

        plan = rec.scan([tmp])
        touched = {Path(c["path"]).name for c in plan["candidates"]}
        check("python.exe" not in touched and "pip.exe" not in touched,
              "a virtualenv is detected by pyvenv.cfg regardless of its folder name")
        check(org.looks_like_app_payload(list(os.scandir(Path(tmp) / ".venvTA"))),
              "pyvenv.cfg alone marks the directory as machine-generated")


def test_protections():
    print("\nprotections — identified but never auto-quarantined")
    with tempfile.TemporaryDirectory() as tmp:
        write_file(tmp, "factura-marzo.zip", b"z", age_days=90)
        Path(tmp, "factura-marzo").mkdir()
        write_file(tmp, "cfdi-12345.xml", b"")
        write_file(tmp, "contabilidad/recibo.exe", b"i", age_days=90)
        write_file(tmp, "repo/.git/config", b"g")
        write_file(tmp, "repo/old-setup.exe", b"i2", age_days=90)
        write_file(tmp, "desktop.ini", b"")

        plan = rec.scan([tmp])
        quarantined = {Path(c["path"]).name for c in plan["candidates"]}
        protected = {Path(r["path"]).name: r["protected_by"] for r in plan["review"]}

        check(protected.get("factura-marzo.zip") == "sat-relevant",
              "a file named like an invoice is protected, not quarantined")
        check(protected.get("cfdi-12345.xml") == "sat-relevant",
              "a zero-byte CFDI xml goes to review, never to the trash")
        check(protected.get("recibo.exe") == "sat-relevant", "SAT name wins over the installer rule")
        check(protected.get("old-setup.exe") == "inside-git-worktree",
              "a stale installer inside a git worktree is protected")
        check(protected.get("desktop.ini") == "machine-managed", "machine-managed file protected")
        check(not quarantined, f"nothing at all was quarantined here: {quarantined}")


def test_quarantine_round_trip():
    print("\nROUND TRIP — quarantine then undo")
    with tempfile.TemporaryDirectory() as tmp:
        zone = Path(tmp) / "zone"
        original_trash = rec.TRASH_ROOT
        rec.TRASH_ROOT = Path(tmp) / "_trash"
        try:
            write_file(zone, "a/report.pdf", b"same bytes")
            write_file(zone, "a/b/report.pdf", b"same bytes")
            write_file(zone, "empty.txt", b"")
            write_file(zone, "keeper.pdf", b"different")
            before = manifest(zone)

            plan = rec.scan([zone])
            check(plan["counts"]["candidates"] == 2, f"two candidates: {plan['counts']['candidates']}")

            results, _ = rec.quarantine(plan, False)
            check(manifest(zone) == before, "dry run moves nothing")

            results, batch = rec.quarantine(plan, True, batch_stamp="testbatch")
            check(results["ok"] == 2, f"both candidates moved: {results}")
            check(not (zone / "a" / "b" / "report.pdf").exists(), "duplicate left the zone")
            check((zone / "a" / "report.pdf").exists(), "the keeper stayed put")
            check((zone / "keeper.pdf").exists(), "the unrelated file was never touched")

            journal = Path(batch) / "journal.ndjson"
            check(journal.is_file(), "batch journal written")
            check((Path(batch) / "_manifest.json").is_file(), "batch manifest written")

            undo = org.undo(journal, True)
            check(undo["ok"] == 2 and undo["failed"] == 0, f"organize.py undo restores a batch: {undo}")
            check(manifest(zone) == before, "zone byte-identical after undo")
        finally:
            rec.TRASH_ROOT = original_trash


def test_purge_refusals():
    print("\npurge — the irreversible one")
    with tempfile.TemporaryDirectory() as tmp:
        zone = Path(tmp) / "zone"
        original_trash = rec.TRASH_ROOT
        rec.TRASH_ROOT = Path(tmp) / "_trash"
        try:
            write_file(zone, "a.txt", b"dup")
            write_file(zone, "sub/a.txt", b"dup")
            plan = rec.scan([zone])
            _, batch = rec.quarantine(plan, True, batch_stamp="fresh")

            try:
                rec.purge(batch, confirm=True, force=False)
                check(False, "purge refuses a batch inside the hold period")
            except SystemExit as exc:
                check("hold is" in str(exc), "purge refuses a batch inside the hold period")
            check(Path(batch).is_dir(), "the refused batch is still on disk")

            outside = Path(tmp) / "not-trash"
            outside.mkdir()
            try:
                rec.purge(outside, confirm=True, force=True)
                check(False, "purge refuses a path outside the trash root")
            except SystemExit as exc:
                check("not inside" in str(exc), "purge refuses a path outside the trash root")
            check(outside.is_dir(), "the outside directory is untouched")

            stray = rec.TRASH_ROOT / "hand-made"
            stray.mkdir(parents=True)
            (stray / "something.txt").write_text("not ours")
            try:
                rec.purge(stray, confirm=True, force=True)
                check(False, "purge refuses a directory it did not create")
            except SystemExit as exc:
                check("no _manifest.json" in str(exc), "purge refuses a directory it did not create")

            rec.purge(batch, confirm=False, force=True)
            check(Path(batch).is_dir(), "purge without --confirm is a dry run and deletes nothing")

            rec.purge(batch, confirm=True, force=True)
            check(not Path(batch).exists(), "purge with --confirm --force deletes the batch")
        finally:
            rec.TRASH_ROOT = original_trash


def test_list_batches():
    print("\nlist")
    with tempfile.TemporaryDirectory() as tmp:
        zone = Path(tmp) / "zone"
        original_trash = rec.TRASH_ROOT
        rec.TRASH_ROOT = Path(tmp) / "_trash"
        try:
            write_file(zone, "a.txt", b"dup")
            write_file(zone, "sub/a.txt", b"dup")
            plan = rec.scan([zone])
            rec.quarantine(plan, True, batch_stamp="b1")

            batches = rec.list_batches()
            check(len(batches) == 1, "one batch listed")
            check(batches[0]["files"] == 1, "batch file count reported")
            check(batches[0]["purgeable"] is False, "a fresh batch is not purgeable")
            check("duplicate" in batches[0]["by_category"], "categories carried into the manifest")
        finally:
            rec.TRASH_ROOT = original_trash


def main():
    for test in (test_categories, test_duplicate_name_judgment, test_virtualenv_detection,
                 test_protections, test_quarantine_round_trip,
                 test_purge_refusals, test_list_batches):
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
