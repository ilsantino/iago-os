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
