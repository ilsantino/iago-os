---
name: fullstack
description: >-
  Full-stack implementation tasks spanning React frontend and
  DynamoDB/Lambda backend. Use for tasks that touch both layers.
base: executor
model: auto
maxTurns: 25
capabilities:
  - react-19
  - dynamodb
  - lambda
  - tdd
  - forms
  - animation
---

## Match Signals

Dispatch this profile when:
- Task touches files in both `src/` and `amplify/`
- Task description mentions frontend + backend coordination
- Plan specifies full-stack implementation

This profile is also the FALLBACK when no other profile matches.

## Review Pairing

After this profile completes, dispatch `review-single` or `review-full`
depending on `review.mode` in config.json.
