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

// ── Broadened TIER3 keyword set (#gate-hardening plan 01) ───────────────
test('broadened keyword: "rbac permission" → Tier 3', () => {
  const plan = `# Plan
### Task T01
Add rbac permission checks to the resolver.`
  assert.strictEqual(classifyTier(plan), 3)
})

test('broadened keyword: "credential" → Tier 3', () => {
  const plan = `# Plan
### Task T01
Rotate the stored credential on expiry.`
  assert.strictEqual(classifyTier(plan), 3)
})

test('broadened keyword: "tenant isolation" → Tier 3', () => {
  const plan = `# Plan
### Task T01
Enforce tenant isolation on the aggregate query.`
  assert.strictEqual(classifyTier(plan), 3)
})

test('accepted safe over-tier: "author"/"role"/"sql"/"secret" substrings escalate to Tier 3 (documented, not a bug)', () => {
  // 'auth' is a substring of 'author', and 'role'/'sql'/'secret' are now explicit Tier-3
  // keywords, so prose like "the author", "the team's role", a "nosql" note, or "secretary"
  // escalates to Tier 3. This is an ACCEPTED safe over-tier under the keyword-only (no
  // word-boundary) approach — over-review costs time, never correctness. Plan 01 Task 1
  // intentionally kept the substring scan; documenting the known over-match here.
  assert.strictEqual(classifyTier(`# Plan\n### Task T01\nThe author of this doc.`), 3) // author ⊃ auth
  assert.strictEqual(classifyTier(`# Plan\n### Task T01\nClarify the team's role here.`), 3) // role
  assert.strictEqual(classifyTier(`# Plan\n### Task T01\nA nosql data store note.`), 3) // nosql ⊃ sql
})

// ── tier_override seam (#gate-hardening plan 01, clamped to [1,3]) ───────
test('tier_override:1 wins over a Tier-3 "auth" keyword (override → Tier 1)', () => {
  const plan = `---
tier_override: 1
---
# Plan
### Task T01
Add an auth check to the handler.`
  // Override is passed explicitly (the orchestration block parses it from frontmatter).
  assert.strictEqual(classifyTier(plan, { tier_override: 1 }), 1)
  // Without the override the same plan is Tier 3.
  assert.strictEqual(classifyTier(plan), 3)
})

test('tier_override:0 is IGNORED (clamped out of [1,3]) — keyword tier wins', () => {
  // The Critical the stress test caught: tier_override:0 must NOT be honored, or it would
  // void the EOF-sentinel + headings fail-safes in the pipeline. The function-body guard
  // requires the override be in [1,3]; a 0 falls through to the keyword classification.
  const plan = `# Plan
### Task T01
Add an auth check.`
  assert.strictEqual(classifyTier(plan, { tier_override: 0 }), 3)
})

test('tier_override:4 (out of range) is IGNORED — keyword tier wins', () => {
  const plan = `# Plan
### Task T01
Add an auth check.`
  assert.strictEqual(classifyTier(plan, { tier_override: 4 }), 3)
})

// ── fileCount regex accepts all attested file-bullet formats (#gate-hardening plan 01) ──
test('two "**File:** x" bullets (no dash, capital F, singular) → Tier 0', () => {
  // The canonical `**File:** path` format (no leading dash, singular, capital F) was missed
  // by the old `^\s*-\s*\*\*files:\*\*` regex — these files went uncounted. The broadened
  // regex counts them: 2 files, 2 tasks, no keywords → Tier 0.
  const plan = `# Plan
### Task T01
**File:** a.ts
### Task T02
**File:** b.ts`
  assert.strictEqual(classifyTier(plan), 0)
})

test('four "**File:** x" bullets → Tier 1 (file ceiling blocks Tier 0)', () => {
  const plan = `# Plan
### Task T01
**File:** a.ts
**File:** b.ts
### Task T02
**File:** c.ts
**File:** d.ts`
  assert.strictEqual(classifyTier(plan), 1)
})

// ── Drift guard: the inline copy in execute-pipeline.js must match this module ──
test('inline classifyTier in execute-pipeline.js has not drifted from the twin', () => {
  const extract = (src) => {
    // Anchored to the `// END classifyTier` sentinel (present in BOTH copies) so a stray
    // column-0 `}` mid-function cannot silently truncate the extraction and let a drifted
    // body compare equal. The signature is matched loosely (planText[^)]*) so the
    // `, overrides = {}` parameter — added in lockstep to both copies — is captured rather
    // than breaking the locate.
    const fn = src.match(/function classifyTier\(planText[^)]*\) \{[\s\S]*?\n\}\s*\/\/ END classifyTier/)
    const t3 = src.match(/const TIER3_KEYWORDS = \[[^\]]*\]/)
    const t2 = src.match(/const TIER2_KEYWORDS = \[[^\]]*\]/)
    assert.ok(fn && t3 && t2, 'could not locate classifyTier + keyword consts (or the // END classifyTier sentinel is missing from a copy)')
    // Compare LOGIC only: strip line comments, normalize whitespace.
    return `${t3[0]}\n${t2[0]}\n${fn[0]}`.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim()
  }
  const twin = extract(readFileSync(join(__dirname, 'classify-tier.mjs'), 'utf8'))
  const inline = extract(readFileSync(join(__dirname, 'execute-pipeline.js'), 'utf8'))
  assert.strictEqual(inline, twin, 'execute-pipeline.js inline classifyTier drifted from classify-tier.mjs — edit BOTH in lockstep')
})

// ── Sentinel anchor catches mid-function truncation (plan 04 M1) ─────────
test('drift-guard regex: the // END classifyTier anchor defeats a mid-function truncation', () => {
  // Plan 04 M1: anchoring extract() to `// END classifyTier` means a stray column-0 `}`
  // mid-function can no longer silently truncate BOTH extractions equally (which would let a
  // drifted body pass the equality check). Proven on a synthetic source: the anchored regex
  // must extend PAST a stray brace to the sentinel; the OLD unanchored regex stops at it.
  const mutated =
    'function classifyTier(planText, overrides = {}) {\n  const x = 1\n}\n  const y = 2\n  return x\n}\n// END classifyTier'
  const anchored = /function classifyTier\(planText[^)]*\) \{[\s\S]*?\n\}\s*\/\/ END classifyTier/
  const m = mutated.match(anchored)
  assert.ok(m, 'anchored regex still locates the function')
  assert.ok(/const y = 2/.test(m[0]), 'extraction extends PAST a stray column-0 brace to the sentinel (no silent truncation)')
  // Control: the old unanchored regex truncates at the FIRST column-0 brace, dropping `const y`.
  const old = /function classifyTier\(planText[^)]*\) \{[\s\S]*?\n\}/
  const mo = mutated.match(old)
  assert.ok(mo && !/const y = 2/.test(mo[0]), 'control: the unanchored regex truncates at the stray brace')
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
