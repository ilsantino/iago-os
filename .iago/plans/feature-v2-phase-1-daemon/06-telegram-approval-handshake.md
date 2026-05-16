---
phase: feature-v2-phase-1-daemon
plan: 06
wave: 3
depends_on: [02, 03]
context: .iago/plans/feature-v2-phase-1-daemon/CONTEXT.md
created: 2026-05-15
source: feature
---

# Plan: feature-v2-phase-1-daemon/06-telegram-approval-handshake

## Goal

Wire the Telegram control surface: one bot routes messages to agents via per-agent file-bus tagging, `appr_*` callbacks move approvals from `approvals/pending/` to `approvals/resolved/`, and the command router introspects each agent's `runtime.shape` so PTY-only commands (`/inject`) are gated to Shape 1 agents. Phase 1 commands: `/start <agent>`, `/agents`, `/approve <id>`, `/abort <agent>`, `/inject <agent> <text>` (PTY only), `/status <agent>`.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/telegram/bot.ts` | Bot initialization, polling, message routing |
| create | `runtime/telegram/commands.ts` | Command parser + per-shape command gating |
| create | `runtime/telegram/approval-bus.ts` | File-based approval handshake (pending/ → resolved/) |
| create | `runtime/telegram/bot.test.ts` | Bot routing tests with mocked Telegram API |
| create | `runtime/telegram/commands.test.ts` | Command parsing + per-shape gating tests |
| create | `runtime/telegram/approval-bus.test.ts` | Approval pending/resolved transitions |
| create | `runtime/telegram/README.md` | Bot token setup, approval handshake mechanics, per-shape command gating |

## Tasks

### Task 1: Implement approval-bus

- **files:** `runtime/telegram/approval-bus.ts`
- **action:** Export `ApprovalRequest = { approvalId: string; agentId: string; handleId: string; reason: string; createdAt: number; expiresAt?: number }`. Export `ApprovalDecision = { approvalId: string; decision: "allow" | "deny"; resolvedBy: string; resolvedAt: number }`. Export async `createApprovalRequest(req: Omit<ApprovalRequest, "approvalId" | "createdAt"> & { ttlMs?: number }): Promise<{ approvalId: string; pendingPath: string }>` that generates a UUID for approvalId, writes the request JSON to `pathFor("approvals/pending") + "/" + approvalId + ".json"`, returns the id + path. Export async `resolveApproval(approvalId: string, decision: "allow" | "deny", resolvedBy: string): Promise<{ ok: true; resolvedPath: string } | { ok: false; reason: "not-found" | "already-resolved" }>` — reads pending file (404 → not-found), writes the decision envelope to `pathFor("approvals/resolved") + "/." + approvalId + ".tmp"`, renames to `.../approvals/resolved/<approvalId>.json` atomically, then deletes the pending file. If already in resolved/, returns `{ ok: false, reason: "already-resolved" }`. Export `async waitForApproval(approvalId: string, timeoutMs: number): Promise<ApprovalDecision | { timedOut: true }>` using polling at 250ms intervals (no fs.watch — keep cross-platform simple); after `timeoutMs`, returns `{ timedOut: true }` (caller decides what to do). Export `async listPendingApprovals(): Promise<ApprovalRequest[]>` for `/status` and dashboard use.
- **verify:** `cd runtime && npx tsc --noEmit && grep -E "^export (async )?(function|const|type)" telegram/approval-bus.ts`
- **expected:** `tsc --noEmit` exits 0. Exports include `createApprovalRequest`, `resolveApproval`, `waitForApproval`, `listPendingApprovals`.

### Task 2: Write approval-bus tests

- **files:** `runtime/telegram/approval-bus.test.ts`
- **action:** Use temp-dir scaffolding. Tests: (1) `createApprovalRequest` writes file to `approvals/pending/<id>.json` with all expected fields; (2) `resolveApproval` happy path: pending file deleted, resolved file present, decision data correct; (3) `resolveApproval` on already-resolved returns `{ ok: false, reason: "already-resolved" }`; (4) `resolveApproval` on missing approvalId returns `{ ok: false, reason: "not-found" }`; (5) `waitForApproval` returns the decision once `resolveApproval` is called (use `Promise.all` to call both concurrently with a 50ms delay before resolve, assert decision returned within 1s); (6) `waitForApproval` returns `{ timedOut: true }` after `timeoutMs` elapses; (7) `listPendingApprovals` returns all written-but-unresolved approvals; (8) concurrent `resolveApproval` calls — exactly one succeeds, others return `already-resolved` (race-condition assertion via the atomic-rename). File <300 lines.
- **verify:** `cd runtime && npx vitest run telegram/approval-bus.test.ts --reporter=verbose 2>&1 | tail -15`
- **expected:** All 8 tests pass.

### Task 3: Implement command parser with per-shape gating

- **files:** `runtime/telegram/commands.ts`
- **action:** Export `Command = { name: "start"; agent: string } | { name: "agents" } | { name: "approve"; approvalId: string; decision: "allow" | "deny" } | { name: "abort"; agent: string } | { name: "inject"; agent: string; text: string } | { name: "status"; agent: string }`. Export `parseCommand(text: string): { ok: true; command: Command } | { ok: false; error: string }`. Parse rules: `/start <agent>`, `/agents`, `/approve_allow_<id>` or `/approve_deny_<id>` (callback form from inline buttons; also accept `/approve <id> allow|deny` for text form), `/abort <agent>`, `/inject <agent> <text...>` (text is everything after the agent name, joined with spaces), `/status <agent>`. Unknown command returns `{ ok: false, error: "unknown command: <cmd>" }`. Missing argument returns `{ ok: false, error: "missing argument: <name>" }`. Export `async isCommandAvailableForShape(command: Command, getShape: (agent: string) => Promise<AgentShape | null>): Promise<{ available: true } | { available: false; reason: string }>` — for commands that name an agent, look up its shape; `/inject` is available only when `shape === "pty"` (Phase 1 — Shape 1 is the only shape registered anyway, but the gating logic must be in place for Phase 3+); other commands are available for all shapes. If `getShape` returns null (agent not registered), return `{ available: false, reason: "agent not registered: <name>" }`. Document Phase 1 vs Phase 3+ command matrix in JSDoc.
- **verify:** `cd runtime && npx tsc --noEmit && grep -E "^export (async )?(function|const|type)" telegram/commands.ts`
- **expected:** `tsc --noEmit` exits 0. Exports include `Command`, `parseCommand`, `isCommandAvailableForShape`.

### Task 4: Write command parser tests

- **files:** `runtime/telegram/commands.test.ts`
- **action:** Tests for `parseCommand`: (1) `/start agent-foo` → `{ name: "start", agent: "agent-foo" }`; (2) `/agents` → `{ name: "agents" }`; (3) `/approve_allow_abc123` → `{ name: "approve", approvalId: "abc123", decision: "allow" }`; (4) `/approve_deny_xyz` → `{ name: "approve", approvalId: "xyz", decision: "deny" }`; (5) `/approve abc deny` → text-form same result; (6) `/abort agent-foo` → abort command; (7) `/inject agent-foo hello world` → `{ name: "inject", agent: "agent-foo", text: "hello world" }`; (8) `/status agent-foo` → status command; (9) `/start` (missing agent) → `{ ok: false, error: "missing argument: ..." }`; (10) `/unknown` → `{ ok: false, error: "unknown command: ..." }`; (11) `/inject agent-foo` (missing text) → `{ ok: false, error: "missing argument: text" }`. Tests for `isCommandAvailableForShape`: (12) `/inject` on a PTY agent returns `{ available: true }`; (13) `/inject` on an HTTP agent returns `{ available: false, reason: ... }` (mock getShape to return "http" for the test); (14) `/start` is available for any shape (test with all 5 shapes via parameterized `it.each`); (15) `/inject` on an agent that getShape returns null for returns `{ available: false, reason: "agent not registered: ..." }`. File <350 lines.
- **verify:** `cd runtime && npx vitest run telegram/commands.test.ts --reporter=verbose 2>&1 | tail -20`
- **expected:** All 15 tests pass.

### Task 5: Implement Telegram bot

- **files:** `runtime/telegram/bot.ts`
- **action:** Add `node-telegram-bot-api: "^0.65.0"` and `@types/node-telegram-bot-api: "^0.64.0"` to runtime/package.json. Export `TelegramBot` class. Constructor: `constructor(opts: { token: string; allowedUserIds: number[]; agentManager: { getHandle, listHandles, shutdownAgent, restartAgent, getShape: (agent: string) => Promise<AgentShape | null> }; injectIntoAgent: (agentId: string, text: string) => Promise<void> })`. Method `async start(): Promise<void>` — initializes `TelegramBot` from node-telegram-bot-api with polling enabled. Method `async stop(): Promise<void>` — stops polling. On every incoming message: (1) check `msg.from.id` is in `allowedUserIds` — if not, ignore silently AND log the rejection to stderr; (2) parse command via `parseCommand`; (3) if parse fails, reply with the error; (4) gate via `isCommandAvailableForShape` — if unavailable, reply with the reason; (5) dispatch: `start` → reply with placeholder ("Phase 1 hello-world — agent must be pre-registered in config"); `agents` → list all handles from `agentManager.listHandles()` with `shape`, `agentId`, `lastStatus`; `approve` → call `resolveApproval(approvalId, decision, msg.from.username || msg.from.id.toString())`, reply with confirmation; `abort` → call `agentManager.shutdownAgent(handle.id, "SIGTERM")`, reply confirmation; `inject` → call `injectIntoAgent(agent, text)`, reply confirmation; `status` → return alive state + last status + pending approvals filtered to that agent. Approval handshake — when an agent requests approval, emit an inline-keyboard message with two buttons `Allow` (callback `approve_allow_<id>`) and `Deny` (callback `approve_deny_<id>`). Method `async sendApprovalRequest(chatId: number, req: ApprovalRequest): Promise<void>` — sends the message with inline keyboard. Handle callback queries — when an `appr_*` (or `approve_allow_*` / `approve_deny_*`) callback arrives, parse via `parseCommand`, dispatch as `approve` command. Emit telemetry events for all command dispatches (`approval-requested`, `approval-resolved` at minimum). All exceptions caught at the dispatch level — bot MUST NOT crash on user input.
- **verify:** `cd runtime && npm install && npx tsc --noEmit && grep -E "^export (class|const)" telegram/bot.ts`
- **expected:** `tsc --noEmit` exits 0. `TelegramBot` class exported.

### Task 6: Write Telegram bot tests

- **files:** `runtime/telegram/bot.test.ts`
- **action:** Mock `node-telegram-bot-api` via `vi.mock`. Build a fixture bot with controllable `.onMessage`/`.onCallbackQuery`/`.sendMessage` behaviors. Mock `agentManager` with vi-fn stubs. Tests: (1) message from non-allowed user is ignored (sendMessage not called); (2) `/agents` command from allowed user calls `agentManager.listHandles` and replies; (3) `/inject agent-foo hello` on a PTY agent calls `injectIntoAgent("agent-foo", "hello")`; (4) `/inject agent-foo hello` on an HTTP agent (mock getShape to return "http") replies with rejection; (5) callback query `approve_allow_<id>` calls `resolveApproval(id, "allow", ...)`; (6) `sendApprovalRequest` emits a message with inline_keyboard containing two buttons; (7) malformed command replies with error message, does NOT crash; (8) thrown exception in `injectIntoAgent` is caught — bot still replies with an error message; (9) telemetry events emitted for `approval-requested` and `approval-resolved` (assert via `vi.spyOn(telemetry, "emit")`); (10) `stop()` halts polling — subsequent simulated messages NOT dispatched. File <450 lines.
- **verify:** `cd runtime && npx vitest run telegram/bot.test.ts --reporter=verbose 2>&1 | tail -20`
- **expected:** All 10 tests pass.

### Task 7: Write Telegram README

- **files:** `runtime/telegram/README.md`
- **action:** Document: (1) Purpose — "Telegram control surface: one bot routes commands to agents via per-agent file-bus tagging; approval handshake via file moves pending/ → resolved/"; (2) Bot token setup — create via BotFather, set `IAGO_TELEGRAM_BOT_TOKEN` env var; allowedUserIds restricted to Santiago's Telegram user ID (`IAGO_TELEGRAM_ALLOWED_USER_IDS` env var, comma-separated); (3) Approval handshake mechanics — agent calls `createApprovalRequest()`, bot picks up via `listPendingApprovals` poll OR direct call from agent code, sends inline-keyboard message to allowed user, user taps Allow/Deny, callback fires `resolveApproval()`, agent's `waitForApproval` unblocks; (4) Per-shape command gating — Phase 1 supports `/inject` only on Shape 1 (PTY) agents; `/send <agent> <message>` lands in Phase 3 for non-PTY shapes; the router introspects `runtime.shape` via `agentManager.getShape()` and rejects unsupported commands per-shape; (5) Command reference for Phase 1 — exhaustive list with examples; (6) Security model — `allowedUserIds` is a hard allowlist; non-allowed users are ignored silently (logged to stderr but not replied to, to avoid info leakage); bot token MUST live in env var, never in code; in production (Phase 2 VPS) the token is provisioned via systemd `LoadCredential=` per ADR — see `.iago/decisions/2026-05-15-agent-shape-taxonomy.md`; (7) Failure modes — Telegram API outage (bot polling retries with backoff; commands queue), unknown callback ID (silent ignore + stderr log), agent not registered (`{ available: false, reason: "agent not registered" }` reply). File 150-220 lines.
- **verify:** `wc -l runtime/telegram/README.md && grep -c "^##" runtime/telegram/README.md`
- **expected:** Line count 150-220. Heading count ≥7.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-15

### Important precision + missing criteria

- **PR1 (RESOLVED 2026-05-15 PM) — Per-agent file-bus tagging form locked.** Santiago decision 2026-05-15 PM: canonical form is **`tasks/{pending,claimed,resolved}/<agentId>__<taskId>.json`** with double-underscore (`__`) as the prefix separator. Rationale: agents `fs.readdir` and filter on filename prefix without parsing every JSON; file-bus stays agentId-agnostic (taskId is the full filename minus `.json` from the file-bus's perspective). Implementer notes: (a) Plan 02 file-bus.ts `claimTask` accepts the full `taskId` (e.g., `"agent-claude__abc-123"`) as an opaque string; the file-bus does NOT parse it. (b) Plan 06 telegram/bot.ts writes tasks with names like `<targetAgentId>__<crypto.randomUUID()>.json`. (c) Agents (Plan 04 claude-pty or any future adapter) discover their tasks by `fs.readdir(tasks/pending/)` and filter `name.startsWith(myAgentId + "__")`. (d) `__` MUST appear in `agentId` validation as a forbidden substring (agentIds cannot contain `__` or `/` — add to a `validateAgentId()` helper in `runtime/daemon/state-paths.ts`). Document in `runtime/telegram/README.md` AND `runtime/daemon/README.md` AND `runtime/agent-runtime/README.md` (Plan 01 — adapter authors must know this when designing task-discovery loops). This decision is now LOCKED — implementer applies without further question.
- **PR2 (Important) — `chatId` source for `sendApprovalRequest` undocumented.** `TelegramBot` constructor takes `allowedUserIds` but not `chatId`. **Fix:** in `loadConfig` (Plan 07), if `IAGO_TELEGRAM_CHAT_ID` is set use it; otherwise default to `allowedUserIds[0]`. Plumb `chatId` into TelegramBot constructor. Document in README.
- **PR3 (Important) — Callback format collision: `appr_*` vs `approve_allow_*`.** **Fix:** pick `approve_allow_<id>` / `approve_deny_<id>` (matches parseCommand). Inline-keyboard `callback_data` uses this form. Drop the `appr_*` legacy passthrough; document in README that `appr_*` was the cortextOS upstream form, iaGO renames to `approve_*` for clarity. Add comment in commands.ts citing the rename.
- **MC1 (Important) — Agent → bot wiring missing.** When agent code calls `createApprovalRequest()`, who actually sends the Telegram message? **Fix:** Plan 07 main.ts wires this: spawn a bot-side poller (250ms) on `listPendingApprovals()`; for each new pending approval not yet broadcast, the bot calls `sendApprovalRequest(chatId, req)`. Track broadcast state via a `Set<approvalId>` in memory + on disk in `pathFor("approvals/pending") + "/." + approvalId + ".sent"` marker (file-presence-based dedupe). Add to Plan 07 Task 2 the wiring step + a test in Plan 07 Task 3 that asserts the bot's mocked `sendApprovalRequest` was called.

### Minor

- M1 — `waitForApproval` poll interval is hardcoded 250ms. Make it a constructor option with 250ms default; tests use shorter intervals.
- M2 — Allow-then-Deny race: atomic rename means first tap wins. Document in README explicitly.
- M3 — Telegram polling outage during `waitForApproval`: caller responsible for handling `timedOut`; document expected cleanup (call `resolveApproval(id, "deny", "system-timeout")` or leave for `listPendingApprovals` ghost detection).
- M4 — `node-telegram-bot-api` vs `grammy`: keep `node-telegram-bot-api` for battle-tested stability; document tradeoff one-liner. If TS friction surfaces in Phase 6 dashboard wiring, reconsider.
- M5 — `/start <agent>` placeholder: add JSDoc forward-reference: "Phase 1 = pre-registered agents only; dynamic spawn lands in Phase 3 with the AgentRuntime registry's full multi-shape support."

### Implementer forward-list

1. ~~Define canonical file-bus tagging form~~ LOCKED 2026-05-15 PM — `tasks/{pending,claimed,resolved}/<agentId>__<taskId>.json`. File-bus signatures (Plan 02) NOT changed; `taskId` is opaque + may contain `__`. Apply per PR1 resolution and 2nd-pass stress notes below.
2. Plumb `chatId` via env var + `allowedUserIds[0]` fallback — see PR2.
3. Canonicalize callback form to `approve_allow_*` / `approve_deny_*`; drop `appr_*` — see PR3.
4. Plan 07 main.ts adds the bot-side approval poller wiring + dedupe marker — see MC1.
5. Configurable poll interval — see M1.
6. Document Allow-then-Deny semantics — see M2.

### 2nd-pass stress notes (2026-05-15 PM)

- **`approval-bus.ts` (Task 1) MUST use the `atomicRename(src, dst)` helper from Plan 02** for the `pending/.<id>.tmp → pending/<id>.json` initial write AND the `pending → resolved` rename. Direct `fs.promises.rename` fails on Windows when the target exists. Cross-plan dependency: Plan 02's atomicRename helper is the single source of truth.
- **`bot.ts` (Task 5) MUST validate the target agentId via `validateAgentId()` (Plan 02) before writing tagged tasks.** Reject the command with a clear Telegram reply on invalid agentId (e.g., `/inject AGENT-WITH-CAPS hello` → "Invalid agent id. Must match `^[a-z][a-z0-9-]{0,62}$` and exclude reserved names.").
- **`bot.ts` (Task 5) MUST use `crypto.randomUUID()` for taskIds.** Filename form: `${targetAgentId}__${crypto.randomUUID()}.json`. Document in JSDoc.
- **`bot.ts` (Task 5) — `kind: "approval"` is NOT actively dispatched.** The bot does NOT call `runtime.send(handle, { kind: "approval", ... })`. The active approval path is file-bus: `resolveApproval()` moves `approvals/pending/ → approvals/resolved/`; the agent's `waitForApproval` polling loop picks it up. The `approval` kind on `AgentRuntime.send()` is a reserved future channel — document this in `runtime/telegram/README.md` § approval handshake. Add a comment in `bot.ts` callback handler: "We resolve the approval via file-bus; we do NOT push via `runtime.send`. See ADR § AgentMessage typing — `approval` is RESERVED."

## Verification

```bash
cd runtime && npm install && npx tsc --noEmit && npx vitest run telegram/ --coverage 2>&1 | tail -25
```

Expected:
- `tsc --noEmit` exits 0
- Vitest: `33 passed` (8 + 15 + 10)
- Coverage on `approval-bus.ts`, `commands.ts`, `bot.ts` each ≥80% lines
- `node-telegram-bot-api` listed in `runtime/package.json` dependencies
