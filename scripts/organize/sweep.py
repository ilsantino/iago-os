"""P6 — sweep: the scheduled job that stops all of this rotting.

P1–P5 were a one-off cleanup. Twelve loose files landed in Downloads within
twenty-four hours of P5 closing, which is the whole argument for this file: a
convention nobody enforces is a convention that lasts about a day.

The sweep runs unattended, so the split between what it DOES and what it
REPORTS is the entire design:

  acts    renames at high/medium confidence, and routes files whose entity the
          nomenclature already records. Both are reversible through a journal,
          and both are decisions the tooling can make from evidence in the
          filename.

  reports low-confidence renames, regenerable installers old enough to drop,
          and conformance drift per zone. These need a human, and a job that
          quietly guessed at them would be worse than no job at all.

It never deletes. Aged installers are *listed*; quarantining them stays a
separate, explicit `reclaim.py` run. The one thing a scheduled task must never
do is destroy something while nobody is watching.

Usage:
  python sweep.py                  # dry-run: report only, change nothing
  python sweep.py --apply          # act on the safe half, report the rest
  python sweep.py --install-task   # register with Windows Task Scheduler
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import organize as org                                              # noqa: E402
import route                                                        # noqa: E402

HERE = Path(__file__).resolve().parent
LOG_DIR = Path.home() / ".local" / "organize"
REPORT = LOG_DIR / "sweep-latest.md"
HISTORY = LOG_DIR / "sweep-history.ndjson"

# Zones the sweep is allowed to act in. `downloads` is the staging area and the
# only one that accumulates; the OneDrive zones are linted for drift but not
# swept, because a rename there is a re-upload (§6.2 of the standard).
ACT_ZONES = ["downloads"]
LINT_ZONES = ["downloads", "od-personal", "od-iago", "od-din", "od-pictures"]

# §5 of the standard: installers and already-extracted archives go at 30 days.
# Reported, never acted on — see the module docstring.
STALE_INSTALLER_DAYS = 30
INSTALLER_EXT = {".exe", ".msi", ".dmg", ".pkg", ".appinstaller"}

TASK_NAME = "iaGO File Sweep"


def run_scan(root, out_path):
    """organize.py scan, as a subprocess so its own guards and refusals apply.

    Passes `--root` rather than `--zone`: a subprocess re-imports organize.py
    and reads its own ZONES table, so a zone NAME cannot be redirected by the
    caller. That indirection made the sweep untestable, and untestable is what
    hid a real bug — the scan was silently reporting on the live Downloads
    while the rest of the sweep worked on somewhere else entirely, so the
    review list came back empty and nothing was ever held back.
    """
    result = subprocess.run(
        [sys.executable, str(HERE / "organize.py"), "scan", "--root", str(root),
         "--out", str(out_path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    return result.returncode == 0, (result.stdout or "") + (result.stderr or "")


def split_by_confidence(plan_path):
    """Separate what the sweep may apply from what a human must look at."""
    plan = json.loads(Path(plan_path).read_text(encoding="utf-8"))
    safe = [op for op in plan["ops"] if op.get("confidence") in (None, "high", "medium")]
    review = [op for op in plan["ops"] if op.get("confidence") == "low"]
    return plan, safe, review


def apply_safe_renames(plan, safe, plan_path, do_apply):
    """Write a plan holding only the safe ops, then hand it to organize.py."""
    if not safe:
        return {"ok": 0}, []
    trimmed = dict(plan, ops=safe)
    trimmed_path = Path(str(plan_path).replace(".json", "-safe.json"))
    trimmed_path.write_text(json.dumps(trimmed, indent=2, ensure_ascii=False),
                            encoding="utf-8")
    argv = [sys.executable, str(HERE / "organize.py"), "apply", str(trimmed_path)]
    if do_apply:
        argv.append("--apply")
    result = subprocess.run(argv, capture_output=True, text=True,
                            encoding="utf-8", errors="replace",
                            env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    return {"ok": len(safe)}, (result.stdout or "").splitlines()[-2:]


def stale_installers():
    """Regenerable installers past the retention window. Listed, not touched."""
    cutoff = datetime.now() - timedelta(days=STALE_INSTALLER_DAYS)
    found = []
    for zone in ACT_ZONES:
        root = org.ZONES[zone]
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in INSTALLER_EXT:
                continue
            try:
                info = path.stat()
            except OSError:
                continue
            if org.is_placeholder(info):
                continue
            if datetime.fromtimestamp(info.st_mtime) < cutoff:
                found.append({"path": str(path), "mb": info.st_size / 1048576,
                              "age_days": (datetime.now() -
                                           datetime.fromtimestamp(info.st_mtime)).days})
    return sorted(found, key=lambda e: -e["mb"])


def lint(root):
    result = subprocess.run(
        [sys.executable, str(HERE / "organize.py"), "lint", "--root", str(root)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    # `1,061/1,061` — organize.py prints thousands separators, so a bare int()
    # raised and the old handler swallowed it, reporting a healthy zone as 0/0.
    # A parse failure must be loud: it returns None, and the report says so.
    match = re.search(r"conforming\s+([\d,]+)/([\d,]+)", result.stdout or "")
    if not match:
        return None, None
    return int(match.group(1).replace(",", "")), int(match.group(2).replace(",", ""))


def sweep(do_apply):
    started = datetime.now(timezone.utc)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    renamed, review, routed = 0, [], 0

    for zone in ACT_ZONES:
        plan_path = LOG_DIR / f"sweep-{zone}.json"
        ok, output = run_scan(org.ZONES[zone], plan_path)
        if not ok:
            review.append({"src": f"[scan failed: {zone}]", "dst": output[-400:]})
            continue
        plan, safe, low = split_by_confidence(plan_path)
        results, _ = apply_safe_renames(plan, safe, plan_path, do_apply)
        renamed += results["ok"]
        review.extend(low)

    # Routing runs after renaming, because route.py reads the entity out of the
    # filename that the rename step just corrected.
    route_plan = route.build([org.ZONES[z] for z in ACT_ZONES])

    # ...but never route a file the sweep refused to rename. Filing it away
    # under a name the tool could not justify buries it in a tidy folder where
    # nobody will look, and quietly drops the zone's conformance. A file that
    # needs a human stays where a human will trip over it.
    held = {op["src"] for op in review}
    if held:
        deferred = [m for m in route_plan["moves"] if m["src"] in held]
        route_plan["moves"] = [m for m in route_plan["moves"] if m["src"] not in held]
        if deferred:
            route_plan["held_for_review"] = len(deferred)

    if route_plan["moves"]:
        results, _ = route.apply_plan(route_plan, do_apply)
        routed = results["ok"]

    installers = stale_installers()
    conformance = {zone: lint(org.ZONES[zone]) for zone in LINT_ZONES}

    record = {
        "ran": started.isoformat(timespec="seconds"),
        "mode": "apply" if do_apply else "dry-run",
        "renamed": renamed,
        "routed": routed,
        "needs_review": len(review),
        "stale_installers": len(installers),
        "conformance": {z: (f"{c}/{t}" if c is not None else "unreadable")
                        for z, (c, t) in conformance.items()},
    }
    with HISTORY.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())

    write_report(record, review, installers, conformance)
    return record, review, installers


def write_report(record, review, installers, conformance):
    lines = [
        f"# File sweep — {record['ran'][:16].replace('T', ' ')} UTC",
        "",
        f"Mode: **{record['mode']}**",
        "",
        "## Acted",
        "",
        f"- renamed to standard: **{record['renamed']}**",
        f"- routed to their folder: **{record['routed']}**",
        "",
        "## Conformance",
        "",
        "| zone | conforming |",
        "|---|---|",
    ]
    for zone, (conforming, total) in conformance.items():
        if conforming is None:
            lines.append(f"| `{zone}` | **could not read lint output** ⚠ |")
            continue
        pct = f"{100.0 * conforming / total:.1f}%" if total else "—"
        flag = "" if total and conforming == total else "  ⚠"
        lines.append(f"| `{zone}` | {conforming:,}/{total:,} ({pct}){flag} |")

    lines += ["", "## Needs a human", ""]
    if review:
        lines.append(f"**{len(review)} low-confidence name(s)** — the tool has a guess "
                     "but not enough evidence. Run `organize.py scan --zone downloads` "
                     "and apply by hand, or add a hint.")
        lines.append("")
        for op in review[:20]:
            lines.append(f"- `{Path(op['src']).name}` → `{Path(op['dst']).name}`")
        if len(review) > 20:
            lines.append(f"- …and {len(review) - 20} more")
    else:
        lines.append("Nothing. Every file the sweep saw had enough evidence to name itself.")

    lines += ["", "## Regenerable installers past retention", ""]
    if installers:
        total_mb = sum(e["mb"] for e in installers)
        lines.append(f"**{len(installers)} file(s), {total_mb:.0f} MB**, older than "
                     f"{STALE_INSTALLER_DAYS} days. The sweep never deletes — quarantine "
                     "them deliberately:")
        lines.append("")
        lines.append("```")
        lines.append("python reclaim.py scan --zone downloads --out plan.json")
        lines.append("python reclaim.py apply plan.json --apply")
        lines.append("```")
        lines.append("")
        for entry in installers[:15]:
            lines.append(f"- {entry['mb']:.0f} MB · {entry['age_days']}d · "
                         f"`{Path(entry['path']).name}`")
    else:
        lines.append("None.")

    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")


# `schtasks /Create` sets DisallowStartIfOnBatteries and StopIfGoingOnBatteries
# to true and StartWhenAvailable to false. On a Surface that is normally on
# battery this means the job effectively never runs: the first real unattended
# run, on 2026-08-20, returned 0x800710E0 ("the operator or administrator has
# refused the request") and wrote no history line at all. A scheduled task that
# silently declines is worse than no task, because the report it never writes
# reads exactly like a clean machine. These flags are not reachable through
# schtasks, so the install corrects them afterwards and fails loudly if it
# cannot.
POWER_FIX = (
    "$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries "
    "-DontStopIfGoingOnBatteries -StartWhenAvailable "
    "-ExecutionTimeLimit (New-TimeSpan -Hours 2); "
    "Set-ScheduledTask -TaskName '{name}' -Settings $s | Out-Null; "
    "$t = Get-ScheduledTask -TaskName '{name}'; "
    "if ($t.Settings.DisallowStartIfOnBatteries) {{ exit 1 }}"
)


def install_task():
    """Register a daily run with Windows Task Scheduler.

    `schtasks` is used rather than a PowerShell scheduled-job because it needs
    no elevation for a per-user task, which keeps this a thing Santiago can
    install and inspect himself.
    """
    command = f'"{sys.executable}" "{HERE / "sweep.py"}" --apply'
    argv = ["schtasks", "/Create", "/TN", TASK_NAME, "/TR", command,
            "/SC", "DAILY", "/ST", "09:00", "/F"]
    result = subprocess.run(argv, capture_output=True, text=True,
                            encoding="utf-8", errors="replace")
    print((result.stdout or "").strip() or (result.stderr or "").strip())
    if result.returncode != 0:
        return result.returncode

    fix = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command",
         POWER_FIX.format(name=TASK_NAME)],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    if fix.returncode != 0:
        print("\nREFUSED TO CLAIM SUCCESS: the task was created but still declines "
              "to start on battery, so it will not actually run.")
        print((fix.stdout or "").strip() or (fix.stderr or "").strip())
        print(f"fix by hand:  Set-ScheduledTask -TaskName \"{TASK_NAME}\" -Settings "
              "(New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries "
              "-DontStopIfGoingOnBatteries -StartWhenAvailable)")
        return 1

    print(f"\nregistered: {TASK_NAME} — daily 09:00, runs on battery")
    print(f"report:     {REPORT}")
    print(f"remove:     schtasks /Delete /TN \"{TASK_NAME}\" /F")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--apply", action="store_true",
                        help="act on the safe half (default: report only)")
    parser.add_argument("--install-task", action="store_true",
                        help="register the daily scheduled run")
    args = parser.parse_args()

    if args.install_task:
        sys.exit(install_task())

    record, review, installers = sweep(args.apply)
    print(f"{record['mode']}: renamed={record['renamed']} routed={record['routed']} "
          f"review={len(review)} stale_installers={len(installers)}")
    for zone, value in record["conformance"].items():
        print(f"  {zone:<14} {value}")
    print(f"\nreport: {REPORT}")


if __name__ == "__main__":
    main()
