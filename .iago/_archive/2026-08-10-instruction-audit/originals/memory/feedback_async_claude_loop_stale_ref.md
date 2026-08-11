---
name: feedback_async_claude_loop_stale_ref
description: "The async @claude GitHub review-fix loop can push damaging commits when its review reads a stale ref; verify findings against ground truth before trusting auto-fix, and don't re-tag if it misfires."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 0e033f66-2470-4f77-90ac-156b12dd9d0c
---

On 2026-05-30 (PR #86) the async `@claude` review-fix loop (`claude.yml` → `claude-review-fix.yml`) read a **stale/base copy** of `.claude/workflows/dual-adversarial.js`, produced 2 false-positive "Important" findings (claimed `gateStatus`/`lenses` were absent when the committed file had them), and the `[fallback]` fix round acted on them — deleting the lens feature, `general.md`, and the trust-boundary wiring (commit `356d132`). It DID correctly catch one real bug (a case-only `/council` rename dropped by a rebase on the case-insensitive Windows FS).

**Why:** the loop runs unsupervised on GitHub and pushes commits + re-tags itself (up to 5 rounds). When its review is wrong, it amplifies the error into a regression with no human in the loop. The harness-native Workflow files (top-level `await`/`return`, harness-injected globals) seem especially prone to being misread.

**How to apply:**
- After tagging `@claude`, **verify each finding against ground truth** (`git ls-tree`/`git show <ref>:<path>`) before accepting or letting the fix loop run — never assume the review read the PR head.
- If the loop misfires on a file, **cancel the run** (`gh run cancel`) and **do NOT re-tag** — it will regress again. Fix forward yourself and post a correction comment (no `@claude`).
- Recover a bad automated commit with `git revert` or a `-s ours` merge — **never `git reset --hard`** (hook-blocked) and avoid force-push.
- The in-session `/dual-adversarial` gate reads files directly and does not have this stale-ref failure mode; prefer it for the final pre-merge check. Related: [[feedback_no_auto_merge]], [[feedback_single_claude_tag]], [[feedback_workflow_journal_recovery]].
