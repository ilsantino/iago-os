# Synthesis & Fixes — PR #76 Dual Aggressive Review

**Date:** 2026-05-25
**Reviewers:** Codex GPT-5.5 (via codex-companion) + Opus 4.7 (orchestrator-direct after sub-agent dispatch failed)
**Branch:** `feat/04b-pr-triage-wiring` vs `main`

## Joint findings

Both reviewers independently flagged the same 2 Critical issues. Opus added 4 Important + 3 Minor.

| Severity | ID | Title | Both? |
|---|---|---|---|
| Critical | C1 | Production agent-asset path wrong (`dist/agents/` doesn't exist) | Codex H1 + Opus C1 ✓ |
| Critical | C2 | No dispatch handler from cron-fired task → claude-pty | Codex H2 + Opus C2 ✓ |
| Important | I1 | README claims flow that doesn't work today | Opus only |
| Important | I2 | `loadCronEntries` silently swallows ENOENT on agents root | Opus only |
| Important | I3 | `agent-config.json` is never read (same root as C2) | Opus only |
| Important | I4 | README § 5 verbatim claim not validated | Opus only |
| Minor | M1 | Defensive `typeof CronScheduler !== "function"` guard noise | Opus only |
| Minor | M2 | Pre-existing cred-bootstrap sentinel-leak failure | Opus only |
| Minor | M3 | Dispatch crash logs in limbo in `.iago/summaries/` | Opus only |

## Why both reviewers agree C2 is the headline

Plan 04a's own `runtime/agents/pr-triage/agent-config.json` `_comment_fields` literally documents Plan 04b's contract: discover agent-config.json, register agent, dispatch via PTY, forward authProfile + cwd + org + env. Plan 04b Task 3's description omitted everything except cron registration. The implementer faithfully implemented what Task 3 said. The plan was incomplete relative to its own dependency contract.

## Fix scope decision

**In this PR (commit on top of `feat/04b-pr-triage-wiring`):** C1, I1, I2.

**Deferred to new Plan 04d** (created as part of this fix wave): C2, I3, and updates to 04c.

**Deferred to standalone follow-ups:** M1 (cleanup PR), M2 (separate bugfix plan), M3 (commit or gitignore the logs).

I4 is a human-reviewer manual diff — will surface in @claude review comments if drift exists.

## Justification for splitting C2 off

C2 requires:
1. New EventEmitter event OR new method on `AgentManager` (e.g., `task-dispatch-needed` event between `isAgentRegistered()` check and `claimTask()`)
2. `loadAgentConfig(agentsDir, agentId)` parallel to `loadCronEntries`
3. Dispatch handler in `main.ts` that reads agent-config.json + spawns runtime via the existing `registerAgent` + handles task content forward to the PTY
4. Pre-register `pr-triage` at startup so `isAgentRegistered("pr-triage")` returns true
5. Unit + integration tests covering the new dispatch path

Item 1 touches `runtime/daemon/agent-manager.ts` (shipped infrastructure). Items 3-5 add ~150-250 LOC. This is a separate plan-worthy chunk, not a "fix in commit" — and is exactly the kind of scope-creep that caused 04b to fail 4 dispatches.

Plan 04d is created as a sibling to 04c. 04c's `depends_on` is updated from `[04a, 04b, 07a, 07b]` to `[04a, 04b, 04d, 07a, 07b]` because the integration test exercises the full dispatch chain that 04d wires.

## Code fixes applied in this PR (this commit)

### C1 fix — `runtime/daemon/main.ts` `resolveAgentsDir()`

Walks up from `import.meta.url` location until it finds a directory containing an `agents/` subdirectory. Handles both source-test (`runtime/daemon/`) and compiled (`runtime/dist/daemon/`) layouts. Falls back to legacy 1-up path with a structured warning log if no `agents/` found in 4 levels.

### I2 fix — `runtime/daemon/main.ts` `loadCronEntries()`

When the root `agentsDir` returns ENOENT, log a structured WARN event ("[daemon] loadCronEntries: agents directory not found at <path> — no crons will fire. Check resolveAgentsDir and the agents-asset deployment.") and return empty. Per-agent ENOENT on `crons.json` continues to be a silent skip (existing behavior, correct for "agent dir exists but no cron").

### I1 fix — `runtime/agents/pr-triage/README.md`

§ 1 (Purpose) qualifies the dispatch claim. Adds a "## Wiring status (2026-05-25)" subsection noting that cron registration is wired in this PR via Plan 04b; dispatch handler from cron-fire to PTY is in Plan 04d (incoming). Updates § 4 (Operations) "how to invoke manually" to note dispatch path is not yet live.

### 04c plan update — `depends_on`

Add `04d` to the depends_on list. Update `split_rationale` to note the C2 carve-out from the dual-review.

### New Plan 04d — `04d-pr-triage-dispatch-handler.md`

Single-task plan. Files: agent-manager.ts (add `task-dispatch-needed` event between `isAgentRegistered` check and `claimTask`), main.ts (add `loadAgentConfig`, subscribe dispatch handler, pre-register pr-triage at startup). Includes 04d-specific stress test.

## Severity gate

Critical-fix bar for landing this PR: C1 must be addressed. C2 must be explicitly deferred with a successor plan in place. Both satisfied by this commit + Plan 04d creation.

If Santiago wants C2 fixed in this PR instead of as 04d, that's authorizable — but it materially expands the PR and risks the same scope-explosion that caused 04b's 4 failures.
