# Capability: Code Quality Review

Run diagnostics first and report results before manual review: `npx tsc --noEmit`, `npx biome check`.

Then review performance, maintainability, and stack conventions against the project's path-scoped rules (react-vite, aws-amplify, e2e-testing).

Severity floors (never downgrade):

- `any` type — Critical
- `as` cast without a type guard — Important
- `@ts-ignore` / `@ts-expect-error` without justification — Important
- Non-null `!` assertion without proven safety — Important
- Missing return types on exported functions — Minor
- Security vulnerability or data-loss risk — Critical
- Performance problem, missing error handling, test gap — Important
