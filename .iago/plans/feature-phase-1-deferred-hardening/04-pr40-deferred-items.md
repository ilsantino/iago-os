---
phase: feature-phase-1-deferred-hardening
plan: 04
wave: 1
depends_on: []
context: .iago/plans/feature-phase-1-deferred-hardening/CONTEXT.md
created: 2026-05-17
source: feature
---

# Plan: feature-phase-1-deferred-hardening/04-pr40-deferred-items

## Goal

Close the 11 items the brief enumerates as "deferred from PR #40 review" plus the cross-cutting registry / config / formatter items the Phase 1 merge train surfaced. PR #40 itself had 4 findings — Vitest v2 threshold normalization (already fixed in source per Round 2 verification), CustomMessage payload double-nesting (fixed), `biome` devDep (fixed), `REQUIRED_METHODS` test coverage (fixed). The "11 deferred" the brief refers to are the deeper hardening items the original Claude PR-review process raised but did not block on — they sit in the source today as latent risk items. Per the brief's list:

1. **vitest coverage glob portability** — the existing `vitest.config.ts` `coverage.include` patterns (`agent-runtime/**`, `daemon/**`, `telegram/**`) may not portable across `cwd` settings; verify + lock.
2. **threshold normalization 80↔85** — `runtime/agent-runtime/registry.ts` and Plan 04 of Phase 1 spec call for ≥85% coverage on critical files; current threshold is 80%. Decide per-file overrides vs uniform 80%.
3. **`Reflect.get` getter-side-effects hardening** — `registry.ts:96` uses `Reflect.get` in the structural probe; a malicious adapter could expose a getter with side effects. Defense-in-depth: switch to `Object.getOwnPropertyDescriptor` + `typeof descriptor.value === "function"` to avoid invoking getters.
4. **`listRuntimes` deep-freeze** — caller of `listRuntimes()` can mutate the returned array + sub-objects. Deep-freeze on output OR change return type to `ReadonlyArray<Readonly<...>>`.
5. **`exactOptionalPropertyTypes` adoption decision** — tsconfig flag that disambiguates `prop?: string` from `prop?: string | undefined`. Decide adopt/defer/reject with rationale.
6. **fail-isolated module-load test** — `agent-runtime/README.md` lines 64-65 promise a regression test for "adapter module that throws at registerRuntime is skipped; daemon continues with remaining runtimes." Test doesn't exist (PR #46 review Critical #2 flagged the gap).
7. **`runtime/biome.json` setup** — per memory `feedback_subproject_format_hook.md`: sub-project format hook drifts tabs↔spaces because no local biome.json exists in `runtime/`. Land a scoped config.
8. **`_resetRegistryForTests` production guard** — currently exported with JSDoc warning; harden via `if (process.env.NODE_ENV === "production") throw` so prod runs cannot accidentally invoke.
9. **`InterfaceVersion` centralization** — `"v1"` literal scattered across `runtime/agent-runtime/registry.ts` + tests + Plan 04 daemon code. Extract `INTERFACE_VERSION = "v1"` const in `runtime/agent-runtime/types.ts`; every callsite imports from there.
10. (Brief says "others — read PR #40 review history in `.iago/reviews/` (if file not present, search via `gh pr view 40 -R ilsantino/iago-os --comments`)". The gh-fetched history shows the original review found exactly the 4 items already-fixed; the "deferred 11" in the brief therefore IS items 1-9 above + the bullets the brief later names — i.e., they are exactly the 8 items the brief enumerates as bullet points and not extra hidden items. Land items 1-9 above; nothing extra to mine from PR #40 history.)
11. PLUS the brief's PR #46 Critical #2 ("Adapter module that throws at registerRuntime is skipped; daemon continues with remaining runtimes" — promised regression test never written) — wired into item 6 above.

Source of truth: PR #40 review trail (loaded via `gh pr view 40 -R ilsantino/iago-os --comments`); `runtime/agent-runtime/README.md:64-65` regression-test promise; the brief's explicit list.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| edit | `runtime/agent-runtime/registry.ts` | Reflect.get → getOwnPropertyDescriptor hardening; listRuntimes deep-freeze; _resetRegistryForTests prod-guard; import `INTERFACE_VERSION` from `types.ts` |
| edit | `runtime/agent-runtime/types.ts` | Export `INTERFACE_VERSION: "v1"` const; existing types reference the const |
| edit | `runtime/agent-runtime/registry.test.ts` | Tests for: getter side-effect (assert no side effect when adapter defines getter); listRuntimes immutability; _resetRegistryForTests prod-guard throw; INTERFACE_VERSION import |
| create | `runtime/integration/adapter-isolation.test.ts` | Regression test: a module that throws at top-level `registerRuntime` does not prevent other adapters from registering (fulfills agent-runtime/README.md:64-65 promise + Opus PR #46 C2) |
| edit | `runtime/vitest.config.ts` | Coverage glob portability lock; per-file threshold overrides (registry.ts ≥85%); add `json-summary` reporter for cheap CI parsing (per Plan 03 stress I2) |
| create | `runtime/biome.json` | Scoped Biome config for runtime/** — mirrors repo root with tab indent matching iago-os parent OR spaces matching runtime test conventions; pick + lock per Task 7 |
| create | `.iago/decisions/2026-05-17-exact-optional-property-types.md` | ADR: adopt / defer / reject — decision + rationale |
| edit | `runtime/tsconfig.json` | If ADR decides adopt: add `"exactOptionalPropertyTypes": true`; if defer/reject: leave unchanged, document in ADR |
| edit | `runtime/daemon/main.ts`, `runtime/daemon/ipc-server.ts`, any other `"v1"` literal user | Replace `"v1"` literals with `INTERFACE_VERSION` import |

## Tasks

### Task 1: Centralize `INTERFACE_VERSION` in types.ts

- **files:** `runtime/agent-runtime/types.ts`
- **action:** Add `export const INTERFACE_VERSION = "v1" as const;` near the existing `AgentRuntime` interface definition. Add JSDoc explaining: "Locked per ADR `.iago/decisions/2026-05-15-agent-shape-taxonomy.md` § Interface versioning. Phase 1 — Phase 2 stays v1. RuntimeAdapterShim covers v1↔v2 migration when Phase 3 introduces breaking changes." Adjust the `AgentRuntime.interfaceVersion` field type from the literal `"v1"` to the const-typed `typeof INTERFACE_VERSION`. Export the const + keep the type intersection so adapters can still write `interfaceVersion: "v1"` and that literal still satisfies the type (TypeScript narrows correctly).
- **verify:** `cd runtime && npx tsc --noEmit && grep -n "INTERFACE_VERSION" agent-runtime/types.ts`
- **expected:** `tsc --noEmit` exits 0. Const exported once.

### Task 2: Replace `"v1"` literals across the runtime tree

- **files:** `runtime/agent-runtime/registry.ts`, `runtime/agent-runtime/registry.test.ts`, `runtime/daemon/main.ts`, `runtime/daemon/ipc-server.ts`, `runtime/agent-runtime/pty/claude-pty.ts`, any other file with the literal
- **action:** `grep -rn '"v1"' runtime/ --include="*.ts" | grep -v ".test.ts"` to enumerate. Replace each non-test `"v1"` literal with `INTERFACE_VERSION` imported from `agent-runtime/types.js` (use the `.js` extension per the project's ESM convention). In test files, keep the string literals where they're asserting on exact wire content (e.g., a test asserting "the JSON output contains the string `\"v1\"`" must keep the literal — that's testing the serialization, not the constant). Document via inline comment: `// LITERAL "v1" preserved — testing wire format, not the const`.
- **verify:** `cd runtime && npx tsc --noEmit && grep -rn '"v1"' . --include="*.ts" | grep -v ".test.ts" | grep -v "node_modules\|dist" | wc -l && grep -rn "INTERFACE_VERSION" . --include="*.ts" | wc -l`
- **expected:** `tsc --noEmit` exits 0. Literal `"v1"` outside test files = 0. `INTERFACE_VERSION` usage count = original literal count (likely 3-5).

### Task 3: `Reflect.get` → `getOwnPropertyDescriptor` hardening

- **files:** `runtime/agent-runtime/registry.ts`
- **action:** In the structural probe (line ~96 per PR #40 review context), replace `Reflect.get(rt, method)` (which invokes getters) with `Object.getOwnPropertyDescriptor(rt, method)`. Logic: `const desc = Object.getOwnPropertyDescriptor(rt, method) ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(rt), method); const value = desc?.value; if (typeof value !== "function") return false;`. The descriptor traversal handles prototype-chain methods (most adapters define methods on class prototypes, not own properties). Add JSDoc to the probe explaining: "Uses property descriptors instead of `Reflect.get` so that a hostile adapter exposing a getter cannot run code during registration — the structural probe stays purely introspective." Preserve all 6 method checks.
- **verify:** `cd runtime && npx tsc --noEmit && grep -n "getOwnPropertyDescriptor\|Reflect.get" agent-runtime/registry.ts`
- **expected:** `tsc --noEmit` exits 0. `Reflect.get` removed (0 hits). `getOwnPropertyDescriptor` present.

### Task 4: `listRuntimes` immutability + `_resetRegistryForTests` prod-guard

- **files:** `runtime/agent-runtime/registry.ts`
- **action:** Two sub-changes:
  (a) Update `listRuntimes()` to return `ReadonlyArray<Readonly<{ id: string; shape: AgentShape; interfaceVersion: typeof INTERFACE_VERSION }>>`. Wrap returned items in `Object.freeze(...)` before pushing into the result array, then `Object.freeze` the array itself. JSDoc explains: "Returns a frozen snapshot — callers must NOT mutate. Use the snapshot as a read-only inspection surface; mutations should go through `registerRuntime` / `_resetRegistryForTests`."
  (b) At the top of `_resetRegistryForTests`, add: `if (process.env.NODE_ENV === "production") { throw new Error("_resetRegistryForTests cannot run in production"); }`. Update JSDoc: "Test-only — production runs throw. The existing barrel-exclusion rule remains; this is defense-in-depth in case the export accidentally lands in a public API surface."
- **verify:** `cd runtime && npx tsc --noEmit && grep -n "Object.freeze\|_resetRegistryForTests cannot run" agent-runtime/registry.ts`
- **expected:** `tsc --noEmit` exits 0. Both freeze + prod-guard present.

### Task 5: Tests for registry hardening

- **files:** `runtime/agent-runtime/registry.test.ts`
- **action:** Add 4 new tests:
  (a) `"registerRuntime does not invoke getter-defined methods on the adapter"` — define a test adapter using `Object.defineProperty` with a getter that throws on access for `spawn`; assert `registerRuntime(adapter)` throws an "invalid shape" error (not the getter's thrown error); assert the getter was never invoked (track via a flag set in the getter body that should NEVER flip).
  (b) `"listRuntimes returns a frozen snapshot"` — register 2 adapters; call `listRuntimes()`; attempt `result[0].id = "modified"` → throws TypeError in strict mode (or silently no-ops in sloppy mode — assert via property value unchanged); attempt `result.push({} as any)` → throws TypeError; confirm the registry state is unchanged afterward (calling listRuntimes again returns the original 2 items).
  (c) `"_resetRegistryForTests throws when NODE_ENV=production"` — `vi.stubEnv("NODE_ENV", "production")`; call `_resetRegistryForTests()`; assert throws with the exact error message.
  (d) `"_resetRegistryForTests succeeds when NODE_ENV !== production"` — stub `NODE_ENV` to `"test"` (or unset); register an adapter; call `_resetRegistryForTests()`; assert subsequent `listRuntimes()` returns empty.
- **verify:** `cd runtime && npx vitest run agent-runtime/registry.test.ts --reporter=verbose 2>&1 | tail -25`
- **expected:** All new + existing tests pass (was 12 → now 16).

### Task 6: Fail-isolated adapter module-load regression test

- **files:** `runtime/integration/adapter-isolation.test.ts`
- **action:** Create a new integration test fulfilling the agent-runtime/README.md:64-65 promise + PR #46 review Critical #2. Test name: `"adapter module that throws at top-level registerRuntime is fail-isolated — daemon continues with remaining runtimes"`. Setup: create two fake adapter modules via `vi.mock`:
  - `fake-broken-adapter` whose top-level body does `registerRuntime(...)` but throws BEFORE registration completes (or AT registration with an invalid shape so `registerRuntime` throws).
  - `fake-good-adapter` whose top-level body successfully registers a runtime named `fake-good`.
  Import both via side-effect imports in the test (mimicking how `claude-pty` imports in `runtime/daemon/main.ts:62`). The broken adapter's throw must be CAUGHT at the import boundary — meaning Plan 04 also needs to add a try/catch around the side-effect import in `runtime/daemon/main.ts` (currently lines 58-62 import `claude-pty` without a try/catch — if claude-pty's top-level threw, the entire daemon would fail to load). Wire the try/catch in main.ts, log the failure to stderr, AND emit a `runtime-registration-failed` telemetry event. Then the integration test asserts: (i) both adapters imported via `import("./fake-broken-adapter")` + `import("./fake-good-adapter")` in test; (ii) the broken adapter's throw was logged; (iii) `listRuntimes()` includes `fake-good` but NOT `fake-broken`. The README claim is then real.
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run integration/adapter-isolation.test.ts --reporter=verbose 2>&1 | tail -25`
- **expected:** `tsc --noEmit` exits 0; new test passes; verifies the fail-isolation contract.

### Task 7: `runtime/biome.json` scoped formatter config

- **files:** `runtime/biome.json` (NEW)
- **action:** Create a scoped Biome config that prevents the sub-project format hook drift documented in memory entry `feedback_subproject_format_hook.md`. Decision: match the existing `runtime/` source convention (currently tabs based on the source file inspection in this plan's CONTEXT.md). Inherit the repo-root rule set via `"extends": "../biome.json"` if Biome supports that flag (verify against Biome docs via Context7 OR omit the extends and copy the relevant `formatter` block + `linter.rules` block verbatim). Minimum content: JSON with `$schema`, `formatter.indentStyle: "tab"`, `formatter.indentWidth: 1`, `files.include: ["**/*.{ts,js,mjs,json,md}"]`, `linter.enabled: true`. After creation, run `npx biome check . --write` from `runtime/` to lock in the canonical format; commit the resulting whitespace changes if any.
- **verify:** `cd runtime && npx biome check . 2>&1 | tail -20 && cat runtime/biome.json | head -5`
- **expected:** `biome check` exits 0 (clean). `biome.json` exists and parses.

### Task 8: ADR + vitest config lock + (optional) exactOptionalPropertyTypes

- **files:** `.iago/decisions/2026-05-17-exact-optional-property-types.md` (NEW), `runtime/vitest.config.ts`, `runtime/tsconfig.json` (conditional)
- **action:** Two sub-changes:
  (a) Write ADR `.iago/decisions/2026-05-17-exact-optional-property-types.md`. Sections: Context (what is `exactOptionalPropertyTypes`, why considered now), Decision (one of: adopt / defer to Phase 3 / reject), Rationale (cost-benefit; current `AgentConfig.org?: string` and `AgentConfig.authProfile?: ...` would change semantics — explicit `undefined` would no longer satisfy `org?: string`), Consequences (what breaks; what to refactor in Phase 3 when adopting if deferred), References (TS docs + ADR pattern doc). Default: defer to Phase 3 since Phase 2 already adds `authProfile?` field and adopting now requires touching every optional-field call-site across Phase 1 code. Phase 3 introduces enough new optional fields that batching the adoption with Phase 3 cleanup is cheaper than retrofitting Phase 1. Document the trigger to revisit.
  (b) Update `runtime/vitest.config.ts`: (i) add `"json-summary"` to the `reporter` array; (ii) verify that `coverage.include` globs work from any cwd (the current `"agent-runtime/**"` patterns are relative — confirm Vitest resolves against the config file's dir, not the runner cwd; if not, switch to absolute via `path.resolve(__dirname, ...)` or add a `root` option); (iii) add per-file threshold overrides for `registry.ts ≥85%` via `coverage.thresholds.perFile = { 'agent-runtime/registry.ts': { lines: 85, branches: 80 } }` IF Vitest v2 supports per-file (verify via Context7); if not, document in the file header that the 80% floor is global and per-file higher floors are aspirational, NOT enforced.
- **verify:** `ls .iago/decisions/2026-05-17-exact-optional-property-types.md && cd runtime && npx vitest run --coverage --reporter=json-summary 2>&1 | tail -10 && cat coverage/coverage-summary.json 2>&1 | head -5`
- **expected:** ADR file exists with ≥4 sections. Vitest produces `coverage/coverage-summary.json` (proves json-summary reporter wired).

## Verification

```bash
cd runtime \
  && npx tsc --noEmit \
  && npx biome check . \
  && npx vitest run --coverage --reporter=verbose 2>&1 | tail -40 \
  && grep -rn '"v1"' . --include="*.ts" | grep -v ".test.ts" | grep -v "node_modules\|dist" | wc -l \
  && grep -rn "INTERFACE_VERSION" . --include="*.ts" | wc -l \
  && ls biome.json
```

Expected:
- `tsc --noEmit` exits 0
- `biome check .` exits 0
- vitest pass count rises by ≥5 (new registry tests + adapter-isolation test)
- Literal `"v1"` outside test files = 0
- INTERFACE_VERSION usage ≥3
- `runtime/biome.json` present

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-17
**Reviewer:** orchestrator inline (5-dimension rubric per `.claude/rules/skill-authoring.md` § 2)

### Critical (must fix in impl)

- **C1 — Task 2 risks breaking the existing PR #40 fix for `interfaceVersion !== "v1"` guard (registry.ts line 79 per PR #40 review).** The guard exists to reject adapters with the wrong interface version. After Task 1 + 2, the guard becomes `if (rt.interfaceVersion !== INTERFACE_VERSION)`. Confirm via test (registry.test.ts has a test for this; updating to `INTERFACE_VERSION` is a literal substitution but the test assertion of the error message — likely "expected v1, got ..." — may need to read from the const. Update the assertion to: `expect(...).toThrow(\`Adapter interfaceVersion mismatch: expected ${INTERFACE_VERSION}, got ...\`)` so the assertion stays meaningful.
- **C2 — Task 6's main.ts try/catch around side-effect import changes Phase 1 behavior.** The current code at main.ts:62 does an unguarded `import "../agent-runtime/pty/claude-pty.js"`. Wrapping this in try/catch is a behavior change — Phase 1 may have tests that assert the daemon FAILS to start on a broken adapter (fail-fast vs fail-isolated has different defaults). Confirm via PR #40 review: the README claim is fail-ISOLATED (continue with remaining runtimes). PR #46 review Critical #2 confirms this is the intent. Adopt fail-isolated. But the broken adapter's failure must be VERY visible — stderr error + `runtime-registration-failed` telemetry event with the adapter name + error message + stack-trace-truncated-to-3-lines. Document in `runtime/agent-runtime/README.md` the new behavior + the telemetry event consumers can monitor for production triage.

### Important (forward to impl, don't block)

- **I1 — `runtime/biome.json` `extends: "../biome.json"` may not work as Biome 1.x's extends only resolves to package names, not relative paths.** Verify via `npx biome --help extends` or Context7 docs. Fallback: copy the relevant rule set inline. Either way, the chosen indentStyle MUST match what `runtime/`'s existing source uses today (verified via reading several files in `runtime/daemon/` and `runtime/telegram/` — looks tab-indented per the source file I/O in the plan's CONTEXT.md). After biome.json lands, run `biome check . --write` to apply; any whitespace churn is expected and ships in this PR.
- **I2 — Per-file threshold override for `registry.ts` may not be supported in Vitest v2.** Per the Vitest v2 docs (Context7-verifiable), `coverage.thresholds` supports `perFile: true` boolean (apply thresholds per-file uniformly) but NOT named per-file overrides. Workaround: keep global threshold at 80%; document `registry.ts` aspirational 85% in JSDoc + leave a TODO with date + tracked issue for when Vitest supports it OR write a custom check script (`scripts/check-coverage.mjs`) that parses `coverage-summary.json` post-run + fails if `registry.ts < 85%`. Decision: skip the custom script; document in JSDoc; revisit if Vitest adds the feature.
- **I3 — `runtime/integration/adapter-isolation.test.ts` mocks two adapter modules via `vi.mock` but `vi.mock` only works against modules importable from the test file's package.** Workaround: create the two fake adapters as REAL files at `runtime/integration/fixtures/fake-broken-adapter.ts` + `fake-good-adapter.ts`; import them in the test directly. No `vi.mock` needed. The fail-isolation is asserted on the REAL import behavior. Document the fixture files' purpose in `runtime/integration/README.md` (which Plan 05 may need to ensure exists per PR #46 Critical #3).
- **I4 — ADR decision is "defer" but does NOT block on Phase 3.** Trigger condition for revisiting: when Phase 3 introduces ≥3 new optional fields in `AgentConfig` or `RegisterAgentConfig`, batch the adoption. Plan 04 ADR documents this trigger explicitly so a Phase 3 implementer sees it.

### Minor

- M1 — Test (a) in Task 5 (getter side-effect) uses `Object.defineProperty` with a getter that throws — confirm the test pattern compiles under strict TS (define adapter as `Object.defineProperty(adapter, "spawn", { get() { ... } })` then cast to `AgentRuntime`; the cast is allowed under TS strict if explicit). Use `as unknown as AgentRuntime` only via the satisfies-pattern from PR #40 round-2 fixes if strict mode rejects.
- M2 — Task 7's biome check may flip indentation across the entire `runtime/` tree if the chosen `indentStyle` differs from current source. Run `biome check . --diff` first to preview impact. If the diff is small (<20 files, all whitespace), proceed. If large, escalate via NEEDS_CONTEXT — the indentation choice itself is a Santiago-level decision (per the project-rule about tab-vs-space conventions).
- M3 — `gh pr view 40` was already done to enumerate deferred items. The plan should NOT re-fetch during impl unless the brief enumeration above proves incomplete. Cite the brief's enumeration as canonical.

### Dimension-by-dimension verdicts

- **Precision:** Every task names file + grep pattern + verify command; the ambiguous items (per-file threshold, biome extends) have explicit fallback paths.
- **Edge cases:** C1 (test assertion drift), C2 (fail-isolated behavior change), I3 (vi.mock limitation), I4 (ADR trigger to revisit) cover the four non-obvious items.
- **Contradictions:** Task 8 says "default: defer to Phase 3" for the ADR; CONTEXT.md OQ6 says "Default: defer to Phase 3". Aligned. Task 2 says "replace `\"v1\"` literals" but Task 1 says the type intersection allows `"v1"` literal to still satisfy — meaning the literal CAN remain, but the explicit goal is centralization for readability + future-proofing. Use the const everywhere except in serialization-asserting tests.
- **Simpler alternatives:** Could leave the existing `Reflect.get` (item 3) since "hostile adapter" is not the Phase 1 trust model. REJECTED — the brief explicitly enumerates this as a deferred item; defense-in-depth is cheap (2-line change) + improves the registry's robustness for Phase 3 Hermes-MCP adapter where the trust boundary widens.
- **Missing acceptance criteria:** All 9 items from the brief enumeration are mapped to tasks (Task 1: item 9 InterfaceVersion + Task 2 propagation; Task 3: item 3 Reflect.get; Task 4: items 4 + 8; Task 5: tests for 3+4+8; Task 6: items 6 + PR #46 C2; Task 7: item 7 biome.json; Task 8: items 1 + 2 + 5). One leftover item from the brief is "fail-isolated module-load test" — covered by Task 6.

### Implementer forward-list

1. Update registry.test.ts assertion for the interfaceVersion mismatch error to use `INTERFACE_VERSION` const in the expected message string (C1 fix).
2. Add stderr error + `runtime-registration-failed` telemetry event in main.ts side-effect import try/catch (C2 fix); document in agent-runtime/README.md.
3. Verify biome 1.x `extends` resolves to package names only; copy rule set inline if not (I1 fix).
4. Document `registry.ts ≥85%` as aspirational in vitest.config.ts JSDoc; revisit when Vitest supports named per-file overrides (I2 fix).
5. Use real fixture files at `runtime/integration/fixtures/fake-*.ts` instead of `vi.mock` (I3 fix).
6. ADR documents the trigger: "≥3 new optional fields in Phase 3 → batch adoption" (I4 fix).
7. Preview biome impact via `--diff` before applying (M2 fix); escalate if large diff.
