# Gate-hardening backlog — for a dedicated review-infra PR

**Date:** 2026-06-13
**Source:** PR #89 (`feat/auto-tier-review-depth`) final dual-adversarial re-gate
(`wf_865dd2bf-12a`, team mode + 4 lenses, **real Codex, no degradation, every blocking
finding skeptic-confirmed**). Verdict `PASS_WITH_CONCERNS`, 8 Important, 0 Critical,
0 skeptic-dropped — all are meta-infra on the new tier feature, **zero regressions**
(Tier 0/1 ≡ the pre-PR Opus+Codex baseline; the feature only ADDS escalation).

**Decision (Santiago, 2026-06-13):** ship #89 with the one genuine non-polish fix only —
the SKILL doc-contract honesty gap (Issue A, wired in this PR). DEFER everything else
below to a dedicated gate-hardening PR. Rationale: the rest is "iterate review-infra to
clean" on a feature that never reduces review depth; bundling it into one focused
hardening PR is cleaner than gold-plating #89.

---

## From #89's re-gate (deferred)

### Tier-keyword breadth (Important, lens:security) — escalation surface
`classify-tier.mjs` TIER3/TIER2 keyword lists are literal substrings; security plans
phrased without one (RBAC, tenant-isolation, SQL-injection, XSS, Stripe/billing, authz,
rbac, role, permission, idor, secret, credential, …) classify Tier 0/1 and get only the
baseline 2-leg, not the deep team gate the feature exists to auto-trigger. NOT a
regression (Tier 0/1 == baseline). Also over-tiers benign words ("author" contains
"auth" → Tier 3). Fix: broaden both keyword lists AND ship the deferred `tier_override N`
frontmatter as the manual escalation/de-escalation seam (the plan already deferred it).

### Test coverage on #89's new honesty code (Important ×2, lens:tests)
- **T06 durable-artifact honesty write untested.** The summaryPrompt change exists so
  `verificationSameFamily`/`verificationDegraded` reach the DURABLE summary
  (`.iago/summaries/{plan}.md` + `pipeline-runs.ndjson`), but the test mocks the summary
  agent without inspecting its prompt — a regression that dropped the honesty note from
  the durable write would pass all tests. Add a prompt-content + NDJSON-flag assertion
  (the dual-adversarial harness proves `reviewCall.prompt.includes(...)` is feasible).
- **Inline-path `crossModelDegraded` untested.** The standard 2-leg return computes
  `crossModelDegraded: codex.source !== 'codex'`; the sole inline test mocks
  `{source:'codex'}` (false branch only). Add a Tier-1 test with a `claude-fallback`
  codex leg asserting `out.crossModelDegraded === true`.

### Plan-compliance leg lacks a read-only guard (Important, codex [high])
The new Tier 2/3 `planCompliancePrompt` runs AFTER commit / BEFORE PR but the shared
PREAMBLE says "you ARE the pipeline / run all git/build/file operations" and there is no
`git status --porcelain`/HEAD snapshot around the call. A compliant agent only
reads+reports (so no active mutation path — hence Important not Critical), but the
fail-closed guard every other non-mutating stage has is missing. Fix: mark the compliance
prompt explicitly read-only (match the build-verify wording) and snapshot HEAD+porcelain
around the call, failing closed on any change.

### Minors (same PR)
- **Drift-guard not in CI.** `classifyTier.test.mjs` byte-identical sync guard between
  `classify-tier.mjs` and the inline copy in `execute-pipeline.js` fires only on a manual
  `node ...test.mjs` run; `validate-workflows.mjs` is compile-only and globs only `*.js`
  (never runs the `.test.mjs` harnesses, never even compile-checks the `.mjs`). Wire the 3
  harnesses (classifyTier / execute-pipeline / dual-adversarial) into `validate.yml`
  (verify GH-Actions inputs/permissions per [[feedback_verify_gh_actions]]).
- **Drift-guard extraction regex** is non-greedy to the first column-0 `}` — anchor it to
  the function end (brace-depth scan / sentinel) so a future column-0 brace mid-function
  cannot silently truncate the comparison.
- **Tier 0 is operationally dead** — `tier >= 2 ? 'team' : 'standard'` collapses Tier 0
  into Tier 1; the 4-tier model is really 3 operational tiers. Either implement a lighter
  Tier-0 path or document Tier 0 ≡ Tier 1.
- **`fileCount` regex** matches only `- **files:**` (plural/lowercase/dash); repo plans use
  `**File:**` → fileCount always 0, the Tier-0 file ceiling is trivially satisfied. Latent
  (Tier 0 ≡ Tier 1 today); real if Tier 0 ever thins review.
- **EOF-sentinel residuals** — a hallucinated sentinel on a truncated transcription can
  still under-tier; and the missing-sentinel escalation only fires when `tier < 2` (a
  truncated plan with an early Tier-2 keyword keeps maxFixRounds=2 instead of Tier-3's 3).
- **Stale topology note** in `.iago/research/2026-05-30-pipeline-dynamic-upgrade.md`
  ("team mode unmerged / not in origin/main") — team mode IS on main; correct it.
- **Diff-expr inconsistency** — `execute-pipeline.js` uses two-dot `${preImplSha}..HEAD`;
  the delegated team gate uses three-dot `${base}...HEAD`. Identical today (preImplSha is
  always a HEAD ancestor); align on two-dot or document the invariant.
- **`filtered` overwritten each fix round** — the final `out.filtered` reflects only the
  last re-review; accumulate across rounds so a round-0 false double-refute stays visible.

## Pre-existing gate-infra backlog (carried from prior rounds / PR #90)
- `refuteHasEvidence` weak-evidence bar (the original #90 I1).
- Team-leg failures should be non-blocking in `gateStatus` routing (already partly there;
  confirm the orchestrator never mis-routes an incomplete-gate to /iago-prfix).
- Deterministic changed-files probe — feed the reviewer a real `git diff --name-only`
  file list instead of trusting an LLM transcription (the #90 probe-transcription-trust
  Critical).
- CI-wiring of the 3 `.test.mjs` workflow harnesses (overlaps the #89 drift-guard item).

## Note
Issue A (crossModelDegraded + filtered not surfaced by the iago-execute/iago-quick SKILLs
despite an in-code comment claiming they were) is FIXED in this PR — it was a shipped
code-comment lie about a safety signal, not polish.
