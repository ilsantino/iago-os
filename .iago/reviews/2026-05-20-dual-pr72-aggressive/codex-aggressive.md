# Codex GPT-5.5 Adversarial Review — PR #72 (Plan 03b runbooks)

Reviewer: Codex GPT-5.5 via codex-companion adversarial-review
Target: feat/phase-2-03b-cutover-runbooks against origin/main
Scope: branch
Date: 2026-05-20 (dispatched from pipeline stage-4 substitute)
Source: `.iago/state/sessions/2026-05-20-03b-pipeline-success.log` (full transcript)

Verdict: **needs-attention** (3 high + 1 medium)

No-ship: these runbooks still contain production commands that can leak live tokens, fail at the credential cutover step, and perform a one-way WhatsApp deauth that rollback explicitly cannot reverse.

## Findings

### [high] Rollback token patch exposes the fresh Telegram token and may leave it world-readable
`runtime/migration/02-rollback-runbook.md:96-118`

The recommended rollback path tells the operator to paste the fresh BotFather token into `FRESH_TOKEN=<...>` and then expands it into an unquoted heredoc sent over SSH. That puts the secret in local shell history/terminal scroll and in the remote `jq --arg` argv while the process runs. The replacement `openclaw.json.tmp` is also created with the remote user's default umask and moved over the config with no chmod, so a rollback can leave the live OpenClaw bot token readable by other local users. The shipped `runtime/deploy/rollback.sh` has a safer SendEnv + hidden prompt + chmod pattern, but the operator-facing runbook still documents the unsafe manual path.

**Recommendation:** Replace the manual heredoc/one-line snippets with the same safe path as `runtime/deploy/rollback.sh`: hidden `read -rs`, forward via `tailscale ssh -o SendEnv=FRESH_TOKEN`, patch from a quoted temp script, set `umask 0077`, and chmod both `openclaw.json` and the backup to 0600.

### [high] WhatsApp deauth is a forward production mutation with no rollback path
`runtime/migration/02-cutover-runbook.md:319-326`

Cutover performs WhatsApp deauth at T+30 and says failure is not a rollback trigger. The rollback runbook then explicitly says successful WhatsApp deauth is not undone, and the decisions log says rolled-back OpenClaw will have WhatsApp inbound permanently dead. If any later T+45/T+55/T+60 check or post-cutover regression triggers rollback, the documented rollback restores Telegram only and leaves a user-visible channel outage outside the 4-minute rollback budget.

**Recommendation:** Move WhatsApp deauth out of the reversible cutover window until after the v2 cutover is stable, or add a tested restoration procedure with concrete Graph API/UI steps and timing. If the one-way deauth is intentional, document it as a separate irreversible migration with its own acceptance gate, not as part of a rollback-covered cutover.

### [high] T+05 credential command can fail after token revocation and leaks token material during verification
`runtime/migration/02-cutover-runbook.md:266-272`

Terminal (a) is defined as local Git Bash, but the T+05 command uses `/opt/iago-os/runtime/deploy/provision-credentials.sh`, a VPS path, instead of the local `runtime/deploy/provision-credentials.sh` usage documented by the provisioning script. Following this literally fails after BotFather has revoked the old token and OpenClaw has been archived. The same step also verifies by decrypting the Telegram credential and printing the first 10 characters, which violates the stated no-secret-output requirement and uses a pipeline ending in `echo`, so decrypt failure is not propagated as a command failure. This also drifts from `runtime/deploy/cutover.sh`, which provisions both `telegram-token gh-token` and verifies by length with `set -o pipefail`.

**Recommendation:** Align the runbook with `cutover.sh`: run the local `bash runtime/deploy/provision-credentials.sh telegram-token gh-token` from the repo checkout, and replace plaintext verification with a length-only `bash -c 'set -o pipefail; systemd-creds decrypt ... | wc -c'` check with a minimum token length threshold.

### [medium] Day -1 prep is not idempotent on a fresh VPS because it chowns to `iago` before creating the user
`runtime/migration/02-cutover-runbook.md:49-68`

The first Day -1 command creates state/log directories and immediately runs `chown iago:iago`, but the `iago` system user is only created in the next step. On a fresh or partially rebuilt VPS this fails after `mkdir -p`, leaving root-owned directories and forcing the operator to diagnose/re-run steps out of order. That contradicts the runbook's claim that these prep items create the preflight state safely when re-run after interruption.

**Recommendation:** Create or verify the `iago` user before any `chown iago:iago`, or combine the prep into a single guarded remote script that runs `getent passwd iago || useradd ...` before directory ownership changes.

## Next steps

- Update the runbooks to match the safer executable scripts command-for-command for credential provisioning and rollback token patching.
- Remove irreversible WhatsApp deauth from the rollback-covered cutover sequence or add a tested rollback pairing.
- Re-run a command parity review between `02-cutover-runbook.md`, `02-rollback-runbook.md`, and `runtime/deploy/{cutover,rollback}.sh`.
