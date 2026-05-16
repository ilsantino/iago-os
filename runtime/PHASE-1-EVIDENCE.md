# Phase 1 — PR Self-Evidence Template

> **DO NOT MERGE while this file still contains `PASTE-` placeholders.**
> The Phase 1 acceptance gate (master prompt criterion #8) is "screenshot
> or terminal log evidence in PR description." Until every `PASTE-…` block
> below is replaced with real terminal output (or screenshot for the
> Telegram screen) from Santiago's box, this PR is NOT mergeable.
>
> Verification gate: `npm run check:evidence` (from `runtime/`) greps for
> the `PASTE-` sentinel in this file and exits non-zero if any remain.
> Wire this script into the merge gate (CI required check) once Phase 2
> stands up the runtime-checks workflow.

This file is the **template the PR description must include** before
requesting merge for any Phase 1 plan. Replace every `PASTE-…` block
with actual run evidence captured from Santiago's box.

## Capture procedure (one pass per PR)

Run these commands in order from `iago-os/` on Santiago's Windows box.
Copy the full terminal output (or screenshot for Telegram screens) into
the matching evidence block below. Mark each box `[x]` after pasting.

```bash
# Prereq: clone PR branch + install deps
cd C:/Users/sanal/dev/iago-os
git fetch origin
git checkout <pr-branch>
cd runtime
npm install
```

## Required evidence blocks

### 1. TypeScript build gate (criterion #1) — `[ ]` filled

```bash
cd runtime
npx tsc --noEmit
echo "exit code: $?"
```

Expected: exit 0, no diagnostics.

**Evidence:**

```
PASTE-tsc-OUTPUT-HERE
```

### 2. Vitest with coverage (criterion #2) — `[ ]` filled

```bash
cd runtime && npx vitest run --coverage 2>&1 | tail -60
```

Expected (cumulative across Phase 1 PRs #40-46): 285+ passed, 5 skipped
(3 golden-transcript placeholders + 2 platform-conditional). Coverage
table shows ≥80% lines on all new `runtime/**` files except `**/types.ts`
(excluded by config). The integration suite now ships 6 wired-daemon
tests (was 1 library-composition test before this fix wave).

KNOWN noise: ~19 unhandled rejections from `claude-pty.test.ts`
status-callback race appear in stderr — they do NOT fail any test (see
`runtime/integration/README.md` ops runbook for the root cause).

**Evidence:**

```
PASTE-vitest-coverage-summary-HERE
```

### 3. Hello-world integration test (criterion #3) — `[ ]` filled

```bash
cd runtime && npx vitest run integration/hello-world.test.ts --reporter=verbose
```

Expected: 6 tests passed. The "full hello-world: spawn → claim → approval
→ resolve → shutdown" test asserts ALL 7 canonical telemetry kinds
(`daemon-start`, `agent-registered`, `agent-spawned`, `task-claimed`,
`approval-requested`, `approval-resolved`, `agent-exited`) plus
`daemon-stop`.

**Evidence:**

```
PASTE-integration-test-output-HERE
```

### 4. Manual hello-world terminal log (criterion #8 — self-evidence) — `[ ]` filled

Drive the daemon manually with real Claude + real Telegram. This is the
only block that requires Santiago's hands on the keyboard (the others
run unattended).

```bash
# Set the bot token + allowed user IDs
export IAGO_TELEGRAM_BOT_TOKEN="<real-token>"
export IAGO_TELEGRAM_ALLOWED_USER_IDS="<your-telegram-user-id>"
# Start the daemon — npm start invokes `node dist/daemon/main.js`,
# which now actually starts the daemon (Codex C1: direct-execution
# guard at module bottom invokes main() when run as entrypoint).
cd runtime && npm start
```

In a second terminal:

```bash
TASK_ID=$(node -e 'console.log(crypto.randomUUID())')
cat > ~/.iago-os/daemon-state/tasks/pending/claude-main__${TASK_ID}.json <<EOF
{ "prompt": "Test prompt — please respond with OK", "needsApproval": true }
EOF
```

In Telegram: tap **Allow** on the approval message.

Confirm in the daemon terminal: agent picked up the task, requested
approval, resumed after approval, wrote to
`~/.iago-os/daemon-state/tasks/resolved/claude-main__${TASK_ID}.json`.

**Evidence — terminal log:**

```
PASTE-daemon-terminal-log-HERE
```

**Evidence — Telegram screenshot:** save to
`runtime/evidence/phase-1-telegram-allow-<date>.png` and reference here:

```
SCREENSHOT-PATH: PASTE-screenshot-path-HERE
```

### 5. Telemetry NDJSON sample (criterion #5) — `[ ]` filled

```bash
head -20 ~/.iago-os/daemon-state/telemetry/$(date +%Y-%m-%d).ndjson
```

Expected: at minimum these `kind` values present: `daemon-start`,
`agent-registered`, `agent-spawned`, `task-claimed`, `approval-requested`,
`approval-resolved`, `agent-exited`, `daemon-stop`. Every line carries
`sessionId: "<CLAUDE_CODE_SESSION_ID>"`.

**Evidence:**

```
PASTE-telemetry-ndjson-head-HERE
```

### 6. Rollback verification (criterion #6) — `[ ]` filled

Run the procedure documented in `runtime/migration/phase-1-rollback.md`
in a scratch worktree. The PR includes a `npm run test:rollback` script
that exercises a dry-run of the rollback steps without actually deleting
state.

```bash
cd iago-os/runtime
npm run test:rollback
```

Expected: exit 0; output enumerates each rollback step + verification
command, marks each as PASS or DRYRUN-OK.

**Evidence:**

```
PASTE-rollback-dry-run-output-HERE
```

## Failure path evidence

Acceptance criterion #2 requires failure paths tested, not just happy
path. Confirm these specific test cases pass:

- [ ] **O_EXCL claim collision** — `runtime/daemon/file-bus.test.ts`: "concurrent claimTask calls — exactly one succeeds"
- [ ] **Owner-mismatch rejection** — `runtime/daemon/file-bus.test.ts`: "writeResolvedOutput with mismatched ownerId returns owner-mismatch"
- [ ] **Unknown PTY parse → restart** — `runtime/agent-runtime/pty/claude-pty.test.ts`: "PTY emits unknown content >100 bytes → crashed status + .daemon-stop marker written"
- [ ] **Stall detection → restart** — `runtime/daemon/heartbeat.test.ts`: "stale lastStatusChangeMs (>5min ago) triggers force-restart 'stalled'"
- [ ] **`.daemon-stop` write/read** — `runtime/daemon/markers.test.ts`: "write + read round-trips"
- [ ] **session.jsonl two-phase replay** — `runtime/daemon/session-log.test.ts`: "pause intake, append, replay up to HWM, resume — no interleaving"
- [ ] **Crash-without-marker recovery** — `runtime/daemon/agent-manager.test.ts`: "treats knownConfigs entries with no marker on disk as crash candidates"
- [ ] **Subagent containment on parent shutdown** — `runtime/daemon/agent-manager.test.ts`: both shutdown + restart paths cascade children
- [ ] **RSS exceedance recycle** — `runtime/daemon/agent-manager.test.ts`: "adapter getStatus surfaces RSS; heartbeat triggers force-restart on exceedance"
- [ ] **SIGINT-mid-spawn EC1** — `runtime/integration/hello-world.test.ts`: "SIGINT during pending spawn shuts down the newly-spawned handle"
- [ ] **bootRecovery with knownConfigs** — `runtime/integration/hello-world.test.ts`: "bootRecovery uses persisted agent records"

## Garry-impressed checklist (apply before declaring done)

Copy from master prompt § Garry-impressed checklist. Tick every box:

- [ ] Implementation handles every code path I can think of, including the failure ones
- [ ] Tests exercise the failure paths, not just the happy path
- [ ] Docs include a "what breaks and how to recover" section (runtime/README.md + per-component READMEs + this rollback doc)
- [ ] No `TODO`, `FIXME`, or `XXX` comments left in shipped code (unless tied to a tracked issue with a date)
- [ ] No "this is good enough for now" rationalizations
- [ ] If the real fix was 5 more minutes away, the real fix is what landed
- [ ] If there's a workaround, the upstream issue is filed AND the workaround documents the issue link
- [ ] If there's a dangling thread (cleanup, config migration, deprecation note), it's in this PR not the next one
- [ ] Pipeline review came back clean, not "clean with carry-over findings"

## Acceptance criterion 7 — pipeline-verification ledger

Phase 1 plans 01-03, 05 were executed end-to-end via
`bash scripts/execute-pipeline.sh --plan <path> --project-dir <repo-root>`
(the iaGO-canonical execution path). Plans 04, 06, 07 hit the pipeline
impl 80-turn ceiling during housekeeping; those PRs were manually
resumed (commit + push + PR) AFTER local build gate + test verification.
Manual @claude tagging on each resumed PR triggered the same async
review-fix loop the pipeline would have triggered automatically.

This PR (#46) was finalized via a final adversarial-review fix dispatch
that landed the integration-test rewrite, bootRecovery-with-knownConfigs
wiring, direct-execution guard, per-stage shutdown timeouts, and this
evidence-template restructure.

**Document in the PR description:** which plans were pipeline-completed
end-to-end vs. manually-resumed, AND the build gate / test count for each.

## What the merge reviewer should see

Before merge approval, this template is filled out completely. No
`PASTE-…` placeholders remain. The `npm run check:evidence` gate
passes. The reviewer can sanity-check the evidence against the codebase
without re-running anything.
