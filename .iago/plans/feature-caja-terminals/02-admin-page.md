---
phase: feature-caja-terminals
plan: 02
wave: 2
depends_on: [01]
context: inline
created: 2026-07-08
source: feature
---

# Plan: feature-caja-terminals/02-admin-page

## Goal

Ship the admin "Terminales" panel page: an "Actualizar terminales" button that
pulls devices from the MercadoPago account, lets a superadmin assign a friendly
alias (+ optional number) to each **without wiping already-saved aliases on
re-sync**, activate PDV mode on `STANDALONE` devices, and save the registry —
plus the typed admin API-client helpers all three plans use.

## Capability

Page route + nav + all writes = **`superadmin`** (matches plan 01's contract and
the codebase precedent that config-writes are `superadmin`, e.g. `/panel/config`
in `PanelShell` and `canChangePrices` in `capabilities.ts:100-102`). The registry
READ (`fetchTerminals`) is `caja`-gated on the backend so the POS can consume it,
but this admin PAGE is `superadmin`.

## Context (verified anchors)

- Admin config page to mirror for STRUCTURE: `src/pages/panel/TicketConfigPage.tsx` —
  RHF + Zod, `useFieldArray` keyed on the synthetic `field.id` (NOT a domain field,
  line 255), array-level uniqueness `refine` (62-68), `["admin","ticketConfig"]` query,
  mutation → invalidate, `AuthExpiredError` → `logout()`, and it wraps in `PanelPage`
  (the Framer-Motion wrapper) with `PanelLoading`/`PanelError`/access-restricted states
  (204-219). The client/server label charset comment (26-29) is the pattern to copy.
- Admin API client: `src/lib/api/admin.ts` (`updateTicketConfig` ~350-372 — helper
  style, `safeJson`, 401 → `AuthExpiredError`, non-ok → `Error(data.error ?? …)`),
  `src/lib/api/admin-types.ts` (error types 375-426; keep the `{ mode:'terminal';
  terminalId:string }` payment shape unchanged). Base URL `getApiUrl()` (`config.ts`).
- Panel routing: `src/components/panel/PanelShell.tsx` — lazy pages + `<AuthGuard
  requiredCapability="superadmin">` (the `/panel/config` precedent). Sidebar:
  `src/components/panel/PanelSidebar.tsx` `navItems` (each `path`,`label`,`icon` +
  `requiredCapability`); "Precios" uses `requiredCapability:"superadmin"`.
- No ShadCN `Select` under `src/components/ui/` (confirmed) — operating mode is a
  display badge and PDV activation is a button, so none is needed. `Card`/`Button`/
  `Input`/`FormError` exist (`FormError` exported from `input.tsx`).
- Backend routes/contract (plan 01): `GET/PUT /api/admin/config/terminals` (PUT returns
  `{ terminals }`), `GET .../terminals/available` (→ `{ available:[{deviceId,
  operatingMode,posId,storeId}] }`, 503 when token unconfigured), `PATCH .../terminals/mode`.
- Test harness: `src/test/render.tsx` `renderWithProviders`; mock patterns per
  `CajaPage.test.tsx`. Repo-wide typecheck gate: `npm run type-check`.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `src/lib/api/admin-types.ts` | `Terminal`, `AvailableTerminal`, `TerminalMode` types |
| modify | `src/lib/api/admin.ts` | `fetchTerminals`, `saveTerminals`, `fetchAvailableTerminals`, `setTerminalMode` |
| create | `src/pages/panel/TerminalesPage.tsx` | Admin management UI |
| create | `src/pages/panel/TerminalesPage.test.tsx` | Page tests |
| modify | `src/components/panel/PanelShell.tsx` | Route (lazy) under `AuthGuard requiredCapability="superadmin"` |
| modify | `src/components/panel/PanelSidebar.tsx` | Nav entry (`requiredCapability:"superadmin"`) |

## Tasks

### Task 1: Types
- **files:** `src/lib/api/admin-types.ts`
- **action:** Add `export interface Terminal { deviceId: string; alias: string; number?: string }`, `export interface AvailableTerminal { deviceId: string; operatingMode: "PDV" | "STANDALONE" | "UNDEFINED"; posId?: string | number; storeId?: string | number }`, `export type TerminalMode = "PDV" | "STANDALONE"`.
- **verify:** `grep -q "interface Terminal" src/lib/api/admin-types.ts && npm run type-check`
- **expected:** grep matches; type-check exits 0

### Task 2: API-client helpers
- **files:** `src/lib/api/admin.ts`
- **action:** Add four helpers in the `updateTicketConfig` style (auth header, `safeJson`, 401 → `AuthExpiredError`, non-ok → `Error(data.error ?? 'Error del servidor: '+status)`): `fetchTerminals(token): Promise<Terminal[]>` GET `/api/admin/config/terminals` reading `.terminals`; `saveTerminals(token, terminals: Terminal[]): Promise<Terminal[]>` PUT same path body `{ terminals }`, reading `.terminals` from the response (plan 01 PUT returns `{ terminals }`); `fetchAvailableTerminals(token): Promise<AvailableTerminal[]>` GET `/api/admin/config/terminals/available` reading `.available`; `setTerminalMode(token, deviceId, mode: TerminalMode): Promise<AvailableTerminal>` PATCH `/api/admin/config/terminals/mode` body `{ deviceId, operatingMode: mode }`.
- **verify:** `grep -cE "export async function (fetchTerminals|saveTerminals|fetchAvailableTerminals|setTerminalMode)" src/lib/api/admin.ts`
- **expected:** `4`

### Task 3: TerminalesPage
- **files:** `src/pages/panel/TerminalesPage.tsx`
- **action:** Mirror `TicketConfigPage` structure and wrap in `PanelPage` (satisfies the Framer-Motion rule); render `PanelLoading`/`PanelError` (with retry) for the initial `["admin","terminals"]` → `fetchTerminals` query. Maintain an editable list via `useFieldArray` keyed on `field.id` with `deviceId` stored as a form value. **Merge semantics (load-bearing):** "Actualizar terminales" is a `useMutation` (or `queryClient.fetchQuery`) calling `fetchAvailableTerminals`; merge its result into the current rows BY `deviceId`, PRESERVING any existing `alias`/`number` and attaching the live `operatingMode`; a device only in `available` gets a blank-alias row; a saved device NOT returned by `available` (orphan) is KEPT with its alias and marked "no detectada en la cuenta" (never silently dropped). Zod: `alias` required, ≤80, matching a copy of the exact `TICKET_LABEL_RE` literal (identical to the plan-01 backend copy and admin-config:51 — add the "must match server" comment); `number` optional ≤32; plus an array-level `refine` rejecting duplicate `alias` (case-insensitive) and duplicate `deviceId`. **On "Guardar", persist ONLY rows with a non-empty alias** (unnamed pulled devices are omitted from the PUT) → `saveTerminals` → invalidate `["admin","terminals"]`; toast "Terminales guardadas". Each row shows an `operatingMode` badge; a `STANDALONE`/`UNDEFINED` row shows an "Activar modo PDV" button with an "Activando…" pending state → `setTerminalMode(deviceId,'PDV')` then refetch available (note MP mode changes can lag a moment). Distinct guidance states: MP account returns 0 devices → "La cuenta no tiene terminales"; the sync call 503s (unconfigured token) → surface "MercadoPago no está configurado" in the button-handler error path (not the page-load query). `AuthExpiredError` → `logout()`. All UI strings in Spanish.
- **verify:** `test -f src/pages/panel/TerminalesPage.tsx && npm run type-check`
- **expected:** file exists; type-check exits 0

### Task 4: Route + nav wiring
- **files:** `src/components/panel/PanelShell.tsx`, `src/components/panel/PanelSidebar.tsx`
- **action:** In `PanelShell`, lazy-import `TerminalesPage` and add `path="terminales"` wrapped in `<AuthGuard requiredCapability="superadmin">` (mirror `/panel/config`). In `PanelSidebar`, add a `navItems` entry `{ path: "/panel/terminales", label: "Terminales", icon: <Smartphone or CreditCard Lucide icon>, requiredCapability: "superadmin" }`.
- **verify:** `grep -q "terminales" src/components/panel/PanelShell.tsx && grep -q "Terminales" src/components/panel/PanelSidebar.tsx && echo OK`
- **expected:** `OK`

### Task 5: Page tests
- **files:** `src/pages/panel/TerminalesPage.test.tsx`
- **action:** `renderWithProviders` + CajaPage-style mocks (mock `@/lib/api/admin`, stub `useAuth` with `capability:"superadmin"`). Cover: (a) clicking "Actualizar terminales" calls `fetchAvailableTerminals` and renders returned devices with their mode badge; (b) **merge preservation** — with `fetchTerminals` returning a saved `{deviceId:'D1', alias:'Caja 1'}` and `fetchAvailableTerminals` returning `D1` (no alias) + a new `D2`, after sync the `D1` row still shows "Caja 1" and `D2` is blank; (c) entering an alias + "Guardar" calls `saveTerminals` with the named rows including `number` when set, and OMITS a pulled-but-unnamed device; (d) the "Activar modo PDV" button appears only for non-PDV devices and calls `setTerminalMode(deviceId,'PDV')`; (e) a duplicate alias fails client validation before any network call; (f) a sync 503 renders the "MercadoPago no está configurado" state.
- **verify:** `npx vitest run src/pages/panel/TerminalesPage.test.tsx`
- **expected:** all tests pass (green)

## Verification

`npm run type-check && npx vitest run src/pages/panel/TerminalesPage.test.tsx` → typecheck clean, page suite green. Manual smoke: `npm run dev`, log in as superadmin, `/panel/terminales`, "Actualizar terminales" → devices with mode badges; rename one, re-sync, confirm the name survives.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-07-08

Findings from the plan-02 analyst pass, resolved inline above unless noted:

- **CRITICAL (fixed):** the original "merges the result into an editable list" would let a
  naïve `form.reset(available)` wipe every saved alias on the first "Actualizar" click.
  Merge is now pinned: by `deviceId`, preserve saved alias/number, keep orphans, and an
  explicit merge-preservation acceptance test (Task 5b) guards it.
- **CAPABILITY (fixed):** page/writes moved to `superadmin` (was `admin`) to match the
  codebase's config-write precedent and plan 01's contract; the `caja` GET gate is for the
  POS reader only. Resolves the plan-01/plan-02 tier disagreement.
- **CONTRADICTION (fixed):** PUT response shape pinned — plan 01 now returns `{ terminals }`
  and `saveTerminals` reads it.
- **PRECISION (fixed):** "Actualizar" modeled as a `useMutation`; alias regex is an exact
  `TICKET_LABEL_RE` copy with the must-match-server comment; save persists the full named
  set (unnamed pulled devices omitted).
- **EDGE (fixed):** orphan aliases preserved + marked; 0-devices vs 503 given distinct
  Spanish copy with 503 in the sync-button path; client-side duplicate-alias `refine`
  added; blank-alias rows excluded from save; PDV activation has a pending state and a
  lag note; `useFieldArray` keyed on `field.id`, deviceId as a form value.
- **MISSING AC (fixed):** `PanelLoading`/`PanelError` for initial load; `PanelPage` wrapper
  for motion; false-green grep verifies replaced with `npm run type-check`.
- **CONFIRMED:** no ShadCN Select needed (verified); a dedicated nav entry beats
  co-locating under the dense TicketConfigPage.
