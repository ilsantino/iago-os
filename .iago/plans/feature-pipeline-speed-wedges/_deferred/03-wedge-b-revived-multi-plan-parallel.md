---
plan: 03-wedge-b-revived-multi-plan-parallel
phase: feature-pipeline-speed-wedges
status: ready
spec: docs/specs/parallel-execution-wedges.md
wave: 2
depends_on: 01-measurement-protocol
---

# Plan 03 — Wedge B-revived — Multi-plan Parallel Execution

## Goal

When `/iago-execute {phase}` runs N plans, run them concurrently in isolated worktrees instead of sequentially. Use Anthropic agent-teams + mailbox file-ownership announcements to detect and resolve cross-plan file conflicts before they cause silent merge failures.

## Approach

The skill `/iago-execute` currently invokes `scripts/execute-pipeline.sh` once per plan in a loop. Replace the loop with a coordinator that:
1. Creates one git worktree per plan (`iago-wt {plan-slug}` helper already exists).
2. Spawns each plan's pipeline as an agent-teams teammate.
3. Each teammate broadcasts file ownership claims via the mailbox: `[plan-02] claim package.json` / `[plan-04] claim src/features/auth/*.ts`.
4. Lead detects conflicts. Resolution policy: first-claim-wins, second-claim queues; if queued plan finishes before unblocked, escalates to lead for rebase or skip.
5. Each plan still runs the full pipeline (stress → impl → build → review → codex → fix → PR) in its own worktree.

**Fallback** (agent-teams unavailable): degrade to sequential execution with a warning.

## Tasks

1. Define file-ownership message types (extend mailbox protocol from plan 02).
2. Implement queue-write conflict resolution: when teammate B sees teammate A claimed `package.json`, B (a) waits up to T seconds, (b) on timeout, asks lead for rebase strategy, (c) on rebase failure, lead aborts B with a clear "queued behind A" message.
3. Add coordinator script `scripts/execute-phase-parallel.sh` that wraps `execute-pipeline.sh` per plan in worktrees.
4. Update `/iago-execute` skill to dispatch via coordinator when more than 1 plan exists for the phase.
5. Telemetry: per-plan timing recorded via plan 01's helper; coordinator emits a phase-level NDJSON record with parallel/sequential mode and total wall time.

## Acceptance

- Phase with N=3 plans (no file conflicts) completes in ~max(plan_1_time, plan_2_time, plan_3_time), not sum.
- Phase with N=2 plans where plan A and plan B both touch `package.json`: plan A completes first; plan B rebases and completes; both PRs created without merge conflicts on origin/main.
- Sequential fallback path tested: with `IAGO_DISABLE_PARALLEL=1`, behavior matches current loop exactly.
- No PR is auto-merged. Each plan's PR follows the existing review-fix loop.

## Out of Scope

- Dynamic load balancing across machines.
- Cross-phase parallelism (only within one phase invocation).
- Auto-rebase when conflicts cannot be resolved; lead aborts with message.

## Stress Test

**VERDICT: PROCEED_WITH_NOTES** — implementation can proceed; impl session must address these notes.

### Critical

1. **Coordinator MUST pass each worktree's own absolute path as `--project-dir`.** The pipeline lock at lines 55-78 keys on `$PROJECT_DIR/.iago/state/.pipeline.lock.d`. If two plans share `--project-dir`, the second hits "Another pipeline is already running" and exits 1 silently. Document this explicitly in Task 3.

2. **Rebase target after timeout-unblock not specified.** When plan A finishes before timeout T expires, plan B unblocks. B must rebase — but onto what? A's PR has not yet merged (no auto-merge). B must rebase onto A's branch, creating a branch dependency. Acceptance criterion for the N=2 conflict case must acknowledge B's PR targets A's branch, not main.

### Important

3. **Glob-level claims create spurious conflicts.** Task 1 shows claims as glob patterns (`src/features/auth/*.ts`); Task 3 acceptance uses exact files (`package.json`). Resolve: claim by exact file at the coordinator layer; expand globs before broadcasting.

4. **Plan 02 dependency unresolved.** Task 1 says "extend mailbox protocol from plan 02." Plan 02 is a wave-2 sibling, not yet merged. If plan 03 executes before 02 merges, message types do not exist. Add `depends_on: 02-wedge-a-plus-review-fanout` OR define the mailbox protocol independently.

5. **Worktree base commit not specified.** Each worktree must start from a known base. Plan does not say which commit. If A and B both branch from identical base, merging either requires the other to rebase — making "both PRs created without merge conflicts" depend on merge order, not coordinator correctness.

6. **No flag-presence check.** If `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is renamed/removed before wave-2 ships, fallback applies silently. Add detection + logged warning.

### Minor

7. **No N=1 degenerate case.** Plan should require N=1 falls through to existing sequential path with no coordinator overhead.

8. **Acceptance "completes in ~max(...)"** untestable without tolerance. Use "within 20% of max(plan_times)" or similar.

9. **Coordinator naming.** `execute-phase-parallel.sh` does not align with `iago-wt` convention. Worth aligning before PR.
