---
name: munet-client-project
description: "Museum platform for FIMUNET — location, infra, and the two live tracks (visual rework + pagos v0)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 28bafbe0-c67b-4788-9a07-c8d4b1837a5c
---

MUNET (Museo Nacional de Energia y Tecnologia) is iaGO's first major client deployment. Public museum website, online+in-person ticketing with QR codes, payments, and Panel MUNET admin dashboard.

**Revenue model:** Tech fee per ticket ($4 MXN fixed + 2% per paid order) — already in `pricing-engine.ts`.
**Domain:** munet.mx (basic-auth gated until launch). **GitHub:** bas-labs/munet-web. **Amplify:** app d2fjob0jvax0j8, only `main` connected/auto-builds (verified 2026-07-03).

## Location

`iago-os/clients/munet-web/` — inner repo of bas-labs/munet-web. Plans at `clients/munet-web/.iago/plans/`. PRs target `main` (repo convention, safe while site is auth-gated).

## Live tracks (as of 2026-07-03)

1. **Visual rework** — orchestration doc `C:\Users\sanal\Downloads\MUNET_ClaudeCode_Orquestacion_Fable.md` (waves W0-W4, ownership-frozen parallel sessions). W0 done: snapshot branch `munet-v1-iago` @ 6d1c441 pushed (inert, no auto-deploy); audit run 2026-07-03. Branding frozen (DM Sans/Inter, #8DC63F/#0A6847). Real paths are flat `src/pages/*Page.tsx`, NOT `pages/Home/*`. Plans reorganized 2026-07-03 into **4 ownership lanes** at `.iago/plans/feature-munet-visual-rework/`: `lane-1-spine/` (03→06→09, critical+revenue path), `lane-2-pages/` (02,04,05→07), `lane-3-panel/` (08→10, isolated), `lane-4-content/` (11, content-blocked), `_shipped/01-prep-ia.md`, + master `README.md` (team-of-3/2/solo assignment + worktree setup) + `execution-order-analysis.md` (dep graph). Each lane has a per-lane charter README (Fable-workflow authored, wf_42178375) with exclusive file-ownership + exact per-plan pruebas content asks. **Lanes run PARALLEL — dep chains are in-lane; only `src/App.tsx` is the cross-lane freeze** (01 registered all routes; only plan 07 edits it). Corrected: plan 10 does NOT touch PanelShell (only 08 does). Gap: plan 01 scaffolded only 5 of 7 content/pruebas .md — plans 03/05 must create home.md/visitas-grupales.md on their own branches. Plan 01 SHIPPED as **PR #102** (green, 627 tests) — @claude-tagged via iago-prfix 2026-07-03 (async loop running); dev server run locally (localhost:5173) for Santiago to view before merge. Fable dual-adversarial pre-merge = deferred to "future plans" standard (01 already dual-reviewed in-pipeline). **Fast-path standard (Santiago 2026-07-03): Fable for impl/debug/codegen in dynamic workflows; dual-adversarial-fix on Fable ∥ Codex; single @claude tag; Santiago merges.**

**Plans live LOCAL only (Santiago 2026-07-03, said 3×): `.iago/plans/` — NEVER on GitHub.** CODE ships via PR to main (normal); only the plan DOCS stay local. Reorganized 2026-07-03: top = `feature-munet-visual-rework/` + `feature-pagos-v0/` (active) + `_archive/` (M1/M2/M3/feature-roles/prior features) + `README.md`. PR #101 (docs/plans push) CLOSED + docs/plans git-rm'd from the branch. Editors HIDE `.iago/` (gitignored) — that's why Santiago couldn't see plans; view via Windows Explorer or unhide gitignored in Cursor. **feature-pagos-v0/ is SELF-CONTAINED** (PLAN-MAESTRO.md + SEBAS-START.md + assets/ + support/{mapa-boletos-v2,kit-operativo,mercadopago-integracion-2026}.md) — hand the whole folder to Sebas; all refs are bundle-relative.

**Content protocol:** pruebas.munet.mx is BOT-RESTRICTED — can't fetch programmatically. When any task needs real copy or images, FLAG exactly what+which page; Santiago provides it → lands in `content/pruebas/`. Until then pages show `⟦PLACEHOLDER⟧` (never invent copy). Live current-site content readable at munet.mx with basic auth munet/Munet2026! (canonical museomunet.com) if needed as a fallback reference.

**STANDING RULES (Santiago 2026-07-03) — apply to ALL munet visual-rework work:**
1. **munet.mx style/branding/design only** — DM Sans/Inter, #8DC63F/#0A6847, and munet's OWN code formatting (2-space, single-quote, no-semi, es5 commas — NOT iago-os Biome). Enforced by the fixed format hook (now skips `clients/**`) + agents told to match the file. No foreign reformatting.
2. **CONTENT GATE — present a Content Change Manifest BEFORE implementing any plan:** a per-page table of every text string ADDED / EDITED / REMOVED vs the live site. Santiago replies: proceed / edit the text / change the command. NO copy is written or shipped without his sign-off. Placeholders (`⟦PLACEHOLDER⟧`) for net-new sections still require the manifest so he sees what's being staged. He said he can provide ALL real content.
2. **Pagos v0** — see [[project_munet_pagos_v0]]. Plan maestro at `clients/munet-web/docs/research/pagos-caja/12-plan-maestro-v0/` (Sebas-ready, discovery questions §8). Mocks from visual rework (group form, panel boards) get wired real here — payload contracts must be frozen between tracks.

M1-M3 history + M4 (prod deploy, blocked on FIMUNET RFC/CLABE/INE) in `.iago/plans/` + STATE.md of the inner repo.

## Infra (snapshot 2026-04, verify before use)

- Sandbox: amplify-munetweb-sanal-sandbox (us-east-1), secrets via `npx ampx secret set`
- Prod Cognito: Sebas + Santiago Admin; groups Admin/Operador
- AWS: il-santino IAM user, us-east-1
- Known gap: backend SSM secrets not set (Stripe, SES, QR HMAC)
- Repo has 55 dependabot vulns on main (1 critical, 20 high) as of 2026-07-03 — pending sweep
