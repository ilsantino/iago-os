# Dual-Aggressive Synthesis & Fix Plan — PR #74

**Date:** 2026-05-20
**Target:** PR #74 SIGHUP handler for live credential reload (branch `wt/plan-06-dispatch`, commit `98ca8b7`)
**Reviewers (independent):**
- Codex GPT-5.5 (`review-mpefvedx-nt6y7p`, 2m58s, verdict `needs-attention` / no-ship)
- Opus 4.7 subagent (verdict `PASS_WITH_CONCERNS`, 21 findings)

---

## Convergence (both reviewers flagged)

| ID | What | Files |
|---|---|---|
| **F1** | `cred-reload-failed.error` carries free-form `err.message` — violates "names-only" telemetry invariant. Future thrower could leak parsed credential bytes via error position context. | `main.ts:335,381`, `telemetry.ts:170-182` |
| **F2** | Shutdown does not drain in-flight SIGHUP. Reverse race: SIGHUP started → SIGTERM arrives → shutdown completes → process exits with telemetry `appendFile` still pending. The existing C1 fix only handles SIGHUPs arriving AFTER shuttingDown is set. | `main.ts:392-393, 598-686` |

## Codex-unique HIGH

| ID | What | Files |
|---|---|---|
| **F3** | Concurrent SIGHUP **drops** trailing reload. `inFlight=true` during the entire await chain → a second SIGHUP arriving after the first read but before telemetry completes is dropped instead of triggering a trailing reload. If credentials rotate in that window the daemon keeps the stale value. | `main.ts:314-322` |
| **F7** | `loadSystemdCredentials` mutates `process.env` one credential at a time. If credential N+1 read fails, env is left with a mixed generation. Partial-success not reflected in telemetry (only `failed` is reported). | `cred-bootstrap.ts:120-147` |
| **F8** | `unchanged` array can claim a credential was "re-read but unchanged" when `loadSystemdCredentials` never actually read it (no-op loader, missing credstore dir, external env override). Test currently blesses this behavior. | `main.ts:349-356`, `sighup.test.ts:183` |

## Opus-unique HIGH

| ID | What | Files |
|---|---|---|
| **F4** | Case 5 (debounce) asserts `>= 1` not `== 1`. Future regression that emits two debounce events for one dropped SIGHUP would pass. | `sighup.test.ts:262-263` |
| **F5** | Case 2 doesn't assert mutual exclusion of `credentialsReloaded` and `unchanged`. A regression breaking the partition (e.g. dropping the `else`) would not be caught by Case 2. | `sighup.test.ts:175-178` |
| **F6** | `envVars` captured at startup. Phase 3 credential additions (the commented entries in cred-bootstrap.ts:92-94) cannot be reloaded via SIGHUP without daemon restart. README implies uncomment-and-deploy works. | `main.ts:707-712` |

## Opus MEDIUM (worth fixing)

| ID | What | Files |
|---|---|---|
| **F9** | Test Case 1 only checks `kind`, not field shape. Mutation reasoning: deleting field arrays from emit would still pass Case 1. | `sighup.test.ts:155` |
| **F10** | Handler swallows synchronous throws from `deps.isShuttingDown()` and `deps.envVars` access. No-throw contract not enforced on the interface. | `main.ts:309-310,328` |
| **F11** | `before` Map captures keys from `deps.envVars`, not `process.env` — consequence of F6, silent under-reporting for un-tracked credentials. | `main.ts:327-358` |
| **F12** | `before` snapshot reads `process.env[k]` in a tight loop; assumes only `loadSystemdCredentials` mutates credential env vars. Not documented as a contract. | `main.ts:327-328` |
| **F13** | Test harness `wrappingEmit` records before awaiting — test passes for wrong reason (state-machine test masquerading as timing test). | `sighup.test.ts:66-71` |

## Opus LOW (deferable but small)

| ID | What | Files |
|---|---|---|
| **F14** | `errors: [...failed]` spread could duplicate if cred-bootstrap.ts ever pushes the same name twice. | `main.ts:365` |
| **F15** | Document "DO NOT move SIGHUP registration later — gap before this is a daemon-kill window." | `main.ts:702-706` |
| **F16** | `cred-bootstrap-loaded` uses file names, `cred-reload-fired` uses env-var names — semantic mismatch. | `telemetry.ts:138-151 vs 152-169` |
| **F17** | `cred-reload-fired` with all-empty arrays — informational noise. Could emit `cred-reload-noop` instead. | `main.ts:361-366` |

## Informational (no action — confirmation Plan 06 is sound)

Opus I1–I7: TypeScript strict clean, named exports, telemetry-contract holds on implemented paths, concurrency invariant verified, README accurate on dropped-SIGHUP, cred-bootstrap delta backwards-compatible, plan-compliance verified.

---

## Fix tier priority

**Tier 1 — Critical / blocking High (must fix this PR):**
- F1 — Typed error code in `cred-reload-failed` (drop free-form `err.message`)
- F2 — `drainInFlight()` in shutdown sequence
- F3 — Coalesce trailing reload (replace drop semantics with set-pending-and-rerun)

**Tier 2 — High (must fix this PR):**
- F4 — Tighten Case 5 to `== 1` and assert event shape
- F5 — Case 2 mutex assertion
- F6 — `envVars` getter (`() => readonly string[]`)

**Tier 3 — Medium (fix this PR):**
- F7 — `loadSystemdCredentials` returns `{ read, failed }`; handler uses `read` for `unchanged` set
- F8 — Subsumed by F7 (correctness of `unchanged` flows from the `read` set)
- F9 — Field-shape assertion on Case 1
- F10 — try/catch around pre-`inFlight` deps access + no-throw JSDoc
- F11 — Subsumed by F6
- F12 — Contract comment on `process.env` co-mutation
- F13 — Comment on `wrappingEmit` recorder-before-await intent

**Tier 4 — Low (fix this PR for completeness):**
- F14 — Dedupe `failed` at emit site
- F15 — DO-NOT-MOVE comment on SIGHUP registration
- F16 — Schema-note comment on file-vs-envvar naming axes

**Defer (out of scope for this PR — document only):**
- F17 — Suppress noop emit (operationally subjective; document for Phase 3 consideration)

---

## Implementation guidance per fix

### F1 (telemetry value-leak prohibition)

Replace `error: err instanceof Error ? err.message : String(err)` with:
```ts
const errInfo = err instanceof Error
  ? { errorCode: (err as NodeJS.ErrnoException).code ?? err.constructor.name }
  : { errorCode: "unknown" };
await deps.emit({ kind: "cred-reload-failed", ...errInfo });
```
Update `CredReloadFailedEvent` in telemetry.ts: drop `error: string`, add `errorCode: string`. Update README to reflect.

Add `// SECURITY: do not include value bytes` comment at both emit site (main.ts:334) AND the telemetry event-type docblock (telemetry.ts:170-182).

### F2 (drain in-flight SIGHUP at shutdown)

In `registerSighupHandler`:
- Track `let activeReload: Promise<void> | null = null`
- In handler: `activeReload = (async () => { ... })(); await activeReload; activeReload = null;`
- Return `{ removeListener, drainInFlight: () => activeReload ?? Promise.resolve() }`

In `shutdown()` (main.ts:578-602):
- After setting `shuttingDown = true`, before stage timeouts, call `await withTimeout("sighup.drain", sighupRegistration.drainInFlight(), stageTimeoutMs)`. Wrap in try/catch — if drain times out, log and continue (don't block shutdown indefinitely).

Document the bounded wait in README.

### F3 (coalesce trailing reload)

In handler, replace drop-and-return with set-pending:
```ts
if (inFlight) {
  reloadPending = true;
  await deps.emit({ kind: "cred-reload-coalesced" });
  return;
}
inFlight = true;
try {
  do {
    reloadPending = false;
    // ... existing reload logic ...
  } while (reloadPending);
} finally {
  inFlight = false;
}
```

Update event-type union: drop `cred-reload-debounced`, add `cred-reload-coalesced`. Update README + tests accordingly. Test Case 5 becomes: "second SIGHUP during in-flight reload triggers exactly one trailing reload (no extra drops)."

Alternative if Santiago prefers drop semantics: keep drop, but document explicitly that operator must wait for one reload to complete before sending the next during rotation. **Picking coalesce per Codex recommendation — safer under active rotation.**

### F4 (tighten Case 5)

```ts
expect(kinds.filter((k) => k === "cred-reload-coalesced").length).toBe(1);
expect(kinds.filter((k) => k === "cred-reload-fired").length).toBe(2); // first + trailing
```

### F5 (mutex assertion Case 2)

After `expect(fired.credentialsReloaded).toContain("IAGO_TELEGRAM_BOT_TOKEN")`:
```ts
expect(fired.unchanged).not.toContain("IAGO_TELEGRAM_BOT_TOKEN");
```

### F6 (envVars getter)

Change `SighupHandlerDeps.envVars: readonly string[]` to `envVars: () => readonly string[]`. Caller passes `() => getCredentialEnvVars()`. Handler calls `deps.envVars()` at the top of each invocation.

### F7 (loadSystemdCredentials returns `{ read, failed }`)

Update return type in cred-bootstrap.ts:
```ts
export function loadSystemdCredentials(): { read: readonly string[]; failed: readonly string[] } {
  const read: string[] = [];
  const failed: string[] = [];
  for (const entry of CREDENTIALS) {
    try {
      const value = fs.readFileSync(filePath, "utf8");
      process.env[entry.envVar] = value;
      read.push(entry.envVar);
    } catch (err) {
      failed.push(entry.envVar);
    }
  }
  return { read, failed };
}
```

In SIGHUP handler, build `unchanged` from intersection of `read` and (before == after):
```ts
const { read, failed } = deps.loadCredentials();
const credentialsReloaded: string[] = [];
const unchanged: string[] = [];
for (const k of read) {
  const beforeVal = before.get(k);
  const afterVal = process.env[k];
  if (beforeVal !== afterVal && afterVal !== undefined && afterVal.length > 0) {
    credentialsReloaded.push(k);
  } else if (afterVal !== undefined && afterVal.length > 0) {
    unchanged.push(k);
  }
}
```

Update Case 3 test to use a loader that returns the right `read` set.

### F9 (Case 1 field shape)

```ts
expect(fired.kind).toBe("cred-reload-fired");
expect(fired.credentialsReloaded).toEqual([]);
expect(fired.unchanged).toEqual([]);
expect(fired.errors).toEqual([]);
```

### F10 (no-throw contract)

Add JSDoc to `SighupHandlerDeps`: "All function members are no-throw. Synchronous throws are not caught and will surface as unhandled rejections." OR wrap handler body in outer try/catch that emits `cred-reload-failed` for any pre-`inFlight` throw.

Picking JSDoc — outer try/catch obscures the no-throw contract and adds a swallowed-error path.

### F12 (env mutation contract)

Add comment to main.ts:327-328:
```ts
// CONTRACT: credential env vars (entries in CREDENTIALS) MUST only be mutated by
// loadSystemdCredentials. Co-mutators from other modules break the diff contract.
for (const k of deps.envVars()) { before.set(k, process.env[k]); }
```

### F13 (wrappingEmit clarification)

Add comment to `wrappingEmit` (sighup.test.ts:66-71):
```ts
// Records the event BEFORE awaiting opts.emit so assertions on event order
// see records in handler-emission order, not in I/O-completion order.
// For integration tests covering real telemetry.ts persistence, use the
// production emit() instead.
```

### F14 (dedupe failed at emit)

```ts
errors: [...new Set(failed)],
```

### F15 (DO-NOT-MOVE comment on SIGHUP registration)

At main.ts:702 (line where `registerSighupHandler` is called):
```ts
// DO NOT move this registration any later in startDaemon — the window between
// loadSystemdCredentials() (line ~409) and this call has Node's default SIGHUP
// behavior (terminate). Lengthening that window introduces a daemon-kill race.
```

### F16 (schema-note comment)

At telemetry.ts:152-169 (cred-reload-fired):
```ts
// SCHEMA NOTE: credentialsReloaded carries env-var names (IAGO_TELEGRAM_BOT_TOKEN, ...).
// The companion `cred-bootstrap-loaded` event (line 138) carries credstore file names
// (iago-telegram-token). Use envVarToFileName() in cred-bootstrap.ts to map between them.
```

---

## Acceptance gate (post-fix)

1. `cd runtime && npx tsc --noEmit` exit 0
2. `cd runtime && npx vitest run daemon/sighup.test.ts` — all tests pass, count ≥ 7 (original 6 + new coalesce test)
3. `grep -n "err.message" runtime/daemon/main.ts | grep cred-reload` returns nothing
4. `grep -n "drainInFlight" runtime/daemon/main.ts runtime/daemon/README.md` returns matches in both
5. README updated for: coalesce semantics (drop F3), drainInFlight at shutdown (F2), Phase 3 credential-addition workflow with `getCredentialEnvVars()` (F6), DO-NOT-MOVE comment (F15)
6. New test cases (in addition to existing 6):
   - Coalesce: 2 SIGHUPs in flight → 1 trailing reload, 1 coalesced event, 2 fired events
   - Drain on shutdown: in-flight SIGHUP completes (or times out) before `daemon-stop` emit
7. No `as` casts introduced (existing `(err as NodeJS.ErrnoException).code` is the one acceptable Node ErrnoException pattern)
