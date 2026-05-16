# Phase 1 — PR Self-Evidence Template

This file is the **template the PR description must include** before requesting merge for any Phase 1 plan. Replace placeholder blocks with actual run evidence. Acceptance criterion #8 (master prompt): "PR description includes a screenshot or terminal log proving the feature works end-to-end. Not a description; evidence."

## Required evidence blocks

### 1. TypeScript build gate (criterion #1)

```bash
cd runtime && npx tsc --noEmit
```

Expected: exit 0, no diagnostics.

**Evidence:** paste the terminal log here, including the command + the literal `$ echo $?` returning `0`.

### 2. Vitest with coverage (criterion #2)

```bash
cd runtime && npx vitest run --coverage
```

Expected: 199+ passed, 5 skipped (3 golden-transcript placeholders + 2 platform-conditional), coverage table showing ≥80% lines on all new `runtime/**` files except `**/types.ts` (excluded by config).

**Evidence:** paste the final Vitest summary + the coverage table.

### 3. Hello-world integration test (criterion #3)

```bash
cd runtime && npx vitest run integration/hello-world.test.ts --reporter=verbose
```

Expected: all integration test cases passed.

**Evidence:** paste the test run output.

### 4. Manual hello-world terminal log (criterion #8 — self-evidence)

Drive the daemon manually on Santiago's Windows box:

```bash
# Set the bot token + allowed user IDs
export IAGO_TELEGRAM_BOT_TOKEN="..."
export IAGO_TELEGRAM_ALLOWED_USER_IDS="<your-telegram-user-id>"
# Start the daemon
cd runtime && node --experimental-specifier-resolution=node dist/daemon/main.js
```

Then in a separate terminal:

```bash
# Write a task to the file-bus (use a real agent ID that's registered in your config)
TASK_ID=$(node -e 'console.log(crypto.randomUUID())')
cat > ~/.iago-os/daemon-state/tasks/pending/claude-main__${TASK_ID}.json <<EOF
{ "prompt": "Test prompt — please respond with OK", "needsApproval": true }
EOF
```

In Telegram: tap **Allow** on the approval message.

Confirm in the daemon terminal: agent picked up the task, requested approval, resumed after approval, wrote to `~/.iago-os/daemon-state/tasks/resolved/claude-main__${TASK_ID}.json`.

**Evidence:** screenshot of the Telegram approval message + paste of the daemon terminal log showing the full flow.

### 5. Telemetry NDJSON sample (criterion #5)

```bash
head -20 ~/.iago-os/daemon-state/telemetry/$(date +%Y-%m-%d).ndjson
```

Expected: at minimum these `kind` values present: `daemon-start`, `agent-registered`, `agent-spawned`, `task-claimed`, `approval-requested`, `approval-resolved`, `agent-exited`.

**Evidence:** paste the head of today's NDJSON file, with `sessionId` field visible.

### 6. Rollback verification (criterion #6)

Run the procedure documented in `runtime/migration/phase-1-rollback.md` in a scratch worktree:

```bash
git worktree add ../iago-os-rollback-test main
cd ../iago-os-rollback-test
# Execute rollback steps from phase-1-rollback.md
# Confirm clean state
ls runtime/ ; ls ~/.iago-os/daemon-state/   # both → "No such file or directory"
```

**Evidence:** paste the rollback terminal log + the verification commands.

## Failure path evidence

Acceptance criterion #2 requires failure paths tested, not just happy path. Confirm these specific test cases pass (one line per — `vitest run --reporter=verbose` shows them):

- [ ] **O_EXCL claim collision** — `runtime/daemon/file-bus.test.ts` test 7: "concurrent claimTask calls — exactly one succeeds"
- [ ] **Owner-mismatch rejection** — `runtime/daemon/file-bus.test.ts` test 5: "writeResolvedOutput with mismatched ownerId returns owner-mismatch"
- [ ] **Unknown PTY parse → restart** — `runtime/agent-runtime/pty/claude-pty.test.ts` test 11: "PTY emits unknown content >100 bytes → crashed status + .daemon-stop marker written"
- [ ] **Stall detection → restart** — `runtime/daemon/heartbeat.test.ts` test 4: "stale lastStatusChangeMs (>5min ago) triggers force-restart 'stalled'"
- [ ] **`.daemon-stop` write/read** — `runtime/daemon/markers.test.ts` test 1: "write + read round-trips"
- [ ] **session.jsonl two-phase replay** — `runtime/daemon/session-log.test.ts` test 6: "pause intake, append, replay up to HWM, resume — no interleaving"
- [ ] **Crash-without-marker recovery** — `runtime/daemon/agent-manager.test.ts` (Codex H1 fix): "treats knownConfigs entries with no marker on disk as crash candidates"
- [ ] **Subagent containment on parent shutdown** — `runtime/daemon/agent-manager.test.ts` (Codex H2 fix): both shutdown + restart paths cascade children
- [ ] **RSS exceedance recycle** — `runtime/daemon/agent-manager.test.ts` (Codex H3 fix): "adapter getStatus surfaces RSS; heartbeat triggers force-restart on exceedance"

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

## Acceptance criterion 7 — verification path

Phase 1 plans were executed via `bash scripts/execute-pipeline.sh --plan <path> --project-dir <repo-root>` per plan, the iaGO-canonical execution path. Plans 04, 06, 07 hit the pipeline impl 80-turn ceiling during housekeeping and were manually resumed (commit + push + PR) AFTER local build gate + test verification. Manual @claude tagging on each resumed PR triggered the same async review-fix loop the pipeline would have triggered automatically.

**Document in the PR description:** which plans were pipeline-completed end-to-end vs. manually-resumed, AND the build gate / test count for each.

## What the merge reviewer should see

Before merge approval, this template is filled out completely. No `<paste here>` placeholders remain. The reviewer can sanity-check the evidence against the codebase without re-running anything.

A merge with this template still placeholder is a Garry-standard violation.
