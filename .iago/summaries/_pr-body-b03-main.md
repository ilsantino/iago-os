## What this does

Adds 38 unit tests for `runtime/daemon/main.ts` pure-function helpers, an integration test extension for `startDaemon`'s teardown stage timeout, and a `shutdownStageTimeoutMs` constructor option so future tests can drive teardown failure paths in <200ms instead of waiting 10s. Lifts `main.ts` line coverage toward the ≥80% floor.

## Context

This PR is **plan 03 tasks 1-3 of 6** — the original `03-coverage-pass-main-and-bot.md` plan was too dense (6 tasks across two files, ~50 tests, with PR #45 forward-list items expanding scope) and hit the 80-turn implementation budget. The remaining tasks 4-6 (bot.ts coverage + Phase 1 evidence template) live in the companion plan `03b-coverage-pass-bot.md` and will ship as a follow-up PR.

## What changed

- `runtime/daemon/main.test.ts` — **new**, 38 tests covering `loadPersistedConfigs`, `withTimeout`, `buildFleetHealth`, `getShapeForAgent`, `findHandleForAgent`, `injectIntoAgent`, `resolveSessionId`, `isDirectlyExecuted`
- `runtime/daemon/main.ts` — small refactors to expose pure helpers + new constructor option for stage timeout (default 10000ms, tests pass 50ms)
- `runtime/daemon/config.ts` — `shutdownStageTimeoutMs?: number` added to `DaemonConfig`
- `runtime/integration/hello-world.test.ts` — extended with a test that exercises the `startDaemon` orchestration path with the new stage-timeout option

## Verify

```bash
cd runtime
npx tsc --noEmit                   # exit 0
npx vitest run                     # 363 passed, 5 skipped (was ~321)
npx vitest run daemon/main.test.ts # 38 passed
```

## Follow-up

- `03b-coverage-pass-bot.md` ships `bot.ts` coverage (~17 tests) + Phase 1 evidence template update + PR #45 forward-list source fixes that weren't in this scope.
