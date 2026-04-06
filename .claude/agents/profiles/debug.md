---
name: debug
description: >-
  Diagnose and fix build, TypeScript, and lint errors.
  Capabilities are dynamic — orchestrator selects based on error type.
base: executor
model: auto
maxTurns: 20
capabilities: dynamic
---

## Match Signals

Dispatch this profile when:
- Build, typecheck, or lint error occurs during execution
- `npx tsc --noEmit` or `npx biome check` fails after implementation
- Test suite fails unexpectedly

## Dynamic Capability Selection

The orchestrator selects capabilities based on the error context:
- TypeScript error in `src/` → inject `react-19` capability
- TypeScript error in `amplify/` → inject `lambda` + `dynamodb` capabilities
- Build error (Vite) → inject `react-19` capability
- Test failure → inject `tdd` + relevant stack capability based on file path
- Auth-related error → inject `cognito` capability

## Debugging Protocol

Follow the 4-phase systematic debugging method:
1. REPRODUCE — get reliable reproduction before touching code
2. ISOLATE — form hypothesis, verify with evidence
3. FIX — smallest change addressing root cause, regression test first
4. VERIFY — full test suite, typecheck, linter

Max 3 fix attempts. After 3 failures, report with BLOCKED status.
