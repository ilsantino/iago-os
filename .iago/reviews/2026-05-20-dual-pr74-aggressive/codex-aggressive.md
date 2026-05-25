# Codex Adversarial Review

Target: branch diff against origin/main
Verdict: needs-attention

No-ship: the reload path can leak exception text into telemetry, lose the latest reload under back-to-back SIGHUPs, report false verification data, and commit partial credential sets.

Findings:
- [high] Failed reload telemetry violates the names-only credential invariant (runtime/daemon/main.ts:335-337)
  The catch paths serialize arbitrary exception text into `cred-reload-failed.error`. That is not names-only: if `loadCredentials` or a future credential reader throws an error containing a token, the value is written to telemetry. The PR explicitly promises credential values never enter telemetry, including failure paths, but these paths are not constrained to env-var names or stable error codes.
  Recommendation: Remove free-form error text from credential-reload telemetry. Emit only a fixed failure code plus sanitized env-var/file names, and keep detailed exception text out of telemetry.
- [high] Concurrent SIGHUP drops the trailing reload, so the latest rotation can be missed (runtime/daemon/main.ts:314-322)
  When `inFlight` is true, the handler emits `cred-reload-debounced` and returns. Because `inFlight` remains true while telemetry is awaited, a second SIGHUP sent after the first file read but before the first telemetry write completes is discarded instead of causing a trailing reload. If credentials rotate in that window, the daemon keeps the stale value until an operator notices and sends another SIGHUP.
  Recommendation: Coalesce to a pending reload instead of dropping: set a `reloadPending` flag and, in `finally`, immediately run one more reload if any SIGHUP arrived during the in-flight operation. Add a test where the file changes between the first read and the second signal.
- [medium] Credential reload is not atomic across the credential set (runtime/daemon/cred-bootstrap.ts:120-147)
  `loadSystemdCredentials` mutates `process.env` one credential at a time as files are read. If one credential is updated and a later credential read fails, the daemon is left with a mixed generation of credentials while telemetry only reports the later env var in `errors`. Under rotation, that can produce inconsistent auth state that is hard to reason about or roll back.
  Recommendation: Stage all credential reads first, then commit the new values only after the scan completes successfully for the intended set, or explicitly model per-credential partial success with rollback/old-value telemetry.
- [medium] `unchanged` telemetry can claim a credential was re-read when no read happened (runtime/daemon/main.ts:349-356)
  The handler classifies any existing env var with the same before/after value as `unchanged`, regardless of whether `loadCredentials` actually read that credential. A no-op loader, missing credstore directory, missing file, or external env override can all be reported as re-read unchanged. The test at `sighup.test.ts:183` blesses this by using a no-op loader and expecting `unchanged` entries, so it would pass even if the reload never touched the credstore.
  Recommendation: Have `loadSystemdCredentials` return structured `read`, `changed`, and `failed` env-var names, and build `unchanged` only from credentials actually read. Change the no-op test to assert no `unchanged` entries.
- [medium] Shutdown does not account for an in-flight reload before daemon-stop (runtime/daemon/main.ts:392-393)
  The signal listener fires the async handler with `void handler()`, so `shutdown()` has no promise to await or cancel. If SIGTERM arrives while a SIGHUP reload is awaiting telemetry, shutdown can emit `daemon-stop`, remove listeners, resolve `shutdownPromise`, and still allow the in-flight reload handler to emit/log afterward. That breaks shutdown sequencing and makes telemetry ordering unreliable during concurrent SIGHUP+SIGTERM.
  Recommendation: Track the active reload promise in the registration, remove the SIGHUP listener at the start of shutdown, and await or timeout the active reload before emitting `daemon-stop`.

Next steps:
- Block PR #74 until reload telemetry is sanitized, SIGHUP coalescing is changed from drop to trailing reload, and file-backed rotation tests cover the real credstore path.

Codex session ID: 019e46cd-ee2c-7412-a7c8-65edc22a06a5
Resume in Codex: codex resume 019e46cd-ee2c-7412-a7c8-65edc22a06a5
(node:3124) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
(Use `node --trace-deprecation ...` to show where the warning was created)
