---
name: Dev-only preview auth bypass for UI review
description: Sandbox Cognito pools don't carry prod users — recurring login friction when reviewing UI changes before merge. Pattern is a DEV-gated env-var bypass in AuthContext (no sandbox account required).
type: feedback
originSessionId: 0c07358c-6786-4543-98c1-d60ee21b0be6
---
When Santiago wants to preview UI changes before merging and can't log in to the dev server, do NOT make him create yet another sandbox account. The recurring friction is real: every Amplify sandbox has its own isolated Cognito User Pool, prod users don't propagate, and reviewers waste 10+ min per session inviting themselves.

**Why:** Santiago has flagged this multiple times. Each new sandbox needs a fresh user-pool seed. The right answer is a one-line dev-only auth bypass that any reviewer can flip on.

**How to apply:** Add a `VITE_PREVIEW_ROLE` env var honored inside `AuthContext` at mount time, strictly gated by `import.meta.env.DEV` (Vite tree-shakes it out of prod builds). When set, the provider injects a mock `AuthUser` with the requested `appRole` ('admin' | 'technician' | 'reporter') and skips the Cognito round-trip entirely. Combine with `cross-env` and three npm scripts (`dev:preview:admin`, `dev:preview:technician`, `dev:preview:reporter`) so reviewers don't need to remember the env-var syntax.

**Sentria implementation (reference):**
- `src/contexts/AuthContext.tsx` — preview-mode branch at the top of the boot `useEffect`, BEFORE `checkUser()` runs. Mocks `AuthUser` with `userId`, `attributes`, `appRole`. Console-warns so it's never silently active.
- `package.json` scripts — `dev:preview:{admin,technician,reporter}` invoke `cross-env VITE_PREVIEW_ROLE={role} vite`.
- Shipped in PR #128 (`feat/ayuda-sidebar-flatten`) on bas-labs/sentria, commit after `d0a5c55`.

**Caveats:**
- Backend mutations still hit the sandbox API and fail under the mock user — preview mode is for UI review only. The auth bypass surfaces a console warning making this obvious.
- Bypass is gated by `import.meta.env.DEV` — never use `process.env.NODE_ENV` (Vite strips one but not the other). Confirm with a prod build inspection if porting this pattern to another stack.
- For projects that don't use Vite, port the same pattern with whatever env-var-DCE mechanism the bundler provides.

**Bigger picture:** every iaGO client project shipping a Cognito-gated UI should ship this preview-mode bypass on day one. Add it to `/iago-scaffold`'s starter so it's never forgotten.
