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

// ── Verification-contract fixtures (plan 01 + its round-1 fix) ──────────────────────
// The INLINE Tier-0/1 legs now carry the same runtime proof-of-work guard as
// dual-adversarial.js: a core leg with an empty `findings` array AND no proof of work is an
// UNREVIEWED leg (the PR #78 silent no-op), so the pipeline fails closed. Every clean-leg
// fixture below therefore ships the minimum conformant proof; tests that must TRIP the rule
// omit it deliberately.
const PROPS = [
  { property: 'no auth boundary is crossed by the changed handler', verdict: 'HOLDS', evidence: 'src/x.ts:12' },
]
// The codex leg maps codex-companion free text, so a non-empty `evidence` string is its proof.
const CODEX_EVIDENCE = 'ran codex-companion adversarial-review --base base123 --wait → "approve, no material findings"'
const FS = 'concrete: an empty list reaches the aggregate and yields NaN'

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
    { match: (l) => /^plan-compliance:/.test(l), reply: { verdict: 'PASS', findings: [], propertiesChecked: PROPS } },
    // plan 03 Task 4 — the compliance leg is bracketed by read-only HEAD/porcelain snapshots.
    // Happy-path: same head, clean porcelain before and after → no side-effect breach.
    { match: (l) => l === 'compliance-pre-snap', reply: { status: 'DONE', head: 'abc123', porcelain: '' } },
    { match: (l) => l === 'compliance-post-snap', reply: { status: 'DONE', head: 'abc123', porcelain: '' } },
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
    { match: (l) => /^review:/.test(l), reply: { verdict: 'PASS', findings: [], propertiesChecked: PROPS } },
    { match: (l) => /^codex:/.test(l), reply: { source: 'codex', findings: [], evidence: CODEX_EVIDENCE } },
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
    assert.strictEqual(c.wargs.lenses, 'auto', 'every delegation forwards lenses:auto (AUTO path → load-bearing lenses on BOTH initial + re-review)')
    assert.ok(String(c.ref.scriptPath || '').endsWith('dual-adversarial.js'), 'delegates to dual-adversarial.js')
  }
  // The inline review/codex agents must NOT run in team mode (no double-review).
  assert.ok(!h.calls.some((c) => /^review:/.test(c.label) || /^codex:/.test(c.label)), 'no inline 2-leg in team mode')
  assert.strictEqual(out.fixRounds, 1, 'one fix round ran')
  assert.strictEqual(out.reviewVerdict, 'PASS', 'final verdict from the clean re-review')
})

await test('team delegation forwards lenses:"auto" → dual-adversarial.js AUTO path (NOT explicit [], which skips the load-bearing lenses + INCOMPLETE guard)', async () => {
  // #96 added auto-derived load-bearing lenses (security/amplify/frontend) + an
  // INCOMPLETE-on-failed-load-bearing-lens guard to dual-adversarial.js, but BOTH fire ONLY on
  // its AUTO path (lensSource==='auto'). dual-adversarial.js treats an explicit Array (incl. [])
  // as the EXPLICIT path → zero path-derived lenses + the guard unreachable. So the production
  // Tier 2/3 delegation MUST forward lenses:'auto' (or omit it), never an explicit []. RED before
  // this follow-up: reviewLenses=[] → wargs.lenses=[] (an array) → dual-adversarial.js EXPLICIT
  // path → the #96 hardening was dead code from /iago-execute (the gap this test closes).
  const teamGate = () => ({
    clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex',
    verificationSameFamily: true, verificationDegraded: false, findings: [],
  })
  const h = makeHarness(stageRules(TIER2_PLAN), teamGate)
  const wf = buildWorkflow()
  await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)
  assert.strictEqual(h.workflowCalls.length, 1, 'team gate invoked once (clean initial review)')
  const { lenses } = h.workflowCalls[0].wargs
  // 'auto' (string) is dual-adversarial.js's AUTO-path trigger; an explicit Array (incl. []) is NOT.
  assert.strictEqual(lenses, 'auto', `Tier 2/3 delegation must forward lenses:'auto' for the AUTO path; got ${JSON.stringify(lenses)} (an explicit array skips the auto-derived load-bearing lenses)`)
  assert.ok(!Array.isArray(lenses), 'lenses must NOT be an explicit array (an array takes dual-adversarial.js EXPLICIT path → zero load-bearing lenses, guard unreachable)')
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
      { match: (l) => /^review:/.test(l), reply: { verdict: 'PASS', findings: [], propertiesChecked: PROPS } },
      { match: (l) => /^codex:/.test(l), reply: { source: 'codex', findings: [], evidence: CODEX_EVIDENCE } },
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
    assert.strictEqual(c.wargs.lenses, 'auto', 'all delegations forward lenses:auto (AUTO path → load-bearing lenses)')
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
  // text has NO `### T...` task headings (an error string or any non-plan body) is garbage
  // masquerading as success. planReadOk is true (non-empty DONE), so classifyTier maps zero
  // headings to its Tier-1 parse-failure default — which would route a possibly-sensitive
  // plan to the SHALLOW inline 2-leg. The body fail-safe escalates a no-heading DONE read to
  // the TEAM gate. The EOF sentinel is PRESENT here so the (Tier 3) sentinel fail-safe does
  // NOT fire — this isolates the headings fail-safe, kept at Tier 2 (plan 01 Task 4).
  const GARBAGE = 'Error: ENOENT failed to read the plan file; this diagnostic was returned instead of the plan body.'
  const teamGate = () => ({
    clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex',
    verificationSameFamily: true, verificationDegraded: false, findings: [],
  })
  const rules = [
    { match: (l) => l === 'plan-read', reply: { status: 'DONE', text: `${GARBAGE}\n===IAGO_PLAN_EOF===` } },
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
  // plan 03 Task 1 — the honesty signal must also reach the DURABLE summary artifact (the
  // .md + the pipeline-runs.ndjson line), not just the live return object that dies with the
  // session. The team gate returned both flags true, so summaryPrompt's honesty NOTE/WARNING
  // and the exact NDJSON literals must appear in the summary agent's prompt.
  const summaryCall = h.calls.find((c) => c.label === 'summary')
  assert.ok(summaryCall, 'summary stage ran')
  assert.ok(summaryCall.prompt.includes('same-family'), 'summary carries the vSameFamily honesty NOTE')
  assert.ok(summaryCall.prompt.includes('WARNING'), 'summary carries the vDegraded honesty WARNING')
  assert.ok(summaryCall.prompt.includes('"vSameFamily":true'), 'NDJSON line carries vSameFamily:true')
  assert.ok(summaryCall.prompt.includes('"vDegraded":true'), 'NDJSON line carries vDegraded:true')
})

await test('FAIL SAFE (plan 01 Task 4): a sentinel-LESS read escalates to Tier 3 (maxFixRounds=3), deeper than the Tier-2 headings fail-safe', async () => {
  // #89 re-gate Important: an LLM transcribes the plan; a TRUNCATED transcription that still
  // contains ≥1 task heading classifies on incomplete text and can drop a LATE Tier-3 risk
  // keyword (silent under-tier). PLANREAD_PROMPT appends ===IAGO_PLAN_EOF=== after the cat; a
  // transcription that lost the tail lost the sentinel. Plan 01 Task 4 raised this fail-safe
  // from Tier 2 to Tier 3 (security gate, maxFixRounds=3) — the truncation may have hidden a
  // security surface. Proof it is Tier 3 (not 2): the team gate blocks on calls 1-3 and is
  // clean on call 4; only maxFixRounds=3 reaches that clean 4th call (a Tier-2 run, cap 2,
  // would throw after the 2nd round still blocking).
  const teamGate = (n) =>
    n <= 3
      ? { clean: false, blocking: 1, gateStatus: 'COMPLETE', verdict: 'FAIL', codexSource: 'codex', verificationSameFamily: true, verificationDegraded: false, findings: [{ severity: 'Critical', summary: 'a late keyword may have been truncated', by: 'opus' }] }
      : { clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex', verificationSameFamily: true, verificationDegraded: false, findings: [] }
  const rules = [
    // headings present, NO sentinel — the truncation signature
    { match: (l) => l === 'plan-read', reply: { status: 'DONE', text: TIER1_PLAN } },
    ...stageRules(TIER1_PLAN).filter((r) => !r.match('plan-read')),
  ]
  const h = makeHarness(rules, teamGate)
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)
  assert.strictEqual(h.workflowCalls[0].wargs.mode, 'team', 'sentinel-less read routed to mode=team')
  assert.ok(!h.calls.some((c) => /^review:/.test(c.label) || /^codex:/.test(c.label)), 'no inline 2-leg for the fail-safe plan')
  assert.strictEqual(out.fixRounds, 3, 'sentinel-less read got Tier 3 maxFixRounds=3 (only Tier 3 reaches the clean 4th gate call)')
  assert.strictEqual(out.reviewVerdict, 'PASS')
})

await test('plan 01 Task 4: headings-missing WITH sentinel stays Tier 2 (maxFixRounds=2, NOT upgraded to Tier 3)', async () => {
  // The headings-missing fail-safe is intentionally KEPT at Tier 2 (not upgraded to Tier 3):
  // a fully-read (sentinel present) plan with no task headings is garbage, but giving every
  // garbage read maxFixRounds=3 over-reviews. Proof it is Tier 2 (not 3): the gate blocks on
  // EVERY call, so a maxFixRounds=2 (Tier 2) run throws after the 2nd round; a Tier-3 run
  // (cap 3) would run a 3rd round. The sentinel is PRESENT so the Tier-3 sentinel fail-safe
  // does NOT fire — this isolates the headings fail-safe.
  const GARBAGE = 'Error: ENOENT failed to read the plan file; this diagnostic was returned instead of the plan body.'
  const teamGate = () => ({
    clean: false, blocking: 1, gateStatus: 'COMPLETE', verdict: 'FAIL', codexSource: 'codex',
    verificationSameFamily: true, verificationDegraded: false, findings: [{ severity: 'Critical', summary: 'still blocking', by: 'opus' }],
  })
  const rules = [
    { match: (l) => l === 'plan-read', reply: { status: 'DONE', text: `${GARBAGE}\n===IAGO_PLAN_EOF===` } },
    ...stageRules(TIER1_PLAN).filter((r) => !r.match('plan-read')),
  ]
  const h = makeHarness(rules, teamGate)
  const wf = buildWorkflow()
  await assert.rejects(
    () => wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow),
    /persist after 2 fix rounds/i,
    'headings-missing read is Tier 2 (maxFixRounds=2) — throws after 2 rounds, not 3',
  )
})

// ── tier_override ORCHESTRATION-level parsing (re-gate Critical + Importants) ──
// The classifyTier unit tests exercise the function-body clamp; these drive the WORKFLOW so
// the frontmatter regex itself is under test (the buggy single-digit / whole-text version).
const OVERRIDE_AUTH_PLAN = (n) => `---
phase: x
tier_override: ${n}
---
# Plan
### Task T01
Add an auth check.`

await test('re-gate Critical: a multi-digit tier_override (10) in frontmatter is REJECTED — keyword Tier 3 wins (team gate)', async () => {
  // /^tier_override:[ \t]*(\d+)[ \t]*$/ captures the FULL integer; 10 ∉ [1,3] → ignored. The
  // plan's `auth` keyword then classifies Tier 3 → team gate. The OLD single-digit regex
  // captured '1' and silently down-tiered this security plan to the shallow inline 2-leg.
  const teamGate = () => ({ clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex', verificationSameFamily: true, verificationDegraded: false, findings: [] })
  const h = makeHarness(stageRules(OVERRIDE_AUTH_PLAN(10)), teamGate)
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)
  assert.ok(h.workflowCalls.length >= 1 && h.workflowCalls[0].wargs.mode === 'team', 'override 10 rejected → keyword Tier 3 → team gate')
  assert.ok(!h.calls.some((c) => /^review:/.test(c.label) || /^codex:/.test(c.label)), 'no inline 2-leg (NOT down-tiered to Tier 1)')
  assert.strictEqual(out.reviewVerdict, 'PASS')
})

await test('valid tier_override:1 in frontmatter LOWERS an auth plan to Tier 1 (inline) on a complete read', async () => {
  // A complete read (EOF sentinel + headings present) lets a valid override correct an
  // over-tier: tier_override:1 on a plan whose `auth` keyword would be Tier 3 → Tier 1 inline.
  const h = makeHarness(
    stageRules(OVERRIDE_AUTH_PLAN(1), [
      { match: (l) => /^review:/.test(l), reply: { verdict: 'PASS', findings: [], propertiesChecked: PROPS } },
      { match: (l) => /^codex:/.test(l), reply: { source: 'codex', findings: [], evidence: CODEX_EVIDENCE } },
    ]),
    () => { throw new Error('team gate must NOT run for a valid tier_override:1 plan') },
  )
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)
  assert.strictEqual(h.workflowCalls.length, 0, 'valid override:1 → inline 2-leg, no team delegation')
  assert.ok(h.calls.some((c) => c.label === 'review:r0') && h.calls.some((c) => c.label === 'codex:r0'), 'inline 2-leg ran')
  assert.strictEqual(out.reviewVerdict, 'PASS')
})

await test('re-gate Important: tier_override:1 does NOT suppress the missing-sentinel fail-safe (truncated read → Tier 3)', async () => {
  // The override survives in the leading frontmatter even on a truncated read, but the lost tail
  // is where a late security keyword hides — so a missing EOF sentinel still escalates to Tier 3
  // REGARDLESS of the override. teamGate blocks calls 1-3, clean on 4 → only Tier 3 (cap 3)
  // reaches the clean call, proving the fail-safe fired over the override.
  const teamGate = (n) => n <= 3
    ? { clean: false, blocking: 1, gateStatus: 'COMPLETE', verdict: 'FAIL', codexSource: 'codex', verificationSameFamily: true, verificationDegraded: false, findings: [{ severity: 'Critical', summary: 'late keyword maybe lost', by: 'opus' }] }
    : { clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex', verificationSameFamily: true, verificationDegraded: false, findings: [] }
  const rules = [
    { match: (l) => l === 'plan-read', reply: { status: 'DONE', text: OVERRIDE_AUTH_PLAN(1) } }, // NO sentinel
    ...stageRules(TIER2_PLAN).filter((r) => !r.match('plan-read')),
  ]
  const h = makeHarness(rules, teamGate)
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)
  assert.ok(h.workflowCalls.length >= 1 && h.workflowCalls[0].wargs.mode === 'team', 'truncated read → team gate despite override:1')
  assert.strictEqual(out.fixRounds, 3, 'Tier 3 (maxFixRounds=3) — the sentinel fail-safe fired over the override')
})

await test('re-gate Minor: a column-0 tier_override:1 in PROSE (no frontmatter fence) is NOT honored', async () => {
  // The override is parsed ONLY from the leading `---...---` frontmatter, so a `tier_override:`
  // line in the plan BODY (e.g. a plan documenting this very feature) cannot self-downgrade.
  // planD has no fence → override ignored → the `auth` keyword classifies Tier 3 → team gate.
  // The OLD whole-text /im regex matched any column-0 line and would have down-tiered to Tier 1.
  const planD = `# Plan
### Task T01
Add an auth check.
tier_override: 1`
  const teamGate = () => ({ clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex', verificationSameFamily: true, verificationDegraded: false, findings: [] })
  const h = makeHarness(stageRules(planD), teamGate)
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)
  assert.ok(h.workflowCalls.length >= 1 && h.workflowCalls[0].wargs.mode === 'team', 'prose tier_override ignored → keyword Tier 3 → team gate')
  assert.ok(!h.calls.some((c) => /^review:/.test(c.label) || /^codex:/.test(c.label)), 'no inline 2-leg (NOT down-tiered by a prose line)')
})

await test('re-gate Important: skeptic-filtered findings ACCUMULATE across fix rounds (cumulative audit trail)', async () => {
  // allFiltered must carry EVERY round's skeptic-dropped findings, not just the last round's.
  // Round 0 drops F0 (and blocks on a Critical → fix round); round 1 (re-review) drops F1 and is
  // clean. out.filtered must contain BOTH. RED if allFiltered.push(...) is reverted to a
  // per-round `filtered = ...` reassignment (only F1 would survive).
  const F0 = { severity: 'Critical', summary: 'round-0 dropped blocker', by: 'codex' }
  const F1 = { severity: 'Critical', summary: 'round-1 dropped blocker', by: 'codex' }
  const teamGate = (n) =>
    n === 1
      ? { clean: false, blocking: 1, gateStatus: 'COMPLETE', verdict: 'FAIL', codexSource: 'codex', verificationSameFamily: true, verificationDegraded: false, findings: [{ severity: 'Critical', summary: 'real blocker', by: 'opus' }], filtered: [F0] }
      : { clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex', verificationSameFamily: true, verificationDegraded: false, findings: [], filtered: [F1] }
  const h = makeHarness(stageRules(TIER2_PLAN), teamGate)
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)
  assert.strictEqual(out.fixRounds, 1, 'one fix round ran (round-0 blocker)')
  assert.deepStrictEqual(out.filtered, [F0, F1], 'filtered accumulates BOTH rounds (cumulative, not last-only)')
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
          ? // Proof of work is required on EVERY return, not only an empty-findings one (round-2
            // fix), so even a leg that reports a Critical must enumerate what it verified.
            { verdict: 'FAIL', findings: [{ severity: 'Critical', file: 'amplify/data/resource.ts', summary: 'plan task T01 (schema migration) has no corresponding change in the diff', failureScenario: FS }], propertiesChecked: PROPS }
          : { verdict: 'PASS', findings: [], propertiesChecked: PROPS }
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
  // plan 03 Task 3 — the compliance prompt carries an explicit read-only guard, positioned
  // AFTER the step directives (not merely inherited from PREAMBLE — a weaker signal).
  const complianceCall = h.calls.find((c) => c.label === 'plan-compliance:r0')
  assert.ok(complianceCall, 'compliance leg dispatched')
  assert.ok(/READ-ONLY: do NOT edit/i.test(complianceCall.prompt), 'planCompliancePrompt contains the read-only guard')
  assert.ok(
    complianceCall.prompt.indexOf('READ-ONLY: do NOT edit') > complianceCall.prompt.lastIndexOf('For EACH task'),
    'read-only guard is positioned after the compliance step directives',
  )
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

await test('plan 03 Task 4: a compliance leg that DIRTIES the tree (HEAD unchanged) FAILS CLOSED', async () => {
  // The stress-flagged case the HEAD-only check misses: a compliance agent that EDITS a file
  // but does NOT commit leaves HEAD unchanged and porcelain non-empty. The guard snapshots
  // porcelain (not just HEAD) and must fail closed. RED with a HEAD-only guard (porcelain
  // ignored) — this is the most common "edited but forgot to commit" side effect.
  const teamGate = () => ({
    clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex',
    verificationSameFamily: true, verificationDegraded: false, findings: [],
  })
  const rules = [
    { match: (l) => l === 'compliance-pre-snap', reply: { status: 'DONE', head: 'abc123', porcelain: '' } },
    { match: (l) => l === 'compliance-post-snap', reply: { status: 'DONE', head: 'abc123', porcelain: ' M .claude/workflows/execute-pipeline.js' } },
    ...stageRules(TIER2_PLAN).filter((r) => !r.match('compliance-pre-snap') && !r.match('compliance-post-snap')),
  ]
  const h = makeHarness(rules, teamGate)
  await assert.rejects(
    () => buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow),
    /advanced HEAD or dirtied the tree/i,
    'a dirty tree (HEAD unchanged) after the compliance leg fails closed',
  )
})

await test('plan 03 Task 4: a compliance leg that ADVANCES HEAD (commits) FAILS CLOSED', async () => {
  // The other side-effect mode: a compliance agent that COMMITS advances HEAD. The guard
  // compares the pre/post sha and must fail closed.
  const teamGate = () => ({
    clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex',
    verificationSameFamily: true, verificationDegraded: false, findings: [],
  })
  const rules = [
    { match: (l) => l === 'compliance-pre-snap', reply: { status: 'DONE', head: 'abc123', porcelain: '' } },
    { match: (l) => l === 'compliance-post-snap', reply: { status: 'DONE', head: 'def456', porcelain: '' } },
    ...stageRules(TIER2_PLAN).filter((r) => !r.match('compliance-pre-snap') && !r.match('compliance-post-snap')),
  ]
  const h = makeHarness(rules, teamGate)
  await assert.rejects(
    () => buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow),
    /advanced HEAD or dirtied the tree/i,
    'a committed change (HEAD advance) after the compliance leg fails closed',
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

// ── Behavior: inline 2-leg crossModelDegraded true-branch (plan 03 Task 2) ─
await test('plan 03 Task 2: Tier-1 inline 2-leg sets crossModelDegraded when codex falls back to claude-fallback', async () => {
  // The inline 2-leg sets crossModelDegraded = codex.source !== 'codex'; the TRUE branch
  // (a claude-fallback codex source = the GPT-5.5 cross-model guarantee degraded to
  // same-family) had no coverage. The flag must reach the pipeline return so the merge
  // decision sees the degradation. Tier-1 (null workflow binding) takes the inline path,
  // never the team gate. RED if crossModelDegraded stayed false on a claude-fallback source.
  const rules = flowRules({ prUrl: 'https://github.com/o/r/pull/99', prNumber: '99', branch: 'feat/x', tagStatus: 'TAGGED' }).map((r) =>
    r.match('codex:r0')
      ? { match: (l) => /^codex:/.test(l), reply: { source: 'claude-fallback', findings: [], evidence: 'fallback: read all changed files in full', propertiesChecked: PROPS } }
      : r,
  )
  const h = makeHarness(rules)
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null)
  assert.strictEqual(out.crossModelDegraded, true, 'claude-fallback codex source → crossModelDegraded true in the inline 2-leg')
  assert.strictEqual(out.reviewVerdict, 'PASS', 'a clean review still PASSes')
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
      reply: { verdict: 'FAIL', findings: [{ severity: 'Critical', summary: 'c0', failureScenario: FS }], propertiesChecked: PROPS, domainsSelected: ['auth', 'api'] },
    },
    // round 1 re-review: still blocking, returns NO domainsSelected → triggers fix round 2
    { match: (l) => l === 'review:r1', reply: { verdict: 'FAIL', findings: [{ severity: 'Critical', summary: 'c1', failureScenario: FS }], propertiesChecked: PROPS } },
    // round 2 re-review: clean → loop ends
    { match: (l) => l === 'review:r2', reply: { verdict: 'PASS', findings: [], propertiesChecked: PROPS } },
    { match: (l) => /^codex:/.test(l), reply: { source: 'codex', findings: [], evidence: CODEX_EVIDENCE } },
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

// ════ Suite C — a failed implement attempt is PRESERVED, not wiped ══════════════════
// The implement stage retries once, and before the retry it resets the worktree to the
// checkpoint. Until 2026-08-12 that reset was a bare `git checkout <sha> -- .` + untracked
// sweep, so a transient API error mid-implementation destroyed everything the attempt had
// written (a sentria run lost 60 minutes of it overnight). The rollback must now run
// scripts/pipeline-wip-restore.sh, which snapshots the partial work to a `wip/<plan>` ref
// FIRST and only then restores.

// Rules where the implement agent dies on its first call (transient server_error) and
// succeeds on the retry. Listed BEFORE flowRules so they win the first-match lookup.
function retryImplRules(rollbackReply) {
  let implCalls = 0
  return [
    {
      match: (l) => l === 'implement',
      reply: () => {
        implCalls++
        if (implCalls === 1) throw new Error('API Error: Unable to connect to API (ENOTFOUND)')
        return { status: 'DONE' }
      },
    },
    { match: (l) => l === 'implement-rollback', reply: rollbackReply },
    ...flowRules({ prUrl: 'http://pr/1', prNumber: '1', tagStatus: 'TAGGED' }),
  ]
}

await test('a failed implement attempt is snapshotted to a wip ref BEFORE the worktree is reset', async () => {
  const rules = retryImplRules({ status: 'DONE', notes: 'snapshot=wip/p (abc0000)' })
  const h = makeHarness(rules)
  const logs = []
  const wf = buildWorkflow()
  await wf(h.agent, h.parallel, null, (m) => logs.push(m), h.phase, { ...baseArgs, skipStress: true }, null, null)

  const rb = h.calls.find((c) => c.label === 'implement-rollback')
  assert.ok(rb, 'the failed attempt triggered a rollback stage')
  assert.ok(
    /pipeline-wip-restore\.sh" "abc123" "p"/.test(rb.prompt),
    'the rollback runs pipeline-wip-restore.sh with the checkpoint sha and the plan name',
  )
  // Drift guard: the old restore-only command must never come back.
  assert.ok(
    !/git checkout "abc123" -- \./.test(rb.prompt),
    'the rollback does NOT run a bare restore that would destroy the partial work',
  )
  assert.ok(/status=DONE only if/.test(rb.prompt), 'the rollback is still verified before any retry')
  assert.strictEqual(h.calls.filter((c) => c.label === 'implement').length, 2, 'implement retried after the rollback')
  // The recovery ref is the only pointer back to the discarded work — it has to reach the log.
  assert.ok(
    logs.some((l) => /snapshot=wip\/p/.test(l)),
    'the run log names the recovery ref',
  )
})

await test('a rollback that cannot reach a clean tree aborts instead of retrying', async () => {
  const rules = retryImplRules({ status: 'BLOCKED', notes: 'wip ref could not be written' })
  const h = makeHarness(rules)
  const wf = buildWorkflow()
  await assert.rejects(
    () => wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null),
    /refusing to retry on dirty state/,
    'the workflow fails closed when the preserve-then-restore step does not finish',
  )
  assert.strictEqual(
    h.calls.filter((c) => c.label === 'implement').length,
    1,
    'implement is NOT retried on a worktree that still holds the failed attempt',
  )
})

await test('the impl stage wires the preserve-then-restore script, not a destructive reset', () => {
  // Source-level drift guard: the behavioral tests above assert on the rollback PROMPT,
  // which only proves the command that was passed in. This pins the command itself.
  assert.ok(
    /pipeline-wip-restore\.sh/.test(SRC),
    'execute-pipeline.js calls scripts/pipeline-wip-restore.sh',
  )
  assert.ok(
    !/git checkout "\$\{preImplSha\}" -- \./.test(SRC),
    'execute-pipeline.js no longer restores the impl checkpoint without snapshotting first',
  )
})

// ════ Suite D — verification contract on the INLINE Tier-0/1 path (round-1 fix) ══════
// The proof-of-work rule landed in dual-adversarial.js only; the inline 2-leg (the path most
// plans run) accepted a leg that returned nothing and proved nothing as CLEAN — the PR #78
// silent no-op, live. The schemas cannot catch it: JSON-Schema `required` enforces key PRESENCE,
// so {verdict:'PASS', findings:[], propertiesChecked:[]} and {source:'codex', findings:[],
// evidence:''} are both valid. These tests pin the runtime guard.

function inlineRules(overrides = []) {
  return [
    ...overrides,
    ...flowRules({ prUrl: 'https://github.com/o/r/pull/5', prNumber: '5', branch: 'feat/x', tagStatus: 'TAGGED' }),
  ]
}

await test('INLINE proof-of-work: an Opus leg with empty findings AND empty propertiesChecked → pipeline THROWS (never ships)', async () => {
  // RED before the fix: the leg is schema-valid, runDualAdversarial checks only `!review`, so
  // findings=[] → no fix round → PR created + @claude tagged over a review that read no code.
  const h = makeHarness(
    inlineRules([{ match: (l) => /^review:/.test(l), reply: { verdict: 'PASS', findings: [], propertiesChecked: [] } }]),
  )
  await assert.rejects(
    () => buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null),
    /opus-review:no-proof/,
    'an unproven Opus leg fails closed on the inline path, exactly as it does in the team gate',
  )
  assert.ok(!h.calls.some((c) => c.label === 'create-pr-tag'), 'no PR is opened over an unreviewed leg')
  assert.ok(!h.calls.some((c) => c.label === 'summary'), 'no summary claims a completed review')
  // The abort happens AFTER the commit stage, so the per-project lock must not be parked for the
  // full 3h stale window on what is a re-run condition.
  assert.ok(h.calls.some((c) => c.label === 'lock-release-on-abort'), 'the fail-closed abort releases the lock best-effort')
})

await test('INLINE proof-of-work: a source=codex leg with empty findings AND an empty evidence string → pipeline THROWS', async () => {
  const h = makeHarness(
    inlineRules([{ match: (l) => /^codex:/.test(l), reply: { source: 'codex', findings: [], evidence: '   ' } }]),
  )
  await assert.rejects(
    () => buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null),
    /codex:no-proof/,
    'a whitespace-only evidence string is no proof of work',
  )
})

await test('INLINE proof-of-work: a claude-fallback codex leg must enumerate propertiesChecked (evidence alone is the codex-only carve-out)', async () => {
  const h = makeHarness(
    inlineRules([
      {
        match: (l) => /^codex:/.test(l),
        reply: { source: 'claude-fallback', findings: [], evidence: 'read every changed file', propertiesChecked: [] },
      },
    ]),
  )
  await assert.rejects(
    () => buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null),
    /codex:no-proof/,
    'a CLAUDE-authored fallback review is held to propertiesChecked, like any Claude leg',
  )
})

await test('INLINE proof-of-work CONTROL: proven legs (properties / codex evidence) complete normally', async () => {
  // The guard must not fire on the legitimate clean shapes — a codex leg proves with `evidence`
  // only (no propertiesChecked), the Opus leg proves with propertiesChecked.
  const h = makeHarness(inlineRules())
  const out = await buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null)
  assert.strictEqual(out.reviewVerdict, 'PASS', 'a genuinely clean, proven review still PASSes')
  assert.ok(!h.calls.some((c) => c.label === 'lock-release-on-abort'), 'no abort path on a healthy run')
})

await test('TEAM proof-of-work: a plan-compliance leg with no findings AND no propertiesChecked FAILS CLOSED', async () => {
  // "every plan task is implemented" must be PROVEN (one property per task), not asserted — the
  // compliance leg's own prompt demands exactly that.
  const teamGate = () => ({
    clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex',
    verificationSameFamily: true, verificationDegraded: false, findings: [],
  })
  const rules = [
    { match: (l) => /^plan-compliance:/.test(l), reply: { verdict: 'PASS', findings: [], propertiesChecked: [] } },
    ...stageRules(TIER2_PLAN).filter((r) => !r.match('plan-compliance:r0')),
  ]
  const h = makeHarness(rules, teamGate)
  await assert.rejects(
    () => buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow),
    /plan-compliance leg is INCOMPLETE \[plan-compliance:no-proof\]/,
    'an unproven compliance leg is INCOMPLETE, not a compliant plan',
  )
  // The abort lands AFTER the commit stage, so the error must name the real recoveries — a bare
  // "re-run the pipeline" dead-ends at the Commit stage on an empty diff.
  const err = await buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow).catch((e) => e)
  assert.ok(/git reset --hard base123/.test(err.message), 'the abort names the pre-impl sha to reset to')
  assert.ok(/\/iago-prfix/.test(err.message), 'and the keep-the-commit recovery')
})

await test('an INCOMPLETE team gate releases the pipeline lock before throwing', async () => {
  // The proof-of-work rule makes INCOMPLETE reachable from a leg FORMATTING slip, not just an
  // infra crash, and this abort lands after the commit stage — parking the lock for 3h on every
  // such run would block the very re-run the error asks for.
  const teamGate = () => ({
    clean: false, blocking: 0, gateStatus: 'INCOMPLETE', incompleteLegs: ['codex:no-proof'],
    verdict: 'PASS', codexSource: 'codex', findings: [],
  })
  const h = makeHarness(stageRules(TIER2_PLAN), teamGate)
  await assert.rejects(
    () => buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow),
    /gateStatus=INCOMPLETE/,
    'an INCOMPLETE gate still fails closed',
  )
  assert.ok(h.calls.some((c) => c.label === 'lock-release-on-abort'), 'the lock is released best-effort before the throw')
})

// ── Minor routing: verdict, dedupe, and the durable artifacts ────────────────────────
const MINOR_A = { severity: 'Minor', summary: 'MINOR-A stale comment', file: 'a.ts', failureScenario: FS, by: 'opus' }
const MINOR_B = { severity: 'Minor', summary: 'MINOR-B unused import', file: 'b.ts', failureScenario: FS, by: 'team:data' }

await test('team gate with ONLY Minor findings records PASS_WITH_CONCERNS, not a clean PASS', async () => {
  // `merged` no longer carries Minors (the gate partitions its own), so reading it alone
  // upgraded a Minor-only run to PASS — written verbatim into .iago/summaries/{plan}.md and the
  // pipeline-runs.ndjson ledger, while the inline path still said PASS_WITH_CONCERNS on the same
  // evidence. RED before the fix: reviewVerdict === 'PASS'.
  const teamGate = () => ({
    clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex',
    verificationSameFamily: false, verificationDegraded: false, findings: [], backlog: [MINOR_A, MINOR_B],
  })
  const h = makeHarness(stageRules(TIER2_PLAN), teamGate)
  const out = await buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)
  assert.strictEqual(out.reviewVerdict, 'PASS_WITH_CONCERNS', 'a run with 2 open Minors is not a clean PASS')
  assert.strictEqual(out.minorRemaining, 2, 'both Minors counted in the backlog')
  const summaryCall = h.calls.find((c) => c.label === 'summary')
  assert.ok(/"verdict":"PASS_WITH_CONCERNS"/.test(summaryCall.prompt), 'the NDJSON ledger line records PASS_WITH_CONCERNS')
})

await test('the Minor backlog is DEDUPED across fix rounds (a never-fixed Minor is re-reported every round)', async () => {
  // Minors are never handed to the fix agent, so the code they flag is unchanged and every
  // re-review re-reports them. RED before the fix: minorRemaining 4 for 2 distinct defects, and
  // `backlog` handed to the orchestrator (and to Santiago at the merge decision) held duplicates.
  const teamGate = (n) =>
    n === 1
      ? { clean: false, blocking: 1, gateStatus: 'COMPLETE', verdict: 'FAIL', codexSource: 'codex', verificationSameFamily: false, verificationDegraded: false, findings: [{ severity: 'Critical', summary: 'real blocker', failureScenario: FS, by: 'opus' }], backlog: [MINOR_A, MINOR_B] }
      : { clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex', verificationSameFamily: false, verificationDegraded: false, findings: [], backlog: [{ ...MINOR_A }, { ...MINOR_B }] }
  const h = makeHarness(stageRules(TIER2_PLAN), teamGate)
  const out = await buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)
  assert.strictEqual(out.fixRounds, 1, 'one fix round ran (the Critical)')
  assert.strictEqual(out.minorRemaining, 2, 'minorRemaining counts DISTINCT Minors, not findings × rounds')
  assert.deepStrictEqual(
    out.backlog.map((f) => f.summary),
    ['MINOR-A stale comment', 'MINOR-B unused import'],
    'the returned backlog holds each Minor exactly once',
  )
})

await test('the Minor backlog reaches DURABLE artifacts: the @claude tag comment and the summary + NDJSON', async () => {
  // Before this fix a Minor was fixed by nobody, named in no PR comment, absent from the async
  // reviewer's context and from every persisted artifact — while the standing rule said it was
  // "forwarded to the async loop". The only carrier was the in-memory return.
  const h = makeHarness(
    inlineRules([
      {
        match: (l) => /^review:/.test(l),
        reply: { verdict: 'PASS_WITH_CONCERNS', findings: [MINOR_A], propertiesChecked: PROPS },
      },
    ]),
  )
  const out = await buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null)
  assert.strictEqual(out.fixRounds, 0, 'a Minor never spends a fix round')
  assert.strictEqual(out.minorRemaining, 1)
  const tagCall = h.calls.find((c) => c.label === 'create-pr-tag')
  assert.ok(/MINOR-A stale comment/.test(tagCall.prompt), 'the @claude tag comment carries the open Minor')
  assert.ok(/Minor backlog/i.test(tagCall.prompt), 'and labels it as the backlog routed out of the fix loop')
  const summaryCall = h.calls.find((c) => c.label === 'summary')
  assert.ok(/MINOR-A stale comment/.test(summaryCall.prompt), '.iago/summaries/{plan}.md records the Minor verbatim')
  assert.ok(/"minorRemaining":1/.test(summaryCall.prompt), 'the NDJSON telemetry line records minorRemaining')
})

await test('the re-review no longer demands deferred Minors be resolved, and the fix agent never receives them', async () => {
  // The fix stage and the re-review stage must agree: Minors are deliberately deferred, so a
  // re-reviewer told to "verify ALL previous findings (Critical, Important, Minor) are resolved"
  // would find them unresolved and (per the repo's escalate-unaddressed convention) re-emit them
  // as Important — throwing the run on a plan whose only residue is a Minor by design.
  const h = makeHarness(
    inlineRules([
      {
        match: (l) => l === 'review:r0',
        reply: {
          verdict: 'FAIL',
          findings: [{ severity: 'Critical', summary: 'CRIT-1 boom', failureScenario: FS }, MINOR_A],
          propertiesChecked: PROPS,
        },
      },
      { match: (l) => l === 'review:r1', reply: { verdict: 'PASS', findings: [], propertiesChecked: PROPS } },
      { match: (l) => /^fix:/.test(l), reply: { status: 'DONE' } },
      { match: (l) => /^rebuild:/.test(l), reply: { passed: true, ran: ['tsc'], summary: 'ok' } },
    ]),
  )
  const out = await buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null)
  assert.strictEqual(out.fixRounds, 1, 'the Critical drove exactly one fix round')
  const fixCall = h.calls.find((c) => c.label === 'fix:1')
  assert.ok(/CRIT-1 boom/.test(fixCall.prompt), 'the fix agent receives the Critical')
  assert.ok(!/MINOR-A stale comment/.test(fixCall.prompt), 'the fix agent is NOT handed the deferred Minor')
  const reReview = h.calls.find((c) => c.label === 'review:r1')
  assert.ok(
    !/Verify ALL previous findings \(Critical, Important, Minor\) are resolved/.test(reReview.prompt),
    're-review no longer orders Minors to be verified resolved',
  )
  assert.ok(/MINOR FINDINGS ARE OUT OF THE FIX LOOP BY DESIGN/.test(reReview.prompt), 're-review states the Minor deferral explicitly')
})

await test('twin sync: the proof-of-work RUNTIME guard exists in execute-pipeline.js, not just its schemas', async () => {
  // The schema twin-sync test in dual-adversarial.test.mjs only greps the schema SOURCE TEXT, so
  // it stayed green while the runtime rule lived in one file only — the PR #96 twin-drift shape.
  assert.ok(/function hasProperties\(/.test(SRC), 'twin declares hasProperties')
  assert.ok(/function foundNothing\(/.test(SRC), 'twin declares foundNothing')
  assert.ok(/function provenProperties\(/.test(SRC), 'twin only counts EVIDENCED properties as proof')
  assert.ok(/function violatedProperties\(/.test(SRC), 'twin tracks VIOLATED properties')
  assert.ok(/legNoProofKey\('opus-review'/.test(SRC) && /legNoProofKey\('codex'/.test(SRC), 'twin emits the same no-proof leg keys')
  assert.ok(/:violated-unreported/.test(SRC), 'twin carries the violated-but-unreported breach key')
  assert.ok(/legDefect\(codex, 'codex'\)/.test(SRC), 'twin applies the guard to the inline codex leg')
  assert.ok(/legDefect\(review, 'review'\)/.test(SRC), 'twin applies the guard to the inline Opus leg')
  assert.ok(/required: \['property', 'verdict', 'evidence'\]/.test(SRC), 'twin PROPERTY requires evidence')
})

// ════ Suite E — verification contract, round-2 hardening ═════════════════════════════
// Round 1 landed the proof-of-work rule with three holes the dual-adversarial pass found:
// an UNEVIDENCED property counted as proof, ONE throwaway finding bought a leg out of the
// rule entirely, and a VIOLATED property alongside an empty findings array read as clean.
// Plus: the inline verdict was read off the Opus leg alone, the lock release was
// unconditional + unverified, and a no-proof abort dead-ended the operator.

await test('an UNEVIDENCED property is not proof of work — a leg that "reviewed the diff" with no file:line fails closed', async () => {
  // RED before the fix: hasProperties() only tested Array.isArray && length>0, so one
  // fabricated line ({property:'reviewed the diff', verdict:'HOLDS'}) cleared the guard and the
  // pipeline opened the PR + tagged @claude over a leg that read nothing.
  const h = makeHarness(
    inlineRules([
      {
        match: (l) => /^review:/.test(l),
        reply: { verdict: 'PASS', findings: [], propertiesChecked: [{ property: 'reviewed the diff', verdict: 'HOLDS' }] },
      },
    ]),
  )
  await assert.rejects(
    () => buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null),
    /opus-review:no-proof/,
    'an unevidenced property is an assertion, not proof',
  )
  assert.ok(!h.calls.some((c) => c.label === 'create-pr-tag'), 'no PR over an unevidenced leg')
})

await test('a VIOLATED property with an EMPTY findings array fails closed (violated-unreported), never a clean PASS', async () => {
  // RED before the fix: foundNothing(review)=true but hasProperties(review)=true → legProved
  // returned true, gateFindings was empty, zero fix rounds, PR opened, and the summary + NDJSON
  // recorded "verdict PASS" while the leg's own VIOLATED verdict was discarded with the session.
  const h = makeHarness(
    inlineRules([
      {
        match: (l) => /^review:/.test(l),
        reply: {
          verdict: 'PASS',
          findings: [],
          propertiesChecked: [{ property: 'tenant filter applied to the aggregate query', verdict: 'VIOLATED', evidence: 'src/api/report.ts:88' }],
        },
      },
    ]),
  )
  await assert.rejects(
    () => buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null),
    /opus-review:violated-unreported/,
    'a recorded violation with nothing reported is a contract breach, not a clean leg',
  )
  assert.ok(!h.calls.some((c) => c.label === 'create-pr-tag'), 'no PR is opened over an unreported violation')
})

await test('VIOLATED properties reach the RETURN and the durable summary instead of dying with the session', async () => {
  const VIOLATION = { property: 'aggregate query is tenant-scoped', verdict: 'VIOLATED', evidence: 'src/api/report.ts:88' }
  const h = makeHarness(
    inlineRules([
      {
        match: (l) => l === 'review:r0',
        reply: {
          verdict: 'FAIL',
          findings: [{ severity: 'Critical', summary: 'cross-tenant read on the aggregate', file: 'src/api/report.ts', failureScenario: FS }],
          propertiesChecked: [VIOLATION],
        },
      },
      { match: (l) => l === 'review:r1', reply: { verdict: 'PASS', findings: [], propertiesChecked: PROPS } },
      { match: (l) => /^fix:/.test(l), reply: { status: 'DONE' } },
      { match: (l) => /^rebuild:/.test(l), reply: { passed: true } },
    ]),
  )
  const out = await buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null)
  assert.deepStrictEqual(
    out.violatedProperties.map((p) => p.property),
    ['aggregate query is tenant-scoped'],
    'the pipeline return carries what a leg DISPROVED',
  )
  const summaryCall = h.calls.find((c) => c.label === 'summary')
  assert.ok(/aggregate query is tenant-scoped/.test(summaryCall.prompt), 'the durable summary records the violated property')
  assert.ok(/"violated":1/.test(summaryCall.prompt), 'the NDJSON ledger counts it')
})

await test('one throwaway Minor does NOT buy a leg out of the proof-of-work rule', async () => {
  // RED before the fix: legProved short-circuited on `!foundNothing(r)` — a degraded leg that
  // emitted a single nit and read no source file was byte-indistinguishable from a thorough
  // clean review, and (since Minors no longer spend a fix round) the bypass was free.
  const h = makeHarness(
    inlineRules([
      {
        match: (l) => /^review:/.test(l),
        reply: {
          verdict: 'PASS_WITH_CONCERNS',
          findings: [{ severity: 'Minor', summary: 'unused var', file: 'a.ts', failureScenario: FS }],
          propertiesChecked: [],
        },
      },
    ]),
  )
  await assert.rejects(
    () => buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null),
    /opus-review:no-proof/,
    'proof of work is required on EVERY return, not only an empty-findings one',
  )
})

await test('an unproven leg gets ONE corrective re-dispatch and a conformant redo completes the run', async () => {
  // The guard fires AFTER the commit stage, where a bare throw strands a committed
  // implementation with no PR. An unproven return is usually a formatting slip, so name the
  // defect and re-dispatch once before failing closed.
  let reviewCalls = 0
  const h = makeHarness(
    inlineRules([
      {
        match: (l) => /^review:/.test(l),
        reply: () => {
          reviewCalls++
          return reviewCalls === 1
            ? { verdict: 'PASS', findings: [], propertiesChecked: [] }
            : { verdict: 'PASS', findings: [], propertiesChecked: PROPS }
        },
      },
      { match: (l) => /^review-reprove:/.test(l), reply: { verdict: 'PASS', findings: [], propertiesChecked: PROPS } },
    ]),
  )
  const out = await buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null)
  const reprove = h.calls.find((c) => c.label === 'review-reprove:r0')
  assert.ok(reprove, 'the unproven leg is re-dispatched exactly once')
  assert.ok(/CORRECTIVE RE-RUN/.test(reprove.prompt), 'the re-dispatch names the contract rejection')
  assert.ok(/no proof of work/.test(reprove.prompt), 'and the exact defect, so the retry is informed')
  assert.strictEqual(out.reviewVerdict, 'PASS', 'a conformant redo completes the run normally')
  assert.ok(h.calls.some((c) => c.label === 'create-pr-tag'), 'the PR is opened after a successful re-prove')
})

await test('a post-commit abort names the real recovery (reset sha / manual PR), not a bare "re-run"', async () => {
  // "re-run the pipeline" dead-ends: PREP passes on a clean tree, the impl agent finds the plan
  // already implemented, and the Commit stage returns BLOCKED on an empty diff.
  const h = makeHarness(
    inlineRules([{ match: (l) => /^codex:/.test(l), reply: { source: 'codex', findings: [], evidence: '   ' } }]),
  )
  const err = await buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null).catch((e) => e)
  assert.ok(/codex:no-proof/.test(err.message), 'the offending leg is named')
  assert.ok(/git reset --hard abc123/.test(err.message), 'the abort names the pre-impl sha the summary stage never recorded')
  assert.ok(/\/iago-prfix/.test(err.message), 'and the keep-the-commit recovery path')
})

await test('INLINE verdict counts BOTH legs: a Codex-only Minor records PASS_WITH_CONCERNS, never a clean PASS', async () => {
  // RED before the fix: `verdict = review.verdict` — the Opus leg alone. A Minor raised only by
  // the Codex leg left `.iago/summaries/{plan}.md` and pipeline-runs.ndjson reading "PASS" with
  // an open defect in the backlog, contradicting the rule this contract ships and diverging from
  // the team-gate branch on identical evidence.
  const h = makeHarness(
    inlineRules([
      { match: (l) => /^review:/.test(l), reply: { verdict: 'PASS', findings: [], propertiesChecked: PROPS } },
      {
        match: (l) => /^codex:/.test(l),
        reply: {
          source: 'codex',
          evidence: CODEX_EVIDENCE,
          findings: [{ severity: 'Minor', summary: 'stale comment references a removed flag', file: 'b.ts', failureScenario: FS }],
        },
      },
    ]),
  )
  const out = await buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null)
  assert.strictEqual(out.fixRounds, 0, 'a Minor still never spends a fix round')
  assert.strictEqual(out.minorRemaining, 1, 'the Codex Minor is in the backlog')
  assert.strictEqual(out.reviewVerdict, 'PASS_WITH_CONCERNS', 'the recorded verdict reflects the whole gate, not one leg')
  const summaryCall = h.calls.find((c) => c.label === 'summary')
  assert.ok(/"verdict":"PASS_WITH_CONCERNS"/.test(summaryCall.prompt), 'the NDJSON ledger stays queryable for genuinely clean runs')
})

await test('the Minor backlog dedupes an EXACT restatement across rounds (same defect, one entry)', async () => {
  // The dedupe that survives: a re-review re-reporting a never-fixed Minor with the same wording
  // must not inflate minorRemaining to findings × rounds or fill the @claude comment's 10-entry
  // cap with duplicates. Key = severity + file + NORMALISED summary, exact match on that key.
  const minor = { severity: 'Minor', summary: 'Missing null check on user.id', file: 'a.ts', failureScenario: FS }
  const teamGate = (n) =>
    n === 1
      ? {
          clean: false, blocking: 1, gateStatus: 'COMPLETE', verdict: 'FAIL', codexSource: 'codex',
          findings: [{ severity: 'Critical', summary: 'real blocker', failureScenario: FS, by: 'opus' }],
          backlog: [{ ...minor, by: 'opus' }],
        }
      : {
          clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex', findings: [],
          // Same defect, same words modulo punctuation/case, attributed to a different leg.
          backlog: [{ ...minor, summary: 'missing null check on user.id!', by: 'lens:codeQuality' }],
        }
  const h = makeHarness(stageRules(TIER2_PLAN), teamGate)
  const out = await buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)
  assert.strictEqual(out.fixRounds, 1, 'the Critical drove one fix round')
  assert.strictEqual(out.minorRemaining, 1, 'one DEFECT, not one entry per round')
})

await test('the Minor backlog NEVER collapses two DISTINCT Minors in the same file', async () => {
  // RULING 4c, 2026-08-19. Round 1 ran a Jaccard >= 0.5 word-overlap pass on top of the key, so
  // two genuinely different defects that shared a file and severity collapsed into one — the
  // second erased from backlog, minorRemaining, the @claude comment, the durable summary and the
  // NDJSON ledger, in round 0, with no fix round involved. A deduper serving a "we never lose a
  // finding" contract must not itself be able to lose a finding. The accepted cost of the exact
  // key is the opposite error (a re-worded restatement surviving as its own entry), which
  // over-counts visibly instead of deleting silently.
  const teamGate = () => ({
    clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex', findings: [],
    backlog: [
      { severity: 'Minor', summary: 'missing null guard on user id', file: 'a.ts', failureScenario: FS, by: 'opus' },
      { severity: 'Minor', summary: 'missing null guard on tenant id', file: 'a.ts', failureScenario: FS, by: 'opus' },
    ],
  })
  const h = makeHarness(stageRules(TIER2_PLAN), teamGate)
  const out = await buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, h.workflow)
  assert.strictEqual(out.minorRemaining, 2, 'two distinct Minors survive as two backlog entries')
})


// ── RULING 4a (2026-08-19): a corrective re-dispatch MERGES, it never replaces ──
await test('a corrective re-dispatch KEEPS the findings the first dispatch reported', async () => {
  // RED before the fix: `review = redo` replaced the leg wholesale. A leg that reported three
  // Criticals but omitted its proof-of-work list tripped the no-proof defect, got re-dispatched,
  // and if the redo came back conformant-but-quiet all three Criticals were DISCARDED — the
  // pipeline then recorded PASS, skipped the fix loop and opened the PR. A re-dispatch exists to
  // supply the missing PROOF, never to retract findings the first pass already earned.
  const crit = { severity: 'Critical', summary: 'silent data loss on restart', failureScenario: FS, file: 'src/a.ts', preExisting: false }
  const h = makeHarness(
    inlineRules([
      // First dispatch: real findings, but NO propertiesChecked -> no-proof defect.
      { match: (l) => l === 'review:r0', reply: { verdict: 'FAIL', findings: [crit], propertiesChecked: [] } },
      // The redo honors the contract but reports nothing.
      { match: (l) => l === 'review-reprove:r0', reply: { verdict: 'PASS', findings: [], propertiesChecked: PROPS } },
      { match: (l) => l === 'review:r1', reply: { verdict: 'PASS', findings: [], propertiesChecked: PROPS } },
      { match: (l) => l === 'lock-heartbeat', reply: { status: 'DONE', notes: 'refreshed' } },
      { match: (l) => /^fix:/.test(l), reply: { status: 'DONE' } },
      { match: (l) => /^rebuild:/.test(l), reply: { passed: true } },
    ]),
  )
  const out = await buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null)
  assert.ok(h.calls.some((c) => c.label === 'review-reprove:r0'), 'the unproven leg WAS re-dispatched')
  assert.strictEqual(out.fixRounds, 1, 'the retained Critical still drove a fix round (it was not silently dropped)')
})

await test('the retained Critical is HANDED TO THE FIX AGENT, not just kept in an array', async () => {
  // The merge is only real if the finding reaches the fix loop. (The run's final verdict is PASS
  // here and SHOULD be — the Critical was retained, fixed in round 1, and the re-review is clean;
  // asserting on the end verdict would test the fix, not the merge.)
  const crit = { severity: 'Critical', summary: 'auth bypass on the changed guard', failureScenario: FS, file: 'src/b.ts', preExisting: false }
  const h = makeHarness(
    inlineRules([
      { match: (l) => l === 'review:r0', reply: { verdict: 'FAIL', findings: [crit], propertiesChecked: [] } },
      { match: (l) => l === 'review-reprove:r0', reply: { verdict: 'PASS', findings: [], propertiesChecked: PROPS } },
      { match: (l) => l === 'review:r1', reply: { verdict: 'PASS', findings: [], propertiesChecked: PROPS } },
      { match: (l) => l === 'lock-heartbeat', reply: { status: 'DONE', notes: 'refreshed' } },
      { match: (l) => /^fix:/.test(l), reply: { status: 'DONE' } },
      { match: (l) => /^rebuild:/.test(l), reply: { passed: true } },
    ]),
  )
  await buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null)
  const fixCall = h.calls.find((c) => /^fix:/.test(c.label))
  assert.ok(fixCall, 'a fix round ran')
  assert.ok(
    fixCall.prompt.includes('auth bypass on the changed guard'),
    'the fix agent was handed the Critical the first dispatch reported',
  )
})

await test('the pipeline lock carries an ownership token and no release ever deletes another run\'s lock', async () => {
  // RED before the fix: every release was an unconditional `rm -rf ${LOCK_DIR}`. After the 3h
  // stale window handed the lock to a SECOND run, the first run's summary (or its abort path)
  // deleted that run's LIVE lock and two pipelines could commit on one worktree.
  const h = makeHarness(inlineRules())
  await buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null)
  const acquire = h.calls.find((c) => c.label === 'lock-acquire')
  const tokenMatch = acquire.prompt.match(/echo "([^"]+)" > \.iago\/state\/\.pipeline\.lock\.d\/token/)
  assert.ok(tokenMatch, 'acquire writes an ownership token into the lock dir')
  const summaryCall = h.calls.find((c) => c.label === 'summary')
  assert.ok(
    summaryCall.prompt.includes(`cat .iago/state/.pipeline.lock.d/token 2>/dev/null)" = "${tokenMatch[1]}"`),
    'the summary release is conditional on THIS run still owning the lock',
  )
  assert.ok(/not-ours/.test(summaryCall.prompt), 'and leaves a lock it does not own intact')
})

await test('a FAILED lock release after an abort is reported as a failure, never logged as "released"', async () => {
  // RED before the fix: releaseLockBestEffort logged "released pipeline lock after abort" without
  // inspecting the agent's result, so a real failure (a Windows handle open on the lock dir) read
  // as success and the operator's prescribed re-run then died on "another pipeline is running" —
  // a second, contradictory diagnosis.
  const logs = []
  const h = makeHarness(
    inlineRules([
      { match: (l) => /^review:/.test(l), reply: { verdict: 'PASS', findings: [], propertiesChecked: [] } },
      { match: (l) => l === 'lock-release-on-abort', reply: { status: 'BLOCKED', notes: 'rm -rf: permission denied' } },
    ]),
  )
  await assert.rejects(
    () => buildWorkflow()(h.agent, h.parallel, null, (m) => logs.push(m), h.phase, { ...baseArgs, skipStress: true }, null, null),
    /opus-review:no-proof/,
  )
  assert.ok(
    logs.some((l) => /pipeline lock NOT released/.test(l) && /rmdir/.test(l)),
    'a BLOCKED release is surfaced with the manual-clear instruction',
  )
  assert.ok(!logs.some((l) => /^released pipeline lock/.test(l)), 'and is never reported as a successful release')
})

await test('a lock the run no longer owns is left INTACT on abort (token mismatch is a correct outcome)', async () => {
  const logs = []
  const h = makeHarness(
    inlineRules([
      { match: (l) => /^review:/.test(l), reply: { verdict: 'PASS', findings: [], propertiesChecked: [] } },
      { match: (l) => l === 'lock-release-on-abort', reply: { status: 'DONE', notes: 'not-ours' } },
    ]),
  )
  await assert.rejects(
    () => buildWorkflow()(h.agent, h.parallel, null, (m) => logs.push(m), h.phase, { ...baseArgs, skipStress: true }, null, null),
    /opus-review:no-proof/,
  )
  assert.ok(
    logs.some((l) => /left intact after abort/.test(l)),
    'the run reports that another holder owns the lock instead of claiming a release',
  )
})

await test('the FIX ROUND emits a token-guarded lock heartbeat (narrow: fix rounds only, see the gap below)', async () => {
  // RENAMED + NARROWED, ruling 6 (2026-08-19). This test was called "a long run refreshes the
  // lock heartbeat" and passed — while the heartbeat only ever fires at fix-round boundaries. It
  // asserted the mechanism it exercised and then claimed the property it did NOT verify, which is
  // the `mutation-verify every regression test` failure in .iago/learnings/patterns.md, on the
  // commit that documents it. It now claims only what it checks: a fix round emits a
  // token-guarded heartbeat that touches `acquired`.
  //
  // KNOWN GAP (backlogged, deliberately NOT fixed here): the longest un-heartbeated stretch of a
  // run — plan read -> impl -> build -> commit -> the round-0 gate — is exactly the window the
  // heartbeat was added to protect, and a run with ZERO fix rounds never heartbeats at all. So a
  // healthy long run is still reclaimable as stale. That defect pre-dates this diff (the
  // heartbeat and the stale window both do), so under the scope ruling it routes to the backlog
  // as a pre-existing Important rather than blocking this branch. Fixing it means heartbeating on
  // a timer or at every stage boundary, which is its own change with its own test.
  const h = makeHarness(
    inlineRules([
      {
        match: (l) => l === 'review:r0',
        reply: { verdict: 'FAIL', findings: [{ severity: 'Critical', summary: 'boom', failureScenario: FS }], propertiesChecked: PROPS },
      },
      { match: (l) => l === 'review:r1', reply: { verdict: 'PASS', findings: [], propertiesChecked: PROPS } },
      { match: (l) => l === 'lock-heartbeat', reply: { status: 'DONE', notes: 'refreshed' } },
      { match: (l) => /^fix:/.test(l), reply: { status: 'DONE' } },
      { match: (l) => /^rebuild:/.test(l), reply: { passed: true } },
    ]),
  )
  const out = await buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null)
  assert.strictEqual(out.fixRounds, 1)
  const beat = h.calls.find((c) => c.label === 'lock-heartbeat')
  assert.ok(beat, 'the fix round refreshes the lock timestamp')
  assert.ok(/acquired/.test(beat.prompt) && /token/.test(beat.prompt), 'the heartbeat is token-guarded and touches `acquired`')
})

await test('the inline codex leg may not drop a Codex-reported defect for a missing failureScenario', async () => {
  // The required failureScenario plus "a finding with no failureScenario is a worry, do not emit
  // it" is a suppression channel on the ONE leg that only MAPS another model's free text: a [P0]
  // with no reproduction steps would become findings:[] while the non-empty `evidence` string
  // still counted the leg as fully proven, and the defect would ship.
  const h = makeHarness(inlineRules())
  await buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, null)
  const codexPrompt = h.calls.find((c) => c.label === 'codex:r0').prompt
  assert.ok(/NEVER DROP A CODEX-REPORTED DEFECT/.test(codexPrompt), 'the mapping leg is told not to suppress')
  assert.ok(/DERIVE one from the diff/.test(codexPrompt), 'it derives the scenario from the diff it can read')
  assert.ok(/still emit the finding at the mapped severity/.test(codexPrompt), 'and emits the finding regardless')
})

await test('the team gate receives the PLAN for its INTENT axis, not just the stress block', async () => {
  // RED before the fix: dual-adversarial.js derived INTENT from `stressBlock`. A PRE-STRESSED
  // plan forwards an EMPTY stress block, so the DEEPEST gate ran on the "no plan in context"
  // degraded branch and verified intent from commit subjects; a plan WITH notes had its stress
  // NOTES read as "the plan acceptance criteria".
  const teamGate = () => ({
    clean: true, blocking: 0, gateStatus: 'COMPLETE', verdict: 'PASS', codexSource: 'codex', findings: [],
  })
  const h = makeHarness(stageRules(TIER3_PLAN), teamGate)
  await buildWorkflow()(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, skipStress: true }, null, h.workflow)
  assert.ok(h.workflowCalls.length > 0, 'the Tier-3 plan delegated to the team gate')
  for (const c of h.workflowCalls) {
    assert.strictEqual(c.wargs.plan, baseArgs.plan, 'every delegation forwards the plan path for the INTENT axis')
  }
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
