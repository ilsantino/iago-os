## Baseline Checks (always included)

- Dead code: unreachable branches, unused variables, fallback values that can never trigger (e.g. nullish coalescing on values guaranteed non-null by earlier guards)
- Magic numbers: hardcoded values that should be named constants
- Silent failure: catch blocks or fallback paths that swallow errors without surfacing them to the user (especially dangerous in dashboards/monitoring UIs)
- Business logic errors: wrong calculations, missing validations, incorrect status transitions
- Unreachable branches: switch/if chains with dead default cases or impossible conditions
