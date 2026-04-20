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
