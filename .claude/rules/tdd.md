---
description: >-
  RED-GREEN-REFACTOR discipline, rationalization prevention, 80% coverage target.
  Always active for all code changes.
---

## TDD Cycle

1. **RED** — Write a failing test first. Run it. See it fail. If it passes, your test is wrong.
2. **GREEN** — Write the minimum code to make the test pass. No extra logic, no "while I'm here."
3. **REFACTOR** — Clean up with the safety net of passing tests. No new behavior in this step.

Repeat. Every feature, every bug fix, every refactor starts at RED.

## Test Runner

- **Unit/Integration:** Vitest — `npx vitest run` (single pass), `npx vitest` (watch)
- **E2E:** Playwright — `npx playwright test` (see rules/e2e-testing.md)
- **Coverage:** `npx vitest run --coverage` — target 80% line coverage per feature folder

## Rationalization Prevention

These are excuses. Recognize them. Do not follow them.

| Excuse | Reality |
|--------|---------|
| "It's a simple change" | Simple changes cause cascading failures |
| "I'll add tests later" | Later never comes; coverage debt compounds |
| "The types handle it" | Types don't catch logic errors or edge cases |
| "It's just a refactor" | Refactors without tests are blind rewrites |
| "Tests slow me down" | Debugging without tests is slower |
| "It's UI, hard to test" | Component tests with Vitest + Testing Library work |
| "It's a prototype" | Prototypes become production; debt starts here |
| "Integration tests cover it" | Integration tests are slow and coarse-grained |
| "It's third-party code" | Test your integration with third-party code |
| "Time pressure" | Broken code costs more time than tests save |
| "It works on my machine" | Tests prove it works everywhere |

## Coverage Rules

- New feature: tests required before merge
- Bug fix: regression test required (proves the bug existed, proves it's fixed)
- Refactor: existing tests must stay green; add tests if coverage drops
- Skip (`test.skip`, `test.todo`): allowed only with a linked issue or task ID

## File Placement

Tests colocate with source: `component.tsx` + `component.test.tsx` in the same directory.
E2E tests live in `e2e/` at project root.
