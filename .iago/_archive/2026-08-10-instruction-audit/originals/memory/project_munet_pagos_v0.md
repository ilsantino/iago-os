---
name: munet-pagos-v0
description: Canonical payment architecture + LOCKED pricing decisions for MUNET v0 (jul-2026)
metadata: 
  node_type: memory
  type: project
  originSessionId: 28bafbe0-c67b-4788-9a07-c8d4b1837a5c
---

**Canon (2026-07-03), supersedes Openpay/BBVA pivot (ADR 007 superseded by research docs 09→10→11):**

- **Web:** Stripe Checkout principal (live) + **Mercado Pago respaldo** (OXXO/SPEI). Stripe Terminal doesn't exist in MX → presencial MUST be MP.
- **Caja:** efectivo (panel registro + corte) + **MP Point Smart 2** via Orders API (the ONLY terminal with PDV mode — Air/Mini/Tap verified NO). Smart 2 promo $549 ends **14-jul-2026**.
- **Ticket de compra** (receipt) = Smart 2 built-in printer, zero dev. **Boleto** (QR access) = Star TSP143IVUE via CloudPRNT — new `print-service` Lambda.

**LOCKED decisions (Santiago 2026-07-03 PM — do not re-litigate, §0.5 of plan maestro):**
1. **Precios oficiales MUNET:** Entrada General lista $320 SIEMPRE en descuento → $190 efectivo (lista tachada en UI); Black Box $80; MINI MUNET (5-10 años) $50. $40-kids problem obsolete.
2. **Tarifa:** $4 × N accesos + 2% de la orden COMPLETA — todos los canales incl. EFECTIVO (iaGO cobra efectivo por factura, no split). KEEP SAME TARIFA.
3. **Desglose = modelo Ticketmaster MX** (ref image in repo assets): per-boleto all-in "cada uno" + "Cargo por servicio" line; NEVER "comisión de tarjeta". Gateway fee computed per provider into priceBreakdown; default absorbed by FIMUNET, `passGatewayFee` switch folds it into Cargo por servicio.
4. **Link grupal:** generated AUTOMATICALLY on accept; sent MANUALLY by worker to form email (copy+mailto, no auto-send); charges FULL total (N×precio + tarifa). One group QR `admits: N`, not N tickets.
5. Residual fine print: IVA de la tarifa, link vigencia, door policies, MP online rate.

**Plan location (LOCAL — Santiago 2026-07-03: no plans on GitHub):** `.iago/plans/feature-pagos-v0/` — `PLAN-MAESTRO.md` (§0.5 locked decisions, §8 discovery) + `SEBAS-START.md` (paste-ready prompt for Sebas: standard Claude Code, NO iago skills, Fable reviews) + Ticketmaster ref in `assets/`. Same files also on branch `feat/pagos-caja-research` at `docs/plans/pagos-v0/` (for handing to Sebas — PR #101 to main was CLOSED; branch preserved). Support docs (also on that branch): `docs/workflows/mapa-boletos-v2.md`, `docs/hardware/kit-operativo.md`, `docs/research/pagos-caja/11-mercadopago-arranque/`. Sebas gets these via the branch or Santiago hands him the files directly.

Related: [[project_munet]]
