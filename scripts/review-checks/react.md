## React Checks (apply when diff touches .tsx component files — skip test files and non-component .tsx like theme/config)

### Severity Floors

| Pattern | Minimum Severity |
|---|---|
| Render-cycle violations: calling a state setter of another component during render, or triggering external side effects (fetch, DOM mutation, subscriptions) in the render phase — excludes hook initialization and dev-only logging | ALWAYS Critical |
| Eager imports of heavy SDKs (AWS SDK, chart libs, PDF generators) in app entry points or eagerly-imported route components — excludes code behind React.lazy() or dynamic import() | ALWAYS Critical |
| Missing useEffect for state-mutating or external side effects outside event handlers/transitions | ALWAYS Important |
| Hook rule violations: hooks called conditionally, inside loops, or in non-component/non-hook functions | ALWAYS Important |
| Missing error boundaries on lazy-loaded routes (React.lazy + Suspense without ErrorBoundary wrapper) | ALWAYS Important |

### Checks

- Render-cycle violations: calling setState on another component during render, or external side effects (fetch, subscription, DOM mutation) in the render phase — Critical in React 19 concurrent mode (triggers 'Cannot update a component while rendering a different component'). Note: hook initialization (useState/useRef) and console.log are NOT violations.
- Missing useEffect for effects: state-mutating or external side effects must be inside useEffect, event handler, or transition — never in the render body
- Stale closures in async callbacks: callbacks capturing state that may change before the callback resolves (common with setTimeout, fetch .then, event listeners)
- Eager imports of heavy SDKs: top-level imports of large libraries in app entry points or eagerly-imported route components — must be lazy-loaded. Code already behind React.lazy() boundaries is exempt.
- Improper Suspense boundaries: data-fetching components without wrapping Suspense, or Suspense boundaries that are too broad (wrapping the entire app instead of specific async sections)
- Missing error boundaries: lazy-loaded feature routes or async sections without error boundary wrappers — check the component tree, not just the immediate wrapper
- Hook rule violations: hooks called conditionally, inside loops, or in non-component/non-hook functions
- useOptimistic misuse: optimistic state not rolled back on mutation failure
- ref as prop: using forwardRef unnecessarily (React 19 accepts ref as a regular prop)
