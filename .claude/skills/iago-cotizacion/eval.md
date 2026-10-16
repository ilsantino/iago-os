# Routing eval — iago-cotizacion vs iago-proposal

Both produce a client-facing commercial document. The line: a **cotización** is priced, foliated,
signed and invoiced (legal entities, bank block, payment dates); a **proposal** scopes an engagement
(problem, approach, phases, cost range) before anyone commits. Scores 0–2 on Intent, Scope,
Reversibility, Stack, Workflow-phase; pass = expected skill ≥ 7 and unique top.

| Intent | iago-cotizacion | iago-proposal | Expected |
|---|---|---|---|
| «Give me the cotización again at 260k + IVA with our banking info» | 2+2+2+2+2 = **10** | 1+1+0+1+0 = 3 | cotizacion ✔ |
| «Accounting wants a folio, the full date and the client's razón social on the quote» | 2+2+2+2+2 = **10** | 0+0+0+1+0 = 1 | cotizacion ✔ |
| «Write a proposal for a POC for a new logistics client, budget 20–50k, 8 weeks» | 1+0+1+1+0 = 3 | 2+2+2+2+2 = **10** | proposal ✔ |
| «Draft the scope and phases we'd suggest for Palazuelos' dashboard, no prices yet» | 0+0+1+1+0 = 2 | 2+2+2+2+2 = **10** | proposal ✔ |
| «Quote the setup and monthly fee for the Absara bot, with SLA» | 2+2+2+2+2 = **10** | 1+1+0+1+1 = 4 | cotizacion ✔ |

Anti-triggers that keep them apart: `iago-cotizacion` says «Not when drafting an unpriced proposal or
scoping document»; `iago-proposal` says «Not when the project is already initiated». A priced document
with no legal entities and no payment dates is a proposal that needs a cotización next, not a cotización.
