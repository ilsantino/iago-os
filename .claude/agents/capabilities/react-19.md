# React 19 Patterns

## Data Fetching
- Use `use()` hook inside `<Suspense>` boundaries for data fetching — never `useEffect` for loading data
- Wrap every feature route in an error boundary to catch fetch and render failures
- Place error boundaries at the feature route level, not inside individual components

## ShadCN/UI
- Install components via `npx shadcn@latest add {component}` — never copy-paste from docs
- Components land in `src/components/ui/` — do not relocate them
- Customize via CSS variables in `src/index.css`, not by editing component source files
- Compose ShadCN primitives into feature components in `src/features/{name}/components/`

## TanStack Query
- Query keys follow `[feature, entity, id]` pattern — e.g., `["users", "detail", userId]`
- `queryFn` must call a typed API helper — never inline `fetch` calls inside components
- Use `useMutation` with `onSuccess` invalidation — never manually update the cache
- Default `staleTime`: 5 minutes for list queries, 1 minute for detail queries
- Prefetch on hover or focus for navigation targets

## Concurrent UI
- Use `useTransition` for non-urgent state updates that should not block the UI
- Use `useOptimistic` for immediate UI feedback on mutations before the server responds

## Component Conventions
- `ref` is a plain prop in React 19 — no `forwardRef` wrapper needed
- Functional components only — no class components (error boundaries are the sole exception)
- Named exports only — no `export default`
