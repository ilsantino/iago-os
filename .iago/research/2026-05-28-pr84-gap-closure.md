# Feature brief — PR #84 gap closure (close the green-locked prod gaps)

**Date:** 2026-05-28
**Branch:** `feat/pr-triage-integration-test` (PR #84, OPEN — update in place, do NOT rebranch)
**Driver:** Dual aggressive adversarial on PR #84 — Codex GPT-5.5 `needs-attention` (2 High: H1, H2); Opus 4.7 `PROCEED_WITH_NOTES` (5 Important: I1–I5).

## Why this exists

PR #84 shipped `runtime/agents/pr-triage/pr-triage.test.ts` (+926) — the Phase-2 cron→wake-check→PTY-spawn→polling→dispatch integration test. To stay "honest," it encoded two **known production gaps** as *passing* assertions (`toBeUndefined()`) plus an `it.todo`. The two reviewers disagreed on whether that pattern is acceptable.

**Verdict (locked): Codex was right on substance.** Encoding a known-broken prod behavior as "current behavior passes / desired behavior `it.todo`" **green-locks the broken prod path** — the suite goes green while production is wrong, and the gap is invisible to anything that only watches CI status. The fix is to **implement the real daemon behavior** and flip the assertions to assert the *correct* contract. Both gaps + all Opus notes are closed in THIS PR (no chore follow-up).

The async `@claude` review loop on PR #84 separately hit max rounds (5) and posted "Manual review required" — the commits from this brief supersede that state.

## Real file paths (scope-as-given used stale `runtime/lib/*` paths — corrected here)

| Concern | Real path |
|---|---|
| Polling loop / `processPendingTask` / `claimTask` | `runtime/daemon/agent-manager.ts` |
| Dispatch handler / cron-agent registration | `runtime/daemon/main.ts` |
| `DaemonEvent` telemetry union | `runtime/daemon/telemetry.ts` |
| PTY adapter (env handling) | `runtime/agent-runtime/pty/claude-pty.ts` |
| Integration test (the PR artifact) | `runtime/agents/pr-triage/pr-triage.test.ts` |
| Canonical envelope contract (reference, **do not edit**) | `runtime/agents/pr-triage/prompt-template.md` |

## Locked design decisions (resolved before planning)

### D1 — ndjsonAlert telemetry payload shape (resolves open question "curl exit + body, or one?")
The canonical producer is `prompt-template.md:145-148`, which writes a **single combined string**, not separate fields:
```json
{"agentId":"pr-triage","ndjsonAlert":"pr-triage-telegram-send-failed","details":"${HTTP_STATUS} ${redacted-body}"}
```
There is a **second** alert kind — `prompt-template.md:180` — `"ndjsonAlert":"pr-triage-double-failure"` with its own `details`. The daemon must mirror the producer, NOT invent `curlExitCode`/`telegramResponseBody` (which the agent's bash never captures — it captures `$HTTP_STATUS`, not the curl process exit).

**Telemetry event (one kind, disambiguated by `alertKind`):**
```ts
{
  readonly kind: "pr-triage-telegram-send-failed";
  readonly agentId: string;
  readonly filename: string;
  readonly alertKind: string;   // verbatim `ndjsonAlert` value ("pr-triage-telegram-send-failed" | "pr-triage-double-failure" | future)
  readonly details: string;     // verbatim `details` string from the envelope (already token-redacted by the agent)
}
```
**Consequence:** `prompt-template.md` stays out of the change set (≈5 files preserved); honors the team's "prompt-template is canonical" decision.

### D2 — Env-forward layer (resolves the claude-pty.ts CRITICAL #1 conflict)
Scope-as-given said edit `claude-pty.ts:340` to merge `process.env`. That file carries an explicit **CRITICAL #1** invariant (lines 469-474, 624-630): *"NEVER substitute `process.env` — the daemon's ambient env can differ from the per-agent env, leaking cross-client credentials."* The daemon is multi-tenant; merging at the generic adapter would leak iaGO's Telegram/GH creds into every spawned agent including future client agents.

**Decision: forward at the daemon registration layer, org-gated. `claude-pty.ts` is NOT edited.**
- In `registerCronAgentWithRestart` (`main.ts:736`), before each `agentManager.registerAgent({... env ...})` call (the initial registration ~`main.ts:803-809` AND the restart re-registration ~`main.ts:780-786`), compose the env passed to `registerAgent` as: `{ ...agentConfig.env, ...allowlistedFromProcessEnv }`.
- Allowlist constant (module-level, exported for the test): `CRON_AGENT_ENV_ALLOWLIST = ["IAGO_TELEGRAM_BOT_TOKEN", "IAGO_TELEGRAM_ALLOWED_USER_IDS", "GH_TOKEN"]`.
- **Gate:** only inject when `agentConfig.org === "internal"` (the pr-triage fixture sets `org: "internal"`). A future client cron agent (`org: "client-x"`) does NOT receive the daemon's creds.
- Only forward a var if it is actually present in `process.env` (skip `undefined` — don't materialize empty-string env entries).
- The adapter (`claude-pty.ts`) continues to forward only `opts.env` — invariant preserved; the daemon (trusted orchestrator) is the layer allowed to compose per-agent env from its own secrets.

### D3 — Case 4 restart-backoff timing (resolves the fake-timer spike)
Spike result: the backoff `setTimeout` is armed at crash-time (Phase A→B) under real timers, so "fake timers for Phase C only" cannot control an already-armed real timer; faking from the start breaks Phase B's real-I/O marker poll (libuv fs write is not a microtask `advanceTimersByTimeAsync` can flush → cold-Windows `fdatasync` flakiness — the exact class the team just fixed by bumping the poll to 2s).

**Decision: add an injectable backoff seam; keep real timers.**
- `registerCronAgentWithRestart` gains an optional `backoffMs?: readonly number[]` param, defaulting to `CRON_AGENT_RESTART_BACKOFF_MS`. Mirrors the codebase's existing test seams (`CronScheduler` `nowFn`, `startPollingLoop` `intervalMs`).
- Case 4 passes a tiny backoff (e.g. `[10]` or `[10, 30, 60]`) and stays on **real timers** end-to-end. Phase B unchanged. No `vi.useFakeTimers`.
- Case 4 asserts the restart **mechanism** (second spawn lands, `cron-agent-restarted { attempt: 1 }` emitted), not the literal 5000ms value.

## Scope — tasks (group as ONE feature plan, multiple tasks)

Prod-behavior tasks (T1–T4) must land **before** the test-assertion flips (T5–T6) so the flipped assertions pass against real behavior.

### T1 — ndjsonAlert branch in `processPendingTask` (`agent-manager.ts`) — closes Codex H1
- Location: after `agentId` is extracted (~`agent-manager.ts:1714`), **before** the `isAgentRegistered` check (~`:1723`). An alert is a record-and-resolve signal; it needs no live handle.
- If `parsed.ndjsonAlert` is a **non-empty string**: emit `pr-triage-telegram-send-failed { agentId, filename, alertKind: <ndjsonAlert>, details: <parsed.details ?? ""> }` telemetry, then `await this.claimTask(filename, agentId)` to move pending→resolved.
- `claimTask` is decrement-only and registration-agnostic (verified `agent-manager.ts:1469-1495`); the cron per-filename outstanding-set filter makes the resulting `task-resolved` a slot-accounting no-op for non-cron-fired alert files (same filter Case 9 exercises) — safe.
- Emit telemetry **before** `claimTask`; on rename failure the file stays in pending and the alert re-emits next tick (acceptable, matches existing failure shape). Do NOT advance to the `task-dispatch-needed` emit for alert envelopes.
- Acceptance: an envelope with `ndjsonAlert` and no `prompt` resolves to `tasks/resolved/`, emits `pr-triage-telegram-send-failed`, and does NOT emit `task-dispatch-needed` or `pr-triage-dispatch-failed`.

### T2 — Mirror ndjsonAlert branch in `makeTaskDispatchHandler` (`main.ts:575`) — defense in depth
- After the `findHandleForAgent` lookup, **before** the `prompt` validation (~`main.ts:600`), branch on `evt.taskContent.ndjsonAlert` being a non-empty string with identical semantics to T1 (emit `pr-triage-telegram-send-failed`, `await agentManager.claimTask(evt.filename, evt.agentId)`, return). Keeps the `finally`→`releaseDispatchSlot` guard intact.
- Rationale: T1 short-circuits before dispatch in the normal path; this mirror covers any path that reaches the handler directly (direct invocation in tests, future re-routing). `prompt`-less alert envelopes must never reach `malformed-task` once the contract exists.
- Acceptance: handler given an `ndjsonAlert` envelope emits `pr-triage-telegram-send-failed` (not `malformed-task`) and resolves the file.

### T3 — Add `pr-triage-telegram-send-failed` to `DaemonEvent` union (`telemetry.ts`) — closes D1 typing
- Add the union member from D1, type-strict. Place near the existing `pr-triage-dispatch-failed` member (~`telemetry.ts:368`) with a JSDoc noting it carries both `pr-triage-telegram-send-failed` and `pr-triage-double-failure` alertKinds.

### T4 — Org-gated env allowlist at registration (`main.ts`) — closes Codex H2, per D2
- Implement D2 exactly. Export `CRON_AGENT_ENV_ALLOWLIST`. `claude-pty.ts` untouched.
- Acceptance: when registering an `org: "internal"` cron agent with the three vars present in `process.env`, the `registerAgent` env (→ spawn `opts.env`) carries all three; with `org !== "internal"`, it carries none of them.

### T5 — Case 2 assertion flip (`pr-triage.test.ts:433-435`) — closes Codex H2 test side
- Replace the three `toBeUndefined()` with `toBe(value)` using the fixture vars set in `beforeEach` (`IAGO_TELEGRAM_BOT_TOKEN="test-bot-token"`, `IAGO_TELEGRAM_ALLOWED_USER_IDS="123456,789012"`, `GH_TOKEN="test-gh-token"`). The fixture `agent-config.json` already sets `org: "internal"` so the T4 injection fires.
- Update the GAP comment block (`:414-422`, `:429-432`) to describe the now-correct contract (creds forwarded via the org-gated allowlist), not a pending gap.

### T6 — Case 5 rewrite + delete Case 5b `it.todo` (`pr-triage.test.ts:607-681`) — closes Codex H1 test side + Opus I3
- Rewrite Case 5 to assert the **correct** ndjsonAlert behavior: after the polling tick, file moved to `tasks/resolved/` (not left in pending), `pr-triage-telegram-send-failed { alertKind, details }` emitted, and NO `pr-triage-dispatch-failed`/`malformed-task`. The fixture envelope already carries `ndjsonAlert` + `details`.
- Delete the `it.todo` Case 5b (`:679-681`) — now subsumed.
- Add a **second** `await mgr._pollingTickForTests()` after the first to exercise the `dispatchInFlight` guard / idempotency on the resolved file (covers Opus I3): the second tick must NOT re-emit `pr-triage-telegram-send-failed` or re-resolve (file already moved). Assert exactly one `pr-triage-telegram-send-failed`.

### T7 — Case 4 injectable backoff (`pr-triage.test.ts:547-605` + `main.ts`) — per D3
- Add `backoffMs?` param to `registerCronAgentWithRestart` (default `CRON_AGENT_RESTART_BACKOFF_MS`); thread it into `scheduleRestart`'s delay lookup.
- Case 4's `register()`/inline `registerCronAgentWithRestart` passes a tiny backoff; replace the `CRON_AGENT_RESTART_BACKOFF_MS[0] + 1_500` real wait with a short real wait keyed to the injected value. Real timers throughout; Phase B unchanged. Assert `cron-agent-restarted { attempt: 1 }` + second spawn.

### T8 — Comment fixes (`pr-triage.test.ts`) — Opus I2 + I4
- I2: fix the Phase B ceiling rationale comment (~`:565-567`) to state the actual 2s ceiling math correctly.
- I4: fix the Case 9 internals-contract comment (~`:822-836`) so it accurately describes the per-filename outstanding-set assertions vs. the claim-on-send model.

### T9 — `emitState.real` mockReset race (`pr-triage.test.ts:146-161, 353-357`) — Opus I5
- The `emit` mock's `mockImplementation` (delegating to `emitState.real`) is installed in `beforeEach` after `emitMock.mockReset()`. Harden so a reset can never leave a window where `emit` is a bare mock with no implementation. Either install the implementation inside the `vi.mock` factory at module load, or make the `mockReset`+`mockImplementation` an atomic re-arm. Verify no test observes a dropped telemetry delegation.

## Constraints & process

- **Update PR #84 in place.** Commit to `feat/pr-triage-integration-test`; do NOT create a new branch or new PR. The execute pipeline's PR stage must push to the existing branch (PR #84 already open) rather than `gh pr create` a duplicate.
- **Stress-test first, proceed with notes** (per CEO directive on the env-layer decision). Pipeline stage 0 stress test → `PROCEED_WITH_NOTES` forwarded to impl; do not BLOCK on the D2 layer choice — it is decided.
- **TDD:** T1–T4 are behavior changes — the flipped/rewritten assertions in T5–T7 ARE the regression tests (they fail against pre-change prod, pass after). Run `cd runtime && npx tsc --noEmit && npx vitest run agents/pr-triage/pr-triage.test.ts` plus the affected unit suites (`daemon/agent-manager.test.ts`, `daemon/main.test.ts`, `daemon/telemetry.test.ts`) — the new telemetry kind + the `registerCronAgentWithRestart` signature change may touch those.
- **No `process.env` in `claude-pty.ts`.** The adapter stays pure; all credential composition is daemon-layer.
- Biome formatting via the repo toolchain (tabs).

## Out of scope
- Editing `prompt-template.md` (canonical; the daemon mirrors it).
- A per-agent declared env-allowlist mechanism (YAGNI; hardcoded `CRON_AGENT_ENV_ALLOWLIST` + org gate is sufficient now).
- Live Telegram POST integration (Phase 5 e2e).
- The `pr-triage-double-failure` *producer* path (already in prompt-template); T1/T3 just ensure its `alertKind` flows through the same telemetry kind.

## Finding traceability
- Codex H1 (ndjsonAlert green-lock) → T1, T2, T6
- Codex H2 (env-forward green-lock) → T4, T5
- Opus I2 → T8 · I3 → T6 · I4 → T8 · I5 → T9
- (Opus I1, if distinct from the above, is caught by pipeline review + the post-impl Opus 4.8 adversarial pass.)
