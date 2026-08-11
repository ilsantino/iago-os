---
name: munet-typecheck-noop
description: "munet-web `npm run type-check` was a NO-OP until PR"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 4637f363-a88d-4497-b742-eb01bc973290
---

In bas-labs/munet-web, `npm run type-check` used to run bare `tsc --noEmit` against the solution-style root `tsconfig.json` (`"files": []`) — it type-checked **nothing** and always exited 0. It reported green on a worktree with a hard TS2724 error (discovered 2026-07-05, r2 lane-1 crash recovery).

**Fixed on main 2026-07-06:** PR #132 changed the script to `tsc -b`. Branches/worktrees cut from main at ba7e9b4 or later have the real gate.

**How to apply:** on any munet-web branch cut BEFORE PR #132 (or when unsure), gate with `npx tsc -b` directly — never trust `npm run type-check` exit 0 without checking `package.json` first.
