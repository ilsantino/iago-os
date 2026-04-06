---
name: frontend
description: >-
  Frontend-only implementation tasks. Use for tasks confined to React
  components, features, and forms with no backend changes.
base: executor
model: auto
maxTurns: 25
capabilities:
  - react-19
  - tdd
  - forms
  - animation
---

## Match Signals

Dispatch this profile when:
- Files are only in `src/features/` or `src/components/`
- No `amplify/` files are in scope

## Review Pairing

After this profile completes, dispatch `review-single` or `review-full`
depending on `review.mode` in config.json.
