# Standards for an iaGO cotización

Reference of the `iago-cotizacion` skill. What every quote must carry, in the order it appears, and
why. The first five rows of §2 are accounting's review of COT-RSF-002-2026 (16-oct-2026); each one
was a defect that reached a sent-ready document.

## 1 · Folio and ledger

- Scheme: `COT-{CLIENTE}-{NNN}-{YYYY}`. `CLIENTE` is the client slug in capitals (RSF, ABSARA,
  ONELEVEN); `NNN` counts per client, never resets; `YYYY` is the issue year.
- The ledger is the Obsidian note `_context/iago-agency/cotizaciones.md` (business docs live in `_context/`; read and write it through the Obsidian MCP only).
  One row per folio: folio · cliente (razón social) · tema · total sin IVA · emitida · vigencia ·
  estado (borrador · emitida · aceptada · sustituida por · rechazada) · archivo.
- Take the number before writing; write the row as «borrador»; update it on issue and on acceptance.
- A quote that changes amounts, dates or parties after being sent is a new folio; the old row reads
  «sustituida por COT-…». A wording fix before sending keeps the folio and takes a new date stamp.

## 2 · What accounting needs on the page

| # | Must have | Where | Why |
|---|---|---|---|
| 1 | Folio | header meta, footer of every page, README | identifies the quote in mails, authorisations, invoices and payments |
| 2 | Full issue date («16 de octubre de 2026») | header meta, terms | a month alone cannot anchor anything |
| 3 | Expiry as a date («hasta el 15 de noviembre de 2026») | header meta, terms (with the rule: «30 días naturales a partir de la fecha de emisión») | validity must be computable without reading the mail |
| 4 | The client's legal entity | eyebrow, objeto, acceptance line | the brand (Red Sun Farms) is not who contracts and pays (Agrícola El Rosal, S.A. de C.V.) |
| 5 | Objeto that separates done from pending | objeto | «servicios prestados» alone is wrong when the quote also covers work to come |
| 6 | Viáticos without meals | terms | iaGO does not bill meals; say so, or the client will expect them on the invoice |
| 7 | Our legal entity, RFC, fiscal address | objeto (name), bank block | the invoice is issued by the entity named here |
| 8 | Payment terms with dates | terms | each payment: amount, what it pays for, due date, «contra factura, por transferencia a la cuenta de la sección 06» |
| 9 | Bank block | last section | razón social, RFC, domicilio fiscal, banco, cuenta, CLABE, SWIFT, contacto; verify the CLABE before the first quote to a new client |
| 10 | Acceptance lines | after the bank block | «Por {razón social del cliente}» and «Por iaGO»: nombre y cargo, firma y fecha |

## 3 · The six sections

| § | Title (claim) | Content |
|---|---|---|
| 01 | Objeto | one paragraph: who for whom, the two parts with dates and section pointers, what it comprises, what is out |
| 02 | Servicios entregados (if any) | table Fecha · Entregable, names only; the on-site weeks named as such |
| 03 | Servicios por realizar | table Bloque · Alcance · Cuándo; one line per block; «por acordar» on proposed dates |
| 04 | Inversión | amounts table: group rows, lines, subtotal per group, total; one line of prose with the total «más IVA» |
| 05 | Condiciones | forma de pago · vigencia · viáticos · confidencialidad · propiedad (· garantía, SLA, mora for recurring work) |
| 06 | Datos de facturación y pago | the bank block, then the acceptance columns |

The calendar lives inside §03 («Cuándo»). There is no «supuestos», no «qué sigue», no asks: anything the
client must give us goes in the mail, not in the quote.

## 4 · Text rules

- Client Spanish, formal register: «el cliente», «se facturan», «se cotiza por separado». No «ustedes»
  chat, no «nos digan», no first names in the terms (first names are fine inside a block's scope line).
- Headings are labels (Objeto, Inversión), not sentences. Eyebrow carries only the section number.
- Entregables by name, in «guillemets», with the date they were delivered. No descriptions of what they are.
- Figures: `$160,000` in tables (mono, right-aligned), «$260,000 MXN más IVA» in prose. The table header
  says «MXN, sin IVA». Never a figure the table does not carry.
- One rate per unit of work across the document: if a week on site is 30,000 in the delivered part, it is
  30,000 in the pending part. Price per deliverable, never per hour, unless the type says otherwise.
- No brackets, no placeholders, no internal codes (E-nn, NS-nn, PV-nn, Hnn), no savings claims.
- Three pages. If it does not fit, cut words; never shrink the print sheet.

## 5 · Standard wording (paste, then adapt names and dates)

- **Forma de pago, one payment.** «Un solo pago a la aceptación de esta cotización, contra factura, por
  transferencia a la cuenta de la sección 06.»
- **Forma de pago, two payments.** «Dos pagos, contra factura, por transferencia a la cuenta de la sección 06:
  $X MXN más IVA por los servicios prestados, a más tardar el D de mes de AAAA; y $Y MXN más IVA al cierre
  de la consultoría, el D de mes de AAAA.»
- **Vigencia.** «30 días naturales a partir de la fecha de emisión, D de mes de AAAA: hasta el D de mes de AAAA.»
- **Viáticos.** «Traslados y hospedaje del trabajo en sitio se facturan por separado, a costo, con aprobación
  previa del cliente. Los alimentos no se facturan: corren por cuenta de iaGO.»
- **Confidencialidad.** «La información del cliente se utiliza exclusivamente para este trabajo.»
- **Propiedad (consultoría).** «Los entregables son propiedad del cliente desde su entrega. iaGO conserva sus
  métodos y herramientas de uso general.»
- **Propiedad (desarrollo).** «El código fuente y su documentación son propiedad del cliente desde su entrega
  y pago. iaGO conserva sus métodos, bibliotecas y herramientas de uso general.»
- **Fuera de alcance.** «El desarrollo de la solución no forma parte de esta cotización; se cotiza por separado
  al concluir el diseño.»
