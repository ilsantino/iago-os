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

await test('Tier 2 delegates to the team gate on BOTH the initial review AND the fix-loop re-review', async () => {
  // workflow() (the team gate) returns a blocking finding first → triggers a fix round →
  // re-review must call workflow() AGAIN with mode='team'; second call is clean.
  const teamGate = (n) =>
    n === 1
      ? { clean: false, blocking: 1, verdict: 'FAIL', codexSource: 'codex', verificationSameFamily: true, verificationDegraded: false, findings: [{ severity: 'Critical', summary: 'boom', by: 'opus' }] }
      : { clean: true, blocking: 0, verdict: 'PASS', codexSource: 'codex', verificationSameFamily: true, verificationDegraded: false, findings: [] }
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

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
