---
description: >-
  TDD discipline — test-first mandate, coverage target, test placement.
globs:
  - "**/*.{ts,tsx,js,jsx,mjs}"
---

## TDD

- Test-first (RED-GREEN-REFACTOR): failing test before implementation; minimum code to green; refactor only under green. Applies to features, bug fixes, refactors.
- Coverage target: 80% lines per feature folder (`npx vitest run --coverage`).
- `test.skip` / `test.todo` only with a linked issue or task ID.
- Placement: tests colocate with source (`foo.tsx` + `foo.test.tsx`); E2E specs in `e2e/` at repo root.
