---
name: Preview-mode empty data states are normal, not a bug
description: When testing UI with VITE_PREVIEW_ROLE on localhost, ALL data-driven pages will show empty states because mock profile has organizationId="preview-org" (fake) and multi-tenancy requires real org filter. Pages mount and layout works; data is just empty. NOT a merge blocker.
type: feedback
originSessionId: 1d4602fc-8c9f-4ef3-823e-a6736c9394b4
---
When testing sentria (or any client) UI on localhost via `VITE_PREVIEW_ROLE`-style preview-mode, every data-driven page (dashboard, incidents list, users, reports) WILL show empty states or stuck loading spinners. This is the EXPECTED behavior. The mock profile injects a fake `organizationId` (e.g., `"preview-org"`), and multi-tenancy rules (every AppSync query filters by real org) ensure no real data matches. Pages mount, layout renders, but lists are empty.

**Why:** Santiago hit this on 2026-05-16 during sentria PR #133 visual review — he saw "all other tabs broken" and was terrified to merge. It was harmless preview-mode artifact. Confusion wasted ~10 min and almost stalled a clean merge.

**How to apply:**
- When testing UI in preview-mode (any client), do NOT treat empty data tables / no-result lists / stuck loaders as bugs. Verify it's the data layer (not the layout/components) by checking browser DevTools Network tab:
  - `401` / `403` / `Unauthorized` from AppSync → preview-mode artifact, harmless
  - `200` with empty array → preview-mode artifact (real query, no matching org data)
  - JavaScript runtime errors (`Cannot read properties of undefined`, error boundary triggered) → REAL bug, must fix before merge
- When showing preview-mode UI to Santiago, set expectation BEFORE he tests: "data tables will be empty, that's expected; you're checking layout + navigation + content rendering, not data flows."
- For ABSOLUTE certainty (or for any data-related change), spin up the Amplify sandbox (`npm run amplify:sandbox` for sentria) — that gives real Cognito + real data flows. Adds 3-5 min but eliminates ambiguity.
- Sentria-specific: `AuthContext.tsx` mock-profile shape is `id: preview-{role}-profile, organizationId: "preview-org", appRole: {role}`. Any client adopting this pattern uses a similar shape.
