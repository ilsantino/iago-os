#!/usr/bin/env node
// Behavioral test harness for execute-pipeline.js.
//
// No test framework is installed at the repo root (validate-workflows.mjs is
// compile-only), so this is a plain node:assert harness modeled on
// dual-adversarial.test.mjs. It loads the workflow BODY inside the same
// async-function wrapper the live harness uses (see scripts/validate-workflows.mjs)
// and injects MOCK agent/parallel/log/phase/args bindings, then asserts behavior.
//
// Run:  node .claude/workflows/execute-pipeline.test.mjs
//
// Regression coverage for the dual-adversarial Critical finding (PR_TAG_SCHEMA had
// no representable tag-FAILURE state):
//  - PR_TAG_SCHEMA's tagStatus enum includes "TAG_FAILED" (the honest value an agent
//    must report when `gh pr comment` fails AFTER PR creation, instead of
//    hallucinating "TAGGED"). FAILS without the schema fix.
//  - The workflow ABORTS (throws) when the merged create-PR+tag agent returns
//    tagStatus="TAG_FAILED" — it must NOT report pipeline success while the mandatory
//    async @claude review never started.
//  - The abort message PRESERVES prUrl + prNumber so the run is recoverable via
//    /iago-prfix (no work lost; the PR is real and re-taggable).
//  - Control: a healthy tagStatus="TAGGED" run completes (proves the abort is
//    specific to the failure value, not a blanket failure).

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(__dirname, 'execute-pipeline.js'), 'utf8').replace(
  /export const meta/,
  'const meta',
)

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

// A scripted-agent mock: each call is matched against a list of {match, reply} rules
// by the agent label. parallel just runs the leg fns concurrently. The mock does NOT
// validate the agent() `schema` option (the live tool-call layer does), so these
// tests exercise the workflow's OWN guards on the returned values.
function makeHarness(rules, opts = {}) {
  const calls = []
  const logs = []
  const agent = async (prompt, options = {}) => {
    const label = options.label || ''
    calls.push({ label, prompt, options })
    for (const r of rules) {
      if (r.match(label, prompt, options)) {
        return typeof r.reply === 'function' ? r.reply({ label, prompt, options }) : r.reply
      }
    }
    if (opts.defaultReply !== undefined) return opts.defaultReply
    throw new Error(`mock agent: no rule for label "${label}"`)
  }
  const parallel = async (legs) => Promise.all(legs.map((fn) => fn()))
  const log = (m) => logs.push(String(m))
  const phase = () => {}
  return { agent, parallel, log, phase, calls, logs }
}

const baseArgs = {
  plan: '/repo/.iago/plans/feature-x/01.md',
  projectDir: '/repo',
  iagoRoot: '/iago',
  // skipStress so we don't have to mock the stress agent — the PR-tag path is
  // unaffected by the stress decision.
  skipStress: true,
}

// Mock rules covering every agent on the happy path UP TO the PR stage. The PR agent
// rule (label create-pr-tag) is supplied per-test so each test controls tagStatus.
function flowRules(prReply) {
  return [
    { match: (l) => l === 'lock-acquire', reply: { status: 'ACQUIRED' } },
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
    await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, null)
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
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, null)
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
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, null)
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
