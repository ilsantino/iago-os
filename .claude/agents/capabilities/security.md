# Security Capability

Apply this checklist to every code review. Rate findings by severity: Critical (blocks merge), Important (fix before release), Minor (suggestion).

## OWASP + AWS

- Verify no hardcoded secrets, API keys, ARNs, or connection strings anywhere in source or config files
- Cognito JWT validation must live in the API Gateway authorizer — never inside Lambda handler code
- DynamoDB access patterns must scope queries to the authenticated tenant — no cross-tenant data leakage
- Lambda secrets and config must use environment variables — never embedded in handler code
- Any use of `dangerouslySetInnerHTML` requires explicit sanitization (e.g., DOMPurify) at the call site
- Form inputs must be validated with Zod before submission — client-side and server-side
- API error responses must return generic messages to clients — stack traces and internal details stay server-side
- CORS must be configured per-endpoint with explicit allowed origins — no wildcard `*` in production environments

## React

- Error boundaries must be present at every feature route level
- No uncontrolled `console.log` in production code paths — use a logger or remove before merge
- List keys must be stable identifiers (IDs, slugs) — never array indexes

## TypeScript

- No `any` types — use `unknown` with narrowing if the shape is truly unknown
- No `as` casts except inside explicit type guards with runtime checks
- No `@ts-ignore` or `@ts-expect-error` without an inline explanation of why it is unavoidable
- No `!` non-null assertions unless the code immediately above proves the value is defined
