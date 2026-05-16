---
phase: feature-v2-phase-1-daemon
plan: 01
wave: 1
depends_on: []
context: .iago/plans/feature-v2-phase-1-daemon/CONTEXT.md
created: 2026-05-15
source: feature
---

# Plan: feature-v2-phase-1-daemon/01-runtime-skeleton-and-agent-runtime-interface

## Goal

Create the `runtime/` directory skeleton and define the polymorphic `AgentRuntime` interface + registry boot logic. This is the foundation every subsequent plan builds against. No agent shape adapters yet — just the contract + the registry + interface-compliance validation at boot.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/package.json` | Node 20 ESM package manifest for v2 daemon; declares `"type": "module"`, scripts, deps |
| create | `runtime/tsconfig.json` | TypeScript strict config; extends repo root patterns; `outDir: "./dist"`, `target: "ES2022"`, `module: "NodeNext"` |
| create | `runtime/vitest.config.ts` | Vitest config for runtime/ subtree; `coverage.lines: 80` floor; include `runtime/**/*.{test,spec}.ts` |
| create | `runtime/.gitignore` | Ignore `dist/`, `node_modules/`, `tasks/`, `approvals/`, `state/`, `*.log`, `telemetry/*.ndjson` (runtime state must not be committed) |
| create | `runtime/agent-runtime/types.ts` | Core types: `AgentShape`, `AgentHandle`, `AgentMessage`, `SpawnOpts`, `StatusCallback`, `CostEvent`, `StatusValue` |
| create | `runtime/agent-runtime/registry.ts` | `AgentRuntime` interface + `registerRuntime()` + boot-time interface validation + `resolveRuntime(id)` lookup |
| create | `runtime/agent-runtime/registry.test.ts` | Vitest unit tests for registry validation, registration, lookup, version compliance |
| create | `runtime/README.md` | Top-level runtime/ README: purpose, layout, how to run locally, configuration reference |
| create | `runtime/agent-runtime/README.md` | agent-runtime/ README: how to implement a new adapter, registry boot sequence, interface versioning |

## Tasks

### Task 1: Scaffold runtime/ Node ESM package

- **files:** `runtime/package.json`, `runtime/tsconfig.json`, `runtime/vitest.config.ts`, `runtime/.gitignore`
- **action:** Create `runtime/package.json` with `"name": "@iago-os/runtime"`, `"type": "module"`, `"private": true`, scripts `{ "build": "tsc -p .", "test": "vitest run", "test:watch": "vitest", "typecheck": "tsc --noEmit", "lint": "biome check ." }`, devDependencies for `typescript@^5.6`, `vitest@^2`, `@vitest/coverage-v8@^2`, `@types/node@^20`. Create `runtime/tsconfig.json` extending nothing (standalone) with `compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noUncheckedIndexedAccess: true, esModuleInterop: true, skipLibCheck: true, declaration: true, declarationMap: true, sourceMap: true, outDir: "./dist", rootDir: "." }`, `include: ["agent-runtime/**/*.ts", "daemon/**/*.ts", "telegram/**/*.ts"]`, `exclude: ["dist", "node_modules", "**/*.test.ts"]`. Create `runtime/vitest.config.ts` exporting `defineConfig({ test: { coverage: { provider: "v8", reporter: ["text", "json", "html"], lines: 80, branches: 75, functions: 80, statements: 80, include: ["agent-runtime/**", "daemon/**", "telegram/**"], exclude: ["**/*.test.ts", "**/types.ts", "dist/**"] }, include: ["**/*.test.ts"], passWithNoTests: false } })`. Create `runtime/.gitignore` with: `dist/`, `node_modules/`, `tasks/`, `approvals/`, `state/`, `telemetry/*.ndjson`, `*.log`, `.daemon-stop`.
- **verify:** `cd runtime && npm install --package-lock-only --omit=optional && cat package.json tsconfig.json vitest.config.ts .gitignore | wc -l`
- **expected:** All four files exist with non-zero content; `npm install --package-lock-only` exits 0; combined line count > 50. `cat runtime/package.json | grep -c '"type": "module"'` returns `1`.

### Task 2: Define AgentRuntime core types

- **files:** `runtime/agent-runtime/types.ts`
- **action:** Define and `export` (named exports only) the following types verbatim from `docs/specs/iago-os-v2-vision.md` § Agent Shape Taxonomy + `.iago/decisions/2026-05-15-agent-shape-taxonomy.md` § Decision: `AgentShape = "pty" | "http" | "mcp" | "event" | "daemon"`; `InterfaceVersion = "v1"`; `StatusValue = "running" | "idle" | "exited" | "crashed" | "unknown"`; `AgentHandle` (object: `id: string`, `runtime: string`, `shape: AgentShape`, `agentId: string`, `sessionId: string`, `generationToken: number`, `org?: string`, `parentHandleId?: string`, `spawnedAt: number`, `markerPath: string`); `SpawnOpts` (object: `cwd: string`, `env: Record<string, string>`, `agentId: string`, `sessionId: string`, `org?: string`, `parentHandle?: AgentHandle`); `AgentMessage` (discriminated union by `kind: "prompt" | "approval" | "abort" | "inject" | "custom"`, each with appropriate `payload` type — `prompt: { text: string }`, `approval: { approvalId: string; decision: "allow" | "deny" }`, `abort: { reason?: string }`, `inject: { text: string }`, `custom: { payload: unknown }`); `StatusCallback = (status: StatusValue, code?: number) => void`; `CostEvent` (object: `at: number`, `agentId: string`, `sessionId: string`, `inputTokens?: number`, `outputTokens?: number`, `dollarsUsd?: number`, `provider?: string`, `model?: string`). No `any`, no `unknown` outside `AgentMessage.custom.payload`. File <120 lines.
- **verify:** `cd runtime && npx tsc --noEmit -p tsconfig.json 2>&1 | tee /tmp/tsc.log && grep -c "export" agent-runtime/types.ts`
- **expected:** `tsc --noEmit` exits 0 (no diagnostics). `grep -c "export"` returns ≥10 (one per named export above).

### Task 3: Implement AgentRuntime interface + registry

- **files:** `runtime/agent-runtime/registry.ts`, `runtime/agent-runtime/types.ts`
- **action:** In `registry.ts`, define and export the polymorphic interface `AgentRuntime` exactly: readonly fields `shape: AgentShape`, `id: string`, `version: string`, `interfaceVersion: "v1"`; methods `spawn(opts: SpawnOpts): Promise<AgentHandle>`, `send(handle: AgentHandle, message: AgentMessage): Promise<void>`, `onStatusChanged(handle: AgentHandle, cb: StatusCallback): () => void` (returns unsubscribe fn — JSDoc that callers MUST call it), `isAlive(handle: AgentHandle): Promise<boolean>`, `shutdown(handle: AgentHandle, signal?: "SIGTERM" | "SIGKILL"): Promise<void>`, `restoreFromMarker(markerPath: string): Promise<AgentHandle | null>`, optional `costTap?(handle: AgentHandle): AsyncIterable<CostEvent>`. Implement registry as a module-scope `Map<string, AgentRuntime>` keyed by `id`; export `registerRuntime(rt: AgentRuntime): void` that throws `Error` with message starting `"AgentRuntime registration failed:"` if: (a) `id` already registered, (b) `interfaceVersion !== "v1"`, (c) any required method is missing (runtime structural probe using `typeof rt.method === "function"` checks for spawn/send/onStatusChanged/isAlive/shutdown/restoreFromMarker), (d) `shape` is not one of the 5 valid values. Export `resolveRuntime(id: string): AgentRuntime` that throws `Error("No AgentRuntime registered for id: <id>")` on miss. Export `listRuntimes(): ReadonlyArray<{ id: string; shape: AgentShape; version: string }>` for diagnostic purposes. Export `_resetRegistryForTests(): void` (used only in test files; document the underscore prefix as test-only). All named exports.
- **verify:** `cd runtime && npx tsc --noEmit -p tsconfig.json && grep -E "^export (function|const|interface|type)" agent-runtime/registry.ts`
- **expected:** `tsc --noEmit` exits 0. `grep -E` lists: `export interface AgentRuntime`, `export function registerRuntime`, `export function resolveRuntime`, `export function listRuntimes`, `export function _resetRegistryForTests`.

### Task 4: Write registry Vitest unit tests

- **files:** `runtime/agent-runtime/registry.test.ts`
- **action:** Write Vitest tests (using `describe`/`it`/`expect` from `vitest`) covering: (1) successfully register a minimal valid runtime fixture and resolve it back; (2) registering duplicate `id` throws with message starting `"AgentRuntime registration failed:"`; (3) `interfaceVersion: "v2"` is rejected at registration; (4) missing `spawn` method is rejected (use `as unknown as AgentRuntime` cast intentionally to bypass TS and trigger the runtime probe); (5) missing `onStatusChanged` rejected; (6) invalid `shape: "browser"` rejected; (7) `resolveRuntime("nonexistent")` throws with `"No AgentRuntime registered for id: nonexistent"`; (8) `listRuntimes()` returns id/shape/version triples for all registered runtimes. Use `beforeEach(() => _resetRegistryForTests())` to isolate tests. Build fixture with stubbed async methods that return immediate `Promise.resolve()` or empty handles. File <250 lines. No mocks of node modules — pure logic tests.
- **verify:** `cd runtime && npx vitest run agent-runtime/registry.test.ts --reporter=verbose 2>&1 | tail -30`
- **expected:** All 8 tests pass; output contains `8 passed`; coverage on `registry.ts` ≥85% lines.

### Task 5: Write runtime/README.md

- **files:** `runtime/README.md`
- **action:** Write a top-level README documenting: (1) Purpose — "iago-os v2 daemon runtime; hosts agents of any execution shape via polymorphic `AgentRuntime` interface"; (2) Directory layout — `agent-runtime/` (registry + adapters by shape), `daemon/` (agent-manager, file-bus, IPC, session-log, heartbeat), `telegram/` (approval handshake + per-agent routing), `migration/` (phase-N audit + rollback docs); (3) How to run locally on Windows/Linux — `cd runtime && npm install && npm test`; daemon entry point lands in Phase 1 plan 07; (4) Configuration — agent config files at `orgs/<client>/agents/<agent>/config.json` with `runtime` field pointing to a registered adapter `id`; (5) Tech constraints — Node 20 ESM, TypeScript strict, named exports only, no Docker, no Postgres, SQLite + JSON/JSONL for state; (6) Phase 1 scope explicit: Shape 1 (PTY) only via `claude-pty`. Shapes 2-5 land in Phases 3, 9, 11; (7) Links to canonical specs (`docs/specs/iago-os-v2-vision.md`, `docs/specs/iago-os-v2-master-prompt.md`, ADR, runtime/CONTEXT.md). Use markdown headings, code fences, no emojis. File 80-150 lines.
- **verify:** `wc -l runtime/README.md && grep -c "^##" runtime/README.md`
- **expected:** Line count 80-150 inclusive. Heading count (`grep -c "^##"`) ≥6 (one per top-level section). `grep -q "Shape 1 (PTY)" runtime/README.md` exits 0.

### Task 6: Write runtime/agent-runtime/README.md

- **files:** `runtime/agent-runtime/README.md`
- **action:** Write a README documenting: (1) Purpose — "Polymorphic `AgentRuntime` interface + registry + per-shape adapter implementations"; (2) The 5 shapes with one-line mechanics each (PTY: pseudo-terminal subprocess; HTTP/SDK: provider SDK call from host process; MCP-as-agent: stdio JSON-RPC goal-taking subprocess; Webhook/event: triggered by inbound event, runs to completion; Daemon/long-running: always-on host process with internal scheduler); (3) How to implement a new adapter — "implement the `AgentRuntime` interface from `registry.ts`, declare `interfaceVersion: 'v1'`, register at module load with `registerRuntime(yourAdapter)`"; (4) Adapter file layout convention: `runtime/agent-runtime/<shape>/<id>.ts` (e.g., `pty/claude-pty.ts`, `http/anthropic-sdk.ts`); (5) Boot sequence — daemon loads all adapter modules at startup; each module side-effects `registerRuntime()` at import time; daemon validates `interfaceVersion` at boot and refuses to start if validation fails; (6) Interface versioning + migration via `RuntimeAdapterShim` (Phase 3+ concern, but explained); (7) Per-shape lifecycle semantics — refer the reader to `docs/specs/iago-os-v2-vision.md` § Per-shape lifecycle semantics. File 80-140 lines.
- **verify:** `wc -l runtime/agent-runtime/README.md && grep -c "Shape" runtime/agent-runtime/README.md`
- **expected:** Line count 80-140. `grep -c "Shape"` returns ≥5 (one per shape).

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-15

### Contradictions

- **C1 (RESOLVED 2026-05-15 PM) — `AgentMessage` shape is the richer discriminated union.** Santiago decision 2026-05-15 PM: ADR + vision spec amended to adopt the per-kind typed union (see `.iago/decisions/2026-05-15-agent-shape-taxonomy.md` § "AgentMessage typing — richer per-kind discriminated union (2026-05-15 PM)" and `docs/specs/iago-os-v2-vision.md` § Agent Shape Taxonomy + `AgentRuntime` Interface). Task 2 here is now ALIGNED with canon. Implementer: implement exactly as Task 2 specifies (typed per-kind payloads; `custom.payload: unknown` is the escape hatch). No conflict remains.
- **C2 (Critical) — `interfaceVersion` field missing from the interface declaration.** Task 3 specifies registry validation checks `rt.interfaceVersion !== "v1"`, but the interface block in Task 3 does not declare `readonly interfaceVersion: "v1"` as a field. TypeScript strict cannot enforce missing fields without the declaration. **Fix:** declare `readonly interfaceVersion: "v1"` on `interface AgentRuntime` next to `shape`/`id`/`version`.

### Edge cases

- **C3 (Critical) — Module-load `registerRuntime` throw crashes the daemon at boot.** If an adapter's module load calls `registerRuntime()` and validation fails, the throw propagates into the daemon's `import` chain. Plan does not specify fail-closed (crash daemon) vs fail-isolated (skip adapter, log, continue). **Fix:** wrap module-load registration in a try/catch at the daemon entry point (Plan 07 main.ts); log failed adapters; continue with remaining registered runtimes. Document the policy in `runtime/agent-runtime/README.md`. Add a test for "adapter that throws at registerRuntime is skipped, daemon continues."

### Precision

- **I1+I2 (Important) — Phase-1 scope mismatch in tsconfig/vitest includes.** `tsconfig.json` and `vitest.config.ts` reference `daemon/**` and `telegram/**` which don't exist after Plan 01 only. Either scope to `agent-runtime/**` and have later plans extend, OR pre-create empty `daemon/` and `telegram/` directories with a `.keep` file in Plan 01 task 1 (recommended — single-source-of-truth config). **Fix:** add `daemon/.keep` and `telegram/.keep` creation to Task 1.
- **I4 (Important) — `resolveRuntime` return type unstated.** Explicitly declare `resolveRuntime(id: string): AgentRuntime` (throw-on-miss) — not `AgentRuntime | undefined`.

### Standards

- **I3 (Important) — `as unknown as AgentRuntime` cast violates CLAUDE.md "no `as` casts".** Test 4 in Task 4 needs a CLAUDE.md-compliant alternative. **Fix:** use a `Partial<AgentRuntime>` factory in a clearly-scoped test helper, or use the `satisfies` operator pattern: `const broken = { ... } satisfies Partial<AgentRuntime>` and feed it through a `// @ts-expect-error` test-only escape that documents the intentional probe.
- **I5 (Important) — `migration/` in expected `ls` output may not exist.** Replace `ls runtime/` exit-status dependency with explicit check: `[ -d runtime/agent-runtime ] && [ -f runtime/README.md ] && echo OK`.

### Minor

- M1 — `_resetRegistryForTests` documented as test-only with underscore prefix; do not re-export from any barrel `index.ts`.
- M2 — `costTap?` async iterable cancellation policy: document "consumer stops iterating → adapter MUST stop producing within 100ms or accept memory pressure." Phase 1 has no consumer; flag for Phase 3.
- M3 — `wc -l` is Unix-only; works in Git Bash on Windows but verify command portability.

### Implementer forward-list

1. ~~Match `AgentMessage` to spec canon~~ RESOLVED 2026-05-15 PM — implement the richer discriminated union per Task 2 (the ADR + vision spec have been amended to match).
2. Declare `readonly interfaceVersion: "v1"` on `AgentRuntime` interface — see C2.
3. Document and test fail-isolated module-load policy — see C3.
4. Pre-create `daemon/.keep` and `telegram/.keep` to keep tsconfig includes valid — see I1+I2.
5. Replace `as unknown as` cast with `satisfies` + `// @ts-expect-error` pattern — see I3.
6. Explicit return type on `resolveRuntime` — see I4.
7. Replace `ls` verify with explicit file existence check — see I5.

### 2nd-pass stress notes (2026-05-15 PM)

- **`agent-runtime/README.md` (Task 6) must include the adapter-authoring rule:** "Adapters that accept structured `custom` payloads MUST document the expected payload shape in JSDoc on the adapter's `send()` override. The `custom` kind is the explicit escape hatch — adapters using it OWN their payload schema documentation."
- **`agent-runtime/README.md` (Task 6) must document `approval` kind status:** "RESERVED kind — the active approval path is file-bus polling via `approval-bus.ts` (Plan 06). `runtime.send(handle, { kind: 'approval', ... })` is not invoked by any Phase 1 caller. The kind exists on the interface as a reserved future channel for push-based approval notification. Adapter `send()` implementations should no-op the `approval` arm in Phase 1 (Plan 04 claude-pty does this)."
- **`prompt` payload is intentionally narrow.** When Shape 2 (HTTP/SDK) lands in Phase 3, a new kind will be added (e.g., `sdk-request`) rather than extending `prompt`. No Phase 1 implementation impact.

## Verification

After all tasks complete, from the repo root:

```bash
cd runtime && npm install && npx tsc --noEmit && npx vitest run --coverage 2>&1 | tail -20
```

Expected:
- `tsc --noEmit` exits 0
- Vitest reports `8 passed` (all registry tests)
- Coverage table shows `registry.ts` ≥85% lines, `types.ts` excluded from coverage
- Overall coverage report renders without errors
- `ls runtime/agent-runtime/` shows: `README.md`, `registry.ts`, `registry.test.ts`, `types.ts`
- `ls runtime/` shows: `README.md`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `agent-runtime/`, `migration/` (pre-existing)
