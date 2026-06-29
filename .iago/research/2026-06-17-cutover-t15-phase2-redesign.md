# Cutover T+15 acceptance — Phase 2 redesign (follow-up)

**Status:** ACCEPTED (2026-06-29, Santiago) — the Phase-2 cutover-acceptance
definition below is approved. Daemon liveness (`systemctl is-active` + exactly
one `iago`-owned daemon process) and bot reachability (`/agents` reply) now fail
closed BEFORE the irreversible T+30 WhatsApp deauth (enforced in
`runtime/deploy/cutover.sh` §T+15, re-asserted at §T+30 for resumed runs). The
pr-triage **workflow-execution** proof is deliberately deferred to the first
post-cutover 14:00 UTC cron tick — a forward-fix path, NOT rollback-covered.
This residual is physically unavoidable: pr-triage is a cron-driven,
`autoStart:false` agent, so there is no live registration to verify
synchronously at cutover time. PR #98's dual-adversarial gate will keep flagging
the residual as Critical; that is the accepted tradeoff, not an open defect.
**Raised by:** PR #98 (plan 05a evidence template) dual-adversarial gate, round 6
(Critical). **Owner:** Santiago. **Created:** 2026-06-17. **Decided:** 2026-06-29.

## Problem

The Phase 2 cutover machinery gates an **irreversible** action (T+30 WhatsApp
deauth) on a Telegram "canonical workflow end-to-end test" that **Phase 2 cannot
perform**:

- `02-cutover-runbook.md` T+15 (and `runtime/deploy/cutover.sh` §T+15, lines
  ~621-625) drive a 5-step IPC sequence: `/agents` → `/start hello-world`
  (dynamic spawn) → `/sessions` → free-form reply → `/stop <id>`.
- In Phase 2: `/start <agent>` is a **Phase-1 placeholder** (replies "Dynamic
  spawn lands in Phase 3" — `runtime/telegram/bot.ts`); `/sessions` and `/stop`
  **do not exist** in the command parser (`runtime/telegram/commands.ts` supports
  only `start/agents/approve/abort/inject/status`).
- The runbook made a 60s no-ack on `/start hello-world` a **ROLLBACK TRIGGER**
  and listed "T+15 canonical 5-step IPC sequence passed end-to-end" as an
  **ACCEPTANCE GATE** item before the one-way WhatsApp deauth.

Net: a healthy Phase 2 cutover would either roll back on impossible evidence or
stall the gate. The real Phase 2 "migrated workflow" is **pr-triage**
(cron-driven at 14:00 UTC), not a `/start hello-world` spawn.

## What PR #98 already did (safety neutralization, NOT the redesign)

To stop the runbook from mandating impossible evidence, PR #98:

- **Suspended** the 5-step sequence in `02-cutover-runbook.md` T+15 as a Phase 2
  gate (marked Phase-3, with a pointer here).
- Replaced the T+15 gate with the **producible** Phase 2 subset: bot replies to
  `/agents` (lists the pr-triage handle) + `systemctl is-active` = active +
  exactly one `iago`-owned daemon process. The Phase-2 rollback trigger is now
  "bot unreachable OR daemon not active".
- Updated the ACCEPTANCE GATE item accordingly.

`runtime/deploy/cutover.sh` §T+15 was **safety-neutralized in PR #98 too**
(round 7): the impossible 5-step `cat`/`read_or_skip` block was replaced with the
producible `/agents` reachability check, matching the runbook (the runbook and
the executable must agree — leaving one broken contradicts the other). The full
pr-triage acceptance test (and any deeper `cutover.sh` changes) remain this
follow-up's work.

## The redesign (this follow-up)

Decide and implement the **real** Phase 2 cutover-acceptance test, exercising the
actual migrated workflow:

1. **Acceptance definition (needs Santiago):** what proves "Phase 2 cutover
   succeeded"? Proposed: (a) daemon active under systemd as `iago`; (b) bot
   reachable (`/agents`); (c) OpenClaw gone; (d) the **pr-triage cron workflow**
   completes one real dispatch — verified at the next 14:00 UTC tick via the
   telemetry NDJSON (`cron-fired` → `agent-spawned` → `task-claimed`/`-resolved`
   → `agent-exited`, or `cron-skipped` on a zero-PR day) and the resolved
   `pr-triage-send__*.json` envelope. Because the cron is time-based, the
   workflow proof is **post-cutover** (next tick), not a synchronous T+15 gate.
2. **`cutover.sh` §T+15:** the impossible 5-step block is already removed
   (PR #98 safety fix → producible `/agents` reachability). The redesign adds the
   real pr-triage end-to-end test here (and may re-introduce a producible
   synchronous rollback trigger).
3. **Rollback triggers:** re-scope the canonical-workflow rollback trigger to the
   producible signals (bot unreachable / daemon inactive / journal errors), and
   define how a **post-cutover** pr-triage failure (after the irreversible deauth)
   is handled (it is no longer rollback-covered — likely a forward-fix path).
4. **Optional:** if a synchronous end-to-end agent test is wanted at T+15,
   implement a Phase-2-legal trigger (e.g. a manual cron kick / file-bus task
   drop that pr-triage claims) rather than `/start` dynamic spawn.

## Cross-refs

- Producible Phase 2 Telegram surface + the block (f) fix:
  `runtime/PHASE-2-EVIDENCE.md` block (f).
- Telemetry kind contracts: `runtime/integration/phase-2-vps.fixtures/expected-events.json`.
- Plan 05b will ship the machine acceptance checker/E2E
  (`.iago/plans/feature-phase-2-vps-bootstrap/05b-evidence-checker-and-e2e.md`).
