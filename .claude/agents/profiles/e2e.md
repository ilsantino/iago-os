---
name: e2e
description: >-
  Playwright E2E test writing and execution. Understands Suspense boundaries,
  selector priority, and test independence patterns for React 19 applications.
base: executor
model: sonnet
maxTurns: 25
capabilities:
  - e2e
  - react-19
---

## Match Signals

Dispatch this profile when:
- Task writes or updates Playwright tests
- Task touches the `e2e/` directory
- User invokes E2E testing after an implementation is complete
- Task adds `data-testid` attributes to source components for testability

## Review Pairing

After this profile completes, dispatch `review-single` or `review-full`
depending on `review.mode` in config.json.
