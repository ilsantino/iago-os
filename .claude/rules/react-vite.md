---
description: >-
  React 19 + Vite + ShadCN/UI + TanStack Query patterns + Code Standards.
globs:
  - "src/**/*.{tsx,jsx,css}"
---

## Code Standards

- TypeScript strict — no `any`, no `as` casts (except type guards), no `@ts-ignore`
- Named exports only — no default exports
- Functional components only — no class components (error boundaries are the sole exception)
- Naming: kebab-case files, PascalCase components, camelCase utilities
- Barrel files (`index.ts`) only at public API boundaries
- Imports: external first, then internal with `@/` aliases

## React 19

- `use()` hook for data fetching inside `<Suspense>` boundaries — no useEffect for data loading
- Error boundaries wrap every feature route — use `react-error-boundary` or custom class component (only exception to no-class-components rule)
- `useTransition` for non-urgent state updates — keeps UI responsive during heavy renders
- `useOptimistic` for optimistic UI updates on mutations
- `ref` as a prop (no forwardRef needed in React 19)

## ShadCN/UI

- Always verify installation against official ShadCN docs — Vite setup differs from Next.js
- Install components via `npx shadcn@latest add {component}` — never copy-paste from docs
- Components land in `src/components/ui/` — do not move them
- Customize via CSS variables in `src/index.css`, not by editing component source
- Compose ShadCN primitives into feature components in `src/features/{name}/components/`

## TanStack Query

- Server state only — never use for UI state (use React Context or useState for that)
- Query keys: `[feature, entity, id]` pattern — e.g., `["users", "detail", userId]`
- `queryFn` calls typed API helpers — never inline fetch calls in components
- Mutations: `useMutation` with `onSuccess` invalidation — never manually update cache
- `staleTime`: 5 minutes default for list queries, 1 minute for detail queries
- Prefetch on hover/focus for navigation targets

## Vite

- Path aliases: `@/` maps to `src/` — configured in `vite.config.ts` and `tsconfig.json`
- Environment variables: `import.meta.env.VITE_*` — never use `process.env` in client code
- Lazy routes: `React.lazy(() => import("./features/{name}/page.tsx"))` wrapped in `<Suspense>`

## Forms

- React Hook Form + Zod: define Zod schema, infer TypeScript type, pass to `useForm<T>()`
- Controlled inputs via `Controller` for ShadCN components
- Server validation errors: map API error responses to `setError()` on specific fields
