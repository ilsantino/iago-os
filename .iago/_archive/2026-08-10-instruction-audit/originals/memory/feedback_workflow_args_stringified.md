---
name: workflow-args-stringified
description: Workflow tool args can arrive in the script as a JSON STRING — always defensive-parse at script top or every A.x reads undefined
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a7c9dfb6-ca7e-4299-a2c2-71a7026b6eb1
  modified: 2026-08-07T18:46:52.487Z
---

The harness may deliver the Workflow tool's `args` input to the script as a JSON-encoded STRING even when passed as a real JSON object in the tool call (observed 2026-08-07, RSF phase-1 workflow: every `args.x` was `undefined` and agents received literal "undefined" paths; also noted earlier in [[project_pipeline_v2]]).

**Why:** property access on a string returns undefined silently — no error, agents just get "undefined" interpolated into prompts and must improvise. Costly to detect mid-run.

**How to apply:** first line of every workflow script body:
`const A = typeof args === 'string' ? JSON.parse(args) : (args ?? {})`
Then validate the critical keys and `throw` early if missing (e.g. `if (!A.scratchDir) throw new Error('args not parsed')`) so the failure is loud at launch, not discovered by agents mid-flight.
