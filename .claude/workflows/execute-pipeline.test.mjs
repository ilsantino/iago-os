#!/usr/bin/env node
// Integration tests for execute-pipeline.js risk-tiering + team-gate delegation.
//
// Loads the workflow BODY inside the same async-function wrapper the live harness uses
// (see scripts/validate-workflows.mjs) and injects MOCK agent/parallel/log/phase/args/
// workflow bindings, then drives the whole flow with scripted stage replies.
//
// Run:  node .claude/workflows/execute-pipeline.test.mjs
//
// Covers the two load-bearing risk-tiering guarantees:
//  - Tier 2/3 review DELEGATES to the dual-adversarial.js team gate via workflow(), and
//    the fix-loop RE-REVIEW threads mode='team' too (the headline stress-test Critical:
//    a re-review that silently dropped to the inline 2-leg would "validate" fixes with a
//    shallower gate than the one that found them).
//  - Tier 0/1 plans NEVER delegate — they run today's inline Opus∥Codex 2-leg unchanged.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(__dirname, 'execute-pipeline.js'), 'utf8').replace(/export const meta/, 'const meta')

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

function makeHarness(rules, workflowImpl) {
  const calls = []
  const workflowCalls = []
  const agent = async (prompt, options = {}) => {
    const label = options.label || ''
    calls.push({ label, options })
    for (const r of rules) {
      if (r.match(label)) return typeof r.reply === 'function' ? r.reply({ label }) : r.reply
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
    { match: (l) => l === 'plan-read', reply: { status: 'DONE', text: planText } },
    { match: (l) => l === 'prep', reply: { status: 'DONE', preImplSha: 'base123', branch: 'feat/x' } },
    { match: (l) => l === 'implement', reply: { status: 'DONE' } },
    { match: (l) => /^build:/.test(l), reply: { passed: true } },
    { match: (l) => l === 'commit', reply: { status: 'DONE', branch: 'feat/x', headSha: 'head456' } },
    { match: (l) => /^fix:/.test(l), reply: { status: 'DONE' } },
    { match: (l) => /^rebuild:/.test(l), reply: { passed: true } },
    { match: (l) => l === 'create-pr', reply: { prUrl: 'http://pr/1', prNumber: '1' } },
    { match: (l) => l === 'tag-claude', reply: { status: 'DONE' } },
    { match: (l) => l === 'summary', reply: { status: 'DONE' } },
    { match: (l) => l === 'lock-release', reply: { status: 'DONE' } },
    ...extra,
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

// NOTE (test-coverage limitation): the internal `tier>=2 && mode!=='team'` hard-stop assertion
// in runDualAdversarial is a defensive invariant that the full-pipeline harness cannot reach —
// reviewMode is always derived as `tier>=2 ? 'team' : 'standard'`, so mode is never inconsistent
// with tier through the public flow. The above FAIL-SAFE test pins the live consequence (a
// Tier-2 plan always runs the team gate); the raw assertion guards only a future coding error.

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
