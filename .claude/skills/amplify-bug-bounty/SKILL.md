---
name: amplify-bug-bounty
description: >-
  Use when the user asks for an Amplify Gen 2 repo audit — hunting CFN cycles,
  auth/data authorization holes, IAM over-grants, multi-tenancy leaks, frontend
  client misuse, or other AWS Amplify bugs. Works on any repo that uses
  `@aws-amplify/backend` (Gen 2). Not for non-Amplify stacks.
audit_scope: standalone
audit_disclaimer: >-
  This is an audit snapshot. Highest-leverage rules from this skill are also
  promoted into the local pipeline at `scripts/review-checks/amplify.md` and
  run on every plan. Use this full skill for periodic deep sweeps (new client
  onboarding, pre-launch hardening, post-incident audits) — not as a
  per-plan gate. Rules below may lag the live pipeline module.
---

## Purpose

Scan an Amplify Gen 2 repo end-to-end and report **actionable bugs only** —
CFN circular dependencies, authorization misconfigurations, IAM over-grants,
multi-tenancy leaks, client/server contract drift, and Amplify-specific
footguns. Output is a severity-ranked punch list, no filler.

## Arguments

`/amplify-bug-bounty` — full sweep.

Optional:
- `--scope {backend|frontend|both}` — default `both`
- `--modules {A,B,C,…}` — run only specific rule modules (see §4)
- `--quick` — skip §5 cross-file analysis, run §4 per-file checks only

## Steps

### 1. Orient

Read in this order — do not skip if the file exists:

1. `amplify/backend.ts`
2. `amplify/auth/resource.ts`
3. `amplify/data/resource.ts`
4. `amplify/storage/resource.ts` (if present)
5. `amplify/functions/*/resource.ts` (all)
6. `amplify/functions/shared/**` (if present)
7. Representative `amplify/functions/*/handler.ts` (pick ≥3 covering: auth trigger, custom mutation, scheduled/webhook)
8. `src/main.tsx`, `src/App.tsx`, auth context, 2–3 data hooks, `src/lib/amplify*`
9. `.gitignore`, `amplify_outputs*.json` presence, any `scripts/configure-*.sh`

If `amplify/` is absent → stop, report "not an Amplify Gen 2 repo."

### 2. Build the mental model

Before flagging anything, identify:

- **Stack layout** — which functions sit in `auth`, `data`, `storage`, or default stack (inferred from `resourceGroupName` and from which stack's refs they consume)
- **Cross-stack edges** — every `backend.X.resources.{lambda,bucket,userPool}.…` reference and which stack the *source* vs *target* lives in
- **Authorization matrix** — per model, which caller identities (groups, owner, apiKey, iam) can do which ops
- **Tenancy model** — is there an `organizationId` / `tenantId` / similar field; is it stamped server-side or client-supplied
- **Custom mutation contracts** — for each `a.handler.function(fn)`, what the handler *actually* expects vs the schema signature

Without this map, findings will be wrong. Spend effort here.

### 3. Dispatch (optional)

For large repos (>15 functions or >500 lines of schema), delegate each rule
module to a `security-audit` or `analyst` agent in parallel. Each agent
receives: (a) the rule module, (b) the pre-built mental-model map from §2,
(c) the relevant files. Collate findings back.

For smaller repos, run §4 inline.

### 4. Rule modules

Each rule is a **yes/no check**. Lead with the filename + line. Do not report
compliant checks — only findings.

#### A. CFN circular dependencies

A1. `allow.resource(fn)` in `defineAuth` for a function NOT in the auth stack (via `resourceGroupName` or via landing in data stack) — creates auth→data (or →default) edge.
A2. `allow.authenticated()` in `defineStorage` + any function that is `allow.resource(fn)`'d in `defineAuth` — storage→auth→fn three-leg cycle candidate.
A3. `backend.X.resources.lambda` in stack `S1` consuming `backend.Y.resources.{bucket,userPool,table}` from stack `S2` with `S1 ≠ S2` — cross-stack export.
A4. CDK resource (`new Table`, `new Queue`, `new Rule`) instantiated with a stack scope that differs from the function that uses it.
A5. `userPool.grantX(fn)` / `bucket.grantX(fn)` called in `backend.ts` when `fn` is in a different stack — prefer `fn.resources.lambda.addToRolePolicy` with explicit ARN.
A6. `a.handler.function(fn)` where `fn` also receives IAM grants to cross-stack resources via `allow.resource` — double-binding.
A7. EventBridge `Rule` constructed in default stack (no scope arg) while its target Lambda lives in a nested stack.
A8. Function imports another function's resource module (e.g., `import { fnB } from '../fnB/resource'`) creating compile-time coupling that maps to runtime stack edges.

#### B. Auth / Cognito

B1. Trigger wired in `defineAuth` that doesn't exist (`customMessage` is NOT a valid `triggers.*` key — must go through `addPropertyOverride` on `CfnUserPool`). Verify against current `@aws-amplify/backend` types — this rule may be stale.
B2. `postConfirmation` vs `preSignUp` misuse — group assignment MUST be in `postConfirmation` (user doesn't exist in Cognito during `preSignUp`).
B3. `custom:` attribute added without acknowledging it cannot be renamed/deleted post-deploy.
B4. `allow.owner()` without `.identityClaim("sub")` — default owner token is `sub::username`, brittle when usernames are emails or change.
B5. Custom-message or email-sender Lambda wired without `addPermission` for `cognito-idp.amazonaws.com` principal.
B6. Frontend reads group membership from a cached session and never calls `fetchAuthSession({ forceRefresh: true })` after a group-mutation (`manageUserGroup`-type) call — stale JWT claims.
B7. Multiple `triggers.postConfirmation` / `triggers.preSignUp` wired on the same Amplify resource (only one per event).
B8. Trigger handler has code paths that don't return `event` (Cognito hangs until timeout).
B9. `groups: [...]` list mutated post-deploy (group deletions in Cognito are irreversible via Amplify; requires manual Console fix).
B10. `loginWith.phone` ↔ `loginWith.email` change attempted on an existing pool (forces pool recreation — data loss).

#### C. Data / AppSync authorization

C1. `allow.publicApiKey()` **without `.to([...])`** — grants full CRUD silently. Every `publicApiKey()` rule must be explicit.
C2. `allow.authenticated()` without `.to([...])` — same. Every signed-in user gets full CRUD.
C3. Model holds multi-tenant data (has `organizationId` / `tenantId` field) **and** has any writable rule (`create`/`update`/`delete`) that does NOT route through a Lambda resolver stamping tenancy from the JWT — clients can write arbitrary tenant IDs.
C4. `apiKeyAuthorizationMode.expiresInDays` > 30 combined with write grants on sensitive models — long-lived write credential embedded in `amplify_outputs.json`.
C5. `amplify_outputs*.json` tracked in git OR not listed in `.gitignore` (contains API key + pool IDs).
C6. `allow.group("x")` passed an array (`allow.group(["a","b"])` — silently wrong; must use `allow.groups([...])`).
C7. `allow.groups([a,b]).to([...])` where a and b should have different permission sets — collapses them.
C8. `allow.owner()` without field-level protection on the `owner` field itself — owners can reassign records.
C9. `a.hasMany("M","fk")` / `a.belongsTo("M","fk")` pair with mismatched `fk` names or `fk` field missing from child model.
C10. `a.customType` used as if it were `a.model` (can't be stored standalone, can't have `.authorization()`).
C11. Custom mutation `.returns(...)` type doesn't match what the handler actually returns in every code path (including error branches — AppSync coerces mismatches to null).
C12. Custom mutation handler assumes `event.arguments` shape but `.arguments({...})` in schema is missing a field or has different optionality.
C13. Custom mutation `.authorization((allow) => [...])` missing or set to `allow.publicApiKey()` for an action that should be group-gated.
C14. Secondary index defined on a field that is not `.required()` when the access pattern needs consistent coverage (null pk items silently skipped).
C15. >5 GSIs on a single model (DynamoDB hard limit).
C16. Enum defined inline in multiple models instead of via a named `a.enum([...])` at schema top level — duplication drifts.
C17. `defaultAuthorizationMode` set to `apiKey` on a multi-user product (every field effectively public).
C18. Relationship fields (`hasMany`, `belongsTo`, `hasOne`) referenced cross-model but one side of the pair is missing.

#### D. Functions / Lambda

D1. `defineFunction.entry` path does not resolve to an existing file from the `resource.ts` directory.
D2. Handler calls AppSync but the owning function is NOT in the `graphqlLambdas` env-var injection loop (or equivalent) — will 401/404 at runtime.
D3. Secret (`secret('NAME')`) referenced but not set in sandbox or branch deployment → function crashes on cold start with cryptic error.
D4. Secret value passed via `addEnvironment` as a plaintext string (leaks in CFN template + CloudTrail).
D5. Lambda handler imports heavy SDK clients at top level (SESv2, Bedrock, DynamoDB client with full middleware) inflating cold start — should lazy-import inside handler for rare paths.
D6. Cron/polling Lambda without `reservedConcurrentExecutions = 1` where the handler is not idempotent under concurrent invocation.
D7. Lambda function URL (`addFunctionUrl`) with `authType: NONE` and no header-based secret verification — unauth public endpoint.
D8. Function that calls other Lambdas via `InvokeCommand` lacks `lambda:InvokeFunction` on the target's ARN (or has it over-broad with `*`).
D9. `timeoutSeconds` / `memoryMB` left at defaults for a function doing long external I/O (Bedrock, SES, HTTP fanout).
D10. Function hardcodes table name, ARN, endpoint, or region — should come from env var injected in `backend.ts`.
D11. Handler does not validate `event.identity.sub` exists before using it (API-key invocations have no identity).
D12. Handler trusts `event.arguments.organizationId` / tenant fields instead of deriving from the caller's profile record.
D13. SSM `GetParameter` resource ARN is `*` instead of a scoped prefix (`/<app>/<feature>/*`).
D14. `package.json` in `amplify/functions/<fn>/` pins a conflicting AWS SDK version vs the Lambda runtime's bundled SDK — bundler doubles size or picks wrong version.

#### E. Storage / S3

E1. `allow.authenticated` path used without `{entity_id}` scoping on user-private data — any signed-in user can read any other user's files.
E2. Non-owner rule (group, authenticated) references `{entity_id}` token — `{entity_id}` expands per-caller, so a group rule with it means the path fragment is ignored and the rule applies broadly.
E3. Path begins with `/` or has more than one wildcard segment — invalid.
E4. `grantWrite(fn)` / `grantRead(fn)` called on a function in a different stack than the bucket (contributes to cycles — see A).
E5. Presigned URL expiry left at SDK default (15 min may be too short OR too long depending on the flow); explicit `expiresIn` required.
E6. `cors` rules on bucket or on a function URL allow `*` origin for authenticated operations.

#### F. Frontend — Amplify-specific client misuse

This module ONLY covers Amplify-client wiring. For general React / hooks / data-fetching patterns (effects, memoization, Suspense, TanStack Query, forms), see `/frontend-bug-bounty`.

F1. `Amplify.configure(outputs)` called AFTER a lazy-loaded route that calls `generateClient<Schema>()` at module scope — client uses stale/empty config.
F2. `generateClient<Schema>()` called inside a component body / hook body (re-creates client per render) instead of module scope or a memoized factory.
F3. Multiple `generateClient` calls across hooks with drifting type params (`<Schema>` missing in some) — loses type inference and silently allows wrong field names.
F4. `amplify_outputs.json` imported from a path that is also committed (check `.gitignore` AND `git ls-files`).
F5. `Amplify.configure` called in a component effect instead of module top-level / entry file — first render races the config.
F6. `client.models.X.observeQuery({ filter })` — known Amplify Gen 2 issue: filtered `observeQuery` silently never fires in several `aws-amplify` versions; verify against installed version.
F7. Direct `client.models.X.create/update/delete` from UI on models that have a `createXForCaller` / stamped custom mutation — bypasses server-side identity stamping.
F8. Mutation input includes `organizationId` / `owner` / `createdBy` sourced from client state rather than server-derived — defeats tenancy stamping.
F9. Hook returns `result` from `client.models.X.list/get/mutations.foo(...)` without checking `result.errors` — errors silently become empty data.
F10. Frontend reads group membership from a cached session and never calls `fetchAuthSession({ forceRefresh: true })` after a group-mutation call — stale JWT claims.

#### G. Deployment / ops

G1. Sandbox-specific config script writes env vars that CDK-managed env vars would overwrite on next deploy (double source of truth).
G2. Prod config script selects resources by name rather than by `amplify:deployment-type` / `amplify:branch-name` tags — brittle across redeploys.
G3. Telegram / Twilio / SES webhook URL registered with a provider but not updated when the Function URL rotates after deploy.
G4. No runbook for API key rotation — keys expire, frontend breaks silently.
G5. `amplify sandbox` secrets referenced in code but not set, causing silent fallback to undefined.

### 5. Cross-file analysis

After per-file rules, run these multi-file checks. Each one spans schema ↔ handler ↔ hook ↔ component.

- **Auth matrix vs hook usage**: for each model in `data/resource.ts`, cross-reference with `src/hooks/**` + `src/pages/**`. If a hook calls `.list()` / `.get()` / `.create()` / `.update()` / `.delete()` but the rule doesn't grant the caller's group (or `owner`, or `authenticated`) that op → runtime 401 for that role.
- **Custom mutation contract (three-way)**: for each `a.handler.function(fn)`, diff (a) `arguments` + `returns` in the schema, (b) `event.arguments` shape in the handler, (c) the hook's `client.mutations.fooBar({...})` call site. All three must agree; flag any field present in hook call but missing from schema (silently dropped), or present in handler but missing from hook (undefined at runtime).
- **Tenancy boundary trace**: walk every create/update mutation end-to-end — is `organizationId` / `tenantId` set from JWT + server-fetched profile, or from client input? Flag any path where the hook passes the tenant ID and nothing server-side validates it.
- **Stamped-mutation bypass**: if a `createXForCaller` / stamped custom mutation exists for a model, grep for direct `client.models.X.create` calls anywhere in `src/` — those paths bypass the stamping and must be flagged (unless they're for API-key ingest Lambdas, which shouldn't live in the frontend at all).
- **Subscription-filter drift**: for each `observeQuery` / `onCreate` with a `filter`, check the corresponding model's `.authorization()` rule — if the filter is the only tenant isolation, and the rule is broad (group-level `read`), the hook leaks cross-tenant events until the SDK's filter bug is fixed.
- **Env var closure**: for each `addEnvironment(K, V)` in `backend.ts`, confirm the function handler reads `process.env[K]` and handles the missing case without swallowing.
- **Unused backend resources**: functions defined in `defineBackend` but never wired to a trigger, resolver, schedule, or function URL → dead code, still costs IAM surface.
- **Unused frontend fields**: schema fields with no reader in `src/` — optional cleanup but worth flagging as drift.

### 6. Severity & output

**Categorize**:

| Severity | Definition |
|----------|------------|
| **Critical** | Multi-tenancy leak, auth bypass, public write to sensitive data, plaintext secret leak, deploy-breaking circular dep |
| **Important** | IAM over-grant, missing `.to([...])` on publicApiKey/authenticated, stale JWT in auth decisions, subscription leak, missing error boundary |
| **Minor** | Bundle bloat, cold-start smell, missing docstring on non-obvious IAM grant, naming drift |

**Output format**:

```
# Amplify Bug Bounty — {repo}

## Critical
- [C3] amplify/data/resource.ts:256 — `Incident` model grants `allow.publicApiKey().to(["create","update","delete"])` with no Lambda-stamped tenancy; API key is client-readable via `amplify_outputs.json`, so any user can extract it and write to any `organizationId`.
  → Fix: remove `create/update/delete` from apiKey rule on Incident; route bot ingest through a Lambda that stamps `organizationId` from a bot-context lookup.

## Important
- [A1] amplify/auth/resource.ts:15 — …

## Minor
- …

## Verdict
- {n} Critical, {m} Important, {k} Minor
- Recommended fix order: …
```

Rules:
- ONE finding per issue. No "see also" piles.
- File:line on every finding.
- State the exploit / consequence, not just the violation.
- Propose a concrete fix in one sentence.
- If a rule is N/A (e.g., no storage stack), don't mention it.
- If everything is clean in a module, skip the module entirely.

### 7. Anti-patterns in the audit itself

- Do NOT flag style, naming, comments, or docs.
- Do NOT flag "should use X pattern" without a concrete bug.
- Do NOT recommend adding tests — that's not this skill's job.
- Do NOT speculate on performance without evidence.
- A known limitation documented in-code with a tracked follow-up (e.g., a `NOTE:` comment pointing at a roadmap item) is still reported, but reduced one severity tier.

## Calibration

"Good" patterns to propose as fixes (sourced from the Amplify Gen 2 docs + hardened production usage):

- **Stack separation**: keep Lambdas that write to AppSync in the `data` stack (via `resourceGroupName: "data"` or by letting `a.handler.function(fn)` pull them in) so `AMPLIFY_DATA_GRAPHQL_ENDPOINT` / `AMPLIFY_DATA_API_KEY` injection is same-stack.
- **Stamped-mutation pattern**: for any write on a multi-tenant model, expose a custom mutation (`createXForCaller`-style) whose Lambda stamps `organizationId`/`tenantId`, actor identity, and audit fields from the JWT + a server-fetched profile — never from client arguments.
- **Explicit owner claim**: always `allow.owner().identityClaim("sub")` (or `allow.ownerDefinedIn("field").identityClaim("sub")`); never rely on the default.
- **Explicit `.to([...])`**: every `allow.publicApiKey()` and `allow.authenticated()` must list its ops.
- **Cross-stack IAM via `addToRolePolicy`**: when a function in stack S1 needs access to a resource in S2, grant in `backend.ts` with an explicit ARN — avoid `resource.grantX(fn)` across stacks and avoid `allow.resource(fn)` for functions that don't live in the auth stack.
