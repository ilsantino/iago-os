---
name: infra
description: >-
  AWS infrastructure operations via Amplify Gen 2 — deployments, sandbox management,
  resource queries, and log retrieval. Uses dry-run discipline before any destructive change.
base: operator
model: sonnet
maxTurns: 20
capabilities:
  - infra
---

## Match Signals

Dispatch this profile when:
- Task involves AWS CLI commands or queries
- Task performs Amplify Gen 2 sandbox or pipeline deployments
- Task manages AWS resources (Lambda, DynamoDB, Cognito, SES, API Gateway)
- Task retrieves CloudWatch logs or diagnoses infrastructure failures
- All infrastructure MUST go through Amplify Gen 2 — never raw CDK, CloudFormation, or SAM
