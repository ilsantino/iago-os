# Adversarial Review (Opus 4.7): PR #54

**Verdict:** APPROVE_WITH_NOTES
**Plan reviewed against:** `.iago/plans/feature-phase-1-deferred-hardening/04-pr40-deferred-items.md`
**Diff size:** ~6252 lines across 50 files (includes stacked prior-plan summaries; Plan 04 commit `6ed4fcc` touches 34 files, ~9 are substantive — rest is biome-driven formatter churn).

---

## Dimension verdicts

| Dimension | Verdict | One-line evidence |
|---|---|---|
| Auth/security | PASS | Structural probe replaced (`registry.ts:117-134`) — `Object.getOwnPropertyDescriptor` with prototype walk; accessor descriptors rejected (`typeof desc.value !== "function"`), closing getter-side-effect surface. Defense-in-depth prod-guard on `_resetRegistryForTests` (`registry.ts:174-178`). |
| Data loss | PASS | Registry mutations unchanged; `listRuntimes` returns frozen snapshot (`registry.ts:164-171`) — callers cannot corrupt registry through the snapshot. No persisted-state changes. |
| Concurrency/observability | PASS | New `runtime-registration-failed` telemetry event (`telemetry.ts:124`); `loadAdapterFailIsolated` (`main.ts:loadAdapterFailIsolated`) emits stderr + NDJSON with `stackTrace` truncated to ≤3 lines. Operator triage path documented in `agent-runtime/README.md`. |
| Rollback safety | PASS | Changes are additive: `INTERFACE_VERSION` is a typeof'd const so literal `"v1"` still satisfies the type; structural probe rejects strictly the same set + accessor-defined methods (which were never valid runtimes); `Object.freeze` widens return type compatibly; `loadAdapterFailIsolated` is internal helper. No DB migration, no API contract break. |
| Plan compliance | PASS_WITH_NOTES | All 8 tasks landed. Two deviations flagged as Minors below. |
| Code quality | PASS | JSDoc on registry hardening explains *why* (getter side-effects, frozen-snapshot rationale); `Object.freeze` applied at both element and array boundaries; TS types correctly widened to `ReadonlyArray<Readonly<...>>`. |
| Test quality | PASS | `adapter-isolation.test.ts` uses real ESM fixtures per stress I3, scoped `IAGO_DAEMON_STATE_ROOT` to per-test tmpdir, reads telemetry from disk and asserts NDJSON shape including stackTrace line cap. Per-test `_resetRegistryForTests` + `__resetTelemetryWarningFlagForTests`. |

---

## Critical findings

None.

## Important findings

None.

## Minor findings

### M1 — `vitest.config.ts` missing aspirational-threshold JSDoc (forward-list item 4)
**File:** `runtime/vitest.config.ts` (entire file, no JSDoc block present)
**Plan reference:** Stress-test I2 + implementer forward-list item 4 explicitly required documenting `registry.ts ≥85%` as aspirational in the config's JSDoc since Vitest v2 doesn't support named per-file overrides.
**Evidence:** Config has `json-summary` reporter wired (good) but no leading JSDoc comment explaining the 80% global / 85% aspirational gap for `registry.ts`. A reader of the config has no signal that the deferred 85% target exists.
**Severity:** Minor — coverage thresholds are still enforced at 80% global, the 85% intent is in the plan but loses persistence outside it.

### M2 — `listRuntimes` return shape kept `{id, shape, version}` instead of plan's `{id, shape, interfaceVersion}`
**File:** `runtime/agent-runtime/registry.ts:164-171`
**Plan reference:** Task 4(a) specifies `ReadonlyArray<Readonly<{ id: string; shape: AgentShape; interfaceVersion: typeof INTERFACE_VERSION }>>` — i.e., the plan swaps `version` (adapter semver) for `interfaceVersion` (the contract version).
**Evidence:** Actual return type is `ReadonlyArray<Readonly<{ id: string; shape: AgentShape; version: string }>>`. The implementer kept the pre-existing `version` field rather than swapping. This is the *safer* call (preserves the adapter semver that startup-check code in `main.ts` already consumes) but is a documented spec drift from the plan.
**Severity:** Minor — preserving backward-compat is correct judgment, but the plan should be retroactively updated OR an inline comment should record the deviation so a future reader doesn't re-introduce the swap.

---

## Notes (non-findings worth recording)

- **Stress C1 (test-assertion drift) resolved cleanly.** `registry.test.ts` imports `INTERFACE_VERSION` and asserts the v2-rejection error via template literal `expected "${INTERFACE_VERSION}"` — assertion stays meaningful if the const ever changes.
- **Stress C2 (fail-isolated import) implemented as designed.** Top-level side-effect import removed; `BUILT_IN_ADAPTER_MODULES` array + `loadAdapterFailIsolated` loop replaces it. Existing startup `listRuntimes()` check for `claude-pty` retained as second-line warning.
- **Stress I3 (real fixtures, not `vi.mock`) honored.** `fake-good-adapter.ts` and `fake-broken-adapter.ts` are real ESM modules under `runtime/integration/fixtures/`. Telemetry is asserted by reading the actual NDJSON file from `IAGO_DAEMON_STATE_ROOT`, not via mock.
- **Reflect.get → getOwnPropertyDescriptor includes prototype-chain walk** (`registry.ts:124-130`) — covers adapters that define methods on a class prototype rather than as own properties. The plan called this out and it's correctly implemented.
- **`INTERFACE_VERSION` propagation verified end-to-end.** Const exported in `types.ts:28`; consumed in `registry.ts` guard and in `agent-runtime/pty/claude-pty.ts` via import. No stray `"v1"` literals outside test files.
- **Coverage suggestion (not raised as finding):** `adapter-isolation.test.ts` only exercises good-then-broken load order. Reverse order (broken first, good second) is not tested. Since `loadAdapterFailIsolated` and the registry are both order-independent, this is a low-value gap — not worth raising as a Minor, noted here only for completeness.
- **Biome config landed without `extends`** (`runtime/biome.json`) — per stress I1's fallback recommendation; rule set inlined. Tab indent matches parent.
- **ADR present and well-formed** at `.iago/decisions/2026-05-17-exact-optional-property-types.md` with all four required sections plus revisit triggers per I4.

---

## Recommendation

APPROVE_WITH_NOTES — merge unblocked. The two Minors are documentation/spec-alignment items that can land in a follow-up commit or be absorbed into the next plan's first commit; neither blocks the hardening from shipping.
