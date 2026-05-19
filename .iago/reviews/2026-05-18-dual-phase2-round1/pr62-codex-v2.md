> Note: PowerShell command-trace prefix from codex-companion stripped at archive time. Verdict and findings below are verbatim from the run.

# Codex Adversarial Review

Target: branch diff against a63b2bb84240cd0c9602fcc865a252189e5a2683
Verdict: needs-attention

No-ship: the new deploy path can start a daemon without usable credentials, can silently overwrite credentials with empty values, and likely blocks the intended IPC clients.

Findings:
- [critical] Loaded systemd credentials are never wired into the daemon environment (runtime/deploy/iago-os-v2-daemon.service:97-115)
  The unit adds LoadCredentialEncrypted entries and says a bootstrap helper reads $CREDENTIALS_DIRECTORY before loadConfig(), but this branch does not contain that helper or any CREDENTIALS_DIRECTORY reader; the existing config path only reads IAGO_TELEGRAM_BOT_TOKEN from the environment. Inference from the current codebase: systemd will mount credential files, but the daemon will not turn them into IAGO_TELEGRAM_BOT_TOKEN/IAGO_GH_TOKEN, so Telegram can start disabled and the gh token will be unavailable after cutover.
  Recommendation: Do not ship the unit until the credential bootstrap lands and is wired before loadConfig(), or change ExecStart to a wrapper that reads $CREDENTIALS_DIRECTORY and exports the required env vars. Add an integration test that runs main with a fake CREDENTIALS_DIRECTORY and no token env vars.
- [high] op read failures are masked and can publish empty credentials (runtime/deploy/provision-credentials.sh:125-128)
  plaintext_marker=$(op read "$op_ref"; printf 'X') returns the status of printf, not op read. With set -e this still survives a missing 1Password item, permission failure, or transient op read failure; plaintext becomes empty if op produced no stdout, local_len becomes 0, and the script proceeds to encrypt and publish that value. The round-trip length check then compares the empty local value to the empty remote value and reports success, silently rotating a live token to an unusable credential.
  Recommendation: Capture op read with an explicit status check before appending the marker, fail closed on nonzero exit, and reject empty token values for these credential types. Add a bats case where op whoami succeeds but op read exits nonzero.
- [high] IPC socket path is advertised for local clients but remains owner-only to the iago user (runtime/deploy/iago-os-v2-daemon.service:202-209)
  The unit runs the daemon as User=iago and moves the IPC socket to /var/lib/iago-os/daemon-state/ipc.sock so Santiago's CLI can reach it via group-readable ACL. The existing IpcServer, however, chmods the socket to 0600 after listen(), so a CLI running as ilsantino cannot connect even if the directory has group ACLs. This breaks the dashboard/CLI control plane that the unit comments make load-bearing for Tailscale clients.
  Recommendation: Define the IPC access model explicitly: either run clients through the iago user, or change the daemon/socket setup to create the socket with a shared group and mode 0660, with ilsantino in that group. Verify with a real cross-user connect test.

Next steps:
- Wire and test systemd credential consumption before deploying the unit.
- Make provision-credentials.sh fail on op read errors and empty secrets.
- Add a VPS-style smoke test covering Telegram token load and cross-user IPC access.
