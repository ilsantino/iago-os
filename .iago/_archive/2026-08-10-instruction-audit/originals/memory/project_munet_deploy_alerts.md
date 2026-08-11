---
name: project_munet_deploy_alerts
description: "munet main-deploy email alerts — SNS + EventBridge in Sebas's AWS account"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8a11998c-b783-418d-b035-8a357a93ddb4
---

munet-web merges to main auto-deploy (Amplify app `d2fjob0jvax0j8`, account 851725296610, us-east-1) and now email santiago@iagoag.com on completion. Set up 2026-07-06.

Chain: EventBridge rules `munet-main-deploy-succeed` / `munet-main-deploy-failed` (pattern: source `aws.amplify`, detail-type `Amplify Deployment Status Change`, appId `d2fjob0jvax0j8`, branchName `main`, jobStatus SUCCEED/FAILED) → SNS topic `munet-deploy-notifications` → confirmed email sub. SUCCEED msg = "site is LIVE", FAILED msg = "merge NOT live, check build log".

**Why:** merges deploy fine but there was no signal when a deploy finished or failed (~6 min lag; builds do fail — e.g. job 146). Not a broken deploy — a missing notification.
**How to apply:** to add another Amplify app (valideoai/palazuelos/iago-web same account), clone the 2 rules with the new appId and point at the same topic. Amplify PR previews were deliberately NOT enabled — munet's amplify.yml runs `ampx pipeline-deploy` per branch, so each preview would spin a full separate backend stack. See [[project_munet_basic_auth_gate]] (site is basic-auth gated; view at https://munet.mx).
