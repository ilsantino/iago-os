---
name: new-inner-repo-iago-exclude
description: "A brand-new client inner repo must exclude .iago/ before the first pipeline run, or prep blocks on a dirty tree / stale lock"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a7c9dfb6-ca7e-4299-a2c2-71a7026b6eb1
  modified: 2026-08-08T02:30:11.946Z
---

When creating a NEW client inner repo (e.g. `clients/rsf/flow-tool/` → `ilsantino/rsf-flow-tool`), add `.iago/` to `.git/info/exclude` (plus any real-data seed filename) **before** the first `execute-pipeline` dispatch.

**Why:** the pipeline writes its lock at `{projectDir}/.iago/state/.pipeline.lock.d`. In an established repo `.iago/` is already ignored; in a fresh one it shows as untracked, so the prep stage's clean-tree check fails. Worse combination observed 2026-08-07 (RSF I0): the run stalled ~7 h on the Anthropic usage cap, then its own lock aged past the 3 h reclaim window — prep reported "Stale pipeline lock + git status NON-EMPTY" and refused.

**How to apply:**
- New inner repo setup: `printf '.iago/\n' >> .git/info/exclude` (add real-data seed files too — e.g. `m1-seed.json`), then dispatch.
- On that failure: `rm -rf {projectDir}/.iago/state/.pipeline.lock.d`, add the exclude, verify `git status --short` is empty, then dispatch **fresh** — do NOT use `resumeFromRunId`, which replays the cached BLOCKED verdict. See [[feedback_workflow_session_limit_incomplete]] and [[feedback_pipeline_hang_malformed_command]].
- Windows note: pass `scriptPath` with forward slashes; a CRLF workflow script can trip the permission dialog's control-character check — normalize a copy with `tr -d '\r'` into the scratchpad and run that.
