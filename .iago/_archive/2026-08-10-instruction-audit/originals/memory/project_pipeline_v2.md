---
name: project_pipeline_v2
description: Execution pipeline rebuilt as harness-native Workflow — PR
metadata: 
  node_type: memory
  type: project
  originSessionId: d52dd45c-e931-40d8-a2bd-847cc02ab06d
---

The iaGO execution pipeline was rebuilt 2026-05-28 from `scripts/execute-pipeline.sh` (nohup-bash + `claude -p` per stage) into harness-native Workflows: `.claude/workflows/execute-pipeline.js` (full pipeline) + `.claude/workflows/dual-adversarial.js` (pre-merge Opus 4.8 ∥ Codex GPT-5.5 gate). Invoked by /iago-execute, /iago-quick, /subagent-driven-development via the `Workflow` tool. **PR #83 MERGED into main 2026-05-28.** Bash script DEPRECATED — retained one cycle as fallback; delete after a few real-plan runs bank.

**Why:** two of three Sentria P3a runs died on the bash pipeline — transient `thinking blocks` 400 (no retry) and an 80-turn cap. ~55% of the 1124-line script was Windows scar tissue.

**How to apply:** each stage is a tracked retryable subagent (no transient-error death, no static turn caps). **Commit happens BEFORE review** (Stage 2b) — codex-companion reviews committed history only; uncommitted changes were invisible, silently disabling the cross-model leg. Fail-closed dual gate (both legs mandatory). Atomic per-project lock (`mkdir .iago/state/.pipeline.lock.d`). PREP asserts clean tree. Summary self-commits (diff-safe — excluded from review diffs by preImplSha). Workflow `args` arrive as a JSON STRING — both scripts `JSON.parse`. To run the post-merge gate manually: `/codex:adversarial-review` is user-only (model-disabled) — run codex-companion directly with `--cwd` OR dispatch an Opus analyst agent + codex-companion.

**Validated:** 5 dual-adversarial cycles (~16 findings fixed in the pipeline's own code) + 3 green E2E. First real `/iago-execute` run is the live-binding integration test — suggested: re-run Sentria P3a.

**Deferred follow-up** (spec = PR #83 stress-test): cleaner multi-plan PR model (one-PR-per-phase or true `--base` stacked PRs — currently STACKING with cumulative PR diffs, merge in order), finally-guaranteed lock release + atomic stale-reclaim. Single-plan/`--plan`//iago-quick unaffected. Supersedes [[project_pipeline_bugs]].

**Concurrency lesson:** a concurrent pr-triage session shared the main checkout and collided (my fix briefly on the wrong branch; first review diff contaminated). Use worktrees — [[feedback_worktree_per_session]].

**2026-06-05 — efficiency hardening MERGED (PR #93, `1d7ab94`).** `execute-pipeline.js` now routes mechanical stages off Opus (prep/rollback→haiku, lock/commit/buildVerify→sonnet; impl/build-fix/stress/review/codex/fix stay Opus), skips the Opus stress *spawn* on pre-stressed plans (skill greps `^## Stress Test` → passes `skipStress: true`; workflow guards with strict `=== true`), merges summary+lock-release (haiku) and create-pr+tag (sonnet, with a `TAG_FAILED` honesty value so a failed `gh pr comment` can't be hallucinated as success), and threads round-0 `domainsSelected` as a re-review focus hint (all 11 modules still load — zero coverage loss). The dual-adversarial gate is UNCHANGED (verified by pass-#2: codex real, no weakening).

**How to apply (corrects a stale premise):** a **behavioral test harness now exists** — `.claude/workflows/execute-pipeline.test.mjs` (4 tests, `new Function` + mock-agent bindings, same pattern as `dual-adversarial.test.mjs`). Do NOT claim "no test infra for the workflow" anymore (the 01-pipeline-efficiency plan said so and was wrong) — extend this harness instead. `validate-workflows.mjs` is still compile-only. Note: `node --check execute-pipeline.js` falsely reports "Illegal return statement" (top-level `return` is legal inside the harness async wrapper) — `validate-workflows.mjs` is the correct gate.

**Executing a plan committed to a FEATURE branch:** skip the iago-execute skill's Step-3 `git checkout main` — it would delete the plan from disk and break the Workflow's `${plan}` path. Run from a worktree on the branch that holds the plan; pass that worktree as both projectDir and iagoRoot.

**Deferred follow-ups (post-#93):** (1) build-gate split — Sonnet routing/run agent + Opus fix-only agent dispatched only on failure (plan Out-of-Scope). (2) Orphan-PR window — if the merged create-pr+tag agent crashes after `gh pr create` but before returning, the PR URL never reaches the log (lossless recovery via idempotent reuse); optional early-breadcrumb hardening. Both Minor/non-blocking.

**Post-merge canary:** the #93 changes only bind on the NEXT `/iago-execute` (the running Workflow is the pre-edit copy). Watch the first real run — live-untested: haiku stages running verbatim shell, merged summary+lock-release, the skill-side skipStress grep.
