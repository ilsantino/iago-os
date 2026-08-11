---
name: Worktree and vite process hygiene
description: Keep dev/ clean — no stray worktrees, no leaked vite processes from pipeline runs
type: feedback
originSessionId: e28f31da-b81a-47ce-9a7c-46139b6ecc76
---
Keep `C:\Users\sanal\dev\` clean. Top-level should only hold main project repos (iago-os, obsidian-brain, iago-content-engine, payment-network-ai-agents). Never leave stray `munet-web-*` or other client-named sibling folders there.

**Why:** On 2026-04-20 Santiago found 4 stray folders at `dev/` (`munet-web-ticket3-p02`, `munet-web-combustibles`, `munet-web-exposicion`, `munet-web-fotogaleria`) — some were active git worktrees, some were abandoned shells with stale `vite preview` processes (6 leaked node procs total) holding files so Windows wouldn't let him delete the folders ("need permission from Surface-San"). Root cause of the process leak was `scripts/console-check.mjs` using `spawn(..., { shell: true })` on Windows — `preview.kill()` only reaps `cmd.exe`, leaving vite holding files. Fixed by using `taskkill /T /F /PID` on Windows + adding `process.on('exit')` hook. Worktree placement: `iago-wt` run from `iago-os` root creates worktrees at `dev/` level; helper was hardened to refuse running from iago-os root.

**How to apply:**
1. Worktrees MUST be created from inside a client repo (`cd clients/<repo>/` then `iago-wt <slug>`) so they land as siblings of that repo, not at `dev/` level.
2. After any pipeline or `/iago-fast`/`/iago-quick` run, check `tasklist | grep node` — if count is high, run `taskkill /F /IM node.exe /FI "COMMANDLINE like *vite*preview*"` or equivalent.
3. For bulk cleanup: `iago-wt-clean <slug>` or `iago-wt-clean --all` (added to `.bashrc` 2026-04-20). Safe — refuses to delete worktrees with uncommitted or unpushed work.
4. Never add a worktree manually with `git worktree add ../../<name>` — always use `iago-wt` so placement is consistent.
5. When Windows Explorer says "need permission from Surface-San" on a folder you own, it's almost always a stale process with file handles, not an ACL issue. Find with: `Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where { $_.CommandLine -like '*<folder>*' }`.
