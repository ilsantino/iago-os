---
name: general
description: >-
  No-capability fallback for tasks that match no domain profile. Use for
  doc/script/config/markdown and runtime-infra edits with no React/Amplify stack work.
base: executor
model: sonnet
maxTurns: 25
capabilities: []
---

## Match Signals

Dispatch this profile when:
- No domain profile matches — doc/script/config/markdown/runtime-infra and other non-stack edits.

Carries no stack capabilities, so it never force-loads React/DynamoDB/Lambda/Framer
context onto a task that does not need it.

## Review Pairing

After this profile completes, dispatch `review-single` or `review-full`
depending on `review.mode` in config.json.
