# Phase 1 Rollback Procedure

**Scope:** Phase 1 ships the v2 daemon skeleton **local-only** on Santiago's Windows box. No VPS install, no systemd unit deployed, no production state. Rollback = revert local state to pre-Phase-1.

## When to run this

- The hello-world end-to-end test (`runtime/integration/hello-world.test.ts`) fails in a way that cannot be diagnosed within one debugging session.
- Phase 2 (VPS install) needs to start from a clean local baseline.
- The daemon enters an unrecoverable state on Santiago's box (corrupted markers, runaway adapter, etc.) and the fastest path back to working is a full reset.

## Steps

### 1. Stop the daemon

If the daemon is currently running:

```bash
# Find the process (POSIX)
ps aux | grep -E "node.*runtime/daemon/main" | grep -v grep
# Send SIGTERM (graceful — writes .daemon-stop markers per Plan 03)
kill -TERM <pid>
# If it does not exit within 40s, force-kill (see budget below)
kill -KILL <pid>
```

**Shutdown timeout budget.** `runtime/daemon/main.ts` (Opus I4 fix)
bounds each stage of graceful shutdown at 10s:

| Stage | Bound |
|-------|-------|
| heartbeat.stop | 10s |
| bot.stop (if Telegram enabled) | 10s |
| ipcServer.stop | 10s |
| shutdownAgent per live handle | 10s each |

For a daemon with N live handles the cumulative budget is
`30s + 10s × N`. Wait at least that before escalating to SIGKILL — the
graceful path WILL terminate within budget even if an adapter hangs.

On Windows (PowerShell), do the graceful step first, fall back to
force-kill only after the budget elapses:

```powershell
# Step (a) — try graceful: send Ctrl+C to the daemon's console.
# taskkill without /F sends WM_CLOSE / Ctrl+C; the daemon's SIGINT
# handler then runs (writing .daemon-stop markers).
$pid = (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*runtime*daemon*main*" }).ProcessId
taskkill /PID $pid /T          # graceful — no /F flag
# Wait up to the budget (heartbeat+bot+ipc+handles × 10s).
Start-Sleep -Seconds 40
# Step (b) — only if still alive, force-kill (skips graceful shutdown).
if (Get-Process -Id $pid -ErrorAction SilentlyContinue) {
    Stop-Process -Id $pid -Force
}
```

If the Windows force-kill path runs, the daemon does NOT write
`.daemon-stop` markers; the next boot will treat every prior handle as
a crash candidate and attempt replay (correct behavior per the
crash-without-marker recovery branch).

The daemon's SIGINT/SIGTERM handlers in `runtime/daemon/main.ts` write
graceful `.daemon-stop` markers for every live agent handle within the
budget above.

### 2. Remove the daemon code

```bash
git checkout main
git pull origin main
# Optionally: branch from current main if you want to inspect before deletion
git checkout -b chore/phase-1-rollback
rm -rf runtime/
git commit -am "chore(runtime): roll back Phase 1 daemon skeleton"
```

If Phase 1 commits are already merged to `main`, alternative paths:

- **Revert the merge commits in order** (preferred for shared history):
  ```bash
  git revert -m 1 <merge-sha-7>  # plan 07 hello-world
  git revert -m 1 <merge-sha-6>  # plan 06 telegram
  # ... continue in reverse merge order through plan 01
  ```
  Reverting in reverse order avoids merge conflicts since each plan stacks on the previous.

- **Reset main to pre-Phase-1** (only if no downstream consumers):
  ```bash
  git checkout main
  git reset --hard <pre-phase-1-sha>   # 06ffe12c or earlier
  git push --force-with-lease origin main
  ```
  Force-push only if no other developer has pulled the Phase 1 commits.

### 3. Remove the local daemon state

```bash
# Default state root (per runtime/daemon/state-paths.ts):
rm -rf ~/.iago-os/daemon-state/
# OR, if IAGO_DAEMON_STATE_ROOT was set:
rm -rf "$IAGO_DAEMON_STATE_ROOT"
```

State subtrees deleted:

- `tasks/{pending,claimed,resolved}/` — file-bus task queue
- `approvals/{pending,resolved}/` — Telegram HITL handshake
- `agents/<agentId>/` — per-agent config records
- `markers/<handleId>.daemon-stop` — crash recovery markers
- `session-logs/<handleId>.jsonl` — append-only event logs
- `telemetry/<date>.ndjson` — NDJSON event stream

### 4. Revert configuration changes

Phase 1 does **not** modify any iago-os files outside `runtime/`. Specifically:

- No `CLAUDE.md` changes
- No `.claude/rules/*.md` changes
- No `scripts/execute-pipeline.sh` changes
- No `.github/workflows/*.yml` changes EXCEPT the `runtime-checks` job added in PR #40 — leave this in place (it conditional-skips when `runtime/package.json` absent and harms nothing)

Before deciding to drop the `runtime-checks` job, verify it actually exists with the expected block (some PRs may have renamed or moved it):

```bash
grep -A 5 "^  runtime-checks:" .github/workflows/validate.yml || echo "block absent — nothing to drop"
```

If the rollback PR also removes `runtime-checks`, drop the `runtime-checks` job block from `.github/workflows/validate.yml`.

### 5. Verify rollback

```bash
# Repo state
ls runtime/                          # → "No such file or directory"
ls ~/.iago-os/daemon-state/          # → "No such file or directory"
git status                           # → clean (or only the rollback commit)

# Existing iaGO pipeline still works
bash scripts/execute-pipeline.sh --help   # → usage banner, exit 0
node --version                       # → v20+ still on PATH
```

The existing iaGO review pipeline (`scripts/execute-pipeline.sh`) is unchanged by Phase 1 and continues to operate.

### 6. Re-run Phase 1 after rollback (if desired)

The correct re-apply path depends on HOW the rollback was done. Three branches:

**Branch (a) — Phase 1 not yet merged to main; feature branches still exist on remote.**

```bash
git fetch origin
git checkout feat/v2-runtime-skeleton-agent-runtime-interface
git pull --ff-only origin feat/v2-runtime-skeleton-agent-runtime-interface
# Re-walk the stack via PR merges: open PRs #40, #41, ..., #46 in order and merge each.
cd runtime && npm install
npm test    # → 285+ passed, 5 skipped (per acceptance criterion #2)
npm start                            # daemon starts (npm start → node dist/daemon/main.js → main())
```

**Branch (b) — Phase 1 was merged AND rolled back via `git revert`.**

You cannot re-merge an already-merged PR — gh / GitHub will say "Already merged."
Re-application is done by reverting the revert commits in REVERSE order so the
original feature commits land back on main:

```bash
git checkout main
git pull --ff-only origin main
# Walk back through the revert commits (one per Phase 1 PR) in REVERSE.
# Identify them via:
git log --oneline --grep "Revert " --since="<rollback-date>" --reverse
# Apply each in reverse order (the LAST revert is reverted FIRST):
git revert <revert-sha-for-pr-46>
git revert <revert-sha-for-pr-45>
# ... continue through <revert-sha-for-pr-40>
git push origin main
cd runtime && npm install && npm test
```

**Branch (c) — Phase 1 was merged AND rolled back via `git reset --hard`.**

```bash
git checkout main
# Locate the post-Phase-1 sha (last commit BEFORE the reset):
git reflog | head -20
git reset --hard <post-phase-1-sha>
git push --force-with-lease origin main   # only if no other developer pulled the reset
cd runtime && npm install && npm test
```

Verification command (same for all three branches):

```bash
cd runtime && npx tsc --noEmit && npx vitest run --coverage 2>&1 | tail -50
```

Expected exit 0 + ≥285 passed + coverage ≥80% per acceptance criterion #2.

## What rollback does NOT touch

- **`scripts/execute-pipeline.sh`** — the iaGO build pipeline. Untouched by Phase 1.
- **`.claude/`** — agent + skill + rule infrastructure. Untouched.
- **`.iago/plans/`** — phase planning artifacts. Phase 1's `feature-v2-phase-1-daemon/` folder survives rollback so the plan stack is recoverable.
- **`.iago/decisions/`** — ADRs. The 2026-05-15 agent-shape-taxonomy ADR remains.
- **`docs/specs/`** — v2 vision spec + master prompt. Survives rollback.

## State preservation before rollback

If `session.jsonl` event logs or NDJSON telemetry has analytical value (debugging the failure that triggered rollback):

```bash
# POSIX
tar -czf "$HOME/iago-os-pre-rollback-$(date +%Y%m%d-%H%M%S).tgz" ~/.iago-os/daemon-state/
# Then delete:
rm -rf ~/.iago-os/daemon-state/
```

The tarball can be inspected without restoring the daemon — markers are JSON, session.jsonl is NDJSON, telemetry is NDJSON.

## Phase 2 prep (post-rollback)

Phase 2 will:

1. Author the `iago-os-v2-daemon.service` systemd unit
2. Configure `LoadCredential=` for Telegram bot token + future HTTP-shape adapter API keys
3. Deploy daemon alongside OpenClaw on the Hostinger VPS
4. Validate one non-critical workflow end-to-end on the VPS

Phase 2 starts from `main` (presumably with Phase 1 either merged or freshly rolled back per this doc). Phase 2 does NOT alter Phase 1's local-only contract until cutover (Stage D / Phase 7).
