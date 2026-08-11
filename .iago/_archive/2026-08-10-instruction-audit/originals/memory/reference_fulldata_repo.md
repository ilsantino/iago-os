---
name: FullData pricing mock repo
description: github.com/ilsantino/fulldata-pricing-mock — inner repo at clients/fulldata/web-pricing-mock/, demo-only single-page mock
type: reference
originSessionId: 2bf07a4d-471a-4538-8de5-a4d045f3ac2b
---
- **GitHub:** github.com/ilsantino/fulldata-pricing-mock (private)
- **Local:** `clients/fulldata/web-pricing-mock/` — inner git repo (own `.git/`), remote = origin = ilsantino/fulldata-pricing-mock
- **Stack:** Vite + React 19 + TypeScript + Tailwind 4 (`@tailwindcss/vite` + `@theme` CSS-first config) + Framer Motion. No backend, no tests (demo by design).
- **Source spec:** `clients/fulldata/out/04_executive_document.md` §3.1 (8 bandas + 5 add-ons, mensual/anual toggle, Pro destacada, "Próximamente" badge on add-ons)
- **All git ops** (commit, push, PR) happen INSIDE the inner repo — never from iago-os outer. iago-os has `clients/` in `.gitignore`.
- **Build:** `cd clients/fulldata/web-pricing-mock && npm run build` → ~105 KB gz, ~1.5s
- Status as of 2026-05-06: HEAD `d7c3c3e fix(ui): cards more compact + visible color baseline + numbered`, in sync with origin/main.
