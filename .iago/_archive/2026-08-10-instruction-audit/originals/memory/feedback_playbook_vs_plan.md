---
name: PLAYBOOK-v2 entries vs plan files
description: PLAYBOOK-v2 §X.Y entries are NOT the same as .iago/plans/feature-X/0Y.md plan files
type: feedback
originSessionId: 279d0e5d-075f-4320-875b-b75d93a0b256
---
PLAYBOOK-v2.md contains numbered entries (e.g. §1.4, §2.1) that describe the higher-level "what to ship in this step" and embed a `/iago-execute` prompt referencing a plan file. The plan file at `.iago/plans/feature-X/0Y.md` is the implementation artifact created by `/iago-plan`.

These are DIFFERENT artifacts even when the playbook entry references plan execution.

**Why:** Santiago tracks progress against the playbook entries; conflating "playbook §1.4" with "plan 04" gets in the way of communication and triggers frustration. Treat them as separate.

**How to apply:** When Santiago says "1.4" or "the §1.4 prompt", that's a PLAYBOOK-v2 entry. When he says "plan 04" or references a path under `.iago/plans/`, that's a plan file. Acknowledge the distinction explicitly. The playbook entry's embedded prompt is what kicks off plan execution; once the plan file exists and was implemented, the playbook prompt is "past" — re-running it would re-execute, not re-create.
