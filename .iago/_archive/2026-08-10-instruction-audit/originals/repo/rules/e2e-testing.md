---
description: >-
  Playwright E2E testing conventions for React 19 + Vite projects.
globs:
  - "**/*.{test,spec}.{ts,tsx}"
  - "e2e/**"
---

## Setup

- Playwright config at project root: `playwright.config.ts`
- Base URL: `http://localhost:5173` (Vite dev server)
- Start server before tests: `webServer` config in playwright.config.ts
- Browsers: chromium only for local dev; chromium + firefox + webkit in CI

## Test Structure

```
e2e/
  fixtures/         # Shared test fixtures and page objects
  {feature}.spec.ts # One spec file per feature or user flow
```

## Selectors

Priority order:
1. `data-testid` attributes — `page.getByTestId("submit-btn")`
2. Accessible roles — `page.getByRole("button", { name: "Submit" })`
3. Text content — `page.getByText("Welcome")`
4. Never use CSS selectors, XPath, or DOM structure

Add `data-testid` in components when writing E2E tests — this is the one case where modifying source for testability is correct.

## Assertions

- Use Playwright's built-in `expect` with auto-retry: `await expect(page.getByText("Done")).toBeVisible()`
- Never use `page.waitForTimeout()` — use `expect` with auto-retry or `page.waitForSelector()`
- Assert final state, not intermediate states

## Authentication

- Use `storageState` for authenticated tests — log in once in global setup, reuse session
- Cognito test users: create in test fixtures, clean up in global teardown
- Never hardcode credentials in test files — use environment variables

## Patterns

- Page Object Model for complex pages: encapsulate selectors and actions
- Isolate tests: each test must not depend on state from another test
- Parallel execution: tests must be independent — no shared mutable state
- Screenshots on failure: configured in playwright.config.ts `use.screenshot: "only-on-failure"`

## React 19 Considerations

- Suspense boundaries: wait for content to load, not for loading indicators to disappear
- Server components: test the rendered output, not the component internals
- Transitions: use `expect` auto-retry to handle concurrent rendering delays
