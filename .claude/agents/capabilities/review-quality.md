# Capability: Code Quality Review

Assess code quality across performance, security, maintainability, and stack conventions.

## Diagnostics (run first)

- `npx tsc --noEmit` — report any type errors
- `npx biome check` — report any lint or format issues
- Report results before proceeding to manual review

## Performance

- React: flag missing `useMemo`/`useCallback` on expensive computations, unnecessary re-renders, components that should use `React.lazy()` for route splitting
- DynamoDB: flag N+1 query patterns, missing `ProjectionExpression` on large items, hot partition keys, missing GSI for required access patterns
- Lambda: flag heavy top-level imports (cold start impact), bundle size issues, timeout mismatches (API handlers 30s, async up to 15min)

## TypeScript Strictness

- `any` types — Critical
- `as` casts without a type guard — Important
- `@ts-ignore` or `@ts-expect-error` without justification — Important
- Non-null assertions (`!`) without proven safety — Important
- Missing return types on exported functions — Minor

## Maintainability

- Clear, intention-revealing naming
- No duplicated logic that could be extracted
- Appropriate function size and complexity
- Separation of concerns: UI logic stays in components, business logic in domain modules

## React Conventions

- `use()` + `<Suspense>` for data loading — flag any `useEffect` used for data fetching
- Error boundaries present at feature route level
- Stable, non-index list keys

## DynamoDB Conventions

- Access patterns match the defined schema and GSI design
- Batch write max 25 items, batch get max 100 items
- TTL attribute used for sessions, tokens, and temporary records

## Finding Severity

- **Critical** — security vulnerability, data loss risk, type safety violation (`any`)
- **Important** — performance problem, missing error handling, test gap
- **Minor** — naming suggestion, minor duplication, cosmetic organization
