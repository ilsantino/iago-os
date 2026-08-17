"""P2b — reclaim: identify / quarantine / purge.

Deletion, in three stages, because the third is the only irreversible thing this
whole project does:

  1. scan      deterministic rules produce candidates. Nothing moves.
  2. apply     candidates move to C:\\Users\\sanal\\_trash\\{stamp}\\, journalled
               in organize.py's format — so `organize.py undo` restores them.
  3. purge     a batch is hard-deleted, only after a hold period, only with
               --confirm, and only one batch at a time.

Nothing here deletes a file. `purge` is the only subcommand that does, it is
never reached by `apply`, and it refuses to run on a batch younger than the hold
period. Quarantine also moves bytes OUT of OneDrive immediately, so the cloud
quota is reclaimed at stage 2 while the safety net is still intact.

The categories are deliberately dull. Every one is a fact about the file — a
hash collision, a zero length, a sibling directory — never a judgment about
whether Santiago still wants it. Age alone is never grounds: "old" is not
"unused", and the one exception (installers) is regenerable by re-downloading.

Usage:
  python reclaim.py scan --zone downloads --zone od-documents --out plan.json
  python reclaim.py apply plan.json                    # dry-run
  python reclaim.py apply plan.json --apply
  python reclaim.py list
  python reclaim.py purge C:/Users/sanal/_trash/20260817-140000 --confirm
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import organize as org                                              # noqa: E402

TRASH_ROOT = Path.home() / "_trash"
HOLD_DAYS = 7
INSTALLER_AGE_DAYS = 30

PARTIAL_EXT = {".part", ".crdownload", ".partial", ".download", ".tmp", ".!ut"}
INSTALLER_EXT = {".exe", ".msi", ".dmg", ".pkg", ".appinstaller"}
ARCHIVE_EXT = {".zip", ".rar", ".7z", ".tar", ".tgz", ".gz"}
CACHE_NAMES = {"thumbs.db", ".ds_store", "ehthumbs.db"}

# Legally retained under Mexican tax rules. Never quarantined, never swept —
# they get renamed and refiled, and if one matches a junk rule it goes to the
# review list for Santiago instead of to the trash.
SAT_PATTERN = re.compile(
    r"factura|recibo|invoice|receipt|cfdi|constancia|declaraci|n[oó]mina|"
    r"deducible|comprobante|impuesto|\bsat\b|\brfc\b",
    re.IGNORECASE,
)
SAT_PATH_PATTERN = re.compile(r"fiscal|contab|facturas|impuestos|sat", re.IGNORECASE)

# Photos are never auto-quarantined: a duplicate photo is usually an edit, and
# nobody can tell from a hash which one someone wants.
NEVER_ZONES = {(Path.home() / "OneDrive" / "Pictures").resolve()}


def is_protected_from_deletion(path, root):
    """Reasons a file may be identified but must never be auto-quarantined."""
    resolved = Path(path).resolve()

    if org.under_frozen_zone(resolved):
        return "under-dev-frozen-zone"
    for never in NEVER_ZONES:
        if never == resolved or never in resolved.parents:
            return "under-pictures"
    if org.find_git_root(resolved.parent):
        return "inside-git-worktree"
    # organize.py protects these from RENAMING, which is right — their names are
    # an interface. Deletion is a different question: a thumbnail cache is
    # regenerable, while desktop.ini holds a customisation someone chose. So the
    # two protection lists deliberately differ, and only the caches are exempt.
    if resolved.name.lower() not in CACHE_NAMES and org.is_protected_file(resolved.name):
        return "machine-managed"

    name = resolved.name
    if SAT_PATTERN.search(name) or resolved.suffix.lower() == ".xml":
        return "sat-relevant"
    try:
        relative = resolved.relative_to(Path(root).resolve())
        if SAT_PATH_PATTERN.search(str(relative.parent)):
            return "sat-relevant-path"
    except ValueError:
        pass
    return None


COPY_SUFFIX = re.compile(r"\s*(?:\(\s*\d+\s*\)|-\s*cop(?:y|ia)\s*\d*)\s*$", re.IGNORECASE)


def normalise_stem(path):
    """Filename stem with Windows copy markers removed, for same-name comparison."""
    return COPY_SUFFIX.sub("", Path(path).stem).strip().lower()


def file_hash(path, chunk_size=1 << 20):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            block = handle.read(chunk_size)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def walk(root):
    """Yield (path, stat) for every real file under root. Never opens a file."""
    root = Path(root).resolve()
    stack = [str(root)]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as iterator:
                entries = sorted(iterator, key=lambda e: e.name)
        except (PermissionError, OSError):
            continue
        if org.looks_like_app_payload(entries):
            continue
        for entry in entries:
            try:
                if entry.is_dir(follow_symlinks=False):
                    lowered = entry.name.lower()
                    if lowered in org.SKIP_DIRS or lowered.startswith("$"):
                        continue
                    stack.append(entry.path)
                    continue
                if entry.is_symlink():
                    continue
                info = entry.stat(follow_symlinks=False)
            except (PermissionError, OSError):
                continue
            if org.is_placeholder(info):
                continue                    # cloud-only: reading it would hydrate it
            yield entry.path, info


def find_duplicates(files, now):
    """Byte-identical groups. Size-grouped first so most files are never read."""
    by_size = defaultdict(list)
    for path, info in files:
        if info.st_size > 0:
            by_size[info.st_size].append((path, info))

    duplicates = []
    for size, group in by_size.items():
        if len(group) < 2:
            continue
        by_hash = defaultdict(list)
        for path, info in group:
            try:
                by_hash[file_hash(path)].append((path, info))
            except (PermissionError, OSError):
                continue
        for digest, identical in by_hash.items():
            if len(identical) < 2:
                continue
            # Keeper: shortest path, then shortest name, then oldest — the copy
            # most likely to be the original and least likely to be a stray.
            identical.sort(key=lambda item: (len(Path(item[0]).parts),
                                             len(Path(item[0]).name),
                                             item[1].st_mtime))
            keeper = identical[0][0]
            # Identical bytes under DIFFERENT names is not the same finding as
            # identical bytes under the same name. Two copies of `food_info.csv`
            # are a stray copy; `descripcion materias RSB.pdf` and `book DBAN.pdf`
            # are one document filed under two meanings, and which name survives
            # is a judgment no hash can make. Those go to review.
            stems = {normalise_stem(path) for path, _ in identical}
            names_match = len(stems) == 1
            for path, info in identical[1:]:
                duplicates.append({
                    "path": path, "size": info.st_size, "mtime_ns": info.st_mtime_ns,
                    "category": "duplicate" if names_match else "duplicate-different-name",
                    "keeper": keeper, "sha256": digest, "names_match": names_match,
                })
    return duplicates


def classify_junk(path, info, now, sibling_dirs):
    name = Path(path).name
    lowered = name.lower()
    extension = Path(path).suffix.lower()
    age_days = (now - info.st_mtime) / 86400.0

    if lowered in CACHE_NAMES:
        return "cache-artifact"
    if extension in PARTIAL_EXT:
        return "partial-download"
    if info.st_size == 0:
        return "zero-byte"
    if extension in INSTALLER_EXT and age_days > INSTALLER_AGE_DAYS:
        return "installer-stale"
    if extension in ARCHIVE_EXT:
        stem = Path(path).stem.lower()
        if (str(Path(path).parent).lower(), stem) in sibling_dirs:
            return "archive-already-extracted"
    return None


def scan(roots):
    now = datetime.now(timezone.utc).timestamp()
    candidates, review = [], []
    all_files = []
    sibling_dirs = set()

    for root in roots:
        root_path = Path(root).resolve()
        if not root_path.is_dir():
            continue
        for current, dirnames, _ in os.walk(root_path):
            for dirname in dirnames:
                sibling_dirs.add((current.lower(), dirname.lower()))
        for path, info in walk(root_path):
            all_files.append((path, info, str(root_path)))

    seen = set()

    def add(entry, root):
        protection = is_protected_from_deletion(entry["path"], root)
        if not protection and entry.get("names_match") is False:
            protection = "different-filenames"
        if protection:
            review.append({**entry, "protected_by": protection})
            return
        if entry["path"] in seen:
            return
        seen.add(entry["path"])
        candidates.append(entry)

    for path, info, root in all_files:
        category = classify_junk(path, info, now, sibling_dirs)
        if category:
            add({"path": path, "size": info.st_size, "mtime_ns": info.st_mtime_ns,
                 "category": category}, root)

    root_for = {path: root for path, _, root in all_files}
    for entry in find_duplicates([(p, i) for p, i, _ in all_files], now):
        add(entry, root_for.get(entry["path"], roots[0]))

    by_category = defaultdict(lambda: {"files": 0, "bytes": 0})
    for entry in candidates:
        by_category[entry["category"]]["files"] += 1
        by_category[entry["category"]]["bytes"] += entry["size"]

    return {
        "tool_version": 1,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "roots": [str(Path(r).resolve()) for r in roots],
        "counts": {
            "candidates": len(candidates),
            "bytes": sum(e["size"] for e in candidates),
            "review": len(review),
        },
        "by_category": {k: dict(v) for k, v in sorted(by_category.items())},
        "candidates": candidates,
        "review": review,
    }


def quarantine(plan, do_apply, batch_stamp=None):
    """Move candidates to the trash. Journal format matches organize.py, so
    `organize.py undo <journal>` restores a batch."""
    stamp = batch_stamp or datetime.now().strftime("%Y%m%d-%H%M%S")
    batch = TRASH_ROOT / stamp
    results = {"ok": 0, "stale": 0, "missing": 0, "failed": 0, "bytes": 0}

    journal = None
    if do_apply:
        batch.mkdir(parents=True, exist_ok=True)
        journal = org.Journal(batch / "journal.ndjson")
        journal.write({"type": "header", "tool_version": 1, "kind": "quarantine",
                       "batch": str(batch), "roots": plan["roots"],
                       "started": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                       "ops_planned": len(plan["candidates"])})

    moved = []
    try:
        for entry in plan["candidates"]:
            source = entry["path"]
            if org.under_frozen_zone(source):
                raise SystemExit(f"REFUSED: {source} is under the rename-frozen code zone.")
            if not os.path.exists(source):
                results["missing"] += 1
                continue
            info = os.stat(source)
            if info.st_size != entry["size"] or info.st_mtime_ns != entry["mtime_ns"]:
                results["stale"] += 1
                continue
            if not do_apply:
                results["ok"] += 1
                results["bytes"] += entry["size"]
                continue

            drive, tail = os.path.splitdrive(os.path.abspath(source))
            destination = batch / drive.replace(":", "") / tail.lstrip("\\/")
            destination.parent.mkdir(parents=True, exist_ok=True)
            try:
                org._safe_rename(source, str(destination))
            except OSError:
                try:
                    shutil.move(source, str(destination))     # cross-volume fallback
                except OSError as exc:
                    results["failed"] += 1
                    journal.write({"type": "op", "op": "rename", "src": source,
                                   "dst": str(destination), "status": "failed",
                                   "error": str(exc)})
                    continue
            results["ok"] += 1
            results["bytes"] += entry["size"]
            record = {"type": "op", "op": "rename", "src": source, "dst": str(destination),
                      "size": entry["size"], "mtime_ns": entry["mtime_ns"],
                      "category": entry["category"], "status": "ok"}
            moved.append(record)
            journal.write(record)
    finally:
        if journal:
            journal.close()

    if do_apply:
        (batch / "_manifest.json").write_text(json.dumps({
            "batch": str(batch), "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "hold_days": HOLD_DAYS, "files": len(moved),
            "bytes": sum(m["size"] for m in moved),
            "by_category": {c: sum(1 for m in moved if m["category"] == c)
                            for c in sorted({m["category"] for m in moved})},
            "ops": moved,
        }, indent=2, ensure_ascii=False), encoding="utf-8")

    return results, (str(batch) if do_apply else None)


def list_batches():
    if not TRASH_ROOT.is_dir():
        return []
    now = datetime.now().timestamp()
    batches = []
    for entry in sorted(TRASH_ROOT.iterdir()):
        manifest_path = entry / "_manifest.json"
        if not entry.is_dir() or not manifest_path.is_file():
            continue
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        age = (now - manifest_path.stat().st_mtime) / 86400.0
        batches.append({
            "batch": str(entry), "files": manifest["files"], "bytes": manifest["bytes"],
            "age_days": age, "hold_days": manifest.get("hold_days", HOLD_DAYS),
            "purgeable": age >= manifest.get("hold_days", HOLD_DAYS),
            "by_category": manifest.get("by_category", {}),
        })
    return batches


def purge(batch_path, confirm, force):
    """The only irreversible operation in this project."""
    batch = Path(batch_path).resolve()
    if TRASH_ROOT.resolve() not in batch.parents:
        raise SystemExit(f"REFUSED: {batch} is not inside {TRASH_ROOT}. "
                         "purge only ever operates on a quarantine batch.")
    manifest_path = batch / "_manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"REFUSED: no _manifest.json in {batch}. "
                         "Not a quarantine batch this tool created.")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    age = (datetime.now().timestamp() - manifest_path.stat().st_mtime) / 86400.0
    hold = manifest.get("hold_days", HOLD_DAYS)

    print(f"batch      {batch}")
    print(f"contents   {manifest['files']:,} files · {manifest['bytes'] / 1e6:,.1f} MB")
    for category, count in sorted(manifest.get("by_category", {}).items()):
        print(f"             {count:>6,}  {category}")
    print(f"age        {age:.1f} days (hold {hold})")

    if age < hold and not force:
        raise SystemExit(f"REFUSED: batch is {age:.1f} days old, hold is {hold}. "
                         "Wait, or pass --force if you are certain.")
    if not confirm:
        print("\nDRY-RUN. Nothing deleted. Pass --confirm to hard-delete this batch.")
        return 0

    shutil.rmtree(batch)
    print(f"\nPURGED {manifest['files']:,} files · {manifest['bytes'] / 1e6:,.1f} MB. "
          "This is not reversible.")
    return 0


# --------------------------------------------------------------------------
# cli
# --------------------------------------------------------------------------

def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if abs(n) < 1024:
            return f"{n:.0f}{unit}" if unit == "B" else f"{n:.1f}{unit}"
        n /= 1024.0
    return f"{n:.1f}TB"


def cmd_scan(args):
    roots = []
    for zone in args.zone or []:
        if zone not in org.ZONES:
            raise SystemExit(f"unknown zone '{zone}'. known: {', '.join(sorted(org.ZONES))}")
        roots.append(org.ZONES[zone])
    roots.extend(Path(r) for r in (args.root or []))
    if not roots:
        raise SystemExit("need at least one --zone or --root")

    plan = scan(roots)
    out = Path(args.out) if args.out else Path(".local/organize") / (
        f"reclaim-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(plan, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"roots      {', '.join(plan['roots'])}")
    print(f"candidates {plan['counts']['candidates']:,}  ({human(plan['counts']['bytes'])})")
    for category, stats in plan["by_category"].items():
        print(f"             {stats['files']:>6,}  {human(stats['bytes']):>8}  {category}")
    print(f"review     {plan['counts']['review']:,}  (matched a rule but protected — never auto-quarantined)")
    protections = defaultdict(int)
    for entry in plan["review"]:
        protections[entry["protected_by"]] += 1
    for reason, count in sorted(protections.items(), key=lambda kv: -kv[1]):
        print(f"             {count:>6,}  {reason}")
    print(f"plan       {out}")
    print("\nNothing has moved. Review the plan, then: "
          f"python reclaim.py apply \"{out}\" --apply")
    return 0


def cmd_apply(args):
    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    results, batch = quarantine(plan, args.apply)
    mode = "QUARANTINED" if args.apply else "DRY-RUN (nothing moved; pass --apply)"
    print(f"{mode}  moved={results['ok']:,} ({human(results['bytes'])}) "
          f"stale={results['stale']:,} missing={results['missing']:,} failed={results['failed']:,}")
    if batch:
        print(f"batch     {batch}")
        print(f"restore:  python {Path(org.__file__).name} undo \"{batch}\\journal.ndjson\" --apply")
        print(f"purge:    python {Path(__file__).name} purge \"{batch}\" --confirm   "
              f"(refused for {HOLD_DAYS} days)")
    return 1 if results["failed"] else 0


def cmd_list(args):
    batches = list_batches()
    if not batches:
        print(f"no quarantine batches in {TRASH_ROOT}")
        return 0
    print(f"{'batch':<48}{'files':>9}{'size':>10}{'age':>8}  state")
    total = 0
    for batch in batches:
        total += batch["bytes"]
        state = "PURGEABLE" if batch["purgeable"] else f"held ({batch['hold_days']}d)"
        print(f"{Path(batch['batch']).name:<48}{batch['files']:>9,}"
              f"{human(batch['bytes']):>10}{batch['age_days']:>7.1f}d  {state}")
    print(f"\ntotal held: {human(total)}")
    return 0


def cmd_purge(args):
    return purge(args.batch, args.confirm, args.force)


def main():
    parser = argparse.ArgumentParser(prog="reclaim.py")
    subparsers = parser.add_subparsers(dest="command", required=True)

    scan_parser = subparsers.add_parser("scan", help="identify candidates (read-only)")
    scan_parser.add_argument("--zone", action="append")
    scan_parser.add_argument("--root", action="append")
    scan_parser.add_argument("--out")
    scan_parser.set_defaults(func=cmd_scan)

    apply_parser = subparsers.add_parser("apply", help="move candidates to quarantine")
    apply_parser.add_argument("plan")
    apply_parser.add_argument("--apply", action="store_true")
    apply_parser.set_defaults(func=cmd_apply)

    list_parser = subparsers.add_parser("list", help="show quarantine batches")
    list_parser.set_defaults(func=cmd_list)

    purge_parser = subparsers.add_parser("purge", help="hard-delete a batch (irreversible)")
    purge_parser.add_argument("batch")
    purge_parser.add_argument("--confirm", action="store_true")
    purge_parser.add_argument("--force", action="store_true",
                              help="override the hold period")
    purge_parser.set_defaults(func=cmd_purge)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
