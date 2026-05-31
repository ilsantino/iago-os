#!/usr/bin/env node
// Behavioral test harness for dual-adversarial.js.
//
// No test framework is installed at the repo root (validate-workflows.mjs is
// compile-only), so this is a plain node:assert harness. It loads the workflow
// BODY inside the same async-function wrapper the live harness uses (see
// scripts/validate-workflows.mjs) and injects MOCK agent/parallel/log/phase/args
// bindings, then asserts behavior.
//
// Run:  node .claude/workflows/dual-adversarial.test.mjs
//
// Covers (stress constraints C1, C4, I1, I3, plus the four numbered task points):
//  - standard mode (mode !== "team") return shape is unchanged — no `mode`/`filtered`
//    semantics leak into the standard path, lens indexing intact
//  - team mode appends team:data + team:arch legs, tagged by:"team:data"/"team:arch"
//  - team verification keeps a Critical finding on {confirm, refute}
//  - team verification drops a Critical finding only on {refute, refute}, moving it to `filtered`
//  - a bare refute (no code evidence) counts as a confirm — keep (C1)
//  - Minor findings are kept un-verified and never dropped
//  - blocking recomputed from CONFIRMED Critical/Important only
//  - verificationDegraded flag surfaces when both skeptics are same-family (I3/M2)
//  - side-effect assertion: a review leg that dirtied the tree fails the gate (I1)

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(__dirname, 'dual-adversarial.js'), 'utf8').replace(
  /export const meta/,
  'const meta',
)

// Build the workflow as an async function with the harness signature. The
// workflow ends in a top-level `return {...}`, so the wrapped function returns it.
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

// A scripted-agent mock: each call is matched against a list of {match, reply}
// rules by the agent label. parallel just runs the leg fns concurrently.
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

const baseArgs = { projectDir: '/repo', iagoRoot: '/iago', base: 'origin/main', prNumber: '7' }

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

// ── Standard mode: shape unchanged ──────────────────────────────────────
await test('standard mode returns the original shape (no team semantics)', async () => {
  const h = makeHarness([
    { match: (l) => l === 'review', reply: { verdict: 'PASS', findings: [] } },
    { match: (l) => l === 'codex', reply: { source: 'codex', findings: [] } },
  ])
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, null)
  assert.strictEqual(out.clean, true, 'clean')
  assert.strictEqual(out.gateStatus, 'COMPLETE', 'gateStatus')
  assert.strictEqual(out.blocking, 0, 'blocking')
  assert.strictEqual(out.verdict, 'PASS', 'verdict')
  assert.deepStrictEqual(out.incompleteLegs, [], 'incompleteLegs')
  assert.deepStrictEqual(out.lenses, [], 'lenses')
  // standard mode must report mode "standard" and NOT run verification.
  assert.strictEqual(out.mode, 'standard', 'mode flag')
  assert.deepStrictEqual(out.filtered, [], 'filtered empty in standard mode')
  // No verification skeptic agents may run in standard mode.
  assert.ok(!h.calls.some((c) => /skeptic/i.test(c.label)), 'no skeptic agents in standard mode')
})

await test('standard mode lens indexing intact (lens findings attributed correctly)', async () => {
  const h = makeHarness([
    { match: (l) => l === 'review', reply: { verdict: 'PASS', findings: [] } },
    { match: (l) => l === 'codex', reply: { source: 'codex', findings: [] } },
    {
      match: (l) => l === 'security',
      reply: { findings: [{ severity: 'Minor', summary: 'sec lens note' }] },
    },
  ])
  const wf = buildWorkflow()
  const out = await wf(
    h.agent,
    h.parallel,
    null,
    h.log,
    h.phase,
    { ...baseArgs, lenses: ['security'] },
    null,
    null,
  )
  assert.deepStrictEqual(out.lenses, ['security'])
  const lensFinding = out.findings.find((f) => f.by === 'lens:security')
  assert.ok(lensFinding, 'security lens finding attributed by:lens:security')
  assert.strictEqual(out.clean, true, 'minor-only lens still clean')
})

// ── Team mode: extra legs ───────────────────────────────────────────────
await test('team mode appends team:data and team:arch legs tagged correctly', async () => {
  const h = makeHarness([
    { match: (l) => l === 'review', reply: { verdict: 'PASS', findings: [] } },
    { match: (l) => l === 'codex', reply: { source: 'codex', findings: [] } },
    {
      match: (l) => l === 'team:data',
      reply: { findings: [{ severity: 'Minor', summary: 'float drift maybe' }] },
    },
    {
      match: (l) => l === 'team:arch',
      reply: { findings: [{ severity: 'Minor', summary: 'coupling note' }] },
    },
  ])
  const wf = buildWorkflow()
  const out = await wf(
    h.agent,
    h.parallel,
    null,
    h.log,
    h.phase,
    { ...baseArgs, mode: 'team' },
    null,
    null,
  )
  assert.strictEqual(out.mode, 'team', 'mode is team')
  assert.ok(
    out.findings.some((f) => f.by === 'team:data'),
    'team:data finding tagged by:team:data',
  )
  assert.ok(
    out.findings.some((f) => f.by === 'team:arch'),
    'team:arch finding tagged by:team:arch',
  )
  assert.ok(h.calls.some((c) => c.label === 'team:data'), 'team:data leg ran')
  assert.ok(h.calls.some((c) => c.label === 'team:arch'), 'team:arch leg ran')
})

// ── Team verification truth table ───────────────────────────────────────
function teamRules({ critFrom = 'review', skeptic } = {}) {
  return [
    {
      match: (l) => l === 'review',
      reply:
        critFrom === 'review'
          ? { verdict: 'FAIL', findings: [{ severity: 'Critical', summary: 'sql injection in q' }] }
          : { verdict: 'PASS', findings: [] },
    },
    { match: (l) => l === 'codex', reply: { source: 'codex', findings: [] } },
    { match: (l) => l === 'team:data', reply: { findings: [] } },
    { match: (l) => l === 'team:arch', reply: { findings: [] } },
    // skeptic rule supplied by caller; falls through to per-call below
    ...(skeptic ? [{ match: (l) => /skeptic/i.test(l), reply: skeptic }] : []),
  ]
}

await test('team verification KEEPS a Critical on {confirm, refute}', async () => {
  // Two skeptics: first confirms real=true, second refutes real=false w/ evidence.
  let n = 0
  const h = makeHarness(
    teamRules({
      skeptic: () => {
        n++
        return n === 1
          ? { real: true, reason: 'reachable via unauth route' }
          : { real: false, reason: 'param is parameterized at db.ts:42' }
      },
    }),
  )
  const wf = buildWorkflow()
  const out = await wf(
    h.agent,
    h.parallel,
    null,
    h.log,
    h.phase,
    { ...baseArgs, mode: 'team' },
    null,
    null,
  )
  assert.strictEqual(out.blocking, 1, 'one confirm keeps the Critical blocking')
  assert.deepStrictEqual(out.filtered, [], 'nothing filtered when one skeptic confirms')
  assert.strictEqual(out.clean, false, 'not clean with a kept Critical')
})

await test('team verification DROPS a Critical only on {refute, refute} with evidence', async () => {
  const h = makeHarness(
    teamRules({
      skeptic: () => ({ real: false, reason: 'input is escaped at sanitize.ts:10, not reachable' }),
    }),
  )
  const wf = buildWorkflow()
  const out = await wf(
    h.agent,
    h.parallel,
    null,
    h.log,
    h.phase,
    { ...baseArgs, mode: 'team' },
    null,
    null,
  )
  assert.strictEqual(out.blocking, 0, 'both refute → dropped → no blocking')
  assert.strictEqual(out.filtered.length, 1, 'dropped finding moved to filtered')
  assert.ok(out.filtered[0].reasons && out.filtered[0].reasons.length >= 1, 'filtered carries reasons')
  assert.strictEqual(out.clean, true, 'clean once the only Critical is refuted by both')
})

await test('a bare refute (no evidence) counts as a confirm — finding kept (C1)', async () => {
  // Both skeptics return real=false but with NO substantive code evidence.
  const h = makeHarness(
    teamRules({
      skeptic: () => ({ real: false, reason: '' }),
    }),
  )
  const wf = buildWorkflow()
  const out = await wf(
    h.agent,
    h.parallel,
    null,
    h.log,
    h.phase,
    { ...baseArgs, mode: 'team' },
    null,
    null,
  )
  assert.strictEqual(out.blocking, 1, 'evidence-free refute is treated as a confirm — kept')
  assert.deepStrictEqual(out.filtered, [], 'not filtered when refutes lack evidence')
})

await test('Minor findings are kept un-verified (never sent to skeptics, never dropped)', async () => {
  const skepticCalls = []
  const h = makeHarness([
    {
      match: (l) => l === 'review',
      reply: { verdict: 'PASS_WITH_CONCERNS', findings: [{ severity: 'Minor', summary: 'nit' }] },
    },
    { match: (l) => l === 'codex', reply: { source: 'codex', findings: [] } },
    { match: (l) => l === 'team:data', reply: { findings: [] } },
    { match: (l) => l === 'team:arch', reply: { findings: [] } },
    {
      match: (l) => /skeptic/i.test(l),
      reply: ({ label }) => {
        skepticCalls.push(label)
        return { real: false, reason: 'n/a' }
      },
    },
  ])
  const wf = buildWorkflow()
  const out = await wf(
    h.agent,
    h.parallel,
    null,
    h.log,
    h.phase,
    { ...baseArgs, mode: 'team' },
    null,
    null,
  )
  assert.strictEqual(skepticCalls.length, 0, 'no skeptic ran for a Minor-only finding set')
  assert.ok(
    out.findings.some((f) => f.severity === 'Minor'),
    'Minor finding still reported',
  )
  assert.strictEqual(out.blocking, 0, 'Minor never blocks')
  assert.deepStrictEqual(out.filtered, [], 'Minor never filtered')
})

await test('verificationSameFamily surfaces when skeptics run (same-family Opus) — T06', async () => {
  const h = makeHarness(
    teamRules({ skeptic: () => ({ real: true, reason: 'confirmed' }) }),
  )
  const wf = buildWorkflow()
  const out = await wf(
    h.agent,
    h.parallel,
    null,
    h.log,
    h.phase,
    { ...baseArgs, mode: 'team' },
    null,
    null,
  )
  // T06: the structural same-family fact is its own flag; verificationDegraded is reserved
  // for a skeptic that could not RUN, so it stays false when both skeptics returned.
  assert.strictEqual(out.verificationSameFamily, true, 'skeptics ran → same-family flagged')
  assert.strictEqual(out.verificationDegraded, false, 'no null skeptic → not degraded')
})

await test('verificationDegraded is true only when a skeptic fails to run (null) — T06', async () => {
  const h = makeHarness([
    { match: (l) => l === 'review', reply: { verdict: 'FAIL', findings: [{ severity: 'Critical', summary: 'x' }] } },
    { match: (l) => l === 'codex', reply: { source: 'codex', findings: [] } },
    { match: (l) => l === 'team:data', reply: { findings: [] } },
    { match: (l) => l === 'team:arch', reply: { findings: [] } },
    { match: (l) => /^skeptic:0/.test(l), reply: null }, // one angle fails to run every retry
    { match: (l) => /^skeptic:1/.test(l), reply: { real: true, reason: 'confirmed' } },
  ])
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, mode: 'team' }, null, null)
  assert.strictEqual(out.verificationSameFamily, true, 'verification ran → same-family')
  assert.strictEqual(out.verificationDegraded, true, 'a null skeptic marks verification degraded')
  assert.strictEqual(out.blocking, 1, 'a null skeptic is treated as a confirm — finding kept')
})

await test('skeptic verification is capped; overflow blocking findings kept un-verified — T05', async () => {
  const crits = Array.from({ length: 10 }, (_, i) => ({ severity: 'Critical', summary: `crit-${i}` }))
  const skepticLabels = []
  const h = makeHarness([
    { match: (l) => l === 'review', reply: { verdict: 'FAIL', findings: crits } },
    { match: (l) => l === 'codex', reply: { source: 'codex', findings: [] } },
    { match: (l) => l === 'team:data', reply: { findings: [] } },
    { match: (l) => l === 'team:arch', reply: { findings: [] } },
    {
      match: (l) => /skeptic/i.test(l),
      reply: ({ label }) => {
        skepticLabels.push(label)
        return { real: true, reason: 'confirmed' }
      },
    },
  ])
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, mode: 'team', skepticCap: 8 }, null, null)
  // 8 findings verified × 2 skeptics = 16 skeptic invocations; the other 2 get none.
  assert.strictEqual(skepticLabels.length, 16, 'cap=8 → exactly 8 findings × 2 skeptics verified')
  assert.strictEqual(out.blocking, 10, 'all 10 Criticals remain blocking (8 verified + 2 overflow kept)')
})

// ── Side-effect assertion (I1) ──────────────────────────────────────────
await test('a review leg that dirties the tree fails the gate, does not report clean (I1)', async () => {
  // The side-effect guard runs a read-only agent at start + end to capture HEAD +
  // porcelain. Simulate the tree changing between snapshots.
  let snap = 0
  const h = makeHarness([
    { match: (l) => l === 'review', reply: { verdict: 'PASS', findings: [] } },
    { match: (l) => l === 'codex', reply: { source: 'codex', findings: [] } },
    {
      match: (l) => /side-?effect|tree-snapshot|integrity/i.test(l),
      reply: () => {
        snap++
        return snap === 1
          ? { head: 'aaa', porcelain: '' }
          : { head: 'aaa', porcelain: ' M src/x.ts' }
      },
    },
  ])
  const wf = buildWorkflow()
  let threw = false
  try {
    await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, null)
  } catch (e) {
    threw = true
    assert.ok(/side.?effect|dirtied|mutat|porcelain|tree/i.test(e.message), 'error names the side-effect')
  }
  assert.ok(threw, 'a dirtied tree must throw, never report clean')
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
