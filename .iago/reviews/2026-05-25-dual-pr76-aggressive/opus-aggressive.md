# Opus 4.7 Aggressive Adversarial Review — PR #76

**Reviewer:** Opus 4.7 (1M context) — orchestrator session (sub-agent dispatch failed to write file twice; orchestrator performed review directly)
**Date:** 2026-05-25
**Branch:** `feat/04b-pr-triage-wiring` vs `main`
**Diff:** 606 lines, 4 files (README new, main.ts edit, 04b plan revised, 04c plan new)

## Summary

**Verdict: NO-SHIP.** The PR implements what Plan 04b Task 3 literally asks for, but Plan 04b Task 3 is **defective relative to its own dependency contract**. Plan 04a's `agent-config.json` explicitly enumerates 6 things 04b must wire; the implementer wired only 1. The daemon will start cleanly, look for crons in a non-existent `dist/agents/` directory, register zero of them, and never fire the PR-triage workflow even after fixing the directory issue — because there's no dispatch handler from `tasks/pending/` → `claude-pty`. README's described flow doesn't match the code's actual behavior.

Codex found the two top-level gaps. Opus finds 4 more.

## Findings

### Critical

- **C1 — Production agent-asset path resolution is wrong.** `runtime/daemon/main.ts` `resolveAgentsDir()` returns `path.resolve(thisDir, "..", "agents")` where `thisDir` is `path.dirname(fileURLToPath(import.meta.url))`. In production, the daemon runs from `runtime/dist/daemon/main.js` (per systemd unit + `tsconfig.json` `outDir: "./dist"`). `tsconfig.json` `include` list is `["agent-runtime/**/*.ts", "daemon/**/*.ts", "telegram/**/*.ts"]` — no `agents/` copy step. Production resolves to `runtime/dist/agents/` which does not exist. `loadCronEntries` treats ENOENT as silent empty → zero crons registered → daemon happy, workflow dead.
  - **Fix:** Either (a) `resolveAgentsDir()` returns a path relative to the repo root (e.g., `process.cwd()` since systemd sets `WorkingDirectory=/opt/iago-os`), OR (b) extend `tsconfig.json` / build step to copy `runtime/agents/` to `dist/agents/`. (a) is simpler and matches the production WorkingDirectory contract; (b) is more "build-output is self-contained" but adds a build step. Codex flagged this as H1.
  - **Verifier:** add main.test.ts case asserting `resolveAgentsDir()` returns a path that exists when called from the compiled `dist/daemon/` location (use `IAGO_AGENTS_DIR` override + verify the override is honored).

- **C2 — No dispatch handler from cron-fired task files to claude-pty.** This is the **headline gap**. Plan 04a's `agent-config.json` `_comment_fields` literally documents 04b's contract: "*Plan 04b is responsible for daemon-side discovery of agent-config.json and crons.json, cron registration, **agent spawn via PTY, prompt dispatch, and the ndjsonAlert envelope contract** used by the fallback path in prompt-template.md step (d). The authProfile, cwd, org, and env fields below are inputs 04b must forward to the PTY spawn opts.*"

  What the implementer did: registered crons. What the implementer did NOT do: subscribe a dispatch handler to the polling-loop's `task-claim` (or equivalent) event. The flow today: cron fires → task file written to `tasks/pending/pr-triage__<unix>.json` → polling loop's `claimTask()` runs (`agent-manager.ts:claimTask` is explicitly **decrement-only** per its JSDoc) → file moves to `tasks/resolved/` with `task-resolved` emitted to release the cron slot → **no PTY ever spawned, no prompt ever sent, no Telegram message ever fires**.

  The `agent-manager.ts` code itself flags this: "*claimTask is decrement-only ... that dispatch logic is deferred to Plan 04b Task 3 (`wireAgentManagerIntoStartDaemon`) which will subscribe a real dispatch handler to the agent registry's runtime channel.*" The plan's Task 3 description was written without ever mentioning the dispatch handler.

  - **Fix:** In `startDaemon`, after constructing `CronScheduler`, also subscribe a dispatch handler. Pseudocode:
    ```ts
    agentManager.on('task-claim-needed', async (filename, agentId) => {
      const config = await loadAgentConfig(agentsDir, agentId); // reads agent-config.json
      const handle = await agentManager.spawn({
        agentId,
        runtimeId: config.runtimeId,
        cwd: config.cwd,
        env: { ...config.env, ...inheritedCreds },
        authProfile: config.authProfile,
      });
      // Read task file, parse, forward prompt to handle; wait for exit; call claimTask
    });
    ```
    Verify the AgentManager EventEmitter API surface — the exact event name + payload is in 07b's source.
  - This was Codex H2 and is the most consequential bug in the PR.

### Important

- **I1 — README accuracy drift.** `runtime/agents/pr-triage/README.md` § 1 (Purpose) claims the flow: "cron-fired (07a) → wake-check gated (04a) → claude-pty spawned (Phase 1) → curl-to-Telegram POST (direct, agent-side) → exit clean → polling loop reaps the task file (07b)." Today, ONLY the first two steps work; steps 3-5 do not happen because C2 is unfixed. README documents intended behavior as if it were shipped behavior. Either update README to say "claude-pty dispatch is wired in this same plan" (true after C2 fix) or qualify what is and isn't reachable today.
  - **Fix:** After C2 is fixed, README becomes accurate. Until then, README is materially misleading to anyone reviewing or running the daemon.

- **I2 — `loadCronEntries` silently swallows ENOENT on the agents directory.** Per C1, this is the exact failure mode — production directory doesn't exist, ENOENT returns empty list, daemon happy. The implementer's choice was correct for the "no agents installed yet" case (Phase 3+ new agents) but wrong for "production is misconfigured." Should distinguish: ENOENT on the agents-dir root = log a WARN-level structured event ("no agents discovered — is the agents directory deployed?"), continue. ENOENT on per-agent `crons.json` = silent skip (current behavior, correct).
  - **Fix:** Split the ENOENT handling — log a high-visibility warning on the root path missing, keep silent skip for per-agent missing crons.

- **I3 — `agent-config.json` is never read.** The file exists, documents the contract, and the daemon completely ignores it. Per Plan 04a's `_comment_fields`: "*The authProfile, cwd, org, and env fields below are inputs 04b must forward to the PTY spawn opts. If 04b reads from a different source, these values will silently rot.*" Plan 04b's implementation reads only `crons.json`. There's no code path that touches `agent-config.json` at all. Fixing C2 requires fixing this — they're the same gap, but I3 deserves its own line item so it's not lost when C2 is implemented.
  - **Fix:** Add `loadAgentConfig(agentsDir, agentId)` parallel to `loadCronEntries`. Wire its output into the dispatch handler (C2).

- **I4 — README acceptance-criteria § 5 verbatim claim doesn't match.** Plan 04b Task 1 spec requires § 5 to be "verbatim copy of migration-scope § 1 6-criterion gate." The shipped README § 5 has 6 numbered items, which is correct shape, but I have not validated each criterion is verbatim from `.iago/research/2026-05-16-v2-operational-migration-scope.md` § 1. Reviewer should diff the two before merge.
  - **Fix:** Manual diff against migration-scope § 1 by the human reviewer. Adjust README if drift exists.

### Minor

- **M1 — Defensive `typeof CronScheduler !== "function"` runtime guard is noise.** This guard can only fail if the ESM import resolved to something unexpected — which is a configuration / build failure that would surface much earlier. The plan asked for "fail loudly with `Error('Plan 07a or 07b not landed: ...')` so the dispatcher catches the dependency violation immediately" — but the dispatcher catches the violation at import-resolution time long before reaching this check. The guard adds 8 lines for a case that can't happen in practice. Keep for now (the plan asked for it), but flag for removal in a follow-up cleanup PR.

- **M2 — Pre-existing `cred-bootstrap.test.ts` sentinel-leak failure flagged in PR body.** The failure is real and unrelated to 04b (file not touched). Document a follow-up issue/plan to fix it before Phase 2 cutover, since the test asserts a security-relevant property (env-var values not retained after credential read failure). Not a blocker for THIS PR.

- **M3 — `_dispatch-04b-retry*.log` files left in `.iago/summaries/`.** Three dispatch crash logs sit untracked in p04b worktree. They are diagnostic artifacts for the failure investigation but should either be committed (as session artifacts) or `.gitignore`d (if they're considered ephemeral). Currently they're in limbo.

## What I checked but found clean

- Construction order: AgentManager → CronScheduler is correct per stress-test I1.
- `CronScheduler.stop()` handles never-started case via `if (this.interval !== null)` guard — no NPE on SIGTERM during auto-start drain. EC1 carry-over honored.
- Teardown order: scheduler.stop → polling-loop stop → existing per-stage teardown. Comment correctly notes preventing fresh cron-fires mid-teardown.
- `withTimeout` wrapping on scheduler.stop + agentManager.stopPollingLoop — uses existing `stageTimeoutMs` consistently.
- TypeScript: `RegisterCronOpts` imported correctly; type narrowing in `loadCronEntries` properly validates each field's runtime type.
- `console.error` calls in `loadCronEntries` log file path + error.message only — no JSON content, no credential surface. Safe.
- `IAGO_AGENTS_DIR` env override semantics: empty string is treated as "use default" (correct — avoids accidentally pointing at root if env var is set but empty).
- No secrets in diff (no API keys, tokens, or private keys in any added line).
- The 04b/04c plan split: 04c's `depends_on: [04a, 04b, 07a, 07b]` is correct — 04c's integration test exercises the full stack including 04b's wiring.
- Lifecycle `!shuttingDown` guard before `scheduler.start()` — race safety honored.

## Severity-weighted next-action

1. **C2 first** — without dispatch, the PR is functionally a no-op even after C1 fix. Implement dispatch handler + agent-config.json loader.
2. **C1 second** — without correct dir resolution, neither cron registration nor dispatch fires.
3. **I1 + I3** ride along with C2 fix (same change wave).
4. **I2** — small ergonomic fix, can be in the same commit as C1.
5. **I4** — manual diff by human reviewer.
6. **M1/M2/M3** — follow-up issues, do not block merge.

Total: 2 Critical, 4 Important, 3 Minor.
