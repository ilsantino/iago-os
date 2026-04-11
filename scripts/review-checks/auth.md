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
