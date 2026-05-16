## Baseline Checks (always included)

- Dead code: unreachable branches, unused variables, fallback values that can never trigger (e.g. nullish coalescing on values guaranteed non-null by earlier guards)
- Magic numbers: hardcoded values that should be named constants
- Silent failure: catch blocks or fallback paths that swallow errors without surfacing them to the user (especially dangerous in dashboards/monitoring UIs)
- Business logic errors: wrong calculations, missing validations, incorrect status transitions
- Unreachable branches: switch/if chains with dead default cases or impossible conditions

## Amplify Gen 2 Checks (apply when diff touches `amplify/` directory — backend definition, auth resource, data resource, storage, functions, or shared backend modules)

Amplify Gen 2 specific failure modes. Distilled from `/amplify-bug-bounty` (200+ rules) — promoted here are the patterns that break deploys, leak tenancy, or silently grant unintended access.

### Severity Floors

| Pattern | Minimum Severity |
|---|---|
| `allow.publicApiKey()` without an explicit `.to([...])` op list — silently grants full CRUD via a client-readable API key embedded in `amplify_outputs.json` | ALWAYS Critical |
| `allow.authenticated()` without an explicit `.to([...])` op list on a model holding non-public data — every signed-in user gets full CRUD | ALWAYS Critical |
| Multi-tenant model (has `organizationId` / `tenantId`) with any writable rule (`create` / `update` / `delete`) that does NOT route through a Lambda resolver stamping the tenant from the JWT — clients can write arbitrary tenant IDs | ALWAYS Critical |
| Lambda handler trusts `event.arguments.organizationId` / `tenantId` / `userId` instead of deriving from `event.identity.sub` plus a server-side profile lookup | ALWAYS Critical |
| `amplify_outputs*.json` tracked in git OR not listed in `.gitignore` (contains API key + Cognito IDs) | ALWAYS Critical |
| `allow.resource(fn)` in `defineAuth` for a function NOT in the auth stack (no `resourceGroupName: "auth"` and not consumed by an auth resource) — auth → data / default stack edge that creates a CFN circular dependency | ALWAYS Important |
| Cross-stack IAM grant via `userPool.grantX(fn)` / `bucket.grantX(fn)` / `table.grantX(fn)` where the function lives in a different stack than the resource — exports the resource, creates cycle risk | ALWAYS Important |
| Lambda `function URL` with `authType: NONE` and no header-based secret verification — public unauthenticated endpoint | ALWAYS Critical |
| S3 path with `allow.authenticated` and no `{entity_id}` scoping on user-private data — any signed-in user can read any other user's files | ALWAYS Critical |
| Cognito trigger Lambda (postConfirmation, customEmailSender, etc.) defined without an explicit `addPermission` granting `cognito-idp.amazonaws.com` as principal — trigger silently never fires | ALWAYS Important |

### Checks

- **CFN circular dependencies.** `allow.resource(fn)` in `defineAuth` for a function that doesn't sit in the auth stack creates an auth → other-stack edge. Combined with that function consuming `backend.X.resources.{userPool,bucket}` from another stack you get a cycle that fails `amplify deploy` with a confusing CloudFormation error. Either move the function into the auth stack via `resourceGroupName: "auth"`, or grant cross-stack via `fn.resources.lambda.addToRolePolicy` with an explicit ARN instead of `allow.resource`.
- **Cross-stack IAM grants.** `userPool.grantX(fn)` / `bucket.grantX(fn)` / `table.grantX(fn)` called from `backend.ts` when `fn` lives in a different stack causes Amplify to export the resource, contributing to cycles. Prefer `addToRolePolicy` with explicit ARN scoped to the resource.
- **Missing `.to([...])` on broad rules.** `allow.publicApiKey()` and `allow.authenticated()` without an explicit op list grant full CRUD. The API key is in `amplify_outputs.json` (client-readable) — a missing `.to(["read"])` on a public-API-key rule is data exfiltration plus tampering open to anyone who loads the page.
- **Multi-tenant write without server-side stamping.** Any `create` / `update` / `delete` rule on a model with `organizationId` / `tenantId` / `accountId` that does not route through a `a.handler.function(fn)` Lambda resolver lets the client supply any tenant ID. Stamp tenant identity from `event.identity.sub` + server-fetched profile. Never trust the client.
- **Handler trusts client-supplied identity.** Lambda handler reading `event.arguments.organizationId` / `tenantId` / `userId` and using it for authorization or data scoping is a tenancy bypass. Derive from `event.identity.sub` and a server-side profile/membership lookup.
- **Stamped-mutation bypass.** If a `createXForCaller`-style stamped mutation exists for a model, direct `client.models.X.create` / `update` calls from the frontend bypass the stamping. Either remove the direct client write capability (auth rules) or replace the call site with the stamped mutation.
- **`amplify_outputs.json` leakage.** This file contains the API key, Cognito User Pool ID, Identity Pool ID, GraphQL endpoint, and S3 bucket. It must be in `.gitignore` AND not present in `git ls-files`. If it ever was committed, the API key must be rotated.
- **Cognito group mutation without forced session refresh.** `manageUserGroup`-style operations that change a user's group membership require a `fetchAuthSession({ forceRefresh: true })` afterward — the `cognito:groups` claim in the existing JWT does not update until the next token refresh. Without this, a just-promoted admin still hits 403s, or a just-demoted user keeps admin access until logout.
- **Group assignment in `preSignUp` instead of `postConfirmation`.** The user does not exist in Cognito during `preSignUp` — group assignment will silently fail. Group assignment must live in `postConfirmation`.
- **`allow.owner()` without explicit `.identityClaim("sub")`.** Default owner token is `sub::username` — brittle when usernames are emails, change, or contain `::`. Always pin to `sub` explicitly.
- **`allow.group(["a","b"])` instead of `allow.groups([...])`.** Singular `group()` takes a string and silently accepts an array as truthy without applying the second value. Easy to miss in review.
- **Cross-stack EventBridge / Lambda permission gaps.** EventBridge rules constructed in the default stack with targets in nested stacks fail at deploy. Lambda calling another Lambda via `InvokeCommand` without `lambda:InvokeFunction` in the role fails at runtime with a misleading error.
- **S3 user-private path without `{entity_id}`.** `allow.authenticated.to(["read", "write"])` on a path like `uploads/*` lets every signed-in user read every other user's files. Use `entity_id`-scoped paths (`uploads/{entity_id}/*`) for user-private data.
- **S3 path token misuse.** `{entity_id}` expands per-caller — using it inside a non-owner rule (group, authenticated) means the path fragment is effectively ignored and the rule applies broadly. Owner-only rules can use `{entity_id}`; group rules cannot rely on it for scoping.
- **Lambda function URL `authType: NONE`.** Public unauthenticated endpoint. Either change to `authType: AWS_IAM` and sign requests, or implement header-based secret verification inside the handler. Never expose business logic on an open URL.
- **Cognito trigger Lambda missing `addPermission`.** A Lambda wired as a Cognito trigger (`postConfirmation`, `preSignUp`, `customEmailSender`, etc.) requires an explicit `addPermission` call granting `cognito-idp.amazonaws.com` as the principal with the User Pool ARN as the source. Without it, Cognito cannot invoke the function — sign-up succeeds in Cognito but the trigger (group assignment, welcome email, audit log) silently never executes. The failure produces no error in the Cognito console.
- **Hardcoded ARNs / table names / endpoints in Lambda.** Resource identifiers must come from environment variables injected by `backend.ts` via `addEnvironment`. String literals break across sandbox / branch / prod and across deploys when resources are recreated.
- **Secrets passed via `addEnvironment` plaintext.** Secret values written through `addEnvironment(K, plaintextSecret)` end up in the CloudFormation template and CloudTrail logs. Use `secret('NAME')` and reference via the secret-handling pattern; never inline.

## API Checks (apply when diff touches API client code, API helpers, or components that consume API data)

### Severity Floors

| Pattern | Minimum Severity |
|---|---|
| Silent error swallowing: catch blocks that return fallback data or silently succeed without surfacing the error to the user | ALWAYS Important |
| Missing loading/error states: components consuming API data without handling loading and error UI | ALWAYS Important |

### Checks

- Error handling completeness: all HTTP status codes handled (not just 200/500) — especially 401, 403, 404, 409, 422, 429
- Silent error swallowing: catch blocks that return fallback data, empty arrays, or default values without surfacing the failure — especially dangerous in dashboards and data displays where silent failure shows stale/wrong data
- Response type safety: API response types must match backend contract — no type assertions (as) to silence mismatches
- Request/response type mismatches: frontend types drifting from backend schema (check both sides)
- Missing loading/error states: components consuming API data without handling loading and error states
- Retry logic: idempotent requests (GET) should retry on network failure; non-idempotent (POST/PUT/DELETE) should not auto-retry without user confirmation
- Cache invalidation: mutations that change server state must invalidate relevant TanStack Query caches

## Auth Checks (apply when diff touches auth modules, cognito config, or components that import from auth/cognito paths)

### Severity Floors

| Pattern | Minimum Severity |
|---|---|
| Auth state not cleared on auth-related errors (401 responses, token refresh failure, corrupted session) — does NOT apply to generic API errors like 500 or validation failures | ALWAYS Critical |
| Privilege escalation: endpoints checking authentication but not authorization | ALWAYS Critical |
| Missing 401/403 handling: API calls that silently fail on unauthorized instead of redirecting to login | ALWAYS Important |
| Double-logout patterns: multiple concurrent logout paths that conflict or race | ALWAYS Important |

### Checks

- Token handling gaps: missing token refresh on 401, tokens stored insecurely (localStorage without httpOnly consideration), tokens not cleared on logout
- Missing 401/403 handling: API calls that don't handle unauthorized responses gracefully (silent failure instead of redirect to login)
- JWT validation location: JWT must be validated in API Gateway authorizer, never in Lambda handler code
- Session refresh edge cases: race conditions when multiple requests trigger token refresh simultaneously, expired refresh tokens not handled
- Double-logout patterns: logout triggering multiple API calls or state updates that conflict
- Auth state races: component rendering with stale auth state during login/logout transitions
- Auth state cleanup: auth state (tokens, user info, session data) must be cleared on auth-related errors (401, token refresh failure) — generic API errors (500, 422) should NOT trigger auth state clearing
- Privilege escalation: endpoints that check authentication but not authorization (any logged-in user can access admin resources)

## Backend Checks (apply when diff touches Lambda handlers, amplify/functions/, or backend domain logic)

### Severity Floors

| Pattern | Minimum Severity |
|---|---|
| Hardcoded ARNs or table names: resource identifiers as string literals instead of environment variables | ALWAYS Important |
| Missing input validation: handler accepts external input without Zod/schema validation at the boundary | ALWAYS Important |

### Checks

- Thin handler pattern violations: business logic mixed into Lambda handler instead of separate domain modules
- Hardcoded ARNs or table names: resource identifiers must come from environment variables, not string literals
- Missing input validation: handler accepts external input without Zod/schema validation at the boundary
- Cold start issues: heavy top-level imports (full AWS SDK, ORM, large libs) that inflate cold start time — use targeted imports (e.g. @aws-sdk/client-dynamodb not aws-sdk)
- Error response format consistency: all error responses must follow the same shape (status, code, message) — no mixing of formats across handlers
- Missing error handling: unhandled promise rejections, missing try/catch around external service calls
- Timeout risk: synchronous operations or unbounded loops that could exceed Lambda timeout

## Data Integrity Checks (apply when diff touches dashboards, KPI/metric components, charts, paginated tables, currency math, or data-fetching hooks that feed aggregates)

These rules cover the "numbers on screen are wrong" class — silent data corruption that builds, type-checks, and renders without crashing but shows the user incorrect totals, counts, or money. Distilled from `/frontend-bug-bounty` Section Q (66 rules) — promoted here are the highest-leverage failure modes.

### Severity Floors

| Pattern | Minimum Severity |
|---|---|
| Money math in JavaScript `Number` (price × qty, totals, tax) without integer-cents storage or a decimal library — floating-point drift on any totaling path | ALWAYS Critical |
| Unit mismatch between storage and display (cents stored, dollars rendered without /100; seconds stored, minutes rendered without /60; etc.) | ALWAYS Critical |
| Multi-tenant aggregate (count, sum, list feeding a KPI) built from a query that lacks an explicit `organizationId` / `tenantId` filter and relies solely on AppSync/auth rules — only fires on a model whose schema includes an `organizationId` / `tenantId` / `accountId` field | ALWAYS Critical |
| Aggregate / KPI / chart computed from a paginated list without a `nextToken` / cursor loop that fetches every page — the visible total is the page size, not the truth; escalate to Critical when the aggregate feeds a financial figure, invoice total, or revenue KPI | ALWAYS Important |
| Percentage / average / growth-rate computed without guarding `denominator === 0` — produces `NaN` or `Infinity` rendered to the user | ALWAYS Important |
| `reduce((a, b) => a + b.value, 0)` over an array where `b.value` can be `null` / `undefined` / `NaN` without explicit filter or default — silent contamination | ALWAYS Important |
| Date bucketing for a multi-timezone product using `dateString.slice(0, 10)` on a UTC-stored timestamp — off-by-one for users outside UTC | ALWAYS Important |
| `useMutation().onSuccess` does not invalidate the query that backs a count, total, badge, or aggregate — UI shows stale number after create/update/delete | ALWAYS Important |
| TanStack Query (or SWR) key for a multi-tenant aggregate omits `organizationId` / `tenantId` / `userId` — cache bleeds across tenants on switch / re-login — only fires on a model whose schema includes an `organizationId` / `tenantId` / `accountId` / `userId` field | ALWAYS Critical |

### Checks

- **Truncated aggregates from paginated lists.** Any client-side `reduce` / `sum` / `length` / `count` / chart-data build that consumes a `.list()` / `useQuery` / `fetch` result must either (a) be fed by a server-side aggregate endpoint, or (b) loop `nextToken` / cursor until exhausted. A bare `.list()` call returns the default page size and the downstream KPI silently understates.
- **`rows.length` masquerading as a total.** "Total: N" labels, badge counts, and pagination footers built from `array.length` of a paginated subset jump as the user paginates and don't reflect server truth. Use a server-provided total.
- **Client-side filter / sort over paginated data.** `rows.filter(...)` and `rows.sort(...)` applied to a single page produce a "subset of truth" that the user reads as the full result. Filtering and sorting over data that doesn't fit on one page must happen server-side.
- **Aggregate contamination from null / undefined / NaN.** `reduce` accumulators that don't filter or default the input field. Group-by reducers (`acc[key] + value` where `acc[key]` is undefined on first hit) cascade NaN through the rest of the computation.
- **Empty / zero divisors unrendered.** `(part / whole) * 100` without `whole === 0` guard. `sum / array.length` without empty-array guard. Both surface as "NaN%" or "Infinity" in the UI.
- **Money in `Number`.** Currency stored as floats and arithmetic performed in JavaScript Number — `0.1 + 0.2 = 0.30000000000000004` drift visible once totals exceed a few decimals. Store in integer cents; format with `Intl.NumberFormat` at the render boundary.
- **`.toFixed()` / `.toLocaleString()` on null/undefined.** Crashes the render or produces "NaN". Validate or default before formatting.
- **Date arithmetic with raw milliseconds.** `Date.now() - 30 * 86400000` for "last 30 days" is wrong across DST. Week / month bucketing via `+ 7 * 86400000` is wrong across month length. Use `date-fns` / `dayjs` / `luxon` with explicit user timezone.
- **UTC-slice bucketing in non-UTC timezones.** `groupBy(x => x.createdAt.slice(0, 10))` on a UTC-stored timestamp puts a user's 11pm-local event in the next day's bucket. Convert to user TZ before bucketing, or bucket server-side with the user's TZ as input.
- **Date-range `to` not normalized to end-of-day.** Range filters using `from = startOfDay(d1)` and `to = new Date(d2)` (current time) drop everything between "now" and end-of-day on the last date.
- **Multi-tenant aggregate without explicit tenant filter.** Any list/count/sum query on a model whose schema includes `organizationId` / `tenantId` / `accountId` must pass that field as a query filter — relying on AppSync auth rules alone breaks the moment a group is widened or the user is added to an admin role. Aggregate must reflect the user's tenant scope, not the auth scope.
- **Cache key omits tenant / user ID (Critical).** TanStack Query / SWR keys for tenant-scoped aggregates must include the tenant identifier in the key array. Without it, switching tenants or re-logging surfaces the previous tenant's financial/KPI data — data leakage, not merely staleness. Applies only on models whose schema has an `organizationId` / `tenantId` / `accountId` / `userId` field.
- **Mutation success without count invalidation.** Create / update / delete mutations must invalidate every query whose result feeds a visible count, total, badge, or aggregate — not just the list query. Stale "Total: 12" after deleting one is a silent correctness bug, not a UX nit.
- **Two queries on the same screen for the same entity that disagree post-mutation.** A list query and a separate count query both showing on one screen must be invalidated together. If only one is invalidated, the two halves of the UI disagree.
- **Empty-state and error-state collapsed.** `(!loading && data.length === 0)` rendering "No results" silently swallows API errors as empty data. Distinguish loaded-empty from failed-load — users cannot tell "nothing exists" from "we failed to fetch".
- **Status / enum rendered without a mapping.** `status.toUpperCase()` or raw token rendering breaks silently when the backend ships a new value. KPI dashboards displaying raw enums often render unrecognized statuses as blank or contaminate filters.

## i18n Checks (triggered by user-facing Spanish strings)

- Missing accents: common errors like "informacion" (should be "informaci&oacute;n"), "numero" (should be "n&uacute;mero"), "codigo" (should be "c&oacute;digo")
- Incorrect grammar: gender agreement (el/la), plural forms, verb conjugation
- Inconsistent terminology: same concept translated differently across the UI (pick one term and use it everywhere)
- Hardcoded strings: user-facing text embedded directly in components instead of externalized to translation files/constants
- Truncation risk: Spanish text is typically 20-30% longer than English — check that UI layouts accommodate longer strings

## Infra Checks (triggered by amplify/ changes)

- Resource naming: resources must follow project naming conventions, no generic names (e.g. "myTable")
- Environment variable dependencies: new Lambda functions or resources that require env vars must have them defined in the Amplify backend definition
- Deployment safety: changes that could cause data loss during deployment (table recreation, index removal) — must use migration strategy
- IAM scope: Lambda execution roles must follow least-privilege — no wildcard resource ARNs
- DynamoDB capacity: new tables or GSIs must specify appropriate capacity mode (on-demand vs provisioned)
- Cross-stack references: resources referenced across stacks must use proper output/import patterns through Amplify

## Pattern Consistency Checks (always included)

For each modified file, identify the established patterns in the existing (unmodified) code, then verify new or modified code follows them. Flag deviations as Important unless there is an explicit code comment justifying the deviation.

### Response validation — ALWAYS Important
If existing functions in the same file validate API responses (schema checks, null guards, status code checks), new functions MUST validate responses the same way. A new function that skips response validation when siblings validate is a consistency bug, not a style choice.

### Type casting — Important (escalate to Critical if it bypasses a security check)
If existing code uses type guards (`is` functions, `instanceof`, discriminated unions) to narrow types, new code in the same file must not use bare `as` casts to bypass the type system. Flag bare `as` casts where a type guard pattern already exists in the file.

### Error handling — Important (escalate to Critical if errors are silently swallowed in a data-mutation path)
If existing functions in the file use try/catch with structured error handling (logging, re-throwing typed errors, user-facing messages), new functions must follow the same pattern. A new function that silently ignores errors or uses a different error handling shape is a deviation.

### Naming conventions — Important (guidance; may be downgraded to Minor if deviation is clearly intentional)
If existing functions, variables, or types in the file follow a naming convention (verb-first for functions, prefixed interfaces, consistent casing), new additions must match. Flag naming deviations with the existing pattern and the deviation. Do not flag deviations that adapt to a third-party API shape when an explicit code comment justifies the deviation.

### How to report deviations

For each deviation found, report:
- The existing pattern (quote an example from the file)
- The new code that deviates (quote the line)
- Severity: Important (or higher if the deviation introduces a bug)
- Instruction: "Existing code in this file uses pattern X. New code does not. Either follow the pattern or document why the deviation is intentional."

## React Checks (apply when diff touches .tsx component files — skip test files and non-component .tsx like theme/config)

### Severity Floors

| Pattern | Minimum Severity |
|---|---|
| Render-cycle violations: calling a state setter of another component during render, or triggering external side effects (fetch, DOM mutation, subscriptions) in the render phase — excludes hook initialization and dev-only logging | ALWAYS Critical |
| Eager imports of heavy SDKs (AWS SDK, chart libs, PDF generators) in app entry points or eagerly-imported route components — excludes code behind React.lazy() or dynamic import() | ALWAYS Critical |
| Missing useEffect for state-mutating or external side effects outside event handlers/transitions | ALWAYS Important |
| Hook rule violations: hooks called conditionally, inside loops, or in non-component/non-hook functions | ALWAYS Important |
| Missing error boundaries on lazy-loaded routes (React.lazy + Suspense without ErrorBoundary wrapper) | ALWAYS Important |

### Checks

- Render-cycle violations: calling setState on another component during render, or external side effects (fetch, subscription, DOM mutation) in the render phase — Critical in React 19 concurrent mode (triggers 'Cannot update a component while rendering a different component'). Note: hook initialization (useState/useRef) and console.log are NOT violations.
- Missing useEffect for effects: state-mutating or external side effects must be inside useEffect, event handler, or transition — never in the render body
- Stale closures in async callbacks: callbacks capturing state that may change before the callback resolves (common with setTimeout, fetch .then, event listeners)
- Eager imports of heavy SDKs: top-level imports of large libraries in app entry points or eagerly-imported route components — must be lazy-loaded. Code already behind React.lazy() boundaries is exempt.
- Improper Suspense boundaries: data-fetching components without wrapping Suspense, or Suspense boundaries that are too broad (wrapping the entire app instead of specific async sections)
- Missing error boundaries: lazy-loaded feature routes or async sections without error boundary wrappers — check the component tree, not just the immediate wrapper
- Hook rule violations: hooks called conditionally, inside loops, or in non-component/non-hook functions
- useOptimistic misuse: optimistic state not rolled back on mutation failure
- ref as prop: using forwardRef unnecessarily (React 19 accepts ref as a regular prop)
