"""P1 — organize: scan / apply / undo / lint.

The instrument the later phases point at real trees. Dry-run is the default and
`--apply` is always explicit; every executed move is written to an NDJSON
journal that `undo` replays in reverse.

Standard: .iago/_config/runbooks/file-naming-standard.md
    {YYYYMMDD}-{entity}-{descriptor}[-v{N}].{ext}

Design rule: the tool NEVER invents a descriptor. Date, entity and version are
extracted and repositioned; whatever is left of the original stem is slugified
and kept. A rename is therefore reversible by eye, not only by journal.

HARD RULE, inherited from P0: cloud-only OneDrive placeholders are skipped via
their attribute bits and never opened. Renaming one forces a download.

Usage:
  python organize.py scan --zone downloads --out plan.json
  python organize.py scan --root "C:/some/dir" --bucket
  python organize.py apply plan.json                 # dry-run
  python organize.py apply plan.json --apply
  python organize.py undo .local/organize/j-xxx.ndjson --apply
  python organize.py lint --zone downloads
"""

import argparse
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

TOOL_VERSION = 1
HOME = Path.home()

MAX_PATH = 255          # under the 260 ceiling, with headroom for the temp name
MAX_DESCRIPTOR = 60

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
}

SKIP_DIRS = {
    ".git", "node_modules", "appdata", "$recycle.bin", "__pycache__",
    ".venv", "venv", ".next", "dist", "build", ".cache", ".pytest_cache",
    "system volume information", ".claude", ".worktrees", "_trash",
    # Application-managed folders resolved by literal name. `WindowsPowerShell`
    # is the live user-scope PSModulePath — renaming it breaks Import-Module the
    # same way renaming dev\ breaks Claude Code's project directories.
    "windowspowershell", "onenote notebooks", "custom office templates",
    "plantillas personalizadas de office", "microsoft copilot chat files",
    "my music", "my pictures", "my videos",
}

# Files whose NAME is an interface. Renaming these breaks something silently:
# desktop.ini drives Windows folder customisation; a dotfile is tool-managed by
# convention; a binary is loaded by literal name from a manifest or an import
# table that no rename updates.
PROTECTED_NAMES = {"desktop.ini", "thumbs.db", ".ds_store", "icon\r", "ntuser.dat"}
PROTECTED_EXTS = {
    ".dll", ".sys", ".ocx", ".drv", ".winmd", ".mui", ".rll", ".tlb", ".pdb",
    ".cat", ".manifest", ".config", ".ini", ".lnk", ".url", ".msix", ".cab",
}

# Separate school tenant — not Santiago's to reorganise.
SKIP_ROOTS = {(HOME / "OneDrive - Rennes School of Business").resolve()}

# The rename-frozen code zone. Claude Code derives project directories from the
# literal path, so a rename here orphans transcripts, memory dirs and worktrees.
FROZEN_ROOTS = {(HOME / "dev").resolve()}

ENTITIES = {
    "rsf", "munet", "sentria", "din", "fulldata", "palazuelos",
    "iago", "iago-os", "iagoag", "iagoagency",
    "personal", "familia", "cfa", "uc3m", "rennes",
}
ENTITY_SENTINEL = "misc"

# Windows attribute bits marking a file that is not local.
PLACEHOLDER_MASK = 0x00001000 | 0x00040000 | 0x00400000

RESERVED_STEMS = {"con", "prn", "aux", "nul", "clock$"} | {
    f"{p}{i}" for p in ("com", "lpt") for i in range(1, 10)
}

# Stems that carry no information even after slugging — the review list.
DEGENERATE = re.compile(
    r"^(?:img|image|dsc|pxl|vid|video|screenshot|captura|scan|doc|documento|"
    r"untitled|sin-titulo|documento-sin-titulo|new|nuevo|download|descarga|"
    r"file|archivo|copy|copia|tmp|temp|unnamed|whatsapp[a-z-]*)"
    r"(?:-?\d+)?$"
)

BUCKETS = {
    "docs": {".pdf", ".doc", ".docx", ".odt", ".rtf", ".txt", ".md", ".pages", ".epub"},
    "sheets": {".xls", ".xlsx", ".xlsm", ".csv", ".ods", ".numbers"},
    "slides": {".ppt", ".pptx", ".odp", ".key"},
    "images": {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".heic", ".bmp",
               ".tif", ".tiff", ".ico", ".psd", ".ai"},
    "video": {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".wmv"},
    "audio": {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac"},
    "archives": {".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2"},
    "installers": {".exe", ".msi", ".dmg", ".pkg", ".appinstaller", ".deb", ".rpm"},
    "code": {".json", ".yaml", ".yml", ".xml", ".sql", ".py", ".js", ".ts", ".sh",
             ".ps1", ".bat", ".ipynb", ".html", ".css"},
}
EXT_TO_BUCKET = {ext: name for name, exts in BUCKETS.items() for ext in exts}


# --------------------------------------------------------------------------
# name derivation
# --------------------------------------------------------------------------

def slugify(text):
    """Lowercase ascii kebab. Accents folded, never dropped: 'ñ' -> 'n'."""
    decomposed = unicodedata.normalize("NFKD", text)
    ascii_only = decomposed.encode("ascii", "ignore").decode("ascii")
    kebab = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_only).strip("-").lower()
    return re.sub(r"-{2,}", "-", kebab)


def _valid_date(year, month, day):
    if not (1990 <= year <= 2099):
        return None
    try:
        return datetime(year, month, day).strftime("%Y%m%d")
    except ValueError:
        return None


COMPACT_DATE = re.compile(r"(?<!\d)((?:19|20)\d{2})(\d{2})(\d{2})(?!\d)")
TRIPLE_DATE = re.compile(r"(?<!\d)(\d{1,4})[-_.](\d{1,2})[-_.](\d{2,4})(?!\d)")

AMBIGUOUS = object()   # date-shaped, order unknowable — strip it, use mtime


def _resolve_day_month(first, second, year):
    """Decide which of two numbers is the day. Never guesses.

    `18.05` and `05.18` are both resolvable because 18 cannot be a month. `03.06`
    is not, and returns AMBIGUOUS rather than silently picking a locale.
    """
    if first > 12 and second <= 12:
        return _valid_date(year, second, first)
    if second > 12 and first <= 12:
        return _valid_date(year, first, second)
    if first <= 12 and second <= 12:
        return AMBIGUOUS
    return None


def _parse_triple(a, b, c):
    if len(a) == 4:                                    # yyyy-mm-dd, unambiguous
        return _valid_date(int(a), int(b), int(c))
    if len(c) == 4:                                    # dd-mm-yyyy or mm-dd-yyyy
        return _resolve_day_month(int(a), int(b), int(c))
    if len(c) == 2:                                    # two-digit year
        year = 1900 + int(c) if int(c) >= 80 else 2000 + int(c)
        return _resolve_day_month(int(a), int(b), year)
    return None


def extract_date(stem):
    """Return (yyyymmdd | None, remaining_stem, ambiguous).

    A date-shaped token whose field order cannot be determined is stripped from
    the stem anyway — it is still a date, so leaving it in the descriptor just
    duplicates noise next to the mtime-derived prefix — but None is returned so
    the caller falls back to mtime rather than guessing between day-first and
    month-first.
    """
    for pattern in (COMPACT_DATE, TRIPLE_DATE):
        for match in pattern.finditer(stem):
            a, b, c = match.groups()
            stamp = (_valid_date(int(a), int(b), int(c))
                     if pattern is COMPACT_DATE else _parse_triple(a, b, c))
            if stamp is None:
                continue
            remainder = stem[:match.start()] + " " + stem[match.end():]
            if stamp is AMBIGUOUS:
                return None, remainder, True
            return stamp, remainder, False
    return None, stem, False


VERSION_TOKEN = re.compile(r"(?:^|[-_. ])v\.?\s?(\d{1,3})(?=$|[-_. ])", re.IGNORECASE)
COPY_MARKER = re.compile(r"\(\s*\d+\s*\)|\bcopy\s*\d*\b", re.IGNORECASE)


def extract_version(stem):
    """Pull a standalone v{N} token out to the suffix position."""
    match = None
    for match in VERSION_TOKEN.finditer(stem):
        pass                                 # last one wins: 'v1 rev v2' -> v2
    if not match:
        return None, stem
    return int(match.group(1)), stem[:match.start()] + " " + stem[match.end():]


def extract_entity(stem, path_parts):
    """Vocabulary token from the stem, else from the path, else the sentinel."""
    tokens = [t for t in re.split(r"[-_. ]+", stem.lower()) if t]
    for i, token in enumerate(tokens):
        if i + 1 < len(tokens) and f"{token}-{tokens[i + 1]}" in ENTITIES:
            return f"{token}-{tokens[i + 1]}", "filename"
        if token in ENTITIES:
            return token, "filename"
    for part in reversed(path_parts):
        candidate = slugify(part)
        if candidate in ENTITIES:
            return candidate, "path"
    return ENTITY_SENTINEL, None


CONFORMING = re.compile(
    r"^(?:(?P<date>\d{8})-)?(?P<rest>[a-z0-9]+(?:-[a-z0-9]+)*?)(?:-v(?P<ver>\d+))?$"
)


def is_conforming(stem):
    """True if the stem already parses under the grammar with a known entity.

    The undated form is legal (§3: reference documents lead with the entity), so
    a deliberate undated name is left alone rather than having a date forced on
    it from mtime.
    """
    match = CONFORMING.fullmatch(stem)
    if not match:
        return False
    rest = match.group("rest")
    for entity in sorted(ENTITIES | {ENTITY_SENTINEL}, key=len, reverse=True):
        if rest == entity:
            return False                     # entity but no descriptor
        if rest.startswith(f"{entity}-"):
            return True
    return False


def truncate_descriptor(descriptor):
    if len(descriptor) <= MAX_DESCRIPTOR:
        return descriptor
    cut = descriptor[:MAX_DESCRIPTOR]
    if "-" in cut:
        cut = cut.rsplit("-", 1)[0]
    return cut.strip("-") or "file"


def derive_name(filename, mtime, path_parts, entity_override=None):
    """Derive the target filename. Pure function over metadata — no I/O.

    `entity_override` comes from a hints file: the AI pass supplies judgment for
    files whose owner cannot be derived mechanically, and this deterministic
    function still does the work. That split is the 60/30/10 rule in one call.
    """
    stem, ext = os.path.splitext(filename)
    ext = ext.lower()
    flags = []

    if COPY_MARKER.search(stem):
        flags.append("copy-marker")
        stem = COPY_MARKER.sub(" ", stem)

    date, stem, ambiguous = extract_date(stem)
    date_source = "filename"
    if ambiguous:
        flags.append("ambiguous-date")
    if not date:
        date = datetime.fromtimestamp(mtime).strftime("%Y%m%d")
        date_source = "mtime"

    version, stem = extract_version(stem)
    if entity_override:
        entity, entity_source = entity_override, "hint"
    else:
        entity, entity_source = extract_entity(stem, path_parts)

    descriptor_tokens = [
        t for t in slugify(stem).split("-")
        if t and t != entity and t not in entity.split("-")
    ]
    descriptor = truncate_descriptor("-".join(descriptor_tokens))
    if not descriptor:
        descriptor = "file"
        flags.append("empty-descriptor")
    if DEGENERATE.match(descriptor):
        flags.append("degenerate-stem")

    if entity == ENTITY_SENTINEL:
        flags.append("no-entity")

    if entity_source in ("filename", "hint") and date_source == "filename":
        confidence = "high"
    elif "empty-descriptor" in flags or "degenerate-stem" in flags:
        confidence = "low"
    elif entity == ENTITY_SENTINEL:
        confidence = "low"
    else:
        confidence = "medium"

    name = f"{date}-{entity}-{descriptor}"
    if version is not None:
        name += f"-v{version}"
    return {
        "name": name + ext,
        "confidence": confidence,
        "flags": flags,
        "date_source": date_source,
        "entity": entity,
        "entity_source": entity_source or "sentinel",
    }


# --------------------------------------------------------------------------
# safety rails
# --------------------------------------------------------------------------

def is_placeholder(stat_result):
    """Cloud-only OneDrive file. Renaming one forces a download."""
    return bool(getattr(stat_result, "st_file_attributes", 0) & PLACEHOLDER_MASK)


def under_frozen_zone(path):
    resolved = Path(path).resolve()
    for frozen in FROZEN_ROOTS:
        if resolved == frozen or frozen in resolved.parents:
            return True
    return False


def under_skipped_root(path):
    resolved = Path(path).resolve()
    for root in SKIP_ROOTS:
        if resolved == root or root in resolved.parents:
            return True
    return False


def in_git_tree(directory, stop_at, cache):
    """Walk up looking for .git. Result cached per directory."""
    directory = os.path.abspath(directory)
    if directory in cache:
        return cache[directory]
    chain, current = [], directory
    stop_at = os.path.abspath(stop_at)
    result = False
    while True:
        if current in cache:
            result = cache[current]
            break
        chain.append(current)
        if os.path.isdir(os.path.join(current, ".git")):
            result = True
            break
        parent = os.path.dirname(current)
        if current == stop_at or parent == current or not current.startswith(stop_at):
            break
        current = parent
    for entry in chain:
        cache[entry] = result
    return result


def is_protected_file(name):
    """A file whose name is load-bearing rather than descriptive."""
    lowered = name.lower()
    if lowered in PROTECTED_NAMES:
        return "protected-name"
    if os.path.splitext(lowered)[1] in PROTECTED_EXTS:
        return "protected-extension"
    if name.startswith("."):
        return "dotfile"
    return None


BINARY_EXTS = {".dll", ".sys", ".ocx", ".drv", ".winmd", ".pdb", ".rll", ".tlb"}


def looks_like_app_payload(entries):
    """True if this directory IS an unpacked application rather than documents.

    Generalises past a hardcoded list: an extracted installer, a portable app and
    a vendored runtime all look alike — binaries referencing each other by literal
    name from an import table or a manifest. Renaming any one breaks the tree, so
    the whole subtree is pruned.

    Deliberately a MAJORITY test, not a presence test. Downloads holds a dozen
    loose installers among hundreds of documents; that makes it a download folder,
    not an application. Requiring binaries to dominate is what separates the two.
    """
    # A virtualenv, whatever someone named it. PEP 405 guarantees pyvenv.cfg at
    # the root, which is the only reliable marker — matching on `.venv` by name
    # missed a real one called `.venvTA` and left 454 files behind.
    if any(entry.name.lower() == "pyvenv.cfg" for entry in entries):
        return True

    files, binaries = 0, 0
    for entry in entries:
        try:
            if entry.is_dir(follow_symlinks=False):
                continue
        except OSError:
            continue
        files += 1
        if os.path.splitext(entry.name.lower())[1] in BINARY_EXTS:
            binaries += 1
    return binaries >= 3 and binaries * 2 >= files


def name_is_legal(name):
    stem = os.path.splitext(name)[0].lower()
    if stem in RESERVED_STEMS:
        return False, "reserved-name"
    if name != name.rstrip(". "):
        return False, "trailing-dot-or-space"
    if not name.strip():
        return False, "empty-name"
    return True, None


def resolve_collision(target_dir, name, taken, src=None):
    """Collision-safe suffix, checked against the tree AND the plan's own targets.

    `src` is not a collision with itself — without this a case-only fix like
    `Informe.pdf` -> `informe.pdf` would be bumped to `informe-2.pdf`, because
    NTFS reports the destination as already existing.
    """
    stem, ext = os.path.splitext(name)
    candidate, counter = name, 2
    src_normcase = os.path.normcase(src) if src else None
    while True:
        full = os.path.join(target_dir, candidate)
        normcased = os.path.normcase(full)
        if normcased == src_normcase:
            return candidate
        if normcased not in taken and not os.path.exists(full):
            return candidate
        candidate = f"{stem}-{counter}{ext}"
        counter += 1


def find_git_root(path):
    """Nearest ancestor (inclusive) holding a .git directory, or None."""
    current = Path(path).resolve()
    for candidate in [current, *current.parents]:
        if (candidate / ".git").is_dir():
            return candidate
    return None


# --------------------------------------------------------------------------
# scan
# --------------------------------------------------------------------------

def scan(root, bucket=False, limit=None, hints=None):
    """Walk `root` and propose a rename per file.

    `hints` maps a root-relative path (forward slashes) to an entity token, so an
    AI classification pass can resolve the ambiguous tail without the derivation
    itself ever stopping being deterministic.
    """
    hints = hints or {}
    unknown_hints = {e for e in hints.values() if e not in ENTITIES and e != ENTITY_SENTINEL}
    if unknown_hints:
        raise SystemExit(f"hints use entities outside the vocabulary: {', '.join(sorted(unknown_hints))}. "
                         "Add them to the standard's §4 vocabulary first, deliberately.")
    root = Path(root).resolve()
    ops, skipped = [], []
    git_cache = {}
    taken = set()

    if under_frozen_zone(root):
        raise SystemExit(f"REFUSED: {root} is under the rename-frozen code zone.")
    enclosing_repo = find_git_root(root)
    if enclosing_repo:
        raise SystemExit(f"REFUSED: {root} is inside the git working tree at {enclosing_repo}. "
                         "Git tracks paths; renaming here rewrites history's idea of the tree.")

    stack = [str(root)]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as it:
                entries = sorted(it, key=lambda e: e.name)
        except (PermissionError, OSError) as exc:
            skipped.append({"path": current, "reason": f"unreadable: {exc.__class__.__name__}"})
            continue

        # Prune the whole subtree: an unpacked application is not documents, and
        # its parts reference each other by literal name.
        if looks_like_app_payload(entries):
            skipped.append({"path": current, "reason": "application-payload-dir"})
            continue

        for entry in entries:
            try:
                if entry.is_dir(follow_symlinks=False):
                    lowered = entry.name.lower()
                    if lowered in SKIP_DIRS or lowered.startswith("$"):
                        continue
                    if under_skipped_root(entry.path):
                        continue
                    stack.append(entry.path)
                    continue
                if entry.is_symlink():
                    skipped.append({"path": entry.path, "reason": "symlink"})
                    continue
                info = entry.stat(follow_symlinks=False)
            except (PermissionError, OSError) as exc:
                skipped.append({"path": entry.path, "reason": f"stat-failed: {exc.__class__.__name__}"})
                continue

            protected = is_protected_file(entry.name)
            if protected:
                skipped.append({"path": entry.path, "reason": protected})
                continue
            if is_placeholder(info):
                skipped.append({"path": entry.path, "reason": "cloud-placeholder"})
                continue
            if in_git_tree(current, str(root), git_cache):
                skipped.append({"path": entry.path, "reason": "inside-git-worktree"})
                continue

            stem, raw_ext = os.path.splitext(entry.name)
            target_dir = current
            if bucket:
                target_dir = str(root / EXT_TO_BUCKET.get(raw_ext.lower(), "other"))

            # Casing counts: `20250301-rsf-Informe.PDF` parses under the grammar
            # but is not conforming, and must still be lowercased.
            already_lower = stem == stem.lower() and raw_ext == raw_ext.lower()
            if already_lower and is_conforming(stem) and target_dir == current:
                skipped.append({"path": entry.path, "reason": "already-conforming"})
                continue

            rel_parts = Path(current).relative_to(root).parts
            rel_path = "/".join([*rel_parts, entry.name])
            proposal = derive_name(entry.name, info.st_mtime, list(rel_parts),
                                   entity_override=hints.get(rel_path))

            legal, why = name_is_legal(proposal["name"])
            if not legal:
                skipped.append({"path": entry.path, "reason": why})
                continue

            final_name = resolve_collision(target_dir, proposal["name"], taken, src=entry.path)
            destination = os.path.join(target_dir, final_name)

            # Exact match only — a difference of case alone is still a rename.
            if destination == entry.path:
                skipped.append({"path": entry.path, "reason": "already-conforming"})
                continue
            if len(destination) > MAX_PATH:
                skipped.append({"path": entry.path,
                                "reason": f"path-too-long ({len(destination)} > {MAX_PATH})"})
                continue

            taken.add(os.path.normcase(destination))
            if final_name != proposal["name"]:
                proposal["flags"] = proposal["flags"] + ["collision-suffixed"]

            ops.append({
                "id": len(ops) + 1,
                "op": "rename",
                "src": entry.path,
                "dst": destination,
                "size": info.st_size,
                "mtime_ns": info.st_mtime_ns,
                "confidence": proposal["confidence"],
                "flags": proposal["flags"],
                "entity": proposal["entity"],
                "entity_source": proposal["entity_source"],
                "date_source": proposal["date_source"],
            })
            if limit and len(ops) >= limit:
                stack = []
                break

    return {
        "tool_version": TOOL_VERSION,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "root": str(root),
        "bucket": bucket,
        "counts": {
            "ops": len(ops),
            "skipped": len(skipped),
            "high": sum(1 for o in ops if o["confidence"] == "high"),
            "medium": sum(1 for o in ops if o["confidence"] == "medium"),
            "low": sum(1 for o in ops if o["confidence"] == "low"),
        },
        "ops": ops,
        "skipped": skipped,
    }


# --------------------------------------------------------------------------
# apply / undo
# --------------------------------------------------------------------------

class Journal:
    """NDJSON, flushed and fsynced per line.

    A crash mid-run is exactly when the record matters most, so durability beats
    the throughput cost of one fsync per move.
    """

    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("a", encoding="utf-8", newline="\n")

    def write(self, record):
        self.handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        self.handle.flush()
        os.fsync(self.handle.fileno())

    def close(self):
        self.handle.close()


def _safe_rename(src, dst):
    """os.rename, with the NTFS case-insensitivity two-step when needed."""
    if os.path.normcase(src) == os.path.normcase(dst) and src != dst:
        temp = f"{dst}.organize-tmp"
        counter = 0
        while os.path.exists(temp):
            counter += 1
            temp = f"{dst}.organize-tmp{counter}"
        os.rename(src, temp)
        os.rename(temp, dst)
        return
    os.rename(src, dst)


def _guard(path):
    if under_frozen_zone(path):
        raise SystemExit(f"REFUSED: {path} is under the rename-frozen code zone.")


def apply_plan(plan, do_apply, journal_path=None, confidence=None):
    """Execute a plan. `confidence` filters to a subset, e.g. {'high','medium'},
    so a large plan can go out in batches with a journal per batch."""
    ops = plan["ops"]
    if confidence:
        ops = [o for o in ops if o["confidence"] in confidence]
    plan = dict(plan, ops=ops)

    for op in plan["ops"]:
        _guard(op["src"])
        _guard(op["dst"])

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    journal = None
    if do_apply:
        journal_path = journal_path or Path(".local/organize") / f"journal-{stamp}.ndjson"
        journal = Journal(journal_path)
        journal.write({
            "type": "header", "tool_version": TOOL_VERSION, "root": plan["root"],
            "started": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "ops_planned": len(plan["ops"]),
        })

    made_dirs, results = [], {"ok": 0, "stale": 0, "missing": 0, "failed": 0}
    try:
        for op in plan["ops"]:
            src, dst = op["src"], op["dst"]
            if not os.path.exists(src):
                results["missing"] += 1
                continue
            info = os.stat(src)
            if info.st_size != op["size"] or info.st_mtime_ns != op["mtime_ns"]:
                results["stale"] += 1
                continue

            target_dir = os.path.dirname(dst)
            if not do_apply:
                results["ok"] += 1
                continue

            if not os.path.isdir(target_dir):
                os.makedirs(target_dir, exist_ok=True)
                made_dirs.append(target_dir)
                journal.write({"type": "op", "op": "mkdir", "path": target_dir, "status": "ok"})

            # Re-resolve: the tree can change between scan and apply, so the
            # journal — not the plan — records the name actually used.
            final = dst
            if os.path.exists(final) and os.path.normcase(final) != os.path.normcase(src):
                final = os.path.join(
                    target_dir,
                    resolve_collision(target_dir, os.path.basename(dst), set(), src=src))
            if len(final) > MAX_PATH:
                results["failed"] += 1
                journal.write({"type": "op", "op": "rename", "src": src, "dst": final,
                               "status": "failed", "error": "path-too-long"})
                continue
            try:
                _safe_rename(src, final)
            except OSError as exc:
                results["failed"] += 1
                journal.write({"type": "op", "op": "rename", "src": src, "dst": final,
                               "status": "failed", "error": str(exc)})
                continue
            results["ok"] += 1
            journal.write({"type": "op", "op": "rename", "src": src, "dst": final,
                           "size": op["size"], "mtime_ns": op["mtime_ns"], "status": "ok"})
    finally:
        if journal:
            journal.close()

    return results, (str(journal_path) if do_apply else None)


def undo(journal_file, do_apply):
    records = []
    with open(journal_file, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                records.append(json.loads(line))

    operations = [r for r in records if r.get("type") == "op" and r.get("status") == "ok"]
    results = {"ok": 0, "missing": 0, "occupied": 0, "failed": 0, "dirs_removed": 0}

    out_journal = None
    if do_apply:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        out_journal = Journal(Path(journal_file).parent / f"undo-{stamp}.ndjson")
        out_journal.write({"type": "header", "tool_version": TOOL_VERSION,
                           "reverses": str(journal_file),
                           "started": datetime.now(timezone.utc).isoformat(timespec="seconds")})

    try:
        for record in reversed(operations):
            if record["op"] == "mkdir":
                if do_apply and os.path.isdir(record["path"]) and not os.listdir(record["path"]):
                    try:
                        os.rmdir(record["path"])
                        results["dirs_removed"] += 1
                    except OSError:
                        pass
                continue

            src, dst = record["src"], record["dst"]
            _guard(src)
            _guard(dst)
            if not os.path.exists(dst):
                results["missing"] += 1
                continue
            if os.path.exists(src) and os.path.normcase(src) != os.path.normcase(dst):
                results["occupied"] += 1
                continue
            if not do_apply:
                results["ok"] += 1
                continue
            try:
                os.makedirs(os.path.dirname(src), exist_ok=True)
                _safe_rename(dst, src)
            except OSError as exc:
                results["failed"] += 1
                out_journal.write({"type": "op", "op": "rename", "src": dst, "dst": src,
                                   "status": "failed", "error": str(exc)})
                continue
            results["ok"] += 1
            out_journal.write({"type": "op", "op": "rename", "src": dst, "dst": src, "status": "ok"})
    finally:
        if out_journal:
            out_journal.close()

    return results


# --------------------------------------------------------------------------
# cli
# --------------------------------------------------------------------------

def resolve_root(args):
    if args.zone:
        if args.zone not in ZONES:
            raise SystemExit(f"unknown zone '{args.zone}'. known: {', '.join(sorted(ZONES))}")
        return ZONES[args.zone]
    if args.root:
        return Path(args.root)
    raise SystemExit("need --zone or --root")


def cmd_scan(args):
    root = resolve_root(args)
    if not Path(root).is_dir():
        raise SystemExit(f"not a directory: {root}")
    hints = {}
    if args.hints:
        hints = json.loads(Path(args.hints).read_text(encoding="utf-8"))
    plan = scan(root, bucket=args.bucket, limit=args.limit, hints=hints)

    out = Path(args.out) if args.out else Path(".local/organize") / (
        f"plan-{args.zone or Path(root).name}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(plan, indent=2, ensure_ascii=False), encoding="utf-8")

    counts = plan["counts"]
    print(f"root      {plan['root']}")
    print(f"proposed  {counts['ops']:,}  (high {counts['high']:,} · "
          f"medium {counts['medium']:,} · low {counts['low']:,})")
    print(f"skipped   {counts['skipped']:,}")
    reasons = {}
    for entry in plan["skipped"]:
        reasons[entry["reason"].split(" (")[0]] = reasons.get(entry["reason"].split(" (")[0], 0) + 1
    for reason, count in sorted(reasons.items(), key=lambda kv: -kv[1]):
        print(f"            {count:>6,}  {reason}")
    print(f"plan      {out}")
    if counts["low"]:
        print(f"\n{counts['low']:,} low-confidence proposals need review before --apply.")
    return 0


def cmd_apply(args):
    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    confidence = set(args.confidence.split(",")) if args.confidence else None
    if confidence:
        unknown = confidence - {"high", "medium", "low"}
        if unknown:
            raise SystemExit(f"unknown confidence level(s): {', '.join(sorted(unknown))}")
        print(f"batch     confidence in {sorted(confidence)} "
              f"({sum(1 for o in plan['ops'] if o['confidence'] in confidence):,} "
              f"of {len(plan['ops']):,} ops)")
    results, journal_path = apply_plan(plan, args.apply, args.journal, confidence)
    mode = "APPLIED" if args.apply else "DRY-RUN (nothing changed; pass --apply)"
    print(f"{mode}  ok={results['ok']:,} stale={results['stale']:,} "
          f"missing={results['missing']:,} failed={results['failed']:,}")
    if journal_path:
        print(f"journal   {journal_path}")
        print(f"undo with: python {Path(__file__).name} undo \"{journal_path}\" --apply")
    return 1 if results["failed"] else 0


def cmd_undo(args):
    results = undo(args.journal, args.apply)
    mode = "APPLIED" if args.apply else "DRY-RUN (nothing changed; pass --apply)"
    print(f"{mode}  restored={results['ok']:,} missing={results['missing']:,} "
          f"occupied={results['occupied']:,} failed={results['failed']:,} "
          f"dirs_removed={results['dirs_removed']:,}")
    return 1 if results["failed"] or results["occupied"] else 0


def cmd_lint(args):
    root = resolve_root(args)
    plan = scan(root, bucket=False)
    violations = plan["counts"]["ops"]
    conforming = sum(1 for s in plan["skipped"] if s["reason"] == "already-conforming")
    total = violations + conforming
    rate = 100.0 * conforming / total if total else 100.0
    print(f"{root}\n  conforming {conforming:,}/{total:,} ({rate:.1f}%)  violations {violations:,}")
    for op in plan["ops"][:20]:
        print(f"    {os.path.basename(op['src'])}  ->  {os.path.basename(op['dst'])}")
    if violations > 20:
        print(f"    ... and {violations - 20:,} more")
    return 1 if violations else 0


def main():
    parser = argparse.ArgumentParser(prog="organize.py")
    subparsers = parser.add_subparsers(dest="command", required=True)

    scan_parser = subparsers.add_parser("scan", help="propose renames -> plan JSON (read-only)")
    scan_parser.add_argument("--zone")
    scan_parser.add_argument("--root")
    scan_parser.add_argument("--out")
    scan_parser.add_argument("--bucket", action="store_true", help="also file into type buckets")
    scan_parser.add_argument("--limit", type=int)
    scan_parser.add_argument("--hints", help="JSON map of root-relative path -> entity token")
    scan_parser.set_defaults(func=cmd_scan)

    apply_parser = subparsers.add_parser("apply", help="execute a plan (dry-run by default)")
    apply_parser.add_argument("plan")
    apply_parser.add_argument("--apply", action="store_true")
    apply_parser.add_argument("--journal")
    apply_parser.add_argument("--confidence",
                              help="comma-separated subset to execute, e.g. high,medium")
    apply_parser.set_defaults(func=cmd_apply)

    undo_parser = subparsers.add_parser("undo", help="reverse a journal (dry-run by default)")
    undo_parser.add_argument("journal")
    undo_parser.add_argument("--apply", action="store_true")
    undo_parser.set_defaults(func=cmd_undo)

    lint_parser = subparsers.add_parser("lint", help="report non-conforming names")
    lint_parser.add_argument("--zone")
    lint_parser.add_argument("--root")
    lint_parser.set_defaults(func=cmd_lint)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
