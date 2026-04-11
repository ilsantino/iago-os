## React Checks (triggered by *.tsx changes)

- Render-cycle violations: side effects in render body, calling setState on another component during render — this is **Critical** in React 19 concurrent mode (triggers 'Cannot update a component while rendering a different component')
- Missing useEffect for effects: any side effect (fetch, subscription, DOM mutation, state update) must be inside useEffect, event handler, or transition — never in the render body
- Stale closures in async callbacks: callbacks capturing state that may change before the callback resolves (common with setTimeout, fetch .then, event listeners)
- Eager imports of heavy SDKs: top-level imports of large libraries (AWS SDK, chart libs, PDF generators) in app entry points or route components — must be lazy-loaded via dynamic import() or React.lazy()
- Improper Suspense boundaries: data-fetching components without wrapping Suspense, or Suspense boundaries that are too broad (wrapping the entire app instead of specific async sections)
- Missing error boundaries: feature routes or async sections without error boundary wrappers
- Hook rule violations: hooks called conditionally, inside loops, or in non-component/non-hook functions
- useOptimistic misuse: optimistic state not rolled back on mutation failure
- ref as prop: using forwardRef unnecessarily (React 19 accepts ref as a regular prop)
