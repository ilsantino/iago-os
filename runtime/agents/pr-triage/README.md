# PR-Triage Agent

The `pr-triage` agent is the first real workflow proving the iaGO v2
daemon's end-to-end agent loop: the CronScheduler fires the entry at
14:00 UTC, a bash wake-check decides whether work exists, the claude-pty
adapter spawns a Claude Code session that classifies every open PR
authored by `ilsantino`, and the session POSTs a single Telegram message
to Santiago before exiting cleanly. No daemon-side outbound message
broadcasting contract exists — the agent reaches the Telegram Bot API
directly via `curl`, inheriting `IAGO_TELEGRAM_BOT_TOKEN` from
`process.env` (populated by Plan 01b cred-bootstrap from the systemd
credstore) and `IAGO_TELEGRAM_ALLOWED_USER_IDS` from the systemd unit's
`Environment=` block (Plan 01a Task 1). This README documents the
contract, the configuration surface, the operations playbook, and the
acceptance criteria carved out of `.iago/research/2026-05-16-v2-operational-migration-scope.md`.

## 1. Purpose

`pr-triage` is the smallest closed loop that exercises every Phase 1 and
Phase 2 primitive: cron-scheduler firing → wake-check gate → claude-pty
session spawn → outbound HTTP via curl → exit on completion. It is
intentionally read-only (one `gh api graphql` query plus one Telegram
POST) so the failure surface is narrow and so cost stays well under the
$0.50/week Phase 2 ceiling.

Operationally it produces one Telegram digest per day grouping all open
PRs into four buckets — `merge_ready`, `waiting_claude`, `waiting_santiago`,
`stuck` — so Santiago can read the daily state of his queue from his phone
in under 30 seconds. The classification logic lives in
`prompt-template.md` and is fixed at deploy time; the agent does not
learn or adapt.

## 2. Dependencies

| Dependency | Plan | Role |
|---|---|---|
| `claude-pty` adapter | Phase 1 / Plan 03 | Shape 1 PTY runtime that spawns the Claude Code session |
| Telegram bot config | Phase 1 / Plan 06 | Provides `IAGO_TELEGRAM_BOT_TOKEN` + `IAGO_TELEGRAM_ALLOWED_USER_IDS` |
| `CronScheduler` | Plan 07a | 60s tick + POSIX cron parser + wake-check gating |
| `AgentManager.startPollingLoop` | Plan 07b | Polls `tasks/pending/`, claims cron-fired tasks, emits `task-resolved` decrement events |
| `gh` CLI | Phase 0 audit | Authenticated against `GH_TOKEN` for the GraphQL search query |
| `GH_TOKEN` credential | Plan 01a / Plan 01b | Classic PAT, scopes `repo` + `read:org`, 90-day expiry; provisioned via `runtime/deploy/provision-credentials.sh gh-token`, bridged into env by `runtime/daemon/cred-bootstrap.ts` |
| `jq` | Phase 0 audit | Required by the wake-check script to parse the gh API response |

The wake-check ships as `runtime/agents/pr-triage/wake-check.sh` and
emits exit 0 (work exists), 1 (zero open PRs), or 2 (rate-limited /
auth failure / missing tool). The CronScheduler distinguishes exit-1
from exit-2 only via the recorded `cron-skipped` reason — both halt the
fire, but a sustained 2-stream signals upstream trouble worth paging.

## 3. Configuration

Two static files live alongside this README and are read by the daemon at
boot:

- `agent-config.json` (Plan 04a Task 1) — declares
  `agentId: "pr-triage"`, `runtimeId: "claude-pty"`,
  `cwd: "/opt/iago-os"`, `env.IAGO_DAEMON_STATE_ROOT: "/var/lib/iago-os/daemon-state"`,
  `autoStart: false`, `authProfile: "default"`. The `org: "internal"`
  field scopes the agent to the daemon's internal org so it is not
  cross-pollinated with client work.
- `crons.json` (Plan 04a Task 2) — declares
  `schedule: "0 14 * * *"`, `wakeCheck: "runtime/agents/pr-triage/wake-check.sh"`,
  `prompt: "runtime/agents/pr-triage/prompt-template.md"`,
  `outputTaskNamePrefix: "pr-triage"`, `maxConcurrent: 1`. The
  `maxConcurrent: 1` ceiling prevents a slow run from being doubled-up
  by the next 14:00 tick if the daemon was lagging.

The prompt itself is in `prompt-template.md`. It is plain text — Telegram
receives it with no `parse_mode` so MarkdownV2's reserved-character
escape surface is avoided entirely.

Plan 04b's `runtime/daemon/main.ts` edit reads the `agents/*` tree at
startDaemon time, parses each `crons.json`, and calls
`scheduler.registerCron(...)` for every entry. Agents that ship without
a `crons.json` are silently skipped (no cron registration). Schedule
values of `null` are also skipped — see § 4 for the operational
implication.

## 4. Operations

### Manual invocation (test path / one-shot)

Write a task file under the daemon's state root. The polling loop (Plan
07b) will pick it up on the next 5s tick, atomic-rename it to
`tasks/resolved/`, and emit `task-resolved` telemetry:

```
echo '{"agentId":"pr-triage","prompt":"...inline prompt template body...","needsApproval":false}' \
  > /var/lib/iago-os/daemon-state/tasks/pending/pr-triage__$(date +%s).json
```

This bypasses the cron-scheduler entirely and is the recommended path
for smoke-testing after a deploy. The wake-check is **not** consulted on
this path — operators using it MUST verify there is at least one open PR
before invoking, or the agent will emit `No open PRs today.`

### Reading recent invocations

Cron-fired tasks land in `tasks/resolved/` after the polling loop claims
them:

```
ls /var/lib/iago-os/daemon-state/tasks/resolved/pr-triage__*.json | tail -7
```

For deeper forensics, the `cron-fired`, `cron-skipped`,
`task-resolved`, and any `pr-triage-telegram-send-failed` events live in
the NDJSON telemetry log under
`/var/lib/iago-os/daemon-state/telemetry/`. PostHog (Layer B+E, ADR
2026-05-20) ingests the daemon stream once Sebas joins Phase 6; until
then, `jq` over the on-disk NDJSON is the operator path.

### Disabling temporarily

Stopping the daemon (`systemctl stop iago-os-v2-daemon`) is a
sledgehammer — it kills every agent. Two scoped options:

1. Set `crons.json` `schedule: null` and restart the daemon. The
   daemon's `crons.json` reader treats `null` as "do not register" and
   no cron-scheduler entry exists for the agent. `autoStart: false`
   already gates the auto-start loop, so the agent remains dormant.
2. Edit `wake-check.sh` to `exit 1` unconditionally. The 60s tick still
   fires, but the gate always says "no work" and no claude-pty session
   spawns. Cost stays at zero. The `cron-skipped` event still emits so
   the operator has a trail.

Pick option 1 for indefinite disable, option 2 for a short pause
(e.g., during a credential rotation window where Telegram might 401).

## 5. Acceptance Criteria

Verbatim from
`.iago/research/2026-05-16-v2-operational-migration-scope.md` § 1
(6-criterion gate — Plan 04 success):

1. **7 consecutive days of clean operation.** No daemon restart, no
   stranded inflight, no orphan PTY. `daemon-start`/`daemon-stop`
   telemetry cardinality matches 1:1 over the window.
2. **1 Telegram message per day.** Exactly one outbound `sendMessage`
   per 14:00 UTC tick. Zero on days the wake-check returns 1 (no open
   PRs).
3. **Wake-check correctly skips zero-PR days.** On any day where
   `gh api search` returns `total_count === 0`, `cron-skipped` fires
   with `reason: "wake-check-failed"` and `exitCode: 1`; no
   claude-pty spawn occurs.
4. **Crash recovery from session.jsonl HWM.** If the daemon crashes
   mid-run, the next boot's `bootRecovery` (Plan 03) replays
   `session.jsonl` up to the HWM marker; the spawned claude-pty resumes
   without re-sending the Telegram message.
5. **Cost ≤ $0.50/week once the Phase 8 ledger lands.** Phase 2
   estimate (§ 7 below) is $0.70/week pre-skip and ~$0.40/week
   post-skip; the criterion is enforced once real metering exists.
6. **Santiago acts on ≥ 1 message during the 7-day window.** Behavioral
   signal, not a code-side assertion. Surface in the Phase 6 dashboard
   as a percentage of triage runs that produced a follow-up action
   (merge, PR comment, rebase) within 24 hours.

Criteria 1–4 are testable inside this plan; criterion 5 is deferred to
Phase 8; criterion 6 is observed-not-tested.

## 6. Failure Modes

| Scenario | Detection signal | Recovery |
|---|---|---|
| `GH_TOKEN` expired (401 from `gh api`) | wake-check exits 2, `cron-skipped { reason: "wake-check-failed", exitCode: 2 }` | Operator rotates the PAT via `provision-credentials.sh gh-token`; SIGHUP reloads daemon env (Plan 06); next tick recovers |
| `gh` API rate-limited (429) | wake-check exits 2 with stderr match `rate.?limit`, same `cron-skipped` event | Backoff is implicit (next tick is 24h out); operator action only if sustained |
| Telegram `sendMessage` returns non-200 | prompt-template § (d) writes fallback task at `tasks/pending/pr-triage__<unix-ms>-<pid>.json` carrying `ndjsonAlert: "pr-triage-telegram-send-failed"`; daemon polling loop surfaces it via telemetry (no `pr-triage` agent dispatch — `agentId` field is present but the alert envelope is read by the daemon's polling loop, not by the agent) | Tomorrow's run still proceeds. Operator inspects telemetry and decides whether to manually re-POST. |
| `claude-pty` crash mid-run | Phase 1 heartbeat detects RSS/stall and restarts the handle; session.jsonl HWM lets the resumed agent know where it stopped | Automatic; no operator action |
| `IAGO_TELEGRAM_ALLOWED_USER_IDS` empty / unset | prompt-template § (d) guard fires `HTTP_STATUS=000` and writes the fallback task | Operator audits `Environment=` block in the systemd unit; SIGHUP reload |
| 7-day Santiago-no-action signal | Phase 6 dashboard surfaces it as a triage-effectiveness metric (criterion 6 above) | Out of Phase 2 scope; informational |
| `crons.json` schedule typo (e.g., `0 99 * * *`) | `registerCron` throws `RangeError` at `validateScheduleSyntax`; daemon startup logs the error and the agent never registers | Fix the schedule, restart the daemon |

## 7. Cost

Initial estimate (pre-Phase 8 ledger):

- $0.10 per LLM invocation (Claude Code session for classification + summary)
- 7 invocations per week (one per day)
- 7 × $0.10 = **$0.70 per week pre-skip**
- Wake-check skips drop this 30–50% on quiet days (days with zero open
  PRs across `ilsantino`); post-skip steady state estimate
  **~$0.40/week**.

Cost stays well under the Phase 2 ceiling of $0.50/week (criterion 5
above) once the wake-check gating is contributing. The estimate is a
guess until Phase 8's cost ledger writes real numbers; this section is
the documented refresh point when those numbers land.

## 8. cwd-agnostic note

The pr-triage agent does **not** require git-in-cwd. Its only external
data call is `gh api graphql` (or `gh api -i /search/issues` in the
wake-check), both of which hit the GitHub API directly and do not
require a local repo checkout. The `cwd: "/opt/iago-os"` setting in
`agent-config.json` is therefore arbitrary — it could point anywhere
writable.

Future agents that DO require git-in-cwd (e.g., a hypothetical
auto-merge agent or a per-repo lint runner) MUST declare a
repository-scoped cwd in their own `agent-config.json` and SHOULD NOT
rely on the daemon to switch directories for them. Each agent owns its
cwd at registration time; the daemon does not chdir between handles.
Carry-over note from I3 of the original Plan 04 stress test —
documented here so the precedent is explicit.
