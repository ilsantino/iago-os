---
name: project_munet_caja_hardware
description: MUNET caja printer (Nextep NE-511) plan set + demo deadline + firmware gotchas
metadata: 
  node_type: memory
  type: project
  originSessionId: 1cfb11d9-2ca4-4511-893e-a97104ec3abc
---

MUNET taquilla physical-ticket printing. Hardware IN HAND (2026-07-07): **Nextep NE-511** (80mm, USB/RJ11/LAN, auto-cutter — Zijiang POS-80 OEM family) for prod + Domary PT-210 (58mm BT, respaldo only).

**DEMO VALIDATED 2026-07-08** (whole loop, real hardware): NE-511 via USB + Windows POS-80 driver; boleto ESC/POS with raster MUNET logo + type bar + native-QR-as-raster + partial cut + code page 19 (accents OK); scans **GREEN** against prod table `munet-c858c7c4` (validator online path needs order exists + status completed + visitDate==today + stored qrCode==scanned, NOT HMAC recompute); **auto-print** works via prototype agent (`.local/printer-demo/`: boleto.mjs render + send-raw.ps1 RAW-to-Windows-printer + watch.mjs polls DDB for new caja sales). Working prototype = layout spec, in `.local/printer-demo/` (throwaway). **Cash path confirmed end-to-end; CARD/terminal pending Sebas fixing MP Point Smart 2 ("no puede contactar a la terminal de pago").** 2 demo orders (email demo@munet.mx) written to munet-c858c7c4 — DELETE after demo. AWS: acct 851725296610 (il-santino), munet.mx has Route53 zone + Amplify app d2fjob0jvax0j8 but NO email (no MX, no SES munet.mx identity — SES verified: sentria.live/alfallo.mx/privia.legal/iago.live). **Plan 03 (productionize the print agent) GREENLIT by Santiago but HELD pending Sebas terminal-fix confirm + one more card test.** Prod reqs locked in 03-bridge-dispatch.md: any caja PC, connection-agnostic, NO AWS creds on device (route via print-service API + caja token), Windows service. See [[feedback_agents_never_hold_secrets]] principle.

**⚡ RESTART THE DEMO AUTO-PRINT (after crash / reboot / paper change) — exact steps:**
1. **Printer:** NE-511 on, USB in, paper loaded. Verify Windows sees it: `Get-Printer -Name POS-80` → PrinterStatus `Normal`, PortName `USB001`. Turning the printer off/on (e.g. to reload paper) does NOT require restarting the watcher — it only pushes bytes when a *new* caja sale lands.
2. **Watcher:** `cd C:\Users\sanal\dev\iago-os\.local\printer-demo` then `node watch.mjs` — or double-click `INICIAR-IMPRESORA.cmd` (self-restarts, leave the window open all day). On startup it marks today's *existing* caja orders as "seen" (`printed-orders.json`) and only auto-prints NEW completed caja sales dated today.
3. **Test print:** `node boleto.mjs; powershell -ExecutionPolicy Bypass -File .\send-raw.ps1` (uses `order.json` if present — currently a single `test_ticket` — else the 4-type demo catalog).
4. **Deps the watcher needs:** AWS CLI creds for acct **851725296610** (`il-santino`), region `us-east-1`, table `munet-c858c7c4`; `node`; the `POS-80` Windows driver. Flow: DDB scan (poll 3s) → `boleto.mjs` renders ESC/POS → `send-raw.ps1` sends RAW bytes to POS-80.
5. **This poll-DDB agent is the THROWAWAY demo shortcut** (has AWS creds on the PC). The target arch Santiago keeps asking for = **panel-driven**: Caja browser panel → print-service API → local Node agent (NO AWS creds on device) = **Plan 03, HELD**. Don't confuse the two.

Plan set at `clients/munet-web/.iago/plans/feature-caja-hardware/` (LOCAL, never GitHub): SETUP-PC.md (USB demo runbook) + SETUP-NE-511.md (prod tablet/RawBT) + LANES.md + plans 01-05 + README. Driver zip extracted at `.local/printer-driver-zip/` (programmer manual text in `manual-extract.txt`).

**Architecture:** browser can't talk TCP:9100/USB → bridge mandatory. Demo = boleto HTML 80mm via Windows POS-80 driver + `window.print()` (plan 01). Prod = ESC/POS payload frozen server-side (plan 02) dispatched by panel via RawBT (Android tablet, ~$6 license) or local Node agent (PC, localhost→9100). QR byte-identical to digital ticket.

**Firmware gotchas (verified vs manual, contradict standard ESC/POS):** QR = proprietary `ESC Z` (1B 5A), NOT `GS ( k`; NO full cut (only partial `1D 56 01`); code-page table absent from PDF (accents n candidate 16=WPC1252, confirm on hardware); factory IP is manual-says-192.168.1.100 but family often 192.168.123.100 — **autotest print is the only truth**. Drawer kick `1B 70 00 19 FA`, cash-only.

**Repo reality (already built, don't recreate):** CajaPage.tsx full sale flow (SalePhase → `{kind:"done";orderId;method;ticketCount}`), print-service CloudPRNT queue, HMAC-QR tickets, SES email (optional in caja). `qrcode`/`qrcode.react` already deps. Cash sale generates tickets SYNC in assisted-checkout handler; terminal via MP webhook (async). Builds on [[project_munet_pagos_v0]]. Related: [[project_munet]], [[project_munet_mvp_scope]].
