---
name: iago-cotizacion
description: >-
  Use when producing a client quote (cotización) that will be signed, invoiced and paid:
  a priced, foliated, formal document in the iaGO Señal brand, as PDF and DOCX.
  Not when drafting an unpriced proposal or scoping document (use /iago-proposal), nor
  when the client asks for a budget range in a mail (answer in the mail).
---

## Purpose

Produce a cotización that accounting can file, the client can sign and both can invoice
against: one folio, full dates, the two legal entities, the amounts that add up, the payment
terms, the bank block and the acceptance lines. Same six sections, same brand, every time.
Three pages, formal Spanish, nothing the reader does not act on.

## Arguments

`/iago-cotizacion {cliente-slug}` — the client folder under `C:\development\` (e.g. `rsf`).

Optional flags:
- `--tipo {consultoria|desarrollo|recurrente|ampliacion}` — the shape of the quote (default: ask)
- `--folio COT-{CLIENTE}-{NNN}-{YYYY}` — reuse a folio already assigned (a reissue); otherwise the next one
- `--out {deliverables/YYYY-MM-slug}` — the deliverable folder (default: `deliverables/{YYYY-MM}-cotizacion-{tipo}`)

## Preconditions

Ask for whatever is missing before writing a line. Nothing below may be invented:

1. **Las dos razones sociales**: the client's legal entity that contracts and pays (not the brand), and ours.
2. **El total**, decided by Santiago, and the **split** rule he wants (per deliverable, per phase, setup + monthly).
3. **Qué ya se entregó y qué falta**, with dates: a quote that covers work already done names both parts.
4. **La forma de pago**: one payment or several, each with amount and date.
5. **Fechas**: issue date (today), validity (30 natural days unless told otherwise) and the on-site weeks if any.

## Steps

1. **Folio.** Read the ledger (`references/standards.md` §1) and take the next number for that client.
   Write the ledger row first, status «borrador».
2. **Type.** Pick the shape in `references/types.md`; it fixes the sections and the amounts table.
3. **Fragments.** Copy `templates/cotizacion/` into `{out}/4-entregado/fuente/cotizacion/` and fill every
   `{{PLACEHOLDER}}`. The text rules are `references/standards.md` §2–§4. Formal register, labels not claims,
   entregables by name, no asks, no internal codes, no brackets.
4. **Build.** `python scripts/build.py --src {fuente}/cotizacion --out {fuente}/cotizacion.html --title "…"`.
   The build refuses: a missing folio or full date, a brand name where a legal entity must be, amounts that
   do not add up (lines → subtotals → total → prose), a leftover placeholder, an internal code.
5. **PDF.** `node scripts/pdf.mjs --src {fuente}/cotizacion.html --out {out}/4-entregado/{YYYYMMDD}-{cliente}-cotizacion-{tipo}.pdf --footer "iaGO × {Cliente} · {folio} · {tema}" --max 3`.
   Over three pages → cut text, never shrink type below the print sheet's sizes.
6. **DOCX.** `python scripts/print_docx.py --src … --out …docx --footer "…"`. Fonts embed from `assets/fonts/`.
   Verify through Word: `python scripts/word2pdf.py in.docx out.pdf` then `python scripts/rasterize.py out.pdf dir 70`
   and look at every page. Same page count as the PDF or fix the printer, not the text.
7. **Record.** Deliverable README (what, to whom, what changed and why), `1-fuentes.md`, STATE.md row,
   ledger row updated to «emitida» with the date. Commit the workspace.
8. **Send** (Santiago sends): the PDF only, through the Gmail compose window in Chrome; the DOCX on request.
   Verify the CLABE against a bank statement before the first quote to a new client.

## Standards (summary — the full text is `references/standards.md`)

- Folio `COT-{CLIENTE}-{NNN}-{YYYY}`, in the header, the footer of every page and the file name's README.
- Header: folio · «Ciudad de México, D de mes de AAAA» · «Vigencia: hasta el D de mes de AAAA».
- Eyebrow: the client's legal entity, the brand in parentheses, «At'n.» the person who signs.
- Objeto: our legal entity, theirs, «en adelante el cliente», then **prestados** (dates, §02) and
  **por prestar** (dates, §03) when both exist; what is out of scope in one sentence.
- Amounts: MXN without IVA in the table, «más IVA» in prose; one rate for the same unit everywhere
  (a week on site costs the same in August and in November).
- Payment: amount + trigger + date per payment; «contra factura, por transferencia a la cuenta de la sección 06».
- Viáticos: traslados y hospedaje a costo con aprobación previa; **alimentos por cuenta de iaGO**.
- Bank block: razón social, RFC, domicilio fiscal, banco, cuenta, CLABE, SWIFT, contacto. Then two acceptance columns.

## Boundaries

- Does not decide prices, splits or payment dates — Santiago does; the skill only checks they add up.
- Does not send mail or create Gmail drafts.
- Does not re-issue a sent quote under the same file name: a change after sending is a new date stamp and,
  if the amounts or dates change, a new folio with the old one marked «sustituida» in the ledger.
- Brand is the Señal identity (`references/design.md`); client document brands are never used for a quote.
