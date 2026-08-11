---
name: feedback_sync_before_pr_fix
description: "Before /dual-adversarial pass#2 or any PR-fix, git fetch + sync local to the PR's ORIGIN head first — the async @claude loop may push a fix mid-session"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: ba0bd03c-2d73-4a37-ac0a-6591544cdc59
---

Before running a dual-adversarial pass #2 (or any review-fix) on an open PR, ALWAYS
`git fetch` and sync local to the PR's **origin head** first. The async @claude
GitHub-Actions loop (triggered by a prior `/iago-prfix` tag) runs without a session
and can push a fix commit to the PR branch **mid-session** — on Sentria PR #165 the
loop's fix `c0332ca` (`claude[bot]`) landed at 20:57 UTC while a fix workflow was
operating on the stale local HEAD `be91df5`. Result: a full fix round was wasted on
the wrong base, its edits were never committed (re-verify reviewed stale committed
code), and the uncommitted edits would have *overwritten* the loop's superior work.

**Why:** the async loop is an independent writer to the same branch; local HEAD is not
authoritative for an open PR. Operating on a stale base wastes a fix round and risks
clobbering parallel work (see [[feedback_stack_prs]]).

**How to apply:** (1) `git fetch origin <branch>` → confirm `git merge-base --is-ancestor
origin/<branch> HEAD`; if local is behind, `git restore` any uncommitted edits and
`git merge --ff-only` to the origin head BEFORE reviewing/fixing. (2) Run the gate
against the real PR head, not local. (3) The hook blocks `git reset --hard` — use
`git restore <files>` + `git merge --ff-only` instead.

Second lesson from the same PR: the cross-model pass #2 (Codex GPT-5.5 leg) caught that
the single-model async loop's "lost-update fix" was a **false-atomicity TOCTOU**
(app-layer read→compare-`updatedAt`→unconditional write). Real fix = AppSync
`condition:{updatedAt:{eq}}` on the mutation + catch `ConditionalCheckFailedException`.
Treat any "optimistic lock" claim skeptically: verify the condition is on the DB
mutation, not in app code. Cross-row invariants (multi-item) need `TransactWriteItems`/
per-org version token — a per-row `updatedAt` condition cannot close them.
