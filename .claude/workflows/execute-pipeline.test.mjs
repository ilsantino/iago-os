#!/usr/bin/env node
// Behavioral + integration test harness for execute-pipeline.js.
//
// No test framework is installed at the repo root (validate-workflows.mjs is
// compile-only), so this is a plain node:assert harness modeled on
// dual-adversarial.test.mjs. It loads the workflow BODY inside the same
// async-function wrapper the live harness uses (see scripts/validate-workflows.mjs)
// and injects MOCK agent/parallel/log/phase/args/workflow bindings, then drives the
// whole flow with scripted stage replies.
//
// Run:  node .claude/workflows/execute-pipeline.test.mjs
//
// Two suites:
//
// A — risk-tiering + team-gate delegation (#89):
//  - Tier 2/3 review DELEGATES to the dual-adversarial.js team gate via workflow(), and
//    the fix-loop RE-REVIEW threads mode='team' too (the headline stress-test Critical:
//    a re-review that silently dropped to the inline 2-leg would "validate" fixes with a
//    shallower gate than the one that found them).
//  - Tier 0/1 plans NEVER delegate — they run the inline Opus∥Codex 2-leg unchanged.
//  - FAIL-CLOSED on every team-gate failure mode, FAIL-SAFE-to-Tier-2 on unreadable/
//    garbage/sentinel-less plan reads, plan-compliance leg, and honesty propagation.
//
// B — PR-tag honesty + domain-hint threading (#93):
//  - PR_TAG_SCHEMA's tagStatus enum includes "TAG_FAILED" (the honest value an agent
//    must report when `gh pr comment` fails AFTER PR creation, instead of
//    hallucinating "TAGGED").
//  - The workflow ABORTS (throws) on tagStatus="TAG_FAILED" — never reports success
//    while the mandatory async @claude review never started — preserving prUrl/prNumber
//    for /iago-prfix recovery. Control: a healthy "TAGGED" run completes.
//  - Round-0 domainsSelected survives into a round-2 re-review as a focus hint.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(__dirname, 'execute-pipeline.js'), 'utf8').replace(/export const meta/, 'const meta')

// Build the workflow as an async function with the harness signature (same order as
// scripts/validate-workflows.mjs). The workflow ends in a top-level `return {...}`,
// so the wrapped function resolves to it (or rejects if the workflow throws).
function buildWorkflow() {
  // eslint-disable-next-line no-new-func
  return new Function(
    'agent',
    'parallel',
    'pipeline',
    'log',
    'phase',
    'args',
    'budget',
    'workflow',
    `return (async () => {\n${SRC}\n})()`,
  )
}

// ─── Suite A helpers — risk-tiering + team-gate delegation (#89) ─────────────────────
function makeHarness(rules, workflowImpl) {
  const calls = []
  const workflowCalls = []
  const agent = async (prompt, options = {}) => {
    const label = options.label || ''
    // Capture `prompt` too — Suite B asserts on the reviewPrompt text (domain-hint threading).
    calls.push({ label, prompt, options })
    for (const r of rules) {
      if (r.match(label)) return typeof r.reply === 'function' ? r.reply({ label, prompt, options }) : r.reply
    }
    throw new Error(`mock agent: no rule for label "${label}"`)
  }
  const parallel = async (legs) => Promise.all(legs.map((fn) => fn()))
  const log = () => {}
  const phase = () => {}
  const workflow = async (ref, wargs) => {
    workflowCalls.push({ ref, wargs })
    return workflowImpl(workflowCalls.length, wargs)
  }
  return { agent, parallel, log, phase, workflow, calls, workflowCalls }
}

const baseArgs = { plan: '/repo/.iago/plans/p.md', projectDir: '/repo', iagoRoot: '/iago' }

// Common happy-path stage replies (everything except review, which goes through workflow()
// in team mode or the inline review/codex agents in standard mode).
function stageRules(planText, extra = []) {
  return [
    { match: (l) => l === 'lock-acquire', reply: { status: 'ACQUIRED' } },
    { match: (l) => l === 'stress', reply: { verdict: 'PROCEED', notes: [] } },
    // A faithful plan-read transcription ends with the EOF sentinel PLANREAD_PROMPT
    // appends (its absence = possibly-truncated read → body fails safe to Tier 2).
    { match: (l) => l === 'plan-read', reply: { status: 'DONE', text: `${planText}\n===IAGO_PLAN_EOF===` } },
    // Team-mode (Tier 2/3) reviews dispatch a dedicated plan-compliance leg alongside
    // the delegated gate (#89 re-gate Critical). Default: compliant (no findings).
    { match: (l) => /^plan-compliance:/.test(l), reply: { verdict: 'PASS', findings: [] } },
    { match: (l) => l === 'prep', reply: { status: 'DONE', preImplSha: 'base123', branch: 'feat/x' } },
    { match: (l) => l === 'implement', reply: { status: 'DONE' } },
    { match: (l) => /^build:/.test(l), reply: { passed: true } },
    { match: (l) => l === 'commit', reply: { status: 'DONE', branch: 'feat/x', headSha: 'head456' } },
    { match: (l) => /^fix:/.test(l), reply: { status: 'DONE' } },
    { match: (l) => /^rebuild:/.test(l), reply: { passed: true } },
    // #93 merged PR-create + @claude-tag into one create-pr-tag agent (tagStatus drives the
    // merged pipeline's fail-closed tag assertion); summary now also releases the lock.
    { match: (l) => l === 'create-pr-tag', reply: { prUrl: 'http://pr/1', prNumber: '1', tagStatus: 'TAGGED' } },
    { match: (l) => l === 'summary', reply: { status: 'DONE' } },
    ...extra,
  ]
}

// ─── Suite B helpers — PR-tag honesty + domain-hint threading (#93) ───────────────────
// Reuses Suite A's makeHarness/baseArgs above. The PR-tag tests are Tier-1, so they take
// the inline 2-leg and never touch the workflow() mock (they pass null as the workflow
// binding). The merged pipeline ALWAYS runs plan-read for tier classification, so flowRules
// now mocks it with a Tier-1 plan (task headings, no risk keyword, EOF sentinel) → standard
// inline review, not the team gate. Tests spread `{ ...baseArgs, skipStress: true }` to skip
// the stress agent (the PR-tag path is unaffected by the stress decision).
function flowRules(prReply) {
  return [
    { match: (l) => l === 'lock-acquire', reply: { status: 'ACQUIRED' } },
    { match: (l) => l === 'plan-read', reply: { status: 'DONE', text: `${TIER1_PLAN}\n===IAGO_PLAN_EOF===` } },
    { match: (l) => l === 'prep', reply: { status: 'DONE', preImplSha: 'abc123', branch: 'main' } },
    { match: (l) => l === 'implement', reply: { status: 'DONE' } },
    { match: (l) => /^build:/.test(l), reply: { passed: true, ran: ['tsc'], summary: 'ok' } },
    {
      match: (l) => l === 'commit',
      reply: { status: 'DONE', branch: 'feat/x', headSha: 'def456' },
    },
    { match: (l) => /^review:/.test(l), reply: { verdict: 'PASS', findings: [] } },
    { match: (l) => /^codex:/.test(l), reply: { source: 'codex', findings: [] } },
    { match: (l) => l === 'create-pr-tag', reply: prReply },
    { match: (l) => l === 'summary', reply: { status: 'DONE' } },
  ]
}

let passed = 0
let failed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`PASS  ${name}`)
  } catch (e) {
    failed++
    console.error(`FAIL  ${name}\n      ${e && e.message ? e.message : e}`)
  }
}

// ════ Suite A — risk-tiering + team-gate delegation (#89) ════════════════════════════
// A tier-2 plan (contains a tier-2 keyword, no tier-3 keyword) → reviewMode 'team'.
const TIER2_PLAN = `# Plan
### Task T01
A schema migration touching amplify/data/resource.ts.`

// A tier-1 plan: 2 tasks, 4 files, no risk keywords → standard 2-leg, no delegation.
const TIER1_PLAN = `# Plan
### Task T01
- **files:** a.ts, b.ts
### Task T02
- **files:** c.ts, d.ts`

// A tier-3 plan (contains a tier-3 keyword like 'jwt') → reviewMode 'team', maxFixRounds=3.
const TIER3_PLAN = `# Plan
### Task T01
Add JWT auth middleware to verify bearer tokens against Cognito.`

await test('Tier 2 delegates to the team gate on BOTH the initial review AND the fix-loop re-review', async () => {
  // workflow() (the team gate) returns a blocking finding first → triggers a fix round →
  // re-review must call workflow() AGAIN with mode='team'; second call is clean.
  const teamGate = (n) =>
    n === 1
      ? { clean: false, blocking: 1, gateStatus: 'COMPLETE', verdict: 'FAIL', codexSource: 'codex', verificationSameFamily: true, verificationDegraded: false, findings: [{ severity: 'Critical', summary: 'boom', by: 'opus' }] }
      : { clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex', verificationSameFamily: true, verificationDegraded: false, findings: [] }
  const h = makeHarness(stageRules(TIER2_PLAN), teamGate)
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)

  assert.strictEqual(h.workflowCalls.length, 2, 'team gate invoked twice (initial + re-review)')
  for (const c of h.workflowCalls) {
    assert.strictEqual(c.wargs.mode, 'team', 'every delegation passes mode=team')
    assert.strictEqual(c.wargs.base, 'base123', 'delegation reviews preImplSha..HEAD')
    assert.strictEqual(c.wargs.skepticCap, 8, 'skepticCap forwarded')
    assert.ok(String(c.ref.scriptPath || '').endsWith('dual-adversarial.js'), 'delegates to dual-adversarial.js')
  }
  // The inline review/codex agents must NOT run in team mode (no double-review).
  assert.ok(!h.calls.some((c) => /^review:/.test(c.label) || /^codex:/.test(c.label)), 'no inline 2-leg in team mode')
  assert.strictEqual(out.fixRounds, 1, 'one fix round ran')
  assert.strictEqual(out.reviewVerdict, 'PASS', 'final verdict from the clean re-review')
})

await test('team delegation threads stressBlock (initial) + isReReview (re-review) into the gate', async () => {
  // Tier 2/3 reviews DELEGATE to the team gate, but the gate must enforce the SAME stress
  // notes and re-review integrity check as the inline 2-leg. Assert the delegation forwards
  // stressBlock (carrying the stress note) with isReReview=false on the INITIAL review, and
  // isReReview=true on the fix-loop RE-REVIEW. RED before the threading: wargs has neither.
  const rules = stageRules(TIER2_PLAN).map((r) =>
    r.match('stress')
      ? { match: (l) => l === 'stress', reply: { verdict: 'PROCEED', notes: ['guard the empty-list edge case'] } }
      : r,
  )
  const teamGate = (n) =>
    n === 1
      ? { clean: false, blocking: 1, gateStatus: 'COMPLETE', verdict: 'FAIL', codexSource: 'codex', verificationSameFamily: true, verificationDegraded: false, findings: [{ severity: 'Critical', summary: 'boom', by: 'opus' }] }
      : { clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex', verificationSameFamily: true, verificationDegraded: false, findings: [] }
  const h = makeHarness(rules, teamGate)
  const wf = buildWorkflow()
  await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)
  assert.strictEqual(h.workflowCalls.length, 2, 'team gate invoked twice (initial + re-review)')
  const [initial, reReview] = h.workflowCalls
  assert.strictEqual(initial.wargs.isReReview, false, 'initial delegation is not a re-review')
  assert.ok(
    typeof initial.wargs.stressBlock === 'string' && initial.wargs.stressBlock.includes('guard the empty-list edge case'),
    'initial delegation forwards the stress note in stressBlock',
  )
  assert.strictEqual(reReview.wargs.isReReview, true, 're-review delegation sets isReReview=true (enables the integrity check)')
  assert.ok(
    typeof reReview.wargs.stressBlock === 'string' && reReview.wargs.stressBlock.includes('guard the empty-list edge case'),
    're-review delegation still forwards the stress note',
  )
})

await test('Tier 1 runs the inline 2-leg and NEVER delegates to the team gate', async () => {
  const h = makeHarness(
    stageRules(TIER1_PLAN, [
      { match: (l) => /^review:/.test(l), reply: { verdict: 'PASS', findings: [] } },
      { match: (l) => /^codex:/.test(l), reply: { source: 'codex', findings: [] } },
    ]),
    () => {
      throw new Error('workflow() must NOT be called for a Tier 1 plan')
    },
  )
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)

  assert.strictEqual(h.workflowCalls.length, 0, 'no delegation for Tier 1')
  assert.ok(h.calls.some((c) => c.label === 'review:r0'), 'inline opus review ran')
  assert.ok(h.calls.some((c) => c.label === 'codex:r0'), 'inline codex leg ran')
  assert.strictEqual(out.reviewVerdict, 'PASS')
})

await test('Tier 3 delegates to team gate AND allows 3 fix rounds (not capped at 2)', async () => {
  // teamGate blocks on calls 1-3, clean on call 4. Tier 2 (maxFixRounds=2) would throw
  // after call 3 still blocking; Tier 3 (maxFixRounds=3) runs a third fix round instead.
  const teamGate = (n) =>
    n <= 3
      ? { clean: false, blocking: 1, gateStatus: 'COMPLETE', verdict: 'FAIL', codexSource: 'codex', verificationSameFamily: true, verificationDegraded: false, findings: [{ severity: 'Critical', summary: 'jwt validation missing', by: 'opus' }] }
      : { clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex', verificationSameFamily: true, verificationDegraded: false, findings: [] }
  const h = makeHarness(stageRules(TIER3_PLAN), teamGate)
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)

  // 1 initial (r0) + 3 fix-loop re-reviews (r1, r2, r3) = 4 workflow() invocations
  assert.strictEqual(h.workflowCalls.length, 4, 'team gate invoked 4 times (initial + 3 re-reviews for maxFixRounds=3)')
  for (const c of h.workflowCalls) {
    assert.strictEqual(c.wargs.mode, 'team', 'all delegations pass mode=team')
  }
  assert.ok(!h.calls.some((c) => /^review:/.test(c.label) || /^codex:/.test(c.label)), 'no inline 2-leg in team mode')
  assert.strictEqual(out.fixRounds, 3, 'three fix rounds ran (Tier 3 maxFixRounds)')
  assert.strictEqual(out.reviewVerdict, 'PASS', 'final verdict clean after 3rd fix round')
})

// ─── FAIL-CLOSED team-gate delegation (dual-adversarial pass #2 — 3 Criticals) ──────
// A team-mode (Tier>=2) plan MUST get a COMPLETE team review. Every team-gate failure mode
// below now STOPS the pipeline (a re-run condition) instead of silently downgrading to the
// shallow inline 2-leg — the bug that let an auth/payment/schema plan ship after the exact
// thin review the team gate exists to prevent.

await test('FAIL CLOSED: team gate gateStatus INCOMPLETE (a core leg failed) → pipeline THROWS, never ships', async () => {
  // dual-adversarial.js returns gateStatus:'INCOMPLETE', clean:false, blocking:0, findings:[]
  // when a CORE Opus/Codex leg fails to run. Reading only findings/clean/blocking mis-maps that
  // to PASS_WITH_CONCERNS with no findings → fix loop skipped → SHIP. The fix honors gateStatus.
  const teamGate = () => ({
    clean: false, blocking: 0, gateStatus: 'INCOMPLETE', incompleteLegs: ['codex'],
    verdict: 'PASS_WITH_CONCERNS', codexSource: 'unavailable', findings: [],
  })
  const h = makeHarness(stageRules(TIER2_PLAN), teamGate)
  const wf = buildWorkflow()
  await assert.rejects(
    () => wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow),
    /did NOT complete|gateStatus=INCOMPLETE/i,
    'an INCOMPLETE team gate fails closed (throws), never proceeds to PR',
  )
  assert.ok(!h.calls.some((c) => /^review:/.test(c.label) || /^codex:/.test(c.label)), 'no silent inline-2-leg downgrade')
})

await test('FAIL CLOSED: team gate THROWS → pipeline THROWS, never downgrades to the inline 2-leg', async () => {
  const teamGate = () => {
    throw new Error('nested workflow() unavailable')
  }
  const h = makeHarness(stageRules(TIER2_PLAN), teamGate)
  const wf = buildWorkflow()
  await assert.rejects(
    () => wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow),
    /team gate.*threw|failing closed/i,
    'a thrown team gate fails closed',
  )
  assert.ok(!h.calls.some((c) => /^review:/.test(c.label) || /^codex:/.test(c.label)), 'no silent inline-2-leg downgrade')
})

await test('FAIL CLOSED: team gate returns a malformed result (no findings array) → pipeline THROWS', async () => {
  const teamGate = () => ({ clean: true, blocking: 0, gateStatus: 'COMPLETE' }) // no findings array
  const h = makeHarness(stageRules(TIER2_PLAN), teamGate)
  const wf = buildWorkflow()
  await assert.rejects(
    () => wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow),
    /malformed result|no findings array/i,
    'a malformed team-gate result fails closed',
  )
})

await test('FAIL SAFE: an unreadable plan (plan-read BLOCKED) classifies Tier 2 and runs the TEAM gate, not the inline 2-leg', async () => {
  // A transient plan-read failure must NOT silently downgrade a possibly-security-sensitive plan
  // to the shallow Tier-1 inline review. The fix classifies an unreadable plan to Tier 2 (team).
  const teamGate = () => ({
    clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex',
    verificationSameFamily: true, verificationDegraded: false, findings: [],
  })
  const rules = [
    { match: (l) => l === 'plan-read', reply: { status: 'BLOCKED', notes: 'transient read fault' } },
    ...stageRules(TIER1_PLAN).filter((r) => !r.match('plan-read')),
  ]
  const h = makeHarness(rules, teamGate)
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)
  assert.ok(h.workflowCalls.length >= 1, 'team gate invoked for the unreadable (fail-safe Tier 2) plan')
  assert.strictEqual(h.workflowCalls[0].wargs.mode, 'team', 'unreadable plan routed to mode=team')
  assert.ok(!h.calls.some((c) => /^review:/.test(c.label) || /^codex:/.test(c.label)), 'no inline 2-leg for the fail-safe Tier 2 plan')
  assert.strictEqual(out.reviewVerdict, 'PASS')
})

await test('FAIL SAFE: a DONE plan-read with garbage / no-task-heading text classifies Tier 2 (team), not the shallow inline 2-leg', async () => {
  // The gap the BLOCKED test above does NOT cover: a read that returns status=DONE but whose
  // text has NO `### T...` task headings (a truncated read, an error string, or any
  // non-plan body) is garbage masquerading as success. planReadOk is true (non-empty DONE),
  // so classifyTier runs and maps zero headings to its Tier-1 parse-failure default — which
  // would route a possibly-security-sensitive plan to the SHALLOW inline 2-leg. The body
  // fail-safe must escalate a no-heading DONE read to the deep TEAM gate (Tier 2), the same
  // direction as a BLOCKED read. RED before the fix: classifyTier→1→inline review:/codex:.
  const GARBAGE = 'Error: ENOENT failed to read the plan file; this diagnostic was returned instead of the plan body.'
  const teamGate = () => ({
    clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex',
    verificationSameFamily: true, verificationDegraded: false, findings: [],
  })
  const rules = [
    { match: (l) => l === 'plan-read', reply: { status: 'DONE', text: GARBAGE } },
    ...stageRules(TIER1_PLAN).filter((r) => !r.match('plan-read')),
  ]
  const h = makeHarness(rules, teamGate)
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)
  assert.ok(h.workflowCalls.length >= 1, 'team gate invoked for the garbage-read (fail-safe Tier 2) plan')
  assert.strictEqual(h.workflowCalls[0].wargs.mode, 'team', 'garbage-read plan routed to mode=team')
  assert.ok(!h.calls.some((c) => /^review:/.test(c.label) || /^codex:/.test(c.label)), 'no inline 2-leg for the fail-safe Tier 2 plan')
  assert.strictEqual(out.reviewVerdict, 'PASS')
})

await test('T06 honesty: verificationDegraded from the team gate propagates to the pipeline return', async () => {
  // A degraded skeptic verification (a real run gap) must reach the orchestrator's final return
  // so the human merge decision sees verification was incomplete. (T06's wrapper-read, end-to-end.)
  const teamGate = () => ({
    clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex',
    verificationSameFamily: true, verificationDegraded: true, findings: [],
  })
  const h = makeHarness(stageRules(TIER2_PLAN), teamGate)
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)
  assert.strictEqual(out.verificationDegraded, true, 'verificationDegraded surfaced to the final return')
  assert.strictEqual(out.verificationSameFamily, true, 'verificationSameFamily surfaced to the final return')
})

await test('FAIL SAFE: a DONE plan-read MISSING the EOF sentinel (possibly truncated) classifies Tier 2 (team), not inline', async () => {
  // #89 re-gate Important: an LLM transcribes the plan; a TRUNCATED transcription that
  // still contains ≥1 task heading classifies on incomplete text and can drop a late
  // risk keyword (silent under-tier). PLANREAD_PROMPT appends ===IAGO_PLAN_EOF=== after
  // the cat; a transcription that lost the tail lost the sentinel. RED before the fix:
  // a heading-bearing Tier-1 text without the sentinel ran the shallow inline 2-leg.
  const teamGate = () => ({
    clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex',
    verificationSameFamily: true, verificationDegraded: false, findings: [],
  })
  const rules = [
    // headings present, NO sentinel — the truncation signature
    { match: (l) => l === 'plan-read', reply: { status: 'DONE', text: TIER1_PLAN } },
    ...stageRules(TIER1_PLAN).filter((r) => !r.match('plan-read')),
  ]
  const h = makeHarness(rules, teamGate)
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)
  assert.ok(h.workflowCalls.length >= 1, 'team gate invoked for the sentinel-less (fail-safe Tier 2) read')
  assert.strictEqual(h.workflowCalls[0].wargs.mode, 'team', 'sentinel-less read routed to mode=team')
  assert.ok(!h.calls.some((c) => /^review:/.test(c.label) || /^codex:/.test(c.label)), 'no inline 2-leg for the fail-safe Tier 2 plan')
  assert.strictEqual(out.reviewVerdict, 'PASS')
})

await test('team mode runs a dedicated PLAN-COMPLIANCE leg and its findings drive the fix loop', async () => {
  // #89 re-gate Critical: the delegated team gate never reads the plan, so a Tier 2/3
  // implementation could omit a required plan task and still PASS. The compliance leg
  // restores the inline PASS-1: its blocking finding must trigger a fix round even when
  // the gate itself is clean, and the re-review must run the leg again. RED before the
  // fix: no plan-compliance agent is dispatched and the run ships with zero fix rounds.
  const teamGate = () => ({
    clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex',
    verificationSameFamily: true, verificationDegraded: false, findings: [],
  })
  let complianceCalls = 0
  const rules = [
    {
      match: (l) => /^plan-compliance:/.test(l),
      reply: () => {
        complianceCalls++
        return complianceCalls === 1
          ? { verdict: 'FAIL', findings: [{ severity: 'Critical', file: 'amplify/data/resource.ts', summary: 'plan task T01 (schema migration) has no corresponding change in the diff' }] }
          : { verdict: 'PASS', findings: [] }
      },
    },
    ...stageRules(TIER2_PLAN).filter((r) => !r.match('plan-compliance:r0')),
  ]
  const h = makeHarness(rules, teamGate)
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)
  assert.ok(h.calls.some((c) => c.label === 'plan-compliance:r0'), 'compliance leg ran on the initial review')
  assert.ok(h.calls.some((c) => c.label === 'plan-compliance:r1'), 'compliance leg ran again on the re-review')
  assert.strictEqual(out.fixRounds, 1, 'the compliance finding (gate clean!) triggered a fix round')
  assert.strictEqual(out.reviewVerdict, 'PASS', 'clean after the compliance gap was fixed')
})

await test('FAIL CLOSED: a null or malformed plan-compliance leg in team mode THROWS — never proceeds without the pass', async () => {
  const teamGate = () => ({
    clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex',
    verificationSameFamily: true, verificationDegraded: false, findings: [],
  })
  // (a) NULL leg — withRetry exhausts both attempts and throws its skipped-agent error.
  const nullRules = [
    { match: (l) => /^plan-compliance:/.test(l), reply: null },
    ...stageRules(TIER2_PLAN).filter((r) => !r.match('plan-compliance:r0')),
  ]
  const hNull = makeHarness(nullRules, teamGate)
  await assert.rejects(
    () => buildWorkflow()(hNull.agent, hNull.parallel, null, hNull.log, hNull.phase, { ...baseArgs }, null, hNull.workflow),
    /plan-compliance:r0.*skipped/i,
    'a null compliance leg fails closed (withRetry skipped-agent throw)',
  )
  // (b) MALFORMED leg (truthy, no findings array) — the wrapper's own guard throws.
  const malformedRules = [
    { match: (l) => /^plan-compliance:/.test(l), reply: { verdict: 'PASS' } },
    ...stageRules(TIER2_PLAN).filter((r) => !r.match('plan-compliance:r0')),
  ]
  const hMal = makeHarness(malformedRules, teamGate)
  await assert.rejects(
    () => buildWorkflow()(hMal.agent, hMal.parallel, null, hMal.log, hMal.phase, { ...baseArgs }, null, hMal.workflow),
    /plan-compliance leg failed/i,
    'a malformed compliance leg fails closed (wrapper guard)',
  )
})

await test('honesty propagation: crossModelDegraded + filtered flow from the team gate to the pipeline return', async () => {
  // #89 re-gate Important + Critical: the gate's cross-model degradation flag and its
  // skeptic-FILTERED findings (the audit trail of dropped blockers) must reach the final
  // pipeline return for the human merge decision — a log line dies with the session.
  // RED before the fix: both fields were absent from the wrapper and final return.
  const FILTERED = [{ severity: 'Critical', summary: 'double-refuted by skeptics', by: 'codex' }]
  const teamGate = () => ({
    clean: false, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS_WITH_CONCERNS',
    codexSource: 'claude-fallback', crossModelDegraded: true,
    verificationSameFamily: true, verificationDegraded: false,
    findings: [], filtered: FILTERED,
  })
  const h = makeHarness(stageRules(TIER2_PLAN), teamGate)
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)
  assert.strictEqual(out.crossModelDegraded, true, 'crossModelDegraded surfaced to the final return')
  assert.deepStrictEqual(out.filtered, FILTERED, 'skeptic-filtered findings surfaced verbatim to the final return')
  assert.strictEqual(out.reviewVerdict, 'PASS_WITH_CONCERNS', 'a not-clean gate with zero live findings stays PASS_WITH_CONCERNS')
})

await test('T08 structural: the fix agent forwards agentType executor (source-level pin)', async () => {
  // The harness mocks agent(), so options.agentType has no behavioral effect here; the
  // plan's T08 regression note specifies a structural source assertion instead.
  assert.ok(/agentType:\s*'executor'/.test(SRC), "fix agent call carries agentType: 'executor'")
})

// NOTE (test-coverage limitation): the internal `tier>=2 && mode!=='team'` hard-stop assertion
// in runDualAdversarial is a defensive invariant that the full-pipeline harness cannot reach —
// reviewMode is always derived as `tier>=2 ? 'team' : 'standard'`, so mode is never inconsistent
// with tier through the public flow. The above FAIL-SAFE test pins the live consequence (a
// Tier-2 plan always runs the team gate); the raw assertion guards only a future coding error.

// ════ Suite B — PR-tag honesty + domain-hint threading (#93) ═════════════════════════
// ── Schema: TAG_FAILED must be representable ─────────────────────────────
await test('PR_TAG_SCHEMA tagStatus enum includes TAG_FAILED (honest failure value)', () => {
  // Without the fix the enum is [TAGGED, ALREADY_TAGGED, SKIPPED_NO_PR_NUMBER] and an
  // agent whose `gh pr comment` failed after PR creation has no truthful schema-valid
  // value — its only conformant escape is to hallucinate TAGGED. This assertion fails
  // without the fix.
  const m = SRC.match(/const PR_TAG_SCHEMA = \{[\s\S]*?\n\}/)
  assert.ok(m, 'PR_TAG_SCHEMA definition found in source')
  const block = m[0]
  for (const v of ['TAGGED', 'ALREADY_TAGGED', 'SKIPPED_NO_PR_NUMBER', 'TAG_FAILED']) {
    assert.ok(block.includes(`'${v}'`), `tagStatus enum includes '${v}'`)
  }
})

// ── Behavior: TAG_FAILED aborts the pipeline, preserving prUrl/prNumber ───
await test('workflow ABORTS when create-pr-tag returns tagStatus=TAG_FAILED', async () => {
  const h = makeHarness(
    flowRules({
      prUrl: 'https://github.com/o/r/pull/42',
      prNumber: '42',
      branch: 'feat/x',
      tagStatus: 'TAG_FAILED',
    }),
  )
  const wf = buildWorkflow()
  let threw = false
  let msg = ''
  try {
    await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null)
  } catch (e) {
    threw = true
    msg = e && e.message ? e.message : String(e)
  }
  assert.ok(threw, 'a TAG_FAILED tag must throw, never report pipeline success')
  // The abort must NOT happen on the PR-number assertion — the PR was created.
  assert.ok(!/did not yield a usable PR url\/number/.test(msg), 'aborts on the tag guard, not the number guard')
  // Recovery affordance: the message preserves the real PR url + number for /iago-prfix.
  assert.ok(msg.includes('42'), 'abort message preserves prNumber 42 for recovery')
  assert.ok(msg.includes('pull/42'), 'abort message preserves prUrl for recovery')
  assert.ok(/iago-prfix/.test(msg), 'abort message names /iago-prfix as the recovery path')
  // The summary stage must NOT have run — the pipeline stopped at the tag guard.
  assert.ok(!h.calls.some((c) => c.label === 'summary'), 'summary stage never runs after a TAG_FAILED abort')
})

// ── Control: a healthy TAGGED run completes ──────────────────────────────
await test('workflow COMPLETES when create-pr-tag returns tagStatus=TAGGED', async () => {
  const h = makeHarness(
    flowRules({
      prUrl: 'https://github.com/o/r/pull/42',
      prNumber: '42',
      branch: 'feat/x',
      tagStatus: 'TAGGED',
    }),
  )
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null)
  assert.strictEqual(out.prNumber, '42', 'returns the PR number on a healthy run')
  assert.strictEqual(out.prUrl, 'https://github.com/o/r/pull/42', 'returns the PR url')
  assert.ok(h.calls.some((c) => c.label === 'summary'), 'summary stage runs on a healthy run')
})

// ── Behavior: round-0 domainsSelected survives into a round-2 re-review ───
// Regression for the dual-adversarial Minor: the re-review is instructed NOT to
// re-derive domainsSelected, so it returns []/undefined. Destructuring it directly
// reset the outer variable to [] after round 1, dropping the focus hint for round-2's
// re-review. The fix preserves the round-0 selection when a re-review returns none.
// This test forces TWO fix rounds and asserts the round-2 review prompt still carries
// the round-0 domains. Without the fix, domainsSelected is [] by round 2 and the hint
// is absent → this assertion fails.
await test('round-0 domainsSelected is preserved into the round-2 re-review hint', async () => {
  const rules = [
    { match: (l) => l === 'lock-acquire', reply: { status: 'ACQUIRED' } },
    // Tier-1 plan-read (merged pipeline always classifies tier) → standard inline 2-leg.
    { match: (l) => l === 'plan-read', reply: { status: 'DONE', text: `${TIER1_PLAN}\n===IAGO_PLAN_EOF===` } },
    { match: (l) => l === 'prep', reply: { status: 'DONE', preImplSha: 'abc123', branch: 'main' } },
    { match: (l) => l === 'implement', reply: { status: 'DONE' } },
    { match: (l) => /^build:/.test(l), reply: { passed: true, ran: ['tsc'], summary: 'ok' } },
    { match: (l) => /^rebuild:/.test(l), reply: { passed: true, ran: ['tsc'], summary: 'ok' } },
    { match: (l) => l === 'commit', reply: { status: 'DONE', branch: 'feat/x', headSha: 'def456' } },
    // round 0: blocking + domains → triggers fix round 1
    {
      match: (l) => l === 'review:r0',
      reply: { verdict: 'FAIL', findings: [{ severity: 'Critical', summary: 'c0' }], domainsSelected: ['auth', 'api'] },
    },
    // round 1 re-review: still blocking, returns NO domainsSelected → triggers fix round 2
    { match: (l) => l === 'review:r1', reply: { verdict: 'FAIL', findings: [{ severity: 'Critical', summary: 'c1' }] } },
    // round 2 re-review: clean → loop ends
    { match: (l) => l === 'review:r2', reply: { verdict: 'PASS', findings: [] } },
    { match: (l) => /^codex:/.test(l), reply: { source: 'codex', findings: [] } },
    { match: (l) => /^fix:/.test(l), reply: { status: 'DONE' } },
    {
      match: (l) => l === 'create-pr-tag',
      reply: { prUrl: 'https://github.com/o/r/pull/7', prNumber: '7', branch: 'feat/x', tagStatus: 'TAGGED' },
    },
    { match: (l) => l === 'summary', reply: { status: 'DONE' } },
  ]
  const h = makeHarness(rules)
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null)
  assert.strictEqual(out.fixRounds, 2, 'two fix rounds ran (forces a round-2 re-review)')
  const r1 = h.calls.find((c) => c.label === 'review:r1')
  const r2 = h.calls.find((c) => c.label === 'review:r2')
  assert.ok(r1, 'a round-1 re-review ran')
  assert.ok(r2, 'a round-2 re-review ran')
  // round 1 gets the hint straight from round 0; round 2 only gets it if it was PRESERVED
  // across round 1 (which returned no domainsSelected) — the regression assertion.
  assert.ok(/Domains identified in round 0: auth, api/.test(r1.prompt), 'round-1 re-review carried the hint')
  assert.ok(
    /Domains identified in round 0: auth, api/.test(r2.prompt),
    'round-2 re-review still carries the round-0 hint (preserved, not reset to [])',
  )
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
