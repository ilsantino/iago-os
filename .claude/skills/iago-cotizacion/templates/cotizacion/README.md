# Fragment templates — one file per section

Copy this folder to `{deliverable}/4-entregado/fuente/cotizacion/`, fill every `{{PLACEHOLDER}}`, add or
remove table rows. `<!--LOCKUP-->` is replaced by the build with the final horizontal logo (`assets/iago-logo-horizontal-light.png`, from `iago-web/workspace/deliverables/2026-09-logo-final`).
The amounts table keeps its row classes: `group` (a heading row), `line` (priced), `sub` (subtotal of the
lines above it since the last group), `total`. The build sums them. Bank values come from the Obsidian
vault note «ALTA CUENTA PROVEEDOR» (never from memory); the RFC and CLABE are checked by hand once per
client. A type without delivered work drops `02-entregado.html` and the first group of the amounts table.
