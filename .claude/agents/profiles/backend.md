---
name: backend
description: >-
  Backend-only implementation tasks. Use for tasks confined to Lambda
  handlers, DynamoDB schema, and Cognito configuration with no frontend changes.
base: executor
model: opus
capabilities:
  - dynamodb
---

Scope: files only in `amplify/` (no `src/`). Stack standards load via path-scoped rules (aws-amplify.md).
