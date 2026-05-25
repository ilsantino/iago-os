# pr-triage agent

## 1. Purpose

The first real iaGO v2 workflow that proves the Shape 1 PTY adapter can run end-to-end.

The full execution path is:

1. The `cron-scheduler` (Plan 07a) ticks once every 60 seconds.
2. On a UTC-minute match against `0 14 * * *`, it runs `wake-check.sh` via `spawnSync("bash", ...)`.
3. If wake-check exits 0 (open PRs exist), the scheduler reads `prompt-template.md` and writes a task file to `tasks/pending/pr-triage__<unix>.json` (atomic tmp→rename).
4. The polling loop (Plan 07b) picks the file up and the daemon dispatches it to a `claude-pty` PTY.
5. The agent runs the GraphQL query, builds the plain-text summary, and issues a direct `curl` POST to the Telegram Bot API `sendMessage` endpoint.
6. The PTY exits cleanly.

There is no daemon-side outbound message broadcasting contract — the agent POSTs directly to Telegram. It inherits `IAGO_TELEGRAM_BOT_TOKEN` from `process.env` (loaded from the systemd credstore by `runtime/daemon/cred-bootstrap.ts` per Plan 01b) and `IAGO_TELEGRAM_ALLOWED_USER_IDS` from the systemd unit's `Environment=` directive (Plan 01a Task 1).

A single Telegram message per cron tick (daily, 14:00 UTC) summarizing every open PR Santiago has authored across GitHub, classified into four buckets — `merge_ready`, `stuck`, `waiting_claude`, `waiting_santiago`.

The PR triage agent is fire-and-forget: it does not poll, does not thread, does not start a conversation. Plain text only — no `parse_mode`, no MarkdownV2 escaping surface, no HTML.

Why this agent is first:

- It is the smallest workflow that exercises every Phase 2 primitive (cron-scheduler timing, wake-check skip semantics, claude-pty spawn lifecycle, gh-token credential flow, polling-loop fallback envelope handling) in one execution.
- It surfaces a daily signal Santiago will actually read on his phone, which means failures get caught fast.
- It deliberately avoids any approval flow (the bot's inbound message routing in `runtime/telegram/bot.ts` is unused here), so the success path stays narrow.

Successful 7-day operation gates the rest of Phase 3.

## 2. Dependencies

| Layer | Provider | Purpose |
|-------|----------|---------|
| Shape 1 PTY adapter | `runtime/agent-runtime/pty/claude-pty.ts` (Phase 1) | Spawns the agent under `claude` with prompt on stdin |
| Telegram inbound bot | `runtime/telegram/bot.ts` (Phase 1) | Not used by this agent; bot owns inbound routing only |
| Cron scheduler (07a) | `runtime/daemon/cron-scheduler.ts` | Reads `crons.json`, fires the wake-check gate, writes the task file |
| Polling loop (07b) | `runtime/daemon/agent-manager.ts` `startPollingLoop()` | Picks up fallback task files and emits the `pr-triage-telegram-send-failed` telemetry alert |
| `gh` CLI | Installed on VPS per Phase 0 audit | Used inside `wake-check.sh` and the agent's GraphQL call |
| `gh-token` credential | 1Password `v2-gh-token` (field `token`) → systemd credstore → `process.env.GH_TOKEN` | Authenticates `gh api` calls; classic PAT, scopes `repo` + `read:org`, 90-day expiry |
| Telegram bot token | 1Password `v2-daemon-telegram-bot` → credstore → `process.env.IAGO_TELEGRAM_BOT_TOKEN` | Authenticates the direct `curl` POST to `sendMessage` |

The `gh-token` flow is the load-bearing cross-plan path:

- Plan 01a `provision-credentials.sh gh-token` reads from 1Password (`v2-gh-token`/`token`) and writes the encrypted credstore file via `systemd-creds encrypt`.
- Plan 01a `iago-os-v2-daemon.service` loads the credstore file via `LoadCredentialEncrypted=iago-gh-token:/etc/credstore.encrypted/iago-gh-token.cred`.
- Plan 01b `cred-bootstrap.ts` bridges `iago-gh-token` (filename) → `process.env.GH_TOKEN` before any daemon code runs.
- Plan 03b's cutover runbook documents the Day -1 1Password vault prep that seeds the rotation cadence.
- Plan 04b Task 2 verifies all five surfaces remain wired (this README + the four above + the cred-bootstrap test case).

Regenerate `gh-token` every 90 days:

```bash
bash runtime/deploy/provision-credentials.sh gh-token
tailscale ssh root@srv1456441 -- systemctl kill -s SIGHUP iago-os-v2-daemon.service
```

The SIGHUP handler in Plan 06 re-reads credstore without daemon restart. In-flight PTY children (if any) keep the OLD token until the next claude-pty spawn — the cron-scheduler's next tick picks up the fresh value automatically.

## 3. Configuration

Four colocated files own the agent's runtime contract:

- **`agent-config.json`** (04a Task 1) — `agentId: "pr-triage"`, `runtimeId: "claude-pty"`, `org: "internal"`, `cwd: "/opt/iago-os"`, `env: { IAGO_DAEMON_STATE_ROOT }`, `autoStart: false`, `authProfile: "default"`.
  - `autoStart: false` is intentional. The agent is spawned by the cron-scheduler on schedule match, not by the daemon's auto-start loop.
  - `autoStart` here is documentational only: the live auto-start loop in `main.ts` reads from `DaemonConfig.agents[]`, not from this file.
  - `runtimeId: "claude-pty"` pins the Shape 1 PTY adapter. Future shapes (Shape 2 stream, Shape 3 batch) would change this string but not the surrounding plumbing.

- **`crons.json`** (04a Task 2) — `schedule: "0 14 * * *"`, `wakeCheck: "runtime/agents/pr-triage/wake-check.sh"`, `prompt: "runtime/agents/pr-triage/prompt-template.md"`, `outputTaskNamePrefix: "pr-triage"`, `maxConcurrent: 1`.
  - 14:00 UTC = 09:00 EST = 06:00 PST.
  - The systemd unit pins `Environment=TZ=UTC` so the cron tick interpretation is host-timezone-agnostic.
  - `maxConcurrent: 1` prevents overlap if a slow run wedges past the next tick.

- **`wake-check.sh`** (04a Task 2 sibling) — Hermes gate. Exit 0 = there is work (≥1 open PR org-wide). Exit 1 = no work, skip the LLM call. Exit 2 = rate-limited or transient error.

- **`prompt-template.md`** (04a Task 3) — the prompt the cron-scheduler reads on every fire and writes into the task file. Contains the GraphQL query (`author:ilsantino is:pr is:open`), the four-bucket classification rules, the plain-text summary shape, and the direct-`curl` Telegram POST + fallback task-file pattern.

The `cron-scheduler` does NOT discover these files on its own — daemon-boot wiring in `runtime/daemon/main.ts` (Plan 04b Task 3) walks `runtime/agents/*/crons.json`, parses each, and calls `scheduler.registerCron(opts)` per entry.

To temporarily disable pr-triage without stopping the daemon, edit `crons.json` and set `schedule: null` (the wiring loop skips entries with `schedule: null`). Restart the daemon to apply.

## 4. Operations

**Manual invocation (test path).** Write a task file directly to `tasks/pending/` with the rendered prompt inline; the polling loop picks it up via `claimTask`. The agent runs once, exits, and the task moves to `tasks/resolved/`.

```bash
STATE_ROOT="${IAGO_DAEMON_STATE_ROOT:-/var/lib/iago-os/daemon-state}"
NOW_MS=$(date +%s%3N)
jq -n --arg prompt "$(cat runtime/agents/pr-triage/prompt-template.md)" \
  '{"agentId":"pr-triage","prompt":$prompt,"needsApproval":false}' \
  > "$STATE_ROOT/tasks/pending/pr-triage__${NOW_MS}-$$.json"
```

**Recent invocations.** Show the last week of completed runs (one per cron tick; absent days mean wake-check skipped):

```bash
ls -t "$STATE_ROOT/tasks/resolved/pr-triage__"*.json | head -7
```

**Telemetry tail.** Watch the daemon's NDJSON telemetry stream for `cron-fired`, `cron-skipped`, `task-resolved`, and `pr-triage-telegram-send-failed` events:

```bash
tail -F "$STATE_ROOT/telemetry/$(date -u +%Y-%m-%d).ndjson" \
  | grep -E '"agentId":"pr-triage"|pr-triage-telegram'
```

**Temporary disable.** Setting `agent-config.json` `autoStart: false` does NOT silence the cron (it is already `false`; auto-start and cron are orthogonal). To silence the cron, edit `crons.json` and set `schedule: null`, then reload the daemon. A `systemctl stop iago-os-v2-daemon` would also silence it but is a sledgehammer that drops every other agent.

**Credential rotation.** Run `bash runtime/deploy/provision-credentials.sh gh-token`, then `systemctl kill -s SIGHUP iago-os-v2-daemon.service`. The SIGHUP handler re-reads the systemd credstore (Plan 06); no daemon restart needed. In-flight pr-triage runs continue with the old token until the next cron tick spawns a fresh PTY.

## 5. Acceptance criteria

Verbatim from `.iago/research/2026-05-16-v2-operational-migration-scope.md` § 1 6-criterion gate:

1. The cron-scheduler fires `pr-triage` on schedule for 7 consecutive days at 14:00 UTC with no missed ticks (verifiable via the `cron-fired` telemetry stream).
2. On at least one of those days, the wake-check correctly DETECTS open PRs (exit 0) and the agent delivers exactly 1 Telegram message to Santiago's chat.
3. On at least one of those days, the wake-check correctly SKIPS the LLM invocation when there are no open PRs (exit 1) and `cron-skipped { reason: 'wake-check-failed' }` is emitted with no claude-pty spawn.
4. Crash recovery from `session.jsonl` HWM works: a mid-run claude-pty kill (SIGKILL during PTY) does not produce duplicate Telegram messages on the next tick; the agent's heartbeat-driven restart per Phase 1 resumes from the last-acknowledged checkpoint without re-sending.
5. Cost stays ≤$0.50/week once the Phase 8 ledger is active (skips drop the 7 × $0.10 = $0.70 nominal to roughly $0.30–$0.40 on quiet weeks). Phase 2 cannot verify this — it is documented as a forward gate.
6. Santiago acts on at least one delivered message during the 7-day window (merges a `merge_ready` PR, comments on a `stuck` PR, etc.). Behavioral signal — observed, not asserted by code. The Phase 6 dashboard surfaces this once it exists.

Criteria 1–3 are testable inside Phase 2. Criterion 4 is exercised by `pr-triage.test.ts` case 4 (heartbeat-restart on mid-run crash). Criteria 5 and 6 are deferred to Phase 6/8 with the rationale recorded above.

## 6. Failure modes

| Failure | Manifestation | Telemetry | Recovery |
|---------|---------------|-----------|----------|
| `gh-token` expired or revoked | `gh api` returns HTTP 401; wake-check stderr `ERROR: gh api returned non-200` | `cron-skipped { reason: "wake-check-failed", exitCode: 2 }` | Rotate via `provision-credentials.sh gh-token` + SIGHUP |
| GitHub API rate-limited | wake-check stderr `Rate-limited`; exit code 2 (distinct from generic failure per I2 carry-over) | `cron-skipped { reason: "wake-check-failed", exitCode: 2 }` | Wait one hour; the next tick retries |
| Telegram `sendMessage` returns 4xx/5xx | Agent writes fallback task at `tasks/pending/pr-triage__<unix-ms>-<pid>.json` with `ndjsonAlert: "pr-triage-telegram-send-failed"`, redacted bot token, truncated response body | Polling loop emits `pr-triage-telegram-send-failed`; file moves to `tasks/resolved/` | Investigate Telegram bot or token; next day's cron-scheduler tick still runs |
| claude-pty crash mid-run | PTY exits with non-zero before HTTP-200; agent never POSTs; heartbeat detects and restarts per Phase 1 | `agent-exited { reason: "crash" }` then `agent-spawned` | Automatic — session.jsonl HWM replay resumes from the last checkpoint |
| `IAGO_TELEGRAM_BOT_TOKEN` unset | Agent's `curl` invocation falls into the empty-recipient guard with `HTTP_STATUS=000`; fallback task written | `pr-triage-telegram-send-failed` carrying `000` status | Investigate cred-bootstrap; verify `iago-telegram-token` is in credstore |
| `IAGO_TELEGRAM_ALLOWED_USER_IDS` empty | Same empty-recipient guard fires before `curl`; fallback task written | Same as above | Set `Environment=IAGO_TELEGRAM_ALLOWED_USER_IDS=...` in the systemd unit |
| 7-day no-action by Santiago | Behavioral signal only; not a daemon-side failure | None (Phase 2); Phase 6 dashboard surfaces | Out of Phase 2 scope; informational |
| GraphQL `gh api` failure inside the agent (not wake-check) | Agent POSTs a brief failure summary to Telegram; if THAT also fails, writes `pr-triage-double-failure` fallback | `pr-triage-double-failure` via polling-loop | Investigate `gh-token` or the GraphQL query shape |

## 7. Cost

Initial estimate (no skip): $0.10 per claude-pty invocation × 7 runs/week = $0.70/week. The wake-check gate drops this by 30–50% on quiet weeks (no open PRs ⇒ no LLM call), bringing the realistic envelope to roughly $0.30–$0.50/week. The number stabilizes when the Phase 8 cost ledger lands and writes per-invocation costs to `/var/lib/iago-os/state/ledger.sqlite`. Until then, treat these figures as an upper-bound guess; do not promote pr-triage to a paid contract metric.

Tokens consumed per invocation are dominated by the GraphQL result (50 open PRs × ~600 tokens of body + comments + checks ≈ 30k input tokens, plus ~1k output tokens for the summary). Sonnet/Haiku routing is a future optimization — the prompt-template currently lets the daemon's default Anthropic profile decide.

## 8. cwd-agnostic note

(I3 carry-over from original Plan 04 stress test.) The pr-triage agent does NOT require git in its `cwd` — it uses `gh pr list --owner ilsantino` style queries (via GraphQL) which talk to the GitHub API directly and never touch a local checkout. The `cwd: "/opt/iago-os"` setting in `agent-config.json` is convenience only; the agent would behave identically with any writable directory.

This is a property of pr-triage specifically. Other agents that DO require git in `cwd` (for example, a future PR-review agent that clones the diff locally) must declare their own working directory in `agent-config.json` and the daemon will honor it at PTY spawn time. The daemon never assumes a global agent cwd; it always reads from per-agent config.

## 9. Observability

The agent's hot signals land in three places, each owned by a different layer:

- **Daemon NDJSON telemetry** (`$STATE_ROOT/telemetry/YYYY-MM-DD.ndjson`) — every `cron-fired`, `cron-skipped`, `task-resolved`, and `pr-triage-telegram-send-failed` event from the cron-scheduler + polling loop.
- **PTY session log** (`$STATE_ROOT/sessions/pr-triage/<task-id>.jsonl`) — per-invocation transcript of the claude-pty stream (prompt, model output, exit code, heartbeat ticks).
- **Sentry** (Layer A per ADR 2026-05-20) — uncaught exceptions in the wiring code (`main.ts` registerCron loop, scheduler tick handler). Telegram-send failures stay in NDJSON only; they are operational, not crashes.

PostHog dashboards (Layer B per the same ADR) ingest the NDJSON stream once Phase 6 lands. Until then, `tail -F` and `jq` are the read path.

## 10. Cross-references

- Plan 04a: ships the agent artifacts (`agent-config.json`, `crons.json`, `prompt-template.md`, `wake-check.sh`).
- Plan 04b (this plan): wires `cron-scheduler` discovery into `main.ts`, writes the integration test, ships this README.
- Plan 07a: implements `CronScheduler` (subscribed in 04b).
- Plan 07b: implements `AgentManager.startPollingLoop()` + `claimTask` (decrement chain for cron overlap prevention).
- Plan 01a: `provision-credentials.sh` (CRED_MAP entry for `gh-token`) + systemd unit `LoadCredentialEncrypted=iago-gh-token:...`.
- Plan 01b: `cred-bootstrap.ts` bridges `iago-gh-token` credstore file → `process.env.GH_TOKEN`.
- Plan 03b: cutover runbook documents the Day -1 1Password vault prep that seeds `v2-gh-token`.
- Phase 1 `claude-pty` adapter: spawns the agent process; the canonical `vi.mock("node-pty")` block in `runtime/agent-runtime/pty/claude-pty.test.ts` is the pattern reused by `pr-triage.test.ts`.
