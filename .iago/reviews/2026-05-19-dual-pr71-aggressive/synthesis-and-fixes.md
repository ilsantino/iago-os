# Dual Aggressive Adversarial Review — PR #71 Synthesis + Fixes

**Date:** 2026-05-19
**Reviewers:** Claude Opus 4.7 (background subagent, partial — see `opus-aggressive.md`) + Codex GPT-5.5 (full review at `codex-aggressive.md`)
**Independence:** Both reviewers ran with no awareness of the other; Opus subagent received the brief inline, Codex was dispatched via `codex-companion adversarial-review` with a separate focus brief at `codex-focus.txt`.
**Target branch:** `docs/strategy-sync-2026-05-19` (PR #71) — `.iago/decisions/2026-05-19-three-invocation-modes.md` + `docs/specs/sentry-integration.md` + STATE.md row

---

## Unified finding set (after orchestrator verification)

| # | Sev | Source | Title | File:loc | Status |
|---|---|---|---|---|---|
| 1 | Critical | Opus | `SENTRY_DAEMON_DSN` provisioning claim false — Plan 01b CREDENTIALS array does not include it | `sentry-integration.md:41-42` | **FIXED** |
| 2 | High | Codex | Mode 1 framed as "pipeline invokes named daemon agents" — pipeline is `child_process` script runner with fresh `claude -p` per stage, not `AgentRuntime` consumer | `three-invocation-modes.md:15` | **FIXED** |
| 3 | High | Codex | Mode 2 bypass of skill-routing conflicts with `CLAUDE.md` and `.claude/rules/execution-pipeline.md` mandatory-skill rule | `three-invocation-modes.md:67-68` | **FIXED** |
| 4 | High | Codex | Sentry auto-commit-on-iago-os gate is a slogan, not enforcement — no repo-ID allowlist, realpath check, git-remote verification, token-scope restriction | `sentry-integration.md:128-138` | **FIXED** — auto-commit route REMOVED entirely |
| 5 | High | Codex | Webhook dedupe TOCTOU race — file check then spawn is not atomic; no Shape 4 canonical replay safety (event_dedupe SQLite, idempotency keys, dead-letter) | `sentry-integration.md:116-120` | **FIXED** |
| 6 | Medium | Codex | Phase numbering ambiguity — canonical vision has cutover at roadmap Phase 7, doc used compressed `feature-phase-N` numbering without clarifying | `sentry-integration.md:13, 47` | **FIXED** — explicit phase-numbering note added to both docs |
| 7 | Minor | Codex+Opus | `runtime/daemon/index.ts` cited but actual entry is `runtime/daemon/main.ts` | `sentry-integration.md:40, 45` | **FIXED** |

---

## Verification methods (orchestrator-side, after both reviews completed)

1. **runtime/daemon/ entry path** — `ls runtime/daemon/` confirms `main.ts` exists, no `index.ts`. Codex + Opus correct.
2. **Plan 01b CREDENTIALS array** — `grep -n "CREDENTIALS" .iago/plans/feature-phase-2-vps-bootstrap/01b-cred-bootstrap-and-config-schema.md` confirms only `iago-telegram-token` + `iago-gh-token` active; three commented Phase 3 entries are Anthropic, not Sentry. Opus correct.
3. **Canonical cutover phase** — `grep "Stage D" docs/specs/iago-os-v2-vision.md` returns line 309: "Stage D — Cutover. Maps to roadmap Phase 7 (gated on Phase 6 dashboard stable)." Codex correct on canonical numbering; operational `feature-phase-2` compresses install + cutover into one folder.
4. **Sentry MCP install block** — `grep -n "claude mcp add" docs/specs/iago-os-v2-master-prompt.md` confirms line 314: `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp`. Reference remains accurate.
5. **`feedback_no_auto_merge` memory** — recently strengthened (2026-05-19, same session) to apply to ALL Claude actions, not just GH Actions. Reinforces removal of auto-commit route.

---

## What was changed

### `.iago/decisions/2026-05-19-three-invocation-modes.md`

- Added phase-numbering note at top (canonical roadmap vs operational `feature-phase-N`)
- Mode 1: rewritten to clarify that the pipeline is a `child_process` script runner spawning fresh `claude -p` per stage, NOT a consumer of named daemon agents. New "Important architectural note" paragraph added.
- Mode 2: rewritten to constrain to runtime/operational tasks. New explicit "Mode 2 boundary" subsection listing what Mode 2 CAN and CANNOT do, plus the `claude -p` raw-call edge case.
- Mode 3: added explicit "implementation-discipline constraint" — Mode 3 agents that propose code changes must route through Mode 1 for PR creation.
- "Implications" section: rewritten to reinforce that the mandatory-skill rule is UNCHANGED by this ADR.
- "What this does NOT change": rewritten to be explicit that Mode 1 is mandatory for repo code work; Mode 2 is not an exemption.
- Added OQ-4 for the `claude -p` boundary edge case.
- Status field: "Accepted (amended post-dual-adversarial-review 2026-05-19)"

### `docs/specs/sentry-integration.md`

- Added phase-numbering note at top (this spec uses canonical roadmap, NOT operational `feature-phase-N`)
- Layer A: implementation section rewritten to (a) reference `runtime/daemon/main.ts` (not `index.ts`), (b) acknowledge that `SENTRY_DAEMON_DSN` is NOT yet in Plan 01b's CREDENTIALS array — Layer A's PR must add entries to both Plan 01a's `CRED_MAP` and Plan 01b's `CREDENTIALS`, (c) revised effort from "half-day" to "~1 day"
- Layer D flow diagram rewritten to put atomic claim BEFORE agent spawn, with explicit (1)-(5) numbered handler steps
- Layer D safety constraints expanded from 7 to 8 and substantially rewritten:
  - Constraint 1: "Auto-commit only on iago-os repo" REMOVED — every fix terminates in a PR via Mode 1 pipeline
  - Constraint 2: Idempotent dedupe BEFORE agent spawn (SQLite UNIQUE or O_EXCL claim)
  - Constraint 3: Daemon-side event_type allowlist check (catches misconfigured Sentry alerts)
  - Constraint 4: HMAC + secret rotation policy
  - Constraint 5: PII scrubbing ownership and audit pattern
  - Constraint 6: Fixer wall-clock timeout (20 min, SIGTERM → SIGKILL)
  - Constraint 7: Code-scope denylist enforced at spawn time (pre-LLM dispatch)
  - Constraint 8 (new): Repo-identity gate — `realpath` + `git config remote.origin.url` + fine-grained PAT scope, replaces the "iago-os repo only" slogan with enforceable config
- Implementation phases section rewritten — Phase 9 (Webhook/event shape) is now the prerequisite; D-1 lands canonical Phase 10; D-2 lands canonical Phase 10+
- Phase mapping table updated with canonical roadmap numbering
- Decisions taken section expanded to 8 items reflecting the safety changes
- Open questions: added OQ-4 (HMAC secret rotation), OQ-5 (per-client PII denylist storage)
- References: added `feedback_no_auto_merge` memory link

---

## What was NOT changed (out of scope for this fix cycle)

- The four 2026-05-19 STATE.md rows (PR #66, #68, #70, #71) — unchanged
- Other docs the dual review noted but did not flag for fix (master prompt, vision spec, CLAUDE.md framing)
- Plan 01a / Plan 01b themselves — Phase 2 plans are locked; Layer A's PR will add the SENTRY_DAEMON_DSN entries when it lands, not this PR

---

## Notes on Opus subagent reliability

Three subagent attempts produced one persisted finding via task-completion notification but failed to write the structured report file at the expected path. The failure mode appears to be late-stage Write call dropped or turn-budget exhaustion after extensive Read/Grep verification work. Cross-model independence is preserved (Codex full report on disk, Opus partial via notification), so this fix cycle is grounded in two independent reviewers. For future dual adversarial cycles consider:

- Writing the report file FIRST (with skeleton), then filling in findings as Edits, so partial work survives turn limits
- Increasing the subagent's max_turns budget if available
- Running the Opus review via `claude -p` script invocation directly with a write-to-file constraint in the prompt's first instruction
