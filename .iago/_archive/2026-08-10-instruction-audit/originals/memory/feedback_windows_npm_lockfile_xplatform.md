---
name: feedback_windows_npm_lockfile_xplatform
description: "Regenerating package-lock.json on Windows — update in place, never delete-and-reinstall"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 59567235-5d1f-4a59-b93c-606f7be2610d
---

When fixing an out-of-sync `package-lock.json` on **Windows** for a project whose CI builds on **Linux** (e.g. Amplify Hosting, GitHub Actions), regenerate the lockfile **in place** — never delete it first.

**Why:** npm 11.x on Windows, when it rewrites a lockfile from scratch (after `rm package-lock.json`, via either `npm install` or `npm install --package-lock-only`), records optional-dependency PACKAGE ENTRIES (`node_modules/@rollup/rollup-linux-x64-gnu`, `node_modules/@esbuild/linux-x64`, darwin, etc.) for ONLY the current platform (win32). The Linux CI then can't install the rollup/esbuild native binary → `vite build` fails with "Cannot find module @rollup/rollup-linux-x64-gnu". A naïve Windows regen breaks Linux CI *worse* than the original drift.

**How to apply:**
1. Restore the committed lockfile (which already has all platforms): `git checkout origin/<branch> -- package-lock.json`.
2. Update in place WITHOUT deleting: `npm install --package-lock-only`. This MERGES the missing transitive entries while PRESERVING the existing cross-platform optional package entries.
3. Verify before pushing: `npm ci --dry-run` exits 0 (in sync), AND `grep -c '"node_modules/@rollup/rollup-linux-x64-gnu"' package-lock.json` ≥ 1 (linux + darwin + win32 all present), AND `git diff --quiet -- package.json` (package.json untouched).

Root cause of the Sentria #169 qc build break (2026-05-31): a merge-conflict resolution on package-lock.json left it out of sync with package.json (stale `@smithy/*` + `@aws-cdk/toolkit-lib` transitive versions); `npm ci` in the Amplify build (job 52) failed. The in-place fix above (commit a4744a6) was a +516/-16 one-file patch → green. See [[reference_sentria_qc_env]]. No WSL/Docker on Santiago's Windows box, so a Linux regen wasn't an option.
