"""Emit reusable-pattern signals from a session transcript at session end.

Called by the Stop hook (async). DETERMINISTIC — no LLM call. This is the 60%
layer of the recurrence-harvester (see brain/patterns/ + layer-triage.md):
it makes each session queryable by "engineering-pattern signal" so a later
AI harvest step (/pattern-harvest skill) can detect the same execution shape
recurring across 3+ sessions or across 2+ distinct projects/clients — the
threshold at which the vault promotes a shape into brain/patterns/.

It does NOT decide anything. It appends/updates one NDJSON record per session
in the harvest queue. All judgment (promote? bump? draft the pattern node?)
happens in the AI layer that reads this queue.

Modes:
  python session-pattern-signals.py              # live: index THIS session
  python session-pattern-signals.py --backfill   # index every transcript once

Env overrides (for testing / relocation):
  PATTERN_QUEUE_PATH     default: ~/.claude/state/pattern-harvest-queue.ndjson
  PATTERN_PROJECTS_DIR   default: ~/.claude/projects
"""

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from lib_transcript import (
    iter_assistant_blocks,
    iter_transcripts,
    parse_project_name,
    resolve_transcript,
)

QUEUE_PATH = Path(
    os.environ.get(
        "PATTERN_QUEUE_PATH",
        str(Path.home() / ".claude" / "state" / "pattern-harvest-queue.ndjson"),
    )
)

# Skip pathological transcripts (bytes). Signal matching over a few MB is cheap;
# beyond this a single file is almost certainly a runaway log, not a session.
MAX_TRANSCRIPT_BYTES = 40 * 1024 * 1024

# A signal counts only if it appears at least this many times in the session's
# ACTION text (assistant prose + tool inputs). A single passing mention is not
# "worked on it" — this is what stops the injected CLAUDE.md / rules / MEMORY
# boilerplate (which names every pattern once) from tagging every session.
MIN_SIGNAL_HITS = int(os.environ.get("PATTERN_MIN_HITS", "3"))

# Engineering-pattern signal dictionary. keyword/regex (case-insensitive) -> signal slug.
# This is deliberately extensible: adding a row here is how you teach the harvester
# to notice a new recurring shape. Slugs are kebab-case and should read like a
# brain/patterns/ filename ({verb}-{noun}) so the AI layer can map signal -> node.
SIGNALS = {
    "dual-adversarial-review": r"dual[\s-]?adversarial|codex.{0,20}opus|opus.{0,20}codex",
    "accepted-residual-gate": r"accepted[\s-]?residual|gate never (?:goes|reports) clean|non-accepted (?:findings? )?fixed",
    "workflow-journal-recovery": r"journal\.jsonl|journal recovery|recover(?:ed)? .{0,20}journal",
    "thinking-block-400": r"thinking[\s-]?block|400 .{0,20}thinking|thinking.{0,20}cannot be modified",
    "worktree-per-session": r"worktree",
    "format-hook-breakage": r"format[\s-]?hook|biome hook|useconst|let\W+const flip",
    "stacked-prs": r"stack(?:ed)?[\s-]?pr|one pr at the end|stack commits",
    "pr-split-per-chunk": r"pr[\s-]?split|per-chunk pr|split into (?:separate )?prs",
    "destructive-confirm-ux": r"type[\s-]?to[\s-]?confirm|hard[\s-]?delete|cascade delete|multi-select delete",
    "preview-mode-auth-bypass": r"preview[\s-]?mode|vite_preview_role|auth bypass",
    "optimistic-locking": r"optimistic lock|conditional write|attribute_not_exists|conditionalcheckfailed",
    "idempotency-guard": r"idempoten",
    "hmac-signing": r"hmac|signing secret|offline (?:qr|scanner)",
    "skeleton-first-persistence": r"skeleton[\s-]?first|write .{0,15}report .{0,10}first",
    "fix-dont-paste": r"fix[\s-]?don.?t[\s-]?paste|drive fixes via subagent",
    "diagnose-before-fix": r"diagnose before fix|reproduce.{0,20}isolate|4-phase debug",
    "design-pass-ux": r"design[\s-]?pass|design[\s-]?first",
    "basic-auth-gate": r"basic[\s-]?auth (?:gate|gating)|--no-enable-basic-auth",
    "security-pentest": r"pentest|\bidor\b|broken auth(?:z|orization)|forgeable token|app_debug",
    "acceptance-evidence": r"evidence checker|acceptance evidence|evidence template|phase-2 evidence",
    "dynamodb-single-table": r"single[\s-]?table|pk.{0,5}sk|gsi\d",
    "codex-rescue": r"codex[\s:-]?rescue|cross-model second opinion",
    "stress-test-plan": r"stress[\s-]?test",
    "sync-before-work": r"pull main first|sync before|fetch .{0,15}before (?:pr|work|recon)|git fetch --prune",
    "config-protection-bypass": r"config[\s-]?protection|protected config|shell redirect.{0,20}hook",
    "windows-node-tooling": r"bash.{0,20}not on .{0,10}path|use node for hook|taskkill /t",
}

_COMPILED = [(slug, re.compile(pat, re.IGNORECASE)) for slug, pat in SIGNALS.items()]


def extract_action_text(path):
    """Extract only what the session DID: assistant-authored text + tool inputs.

    Deliberately EXCLUDES system prompts, user turns, attachments, and
    tool_result dumps — those carry the injected CLAUDE.md / rules / MEMORY
    boilerplate (which names every pattern) and file-read output, which would
    make every session match every signal. Also excludes assistant `thinking`
    (tangential deliberation) to keep the signal to real work.
    Returns lowercased action text, or '' on failure.
    """
    try:
        if Path(path).stat().st_size > MAX_TRANSCRIPT_BYTES:
            return ""
    except OSError:
        return ""

    parts = []
    for btype, block in iter_assistant_blocks(path):
        if btype == "text":
            parts.append(block.get("text", ""))
        elif btype == "tool_use":
            inp = block.get("input", {})
            if isinstance(inp, dict):
                # serialize the string-bearing fields (command, file_path,
                # prompt, description, args, plan text, ...) — the concrete
                # evidence of what the session operated on.
                parts.append(json.dumps(inp, ensure_ascii=False))
    return "\n".join(parts).lower()


def detect_signals(text):
    """Signals whose regex matches >= MIN_SIGNAL_HITS times in the action text."""
    found = []
    for slug, rx in _COMPILED:
        if len(rx.findall(text)) >= MIN_SIGNAL_HITS:
            found.append(slug)
    return sorted(found)


def build_record(transcript_path):
    """Build a queue record for one transcript, or None if no signals."""
    text = extract_action_text(transcript_path)
    if not text:
        return None
    signals = detect_signals(text)
    if not signals:
        return None
    try:
        mtime = Path(transcript_path).stat().st_mtime
        date = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d")
    except OSError:
        date = datetime.now().strftime("%Y-%m-%d")
    return {
        "session_id": Path(transcript_path).stem,
        "date": date,
        "project": parse_project_name(transcript_path),
        "signals": signals,
        "transcript": str(transcript_path),
    }


def load_queue():
    """Load the queue as a dict keyed by session_id (upsert semantics)."""
    records = {}
    if not QUEUE_PATH.exists():
        return records
    for line in QUEUE_PATH.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            continue
        sid = rec.get("session_id")
        if sid:
            records[sid] = rec
    return records


def write_queue(records):
    """Rewrite the queue file from the records dict, sorted by date then project."""
    QUEUE_PATH.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(records.values(), key=lambda r: (r.get("date", ""), r.get("project", "")))
    body = "\n".join(json.dumps(r, ensure_ascii=False) for r in ordered)
    QUEUE_PATH.write_text(body + ("\n" if body else ""), encoding="utf-8")


def run_backfill():
    records = load_queue()
    added = 0
    for f in iter_transcripts():
        rec = build_record(f)
        if rec:
            records[rec["session_id"]] = rec
            added += 1
    write_queue(records)
    print(f"pattern-signals backfill: {added} sessions indexed, {len(records)} in queue", file=sys.stderr)


def run_live():
    t = resolve_transcript()
    if not t:
        return
    rec = build_record(t)
    if not rec:
        return
    records = load_queue()
    records[rec["session_id"]] = rec  # upsert — later turns in a session refresh signals
    write_queue(records)
    print(f"pattern-signals: {rec['project']} -> {', '.join(rec['signals'])}", file=sys.stderr)


def main():
    if "--backfill" in sys.argv or "--all" in sys.argv:
        run_backfill()
    else:
        run_live()


if __name__ == "__main__":
    main()
