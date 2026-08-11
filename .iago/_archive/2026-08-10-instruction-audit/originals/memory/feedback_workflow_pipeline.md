---
name: Execution pipeline preferences
description: PR-based workflow with mandatory Codex adversarial review on every plan — not just auth/payment
type: feedback
---

User wants a structured execution pipeline for all client work:
1. Implement (matching profile — fullstack/frontend/backend)
2. Build/typecheck verification (mandatory gate)
3. Internal review (`review-single` or `review-full`)
4. `/codex:adversarial-review` (GPT-5.4 cross-model review) — **mandatory on every plan, not conditional**
5. Fix any issues found
6. Create PR on GitHub (branch per plan)
7. User reviews PR on GitHub
8. Merge to main after approval

**Why:** User explicitly rejected the conditional Codex review (only for auth/data/payment). A different model catches different blind spots — business logic bugs, race conditions in form handlers, state management issues are just as dangerous as auth bugs. The cost delta is trivial compared to catching a Critical bug.

**How to apply:** Always dispatch `/codex:adversarial-review` after internal review passes. Never skip it based on file path heuristics. This is wired into iago-execute, subagent-driven-development, and code-review skills as a mandatory gate.
