# Types of cotización

Reference of the `iago-cotizacion` skill. Four shapes; each fixes the sections, the amounts table
and the payment pattern. Pick one before writing. Mixed engagements are two quotes, not one.

## consultoria — analysis, findings, design; priced per deliverable

The RSF pattern (COT-RSF-002-2026). Work is sold as named deliverables, each with a fixed price,
and often covers work already delivered plus work to come.

- Sections: 01 Objeto (prestados / por prestar) · 02 Servicios entregados · 03 Servicios por realizar
  · 04 Inversión · 05 Condiciones · 06 Datos de facturación y pago.
- Amounts table: group «Servicios entregados · {meses}» (lines E1…En, subtotal) and group
  «Servicios por realizar · {meses}» (lines numbered like the blocks of §03: 3.1…3.n, subtotal), total.
- Units: a week on site, a session with minuta, a document. Same unit, same price, in both groups.
- Payment: one payment at acceptance, or two (the delivered part by a date, the pending part at the close).
- Out of scope sentence: the development, quoted apart.

## desarrollo — building the thing; priced per phase or per function, accepted against a number

What follows a consultoría. Scope is a list of functions or phases, each with its acceptance criterion;
the price is per phase and the payment follows acceptance.

- Sections: 01 Objeto (what gets built, on what design, what is out) · 02 Alcance (table Fase/Función ·
  Entregable · Se acepta cuando) · 03 Calendario (table Fase · Inicio · Entrega) · 04 Inversión (one line
  per phase, total) · 05 Condiciones (+ garantía 30 días, cambios de alcance se cotizan aparte, propiedad del
  código) · 06 Datos de facturación y pago.
- Acceptance: every function names the number or record it is checked against («el costo por FG del mes,
  al centavo, en corrida en paralelo»). No acceptance, no line.
- Payment: a share at acceptance of the quote (30–40 %), the rest per phase on acceptance of that phase.
- Mantenimiento y evolución: quoted apart (one sentence in Condiciones).

## recurrente — setup plus a monthly fee (SaaS, bots, hosting)

The Absara pattern (COT-ABSARA-001-2025). A one-time setup and a monthly amount that may vary with use.

- Sections: 01 Objeto · 02 Alcance (entregables del setup; exclusiones) · 03 Inversión (Setup, pago único;
  Mensualidad: fixed part + variable part with its rule; «Total año 1») · 04 Condiciones (SLA: uptime, horario,
  tiempos de respuesta por severidad, compensación; facturación del setup a la firma y de la mensualidad
  mes vencido; mora; garantía; propiedad: código de iaGO, datos del cliente; terminación; vigencia 12 meses,
  renovación) · 05 Datos de facturación y pago.
- The variable part states the metric (usuarios activos, mensajes), the price per unit and when the
  adjustment is notified (first two business days of the month, with the invoice).
- Currency may be USD for cloud-cost pass-through; say so in the header and in every figure.

## ampliacion — a change of scope on a signed quote

Short. References the parent folio, lists only what is added or changed, prices it, states the effect on
dates and on the payment schedule. Same terms as the parent unless a line says otherwise.

- Sections: 01 Objeto (parent folio, what changes) · 02 Alcance adicional · 03 Inversión adicional ·
  04 Condiciones (only the deltas) · 05 Datos de facturación y pago (omit if unchanged: one line «los de
  la cotización {folio}»).

## Choosing

| Signal | Type |
|---|---|
| Deliverables are documents, sessions, designs; price per deliverable | consultoria |
| Deliverables are code or configured systems with acceptance criteria | desarrollo |
| There is a monthly amount | recurrente |
| A signed quote exists and the client asks for more | ampliacion |
