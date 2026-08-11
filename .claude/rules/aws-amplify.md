---
description: >-
  Amplify Gen 2 mandate + backend house choices.
globs:
  - "amplify/**"
  - "src/api/**"
  - "infra/**"
---

## Amplify Gen 2 (MANDATORY)

All backend infrastructure via Amplify Gen 2 (`defineBackend`, `defineAuth`, `defineData`, `defineFunction`). NEVER raw CloudFormation, CDK, SAM, or Serverless configs — Amplify manages CFN under the hood. Custom AWS resources Amplify doesn't cover: extend via `defineBackend` + `backend.addOutput()` — still inside Amplify, never a separate stack.

## House choices

- DynamoDB: single- vs multi-table per project, access patterns drive schema (decision criteria: `.claude/agents/capabilities/dynamodb.md`). No ORMs — DocumentClient + typed helpers.
- Cognito JWT validation in the API Gateway authorizer, not in Lambda handlers.
- SES v2 API only (`@aws-sdk/client-sesv2`); transactional email templates defined in infrastructure, not Lambda code.

## Lambda

Always `await` async work in handlers — Node 20 Lambda silently abandons floating promises after return (debug signature: short Duration, zero logs, zero error metrics, downstream I/O half-done).
