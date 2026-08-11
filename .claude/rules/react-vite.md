---
description: >-
  React 19 + Vite house standards.
globs:
  - "src/**/*.{tsx,jsx,css}"
---

## House Standards

- Named exports only — no default exports. No `as` casts (type guards excepted).
- kebab-case files, PascalCase components, camelCase utilities. Barrel `index.ts` only at public API boundaries.
- Error boundary wraps every feature route. Feature routes lazy-load: `React.lazy` + `<Suspense>`. Feature folders: `src/features/{name}/`.

## ShadCN/UI

- Install via `npx shadcn@latest add {component}` — never copy-paste from docs; verify setup against official Vite docs (Vite ≠ Next).
- Never edit `src/components/ui/` source — customize via CSS variables in `src/index.css`; compose primitives into `src/features/{name}/components/`.

## TanStack Query

- Server state only (UI state = Context/useState). Query keys: `[feature, entity, id]`. `staleTime`: 5 min lists, 1 min detail.
- Mutations invalidate via `onSuccess` — never manually update cache. Prefetch navigation targets on hover/focus.
