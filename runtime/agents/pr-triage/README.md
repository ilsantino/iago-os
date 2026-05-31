# pr-triage agent

First real workflow on the iaGO v2 daemon. Daily-cron PR triage for
Santiago's GitHub account (`ilsantino`), spawned by the daemon's
CronScheduler at 14:00 UTC, runs via the Shape 1 PTY adapter
(`claude-pty`).

**R1 (feature-pr84-r1-daemon-creds) — agents never hold long-lived
secrets.** The pr-triage agent holds **no GitHub PAT, no Telegram bot
token, and makes no network call.** It is a pure **data-in → text-out**
transform. The **daemon** (trusted code that already holds the secrets in
its own `process.env` via cred-bootstrap):

1. **fetches** every open PR (`runtime/daemon/pr-triage-fetch.ts`,
   holding `GH_TOKEN`),
2. **sanitizes** each PR to a small set of pre-computed scalar fields and
   injects that payload into the agent prompt. The raw PR **body** and
   **comments** are structurally eliminated — reduced to the single
   `mentionsClaude` boolean, so attacker-authored body/comment text never
   reaches the prompt. `title`/`author`/`url` are attacker-influenced free
   text passed verbatim as **delimited untrusted data**; they are
   control-stripped + length-capped (defense-in-depth) — a real-but-mitigated
   residual surface, **not** a zero-surface guarantee,
3. **gates** the spawn on zero open PRs (replacing the retired bash
   wake-check — zero PRs means no spawn, no notification), and
4. **sends** the agent's text summary to Santiago on Telegram itself
   (`TelegramBot.sendAgentNotification`).

The agent classifies the scalar payload into four buckets, formats a
plain-text summary, and writes a single result envelope
(`{ "agentId": "pr-triage", "sendText": "<summary>" }`) to
`tasks/pending/pr-triage-send__<epoch-ms>-<pid>.json`. The daemon's poll
loop picks it up and performs the send.

## 1. Purpose

The pr-triage agent proves the Shape 1 PTY adapter can run a daemon-owned
data-in → text-out workflow end-to-end inside the v2 daemon:

```
cron tick (07a) → daemon fetch + sanitize + zero-PR gate (R1) →
  claude-pty spawned with the sanitized payload injected (Phase 1) →
  agent classifies + formats + writes a `pr-triage-send__*.json` envelope →
  daemon poll loop routes the envelope → daemon sends to Telegram (R1) →
  daemon reaps the resolved task file (07b)
```

There is no agent-side outbound POST and no agent-held secret. The daemon
owns the GitHub fetch and the Telegram send. The first ID in
`IAGO_TELEGRAM_ALLOWED_USER_IDS` is Santiago — the daemon's
`getChatId()` resolves the recipient.

Behavioural contract: one Telegram message per cron tick on a day with
open PRs. The agent never polls, never threads, never waits for
follow-ups. If the agent dispatches but writes no envelope (crash), the
daemon's dead-letter timer surfaces a `pr-triage-result-timeout` so the
missed notification is never silently lost.

## 2. Dependencies

| Dependency | Plan | Notes |
|------------|------|-------|
| `claude-pty` adapter | Phase 1 | Shape 1 PTY-spawned subprocess, heartbeat-supervised |
| Telegram bot | Phase 1 / R1 | The DAEMON sends the summary via `TelegramBot.sendAgentNotification`; the agent emits no POST |
| `pr-triage-fetch.ts` | R1 | Daemon-owned GraphQL fetch (holds `GH_TOKEN`) + sanitize to scalar payload |
| CronScheduler | 07a / R1 | Fires the 14:00 UTC cron; `prepareCronPrompt` runs the daemon fetch + zero-PR gate + payload injection |
| AgentManager polling loop | 07b / R1 | Routes `pr-triage__*` prompts to dispatch AND `pr-triage-send__*` envelopes to the daemon send handler |
| `GH_TOKEN` credential | 01a + 01b | Held by the DAEMON only (cred-bootstrap → daemon `process.env`); NEVER injected into the agent env |
| `jq` on VPS | Phase 0 audit | Used by the prompt-template to write the result envelope atomically |

The `GH_TOKEN` credential lifecycle is unchanged (Santiago provisions a
classic PAT via `provision-credentials.sh gh-token`; cred-bootstrap reads
it at daemon start into the **daemon's** `process.env`). The change in R1:
the daemon **uses** `GH_TOKEN` for its own fetch instead of **forwarding**
it to the agent's PTY. The composed agent env carries only the non-secret
runtime descriptors (`PATH`/`HOME`/`SHELL`/`LANG`) plus
`IAGO_DAEMON_STATE_ROOT` — no secret of any kind.

## 3. Configuration

Three files live in this folder:

- `agent-config.json` — declares `agentId: "pr-triage"`,
  `runtimeId: "claude-pty"`, `org: "internal"`, `cwd: "/opt/iago-os"`,
  `autoStart: false` (the cron decides when to fire), and
  `env.IAGO_DAEMON_STATE_ROOT` so the spawned shell can resolve the state
  root. The `env` block is **secret-free** — no token is declared or
  injected.
- `crons.json` — declares `schedule: "0 14 * * *"`,
  `prompt: "runtime/agents/pr-triage/prompt-template.md"`, output prefix
  `pr-triage`, and `maxConcurrent: 1`. **No `wakeCheck` field** — gating
  moved daemon-side into `prepareCronPrompt` (zero open PRs → skip).
- `prompt-template.md` — the data-in → text-out prompt piped to
  claude-pty's stdin at fire time. The daemon substitutes the sanitized
  scalar payload into the `{{PR_DATA_JSON}}` placeholder. Algorithm:
  classify the scalar fields into four buckets (`merge_ready`, `stuck`,
  `waiting_claude`, `waiting_santiago`), build a plain-text summary, and
  write a `pr-triage-send__*.json` result envelope. No `gh`, no HTTP
  client, no token.

The cron-scheduler picks `crons.json` up automatically on daemon start.

## 4. Operations

### Manual invocation (test / one-off run)

The cron path runs the daemon fetch + payload injection automatically. To
fire the agent OUTSIDE the cron schedule you would normally let the cron
tick handle it; a manual prompt task can be written but it would lack the
injected payload (the daemon only renders the payload on the cron
`prepareCronPrompt` path). For a faithful smoke test, trigger the cron at
14:00 UTC (or temporarily adjust `schedule` and restart the daemon).

### Reading recent invocations

```bash
ls -1t /var/lib/iago-os/daemon-state/tasks/resolved/pr-triage-send__*.json | head -7
```

Shows the last seven result envelopes (one per day). To see telemetry
events from the same window:

```bash
grep '"agentId":"pr-triage"' /var/lib/iago-os/daemon-state/telemetry/*.ndjson
```

Relevant telemetry kinds: `cron-skipped { reason: "no-open-prs" }` (zero
PRs), `cron-skipped { reason: "pr-fetch-failed" }` (daemon GitHub fetch
error), `pr-triage-no-send` (agent computed an empty summary),
`pr-triage-result-timeout` (agent dispatched but wrote no envelope), and
`pr-triage-telegram-send-failed` (the daemon's send failed).

### Disabling temporarily

Three escalation levels, weakest to strongest:

1. **Pause the cron only.** Edit `crons.json` and set `schedule: null`.
   The cron-scheduler skips registration for null-schedule entries.
   Daemon must be restarted to pick up the change (SIGHUP only reloads
   credentials, not cron entries).
2. **Disable the agent fully.** `agent-config.json` already has
   `autoStart: false`, so the daily cron is the only fire surface;
   combine with (1) to silence it.
3. **Sledgehammer.** `systemctl stop iago-os-v2-daemon` — terminates the
   whole daemon. Use only when (1)+(2) are insufficient.

## 5. Acceptance criteria

1. **Seven consecutive days.** The agent fires once per day for seven
   calendar days without daemon-side error. The 14:00 UTC cron must match
   every day; any missed day fails the gate.
2. **One Telegram message per day.** Santiago receives exactly one
   well-formed plain-text summary per day, except on days the daemon
   correctly gates (criterion 3).
3. **Zero-PR days are gated daemon-side.** On any day with zero open PRs,
   the daemon's `prepareCronPrompt` returns skip and the cron-scheduler
   emits `cron-skipped { reason: "no-open-prs" }` — no spawn, no Telegram
   message, gate continues.
4. **Crash recovery + dead-letter.** If claude-pty crashes mid-run,
   heartbeat detects the missing acknowledgement and restart fires per
   Phase 1. If the agent dispatches but writes no envelope, the daemon's
   result-timeout surfaces `pr-triage-result-timeout` rather than a silent
   lost notification.
5. **Cost ≤ $0.50/week once Phase 8 ledger is active.** The Phase 8 cost
   ledger (deferred) must report pr-triage spend ≤ $0.50/week.
6. **Santiago acts on ≥ 1 message.** Behavioural signal observed in the
   Phase 6 dashboard, not asserted by automation.

## 6. Failure modes

| Failure | Symptom | Daemon response |
|---------|---------|-----------------|
| `GH_TOKEN` expired / revoked | The daemon's GraphQL fetch returns 401 | `prepareCronPrompt` skips with `cron-skipped { reason: "pr-fetch-failed" }`; no spawn; rotate via `provision-credentials.sh gh-token` |
| GitHub rate-limit / network error | Daemon fetch throws (token-free `FetchPrsError`) | `cron-skipped { reason: "pr-fetch-failed" }`; next-day run usually clears |
| Zero open PRs | `totalCount === 0` | `cron-skipped { reason: "no-open-prs" }`; no spawn, no message |
| Telegram API outage | Daemon `sendAgentNotification` returns `{ ok: false }` | Daemon emits `pr-triage-telegram-send-failed`; the envelope stays in `pending/` to re-trip; next-day run still fires |
| Agent computes an empty summary | Agent writes `{ noSend: true }` | Daemon emits `pr-triage-no-send` and resolves the envelope (distinguishes "nothing to send" from "agent died") |
| claude-pty crash mid-run (no envelope) | PTY child dies before writing an envelope | Heartbeat → restart per Phase 1; daemon's result-timeout emits `pr-triage-result-timeout` so the slot is observable, not silently lost |
| `IAGO_TELEGRAM_ALLOWED_USER_IDS` empty | No recipient | `TelegramBot` constructor throws `RangeError` at startup (fail loud); local-dev with no `config.telegram` → `sendAgentNotification` returns `{ ok: false, error: "telegram-not-configured" }` and the daemon records the failed send |

## 7. Cost

Initial estimate (pre-Phase 8 ledger, back-of-envelope):

- ~$0.10 per run × 7 runs/week = **$0.70/week**.
- Daemon-side zero-PR gating drops this on quiet days — practical
  estimate **$0.40–$0.50/week**.

The $0.10/run figure comes from claude-pty model cost for a single triage
prompt run, no follow-up turns, summary cap of ~3500 chars. The daemon's
GitHub fetch is a single GraphQL round-trip and adds no model cost. Once
Phase 8's cost ledger ships, this section gets replaced with measured
numbers.

## 8. cwd-agnostic note

pr-triage does NOT require git in cwd. The daemon queries GitHub directly
via the GraphQL API (`pr-triage-fetch.ts`), not the local git repository.
pr-triage's `cwd: "/opt/iago-os"` is set for the daemon's
working-directory contract, not because the agent reads files from that
path.

The load-bearing dependencies are now daemon-side: the GitHub fetch +
sanitize module, the CronScheduler `prepareCronPrompt` gate, the
claude-pty adapter, and the daemon's Telegram send. Any change to one
requires re-validating against the six-criterion gate.
