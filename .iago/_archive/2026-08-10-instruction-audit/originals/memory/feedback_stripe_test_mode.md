---
name: Stripe test mode for development
description: Build full Stripe Connect flows with test keys, swap one env var at go-live
type: feedback
---

Do NOT wait for client's live Stripe account to build payment flows. Use test mode:
- `sk_test_` / `pk_test_` keys
- Create test connected account to simulate client
- Test card: 4242 4242 4242 4242
- OXXO and SPEI work in Stripe test mode
- At go-live: swap `STRIPE_CONNECTED_ACCOUNT_ID` env var + flip to live keys

**Why:** User explicitly stated this unblocks Phase 1 without waiting for FIMUNET's RFC/CLABE. Waiting for client data is a common mistake that stalls projects unnecessarily.

**How to apply:** When building any payment integration, default to test mode. Never block on client account setup for development work.
