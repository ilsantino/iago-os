---
name: Don't push optional verification gates as required
description: When the pipeline (148/148 tests + 3-pass review + Codex) has already covered correctness, don't insist on extra synthetic-curl/manual-QA gates as if they're required to advance
type: feedback
originSessionId: db21cfb4-178d-4479-aa93-37b215ca6afe
---
When the local pipeline has run cleanly — build gate green, 3-pass review PASS, Codex P0/P1 findings fixed, full unit test suite green — and the change is backend-only with explicit transitional fallbacks, the heavy verification is already done. Treat additional synthetic curl matrices, manual QA scripts, and post-deploy regression sweeps as **optional polish**, not blocking gates, unless the change category demands them (PHI/financial/auth-critical with no test coverage).

**Why:** Specific incident (2026-04-27, plan feature-roles/01): I wrote a 20-row synthetic curl runbook + verification script after the pipeline already had 148 passing tests covering the same gates. Santiago: "wtf is my jwt. i really just want to start with 1.2". The curl matrix was theoretically thorough but redundant with what the pipeline already proved, and getting JWTs/API_BASE/coordinating with a scanner login adds friction that doesn't move the needle. The earlier Codex stage already caught the only real bug.

**How to apply:** When the user asks "do I need to test X before moving on", default to NO if the pipeline + tests cover it. Recommend the cheapest possible smoke check (open the app, click 3 things) as the practical regression gate — not a multi-step matrix that requires JWT extraction and prod URL discovery. Reserve full synthetic-curl matrices for: changes deployed to systems with NO unit test coverage, multi-tenant data isolation gates, payment flows, or post-incident hardening sweeps. If the user asks "should I run the verification you wrote", remind them it's optional polish.
