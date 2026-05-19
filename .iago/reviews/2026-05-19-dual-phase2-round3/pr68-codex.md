# Codex Adversarial Review

Target: branch diff against fd9f27c
Verdict: needs-attention

Do not ship: rollback can restore OpenClaw while the v2 daemon is still running, and cutover can complete despite journal evidence that should trigger rollback.

Findings:
- [high] Rollback continues after v2 daemon remains active (runtime/deploy/rollback.sh:248-262)
  If `systemctl stop` fails or times out but `disable` succeeds, the script treats the final `is-active` check as informational and continues. That means rollback can proceed to token/config restoration and start `openclaw-gateway.service` while `iago-os-v2-daemon.service` is still active, creating an immediate split-brain bot/processing path. This is not hypothetical from the code: line 260 explicitly logs the active state and continues.
  Recommendation: Make an active v2 daemon after stop+disable a fatal rollback failure before token patching or OpenClaw start. Retry stop if needed, then fail closed with manual recovery instructions if `is-active` is anything other than inactive/failed/not-found.
- [high] Journal rollback trigger is not enforced (runtime/deploy/cutover.sh:507-581)
  The header declares that daemon-start failure or stack traces trigger rollback, but T+08 only greps for the presence of `daemon-start`. A log containing `daemon-start` plus a failure/stack trace still passes. Later, T+50 labels the checkpoint "journalctl free of errors" but only warns when error logs exist, masks journal query failures with `|| echo 0`, and still writes the step as ok. A degraded daemon can therefore complete cutover with known error evidence.
  Recommendation: At T+08 and T+50, scan recent daemon logs for failure/error/stack-trace patterns and call `trigger_rollback` on matches or journal query failure. Do not record T+50 as ok when error-level logs are present unless an operator explicitly overrides with an audited confirmation.

Next steps:
- Block release until rollback fails closed when v2 remains active.
- Add dry-run tests for stop-fails-but-disable-succeeds and journal-error-present scenarios.
