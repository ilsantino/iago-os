# Adversarial Review — PR #65 (Plan 01b cred-bootstrap + AgentConfig.authProfile)

**Reviewer:** Opus (adversarial)
**Date:** 2026-05-18
**Verdict:** PASS_WITH_CONCERNS

## Scope

- Plan: `.iago/plans/feature-phase-2-vps-bootstrap/01b-cred-bootstrap-and-config-schema.md`
- Files reviewed: `runtime/daemon/cred-bootstrap.ts`, `cred-bootstrap.test.ts`, `config.ts`, `config.test.ts`, `main.ts`, `main.test.ts`, `telemetry.ts`
- Cross-plan: `runtime/deploy/iago-os-v2-daemon.service`, `runtime/deploy/provision-credentials.sh` (01a — merged 20c8348)
- Pipeline Codex fix verified: `lastWrittenByCredstore` reload semantics

## Findings

### Critical
None.

### Important

**I1 — `credentialsLoaded` telemetry diff misses rotation events (latent for Plan 06).**
`runtime/daemon/main.ts:264-280` computes `credentialsLoaded` by diffing env-var keys: `beforeUnset && afterSet`. Works for fresh boot, but on a SIGHUP reload where the env was already set from the prior boot AND the credstore file rotated, both `before` and `after` are non-empty → conditional false → `credentialsLoaded` emits as `[]`. The telemetry event no longer reflects which credentials the helper actually replaced.

- Today: `loadSystemdCredentials()` is called once at `startDaemon()` start, so this never fires in practice — env-before is always unset on cold boot.
- Plan 06 (SIGHUP credential reload): MUST revisit. Either change criterion to `after !== before` (captures rotation), or have the helper return the list of file names it wrote and pass that through.
- Not blocking 01b. Flagged so Plan 06 implementer does not blindly reuse this diff pattern.

**I2 — Coincidental external-value match trap in reload fix.**
`runtime/daemon/cred-bootstrap.ts:94-99`: if `process.env[envVar]` already contains a value equal to the credstore file content AND `lastWrittenByCredstore.get(envVar)` is undefined (helper never wrote this var), the helper treats it as an external override and refuses to track it. Subsequent rotations are then treated as external override and stale value persists forever.

- Concrete trigger: `IAGO_TELEGRAM_BOT_TOKEN=<value>` set via systemd `Environment=` directive that matches the credstore value on first boot. Operator removes `Environment=` later. Helper still sees env=V and skips on every reload.
- Mitigation: gate on "first invocation only" — track *whether the helper has ever been called for this envVar in this process*, not whether it has *written* it. If unseen, accept the file value as ours.
- Edge case; documented contract preserves external overrides "including values set before the first call." Acceptable per spec; flag for reload-contract credibility.

### Minor

**M1 — Sentinel-leak test (case 10) is partially tautological.**
`cred-bootstrap.test.ts:160-207` spies on `telemetry.emit`, `process.stdout.write`, `process.stderr.write` and calls `loadSystemdCredentials()`. The helper today never calls any of those — test asserts a contract on present code, not a behavioral check. The main.ts call site (which DOES call `emit`) is not covered. Acceptable as forward-looking regression guard.

**M2 — TOCTOU window `fs.existsSync` → `fs.readFileSync`.**
`cred-bootstrap.ts:88-90`. If credstore file is unlinked between syscalls, readFileSync throws ENOENT → propagates → daemon fails to boot. Essentially impossible in single-tenant systemd-controlled credstore.

**M3 — No per-credential error isolation.**
`cred-bootstrap.ts:82-104`: a throw from `readFileSync` on ANY credential aborts the entire loop. Today only two active credentials; Phase 3 adds three more. One misconfigured credential takes the daemon down for all. Consider catching `readFileSync` errors per-entry + telemetry event so observability isn't blind. Not blocking; fail-loud-as-intended for Phase 2.

**M4 — `vi.stubEnv("")` + `delete process.env.X` pattern is fragile.**
`cred-bootstrap.test.ts:45-52`. Works today; brittle if vitest changes stub semantics.

## Cross-cutting verification

| Area | Status | Notes |
|------|--------|-------|
| Auth bypass via env-override path manipulation | PASS | Env set by systemd unit (root-only); helper is env→env passthrough, no shell exec, no path traversal. |
| Data loss / value leak | PASS | No disk writes. Telemetry payload carries file names only. Sentinel test (case 10) confirms no stdout/stderr/telemetry value flow. |
| Race conditions (SIGHUP re-entrancy) | PASS | Helper is sync; Node signal handlers are queued. Re-entrant by construction. |
| Rollback safety (partial state on throw) | PASS | Mid-loop throw propagates to `main()` catch → exitCode=1. Partial state never reaches `loadConfig()` within same boot. |
| Stress C1 — `NODE_ENV=test` overrides `runUnder` | PASS | `computeRunUnder()` exported + unit-tested in `main.test.ts:601-672` with 10 cases asserting override beats both `CREDENTIALS_DIRECTORY` and `INVOCATION_ID`. |
| Stress C2 — sentinel leak negative test | PASS (with M1 caveat) | All three buffer assertions present. |
| Codex pipeline fix — `lastWrittenByCredstore` reload semantics | PASS (with I2 caveat) | Tests 11-13 cover rotation replaces, external override survives, post-load mutation treated as override. |
| authProfile JSDoc — `undefined ≡ "default"` equivalence | PASS | `config.ts:38-48` documents equivalence per plan I1. |
| 01a CRED_MAP ↔ 01b CREDENTIALS contract | PASS | Unit file (`iago-os-v2-daemon.service:98-99`) uses `LoadCredentialEncrypted=iago-telegram-token:...` and `LoadCredentialEncrypted=iago-gh-token:...`. Systemd surfaces them as `$CREDENTIALS_DIRECTORY/iago-telegram-token` / `$CREDENTIALS_DIRECTORY/iago-gh-token` — exactly what `cred-bootstrap.ts:58-60` reads. |

## What pipeline + Codex missed

Pipeline found missing C1 verification test (good) and partial tautology of sentinel test (good). Codex found reload-semantics regression (high — fixed correctly).

Both missed:
- **I1** — Diff-based `credentialsLoaded` in main.ts silently emits `[]` on SIGHUP rotation. Codex correctly fixed the helper but did not chase the telemetry call site.
- **I2** — Coincidental external-value match trap. Reload fix tracks "what we last wrote," not "what we've ever been responsible for."

Both are edge cases that don't break Phase 2 deliverables. Both deserve a forward-note for Plan 06.

## Recommendation

Land as-is. Add a one-line comment in `cred-bootstrap.ts` JSDoc and a forward-note in the 01b summary calling out I1/I2 for the Plan 06 SIGHUP implementer. No code changes required to ship 01b.

Verdict: PASS_WITH_CONCERNS
