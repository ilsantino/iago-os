---
name: Sub-project formatting hook bug
description: post-edit-format.mjs uses iago-os root biome config, breaks edits inside sub-projects with their own biome.json
type: feedback
originSessionId: 05eece77-47fe-4bc5-ba04-0893d2c6acfd
---
When editing `.ts/.tsx/.json` files inside a sub-project that has its own `biome.json` (e.g. `clients/din/dinpro-app/`), the global `post-edit-format.mjs` hook auto-formats with the **iago-os root** Biome config — not the sub-project config.

iago-os root uses TABS; client sub-projects (DIN dinpro-app, munet-web, etc.) use SPACES. Result: every Edit/Write to a sub-project file gets re-tabbed, then `npm run lint` from inside the sub-project rejects it.

**Why:** `post-edit-format.mjs` runs `npx biome check --write <file>` from the CWD, which is the iago-os root. Biome resolves config from CWD upward, finding the iago-os root `biome.json` first.

**How to apply:** After EVERY Edit/Write to a file inside a sub-project that has its own `biome.json`, immediately re-format from inside the sub-project:

```bash
cd <sub-project-dir> && npx biome format --write <file>
```

Then optionally `npx biome check --fix <file>` for safe import-sort fixes. Run `npm run lint` from inside the sub-project to confirm clean.

When dispatching executor agents into sub-projects, brief them on this workaround explicitly — otherwise they'll burn turns chasing phantom format errors (saw both Plan 02 and Plan 04 agents stop on this during 2026-05-05 DIN execution).

**Permanent fix (not yet implemented):** patch `.iago/hooks/post-edit-format.mjs` to `cd` to the file's nearest ancestor directory containing a `biome.json` before running `npx biome check --write`. Worth doing before next sub-project execution session.
