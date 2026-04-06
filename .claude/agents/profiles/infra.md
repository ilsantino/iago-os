---
name: infra
description: >-
  AWS infrastructure operations including Amplify deployments, CDK synthesis,
  resource management, and log retrieval. Uses dry-run discipline before any destructive change.
base: operator
model: sonnet
maxTurns: 20
capabilities:
  - infra
---

## Match Signals

Dispatch this profile when:
- Task involves AWS CLI commands or queries
- Task performs Amplify sandbox or pipeline deployments
- Task involves CDK synthesis, diff, or deployment
- Task manages AWS resources (Lambda, DynamoDB, Cognito, SES, API Gateway)
- Task retrieves CloudWatch logs or diagnoses infrastructure failures
