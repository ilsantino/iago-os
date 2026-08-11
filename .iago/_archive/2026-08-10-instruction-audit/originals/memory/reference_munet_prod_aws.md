---
name: Munet prod on Sebas's AWS account
description: munet-web production deployment lives on Sebas's AWS account (851725296610), not Santiago's (582071018864)
type: reference
---

munet-web production is on **Sebas's AWS account** (851725296610), not Santiago's iaguito account (582071018864).

- **Amplify app:** `d2fjob0jvax0j8` (repo: `bas-labs/munet-web`, branch: `main`)
- **Prod Cognito pool:** `us-east-1_b4qCU2ISW` (tag: `amplify:deployment-type: branch`)
- **Sandbox Cognito pool:** `us-east-1_bdi79wUEO` (tag: `amplify:deployment-type: sandbox`)
- **Client ID (prod):** `5mmvsd7l6ref3ido9fp9chlm09`
- **Groups:** Admin, Operador
- **IAM user on that account:** `il-santino` (admin access)
- **Console:** `aws-bas-v1.signin.aws.amazon.com/console`
- **Santiago's account (582071018864):** has its own sandbox pool (`us-east-1_qbFsIWnso`) — that's the local dev sandbox
- **Prod Stripe publishable key:** `pk_test_51T72QdAD4vYaRpxm6pW0i8vLUWtBIw57eW68njNoRiuljHnPCexwJD3jGFBxB689wCgEB7842llFwRsUOyrV0aCU00a6SSEY9P` (set as Amplify branch env var on main)
- **Backend secrets (SSM):** NOT SET — Lambda functions reference SSM paths but no parameters exist for sandbox or production. Must set via `npx ampx secret set` (sandbox) or `npx ampx secret set --branch main` (prod)
- **Other Amplify apps on same account:** valideoai, sentria, pulsara, palazuelos-web, iago-web

**Why:** First time I looked only on Santiago's account and couldn't find prod. Wasted time.
**How to apply:** For any munet-web prod operations (Cognito, DynamoDB, Lambda, Amplify), use Sebas's account credentials (il-santino). Always check which account you're authenticated to first. AWS CLI default profile is now configured with il-santino keys.
