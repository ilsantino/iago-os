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


def test_manifest_survives_batch_reuse():
    print("\nmanifest — batch stamp reused")
    with tempfile.TemporaryDirectory() as tmp:
        zone = Path(tmp) / "zone"
        original_trash = rec.TRASH_ROOT
        rec.TRASH_ROOT = Path(tmp) / "_trash"
        try:
            write_file(zone, "a.txt", b"dup"); write_file(zone, "sub/a.txt", b"dup")
            _, batch = rec.quarantine(rec.scan([zone]), True, batch_stamp="shared")

            write_file(zone, "b.txt", b"other"); write_file(zone, "sub/b.txt", b"other")
            rec.quarantine(rec.scan([zone]), True, batch_stamp="shared")

            manifest = json.loads((Path(batch) / "_manifest.json").read_text(encoding="utf-8"))
            check(manifest["files"] == 2,
                  f"manifest counts BOTH calls, not just the last: {manifest['files']}")
            check(rec.list_batches()[0]["files"] == 2, "list agrees with what is actually held")
            on_disk = sum(1 for p in Path(batch).rglob("*")
                          if p.is_file() and p.name not in ("_manifest.json", "journal.ndjson"))
            check(on_disk == manifest["files"],
                  f"manifest matches files on disk: {manifest['files']} vs {on_disk}")
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



def test_tree_round_trip():
    print("\nTREE — quarantine a whole cache, then undo")
    with tempfile.TemporaryDirectory() as tmp:
        original_trash = rec.TRASH_ROOT
        rec.TRASH_ROOT = Path(tmp) / "_trash"
        try:
            cache = Path(tmp) / "home" / "AppData" / "cache-thing"
            write_file(cache, "a/one.bin", b"aaaa")
            write_file(cache, "a/b/two.bin", b"bbbbbb")
            write_file(cache, "three.bin", b"c")
            keeper = Path(tmp) / "home" / "AppData" / "keep-me"
            write_file(keeper, "important.txt", b"do not touch")
            before = manifest(cache)

            files, size = rec.measure_tree(cache)
            check(files == 3 and size == 11, f"measure_tree counts the tree: {files} files {size} B")

            results, batch, planned, refusals = rec.quarantine_trees([cache], "test-cache", False)
            check(batch is None and cache.is_dir(), "dry run moves nothing")
            check(results["files"] == 3 and results["bytes"] == 11,
                  f"dry run still reports the size: {results}")

            results, batch, planned, refusals = rec.quarantine_trees(
                [cache], "test-cache", True, batch_stamp="treebatch")
            check(results["ok"] == 1 and results["failed"] == 0, f"one tree moved: {results}")
            check(not cache.exists(), "the cache left its home")
            check((keeper / "important.txt").is_file(), "the sibling tree was never touched")

            journal = Path(batch) / "journal.ndjson"
            check(journal.is_file(), "batch journal written")
            manifest_path = Path(batch) / "_manifest.json"
            check(manifest_path.is_file(), "batch manifest written")
            recorded = json.loads(manifest_path.read_text(encoding="utf-8"))
            check(recorded["bytes"] == 11,
                  f"manifest records the TREE bytes, not the directory entry: {recorded['bytes']}")

            undo = org.undo(journal, True)
            check(undo["ok"] == 1 and undo["failed"] == 0, f"organize.py undo restores a tree: {undo}")
            check(cache.is_dir() and manifest(cache) == before,
                  "tree byte-identical after undo")
        finally:
            rec.TRASH_ROOT = original_trash


def test_tree_refusals():
    """Every refusal here is a way to lose something irreplaceable in one rename."""
    print("\nTREE — refusals")
    with tempfile.TemporaryDirectory() as tmp:
        original_trash = rec.TRASH_ROOT
        original_frozen = set(org.FROZEN_ROOTS)
        rec.TRASH_ROOT = Path(tmp) / "_trash"
        try:
            repo = Path(tmp) / "home" / "AppData" / "looks-like-cache"
            write_file(repo, "src/app.ts", b"real work")
            write_file(repo, ".git/HEAD", b"ref: refs/heads/main")
            check(rec.tree_refusal(repo) == "contains a git repository",
                  f"a tree holding a repo is not a cache: {rec.tree_refusal(repo)}")

            nested = Path(tmp) / "home" / "AppData" / "cache-with-repo-inside"
            write_file(nested, "blobs/x.bin", b"x")
            write_file(nested, "vendor/thing/.git/HEAD", b"ref: refs/heads/main")
            check(rec.tree_refusal(nested) == "contains a git repository",
                  "a repo buried anywhere inside still refuses")

            plain = Path(tmp) / "home" / "AppData" / "plain-cache"
            write_file(plain, "blobs/x.bin", b"x")
            check(rec.tree_refusal(plain) is None, "an ordinary cache is allowed")

            missing = Path(tmp) / "home" / "AppData" / "not-here"
            check(rec.tree_refusal(missing) == "not a directory", "a missing path refuses")
            afile = write_file(Path(tmp) / "home", "loose.txt", b"x")
            check(rec.tree_refusal(afile) == "not a directory", "a file refuses")

            check("levels deep" in (rec.tree_refusal(Path.home().parent) or ""),
                  f"a shallow path refuses: {rec.tree_refusal(Path.home().parent)}")
            check(rec.tree_refusal(Path.home()) == "is the home or drive root",
                  "the home directory itself refuses")

            org.FROZEN_ROOTS.clear()
            org.FROZEN_ROOTS.add((Path(tmp) / "home" / "dev").resolve())
            frozen = Path(tmp) / "home" / "dev" / "iago-os" / "node_modules"
            write_file(frozen, "pkg/index.js", b"x")
            check(rec.tree_refusal(frozen) == "under the dev frozen zone",
                  "the dev zone refuses even for node_modules")

            rec.TRASH_ROOT.mkdir(parents=True, exist_ok=True)
            inside = rec.TRASH_ROOT / "batch" / "C" / "some" / "tree"
            inside.mkdir(parents=True, exist_ok=True)
            check(rec.tree_refusal(inside) == "is already inside the quarantine",
                  "quarantine cannot eat itself")

            results, batch, planned, refusals = rec.quarantine_trees(
                [repo, plain, missing], "mixed", False)
            check(results["refused"] == 1 and results["missing"] == 1 and results["ok"] == 1,
                  f"a refusal never blocks the rest of the batch: {results}")
            check(repo.is_dir(), "the refused tree is still where it was")
        finally:
            rec.TRASH_ROOT = original_trash
            org.FROZEN_ROOTS.clear()
            org.FROZEN_ROOTS.update(original_frozen)


def test_cachedir_tag_outranks_the_git_heuristic():
    """uv's cache holds a stray .git from an unpacked sdist. The heuristic
    refused 21 GB of declared-disposable cache over a file that was not even a
    valid repository."""
    print("\nTREE — CACHEDIR.TAG")
    with tempfile.TemporaryDirectory() as tmp:
        cache = Path(tmp) / "home" / "AppData" / "toolcache"
        write_file(cache, "sdists/pkg/.git", b"not really a repo")
        write_file(cache, "wheels/thing.whl", b"x")
        check(rec.tree_refusal(cache) == "contains a git repository",
              "without the tag, a stray .git still refuses")

        write_file(cache, "CACHEDIR.TAG",
                   b"Signature: 8a477f597d28d172789f06886806bc55\n# generated by a tool")
        check(rec.tree_refusal(cache) is None,
              f"a self-declared cache is allowed: {rec.tree_refusal(cache)}")

        write_file(cache, "CACHEDIR.TAG", b"Signature: not-the-real-one")
        check(rec.tree_refusal(cache) == "contains a git repository",
              "a forged or truncated tag does not count")

        original_frozen = set(org.FROZEN_ROOTS)
        try:
            org.FROZEN_ROOTS.clear()
            org.FROZEN_ROOTS.add((Path(tmp) / "home" / "dev").resolve())
            frozen = Path(tmp) / "home" / "dev" / "proj" / "target"
            write_file(frozen, "CACHEDIR.TAG",
                       b"Signature: 8a477f597d28d172789f06886806bc55")
            check(rec.tree_refusal(frozen) == "under the dev frozen zone",
                  "the tag does not unlock the frozen zone")
        finally:
            org.FROZEN_ROOTS.clear()
            org.FROZEN_ROOTS.update(original_frozen)


def test_a_locked_tree_is_never_copied():
    """The 56 GB lesson: os.rename fails, shutil.move copies for eleven minutes,
    its delete half hits the same lock, and the disk now holds two copies while
    the report says nothing moved."""
    print("\nTREE — a locked tree is refused, not copied")
    with tempfile.TemporaryDirectory() as tmp:
        original_trash = rec.TRASH_ROOT
        original_rename = org._safe_rename
        rec.TRASH_ROOT = Path(tmp) / "_trash"
        try:
            cache = Path(tmp) / "home" / "AppData" / "held-open"
            write_file(cache, "big.bin", b"x" * 4096)
            before = manifest(cache)

            def refuse(_src, _dst):
                raise OSError(32, "The process cannot access the file because "
                                  "it is being used by another process")

            org._safe_rename = refuse
            results, batch, _planned, _refusals = rec.quarantine_trees(
                [cache], "locked", True, batch_stamp="lockedbatch")

            check(results["failed"] == 1 and results["ok"] == 0,
                  f"the move is reported as failed: {results}")
            check(cache.is_dir() and manifest(cache) == before,
                  "the original is untouched")
            copied = [p for p in Path(batch).rglob("*") if p.is_file()
                      and p.name not in ("journal.ndjson", "_manifest.json")]
            check(not copied, f"not one byte was copied into quarantine: {copied}")
            check(results["locked"] and "used by another process" in results["locked"][0][1],
                  "the reason reaches the caller")
        finally:
            org._safe_rename = original_rename
            rec.TRASH_ROOT = original_trash

def main():
    for test in (test_categories, test_duplicate_name_judgment, test_virtualenv_detection,
                 test_protections, test_quarantine_round_trip,
                 test_purge_refusals, test_manifest_survives_batch_reuse, test_list_batches,
                 test_tree_round_trip, test_tree_refusals,
                 test_cachedir_tag_outranks_the_git_heuristic,
                 test_a_locked_tree_is_never_copied):
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
