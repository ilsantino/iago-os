---
name: amplify-model-noauth-default-open
description: Amplify Gen 2 — a model with no @auth directive falls back to defaultAuthorizationMode (open); use allow.owner deny-guard for Lambda-only read models
metadata: 
  node_type: memory
  type: reference
  originSessionId: 20443df6-dcc0-47c2-aa7a-045021738536
---

In Amplify Gen 2 `defineData`, an `a.model(...)` whose `.authorization((allow) => [])` is EMPTY emits NO `@auth` directive — verified in `@aws-amplify/data-schema` 1.21.1: `authString = ''` when `rules.length === 0` (SchemaProcessor.js:559), and the model is then emitted as `type X @model {...}` with no `@auth`. With `defaultAuthorizationMode: "userPool"`, a model lacking `@auth` falls back to the default mode — granting any authenticated user access — which can be a WORSE cross-tenant hole than the group-read you removed. **Never leave a model's authorization array empty to "lock it down."**

To make a model **readable only by backend Lambdas** (no client access), keep an explicit deny-guard rule: `allow.owner().to(["read"])` on a model where no row ever carries an owner (e.g. seeded via DynamoDB SigV4, never created through AppSync by a client). No client identity can match ⇒ all client reads denied; backend Lambdas still read via schema-level `allow.resource(fn)` IAM grants, which bypass the owner filter. This is exactly the sentria `User` model pattern (`allow.ownerDefinedIn("owner")` + `allow.resource(listUsersForCaller)` — the Lambda reads all org users via IAM despite the owner rule). Confirmed correct by Codex GPT-5.5 adversarial review on sentria PR #161 / commit ddcbfb9 (FactoryLine/Machine catalog).

`allow.resource` is NOT exposed at the model level in Amplify Gen 2 (schema-level only), and per-org read scoping is not expressible in model auth at all — route org-scoped reads through a `listXForCaller` custom query whose Lambda resolves the caller's org from the JWT sub server-side, then issues the org GSI query. This is the catalog fix in PR #161 and the template for the broader hardening epic (sentria issue #163).
