---
name: research
description: >-
  Deep research tasks across codebase, library docs, and web sources.
base: operator
model: sonnet
capabilities:
  - trust-boundary
---

`trust-boundary` is always loaded — this profile fetches untrusted external content. For stack-specific topics, also read the matching `.claude/rules/` file (react-vite, aws-amplify, e2e-testing) before recommending.
