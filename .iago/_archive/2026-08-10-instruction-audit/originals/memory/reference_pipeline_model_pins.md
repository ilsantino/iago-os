---
name: reference-pipeline-model-pins
description: "Which iaGO workflows pin models: execute-pipeline judgment stages inherit session model (Fable 5 works); dual-adversarial gate+fix hard-pin opus — strip pins via temp variant; drop agentType executor (StructuredOutput flake)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 66e070ae-922f-4585-99e0-319efb99abc9
---

Model pinning across the iaGO review workflows (verified in agent transcripts 2026-06-10):

- **`.claude/workflows/execute-pipeline.js`**: pins `model: 'sonnet'` ONLY on PR-creation + @claude-tag
  stages. Stress/impl/build/commit/review/fix/summary omit `model` → inherit the SESSION model.
  Running `/iago-execute` from a Fable 5 session = Fable 5 impl + Fable 5 review ∥ Codex GPT-5.5.
  No script edit needed for Fable.
- **`.claude/workflows/dual-adversarial.js`**: hard-pins `model: 'opus'` on ALL Claude legs (review,
  lenses, team personas, skeptics, side-effect snapshots — 5 pin sites). **`dual-adversarial-fix.js`**:
  pins `model: 'opus'` + `agentType: 'executor'` on the fix agent.
- To run these on the session model (e.g. Fable): copy both to a temp dir (e.g. `%TEMP%\iago-fable-wf`),
  strip `, model: 'opus'` and standalone `model: 'opus',` lines, `node --check`, invoke via scriptPath.
  Canonical files stay untouched (repo tree stays clean).
- **Also strip `agentType: 'executor',`** from the fix variant: executor-type + schema = recurring
  "completed without calling StructuredOutput" failure ([[feedback-subagent-git-wander-and-structuredoutput]]);
  the default workflow subagent emitted structured output reliably (16/16 same day).
- Workflow resume caveat: `resumeFromRunId` may re-run prematurely-cached-looking stages LIVE after a
  script edit (pre-state clean-tree guard re-fired on a dirty tree); if a dead fix agent left partial
  uncommitted work, commit it as `wip(...)` on the feature branch first, then re-dispatch fresh with a
  finding NOTE pointing at the wip commit.
