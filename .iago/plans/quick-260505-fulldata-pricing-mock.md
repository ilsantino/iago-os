---
phase: quick
plan: quick-260505-fulldata-pricing-mock
wave: 1
depends_on: []
created: 2026-05-05
branch: feat/quick-fulldata-pricing-mock
base: main
---

# Quick: FullData pricing page demo mock (Vite + React 19 + Tailwind 4 + Framer Motion)

## Goal

Scaffold a single-page demo mock at `clients/fulldata/web-pricing-mock/` that renders the FullData pricing model from `clients/fulldata/out/04_executive_document.md` §3.1. Standalone Vite app — separate from any existing iago-os build. Output must be a successful local production build (`npm run build`) inside the sub-project; Santiago handles Vercel deployment manually after the scaffold lands.

## Non-goals

- No backend, API, auth, or persistence.
- No internationalization beyond Spanish (the source is Spanish).
- No Vercel deployment automation — manual via dashboard after the PR merges.
- No tests (vitest/playwright) — demo mock, not production code. Justify by scope: single static page, no business logic to assert.
- No ShadCN/UI primitives — overkill for this single page; raw Tailwind + a few custom components is enough.
- iago-os root build gate (`tsc --noEmit && vite build` at repo root) does NOT apply — iago-os has no Vite config. The build gate auto-skips when `tsconfig.json` and `vite.config.*` are absent at `PROJECT_DIR`. Local verification runs inside `clients/fulldata/web-pricing-mock/`.

## Stress Test

Adversarial review of this plan against pricing-mock precedents (munet-web/panel-ejemplo, din pricing) and the constraints in CLAUDE.md.

### Probes

1. **Build gate semantics** — Confirmed via `scripts/execute-pipeline.sh` lines 341-344 and `lib/build-gate.sh`: when `HAS_TSCONFIG=false` and `HAS_VITE=false` at PROJECT_DIR, the gate produces a no-op. Sub-project Vite/TSC config at `clients/fulldata/web-pricing-mock/` does NOT trigger root-level build because the gate only inspects PROJECT_DIR top-level. Plan stays valid: the implementation task carries its own verification (`cd clients/fulldata/web-pricing-mock && npm install && npm run build`).

2. **Tailwind 4 setup with Vite** — Tailwind 4 changed the integration story (PostCSS deprecated for Vite; use `@tailwindcss/vite` plugin). Plan must instruct the agent to use `@tailwindcss/vite`, not the legacy `postcss + tailwindcss` setup. Brand palette goes in `src/index.css` via `@theme` block (Tailwind 4's CSS-first config), not `tailwind.config.js`. CLAUDE.md feedback memory `feedback_shadcn` requires verifying ShadCN setup against official docs for Vite — same principle applies to Tailwind 4. Plan task 1 explicitly references this.

3. **React 19 ref-as-prop** — No forwardRef needed; ref passes as a regular prop. Plan does NOT introduce class components.

4. **Framer Motion animation count vs scope** — Hero stagger, hover-lift cards, toggle thumb spring, AnimatePresence price morph, `whileInView` add-on cards. Five distinct animation patterns is acceptable for a single page; not over-animated. The Pro card glow is a Tailwind ring + scale, not a Framer animation, to avoid layout thrash.

5. **Add-on "Próximamente" badge clarity** — Source doc explicitly says these are roadmap, NOT in production. Badge must read "Próximamente — en desarrollo" verbatim per the user spec. Cards visually disabled (opacity 0.7, no hover-lift) so the demo doesn't suggest they are purchasable. Plan calls this out.

6. **Annual price math** — `precio_anual = precio_mensual * 12 * 0.88`. For Pro: $8,995 × 12 × 0.88 = $94,987.20. Round to MXN integer (no centavos in display). The source doc cites $94,987 explicitly for Pro annual prepay — math reconciles to the doc within rounding. Plan specifies integer rounding via `Math.round`, not `Math.floor` or formatting truncation.

7. **Branch + path conflicts** — `clients/fulldata/web-pricing-mock/` does not exist. No conflict with existing `clients/fulldata/out/`. Branch `feat/quick-fulldata-pricing-mock` is fresh.

8. **Logo PNG import** — `logo.png` (10.86 KB, RGBA) is small enough to ship via `public/logo.png` and reference as `<img src="/logo.png">`. No need to import as a module or inline as base64.

### Verdict

**PROCEED.** No blockers. Notes for implementer: (a) use `@tailwindcss/vite` plugin (Tailwind 4 Vite integration), (b) verify Tailwind 4 brand tokens render via a quick `<div className="bg-brand-primary text-brand-light">` smoke check before building cards, (c) round annual prices with `Math.round`, (d) add-on cards must be visually disabled, not just badged.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Create | `clients/fulldata/web-pricing-mock/package.json` | Vite + React 19 + TS + Tailwind 4 + Framer Motion deps |
| Create | `clients/fulldata/web-pricing-mock/vite.config.ts` | Vite config with `@tailwindcss/vite` plugin and React plugin |
| Create | `clients/fulldata/web-pricing-mock/tsconfig.json` | TypeScript strict config (Vite default + strict: true, noUncheckedIndexedAccess) |
| Create | `clients/fulldata/web-pricing-mock/tsconfig.node.json` | Vite/Node-side tsconfig |
| Create | `clients/fulldata/web-pricing-mock/index.html` | HTML entry, lang="es", title "FullData — Pricing", favicon to /logo.png |
| Create | `clients/fulldata/web-pricing-mock/public/logo.png` | Copy from `clients/fulldata/out/branding/logo.png` |
| Create | `clients/fulldata/web-pricing-mock/src/main.tsx` | React 19 root render |
| Create | `clients/fulldata/web-pricing-mock/src/index.css` | Tailwind 4 import + `@theme` brand palette + base styles |
| Create | `clients/fulldata/web-pricing-mock/src/App.tsx` | Mounts `<PricingPage />` |
| Create | `clients/fulldata/web-pricing-mock/src/data/pricing.ts` | Typed pricing data (bandas, add-ons) sourced from §3.1 |
| Create | `clients/fulldata/web-pricing-mock/src/components/Hero.tsx` | Logo + H1 + subtitle, fade-in stagger |
| Create | `clients/fulldata/web-pricing-mock/src/components/BillingToggle.tsx` | Mensual/Anual switch with spring thumb |
| Create | `clients/fulldata/web-pricing-mock/src/components/BandCard.tsx` | Single band card with hover-lift + animated price morph |
| Create | `clients/fulldata/web-pricing-mock/src/components/BandsGrid.tsx` | Grid of 8 BandCards, Pro destacada |
| Create | `clients/fulldata/web-pricing-mock/src/components/AddOnsSection.tsx` | 5 add-on cards, "Próximamente" badge, viewport stagger |
| Create | `clients/fulldata/web-pricing-mock/src/components/Footer.tsx` | AYCE summary line + 1-mes-gratis line |
| Create | `clients/fulldata/web-pricing-mock/src/components/PricingPage.tsx` | Composes Hero + BillingToggle + BandsGrid + AddOnsSection + Footer |
| Create | `clients/fulldata/web-pricing-mock/.gitignore` | node_modules, dist, .env*, .DS_Store |
| Create | `clients/fulldata/web-pricing-mock/README.md` | One-paragraph description + dev/build commands |

## Tasks

### Task 1: Scaffold Vite + React 19 + TS + Tailwind 4 + Framer Motion

- **files:** all package.json / vite.config.ts / tsconfig*.json / index.html / main.tsx / index.css / App.tsx / .gitignore / public/logo.png / README.md from the table above.
- **action:**
  - Create `clients/fulldata/web-pricing-mock/` directory.
  - Author `package.json` with deps: `react@^19`, `react-dom@^19`, `framer-motion@^11`. Dev deps: `@vitejs/plugin-react@^4`, `vite@^5`, `typescript@^5.7`, `@types/react@^19`, `@types/react-dom@^19`, `tailwindcss@^4`, `@tailwindcss/vite@^4`. Scripts: `dev`, `build` (`tsc --noEmit && vite build`), `preview`.
  - `vite.config.ts` registers `@vitejs/plugin-react` and `@tailwindcss/vite`. Sets `base: "/"`. No path aliases needed (single-app simple imports).
  - `tsconfig.json`: strict, noUncheckedIndexedAccess, noFallthroughCasesInSwitch, target ES2022, module ESNext, moduleResolution bundler, jsx react-jsx, isolatedModules, allowSyntheticDefaultImports. References tsconfig.node.json.
  - `tsconfig.node.json`: covers vite.config.ts (composite, target ES2022, module ESNext, moduleResolution bundler).
  - `index.html`: lang="es", `<title>FullData — Pricing</title>`, `<link rel="icon" href="/logo.png">`, root div + `<script type="module" src="/src/main.tsx"></script>`.
  - `public/logo.png`: copy from `clients/fulldata/out/branding/logo.png` (use `cp` command — file is 10.86 KB, binary).
  - `src/main.tsx`: React 19 createRoot, no StrictMode wrapping (simpler for demo, no double-render in animations).
  - `src/index.css`: `@import "tailwindcss";` then `@theme { --color-brand-primary: #D86030; --color-brand-light: #F07830; --color-brand-bright: #FF9030; --color-slate-{800,600,400,200,50}: <hex>; --font-sans: "Segoe UI", "Inter", system-ui, sans-serif; }`. Body bg: slate-50, text: slate-800, font-sans.
  - `src/App.tsx`: `export const App = () => <PricingPage />;` (named export).
  - `.gitignore`: node_modules/, dist/, .env*, .DS_Store, *.local.
  - `README.md`: one paragraph describing the mock + `npm install && npm run dev` and `npm run build`.
- **verify:**
  ```bash
  cd clients/fulldata/web-pricing-mock && npm install --no-audit --no-fund && npx tsc --noEmit
  ```
- **expected:** `npm install` exits 0; `tsc --noEmit` exits 0 with no errors. (PricingPage component imported from App.tsx may not exist yet — task 2 creates it. To unblock task 1's verify, App.tsx in task 1 should render a placeholder `<div>FullData pricing mock — pending content.</div>` and task 2 replaces App.tsx's body with `<PricingPage />`.)

### Task 2: Build PricingPage with all sections + Framer Motion animations

- **files:** all `src/data/pricing.ts` + `src/components/*.tsx` from the table; update `src/App.tsx` to render `<PricingPage />`.
- **action:**
  - `src/data/pricing.ts`: export typed arrays.
    - `type Banda = { id: string; nombre: string; subtitle?: string; rangoUnidades: string; precioMensual: number | null; ctaCustom?: boolean; recomendado?: boolean; };`
    - `BANDAS: Banda[]` with 8 entries (Starter, Basic, Pro [recomendado=true], Growth, Scale, Fleet, Custom [precioMensual=null, ctaCustom=true]).
    - `type AddOn = { id: string; nombre: string; precio: string; segmento: string; };`
    - `ADDONS: AddOn[]` with 5 entries verbatim per spec.
  - `BillingToggle.tsx`: controlled component, props `{ mode: "monthly" | "annual"; onChange(mode): void }`. Renders pill with two labels, an absolutely positioned thumb that animates `x` between 0 and the right slot via `motion.div` + spring transition (`stiffness: 400, damping: 30`).
  - `BandCard.tsx`: props `{ banda: Banda; mode: "monthly" | "annual" }`. Computes display price: if `precioMensual === null`, render "Habla con ventas". Else if mode === "monthly", render `$${formato(precioMensual)} MXN/mes`. Else render `$${formato(Math.round(precioMensual * 12 * 0.88))} MXN/año` plus a small line "($${formato(Math.round(precioMensual * 0.88))} MXN/mes equivalente)". `formato` uses `Intl.NumberFormat("es-MX")` with no currency symbol so we control the `$` placement. Wrapper `motion.div` with `whileHover={{ y: -8, scale: 1.02 }}` and `transition={{ type: "spring", stiffness: 300, damping: 20 }}`. If `recomendado`, base scale 1.03, ring `ring-2 ring-brand-primary`, badge "★ Recomendado" pill at top. Price uses `<AnimatePresence mode="wait">` keyed on `${mode}-${banda.id}` with motion.span fading and sliding (y: 8 → 0 → -8).
  - `BandsGrid.tsx`: lays out the 8 cards. Use `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6`. Pro card spans extra emphasis via the inner ring; no grid-span trickery to keep layout predictable.
  - `Hero.tsx`: container with `motion.div` parent, `variants` with stagger 0.15s. Children: `<motion.img src="/logo.png" alt="FullData" className="h-12">`, `<motion.h1>` ("Precios FullData"), `<motion.p>` (subtitle: "All-You-Can-Eat por banda. Un precio mensual, todo incluido."). Each child `variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }}`.
  - `AddOnsSection.tsx`: H2 + paragraph framing ("Roadmap modular — desarrollo pendiente"). Grid of 5 cards (`md:grid-cols-2 lg:grid-cols-3`). Each card uses `motion.div` with `whileInView={{ opacity: 1, y: 0 }}` initial `{ opacity: 0, y: 20 }`, `viewport={{ once: true, margin: "-10%" }}`, stagger via `transition={{ delay: index * 0.08 }}`. Card has opacity-70, no hover-lift, badge pill "Próximamente — en desarrollo" in the corner with `bg-brand-light/15 text-brand-primary border border-brand-light/40`.
  - `Footer.tsx`: two lines of muted slate-600 text. First: "AYCE — Sin cobro por timbre. Sin cobro por usuario adicional. Soporte ilimitado." Second: "1 mes gratis al activarse. La revenue empieza desde el segundo mes natural."
  - `PricingPage.tsx`: `useState<"monthly" | "annual">("monthly")`. Renders `<Hero />`, `<BillingToggle mode={mode} onChange={setMode} />`, `<BandsGrid mode={mode} />` (passes mode down to BandCards), `<AddOnsSection />`, `<Footer />`. Container: `max-w-7xl mx-auto px-6 py-16 space-y-16`.
  - Update `src/App.tsx`: `import { PricingPage } from "./components/PricingPage"; export const App = () => <PricingPage />;`.
- **verify:**
  ```bash
  cd clients/fulldata/web-pricing-mock && npm run build && ls dist/index.html dist/assets/
  ```
- **expected:** `vite build` exits 0; `dist/index.html` exists; `dist/assets/` contains the bundled JS + CSS. Bundle size sanity: under 500 KB gzipped (a single-page React 19 + Framer Motion app should land around 80-150 KB gzipped).

## Acceptance criteria

1. `clients/fulldata/web-pricing-mock/` exists with the file structure above.
2. `npm install && npm run build` inside that directory exits 0.
3. The page renders 8 band cards with Pro visually distinguished (ring + badge + slight scale).
4. The Mensual/Anual toggle changes prices with a visible morph animation; annual prices match `Math.round(monthly * 12 * 0.88)`.
5. The 5 add-on cards each show the "Próximamente — en desarrollo" badge and are visually muted.
6. Hero animates in on first paint (stagger fade-in); band cards lift on hover; add-ons stagger in on scroll.
7. Brand colors render correctly (primary #D86030 visible on Pro ring + CTA elements; slate scale on body/borders).
8. The footer reflects the AYCE / 1-mes-gratis copy verbatim per the spec.
9. `clients/fulldata/out/branding/logo.png` is copied to `public/logo.png` (not symlinked).

## Out of scope (deferred)

- Vercel deployment (Santiago, manual via dashboard).
- Screenshot capture (Santiago, post-deploy).
- A11y audit beyond semantic HTML basics (single-page demo, full audit not warranted).
- Lighthouse / performance tuning beyond the default Vite production build.
- Mobile-specific optimizations beyond Tailwind responsive breakpoints used in BandsGrid / AddOnsSection.
