## Backend Checks (triggered by lambda/handler changes)

- Thin handler pattern violations: business logic mixed into Lambda handler instead of separate domain modules
- Hardcoded ARNs or table names: resource identifiers must come from environment variables, not string literals
- Missing input validation: handler accepts external input without Zod/schema validation at the boundary
- Cold start issues: heavy top-level imports (full AWS SDK, ORM, large libs) that inflate cold start time — use targeted imports (e.g. @aws-sdk/client-dynamodb not aws-sdk)
- Error response format consistency: all error responses must follow the same shape (status, code, message) — no mixing of formats across handlers
- Missing error handling: unhandled promise rejections, missing try/catch around external service calls
- Timeout risk: synchronous operations or unbounded loops that could exceed Lambda timeout
