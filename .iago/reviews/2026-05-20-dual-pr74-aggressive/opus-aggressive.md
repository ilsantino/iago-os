# Opus 4.7 Aggressive Adversarial — PR #74

**Reviewer:** Opus 4.7 subagent (independent of Codex GPT-5.5 half of dual review)
**Date:** 2026-05-20
**Target:** PR #74 SIGHUP handler for live credential reload
**Branch:** wt/plan-06-dispatch (commit 98ca8b7)
**Status:** COMPLETE

## Scope examined
- [x] runtime/daemon/main.ts (full read, 899 lines)
- [x] runtime/daemon/sighup.test.ts (full read, 384 lines)
- [x] runtime/daemon/README.md (full read, including SIGHUP section)
- [x] runtime/daemon/cred-bootstrap.ts (full read + diff delta)
- [x] runtime/daemon/telemetry.ts (full read + diff delta)
- [x] pr74-diff.patch (line-level cross-reference)

## Findings

### Critical

No findings rise to Critical. No data loss vector, no auth bypass, no secret leakage on the implemented paths, no crash mode, no rollback breakage. The handler's failure posture (catch + log + continue) is conservative; telemetry contract carries names only on the implemented paths; shutdown-race guard works as documented.

### High

- **H1 — Shutdown leaves in-flight SIGHUP handler unbounded** — `runtime/daemon/main.ts:598-686` — A SIGHUP handler that has already passed the `isShuttingDown()` guard at line 310 can still be mid-await when `shutdown()` runs to completion, exits the stages, and resolves `shutdownPromise`. The handler is never cancelled and the daemon process exits while `cred-reload-fired` is still queued in the `emit()` awaitable.
  **Detail:** Sequence — (a) SIGHUP arrives at T=0, handler enters, sees `shuttingDown=false`, sets `inFlight=true`, calls `loadCredentials()` synchronously. (b) SIGTERM arrives at T=1ms; `shutdown()` sets `shuttingDown=true` and proceeds through stages. (c) The in-flight SIGHUP handler reaches `await deps.emit({kind:"cred-reload-fired",...})` and is suspended on an `fsp.appendFile` write. (d) `shutdown()` completes all stages, removes the SIGHUP listener, emits `daemon-stop`, resolves `shutdownPromise`. (e) `main()` returns. Node exits the event loop with the pending appendFile possibly unflushed. The operator does `journalctl | grep cred-reload-fired` and sees nothing — silently lost telemetry of a successful credential rotation right before shutdown. The C1 fix only handles SIGHUPs arriving AFTER `shuttingDown` is set; it does not handle the in-flight reverse race.
  **Suggested fix:** Track in-flight handler promise: store `inFlightHandler: Promise<void> | null` in the closure. The `registerSighupHandler` returns a `drainInFlight: () => Promise<void>` helper alongside `removeListener`. `shutdown()` awaits `drainInFlight()` (bounded by `withTimeout("sighup.drain", ..., stageTimeoutMs)`) between setting `shuttingDown=true` and proceeding to stage timeouts. Document the bounded wait in README.

- **H2 — Test case 5 (debounce) asserts `>= 1` instead of `== 1` on cred-reload-debounced count** — `runtime/daemon/sighup.test.ts:262-263` — The assertion `expect(kinds.filter((k) => k === "cred-reload-debounced").length).toBeGreaterThanOrEqual(1)` is too loose. Only one extra SIGHUP fires; exactly one debounce event is correct. Using `>= 1` lets a future regression that emits two debounce events for one dropped SIGHUP pass undetected.
  **Detail:** The case is the only test that validates the debounce contract. The plan's stress-test directly asked whether the second SIGHUP is "dropped" — the test prove "at least one" debounced event, not "exactly one." A bug that double-emits on the inFlight branch (e.g., a future maintainer adds a retry loop) would not regress this test. The author's review M1 fix added strict `toEqual` for the `errors` array; this case should mirror the strictness.
  **Suggested fix:** Change to `expect(kinds.filter((k) => k === "cred-reload-debounced").length).toBe(1)`. Also assert the SHAPE of the debounced event (no extra fields leaked).

- **H3 — Mutation gap on diff partitioning (else-if exclusivity)** — `runtime/daemon/sighup.test.ts:182-202,162-180` — Cases 2 and 3 use `toContain` on `credentialsReloaded` and `unchanged` independently, but never assert mutual exclusion. A regression that drops the `else` in `main.ts:351-357` (so a changed var ends up in BOTH arrays) would still pass these tests.
  **Detail:** Mutation reasoning — if I rewrite `} else if (afterVal !== undefined && afterVal.length > 0) {` to a bare `if (...)` (no `else`), every changed var would appear in `credentialsReloaded` AND, since `beforeVal !== afterVal` is true, NOT in `unchanged` because the test compares `beforeVal !== afterVal`. Wait — re-checking: if `beforeVal !== afterVal` is true and we entered the first `if`, the second `if` evaluates `afterVal !== undefined && afterVal.length > 0`, which is independent. If `afterVal` is non-empty, the var lands in BOTH arrays. Case 2's only assertion on `unchanged` is implicit through `errors.toEqual([])`. Case 3 asserts `credentialsReloaded.toEqual([])` AND `unchanged.toContain(...)`. So Case 3 does catch the bug (because `credentialsReloaded` would no longer be empty). But Case 2 does NOT — it never asserts `unchanged` does not contain `IAGO_TELEGRAM_BOT_TOKEN`. A reviewer who only ran Case 2 would think the partition holds.
  **Suggested fix:** Add `expect(fired.unchanged).not.toContain("IAGO_TELEGRAM_BOT_TOKEN")` in Case 2 (lines 175-178). Mirrors the explicit exclusivity check Review M1 added for `errors`.

- **H4 — `cred-reload-failed.error` is a free-form string with no documented value-leak prohibition for future maintainers** — `runtime/daemon/main.ts:335,381` and `runtime/daemon/telemetry.ts:170-182` — The `error: string` field on the `cred-reload-failed` event takes `err.message` straight from any thrown `Error`. Today `loadSystemdCredentials` only throws `fs.readFileSync` errors whose messages contain a path (`ENOENT: no such file or directory, open '/run/credentials/.../iago-telegram-token'`) — leaks deployment topology but not credential bytes. A future maintainer adding JSON-format credstore files (or any parsed credential) could leak partial credential bytes through `JSON.parse`'s error position context or a custom `new Error(\`Invalid token: ${raw}\`)`.
  **Detail:** Telemetry comment at telemetry.ts:170-182 says "NEVER carries credential values" but the code does no scrubbing. The contract relies on every future thrower being aware. The README's "Names only in telemetry" section (lines 378-381) makes a stronger guarantee than the type system enforces. This is a TypeScript surface that begs for either (a) a redact step before emitting, or (b) a sentinel error-code enum rather than free-form `message`.
  **Suggested fix:** Either (a) intercept at `main.ts:334-336` — replace `err.message` with `err instanceof Error ? err.constructor.name : "unknown"` plus `code: (err as NodeJS.ErrnoException).code` so the telemetry carries a typed error code without the message; or (b) sanitize known credstore-path patterns before emit. At minimum, add a `// SECURITY:` comment at lines 334-336 of main.ts AND telemetry.ts:170-182 stating "do not include parsed value bytes in thrown error messages from loadCredentials" so the contract is loud at every author site.

### Medium

- **M1 — Static envVars closure cannot pick up Phase 3 credential additions without daemon restart** — `runtime/daemon/main.ts:707-712` — `registerSighupHandler` captures `envVars: getCredentialEnvVars()` at startup. Phase 3 plan uncomments three Anthropic-profile entries in `cred-bootstrap.ts:92-94`. Even after the source is uncommented and deployed, SIGHUP reloads will NOT detect changes to those env vars because the handler's `envVars` list was frozen at last daemon start.
  **Detail:** This forces a `systemctl restart` after every CREDENTIALS array edit, defeating the entire "no restart for rotation" promise for the new credentials' first reload. The reload mechanism is fine for ROTATION of already-tracked credentials but not for ADDITION of new ones. Documentation (README:340-342) implies adding Phase 3 entries is just an uncomment-and-deploy, glossing over the restart requirement.
  **Suggested fix:** Either (a) change `envVars` from a captured array to a getter `() => readonly string[]` so the handler re-reads on every fire; or (b) document explicitly in README that adding entries to CREDENTIALS requires a daemon restart, even when SIGHUP reload is available. Option (a) is one extra line of code and avoids a deployment-time footgun.

- **M2 — `before` snapshot reads `process.env[k]` in a tight loop and is not atomic across env mutations** — `runtime/daemon/main.ts:327-328` — The before-snapshot is built by iterating `deps.envVars` and reading `process.env[k]`. If external code mutates `process.env` between the loop iteration and the `loadCredentials()` call, the diff result is wrong.
  **Detail:** Concretely: in Node.js the daemon process may have other modules (e.g., a config-reload IPC handler) that mutate `process.env`. The handler does not guard against this. The risk surface is small in practice (no other module currently writes to credential env vars), but the contract "credentialsReloaded carries names that changed across the reload" silently breaks if some other mutation interleaves. Documentation does not warn against this.
  **Suggested fix:** None required for current code (single-threaded V8, no other env mutators), but add a comment to lines 327-328 stating the assumption: "credential env vars MUST only be mutated by loadSystemdCredentials; co-mutators break the diff contract."

- **M3 — Test harness records emitted event BEFORE awaiting `opts.emit`** — `runtime/daemon/sighup.test.ts:66-71` — The `wrappingEmit` pushes to `emittedEvents` immediately, then awaits the caller-supplied `opts.emit`. In Case 5 (debounce test), this means `emittedEvents` has the `cred-reload-fired` entry BEFORE the production code's `await deps.emit(...)` has returned. The test passes for the wrong reason: it asserts on a side-effect that happened in the test harness, not in production code.
  **Detail:** In real production code, `emit()` (telemetry.ts:368-388) does `await fsp.appendFile(...)`. If the appendFile rejects, the telemetry record is NOT persisted, but `emittedEvents` in the test harness would still show the record. The test wraps production's `deps.emit` parameter — it does NOT exercise production's actual `emit()`. This is acceptable for unit-test scope but the test name "drops a second SIGHUP arriving while the first is in flight" implies a real timing test, when it's actually a state-machine test with no real I/O.
  **Suggested fix:** Add a comment to `wrappingEmit` explaining the recorder-before-await intent. Optionally split into two harnesses: `wrappingEmit` (recorder-first, for assertion order) and `actualEmit` (production telemetry.ts, for integration-test coverage).

- **M4 — Handler swallows synchronous throws from `deps.isShuttingDown` and `deps.envVars` access** — `runtime/daemon/main.ts:309-310,328` — The handler is `async`, so a synchronous throw from `deps.isShuttingDown()` (a user-supplied function) becomes a rejected promise. The outer `void handler()` at line 393 discards the rejection. No `process.on("unhandledRejection")` handler is installed by this PR.
  **Detail:** In production, `isShuttingDown` is `() => shuttingDown` (line 711) which cannot throw. But the interface `SighupHandlerDeps` admits any `() => boolean` and the contract is not loud about no-throw. A future caller wiring SIGHUP to a different shutdown-flag source (e.g., a debounced async predicate) would silently lose errors. Plus tests don't cover this path.
  **Suggested fix:** Wrap the body in a try/catch around all of `deps.isShuttingDown()`, `deps.envVars` access, and any pre-`inFlight` operations. Or add a `// no-throw contract` JSDoc to `isShuttingDown` and `envVars` in the `SighupHandlerDeps` interface.

- **M5 — `before` Map captures keys from `deps.envVars`, not from `process.env`** — `runtime/daemon/main.ts:327-358` — If `deps.envVars` returns a stale list (M1 scenario), a credential present in `process.env` but not in `deps.envVars` is invisible to the diff. The reload could correctly populate `process.env.IAGO_ANTHROPIC_DEFAULT_TOKEN`, but the `cred-reload-fired` event would have empty `credentialsReloaded` and `unchanged` for it, because the loop only iterates `deps.envVars`.
  **Detail:** This is the consequence of M1. Operationally, the daemon-running operator who SIGHUPs after rotating a brand-new credential gets a `cred-reload-fired` with empty arrays and concludes "nothing happened." They don't see a failure event either — silent under-reporting.
  **Suggested fix:** Same as M1.

- **M6 — Test case 1 assertion `.kind).toBe("cred-reload-fired")` only checks the kind, not field shape** — `runtime/daemon/sighup.test.ts:155` — The happy-path test never verifies that `credentialsReloaded`, `unchanged`, and `errors` are all present and are arrays. A regression that emits `{ kind: "cred-reload-fired" }` with no fields would pass Case 1.
  **Detail:** TypeScript catches this at compile time on the production side, but the test as written is a kind-only smoke. Mutation reasoning: if I delete the `credentialsReloaded`, `unchanged`, `errors` fields from the emit() call (and silence the resulting tsc error), Case 1 still passes — Case 2 catches the credentialsReloaded loss, Case 3 catches the unchanged loss, but the case-1 smoke is misleadingly thin.
  **Suggested fix:** Add field-shape assertions to Case 1: `expect(fired.credentialsReloaded).toEqual([])`, `expect(fired.unchanged).toEqual([])`, `expect(fired.errors).toEqual([])`.

### Low

- **L1 — `emit({ kind: "cred-reload-fired", ..., errors: [...failed] })` spread may copy duplicates if `failed` has them** — `runtime/daemon/main.ts:365` — `loadSystemdCredentials` does not dedupe its `failed` array. If a maintenance change to cred-bootstrap.ts ever causes the same envVar to be pushed twice (e.g., a refactor of the catch block), the telemetry `errors` would have duplicates.
  **Detail:** Current cred-bootstrap.ts pushes once per `entry` and `continue`s, so the invariant holds. The pattern is fragile.
  **Suggested fix:** `errors: [...new Set(failed)]` at the emit site, or document the no-duplicate invariant at the cred-bootstrap.ts:115 docstring.

- **L2 — README "SIGHUP during daemon startup" failure mode is documented but not tested** — `runtime/daemon/README.md:432-441` — The README acknowledges that SIGHUP arriving in the sub-second window before handler installation kills the daemon (Node default action). No regression test guards this — a future refactor that moves handler installation later would lengthen the window without warning.
  **Detail:** Acceptable as a known gap (the operator-workflow note says "wait for active (running) before SIGHUP"), but the contract is fragile.
  **Suggested fix:** Add a comment to main.ts:702-706 explicitly stating "DO NOT move the SIGHUP registration any later — the gap before this point is a daemon-kill window."

- **L3 — `cred-bootstrap-loaded` event uses FILE NAMES while `cred-reload-fired` uses ENV-VAR NAMES — semantic mismatch** — `runtime/daemon/telemetry.ts:138-151 vs 152-169` — The pre-existing `cred-bootstrap-loaded.credentialsLoaded` carries credstore file names (`["iago-telegram-token"]`). The new `cred-reload-fired.credentialsReloaded` carries env-var names (`["IAGO_TELEGRAM_BOT_TOKEN"]`). Operators querying both events for "what credentials moved" need to mentally translate one to the other.
  **Detail:** Documentation in README is correct about each individually but does not flag the mismatch. The author chose differently for `cred-reload-fired` likely because `loadSystemdCredentials` doesn't return the touched filenames (only success/fail). The reload event could carry both `envVars` and `fileNames` for parity. Not a bug; a polish opportunity.
  **Suggested fix:** Either (a) add a `fileNames: string[]` field to `cred-reload-fired` by mapping via `envVarToFileName`, OR (b) add a `// SCHEMA NOTE:` comment on both event types pointing out the naming-axis difference.

- **L4 — `cred-reload-fired` is emitted with all-empty arrays when SIGHUP fires but no env vars are set** — `runtime/daemon/main.ts:361-366,sighup.test.ts:340-357` — The "does NOT list env vars that were unset before and after" test confirms the handler emits an empty event in this case. This is informational noise in the journal — an operator sending SIGHUP on a fresh daemon with no provisioned credentials gets a misleading "fired" record.
  **Detail:** Could be suppressed (no emit if all three arrays empty AND no envVars were inspected), but doing so reduces observability of "SIGHUP was received." Acceptable trade-off as designed.
  **Suggested fix:** None. Flag for future Phase 3 consideration: emit `cred-reload-noop` if all arrays empty, to make journal greps for "real" reloads tighter.

### Informational

- **I1 — TypeScript-strict compliance verified.** No `any`, no `as` casts (except the `(err as { code?: string }).code` in cred-bootstrap.ts:127 which is a deliberate Node.js ErrnoException type-guard — acceptable per CLAUDE.md), no `@ts-ignore` in the diff. The `as const` at sighup.test.ts:34 and 366 is on literal tuples, not type assertions — clean.

- **I2 — Named exports only.** Confirmed via diff inspection. `registerSighupHandler`, `SighupHandlerDeps`, `SighupHandlerRegistration` all named.

- **I3 — Telemetry contract holds for the implemented cred-reload-* paths.** `cred-reload-fired` carries env-var name string arrays. `cred-reload-debounced` carries no payload. `cred-reload-failed.error` is a string (see H4 for forward-leak risk). No `process.env[name]` value is reachable from any of these emits.

- **I4 — Concurrency invariant: `inFlight=true` is set BEFORE the first await, and `inFlight=false` is in `finally`.** Drop-vs-queue debounce works as documented. Verified by code reading at main.ts:325 (set), 387-389 (clear in finally), and the `try { ... return; }` early-exit at line 343 (finally still runs, confirmed by Node semantics).

- **I5 — README `cred-reload-debounced` documentation correctly says "the second is dropped".** Behavior matches code: line 314-323 returns BEFORE setting `inFlight=true`, so the second handler invocation does NOT enter the production path; only the debounced emit happens. Test case 5 confirms `loadCredentials` is NOT called a second time on the dropped SIGHUP (implicit — `loadCallCount` is not checked in Case 5, but the test sets `inFlight` via the first emit-gate so any second call would have to wait, and the test asserts `cred-reload-fired` count == 1).

- **I6 — cred-bootstrap.ts delta is minimal and backwards-compatible at the call-site.** The return type widened from `void` to `{ failed: readonly string[] }`. Existing call site `startDaemon()` at main.ts:430 ignores the return value (treats as void). New call site at main.ts:332 destructures `result.failed`. Type widening + ignore-return is safe.

- **I7 — Plan-compliance check.** The plan's six mandatory test cases (1-6) are all present at sighup.test.ts:144-293. The C1 shutdown-race fix is implemented at main.ts:309-313 and covered by Case 6. The plan calls for "debounce strategy: drop" — implemented and tested. No plan deviations detected.

## Verdict

PASS_WITH_CONCERNS. Plan 06 ships a correct, documented, well-isolated SIGHUP credential-reload handler with conservative failure posture, clean TypeScript-strict shape, and good test coverage of the documented behavior. The shutdown-race C1 fix is solid for SIGHUPs arriving after `shuttingDown` is set. The HIGH-tier concerns are about the reverse race (H1 — in-flight SIGHUP during shutdown), one weak assertion (H2), one mutation-gap on the partition contract (H3), and the future-leak surface in `cred-reload-failed.error` (H4) — none are blocking the merge, all are tractable in a follow-up plan or as PR #74 fix commits. M1 (static envVars closure not picking up Phase 3 additions) is the most operationally interesting: the README implies "uncomment and deploy" but daemon restart is required. Fix in this PR is one-line if desired; otherwise document loud and defer.

**Status: COMPLETE**

