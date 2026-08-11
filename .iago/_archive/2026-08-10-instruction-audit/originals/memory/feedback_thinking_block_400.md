---
name: feedback_thinking_block_400
description: "The recurring \"400 thinking blocks cannot be modified\" API error — harness bug, root cause, operational mitigations"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4c56c73a-17b1-4588-8204-d1c939cd9d4a
---

The recurring API error Santiago hits ("you keep getting fucking api error") is the harness bug **`400 messages.N.content.M: 'thinking' or 'redacted_thinking' blocks in the latest assistant message cannot be modified`**. Verified 2026-05-30: of 38 real API errors in iago-os transcripts, 16 were this (100% of all 400s), spiking to 13 on 2026-05-30 alone (vs 1–5/day before), on harness 2.1.113 + 2.1.154.

**Root cause:** with interleaved/extended thinking ON, the API requires the latest assistant message's thinking block be resent byte-identical. Claude Code mutates it when context gets spliced between Claude's thinking turn and the next request. Dominant trigger here: **a dynamic Workflow finishing and the orchestrator re-rendering the launching turn** (matches heavy `/iago-execute` Workflow use). Other triggers: pasting a file mid-turn, a queued "continue", toggling permission mode (shift+tab) mid-stream. 1M context amplifies it. It then retry-storms (re-sends the broken payload, re-fails seconds apart). NOT fixable in project code — it's harness message-array construction.

**Why:** crashes the foreground session render but NOT background Workflows — the subagents finish and persist to journal.jsonl. This is why pushing work into Workflows survives the crash.

**How to apply:**
- When it hits mid-pipeline, RECOVER don't re-run — read verdicts from `…\{sessionId}\subagents\workflows\{wf_id}\journal.jsonl` (`type:"result"` lines). See [[feedback_workflow_journal_recovery]].
- `/clear` immediately (it's sticky); adopt a /clear cadence after each long run instead of one endless 1M thread.
- Don't inject context right after a thinking turn (file paste / "continue" / shift+tab) — let the turn finish first.
- Keep the orchestrator's own context short: invoke skill → let Workflow run → /clear → read journal/summary. Don't narrate stacked plans in one thread.
- Consider lowering thinking on the long hub session; keep it in fresh isolated subagent stages.
- Update Claude Code (spiked on a recent version — likely a regression worth reporting to Anthropic).
