---
phase: feature-phase-2-vps-bootstrap
plan: 01
wave: 1
depends_on: []
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-17
source: feature
---

# Plan: feature-phase-2-vps-bootstrap/01-daemon-deploy-infrastructure

## Goal

Ship the deploy-side infrastructure that lets the Phase 1 daemon run as a system-level systemd unit on the Hostinger VPS without leaking plaintext credentials. Three concrete deliverables: (1) the `iago-os-v2-daemon.service` systemd unit file (full sandboxing flags + `LoadCredentialEncrypted=` for Telegram + gh-token (active in Phase 2); 3 Anthropic profiles provisioned-but-commented-out per CONTEXT.md provision-vs-activate constraint (active Phase 3); Phase 3 placeholders also include 2 webhook secrets); (2) the bash provisioning script that reads from 1Password CLI and pushes `systemd-creds`-encrypted ciphertext to `/etc/credstore.encrypted/` on the VPS via Tailscale SSH (plaintext never lands on local OR remote disk); (3) the TypeScript credential bootstrap helper that bridges systemd's `$CREDENTIALS_DIRECTORY` files into `process.env` before `loadConfig()` runs, plus the `AgentConfig.authProfile` schema field for Phase 3 adapter resolution. Source of truth: `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` §§ 1, 2, 5.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/deploy/iago-os-v2-daemon.service` | systemd unit (verbatim from spec § 1 — full sandboxing + LoadCredentialEncrypted) |
| create | `runtime/deploy/provision-credentials.sh` | 1Password → systemd-creds encrypt → VPS via Tailscale SSH |
| create | `runtime/deploy/provision-credentials.test.sh` | bats-core tests with systemd-creds + tailscale stubbed |
| create | `runtime/daemon/cred-bootstrap.ts` | Read `$CREDENTIALS_DIRECTORY/<name>` files → `process.env[<VAR>]` |
| create | `runtime/daemon/cred-bootstrap.test.ts` | Unit tests for cred-bootstrap (≥80% lines) |
| edit | `runtime/daemon/config.ts` | Add `authProfile?: "default" \| "ilsantino" \| "iaguito"` field to `AgentConfig` |
| edit | `runtime/daemon/config.test.ts` | Test that `authProfile` round-trips through file + env paths |
| edit | `runtime/daemon/main.ts` | Call `loadSystemdCredentials()` BEFORE `loadConfig()` in `startDaemon` |
| create | `runtime/deploy/README.md` | Catalog of deploy artifacts + run order + prerequisites |

## Tasks

### Task 1: Author the systemd unit file

- **files:** `runtime/deploy/iago-os-v2-daemon.service`
- **action:** Write the unit file verbatim from spec § 1 "Exact unit content" — every line, every comment. Description, Documentation (both lines), After=network-online.target tailscaled.service, Requires=tailscaled.service, Type=exec, User=iago, Group=iago, WorkingDirectory=/opt/iago-os, ExecStartPre lines (test -d state, test -f main.js), ExecStart=/usr/bin/node --experimental-specifier-resolution=node /opt/iago-os/runtime/dist/daemon/main.js, Restart=on-failure RestartSec=5s StartLimitIntervalSec=120 StartLimitBurst=5, KillMode=mixed KillSignal=SIGTERM TimeoutStopSec=30s, LoadCredentialEncrypted=iago-telegram-token:/etc/credstore.encrypted/iago-telegram-token.cred AND LoadCredentialEncrypted=iago-gh-token:/etc/credstore.encrypted/iago-gh-token.cred (gh-token ACTIVE in Phase 2 for pr-triage agent per Plan 04 + migration-scope § 1; Phase 3 placeholders for 3 Anthropic profiles + 2 webhook secrets as commented-out lines), every sandboxing flag (NoNewPrivileges, PrivateTmp, PrivateDevices, ProtectSystem=strict, ProtectHome, ProtectKernel{Tunables,Modules}, ProtectControlGroups, ProtectClock, ProtectHostname, LockPersonality, RestrictNamespaces, RestrictSUIDSGID, RestrictRealtime, MemoryDenyWriteExecute, SystemCallArchitectures=native, CapabilityBoundingSet=, AmbientCapabilities=), ReadWritePaths=/var/lib/iago-os/daemon-state + /var/log/iago-os, Environment lines (`Environment=NODE_ENV=production`, `Environment=TZ=UTC` [per Codex P2-2 — locks cron schedules in `0 14 * * *` semantics regardless of host tz default; required by Plan 04 PR-triage schedule], `Environment=IAGO_DAEMON_STATE_ROOT=/var/lib/iago-os/daemon-state`, `Environment=IAGO_DAEMON_IPC_SOCKET_PATH=/var/lib/iago-os/daemon-state/ipc.sock`, `Environment=IAGO_TELEGRAM_ALLOWED_USER_IDS=__SANTIAGO_TELEGRAM_USER_ID__` placeholder), StandardOutput/Error=journal + SyslogIdentifier, MemoryMax=2G TasksMax=512, [Install] WantedBy=multi-user.target. All preserved comments stay (rationale lines from spec). Preserve the `__SANTIAGO_TELEGRAM_USER_ID__` placeholder — Plan 03 cutover script substitutes the real ID at install time.
- **verify:** `head -1 runtime/deploy/iago-os-v2-daemon.service ; grep -c "^LoadCredentialEncrypted\|^Environment\|^Protect\|^Restrict" runtime/deploy/iago-os-v2-daemon.service ; grep -c "^# " runtime/deploy/iago-os-v2-daemon.service ; grep -E '^Environment=TZ=UTC$' runtime/deploy/iago-os-v2-daemon.service`
- **expected:** First line is `# /etc/systemd/system/iago-os-v2-daemon.service`. Hardening-flag line count (LoadCredentialEncrypted / Environment / Protect* / Restrict*) is ≥18. Comment-line count is ≥40 (verbatim rationale preservation from spec). The `grep -E '^Environment=TZ=UTC$'` command exits 0 with one match (Codex P2-2 fix).

### Task 2: Author the credential provisioning script

- **files:** `runtime/deploy/provision-credentials.sh`
- **action:** Write the bash script verbatim from spec § 2 "Exact script content". Shebang `#!/usr/bin/env bash`, `set -euo pipefail`, header comments naming purpose + provenance + idempotency + usage + prerequisites. Constants: `VPS_HOST="${VPS_HOST:-srv1456441}"`, `VPS_USER="${VPS_USER:-root}"`, `CREDSTORE="/etc/credstore.encrypted"`, `UNIT_NAME="iago-os-v2-daemon.service"`. Declare `CRED_MAP` associative array mapping `telegram-token` → `op://iago-os/v2-daemon-telegram-bot/token::iago-telegram-token`, `gh-token` → `op://iago-os/v2-gh-token/token::iago-gh-token`, `anthropic-default` → `op://iago-os/v2-anthropic-default/token::iago-anthropic-default`, `anthropic-ilsantino` → `op://iago-os/v2-anthropic-ilsantino/token::iago-anthropic-ilsantino`, `anthropic-iaguito` → `op://iago-os/v2-anthropic-iaguito/token::iago-anthropic-iaguito`. `usage()` function. Argument validation (reject unknown keys before any remote action). Pre-flight checks: `op whoami` (fail with `op signin` hint), `tailscale ssh <vps> -- true` (fail with `tailscale status` hint), `tailscale ssh <vps> -- mkdir -p $CREDSTORE && chmod 0700 $CREDSTORE`. For each requested key: pipe `op read $op_ref` → `tailscale ssh root@$VPS -- "mktemp + chmod 0600 + systemd-creds encrypt --name=<name> - <tmpfile> + mv tmpfile final.cred + chown root:root + chmod 0600"`. Round-trip verification: decrypt remote, `wc -c`, compare to `op read | wc -c`; fail loudly on mismatch. After all keys: `tailscale ssh root@$VPS -- systemctl daemon-reload` (does NOT restart daemon — restart is Plan 03's job). Final echo lists activation commands. `chmod 0755` the script. Exact text from spec § 2 — Garry standard requires zero invention beyond spec.
- **verify:** `bash -n runtime/deploy/provision-credentials.sh && shellcheck runtime/deploy/provision-credentials.sh && grep -c "^[A-Z_]\+=" runtime/deploy/provision-credentials.sh`
- **expected:** `bash -n` exits 0 (syntax OK). `shellcheck` exits 0 (no findings; if there are stylistic warnings, address them with inline `# shellcheck disable=` comments referencing why). Top-level constant count ≥4.

### Task 3: bats-core tests for provision-credentials.sh

- **files:** `runtime/deploy/provision-credentials.test.sh`
- **action:** Bats-core test file (`#!/usr/bin/env bats`). Setup: create `tmp/` dir with fake `op` + `tailscale` + `systemd-creds` stubs in PATH (writes to predictable log files). Tests: (1) `usage` printed when no args (`run bash provision-credentials.sh; [[ $status -eq 64 ]]; [[ $output =~ "Usage:" ]]`); (2) unknown cred-key rejected (`run bash provision-credentials.sh frobnicate; [[ $status -ne 0 ]]; [[ $output =~ "unknown cred-key" ]]`); (3) `op whoami` failure → script exits 1 with `op signin` hint (stub `op` to return 1 on `whoami`); (4) tailscale unreachable → script exits 1 with `tailscale status` hint (stub `tailscale` to return 1 on `ssh ... -- true`); (5) happy path single key: stubs all succeed, both `op read` and `systemd-creds decrypt` return same-length output → script exits 0, final echo contains "Provisioning complete"; (6) length-mismatch failure: stub `systemd-creds decrypt` to return different bytecount → script exits 1 with "round-trip length mismatch"; (7) `all` keyword expands to every key (stub records 4 invocations); (8) reading `VPS_HOST=other-host` env override hits the stubbed tailscale with `other-host`. File 120-200 lines.
- **verify:** `which bats || echo "INSTALL bats-core: apt install bats OR brew install bats-core" ; bats runtime/deploy/provision-credentials.test.sh 2>&1 | tail -20`
- **expected:** All 8 tests pass. If bats absent, document install path in `runtime/deploy/README.md` (Task 8). On Windows where bats may be awkward, the pipeline-build-gate path runs `bash -n` + `shellcheck` only; bats run is documented but not gated.

### Task 4: Credential bootstrap helper (TypeScript)

- **files:** `runtime/daemon/cred-bootstrap.ts`
- **action:** Export `loadSystemdCredentials(): void` per spec § 1 "Credential bootstrap helper" verbatim. Imports `fs` and `path` from `node:`. Internal `CredMap` interface with `fileName: string` + `envVar: string`. Module-private `CREDENTIALS: CredMap[]` array with TWO active entries — `{ fileName: "iago-telegram-token", envVar: "IAGO_TELEGRAM_BOT_TOKEN" }` AND `{ fileName: "iago-gh-token", envVar: "GH_TOKEN" }` (gh-token active per Phase 2 pr-triage agent — Plan 04 Task 6 then becomes verify-not-edit) — and three commented-out Phase 3 entries (`iago-anthropic-default` → `IAGO_ANTHROPIC_DEFAULT_TOKEN`, plus ilsantino + iaguito). Function body: read `process.env.CREDENTIALS_DIRECTORY`; if undefined or empty, return early (local-dev no-op). Iterate `CREDENTIALS`; for each: `credPath = path.join(dir, fileName)`; if `!fs.existsSync(credPath)` continue; read file as utf8, trim; if empty continue; if `process.env[envVar]` already defined AND length > 0, continue (env-var override beats credential); set `process.env[envVar] = value`. Add JSDoc explaining: runs BEFORE `loadConfig`, local-dev path is no-op, env-var override path lets Santiago set `IAGO_TELEGRAM_BOT_TOKEN=` directly for unit-test runs. Strict-mode TS — no `any`, no `as` casts.
- **verify:** `cd runtime && npx tsc --noEmit && grep -E "^export (function|const)" daemon/cred-bootstrap.ts`
- **expected:** `tsc --noEmit` exits 0. `loadSystemdCredentials` exported.

### Task 5: cred-bootstrap unit tests

- **files:** `runtime/daemon/cred-bootstrap.test.ts`
- **action:** Vitest tests covering all branches of `loadSystemdCredentials()`. Use `vi.stubGlobal` / `vi.stubEnv` to control `process.env`; use `vi.mock("node:fs", ...)` for filesystem control. Test cases: (1) `CREDENTIALS_DIRECTORY` undefined → no-op (verify no env writes occurred — capture initial keys, assert unchanged); (2) `CREDENTIALS_DIRECTORY` set to empty string → no-op; (3) `CREDENTIALS_DIRECTORY` set + `iago-telegram-token` file present with value `"1234567890:ABCDEFG"` → `process.env.IAGO_TELEGRAM_BOT_TOKEN === "1234567890:ABCDEFG"`; (4) file present but contents have trailing newline → trimmed correctly; (5) file present but empty (zero bytes) → env NOT set; (6) file present but `process.env.IAGO_TELEGRAM_BOT_TOKEN` already set to `"override"` → env unchanged (override path wins); (7) file present but env already set to empty string `""` → file value IS loaded (empty string treated as not-set per spec: `process.env[envVar] !== undefined && process.env[envVar]!.length > 0`); (8) `CREDENTIALS_DIRECTORY` set but credential file missing → no-op for that entry, no throw; (9) `CREDENTIALS_DIRECTORY` set + `iago-gh-token` file present with value `"ghp_AAAtestBBB"` → `process.env.GH_TOKEN === "ghp_AAAtestBBB"`; (10) **MANDATORY — credential value leak negative test (Codex P1-4 fix):** seed a unique sentinel token value `"sentinel_must_not_leak_AAA"` as the file contents for `iago-telegram-token`; install a test spy on the telemetry event emitter (capture ALL emitted event payloads to a buffer), spy on `process.stdout.write` (capture all bytes written to stdout), spy on `process.stderr.write` (capture all bytes written to stderr); call `loadSystemdCredentials()`; assertion: ZERO occurrences of the literal sentinel string in ANY of the three captured buffers (telemetry payloads, stdout, stderr). This guards against accidental token logging in any future implementation change. Coverage ≥80% lines on `cred-bootstrap.ts`.
- **verify:** `cd runtime && npx vitest run daemon/cred-bootstrap.test.ts --coverage --reporter=verbose 2>&1 | tail -25`
- **expected:** All 10 tests pass (including the sentinel-leak negative test). Coverage table shows `cred-bootstrap.ts` ≥80% lines, ≥80% branches.

### Task 6: Extend AgentConfig with authProfile field

- **files:** `runtime/daemon/config.ts`, `runtime/daemon/config.test.ts`
- **action:** Edit existing `AgentConfig` interface in `config.ts` to add `readonly authProfile?: "default" | "ilsantino" | "iaguito";` field (optional, narrow union per spec § 5). Update `loadConfig()` parsing to accept `authProfile` from JSON config file (pass-through; no env-var override since per-agent setting); validate that if present it's one of the three allowed strings (use a narrow type guard, NOT `as` cast — throw `RangeError(`unknown authProfile: ${value}; expected default|ilsantino|iaguito\``)` on invalid). Tests added to `config.test.ts`: (9) AgentConfig without `authProfile` parses fine, field is undefined; (10) AgentConfig with `authProfile: "default"` parses correctly; (11) AgentConfig with `authProfile: "ilsantino"` parses; (12) AgentConfig with `authProfile: "iaguito"` parses; (13) AgentConfig with `authProfile: "unknown"` throws `RangeError` mentioning the invalid value AND the allowed set. Do NOT yet wire the field to claude-pty adapter (Phase 3 work per spec § 5 explicit deferral) — Plan 01 just adds the schema slot.
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run daemon/config.test.ts --reporter=verbose 2>&1 | tail -20`
- **expected:** `tsc --noEmit` exits 0. All Phase 1 config tests (8) + new tests (9–13) pass = ≥13 tests in config.test.ts.

### Task 7: Wire loadSystemdCredentials into startDaemon

- **files:** `runtime/daemon/main.ts`
- **action:** **Credential value handling contract (Codex P1-4 fix):** telemetry records the credential FILE NAME (e.g., `iago-telegram-token`) — NEVER the value. The value bytes never enter telemetry payloads, never enter `console.log`, never enter `console.error`, never enter journal-visible output. This is enforced by Task 5 test case (10). Edit `startDaemon()` in `runtime/daemon/main.ts`. Import `loadSystemdCredentials` from `./cred-bootstrap.js`. As the FIRST statement inside the function body (BEFORE `ensureStateDirsSync()`, BEFORE the optional `loadConfig()` call), invoke `loadSystemdCredentials()`. Emit a new NDJSON telemetry event `{ kind: "cred-bootstrap-loaded", credentialsLoaded: [<credential FILE names (NOT env var names, NOT values) that were loaded>] }` AFTER calling the function — to record which credentials came from systemd vs from existing env. The credentialsLoaded array contains the `fileName` field from each CredMap entry that actually wrote to env (e.g., `["iago-telegram-token", "iago-gh-token"]`), per spec § 10 criterion 5 exact shape. The list of envs that were set is computed by capturing the keys-of-interest snapshot before/after the call. Also extend the existing `daemon-start` telemetry event with new field `runUnder: "systemd" | "local"` (set to `"systemd"` if `process.env.CREDENTIALS_DIRECTORY` is non-empty OR `process.env.INVOCATION_ID` is set [systemd auto-sets `INVOCATION_ID`]; otherwise `"local"`). Update inline JSDoc on `startDaemon` documenting the new boot order. Do NOT break any existing Phase 1 test — existing tests pass `CREDENTIALS_DIRECTORY=undefined` implicitly, so cred-bootstrap is no-op for them.
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run daemon/ integration/ 2>&1 | tail -15`
- **expected:** `tsc --noEmit` exits 0. All Phase 1 daemon + integration tests still pass (≥115 tests). The new `cred-bootstrap-loaded` event lands in any local-dev run with `CREDENTIALS_DIRECTORY=/tmp/test-creds + IAGO_TELEGRAM_BOT_TOKEN unset + file present`.

### Task 8: Author runtime/deploy/README.md

- **files:** `runtime/deploy/README.md`
- **action:** Catalog the deploy directory contents per `.claude/rules/mcp-server-patterns.md` README convention (purpose / dependencies / configuration / ops runbook / failure modes). Sections: (1) Purpose — "Phase 2 VPS deploy artifacts. NOT executed by the iaGO pipeline. Executed by Santiago at cutover-time per `runtime/migration/02-cutover-runbook.md`." (2) Artifacts table — for each file in `runtime/deploy/`: purpose, runs-on (local Windows vs VPS), prerequisites, idempotent (Y/N); (3) Prerequisites — bash, shellcheck, bats-core (optional, tests only), 1Password CLI signed in (`op whoami`), Tailscale CLI installed + VPS reachable, age binary on VPS, root SSH on VPS via Tailscale (per Phase 0 audit); (4) Run order — `iago-os-v2-daemon.service` copied to `/etc/systemd/system/` first (Plan 03 cutover.sh handles); `provision-credentials.sh telegram-token` second (after BotFather rotation); `provision-credentials.sh anthropic-default anthropic-ilsantino anthropic-iaguito` third (after extraction from archive per Plan 02); `systemctl enable --now iago-os-v2-daemon.service` last; (5) Failure modes — table per script: bad 1Password ref → script exits 1 with op error; tailscale offline → exits 1 with status hint; systemd-creds round-trip mismatch → exits 1 with name + lengths; missing pubkey for archive (Plan 02) → archive script exits 1; (6) Verification matrix — table mapping each Phase 2 acceptance criterion (spec § 10) to which verification command from this README satisfies it. File 100-180 lines.
- **verify:** `wc -l runtime/deploy/README.md && grep -c "^## " runtime/deploy/README.md && grep -c "provision-credentials\|iago-os-v2-daemon\|archive-openclaw" runtime/deploy/README.md`
- **expected:** Line count 100-180. ≥6 top-level sections. ≥3 references to each named artifact.

## Verification

```bash
cd runtime \
  && npx tsc --noEmit \
  && npx vitest run --coverage 2>&1 | tail -40 \
  && cd .. \
  && bash -n runtime/deploy/provision-credentials.sh \
  && shellcheck runtime/deploy/provision-credentials.sh \
  && head -1 runtime/deploy/iago-os-v2-daemon.service \
  && wc -l runtime/deploy/README.md
```

Expected:
- `tsc --noEmit` exits 0
- `vitest run --coverage` passes (Phase 1 117+ tests + 8 cred-bootstrap tests + 5 new config tests ≥130 total); `cred-bootstrap.ts` coverage ≥80% lines
- `bash -n` + `shellcheck` exit 0 on provision-credentials.sh
- systemd unit first line is the path comment
- README.md 100-180 lines

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-17
**Reviewer:** orchestrator inline (5-dimension rubric per `.claude/rules/skill-authoring.md` § 2)

### Critical (must fix in impl)

- **C1 — `runUnder` detection logic.** Task 7 says "`process.env.CREDENTIALS_DIRECTORY` non-empty OR `INVOCATION_ID` set → systemd". But Phase 1 tests that mock `CREDENTIALS_DIRECTORY=/tmp/test` will now report `runUnder: "systemd"` even though they run from Vitest. **Fix:** treat `process.env.NODE_ENV === "test"` as a hard override → `runUnder: "test"` (new third value). Update event type union: `runUnder: "systemd" | "local" | "test"`. Add a test in `cred-bootstrap.test.ts` (or a new test in `main.test.ts` if exists) asserting `NODE_ENV=test` always emits `"test"` regardless of CREDENTIALS_DIRECTORY. This preserves Phase 1 test semantics and gives Phase 2 telemetry consumers a clean filter.
- **C2 — `cred-bootstrap-loaded` telemetry leaks credential names.** Spec § 10 criterion 5 says emit `credentialsLoaded: ["iago-telegram-token"]` — a credential NAME, not the value. That's safe. But: confirm no test or accidental log line includes the VALUE. Task 4 + Task 7 must explicitly say "telemetry records the name only; the value never enters telemetry, never enters console.log, never enters journal-visible output." Add assertion in `cred-bootstrap.test.ts` test 3: after the call, grep the recorded telemetry events for the literal `"1234567890:ABCDEFG"` (the test token) — must be 0 hits.

### Important (forward to impl, don't block)

- **I1 — `bats-core` install path on Windows.** Task 3 acknowledges Windows awkwardness. Make the pipeline build gate path explicit: pipeline run on Santiago's Windows box runs `bash -n` + `shellcheck` only; bats tests run on the VPS pre-cutover OR on macOS/Linux dev machines. README Task 8 must spell this out so a fresh-context implementer doesn't assume bats is required for the build to be green.
- **I2 — systemd unit `User=iago` validation in unit tests.** No test in this plan verifies the unit file declares `User=iago` (vs `ilsantino` or `root`). Add to Task 1 verify command: `grep -E "^User=iago$" runtime/deploy/iago-os-v2-daemon.service` — exit 0 expected. Cheap protection against a copy-paste error that re-introduces the rejected `ilsantino` option.
- **I3 — `ExecStartPre` path assumptions.** Task 1's unit hard-codes `/var/lib/iago-os/daemon-state` and `/opt/iago-os/runtime/dist/daemon/main.js`. These paths get CREATED by Plan 03's cutover.sh, NOT by Plan 01. The plan reads cleanly only if 03 is acknowledged. Task 1's action sentence should note: "These paths are pre-created by Plan 03 cutover.sh — Plan 01 only ships the unit file; it does NOT validate runtime paths exist on the build machine." Avoids confusion if a fresh-context implementer tries to `systemd-analyze verify` the unit on a Windows dev box (which won't have those paths).
- **I4 — `authProfile` test coverage of "default vs undefined".** Task 6 tests 9 + 10 cover undefined and `"default"`. Add a test asserting both code paths produce semantically equivalent downstream behavior in Phase 3 (today: just document the equivalence with a TODO comment + Phase 3 reference). Prevents a future Phase 3 bug where `undefined` and `"default"` accidentally diverge.

### Minor

- M1 — `runtime/deploy/` is a new folder; `runtime/migration/` already exists. Plan 02 will write to `runtime/migration/` too. Confirm no path conflict: deploy/ = executable scripts + units; migration/ = human-readable runbooks + decision docs. README (Task 8) should state this dichotomy.
- M2 — Task 1 systemd unit refers to `iago-archive-prune.timer` in commentary (via spec context) but Plan 02 actually creates it. Cross-reference is a forward dependency, not a blocker.

### Dimension-by-dimension verdicts

- **Precision:** All 8 tasks have exact file paths + verify commands + expected output. No "TBD".
- **Edge cases:** C1 + C2 cover the two non-obvious ones (test-env detection, value-vs-name leak). I3 covers path-on-build-machine confusion.
- **Contradictions:** Plan 01 schema field `authProfile` typed as `"default" | "ilsantino" | "iaguito"` matches spec § 5 schema. Spec also names the OpenClaw verbose form `iaguito_anthropic_sutoken` (OQ10 confirms short form in v2). No contradiction inside Plan 01; cross-plan consistency verified in Plan 04 (PR-triage uses `default`).
- **Simpler alternatives:** Could store credentials in `runtime/.env` instead of systemd creds — REJECTED, plaintext on disk violates Garry standard. Could use 1Password CLI on the VPS — REJECTED per spec § 2 explicit constraint. Current approach is the minimum-viable secure path.
- **Missing acceptance criteria:** Task 8 README maps each spec § 10 acceptance criterion to a verification command. Tasks 4 + 5 cover criterion 2 (≥80% coverage on new TS code). Task 7 covers criterion 5 (telemetry NDJSON extended). Plan 03 + Plan 05 cover the rest.

### Implementer forward-list

1. Update Task 7 to add `runUnder: "test"` for `NODE_ENV=test` (C1 fix).
2. Update Task 5 to add assertion that token VALUE never appears in telemetry buffer (C2 fix).
3. Update Task 1 verify to grep for literal `^User=iago$` line (I2 fix).
4. Update Task 1 action paragraph to note that VPS-side paths are Plan 03 territory (I3 fix).
5. Update Task 6 to add the documentation TODO around undefined-vs-"default" equivalence (I4 fix).
6. Task 8 README explicitly states deploy/ (executables) vs migration/ (docs) dichotomy (M1 fix).
