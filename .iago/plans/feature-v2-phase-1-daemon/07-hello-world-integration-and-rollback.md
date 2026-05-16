---
phase: feature-v2-phase-1-daemon
plan: 07
wave: 4
depends_on: [01, 02, 03, 04, 05, 06]
context: .iago/plans/feature-v2-phase-1-daemon/CONTEXT.md
created: 2026-05-15
source: feature
---

# Plan: feature-v2-phase-1-daemon/07-hello-world-integration-and-rollback

## Goal

Wire all six prior plans into a runnable daemon and ship the end-to-end hello-world: register one Claude Code agent, file-bus claim, Telegram approval, agent resumes, task completes. Automated integration test exercises the full path. Rollback path documented. PR description evidence checklist defined. This plan is the Phase 1 acceptance gate — without a passing hello-world, Phase 1 is not done.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/daemon/main.ts` | Daemon entry point: wires AgentManager + HeartbeatController + IpcServer + TelegramBot + bootRecovery |
| create | `runtime/daemon/config.ts` | Daemon config loader (env vars + optional `runtime/daemon-config.json`) |
| create | `runtime/daemon/config.test.ts` | Config loader tests |
| create | `runtime/integration/hello-world.test.ts` | Automated end-to-end test: register → claim → approve → resume → complete |
| create | `runtime/migration/phase-1-rollback.md` | Phase 1 rollback procedure |
| create | `runtime/PHASE-1-EVIDENCE.md` | PR description evidence checklist + template terminal-log section for the hello-world run |

## Tasks

### Task 1: Implement daemon config loader

- **files:** `runtime/daemon/config.ts`, `runtime/daemon/config.test.ts`
- **action:** Export `DaemonConfig = { telegram: { token: string; allowedUserIds: number[] } | null; agents: AgentConfig[]; heartbeat: { intervalMs: number; rssLimitBytes: number; stallThresholdMs: number }; ipc: { socketPath: string; cacheTtlMs: number } }` where `AgentConfig = { agentId: string; runtimeId: string; org?: string; cwd: string; env: Record<string, string>; autoStart: boolean }`. Export async `loadConfig(): Promise<DaemonConfig>` that reads (in order): (a) `IAGO_DAEMON_CONFIG_PATH` env var if set, points to a JSON file; (b) `runtime/daemon-config.json` if exists in repo root; (c) built-in defaults (no agents auto-started, telegram disabled if no token env var). Env vars override file: `IAGO_TELEGRAM_BOT_TOKEN`, `IAGO_TELEGRAM_ALLOWED_USER_IDS` (comma-separated), `IAGO_DAEMON_HEARTBEAT_INTERVAL_MS`, `IAGO_DAEMON_RSS_LIMIT_BYTES`. If `IAGO_TELEGRAM_BOT_TOKEN` is empty AND no config-file telegram entry, set `telegram: null` (bot disabled — daemon runs without Telegram for the unit test path). Tests: (1) all defaults applied when env empty; (2) `IAGO_TELEGRAM_BOT_TOKEN` populates telegram.token; (3) `IAGO_TELEGRAM_ALLOWED_USER_IDS="111,222"` parses to `[111, 222]`; (4) JSON config file is loaded; (5) env overrides file; (6) malformed JSON in config file throws clear error mentioning path; (7) `telegram: null` when no token AND no file entry; (8) heartbeat env overrides apply.
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run daemon/config.test.ts --reporter=verbose 2>&1 | tail -15`
- **expected:** `tsc --noEmit` exits 0. All 8 tests pass.

### Task 2: Implement daemon main entry point

- **files:** `runtime/daemon/main.ts`
- **action:** Export async `startDaemon(config?: DaemonConfig): Promise<{ shutdown: () => Promise<void> }>`. Steps: (1) call `ensureStateDirsSync()`; (2) load config via `loadConfig()` if not passed; (3) emit `daemon-start` telemetry; (4) `import("../agent-runtime/pty/claude-pty.js")` (side effect: registers the adapter); (5) construct `HeartbeatController` with config.heartbeat values + `onForceRestart` callback that calls `agentManager.restartAgent`; (6) construct `AgentManager({ heartbeat })`; (7) call `agentManager.bootRecovery()` and emit recovery telemetry per category (recovered / cleanShutdowns / crashes); (8) construct `IpcServer` injecting `getFleetHealth` (returns per-handle status snapshot via `agentManager.listHandles()`), `listAgents`, `getHandle`; call `ipcServer.start()`; (9) if `config.telegram` is non-null, construct `TelegramBot` with `agentManager` adapter + `injectIntoAgent` callback that calls `agentManager.getRuntime(...).send(handle, { kind: "inject", payload: { text } })`; call `bot.start()`; (10) for each `agents[]` with `autoStart: true`, call `agentManager.registerAgent(...)`; (11) install SIGINT/SIGTERM handlers that call `shutdown()`: stop heartbeat, stop ipc, stop bot, shutdown all agents (writes graceful markers), emit `daemon-stop`. Return `{ shutdown }`. Export `main()` (no args) that calls `startDaemon()` and resolves on shutdown. Add `"start": "node --experimental-specifier-resolution=node dist/daemon/main.js"` to `runtime/package.json` scripts. Add `"prestart": "tsc -p ."` to ensure build before start.
- **verify:** `cd runtime && npx tsc --noEmit && grep -E "^export (async )?(function|const)" daemon/main.ts`
- **expected:** `tsc --noEmit` exits 0. `startDaemon` and `main` exported.

### Task 3: Write hello-world integration test

- **files:** `runtime/integration/hello-world.test.ts`
- **action:** Vitest integration test that automates the full Phase 1 path WITHOUT actually invoking the Telegram API or spawning real Claude (both mocked at module boundary). Setup: temp-dir state root, `vi.mock("node-telegram-bot-api")` returning a controllable bot, `vi.mock("node-pty")` returning a controllable PTY. Test: (1) start daemon with mocked telegram + an `autoStart: true` agent config pointing at `claude-pty`; (2) assert agent registered (verify via `listHandles`); (3) write a task to `tasks/pending/<id>.json`; (4) simulate the agent claiming it via `claimTask` (the file-bus call); (5) agent's logic decides it needs approval — call `createApprovalRequest` + `bot.sendApprovalRequest`; (6) assert pending approval file exists at `approvals/pending/<id>.json`; (7) simulate a Telegram callback `approve_allow_<id>` — invoke the bot's mocked callback handler directly; (8) assert pending file deleted, resolved file present with `decision: "allow"`; (9) `waitForApproval` (which the agent code was awaiting) resolves with the decision; (10) agent writes `tasks/resolved/<id>.json` via `writeResolvedOutput` with matching ownerId; (11) assert resolved file present, owner-id matches, no zombie writes succeeded; (12) assert telemetry events emitted for: daemon-start, agent-registered, agent-spawned, task-claimed, approval-requested, approval-resolved (assert all 6 lines in today's ndjson file); (13) call `shutdown()`, assert `.daemon-stop` marker written with `reason: "graceful"` for the agent. File <500 lines. Add `runtime/vitest.config.ts` `include` pattern adjustment to also pick up `integration/*.test.ts`.
- **verify:** `cd runtime && npx vitest run integration/hello-world.test.ts --reporter=verbose 2>&1 | tail -25`
- **expected:** Test passes; output contains `1 passed` and lists at least 12 assertions (via descriptive `it` titles or sub-it blocks).

### Task 4: Write Phase 1 rollback doc

- **files:** `runtime/migration/phase-1-rollback.md`
- **action:** Document Phase 1 rollback procedure: (1) Scope — Phase 1 is local-only on Santiago's Windows box; no VPS install yet; rollback = revert local state to pre-Phase-1; (2) Steps to roll back: (a) stop daemon via Ctrl-C or `kill` on the daemon process; (b) `rm -rf runtime/` to remove all daemon code (recoverable via `git restore runtime/` if uncommitted, or `git revert <Phase-1-PR-commit>` if merged); (c) `rm -rf <stateRoot>` to remove daemon state (default: `~/.iago-os/daemon-state/`); (d) revert any `CLAUDE.md` or config changes Phase 1 introduced (none expected — Phase 1 adds runtime/ but does not modify existing iago-os infra); (3) Verification after rollback: `ls runtime/` returns "not found"; `ls ~/.iago-os/daemon-state/` returns "not found"; `git status` clean; existing iago-os pipeline (`scripts/execute-pipeline.sh`) still runs unchanged; (4) Data preservation — `session.jsonl` files and telemetry NDJSON are deleted with state root; if you need to keep them, copy out of the state root BEFORE deletion; (5) Re-running Phase 1 after rollback — `git checkout <Phase-1-PR-branch>` (or re-merge the PR), `cd runtime && npm install`, run integration test, restart daemon; (6) What rollback does NOT touch — pipeline scripts, .claude/, .iago/plans/ (those are workflow infra, not Phase 1 daemon code); (7) Phase 2 prep — the systemd unit file authored in Phase 1 (if any — none for Phase 1; that lands in Phase 2) is not deployed yet; rollback need not touch systemd. File 80-140 lines.
- **verify:** `wc -l runtime/migration/phase-1-rollback.md && grep -c "^##" runtime/migration/phase-1-rollback.md`
- **expected:** Line count 80-140. Heading count ≥6.

### Task 5: Write Phase 1 PR-evidence template

- **files:** `runtime/PHASE-1-EVIDENCE.md`
- **action:** Document the acceptance-criteria-8 self-evidence requirements: (1) Purpose — "This file is the template the PR description must include for Phase 1. Replace placeholder blocks with actual run evidence before requesting review."; (2) Required evidence blocks: (a) `tsc --noEmit` exit-0 log; (b) `vitest run --coverage` summary (line coverage table for all new runtime/ files ≥80%); (c) Hello-world integration test output (`vitest run integration/hello-world.test.ts` — final summary); (d) Manual hello-world run terminal log: start daemon → write a task to `tasks/pending/` → observe Telegram approval message (screenshot OR copy of bot log) → tap Allow → observe agent resume → observe `tasks/resolved/` file appear → daemon graceful shutdown. Screenshot is optional if the terminal log shows all steps clearly; (e) Telemetry NDJSON snippet — `head -20 telemetry/<date>.ndjson` showing at minimum: daemon-start, agent-registered, agent-spawned, task-claimed, approval-requested, approval-resolved, agent-exited; (3) Failure-path evidence — each acceptance-criterion-2 failure path must have a test result line: O_EXCL collision (`file-bus.test.ts` test 7), owner-mismatch rejection (test 5), unknown PTY parse → restart (claude-pty.test.ts test 11), stall detection → restart (heartbeat.test.ts test 4), `.daemon-stop` write/read (markers.test.ts test 1), session.jsonl two-phase replay (session-log.test.ts test 6); (4) Rollback verification — output of `runtime/migration/phase-1-rollback.md` steps run in a scratch worktree, showing clean rollback; (5) Garry checklist — copy-paste the 9-item checklist from master prompt and check each before marking ready-for-review. File 100-150 lines.
- **verify:** `wc -l runtime/PHASE-1-EVIDENCE.md && grep -c "\[ \]" runtime/PHASE-1-EVIDENCE.md`
- **expected:** Line count 100-150. Checkbox count (`grep -c "\[ \]"`) ≥9 (the Garry checklist items).

### Task 6: Full-suite verification + coverage gate

- **files:** *(no new file; this task validates the integration)*
- **action:** From `runtime/`, run the full test suite + build + coverage: `npm install && npx tsc --noEmit && npx vitest run --coverage`. The build must exit 0 and the coverage report must show every new `.ts` file in `agent-runtime/`, `daemon/`, `telegram/` at ≥80% lines except `types.ts` files (excluded by config). The integration test in `integration/hello-world.test.ts` must pass. Total test count across all plans 01-07 should be approximately: 8 (registry) + 5 (state-paths) + 8 (file-bus) + 8 (session-log) + 6 (markers) + 7 (heartbeat) + 8 (agent-manager) + 6 (prompt-parser) + 11 (claude-pty) + 8 (telemetry) + 6-8 (ipc, platform-dependent) + 8 (approval-bus) + 15 (commands) + 10 (bot) + 8 (config) + 1 (integration) ≈ 117-119 tests. Document the exact final number in `PHASE-1-EVIDENCE.md` once the suite stabilizes.
- **verify:** `cd runtime && npm install && npx tsc --noEmit && npx vitest run --coverage 2>&1 | tail -40`
- **expected:** `tsc --noEmit` exit 0; `vitest run` reports ≥115 tests passed; coverage table shows all new runtime/ files at ≥80% lines.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-15

### Critical edge cases

- **EC1 (Critical) — SIGINT during agent spawn leaks PTY subprocess.** Between `resolveRuntime().spawn()` returning and the handle being inserted into agent-manager's internal map, SIGINT fires. The shutdown handler iterates the map but the handle is not yet there; the PTY subprocess survives as an orphan. **Fix:** `agentManager.registerAgent()` wraps the spawn+bookkeeping in try/finally: if any step after spawn throws OR if a shutdown flag is set, call `runtime.shutdown(handle, "SIGTERM")` before rethrowing. The shutdown flag is set by the SIGINT handler at the daemon level. Add an integration test (Task 3 step 13) that signals SIGINT mid-spawn (using a mocked runtime whose spawn returns after a `setTimeout`) and asserts no orphan process by checking the mocked PTY's shutdown was invoked.
- **EC2 (Critical) — Startup-cleanup pass missing.** After a crash, leftover state can include: stale IPC socket file (already covered in Plan 05 stress test EC1), stale `.claim.json` files (Plan 02 stress test E1 calls for `reclaimIfStale` via `bootRecovery`), stale `.hwm.json` markers. Plan 07 `startDaemon()` calls `ensureStateDirsSync()` + `bootRecovery()` but not the cleanup steps from Plans 02 + 05 stress notes. **Fix:** Plan 07 main.ts MUST orchestrate: `ensureStateDirsSync()` → preemptive socket unlink (`Plan 05 fix`) → `bootRecovery()` (which internally calls `reclaimIfStale` for orphan claims per Plan 03 fix) → start IPC + telegram + auto-start agents. Document the sequence in main.ts JSDoc.

### Important missing criteria

- **MC1 (Important) — Config error propagation undocumented.** Task 1 says `loadConfig()` throws on malformed JSON. Task 2 calls `loadConfig` but does NOT specify error handling. **Fix:** Task 2 `main()` wraps `startDaemon()` in try/catch: log error message + path to stderr, exit code 1. No raw stack trace. Document in JSDoc.
- **MC2 (Important) — Build gate completeness.** Task 6 runs `tsc --noEmit && vitest run --coverage` but NOT `biome check`. Per CLAUDE.md Tooling, Biome is the canonical formatter+linter. Plan 01 task 1 adds `"lint": "biome check ."` to `runtime/package.json`. **Fix:** Task 6 verification command becomes `npm install && npx tsc --noEmit && npx biome check . && npx vitest run --coverage`. Also note in `runtime/README.md`: "iaGO pipeline build-gate step (`tsc --noEmit && vite build`) is repo-root scoped. `runtime/` is a Node CLI subpackage — its equivalent gate runs from inside `runtime/`. Pipeline integration in Phase 2 wires this; Phase 1 pipeline runs the runtime-scoped gate manually." Update `scripts/execute-pipeline.sh` IF it does not already detect Node-only subpackages and skip `vite build` — but DO NOT modify the pipeline in Phase 1 (scope creep). Phase 1 path: pipeline runs root `tsc --noEmit` which catches runtime/ if root tsconfig references it; verify root tsconfig either does or does not include runtime/, and either ensure runtime/ tsc is run as part of pipeline impl-session verify OR add a clear note in Plan 07 README that the runtime/ build gate is verified by per-task verify commands inside the impl session.

### Minor

- M1 — `integration/*.test.ts` glob: Plan 01 Task 1 `**/*.test.ts` already matches subdirectories. Plan 07 Task 3's "vitest.config.ts include pattern adjustment" is defensive redundancy. Confirm or drop.
- M2 — PR-evidence screenshot softening aligns with master prompt criterion 8 ("screenshot or terminal log"). No contradiction.

### Verdicts on dimension-by-dimension checks

- **Precision:** mocked-at-module-boundary integration test satisfies criterion 3 (master prompt + runtime/CONTEXT.md both say "runnable"). Criterion 8 evidence template correctly handles real-run requirement separately. No contradiction.
- **Simpler alternatives:** Vitest-with-targeted-mocks is the correct tool. Real-subprocess integration would add CI fragility + require real Telegram + real Claude in CI. Keep current approach.

### Implementer forward-list

1. `agentManager.registerAgent()` try/finally with shutdown-flag check — see EC1.
2. Startup-cleanup sequence in `startDaemon()`: ensureStateDirsSync → socket unlink → bootRecovery → IPC/telegram start — see EC2.
3. `main()` catches config errors, logs, exits 1 — see MC1.
4. Task 6 verification adds `biome check .` between tsc and vitest — see MC2. Add note in `runtime/README.md` about pipeline build-gate scoping.
5. Confirm or drop the "vitest include pattern adjustment" line in Task 3 — see M1.

### 2nd-pass stress notes (2026-05-15 PM)

- **Task-discovery polling loop is DEFERRED to Phase 2.** Phase 1 hello-world integration test (Task 3) exercises `claimTask()` directly from test code — there is no production polling loop in Phase 1. Add a sentence to `runtime/README.md` AND Task 3's test JSDoc: "Phase 1 task discovery: integration test manually calls `claimTask()`. Production polling loop (a per-agent `fs.readdir(tasks/pending/) + filter` poll, or fs.watch-based) lands in Phase 2 alongside daemon-driven pipeline invocation."
- **Bot-side approval poller (MC1 fix) MUST also implement the Phase 1 task-discovery loop for the hello-world.** Specifically: the integration test (Task 3 step 4) writes the task via `claimTask()` from test code AND triggers the agent's `waitForApproval` flow by having claude-pty receive a `prompt` that includes a special marker (e.g., `[REQUEST_APPROVAL: <reason>]`) — the claude-pty adapter on detecting this marker in its OWN output calls `createApprovalRequest()`. This keeps Phase 1 minimal: no production task-discovery loop; integration test wires the trigger manually. Update Task 3 step 5 to spell out this trigger mechanism explicitly.
- **Plan 02 atomicRename helper is the single source of truth for ALL `tmp → final` renames across plans 02/03/05/06.** Plan 07 main.ts itself does not rename, but it imports + composes the helpers from 02. No direct `fs.promises.rename` calls in main.ts.

### Phase 1 acceptance gate (re-confirmed)

This plan IS the gate. All 8 acceptance criteria pass-fail map:
1. Build gate: `tsc --noEmit && biome check .` exit 0 — was missing biome; see MC2.
2. Coverage ≥80%: integration test alone won't deliver; relies on Plans 01-06 unit-test coverage; verified in Task 6.
3. Integration test: Task 3 covers this.
4. Documentation: Plans 01/03/04/06 cover per-component READMEs; this plan covers `runtime/migration/phase-1-rollback.md` + `PHASE-1-EVIDENCE.md`.
5. Telemetry: Plan 05 covers; integration test (Task 3 step 12) asserts events in today's ndjson.
6. Rollback: Task 4 covers.
7. Pipeline-verified: `/iago-execute feature-v2-phase-1-daemon` is the only acceptable execution path. Manual commits forbidden.
8. Self-evidence: `PHASE-1-EVIDENCE.md` template — Santiago fills before PR review.

## Verification

```bash
cd runtime && npm install && npx tsc --noEmit && npx vitest run --coverage 2>&1 | tail -50
```

Expected (Phase 1 acceptance gate):
- `tsc --noEmit` exits 0 — acceptance criterion #1 (build gate)
- `vitest run --coverage` reports all tests passed and coverage ≥80% — acceptance criterion #2
- `integration/hello-world.test.ts` passes — acceptance criterion #3
- Every `runtime/**/README.md` and `runtime/agent-runtime/pty/claude-pty.md` exists — acceptance criterion #4 (documentation)
- `telemetry/<today>.ndjson` contains the 9 event types after a daemon run — acceptance criterion #5
- `runtime/migration/phase-1-rollback.md` exists and documents the procedure — acceptance criterion #6
- Pipeline-verified (the merging PR is opened via `/iago-execute feature-v2-phase-1-daemon`, not manual git commit) — acceptance criterion #7
- PR description embeds `runtime/PHASE-1-EVIDENCE.md` with all blocks filled — acceptance criterion #8

This plan is the GATE. If any of the above fails, Phase 1 is NOT done.
