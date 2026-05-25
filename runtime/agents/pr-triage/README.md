# pr-triage agent

First real workflow on the iaGO v2 daemon. Daily-cron PR triage for
Santiago's GitHub account (`ilsantino`), spawned by the daemon's
CronScheduler at 14:00 UTC, runs via the Shape 1 PTY adapter
(`claude-pty`), POSTs a single Telegram message via direct `curl`, and
exits clean.

## Wiring status (2026-05-25)

Dual aggressive adversarial review of PR #76 (Codex GPT-5.5 + Opus 4.7)
flagged that this README originally described the FULL flow as shipped
when in fact only the cron-registration half is wired. Honest current
state:

| Step | Plan | Status in PR #76 |
|------|------|------------------|
| Cron tick at 14:00 UTC | 07a (shipped) | ✓ wired in main.ts |
| Wake-check gating | 04a (shipped) + 07a | ✓ wired via CronScheduler |
| Task file written to `tasks/pending/` | 07a → 07b | ✓ |
| Polling loop claims task | 07b (shipped) | ✓ wired via `agentManager.startPollingLoop` |
| **Dispatch: read agent-config + spawn claude-pty + forward prompt** | **Plan 04d (next)** | **NOT YET WIRED** |
| Curl to Telegram, exit clean | 04a prompt-template (shipped) | gated on dispatch |
| Polling loop reaps resolved | 07b | gated on dispatch |

Until Plan 04d lands, cron-fired task files land in `tasks/pending/` and
the polling loop emits `task-unrouted` (pr-triage agent is not yet
registered via `AgentManager.registerAgent`). No PTY spawn, no Telegram
message. This is intentional — splitting prevents 04b's 4-failure
scope-explosion from recurring. See `.iago/plans/feature-phase-2-vps-bootstrap/04d-pr-triage-dispatch-handler.md`.

## 1. Purpose

The pr-triage agent is the first real workflow that — once Plan 04d lands —
proves Shape 1 PTY adapter can run end-to-end inside the v2 daemon: cron-fired (07a) →
wake-check gated (04a) → claude-pty spawned (Phase 1) → curl-to-Telegram
POST (direct, agent-side) → exit clean → polling loop reaps the task
file (07b). No new outbound message broadcasting contract on the
daemon — the agent POSTs directly to Telegram's `sendMessage` endpoint
via `curl`, inheriting `IAGO_TELEGRAM_BOT_TOKEN` from the daemon's
`process.env` (set by 01b cred-bootstrap from the systemd credstore) and
`IAGO_TELEGRAM_ALLOWED_USER_IDS` from systemd `Environment=` (01a unit
file). The first ID in the comma-separated list is Santiago.

Behavioural contract: one Telegram message per cron tick. Never poll,
never thread, never wait for follow-ups. If the POST fails non-200, the
agent writes a fallback task file under `tasks/pending/` and exits — the
daemon's polling loop (07b) picks it up and emits telemetry for
post-mortem.

## 2. Dependencies

| Dependency | Plan | Notes |
|------------|------|-------|
| `claude-pty` adapter | Phase 1 | Shape 1 PTY-spawned subprocess, heartbeat-supervised |
| Telegram bot | Phase 1 | Inbound routing only — the agent emits its OWN outbound POST |
| CronScheduler | 07a | Receives pre-parsed cron entries from `main.ts` `loadCronEntries()`; fires the 14:00 UTC cron tick, gates via wake-check |
| AgentManager polling loop | 07b | Claims `tasks/pending/pr-triage__*.json` → emits `task-resolved` |
| `gh` CLI on VPS | Phase 0 audit | Authenticated via `GH_TOKEN` env var |
| `GH_TOKEN` credential | 01a + 01b | Provisioned by `provision-credentials.sh gh-token`; classic PAT, `repo` + `read:org`, 90-day expiry |
| `jq` on VPS | Phase 0 audit | Used by prompt-template for fallback task envelope construction |

The `GH_TOKEN` credential lifecycle: Santiago creates a classic PAT in
GitHub (`repo` + `read:org` scopes, 90-day expiry), stores it in
1Password under item `v2-gh-token` field `token` (per 03b Day -1 prep
checklist), then runs `runtime/deploy/provision-credentials.sh gh-token`
on the VPS. The script reads the secret via `op://iago-os/v2-gh-token/token`,
encrypts to `/etc/credstore.encrypted/iago-gh-token.cred` via
`systemd-creds encrypt`, and the daemon's systemd unit picks it up via
`LoadCredentialEncrypted=iago-gh-token:/etc/credstore.encrypted/iago-gh-token.cred`.
The cred-bootstrap module (`runtime/daemon/cred-bootstrap.ts`) reads the
file at daemon start and writes the cleartext into `process.env.GH_TOKEN`,
so every spawned PTY child inherits the variable.

## 3. Configuration

Three files live in this folder:

- `agent-config.json` (04a Task 1) — declares `agentId: "pr-triage"`,
  `runtimeId: "claude-pty"`, `org: "internal"`, `cwd: "/opt/iago-os"`,
  `autoStart: false` (the cron decides when to fire), and
  `env.IAGO_DAEMON_STATE_ROOT` so spawned shells can resolve the state
  root.
- `crons.json` (04a Task 2) — declares `schedule: "0 14 * * *"`,
  `wakeCheck: "runtime/agents/pr-triage/wake-check.sh"`,
  `prompt: "runtime/agents/pr-triage/prompt-template.md"`, output prefix
  `pr-triage`, and `maxConcurrent: 1`.
- `prompt-template.md` (04a Task 3) — the natural-language prompt piped
  to claude-pty's stdin at fire time. Algorithm: enumerate open PRs via
  `gh api graphql`, classify into four buckets (`merge_ready`, `stuck`,
  `waiting_claude`, `waiting_santiago`), build plain-text summary,
  `curl` POST to Telegram sendMessage with no `parse_mode`.

The cron-scheduler picks `crons.json` up automatically on daemon start
(see Task 3 wiring in `runtime/daemon/main.ts` from plan 04b).

## 4. Operations

### Manual invocation (test / one-off run)

To fire the agent OUTSIDE the cron schedule (smoke test, on-demand
re-run), write a task envelope to `tasks/pending/`:

```bash
STATE_ROOT="${IAGO_DAEMON_STATE_ROOT:-/var/lib/iago-os/daemon-state}"
PROMPT=$(cat runtime/agents/pr-triage/prompt-template.md | jq -Rs .)
cat > "$STATE_ROOT/tasks/pending/pr-triage__$(date +%s).json" <<EOF
{ "agentId": "pr-triage", "prompt": $PROMPT, "needsApproval": false }
EOF
```

The daemon's polling loop (07b) claims the file, dispatches it to the
claude-pty adapter, and the agent runs identically to a cron-fired
invocation. Wake-check is BYPASSED on this path — the manual write is
treated as an explicit request, not a scheduled tick.

### Reading recent invocations

```bash
ls -1t /var/lib/iago-os/daemon-state/tasks/resolved/pr-triage__*.json | head -7
```

Shows the last seven runs (one per day). To see telemetry events from
the same window:

```bash
grep '"agentId":"pr-triage"' /var/lib/iago-os/daemon-state/telemetry/*.ndjson
```

### Disabling temporarily

Three escalation levels, weakest to strongest:

1. **Pause the cron only.** Edit `crons.json` and set `schedule: null`.
   The cron-scheduler skips registration for null-schedule entries.
   Daemon must be restarted to pick up the change (SIGHUP only reloads credentials, not cron entries).
2. **Disable the agent fully.** `agent-config.json` already has
   `autoStart: false`, so the manual write path still works but the
   daily cron silences. Combine with (1) for both surfaces.
3. **Sledgehammer.** `systemctl stop iago-os-v2-daemon` — kills the
   whole daemon. Use only when (1)+(2) are insufficient (e.g.,
   investigating a daemon-side bug).

## 5. Acceptance criteria

Verbatim copy of `.iago/research/2026-05-16-v2-operational-migration-scope.md`
§ 1 six-criterion gate:

1. **Seven consecutive days.** The agent fires once per day for seven
   calendar days without daemon-side error. The 14:00 UTC cron must
   match every day in the window; any missed day fails the gate.
2. **One Telegram message per day.** Santiago receives exactly one
   well-formed plain-text summary per day, except on days where
   wake-check correctly skips (criterion 3).
3. **Wake-check correctly skips zero-PR days.** On any day where the
   account has zero open PRs, wake-check exits 1 and the cron-scheduler
   emits `cron-skipped { reason: "wake-check-failed" }` — no
   Telegram message is sent and the gate continues.
4. **Crash recovery from session.jsonl HWM.** If claude-pty crashes
   mid-run (process exit, OOM, signal), heartbeat detects the missing
   acknowledgement, restart fires per Phase 1, and the agent resumes
   from the high-watermark recorded in `session.jsonl`.
5. **Cost ≤ $0.50/week once Phase 8 ledger is active.** The Phase 8
   cost ledger (deferred — outside Phase 2 scope) must report
   pr-triage spend ≤ $0.50/week averaged over the 7-day window.
6. **Santiago acts on ≥ 1 message.** Behavioural signal: in any 7-day
   window after launch, Santiago acts (merges, reviews, replies) on at
   least one PR surfaced in the daily summary. Observed in Phase 6
   dashboard, not asserted by automation.

## 6. Failure modes

| Failure | Symptom | Daemon response |
|---------|---------|-----------------|
| `GH_TOKEN` expired / revoked | `gh api graphql` returns 401 | wake-check exits 1; cron-scheduler emits `cron-skipped { reason: "wake-check-failed" }`; rotate via `provision-credentials.sh gh-token` |
| GitHub rate-limit hit | wake-check sees `gh api` failure | wake-check exits 2; cron-scheduler emits `cron-skipped { reason: "wake-check-failed" }` (exit code captured); next-day run usually clears the limit |
| Telegram API outage | `curl` POST returns non-200 (e.g., 429, 500, network error) | Agent writes fallback task file `pr-triage__<unix-ms>-<pid>.json` with `ndjsonAlert: "pr-triage-telegram-send-failed"`; polling loop emits telemetry; next-day run still fires independently |
| claude-pty crash mid-run | PTY child dies before message sent | Heartbeat detects missing ack → restart per Phase 1; session.jsonl replay resumes from HWM; if restart also fails, the daily slot is lost (no retry) |
| `IAGO_TELEGRAM_ALLOWED_USER_IDS` empty | First chat ID is empty string | Agent uses `HTTP_STATUS=000` synthetic guard, drops to fallback task file path, daemon emits misconfiguration alert |
| 7-day no-Santiago-action | Acceptance criterion 6 violated | Behavioural — not a code failure. Surface in Phase 6 dashboard; investigate prompt-template signal-to-noise |
| `gh` CLI missing on VPS | wake-check fails to exec `gh` | Phase 0 audit caught this; install via `apt-get install gh` per audit doc |

## 7. Cost

Initial estimate (pre-Phase 8 ledger, back-of-envelope):

- $0.10 per run × 7 runs/week = **$0.70/week**.
- Wake-check skips drop this by 30–50% on quiet days (zero PRs, weekends
  early in lifecycle) — practical estimate **$0.40–$0.50/week**.

The $0.10/run figure comes from claude-pty model cost (Opus 4.7) for a
single triage prompt run, no follow-up turns, summary cap of ~3500
chars. Once Phase 8's cost ledger ships, this section gets replaced
with measured numbers per the migration-scope acceptance criterion 5.

## 8. cwd-agnostic note (I3 carry-over)

pr-triage does NOT require git in cwd. The algorithm uses
`gh pr list --search "author:ilsantino is:pr is:open"` via the GraphQL
API, which queries GitHub directly rather than reading the local git
repository. Other agents that DO require git in cwd (e.g., agents that
need to `git status` or `git log` against the iago-os checkout) must
declare their own `cwd` in `agent-config.json` — pr-triage's
`cwd: "/opt/iago-os"` is set for the daemon's working-directory
contract, not because the agent reads files from that path.

The four touchpoints — wake-check, cron-scheduler, claude-pty, and
gh-token — are the load-bearing dependencies. Any change to one
requires re-validating against the six-criterion gate.
