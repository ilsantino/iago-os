---
description: >-
  Playwright E2E conventions for React 19 + Vite projects.
globs:
  - "**/*.{test,spec}.{ts,tsx}"
  - "e2e/**"
---

## Playwright E2E

- `playwright.config.ts` at root: baseURL `http://localhost:5173`, `webServer` starts Vite, screenshots `only-on-failure`. Chromium only locally; chromium + firefox + webkit in CI.
- Layout: `e2e/{feature}.spec.ts`; shared fixtures/page objects in `e2e/fixtures/`.
- Selector priority: `getByTestId` > `getByRole` > `getByText`. Adding `data-testid` to components for E2E is the one sanctioned source change for testability.
- Auth: `storageState` from global setup; Cognito test users created in fixtures, cleaned in global teardown; credentials from env vars.
