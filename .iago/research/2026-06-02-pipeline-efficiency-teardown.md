---
title: Execute-pipeline efficiency teardown
date: 2026-06-02
type: audit
target: .claude/workflows/execute-pipeline.js
method: 4-lens adversarial teardown → per-finding verification → holistic gate audit (44 agents)
feeds: .iago/plans/feature-pipeline-efficiency/01-pipeline-efficiency.md
---

# Execute-pipeline efficiency teardown — 2026-06-02

## Purpose

Cut latency + token cost of the harness-native execution pipeline
(`.claude/workflows/execute-pipeline.js`, 707 lines) **without weakening** the
dual-adversarial Opus ∥ Codex review — the pipeline's entire value. This is the
audit record behind plan `feature-pipeline-efficiency/01`.

## Hard constraint that shapes every fix

The Workflow JS has **no filesystem/shell access** — it can only spawn LLM
subagents (each gets Bash). Every `git`/`mkdir`/`rm`/build runs **inside a
subagent**. So the fix for a deterministic stage is never "delete the agent"
(there is no non-agent way to run the shell) — it is **route that subagent to a
cheaper model** and/or **batch two adjacent mechanical subagents into one**.

## Method

A 3-phase read-only Workflow (`pipeline-efficiency-teardown`, 44 agents,
~3.6M tokens):

1. **Analyze** — 4 parallel lenses (model-routing-waste, redundant-compute,
   mergeable-stages, completeness-expansion) read the file against ground truth
   and produced **39 candidate findings**.
2. **Verify** — every finding got an **independent skeptical verifier** that
   re-checked the line ref against the file, confirmed the waste was real, and
   ruled on **gate-impact** (would the change weaken review/codex/build rigor in
   any worst case?). 31 accepted, **8 rejected**.
3. **Synthesize** — dedup + a **holistic gate audit** over all accepted changes
   taken together.

**Holistic gate verdict: `NO_WEAKENING`.** All accepted changes touch only
pre-implementation bookkeeping (lock, prep, rollback), the commit stage, post-gate
telemetry (summary, lock-release), the read-only build re-gate, or the
re-review's *redundant* PASS-2 output — never the review leg, the Codex leg, the
primary build gate, or the diff the review sees. The one compound case checked
explicitly: `buildVerify→Sonnet` cannot produce a false-pass that skips the
re-review — they are sequential independent gates.

## What the gate audit REJECTED (the do-not-touch boundary)

The most important output. These were flagged as candidate savings and
**rejected** because any form weakens the gate or breaks failure semantics. The
plan must preserve them, and a future over-eager efficiency pass must not revisit
them without re-auditing.

| Rejected candidate | Why it stays | Line ref |
|---|---|---|
| Downgrade the **Codex leg** off Opus | Its prompt contains a **full fallback adversarial review** that runs when the GPT-5.5 companion is missing/misfires. The agent's model is the floor for that fallback. Haiku/Sonnet there = a weak cross-model check on companion-absent machines (a real scenario). | L437-446 / codexPrompt L267-282 |
| Downgrade the **stress agent** when it runs | Adversarial plan review (precision gaps, edge cases, contradictions) is judgment across unstructured text — genuine Opus work. (We only *skip the spawn* for already-stressed plans; fresh plans keep full Opus.) | L511-514 / STRESS_PROMPT L284-297 |
| Downgrade **BUILD_PROMPT** (primary build gate) | It **edits source** to fix build breaks — code-writing. A weaker model risks syntactically-valid-but-wrong fixes passing `tsc` silently. | L561-564 / L319-333 |
| Scope the **fix-round re-review to the fix delta** / drop the full **Codex re-invocation** | The full `preImplSha..HEAD` diff is required for cross-file regression detection AND the codex-companion enumerates changed files from the diff it receives; the claude-fallback reads that diff directly. Scoping deprives the fallback of essential context. **This was the single costliest repeat — and it is load-bearing, not waste.** | re-review L617-622 / R7 |
| **Selective module loading** in review (read only selected domains) | The read-all is **fail-safe**: a PASS-2 misclassification would silently drop checks (incl. ALWAYS-Critical severity floors that live inside the module text). Modules total only ~38 KB / ~10K tokens — modest cost, fully justified. | L261 / C11 |
| Drop **stressBlock** from re-review passes | Removing it creates an escape path for an r0 reviewer miss on a stress-critical note; the re-review integrity check only covers prior *findings*, not silently-dropped notes. | L518-521, L620 / C6 |
| Collapse the **build-gate retry layers** | Inner `withRetry` (API transient) and outer for-loop (genuine build failure with a fresh code-writing agent) address orthogonal failure modes — not redundant. | L559-568 / C7 |
| **Merge lock-acquire + prep** into one agent | They are **non-adjacent** — the Opus stress agent runs between them. Individual model downgrades capture the saving without the placement complexity. | L488 vs L525 |

## Accepted changes (→ the plan)

Honest magnitude: individual savings are modest (cents and 1–15 s per stage) but
**fire on every pipeline run** and compound. The two largest are latency, not
tokens: skipping the fix-agent's redundant `vite build` (1–4 min/fix-round on
vite projects) and skipping the Opus stress *spawn* on the common (pre-stressed)
path.

| # | Change | Mechanism | Gate impact |
|---|---|---|---|
| 1 | `prep`→haiku, `rollback`→haiku, `lock-acquire`→sonnet, `commit`→sonnet, `buildVerify`→sonnet | model-tier | none (buildVerify: low — conservative false-fail only) |
| 2 | Skip the Opus **stress spawn** when the plan is pre-stressed (skill greps `^## Stress Test`, passes `skipStress`; Workflow guards the spawn) | scope (conditional spawn) | none |
| 3 | Merge `summary` + `lock-release` → one haiku agent | batch-merge | none |
| 4 | Merge `create-pr` + `tag-claude` → one sonnet agent (idempotency + PR-number assertion preserved) | batch-merge | none |
| 5 | Thread round-0 `domainsSelected` as a **hint** to re-review + drop its redundant PASS-2 *output* — **all 11 modules still loaded** | scope (drop redundant regeneration) | low |
| 6 | Fix-agent self-check runs `tsc`+`shellcheck`+`validate-workflows` only; **buildVerify keeps the full `vite` gate** | scope (de-dup the double vite build) | low |

Per-finding line refs, exact edits, regression notes, and gate flags: see the
plan.

## Why model downgrades land where they do

- **haiku** — pure shell passthrough with a binary branch: `prep` (3 git reads +
  empty-string check), `rollback` (run a pre-built restore cmd + verify clean),
  `summary`+`release` (templated md/NDJSON + commit + `rm -rf`).
- **sonnet** (not haiku) — mechanical but with one consequential judgment:
  `lock-acquire` (destructive `rm -rf` on a 3h-stale reclaim — asymmetric cost if
  mis-timed), `commit` (secret-exclusion pathspec + conventional-commit type),
  `buildVerify` (read-only re-gate that must correctly *diagnose* a failing
  build). Matches the existing sonnet precedent on create-pr/tag.
- **opus** — kept everywhere judgment or code-writing lives (impl, build-fix,
  stress-when-run, review, codex-leg, fix).

## Relationship to `feature-pipeline-speed-wedges`

Orthogonal, no overlap. The speed-wedges program targets the **deprecated bash
`scripts/execute-pipeline.sh`** on a *parallelism/timeout* axis, governed by
`docs/specs/parallel-execution-wedges.md`. Its headline hypothesis — "**Wedge D:
Review ∥ Codex concurrent, ~600 s win**" — is **already implemented for free** in
this Workflow (`runDualAdversarial` uses `parallel([review, codex])`). This plan
is the **model-tier + agent-count axis on the Workflow JS** — a different lever on
a different file. Sibling review workflows (`dual-adversarial.js`,
`dual-adversarial-fix.js`) correctly pin every agent to **opus** (pure judgment) —
no model-routing waste there; this audit is `execute-pipeline.js`-only.

## Deferred (follow-on trigger)

- **Build-gate split** (Sonnet routing/run agent + Opus fix-only agent, dispatched
  only on failure) — a cleaner structural design needing a new intermediate schema
  + conditional dispatch + re-run path. Warrants its own plan. Trigger: after this
  plan merges.
