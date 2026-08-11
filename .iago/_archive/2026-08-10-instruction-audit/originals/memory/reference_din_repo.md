---
name: DIN Pro pricing repo + Vercel
description: GitHub + Vercel locations for the DIN Pro pricing PoC simulation deliverable
type: reference
originSessionId: 05eece77-47fe-4bc5-ba04-0893d2c6acfd
---
DIN Pro pricing module lives at:

- **GitHub:** `github.com/ilsantino/dinpro-pricing` (private, created 2026-05-05). Personal namespace. Transfer to client/iagoag at handoff. Initial commit `b7b22c9` carries Phase 01 + 01b state.
- **Vercel:** `dinpro-app.vercel.app` (project named after `package.json` name "dinpro-app", NOT `dinpro-pricing` — that URL is 404). Live since 2026-05-06 with Phase 02 + simplified pricing model. Currently behind Vercel SSO/Deployment Protection — disable in Vercel dashboard → project → Settings → Deployment Protection to make public for DIN demos.
- **Local:** `iago-os/clients/din/dinpro-app/` — separate inner git repo inside iago-os's gitignored `clients/`. Folder name `dinpro-app` retained for legacy plan-file references; repo name `dinpro-pricing` is the deliverable's actual scope.

When working on DIN: cd into `clients/din/dinpro-app/` to access the inner repo. `clients/` is still gitignored from iago-os, so the inner repo is independent.

Phase 02+ will be visual demo only (mirrors munet-web `panel-ejemplo` pattern) — no Amplify, no Cognito, no Lambda. Pure frontend simulation.
