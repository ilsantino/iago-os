## Amplify Gen 2 Checks (apply when diff touches `amplify/` directory — backend definition, auth resource, data resource, storage, functions, or shared backend modules)

Amplify Gen 2 specific failure modes. Distilled from `/amplify-bug-bounty` (200+ rules) — promoted here are the patterns that break deploys, leak tenancy, or silently grant unintended access.

### Severity Floors

| Pattern | Minimum Severity |
|---|---|
| `allow.publicApiKey()` without an explicit `.to([...])` op list — silently grants full CRUD via a client-readable API key embedded in `amplify_outputs.json` | ALWAYS Critical |
| `allow.authenticated()` without an explicit `.to([...])` op list on a model holding non-public data — every signed-in user gets full CRUD | ALWAYS Critical |
| Multi-tenant model (has `organizationId` / `tenantId`) with any writable rule (`create` / `update` / `delete`) that does NOT route through a Lambda resolver stamping the tenant from the JWT — clients can write arbitrary tenant IDs | ALWAYS Critical |
| Lambda handler trusts `event.arguments.organizationId` / `tenantId` / `userId` instead of deriving from `event.identity.sub` plus a server-side profile lookup | ALWAYS Critical |
| `amplify_outputs*.json` tracked in git OR not listed in `.gitignore` (contains API key + Cognito IDs) | ALWAYS Critical |
| `allow.resource(fn)` in `defineAuth` for a function NOT in the auth stack (no `resourceGroupName: "auth"` and not consumed by an auth resource) — auth → data / default stack edge that creates a CFN circular dependency | ALWAYS Important |
| Cross-stack IAM grant via `userPool.grantX(fn)` / `bucket.grantX(fn)` / `table.grantX(fn)` where the function lives in a different stack than the resource — exports the resource, creates cycle risk | ALWAYS Important |
| Lambda `function URL` with `authType: NONE` and no header-based secret verification — public unauthenticated endpoint | ALWAYS Critical |
| S3 path with `allow.authenticated` and no `{entity_id}` scoping on user-private data — any signed-in user can read any other user's files | ALWAYS Critical |

### Checks

- **CFN circular dependencies.** `allow.resource(fn)` in `defineAuth` for a function that doesn't sit in the auth stack creates an auth → other-stack edge. Combined with that function consuming `backend.X.resources.{userPool,bucket}` from another stack you get a cycle that fails `amplify deploy` with a confusing CloudFormation error. Either move the function into the auth stack via `resourceGroupName: "auth"`, or grant cross-stack via `fn.resources.lambda.addToRolePolicy` with an explicit ARN instead of `allow.resource`.
- **Cross-stack IAM grants.** `userPool.grantX(fn)` / `bucket.grantX(fn)` / `table.grantX(fn)` called from `backend.ts` when `fn` lives in a different stack causes Amplify to export the resource, contributing to cycles. Prefer `addToRolePolicy` with explicit ARN scoped to the resource.
- **Missing `.to([...])` on broad rules.** `allow.publicApiKey()` and `allow.authenticated()` without an explicit op list grant full CRUD. The API key is in `amplify_outputs.json` (client-readable) — a missing `.to(["read"])` on a public-API-key rule is data exfiltration plus tampering open to anyone who loads the page.
- **Multi-tenant write without server-side stamping.** Any `create` / `update` / `delete` rule on a model with `organizationId` / `tenantId` / `accountId` that does not route through a `a.handler.function(fn)` Lambda resolver lets the client supply any tenant ID. Stamp tenant identity from `event.identity.sub` + server-fetched profile. Never trust the client.
- **Handler trusts client-supplied identity.** Lambda handler reading `event.arguments.organizationId` / `tenantId` / `userId` and using it for authorization or data scoping is a tenancy bypass. Derive from `event.identity.sub` and a server-side profile/membership lookup.
- **Stamped-mutation bypass.** If a `createXForCaller`-style stamped mutation exists for a model, direct `client.models.X.create` / `update` calls from the frontend bypass the stamping. Either remove the direct client write capability (auth rules) or replace the call site with the stamped mutation.
- **`amplify_outputs.json` leakage.** This file contains the API key, Cognito User Pool ID, Identity Pool ID, GraphQL endpoint, and S3 bucket. It must be in `.gitignore` AND not present in `git ls-files`. If it ever was committed, the API key must be rotated.
- **Cognito group mutation without forced session refresh.** `manageUserGroup`-style operations that change a user's group membership require a `fetchAuthSession({ forceRefresh: true })` afterward — the `cognito:groups` claim in the existing JWT does not update until the next token refresh. Without this, a just-promoted admin still hits 403s, or a just-demoted user keeps admin access until logout.
- **Group assignment in `preSignUp` instead of `postConfirmation`.** The user does not exist in Cognito during `preSignUp` — group assignment will silently fail. Group assignment must live in `postConfirmation`.
- **`allow.owner()` without explicit `.identityClaim("sub")`.** Default owner token is `sub::username` — brittle when usernames are emails, change, or contain `::`. Always pin to `sub` explicitly.
- **`allow.group(["a","b"])` instead of `allow.groups([...])`.** Singular `group()` takes a string and silently accepts an array as truthy without applying the second value. Easy to miss in review.
- **Cross-stack EventBridge / Lambda permission gaps.** EventBridge rules constructed in the default stack with targets in nested stacks fail at deploy. Lambda calling another Lambda via `InvokeCommand` without `lambda:InvokeFunction` in the role fails at runtime with a misleading error.
- **S3 user-private path without `{entity_id}`.** `allow.authenticated.to(["read", "write"])` on a path like `uploads/*` lets every signed-in user read every other user's files. Use `entity_id`-scoped paths (`uploads/{entity_id}/*`) for user-private data.
- **S3 path token misuse.** `{entity_id}` expands per-caller — using it inside a non-owner rule (group, authenticated) means the path fragment is effectively ignored and the rule applies broadly. Owner-only rules can use `{entity_id}`; group rules cannot rely on it for scoping.
- **Lambda function URL `authType: NONE`.** Public unauthenticated endpoint. Either change to `authType: AWS_IAM` and sign requests, or implement header-based secret verification inside the handler. Never expose business logic on an open URL.
- **Hardcoded ARNs / table names / endpoints in Lambda.** Resource identifiers must come from environment variables injected by `backend.ts` via `addEnvironment`. String literals break across sandbox / branch / prod and across deploys when resources are recreated.
- **Secrets passed via `addEnvironment` plaintext.** Secret values written through `addEnvironment(K, plaintextSecret)` end up in the CloudFormation template and CloudTrail logs. Use `secret('NAME')` and reference via the secret-handling pattern; never inline.
