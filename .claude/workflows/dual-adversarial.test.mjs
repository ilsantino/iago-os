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
//
// AUTO-DERIVE default (stress note 1): under the auto-config path the workflow now
// dispatches a `changed-files` agent before building the lens legs whenever `lenses`
// is absent/null/"auto". Tests that exercise the auto path but do not care about the
// derived set get a default `changed-files` rule here returning `{ files: [] }` (→ the
// two base lenses), so the 8 pre-existing tests that omit `lenses` stay green without a
// per-test mock. A test that needs a specific derived set supplies its own
// `changed-files` rule, which is matched FIRST (rules are checked before this default).
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
    // Default changed-files probe → empty diff → base lenses. Caller rules above win.
    if (label === 'changed-files') return { files: [] }
    // The auto-derive path ALWAYS appends the two base lenses (codeQuality + completeness),
    // whose leg labels are LENS_DEFS[key].title. Give them clean empty-findings defaults so
    // auto-path tests that don't care about lens output don't see them as incomplete legs.
    if (label === 'code quality' || label === 'completeness critic') return { findings: [] }
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
  // baseArgs omits `lenses` → auto-derive path. The default changed-files mock returns
  // an empty diff, so deriveLenses([]) yields exactly the two base lenses.
  assert.deepStrictEqual(out.lenses, ['codeQuality', 'completeness'], 'lenses (auto-derived base)')
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

await test('verificationDegraded surfaces when skeptics are same-family (I3/M2)', async () => {
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
  assert.strictEqual(out.verificationDegraded, true, 'same-family skeptics flagged degraded')
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

// ── Start snapshot precedes the changed-files probe (I1 + codex Important) ──
await test('start snapshot is captured BEFORE the changed-files probe (probe mutation is caught)', async () => {
  // codex Important: the changed-files probe ran BEFORE the start snapshot, so a probe that
  // dirtied the tree became the read-only baseline and the run could still report clean. The
  // fix moves the start snapshot ahead of the probe. Assert (a) call ORDER: start snapshot
  // before changed-files; and (b) a probe-caused mutation is DETECTED and throws.
  const order = []
  let snap = 0
  const h = makeHarness([
    {
      match: (l) => /side-?effect-snapshot/i.test(l),
      reply: ({ label }) => {
        order.push(label)
        snap++
        // start = clean; end = dirty (the probe "mutated" the tree between snapshots)
        return snap === 1 ? { head: 'aaa', porcelain: '' } : { head: 'aaa', porcelain: ' M src/x.ts' }
      },
    },
    {
      match: (l) => l === 'changed-files',
      reply: () => {
        order.push('changed-files')
        return { files: ['src/main.tsx'] }
      },
    },
    { match: (l) => l === 'review', reply: { verdict: 'PASS', findings: [] } },
    { match: (l) => l === 'codex', reply: { source: 'codex', findings: [] } },
    {
      match: (l) => ['security', 'amplify bug-bounty', 'frontend bug-bounty', 'code quality', 'completeness critic'].includes(l),
      reply: { findings: [] },
    },
  ])
  const wf = buildWorkflow()
  let threw = false
  try {
    await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, null)
  } catch (e) {
    threw = true
    assert.ok(/side.?effect|dirtied|mutat|porcelain|tree/i.test(e.message), 'error names the side-effect breach')
  }
  // The start snapshot label must appear in the call order BEFORE the changed-files probe.
  const startIdx = order.indexOf('side-effect-snapshot:start')
  const probeIdx = order.indexOf('changed-files')
  assert.ok(startIdx !== -1, 'start snapshot was captured')
  assert.ok(probeIdx !== -1, 'changed-files probe ran')
  assert.ok(startIdx < probeIdx, 'start snapshot is captured BEFORE the changed-files probe')
  assert.ok(threw, 'a probe-caused tree mutation throws — the gate never reports clean over a dirtied tree')
})

// ── Auto-derive lens path (lenses absent / "auto") ──────────────────────
// The DEFAULT run omits `lenses`, so the workflow dispatches a `changed-files` agent and
// derives the extra lenses from the diff. Lens leg labels are LENS_DEFS[key].title:
//   security → "security", amplify → "amplify bug-bounty", frontend → "frontend bug-bounty",
//   codeQuality → "code quality", completeness → "completeness critic".
const LENS_TITLE = {
  security: 'security',
  amplify: 'amplify bug-bounty',
  frontend: 'frontend bug-bounty',
  codeQuality: 'code quality',
  completeness: 'completeness critic',
  perf: 'performance & cost',
  tests: 'test coverage',
}
// Build a harness that resolves the two core legs + a controlled changed-files probe +
// clean empty-findings replies for every lens leg, so we can assert on the dispatched set.
function autoHarness(files, extraRules = []) {
  return makeHarness([
    { match: (l) => l === 'review', reply: { verdict: 'PASS', findings: [] } },
    { match: (l) => l === 'codex', reply: { source: 'codex', findings: [] } },
    { match: (l) => l === 'changed-files', reply: { files } },
    // every possible lens leg → empty findings (we assert on which ran, not their output)
    { match: (l) => Object.values(LENS_TITLE).includes(l), reply: { findings: [] } },
    ...extraRules,
  ])
}
// Which lens KEYS were dispatched as legs, derived from the captured call labels.
function dispatchedLensKeys(calls) {
  const titles = new Set(calls.map((c) => c.label))
  return Object.keys(LENS_TITLE).filter((k) => titles.has(LENS_TITLE[k]))
}

await test('auto-derive: amplify/** path → amplify + base lenses, no frontend/security', async () => {
  const h = autoHarness(['amplify/data/resource.ts'])
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, null)
  assert.deepStrictEqual(out.lenses, ['amplify', 'codeQuality', 'completeness'], 'exact derived set + order')
  assert.deepStrictEqual(dispatchedLensKeys(h.calls).sort(), ['amplify', 'codeQuality', 'completeness'], 'dispatched legs')
  assert.ok(!out.lenses.includes('frontend'), 'no frontend')
  assert.ok(!out.lenses.includes('security'), 'no security')
})

await test('auto-derive: src/**/*.tsx path → frontend + base lenses', async () => {
  const h = autoHarness(['src/features/x/Widget.tsx'])
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, null)
  assert.deepStrictEqual(out.lenses, ['frontend', 'codeQuality', 'completeness'], 'frontend + base')
})

await test('auto-derive: .tsx OUTSIDE src/ (packages/ui/Button.tsx) → frontend', async () => {
  const h = autoHarness(['packages/ui/Button.tsx'])
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, null)
  assert.ok(out.lenses.includes('frontend'), '.tsx anywhere maps to frontend')
  assert.deepStrictEqual(out.lenses, ['frontend', 'codeQuality', 'completeness'], 'frontend + base, exact')
})

await test('auto-derive: amplify auth handler → amplify AND security + base', async () => {
  const h = autoHarness(['amplify/functions/auth/handler.ts'])
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, null)
  // fixed precedence: security, amplify, frontend, codeQuality, completeness
  assert.deepStrictEqual(out.lenses, ['security', 'amplify', 'codeQuality', 'completeness'], 'security+amplify+base, ordered')
})

await test('auto-derive: no rule matches (docs/readme.md) → exactly the two base lenses', async () => {
  const h = autoHarness(['docs/readme.md'])
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, null)
  assert.deepStrictEqual(out.lenses, ['codeQuality', 'completeness'], 'base lenses only')
  assert.deepStrictEqual(dispatchedLensKeys(h.calls).sort(), ['codeQuality', 'completeness'], 'only base legs dispatched')
})

await test('auto-derive: lenses:"auto" string triggers the same derivation as absent', async () => {
  const h = autoHarness(['src/main.tsx'])
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, lenses: 'auto' }, null, null)
  assert.deepStrictEqual(out.lenses, ['frontend', 'codeQuality', 'completeness'], '"auto" derives like absent')
  assert.ok(h.calls.some((c) => c.label === 'changed-files'), 'changed-files agent ran for "auto"')
})

await test('auto-derive: lenses:"AUTO" (uppercase) derives like "auto" (case-insensitive)', async () => {
  // Minor (opus): an uppercase "AUTO" previously took the EXPLICIT path, parsed as csv
  // ["AUTO"], dropped as an unknown LENS_DEFS key → zero extra lenses + a drift WARNING.
  // The fix lowercases the auto-match so a fat-fingered case still auto-derives.
  const h = autoHarness(['src/main.tsx'])
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, lenses: 'AUTO' }, null, null)
  assert.deepStrictEqual(out.lenses, ['frontend', 'codeQuality', 'completeness'], '"AUTO" derives like "auto"')
  assert.ok(h.calls.some((c) => c.label === 'changed-files'), 'changed-files agent ran for "AUTO"')
  assert.ok(!h.logs.some((m) => /lens drift/i.test(m)), 'no lens-drift WARNING for "AUTO"')
})

await test('auto-derive: empty diff (changed-files returns []) → base lenses, distinct no-change log', async () => {
  const h = autoHarness([])
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, null)
  assert.deepStrictEqual(out.lenses, ['codeQuality', 'completeness'], 'base lenses on empty diff')
  // stress note 4: the real no-change diff must log DISTINCTLY from a degraded fetch.
  assert.ok(h.logs.some((m) => /no diff vs/i.test(m)), 'logs a no-change diff message')
  assert.ok(!h.logs.some((m) => /DEGRADED probe/i.test(m)), 'does NOT log a degraded-fetch message')
})

await test('auto-derive: changed-files agent fails (null) → FULL auto-selectable lens set, distinct DEGRADED log, no throw', async () => {
  // No changed-files rule and skip the makeHarness default by returning null explicitly →
  // withRetry exhausts and yields null → degraded fetch path.
  // Critical-finding regression (codex): a DEGRADED probe must NOT shrink coverage to the two
  // base lenses — it must fall back to the FULL auto-selectable set so the specialized
  // security/amplify/frontend lenses still run on what might be a sensitive diff.
  const h = makeHarness([
    { match: (l) => l === 'review', reply: { verdict: 'PASS', findings: [] } },
    { match: (l) => l === 'codex', reply: { source: 'codex', findings: [] } },
    { match: (l) => l === 'changed-files', reply: null },
    // every auto-selectable lens leg → empty findings (assert on WHICH ran, not their output)
    {
      match: (l) =>
        ['security', 'amplify bug-bounty', 'frontend bug-bounty', 'code quality', 'completeness critic'].includes(l),
      reply: { findings: [] },
    },
  ])
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, null)
  assert.deepStrictEqual(
    out.lenses,
    ['security', 'amplify', 'frontend', 'codeQuality', 'completeness'],
    'degraded probe falls back to the FULL auto-selectable lens set (coverage cannot shrink)',
  )
  // The specialized lenses MUST be present — this is the heart of the fix.
  assert.ok(out.lenses.includes('security'), 'security lens present under degraded probe')
  assert.ok(out.lenses.includes('amplify'), 'amplify lens present under degraded probe')
  assert.ok(out.lenses.includes('frontend'), 'frontend lens present under degraded probe')
  // And every fallback lens actually DISPATCHED a leg (not just listed in out.lenses).
  assert.deepStrictEqual(
    dispatchedLensKeys(h.calls).sort(),
    ['amplify', 'codeQuality', 'completeness', 'frontend', 'security'],
    'all auto-selectable lens legs dispatched under degraded probe',
  )
  assert.strictEqual(out.clean, true, 'degraded fetch does not throw or block (just widens coverage)')
  assert.ok(h.logs.some((m) => /DEGRADED probe/i.test(m)), 'logs a degraded-fetch message')
  assert.ok(!h.logs.some((m) => /no diff vs/i.test(m)), 'does NOT log the no-change-diff message')
})

await test('auto-derive: degraded probe still surfaces a security lens FINDING on a sensitive diff (codex Critical regression)', async () => {
  // The exact failure the codex finding describes: a transient/skipped changed-files probe on
  // an auth/payment diff. With the OLD base-lenses-only fallback, the security lens never ran,
  // so a real auth-bypass it would have caught is invisible and the gate reports clean:false→true.
  // With the conservative fallback the security lens runs, surfaces its Critical, and the gate
  // BLOCKS — proving coverage did not silently shrink.
  const h = makeHarness([
    { match: (l) => l === 'review', reply: { verdict: 'PASS', findings: [] } },
    { match: (l) => l === 'codex', reply: { source: 'codex', findings: [] } },
    { match: (l) => l === 'changed-files', reply: null },
    {
      match: (l) => l === 'security',
      reply: { findings: [{ severity: 'Critical', summary: 'auth bypass on the changed handler' }] },
    },
    {
      match: (l) => ['amplify bug-bounty', 'frontend bug-bounty', 'code quality', 'completeness critic'].includes(l),
      reply: { findings: [] },
    },
  ])
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, null)
  assert.ok(
    out.findings.some((f) => f.by === 'lens:security' && f.severity === 'Critical'),
    'security lens Critical surfaced under a degraded probe (would be invisible with base-only fallback)',
  )
  assert.strictEqual(out.blocking, 1, 'the degraded-probe security Critical blocks the gate')
  assert.strictEqual(out.clean, false, 'gate does NOT report clean when a fallback lens finds a Critical')
})

await test('explicit override: lenses:["perf"] (Array) bypasses derivation — no changed-files agent', async () => {
  const h = makeHarness([
    { match: (l) => l === 'review', reply: { verdict: 'PASS', findings: [] } },
    { match: (l) => l === 'codex', reply: { source: 'codex', findings: [] } },
    { match: (l) => l === 'performance & cost', reply: { findings: [] } },
  ])
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, lenses: ['perf'] }, null, null)
  assert.deepStrictEqual(out.lenses, ['perf'], 'explicit array honored verbatim, no base lenses added')
  assert.ok(!h.calls.some((c) => c.label === 'changed-files'), 'explicit array never dispatches changed-files')
})

await test('explicit empty []: legacy/interactive zero-lens path — no derivation, no changed-files', async () => {
  // stress note 2: an explicit [] must NOT collapse into the auto path — it means "run zero
  // extra lenses" (the --interactive "none selected" case), distinct from absent → auto.
  const h = makeHarness([
    { match: (l) => l === 'review', reply: { verdict: 'PASS', findings: [] } },
    { match: (l) => l === 'codex', reply: { source: 'codex', findings: [] } },
  ])
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, lenses: [] }, null, null)
  assert.deepStrictEqual(out.lenses, [], 'explicit [] = zero lenses, NOT auto-derived')
  assert.ok(!h.calls.some((c) => c.label === 'changed-files'), 'explicit [] never dispatches changed-files')
})


// ── EXPLICIT csv/map: no changed-files probe ────────────────────────────
await test('explicit csv ("security,frontend") takes the EXPLICIT path — no changed-files probe', async () => {
  const h = makeHarness([
    { match: (l) => l === 'review', reply: { verdict: 'PASS', findings: [] } },
    { match: (l) => l === 'codex', reply: { source: 'codex', findings: [] } },
    { match: (l) => l === 'security', reply: { findings: [] } },
    { match: (l) => l === 'frontend bug-bounty', reply: { findings: [] } },
  ])
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, lenses: 'security,frontend' }, null, null)
  assert.deepStrictEqual(out.lenses, ['security', 'frontend'], 'csv string honored verbatim')
  assert.ok(!h.calls.some((c) => c.label === 'changed-files'), 'csv EXPLICIT path never dispatches changed-files')
})

await test('explicit map ({ security: true, frontend: true }) takes the EXPLICIT path — no changed-files probe', async () => {
  const h = makeHarness([
    { match: (l) => l === 'review', reply: { verdict: 'PASS', findings: [] } },
    { match: (l) => l === 'codex', reply: { source: 'codex', findings: [] } },
    { match: (l) => l === 'security', reply: { findings: [] } },
    { match: (l) => l === 'frontend bug-bounty', reply: { findings: [] } },
  ])
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, lenses: { security: true, frontend: true } }, null, null)
  assert.deepStrictEqual(out.lenses, ['security', 'frontend'], 'map honored verbatim')
  assert.ok(!h.calls.some((c) => c.label === 'changed-files'), 'map EXPLICIT path never dispatches changed-files')
})

// ── Broadened security-lens taxonomy (Important — codex) ────────────────
await test('auto-derive: broadened security taxonomy — authz/tenant/policy/jwt/secret paths derive the security lens', async () => {
  // Important (codex): the security trigger was only auth|authz|cognito|payment|billing, so a
  // permissions / tenant-isolation / authz diff passed the FINAL pre-merge gate with NO deep
  // security lens. Each path below contains ONLY a NEW keyword (no auth/cognito/payment/billing)
  // and MUST still derive the security lens. RED before the broadening: none of these match.
  const securityPaths = [
    'src/features/tenant/rbac-policy.ts', // tenant, rbac, polic
    'amplify/functions/permissions/handler.ts', // permission
    'src/lib/jwt-verify.ts', // jwt
    'src/roles/acl.ts', // role, acl
    'src/login/redirect.ts', // login (note: "oauth" would also match via the "auth" substring)
    'src/session/store.ts', // session
    'infra/secret-rotation.ts', // secret
    'src/crypto/encrypt-token.ts', // encrypt, token
  ]
  for (const f of securityPaths) {
    const h = autoHarness([f])
    const wf = buildWorkflow()
    const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, null)
    assert.ok(out.lenses.includes('security'), `security lens derived for "${f}"`)
    assert.ok(dispatchedLensKeys(h.calls).includes('security'), `security leg dispatched for "${f}"`)
  }
  // Negative control: a path with NO security keyword must NOT derive the security lens (the
  // broadening must not collapse into "always run security").
  const neg = autoHarness(['src/components/DataTable.tsx'])
  const wfNeg = buildWorkflow()
  const outNeg = await wfNeg(neg.agent, neg.parallel, null, neg.log, neg.phase, { ...baseArgs }, null, null)
  assert.ok(!outNeg.lenses.includes('security'), 'no security lens for a non-security path')
})

// ── Production default: team mode WITH auto-derived lenses >2 (Important — lens:tests) ──
await test('team mode + auto-derived multi-lens diff: lens and team findings attributed correctly (production default path)', async () => {
  // Important (lens:tests): the production default is mode:'team' WITH auto-derived lenses, so
  // lenses.length is VARIABLE and the leg-slicing (lensResults = results.slice(2, 2+len);
  // teamResults = results.slice(2+len, 2+len+teamDefs.length)) depends on it. Every other team
  // test uses the default {files:[]} (len=2). This exercises len>2 (a sensitive diff deriving 5
  // lenses) ∥ team and asserts each finding lands on the CORRECT by: tag — a slicing regression
  // would bleed a lens finding into teamResults (or vice versa) with no other test failing. Pins
  // the slicing invariant for the most common real path.
  const h = makeHarness([
    { match: (l) => l === 'review', reply: { verdict: 'PASS', findings: [] } },
    { match: (l) => l === 'codex', reply: { source: 'codex', findings: [] } },
    // a sensitive diff: amplify auth handler + a .tsx → derives security, amplify, frontend, +base (5)
    {
      match: (l) => l === 'changed-files',
      reply: { files: ['amplify/functions/auth/handler.ts', 'src/Widget.tsx'] },
    },
    { match: (l) => l === 'security', reply: { findings: [{ severity: 'Minor', summary: 'SEC-LENS-MARK' }] } },
    { match: (l) => l === 'amplify bug-bounty', reply: { findings: [] } },
    { match: (l) => l === 'frontend bug-bounty', reply: { findings: [] } },
    { match: (l) => l === 'team:data', reply: { findings: [{ severity: 'Minor', summary: 'TEAM-DATA-MARK' }] } },
    { match: (l) => l === 'team:arch', reply: { findings: [] } },
  ])
  const wf = buildWorkflow()
  const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs, mode: 'team' }, null, null)
  // 5 lenses derived in fixed precedence; team appends team:data + team:arch.
  assert.deepStrictEqual(
    out.lenses,
    ['security', 'amplify', 'frontend', 'codeQuality', 'completeness'],
    'auto-derived 5 lenses',
  )
  // The security LENS finding is attributed to lens:security (NOT bled into a team slot).
  const secLens = out.findings.find((f) => f.summary === 'SEC-LENS-MARK')
  assert.ok(secLens && secLens.by === 'lens:security', 'security lens finding attributed by:lens:security')
  // The team:data finding is attributed to team:data (NOT bled into a lens slot).
  const teamData = out.findings.find((f) => f.summary === 'TEAM-DATA-MARK')
  assert.ok(teamData && teamData.by === 'team:data', 'team finding attributed by:team:data')
  assert.strictEqual(out.mode, 'team', 'team mode')
  assert.strictEqual(out.blocking, 0, 'both findings Minor → no blocking')
})

// ── Case-insensitive .tsx extension (round-2 Important — codex) ──────────
await test('auto-derive: .TSX (uppercase ext) outside src/ → frontend lens (case-insensitive)', async () => {
  // round-2 Important: deriveLenses tested `p.endsWith(".tsx")` on the raw path, so an
  // uppercase `.TSX` (e.g. a Button.TSX outside src/) did NOT match and the frontend lens
  // was silently dropped — a frontend diff passing the final pre-merge gate with NO frontend
  // review. The fix lowercases the extension check (`lower.endsWith(".tsx")`), the same
  // coverage-cannot-shrink invariant as the security taxonomy. RED before: no frontend lens.
  for (const f of ['packages/ui/Button.TSX', 'lib/Widget.Tsx']) {
    const h = autoHarness([f])
    const wf = buildWorkflow()
    const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, null)
    assert.ok(out.lenses.includes('frontend'), `frontend lens derived for "${f}" (case-insensitive .tsx)`)
    assert.deepStrictEqual(out.lenses, ['frontend', 'codeQuality', 'completeness'], `frontend + base for "${f}"`)
    assert.ok(dispatchedLensKeys(h.calls).includes('frontend'), `frontend leg dispatched for "${f}"`)
  }
})

// ── Malformed-truthy changed-files probe → FULL set (round-2 Critical — codex) ──
await test('auto-derive: MALFORMED-truthy probe (non-array files) → FULL auto-selectable set, DEGRADED log (not base lenses)', async () => {
  // round-2 Critical: a truthy-but-malformed probe result (files is not an array — {files:"x"},
  // {files:null}, {} with no files key, or a non-array object) slipped past the `filesResult ?`
  // guard and derived from an empty list → coverage SHRANK to the two base lenses while still
  // reporting clean, silently dropping the security/amplify/frontend lenses on what might be a
  // sensitive diff. A non-array `files` must be treated as DEGRADED (full set), identical to a
  // null probe, so coverage can only grow, never shrink. RED before: out.lenses === base two.
  for (const malformed of [{ files: 'oops-not-an-array' }, { files: null }, {}, { files: { 0: 'a' } }]) {
    const h = makeHarness([
      { match: (l) => l === 'review', reply: { verdict: 'PASS', findings: [] } },
      { match: (l) => l === 'codex', reply: { source: 'codex', findings: [] } },
      { match: (l) => l === 'changed-files', reply: malformed },
      {
        match: (l) =>
          ['security', 'amplify bug-bounty', 'frontend bug-bounty', 'code quality', 'completeness critic'].includes(l),
        reply: { findings: [] },
      },
    ])
    const wf = buildWorkflow()
    const out = await wf(h.agent, h.parallel, null, h.log, h.phase, { ...baseArgs }, null, null)
    assert.deepStrictEqual(
      out.lenses,
      ['security', 'amplify', 'frontend', 'codeQuality', 'completeness'],
      `malformed probe ${JSON.stringify(malformed)} → FULL auto-selectable set (coverage cannot shrink)`,
    )
    assert.ok(h.logs.some((m) => /DEGRADED probe/i.test(m)), `malformed probe ${JSON.stringify(malformed)} logs a DEGRADED message`)
    assert.ok(
      !h.logs.some((m) => /no diff vs/i.test(m)),
      `malformed probe ${JSON.stringify(malformed)} does NOT log a no-change diff`,
    )
  }
})

// ── SKILL ↔ code security-taxonomy sync (round-2 Minor — codex) ──────────
await test('SKILL step-3 default explanation lists the BROADENED security taxonomy (no drift vs code)', async () => {
  // round-2 Minor: the deriveLenses security regex was broadened (tenant/rbac/jwt/secret/...)
  // and the Guarantees block was updated, but the step-3 default-run explanation AND the Q1
  // security pre-select hint still listed the OLD narrow auth/authz/cognito/payment/billing set
  // — doc drift that misleads an operator about what auto-derives the security lens. Assert the
  // step-3 default block AND the Q1 security hint now name the new terms. RED before the update.
  const skill = readFileSync(join(__dirname, '..', 'skills', 'dual-adversarial', 'SKILL.md'), 'utf8')
  const start = skill.indexOf('**DEFAULT (no flags)')
  const end = skill.indexOf('**`--interactive` branch.**')
  assert.ok(start !== -1 && end !== -1 && end > start, 'step-3 default block located')
  const block = skill.slice(start, end)
  for (const kw of ['tenant', 'rbac', 'jwt', 'secret', 'token']) {
    assert.ok(new RegExp(kw, 'i').test(block), `step-3 default block names the broadened security keyword "${kw}"`)
  }
  // The Q1 "Security review" pre-select hint must not still say only "auth or payments".
  const q1 = skill.slice(skill.indexOf('**Security review**'), skill.indexOf('**Code review**'))
  assert.ok(q1.length > 0, 'Q1 security option located')
  assert.ok(
    /tenant|rbac|session|jwt|secret/i.test(q1),
    'Q1 security pre-select hint broadened beyond "auth or payments"',
  )
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
