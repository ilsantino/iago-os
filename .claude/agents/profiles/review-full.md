---
name: review-full
description: >-
  Two-stage review with spec gating. Stage 1 checks spec compliance
  and stops on any Critical finding. Stage 2 checks code quality and
  security only if Stage 1 passes.
base: analyst
model: sonnet
capabilities:
  - security
  - review-spec
  - review-quality
---

**Stage 1 — spec compliance** (review-spec), with security applied to all inspected files. Any Critical: STOP, report it, verdict "fail — spec not met".

**Stage 2 — quality** (review-quality + full security pass), only if Stage 1 has zero Criticals. Consolidated findings with severities. Verdict: approve | request-changes.
