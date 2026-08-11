---
name: Explicit authorization for high-blast-radius actions
description: Don't infer execute-permission from opinion-seeking phrases; require explicit "go" before launching pipelines, creating PRs, or running destructive ops
type: feedback
originSessionId: 320deca6-40d5-4131-a344-293379d30f22
---
Don't infer execution authorization from opinion-seeking phrases like "wdyt",
"I feel like we can continue", "what do you think", "should we ship".

These are asking for a recommendation, not granting permission to act.

For high-blast-radius actions (running `/iago-execute`, creating PRs, tagging
@claude on GitHub, force-pushing, deleting branches, hitting `/iago-quick`,
launching long background pipelines), require an explicit "go", "yes do it",
"run it", "approved", "ship", or similar.

**Why:** 2026-04-27 incident — Santiago asked "well idk, i feel like we can
continue with plan 02. wdyt?" after the stress test landed. I treated this as
authorization, kicked off `/iago-execute feature-roles --plan 02`, the pipeline
spawned an implement session that started writing files. Santiago corrected:
"i never told you to run. context is filling up in this session. why did you
do this?" — pipeline output streaming into the orchestrator session burns
context, and creating a real branch + PR + tagging @claude is a public action
that can't be undone with an apology. I had to kill the pipeline tree (PIDs
727466, 727499, 727501) and surface the half-written files.

**How to apply:**
- "wdyt" / "should we" / "I feel like" → give an opinionated verdict + offer
  to execute. Wait for explicit "go" before the next tool call that launches
  anything.
- Especially: never invoke `/iago-execute`, `/iago-quick`, `/iago-fast`, or
  any skill that creates PRs/branches/commits without explicit authorization.
- Pipeline output (background task notifications) costs context in the
  launching session even though the pipeline runs in fresh `claude -p`
  sub-sessions. Long pipelines = significant orchestrator context burn.
- The verification of plan 01 prod deploy (Amplify build + Cognito attribute)
  was the right move BEFORE asking for authorization. Don't conflate
  "ready to run" with "user said run".
