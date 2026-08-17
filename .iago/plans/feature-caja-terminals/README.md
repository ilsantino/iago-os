# feature-caja-terminals

**Status:** planned (local — NOT pushed to GitHub, same convention as `feature-caja-hardware`)
**Created:** 2026-07-08
**Client:** MUNET (`clients/munet-web`, Amplify Gen 2 + React 19)

## What this builds

Replace the current single free-text MercadoPago-Point terminal-ID field in the
Caja panel with a **saved, named registry of terminals**, populated by pulling the
devices registered on the MUNET MercadoPago account (no hand-typed device IDs),
and selected at the till via a named dropdown.

A "terminal" = a physical MercadoPago Point Smart card device. Its `terminal_id`
is routed straight to the MP Point Orders API (`mercadopago-client.ts:247` →
`config.point.terminal_id`). Charge the wrong ID and the customer at another till
gets the prompt — a named registry + per-station selector removes that footgun.

## Plans

| Plan | Wave | Depends | What |
|------|------|---------|------|
| 01-registry-backend | 1 | — | New `admin-terminals` Lambda: `CONFIG#TERMINALS` registry (GET/PUT), MP device sync (`GET /terminals/v1/list`), PDV-mode activation (`PATCH /terminals/v1/setup`); wired + tested. |
| 02-admin-page | 2 | 01 | Admin "Terminales" page — pull from MP account, assign aliases, activate PDV, save; plus admin API-client helpers. |
| 03-caja-dropdown | 3 | 02 | Replace Caja free-text terminal input with a named dropdown from the registry; remember per station; stale-id re-pick; empty-registry fallback. |

## Locked decisions (do not re-litigate)

1. **Server-side registry** — `CONFIG#TERMINALS` DynamoDB item, admin-managed,
   shared across every till/device. Mirrors the `admin-config` Lambda discipline.
2. **Add-path = pull from MP account** — an "Actualizar terminales" button calls
   `GET /terminals/v1/list` (reusing `MERCADOPAGO_ACCESS_TOKEN`); admin assigns an
   alias to each discovered device. Manual entry is a fallback only.
3. **PDV mode** — the sync shows each device's `operating_mode`; `STANDALONE`
   devices get an "Activar modo PDV" action (`PATCH /terminals/v1/setup`) because
   only `PDV`-mode terminals accept API charges.
4. **Selection UX** — a named dropdown in the Caja **Venta** tab (no login gate)
   that replaces the free-text input, persists per station in `localStorage`
   (reusing `munet_caja_terminal_id`), validates against the fetched registry, and
   forces a re-pick if the stored device is gone. Registry empty → keep today's
   free-text fallback.

## Out of scope

Printer/hardware registry (that's `feature-caja-hardware`), any change to
pricing/charge logic beyond sourcing the deviceId from the selection, non-caja
payment channels.

## Execute

`/iago-execute feature-caja-terminals` (runs each plan through the full pipeline).
