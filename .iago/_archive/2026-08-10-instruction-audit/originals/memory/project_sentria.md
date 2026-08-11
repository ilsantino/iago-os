---
name: Sentria (Absara) project
description: WhatsApp→Telegram migrated incident-management bot for Absara, AWS Amplify Gen 2 stack, ~$165/mo on Telegram (~$175 saved vs original Twilio cotización)
type: project
originSessionId: 7995aa98-171e-4e3e-8d9a-7406e2779c0e
---
**Client:** Absara S.A. de C.V. — Pablo Haddad (COO, decision-maker), Daniel Chamlati (CEO), Daniel Alvarez Morales (project owner / day-to-day).

**Repo:** `github.com/bas-labs/sentria` (private, bas-labs org). Inner repo at `clients/sentria/` inside iago-os. NOT under ilsantino/.

**Stack:** React 19 + Vite + TS + shadcn/ui frontend; AWS Amplify Gen 2 (AppSync + Cognito + Lambda Node 20 + DynamoDB + S3 + EventBridge + SES + SSM); Telegram Bot API for messaging (Twilio/WhatsApp dropped). Spanish copy, English code. No automated test suite.

**Channel:** Telegram only. Migrated from Meta Business / WhatsApp during Nov-2025 to early-2026 — Pablo greenlit Telegram in the Nov-20-2025 demo, Meta approval was a caos. Cost on Telegram: $0 messaging, ~$165/mo AWS infra. Down from $340/mo Mes 1 cotización (~$175/mo savings on Twilio variable). Confidence HIGH — verified against Telegram Bot API docs (no volume tiers, 30 msg/sec global + 1 msg/sec per chat free).

**Why:** Confirms Pablo's Telegram pivot was the right call commercially, not just operationally. The $165 estimate could float ±$50 on DynamoDB/S3 spikes, so monitor monthly. Bedrock IS used (incident classification), already priced into the $165 anchor.

**How to apply:** When Santiago asks "what does Sentria cost monthly," answer ~$165 USD AWS-only on Telegram. Original cotización (COT-ABSARA-001-2025: $3,415 setup + $340 Mes 1, $165+variable Mes 2+) priced WhatsApp/Twilio — that variable line is now zero. Active recurring savings = ~$175/mo. When advising Sentria roadmap, default to Telegram primitives (Bot API, inline keyboards, webhook), not Twilio. The bot owns 11+ Spanish-locale templates, escalation chain walker, supervisor visibility.

**Active branches (2026-05-07):** `main` and `sentria-qc` are parity (sentria-qc is integration base for new feature waves). PRs from feature branches now target sentria-qc per Santiago's instruction, not main. Reporter-notifications work plan lives at `clients/sentria/.iago/plans/feature-reporter-notifications/01.md`.

**Open question:** Sentria CV blurb says "multi-agent incident system" but cotización scope and current code are single-bot conversational. Pablo wants more bots ("metiendo más bots que empleados") — multi-bot is roadmap, not current scope.
