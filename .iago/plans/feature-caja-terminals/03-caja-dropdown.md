---
phase: feature-caja-terminals
plan: 03
wave: 3
depends_on: [02]
context: inline
created: 2026-07-08
source: feature
---

# Plan: feature-caja-terminals/03-caja-dropdown

## Goal

Replace the Caja page's free-text terminal-ID input with a named dropdown fed by
the saved registry: the cashier picks a terminal by alias, the choice is remembered
per station and preselected, a stale/removed device forces a re-pick, and an empty
registry falls back to today's free-text behavior. The card charge sources the
selected `deviceId` — the rest of the sale flow is untouched.

## Context (verified anchors — line refs confirmed accurate)

- `src/pages/panel/CajaPage.tsx`: `TERMINAL_ID_STORAGE_KEY = "munet_caja_terminal_id"`
  (68); `terminalId`/`terminalDraft` state (597-600); `saveTerminalId` reads
  `terminalDraft` (938-943) — the DROPDOWN must NOT route through `terminalDraft`; the
  `method==="terminal"` free-text block (1334-1360); `submitDisabled` terminal clause
  requires `terminalId !== ""` (989); the charge payload `{ mode:"terminal", terminalId }`
  (712); identity-changing edits call `rotateIdempotencyKey()` (`selectMethod` 930-936,
  date/email 1240-1264). Terminal charges do NOT currently send an Idempotency-Key (only
  cash does, 722-724) — blast radius of a stale key on terminal is limited, but rotate on
  change for consistency with every other identity edit.
- Native `<select>` is the established codebase dropdown pattern (no ShadCN Select;
  e.g. `ScannerPage.tsx:351`).
- Registry helper (plan 02): `fetchTerminals(token): Promise<Terminal[]>`, type
  `Terminal { deviceId; alias; number? }`. GET is `caja`-gated (a cashier can read it).
- Tests: `src/pages/panel/CajaPage.test.tsx` — existing terminal tests (516-747) set
  `localStorage["munet_caja_terminal_id"]="TERM-1"` and expect `payment.terminalId:"TERM-1"`
  (516-635), and one types into the free-text Input `getByLabelText("ID de terminal (Point
  Smart)")` then clicks "Guardar" (637-667). The default `fetchTerminals` mock is
  load-bearing: it MUST default to an EMPTY registry so these legacy tests keep the
  free-text path and "TERM-1" is not validated-away as stale.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `clients/munet-web/src/pages/panel/CajaPage.tsx` | Registry query + dropdown replacing the free-text input; stale/empty handling |
| modify | `clients/munet-web/src/pages/panel/CajaPage.test.tsx` | Terminal-selection test cases + default mock |

## Tasks

### Task 1: Registry query + settled-gated stale validation
- **files:** `clients/munet-web/src/pages/panel/CajaPage.tsx`
- **action:** Add a TanStack query `["admin","terminals"]` → `fetchTerminals(await getToken())` (`staleTime` ~5 min; `AuthExpiredError` → `logout()`, matching the other admin queries). Keep the `terminalId` + localStorage mechanism as the SELECTED-device store. In a `useEffect` gated ONLY on `terminalsQuery.isSuccess === true` (never on `isLoading` polarity and never in the render body), validate the stored `terminalId` against `terminalsQuery.data`: if the registry is NON-EMPTY and the stored id is absent from it, clear `terminalId` and its localStorage key (force a re-pick). If the stored id IS present, leave it (it will preselect). Do NOT clear anything while the query is loading or when the registry is empty (that preserves a manually-entered fallback id).
- **verify:** `cd clients/munet-web && grep -q '"terminals"' src/pages/panel/CajaPage.tsx && npm run type-check`
- **expected:** grep matches; type-check exits 0

### Task 2: Dropdown replaces the free-text input
- **files:** `clients/munet-web/src/pages/panel/CajaPage.tsx`
- **action:** In the `method === "terminal"` block (1334-1360): when the registry has entries, render a labeled native `<select>` (label `"Terminal"`, `id="terminalId"`) whose options list each terminal as `alias` + ` (number)` when present, `value={deviceId}`, with a disabled unselected placeholder option `"Selecciona una terminal"`. `onChange` uses a small DEDICATED setter — `localStorage.setItem(TERMINAL_ID_STORAGE_KEY, deviceId); setTerminalId(deviceId); rotateIdempotencyKey();` — it must NOT touch `terminalDraft` or `saveTerminalId`. Preselect the current `terminalId`. While `terminalsQuery.isLoading`, show the existing `Loader2` spinner pattern instead of an empty control. When the registry is EMPTY, keep the current free-text input + "Guardar" fallback verbatim. Preserve the existing red-guard message + `submitDisabled` behavior when `terminalId === ""`. Do NOT change the charge payload (`{ mode:"terminal", terminalId }`) or the 409/idempotency flow beyond the rotate-on-change above.
- **verify:** `cd clients/munet-web && npm run type-check`
- **expected:** exit 0, no diagnostics

### Task 3: Selection tests (+ fix the default mock)
- **files:** `clients/munet-web/src/pages/panel/CajaPage.test.tsx`
- **action:** Add `fetchTerminals` to the mocked `@/lib/api/admin` surface and default it in `beforeEach` to resolve `[]` (empty registry) so ALL existing terminal tests keep the free-text path and their `"TERM-1"` stays valid. Add new cases that override the default with a 2-terminal registry `[{deviceId:'D1',alias:'Caja 1'},{deviceId:'D2',alias:'Caja 2'}]`: (a) selecting "Tarjeta (terminal)" shows the `<select>` listing both aliases and NO free-text box; picking "Caja 2" persists `D2` to `munet_caja_terminal_id`, enables "Cobrar en terminal", and the charge calls `createAssistedOrder` with `payment.terminalId === 'D2'`. (b) a stored `munet_caja_terminal_id="GONE"` absent from the registry is cleared and submit stays disabled until re-picked. (c) a stored id present in the registry (`"D1"`) is preselected and submit is enabled. (d) confirm the empty-registry default still renders the legacy free-text input + "Guardar". Keep all pre-existing cash/terminal tests green.
- **verify:** `cd clients/munet-web && npx vitest run src/pages/panel/CajaPage.test.tsx`
- **expected:** all tests pass (green), including the pre-existing cases

## Verification

`cd clients/munet-web && npm run type-check && npx vitest run src/pages/panel/CajaPage.test.tsx` → typecheck clean and the full CajaPage suite green. Manual smoke: `npm run dev`, log in as `caja`, Venta → Tarjeta → confirm the alias dropdown; pick a terminal and verify the charge stays disabled until one is selected.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-07-08

Findings from the plan-03 analyst pass, resolved inline above:

- **PRECISION (fixed):** the stale-clear must run in a `useEffect` gated on
  `terminalsQuery.isSuccess` — never on `isLoading` polarity or in the render body — so an
  `undefined → []` transition or an in-flight refetch can't momentarily clear a valid
  stored id. Pinned in Task 1.
- **CORRECTNESS (fixed):** changing the selected terminal now calls `rotateIdempotencyKey()`
  (mirroring `selectMethod`), since `terminalId` is part of the venta fingerprint; noted
  that terminal charges don't currently send an Idempotency-Key so the practical risk is
  small, but rotating keeps it consistent with every other identity edit.
- **CONTRADICTION (fixed):** the default `fetchTerminals` mock is load-bearing across ~6
  existing terminal tests (they set `"TERM-1"` and expect it echoed). Task 3 pins the
  default to an EMPTY registry (legacy free-text path preserved) and has new tests opt into
  a non-empty registry explicitly. The one test that types into the free-text Input stays on
  the empty-registry path and is unaffected.
- **PRECISION (fixed):** the dropdown uses a dedicated setter (localStorage + `setTerminalId`
  + rotate), NOT `terminalDraft`/`saveTerminalId`; exact label (`"Terminal"`) and option
  format specified for deterministic `getByLabelText`/option queries; a `Loader2` shown
  while the registry loads.
- **CONFIRMED:** charge payload stays `{ mode:"terminal", terminalId }` (712); native
  `<select>` matches the codebase; empty-registry fallback does not clash with the
  stale-clear (which only fires on a non-empty registry).
