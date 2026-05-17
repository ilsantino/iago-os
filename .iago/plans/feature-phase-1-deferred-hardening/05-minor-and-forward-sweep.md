---
phase: feature-phase-1-deferred-hardening
plan: 05
wave: 3
depends_on: [02]
context: .iago/plans/feature-phase-1-deferred-hardening/CONTEXT.md
created: 2026-05-17
source: feature
---

# Plan: feature-phase-1-deferred-hardening/05-minor-and-forward-sweep

## Goal

Close the long-tail of Minor + Forward findings from the six adv-pr* reviews (PRs #41 – #46) that were deliberately not absorbed into Plans 01 – 04. Each finding ID below cites its source review (`adv-pr41 M1`, `adv-pr46 F1`, etc.) so the implementer can re-open the source report for full context. Three classes of action:

- **JSDoc / README clarifications** — add a comment or a "Known limitations" / "Failure modes" row that documents an acknowledged carve-out (per CONTEXT.md "every Forward item either lands a fix OR a tracked issue with date + link"). The carve-out becomes an explicit, dated entry, not silent.
- **Defensive code patches** — tiny diffs (rename a constant, add a JSDoc, swap `flushTicks` for `waitForFile`, etc.) that close a Minor finding without expanding surface area.
- **Telemetry + type-tightening** — fold the Forward items about telemetry kinds + discriminated-union exhaustiveness into the two appropriate files (`runtime/daemon/telemetry.ts` JSDoc table + a small exhaustiveness check at one switch statement). No new event kinds shipped — those are Phase 6 dashboard work per `adv-pr44 F4`.

Plan 05 is a "sweep" plan: scope is intentionally narrow per finding, broad across files. Verify gate is "all tests still pass + biome clean + coverage didn't regress." Wave 3 (parallel with Plan 03) because file surfaces are disjoint from main.ts + bot.ts (which Plan 03 owns). Depends on Plan 02 because Plan 02's `atomicRename` JSDoc + variant addition is the source of truth Task 1 references when it documents file-bus / session-log / approval-bus callsite classifications.

Source of truth: the six `.iago/reviews/adv-pr4{1-6}-opus-*.md` files. Codex P2 sections do not exist in this PR train — codex-pr43/45/46 reports only carry [critical] and [high] findings, all of which were absorbed in-place or by Plans 01 – 04.

## Finding inventory

The full finding-to-task map (Minor + Forward across PRs #41-#46) is consolidated into the **Out-of-scope appendix** at the bottom of this plan. Task bodies cite finding IDs (`adv-pr43 M1`, etc.) inline so the implementer can re-open the source review for full context.

**Total absorbed:** 38 findings (~22 Minor + ~16 Forward) across **8 tasks**. Criticals were fixed in-place pre-merge; Importants are owned by Plans 01-04.

## Files (touched surface)

Files-touched summary; per-finding details inside each task body below.

- `runtime/telegram/{bot,commands,approval-bus,bot.test}.ts`, `runtime/telegram/README.md` — Task 1
- `runtime/daemon/{state-paths,file-bus.test,session-log,markers,agent-manager,ipc-server}.ts` — Task 2
- `runtime/agent-runtime/pty/{claude-pty.ts,claude-pty.md,claude-pty.test.ts}`, `runtime/agent-runtime/pty/version-pin.ts` — Task 3
- `runtime/integration/hello-world.test.ts` — Task 4
- `runtime/daemon/{telemetry,telemetry.test,agent-manager}.ts`, `runtime/daemon/state-paths.ts` — Task 5
- `runtime/daemon/README.md`, `runtime/agent-runtime/pty/claude-pty.md`, `runtime/telegram/README.md`, `runtime/migration/phase-1-rollback.md` — Task 6
- `runtime/daemon/agent-manager.ts` — Task 7
- `runtime/PHASE-1-EVIDENCE.md`, this plan file — Task 8

## Tasks

### Task 1: Telegram sweep (`runtime/telegram/*`)

- **files:** `runtime/telegram/bot.ts`, `runtime/telegram/commands.ts`, `runtime/telegram/approval-bus.ts`, `runtime/telegram/bot.test.ts`, `runtime/telegram/README.md`
- **action:** Apply the following adv-pr45 Minor findings:
  - **M2 — /inject preserves whitespace.** In `commands.ts` `parseCommand` for `/inject`: replace the current `tokens.slice(2).join(" ")` with slicing the original text: `const afterAgent = text.slice(prefix.length).trimStart(); const firstSpace = afterAgent.indexOf(" "); const agent = afterAgent.slice(0, firstSpace).trim(); const message = afterAgent.slice(firstSpace + 1)` — preserving newlines + repeated whitespace verbatim. Add a test: `parseCommand("/inject claude-main hello\\n  world")` returns `command.text === "hello\\n  world"`.
  - **M5 — Truncate reply on invalid agentId.** In `bot.ts` `dispatchInject` (and any other place that embeds user-supplied agent name in a reply): `const safeAgent = command.agent.slice(0, 64)`; use `safeAgent` in the reply text. Add a test asserting a 200-char `command.agent` produces a reply containing only the first 64 chars.
  - **M8 — validateAgentId in dispatchAbort/dispatchStatus.** Wrap both dispatchers with `try { validateAgentId(command.agent); } catch (err) { await safeReply(...); return; }` at the top, matching dispatchInject. Test parity.
  - **M6 — /status includes lastStatus + isAlive.** Extend `AgentManagerInterface` (the duck-typed interface bot.ts uses) with optional `getLastStatus(handleId): string | undefined` + `isAlive(handleId): boolean | undefined`. In `agent-manager.ts`, implement both (read from the tracked record). Bot calls them defensively (optional chaining); if undefined, omit from the reply. Test: register a stub manager whose `getLastStatus` returns `"running"`; `/status` reply includes "running".
  - **M7 — Leading-slash callback normalization inline doc.** In `commands.ts` `parseCallback` (or wherever leading-slash stripping happens), add a single-line comment: `// Telegram callback_data has no leading slash by convention (bot.ts sendApprovalRequest); commands.ts strips it for symmetry with text /commands.`. No code change.
  - **M1 (approval-bus AbortSignal).** In `approval-bus.ts` `waitForApproval` JSDoc, add: `// TODO(2026-Q3): accept optional AbortSignal so caller can cancel on agent shutdown — see issue #TBD. Currently the loop runs to timeoutMs even after the requesting agent is shut down (acceptable for Phase 1 timeouts ≤30s; revisit when agent-manager.shutdownAgent gains a "cancel waiters" path).`. No code change.
  - **M4 (flushTicks → waitForFile).** In `bot.test.ts`, audit every `flushTicks(5)` call. For each, identify the file-system side effect being awaited (e.g., approval-resolved file write) and replace with `await waitForFile(path, 1000)` (extend the existing helper if needed). If a `flushTicks` site is awaiting a pure-in-memory mock callback fire (e.g., `telegramSentMessages.length === 1`), replace with `await vi.waitFor(() => expect(telegramSentMessages.length).toBeGreaterThan(0))`. Leave a single `flushTicks` only if no file or observable mock state corresponds (none of the current sites should qualify — verify).
  - **M3 (README npm audit).** Run `cd runtime && npm audit --omit=dev --json` and pipe through `jq '.vulnerabilities | with_entries(select(.key | test("telegram")))'` (or grep the human-readable output for "telegram"). Paste the result + date into `runtime/telegram/README.md` under a new `## Dependency audit` section. If the result is empty, write "npm audit (YYYY-MM-DD): 0 telegram-related advisories.".
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run telegram/ --reporter=verbose 2>&1 | tail -30 && npx biome check telegram/`
- **expected:** tsc 0, all telegram tests pass (was 33+ → now 33+ with at least 3 new tests for M2/M5/M8/M6), biome clean.

### Task 2: Daemon sweep (`runtime/daemon/*` JSDoc + small patches)

- **files:** `runtime/daemon/state-paths.ts`, `runtime/daemon/file-bus.test.ts`, `runtime/daemon/session-log.ts`, `runtime/daemon/markers.ts`, `runtime/daemon/agent-manager.ts`, `runtime/daemon/ipc-server.ts`
- **action:**
  - **adv-pr41 M1 (state-paths Windows reserved JSDoc).** Above `WINDOWS_RESERVED` const, add JSDoc: `Windows reserved-name check assumes the agentId regex already forbids "." — if reusing this check for less-restrictive ID surfaces (e.g., handle IDs with extensions), expand pattern to /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\\.[^.]+)?$/i to cover "con.txt" / "con.foo.bar" / etc. which are also NTFS-illegal.`
  - **adv-pr41 M2 (file-bus.test.ts rename).** Find the test currently named (per the review) `"rename-over-existing atomically"` or similar. Rename to `"rename-over-existing: second write replaces published file content"`. No assertion change.
  - **adv-pr41 M3 + F1 (session-log module-state + rotation deferral).** File-header JSDoc additions (one paragraph each):
    - "Module state (`pauseStates`, `sequenceCache`, `fileLocks`) is per-process. Multi-process callers MUST coordinate externally (file-bus locks or higher-level coordinator). Plan 07 IPC is single-process; future Phase 6+ multi-process work must rework this."
    - "DEFERRED 2026-05-17: No log-rotation policy. `readEventsUpToHWM` re-reads the whole file each call. Rotation policy (rotate at 100MB; archive to `session-logs/archive/<handleId>-<rotateTimestamp>.jsonl`) is tracked for a Phase 6+ follow-up. Plan 03 boot recovery emits a telemetry warning when session.jsonl exceeds 50MB so the trigger is observable (see Task 6 / `runtime/daemon/README.md` § Failure modes)."
  - **adv-pr42 M1 (markers.ts writeStopMarker note).** Above `writeStopMarker`, JSDoc: `Direct write (not write-temp-then-rename). On hard-kill mid-write the file may exist truncated; readStopMarker JSON.parse fails → treated as absent → next-boot recovery treats this as crash, which is the safe default. Convention elsewhere in the daemon (state-paths.ts atomicRename pattern) is tmp+rename; markers ship the simpler form because the safe-fallback exists. If this assumption changes (e.g., readStopMarker recovers partial markers), switch to tmp+atomicRename.`
  - **adv-pr42 M2 (registerAgent persist-order).** Above `registerAgent`, JSDoc bullet: `Persistence order: persistAgentConfig BEFORE runtime.spawn (Plan 04 hardening). If spawn fails, the config file persists pointing at a never-spawned id; H1 recovery sees "no marker" and attempts restoreFromMarker (returns null) → recorded as crash with no replay (correct outcome).`
  - **adv-pr42 M3 (trackHandle onStatusChanged-throw).** Above `trackHandle`, JSDoc: `If runtime.onStatusChanged throws synchronously (broken adapter), the handle entry remains in this.handles with a no-op unsubscribe placeholder. Defense-in-depth: wrap onStatusChanged in try/catch + remove the entry on throw (Phase 3 hardening; Phase 1 trust model assumes adapters do not throw at subscription time).`
  - **adv-pr42 M5 (cascadeShutdownChildren sequential).** Above `cascadeShutdownChildren`, JSDoc: `Sequential await — one slow child shutdown blocks the rest. Acceptable for Phase 1 (children ≤3 typical, shutdown budget 30s × children). Phase 3 fan-out via Promise.allSettled is tracked (see runtime/daemon/README.md § Failure modes / cascade timing).`
  - **adv-pr44 M3 (ipc-server single-instance).** Above the socket-path constants in `ipc-server.ts`, JSDoc: `Single-instance assumption — Phase 1 runs one daemon per host. Two daemons on the same Windows machine collide on \\\\.\\pipe\\iago-os-v2-daemon; POSIX collides on /tmp/iago-os-v2-daemon.sock. Phase 7 multi-tenant work will need namespaced paths (e.g., iago-os-v2-daemon-<org>).`
  - **adv-pr44 M5 (ipc-server internal-error redaction).** Where the response builder does ``internal: ${message}`` for handler errors, swap to: emit `{ ok: false, error: "internal: handler failure" }` to the client + `console.error("[ipc-server] internal error:", err)` server-side. Add a test asserting client never receives raw error text on a thrown handler.
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run daemon/ --reporter=verbose 2>&1 | tail -30 && npx biome check daemon/`
- **expected:** tsc 0, all daemon tests pass + 1 new ipc-server redaction test, biome clean.

### Task 3: PTY adapter sweep (`runtime/agent-runtime/pty/*`)

- **files:** `runtime/agent-runtime/pty/claude-pty.ts`, `runtime/agent-runtime/pty/claude-pty.md`, `runtime/agent-runtime/pty/claude-pty.test.ts`
- **action:**
  - **adv-pr43 M1 (MAX_BUFFER_BYTES rename).** Rename the constant to `MAX_BUFFER_CHARS` throughout `claude-pty.ts`. Update the doc-comment to clarify "UTF-16 code units (string.length semantics), not bytes". Update the relevant test (adv-pr43 M5 sharpening below).
  - **adv-pr43 M2 (dead state fields).** Remove `env` and `cwd` from the `PtyHandleState` interface and from any place they're populated. Confirm via grep that no reader exists. (CONTEXT.md OQ note: `restoreFromMarker` already re-reads from disk + process.env; removing these dead fields does NOT alter behavior.)
  - **adv-pr43 F5 (CLAUDE_BINARY override).** In `claude-pty.ts` spawn site + `version-pin.ts` probe spawn: `const binary = process.env.CLAUDE_BINARY ?? "claude"`. Document in claude-pty.md. Add a test in `version-pin.test.ts` (or claude-pty.test.ts if version-pin tests don't have a place): stub `process.env.CLAUDE_BINARY = "/tmp/fake-claude"`; assert the spawn call receives `"/tmp/fake-claude"`.
  - **adv-pr43 M5 (sharpen 4KB cap test).** Replace the current "feeds 8KB of x asserts no crashed" test with TWO tests: (1) feed 3KB of `x` then `\\nHuman: ` — assert parse classifies idle (tail visible within cap); (2) feed 4097 bytes of `x` then `\\nHuman: ` — assert parse still classifies idle (verifying the cap kicks in at exactly the documented threshold). Use the renamed `MAX_BUFFER_CHARS` constant in test assertions instead of magic numbers.
  - **adv-pr43 M3 + M4 + M6 (doc notes in claude-pty.md "Known limitations" section).** Append (or extend the existing section with) bullets:
    - "Write back-pressure: `inject`/`prompt` payloads should be bounded to ~64KB. node-pty's `write` is fire-and-forget; large dumps may be dropped silently. The adapter does not validate."
    - "Line endings: `${message.payload.text}\\n` uses LF on all platforms. Windows Claude under ConPTY may need CRLF — Claude Code normalizes input line endings in practice; revisit if injected multi-line content renders incorrectly."
    - "Version probe timeout: on `VERSION_PROBE_TIMEOUT_MS` the probe sends SIGTERM (POSIX) / Windows-stop-signal. No SIGKILL fallback today — track if the probe hangs reproducibly."
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run agent-runtime/ --reporter=verbose 2>&1 | tail -30 && npx biome check agent-runtime/`
- **expected:** tsc 0, all agent-runtime tests pass (existing count + 2 sharpened 4KB tests + 1 new CLAUDE_BINARY test = +3 minimum), biome clean.

### Task 4: Integration test polish (`runtime/integration/*`)

- **files:** `runtime/integration/hello-world.test.ts`
- **action:**
  - **adv-pr46 M3 (version-pin mock derived from real range).** At the top of the test file, add: `import { SUPPORTED_CLAUDE_CODE_VERSION_RANGE } from "../agent-runtime/pty/version-pin.js"; import semver from "semver"; const mockVersion = semver.minVersion(SUPPORTED_CLAUDE_CODE_VERSION_RANGE)?.format() ?? "2.1.113";`. Replace the hardcoded `"2.1.113"` literal in the `vi.mock("../agent-runtime/pty/version-pin.js", ...)` factory with `mockVersion`. Add a comment: `// Derived from the real range so a range tightening forces this mock to update via build-fail rather than silent test pass.`. If `semver` is not already a runtime dep, add it as a dev dep (it's already a transitive dep of vitest — verify and use that).
  - **adv-pr46 F2 (mock state resettable).** The module-level mocks at the top of `hello-world.test.ts` keep `onDataCbs`, `onExitCbs`, `writes`, `killedRef`, `pidRef`, `telegramSentMessages`, `telegramCallbackHandlers` etc. as module-level `Map`/`array`s. They're cleared via `beforeEach` for arrays but Maps accumulate. Refactor: move every mock-state container into a `__resetForTests` function each mock exposes (or, if `vi.mock` factories cannot export, into a single module-level `mockState` object with a `reset()` method called from `beforeEach`). Verify all 3 `it` blocks still pass.
  - Plan 04's `runtime/integration/adapter-isolation.test.ts` is OWNED by Plan 04 — do NOT modify here. If the adapter-isolation test imports the mocks from `hello-world.test.ts`'s fixtures, audit but don't change.
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run integration/ --reporter=verbose 2>&1 | tail -30 && npx biome check integration/`
- **expected:** tsc 0, all integration tests pass (existing count unchanged + cleaner mock isolation), biome clean.

### Task 5: Telemetry forward items (`runtime/daemon/telemetry.{ts,test.ts}`)

- **files:** `runtime/daemon/telemetry.ts`, `runtime/daemon/telemetry.test.ts`
- **action:**
  - **adv-pr44 M2 (header per-event payload table).** Above the `DaemonEvent` discriminated union, expand the header JSDoc into a table:
    ```
    | kind | payload fields |
    | --- | --- |
    | daemon-start | (none) |
    | daemon-stop | (none) |
    | agent-registered | handleId, agentId, runtimeId, org |
    | agent-spawned | handleId |
    | agent-exited | handleId, exitCode, reason |
    | task-claimed | taskId, handleId |
    | task-resolved | taskId, handleId, ok |
    | approval-requested | approvalId, agentId, kind |
    | approval-resolved | approvalId, decision, decidedBy |
    | heartbeat-probe | handleId, alive, rssBytes? |
    ```
    Keep the source-of-truth as the TS type; the table is for skim-readability per CONTEXT.md "Documentation quality".
  - **adv-pr44 M4 (UTC midnight test).** Add a test in `telemetry.test.ts`: stub `Date.now` via `vi.useFakeTimers().setSystemTime(new Date("2026-06-01T23:59:59.500Z"))`. Call `emit({kind: "daemon-start"})`. Advance time 1 second (`vi.advanceTimersByTime(1000)`). Call `emit({kind: "daemon-stop"})`. Assert both files exist (`telemetry-2026-06-01.ndjson` AND `telemetry-2026-06-02.ndjson`) and each contains one line. Title: `"emit resolves UTC date at call time — events spanning midnight land in separate files"`.
  - **adv-pr44 F4 (event size cap forward note).** In the `emit` function JSDoc, add: `DEFERRED 2026-05-17: No MAX_EVENT_BYTES cap. Phase 1 callers (daemon lifecycle) write small structured events; Phase 6 dashboard streaming + Phase 8 cost-event flow may emit larger blobs. Add a cap when Phase 6 wires event-bus consumption — see runtime/daemon/README.md § Failure modes.`
  - **adv-pr42 F3 (cost-tap-after-teardown warning).** Adding a NEW event kind for "cost-tap-after-teardown" expands surface area which CONTEXT.md forbids. Instead: in `runtime/daemon/agent-manager.ts` `applyCostEvent` where `tracked === undefined` short-circuit happens, replace the silent `return` with `console.warn("[agent-manager] cost-event after teardown: handleId=%s amount=%s — event dropped", handleId, event.amount); return;`. No new telemetry kind. Document in agent-manager.ts JSDoc that production drift is observable via stderr until Phase 8 cost-ledger reconciliation lands. Add a test asserting the warn is emitted.
  - **adv-pr41 F3 (atomicRename Windows-race counter).** Same surface-area-expansion concern: do NOT add a new telemetry event kind. Instead, in `state-paths.ts` atomicRename, add an `EEXIST` branch comment: `// Windows: unlink→rename window is unbounded. Plan 02 audit classified callers (race vs stale-dest). When Phase 7 cutover needs measured data, instrument here with Date.now() bracketing + a one-off log line; not landed in Phase 1 to keep surface area stable.`
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run daemon/telemetry.test.ts daemon/agent-manager.test.ts --reporter=verbose 2>&1 | tail -30 && npx biome check daemon/telemetry.ts daemon/agent-manager.ts daemon/state-paths.ts`
- **expected:** tsc 0, telemetry tests +1 new (midnight rollover), agent-manager tests +1 new (cost-tap-after-teardown warn), biome clean.

### Task 6: Documentation Forward items (READMEs + ops docs)

- **files:** `runtime/daemon/README.md`, `runtime/agent-runtime/pty/claude-pty.md`, `runtime/telegram/README.md`, `runtime/migration/phase-1-rollback.md`
- **action:**
  - **adv-pr44 M1 verification.** Confirm Plan 01 already fixed the row 20 IPC mislabel. If still mislabeled, replace with: `IPC server (Unix socket / named pipe) for dashboard + CLI → daemon RPC. Phase 1 stub: fleet-health (30s cache), list-agents, get-handle.`
  - **adv-pr44 F1, F2, F3 (Phase 1 trust model section in daemon/README.md).** Add new `## Phase 1 trust model` section: same-host + owner-only (POSIX socket 0o600). Windows named-pipe ACL: default permissive; production hardening tracked for Phase 6 dashboard work. IPC authentication: no token, no peer-credentials check. Backpressure on `socket.write`: unchecked; Phase 6 dashboard streaming will add flow control. Each subsection labeled `[FORWARD: Phase 6]`.
  - **adv-pr42 F2 (Windows process-tree cleanup).** Add `## Windows process-tree cleanup — adapter responsibility` section to `runtime/daemon/README.md` pointing Plan 04 implementer at `taskkill /T /F` or `winapi-job-object` wrapping. Reference cortextOS + the iaGO memory entry `feedback_worktree_hygiene.md`.
  - **adv-pr41 F2 (file-bus per-agent subdir migration trigger).** In `runtime/daemon/README.md` § Failure modes, add a row: `Pending dir exceeds 200 files OR poll > 100ms — Plan 03 bootRecovery emits a telemetry warning (kind: heartbeat-probe extra fields, since adding a new kind is out of Phase 1 scope); migration to per-agent subdirs deferred to Phase 6+.` Cross-link to `runtime/daemon/file-bus.ts` header JSDoc.
  - **adv-pr43 F1, F2, F3, F4, F5 (claude-pty.md "Known limitations" section).** Ensure the section exists; append bullets:
    - "Process-group / job-object containment: node-pty fork on POSIX uses setsid; on Windows ConPTY does not enroll the child in a job object that the daemon owns. Hard-kill of the daemon leaves claude.exe + descendants running. Phase 7 hardening will wrap with cgroup (Linux) / Job Object (Windows)."
    - "Concurrent send serialization: two simultaneous `send({kind: \"inject\"})` calls are not coordinated; writes can interleave. No mutex. Caller must serialize. Future plan adds per-handle async mutex."
    - "Token redaction policy: env is NEVER persisted on disk today. If a future change adds env persistence (per Plan 02 / adv-pr43 Critical #1), a redactor stripping `/_TOKEN|_KEY|_SECRET|PASSWORD|API_KEY/i` MUST land at the same time. Test redaction explicitly."
    - "PTY dimensions: `PTY_COLS = 200; PTY_ROWS = 50` hardcoded. No resize support. Phase 6 dashboard owns resize wiring."
    - "CLAUDE_BINARY override: honor `process.env.CLAUDE_BINARY` if set, else fall back to `\"claude\"` (PATH lookup). Use for multi-install / beta / pre-release testing."
  - **adv-pr45 F1, F2, F3, F4, F5 (telegram/README.md forward-list section).** Add `## Phase 2+ forward-list` section (or extend existing):
    - "Webhook vs polling: Phase 2 VPS cutover should migrate from `getUpdates` polling to HTTPS-fronted webhook for scale + 409-conflict avoidance. Document the migration path before Phase 2 ships."
    - "getUpdates offset persistence: node-telegram-bot-api persists offset internally per-process. After a crash, on next start the bot may re-process the last batch (Telegram retains updates for 24h). Replay semantics are acceptable for approval callbacks (idempotent: resolveApproval returns already-resolved on retry); document the property."
    - "appr_* legacy passthrough: dropped in Plan 06 stress PR3. Operators reading old cortextOS docs may try `appr_<id>_allow` — bot will not respond. Document the rename in ops runbook."
    - "Persistent approval audit trail: today only `resolved/<id>.json` files + `approval-resolved` telemetry event. For compliance / post-mortem, a dedicated `telemetry/approvals-<date>.ndjson` stream would help. Track for Phase 8 cost-ledger PR."
    - "/send command in Phase 3: master prompt § 274-281 specifies `/send <agent> <message>` for Shapes 2-5. Gating logic in place. Phase 3 plan must implement payload-schema validation per ADR `custom` rule."
  - **adv-pr46 M2 (phase-1-rollback.md runtime-checks grep).** Above the "drop the `runtime-checks` job block" step, add: `Verify the job exists first: \`grep -A 5 "^  runtime-checks:" .github/workflows/validate.yml\`. Operator runs this command and confirms the block name + structure before deciding to remove.`
  - **adv-pr42 M4 (downgrade NOTE).** Record at the end of this plan file's stress section: "adv-pr42 M4 (heartbeat setForceRestartCallback race) was downgraded to NOTE by the original reviewer — verified: line 172 reads `this.onForceRestart` at invocation time, picks up new callback per-call. No action."
- **verify:** `cd runtime && npx biome check daemon/README.md agent-runtime/pty/claude-pty.md telegram/README.md migration/phase-1-rollback.md 2>&1 | tail -10`
- **expected:** biome clean (markdown formatter passes). All five files contain the new sections + bullets.

### Task 7: Type tightening — generation-token TODO comments + exhaustiveness checks

- **files:** `runtime/daemon/agent-manager.ts`
- **action:**
  - **adv-pr42 F1 (generation-token TODO comments).** Above the `handleStatusChange` function body (where status callbacks fire) AND above the `applyCostEvent` function body, add:
    ```
    // TODO(Phase 3 Shape 2/3): validate handle.generationToken === tracked.handle.generationToken
    // before mutating; discard stale callbacks. For Shape 1 PTY the discipline is moot because
    // the stdio reader dies with the child process; for HTTP/SDK callbacks (Shape 2+) stale
    // responses CAN arrive and the discipline becomes mandatory. See ADR § Shape 2 generation
    // token discipline.
    ```
    No behavior change in Phase 1.
  - **Exhaustiveness check at one switch.** Find a switch on a discriminated union in `agent-manager.ts` (likely the message-kind dispatch in `eventToReplayableMessage` or `handleStatusChange`). Add a `default` branch with `const _exhaustive: never = value; throw new Error("Unhandled kind: " + JSON.stringify(_exhaustive));` (using the `never` exhaustiveness pattern). Pick ONE switch — adding more is scope creep. The choice should target the one that's MOST likely to silently miss a new kind when Phase 3 adds Shape 2 message types. Document the choice in a comment.
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run daemon/agent-manager.test.ts --reporter=verbose 2>&1 | tail -20`
- **expected:** tsc 0, all agent-manager tests still pass (the exhaustiveness `default` branch is unreachable today; existing tests do not hit it). No new test required — the `never` type itself is the assertion at compile time.

### Task 8: Verification + evidence + out-of-scope appendix

- **files:** `runtime/PHASE-1-EVIDENCE.md`, this plan file (`05-minor-and-forward-sweep.md`)
- **action:**
  - **adv-pr46 M1 (coverage assertion clarification).** In `runtime/PHASE-1-EVIDENCE.md` line 23, replace the current "199+ passed, 5 skipped" with: `Expected (cumulative across Phase 1 PRs #40-#46 + Phase 1 deferred-hardening PRs #4X-#4Y): 199+ passed, 5 skipped. Reviewer note: per-PR test counts will be smaller; the cumulative bar is the acceptance gate, not any single PR's count.`
  - **adv-pr46 F1 (coverage cross-link).** Append to Block 2 of `runtime/PHASE-1-EVIDENCE.md`: `Coverage pass landed by Plan 03 of feature-phase-1-deferred-hardening. New table:` + add a placeholder row format the Plan 03 implementer fills in: `| main.ts | ≥80% | <Plan 03 result> | <Plan 03 PR link> |` + `| bot.ts | ≥80% | <Plan 03 result> | <Plan 03 PR link> |`. Plan 05 ships the structural row; Plan 03 (wave 3 parallel) fills the actual numbers when its PR opens.
  - **Out-of-scope appendix.** Append to THIS plan file (`05-minor-and-forward-sweep.md`) a new section `## Out-of-scope appendix (residual deferred items)` listing every Forward finding that was NOT actionable in this plan because it would expand surface area. Format:
    ```
    | Finding ID | Source | Disposition |
    |---|---|---|
    | adv-pr44 F1 | Windows named-pipe ACL | Documented in daemon/README.md § Phase 1 trust model. Phase 6 dashboard plan owns. |
    | adv-pr44 F4 | Telemetry event size cap | Documented in telemetry.ts JSDoc. Phase 6 dashboard plan owns. |
    | ... | ... | ... |
    ```
    Enumerate every F* finding from the inventory table. The appendix is the single source of truth Santiago + Garry-impressed standard demands: "every Forward item either lands a fix OR a tracked issue with date + link" — this appendix IS the tracked record.
  - **Full-suite verification gate.** Run the full pipeline-equivalent verification:
    ```
    cd runtime \
      && npx tsc --noEmit \
      && npx vitest run --coverage --reporter=verbose 2>&1 | tail -60 \
      && npx biome check . 2>&1 | tail -20
    ```
    Confirm:
    - tsc exits 0
    - all tests pass (Phase 1 baseline + new tests from Plans 01-04 + Plan 05)
    - coverage table shows NO regression vs `runtime/PHASE-1-EVIDENCE.md` Block 2 baseline (some files MAY rise because Plan 03 explicitly targets +18% on main.ts and +10% on bot.ts; Plan 05 must not pull any other file below its current floor)
    - biome check exits 0 across the full runtime/ tree
  - Append the verification command output (last 60 lines of vitest + 20 of biome) into the plan-05 pipeline summary at `.iago/summaries/feature-phase-1-deferred-hardening-05-<timestamp>.md`.
- **verify:** the verification gate command above
- **expected:** tsc 0, vitest green (no regression), biome 0, coverage table updated, out-of-scope appendix complete.

## Verification

```bash
cd runtime \
  && npx tsc --noEmit \
  && npx vitest run --coverage --reporter=verbose 2>&1 | tail -60 \
  && npx biome check . 2>&1 | tail -20 \
  && grep -c "TODO(Phase 3" daemon/agent-manager.ts \
  && grep -c "MAX_BUFFER_CHARS" agent-runtime/pty/claude-pty.ts \
  && grep -c "## Phase 1 trust model" daemon/README.md \
  && grep -c "## Out-of-scope appendix" ../.iago/plans/feature-phase-1-deferred-hardening/05-minor-and-forward-sweep.md
```

Expected:
- `tsc --noEmit` exits 0
- vitest passes (cumulative count rises by ≥6 new tests across Tasks 1, 3, 4, 5)
- `biome check .` exits 0
- coverage table shows zero file-level regressions vs baseline
- `TODO(Phase 3` matches ≥ 2 (handleStatusChange + applyCostEvent)
- `MAX_BUFFER_CHARS` ≥ 2 (constant + at least one reference)
- `## Phase 1 trust model` exactly 1 (new section in daemon/README.md)
- `## Out-of-scope appendix` exactly 1 (in this plan file)

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-17
**Reviewer:** orchestrator inline (5-dimension rubric per `.claude/rules/skill-authoring.md` § 2)

### Critical (must fix in impl)

- **C1 — Task 6's "## Phase 1 trust model" section in `runtime/daemon/README.md` MUST NOT contradict Plan 01's README edits.** Plan 01 is in wave 1 (lands first) and edits the same file. If Plan 01 already added a trust-model paragraph (the IPC mislabel fix likely touches the IPC row but may also add adjacent context), Task 6 must AMEND that section rather than create a duplicate. Implementer reads the file as it stands AFTER Plan 01's PR merges (which it will — Plan 05 is in wave 3, depends on wave 2 / Plan 02, which depends on wave 1 / Plan 01 implicitly). If the file has the section, extend it with the Phase 6 trust-model deferrals; if not, create it. NEVER duplicate.
- **C2 — Task 5 cost-tap warning must not regress agent-manager tests.** The current test suite for agent-manager covers `applyCostEvent` happy path. Adding a `console.warn` on the after-teardown branch requires (a) verifying no existing test triggers that branch and asserts silence, AND (b) adding the new test that DOES trigger it and asserts the warn. Snapshot tests / mock-spy on console.warn must be set per-test, not globally — otherwise other tests in the same file leak the spy.

### Important (forward to impl, don't block)

- **I1 — Task 4's `semver` dep.** The current `runtime/package.json` may not declare `semver` as a direct dep (it's a transitive of vitest). If `import semver from "semver"` fails at build, add `semver` as a devDependency in `runtime/package.json` + run `npm install --save-dev semver` from `runtime/`. Lock to `^7` to match the version vitest itself pulls in.
- **I2 — Task 1 `M6` AgentManagerInterface extension.** The bot.ts file uses a duck-typed interface (likely inline TypeScript interface, not a separate `agent-manager-interface.ts` file). Locate the interface declaration; add `getLastStatus(handleId): string | undefined` + `isAlive(handleId): boolean | undefined` as OPTIONAL members (`?`). Bot.ts uses optional-chaining + nullish coalescing. agent-manager.ts implements both as concrete (read `tracked.handle.status` for getLastStatus; delegate to `runtime.isAlive(handle)` for isAlive). Verify the interface change doesn't break Plan 01's IPC server which may also reference AgentManagerInterface.
- **I3 — Task 3 dead-field removal (state.env, state.cwd).** Before deletion, grep the entire `runtime/` tree for `state.env` and `state.cwd` reads. If ANY caller exists (e.g., a not-yet-removed reference in tests), either fix the caller or document in the removal commit. Pattern: `cd runtime && grep -rn "state\\.\\(env\\|cwd\\)" agent-runtime/ daemon/ --include="*.ts"`. If grep returns ≥1 hit, hold the field, demote to MINOR doc-note.
- **I4 — Task 7 exhaustiveness `default` placement.** The chosen switch must be exhaustive TODAY (every union member has a case). Adding the `never`-typed default to a switch that already has uncovered members will fail tsc immediately. Pre-check: confirm the chosen switch handles every kind of its discriminated union (count the union members; count the case statements). If they match, add the default safely. If not, either fix the missing cases first (probably scope-creep — defer to a separate plan) or pick a different switch.
- **I5 — Task 6 markdown formatting.** Biome 1.x markdown formatter has limited rules. Run `biome check .` on edited markdown files; if biome flips list-marker style or heading-spacing in a way that creates a large diff, accept it (CONTEXT.md "Garry-impressed completeness" means consistent style is the goal). If biome chokes on a section, simplify the markdown (avoid HTML tags, deep tables, code-fence languages biome doesn't grok).

### Minor

- **m1 — Out-of-scope appendix table can exceed 50 rows.** Fine to ship — readability is what matters, not row count. Group by source PR if helpful.
- **m2 — Task 2 markers.ts JSDoc note is "explanation of carve-out" — make sure it does NOT contradict adv-pr42 M1's recommendation (use tmp+rename).** The JSDoc explains WHY the simpler form is acceptable (the safe-fallback exists). If a reader thinks "but the review said tmp+rename" — the JSDoc explicitly addresses that.
- **m3 — Task 6 telegram/README.md `## Phase 2+ forward-list` may already exist** (the bot.ts header or sendApprovalRequest JSDoc might cross-link). Extend, don't duplicate. Same pattern as C1.

### Dimension-by-dimension verdicts

- **Precision:** Every task names file + finding ID + action; the ambiguous items (markdown formatter behavior, dep-list state of `semver`, AgentManagerInterface location) have explicit fallback paths.
- **Edge cases:** C1 (Plan 01 collision on daemon/README.md), C2 (console.warn spy hygiene), I3 (dead-field reader audit) cover the three non-obvious traps.
- **Contradictions:** Task 5 explicitly REFUSES to add new telemetry kinds (cost-tap-after-teardown stays a stderr warn, atomicRename window stays a comment) per CONTEXT.md "No surface-area expansion beyond what the reviews flagged" + adv-pr44 F4 "Phase 6 dashboard plan owns". Aligned.
- **Simpler alternatives:** Could drop Task 7 (generation-token TODOs) since Phase 1 doesn't ship Shape 2. REJECTED — adv-pr42 F1 explicitly recommends landing the comment in PR #42 itself to "avoid losing the discipline in Phase 3 planning". Plan 05 absorbs the deferred-from-PR-42 marker; cheap and high-leverage.
- **Missing acceptance criteria:** All 38 inventoried findings map to tasks. The 19 Forward items are either fixed in code (F5, F3 cost-tap, F1 trust model) or land as tracked entries in the Out-of-scope appendix (T8). No finding is silently dropped.

### Implementer forward-list

1. Read `runtime/daemon/README.md` AFTER Plan 01 ships to confirm whether the "## Phase 1 trust model" section already exists (C1). Extend if so, create if not.
2. Use per-test `vi.spyOn(console, "warn")` mocks for the cost-tap warning test (C2); never global.
3. Verify `semver` resolves before `import` in Task 4; add as devDep if needed (I1).
4. Locate the AgentManagerInterface declaration (likely inline in bot.ts or in a shared types file); add optional members (I2).
5. Grep for `state.env` / `state.cwd` reads before removing the fields in Task 3 (I3).
6. Pre-check the chosen Task 7 switch is exhaustive today before adding the `never`-default (I4).
7. Markdown formatter: accept biome's style choices, simplify markdown that chokes (I5).
8. Tests must rise by ≥6: M2 (1: /inject whitespace), M5 (1: truncate reply), M6/M8 (2: /status fields + dispatch validation), midnight rollover (1), CLAUDE_BINARY (1), cost-tap warn (1), 4KB-cap sharper (replaces 1 → +2 = +1 net). Verify the running count rises by exactly the expected total.
9. After all tasks land, run the Task 8 verification gate and paste output into the pipeline summary.

## Out-of-scope appendix (residual deferred items)

The following Forward findings are documented as tracked carve-outs rather than landed fixes (per CONTEXT.md "every Forward item either lands a fix OR a tracked issue with date + link"). Each entry names the disposition + owning Phase.

| Finding ID | Source | Disposition |
|---|---|---|
| adv-pr41 F1 | session-log no rotation policy | JSDoc deferral marker in `runtime/daemon/session-log.ts` (Task 2). Phase 6+ owns rotation policy. |
| adv-pr41 F2 | file-bus per-agent subdir migration | `runtime/daemon/README.md` § Failure modes row (Task 6). Plan 03 bootRecovery uses heartbeat-probe extras for early warning; full migration Phase 6+. |
| adv-pr41 F3 | state-paths atomicRename Windows-race telemetry | Inline comment in `state-paths.ts` (Task 5). Phase 7 cutover work instruments with Date.now() bracketing when needed. |
| adv-pr42 F1 | generation-token discipline | TODO comments in handleStatusChange + applyCostEvent (Task 7). Phase 3 Shape 2/3 implementation enforces. |
| adv-pr42 F2 | Windows process-tree cleanup | `runtime/daemon/README.md` § Windows process-tree cleanup section (Task 6). Plan 04 implementer responsibility (taskkill /T or job-object). |
| adv-pr42 F3 | Cost-tap after teardown | Stderr `console.warn` in agent-manager.ts `applyCostEvent` (Task 5). No new telemetry kind — Phase 8 cost-ledger reconciliation surfaces drift. |
| adv-pr43 F1 | PTY process-group containment | claude-pty.md "Known limitations" bullet (Task 6). Phase 7 hardening wraps with cgroup / Job Object. |
| adv-pr43 F2 | Concurrent send serialization | claude-pty.md "Known limitations" bullet (Task 6). Future plan adds per-handle async mutex. |
| adv-pr43 F3 | Token redaction policy | claude-pty.md note (Task 6). Redactor lands at the same time env persistence does (Phase 2+). |
| adv-pr43 F4 | PTY resize support | claude-pty.md "Known limitations" bullet (Task 6). Phase 6 dashboard owns resize wiring. |
| adv-pr43 F5 | CLAUDE_BINARY override | Implemented as 1-line fallback in `claude-pty.ts` + version-pin.ts + test (Task 3). |
| adv-pr44 F1 | Windows named-pipe ACL | `runtime/daemon/README.md` § Phase 1 trust model section (Task 6). Phase 6 dashboard owns ACL hardening. |
| adv-pr44 F2 | IPC authentication | `runtime/daemon/README.md` § Phase 1 trust model section (Task 6). Phase 6 dashboard plan adds auth token / peer-cred check. |
| adv-pr44 F3 | IPC backpressure | `runtime/daemon/README.md` § Phase 1 trust model section (Task 6). Phase 6 streaming work adds flow control. |
| adv-pr44 F4 | Telemetry event size cap | JSDoc deferral in telemetry.ts (Task 5). Phase 6 dashboard plan adds MAX_EVENT_BYTES cap. |
| adv-pr45 F1 | Webhook vs polling migration | telegram/README.md § Phase 2+ forward-list (Task 6). Phase 2 VPS cutover documents path. |
| adv-pr45 F2 | getUpdates offset crash semantics | telegram/README.md § Phase 2+ forward-list (Task 6). Replay-on-crash documented as acceptable; resolveApproval is idempotent. |
| adv-pr45 F3 | appr_* legacy passthrough runbook | telegram/README.md § Phase 2+ forward-list (Task 6). Ops-runbook entry warns operators. |
| adv-pr45 F4 | Persistent approval audit trail | telegram/README.md § Phase 2+ forward-list (Task 6). Phase 8 cost-ledger PR adds dedicated audit stream. |
| adv-pr45 F5 | /send command in Phase 3 | telegram/README.md § Phase 2+ forward-list (Task 6). Phase 3 plan implements with payload-schema validation. |
| adv-pr46 F1 | Coverage ≥80% verification | Plan 03 of this same phase delivers (cross-linked in `runtime/PHASE-1-EVIDENCE.md` Block 2 — Task 8). |
| adv-pr46 F2 | Bot/PTY mock isolation | Refactored to `__resetForTests` exports in `runtime/integration/hello-world.test.ts` (Task 4). |
| adv-pr42 M4 (NOTE) | heartbeat setForceRestartCallback race | Verified at line 172 — picks up new callback per-call. No action. Recorded here for audit completeness. |

End of plan.
