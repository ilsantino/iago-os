## Infra Checks (triggered by amplify/ changes)

- Resource naming: resources must follow project naming conventions, no generic names (e.g. "myTable")
- Environment variable dependencies: new Lambda functions or resources that require env vars must have them defined in the Amplify backend definition
- Deployment safety: changes that could cause data loss during deployment (table recreation, index removal) — must use migration strategy
- IAM scope: Lambda execution roles must follow least-privilege — no wildcard resource ARNs
- DynamoDB capacity: new tables or GSIs must specify appropriate capacity mode (on-demand vs provisioned)
- Cross-stack references: resources referenced across stacks must use proper output/import patterns through Amplify
