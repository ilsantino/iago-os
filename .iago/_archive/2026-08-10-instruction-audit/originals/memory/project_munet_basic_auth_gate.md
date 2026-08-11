---
name: project-munet-basic-auth-gate
description: munet.mx prod is password-gated behind Amplify HTTP basic auth since 2026-06-25; how to view and how to lift at launch
metadata: 
  node_type: memory
  type: project
  originSessionId: 0e9c575a-3d0e-4b43-9d89-52e2be0d4ce8
---

munet.mx (prod) is gated behind **AWS Amplify Hosting HTTP basic auth** as of 2026-06-25 — set so the in-progress site isn't publicly viewable/indexable before launch, but anyone with the link + shared password can see progress.

- **View it:** browse https://munet.mx, enter user `munet` / password `Munet2026!` at the browser login popup. Same creds work on the default `main.d2fjob0jvax0j8.amplifyapp.com` domain.
- **Where:** Amplify app `d2fjob0jvax0j8` (name `munet-web`), branch `main` (PRODUCTION stage), AWS account `851725296610` (Sebas's prod — local default AWS profile `il-santino` points here). See [[reference_munet_prod_aws]], [[reference_munet_canonical_domain]].
- **Lift at launch:** `aws amplify update-branch --app-id d2fjob0jvax0j8 --branch-name main --no-enable-basic-auth` (or flip "Access control" off in the Amplify Console). Takes effect immediately, no rebuild.

**Why:** chosen over a client-side "muy pronto" code screen because munet-web ships a full app bundle wired to a real backend (Stripe/Openpay, real Cognito users, DynamoDB orders) — a client-side gate is devtools-bypassable and would expose live payment/login flows; basic auth blocks at the CDN edge before the bundle loads. A "stop the host" blackout was rejected (kills progress-viewing, makes the domain look dead).
