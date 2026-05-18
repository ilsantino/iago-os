# `runtime/deploy/` — Phase 2 VPS deploy artifacts

## 1. Purpose

Phase 2 VPS deploy artifacts. **NOT executed by the iaGO pipeline.** These files are executed by Santiago at cutover time per `runtime/migration/02-cutover-runbook.md` (ships in Plan 03b). The pipeline's only job for this directory is shipping the artifacts in a buildable + reviewable state; the artifacts themselves run on Santiago's Windows box (Git Bash / WSL) or the Hostinger VPS (Debian 13) over Tailscale SSH.

## 2. Artifacts

| File | Purpose | Runs on | Prerequisites | Idempotent | Landed via |
|---|---|---|---|---|---|
| `iago-os-v2-daemon.service` | systemd unit for the v2 daemon — installs at `/etc/systemd/system/` on the VPS. References `iago-telegram-token` and `iago-gh-token` via `LoadCredentialEncrypted=` (active Phase 2); 3 Anthropic profiles + 2 webhook secrets stay commented until Phase 3/9 | VPS | `iago` system user + `/var/lib/iago-os/daemon-state` + compiled `/opt/iago-os/runtime/dist/daemon/main.js` (all created by Plan 03a cutover.sh) | Y (file is declarative) | Plan 01a |
| `provision-credentials.sh` | 1Password → systemd-creds → `/etc/credstore.encrypted/` over Tailscale SSH; plaintext never lands on local OR remote disk. Provisions `telegram-token`, `gh-token`, and 3 Anthropic profile credentials | Santiago's local box (Git Bash / WSL / macOS) | 1Password CLI signed in, Tailscale CLI installed, VPS reachable, root SSH on VPS | Y (re-running rotates ciphertext) | Plan 01a |
| `provision-credentials.test.sh` | bats-core tests for the provisioning script — all external commands stubbed | Local (Linux / macOS) or VPS pre-cutover | bats-core installed | Y | Plan 01a |
| `README.md` | This catalog | n/a (docs) | n/a | Y | Plan 01a |
| `archive-openclaw.sh` | OpenClaw stop + age-encrypted tar + 30-day retention timer install | VPS | age binary on VPS, OpenClaw running | N (consumes OpenClaw state) | _(landed via Plan 02a)_ |
| `iago-archive-prune.{service,timer}` | systemd timer for 30-day archive retention | VPS | written by `archive-openclaw.sh` | Y (timer is declarative) | _(landed via Plan 02a)_ |
| `MANIFEST.template.md` | OpenClaw archive manifest template | n/a (template) | n/a | Y | _(landed via Plan 02a)_ |
| `revoke-whatsapp.sh` | Meta Graph API `DELETE /<WABA_ID>/subscribed_apps` + `DELETE /me/permissions` | Local | Meta API token in env | N (one-time per WABA) | _(landed via Plan 02b)_ |
| `rotate-telegram-bot.sh` | Telegram bot token rotation wrapper (Santiago invokes BotFather `/revoke` first) | Local | Telegram bot token in 1Password post-rotation | Y (re-provisions credential) | _(landed via Plan 02b)_ |
| `cutover.sh` | Full FAST cutover (stop OpenClaw → archive → install unit → enable → start) | VPS | All Plan 01a + 02a artifacts present | N (state-changing) | _(landed via Plan 03a)_ |
| `rollback.sh` | Rollback (stop v2 → restart OpenClaw from archive) | VPS | Archive present, OpenClaw archive intact | N (state-changing) | _(landed via Plan 03a)_ |

The `(landed via Plan XX)` rows are forward references — those files do not exist yet at the close of Plan 01a. Plan 02a's PR appends to this table; Plan 02b, 03a do the same in sequence.

## 3. Prerequisites

### Local box (Santiago's Windows / macOS)

| Tool | Why | Install |
|---|---|---|
| `bash` 4+ | Provisioning script uses associative arrays | Git Bash on Windows; system bash on macOS/Linux |
| `shellcheck` | Static analysis of `.sh` files; required for pipeline build gate when the gate runs on Linux/macOS | `winget install --id=koalaman.shellcheck` (Windows), `brew install shellcheck` (macOS), `apt install shellcheck` (Debian/Ubuntu) |
| `bats-core` | Test runner for `*.test.sh` files — see § 8 for the bats-on-Windows posture | `apt install bats` (Debian), `brew install bats-core` (macOS), skip on Windows |
| 1Password CLI (`op`) | Reads credential plaintext from 1Password vault | https://developer.1password.com/docs/cli/get-started — sign in with `op signin` |
| Tailscale CLI | Reaches VPS over Tailnet (SSH) | https://tailscale.com/download — VPS already in tailnet per `runtime/migration/00-vps-audit.md` |
| `gh` (GitHub CLI) | Used by `/iago-execute` to open the PR for this plan | https://cli.github.com/ |

### VPS (Hostinger Debian 13 — srv1456441 / 187.77.135.32)

| Tool | Why | State |
|---|---|---|
| `systemd` (with `systemd-creds`) | Encrypts + loads credentials via `LoadCredentialEncrypted=` | Default on Debian 13 |
| `age` | Encrypts OpenClaw archive (Plan 02a) | Confirmed present per Phase 0 audit |
| `tar`, `jq` | Archive packaging | Confirmed present per Phase 0 audit |
| `iago` system user | Daemon process owner | Created by Plan 03a cutover.sh (`useradd --system --no-create-home --shell /usr/sbin/nologin`) |
| `/var/lib/iago-os/daemon-state` | Daemon state root (writable per unit `ReadWritePaths=`) | Created by Plan 03a cutover.sh |
| `/var/log/iago-os` | Daemon log dir (writable per unit `ReadWritePaths=`) | Created by Plan 03a cutover.sh |
| `/opt/iago-os/runtime/dist/daemon/main.js` | Compiled daemon entry point | Built + rsynced by Plan 03a cutover.sh |
| Root SSH via Tailscale | Required by provisioning script (writes to `/etc/credstore.encrypted/`) | Confirmed present per Phase 0 audit |

## 4. Run order

The cutover script (`cutover.sh`, lands Plan 03a) orchestrates the full sequence. For reference, here is the explicit order with provenance:

1. **Install systemd unit** — `cutover.sh` copies `iago-os-v2-daemon.service` to `/etc/systemd/system/`, substitutes `__SANTIAGO_TELEGRAM_USER_ID__` with the real Telegram user ID, runs `systemctl daemon-reload`. (Plan 03a)
2. **Provision Phase 2 active credentials** — `bash runtime/deploy/provision-credentials.sh telegram-token gh-token`. Run AFTER the BotFather `/revoke` rotation completes (Plan 02b). `telegram-token` is required for the Telegram control surface; `gh-token` is required by the Plan 04a/04b PR-triage agent (PTY adapter needs `GH_TOKEN` in the spawned shell environment). The `gh-token` value is a GitHub classic PAT with scopes `repo` + `read:org`, 90-day expiry; rotate via `bash runtime/deploy/provision-credentials.sh gh-token` (idempotent).
3. **Provision Phase 3 credentials (provisioned-but-inactive in Phase 2)** — `bash runtime/deploy/provision-credentials.sh anthropic-default anthropic-ilsantino anthropic-iaguito`. These ciphertexts live in `/etc/credstore.encrypted/` but are NOT referenced by `LoadCredentialEncrypted=` lines in the unit (those lines stay commented until Phase 3 adapter wiring lands).

The script's git mode is `100755`, so the `bash` prefix is belt-and-suspenders for users on filesystems that strip the exec bit (Windows NTFS via Git Bash with `core.filemode=false`). On a Linux/macOS clone the script is directly executable.
4. **Enable + start** — `systemctl enable --now iago-os-v2-daemon.service`. (Plan 03a `cutover.sh`)

## 5. `deploy/` vs `migration/` dichotomy

Phase 2 splits the VPS-side change set across two directories:

| Directory | Content | Audience | Examples |
|---|---|---|---|
| `runtime/deploy/` | Executable scripts + systemd units | Santiago runs them, OR `cutover.sh` runs them | `provision-credentials.sh`, `iago-os-v2-daemon.service`, `cutover.sh`, `archive-openclaw.sh` |
| `runtime/migration/` | Human-readable runbooks + decision logs | Santiago reads them step-by-step at cutover | `02-cutover-runbook.md`, `02-rollback-runbook.md`, `02-cutover-decisions.md`, `02-telegram-bot-rotation.md`, `02-whatsapp-deauth.md` |

Scripts in `deploy/` belong to plans 01a, 02a, 02b, 03a. Runbooks in `migration/` belong to plans 02b, 03b, 07b. A single human action (e.g., the cutover) is split: the executable side lives in `deploy/`, the narrative + checkpoints + decisions live in `migration/`.

## 6. Failure modes

### `provision-credentials.sh`

| Symptom | Cause | Recovery |
|---|---|---|
| `ERROR: 1Password CLI not signed in. Run: op signin` | `op whoami` returned non-zero | `op signin` then re-run |
| `gh-token` rotation produces a stale value at runtime | New PAT provisioned but daemon not restarted (LoadCredentialEncrypted= reads only at unit start) | `tailscale ssh root@srv1456441 -- systemctl restart iago-os-v2-daemon.service` after `bash runtime/deploy/provision-credentials.sh gh-token` |
| `ERROR: cannot reach ${USER}@${HOST} over Tailscale SSH` | Tailscale SSH check (`tailscale ssh ... -- true`) returned non-zero | `tailscale status`, confirm VPS node online, check tailnet ACLs |
| `ERROR: unknown cred-key 'X'` | Argument not present in `CRED_MAP` associative array | Use one of the keys printed by `usage()` |
| `ERROR: round-trip length mismatch for X (local=N remote=M)` | `systemd-creds decrypt` returned a different byte count than `op read` produced — encryption or transport corrupted bytes | Re-run; if persists, check `op read` output for trailing whitespace, check that the 1Password field value matches what BotFather/GitHub issued |
| `ssh: connect to host ... port 22: Connection refused` | VPS sshd offline OR Tailscale not running locally | `tailscale up`; check `systemctl status sshd` on VPS via Hostinger panel |

### `iago-os-v2-daemon.service`

| Symptom | Cause | Recovery |
|---|---|---|
| `start-limit-hit` in `systemctl status` | Daemon crashed 5× in 120s — typically a malformed daemon-config.json | Inspect `journalctl -u iago-os-v2-daemon.service -n 100`; fix config; `systemctl reset-failed iago-os-v2-daemon.service; systemctl start iago-os-v2-daemon.service` |
| Unit refuses to start with `ExecStartPre` failure | `/var/lib/iago-os/daemon-state` missing OR `/opt/iago-os/runtime/dist/daemon/main.js` missing | Plan 03a `cutover.sh` is incomplete — re-run cutover.sh OR manually `mkdir -p /var/lib/iago-os/daemon-state && chown iago:iago /var/lib/iago-os/daemon-state` |
| Telegram heartbeat absent for >10 min | `LoadCredentialEncrypted=` failed (credential file missing or unreadable) | `systemctl status iago-os-v2-daemon.service` will show `Loading credential ... failed`; re-run `bash runtime/deploy/provision-credentials.sh telegram-token` |

## 7. Verification matrix

Maps each Phase 2 acceptance criterion (spec § 10) to which artifact + verify command satisfies it.

| Spec § 10 criterion | Artifact (this plan: 01a) | Verify command |
|---|---|---|
| #1 Build gate (`bash -n` + `shellcheck`) | `provision-credentials.sh` | `bash -n runtime/deploy/provision-credentials.sh && shellcheck runtime/deploy/provision-credentials.sh` |
| #4 Documentation | `README.md` (this file) | `wc -l runtime/deploy/README.md` (expect 120–200); `grep -c "^## " runtime/deploy/README.md` (expect ≥7) |
| (forward) #2 ≥80% TS coverage | _(Plan 01b ships TS code + tests)_ | `vitest run --coverage` (in Plan 01b) |
| (forward) #3 Integration test | _(Plan 05b)_ | `IAGO_VPS_E2E=1 vitest run runtime/integration/phase-2-vps.test.ts` (Plan 05b) |
| (forward) #5 NDJSON telemetry | _(Plan 01b cred-bootstrap emits `credentials_loaded` event)_ | `jq '.event == "credentials_loaded"' on telemetry NDJSON` |
| (forward) #6 Rollback documented + tested | _(Plan 03b)_ | `runtime/deploy/rollback.sh --dry-run` (Plan 03b) |
| (forward) #7 Verification path completed | _(Plan 05a/05b)_ | `node runtime/scripts/check-evidence.mjs` (Plan 05b) |
| (forward) #8 Self-evidence | _(Plan 05a/05b)_ | Real terminal log + Telegram screenshot embedded in cutover PR description (Santiago, Plan 03a/03b cutover window) |

## 8. Bats on Windows

The pipeline build gate runs `bash -n` + `shellcheck` only — `bats` is NOT required for the build to pass. Reasons:

1. **bats-core on Git Bash / MSYS2 is flaky.** Path translation, `[[ ]]` quirks, and `mktemp` differences make tests unreliable.
2. **The provisioning script runs from a real bash environment at cutover.** On the VPS (Debian) or Santiago's local Git Bash with all deps present.
3. **The tests cover external-stub behavior.** Running them on the build machine adds no signal beyond `bash -n` + `shellcheck`.

When tests DO run (macOS dev box, CI on Ubuntu, or VPS pre-cutover validation):

```bash
bats runtime/deploy/provision-credentials.test.sh
# expected: 9 passing
```

If `bats` is absent on the build machine, the pipeline build gate skips the test step but logs `bats not installed — tests deferred to VPS pre-cutover`. This is acceptable per Plan 01a stress test I1.

## 9. Out of scope for Plan 01a

These artifacts will land in later plans of the same phase (`feature-phase-2-vps-bootstrap`):

- TypeScript credential bootstrap (`runtime/daemon/cred-bootstrap.ts`) — Plan 01b
- `AgentConfig.authProfile` schema extension — Plan 01b
- `loadSystemdCredentials()` wire-up in `startDaemon` — Plan 01b
- OpenClaw archive script + retention timer — Plan 02a
- Telegram bot rotation runbook + script — Plan 02b
- WhatsApp deauth runbook + script — Plan 02b
- Cutover + rollback scripts — Plan 03a
- Cutover + rollback runbooks — Plan 03b
- PR-triage agent (consumes `gh-token` from credstore via `$CREDENTIALS_DIRECTORY/iago-gh-token`) — Plan 04a/04b. Plan 04b Task 2 build-failing grep asserts `iago-gh-token` presence in the unit's `LoadCredentialEncrypted=` lines AND in this CRED_MAP — both anchored here in Plan 01a.
- Phase 2 evidence template + integration test — Plan 05a/05b
- SIGHUP credential-reload handler — Plan 06
- Cron scheduler subsystem — Plan 07a/07b
