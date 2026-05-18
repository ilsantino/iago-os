---
phase: feature-phase-2-vps-bootstrap
plan: 01b
wave: 1
depends_on: [01a]
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-18
source: feature
split_from: 01-daemon-deploy-infrastructure
split_rationale: Pre-emptive split per .iago/decisions/2026-05-18-phase-2-split-and-dispatch.md. 01b ships the TypeScript bridge inside the daemon process — cred-bootstrap helper that reads systemd's $CREDENTIALS_DIRECTORY files into process.env, the AgentConfig.authProfile schema field for Phase 3 adapter resolution, and the startDaemon wire-up (Tasks 4, 5, 6, 7 of original 01). 01a ships the deploy-side artifacts (unit + provision + tests + README) that produce the credstore files this plan reads.
---

# Plan: feature-phase-2-vps-bootstrap/01b-cred-bootstrap-and-config-schema

## Goal

Ship the TypeScript bridge inside the daemon process that consumes the systemd credentials provisioned by 01a, plus the schema slot for Phase 3's per-agent Anthropic profile resolution. Four deliverables — all are TypeScript changes inside `runtime/daemon/`: (1) `cred-bootstrap.ts` — helper that reads `$CREDENTIALS_DIRECTORY/<name>` files (provisioned by 01a's `provision-credentials.sh`) into `process.env[<VAR>]` before `loadConfig()` runs; (2) `cred-bootstrap.test.ts` — Vitest unit tests covering every branch including a mandatory credential-value-leak negative test; (3) `runtime/daemon/config.ts` extension adding `authProfile?: "default" | "ilsantino" | "iaguito"` field to `AgentConfig` (provisioned in Phase 2, activated in Phase 3 per CONTEXT.md constraint) + tests; (4) `runtime/daemon/main.ts` wiring — invoke `loadSystemdCredentials()` as the FIRST statement in `startDaemon()` BEFORE any config or state-dir setup, plus telemetry extension (`daemon-start.runUnder` + `cred-bootstrap-loaded` event). Source of truth: `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` §§ 1, 5. The 01a-shipped deploy artifacts (systemd unit + provision script) produce the credstore files; this plan's helper reads them.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/daemon/cred-bootstrap.ts` | Read `$CREDENTIALS_DIRECTORY/<name>` files → `process.env[<VAR>]` |
| create | `runtime/daemon/cred-bootstrap.test.ts` | Unit tests for cred-bootstrap (≥80% lines + sentinel-leak negative test) |
| edit | `runtime/daemon/config.ts` | Add `authProfile?: "default" \| "ilsantino" \| "iaguito"` field to `AgentConfig` |
| edit | `runtime/daemon/config.test.ts` | Test that `authProfile` round-trips through file + env paths |
| edit | `runtime/daemon/main.ts` | Call `loadSystemdCredentials()` BEFORE `loadConfig()` in `startDaemon`; emit telemetry |

## Tasks

### Task 1: Credential bootstrap helper (TypeScript)

- **files:** `runtime/daemon/cred-bootstrap.ts`
- **action:** Export `loadSystemdCredentials(): void` per spec § 1 "Credential bootstrap helper" verbatim. Imports `fs` and `path` from `node:`. Internal `CredMap` interface with `fileName: string` + `envVar: string`. Module-private `CREDENTIALS: CredMap[]` array with TWO active entries — `{ fileName: "iago-telegram-token", envVar: "IAGO_TELEGRAM_BOT_TOKEN" }` AND `{ fileName: "iago-gh-token", envVar: "GH_TOKEN" }` (gh-token active per Phase 2 pr-triage agent — Plan 04b Task 2 verifies this entry exists) — and three commented-out Phase 3 entries (`iago-anthropic-default` → `IAGO_ANTHROPIC_DEFAULT_TOKEN`, plus ilsantino + iaguito). Function body: read `process.env.CREDENTIALS_DIRECTORY`; if undefined or empty, return early (local-dev no-op). Iterate `CREDENTIALS`; for each: `credPath = path.join(dir, fileName)`; if `!fs.existsSync(credPath)` continue; read file as utf8, trim; if empty continue; if `process.env[envVar]` already defined AND length > 0, continue (env-var override beats credential); set `process.env[envVar] = value`. Add JSDoc explaining: runs BEFORE `loadConfig`, local-dev path is no-op, env-var override path lets Santiago set `IAGO_TELEGRAM_BOT_TOKEN=` directly for unit-test runs. **Credential value handling contract (C2 carry-over):** the function NEVER logs the value to console.log, console.error, or any telemetry payload. The value bytes flow from disk to process.env with no intermediate observable; Task 2 test case 10 enforces this with a sentinel-value grep. Strict-mode TS — no `any`, no `as` casts.
- **verify:** `cd runtime && npx tsc --noEmit && grep -E "^export (function|const)" daemon/cred-bootstrap.ts && grep -E 'fileName:\s*"iago-gh-token"' daemon/cred-bootstrap.ts`
- **expected:** `tsc --noEmit` exits 0. `loadSystemdCredentials` exported. The gh-token CREDENTIALS entry present (one match — Plan 04b Task 2 will re-verify this surface).

### Task 2: cred-bootstrap unit tests

- **files:** `runtime/daemon/cred-bootstrap.test.ts`
- **action:** Vitest tests covering all branches of `loadSystemdCredentials()`. Use `vi.stubGlobal` / `vi.stubEnv` to control `process.env`; use `vi.mock("node:fs", ...)` for filesystem control. Test cases: (1) `CREDENTIALS_DIRECTORY` undefined → no-op (verify no env writes occurred — capture initial keys, assert unchanged); (2) `CREDENTIALS_DIRECTORY` set to empty string → no-op; (3) `CREDENTIALS_DIRECTORY` set + `iago-telegram-token` file present with value `"1234567890:ABCDEFG"` → `process.env.IAGO_TELEGRAM_BOT_TOKEN === "1234567890:ABCDEFG"`; (4) file present but contents have trailing newline → trimmed correctly; (5) file present but empty (zero bytes) → env NOT set; (6) file present but `process.env.IAGO_TELEGRAM_BOT_TOKEN` already set to `"override"` → env unchanged (override path wins); (7) file present but env already set to empty string `""` → file value IS loaded (empty string treated as not-set per spec: `process.env[envVar] !== undefined && process.env[envVar]!.length > 0`); (8) `CREDENTIALS_DIRECTORY` set but credential file missing → no-op for that entry, no throw; (9) `CREDENTIALS_DIRECTORY` set + `iago-gh-token` file present with value `"ghp_AAAtestBBB"` → `process.env.GH_TOKEN === "ghp_AAAtestBBB"`; (10) **MANDATORY — credential value leak negative test (Codex P1-4 / C2 carry-over):** seed a unique sentinel token value `"sentinel_must_not_leak_AAA"` as the file contents for `iago-telegram-token`; install a test spy on the telemetry event emitter (capture ALL emitted event payloads to a buffer), spy on `process.stdout.write` (capture all bytes written to stdout), spy on `process.stderr.write` (capture all bytes written to stderr); call `loadSystemdCredentials()`; assertion: ZERO occurrences of the literal sentinel string in ANY of the three captured buffers (telemetry payloads, stdout, stderr). This guards against accidental token logging in any future implementation change. Coverage ≥80% lines on `cred-bootstrap.ts`.
- **verify:** `cd runtime && npx vitest run daemon/cred-bootstrap.test.ts --coverage --reporter=verbose 2>&1 | tail -25`
- **expected:** All 10 tests pass (including the sentinel-leak negative test). Coverage table shows `cred-bootstrap.ts` ≥80% lines, ≥80% branches.

### Task 3: Extend AgentConfig with authProfile field

- **files:** `runtime/daemon/config.ts`, `runtime/daemon/config.test.ts`
- **action:** Edit existing `AgentConfig` interface in `config.ts` to add `readonly authProfile?: "default" | "ilsantino" | "iaguito";` field (optional, narrow union per spec § 5). Update `loadConfig()` parsing to accept `authProfile` from JSON config file (pass-through; no env-var override since per-agent setting); validate that if present it's one of the three allowed strings (use a narrow type guard, NOT `as` cast — throw `RangeError(`unknown authProfile: ${value}; expected default|ilsantino|iaguito\``)` on invalid). Tests added to `config.test.ts`: (9) AgentConfig without `authProfile` parses fine, field is undefined; (10) AgentConfig with `authProfile: "default"` parses correctly; (11) AgentConfig with `authProfile: "ilsantino"` parses; (12) AgentConfig with `authProfile: "iaguito"` parses; (13) AgentConfig with `authProfile: "unknown"` throws `RangeError` mentioning the invalid value AND the allowed set. Do NOT yet wire the field to claude-pty adapter (Phase 3 work per spec § 5 explicit deferral) — this plan just adds the schema slot. **TODO docstring on the field (I4 carry-over):** add a JSDoc above the field stating: `/** Phase 2 schema slot; Phase 3 wires this through to the claude-pty adapter's per-spawn ANTHROPIC_API_KEY env override. \`undefined\` and \`"default"\` are semantically equivalent in Phase 3 (both resolve to the default profile); document this equivalence to prevent a future divergence bug. */`
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run daemon/config.test.ts --reporter=verbose 2>&1 | tail -20`
- **expected:** `tsc --noEmit` exits 0. All Phase 1 config tests (8) + new tests (9–13) pass = ≥13 tests in config.test.ts.

### Task 4: Wire loadSystemdCredentials into startDaemon

- **files:** `runtime/daemon/main.ts`
- **action:** **Credential value handling contract (C2 carry-over):** telemetry records the credential FILE NAME (e.g., `iago-telegram-token`) — NEVER the value. The value bytes never enter telemetry payloads, never enter `console.log`, never enter `console.error`, never enter journal-visible output. This is enforced by Task 2 test case 10. Edit `startDaemon()` in `runtime/daemon/main.ts`. Import `loadSystemdCredentials` from `./cred-bootstrap.js`. As the FIRST statement inside the function body (BEFORE `ensureStateDirsSync()`, BEFORE the optional `loadConfig()` call), invoke `loadSystemdCredentials()`. Emit a new NDJSON telemetry event `{ kind: "cred-bootstrap-loaded", credentialsLoaded: [<credential FILE names (NOT env var names, NOT values) that were loaded>] }` AFTER calling the function — to record which credentials came from systemd vs from existing env. The credentialsLoaded array contains the `fileName` field from each CredMap entry that actually wrote to env (e.g., `["iago-telegram-token", "iago-gh-token"]`), per spec § 10 criterion 5 exact shape. The list of envs that were set is computed by capturing the keys-of-interest snapshot before/after the call. Also extend the existing `daemon-start` telemetry event with new field `runUnder: "systemd" | "local" | "test"`: set to `"test"` if `process.env.NODE_ENV === "test"` (C1 carry-over — preserves Phase 1 test semantics); else `"systemd"` if `process.env.CREDENTIALS_DIRECTORY` is non-empty OR `process.env.INVOCATION_ID` is set (systemd auto-sets `INVOCATION_ID`); else `"local"`. Update inline JSDoc on `startDaemon` documenting the new boot order. Do NOT break any existing Phase 1 test — existing tests pass `CREDENTIALS_DIRECTORY=undefined` implicitly, so cred-bootstrap is no-op for them AND `NODE_ENV=test` ensures `runUnder: "test"` regardless.
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run daemon/ integration/ 2>&1 | tail -15`
- **expected:** `tsc --noEmit` exits 0. All Phase 1 daemon + integration tests still pass (≥115 tests). The new `cred-bootstrap-loaded` event lands in any local-dev run with `CREDENTIALS_DIRECTORY=/tmp/test-creds + IAGO_TELEGRAM_BOT_TOKEN unset + file present`.

## Verification

```bash
cd runtime && npx tsc --noEmit \
  && npx vitest run daemon/cred-bootstrap.test.ts daemon/config.test.ts daemon/ integration/ --coverage 2>&1 | tail -40
```

Expected:
- `tsc --noEmit` exits 0
- `cred-bootstrap.test.ts` 10 tests pass; `cred-bootstrap.ts` coverage ≥80% lines + branches
- `config.test.ts` ≥13 tests pass (Phase 1 baseline + 5 new authProfile cases)
- Phase 1 daemon + integration tests still pass (≥115 tests)

## Stress Test

**Verdict:** PROCEED (carried forward from original Plan 01 stress test, scoped to 01b tasks only)
**Date:** 2026-05-18 (pre-emptive split; original stress 2026-05-17)
**Reviewer:** orchestrator inline (carve-out)

### Critical (must fix in impl)

- **C1 — `runUnder` detection logic must treat `NODE_ENV=test` as override.** Phase 1 tests that mock `CREDENTIALS_DIRECTORY=/tmp/test` would otherwise report `runUnder: "systemd"` even though they run from Vitest. **Fix:** Task 4 treats `process.env.NODE_ENV === "test"` as a hard override → `runUnder: "test"` (new third value). Event type union: `runUnder: "systemd" | "local" | "test"`. Add a test in `main.test.ts` (if it exists) OR a dedicated test in `cred-bootstrap.test.ts` asserting `NODE_ENV=test` always emits `"test"` regardless of CREDENTIALS_DIRECTORY. This preserves Phase 1 test semantics and gives Phase 2 telemetry consumers a clean filter.
- **C2 — `cred-bootstrap-loaded` telemetry MUST NOT leak credential values.** Spec § 10 criterion 5 says emit `credentialsLoaded: ["iago-telegram-token"]` — a credential NAME, not the value. Task 1 + Task 4 explicitly say "telemetry records the name only; the value never enters telemetry, never enters console.log, never enters journal-visible output." Task 2 test case 10 enforces this with a sentinel-value grep across telemetry buffers + stdout + stderr.

### Important (forward to impl, don't block)

- **I1 — `authProfile` test coverage of "default vs undefined".** Task 3 tests 9 + 10 cover undefined and `"default"`. Add a JSDoc comment on the field asserting both code paths produce semantically equivalent downstream behavior in Phase 3 (TODO comment + Phase 3 reference). Prevents a future Phase 3 bug where `undefined` and `"default"` accidentally diverge — I4 carry-over.
- **I2 — `loadSystemdCredentials` re-entrancy.** Plan 06 SIGHUP handler calls this function repeatedly. Task 1 must be safe for repeat invocation — it already is (re-reads files, respects env override on each call). Document in JSDoc: "Safe to call multiple times; Plan 06 SIGHUP handler invokes on each signal."
- **I3 — Test environment cleanup.** Test 6 in Task 2 sets `process.env.IAGO_TELEGRAM_BOT_TOKEN = "override"`; subsequent tests in the same file must restore to undefined or another test's assertion can leak. Use `vi.stubEnv` (auto-restores after each test) instead of direct assignment.

### Minor

- M1 — `cred-bootstrap.ts` ESM import of `node:fs` vs `fs`. Phase 1 daemon uses `node:` prefix (per CLAUDE.md ESM convention). Match the existing pattern.
- M2 — JSDoc on `loadSystemdCredentials` should mention Plan 06's SIGHUP re-invocation contract (forward link). Avoids surprise when reading the helper standalone.

### Dimension-by-dimension verdicts (01b scope)

- **Precision:** All 4 tasks have exact file paths + verify commands + expected output. Sentinel-leak test (Task 2 case 10) gives precise assertion.
- **Edge cases:** C1 (test env detection), C2 (value leak), I2 (re-entrancy for SIGHUP) covered.
- **Contradictions:** Plan 01b TS bridge vs 01a deploy artifacts — clean split. The `cred-bootstrap.ts` CREDENTIALS array references file names that 01a's provision-credentials.sh produces; both must agree on names (`iago-telegram-token`, `iago-gh-token`). Cross-plan consistency: 01a Task 2 CRED_MAP keys derive credstore filenames matching 01b Task 1 CREDENTIALS array — both reference `iago-telegram-token` and `iago-gh-token`.
- **Simpler alternatives:** Could bypass the helper and read `$CREDENTIALS_DIRECTORY` files inline in `loadConfig`. REJECTED — separation of concerns + SIGHUP re-invocation contract requires a callable helper. Could use `systemd-cred-helper` C binary. REJECTED — Node fs.readFileSync is sufficient and dep-free.
- **Missing acceptance criteria:** Spec § 1 (cred-bootstrap helper) + § 5 (authProfile schema) + § 10 criterion #5 (telemetry NDJSON extended with `cred-bootstrap-loaded` event) all covered.

### Implementer forward-list

1. `runUnder: "test"` override on `NODE_ENV=test` (Task 4, C1 fix).
2. Sentinel-leak test (Task 2 case 10, C2 fix).
3. `authProfile` JSDoc on the field documenting `undefined` ≡ `"default"` equivalence (Task 3, I4 carry-over).
4. `loadSystemdCredentials` JSDoc notes Plan 06 SIGHUP re-invocation contract (Task 1, I2 + M2).
5. Use `vi.stubEnv` for env mutations in tests to avoid leakage (Task 2, I3 fix).
