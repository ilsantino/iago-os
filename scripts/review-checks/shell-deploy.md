## Shell + Deploy Script Checks (apply when diff touches `**/deploy/**`, `**/*.sh`, `**/runtime/scripts/**`, systemd unit files, or any bash run against a remote host via ssh)

These rules cover the "script type-checks, lints, runs in dry-run, ships to prod, then silently corrupts state under failure" class. Distilled from the Phase 2 VPS bootstrap manual-review escalations — every rule below corresponds to a real bug that the pipeline reviewer + async @claude both shipped past and a hand-driven Opus + Codex Round 3 caught.

### Severity Floors

| Pattern | Minimum Severity |
|---|---|
| Remote ssh command containing a pipe (`vssh "a \| b"`, `ssh host "a \| b"`) where the local script depends on the pipeline's exit status — without `set -o pipefail` inside the remote shell (`ssh host "bash -c 'set -o pipefail; a \| b'"`) — silent first-stage failure | ALWAYS Critical |
| Credential/token file written via `jq > .tmp; mv .tmp dest` (or any `> tmpfile; mv tmpfile dest` for a secret) without `umask 0077` set BEFORE the redirect — file is born world-readable, race window before chmod even if chmod follows | ALWAYS Critical |
| `systemctl stop`/`disable` of a daemon followed by side-effecting work (token rotation, peer-daemon start, config patch) WITHOUT a hard fail on `systemctl is-active` returning anything other than `inactive`/`failed`/`not-found` — split-brain risk if stop times out but disable succeeds | ALWAYS Critical |
| Bash deploy script lacking `set -euo pipefail` at top (or equivalent `set -e; set -u; set -o pipefail`) — undefined-variable typos and pipeline-stage failures silently continue | ALWAYS Critical |
| Length/format check on a decrypted credential that accepts garbage (`len > 1`, `[ -n "$token" ]`, `len > 0`) when the legitimate credential has a known minimum length (Telegram bot token = 46 chars, GitHub PAT = 40 chars, AWS key = 20 chars) — silent acceptance of corrupted ciphertext decrypt output | ALWAYS Important |
| Remote command echoing a variable into a file (`vssh "echo '${line}' >> file"`, `ssh host "cat > file <<< '${val}'"`) where the variable can contain single quotes, double quotes, backslashes, or `$` — shell parses broken quoting, redirect fails, `\|\| true` swallows the error, telemetry/audit log silently drops the line | ALWAYS Important |
| `journalctl` / log-pattern grep that targets only one logger format when the codebase uses multiple — e.g. checking `grep -qE 'panic\|Error: \|FATAL'` while the service emits Node JSON logs (`level":50`, `level":"error"`, `UnhandledPromiseRejection`) — failure events silently pass the gate | ALWAYS Important |
| `set -o nounset` (or `set -u`) enabled but a required env var referenced without `: "${VAR:?missing}"` fail-fast — script exits with cryptic `unbound variable` at the worst possible moment instead of a clear "set VAR before invoking" message | ALWAYS Important |

### Checks

- **Remote pipe pipefail.** Every ssh-borne pipeline that the local script branches on must wrap the remote side in `bash -c 'set -o pipefail; CMD'`. The local shell's `set -o pipefail` is NOT inherited across ssh — the remote `sh -c` (default ssh exec shell) does not set pipefail. Without it: `journalctl | grep -E pattern` returning exit 1 from journalctl AND exit 0 from grep (because the first stage's stderr never reaches grep) hides the failure.

- **File-mode race on secret writes.** Any sequence that writes a secret file via `redirect > tmp; mv tmp dest; chmod 0600 dest` has a window between mv and chmod where the file is world-readable at the default umask 0022 (mode 0644). The fix is `umask 0077` BEFORE the redirect, not chmod after the mv. Audit: `git grep -nE '(jq|cat|echo|printf|tee).*>.*[Tt]mp.*;.*mv' deploy/ scripts/` and verify each call site sets umask first or uses `install -m 0600`.

- **Systemctl state validation after stop+disable.** If a script stops and disables a daemon then proceeds to side-effecting work (token rotation, port reuse, peer daemon start), it must follow with a HARD-FAIL `is-active` check that exits non-zero on anything other than `inactive` / `failed` / `not-found` / unit-not-loaded. `systemctl stop` can time out without raising — `disable` can succeed independently. Without the hard fail, the script reaches the side-effect step while the old daemon is still running → split-brain (two daemons holding the same lock, both writing the same NDJSON, both responding to the same Telegram chat).

- **Credential length threshold matches the credential.** Decrypt round-trip checks must validate the OUTPUT format, not just that ANY output exists. `len > 1` passes 2-byte garbage. Use the known minimum length for the credential: Telegram bot token `>= 46`, GitHub PAT `>= 40`, AWS access key id `== 20`, AWS secret `>= 40`. Better: pattern-match (`^[0-9]+:[A-Za-z0-9_-]{35,}$` for Telegram tokens).

- **Retry-once on transient credential checks.** Remote ssh + systemd-creds + journal queries can blip on network/syslog backpressure. A single-attempt check that triggers rollback on first failure forces operators to re-rotate credentials they don't need to re-rotate. Wrap transient checks (creds decrypt round-trip, journalctl pattern queries, daemon-start telemetry) in a `for attempt in 1 2; do CHECK && break; sleep 2; done` loop. Triggering rollback only after BOTH attempts fail.

- **Log pattern coverage matches the logger.** When a script greps a service's journal for failure indicators, the grep must cover every log format the service emits. Common gaps: a service that uses Pino/Bunyan/Winston JSON logging (`{"level":50,"err":...}`) reviewed with a grep targeting only Python tracebacks (`grep -E 'Traceback\|panic\|FATAL'`). Audit by listing the service's actual log output during a test run and confirming every failure shape is matched. Add patterns: `level":50`, `level":"error"`, `level":"fatal"`, `UnhandledPromiseRejection`, `"err":`, `"error":`, `terminated abnormally`, `panic`, `Traceback`, `FATAL`.

- **Telemetry single-quote breakage.** NDJSON / structured-log emitters that pipe a variable through ssh as `vssh "echo '${line}' >> file"` break the moment `${line}` contains a single quote. Detail strings for failure events frequently contain single quotes (`state='inactive'`, `failed to ssh: 'no route'`). Switch to stdin-pipe: `vssh "cat >> file" <<< "$line"`. No shell escape needed; the remote shell sees the line as stdin, not as a token.

- **Heredoc quote semantics.** `<<EOF` interpolates `$var`, backticks, and `\` — `<<'EOF'` does NOT. Audit every heredoc in deploy scripts: if it contains literal `$VAR_NAME` you want preserved (e.g. systemd unit `${MAINPID}`), use `<<'EOF'`. If you want local-variable expansion inside the body, use `<<EOF` but guarantee no command substitution or backslash-escape can leak from user-controlled input.

- **`set -euo pipefail` at the top of every script.** Bash deploy scripts that omit `set -e` continue past failing commands. Without `set -u`, a typo in a variable name silently expands to empty string. Without `set -o pipefail`, the LOCAL pipelines (not just remote ones) silently swallow first-stage failures. Three lines, no exceptions.

- **`trap` cleanup runs on every exit path.** Cleanup handlers (`trap cleanup EXIT INT TERM`) must be idempotent (safe to run twice) and must NOT depend on global state set after the trap was installed. Pattern: install trap as the second line of `main()`, after `set -euo pipefail`. Test by injecting a `kill -INT $$` mid-script and verifying cleanup completes.

- **`mktemp`, never `$$` or hardcoded paths.** Temp files via `mktemp` (with cleanup in trap) — never `/tmp/script.$$` (predictable, symlink race) or `/tmp/script-tmp` (collision with parallel runs). Audit: `git grep -nE '/tmp/[A-Za-z]' deploy/ scripts/`.

- **Background processes are awaited.** `cmd &` without a matching `wait` (or explicit kill on exit-trap) leaks processes. If the script polls a daemon for readiness, the poll loop must either succeed or time out and exit non-zero — not loop forever in the background after the parent exits.

- **`vssh` / `ssh` arg quoting under `bash -c`.** When the remote command is wrapped `bash -c 'CMD'`, the outer ssh layer adds a SECOND shell parsing pass. Variables containing `"`, `'`, `$`, or backticks need either careful escaping or a stdin-pipe pattern. Audit: try `vssh "echo '$test'"` where `$test=' has '\''single quotes'\'''` and confirm the remote receives the intended string.

- **`shellcheck` clean.** Every committed `.sh` file in `deploy/`, `scripts/`, `runtime/` must pass `shellcheck -x` with zero warnings. Add a pre-commit hook or CI gate that fails on shellcheck findings. Common catches: `SC2086` (unquoted expansion), `SC2046` (word splitting on command substitution), `SC2155` (`local var=$(cmd)` masks the inner exit status), `SC2034` (unused variable — often a typo).

- **`bash -n` parse clean.** `bash -n script.sh` validates syntax without execution. Every deploy script must pass this gate in CI — a syntax error in a rarely-taken branch (rollback path, error handler) is otherwise undetected until the rare path runs in prod.

- **Required env vars fail loud at top of script.** Scripts that depend on environment variables must validate them at the top with `: "${VAR_NAME:?ERROR — VAR_NAME must be set}"`. NOT `[ -z "$VAR" ] && exit 1` (subtle: `[ -z "$UNSET_VAR" ]` triggers `set -u` before the test). The colon-question construct fails before any side effect.

- **Idempotency on every step that mutates remote state.** Each remote step (token write, config patch, systemd unit install, file create) should check current state first and skip if already correct. A second invocation of the script after a partial first run must not corrupt state.

- **No silent `\|\| true` on commands the script branches on.** `cmd_that_might_fail \|\| true` is acceptable to suppress non-critical command failures (cleanup, best-effort logging) but is a Critical bug when the script's control flow depends on the result. Audit: every `\|\| true` should have a comment explaining why failure is acceptable, or be removed.

- **Regression tests for every failure mode added in fix rounds.** When a fix-loop round addresses a failure mode (silent pipefail, mode race, missing log pattern, split-brain), the same commit must add a regression test that exercises the failure path against a stub. The test should fail without the fix and pass with it. Without the regression, the fix decays at the next refactor.
