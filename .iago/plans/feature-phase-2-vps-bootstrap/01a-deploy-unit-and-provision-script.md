---
phase: feature-phase-2-vps-bootstrap
plan: 01a
wave: 1
depends_on: []
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-18
source: feature
split_from: 01-daemon-deploy-infrastructure
split_rationale: Pre-emptive split per .iago/decisions/2026-05-18-phase-2-split-and-dispatch.md. 01a ships the deploy-side artifacts that run BEFORE the daemon process (systemd unit file, bash provisioning script, bats tests, deploy README — Tasks 1, 2, 3, 8 of original 01). 01b ships the TypeScript bridge inside the daemon process (cred-bootstrap helper, AgentConfig schema, startDaemon wiring — Tasks 4, 5, 6, 7).
---

# Plan: feature-phase-2-vps-bootstrap/01a-deploy-unit-and-provision-script

## Goal

Ship the deploy-side infrastructure that lets the daemon run as a system-level systemd unit on the Hostinger VPS without leaking plaintext credentials. Four deliverables — all are bash + systemd artifacts; zero TypeScript changes: (1) the `iago-os-v2-daemon.service` systemd unit file (full sandboxing flags + `LoadCredentialEncrypted=` for Telegram + gh-token (active in Phase 2); 3 Anthropic profiles provisioned-but-commented-out per CONTEXT.md provision-vs-activate constraint (active Phase 3); 2 webhook secrets Phase 3 placeholders); (2) the bash provisioning script that reads from 1Password CLI and pushes `systemd-creds`-encrypted ciphertext to `/etc/credstore.encrypted/` on the VPS via Tailscale SSH (plaintext never lands on local OR remote disk); (3) bats-core tests for the provisioning script with all external commands stubbed; (4) `runtime/deploy/README.md` cataloging the deploy artifacts + run order + prerequisites. Source of truth: `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` §§ 1, 2. The TS-side bridge (cred-bootstrap helper + config schema + startDaemon wire) ships in 01b.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/deploy/iago-os-v2-daemon.service` | systemd unit (verbatim from spec § 1 — full sandboxing + LoadCredentialEncrypted) |
| create | `runtime/deploy/provision-credentials.sh` | 1Password → systemd-creds encrypt → VPS via Tailscale SSH |
| create | `runtime/deploy/provision-credentials.test.sh` | bats-core tests with systemd-creds + tailscale stubbed |
| create | `runtime/deploy/README.md` | Catalog of deploy artifacts + run order + prerequisites |

## Tasks

### Task 1: Author the systemd unit file

- **files:** `runtime/deploy/iago-os-v2-daemon.service`
- **action:** Write the unit file verbatim from spec § 1 "Exact unit content" — every line, every comment. Description, Documentation (both lines), After=network-online.target tailscaled.service, Requires=tailscaled.service, Type=exec, User=iago, Group=iago, WorkingDirectory=/opt/iago-os, ExecStartPre lines (test -d state, test -f main.js), ExecStart=/usr/bin/node --experimental-specifier-resolution=node /opt/iago-os/runtime/dist/daemon/main.js, Restart=on-failure RestartSec=5s StartLimitIntervalSec=120 StartLimitBurst=5, KillMode=mixed KillSignal=SIGTERM TimeoutStopSec=30s, LoadCredentialEncrypted=iago-telegram-token:/etc/credstore.encrypted/iago-telegram-token.cred AND LoadCredentialEncrypted=iago-gh-token:/etc/credstore.encrypted/iago-gh-token.cred (gh-token ACTIVE in Phase 2 for pr-triage agent per Plan 04a/04b + migration-scope § 1; Phase 3 placeholders for 3 Anthropic profiles + 2 webhook secrets as commented-out lines), every sandboxing flag (NoNewPrivileges, PrivateTmp, PrivateDevices, ProtectSystem=strict, ProtectHome, ProtectKernel{Tunables,Modules}, ProtectControlGroups, ProtectClock, ProtectHostname, LockPersonality, RestrictNamespaces, RestrictSUIDSGID, RestrictRealtime, MemoryDenyWriteExecute, SystemCallArchitectures=native, CapabilityBoundingSet=, AmbientCapabilities=), ReadWritePaths=/var/lib/iago-os/daemon-state + /var/log/iago-os, Environment lines (`Environment=NODE_ENV=production`, `Environment=TZ=UTC` [per Codex P2-2 — locks cron schedules in `0 14 * * *` semantics regardless of host tz default; required by Plan 04a PR-triage schedule], `Environment=IAGO_DAEMON_STATE_ROOT=/var/lib/iago-os/daemon-state`, `Environment=IAGO_DAEMON_IPC_SOCKET_PATH=/var/lib/iago-os/daemon-state/ipc.sock`, `Environment=IAGO_TELEGRAM_ALLOWED_USER_IDS=__SANTIAGO_TELEGRAM_USER_ID__` placeholder), StandardOutput/Error=journal + SyslogIdentifier, MemoryMax=2G TasksMax=512, [Install] WantedBy=multi-user.target. All preserved comments stay (rationale lines from spec). Preserve the `__SANTIAGO_TELEGRAM_USER_ID__` placeholder — Plan 03a cutover script substitutes the real ID at install time. **Note on paths (I3 carry-over):** the `/var/lib/iago-os/daemon-state` and `/opt/iago-os/runtime/dist/daemon/main.js` paths are CREATED by Plan 03a cutover.sh, NOT by this plan. 01a only ships the unit file; it does NOT validate runtime paths exist on the build machine. Do NOT attempt `systemd-analyze verify` on a Windows dev box — those paths won't exist locally.
- **verify:** `head -1 runtime/deploy/iago-os-v2-daemon.service ; grep -c "^LoadCredentialEncrypted\|^Environment\|^Protect\|^Restrict" runtime/deploy/iago-os-v2-daemon.service ; grep -c "^# " runtime/deploy/iago-os-v2-daemon.service ; grep -E '^Environment=TZ=UTC$' runtime/deploy/iago-os-v2-daemon.service ; grep -E '^User=iago$' runtime/deploy/iago-os-v2-daemon.service`
- **expected:** First line is `# /etc/systemd/system/iago-os-v2-daemon.service`. Hardening-flag line count (LoadCredentialEncrypted / Environment / Protect* / Restrict*) is ≥18. Comment-line count is ≥40 (verbatim rationale preservation from spec). The `grep -E '^Environment=TZ=UTC$'` command exits 0 with one match (Codex P2-2 fix). The `grep -E '^User=iago$'` command exits 0 with one match (I2 carry-over — cheap protection against re-introducing `ilsantino` or `root`).

### Task 2: Author the credential provisioning script

- **files:** `runtime/deploy/provision-credentials.sh`
- **action:** Write the bash script verbatim from spec § 2 "Exact script content". Shebang `#!/usr/bin/env bash`, `set -euo pipefail`, header comments naming purpose + provenance + idempotency + usage + prerequisites. Constants: `VPS_HOST="${VPS_HOST:-srv1456441}"`, `VPS_USER="${VPS_USER:-root}"`, `CREDSTORE="/etc/credstore.encrypted"`, `UNIT_NAME="iago-os-v2-daemon.service"`. Declare `CRED_MAP` associative array mapping `telegram-token` → `op://iago-os/v2-daemon-telegram-bot/token::iago-telegram-token`, `gh-token` → `op://iago-os/v2-gh-token/token::iago-gh-token`, `anthropic-default` → `op://iago-os/v2-anthropic-default/token::iago-anthropic-default`, `anthropic-ilsantino` → `op://iago-os/v2-anthropic-ilsantino/token::iago-anthropic-ilsantino`, `anthropic-iaguito` → `op://iago-os/v2-anthropic-iaguito/token::iago-anthropic-iaguito`. The gh-token entry is REQUIRED (Plan 04a/04b PR-triage agent depends on it; Plan 04b Task 2 verifies presence with a build-failing grep). Document the gh-token PAT scope explicitly in a `# COMMENT` line above the gh-token CRED_MAP entry: `# gh-token: GitHub classic PAT, scopes "repo" + "read:org", 90-day expiry (regenerate via `provision-credentials.sh gh-token`).` `usage()` function. Argument validation (reject unknown keys before any remote action). Pre-flight checks: `op whoami` (fail with `op signin` hint), `tailscale ssh <vps> -- true` (fail with `tailscale status` hint), `tailscale ssh <vps> -- mkdir -p $CREDSTORE && chmod 0700 $CREDSTORE`. For each requested key: pipe `op read $op_ref` → `tailscale ssh root@$VPS -- "mktemp + chmod 0600 + systemd-creds encrypt --name=<name> - <tmpfile> + mv tmpfile final.cred + chown root:root + chmod 0600"`. Round-trip verification: decrypt remote, `wc -c`, compare to `op read | wc -c`; fail loudly on mismatch. After all keys: `tailscale ssh root@$VPS -- systemctl daemon-reload` (does NOT restart daemon — restart is Plan 03a's job). Final echo lists activation commands. `chmod 0755` the script. Exact text from spec § 2 — Garry standard requires zero invention beyond spec.
- **verify:** `bash -n runtime/deploy/provision-credentials.sh && shellcheck runtime/deploy/provision-credentials.sh && grep -c "^[A-Z_]\+=" runtime/deploy/provision-credentials.sh && grep -E '^\[gh-token\]=' runtime/deploy/provision-credentials.sh`
- **expected:** `bash -n` exits 0 (syntax OK). `shellcheck` exits 0 (no findings; if there are stylistic warnings, address them with inline `# shellcheck disable=` comments referencing why). Top-level constant count ≥4. `gh-token` CRED_MAP entry present (one match).

### Task 3: bats-core tests for provision-credentials.sh

- **files:** `runtime/deploy/provision-credentials.test.sh`
- **action:** Bats-core test file (`#!/usr/bin/env bats`). Setup: create `tmp/` dir with fake `op` + `tailscale` + `systemd-creds` stubs in PATH (writes to predictable log files). Tests: (1) `usage` printed when no args (`run bash provision-credentials.sh; [[ $status -eq 64 ]]; [[ $output =~ "Usage:" ]]`); (2) unknown cred-key rejected (`run bash provision-credentials.sh frobnicate; [[ $status -ne 0 ]]; [[ $output =~ "unknown cred-key" ]]`); (3) `op whoami` failure → script exits 1 with `op signin` hint (stub `op` to return 1 on `whoami`); (4) tailscale unreachable → script exits 1 with `tailscale status` hint (stub `tailscale` to return 1 on `ssh ... -- true`); (5) happy path single key: stubs all succeed, both `op read` and `systemd-creds decrypt` return same-length output → script exits 0, final echo contains "Provisioning complete"; (6) length-mismatch failure: stub `systemd-creds decrypt` to return different bytecount → script exits 1 with "round-trip length mismatch"; (7) `all` keyword expands to every key (stub records 5 invocations — telegram + gh + 3 anthropic); (8) reading `VPS_HOST=other-host` env override hits the stubbed tailscale with `other-host`; (9) `gh-token` key alone is accepted and provisioned without errors (forward-compat test for Plan 04 dependency). File 130-220 lines.
- **verify:** `which bats || echo "INSTALL bats-core: apt install bats OR brew install bats-core" ; bats runtime/deploy/provision-credentials.test.sh 2>&1 | tail -20`
- **expected:** All 9 tests pass. If bats absent, document install path in `runtime/deploy/README.md` (Task 4). On Windows where bats may be awkward, the pipeline-build-gate path runs `bash -n` + `shellcheck` only; bats run is documented but not gated.

### Task 4: Author runtime/deploy/README.md

- **files:** `runtime/deploy/README.md`
- **action:** Catalog the deploy directory contents per `.claude/rules/mcp-server-patterns.md` README convention (purpose / dependencies / configuration / ops runbook / failure modes). Sections: (1) Purpose — "Phase 2 VPS deploy artifacts. NOT executed by the iaGO pipeline. Executed by Santiago at cutover-time per `runtime/migration/02-cutover-runbook.md` (ships in Plan 03b)." (2) Artifacts table — for each file in `runtime/deploy/`: purpose, runs-on (local Windows vs VPS), prerequisites, idempotent (Y/N). 01a artifacts catalog: `iago-os-v2-daemon.service`, `provision-credentials.sh`, `provision-credentials.test.sh`, `README.md`. Forward-references to 02a/02b/03a artifacts (e.g., `archive-openclaw.sh`, `cutover.sh`) listed as `(landed via Plan 02a / 03a)` — Plan 02a's README PR appends to this table; (3) Prerequisites — bash, shellcheck, bats-core (optional, tests only), 1Password CLI signed in (`op whoami`), Tailscale CLI installed + VPS reachable, age binary on VPS, root SSH on VPS via Tailscale (per Phase 0 audit); (4) Run order — `iago-os-v2-daemon.service` copied to `/etc/systemd/system/` first (Plan 03a cutover.sh handles); `provision-credentials.sh telegram-token gh-token` second (Phase 2 active credentials; after BotFather rotation for telegram-token); `provision-credentials.sh anthropic-default anthropic-ilsantino anthropic-iaguito` third (Phase 3 activation — provisioned but commented out in unit until Phase 3); `systemctl enable --now iago-os-v2-daemon.service` last; (5) deploy/ vs migration/ dichotomy (M1 carry-over): `deploy/` = executable scripts + units (shipped by 01a, 02a, 02b, 03a); `migration/` = human-readable runbooks + decision docs (shipped by 02b, 03b, 07b); (6) Failure modes — table per script: bad 1Password ref → script exits 1 with op error; tailscale offline → exits 1 with status hint; systemd-creds round-trip mismatch → exits 1 with name + lengths; (7) Verification matrix — table mapping each Phase 2 acceptance criterion (spec § 10) to which verification command from this README satisfies it. (8) Bats on Windows (I1 carry-over): pipeline build gate runs `bash -n` + `shellcheck` only; bats tests are run by Santiago on the VPS pre-cutover or on macOS dev machines; bats absent on the build machine does NOT fail the pipeline. File 120-200 lines.
- **verify:** `wc -l runtime/deploy/README.md && grep -c "^## " runtime/deploy/README.md && grep -c "provision-credentials\|iago-os-v2-daemon\|gh-token" runtime/deploy/README.md`
- **expected:** Line count 120-200. ≥7 top-level sections. ≥4 references to each named artifact (provision-credentials, iago-os-v2-daemon, gh-token).

## Verification

```bash
bash -n runtime/deploy/provision-credentials.sh \
  && shellcheck runtime/deploy/provision-credentials.sh \
  && head -1 runtime/deploy/iago-os-v2-daemon.service \
  && grep -E '^User=iago$' runtime/deploy/iago-os-v2-daemon.service \
  && grep -E '^Environment=TZ=UTC$' runtime/deploy/iago-os-v2-daemon.service \
  && grep -E '^\[gh-token\]=' runtime/deploy/provision-credentials.sh \
  && wc -l runtime/deploy/README.md
```

Expected:
- `bash -n` + `shellcheck` exit 0 on provision-credentials.sh
- systemd unit first line is the path comment
- `User=iago` and `Environment=TZ=UTC` both present (one match each)
- gh-token CRED_MAP entry present
- README.md 120-200 lines

## Stress Test

**Verdict:** PROCEED (carried forward from original Plan 01 stress test, scoped to 01a tasks only)
**Date:** 2026-05-18 (pre-emptive split; original stress 2026-05-17)
**Reviewer:** orchestrator inline (carve-out)

### Critical (must fix in impl)

- **C1 — `gh-token` provisioning must land in 01a CRED_MAP.** Plan 04a depends on `iago-gh-token` being in the systemd-creds path; Plan 04b Task 2 verifies via failing-build grep. **Fix:** 01a Task 2 CRED_MAP MUST include `gh-token` entry pointing to 1Password `op://iago-os/v2-gh-token/token::iago-gh-token`; Task 3 test (9) exercises it; Task 1 unit file MUST include `LoadCredentialEncrypted=iago-gh-token:...` line (active, not commented). Without these three places aligned, Plan 04a's PR-triage agent has no GH_TOKEN at runtime.
- **C2 — `ExecStartPre` paths and runtime dist directory.** Task 1's unit hard-codes `/var/lib/iago-os/daemon-state` and `/opt/iago-os/runtime/dist/daemon/main.js`. These paths get CREATED by Plan 03a's cutover.sh (state dirs) and by the Phase 2 build process (TypeScript compilation to `runtime/dist/`), NOT by 01a. 01a only ships the unit file; do NOT add path-existence assertions to the build gate. The plan reads cleanly only if 03a is acknowledged. Task 1 action paragraph explicitly notes this — pre-merge review I3 carry-over.

### Important (forward to impl, don't block)

- **I1 — `bats-core` install path on Windows.** Task 3 acknowledges Windows awkwardness. Pipeline build gate path is `bash -n` + `shellcheck` only; bats tests run on the VPS pre-cutover OR on macOS/Linux dev machines. README Task 4 § 8 spells this out so a fresh-context implementer doesn't assume bats is required for the build to be green.
- **I2 — User=iago validation enforcement.** Task 1 verify command greps for literal `^User=iago$`. This catches the copy-paste error that re-introduces the rejected `ilsantino` or `root` options. Cheap protection.
- **I3 — `chmod 0755` on the bash script.** Task 2 ends with `chmod 0755`. On Windows, `chmod` is a no-op (NTFS doesn't have POSIX permission bits). The bats tests on Linux/macOS confirm the script runs; pipeline on Windows just verifies syntax + shellcheck.

### Minor

- M1 — Spec § 4 archive script (Plan 02a) references `iago-archive-prune.timer` which is INSTALLED by Plan 02a, NOT this plan. Forward dependency, not a blocker.
- M2 — Deploy README forward-references artifacts that don't exist yet (Plan 02a/02b/03a). The table marks them as `(landed via Plan XX)` with an italic note. Plan 02a's README PR appends the table; iterative growth across the chore-PR-merged split set.

### Dimension-by-dimension verdicts (01a scope)

- **Precision:** All 4 tasks have exact file paths + verify commands + expected output. No "TBD". gh-token presence verified in 3 surfaces (CRED_MAP, test, unit).
- **Edge cases:** C1 closes the gh-token cross-plan-coupling failure mode; C2 closes the path-existence-on-build-machine confusion.
- **Contradictions:** Plan 01a deploy artifacts vs 01b TS bridge — clean split, no overlap. Plan 04a/04b dependency on `iago-gh-token` correctly anchored in 01a CRED_MAP.
- **Simpler alternatives:** Could store credentials in `runtime/.env` instead of systemd creds — REJECTED, plaintext on disk violates Garry standard. Could use 1Password CLI on the VPS — REJECTED per spec § 2 explicit constraint. Current approach is the minimum-viable secure path.
- **Missing acceptance criteria:** 01a satisfies spec § 1 (systemd unit) + spec § 2 (provision script). Spec § 10 criterion #1 (build gate) covered by `bash -n` + `shellcheck` in Verification. Spec § 10 criterion #4 (documentation) covered by deploy/README.md.

### Implementer forward-list

1. `gh-token` in CRED_MAP (Task 2) AND in unit file (Task 1) AND in bats test #9 (Task 3) — C1 fix.
2. `User=iago` literal grep in Task 1 verify — I2 fix.
3. README § 8 spells out bats-on-Windows posture — I1 fix.
4. README § 5 documents deploy/ vs migration/ dichotomy — M1 carry-over.
