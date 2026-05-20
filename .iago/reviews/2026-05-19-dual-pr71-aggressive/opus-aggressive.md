# Opus Aggressive Adversarial Review — PR #71

**Reviewer:** Claude Opus 4.7 (background subagent dispatch, 3 attempts)
**Note:** The full Opus report never persisted to disk — all three subagent attempts completed without writing the report file (apparent turn-limit / late-Write failure). The single finding below is recovered from the task-completion notification surfaced by the final subagent. Treat this file as a partial record. The Codex adversarial review (`codex-aggressive.md`) captured a more complete finding set independently.

## Verdict
PROCEED_WITH_NOTES (per the one persisted Opus finding)

## Critical findings

### C-1. `SENTRY_DAEMON_DSN` provisioning claim is FALSE

**File:** `docs/specs/sentry-integration.md:41-42`
**Original text:** *"DSN read from env var `SENTRY_DAEMON_DSN`, provisioned via the credential bootstrap path (Plan 01b → systemd-creds, already in Phase 2)"*

**Reality:** Plan 01b's `CREDENTIALS` array (in `runtime/daemon/cred-bootstrap.ts` per Plan 01b Task 1) has only two active entries: `iago-telegram-token` and `iago-gh-token`. The three commented-out Phase 3 entries are for Anthropic tokens (`iago-anthropic-default`, `iago-anthropic-ilsantino`, `iago-anthropic-iaguito`) — NOT for any Sentry credential. The matching deploy-side provisioning in Plan 01a's `CRED_MAP` also does NOT include a Sentry entry. The claim "already in Phase 2" misrepresents the actual scope.

**Impact:** A future implementer reading Layer A's PR brief would expect the SENTRY_DAEMON_DSN to be available via `process.env` after credential bootstrap. It would not be — the env var would be unset, Sentry SDK init would silently no-op, and daemon crashes would not be captured. Subtle failure mode.

**Fix recommendation:** Replace the false claim with explicit "Layer A's PR must add these entries":
- New entry in Plan 01a's `CRED_MAP` (e.g., `iago-sentry-daemon-dsn`)
- New matching entry in Plan 01b's `CREDENTIALS` array
- Provisioning step for the actual DSN value on the VPS

## Important findings

(Lost to subagent transcript — see Codex review for the complementary high-severity findings around Mode 1 mischaracterization, Mode 2 skill-routing conflict, Sentry auto-commit gate, webhook dedupe race, Phase numbering, and the daemon entry-point path.)

## Procedure followed

Inferred from task-notification telemetry:
- Subagent read the new docs at branch HEAD
- Verified file paths against the actual filesystem
- Verified Plan 01b's CREDENTIALS array contents
- Began checking Phase 8 gating, master-prompt line refs, CLAUDE.md execution rules — work stopped before persisting the report

## Methods

- File existence checks via Read/Bash
- Grep on Plan 01b for CREDENTIALS / SENTRY tokens
- Cross-reference against Plan 01a's `CRED_MAP` (which does not exist anywhere as a Sentry entry)

## Status

Subagent dispatch infrastructure failure — three attempts could not persist the full report. The single recovered finding is high-impact (false provisioning claim in a planned implementation spec) and has been applied to the doc rewrite alongside the Codex findings.
