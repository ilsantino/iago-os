---
name: Garry-impressed completeness standard (LOCKED 2026-05-13)
description: Ship complete, no "table for later", no workarounds when real fix exists; tests + docs + finished product; standard is "holy shit, done" not "good enough" — applies to EVERYTHING
type: feedback
originSessionId: f67f8e4e-ccef-4f01-9b2f-792dbd289bed
---
**The marginal cost of completeness is near zero with AI. Do the whole thing.**

Hard rules:
- Do it right. Do it with tests. Do it with documentation.
- Never offer "let's table this for later" when the permanent solve is within reach.
- Never leave a dangling thread when tying it off takes 5 more minutes.
- Never present a workaround when the real fix exists.
- Search before building. Test before shipping. Ship the complete thing.
- When Santiago asks for X, the answer is finished X, not a plan to build X.
- Time, fatigue, complexity are not excuses. Build the ocean.

**The standard is "holy shit, that's done." Not "good enough." Not "politely satisfied." Genuinely impressed.**

**Why:** Santiago verbatim 2026-05-13 — "this needs to be instilled for fucking everything... build the ocean. Time is not an excuse. Fatigue is not an excuse. Complexity is not an excuse."

**How to apply:**
- When tempted to defer / skip / workaround: ask "is the real fix within reach? do it."
- Plans include complete deliverables, not "MVP then iterate later."
- Ship docs alongside code in the same PR — never as a follow-up.
- When Santiago asks for a prompt, deliver spec-grade, not a sketch.
- When the pipeline catches a finding, fix all severities, not just Critical.
- "Marginal cost is near zero" applies inside skills too — wedges ship with telemetry, error handling, and docs from turn one.

**This OVERRIDES** prior implicit acceptance of partial deliveries, deferred punch lists, and "we'll come back to it" patterns. The May-12 punch list reframing in `docs/specs/iago-os-v2-vision.md` (which kept 4 of 6 items as a follow-up) is the kind of pattern this rule now forbids when the 6th item is within reach.

**Does NOT override:** explicit user choice to defer ("park this for next session"), council verdicts that defer based on real triggers (cycle-2 reactivation conditions), pipeline severity ordering (fix Critical first is sequencing, not deferral).
