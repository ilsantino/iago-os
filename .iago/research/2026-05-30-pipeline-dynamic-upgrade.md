# Pipeline dynamic-workflow upgrade — capability research + decision

**Date:** 2026-05-30
**Trigger:** "Can our code-gen pipeline be upgraded with Claude's new dynamic workflows? Ask vs. auto agent-teams?"
**Decision owner:** Santiago
**Outcome:** Extend the existing Workflow pipeline with auto-tiered review depth; do NOT
rebuild on the new headline features yet. Implementation plan:
`.iago/plans/quick-260530-pipeline-risk-tiering.md`.

## Starting point (often misremembered)

The pipeline is **already** a harness-native dynamic Workflow (`execute-pipeline.js` +
`dual-adversarial.js`, PR #83/#86 lineage). Agent-team machinery — diverse-persona legs
(`team:data`, `team:arch`) + a per-finding skeptic panel with `refuteHasEvidence()` — is
**already built** in `dual-adversarial.js` team mode. The gap was never "adopt dynamic
workflows"; it was that team mode is **unreachable from `execute-pipeline.js`** (hardwired
2-leg) and there's **no risk signal** routing depth. So a CSS tweak and a Cognito-auth
change get identical review.

## What's genuinely new in Claude Code (May 2026, verified against code.claude.com)

| Capability | Verdict for our pipeline |
|---|---|
| **Dynamic Workflows** (model writes orchestration JS on the fly; journal/resume; v2.1.154) | We're on the primitive. **Do NOT let it regenerate** our hand-tuned, tested pipeline. Re-evaluate in ~90 days (exits preview). |
| **Agent Teams** (peer-to-peer multi-session, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) | **Defer.** Hub-and-spoke is correct for sequential impl→review→fix; peer coordination is net-negative on dependent tasks (research: −39% to −70%). |
| **`isolation: worktree`** subagent field | Adopt later — first-class replacement for the manual mkdir-lock. |
| **`effort` per-subagent** + Opus 4.8 fast mode (2.5× speed) | Adopt (P2) — fast-mode Implement, `xhigh` the adversarial review. |
| **Persistent subagent memory** (`memory: project`) | Adopt (P2) — reviewer accumulates per-repo antipatterns across runs. |
| `/goal`, `TaskCompleted` hooks, scoped MCP | Nice-to-have, not load-bearing. |

## The ask-vs-auto verdict

**Auto-tiered, not ask, not full-auto.** Ask-every-run is friction Santiago has explicitly
rejected; full-auto agent-teams-on-everything burns ~15× tokens on changes that don't need
a panel (violates 60/30/10). A **deterministic ~25-line classifier** (zero LLM) reads plan
metadata + risk keywords and picks depth. No human in the routing loop; the human still
merges (the only gate that matters). Tiers: 0 Fast / 1 Normal (2-leg) / 2 Complex (team
mode) / 3 Security (team mode + raised fix cap).

## Multi-agent best-practice corroboration (directional; some cited arxiv IDs were
future-dated/unverifiable — treat exact percentages as illustrative)

- Cross-model (heterogeneous) review > same-family voting — principled false-positive
  filter. Our Opus∥Codex leg is the load-bearing diversity; team-mode skeptics are
  same-family (hence the `verificationSameFamily` flag in the plan).
- **2 fix rounds is the empirical ceiling**; beyond it false-positives outpace true
  findings. We keep 2, raise to 3 only for Tier 3.
- 3–5 diverse specialists = submodular coverage sweet spot (our team:data + team:arch +
  lenses sit in range).
- Commit-before-review is mandatory for the external leg (already enforced, Stage 2b).
- Implementation is sequential → single implementer (no parallel impl on one file).

## Stress test of our own design (pre-implementation)

Verdict **GO_WITH_ADJUSTMENTS**. Concept sound; 7 Criticals in implementation precision,
all resolved in the plan. The load-bearing one: **self-modification** — you cannot run a
pipeline change *through* the pipeline (stale in-memory closure + compile-only build gate).
Ship path: standalone branch + unit tests + independent adversarial review + post-merge
canary `/iago-fast`. Full finding ledger in the plan's `## Stress Test`.

## Deferred (follow-up plan)

Path-lens auto-injection (timing-broken at classify-time — needs post-commit diff),
`--tier-override` escape hatch, `KNOWN_LENS_KEYS` drift-detection. All three ship together
once the post-commit lens seam (`reviewLenses`) is wired.

## Git topology note

Team mode is unmerged: PR #86 squash-merged an earlier snapshot of
`chore/cc-config-optimization`; team-mode + lens commits were added afterward and are NOT
in `origin/main`. This work branches off that HEAD (`feat/pipeline-risk-tiering`); its PR
to main is **cumulative** (carries the unmerged team-mode work too).
