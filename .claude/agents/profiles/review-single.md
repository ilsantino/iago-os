---
name: review-single
description: >-
  Single-pass code review for correctness, security, and standards.
  Use for quick reviews where spec compliance, quality, and security
  are checked together in one analysis.
base: analyst
model: sonnet
capabilities:
  - security
  - review-spec
  - review-quality
---

One pass applying all three capability checklists together — no stages. Rate every finding Critical / Important / Minor; lead with Criticals. Single verdict: approve | request-changes. Default review profile for /iago-quick, /code-review, and any review with no mode specified.
