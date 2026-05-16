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
# If it does not exit within 30s, force-kill
kill -KILL <pid>
```

On Windows (PowerShell):

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*runtime*daemon*main*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

The daemon's SIGINT/SIGTERM handlers in `runtime/daemon/main.ts` write graceful `.daemon-stop` markers for every live agent handle.

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

```bash
# If the Phase 1 branches still exist on the remote:
git checkout feat/v2-runtime-skeleton-agent-runtime-interface
git pull
# Or merge the PRs in order: #40, #41, #42, #43, #44, #45, #46
cd runtime && npm install
npm test    # → 203+ passed, 5 skipped (per acceptance criterion #2)
node runtime/daemon/main.js          # daemon starts; see runtime/README.md
```

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
