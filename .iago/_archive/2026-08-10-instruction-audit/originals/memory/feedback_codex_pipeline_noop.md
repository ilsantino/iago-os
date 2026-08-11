---
name: feedback-codex-pipeline-noop
description: Pipeline Codex stage silently no-ops under --no-pr (empty diff); /codex:adversarial-review is not model-invocable — run codex-companion directly with --base
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1b3a6139-1bd0-4f8e-acbf-558c82417711
---

The pipeline's Codex adversarial stage (`execute-pipeline.sh`) runs `codex-companion adversarial-review --base $PRE_IMPL_SHA` in stage 4, BEFORE the commit in stage 5. Under `--no-pr` (and any run where HEAD has not advanced past the base by codex-time), it diffs a commit-range against an unmoved HEAD → **empty diff → verdict "approve, no findings."** The cross-model gate is silently skipped.

**Why:** `--no-pr` makes its stacked commit in stage 5, AFTER the stage-4 codex review. So at codex-time `HEAD == $PRE_IMPL_SHA` and `git diff base..HEAD` is empty. The codex agent even reads `git status --short` (which shows staged changes) but trusts the empty `git diff` and rubber-stamps approve.

**How to apply:** Never trust the pipeline's codex "approve." After any pipeline run (especially `--no-pr`), re-run Codex independently on the COMMITTED diff:
`node ~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs adversarial-review --cwd . --base <pre-work-sha> --wait`
Verify it reviewed a non-empty diff (the output header says `Target: branch diff against <sha>`).

`/codex:adversarial-review` is `disable-model-invocation` — it CANNOT be triggered via the Skill tool autonomously (it errors "cannot be used with Skill tool"). This corrects [[feedback_codex_adversarial_skill]] for the headless/autonomous case: use `codex-companion.mjs` directly. On PR #84 the pipeline's no-op'd codex stage missed 2 High security findings (un-scoped dispatch bypass + spoofable secret gate) that the manual re-run on the committed diff caught immediately. Related: [[project_pipeline_bugs]].
