---
name: email-setup-personal-gmail
description: "sanalvcham@gmail.com personal inbox — iaGO-style label+filter org system, protected categories, family-finance sensitivity"
metadata: 
  node_type: memory
  type: project
  originSessionId: ba262231-89c6-4ee6-a79a-0b1bb5ee35f6
---

sanalvcham@gmail.com is Santiago's PERSONAL Gmail (recovered 2026-06-29, cleansed/organized same day via the workspace-mcp Gmail MCP). It carries real family/financial correspondence — treat as sensitive, NOT junk. Companion to the business inbox [[email-setup-iagoag]].

Org system: 9 labels — 💳 Finanzas, 🛒 Compras y recibos, 🔐 Cuentas y seguridad, 👤 Personal (these 4 are PROTECTED: never trash), ✈️ Viajes, 🏃 Deporte, 💼 Trabajo y formación, 📰 Noticias, 📣 Promociones. 9 Gmail filters auto-sort future mail (junk → skip-inbox + label; finance alerts + receipts → label + archive; Finaccess/Google/Amazon-security → label, kept in inbox).

Cleanse 2026-06-29: inbox 3,490 → 170 (~95% reduction). ~4,700 junk trashed, ~3,100 archived+labeled (incl. a date-based archive of everything >1yr that wasn't a real person/finance), 31 one-click mailto-unsubscribes sent. Verified no protected mail trashed: Finaccess family wealth mgmt (finaccess.com/.mx/.es/.com.mx; advisor Diego Martinez DMartinez@finaccess.com; father Luis Miguel Alvarez lma@finaccess.mx / lumialva@gmail.com), Santander, GBM brokerage, Amex, Google/Amazon security.

Unsubscribes done for real (50 senders): 31 via mailto + 19 via RFC 8058 one-click POST (`curl -X POST --data "List-Unsubscribe=One-Click"` to the List-Unsubscribe **header** https URL — NOT the body link; read header via get_gmail_messages_content_batch body_format="raw"). Also a consolidated `Newsletters` label (Label_10) + ONE filter (52 promo domains → skip inbox + label) on top of the 9 topical filters. 8 senders have NO List-Unsubscribe header so can't be auto-unsubscribed (chordify, goodreads, adacnewsletter, a.mango, fireflies, ghin, experienciaiberia.iberia.com, ldtsoft.work) — the filter keeps them out instead.

**Weekly auto-cleanse (2026-06-30):** both inboxes are now swept weekly by a Windows Task Scheduler task **"Gmail Weekly Cleanse"** (Mon 08:00) running `C:\Users\sanal\.gmail-cleanse\gmail-weekly-cleanse.py --all`. It retroactively re-applies every skip-inbox filter to inbox drift — archive + label, **never trash**, protected-category guard. Full routine doc in [[email-setup-iagoag]]. Deterministic backstop only; NEW promo senders not yet in a filter still need a periodic manual/AI review.

**Why:** recovered neglected multi-year account; likely to need periodic re-cleanse. **How to apply:** filters keep it clean going forward. For a re-cleanse use workspace-mcp + SEQUENTIAL sub-agents — parallel Gmail API calls hit 429 "too many concurrent requests"; fetching >~1000 message headers in one sub-agent can crash the socket. One-click POST unsubscribe is the cleanest mechanism and works headless.
