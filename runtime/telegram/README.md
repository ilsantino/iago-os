# runtime/telegram — Telegram control surface

## Purpose

One Telegram bot routes commands to N agents via per-agent file-bus
tagging. Tagged tasks live at
`tasks/{pending,claimed,resolved}/<agentId>__<taskId>.json`, where `__`
is the prefix separator and `taskId` is opaque to the file-bus (Plan 02
`claimTask` accepts the full filename as a single string).

Approval handshake is file-based: `createApprovalRequest()` writes to
`approvals/pending/<id>.json`; `resolveApproval()` atomically moves the
request to `approvals/resolved/<id>.json` and deletes the pending file.
The agent's `waitForApproval()` polling loop picks the decision up.

## Bot token setup

1. Create a bot with [@BotFather](https://t.me/BotFather): `/newbot` →
   provide a display name → record the token.
2. Set `IAGO_TELEGRAM_BOT_TOKEN` to the token. Never commit the token
   to git, never log it. In Phase 2 (Hostinger VPS) the token is
   provisioned via systemd `LoadCredential=` per the ADR — see
   `.iago/decisions/2026-05-15-agent-shape-taxonomy.md`.
3. Set `IAGO_TELEGRAM_ALLOWED_USER_IDS` to a comma-separated list of
   Telegram user IDs permitted to send commands. Discover your user ID
   by sending any message to [@userinfobot](https://t.me/userinfobot).
   Phase 1 typically holds a single ID (Santiago's).
4. Optional: `IAGO_TELEGRAM_CHAT_ID` overrides the chat that
   `sendApprovalRequest` broadcasts to. If unset, the first entry in
   `IAGO_TELEGRAM_ALLOWED_USER_IDS` is used as the chat ID — the
   typical case where the allowed user's private chat is also the
   notification chat.

## Approval handshake mechanics

The bot does NOT push approvals via `runtime.send({ kind: "approval",
... })`. The `approval` kind on `AgentRuntime.send()` is a RESERVED
future channel. The active path is the file-bus.

End-to-end flow:

1. Agent code calls `createApprovalRequest({ agentId, handleId,
   reason })`. The helper writes
   `approvals/pending/<approvalId>.json` (atomic write via tmp + nonce
   suffix + rename) and returns the `approvalId`.
2. The daemon's bot-side poller (Plan 07) calls
   `listPendingApprovals()` every 250 ms. For each pending approval
   not yet broadcast, it calls `bot.sendApprovalRequest(chatId,
   request)`. A presence-based dedupe marker
   (`approvals/pending/.<approvalId>.sent`) prevents re-broadcast
   across restarts.
3. `sendApprovalRequest` emits an inline-keyboard message with two
   buttons: **Allow** (`callback_data: approve_allow_<id>`) and
   **Deny** (`callback_data: approve_deny_<id>`).
4. The user taps a button. Telegram fires a `callback_query` event.
   The bot's callback handler parses the `callback_data` via
   `parseCommand` and dispatches the `approve` command.
5. `resolveApproval(approvalId, decision, resolvedBy)` writes
   `approvals/resolved/<approvalId>.json` and deletes the pending
   file. The atomic claim point is `fs.unlink(pendingPath)` — only
   one caller wins; concurrent losers see `ENOENT` / `EPERM` /
   `EBUSY` and return `{ ok: false, reason: "already-resolved" }`
   after a brief poll for the resolved file.
6. The agent's `waitForApproval(approvalId, timeoutMs)` poll (250 ms
   default) detects the resolved file and returns the
   `ApprovalDecision`.

Allow-then-Deny race: the atomic claim point (`fs.unlink` of the
pending file) guarantees first-tap-wins. The second tap returns
`{ ok: false, reason: "already-resolved" }` to the user.

`waitForApproval` returning `{ timedOut: true }` is the caller's
responsibility — the agent should either escalate (call
`resolveApproval(id, "deny", "system-timeout")` to free the slot) or
leave the pending file for the `listPendingApprovals` ghost-detection
sweep.

## Per-shape command gating

Phase 1 supports exactly one agent shape: `pty`. The gating logic is
nevertheless in place so Phase 3+ adapters (HTTP, MCP, event, daemon)
land without a routing rewrite.

`isCommandAvailableForShape(command, getShape)` introspects the
target agent's shape and returns a `{ available: true }` or
`{ available: false, reason: "..." }` verdict. The bot rejects with
the reason string before invoking any side-effecting handler.

| Command         | PTY | HTTP / MCP / event / daemon | Notes                              |
|-----------------|-----|-----------------------------|------------------------------------|
| `/start`        | ✓   | ✓                           | Phase 1 placeholder                |
| `/agents`       | ✓   | ✓                           | Global — never calls `getShape`    |
| `/approve`      | ✓   | ✓                           | Global — never calls `getShape`    |
| `/abort`        | ✓   | ✓                           | Requires registered agent          |
| `/inject`       | ✓   | ✗                           | PTY-only; non-PTY → use `/send`    |
| `/status`       | ✓   | ✓                           | Requires registered agent          |
| `/send` (P3+)   | ✗   | ✓                           | Not implemented in Phase 1         |

`/inject` writes to the PTY adapter's stdin via the `injectIntoAgent`
callback that the daemon supplies. The bot itself does NOT know how
to drive any specific shape — the wiring is the daemon's job.

Callback-form rename: the cortextOS upstream uses `appr_*` callback
IDs. iaGO renames to `approve_allow_*` / `approve_deny_*` for
clarity and to match the text-form `/approve` command. Inline
keyboards MUST emit the `approve_*` form. The legacy `appr_*` form is
NOT accepted.

## Command reference (Phase 1)

| Command                  | Example                       | Result                                                                                          |
|--------------------------|-------------------------------|--------------------------------------------------------------------------------------------------|
| `/start <agent>`         | `/start claude`               | Phase 1 placeholder — agents must be pre-registered in config. Dynamic spawn lands in Phase 3.   |
| `/agents`                | `/agents`                     | Lists every registered handle: `agentId`, `handleId`, `shape`.                                   |
| `/inject <agent> <text>` | `/inject claude run tests`    | PTY-only. Calls `injectIntoAgent(agent, text)`. Validates `agentId` via `validateAgentId()` first. |
| `/approve <id> <verdict>`| `/approve abc123 allow`       | Text-form alternative to inline-keyboard buttons.                                                |
| `/approve_allow_<id>`    | (inline button)               | Callback-form approval allow. Emitted by `sendApprovalRequest`.                                  |
| `/approve_deny_<id>`     | (inline button)               | Callback-form approval deny.                                                                     |
| `/abort <agent>`         | `/abort claude`               | Calls `agentManager.shutdownAgent(handleId, "SIGTERM")`.                                         |
| `/status <agent>`        | `/status claude`              | Reports handle state + pending approvals filtered to that agent.                                 |

Invalid `agentId`: an agentId must match `^[a-z][a-z0-9-]{0,62}$` and
exclude reserved substrings (`__`, `/`, reserved names — see
`runtime/daemon/state-paths.ts` `validateAgentId()`). `/inject
AGENT-WITH-CAPS hi` is rejected with a clear message before any side
effect runs.

## Security model

- **Allowlist.** `allowedUserIds` is a hard allowlist enforced on
  every incoming message AND every `callback_query`. Non-allowed users
  are ignored silently (bot does NOT reply — avoids info leakage
  about the bot's existence). Rejections are counted per-process and
  logged with a counter (NOT user id / username — those are PII
  that persists in journald on VPS deploys). Empty allowlist is
  rejected at startup with `RangeError` (no silent dead-bot mode).
- **Private-chat only.** Every incoming message AND every
  inline-keyboard callback is gated on `chat.type === "private"`.
  Group / supergroup / channel chats are dropped silently with a
  counter. Reasoning: an allowlisted user can be added to a group
  chat with the bot; without this gate, `/agents` or `/status`
  replies would broadcast agent topology, handle IDs, and pending
  approvals to every group member.
- **Bot token.** Lives in `IAGO_TELEGRAM_BOT_TOKEN` env var, NEVER in
  code, NEVER in git, NEVER in logs. The bot wraps the token in an
  opaque object with a `util.inspect.custom` redactor so
  `console.dir(bot)`, `JSON.stringify(bot)`, and stack-trace dumps
  emit `[REDACTED]` instead of the secret. Phase 2 VPS deploy uses
  systemd `LoadCredential=`. Rotation procedure: see `.env.example`.
- **Callback_data.** Treated as untrusted input. The bot parses it via
  `parseCommand` (same path as message text). `approvalId` arguments
  (text-form `/approve` and callback-form `approve_*_<id>`) are
  validated against the strict UUID v4 regex
  (`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
  to close the path-traversal surface in `resolveApproval` (an
  unvalidated id with `..` would let an allowlisted user delete or
  overwrite arbitrary files under the daemon state root).
- **Agent IDs.** The bot validates target `agentId` against
  `validateAgentId()` before writing tagged file-bus tasks or
  invoking `injectIntoAgent`. This prevents filesystem escape
  (`../../etc/passwd`) and reserved-name collisions. Reflected
  agent-id strings in error messages are truncated to 64 chars
  (defense-in-depth against phishing-in-chat-history).
- **`/inject` payload sanitization.** Text forwarded to PTY stdin is
  stripped of ASCII / C1 control bytes (Ctrl-C `\x03`, Ctrl-D `\x04`,
  DEL `\x7f`, OSC 52 `\x1b]52`...) — tab, newline, carriage-return
  retained. Length capped at 4096 bytes (Telegram's per-message
  limit). Without this sanitization an allowlisted user could
  drive arbitrary terminal-control sequences into the running TUI.
- **`sendApprovalRequest` chat re-check.** The caller-supplied
  `chatId` is re-validated against the allowlist before send; an
  attacker who plumbs a hostile chatId cannot redirect approval
  prompts away from Santiago.
- `kind: "approval"` on `AgentRuntime.send()` is RESERVED and NOT
  currently dispatched. Only the file-bus path is active.

## Failure modes

- **Telegram API outage.** `node-telegram-bot-api` polling retries
  with internal backoff; commands queue on the Telegram side until
  the bot reconnects. The bot is idempotent — a re-delivered message
  re-runs the same dispatch logic.
- **Unknown callback ID.** Parses as an `approve` command targeting
  a non-existent `approvalId`; `resolveApproval` returns
  `{ ok: false, reason: "not-found" }`; the bot replies with the
  reason. Logged to stderr for operator visibility.
- **Agent not registered.** `isCommandAvailableForShape` returns
  `{ available: false, reason: "agent not registered: <name>" }`;
  the bot replies with that string before any side effect runs.
- **`injectIntoAgent` throws.** Caught in `dispatchInject`; bot
  replies with `Inject failed: <message>` and continues serving
  other commands. The bot MUST NOT crash on any user input.
- **`waitForApproval` timeout.** Caller-responsibility — see
  approval handshake section above.
- **Race on concurrent approval taps.** Atomic-claim semantics in
  `resolveApproval` guarantee first-tap-wins. The loser sees
  `already-resolved`.
- **Cross-platform atomic rename.** `approval-bus` uses tmp + nonce
  suffix + rename for the resolved-file write. On Windows,
  concurrent renames to the same destination can raise EPERM —
  treated the same as ENOENT / EBUSY (race-loser).
- **Multi-bot HTTP 409.** Telegram allows exactly ONE polling client
  per token. If the daemon is started twice, or if OpenClaw still
  polls the same token during Phase 2 cutover, `getUpdates` returns
  409 and `node-telegram-bot-api` emits `polling_error`. The bot
  registers a `polling_error` handler that logs to stderr. Mitigation
  for cutover: revoke the OpenClaw token via BotFather and provision
  a fresh one for the v2 daemon. Phase 2+ will switch to webhook
  delivery to eliminate this hazard entirely.
- **Approval crash recovery.** `resolveApproval` uses a three-phase
  no-strand sequence: rename pending → inflight, durably write
  resolved, then unlink inflight. A crash between phases (b) and (c)
  leaves a recoverable inflight file. `listInflightApprovals()`
  surfaces these on next boot for daemon-level reconciliation.

## Library choice

`node-telegram-bot-api` is preferred over `grammy` for Phase 1: it is
the most battle-tested Telegram bot library in the Node ecosystem
and the cortextOS upstream uses it too. The tradeoff is weaker
TypeScript inference (uses CommonJS `export =` pattern). If
TypeScript friction surfaces in Phase 6 dashboard wiring, the
library choice may be reconsidered.
