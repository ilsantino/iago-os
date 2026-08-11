---
name: agents-never-hold-secrets
description: R1 decision — spawned agents NEVER hold long-lived secrets in their PTY shell; the daemon makes all GitHub/Telegram calls and passes only sanitized data; PR
metadata: 
  node_type: memory
  type: project
  originSessionId: 14c83422-be42-466e-bd64-808e2644f8f5
---

Decided 2026-05-31 by Santiago (chose **full daemon-side** over scoped-short-lived-creds) after a cross-model gate rated R1 a Critical.

**Rule:** a spawned cron/standing agent's PTY shell must NEVER hold a long-lived secret (GitHub PAT, Telegram bot token). The agent's prompt ingests **attacker-writable** PR comment bodies, so any credential in its shell is prompt-injection-exfiltratable (R1). Instead, the **daemon** performs ALL GitHub + Telegram API calls in daemon-owned code and feeds only SANITIZED results into the agent's prompt as data; the agent produces text, the daemon sends it.

**Supersedes:** PR #84's `composeCronAgentEnv` + `CRON_AGENT_ENV_ALLOWLIST` secret-injection into the PTY (the `GH_TOKEN`/`IAGO_TELEGRAM_BOT_TOKEN` allowlist) — to be **removed** in the R1 rework. The NON-secret `CRON_AGENT_RUNTIME_ALLOWLIST` (PATH/HOME/SHELL/LANG) stays — that was a separate, correct fix (the PTY had no PATH → feature was dead on the VPS).

**Status:** PR #84 (pr-triage) is **HELD unmerged** until the daemon-side rework lands on its branch `feat/pr-triage-integration-test`. This session already fixed PATH, redaction (bash-native), R2 (crash-restart dead-handle + orphan secrets), and the `/tmp` world-readable token — all committed LOCAL to the worktree `iago-os-pr84-review`, **not pushed**. The `#5` restart re-persist durability finding is deferred to the `feature-daemon-recovery-hardening` plan (same `persistAgentConfig` swallow root cause as #87's Critical).

Don't re-introduce agent-held secrets. Related: [[project_iago_v2_vision]], [[feedback_llm_cost_discipline]].
