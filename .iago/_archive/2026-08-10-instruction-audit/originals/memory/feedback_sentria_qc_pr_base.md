---
name: feedback-sentria-qc-pr-base
description: "Sentria pipeline runs target sentria-qc, not main — checkout before dispatch, fix PR base after creation, pass base to dual-adversarial"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8238acd1-7ae0-4e78-bd1d-758e884550fd
---

The execute-pipeline workflow has NO base-branch arg and `gh pr create` defaults to
bas-labs/sentria's default branch (`main`). Every sentria run must compensate manually; Santiago
decided NOT to parameterize the pipeline (2026-06-10) — this memory replaces per-conversation
reminders.

**Why:** Sentria's integration base is `sentria-qc`; `main` = prod. A PR based on main shows a
cumulative wrong diff and risks merging unbaked work to prod. PR #197 only landed on sentria-qc by
ad-hoc correction.

**How to apply (every sentria `/iago-execute` / `/iago-quick`):**
1. BEFORE dispatch: `git -C clients/sentria checkout sentria-qc && git pull` (skill's git-sync
   step says `main` — override it; never sync sentria to main).
2. AFTER each PR stage: `gh pr view <branch> --json baseRefName` — if not `sentria-qc`, run
   `gh pr edit <n> --base sentria-qc`.
3. Dual-adversarial pass #2: pass `base: "origin/sentria-qc"`, never origin/main.
4. Invoke pipeline with `noTag: true`; then per PR: dual-adversarial-fix → `/iago-prfix` (single
   tag) per [[feedback-dual-adversarial-fix-before-claude-tag]].
5. **sentria-qc is DELETED on every QC→main promotion** (Sebas merges sentria-qc into main and
   GitHub removes the branch; observed PR #204, 2026-06-11; re-established same-day at the old QC
   tip). Before any `gh pr create`: `git ls-remote --heads origin sentria-qc` — if missing, do NOT
   silently base on main; ask Santiago (he or Sebas re-establishes it). Also expect mid-flight
   promotions: re-fetch + sync-merge the feature branch and re-run the test battery before PR.
