## What this does

Lands the deferred review items from PR #40 (agent-runtime + daemon hardening) plus a centralized interface-version constant, a `Reflect.get` → `getOwnPropertyDescriptor` registry hardening, an integration test that proves a broken adapter cannot cascade-crash sibling adapters, a scoped Biome config for the runtime tree, an ADR for the deferred `exactOptionalPropertyTypes` flag, and a vitest `json-summary` reporter so future coverage parses are cheap. Build green, 399 tests pass (was 363).

## What changed

### Interface version centralization (T1, T2)
- `runtime/agent-runtime/types.ts` — new `export const INTERFACE_VERSION = "v1" as const` + `InterfaceVersion` type
- All runtime call sites switched from the `"v1"` literal to the `INTERFACE_VERSION` const

### Registry hardening (T3, T4, T5)
- `runtime/agent-runtime/registry.ts` — switched `Reflect.get` to `Object.getOwnPropertyDescriptor` for adapter property reads (avoids prototype-pollution surface)
- `listRuntimes()` now returns a `Object.freeze`-wrapped copy so callers cannot mutate the registry by side effect
- `_resetRegistryForTests` now throws a `RangeError("_resetRegistryForTests cannot run in production")` when `NODE_ENV === "production"`
- `runtime/agent-runtime/registry.test.ts` — regression tests for all three hardenings

### Adapter fail-isolation (T6)
- `runtime/integration/adapter-isolation.test.ts` — new integration test: registers two adapters where one throws at module-load time, asserts the registry surfaces the failure but the sibling adapter remains usable
- `runtime/integration/fixtures/fake-broken-adapter.ts` + `fake-good-adapter.ts` — load fixtures for the new test

### Biome scoped config (T7)
- `runtime/biome.json` — new file with formatter rules scoped to the runtime tree (resolves the project-root vs runtime tree divergence flagged in memory `feedback_subproject_format_hook`)

### ADR + config lock (T8)
- `.iago/decisions/2026-05-17-exact-optional-property-types.md` — ADR documenting why `exactOptionalPropertyTypes` is deferred to Phase 2 with explicit re-evaluation triggers
- `runtime/vitest.config.ts` — added `"json-summary"` to the coverage reporter array so `coverage/coverage-summary.json` is produced and cheap to parse in future audits

## Verify

```bash
cd runtime
npx tsc --noEmit                                     # exit 0
npx vitest run                                       # 399 passed, 5 skipped (was 363)
npx vitest run integration/adapter-isolation.test.ts # 2 passed
npx vitest run agent-runtime/registry.test.ts        # registry hardening regression
ls runtime/biome.json                                # exists
ls .iago/decisions/2026-05-17-exact-optional-property-types.md  # exists
```

## Pipeline note

The implementation session hit the 80-turn max-turns budget mid-task — same pattern as plan 03 (split into 03 + 03b). The bulk of T1–T7 landed cleanly inside the budget; T8's ADR file and the vitest `json-summary` reporter line were added inline in the orchestrator (no model spend) to complete the plan in a single PR rather than splitting again. Build + test suite were re-verified after the inline edits.
