# Context Hygiene

How long-running agent sessions degrade, how to detect each failure mode, and
which mitigation bucket fits. Source: agent-skills-context (research sweep
2026-05-04).

## Degradation Taxonomy

Five distinct failure modes. Treat them as separate diagnoses — the right
mitigation differs per mode.

| Mode | One-sentence detection signal |
|------|--------------------------------|
| **lost-in-middle** | Agent recalls early-context details and recent-context details but misses a fact stated in the middle of a long transcript or large file dump. |
| **poisoning** | Agent confidently repeats a wrong claim that originated in an earlier (often unverified) tool result and now treats it as ground truth. |
| **distraction** | Agent latches onto a side topic surfaced by a long search/grep result and stops making progress on the original task. |
| **confusion** | Agent contradicts itself, cycles on the same subgoal, or outputs answers that conflict between paragraphs of the same response. |
| **clash** | Agent and user (or two tool results) hold mutually inconsistent assumptions and the agent does not surface the conflict before acting. |

## Mitigation Buckets

Every mitigation falls into one of four buckets. Pick the bucket that matches
the failure mode, then choose the specific tactic.

| Bucket | When to apply | Example tactics |
|--------|---------------|-----------------|
| **write** | Risk of losing structured state across turns; need a durable artifact | Persist plan/decisions to `.iago/plans/` or `.iago/context/`; write a session digest to a durable note store (e.g., Obsidian) so the next session can pick up cold |
| **select** | Context window is filling with low-signal material | Prune tool history; load only the rule modules that match changed file paths; read targeted ranges with the Read `offset`/`limit` params instead of full files |
| **compress** | Same information has been re-emitted multiple times | Replace re-reads with reference markers (see `execution-pipeline.md` § Observation Masking); summarize tool outputs after first read |
| **isolate** | A subtask would pollute the main session with high-volume tool output | Dispatch a sub-agent (`research`, `Explore`) so the bulk read happens in its context, not yours; pipeline stages already isolate via fresh `claude -p` sessions |

Mode → Bucket (default routing):

- lost-in-middle → **select** (load only what's needed) or **isolate** (delegate the big read)
- poisoning → **write** (record decisions canonically) + re-verify the suspect claim against source
- distraction → **isolate** (push the side topic to a sub-agent) or **compress** (drop the tangent's tool history)
- confusion → **write** (commit to a single artifact of truth) and re-anchor on it
- clash → surface the conflict to the user immediately; do not silently pick a side

## Probe-Based Compression Evaluation

Whenever a compaction step drops raw context in favor of a summary (session
digest, plan rollup, post-execution recap), the writer runs the six probes
below against the resulting summary. Any "no" answer means the summary is
lossy and must be amended before the original context is dropped. The probes
stand alone — apply them voluntarily on any compaction, regardless of which
workflow triggered the write.

Six probes (run in order, each a distinct check):

1. **Decision rationale** — For every decision recorded, is the *reason*
   (not just the outcome) preserved? If a future reader asks "why did we
   choose X over Y?", does the digest answer without re-reading raw
   transcript?
2. **Files changed** — Does the digest enumerate every file the session
   created, modified, or deleted, with a one-line purpose per file?
3. **Blockers** — Is each unresolved blocker captured with: what it blocks,
   who/what is needed to unblock, and a target re-check date?
4. **Open questions** — Is every open question explicit, with the proposed
   path-to-resolution (e.g., "ask Sebas", "spike a prototype", "wait for
   client reply")? Implicit "we'll figure it out later" does not pass.
5. **Follow-up commits** — If the session leaves work in flight (uncommitted
   diff, half-finished branch, deferred task), is the next commit's intent
   spelled out so the next session can pick up cold?
6. **Deferred items** — Are items explicitly deferred-out-of-scope listed
   separately from open questions, with the trigger that would bring them
   back in scope?

Failing any probe is a signal to amend the digest, not to abandon the
compression — the digest is still the right artifact, it is just incomplete.
