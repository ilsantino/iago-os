## API Checks (triggered by lib/api changes)

- Error handling completeness: all HTTP status codes handled (not just 200/500) — especially 401, 403, 404, 409, 422, 429
- Response type safety: API response types must match backend contract — no type assertions (as) to silence mismatches
- Request/response type mismatches: frontend types drifting from backend schema (check both sides)
- Missing loading/error states: components consuming API data without handling loading and error states
- Retry logic: idempotent requests (GET) should retry on network failure; non-idempotent (POST/PUT/DELETE) should not auto-retry without user confirmation
- Cache invalidation: mutations that change server state must invalidate relevant TanStack Query caches
