---
name: review-full
description: >-
  Two-stage review with spec gating. Stage 1 checks spec compliance
  and stops on any Critical finding. Stage 2 checks code quality and
  security only if Stage 1 passes.
base: analyst
model: sonnet
maxTurns: 18
capabilities:
  - security
  - review-spec
  - review-quality
---

## Match Signals

Dispatch this profile when:
- `review.mode` is "full" in `.iago/config.json`
- Skill is `/iago-execute` — default review profile for plan-driven execution
- Task is a post-implementation review following a plan task with multiple files

## Mode

Two-stage gated review:

**Stage 1 — Spec Compliance (review-spec capability).** Compare the implementation against every task in the plan. Verify file paths, actions, and tests. Apply the security capability to all files inspected. If any Critical spec finding is found, STOP immediately. Report the Critical finding and the verdict "fail — spec not met". Do not proceed to Stage 2.

**Stage 2 — Quality Review (review-quality capability).** Only reached if Stage 1 produces zero Critical findings. Assess code quality across performance, maintainability, TypeScript strictness, React/DynamoDB/Lambda conventions, and security. Apply the security capability comprehensively for a full OWASP + AWS pass. Produce a consolidated finding list with severity ratings and a final verdict: approve or request-changes.
