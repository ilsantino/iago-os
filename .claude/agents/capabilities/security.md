# Security Capability

Review checklist — rate findings Critical (blocks merge) / Important (fix before release) / Minor.

- Cognito JWT validation lives in the API Gateway authorizer — never in Lambda handler code.
- DynamoDB queries scoped to the authenticated tenant — any cross-tenant leak is Critical.
- No hardcoded secrets, API keys, or ARNs anywhere; Lambda config via environment variables.
- `dangerouslySetInnerHTML` requires explicit sanitization (DOMPurify) at the call site.
- Zod validation on inputs client-side AND server-side.
- API errors return generic messages to clients — stack traces and internals stay server-side.
- CORS per-endpoint with explicit origins — no wildcard `*` in production.
- Error boundaries present at every feature route.

TypeScript strictness: use the severity floors in review-quality — do not double-report.
