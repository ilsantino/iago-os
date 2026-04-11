## Auth Checks (triggered by auth/cognito changes or auth imports)

- Token handling gaps: missing token refresh on 401, tokens stored insecurely (localStorage without httpOnly consideration), tokens not cleared on logout
- Missing 401/403 handling: API calls that don't handle unauthorized responses gracefully (silent failure instead of redirect to login)
- JWT validation location: JWT must be validated in API Gateway authorizer, never in Lambda handler code
- Session refresh edge cases: race conditions when multiple requests trigger token refresh simultaneously, expired refresh tokens not handled
- Double-logout patterns: logout triggering multiple API calls or state updates that conflict
- Auth state races: component rendering with stale auth state during login/logout transitions
- Privilege escalation: endpoints that check authentication but not authorization (any logged-in user can access admin resources)
