"""Self-contained test for the pattern-harvester (emitter + aggregator).

No pytest / no deps. Run:  python test-pattern-harvest.py
Exit 0 = pass. Uses a temp projects dir + temp queue via env overrides, so it
never touches the real ~/.claude/projects or the real queue.
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
EMITTER = HERE / "session-pattern-signals.py"
AGGREGATOR = HERE / "pattern-harvest-aggregate.py"

FAILURES = []


def check(cond, msg):
    if cond:
        print(f"  ok  - {msg}")
    else:
        print(f"  FAIL - {msg}")
        FAILURES.append(msg)


def fake_transcript(dir_path, name, texts, tool_inputs=None, noise=True):
    """Write a JSONL transcript in the real schema: assistant message.content blocks.

    `texts` -> assistant text blocks. `tool_inputs` -> assistant tool_use inputs.
    If `noise`, append a USER turn + attachment naming several signals ONCE each —
    these MUST be ignored (they model injected CLAUDE.md / rules boilerplate).
    """
    dir_path.mkdir(parents=True, exist_ok=True)
    f = dir_path / f"{name}.jsonl"
    entries = []
    for t in texts:
        entries.append({"type": "assistant", "message": {"content": [{"type": "text", "text": t}]}})
    for inp in (tool_inputs or []):
        entries.append({"type": "assistant",
                        "message": {"content": [{"type": "tool_use", "name": "Bash", "input": inp}]}})
    if noise:
        boiler = "iaGO rules: worktree-per-session, stress-test the plan, /codex:rescue, dual-adversarial gate, optimistic lock, hmac signing"
        entries.append({"type": "user", "message": {"content": [{"type": "text", "text": boiler}]}})
        entries.append({"type": "user", "message": {"content": [{"type": "tool_result", "content": boiler}]}})
        entries.append({"type": "attachment", "text": boiler})
    f.write_text("\n".join(json.dumps(e) for e in entries), encoding="utf-8")
    return f


def main():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        projects = tmp / "projects"
        queue = tmp / "queue.ndjson"
        env = dict(os.environ)
        env["PATTERN_PROJECTS_DIR"] = str(projects)
        env["PATTERN_QUEUE_PATH"] = str(queue)

        # Two DIFFERENT projects/clients that both hit the accepted-residual shape
        # (each signal repeated >= MIN_SIGNAL_HITS=3 in assistant text), plus a
        # third project with an unrelated single signal. Every session also carries
        # boilerplate noise naming worktree/stress/codex/hmac ONCE in NON-assistant
        # turns — those must never be tagged.
        fake_transcript(
            projects / "C--Users-sanal-dev-iago-os-clients-sentria",
            "sess-sentria-1",
            ["We hit the accepted-residual gate again on PR #241.",
             "The accepted-residual finding re-surfaces; the gate never goes clean.",
             "Stop at non-accepted findings fixed — accepted-residual is by design.",
             "Ran a dual-adversarial review (opus + codex).",
             "The dual-adversarial gate flagged it once more.",
             "Re-ran dual-adversarial after the fix."],
        )
        fake_transcript(
            projects / "C--Users-sanal-dev-iago-os",
            "sess-iago-1",
            ["Recovered state from subagents/workflows/wf/journal.jsonl after the crash.",
             "The journal.jsonl file held the lost verdict.",
             "Parsed journal.jsonl once more to continue.",
             "The dual-adversarial gate flagged an accepted-residual finding.",
             "dual-adversarial re-run: accepted-residual persists by design.",
             "accepted-residual is a permanent Important; dual-adversarial can't go clean."],
        )
        fake_transcript(
            projects / "C--Users-sanal-dev-munet-web",
            "sess-munet-1",
            ["Used an optimistic lock on the ticket write.",
             "Guarded it with attribute_not_exists (optimistic lock).",
             "ConditionalCheckFailed -> optimistic lock retry path."],
        )

        # --- backfill ---
        r = subprocess.run([sys.executable, str(EMITTER), "--backfill"],
                           env=env, capture_output=True, text=True)
        check(r.returncode == 0, f"emitter backfill exits 0 (got {r.returncode}; stderr={r.stderr.strip()})")
        check(queue.exists(), "queue file created")

        recs = [json.loads(l) for l in queue.read_text(encoding="utf-8").splitlines() if l.strip()]
        by_id = {x["session_id"]: x for x in recs}
        check(len(recs) == 3, f"3 sessions indexed (got {len(recs)})")
        check("accepted-residual-gate" in by_id.get("sess-sentria-1", {}).get("signals", []),
              "sentria session tagged accepted-residual-gate")
        check("dual-adversarial-review" in by_id.get("sess-iago-1", {}).get("signals", []),
              "iago session tagged dual-adversarial-review")
        check("workflow-journal-recovery" in by_id.get("sess-iago-1", {}).get("signals", []),
              "iago session tagged workflow-journal-recovery")
        check("optimistic-locking" in by_id.get("sess-munet-1", {}).get("signals", []),
              "munet session tagged optimistic-locking")

        # REGRESSION (the 129-for-everything bug): signals that appear ONLY in the
        # boilerplate noise of NON-assistant turns must NOT tag any session.
        all_signals = {s for r in recs for s in r.get("signals", [])}
        check("worktree-per-session" not in all_signals,
              "boilerplate-only 'worktree' NOT matched (non-assistant turns excluded)")
        check("codex-rescue" not in all_signals,
              "boilerplate-only 'codex-rescue' NOT matched")
        check("stress-test-plan" not in all_signals,
              "boilerplate-only 'stress-test' NOT matched")
        check("hmac-signing" not in all_signals,
              "boilerplate-only 'hmac' NOT matched")

        # --- idempotency: re-run backfill, count must stay 3 (upsert, not duplicate) ---
        subprocess.run([sys.executable, str(EMITTER), "--backfill"], env=env,
                       capture_output=True, text=True)
        recs2 = [json.loads(l) for l in queue.read_text(encoding="utf-8").splitlines() if l.strip()]
        check(len(recs2) == 3, f"re-run stays idempotent at 3 records (got {len(recs2)})")

        # --- aggregate ---
        r = subprocess.run([sys.executable, str(AGGREGATOR)], env=env,
                           capture_output=True, text=True)
        check(r.returncode == 0, f"aggregator exits 0 (got {r.returncode}; stderr={r.stderr.strip()})")
        report = json.loads(r.stdout)
        cands = {c["signal"]: c for c in report["candidates"]}

        # accepted-residual + dual-adversarial each hit 2 distinct projects -> cross-client candidates
        check("accepted-residual-gate" in cands, "accepted-residual-gate surfaced as candidate")
        check(cands.get("accepted-residual-gate", {}).get("meets_cross_client") is True,
              "accepted-residual-gate flagged cross-client (2 projects)")
        check(sorted(cands.get("accepted-residual-gate", {}).get("distinct_projects", [])) ==
              ["iago-os", "sentria"],
              "accepted-residual-gate distinct projects = [iago-os, sentria]")
        check("dual-adversarial-review" in cands, "dual-adversarial-review surfaced as candidate")

        # optimistic-locking appears once, one project -> NOT a candidate
        check("optimistic-locking" not in cands,
              "single-occurrence signal is NOT promoted (optimistic-locking excluded)")

        # cross-client candidate must rank above any non-cross-client one
        if report["candidates"]:
            check(report["candidates"][0]["meets_cross_client"] is True,
                  "top-ranked candidate is cross-client")

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} assertion(s)")
        return 1
    print("PASSED: all assertions green")
    return 0


if __name__ == "__main__":
    sys.exit(main())
