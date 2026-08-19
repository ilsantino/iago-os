"""P5 — route: move files to the folder that owns them.

`organize.py` fixed what files are *called*. This fixes where they *live*.

The premise is that after P2/P3 every filename already carries its entity
(`20260811-din-deck-v8.pptx`), so routing is a lookup, not a judgment — the
deterministic layer, not the AI one. Two rules produce every move:

  1. A file whose entity has a home in the taxonomy goes to that home.
     Client work lands under `iago/01-clientes/{entity}/`, DIN under `din/`
     (Santiago keeps DIN separate from iaGO), personal papers under
     `personal/{area}/`.

  2. Everything else stays in Downloads but is grouped by *purpose* instead of
     by file extension. Extension-based folders (`docs/`, `sheets/`, `slides/`)
     are the thing being removed: the extension is already visible in the name,
     so sorting by it says nothing and it smears one deliverable across four
     folders.

Two exceptions are carved out of rule 1, both about bytes rather than meaning:

  * `HEAVY_MB` — raw source material (database dumps, site archives) is not a
    record and does not belong in a synced drive. It routes to a local project
    folder under `Downloads/proyectos/{entity}/` instead.
  * Credentials never route. They are collected for `~/.secure/` by hand,
    because a secret that moves automatically is a secret nobody is watching.

Journal format matches organize.py, so `organize.py undo <journal>` reverses a
run in full.

Usage:
  python route.py plan --out plan.json
  python route.py apply plan.json                    # dry-run
  python route.py apply plan.json --apply
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import organize as org                                              # noqa: E402

HOME = org.HOME
DOWNLOADS = HOME / "Downloads"
ONEDRIVE = HOME / "OneDrive"

# Above this, a file is treated as source material rather than as a record and
# is kept out of the synced drive. 50 MB clears every document, deck and
# spreadsheet in the corpus and catches only database dumps and site archives.
HEAVY_MB = 50

# Extension-keyed folders P2 created. These are the ones being dissolved; any
# other directory in Downloads is left alone because someone chose its name.
# `installers/` is deliberately absent: every file in it is a re-downloadable
# app installer, so it is reclaim.py's problem, not a filing problem.
TYPE_DIRS = {"docs", "sheets", "slides", "images", "video", "audio",
             "code", "archives", "other"}

# entity -> path relative to OneDrive. A missing entity means "no home yet",
# which routes to the Downloads inbox rather than guessing.
DEST = {
    "allende":     "iago/01-clientes/allende",
    "absara":      "iago/01-clientes/absara",
    "o11e":        "iago/01-clientes/o11e",
    "palazuelos":  "iago/01-clientes/palazuelos",
    "munet":       "iago/01-clientes/munet",
    "sentria":     "iago/01-clientes/sentria",
    "rsf":         "iago/01-clientes/rsf",
    "fulldata":    "iago/01-clientes/fulldata",
    "installflow": "iago/01-clientes/installflow",
    "din":         "din",
    "iago":        "iago/04-comercial",
    "iagoag":      "iago/04-comercial",
    "iagoagency":  "iago/04-comercial",
    "personal":    "personal",
    "uc3m":        "personal/02-educacion",
    "rennes":      "personal/02-educacion/rsb",
    "cfa":         "personal/05-formacion/cfa",
    "sat":         "personal/03-finanzas/sat",
    "familia":     "personal",
}

# Sub-routing inside an entity's home, first match wins. Without these, every
# iaGO file would pile into 04-comercial and every personal file into the root.
SUBROUTE = {
    "iago": [
        (re.compile(r"\bcsf\b|constancia|opinion-cumplimiento|\brfc\b|factura|"
                    r"\boc-\d|orden-de-compra|declaraci"), "iago/02-empresa/fiscal"),
        (re.compile(r"contrato|convenio|confidencialidad|nda\b"), "iago/02-empresa/legal"),
        (re.compile(r"logo|marca|brand|identidad-visual"), "iago/02-empresa/marca"),
        (re.compile(r"system-prompt|blueprint|prototipo"), "iago/03-entregables"),
    ],
    "personal": [
        (re.compile(r"\bcv\b|curriculum|carta-de-recomendacion|carta-recomendacion|"
                    r"recomendacion"), "personal/04-carrera/cvs"),
        (re.compile(r"ine|curp|pasaporte|acta-de-nacimiento|identidad"), "personal/01-identidad"),
        (re.compile(r"\bsat\b|factura|declaraci|constancia|impuesto"), "personal/03-finanzas/sat"),
        (re.compile(r"banco|estado-de-cuenta|inversion|banca"), "personal/03-finanzas/banca-inversion"),
        (re.compile(r"empleo|vacante|oferta|entrevista"), "personal/04-carrera/empleos"),
    ],
}

# Purpose buckets for files that carry no entity. Ordered — first match wins,
# and the name test runs before the extension test so a screenshot that happens
# to be a .png is filed as a capture rather than as generic media.
PURPOSE = [
    ("capturas",   re.compile(r"screenshot|screen-recording|screenrecording|captura|"
                              r"chatgpt-image|whatsapp-image|snipped|pantalla")),
    ("media",      re.compile(r"kling|whatsapp-video|whatsapp-audio|clip-audio|render")),
]
PURPOSE_EXT = [
    ("media",      {".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4a", ".wav", ".mp3", ".ogg"}),
    ("capturas",   {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".heic"}),
    ("referencia", {".pdf", ".docx", ".doc", ".pptx", ".ppt", ".epub", ".md", ".txt"}),
    ("datos",      {".xlsx", ".xlsm", ".xlsb", ".csv", ".tsv", ".json", ".xml"}),
    ("codigo",     {".py", ".js", ".ts", ".tsx", ".html", ".css", ".sh", ".ps1",
                    ".cmd", ".bat", ".bas", ".cls", ".r", ".sql"}),
    ("archivos",   {".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".iso"}),
]

# Never routed by this tool. Secrets move by hand, into ~/.secure/, so that the
# act of relocating one is always a decision somebody made on purpose.
# `recovery-codes` earns its place here: a 2FA recovery code is a credential
# that does not look like one, and the first pass filed a live GitHub set under
# `personal/` because nothing in the name said "secret".
CREDENTIAL = re.compile(
    r"credential|accesskey|access-key|api-key|apikey|client-secret|"
    r"secret|password|contrase|recovery-code|backup-code|\b2fa\b|\botp-|"
    r"seed-phrase|mnemonic|\.pem$|\.ppk$|\.p12$|\.pfx$|\.key$",
    re.IGNORECASE,
)

# Entity tags P2 derived wrongly, corrected here rather than in the filename so
# the reason survives in one readable place. Each entry is a file that was read
# to find out what it actually is.
#
# The Santander orders are Santiago's own portfolio instructions (client 4019487)
# and were tagged `palazuelos` only because of the folder they sat in — the
# clearest case yet of why a folder name is not evidence of ownership.
OVERRIDE = {
    "20260518-palazuelos-unsolicited-investment-order-portfolio-8-sac-phase-1-of-3.pdf":
        ("personal", "personal/03-finanzas/banca-inversion"),
    "20260616-palazuelos-unsolicited-investment-order-portfolio-8-sac-phase-2-of-3.pdf":
        ("personal", "personal/03-finanzas/banca-inversion"),
    "20260716-palazuelos-unsolicited-investment-order-portfolio-8-sac-phase-3-of-3.pdf":
        ("personal", "personal/03-finanzas/banca-inversion"),
}

# A client folder is subdivided only once it is too big to read at a glance.
# Below this, subfolders cost more than they explain.
SUBDIVIDE_AT = 20

# ...and only a CLIENT folder takes this shape. `personal/` is organised by life
# area and has its own subroutes; bucketing it by deliverable type produced
# `personal/03-entregables`, which describes nothing anyone owns.
SUBDIVIDABLE = {e for e, d in DEST.items() if d.startswith("iago/01-clientes")} | {"din"}

# Deliverable-type buckets inside a large client folder. The axis is what a file
# IS to the engagement, not what application opens it — a pricing spreadsheet and
# a pricing deck are both proposals and belong together.
CLIENT_BUCKETS = [
    ("01-contratos",   re.compile(r"contrato|convenio|confidencialidad|\bnda\b|"
                                  r"propuesta-comercial|cotizacion|\bcot-")),
    ("02-propuestas",  re.compile(r"deck|presentaci|propuesta|pricing|precio|bundle|"
                                  r"deco[yi]|deck-v|deck$|onepager|diagnostico")),
    ("03-entregables", re.compile(r"prototipo|\bprd\b|guia|flujo|manual|reporte|"
                                  r"informe|analisis|blueprint|modelo|plantilla|"
                                  r"catalogo|estructura|brief")),
    ("04-insumos",     re.compile(r"logo|asset|captura|screenshot|whatsapp|foto|"
                                  r"imagen|nota|audio|video|\bref\b")),
]

ENTITY_RE = re.compile(r"^(\d{8})-([a-z0-9]+)-")


def client_bucket(stem, ext):
    """Which deliverable bucket a file belongs to inside a big client folder."""
    for bucket, pattern in CLIENT_BUCKETS:
        if pattern.search(stem):
            return bucket
    if ext in {".png", ".jpg", ".jpeg", ".svg", ".mp4", ".m4a", ".wav", ".zip"}:
        return "04-insumos"
    return "03-entregables"


def parse_entity(name):
    """The entity the nomenclature already recorded, or None."""
    match = ENTITY_RE.match(name)
    if not match:
        return None
    entity = match.group(2)
    return entity if entity in org.ENTITIES or entity in DEST else None


def subroute(entity, stem, default):
    for pattern, target in SUBROUTE.get(entity, []):
        if pattern.search(stem):
            return target
    return default


def purpose_bucket(name, ext):
    lowered = name.lower()
    for bucket, pattern in PURPOSE:
        if pattern.search(lowered):
            return bucket
    for bucket, extensions in PURPOSE_EXT:
        if ext in extensions:
            return bucket
    return "_inbox"


def classify(path, size, big_entities=frozenset()):
    """Return (destination_dir, reason) or (None, why-not) for one file."""
    name = path.name
    if org.is_protected_file(name):
        return None, "machine-managed"
    if CREDENTIAL.search(name):
        return None, "credential — moves by hand"

    ext = path.suffix.lower()
    stem = path.stem.lower()

    if name in OVERRIDE:
        entity, target = OVERRIDE[name]
        return ONEDRIVE / target, f"override -> {entity}"

    entity = parse_entity(name)

    if entity and entity in DEST:
        if size > HEAVY_MB * 1024 * 1024:
            return DOWNLOADS / "proyectos" / entity, "heavy source — stays local"
        target = subroute(entity, stem, DEST[entity])
        # `and entity in SUBDIVIDABLE` is not redundant with census(): this
        # function must not depend on its caller having filtered correctly.
        if (entity in big_entities and entity in SUBDIVIDABLE
                and target == DEST[entity]):
            target = f"{target}/{client_bucket(stem, ext)}"
        return ONEDRIVE / target, f"entity {entity}"

    return DOWNLOADS / purpose_bucket(name, ext), "no entity — by purpose"


def census(roots):
    """How many files each entity will end up owning — incoming plus whatever
    its destination already holds. Subdivision is decided on the final size, not
    on this run's share of it, or a folder gets split twice on two runs."""
    tally = defaultdict(int)
    for root in roots:
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d.lower() not in org.SKIP_DIRS]
            for filename in filenames:
                entity = parse_entity(filename)
                if entity:
                    tally[entity] += 1
    resolved = [r.resolve() for r in roots if r.is_dir()]
    for entity, relative in DEST.items():
        home = ONEDRIVE / relative
        if not home.is_dir():
            continue
        # Skip a home the walk above already counted, or it is tallied twice and
        # an 11-file client crosses a 20-file threshold on its own contents.
        here = home.resolve()
        if any(here == r or r in here.parents for r in resolved):
            continue
        tally[entity] += sum(1 for _ in home.rglob("*") if _.is_file())
    return {e for e, n in tally.items()
            if n >= SUBDIVIDE_AT and e in SUBDIVIDABLE}


def disambiguate(moves):
    """When several files would land on one name, fold each one's source folder
    into its descriptor — every member of the group, not just the losers.

    Suffixing only the collisions is what a filesystem does, and it is the wrong
    answer: fourteen distinct Absara mockups were each called `absara-code.html`
    inside fourteen differently-named folders. Dissolving those folders deleted
    the only distinguishing information, and `-2 … -14` put back uniqueness
    without putting back meaning. The folder name was the meaning.
    """
    groups = defaultdict(list)
    for move in moves:
        groups[move["dst"].lower()].append(move)

    for members in groups.values():
        if len(members) < 2:
            continue
        for move in members:
            folder = org.slugify(Path(move["src"]).parent.name)
            destination = Path(move["dst"])
            stem, dot, ext = destination.name.partition(".")
            if not folder or folder in stem:
                continue
            candidate = f"{stem}-{folder}{dot}{ext}"
            if org.name_is_legal(candidate):
                move["dst"] = str(destination.parent / candidate)
                move["reason"] += " (+folder, name clash)"


def build(roots, dissolve_all=False):
    """`dissolve_all` treats every subdirectory as re-fileable. Off by default,
    because in Downloads a hand-named folder is a decision worth keeping; on
    when re-shaping a zone whose folders were never chosen deliberately."""
    moves, skipped = [], []
    counts = defaultdict(int)
    big_entities = census(roots)

    for root in roots:
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            here = Path(dirpath)
            dirnames[:] = [d for d in dirnames
                           if d.lower() not in org.SKIP_DIRS
                           and not (here / d).is_symlink()]
            # Only the extension-keyed folders P2 built are dissolved. A folder
            # somebody named on purpose keeps its contents.
            relative = here.relative_to(root)
            top = relative.parts[0].lower() if relative.parts else ""
            if top and not dissolve_all and top not in TYPE_DIRS:
                dirnames[:] = []
                continue

            for filename in filenames:
                source = here / filename
                try:
                    info = source.stat()
                except OSError:
                    continue
                if org.is_placeholder(info):
                    skipped.append({"path": str(source), "why": "cloud-only placeholder"})
                    continue

                destination, reason = classify(source, info.st_size, big_entities)
                if destination is None:
                    skipped.append({"path": str(source), "why": reason})
                    counts[f"skip:{reason}"] += 1
                    continue
                if destination.resolve() == here.resolve():
                    continue

                moves.append({
                    "src": str(source),
                    "dst": str(destination / filename),
                    "size": info.st_size,
                    "mtime_ns": info.st_mtime_ns,
                    "reason": reason,
                })
                counts[reason] += 1

    disambiguate(moves)

    return {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "roots": [str(r) for r in roots],
        "counts": dict(sorted(counts.items())),
        "subdivided": sorted(big_entities),
        "totals": {"moves": len(moves), "skipped": len(skipped),
                   "bytes": sum(m["size"] for m in moves)},
        "moves": moves,
        "skipped": skipped,
    }


def apply_plan(plan, do_apply):
    results = {"ok": 0, "stale": 0, "missing": 0, "collided": 0, "failed": 0}
    journal = None
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    journal_path = HOME / ".local" / "organize" / f"route-{stamp}.ndjson"

    if do_apply:
        journal_path.parent.mkdir(parents=True, exist_ok=True)
        journal = org.Journal(journal_path)
        journal.write({"type": "header", "tool_version": 1, "kind": "route",
                       "roots": plan["roots"],
                       "started": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                       "ops_planned": len(plan["moves"])})

    taken = set()
    try:
        for move in plan["moves"]:
            source, destination = move["src"], Path(move["dst"])
            if org.under_frozen_zone(source):
                raise SystemExit(f"REFUSED: {source} is under the rename-frozen code zone.")
            if not os.path.exists(source):
                results["missing"] += 1
                continue
            info = os.stat(source)
            if info.st_size != move["size"] or info.st_mtime_ns != move["mtime_ns"]:
                results["stale"] += 1
                continue

            final = org.resolve_collision(destination.parent, destination.name,
                                          taken, src=source)
            if final != destination.name:
                # A collision during a dissolve means the containing folder was
                # the only thing telling these files apart — fourteen mockups all
                # named `absara-code.html` sat in fourteen folders. A `-2` suffix
                # would keep them distinct on disk and identical to a reader, so
                # fold the folder name into the descriptor instead.
                folder = org.slugify(Path(source).parent.name)
                stem, dot, ext = destination.name.partition(".")
                if folder and folder not in stem:
                    candidate = f"{stem}-{folder}{dot}{ext}"
                    if org.name_is_legal(candidate):
                        final = org.resolve_collision(destination.parent, candidate,
                                                      taken, src=source)
                results["collided"] += 1
            target = destination.parent / final
            taken.add(str(target).lower())

            if not do_apply:
                results["ok"] += 1
                continue

            destination.parent.mkdir(parents=True, exist_ok=True)
            try:
                org._safe_rename(source, str(target))
            except OSError as exc:
                results["failed"] += 1
                journal.write({"type": "op", "op": "rename", "src": source,
                               "dst": str(target), "status": "failed", "error": str(exc)})
                continue
            results["ok"] += 1
            journal.write({"type": "op", "op": "rename", "src": source,
                           "dst": str(target), "size": move["size"],
                           "mtime_ns": move["mtime_ns"], "reason": move["reason"],
                           "status": "ok"})
    finally:
        if journal:
            journal.close()

    return results, (str(journal_path) if do_apply else None)


def datefold(root, do_apply):
    """Group a folder into {YYYY}/{YYYY-MM}/ without renaming anything.

    This is the Pictures rule, and it is deliberately not the Downloads rule.
    `Screenshot 2025-10-23 131928.png` already carries its date in sortable
    form, so renaming it to `20251023-misc-screenshot-131928.png` moves the
    same information around for no gain — and in OneDrive every rename is a
    re-upload (§6.2), so 1,058 of them cost real bandwidth to change nothing a
    reader cares about. The folder supplies the grouping; the name already
    supplies the moment.
    """
    moves = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or org.is_protected_file(path.name):
            continue
        if any(part.lower() in org.SKIP_DIRS for part in path.relative_to(root).parts):
            continue
        stamp, _, _ = org.extract_date(path.stem)
        if not stamp:
            stamp = datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y%m%d")
        year, month = stamp[:4], f"{stamp[:4]}-{stamp[4:6]}"
        target = root / year / month / path.name
        if target.resolve() == path.resolve():
            continue
        info = path.stat()
        moves.append({"src": str(path), "dst": str(target), "size": info.st_size,
                      "mtime_ns": info.st_mtime_ns, "reason": f"date {month}"})

    plan = {"roots": [str(root)], "moves": moves,
            "counts": {}, "totals": {"moves": len(moves), "skipped": 0,
                                     "bytes": sum(m["size"] for m in moves)},
            "skipped": []}
    return apply_plan(plan, do_apply), plan


def cmd_datefold(args):
    root = Path(args.root).expanduser()
    if not root.is_dir():
        raise SystemExit(f"not a directory: {root}")
    (results, journal), plan = datefold(root, args.apply)
    buckets = defaultdict(int)
    for move in plan["moves"]:
        buckets[Path(move["dst"]).parent.name] += 1
    mode = "APPLIED" if args.apply else "dry-run"
    print(f"{mode}: " + "  ".join(f"{k}={v}" for k, v in results.items()))
    for bucket in sorted(buckets):
        print(f"  {buckets[bucket]:>5}  {bucket}")
    if journal:
        print(f"undo: python organize.py undo \"{journal}\" --apply")


def cmd_plan(args):
    roots = [Path(r).expanduser() for r in args.root] if args.root else [DOWNLOADS]
    plan = build(roots, args.dissolve_all)
    Path(args.out).write_text(json.dumps(plan, indent=2, ensure_ascii=False),
                              encoding="utf-8")
    print(f"plan: {args.out}")
    print(f"  moves   {plan['totals']['moves']:>6}"
          f"  ({plan['totals']['bytes'] / 1048576:.1f} MB)")
    print(f"  skipped {plan['totals']['skipped']:>6}")
    for reason, count in plan["counts"].items():
        print(f"    {count:>5}  {reason}")


def cmd_apply(args):
    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    results, journal = apply_plan(plan, args.apply)
    mode = "APPLIED" if args.apply else "dry-run"
    print(f"{mode}: " + "  ".join(f"{k}={v}" for k, v in results.items()))
    if journal:
        print(f"undo: python organize.py undo \"{journal}\" --apply")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("plan", help="compute moves (read-only)")
    p.add_argument("--root", action="append", help="root to route (default: Downloads)")
    p.add_argument("--out", default="route-plan.json")
    p.add_argument("--dissolve-all", action="store_true",
                   help="re-file inside every subdirectory, not just the "
                        "extension-keyed ones")
    p.set_defaults(func=cmd_plan)

    d = sub.add_parser("datefold", help="group a folder into YYYY/YYYY-MM (no renaming)")
    d.add_argument("--root", required=True)
    d.add_argument("--apply", action="store_true", help="actually move (default: dry-run)")
    d.set_defaults(func=cmd_datefold)

    a = sub.add_parser("apply", help="execute a plan")
    a.add_argument("plan")
    a.add_argument("--apply", action="store_true", help="actually move (default: dry-run)")
    a.set_defaults(func=cmd_apply)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
