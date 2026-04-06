# E2E Testing Capability

Apply these patterns when writing or reviewing Playwright end-to-end tests.

## Selector Priority

- First choice: `data-testid` attributes — `page.getByTestId("submit-btn")`
- Second choice: accessible roles — `page.getByRole("button", { name: "Submit" })`
- Third choice: text content — `page.getByText("Welcome")`
- Never use CSS selectors, XPath, or DOM structure traversal

## Assertions

- Use Playwright's built-in `expect` with auto-retry: `await expect(locator).toBeVisible()`
- Never call `page.waitForTimeout()` — use `expect` auto-retry or `page.waitForSelector()` instead
- Assert the final state the user sees, not intermediate loading states
- Suspense boundaries: wait for content to appear, not for loading spinners to disappear

## Test Independence

- Each test must set up its own state — no test may depend on state left by another test
- No shared mutable state between tests
- Use `storageState` for authenticated tests: log in once in global setup, reuse the saved session across the suite
- Never hardcode credentials — use environment variables (`PLAYWRIGHT_TEST_USER`, `PLAYWRIGHT_TEST_PASS`)

## Structure

- Page Object Model for any page with more than a few interactions: encapsulate selectors and actions in `e2e/fixtures/{feature}.page.ts`
- One spec file per feature or user flow: `e2e/{feature}.spec.ts`
- Add `data-testid` attributes to source components when writing E2E tests — this is the correct way to make components testable

## Configuration

- Screenshots on failure: set `use.screenshot: "only-on-failure"` in `playwright.config.ts`
- Base URL: `http://localhost:5173` (Vite dev server)
- Browsers: chromium only for local dev; chromium + firefox + webkit in CI
