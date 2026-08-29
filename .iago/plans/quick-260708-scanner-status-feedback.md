---
phase: quick
plan: quick-260708-scanner-status-feedback
wave: 1
depends_on: []
created: 2026-07-08
branch: feat/scanner-status-feedback
base: main
project_dir: clients/munet-web/.worktrees/scanner-feedback
repo: bas-labs/munet-web
---

# Quick: Scanner QR 3-way color verdict (green / red / amber "ya escaneado")

## Goal

In the "Escaner QR" panel a scanned ticket must give an unmistakable color
verdict: GREEN valid, RED invalid, and a NEW AMBER "boleto ya escaneado" state
for an already-used ticket (today it wrongly renders as red "Boleto invalido",
indistinguishable from a fake). Drive the distinction from a machine-readable
backend `status` field — never string-match the English `reason`.

## Context (current state — read before editing)

- Frontend `src/pages/panel/ScannerPage.tsx` already renders a colored result
  card: `resultColors` maps `success→bg-green-500`, `error→bg-red-500`,
  `offline→bg-yellow-500`. `handleScan` (~line 137) switches on `res.valid` /
  `res.kind`; every non-valid response falls into the red `error` branch.
- Backend `amplify/functions/validate-ticket/handler.ts` returns
  `{ valid, reason, ... }`. Already-validated → `{ valid:false, reason:"Already
  validated at <ts>" }` (individual branch ~L191, concurrent
  ConditionalCheckFailed branch ~L234). Group-full → `{ valid:false,
  reason:"Grupo completo (N/N)" }` (~L177). These currently show RED.
- Type `ValidateResult` in `src/lib/api/admin-types.ts` (L17) has
  `valid/message/ticketId/ticketType/visitDate/orderId/reason/kind/groupName/
  admitted/admits` — no `status`.
- Keep the offline-verified yellow state distinct; amber must be a clearly
  different shade from `bg-yellow-500`.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| edit | `amplify/functions/validate-ticket/handler.ts` | Add discriminated `status` (+ `validatedAt`) to every response |
| edit | `src/lib/api/admin-types.ts` | Extend `ValidateResult` with `status` union + `validatedAt?` |
| edit | `src/pages/panel/ScannerPage.tsx` | New amber "already" ResultType; switch on `status` with valid-boolean fallback |
| edit | `amplify/functions/validate-ticket/handler.test.ts` (or existing colocated test) | Assert new status values |
| edit | `src/pages/panel/ScannerPage.test.tsx` | Assert amber render for already_scanned + group_full |

Paths are relative to the project dir
`clients/munet-web/.worktrees/scanner-feedback`.

## Tasks

### Task 1: Backend — machine-readable `status` on every validate response
- **files:** `amplify/functions/validate-ticket/handler.ts`, `src/lib/api/admin-types.ts`, colocated handler test
- **action:**
  1. Add a `status` field to EVERY JSON response body in the handler. Enum:
     `"valid" | "already_scanned" | "group_full" | "wrong_date" | "not_found"
     | "invalid_format" | "order_incomplete" | "offline_verified"`. Keep the
     existing `valid` boolean and `reason` for back-compat (do not remove).
     Map: invalid QR format → `invalid_format`; order not found → `not_found`;
     `order.status !== 'completed'` → `order_incomplete`; wrong visit date →
     `wrong_date`; ticket not found for QR → `not_found`; group success →
     `valid`; group ConditionalCheckFailed ("Grupo completo") → `group_full`;
     individual success → `valid`; already-validated branch (matchingTicket.
     validatedAt) → `already_scanned` and INCLUDE `validatedAt:
     matchingTicket.validatedAt` in the body; concurrent ConditionalCheckFailed
     (attribute_not_exists(validatedAt)) → `already_scanned`; offline HMAC
     success → `offline_verified`; offline invalid signature / offline group
     reject / offline wrong-date → the matching invalid status
     (`invalid_format` / `group_full` / `wrong_date`).
  2. Do not change any validation logic, DynamoDB writes, conditional
     expressions, or HTTP status codes — only ADD the `status` (and the one
     `validatedAt` echo) to existing response bodies.
  3. Add/extend the colocated handler test to assert `status` on: individual
     valid, wrong-date, not-found, already-validated (with `validatedAt`
     echoed), and group-full paths.
- **verify:** `npm run type-check && npx vitest run amplify/functions/validate-ticket`
- **expected:** tsc clean; handler tests green incl. new `status` assertions.

### Task 2: Frontend — amber "boleto ya escaneado" verdict
- **files:** `src/pages/panel/ScannerPage.tsx`, `src/lib/api/admin-types.ts`, `src/pages/panel/ScannerPage.test.tsx`
- **action:**
  1. In `admin-types.ts` extend `ValidateResult` with optional
     `status?: "valid" | "already_scanned" | "group_full" | "wrong_date" |
     "not_found" | "invalid_format" | "order_incomplete" | "offline_verified"`
     and `validatedAt?: string`.
  2. In `ScannerPage.tsx` add ResultType `"already"` → `resultColors.already =
     "bg-amber-500 text-white"` (distinct from offline `bg-yellow-500`) and
     `resultIcons.already` = a distinct lucide icon (e.g. `Ban` or `AlertCircle`).
  3. In `handleScan`, decide the card from `res.status` when present:
     `already_scanned`/`group_full` → `{ type:"already", title:"Boleto ya
     escaneado", detail: res.validatedAt ? \`Validado a las ${new Date(
     res.validatedAt).toLocaleTimeString("es-MX",{hour:"2-digit",minute:
     "2-digit"})}\` : (res.reason ?? "Este boleto ya fue usado") }`. When
     `res.status` is ABSENT (old backend), keep today's `res.valid`/`res.kind`
     branching unchanged so a not-yet-redeployed Lambda still works. Genuine
     invalids → red `error`; valid → green `success`; offline path unchanged
     (yellow). Respect `prefers-reduced-motion` exactly like the existing card.
  4. Extend `ScannerPage.test.tsx`: a scan returning `status:"already_scanned"`
     (with `validatedAt`) renders the amber card with "Boleto ya escaneado" and
     the hora; a `status:"group_full"` scan renders the amber card too; a
     genuine invalid still renders red; a valid still renders green.
- **verify:** `npm run type-check && npx vitest run src/pages/panel/ScannerPage`
- **expected:** tsc clean; ScannerPage tests green incl. amber-state assertions.

## Notes

- Timing: today (2026-07-08) is the caja demo. Ships via PR → Santiago merges →
  Amplify redeploy (prod behind basic-auth gate). Flag merge-readiness in the
  summary. Backend `status` and frontend fallback are decoupled, so partial
  deploy is safe.
