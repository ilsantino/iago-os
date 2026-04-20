---
name: frontend-bug-bounty
description: >-
  Use when the user asks for a frontend-only repo audit — hunting React 19
  hook misuse, stale closures, race conditions, effect/cleanup leaks,
  TypeScript type-drift, Vite misconfig, Tailwind v4 CSS-first pitfalls, AND
  data-pipeline correctness bugs (paginated KPIs, NaN aggregates, money drift,
  tenant-filter on aggregates). Scoped to React + Vite + TypeScript + Hooks +
  Tailwind CSS. Does NOT cover Amplify/AWS wiring — use `/amplify-bug-bounty`
  for that.
audit_scope: standalone
audit_disclaimer: >-
  This is an audit snapshot. Highest-leverage Section Q rules from this skill
  are also promoted into the local pipeline at
  `scripts/review-checks/data-integrity.md` and run on every plan touching
  dashboards, KPIs, charts, paginated tables, currency math, or aggregate
  hooks. Use this full skill for periodic deep sweeps (new client onboarding,
  pre-launch hardening, post-incident audits) — not as a per-plan gate.
  Rules below may lag the live pipeline module.
---

## Purpose

Scan a React + Vite + TS + Tailwind frontend end-to-end and report
**actionable bugs only** — rule-of-hooks violations, effect-based data
races, dependency-array lies, memoization misuse, Suspense/ErrorBoundary
gaps, TypeScript escape hatches, Vite config foot-guns, Tailwind v4 CSS-first
drift, accessibility regressions that actually break users, **and functional
data-pipeline bugs where the numbers on screen are wrong** (miscomputed
stats, truncated/unpaginated lists, off-by-one date ranges, floating-point
currency, missing tenant filters in aggregates, stale cache after mutation).
Output is a severity-ranked punch list, no filler.

Out of scope: Amplify client wiring, AWS authorization, backend Lambda,
IAM — delegate those to `/amplify-bug-bounty`. However, a hook that calls
AppSync *and* miscomputes what it shows the user IS in scope — the bug is
the calculation / the truncation, not the AWS wiring.

## Arguments

`/frontend-bug-bounty` — full sweep.

Optional:
- `--scope {hooks|state|types|build|styles|all}` — default `all`
- `--modules {A,B,C,…}` — run only specific rule modules (see §4)
- `--quick` — skip §5 cross-file analysis, run §4 per-file checks only

## Steps

### 1. Orient

Read in this order — do not skip if the file exists:

1. `package.json` — confirm React 19, Vite, TypeScript, Tailwind versions
2. `vite.config.ts` / `vite.config.js`
3. `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`
4. `tailwind.config.ts` (if present — flag if Tailwind v4 with colors defined here)
5. `src/index.css` / `src/main.css` / `src/app.css`
6. `src/main.tsx` — mount, `StrictMode`, top-level providers
7. `src/App.tsx` — router, global providers, error boundaries
8. `src/router.tsx` or equivalent routes file (if present)
9. `src/lib/` / `src/utils/` — `cn`, date helpers, error helpers
10. 3–5 representative files from each of:
    - `src/components/` (shared/ui composition)
    - `src/features/*/components/`
    - `src/hooks/` (custom hooks)
    - `src/pages/` (route pages)
    - `src/contexts/` (React Context providers)
    - `src/features/*/api.ts` / `src/features/*/queries.ts` (data layer)
11. `.env*` (check gitignore), `index.html`
12. `eslint.config.*` / `.eslintrc*` — note whether `react-hooks/exhaustive-deps` is enabled

If `src/` is absent or no React dependency → stop, report "not a React frontend repo."

### 2. Build the mental model

Before flagging anything, identify:

- **React version** — `19.x` unlocks `use()`, `useOptimistic`, `useActionState`, `ref` as prop; `18.x` does not. Rules are version-conditional.
- **Routing layer** — `react-router-dom` v6 vs v7, data routers vs tree routers, loader/action pattern vs client-only
- **Data layer** — TanStack Query, SWR, bare `fetch + useEffect`, Server Components, RSC + streaming
- **State layer** — React Context per feature, Zustand, Redux, Jotai, none
- **UI primitives** — shadcn/ui (Radix), Headless UI, MUI, raw — affects a11y baseline
- **Tailwind config style** — v4 CSS-first (`@theme` in CSS), v3 JS config, or v3/v4 hybrid (common bug source)
- **Form layer** — React Hook Form + Zod, Formik, raw useState
- **Build target** — SPA, SSR, SSG, library — affects what's a bug vs design
- **Error/loading strategy** — `<Suspense>` + `<ErrorBoundary>` per route, global boundary, none
- **Strict Mode** — `<StrictMode>` present in `main.tsx` (double-invocation of effects surfaces bugs)
- **Data-correctness contracts** — for every dashboard / chart / KPI / table page, identify: (a) the source query or queries, (b) the aggregation / calculation performed client-side, (c) the unit and label shown to the user, (d) whether the list is paginated, filtered, or sorted, and where each happens (client vs server). Note the tenant-filter field (`organizationId` / `tenantId`) if the product is multi-tenant — aggregates MUST respect it.

Without this map, findings will be wrong. Spend effort here.

### 3. Dispatch (optional)

For large repos (>50 components or >20 hooks), delegate each rule module to a
`review-single` or `analyst` agent in parallel. Each agent receives: (a) the
rule module, (b) the mental-model map from §2, (c) the relevant files.
Collate findings back.

For smaller repos, run §4 inline.

### 4. Rule modules

Each rule is a **yes/no check**. Lead with `file:line`. Do not report
compliant checks — only findings.

#### A. React hooks — rules & shape

A1. Hook called conditionally or inside a loop/early-return (Rules of Hooks violation) — even behind a feature flag that's "always false in prod" it's still illegal.
A2. Hook called outside a component or custom hook (`useX` at module scope, inside a helper function not prefixed `use`, inside a class).
A3. Custom hook name doesn't start with `use` — linter cannot enforce Rules of Hooks on it.
A4. Hook order changes across renders (rendering `<A />` vs `<B />` from the same spot where each calls different hooks — reorder the tree, don't branch hook calls).
A5. `useState` initializer does heavy work synchronously on every render — use the lazy form `useState(() => expensive())`.
A6. `useState(expensive())` instead of `useState(() => expensive())` — runs on every render, discarded after first.
A7. `useReducer` reducer not pure (mutates state argument, fires side effects inside the reducer) — breaks StrictMode double-invocation and time-travel.
A8. `useContext(Ctx)` where the default `Ctx` value is a dummy object instead of `null` + a `useX()` hook that throws when provider is missing — silent wrong behavior when consumer rendered outside provider.

#### B. useEffect / useLayoutEffect / cleanup

B1. `useEffect` depends on a value not listed in the dep array (stale closure). If the lint rule is disabled or suppressed via `// eslint-disable-next-line react-hooks/exhaustive-deps`, flag the suppression.
B2. Dep array contains an object/array/function literal that changes identity every render → effect fires every render. Fix by memoizing with `useMemo`/`useCallback` or splitting the derived value.
B3. Effect performs data fetch, sets state, and lacks an `AbortController` / `ignore` flag in cleanup → on quick re-mount (StrictMode, route change) stale response writes to unmounted component ("Can't perform a React state update on an unmounted component").
B4. Subscription / event listener / `setInterval` / `setTimeout` / observer without matching cleanup in the effect's return — leak on unmount.
B5. `useLayoutEffect` used for side effects that don't read layout — should be `useEffect` (layout effect blocks paint).
B6. `useEffect` used as a derived-state calculator (`useEffect(() => setY(f(x)), [x])`) — should be computed during render: `const y = f(x)`. Causes extra render + stale intermediate paint.
B7. `useEffect(() => setState(props.x), [props.x])` — this is prop→state mirroring; use the prop directly or derive during render.
B8. Effect depends on a prop callback that the parent recreates every render → infinite loop. Require the caller to memoize or pull callback into a ref via `useEffectEvent` (or a manual ref pattern).
B9. Cleanup runs a request-cancel that itself has side effects (e.g., logs, toasts) — runs twice in StrictMode dev and may surprise.
B10. `useEffect` with no dep array fires every render and has an expensive body — almost always a bug.
B11. Effect fires client-side fetch that belongs in a route loader (React Router v6.4+ data routers) / `use(promise)` / TanStack Query — flag as architectural drift, not a blocker, unless it causes a race.

#### C. Memoization — useMemo / useCallback / memo / React.memo

C1. `useMemo` wraps a trivial primitive (`useMemo(() => a + b, [a, b])`) — cost > benefit.
C2. `useMemo` / `useCallback` dep array missing values referenced inside — same as B1 for memo targets.
C3. `React.memo(Component)` wrapping a component that receives a freshly-created object/array/function prop every render — memo is a no-op.
C4. `React.memo` with no custom equality on a component that receives deep objects — shallow compare never hits; either pass a stable prop shape or provide `arePropsEqual`.
C5. `useMemo` used to "run an effect" or call a mutation — useMemo must be pure; side effects belong in `useEffect`.
C6. `useCallback` around a function that's immediately passed to `useEffect` dep array AND also recreated because its own deps change — the callback identity still changes → effect fires. Inline the logic or use a ref.
C7. `useMemo` for *identity stabilization* of an object passed to a Context's `value` — this is correct; **missing** it causes all consumers to re-render every provider render. Flag missing useMemo on provider `value={...}` object literal.

#### D. Refs

D1. Writing to `ref.current` during render (outside an effect or event handler) — breaks React's rules, non-deterministic under concurrent rendering.
D2. Reading `ref.current` during render for a layout value that hasn't been measured yet — null on first render, stale on subsequent; use `useLayoutEffect` to measure.
D3. `forwardRef` used in React 19 code — unnecessary, `ref` is a normal prop in 19. Flag as cleanup (Minor).
D4. `useImperativeHandle` exposes a method that mutates parent state from a child — breaks unidirectional data flow, prefer lifting state.
D5. Ref callback (`ref={(el) => ...}`) that doesn't handle the `null` cleanup call — React 19 calls the ref callback with `null` on unmount; if your callback captures subscriptions, they leak.
D6. `useRef<T>()` declared without an initial value and typed as `T` (not `T | null`) — TS lets you read `.current` as `T`, but first read is `undefined` at runtime.

#### E. State modeling & rendering

E1. Multiple `useState` calls that must change together (e.g., `setLoading(true); setData(null); setError(null)`) — should be one `useReducer` or one object-state. Each individual setter is a separate render under legacy batching rules.
E2. Derived state stored in state (`const [fullName, setFullName] = useState(first + last)`) — compute in render.
E3. State holds a reference to a prop (`useState(props.initial)`) — updates to `props.initial` never flow in. If that's intentional, name it `initial` and document; otherwise fix.
E4. Key prop missing or non-unique in a list — reconciler reuses DOM nodes wrong, stale inputs across filter/sort.
E5. Array index used as `key` on a list that can reorder, filter, or insert — loses focus, animates wrong, carries stale form state.
E6. `useState(() => localStorage.getItem(...))` called in a component that also renders on the server (SSR) → hydration mismatch.
E7. Component directly reads `window`, `document`, `navigator`, or `localStorage` during render without an SSR / `typeof window` guard — breaks Vite SSR and prerender.
E8. Component reads `Date.now()` / `Math.random()` during render — non-deterministic, causes hydration mismatches in SSR and double-invocation surprises in StrictMode.

#### F. Concurrent React, Suspense, transitions

F1. Data fetch in `useEffect` when a `<Suspense>` boundary exists around the component — use `use(promise)` or a Suspense-integrated fetcher (TanStack Query `useSuspenseQuery`) to get the streaming benefit.
F2. Promise passed to `use()` created inside render (`use(fetch(url))`) — new promise every render → Suspense thrashes forever. Promise must come from a stable cache (module-scope, ref, or query library).
F3. `startTransition` / `useTransition` not used for non-urgent updates like filter input, typeahead, tab switch, or large list render — each keystroke blocks the UI.
F4. `useDeferredValue` applied to a value whose expensive consumer isn't memoized — deferring doesn't help if the child still re-renders with identical deps.
F5. Suspense boundary wraps the entire app with no finer-grained boundaries — one slow query blanks the whole screen.
F6. `<Suspense fallback={<Spinner />}>` without a matching `<ErrorBoundary>` — thrown fetch errors propagate to the nearest boundary, may crash the route.
F7. `useOptimistic` updater calls async work inside the reducer — reducer must be sync.
F8. `useActionState` / form `action` prop used without awaiting the action's result when the UI depends on it — optimistic flash then incorrect final state.
F9. `useOptimistic` applied without a server-state reconciliation path — UI gets stuck on optimistic value if the mutation fails silently.

#### G. Error boundaries

G1. No error boundary at the app root AND no per-route boundary → a single throw during render crashes the whole tree to a blank page.
G2. Error boundary catches render errors but the page also does data fetching in effects → async errors bypass the boundary. Use `useQueryErrorResetBoundary` (TanStack) or surface via a state setter.
G3. Class-based error boundary with `getDerivedStateFromError` but no `componentDidCatch` logger → errors swallowed silently.
G4. `react-error-boundary` used but `onReset` / `resetKeys` not wired — user hits "try again" and nothing resets.

#### H. Context providers

H1. Context `value` is an object/array literal (`value={{ user, setUser }}`) without `useMemo` → every provider render re-renders every consumer.
H2. One "god context" holds unrelated state (auth + theme + toasts + modal) — any change re-renders everything downstream. Split by concern.
H3. Context consumer reads only one field out of a large value — consider context selector lib (`use-context-selector`) or split context; flag if this causes visible perf pain (long lists, charts).
H4. Provider mounted inside a component that itself unmounts on navigation → entire context state resets.
H5. Custom hook `useXContext` doesn't throw when value is the default/null → callers silently get undefined downstream, masking missing provider.

#### I. Data fetching (library-agnostic, or TanStack Query / SWR specifics)

I1. `fetch` called inside a component body (not in an effect, not in an action) — runs during render, runs twice in StrictMode dev, and on every re-render in prod.
I2. `fetch` without `AbortController` wired to effect cleanup — stale responses after unmount.
I3. Response JSON parsed without validating shape (Zod / io-ts / manual) — `any` flows into state and downstream components.
I4. Query key omits a prop/filter/tenant/id the query depends on → cache bleeds across params.
I5. Query key is a mutable object reference (`{ filter }` new each render) passed as a single key element — TanStack hashes but the hash depends on structure; flag if the key shape is unstable.
I6. `useMutation().onSuccess` doesn't invalidate affected queries → stale list after create/update/delete.
I7. `staleTime` is `0` (default) for data that never changes within a session → refetch on every remount.
I8. `enabled: !!id` pattern used where `id` is `undefined` then a number — first render fires disabled, fine; but if code ALSO relies on `data` being set before `enabled` flips true, may flash empty state. Flag if the UI has "no data found" rendered during the `enabled: false` phase.
I9. SWR / TanStack hook used in a `useEffect` or non-component function — only valid at component / custom hook top level.
I10. Multiple independent queries fired sequentially with `await` in an effect instead of in parallel (`Promise.all` / parallel hooks) — waterfall latency.

#### J. Forms (React Hook Form + Zod)

J1. Zod schema defined inline in the component body — recreated every render, changes identity, breaks `useForm` stability.
J2. `useForm` without `resolver: zodResolver(schema)` when a schema exists — validation is declared but never enforced.
J3. `useForm<T>()` missing the inferred type → field names unchecked at compile time.
J4. Uncontrolled input (`<input {...register(...)} />`) mixed with external state (`value={...}` overrides register) → two sources of truth, subtle bugs.
J5. `Controller` used for a native input that `register` handles fine — over-engineered, re-renders more.
J6. `handleSubmit` invoked without `e.preventDefault` in a form that also has a native submit — double-submit in some browsers.
J7. Server validation errors not mapped onto field state via `setError("fieldName", { message })` — user sees generic toast, form shows green.
J8. `defaultValues` depend on async data (`defaultValues: data`) and form mounts before `data` is loaded → form stuck on empty initial values. Use `reset(data)` in an effect when data arrives.
J9. `Controller` used with shadcn/Radix components without wiring `field.ref` to the component's internal ref → focus management and `setError` focus break.

#### K. Routing (react-router-dom)

K1. `<Link>` used without a `to=` prop or with a dynamically-computed URL that's not URL-encoded — broken nav or XSS in href.
K2. `useNavigate()` inside a render body instead of an effect/event handler → navigation fires on every render loop.
K3. Route loader throws without an `errorElement` on the route → unhandled, breaks the app.
K4. `useParams<T>()` typed with a shape that doesn't match the declared route pattern — TS lies about what's actually a string.
K5. Lazy-loaded route (`React.lazy`) without a surrounding `<Suspense>` → React throws on first nav.
K6. `useSearchParams` mutation without functional updater (`setSearchParams(next => ...)`) when multiple updates can race.
K7. Guard component that redirects via `<Navigate>` inside an effect → flashes protected content. Use a router loader that throws a redirect, or a synchronous render-path check.
K8. `basename` differs between `vite.config.ts` base path and `<BrowserRouter basename>` → 404s in production under a subpath.
K9. Catch-all route `path="*"` not present → unknown URLs render blank.

#### L. TypeScript

L1. `any` in a public component prop, hook return, or API contract — silently tolerates drift; prefer `unknown` + narrowing.
L2. `as` cast on a response (`data as UserDto`) without a runtime check — type lies; first schema change produces silent wrong behavior.
L3. `@ts-ignore` / `@ts-expect-error` without a one-line reason comment — unknown why.
L4. `noImplicitAny`, `strictNullChecks`, or `strict` disabled in `tsconfig` (or "strict-*" family turned off) — half the type system is off.
L5. `React.FC<Props>` used — implicitly adds `children`, breaks generic components. (Rule retained for the implicit-`children` and generic-component issues; the broader "never use `React.FC`" advice is dated.)
L6. Function declared to return `void` but used as a Promise (e.g., async callback passed where sync expected) — floating promise.
L7. `Record<string, any>` as a component prop type — unchecked object, bypass TS.
L8. Discriminated union opportunity missed (`{ loading, data, error }` with any field possibly set) — `{ status: "loading" } | { status: "error"; error } | { status: "success"; data }` is stricter.
L9. Generic component (`<T,>(props: Props<T>)`) with `T` defaulted to `any` — swallow-all.
L10. Type imported from a server/Lambda module into client code directly (bundle leak) — should go through a shared `types/` path or a `type-only` import across a package boundary.
L11. `useRef<HTMLDivElement>(null)` but then `ref.current!.focus()` with non-null-bang everywhere — add a guard or `useImperativeHandle`-style wrapper.
L12. `enum` used where a string literal union would do — larger bundle, harder to tree-shake; minor.

#### M. Vite / build config

M1. `vite.config.ts` missing `@` alias while code uses `@/...` imports — works via `tsconfig paths` but Vite won't resolve; fails on build.
M2. Path alias declared in `tsconfig.json` but not mirrored in `vite.config.ts` `resolve.alias` (or vice versa) → dev and build disagree.
M3. `process.env.X` referenced in `src/` — undefined in browser bundle; must be `import.meta.env.VITE_X`.
M4. Env var used without the `VITE_` prefix → stripped from the client bundle, becomes `undefined` silently.
M5. Secret-looking env var (`_KEY`, `_TOKEN`, `_SECRET`) exposed via `VITE_*` → shipped to every client.
M6. Large dep pre-bundled via `optimizeDeps.include` that isn't actually imported → wasted dev startup.
M7. `build.rollupOptions.external` used in an app (not a library) to externalize a browser dep → runtime "exports is not defined" at load time.
M8. `server.proxy` omitted while code calls a same-origin `/api/...` endpoint → CORS errors in dev only.
M9. `base: "/"` default in config but app deployed under `/app/` subpath → blank page in prod.
M10. Source maps enabled in prod build (`build.sourcemap: true`) while the repo also embeds secrets at build time — leaks via `.map`.
M11. React plugin missing (`@vitejs/plugin-react` or `-swc`) → no Fast Refresh, no JSX transform. Flag if JSX files exist but plugin isn't wired.
M12. Tailwind v4 Vite plugin (`@tailwindcss/vite`) missing when `tailwindcss` v4 is a dep and `@tailwind` directives exist → styles don't compile.
M13. CSS module file `.module.css` imported without a type declaration (`*.module.css.d.ts` or `vite-env.d.ts`) → `any` for class names, typos never caught.
M14. `index.html` references `/src/main.tsx` with an absolute path and the app deploys under a subpath → 404.

#### N. Tailwind CSS (v3 and v4)

N1. **Tailwind v4 with colors defined in `tailwind.config.ts`** — v4 is CSS-first. Colors, fonts, radii must live under `@theme` in the entry CSS file; values in `tailwind.config.ts` are ignored silently.
N2. `@import "tailwindcss"` missing from the entry CSS on a v4 project — classes won't be generated. (v4 drops the `@tailwind base/components/utilities` triple.)
N3. `@tailwind base; @tailwind components; @tailwind utilities;` used on a Tailwind v4 project — legacy; should be `@import "tailwindcss"` + `@theme` config.
N4. Dynamic class name built with string concat (`` `bg-${color}-500` ``) — Tailwind's content scanner never sees it; class purged from output. Fix: enumerate in a map or use the `safelist` mechanism.
N5. Arbitrary values with interpolation (`` `w-[${px}px]` ``) — same purge problem; emit the style via inline `style={{ width: px }}` instead.
N6. `class=` used in JSX instead of `className=` — silent no-op.
N7. `className` built via `+` concat with conditionals instead of `cn()` — fragile, duplicate classes, unpredictable precedence.
N8. Two conflicting utilities in the same `className` (e.g., `p-4 p-6`) without `tailwind-merge` / `cn()` to resolve — later one wins by source order, not by intent.
N9. Global styles in `index.css` override Tailwind utilities without `!important` or a higher-specificity selector → utilities look broken.
N10. `@apply` used heavily inside component CSS for utilities already expressible in JSX — harder to debug, loses utility-first benefit.
N11. Arbitrary variant stacks (`[&_.child]:hover:...`) used where a proper component split would be clearer — style; Minor.
N12. `dark:` variants used without a `darkMode` strategy declared in the entry CSS / config — no-op.
N13. Custom color referenced (`text-brand`) but not defined in `@theme` (v4) or `theme.extend.colors` (v3) — class silently dropped.
N14. shadcn/ui customization done by editing `src/components/ui/*.tsx` source instead of via CSS variables — will fight future `npx shadcn add` updates.
N15. Tailwind `content` globs in v3 config don't include a new source dir (e.g., `src/features/**/*.tsx`) — classes in that dir never generated.
N16. `@layer` mis-ordering in v4 — custom styles placed outside any layer override utilities unintentionally.

#### O. Accessibility / semantics (only user-visible regressions)

O1. Clickable `<div>` / `<span>` with no `role="button"`, no `tabIndex`, no keyboard handler → unreachable for keyboard/screen-reader.
O2. Icon-only button with no `aria-label` / no visually-hidden text.
O3. Form `<input>` without an associated `<label>` (via `htmlFor`/`id` or wrapping) — screen-reader unnames the field.
O4. `<img>` without `alt` (or with `alt=""` for a meaningful image).
O5. Color-only state indication (red/green with no icon/text) — fails low-vision users.
O6. `autoFocus` on a page-mounted input that changes route context — steals screen-reader focus.
O7. Focus trap missing in a modal/dialog (unless using Radix/shadcn which handles it).
O8. Interactive element hidden with `display: none` but still in the tab order (impossible here, but flag `visibility: hidden` on focusable elements).

Minor tier unless the element is on a primary user flow, then Important.

#### P. Performance smells with evidence

P1. Render list >200 items without virtualization (`@tanstack/react-virtual`, `react-window`) and with non-trivial row content — jank scrolling.
P2. Image rendered at a size much smaller than its intrinsic (no `loading="lazy"`, no responsive `srcset`) — wasted bandwidth, LCP regression.
P3. Large JSON imported via `import data from "./huge.json"` into a bundle chunk that loads on first render → initial bundle bloat. Should be fetched lazily.
P4. `console.log` left in a hot render path → DevTools throttle, memory retention on objects logged.
P5. Heavy library imported via default import pulls the whole surface (`import _ from "lodash"`) — use per-function imports.
P6. `<Component />` declared inside another component's render body (`const Inner = () => ...; return <Inner />`) → new component type every render, remounts children, loses state.
P7. Anonymous arrow-function prop passed to a memoized child → kills memoization (see C3).

#### Q. Data correctness — the numbers on screen

These are **functional bugs**. The user sees a number, a chart, a list, a
badge, a total — and it's wrong. Report with the rendered-value consequence
("dashboard shows 42 incidents, real count is 317 because list truncates at
page 1").

**Q.1 Pagination & truncation**

Q1. `client.models.X.list()` / `useQuery` / `fetch` for a list used to build a **count**, **sum**, **average**, or drive a chart — without consuming ALL pages via `nextToken` / cursor / offset loop. Default page size (100 for AppSync, varies per API) silently caps the dataset → every KPI downstream is understated.
Q2. List query with `limit` set but no `nextToken` handling, feeding a "Total: N" label or a `.length` reading → the label is the page size, not the total.
Q3. Paginated list rendered in a table but the **"Total rows" count** is `rows.length` instead of a server-provided total count → jumps as the user paginates.
Q4. "Load more" / infinite scroll implementation that appends pages but **deduplicates nothing** → duplicates when the same item appears in two pages (common when server sort is unstable or items shift during paging).
Q5. Client-side filter (`rows.filter(...)`) applied to a paginated list where the filtered attribute could match rows on **later pages** not yet fetched → the filtered result is a subset of truth; user sees 3 matches when there are 30.
Q6. Client-side sort (`rows.sort(...)`) applied to a paginated list → sorts only the current page; the "top 5" isn't actually the top 5.
Q7. Search / filter input wired to a local `.filter()` instead of a server-side query param → same "subset of truth" problem as Q5.
Q8. Pagination `pageSize` read from a UI control but the request still sends the default → UI says 50/page, server sends 25.
Q9. `nextToken` / cursor stored in local state that resets on prop change → user loses their place when any unrelated prop changes.
Q10. Effect that fetches "all pages" runs inside a component that can remount / re-render → redundant N-page fetch per remount.

**Q.2 Aggregations & statistics**

Q11. Aggregate computed as `array.reduce((a, b) => a + b.value, 0)` where `b.value` can be `null` / `undefined` / `NaN` → silently contaminated sum (`NaN`) or undercounted (coerced `0`). Verify `.filter(Boolean)` or explicit default + the intended semantics (skip vs treat-as-zero).
Q12. Average with `sum / array.length` where `array` can be empty → `NaN` rendered as "NaN%" or as `0` without distinguishing "no data" from "average is zero".
Q13. Percentage computed as `(part / whole) * 100` without guarding `whole === 0` → `Infinity` / `NaN` on screen.
Q14. Bucket percentages (pie / stacked bar) rounded per-slice with `Math.round` → sum drifts to 99% or 101%. Use a largest-remainder rounding if the total must equal 100%.
Q15. "Growth rate" / "delta %" computed as `(new - old) / old` without guarding `old === 0` → `Infinity`; should show "new metric" label or similar.
Q16. Count built via `array.filter(...).length` where the array is a **paginated subset** (see Q1).
Q17. Deduplicated count built with `new Set(array.map(x => x.id))` where `x.id` can be `undefined` → every undefined collapses to one slot, inflating uniqueness.
Q18. `Math.min(...arr) / Math.max(...arr)` with empty `arr` → `Infinity` / `-Infinity` leaks into the UI.
Q19. `reduce(..., 0)` accumulator starts at the wrong identity for the operation (e.g., multiplication starting at `0`, string concat starting at `undefined`).
Q20. Weighted average computed as "average of averages" instead of `sumOfProducts / sumOfWeights` → classic Simpson's-paradox-style wrong number.
Q21. Median / percentile computed on a truncated (paginated) sample and labeled as the overall median.
Q22. Moving-average / rolling window computed without handling the leading window boundary (first N points NaN or labeled incorrectly).
Q23. Group-by aggregate written as `array.reduce((acc, x) => ({ ...acc, [x.key]: acc[x.key] + x.value }), {})` → `acc[x.key]` is `undefined` on first hit → `NaN` cascades.
Q24. Distinct counts built by `uniq(array)` on objects (reference equality) instead of on an ID field → every row counted as unique.

**Q.3 Dates, times, timezones**

Q25. `new Date(dateString)` parsing a date-only string (`"2026-01-15"`) — parsed as UTC midnight, then `.toLocaleDateString()` in a negative-UTC zone shows the PREVIOUS day. Use `date-fns` `parseISO` or explicit parts.
Q26. Day-bucketing (`groupBy(x => x.createdAt.slice(0,10))`) uses the **stored UTC date** for a user in PT → an event at 11 pm PT shows up on the NEXT day's bucket.
Q27. Date range filter `from`/`to` set to `new Date()` without normalizing `to` to end-of-day → the last day is missing its events.
Q28. Week / month calculations built with `+ 7 * 24 * 60 * 60 * 1000` (or 30-day month) — wrong across DST and month length.
Q29. Duration rendered as `ms / 1000 / 60` (naive floor) without handling negative durations when server clock drifts vs client.
Q30. "Last 30 days" range computed with `Date.now() - 30 * 86400000` → DST-affected timezones produce a 29- or 31-day window.
Q31. Calendar range includes a user-facing "today" bucket that the server hasn't finished writing to yet (partial-day bias) — flag if the KPI is compared period-over-period without excluding today.
Q32. `Intl.DateTimeFormat` used without a `locale` in a multi-locale product → shows US dates in Europe, or vice versa.
Q33. `toISOString()` sent to a server that expects a local date; server interprets as UTC — off-by-one day persisted.
Q34. Timezone-naive sort: sorting `createdAt` as strings works for ISO UTC but silently breaks for locale strings or `Date.toString()` outputs.

**Q.4 Numbers, units, precision**

Q35. Money math in `Number` (`price * qty + tax`) — floating-point drift (`0.1 + 0.2 = 0.30000000000000004`) visible once totals exceed a few decimals. Use integer cents or `decimal.js`.
Q36. Currency formatted with `.toFixed(2)` without rounding rules declared — banker's-rounding vs half-up differs and invoices drift.
Q37. Unit mismatch: value stored in cents/seconds/meters but rendered as dollars/minutes/km without conversion (`$0.05` shown as `$5`).
Q38. Unit conversion hard-coded (`km * 0.621371`) without a single source of truth → discrepancy across pages.
Q39. `parseInt(str)` (no radix) on user input with leading zeros → base-8 surprise in old browsers; at minimum `parseInt(str, 10)` or `Number()`.
Q40. `parseFloat` on a locale-formatted string (`"1.234,56"` in es-ES) → `1.234`. Use `Intl.NumberFormat.prototype.formatToParts` or a parser.
Q41. Big numbers beyond `Number.MAX_SAFE_INTEGER` (long IDs, analytics counts) stored/compared as `Number` → precision loss silently. Use `BigInt` or strings.
Q42. Rounding applied before aggregation (`round each row, then sum`) instead of after (`sum, then round once`) → totals that don't match the row sum.

**Q.5 Tenancy / scoping on aggregates**

Q43. Dashboard aggregate (count, sum, chart) built from a list query that lacks an `organizationId` / tenant filter — relies solely on AppSync auth rules. If rules are widened (e.g., admin group), totals inflate across tenants and the user sees someone else's numbers.
Q44. TanStack Query key used for an aggregate omits `organizationId` / `userId` → cache bleeds on tenant switch, user briefly sees previous tenant's KPI.
Q45. "Global" stat (e.g., "team size: 12") computed from `users.list({ filter: { role } })` WITHOUT the tenant filter — role matches across tenants.
Q46. Role/permission-gated data aggregated but the caller is in a **broader** group than expected → aggregate reflects rows the user shouldn't even see. Flag when the list query and the aggregate role-scope disagree.

**Q.6 Cache / mutation consistency**

Q47. After `useMutation(createX)` succeeds, the parent screen's count / total / list is computed from a query whose key is NOT invalidated — stale number until full page reload.
Q48. Optimistic update changes the list but not the "Total: N" label (label computed from a different query) → numbers disagree for the optimistic window.
Q49. Delete mutation removes a row from the UI via local state splice, but the `count` aggregate query is not invalidated — badge keeps the old number.
Q50. Refetching strategy is "on window focus" only; a mutation happening on the same tab doesn't force a refetch → same as Q47.
Q51. Two queries on the same screen for the same entity with different filters, both caching independently — updating one doesn't invalidate the other; the two halves of the UI disagree.

**Q.7 Validation & safety before display**

Q52. Data consumed without schema validation (Zod / `safeParse`) — a missing/renamed backend field silently renders as `undefined` → "undefined%", "NaN", blank badge.
Q53. `value.toFixed(2)` / `value.toLocaleString()` called on a field that can be `null` / `undefined` → runtime crash or "NaN".
Q54. Enum / status string rendered directly (`status.toUpperCase()`) without a mapping — backend ships a new status and UI shows a raw token.
Q55. Empty-state (`array.length === 0`) and error state share the same branch ("No data" when actually errored) — user can't distinguish "nothing here" from "we failed to load".
Q56. Loading state assumed `data === undefined` — but cached stale data means `data` is defined while still refetching. Show stale + spinner or distinguish.
Q57. `data?.x ?? data?.y ?? 0` fallback chains that silently mask a backend contract change — fine for display tolerance, bad for KPIs. Flag when the fallback is on a metric.
Q58. Data mapped via `data.items.map(x => ({ ...x, value: x.v }))` where `x.v` is missing in some rows (partial records, soft-deleted) — NaN / undefined flows downstream.
Q59. Boolean flag treated as truthy/falsy without explicit `=== true` — string `"false"` is truthy, flips the UI.
Q60. `JSON.parse(x)` on a backend-provided string without try/catch — crashes the render.

**Q.8 Chart / visualization specifics**

Q61. Chart data series built from a map without guaranteeing all X-axis ticks have a value → gaps or implicit-zero misrepresented. Decide and document: skip, zero-fill, or null-break the line.
Q62. Y-axis domain computed from the current page / filtered subset; chart rescales wildly as user paginates. Compute from the full dataset or lock the domain.
Q63. Log scale used on a series that contains `0` → blank bar / missing point.
Q64. Bar chart percentages stacked from unrelated denominators (e.g., % of page vs % of total) — labels lie.
Q65. Color legend assigned by `index` in the current render order — legend color meaning flips when a category is filtered out.
Q66. Tooltip hover value uses a different rounding/formatter than the rendered label on the bar → hover reads `$4,999.50`, label reads `$5,000`.

### 5. Cross-file analysis

After per-file rules, run these multi-file checks.

- **Hook dep-array truthfulness** — pick 10 most-depended hooks (custom and effect-heavy) and trace every value used inside against the dep array. Suppressions must have a one-line justification.
- **Suspense boundary audit** — for each route, walk the component tree upward: is there a `<Suspense>` + `<ErrorBoundary>` pair between the data-fetching component and the router? If not, a throw crashes the shell.
- **Provider hierarchy sanity** — in `main.tsx`/`App.tsx`, list provider nesting order. Flag:
  - ThemeProvider or I18nProvider *inside* Router (theme/locale changes force remount)
  - ErrorBoundary *inside* QueryClientProvider but not around Router (errors during route match are uncaught)
  - Context providers whose `value` is a raw object literal (H1 at scale)
- **Query key ↔ mutation invalidation map** — build a table of `queryKey` patterns and `useMutation.onSuccess` invalidations; flag any list/detail pair where a mutation writes the entity but doesn't invalidate a reader.
- **Controlled/uncontrolled form input drift** — for each form, verify every input is either fully registered (`{...register()}`) or fully controlled (`<Controller>`), never both.
- **Type contract drift between API layer and components** — pick 3 API types and grep their consumers; flag any component that restructures the shape via `as` casts instead of importing the API type.
- **Tailwind class-source drift** — grep every `bg-`, `text-`, `border-` color class and confirm it's defined in `@theme` (v4) or `theme.extend` (v3). Dynamic / concatenated classes fail silently (N4).
- **Strict Mode double-invocation tolerance** — pick 3 effects with visible side-effects (toasts, navigation, analytics) and verify they tolerate being invoked twice in dev without producing two user-visible events.
- **Route-level code-splitting map** — list all `React.lazy` imports; every lazy route must have a Suspense boundary above it and an ErrorBoundary. Flag lazy imports used outside the router (module-scope lazy that runs at app startup — defeats the split).
- **StrictMode presence** — if `<StrictMode>` is absent in `main.tsx`, flag as Important for dev-time bug detection (not a runtime bug, but a process gap).
- **`Fragment` key loss** — JSX fragments `<></>` in a list can't take a `key`; if found, flag and recommend `<Fragment key=...>`.

**Data-pipeline correctness (cross-file)** — these require tracing from query → hook → component → render. For each dashboard / KPI / chart / paginated table page in the app:

- **Total-vs-page drift** — walk every "Total: N" / count badge / KPI on the page. Trace back to its source: is `N` the server-provided total, or is it `array.length` of a paginated result? If the latter, it's Q2 / Q3.
- **Aggregate-ignores-pagination** — for every `reduce` / `sum` / `average` / `count` computed client-side, verify the source array contains the FULL dataset (all pages fetched and concatenated) and not just page 1. If the hook never calls `nextToken` in a loop, the aggregate is wrong.
- **Filter/sort sequencing** — for every list screen with a search / filter / sort control: is the filter/sort applied server-side (as query params) or client-side over a paginated subset? If client-side over paginated data, flag Q5 / Q6.
- **Aggregate tenancy** — for every aggregate on a multi-tenant product, trace the source query's `filter`. If the filter doesn't include `organizationId` / `tenantId` (relying on AppSync auth rules alone), flag Q43. Verify the query key includes the tenant ID (Q44).
- **Mutation → aggregate invalidation** — for every mutation that can change a count / sum / list, walk `onSuccess` and verify `invalidateQueries` covers (a) the list query, (b) any separate count / total / aggregate query. Missing invalidations → Q47 / Q49.
- **Dual-query disagreement** — for any screen that shows both a list ("5 rows below") and a separate count query ("total: 8"), verify both are invalidated together. If not, the two numbers disagree after a mutation (Q51).
- **Currency/decimal path** — grep for money-like operations (`* price`, `+ amount`, `* qty`) in `src/`. Flag any that operate on `Number` with `.toFixed` near the render call (Q35). Ideal path is integer-cents storage + a formatter at the edge.
- **Date-bucket path** — for each chart / timeseries, trace the bucketing: is it done on the server (with a user timezone), on the client (with `.slice(0,10)` on a UTC string), or via a library (date-fns with explicit tz)? UTC-slicing is Q26 and shows up cleanly on dashboards for users outside UTC.
- **Empty-state vs error-state collapse** — for each `<EmptyState>` / "No data" branch, check whether the condition is `(!loading && data.length === 0)` OR `(!loading && !error && data.length === 0)`. The first swallows errors (Q55).
- **Runtime schema validation presence** — pick 3 critical metric sources; are they validated with Zod (`schema.parse(json)`) before being used in math? If not, flag Q52 on each.
- **Unit label vs stored unit** — grep for labels like `"min"`, `"km"`, `"$"`, `"%"` next to a rendered value. Trace back to storage: cents vs dollars, seconds vs ms, meters vs km. Flag any mismatch (Q37).

### 6. Severity & output

**Categorize**:

| Severity | Definition |
|----------|------------|
| **Critical** | Breaks prod builds, wipes user input, crashes the app tree, leaks secrets to client, Rules-of-Hooks violations that will produce wrong behavior, **a KPI / dashboard number that is materially wrong** (truncated aggregate, cross-tenant inflation, wrong-by-10x unit mismatch, currency drift on money totals) |
| **Important** | Stale-closure bug that causes visible wrong data, missing error boundary on primary routes, untyped API boundary causing runtime errors, Tailwind class not generating, effect race producing stale UI, form validation silently bypassed, **paginated list that silently truncates without a "more available" signal, mutation that leaves a count / badge / total stale, percentage/average division-by-zero rendering as NaN/Infinity, date-bucket off-by-one for users outside UTC** |
| **Minor** | Missed memoization without evidence of perf pain, style inconsistency, unused imports, accessibility gap on non-primary flow, missing StrictMode, rounding-artifact mismatches between tooltip and label |

**Output format**:

```
# Frontend Bug Bounty — {repo}

## Critical
- [B3] src/hooks/useUsers.ts:42 — effect fetches without AbortController; after quick route change, stale response writes to unmounted component and wipes new route's data. Seen in network tab during rapid nav between /users and /teams.
  → Fix: `const ctrl = new AbortController(); fetch(url, { signal: ctrl.signal }); return () => ctrl.abort();`

## Important
- [C7] src/contexts/AuthContext.tsx:58 — provider `value={{ user, login, logout }}` object literal, no `useMemo` → every re-render of provider cascades to every consumer (hit 1200 renders/s during login form typing).
  → Fix: `const value = useMemo(() => ({ user, login, logout }), [user, login, logout])`.

- [N1] tailwind.config.ts:12 — Tailwind v4 with custom `colors.brand` defined here; v4 ignores JS theme keys, class `bg-brand` is generated as `bg-brand` (unknown utility) → dropped. Current production uses fallback `gray-500`.
  → Fix: move palette to `@theme { --color-brand: #…; }` in `src/index.css`.

## Minor
- …

## Verdict
- {n} Critical, {m} Important, {k} Minor
- Recommended fix order: {auth race → provider memo → tailwind palette → …}
```

Rules:
- ONE finding per issue. No "see also" piles.
- File:line on every finding.
- State the **user-visible consequence**, not just the rule violation.
- Propose a concrete fix in one sentence (with the replacement code when it fits on one line).
- If a module is N/A (no forms, no router, plain React), don't mention it.
- If everything in a module is clean, skip it entirely.

### 7. Anti-patterns in the audit itself

- Do NOT flag style, naming, comments, or docs.
- Do NOT flag "should use X library" without a concrete bug (e.g., "should use TanStack Query" is not a finding; "useEffect fetch races with unmount" is).
- Do NOT recommend adding tests — that's not this skill's job.
- Do NOT speculate on performance without evidence (a 200-ms render, a flame-graph, a reproduction). P-tier findings require a reason to believe the user feels it.
- Do NOT report Amplify / AWS / backend concerns — out of scope; direct them to `/amplify-bug-bounty`.
- A known limitation documented in-code with a tracked follow-up is still reported, but reduced one severity tier.

## Calibration — "good" patterns to propose as fixes

- **Effect hygiene**: every data-fetching effect gets an `AbortController` or `ignore` flag; every subscription gets a cleanup; non-data effects use `useEffectEvent` (React 19) for values that shouldn't trigger re-runs.
- **Suspense-first fetching (React 19)**: `use(promise)` or `useSuspenseQuery` inside a route-level `<Suspense>` + `<ErrorBoundary>` pair. No `useEffect` fetching unless legacy.
- **Stable provider values**: `value={useMemo(() => ({...}), [...])}` on every context provider.
- **Discriminated-union async state**: `{ status: "idle" | "loading" | "error" | "success"; ... }` instead of three nullable fields.
- **Tailwind v4 CSS-first**: `@import "tailwindcss";` + `@theme { ... }` in `src/index.css`; no theme keys in `tailwind.config.ts`. Tokens referenced as `--color-*` CSS vars.
- **Form schema stability**: Zod schema declared at module scope, not in component body; `useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) })`.
- **Path alias parity**: `@/*` defined identically in `tsconfig.json` `paths` and `vite.config.ts` `resolve.alias`.
- **Env var safety**: only `VITE_*` vars referenced in `src/`; server secrets never prefixed `VITE_`.
- **Lazy route contract**: every `React.lazy` route sits under a Suspense boundary with an error boundary sibling; route-level code splits, not module-level.
- **Aggregate-source integrity**: any KPI / chart / total built from a list MUST be fed by (a) a server-side aggregate endpoint, or (b) a client-side full-pagination loop (`while (nextToken) fetchNext()`) — never a single-page call. The "Total: N" label shown to the user comes from a server count, not `rows.length`.
- **Server-side filter/sort for paginated data**: filtering, searching, and sorting over any list that doesn't fit on one page happens as query parameters — never via `rows.filter()` / `rows.sort()` on the client.
- **Safe numeric helpers**: aggregates go through helpers that (1) filter `null`/`undefined`/`NaN`, (2) guard `denominator === 0`, (3) distinguish "no data" from "zero". Declare the policy once (e.g., `src/lib/stats.ts`) and use it everywhere — don't reinvent per component.
- **Money as integer cents**: store and compute money in the smallest unit (cents); format with `Intl.NumberFormat` at the render boundary only.
- **Date math via a library**: all date arithmetic (bucketing, range math, DST-aware) goes through `date-fns` / `dayjs` / `luxon` with an explicit user timezone; no `+ 86400000 * n` arithmetic.
- **Runtime validation at the edge**: every response consumed by a metric passes through `zod.parse()` (or equivalent). The boundary is the hook, not the component.
- **Tenant filter on every aggregate query**: on multi-tenant products, every list/count/aggregate query passes an explicit `organizationId` filter AND includes `organizationId` in the TanStack query key.
- **Mutation invalidation map**: declare, per entity, which query keys are invalidated on create/update/delete — in a single place if possible (an `invalidate(entity)` helper), so count badges and lists stay in sync.
