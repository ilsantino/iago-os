---
name: reference_sentria_qc_env
description: Sentria hosted environment URLs + Amplify app id (qc and prod)
metadata: 
  node_type: memory
  type: reference
  originSessionId: 59567235-5d1f-4a59-b93c-606f7be2610d
---

Sentria (bas-labs/sentria) is a fullstack Amplify Gen 2 app with Git-based branch deploys on AWS account 851725296610 (us-east-1). Amplify **app id `d3h20cgh1g6jgt`** (name "sentria").

- **sentria-qc** (integration/testing): https://sentria-qc.d3h20cgh1g6jgt.amplifyapp.com — branch `sentria-qc`, stage NONE.
- **prod**: branch `main`, custom domain **sentria.live** (+ www). amplifyapp default: main.d3h20cgh1g6jgt.amplifyapp.com.

Each push to `sentria-qc` auto-triggers a build (job counter, e.g. job 53). Build = `npm ci` → `tsc -b && vite build` (frontend) + `ampx pipeline-deploy` (backend, ~46 Lambdas); full run ~15-25 min. Check status: `aws amplify get-job --app-id d3h20cgh1g6jgt --branch-name sentria-qc --job-id <n> --region us-east-1 --query job.summary.status`. A green URL (HTTP 200) can still be serving a STALE build if the latest job FAILED — always verify the latest job SUCCEED, not just the HTTP code. Testing qc needs a Cognito user in the qc user pool (separate from prod + sandboxes). See [[feedback_windows_npm_lockfile_xplatform]].
