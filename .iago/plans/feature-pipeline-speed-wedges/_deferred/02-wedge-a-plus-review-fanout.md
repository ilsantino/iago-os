---
plan: 02-wedge-a-plus-review-fanout
phase: feature-pipeline-speed-wedges
status: ready
spec: docs/specs/parallel-execution-wedges.md
wave: 2
depends_on: 01-measurement-protocol
---

# Plan 02 — Wedge A+ — Review Fan-out (3 lens teammates + mailbox)

## Goal

Replace the single 900s opus review session in `scripts/execute-pipeline.sh` step 3 with a 3-teammate fan-out under Anthropic agent-teams, with a fork-and-join + synthesis-pass fallback when agent-teams is unavailable. Preserve every check the current single session performs. Cut review wall time without weakening the gate.

## Approach

Three lens teammates run in parallel:
1. `plan-compliance` — verifies each plan task is implemented in the diff.
2. `domain-routing` — selects relevant domains from the checks file and applies their rules.
3. `adversarial-cross-cutting` — auth bypass, data loss, races, rollback safety; reads each changed source file in full.

**Agent-teams mode** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` set):
- Lead session orchestrates. Three teammates spawned with shared mailbox.
- Mailbox messages exchanged for seam findings: `[lens-3] auth bypass at file:line — check rate-limit seam` → `[lens-2] api domain confirms rate-limit at handler.ts:42`.
- Lead synthesizes findings, deduplicates, applies severity floors.

**Fallback mode** (agent-teams disabled or unavailable):
- Three concurrent `claude -p` sessions via `&` + `wait`. Each writes findings to a separate file.
- Synthesis pass: a fourth lightweight session reads all three files, deduplicates, resolves contradictions, produces the unified findings list with severity floors applied.

Both code paths must produce findings of identical structure so the existing fix-loop is unchanged.

## Tasks

1. Define mailbox protocol — small spec at `docs/specs/agent-teams-mailbox-protocol.md` (5–10 message types max).
2. Refactor `scripts/execute-pipeline.sh` step 3 to call a new `run_review_fanout` function. The function checks `${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-0}` and routes to agent-teams mode or fallback mode.
3. Implement agent-teams mode (lead + 3 teammates + synthesis). Use Anthropic's experimental agent-teams in-process mode (Windows-compatible).
4. Implement fallback mode (3 concurrent `claude -p` + synthesis pass).
5. Verify severity floors (ALWAYS Critical / ALWAYS Important markers in `scripts/review-checks/*.md`) are honored in the synthesized output.
6. Telemetry: instrument the fan-out and synthesis as separate stages in plan 01's telemetry helper (`stage_start review_fanout`, `stage_start review_synthesis`).

## Acceptance

- Pipeline run with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` produces synthesized findings; verdict format unchanged.
- Pipeline run without the env var produces identical-shape findings via fallback path.
- Existing fix-loop (line 466 onward) consumes the synthesized findings without modification.
- Review wall time on a representative plan drops by ≥30% versus baseline (measured via plan 01's metrics aggregator).
- No regression in finding count or severity assignment on a known-flawed test diff.

## Out of Scope

- Pruning the fallback path. Decision deferred until agent-teams is GA.
- Mailbox protocol beyond 5–10 message types.

## Stress Test

**VERDICT: BLOCK** — must resolve before implementation begins.

### Critical

1. **Agent-teams API unspecified.** `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is a documented env var but there is no public API for spawning named teammates, sending mailbox messages, or reading from a shared mailbox in shell scripts. Two implementers will write entirely different code. Plan must specify: shell command or SDK call to spawn a teammate, mailbox send/receive mechanism, whether the lead session is itself a `claude -p` process.

2. **Conflicts with plan 05 on the same 150-line block.** Plan 05 (Wedge D) refactors stage 3 review into `run_review` and runs concurrently with `run_codex`. Plan 02 refactors the same block into `run_review_fanout`. Both depend only on plan 01; no merge order defined. Resolve by adding `conflicts_with: 05` and explicit merge order before either ships.

### Important

3. **Partial teammate crash in fallback mode unspecified.** If one of the three concurrent `claude -p` subprocesses crashes (OOM, SIGKILL), `wait` returns non-zero. Plan does not say whether synthesis runs on the available 2 files or aborts. Both behaviors silently lose findings or block forever.

4. **Synthesis pass severity-floor enforcement gap.** Synthesis is a fourth `claude -p` session. Plan says "verify severity floors" but does not pass `$REVIEW_CHECKS_FILE` to the synthesis prompt. Without the checklist, it cannot enforce ALWAYS Critical / ALWAYS Important markers.

5. **Mailbox message format underspecified.** Task 1 says "define mailbox protocol (5–10 type spec)" but provides no schema success criterion.

6. **Acceptance criterion "no regression on a known-flawed test diff"** does not identify the test diff or how to generate it. Untestable as written.

### Minor

7. **Synthesis pass duplicates existing review prompt.** Could replace fourth LLM call with a deterministic bash/node merger that takes max severity across duplicate check-ids — fewer moving parts, auditable.

8. **30%-wall-time reduction acceptance** requires plan 01 metrics already capturing baseline. Add explicit dependency note.
