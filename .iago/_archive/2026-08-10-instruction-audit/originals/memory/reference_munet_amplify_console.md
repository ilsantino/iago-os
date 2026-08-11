---
name: reference-munet-amplify-console
description: Direct Amplify console URLs for munet.mx prod deploys — look there FIRST instead of CLI forensics
metadata: 
  node_type: memory
  type: reference
  originSessionId: 45aeb81f-90cf-4757-9ede-ddd7c15a9cb3
---

MUNET prod deployment console (account 851725296610, us-east-1):

- **Deployments (job status + clickable logs):** https://us-east-1.console.aws.amazon.com/amplify/apps/d2fjob0jvax0j8/branches/main/deployments
- App overview: https://us-east-1.console.aws.amazon.com/amplify/apps/d2fjob0jvax0j8/overview

**Why:** Santiago's feedback 2026-07-04 — "you did way too much, you can just access it and look at it." When checking whether a deploy landed, give him (or open) the console page first; reserve CLI for automation (watchers, `start-job RELEASE`, policy pruning). Full procedure in [[project_munet]] client runbook `clients/munet-web/.iago/_config/runbooks/verify-prod-deploy.md`.
