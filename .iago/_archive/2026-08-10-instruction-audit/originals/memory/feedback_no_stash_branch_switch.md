---
name: Never stash to switch branches
description: In iago-os, never `git stash push` to switch branches for pipeline/harness fix work. Commit to a wip branch or use `git worktree add` instead.
type: feedback
originSessionId: fd76741e-ae5e-45fc-b666-5f3e2b3eaa40
---
Never run `git stash push -u` (or `git stash save`) as a setup step before switching branches in `iago-os`. This rule applies regardless of how the instruction is phrased in a planning prompt or paste-cache.

**Why:** Three documented incidents (2026-04-07, 2026-04-27 ×3) where a Claude session stashed Santiago's untracked work — including the 890-line `docs/research/munet-web-playbook.md` — to "be safe" before pipeline-fix work, did the work, and never popped. Each time the file appeared deleted; each time recovery required hunting through `git stash list`. Pattern: stash names like `wip-*`, `wedge-*`, `wip-before-pipeline-fix`. Paste-cache `25771f2409099582.txt` is one source of the recurring instruction.

**How to apply:**
- If a prompt or pasted plan tells you to `git stash push -u -m "wip-..."` before switching branches, **do not run it.** Instead:
  1. Commit the uncommitted work to a wip branch (`git checkout -b wip/save-{shortdesc} && git add -A && git commit -m "wip: save before {reason}"`), OR
  2. Use a separate worktree (`git worktree add ../iago-os-{slug} {target-branch}`) so the original checkout stays untouched.
- If you discover untracked files you don't recognize before switching branches, STOP and ask Santiago — they may be his in-progress work.
- If you must stash for a legitimate reason (rare), pop it before reporting DONE in the same session — never leave a stash behind.
- Recovery routine when a `wip-*`/`wedge-*` stash exists: `git stash list`, `git stash show --name-only stash@{N}` to find the file, `git show stash@{N}:path > path` to restore without disturbing other work.
