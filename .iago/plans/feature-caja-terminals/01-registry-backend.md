---
phase: feature-caja-terminals
plan: 01
wave: 1
depends_on: []
context: inline
created: 2026-07-08
source: feature
projectDir: clients/munet-web (inner repo bas-labs/munet-web) — ALL paths + verify commands below are relative to the munet-web repo root, NOT iago-os.
---

# Plan: feature-caja-terminals/01-registry-backend

## Goal

Stand up a new `admin-terminals` Lambda that owns the terminal registry
(`CONFIG#TERMINALS` DynamoDB item, GET/PUT), pulls live devices from the
MercadoPago account (`GET /terminals/v1/list`), and activates PDV mode
(`PATCH /terminals/v1/setup`) — all wired into API Gateway and unit-tested.

## Capability contract (shared across all three plans)

- `GET /api/admin/config/terminals` (registry read, the POS consumes it) → **`caja`**.
- `PUT /api/admin/config/terminals` (save aliases), `GET .../terminals/available`
  (pull MP devices), `PATCH .../terminals/mode` (flip PDV) → **`superadmin`**.

Rationale: writing the registry and flipping a live device's payment-routing mode is
a money-routing config change — same tier the codebase already uses for price/config
writes (`/panel/config` = `superadmin`, `canChangePrices` = `superadmin`,
`src/lib/auth/capabilities.ts:100-102`). Loosening any write to `admin` later is a
one-line change; start locked. The POS read stays `caja` so any cashier can load the
dropdown.

## Context (verified anchors — paths relative to munet-web root)

- MP client is a raw-fetch module with a reusable `mpRequest<T>(path, init)` helper,
  Bearer-token auth via `MERCADOPAGO_ACCESS_TOKEN`, base `https://api.mercadopago.com`,
  and `getAccessToken()`/`MpConfigError`/`MpApiError` already baked into `mpRequest`:
  `amplify/functions/shared/mercadopago-client.ts` (helper 143-169; guards 33-102).
- MP endpoints (confirmed vs MP docs, Orders-API generation — the sibling
  `create-checkout-session` is already on this generation):
  - List: `GET /terminals/v1/list?limit=&offset=&store_id=&pos_id=` → `{ terminals:
    [{ id, operating_mode, pos_id, store_id }], paging }`. `id` is `type__serial`
    (e.g. `NEWLAND_N950__N950NCB801293324`); `operating_mode` ∈ `PDV|STANDALONE|UNDEFINED`.
    Only `PDV` accepts API charges.
  - Set mode: `PATCH /terminals/v1/setup` body `{ terminals: [{ id, operating_mode }] }`.
- Registry pattern to mirror for the HANDLER shape (optimistic lock, `requireCapability`,
  admin CORS, validation, module-private `TICKET_LABEL_RE` at line 51):
  `amplify/functions/admin-config/handler.ts`.
- Runtime knobs to mirror for an OUTBOUND-HTTP Lambda (not admin-config's 128MB/10s):
  `amplify/functions/create-checkout-session/resource.ts` — it declares
  `MERCADOPAGO_ACCESS_TOKEN: secret('MERCADOPAGO_ACCESS_TOKEN')` and uses a larger
  memory/timeout; copy its secret-name string and size class.
- Shared helpers: `getItem<T>(pk, sk, { consistentRead? })`, `updateItem<T>(pk, sk,
  updateExpr, values, names?, condition?)` (`amplify/functions/shared/dynamodb.ts`);
  `requireCapability(event, cap)` throws `ForbiddenError` 403
  (`amplify/functions/shared/auth.ts`); `corsHeaders`
  (`amplify/functions/shared/cors.ts`, already lists PATCH); `ENTITY`
  (`amplify/functions/shared/constants.ts`, has `CONFIG`, no `TERMINALS`). Single table
  (pk/sk), `TABLE_NAME` env; CONFIG items key pk=sk (`CONFIG#TICKETS`).
- deviceId validity MUST match the charge path exactly (non-empty string, ≤128 chars,
  no whitespace): `amplify/functions/create-checkout-session/handler.ts:801-816`.
- OPTIONS preflight is handled by API Gateway `defaultCorsPreflightOptions`
  (`amplify/backend.ts:416-421`) — sibling config routes add NO per-resource OPTIONS method.
- Amplify functions are typechecked by `amplify/tsconfig.json` (`include: **/*.ts`),
  NOT `tsconfig.app.json` (`include: src`). Repo-wide gate: `npm run type-check` (`tsc -b`).

## Files

| Action | Path (munet-web root) | Purpose |
|--------|------|---------|
| modify | `amplify/functions/shared/mercadopago-client.ts` | Add `listTerminals()` + `setTerminalsOperatingMode()` + `MpTerminal` type |
| create | `amplify/functions/admin-terminals/resource.ts` | `defineFunction` (MP token + FRONTEND_URL env, outbound-HTTP size class) |
| create | `amplify/functions/admin-terminals/handler.ts` | Registry GET/PUT + MP sync + PDV-mode routes |
| create | `amplify/functions/admin-terminals/handler.test.ts` | Unit tests |
| modify | `amplify/backend.ts` | Register function, grant table RW, inject `TABLE_NAME`, wire routes |

## Tasks

### Task 1: MP client — list devices + set operating mode
- **files:** `amplify/functions/shared/mercadopago-client.ts`
- **action:** Add `export interface MpTerminal { id: string; operating_mode?: string; pos_id?: string | number; store_id?: string | number }` and two functions built on the existing `mpRequest` helper (do NOT re-implement auth): `listTerminals(opts?: { limit?: number; offset?: number; storeId?: string; posId?: string }): Promise<MpTerminal[]>` → `GET /terminals/v1/list` with `limit` defaulting to 100 (build the querystring from provided opts), reading `response.terminals ?? []`. A single page of 100 is sufficient for the museum's device count; add a one-line comment that >100 devices would need offset paging (out of scope). Add `setTerminalsOperatingMode(ids: string[], mode: "PDV" | "STANDALONE"): Promise<MpTerminal[]>` → `PATCH /terminals/v1/setup` body `{ terminals: ids.map(id => ({ id, operating_mode: mode })) }`, reading `response.terminals ?? []`.
- **verify:** `cd amplify && npx tsc --noEmit -p tsconfig.json`
- **expected:** exit 0, no diagnostics

### Task 2: Function scaffold (resource.ts)
- **files:** `amplify/functions/admin-terminals/resource.ts`
- **action:** Create a `defineFunction` named `admin-terminals`, `resourceGroupName: 'MunetCustom'`, runtime 20, sized for outbound HTTP like `amplify/functions/create-checkout-session/resource.ts` (`memoryMB: 512`, `timeoutSeconds: 30`), whose `environment` includes `FRONTEND_URL: secret('FRONTEND_URL')` and `MERCADOPAGO_ACCESS_TOKEN: secret('MERCADOPAGO_ACCESS_TOKEN')` — copy the exact secret-name string from `create-checkout-session/resource.ts`. Import `{ defineFunction, secret } from '@aws-amplify/backend'`. Export as `adminTerminals`.
- **verify:** `grep -q "MERCADOPAGO_ACCESS_TOKEN" amplify/functions/admin-terminals/resource.ts && echo OK`
- **expected:** `OK`

### Task 3: Handler — routing, validation, registry, MP proxy
- **files:** `amplify/functions/admin-terminals/handler.ts`
- **action:** Multiplex on `event.resource ?? event.path` with an `OPTIONS` short-circuit (defense-in-depth; real preflight is API-GW `defaultCorsPreflightOptions`) and an admin CORS header set (`Access-Control-Allow-Methods: 'GET,PUT,PATCH,OPTIONS'`). Route by MOST-SPECIFIC suffix FIRST using `endsWith` (never `includes`): check `.endsWith('/terminals/available')`, then `.endsWith('/terminals/mode')`, then `.endsWith('/terminals')`. Routes: (a) GET `/terminals` → `requireCapability(event,'caja')`, `getItem<{terminals?: Terminal[]}>('CONFIG#TERMINALS','CONFIG#TERMINALS')`, return `{ terminals: item?.terminals ?? [] }`. (b) PUT `/terminals` → `requireCapability(event,'superadmin')`, parse+validate body `terminals` (array ≤20; each `{ deviceId: string non-empty ≤128 no-whitespace — the create-checkout-session:801-816 rule; alias: string non-empty ≤80 matching a LOCAL copy of the `TICKET_LABEL_RE` literal from admin-config:51, with a comment that it must stay identical to that regex AND the frontend copy; number?: optional string ≤32 }`; reject duplicate `deviceId` and duplicate `alias` (case-insensitive) with 400), then write `CONFIG#TERMINALS` via `updateItem` conditioned on `attribute_not_exists(updatedAt)` for the first create and on the read `updatedAt` otherwise, 3-attempt retry with `consistentRead` re-read, `ConditionalCheckFailedException` on the last attempt → 409 (single-writer item, so this guards first-create + self-concurrency, not cross-route co-writes). PUT returns `{ terminals }` (the saved array) so the client can read it back. (c) GET `/terminals/available` → `requireCapability(event,'superadmin')`, `listTerminals()`, map to `{ available: mpTerminals.map(t => ({ deviceId: t.id, operatingMode: t.operating_mode ?? 'UNDEFINED', posId: t.pos_id, storeId: t.store_id })) }`. (d) PATCH `/terminals/mode` → `requireCapability(event,'superadmin')`, validate `{ deviceId: string, operatingMode: 'PDV' | 'STANDALONE' }`, `setTerminalsOperatingMode([deviceId], operatingMode)`, return the updated device (mapped like `available`). Error mapping: `ForbiddenError` → 403; `MpConfigError` → 503 `{ error: 'MercadoPago no está configurado' }`; `MpApiError` → `err.status` with `{ error: err.message }`; else 500.
- **verify:** `cd amplify && npx tsc --noEmit -p tsconfig.json`
- **expected:** exit 0, no diagnostics

### Task 4: Wire the function + routes in backend.ts
- **files:** `amplify/backend.ts`
- **action:** Import `{ adminTerminals } from "./functions/admin-terminals/resource"`, add it to `defineBackend({...})`, extract `const adminTerminalsLambda = backend.adminTerminals.resources.lambda`, `table.grantReadWriteData(adminTerminalsLambda)`, and add it to the `forEach` that injects `TABLE_NAME` (mirror `adminConfigLambda` at backend.ts:187/205/216). On the existing `adminConfigResource`, add `const t = adminConfigResource.addResource("terminals")` with `GET`+`PUT` → `lambdaIntegration(adminTerminalsLambda)` (cognitoAuthorizer, `AuthorizationType.COGNITO`), plus `t.addResource("available")` GET and `t.addResource("mode")` PATCH → same lambda + authorizer. Do NOT add OPTIONS methods (defaultCorsPreflightOptions covers them). Match the exact `addMethod` option object used by the sibling `/tickets` route.
- **verify:** `grep -q "adminTerminals" amplify/backend.ts && grep -q 'addResource("terminals")' amplify/backend.ts && (cd amplify && npx tsc --noEmit -p tsconfig.json) && echo OK`
- **expected:** `OK`

### Task 5: Handler unit tests
- **files:** `amplify/functions/admin-terminals/handler.test.ts`
- **action:** Mirror `amplify/functions/admin-config/handler.test.ts`. Mock `../shared/dynamodb.js`, `../shared/auth.js` (`requireCapability` throwing `ForbiddenError` for negative cases), `../shared/mercadopago-client.js`. Cover: PUT rejects >20 entries, whitespace/oversize deviceId, bad alias charset, duplicate deviceId, duplicate alias (case-insensitive); PUT 409 when `updateItem` throws `ConditionalCheckFailedException` every attempt; PUT returns `{ terminals }`; GET `/terminals` requires `caja` and returns `[]` on empty item; `available` maps MP devices, requires `superadmin`, returns `{ available: [] }` on an empty MP account, and returns 503 on `MpConfigError`; `mode` PATCH calls `setTerminalsOperatingMode([deviceId],'PDV')` and requires `superadmin`; `MpApiError` passes its status through.
- **verify:** `npx vitest run amplify/functions/admin-terminals/handler.test.ts`
- **expected:** all tests pass (green), no failures

## Verification

`npm run type-check && npx vitest run amplify/functions/admin-terminals/` → whole-repo typecheck (`tsc -b`, includes the amplify project) clean and the new handler suite green. `grep -c 'addResource("terminals")' amplify/backend.ts` → `1`.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-07-08

Findings from the plan-01 analyst pass, resolved inline above unless noted:

- **PRECISION (fixed):** original verify commands used `tsc -p tsconfig.app.json`, which
  only compiles `src/` and would report false green on a type-broken Lambda. All verifies
  now use `cd amplify && npx tsc -p tsconfig.json` (or repo-wide `npm run type-check`).
- **EDGE/CORRECTNESS (fixed):** route multiplexing must test the most-specific suffix
  first via `endsWith` (a naïve `includes('/terminals')` misroutes all three) — pinned in
  Task 3. First-create seeding pinned to `attribute_not_exists(updatedAt)`.
- **EDGE (accepted):** `listTerminals` reads a single 100-device page; >100 devices would
  need offset paging — out of scope for the museum, documented in Task 1.
- **CONTRADICTION (fixed):** "mirror admin-config" for `memoryMB` was inconsistent (128 vs
  the claimed 256); runtime knobs now explicitly mirror `create-checkout-session`
  (512MB/30s) as the correct outbound-HTTP sibling, while the HANDLER shape mirrors
  admin-config. OPTIONS handled by `defaultCorsPreflightOptions` (Task 4).
- **ARCH (confirmed sound):** a new `admin-terminals` function (vs extending admin-config)
  is correct — admin-config lacks the MP token env and is a hot pricing path; attaching a
  different lambda integration to a child of `adminConfigResource` and routing on
  `event.resource` both work as the codebase already does.
- **CAPABILITY (decided):** GET=`caja`, writes/available/mode=`superadmin` (see Capability
  contract). Loosen writes to `admin` later if desired — one-line change.
