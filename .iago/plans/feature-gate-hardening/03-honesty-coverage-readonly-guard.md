---
phase: feature-gate-hardening
plan: 03
wave: 1
depends_on: []
context: .iago/research/2026-06-13-gate-hardening-backlog.md
created: 2026-06-15
source: feature
---

# Plan: feature-gate-hardening/03-honesty-coverage-readonly-guard

## Goal
Close the honesty-signal test-coverage gaps (durable summary artifact + inline `crossModelDegraded` true-branch) and add a read-only guard plus HEAD/porcelain change-detection to the plan-compliance review leg so a side-effecting compliance agent fails closed instead of silently dirtying or advancing the pipeline tree.

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `.claude/workflows/execute-pipeline.js` | Add the read-only guard to `planCompliancePrompt()`; capture HEAD before / detect HEAD-advance + dirty-tree after the compliance leg in `runDualAdversarial()` and fail closed. |
| modify | `.claude/workflows/execute-pipeline.test.mjs` | Extend the T06 honesty test (prompt-content + NDJSON-flag assertions); add a Tier-1 inline `crossModelDegraded === true` test; extend the team-mode plan-compliance test with a read-only-prompt assertion; add `stageRules()` mocks for the two new snapshot labels. |

## Tasks

### Task 1: Assert the durable summary artifact carries the honesty signal (prompt + NDJSON fields)
- **files:** `.claude/workflows/execute-pipeline.test.mjs`
- **action:** Extend the existing test `'T06 honesty: verificationDegraded from the team gate propagates to the pipeline return'` (at `execute-pipeline.test.mjs:L356-L368`) by appending four assertions after the existing `await wf(...)` and the two return-object asserts. The mock agent in `makeHarness` already pushes `{ label, prompt }` into `calls[]`, so no harness change is needed. Find the summary call with `const summaryCall = h.calls.find(c => c.label === 'summary')`; assert `summaryCall` is truthy; assert `summaryCall.prompt.includes('same-family')` (the `vSameFamily` honesty token emitted by `summaryPrompt()` at `execute-pipeline.js:L553`); assert `summaryCall.prompt.includes('WARNING')` (the `vDegraded` honesty token at `execute-pipeline.js:L554`); assert `summaryCall.prompt.includes('"vSameFamily":true')` and `summaryCall.prompt.includes('"vDegraded":true')` (the exact literals the NDJSON template `${vSameFamily === true}` / `${vDegraded === true}` at `execute-pipeline.js:L560` render, since the T06 teamGate returns both flags true). Use these exact literal tokens — match `"vDegraded":true` (no space around the colon) as the template emits. Do NOT touch `classify-tier.mjs` or `classifyTier.test.mjs`; `summaryPrompt()` is the only production symbol exercised and no source edit is made in this task.
- **verify:** `node .claude/workflows/execute-pipeline.test.mjs`
- **expected:** All previously-passing tests still print PASS; the extended T06 test prints PASS (not FAIL with a `summaryPrompt carries...` / NDJSON message). Zero new FAIL lines. Exit 0.

### Task 2: Cover the inline 2-leg `crossModelDegraded === true` branch (claude-fallback codex source)
- **files:** `.claude/workflows/execute-pipeline.test.mjs`
- **action:** Add one new Tier-1 Suite B test after the existing `'workflow COMPLETES when create-pr-tag returns tagStatus=TAGGED'` test (at `execute-pipeline.test.mjs:L533-L547`) and before the `domainsSelected` re-review test at L549. Build rules from `flowRules({ prUrl: 'https://github.com/o/r/pull/99', prNumber: '99', branch: 'feat/x', tagStatus: 'TAGGED' })`, then map over them replacing the codex rule — match the SAME `/^codex:/` regex `flowRules()` uses at `execute-pipeline.test.mjs:L129` (`r.match('codex:r0')` ? `{ match: (l) => /^codex:/.test(l), reply: { source: 'claude-fallback', findings: [] } }` : `r`) so the override returns `source: 'claude-fallback'` for the round-0 codex leg. Run `const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null)` (null workflow binding — Tier-1 takes the inline 2-leg, never the team gate) and assert `out.crossModelDegraded === true` (the inline branch at `execute-pipeline.js:L762` is `codex.source !== 'codex'`, true only for `'claude-fallback'`) and `out.reviewVerdict === 'PASS'`. This is inline-only; do NOT touch `classify-tier.mjs` or `classifyTier.test.mjs` — the byte-identical copy contract at `execute-pipeline.js:L283-L287` covers `classifyTier` only, not `crossModelDegraded`.
- **verify:** `node .claude/workflows/execute-pipeline.test.mjs`
- **expected:** New test prints `PASS  Tier-1 inline 2-leg: crossModelDegraded is true when codex falls back to claude-fallback`. All previously-passing tests still pass. Exit 0.

### Task 3: Add a read-only guard to `planCompliancePrompt()` and assert it in the team-mode compliance test
- **files:** `.claude/workflows/execute-pipeline.js`, `.claude/workflows/execute-pipeline.test.mjs`
- **action:** In `planCompliancePrompt()` at `execute-pipeline.js:L572-L581`, append an explicit read-only guard paragraph mirroring `buildVerifyPrompt`'s wording — insert it between step 2 and step 3 (or as the last paragraph before the `Return verdict...` directive) so it is prominent: `READ-ONLY: do NOT edit any file, do NOT stage, do NOT commit, do NOT run any build or test command. Your ONLY permitted operations are: reading files (cat, git show, git diff), reading git history (git log, git diff --name-only). Any write operation here corrupts the pipeline tree.`. Do NOT modify the shared `PREAMBLE` constant at `execute-pipeline.js:L258-L262` — the guard overrides PREAMBLE's `Run all git/build/file operations there` permission INSIDE `planCompliancePrompt()` only, exactly as `buildVerifyPrompt` does. Then extend the existing test `'team mode runs a dedicated PLAN-COMPLIANCE leg and its findings drive the fix loop'` (at `execute-pipeline.test.mjs:L394-L424`) by appending: `const complianceCall = h.calls.find(c => c.label === 'plan-compliance:r0')`; assert `complianceCall` truthy; assert `/do NOT edit|do NOT commit|READ-ONLY/i.test(complianceCall.prompt)` with message `'planCompliancePrompt contains the read-only guard'`.
- **verify:** `node .claude/workflows/execute-pipeline.test.mjs`
- **expected:** All existing tests pass. The extended `'team mode runs a dedicated PLAN-COMPLIANCE leg...'` test passes including the new read-only-prompt assertion (fails with `'planCompliancePrompt contains the read-only guard'` if the guard text was not added). Exit 0.

### Task 4: Fail closed when the compliance leg advances HEAD or dirties the tree (HEAD snapshot + porcelain)
- **files:** `.claude/workflows/execute-pipeline.js`, `.claude/workflows/execute-pipeline.test.mjs`
- **action:** In `runDualAdversarial()` at the compliance call site (`execute-pipeline.js:L655-L663`), snapshot HEAD BEFORE the compliance `withRetry(...)` call and check HEAD-advance + dirty-tree AFTER it. Add a pre-snapshot agent with `label: 'compliance-pre-snap'`, `schema: PLANTEXT_SCHEMA` (already defined at `execute-pipeline.js:L120-L127`), `model: 'haiku'`, prompt `${PREAMBLE}\n\nRun: git -C "${projectDir}" rev-parse HEAD\nReturn status=DONE with text=the sha.`. After the existing compliance call, add a post-snapshot agent with `label: 'compliance-post-snap'`, same `PLANTEXT_SCHEMA` + `haiku`, prompt instructing it to run `git -C "${projectDir}" rev-parse HEAD` then `git -C "${projectDir}" status --porcelain` and return `text="<sha> <porcelain_lines_or_empty>"`. Then throw if `preComplianceHead?.text && postComplianceHead?.text && !postComplianceHead.text.trim().startsWith(preComplianceHead.text.trim().split('\n')[0])` with message `plan-compliance leg (${label}) advanced HEAD or dirtied the tree — a read-only compliance agent must not commit or edit; failing closed.` (the `startsWith` check fails on a HEAD advance, and a non-empty porcelain appended after the same sha also fails the prefix when the pre-sha differs; a committed change advances HEAD and is caught). This is the highest cross-test blast-radius change: in `stageRules()` (at `execute-pipeline.test.mjs:L86-L108`) add two mock rules — `{ match: (l) => l === 'compliance-pre-snap', reply: { status: 'DONE', text: 'abc123' } }` and `{ match: (l) => l === 'compliance-post-snap', reply: { status: 'DONE', text: 'abc123 ' } }` — so existing Tier-2 happy-path tests do not fail with `mock agent: no rule for label compliance-pre-snap`; the post sha must share the pre sha prefix so the happy path does NOT throw. Do NOT touch `classify-tier.mjs` or `classifyTier.test.mjs`; no new schema is needed (reuse `PLANTEXT_SCHEMA`).
- **verify:** `node .claude/workflows/execute-pipeline.test.mjs`
- **expected:** All existing Tier-2 team-gate tests still pass (no `mock agent: no rule for label compliance-pre-snap` / `compliance-post-snap` failures). The compliance happy path does not throw (pre/post sha share a prefix). Exit 0.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-06-15

### PRECISION

**P1 (Important) — Task 4 dirty-tree check is logically broken.**
The throw condition is:
```js
!postComplianceHead.text.trim().startsWith(preComplianceHead.text.trim().split('\n')[0])
```
The post-snap prompt instructs the agent to return `text="<sha> <porcelain_lines_or_empty>"` as a single string. When the compliance agent edits a file but does NOT commit, the SHA is unchanged and the porcelain is non-empty — e.g. `'abc123\n M execute-pipeline.js'`. `'abc123\n M execute-pipeline.js'.startsWith('abc123')` is `true`, so the throw does NOT fire. The guard only catches a HEAD advance (committed change), not an uncommitted dirty-tree side effect — the most common compliance-agent failure mode (an agent that edits but forgets to commit) passes silently. The plan's own comment says "a non-empty porcelain appended after the same sha also fails the prefix when the pre-sha differs" — this is wrong when the sha is unchanged.

**P2 (Minor) — Task 2 override pattern notation is ambiguous.**
Task 2 writes `r.match('codex:r0')` as the predicate when mapping over `flowRules()` rules. `r.match` is the stored predicate function, so calling `r.match('codex:r0')` invokes it — it works, but reads as if `r` has a native `.match()` string method. A cleaner expression is `/^codex:/.test(r.match?.toString() ?? '')` or simply an index-based replacement. No behavioral bug, just a trap for the implementer.

### EDGE CASES

**E1 (Important) — Task 4 adds no negative test proving the guard fires.**
The plan only adds stageRules mocks for the happy path (pre-sha === post-sha prefix → no throw). There is no test case where `postComplianceHead.text` starts with a different SHA (HEAD advance) and asserts the pipeline throws. A guard with zero negative coverage can be silently broken by a one-character typo in the throw condition. Per tdd.md and execution-pipeline.md §Fix Session Contract: "For each Critical/Important finding, add or extend a regression test — it must fail without the fix and pass with it." The guard itself is the Critical feature; it needs a RED test.

**E2 (Minor) — Task 4 agent-based snapshot is non-deterministic.**
Using `haiku` LLM agents to capture `git rev-parse HEAD` and `git status --porcelain` introduces hallucination risk in what is a fully deterministic operation. Per `layer-triage.md` 60/30/10: git shell calls are the deterministic layer. An agent that truncates or pads the SHA string turns every subsequent startsWith check into a false-positive throw. A deterministic bash subshell (if the harness permitted it) or a haiku agent with a strictly bounded prompt that quotes the git output verbatim is the safer pattern; the plan should note the truncation risk and mandate verbatim output without summarisation.

**E3 (Minor) — THIS plan's text classifies as Tier 2 at runtime.**
The word "schema" (a Tier-2 keyword per `TIER2_KEYWORDS`) appears repeatedly in this plan's body (PLANTEXT_SCHEMA, PR_TAG_SCHEMA, REVIEW_SCHEMA). When the pipeline runs plan 03, `classifyTier` will return Tier 2 and trigger the team gate + compliance leg on this plan's own diff. That is correct behavior, but it means the implementer should expect a team-mode run (not the shallow inline 2-leg) and should not be surprised by the slower, deeper gate.

### CONTRADICTIONS

**C1 (Important) — Task 4 violates the 60/30/10 deterministic-layer rule.**
`layer-triage.md` is explicit: "exact calculations, data lookups, file operations, deterministic transforms → scripts, databases, CLI utilities." Capturing `git rev-parse HEAD` and `git status --porcelain` via two LLM agent spawns (even haiku) puts a deterministic operation on the AI layer. The existing codebase already uses the haiku model for tiny fetch tasks (PLANREAD_PROMPT), so this is an established pattern, but the compliance snapshot is more fragile than a plan read because a SHA mismatch triggers a pipeline abort. The plan should at minimum mandate verbatim output in the agent prompt (as PLANREAD_PROMPT does with its EOF sentinel) and/or add a null-guard before the startsWith call.

**C2 (Minor) — No `classify-tier.mjs` / `classifyTier.test.mjs` drift-guard implication.**
The plan correctly states "Do NOT touch `classify-tier.mjs` or `classifyTier.test.mjs`" across all four tasks. The byte-identical copy contract at `execute-pipeline.js:L283-L287` is respected — no edits to the classifier copy are proposed. No contradiction.

### MISSING ACCEPTANCE CRITERIA

**M1 (Important) — Task 4 guard fires on HEAD advance: no test.**
The verification section only states "the compliance happy path does NOT throw (pre/post sha share a prefix)." There is no acceptance criterion for the violation path: "when postComplianceHead.text starts with a different SHA, the pipeline throws with message containing 'advanced HEAD'." Without this, an implementer who writes `if (false) throw ...` passes all stated expected outputs.

**M2 (Minor) — Task 3 read-only guard regex is too broad.**
The assertion `/do NOT edit|do NOT commit|READ-ONLY/i` matches any occurrence of those strings anywhere in the prompt — including in the PREAMBLE or in the re-review header. If the guard text is accidentally added to the wrong function or already present via PREAMBLE inheritance, the test still passes. A tighter assertion would check that the guard text appears AFTER the last step directive (e.g., assert `complianceCall.prompt.indexOf('READ-ONLY') > complianceCall.prompt.indexOf('Return verdict')`). Low risk given the function is short, but the test gives a weak signal.

**M3 (Minor) — Task 1 summary test does not verify the NDJSON line was actually written.**
The plan asserts prompt content (the template that instructs the agent to write the NDJSON line), not that the agent executed the write. Since the harness mocks the summary agent, the NDJSON write never happens in the test. This is acceptable at the unit level (the harness tests prompt contract, not agent execution), but the plan does not note this limitation, leaving the implementer unsure whether an integration test is also expected.

## Verification
Run the full harness plus a syntax check on the edited source:

```
node .claude/workflows/execute-pipeline.test.mjs && node --check .claude/workflows/execute-pipeline.js && node --check .claude/workflows/execute-pipeline.test.mjs
```

Expected: every test prints `PASS` (including the extended T06 honesty test, the new inline `crossModelDegraded` Tier-1 test, and the read-only-guard assertion in the team-mode compliance test), zero `FAIL` lines, and both `node --check` invocations exit 0 with no output. Overall exit 0.
