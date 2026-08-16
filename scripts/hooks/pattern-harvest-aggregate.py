"""Aggregate the pattern-harvest queue into promotion candidates.

DETERMINISTIC — no LLM, no vault access (the 30% rule-based layer). Reads the
NDJSON queue emitted by session-pattern-signals.py and groups by signal to find
execution shapes that recur enough to earn a brain/patterns/ node.

Promotion rule (mirrors brain/patterns/CONTEXT.md): a signal is a candidate when
it recurs across >=3 sessions OR appears in >=2 distinct projects/clients. The
second trigger is the "did I solve the same problem for two different clients?"
question — the whole point of the harvester.

Emits JSON to stdout: { generated, total_sessions, candidates: [...] }. The
/pattern-harvest skill (the 10% AI layer) reads this, checks which candidates
already have a pattern node, and drafts or bumps the node.

Env override:
  PATTERN_QUEUE_PATH   default: ~/.claude/state/pattern-harvest-queue.ndjson
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

QUEUE_PATH = Path(
    os.environ.get(
        "PATTERN_QUEUE_PATH",
        str(Path.home() / ".claude" / "state" / "pattern-harvest-queue.ndjson"),
    )
)

MIN_SESSIONS = 3          # recurs across 3+ sessions (vault hub rule)
MIN_DISTINCT_PROJECTS = 2  # OR appears in 2+ distinct projects/clients


def load_records():
    if not QUEUE_PATH.exists():
        return []
    out = []
    for line in QUEUE_PATH.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except (json.JSONDecodeError, ValueError):
            continue
    return out


def fold_project(name):
    """Fold a worktree checkout back onto its parent project.

    Legacy records were written before the emitter folded these, and their
    transcripts are long deleted, so they cannot be re-derived — normalising on
    read is the only way `iago-os` and `iago-os--worktrees-x` stop counting as
    two distinct clients and falsely satisfying the cross-client threshold.
    """
    name = name or "unknown"
    return name.split("--worktrees-")[0] or "unknown"


def aggregate(records):
    by_signal = {}
    for rec in records:
        project = fold_project(rec.get("project"))
        for slug in rec.get("signals", []):
            agg = by_signal.setdefault(
                slug, {"signal": slug, "sessions": [], "projects": {}}
            )
            agg["sessions"].append(
                {"session_id": rec.get("session_id"), "date": rec.get("date"), "project": project}
            )
            agg["projects"].setdefault(project, 0)
            agg["projects"][project] += 1

    candidates = []
    for slug, agg in by_signal.items():
        distinct_projects = sorted(agg["projects"].keys())
        n_sessions = len(agg["sessions"])
        meets_recurrence = n_sessions >= MIN_SESSIONS
        meets_cross_client = len(distinct_projects) >= MIN_DISTINCT_PROJECTS
        if not (meets_recurrence or meets_cross_client):
            continue
        latest = max((s.get("date") or "" for s in agg["sessions"]), default="")
        candidates.append(
            {
                "signal": slug,
                "n_sessions": n_sessions,
                "distinct_projects": distinct_projects,
                "n_distinct_projects": len(distinct_projects),
                "meets_recurrence": meets_recurrence,
                "meets_cross_client": meets_cross_client,
                "latest_date": latest,
                "sessions": sorted(agg["sessions"], key=lambda s: s.get("date") or ""),
            }
        )

    # Rank: cross-client first, then breadth of projects, then session count, then recency.
    candidates.sort(
        key=lambda c: (
            c["meets_cross_client"],
            c["n_distinct_projects"],
            c["n_sessions"],
            c["latest_date"],
        ),
        reverse=True,
    )
    return candidates


def main():
    records = load_records()
    candidates = aggregate(records)
    report = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "queue_path": str(QUEUE_PATH),
        "total_sessions": len(records),
        "n_candidates": len(candidates),
        "candidates": candidates,
    }
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
