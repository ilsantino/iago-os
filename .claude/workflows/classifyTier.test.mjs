#!/usr/bin/env node
// Unit tests for the deterministic risk-tier classifier + a DRIFT GUARD.
//
// No test framework is installed at the repo root (validate-workflows.mjs is
// compile-only), so this is a plain node:assert harness — same style as
// dual-adversarial.test.mjs.
//
// Run:  node .claude/workflows/classifyTier.test.mjs
//
// classify-tier.mjs is the unit-tested TWIN of the inline copy that actually runs inside
// execute-pipeline.js (the workflow body cannot `import`, so the running copy must be
// inlined). The final test asserts the two copies have not drifted in LOGIC.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { classifyTier } from './classify-tier.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`PASS  ${name}`)
  } catch (e) {
    failed++
    console.error(`FAIL  ${name}\n      ${e && e.message ? e.message : e}`)
  }
}

// ── Behavioral cases ────────────────────────────────────────────────────
test('empty plan → Tier 1 (fail-closed, never Tier 0)', () => {
  assert.strictEqual(classifyTier(''), 1)
})

test('non-string input → Tier 1', () => {
  assert.strictEqual(classifyTier(undefined), 1)
  assert.strictEqual(classifyTier(null), 1)
})

test('1 task + 2 files + no risk keywords → Tier 0', () => {
  const plan = `# Plan
### Task T01 — small tweak
- **files:** src/foo.ts, src/bar.ts
Adjust a label. No risky words here.`
  assert.strictEqual(classifyTier(plan), 0)
})

test('"auth" anywhere in prose → Tier 3 (security)', () => {
  const plan = `# Plan
### Task T01
Add an auth check to the handler.`
  assert.strictEqual(classifyTier(plan), 3)
})

test('a tier-2 keyword ("rollback") with 2 tasks → Tier 2', () => {
  const plan = `# Plan
### Task T01
### Task T02
Ensure rollback safety on partial writes.`
  assert.strictEqual(classifyTier(plan), 2)
})

test('>8 tasks with no keywords → Tier 2', () => {
  const plan = `# Plan
${Array.from({ length: 9 }, (_, i) => `### Task T${i + 1}\nsome work`).join('\n')}`
  assert.strictEqual(classifyTier(plan), 2)
})

test('prose with NO "### Task" headings → Tier 1 (parse failure)', () => {
  const plan = `# Plan
Just a narrative description with no task headings and no risk words.`
  assert.strictEqual(classifyTier(plan), 1)
})

test('2 tasks but 4 files (over the Tier 0 file ceiling) → Tier 1', () => {
  const plan = `# Plan
### Task T01
- **files:** a.ts, b.ts
### Task T02
- **files:** c.ts, d.ts`
  assert.strictEqual(classifyTier(plan), 1)
})

test('tier-3 keyword dominates a tier-2 keyword (payment + migration → Tier 3)', () => {
  const plan = `# Plan
### Task T01
A schema migration touching the payment table.`
  assert.strictEqual(classifyTier(plan), 3)
})

test('9 tasks in the repo `### T0N —` convention (no "Task" word) → Tier 2', () => {
  // The repo (incl. #89's own plan quick-260530-pipeline-risk-tiering.md) writes task
  // headings as `### T01 —`, `### T02 —`, ... with NO literal "Task" word. The original
  // /^\s*###\s+Task/ regex missed these entirely → a 9-task keyword-free plan classified
  // Tier 1 (thin inline 2-leg) instead of Tier 2 (team), silently skipping the >8-task
  // escalation — the exact under-review this feature exists to prevent. RED before the
  // broadened /^\s*###\s+T(?:ask|\d)/ regex (returns 1); GREEN after (returns 2).
  const plan = `# Plan
${Array.from({ length: 9 }, (_, i) => `### T0${i + 1} — task ${i + 1}\nsome work`).join('\n')}`
  assert.strictEqual(classifyTier(plan), 2)
})

test('broadened regex does NOT over-count `### Tier`/`### Testing`/`### Technical` as tasks', () => {
  // Precision guard for the broadened regex: it must accept `### T01` but NOT spuriously
  // match other T-words (a digit or "ask" must follow the T). Here 3 decoy T-headings +
  // 2 real `### T0N` tasks → only the 2 tasks count → 2 tasks, ≤3 files, no keywords → Tier 0.
  // If the broadening over-matched, taskCount would be 5 and the tier would shift.
  const plan = `# Plan
### Tier 2 notes
### Testing strategy
### Technical approach
### T01 — first
- **files:** a.ts
### T02 — second
- **files:** b.ts`
  assert.strictEqual(classifyTier(plan), 0)
})

// ── Drift guard: the inline copy in execute-pipeline.js must match this module ──
test('inline classifyTier in execute-pipeline.js has not drifted from the twin', () => {
  const extract = (src) => {
    const fn = src.match(/function classifyTier\(planText\) \{[\s\S]*?\n\}/)
    const t3 = src.match(/const TIER3_KEYWORDS = \[[^\]]*\]/)
    const t2 = src.match(/const TIER2_KEYWORDS = \[[^\]]*\]/)
    assert.ok(fn && t3 && t2, 'could not locate classifyTier + keyword consts')
    // Compare LOGIC only: strip line comments, normalize whitespace.
    return `${t3[0]}\n${t2[0]}\n${fn[0]}`.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim()
  }
  const twin = extract(readFileSync(join(__dirname, 'classify-tier.mjs'), 'utf8'))
  const inline = extract(readFileSync(join(__dirname, 'execute-pipeline.js'), 'utf8'))
  assert.strictEqual(inline, twin, 'execute-pipeline.js inline classifyTier drifted from classify-tier.mjs — edit BOTH in lockstep')
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
