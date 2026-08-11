---
name: Worktree per concurrent session
description: Two concurrent Claude sessions on the same client repo MUST work in separate git worktrees; no shared working tree, no exceptions
type: feedback
originSessionId: 490e8828-67ef-499e-92b8-c0749a5a4fda
---
If two Claude sessions will exist at the same time on the same client repo, they MUST work in separate git worktrees. No exceptions.

**Why:** On 2026-04-19 a Ticket 3 pipeline launched in `clients/munet-web` while another Claude session was mid-execution on Ticket 6 plan 03 in the same working tree. Stashing the other session's in-flight edits, git-pulling main, and running a second pipeline from the same `--project-dir` caused mixed-scope staging — both pipelines staged each other's files and were about to push a mixed-scope PR. The "I'll just be careful" approach bit. Per-worktree isolation is the only reliable defense.

**How to apply:**
1. Before starting any pipeline in `clients/{project}/`, check for another active session on that tree (ask the user, or look at `ps`/background jobs if unclear).
2. If a second session is active or even suspected: spin up a worktree — never operate shared:
   ```bash
   cd ~/dev/iago-os/clients/{project}
   git worktree add "../$(basename $PWD)-{slug}" -b feat/{slug} main
   cd "../$(basename $PWD)-{slug}"
   npm install   # once per worktree
   ```
3. Shell helper when available (Git Bash ~/.bashrc):
   ```bash
   iago-wt() {
     local slug="$1"
     [ -z "$slug" ] && { echo "usage: iago-wt <slug>"; return 1; }
     cd "$(git rev-parse --show-toplevel)" || return
     git worktree add "../$(basename $PWD)-$slug" main
     cd "../$(basename $PWD)-$slug"
     npm install
   }
   ```
4. **Never run `git stash`, `git checkout main`, `git pull`, or `/iago-execute`** in a shared checkout while another session is active. Stashes grab the other session's live work; checkout/pull can clobber; pipelines stage cross-scope files.
5. After the ticket's PR merges: `git worktree remove ../{project}-{slug}`.

Naming: `{project}-{slug}` (e.g., `munet-web-ticket3`, `munet-web-feature-payment`). Keep the main checkout as a read-only "hub" for `git fetch` + worktree creation.
