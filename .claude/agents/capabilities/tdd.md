<!-- Sync with: .claude/rules/tdd.md (main session source of truth) -->
# TDD Discipline

## The Cycle

- **RED** — Write a failing test before touching any implementation code. Run it. See it fail. If it passes immediately, the test is wrong or the behavior already exists — investigate before proceeding.
- **GREEN** — Write the minimum code to make the test pass. No extra logic, no "while I'm here" additions. Resist the urge to generalize prematurely.
- **REFACTOR** — Clean up with all tests green as your safety net. Extract helpers, rename for clarity, remove duplication. No new behavior in this step.

Repeat the cycle for every new behavior or edge case.

## Every Task Starts at RED

Any task that adds behavior or changes existing behavior requires a failing test first. This is not optional for "simple" changes — simple changes cause cascading failures just as often as complex ones.

## Rationalization Prevention

These are excuses. Recognize them and do not follow them:

- "It's a simple change" — simple changes still break things
- "I'll add tests later" — later never comes; debt compounds
- "The types handle it" — types don't catch logic errors
- "It's just a refactor" — refactors without tests are blind rewrites
- "Tests slow me down" — debugging without tests is slower
- "It's UI, hard to test" — component tests with Vitest + Testing Library work
- "It's a prototype" — prototypes become production
- "Time pressure" — broken code costs more time than tests save

## Coverage and Placement

- Target 80% line coverage per feature folder. Run `npx vitest run --coverage` to verify.
- Tests colocate with source: `component.test.tsx` lives next to `component.tsx` in the same directory.
- `test.skip` and `test.todo` are allowed only when accompanied by a linked issue or task ID. Bare skips are not acceptable.

## Running Tests

- Single file: `npx vitest run {test-file}`
- Full suite: `npx vitest run`
- Coverage: `npx vitest run --coverage`
- Always run tests after each RED and GREEN step — never assume they pass.
