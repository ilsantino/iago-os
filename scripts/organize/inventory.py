"""P0 — filesystem inventory. READ-ONLY.

Walks the in-scope zones and reports what is actually there, so the later
phases of `.iago/plans/feature-filesystem-order/` can be scoped from numbers
instead of from folder names.

HARD RULE: this script never opens a file. Attributes and stat() only.
Reading content would hydrate OneDrive cloud-only placeholders and pull
gigabytes down over a 129k-file tree.

Usage:
  python scripts/organize/inventory.py                  # report to stdout
  python scripts/organize/inventory.py --json out.json  # + machine-readable
"""

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import organize as org                                              # noqa: E402

HOME = Path.home()

# Zone roots. `dev` is deliberately absent — it is rename-frozen (Claude Code
# derives project dirs from the literal path) and therefore out of scope.
ZONES = {
    "downloads": HOME / "Downloads",
    "desktop-local": HOME / "Desktop",
    "documents-local": HOME / "Documents",
    "od-iagoagency": HOME / "OneDrive" / "iagoagency",
    "od-documents": HOME / "OneDrive" / "Documents",
    "od-pictures": HOME / "OneDrive" / "Pictures",
    "od-desktop": HOME / "OneDrive" / "Desktop",
    "od-santiago-dodas": HOME / "OneDrive" / "Santiago DoDas",
    "od-cfa": HOME / "OneDrive" / "CFA",
    "od-udemy": HOME / "OneDrive" / "UDEMY",
    "od-din": HOME / "OneDrive" / "DIN",
    "od-biblia": HOME / "OneDrive" / "Biblia",
    "od-make": HOME / "OneDrive" / "Make.com",
    "od-attachments": HOME / "OneDrive" / "Attachments",
}

# Single source of truth, shared with organize.py. Keeping a second copy here is
# how the census and the linter came to disagree on their denominators (1,648 vs
# 1,453) after organize.py learned to prune application payloads.
SKIP_DIRS = org.SKIP_DIRS

# Windows attribute bits marking a OneDrive file that is not local.
FILE_ATTRIBUTE_OFFLINE = 0x00001000
FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x00040000
FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x00400000
PLACEHOLDER_MASK = (
    FILE_ATTRIBUTE_OFFLINE
    | FILE_ATTRIBUTE_RECALL_ON_OPEN
    | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS
)

ENTITIES = org.ENTITIES        # shared, for the same reason as SKIP_DIRS

# {YYYYMMDD}-{entity}-{descriptor}[-vN]
CONFORMING = re.compile(r"^\d{8}-[a-z0-9]+(?:-[a-z0-9]+)*(?:-v\d+)?$")
DATE_IN_NAME = re.compile(r"(?:19|20)\d{6}|(?:19|20)\d{2}[-_.]\d{2}[-_.]\d{2}")

INSTALLER_EXT = {".exe", ".msi", ".dmg", ".pkg", ".appinstaller"}
PARTIAL_EXT = {".part", ".crdownload", ".tmp", ".partial", ".download"}
ARCHIVE_EXT = {".zip", ".rar", ".7z", ".tar", ".gz", ".tgz"}

AGE_BUCKETS = [(30, "<=30d"), (365, "<=1y"), (1095, "<=3y")]


def age_bucket(mtime, now):
    days = (now - mtime) / 86400.0
    for limit, label in AGE_BUCKETS:
        if days <= limit:
            return label
    return ">3y"


def entity_in(stem):
    for token in re.split(r"[-_. ]+", stem.lower()):
        if token in ENTITIES:
            return token
    return None


class ZoneStats:
    def __init__(self, name, root):
        self.name = name
        self.root = root
        self.files = 0
        self.bytes = 0
        self.dirs = 0
        self.empty_dirs = 0
        self.placeholders = 0
        self.payload_dirs = 0
        self.machine_managed = 0
        self.local_files = 0
        self.by_ext = Counter()
        self.bytes_by_ext = Counter()
        self.by_age = Counter()
        self.conforming = 0
        self.has_date = 0
        self.has_entity = 0
        self.depth_hist = Counter()
        self.longest_path = ""
        self.longest_len = 0
        self.dir_counts = Counter()
        self.dup_index = defaultdict(int)
        self.junk = Counter()
        self.junk_bytes = Counter()
        self.errors = 0

    def as_dict(self):
        dup_groups = {k: v for k, v in self.dup_index.items() if v > 1}
        return {
            "zone": self.name,
            "root": str(self.root),
            "files": self.files,
            "bytes": self.bytes,
            "dirs": self.dirs,
            "empty_dirs": self.empty_dirs,
            "placeholders": self.placeholders,
            "payload_dirs_pruned": self.payload_dirs,
            "machine_managed": self.machine_managed,
            "organizable": self.files - self.machine_managed,
            "local_files": self.local_files,
            "conforming": self.conforming,
            "has_date_in_name": self.has_date,
            "has_entity_in_name": self.has_entity,
            "longest_path_len": self.longest_len,
            "longest_path": self.longest_path,
            "errors": self.errors,
            "top_ext": self.by_ext.most_common(15),
            "bytes_by_ext": self.bytes_by_ext.most_common(10),
            "by_age": dict(sorted(self.by_age.items())),
            "depth_hist": dict(sorted(self.depth_hist.items())),
            "top_dirs_by_count": self.dir_counts.most_common(30),
            "dup_candidate_groups": len(dup_groups),
            "dup_candidate_files": sum(dup_groups.values()),
            "junk": dict(self.junk),
            "junk_bytes": dict(self.junk_bytes),
        }


def walk_zone(name, root, now):
    st = ZoneStats(name, root)
    if not root.exists():
        return st, False

    stack = [(str(root), 0)]
    while stack:
        current, depth = stack.pop()
        entries = []
        try:
            with os.scandir(current) as it:
                entries = list(it)
        except (PermissionError, OSError):
            st.errors += 1
            continue

        st.dirs += 1
        if not entries:
            st.empty_dirs += 1

        # Same prune organize.py applies, so `inventory` and `lint` agree.
        if org.looks_like_app_payload(entries):
            st.payload_dirs += 1
            continue

        here_files = 0
        for entry in entries:
            try:
                if entry.is_dir(follow_symlinks=False):
                    if entry.name.lower() in SKIP_DIRS or entry.name.lower().startswith("$"):
                        continue
                    stack.append((entry.path, depth + 1))
                    continue

                info = entry.stat(follow_symlinks=False)
            except (PermissionError, OSError):
                st.errors += 1
                continue

            here_files += 1
            st.files += 1
            if org.is_protected_file(entry.name):
                st.machine_managed += 1
            size = info.st_size
            st.bytes += size

            attrs = getattr(info, "st_file_attributes", 0)
            if attrs & PLACEHOLDER_MASK:
                st.placeholders += 1
            else:
                st.local_files += 1

            stem, ext = os.path.splitext(entry.name)
            ext = ext.lower()
            st.by_ext[ext or "(none)"] += 1
            st.bytes_by_ext[ext or "(none)"] += size
            st.by_age[age_bucket(info.st_mtime, now)] += 1
            st.depth_hist[depth] += 1

            if CONFORMING.match(stem.lower()):
                st.conforming += 1
            if DATE_IN_NAME.search(stem):
                st.has_date += 1
            if entity_in(stem):
                st.has_entity += 1

            plen = len(entry.path)
            if plen > st.longest_len:
                st.longest_len, st.longest_path = plen, entry.path

            # Duplicate CANDIDATES only — same size and same stem. Confirming a
            # duplicate needs a hash, which means reading, which P0 must not do.
            if size > 0:
                st.dup_index[(size, stem.lower())] += 1

            if ext in PARTIAL_EXT:
                st.junk["partial-download"] += 1
                st.junk_bytes["partial-download"] += size
            elif ext in INSTALLER_EXT and (now - info.st_mtime) > 30 * 86400:
                st.junk["installer->30d"] += 1
                st.junk_bytes["installer->30d"] += size
            elif ext in ARCHIVE_EXT:
                st.junk["archive"] += 1
                st.junk_bytes["archive"] += size
            if size == 0:
                st.junk["zero-byte"] += 1

        if here_files:
            rel = os.path.relpath(current, str(root))
            st.dir_counts[rel if rel != "." else "(root)"] += here_files

    return st, True


def human(n):
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024:
            return f"{n:.0f}{unit}" if unit == "B" else f"{n:.1f}{unit}"
        n /= 1024.0
    return f"{n:.1f}PB"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", dest="json_out")
    args = ap.parse_args()

    now = datetime.now(timezone.utc).timestamp()
    results, missing = [], []

    for name, root in ZONES.items():
        st, found = walk_zone(name, root, now)
        (results if found else missing).append(st.as_dict() if found else name)

    results.sort(key=lambda r: -r["files"])
    totals = {
        k: sum(r[k] for r in results)
        for k in ("files", "bytes", "dirs", "empty_dirs", "placeholders", "local_files",
                  "conforming", "has_entity_in_name", "errors", "machine_managed",
                  "organizable", "payload_dirs_pruned")
    }

    report = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "totals": totals,
        "zones_missing": missing,
        "zones": results,
    }

    if args.json_out:
        Path(args.json_out).write_text(
            json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    print(f"TOTAL  files={totals['files']:,}  organizable={totals['organizable']:,}  "
          f"machine-managed={totals['machine_managed']:,}  "
          f"payload-dirs-pruned={totals['payload_dirs_pruned']:,}")
    print(f"       size={human(totals['bytes'])}  "
          f"dirs={totals['dirs']:,}  placeholders={totals['placeholders']:,}  "
          f"local={totals['local_files']:,}  errors={totals['errors']}")
    print(f"CONFORMING to grammar: {totals['conforming']:,} "
          f"({100.0 * totals['conforming'] / max(totals['files'], 1):.2f}%)   "
          f"entity inferable: {totals['has_entity_in_name']:,} "
          f"({100.0 * totals['has_entity_in_name'] / max(totals['files'], 1):.2f}%)")
    if missing:
        print(f"MISSING zones: {', '.join(missing)}")
    print()
    print(f"{'zone':<20}{'files':>9}{'size':>10}{'cloud':>9}{'local':>9}{'dup-cand':>10}{'>3y':>8}{'maxpath':>9}")
    for r in results:
        print(f"{r['zone']:<20}{r['files']:>9,}{human(r['bytes']):>10}"
              f"{r['placeholders']:>9,}{r['local_files']:>9,}"
              f"{r['dup_candidate_files']:>10,}{r['by_age'].get('>3y', 0):>8,}"
              f"{r['longest_path_len']:>9}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
