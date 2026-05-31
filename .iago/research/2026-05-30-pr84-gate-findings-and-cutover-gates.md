# PR #84 — Dual-Adversarial Gate Findings & Pre-Cutover Gates

_2026-05-30. Three dual-adversarial passes (Opus 4.8 ∥ Codex GPT-5.5 + security/completeness/tests lenses) on the pr-triage + credential-hardening PR. Records what was fixed inline, and the residual items that are **pre-cutover hardening / architectural decisions** — NOT cheap reconciliations — so the fix→gate loop was stopped here per a pre-stated condition. The daemon is **not yet deployed**, so none of the residuals is a live incident._

## Trajectory
- **Re-gate #1:** 1 Critical (non-atomic pr-triage producer poisons the new consumer) + 5 Important + Minors → **all fixed** (commit 1bcad0f).
- **Re-gate #2:** 0 Critical + 3 Important (GH-PAT redaction targeted the wrong token; composeAgentEnv allowlist untested; alert filename-provenance) + Minors → **all fixed** (commit 1d02fec). Genuine GPT-5.5 cross-model leg ran.
- **Re-gate #3:** surfaced a **NEW pre-existing Critical** + a **NEW PR84-introduced architectural Important** (below). Loop stopped — these need design/decision, not another inline round.

## Residual — REQUIRES A DECISION / DEDICATED WORK

### R1 — Secret-in-LLM-shell prompt-injection exfil (Important) — **PR84-INTRODUCED — Santiago decision**
- **What:** PR84's `composeCronAgentEnv` + `CRON_AGENT_ENV_ALLOWLIST` inject the long-lived `GH_TOKEN` (PAT, `repo`+`read:org`) and `IAGO_TELEGRAM_BOT_TOKEN` into the pr-triage agent's **PTY shell**. The same agent's prompt pulls PR `body` + `comments.nodes[].body` (third-party-writable). The LLM processes untrusted text in a shell that can read both secrets; the prompt's "Never echo" line is **not** a trust boundary. A hostile PR comment crafted as a prompt-injection payload could coax the model into emitting the secret value to an attacker-controlled endpoint, or into unauthorized GitHub/Telegram actions.
- **Provenance:** `CRON_AGENT_ENV_ALLOWLIST`/`composeCronAgentEnv`/`GH_TOKEN`-in-main = **0 on origin/main** → PR84 materially creates this. (Before PR84 the PTY adapter forbade `process.env` merge.)
- **Why it's not "just fix it":** the agent *needs* GH/Telegram creds to do its job. The fix is **architectural** — either (a) perform GitHub/Telegram calls in **daemon-owned code** and pass only sanitized results into the prompt, or (b) issue **short-lived, narrowly-scoped** creds the shell cannot exfiltrate usefully. Both are real redesigns of the credential-delivery path. May relate to the CEO-approved "Option A" secret-handling decision.
- **Cutover-gate framing:** not exploitable until the daemon runs AND scans a malicious comment → a **hard cutover gate**, consistent with G3 (at-rest encryption) and the boot-recovery deferral.

### R2 — Cron-agent crash-restart pins dispatch to the dead handle (Critical) — **PRE-EXISTING on main**
- **What:** on `exited`/`crashed`, the crashed handle is not torn down before `scheduleRestart()` re-registers; `assertAgentIdAvailable` only rejects on org-mismatch, so a same-org re-register **adds a 2nd handle** without removing the dead one. `findHandleForAgent` returns the **first** (dead) handle → every post-restart dispatch `runtime.send(deadHandle)` no-ops despite a `cron-agent-restarted` event. pr-triage can be permanently down after one PTY crash until manual cleanup.
- **Provenance:** `registerCronAgentWithRestart` + `handleStatusChange` + `teardown` all **pre-exist on origin/main** — PR84 only touched the function for backoffMs/env. So this is a pre-existing daemon-lifecycle bug, not a PR84 regression (though PR84's restart path exercises it).
- **Fix:** teardown/remove the terminal handle before re-registering, OR maintain an `agentId → current-handle` index that skips terminal generations; + a regression test that dispatches a task AFTER a crash-restart and asserts it reaches the NEW handle.

## Residual — Minor (defense-in-depth / acceptable per reviewer)
- `umask 0077` is set mid-script and unrestored, and (in the agent-first-run path) AFTER `mkdir -p pending/` — move it before the mkdir / scope it in a subshell. Bounded: `ensureStateDirsSync` pre-creates dirs 0700 in normal operation.
- Secret redaction interpolates the token UNESCAPED into the `sed` BRE pattern — safe for current PAT/Telegram charsets (no `|`/BRE metachars), latent fragility if a future credential type differs. Escape or use fixed-string match.
- `PR1 lastStatusChangeMs` heartbeat test is flaky under the concurrent Windows suite (passes in isolation, 72ms; times out under CPU starvation) — pre-existing cold-Windows flakiness class; re-run on Linux CI or `--no-file-parallelism`.

## What was FIXED inline (merge-safe regardless of R1/R2 decision)
Atomic pr-triage producer (`.tmp`+`mv`, both paths) + consumer grace-tick; `persistAgentConfig` temp-file+atomicRename at 0o600; `ensureStateDirsSync` chmod 0o700 every call; agent-alert doc reconciled; GH-PAT + Telegram redaction on the double-failure path; `composeCronAgentEnv` allowlist gate + tests; alert filename-provenance guard + test; main.ts mirror durability gate; jsonParseRetries ENOENT cleanup; +regression tests. `tsc` clean; vitest 543 pass (2 pre-existing Windows-env failures only).

## Recommendation
Treat **R1 (secret delivery)** + **R2 (crash-restart)** + the **G3 at-rest encryption** gate as a **dedicated pre-cutover daemon-hardening plan**; the inline-fixed improvements are real and merge-safe. R1's redesign is Santiago's architectural call (accept-as-cutover-gate vs redesign-before-merge). R2 is pre-existing lifecycle work owed regardless.
