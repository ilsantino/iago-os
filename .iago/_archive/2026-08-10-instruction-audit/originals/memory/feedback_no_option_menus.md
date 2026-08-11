---
name: No option menus when directive is explicit
description: When Santiago gives a clear action (e.g. "invoke /iago-execute feature-roles --plan 01"), do not propose multi-option menus or invent blockers
type: feedback
originSessionId: db21cfb4-178d-4479-aa93-37b215ca6afe
---
When Santiago gives an explicit, named action — invoke skill X, run command Y, push branch Z — execute it. Do not propose 3-option menus, hypothetical blockers, or "should we do A, B, or C?" forks.

**Why:** Santiago is decisive and has already weighed alternatives before issuing the directive. Menus burn his time, look like stalling, and signal that I haven't trusted his judgment. Specific incident (2026-04-27): he asked me to invoke `/iago-execute feature-roles --plan 01` with full pre-flight context. I found a dirty `.iago/STATE.md` (his own planning notes) and presented a 3-option menu (commit / stash / leave alone). He responded "wtf are you talking about? shouldnt we just be executing the plan."

**How to apply:** Encounter unexpected state mid-execution → pick the safest reversible default (here: stash, run, restore later) and proceed. Mention the call in one line so he can override. Do NOT pause for a vote unless the action is irreversible (force-push, db drop, prod deploy). Reserve confirmation for actual blast-radius decisions, not minor housekeeping.
