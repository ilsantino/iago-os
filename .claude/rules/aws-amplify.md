---
description: >-
  AWS Amplify Gen 2, DynamoDB, Lambda, Cognito, SES, and API Gateway patterns.
globs:
  - "amplify/**"
  - "src/api/**"
  - "infra/**"
---

## Amplify Gen 2

- Define resources with TypeScript: `defineBackend`, `defineAuth`, `defineData`, `defineFunction`
- Backend definition in `amplify/backend.ts` — single entry point
- Auth in `amplify/auth/resource.ts` — Cognito configuration
- Data in `amplify/data/resource.ts` — AppSync/DynamoDB schema
- Functions in `amplify/functions/{name}/handler.ts` — one directory per Lambda
- Use `amplify sandbox` for local development — creates isolated cloud sandbox

## DynamoDB

- Single-table design — access patterns drive schema, not entity relationships
- Partition key (`pk`) and sort key (`sk`) encode entity type and relationships
- GSI for alternate access patterns — plan GSIs upfront, max 5 per table
- Use `DocumentClient` with typed helpers — no ORMs, no Mongoose-style abstractions
- TTL attribute for auto-expiring records (sessions, temp tokens)
- Consistent reads only when required — default to eventually consistent
- Batch operations: `batchWrite` max 25 items, `batchGet` max 100 items

## Lambda

- Thin handler pattern: handler validates input + calls domain function + formats response
- Domain logic in separate modules — testable without Lambda context
- Cold start mitigation: keep bundle small, avoid heavy imports at top level
- Runtime: Node.js 20 — use ESM (`"type": "module"` in package.json)
- Timeout: 30s default for API handlers, up to 15min for async processing
- Environment variables for config — never hardcode ARNs or table names

## Cognito

- JWT validation in API Gateway authorizer — not in Lambda handler code
- User pools for authentication, identity pools only if direct AWS service access needed
- Custom attributes: prefix with `custom:` — plan schema upfront, attributes cannot be deleted
- Pre-signup trigger for email domain validation or invite-only flows
- Token refresh: handle 401 responses in client with automatic token refresh via Amplify client

## SES

- Verified identities (domain or email) before sending — sandbox limits apply until production access
- Use SES v2 API (`@aws-sdk/client-sesv2`) — not the legacy SES client
- Templates for transactional emails — define in infrastructure, not in Lambda code
- Sending rate: respect account-level rate limits, implement exponential backoff
- Always include unsubscribe headers for non-transactional email (CAN-SPAM compliance)

## API Gateway

- REST API with Lambda proxy integration — API Gateway handles CORS, auth, throttling
- Stage variables for environment-specific config (dev/staging/prod)
- Request validation: use API Gateway models for basic shape validation, Zod in Lambda for business rules
- Usage plans + API keys for external consumers — not for internal auth (use Cognito for that)
