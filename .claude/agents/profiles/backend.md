---
name: backend
description: >-
  Backend-only implementation tasks. Use for tasks confined to Lambda
  handlers, DynamoDB schema, and Cognito configuration with no frontend changes.
base: executor
model: opus
maxTurns: 25
capabilities:
  - dynamodb
  - lambda
  - cognito
  - tdd
---

## Match Signals

Dispatch this profile when:
- Files are only in `amplify/`
- No `src/` files are in scope

## Review Pairing

After this profile completes, dispatch `review-single` or `review-full`
depending on `review.mode` in config.json.
