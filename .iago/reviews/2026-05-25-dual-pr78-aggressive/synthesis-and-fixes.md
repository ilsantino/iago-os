# PR #78 Dual Aggressive Synthesis + Fix Plan

**Date:** 2026-05-25
**Reviewers:** Opus 4.7 (review-single sub-agent, full) + Codex GPT-5.5 (partial — see codex-aggressive.md)
**PR:** [#78](https://github.com/ilsantino/iago-os/pull/78) — `feat/impl-timeout-env-configurable`

## Verdict

**MERGEABLE WITH FIXES.** One Critical (arithmetic safety on bash-injection / non-numeric) + three Important (telemetry capture, scope explanation, doc gap) + three Minor. All fixed in this same PR via cherry-pick of the C-1 fix produced by Santiago's parallel Sonnet 4.6 session on `feat/mwp-restructure-docs-02` (commit `554cbd4`), supplemented with the I-3 docs subsection on this branch.

## Synthesis grid

| ID | Severity | Title | Opus | Codex | Disposition |
|----|----------|-------|------|-------|-------------|
| C-1 | Critical | Arithmetic injection / pipeline abort on invalid `IAGO_IMPL_TIMEOUT_SECS` | ✓ | (partial — context-read only, no structured findings written) | **Fixed** via `scripts/lib/env-validation.sh` + startup-time guards on both impl and PR timeouts |
| I-1 | Important | No telemetry record of configured budget | ✓ | — | **Fixed** via `stage_extra impl_timeout_budget_secs` after `stage_start implement` |
| I-2 | Important | Impl-only scope is arbitrary and undocumented | ✓ | ✓ (precedent at line 974 confirms pattern is asymmetric) | **Fixed** via 7-line scope comment above call site + bonus: also validated `IAGO_PR_TIMEOUT` |
| I-3 | Important | Env var undocumented in all reference locations | ✓ | — | **Fixed** via new subsection in `.claude/rules/execution-pipeline.md` |
| M-1 | Minor | `${VAR:-default}` on empty is correct but implicit | ✓ | — | Resolved by C-1 (validator only fires on explicit non-empty value) |
| M-2 | Minor | STATE.md `(this commit)` placeholder | ✓ | — | **Deferred** — standard post-merge backfill |
| M-3 | Minor | No test case for invalid `timeout_secs` | ✓ | ✓ (extension point identified) | **Fixed** via dedicated `scripts/test-env-validation.sh` (12 cases + wiring-drift assertion) |

## Cross-cutting observation

Codex's grep surfaced that `IAGO_PR_TIMEOUT` at line 974 already uses this exact pattern (`"${IAGO_PR_TIMEOUT:-600}"`). PR #78 is the **second** env-configurable timeout, not the first. This:

- Strengthens I-2: the asymmetric scope is real but precedent exists, so the explanation now covers *which* stages got the knob and why (not just impl).
- Drove the in-PR decision to validate `IAGO_PR_TIMEOUT` with the same `validate_positive_int_env` helper — closes the wider C-1 surface without leaving a follow-up gap. The dedicated test file asserts both validators are wired up so future drift gets caught at CI time, not in production.
- Naming-convention drift between `IAGO_IMPL_TIMEOUT_SECS` (with `_SECS` suffix) and `IAGO_PR_TIMEOUT` (bare): explicitly noted as future-cosmetic, not blocking this PR.

## Fix-set applied

### F1 — C-1 + M-1 + M-3 (validator + tests)

1. **NEW** `scripts/lib/env-validation.sh` — `validate_positive_int_env <var_name> <default_for_msg>`:
   - Accepts unset/empty (caller falls through to `${VAR:-default}`)
   - Accepts `^[1-9][0-9]*$` (positive integer, no leading zero, no sign, no decimal, no whitespace)
   - Rejects everything else (non-numeric, negative, zero, decimal, padded, injection)
   - Emits a contextual error message to stderr on reject

2. **EDIT** `scripts/execute-pipeline.sh`:
   - Source the helper alongside other libs (line 24 area).
   - Validate `IAGO_IMPL_TIMEOUT_SECS` AND `IAGO_PR_TIMEOUT` together at startup, immediately after the Usage check. Block-style validation makes the failure visible at startup, not mid-pipeline.

3. **NEW** `scripts/test-env-validation.sh` — 12 accept/reject cases covering `abc`, `-5`, `0`, `0123`, `1.5`, ` 60 `, `$(rm -rf /)`, `` `rm -rf /` ``, applied to both env vars, plus a wiring-drift assertion that the pipeline references both validators next to each other.

### F2 — I-1 (telemetry capture)

`stage_extra impl_timeout_budget_secs "${IAGO_IMPL_TIMEOUT_SECS:-1800}"` immediately after `stage_start implement`. Mirrors the build-gate stage's tsc/vite duration capture pattern so post-hoc NDJSON analysis can verify the override was active for a given run.

### F3 — I-2 (scope comment)

7-line block-comment above the `run_claude "${IAGO_IMPL_TIMEOUT_SECS:-1800}"` call:
- Names this stage AND the PR-create stage as the only env-configurable timeouts.
- Lists the other stages and their stable hardcoded budgets.
- States the systematization trigger (second pressure point).
- Points to `validate_positive_int_env` as the safety net.

### F4 — I-3 (docs)

New `### Impl stage timeout (IAGO_IMPL_TIMEOUT_SECS)` subsection in `.claude/rules/execution-pipeline.md` after the `IAGO_PARALLEL_BUILD` subsection. Mirrors the existing structure: when/why, usage example, validation regex, telemetry pointer, scope rationale, regression-coverage pointer.

## Out of scope (explicit defers)

- **M-2** (commit-hash backfill in STATE.md): standard post-merge step, handled by next PR's STATE.md edit cycle.
- **Systemizing IAGO_*_TIMEOUT_SECS across all 9 hardcoded call sites**: deferred until second pressure point. Scope comment in F3 captures the decision.
- **Renaming `IAGO_PR_TIMEOUT` → `IAGO_PR_TIMEOUT_SECS` for naming consistency**: defer to a future cosmetic PR.

## Acceptance criteria (verified)

- [x] `bash -n scripts/execute-pipeline.sh` passes.
- [x] `bash -n scripts/lib/env-validation.sh` passes.
- [x] `bash -n scripts/test-env-validation.sh` passes.
- [x] `bash scripts/test-env-validation.sh` passes all cases (accept + reject + wiring-drift).
- [x] `IAGO_IMPL_TIMEOUT_SECS=abc bash scripts/execute-pipeline.sh --plan x --project-dir .` exits 1 with stderr message.
- [x] `IAGO_IMPL_TIMEOUT_SECS=2700 bash scripts/execute-pipeline.sh` proceeds past validation (hits subsequent error path for missing required args, NOT the validator).
- [x] `IAGO_IMPL_TIMEOUT_SECS="" bash scripts/execute-pipeline.sh` proceeds past validation (default fallthrough).
- [x] `.claude/rules/execution-pipeline.md` has IAGO_IMPL_TIMEOUT_SECS subsection.
- [x] `stage_extra impl_timeout_budget_secs` line present after `stage_start implement`.
- [x] Scope comment present above `run_claude` impl call.

## Files touched (this branch — `feat/impl-timeout-env-configurable`)

| Action | Path | Source |
|--------|------|--------|
| NEW | `scripts/lib/env-validation.sh` | Cherry-picked from `554cbd4` |
| edit | `scripts/execute-pipeline.sh` | Cherry-picked from `554cbd4` |
| NEW | `scripts/test-env-validation.sh` | Cherry-picked from `554cbd4` |
| edit | `.claude/rules/execution-pipeline.md` | Written here (Santiago's commit did not touch this file) |
| edit | `.iago/STATE.md` | Updated description row to reflect dual-review hardening |
| NEW | `.iago/reviews/2026-05-25-dual-pr78-aggressive/codex-aggressive.md` | New |
| NEW | `.iago/reviews/2026-05-25-dual-pr78-aggressive/opus-aggressive.md` | Recreated from sub-agent return value (original on `feat/mwp-restructure-docs-02` was overwritten when branch flipped mid-session) |
| NEW | `.iago/reviews/2026-05-25-dual-pr78-aggressive/synthesis-and-fixes.md` | This document |
| NEW | `.iago/reviews/2026-05-25-dual-pr78-aggressive/pr78-diff.patch` | Pre-fix diff snapshot (origin/main → efe0460) |

## Cross-session note

Santiago's parallel Sonnet 4.6 session on `feat/mwp-restructure-docs-02` independently produced the C-1 fix (commit `554cbd4` — "docs(mwp): collapse docs/ dumping ground into canonical locations" — with co-author "Claude Sonnet 4.6"). His commit message explicitly states "adds env-validation guard for env-configurable pipeline timeouts (Codex C-1 fix on feat/impl-timeout)", confirming intent for the C-1 fix to land on this PR's branch. The fix-set landed here by cherry-picking the three relevant files (`scripts/lib/env-validation.sh`, `scripts/execute-pipeline.sh`, `scripts/test-env-validation.sh`) from `554cbd4` onto `feat/impl-timeout-env-configurable`, then adding the I-3 docs subsection on top.

His version was strictly stronger than the orchestrator's initial attempt — he also validated `IAGO_PR_TIMEOUT` (which Opus's review noted as the precedent for this pattern but did not require fixing in this PR). The dedicated `test-env-validation.sh` (vs. extending `test-pipeline-helpers.sh`) is also a cleaner pattern. No reconciliation needed; the orchestrator's earlier work was discarded in favor of the stronger parallel result.
