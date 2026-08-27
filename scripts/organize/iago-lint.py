"""P2 — iago-lint: does this workspace obey the `.iago/` grammar?

Report mode only. This tool never moves, deletes or writes a file — it prints a
worklist and exits 1 when the worklist is non-empty. `fix`/`undo` are deferred
to P5 deliberately: the schema *requires* `_config/` and `_archive/`, so a naive
"underscore means scratch" auto-fix would move an entire config tree into a
gitignored directory.

Standard: .iago/plans/feature-doc-standard/README.md §2 (schema), §3 (docs/),
§6 (lifecycle). The schema is not restated in `.claude/rules/` — this script is
the enforcement.

Codes
  W001  a required file is missing from `.iago/`
  W002  a banned directory sits at `.iago/` root
  W003  a scratch file lives outside `state/`
  W004  a zero-byte file (`.gitkeep` included — reported, never auto-fixed)
  W005  an empty directory
  W006  `STATE.md` has no `Updated:` line, or one older than the tree
  W007  a nested `.iago/` in an app repo holds more than `state/`
  W008  `docs/` runs a second plan system
  W009  a second `ROADMAP-*.md`
  W010  `README.md` at `.iago/` root (CONTEXT.md is the entry)

Usage:
  python iago-lint.py check                       # this workspace
  python iago-lint.py check --root clients/din    # exactly one workspace
  python iago-lint.py check --all                 # + every clients/*/.iago
  python iago-lint.py check --json
  python iago-lint.py check --exclude W006        # CI: checkout flattens mtimes
"""

import argparse
import json
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path

TOOL_VERSION = 1

# --------------------------------------------------------------------------
# the schema, §2
# --------------------------------------------------------------------------

REQUIRED_FILES = ("CONTEXT.md", "PROJECT.md", "ROADMAP.md", "STATE.md", "config.json")

# Banned at `.iago/` root -> the one home each of them has.
BANNED_ROOT_DIRS = {
    "specs": "plans/feature-{slug}/SPEC.md  (stable framing -> _config/context/)",
    "audits": "research/",
    "reviews": "state/reviews/",
    "logs": "state/logs/",
    "runs": "state/runs/",
    "pipeline-runs": "state/pipeline-runs/",
    "context": "_config/context/",
    "runbooks": "_config/runbooks/",
    "decisions": "_config/decisions/",
    "learnings": "_config/learnings/",
    "prompts": "_config/prompts/",
    "hooks": "_config/hooks/",
    "assets": "_config/context/",
    "workflows": "_config/context/",
    "handoff": "_config/context/",
}

# Scratch *files*. Never directories: `_config/`, `_archive/` and
# `plans/*/_archive/` are required by the tree and carry the same prefix.
SCRATCH_PREFIXES = ("_", "tmp")
SCRATCH_SUFFIXES = (".log", ".txt", ".bak")

# Pruned when walking `.iago/`. `state/` is per-run by definition, `_archive/`
# is superseded-on-purpose, and neither may count towards STATE.md staleness.
SKIP_WALK_DIRS = {"state", "_archive", "node_modules", ".git", "__pycache__", ".worktrees"}

# Pruned when walking the workspace tree looking for nested `.iago/` and `docs/`.
TREE_SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", ".next", ".cache",
    ".pytest_cache", ".worktrees", "dist", "dist-app", "dev-dist", "build",
    "out", "coverage", "vendor",
}

# Directories at the workspace root that hold *other* workspaces, or the
# prototype of one. `clients/*` are scanned by `--all` (or their own `--root`);
# `templates/*/.iago` is the scaffolder's source, and what must lint clean is
# the tree it EMITS, not the `.template` files it emits it from. Neither is a
# nested app repo, so neither is W007.
SUB_WORKSPACE_DIRS = {"clients", "templates"}

# docs/ is human-facing (§3). These three are the second plan system.
DOCS_BANNED_CHILDREN = ("plans", "research", "reviews")

STALE_DAYS = 14

CODES = {
    "W001": ("error", "required file missing"),
    "W002": ("error", "banned directory at .iago/ root"),
    "W003": ("error", "scratch file outside state/"),
    "W004": ("warning", "zero-byte file"),
    "W005": ("warning", "empty directory"),
    "W006": ("warning", "STATE.md Updated: missing or stale"),
    "W007": ("error", "nested .iago/ holds more than state/"),
    "W008": ("error", "docs/ runs a second plan system"),
    "W009": ("error", "a second ROADMAP"),
    "W010": ("error", "README.md at .iago/ root"),
}

UPDATED_RE = re.compile(r"Updated:\**\s*(\d{4}-\d{2}-\d{2})")


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def finding(code, path, message, remedy=None):
    """The one record shape. Plan 03 pipes this into CI; do not widen it."""
    return {
        "code": code,
        "path": path,
        "message": message,
        "fix": remedy,
        "severity": CODES[code][0],
    }


def relpath(path, root):
    return os.path.relpath(str(path), str(root)).replace("\\", "/")


def is_scratch_name(name):
    lower = name.lower()
    return lower.startswith(SCRATCH_PREFIXES) or lower.endswith(SCRATCH_SUFFIXES)


def nearest_state_dir(path):
    """The `state/` a stray file belongs in: the NEAREST enclosing `.iago/`.

    An app repo's own `.iago/state/` is the destination for its own scratch —
    never the outer workspace's, which is a different repo.
    """
    for parent in Path(path).parents:
        if parent.name == ".iago":
            return parent / "state"
    return None


def read_text(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


# --------------------------------------------------------------------------
# the checks
# --------------------------------------------------------------------------

def _check_required_files(iago, root):
    out = []
    for name in REQUIRED_FILES:
        if not (iago / name).is_file():
            out.append(finding(
                "W001", relpath(iago / name, root),
                f"required file missing — §2 lists {', '.join(REQUIRED_FILES)}",
                f"create .iago/{name} (templates/{{client,internal}}-project/.iago/ has a seed)",
            ))
    return out


def _check_root_entries(iago, root):
    """W002, W009, W010 — everything decided by a name at `.iago/` root."""
    out = []
    for entry in sorted(iago.iterdir()):
        if entry.is_dir() and entry.name in BANNED_ROOT_DIRS:
            dest = BANNED_ROOT_DIRS[entry.name]
            verb = "move" if "{slug}" in dest else f"git mv .iago/{entry.name} .iago/{dest}"
            out.append(finding(
                "W002", relpath(entry, root),
                f"banned at .iago/ root — its one home is .iago/{dest}",
                verb if "{slug}" not in dest else f"move .iago/{entry.name}/* to .iago/{dest}",
            ))
        elif entry.is_file():
            if entry.name == "README.md":
                out.append(finding(
                    "W010", relpath(entry, root),
                    "README.md at .iago/ root — CONTEXT.md is the entry; two entries means two "
                    "routing tables that drift",
                    "fold anything still true into .iago/CONTEXT.md, then git rm .iago/README.md",
                ))
            elif entry.name.startswith("ROADMAP-") and entry.name.endswith(".md"):
                out.append(finding(
                    "W009", relpath(entry, root),
                    "a second roadmap — §2 allows exactly one ROADMAP.md per workspace",
                    f"merge {entry.name} into .iago/ROADMAP.md as a phase table, then delete it",
                ))
    return out


def _walk_iago(iago, root):
    """W003, W004, W005 + the newest mtime STATE.md is measured against."""
    out = []
    newest = None
    for current, dirnames, filenames in os.walk(iago):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_WALK_DIRS)
        here = Path(current)

        # Truly empty on disk — not "empty once we pruned state/ out of it".
        try:
            entries = os.listdir(current)
        except OSError:
            entries = ["?"]
        if here != iago and not entries:
            out.append(finding(
                "W005", relpath(here, root),
                "empty directory — git cannot track it, so it exists only on this machine",
                "delete it, or ship a real seed file (never .gitkeep — that is W004)",
            ))

        for name in sorted(filenames):
            path = here / name
            try:
                size = path.stat().st_size
            except OSError:
                continue

            if size == 0:
                if name == ".gitkeep":
                    out.append(finding(
                        "W004", relpath(path, root),
                        "zero-byte .gitkeep — the templates ship a real seed file instead; "
                        "deleting this one silently removes a directory the scaffolder depends on",
                        None,
                    ))
                else:
                    out.append(finding(
                        "W004", relpath(path, root),
                        "zero-byte file — it reads as content and carries none",
                        f"delete {relpath(path, root)}, or write the content it promises",
                    ))

            if is_scratch_name(name):
                state = nearest_state_dir(path)
                remedy = None
                if state is not None:
                    remedy = (f"git mv {relpath(path, root)} "
                              f"{relpath(state, root)}/{name}  (gitignored, per-run)")
                out.append(finding(
                    "W003", relpath(path, root),
                    "scratch file outside state/ — `_*`, `tmp*`, `*.log`, `*.txt` and `*.bak` "
                    "are per-run artefacts and belong in the nearest .iago/state/",
                    remedy,
                ))

            mtime = path.stat().st_mtime
            if newest is None or mtime > newest:
                newest = mtime
    return out, newest


def _check_state_freshness(iago, root, newest):
    state_md = iago / "STATE.md"
    if not state_md.is_file():
        return []                      # already reported as W001; do not pile on
    match = UPDATED_RE.search(read_text(state_md))
    if not match:
        return [finding(
            "W006", relpath(state_md, root),
            "no `Updated:` line — §1 makes it mandatory; without it nothing can tell whether "
            "this digest still describes the workspace",
            f"add `**Updated:** {date.today().isoformat()}` to the STATE.md header",
        )]
    if newest is None:
        return []
    updated = date.fromisoformat(match.group(1))
    newest_date = datetime.fromtimestamp(newest).date()
    lag = (newest_date - updated).days
    if lag <= STALE_DAYS:
        return []
    return [finding(
        "W006", relpath(state_md, root),
        f"`Updated: {updated.isoformat()}` is {lag} days behind the newest file under .iago/ "
        f"({newest_date.isoformat()}); the window is {STALE_DAYS} days "
        "(state/, _archive/ and __pycache__/ excluded)",
        f"bump `Updated:` to {newest_date.isoformat()} in the same commit that touched .iago/",
    )]


def _walk_tree(root, iago):
    """W007, W008 — everything outside the workspace's own `.iago/`."""
    out = []
    root_s = str(root)
    for current, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in TREE_SKIP_DIRS)

        if current == root_s:
            # The workspace's own `.iago/` is checked elsewhere; `clients/*` are
            # sub-workspaces with their own roots, reached via --all.
            dirnames[:] = [d for d in dirnames
                           if d != ".iago" and d not in SUB_WORKSPACE_DIRS]

        if ".iago" in dirnames:
            nested = Path(current) / ".iago"
            dirnames.remove(".iago")
            if nested == iago:
                continue
            try:
                extra = sorted(e for e in os.listdir(nested) if e != "state")
            except OSError:
                continue
            if extra:
                out.append(finding(
                    "W007", relpath(nested, root),
                    "nested .iago/ in an app repo holding " + ", ".join(extra[:4]) +
                    " — §2 allows only state/ here (locks); planning lives in the workspace's "
                    ".iago/, which the app repo gitignores",
                    f"git mv {relpath(nested, root)}/* into the workspace .iago/, "
                    "leaving only state/",
                ))

        if Path(current).name == "docs":
            for child in DOCS_BANNED_CHILDREN:
                if child in dirnames:
                    hit = Path(current) / child
                    out.append(finding(
                        "W008", relpath(hit, root),
                        f"docs/ is human-facing (§3) — a `{child}/` tree here is a second plan "
                        "system competing with .iago/plans/",
                        f"git mv {relpath(hit, root)} "
                        f".iago/plans/_archive/{date.today():%Y-%m}-docs-migration/{child}",
                    ))
    return out


# --------------------------------------------------------------------------
# public API
# --------------------------------------------------------------------------

def check_workspace(root, exclude=None):
    """Every §2/§3/§6 violation in ONE workspace. Read-only. Sorted, stable."""
    root = Path(root)
    iago = root / ".iago"
    if not iago.is_dir():
        # A missing `.iago/` scanned to zero findings would read as a perfectly
        # clean workspace, which is the worst possible answer for a check that
        # runs unattended.
        raise SystemExit(f"REFUSED: {root} has no .iago/ — that is not a workspace, "
                         "and an unreadable tree is not a conforming one.")

    findings = []
    findings += _check_required_files(iago, root)
    findings += _check_root_entries(iago, root)
    walked, newest = _walk_iago(iago, root)
    findings += walked
    findings += _check_state_freshness(iago, root, newest)
    findings += _walk_tree(root, iago)

    if exclude:
        findings = [f for f in findings if f["code"] not in exclude]
    findings.sort(key=lambda f: (f["code"], f["path"]))
    return findings


def find_workspaces(root, scan_all=False):
    """`--root` is exactly one workspace. `--all` adds `clients/*/.iago`."""
    root = Path(root)
    if not (root / ".iago").is_dir():
        raise SystemExit(f"REFUSED: {root} has no .iago/ — that is not a workspace.")
    found = [root]
    if scan_all:
        clients = root / "clients"
        if clients.is_dir():
            for child in sorted(clients.iterdir()):
                if (child / ".iago").is_dir():
                    found.append(child)
    return found


def format_finding(record):
    line = f"{record['code']}  {record['path']}  {record['message']}"
    if record["fix"]:
        line += f"  → {record['fix']}"
    return line


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def cmd_check(args):
    exclude = set(args.exclude or ())
    unknown = exclude - set(CODES)
    if unknown:
        raise SystemExit(f"REFUSED: unknown code(s) {', '.join(sorted(unknown))}. "
                         f"Known: {', '.join(sorted(CODES))}")

    workspaces = find_workspaces(args.root, scan_all=args.all)
    blocks = [{"root": str(ws), "findings": check_workspace(ws, exclude=exclude)}
              for ws in workspaces]
    total = sum(len(b["findings"]) for b in blocks)
    errors = sum(1 for b in blocks for f in b["findings"] if f["severity"] == "error")

    if args.json:
        print(json.dumps({
            "tool": "iago-lint",
            "version": TOOL_VERSION,
            "workspaces": blocks,
            "counts": {"findings": total, "error": errors, "warning": total - errors},
        }, indent=2))
        return 1 if total else 0

    for block in blocks:
        print(f"\n{block['root']}")
        if not block["findings"]:
            print("  conforming — 0 violations")
            continue
        for record in block["findings"]:
            print(f"  {format_finding(record)}")
    plural = "workspace" if len(blocks) == 1 else "workspaces"
    print(f"\n{total} violation(s) — {errors} error, {total - errors} warning "
          f"across {len(blocks)} {plural}")
    if total:
        print("report mode only: nothing was moved. This list is the worklist.")
    return 1 if total else 0


def build_parser():
    parser = argparse.ArgumentParser(prog="iago-lint.py")
    subparsers = parser.add_subparsers(dest="command", required=True)

    check_parser = subparsers.add_parser("check", help="report .iago/ schema violations")
    check_parser.add_argument("--root", default=".",
                              help="workspace root — the directory CONTAINING .iago/ (default .)")
    check_parser.add_argument("--all", action="store_true",
                              help="also scan every clients/*/.iago sub-workspace")
    check_parser.add_argument("--json", action="store_true", help="machine-readable report")
    check_parser.add_argument("--exclude", action="append", metavar="CODE",
                              help="suppress a code (repeatable) — CI excludes W006")
    check_parser.set_defaults(func=cmd_check)
    return parser


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    args = build_parser().parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
