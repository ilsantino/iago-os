export const meta = {
  name: 'dual-adversarial',
  description:
    'Dual-adversarial gate over a PR diff: Opus 4.8 reviewer ∥ Codex (GPT-5.5) adversarial, in parallel and fully independent. Optional extra independent lenses (security / code-quality / test-coverage / completeness). Read-only — reports verdict + findings, does not fix or merge. Used as post-async pass #2 before a human merge.',
  whenToUse:
    'After the async GitHub review-fix loop reports clean on a PR, run this as the final pre-merge gate. Surfaces any remaining cross-model findings for the human to decide.',
  phases: [
    { title: 'Review' },
    { title: 'Codex' },
    { title: 'Security' },
    { title: 'Code quality' },
    { title: 'Tests' },
    { title: 'Completeness' },
    { title: 'Frontend' },
    { title: 'Amplify' },
    { title: 'Performance' },
  ],
}

// Retry a read-only agent call. Transient API errors (e.g. "thinking blocks cannot be modified"
// 400s) and null returns (user skipped mid-run) are both retried.
async function withRetry(fn, label, tries = 2) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      const result = await fn()
      if (result !== null) return result
      lastErr = new Error(`${label}: agent was skipped`)
    } catch (e) {
      lastErr = e
    }
    if (i < tries - 1) log(`${label} attempt ${i + 1}/${tries} failed: ${String(lastErr).slice(0, 200)}, retrying`)
  }
  return null
}

// args = { projectDir (required), base (required, e.g. "origin/main" or PR base branch),
//          iagoRoot (required), prNumber (optional, context only),
//          lenses (optional — extra independent lenses: array | csv | {key:true} map) }
// args may arrive parsed OR as a JSON string in this harness build — normalize.
function parseArgs(a) {
  if (a == null) return {}
  if (typeof a === 'object') return a
  if (typeof a === 'string') {
    if (!a.trim()) return {}
    try {
      return JSON.parse(a)
    } catch (e) {
      throw new Error('Workflow args is a string but not valid JSON: ' + String(e))
    }
  }
  return {}
}
const A = parseArgs(args)
const projectDir = A.projectDir
const base = A.base || 'origin/main'
const iagoRoot = A.iagoRoot // no personal-path default — fail loud (resolves review-checks)
const prNumber = A.prNumber || ''
if (!projectDir || !iagoRoot) {
  throw new Error('dual-adversarial requires args.projectDir and args.iagoRoot (absolute paths)')
}

const FINDING = {
  type: 'object',
  required: ['severity', 'summary'],
  properties: {
    severity: { type: 'string', enum: ['Critical', 'Important', 'Minor'] },
    summary: { type: 'string' },
    file: { type: 'string' },
  },
}
const REVIEW_SCHEMA = {
  type: 'object',
  required: ['verdict', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'PASS_WITH_CONCERNS', 'FAIL'] },
    domainsSelected: { type: 'array', items: { type: 'string' } },
    findings: { type: 'array', items: FINDING },
  },
}
const CODEX_SCHEMA = {
  type: 'object',
  required: ['source', 'findings'],
  properties: {
    source: { type: 'string', enum: ['codex', 'claude-fallback'] },
    findings: { type: 'array', items: FINDING },
  },
}
const LENS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: { findings: { type: 'array', items: FINDING } },
}

const PREAMBLE = `You are a read-only adversarial reviewer (pre-merge gate, pass #2). Work in ${projectDir}. Do NOT edit files, commit, push, or merge — only review and report.

OPERATING STANCE — aggressive and independent:
- Default to skepticism. Assume the change can fail in subtle, high-cost, or user-visible ways until the evidence says otherwise.
- Give NO credit for good intent, partial fixes, or likely follow-up work. Happy-path-only behavior is a real weakness — report it.
- You are ONE independent leg of a multi-model gate. Review from the diff and source ALONE; do not assume another leg will catch what you skip, and do not soften a finding because "someone else probably saw it."
- Stay grounded: every finding must be defensible from the actual code. Do not invent files, lines, code paths, or attack chains.`

const diffExpr = `git diff ${base}...HEAD`

const reviewPrompt = `${PREAMBLE}

Final adversarial review of PR${prNumber ? ` #${prNumber}` : ''} before a human merges it. Two passes:

PASS 1 — DOMAIN ROUTING: read every review-checks module under ${iagoRoot}/scripts/review-checks/. From the diff (${diffExpr}), pick the RELEVANT domains and report them in domainsSelected. Skip the rest.

PASS 2 — ADVERSARIAL: read each changed source file IN FULL (not the diff alone). Apply the selected domains' checks plus the always-on cross-cutting set: auth bypass, data loss, race conditions, rollback safety. Honor module severity floors (ALWAYS Critical / ALWAYS Important — never downgrade).

This is the LAST gate before merge — the async GitHub loop already ran, so focus on what an automated loop misses: integration effects across modules, subtle data-correctness, concurrency, and anything the diff-only view hid.

Categorize findings Critical / Important / Minor. Verdict: PASS = none; PASS_WITH_CONCERNS = only Minor; FAIL = any Critical/Important.`

const codexPrompt = `${PREAMBLE}

You are the CROSS-MODEL leg — prefer Codex (GPT-5.5) so the second opinion is from a different model family.
1. Resolve the codex-companion path: try $HOME/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs, else the highest-version $HOME/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs.
2. If node + companion exist, run in ${projectDir}: node "<companion>" adversarial-review --cwd "${projectDir}" --base "${base}" --wait
   Map [P0]/[high]→Critical, [P1]/[medium]→Important, [P2]/[low]→Minor. source="codex".
   GUARD: if it reports "no changed files" but ${diffExpr} --name-only is non-empty, treat as misfire and fall through.
3. FALLBACK: review it yourself — read the diff (${diffExpr}) and each changed file in full; check auth bypass, data loss, races, rollback safety, business logic. source="claude-fallback".
Return findings (empty if clean) and source.`

// Optional extra independent lenses. Each runs as its own fresh parallel subagent
// (no cross-priming) and is pinned to Opus. A lens leg failure is NON-blocking
// (Minor) — only the two core legs failing blocks the gate.
const LENS_DEFS = {
  security: {
    phase: 'Security',
    title: 'security',
    focus: `SECURITY lens (same depth as /security-review). Hunt: auth/authz bypass, broken tenant isolation, injection (SQL/NoSQL/command/prompt), secret leakage, weak or missing crypto, IAM over-permissioning, SSRF, insecure deserialization, missing server-side input validation. Read the security + amplify modules under ${iagoRoot}/scripts/review-checks/ and apply them. Treat any auth bypass or data-exposure gap as Critical.`,
  },
  codeQuality: {
    phase: 'Code quality',
    title: 'code quality',
    focus: `CODE-QUALITY lens (same depth as /code-review). Hunt: dead or duplicated code, excessive complexity, leaky abstractions, swallowed errors, unhandled edge cases, and violations of the repo's standards (no \`any\`/\`as\`, named exports only, thin Lambda handlers, no ORMs). Apply the quality modules under ${iagoRoot}/scripts/review-checks/.`,
  },
  tests: {
    phase: 'Tests',
    title: 'test coverage',
    focus: `TEST-COVERAGE lens. For each RISKY changed path, determine whether a regression test exists that FAILS without the change and PASSES with it. Locate tests by convention (colocated *.test.ts, e2e/, test-*.{mjs,sh,bats}). Report every risky path with no covering test as an Important finding — Critical if it is an auth or data-loss path.`,
  },
  completeness: {
    phase: 'Completeness',
    title: 'completeness critic',
    focus: `COMPLETENESS-CRITIC meta-lens. Assume the other legs missed something. Ask: which changed file did no one read in full? which cross-module integration effect is unverified? which claim in the PR/plan is asserted but not proven by code or a test? which failure mode (timeout, partial write, retry, concurrent actor, empty/null state) is unhandled? Surface each gap as a finding at the severity the underlying risk warrants.`,
  },
  frontend: {
    phase: 'Frontend',
    title: 'frontend bug-bounty',
    focus: `FRONTEND BUG-BOUNTY lens — apply the /frontend-bug-bounty rule set (read ${iagoRoot}/.claude/skills/frontend-bug-bounty/ in full, including its references/, for the complete checklist). On the changed src/**/*.ts(x): React 19 hook misuse, stale closures, missing effect cleanup, race conditions, list/key bugs, TypeScript type-drift, Vite misconfig, Tailwind v4 CSS-first pitfalls, AND Section-Q data-correctness — paginated KPIs that silently drop pages, NaN aggregates, money/float drift, a tenant filter missing on an aggregate. Treat any data-correctness or money-drift bug as Critical.`,
  },
  amplify: {
    phase: 'Amplify',
    title: 'amplify bug-bounty',
    focus: `AMPLIFY BUG-BOUNTY lens — apply the /amplify-bug-bounty rule set (read ${iagoRoot}/.claude/skills/amplify-bug-bounty/ in full for the complete checklist). On the changed amplify/** : CloudFormation dependency cycles, AppSync/authorization-rule holes (an empty model authorization falls back to default-open), multi-tenancy leaks (owner/group not enforced), IAM over-grants, Cognito misconfig (token lifetimes, triggers), S3 access. Treat any auth bypass or cross-tenant read/write as Critical.`,
  },
  perf: {
    phase: 'Performance',
    title: 'performance & cost',
    focus: `PERFORMANCE & COST lens (AWS-aware). DynamoDB: N+1 access patterns, hot partitions, unbounded Scan, missing pagination, redundant GSIs. Lambda: cold-start / bundle bloat, heavy top-level imports, await-in-loop, fire-and-forget (un-awaited async) work that gets abandoned. Frontend: oversized bundles, unmemoized heavy renders, fetch waterfalls. Flag anything that scales badly or silently burns cost, and cite the access pattern or call site.`,
  },
}
function normalizeLenses(l) {
  if (!l) return { keys: [], requested: 0, dropped: [] }
  let raw = []
  if (Array.isArray(l)) raw = l
  else if (typeof l === 'string') raw = l.split(',').map((s) => s.trim())
  else if (typeof l === 'object') raw = Object.keys(l).filter((k) => l[k])
  raw = raw.filter((k) => k)
  const keys = raw.filter((k) => Object.prototype.hasOwnProperty.call(LENS_DEFS, k))
  const dropped = raw.filter((k) => !Object.prototype.hasOwnProperty.call(LENS_DEFS, k))
  return { keys, requested: raw.length, dropped }
}
const { keys: lenses, requested: lensesRequested, dropped: lensesDropped } = normalizeLenses(A.lenses)
// Fail-loud on SKILL/workflow lens-key drift: an unrecognized lens key would otherwise
// be silently dropped and the operator would believe the lens ran.
if (lensesDropped.length) {
  log(
    `WARNING: lens drift — requested ${lensesRequested}, recognized ${lenses.length}; dropped unknown keys [${lensesDropped.join(', ')}] (not in LENS_DEFS — check SKILL/workflow sync)`,
  )
}

function lensPrompt(def) {
  return `${PREAMBLE}

You are an INDEPENDENT extra lens on PR${prNumber ? ` #${prNumber}` : ''}. Read each changed source file IN FULL (from ${diffExpr}), not just the diff.

${def.focus}

Honor module severity floors (ALWAYS Critical / ALWAYS Important — never downgrade). Report findings as Critical / Important / Minor, each with file + line. Return an empty findings array if this lens surfaces nothing.`
}

const legs = [
  () => withRetry(() => agent(reviewPrompt, { label: 'review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'opus' }), 'review'),
  () => withRetry(() => agent(codexPrompt, { label: 'codex', phase: 'Codex', schema: CODEX_SCHEMA }), 'codex'),
]
for (const key of lenses) {
  const def = LENS_DEFS[key]
  legs.push(() =>
    withRetry(() => agent(lensPrompt(def), { label: def.title, phase: def.phase, schema: LENS_SCHEMA, model: 'opus' }), def.title),
  )
}
log(`dual-adversarial #2 starting: ${2 + lenses.length} independent legs (opus review ∥ codex${lenses.length ? ' + lenses: ' + lenses.join(', ') : ''})`)

const results = await parallel(legs)
const review = results[0]
const codex = results[1]
const lensResults = results.slice(2)

const findings = []
let verdict = 'UNKNOWN'
let codexSource = 'unavailable'
// gateStatus is the STRUCTURED routing signal, separate from `findings`. A leg that
// FAILED TO RUN is an "INCOMPLETE gate → re-run" condition, NOT a fixable code defect —
// it must never be mis-routed to /iago-prfix. `incompleteLegs` enumerates the failed
// core legs so the orchestrator can act on a field, not parse a free-text summary.
const incompleteLegs = []
if (review) {
  verdict = review.verdict
  for (const f of review.findings || []) findings.push({ ...f, by: 'opus' })
} else {
  log('WARNING: Opus review leg failed — pre-merge review INCOMPLETE')
  incompleteLegs.push('opus-review')
}
if (codex) {
  codexSource = codex.source
  for (const f of codex.findings || []) findings.push({ ...f, by: codex.source })
} else {
  log('WARNING: Codex leg failed — cross-model check INCOMPLETE')
  incompleteLegs.push('codex')
}
lenses.forEach((key, i) => {
  const r = lensResults[i]
  if (r) {
    for (const f of r.findings || []) findings.push({ ...f, by: `lens:${key}` })
  } else {
    log(`WARNING: ${key} lens leg failed (non-blocking)`)
    incompleteLegs.push(`lens:${key}`)
  }
})

const blocking = findings.filter((f) => f.severity === 'Critical' || f.severity === 'Important')
// A core leg (Opus review / Codex) that failed to run makes the gate INCOMPLETE — this is
// a RE-RUN condition, distinct from `blocking` (fixable code findings). Track it as a
// structured status so the orchestrator routes "re-run the gate" vs "fix findings"
// correctly and never sends an incomplete-gate signal to /iago-prfix.
const coreIncomplete = !review || !codex
const gateStatus = coreIncomplete ? 'INCOMPLETE' : 'COMPLETE'
// `clean` requires BOTH core legs to have actually run AND no blocking findings — a
// half-completed review must never report clean. Extra lens failures are non-blocking
// by design; only the two core legs are load-bearing for `clean`.
const clean = gateStatus === 'COMPLETE' && blocking.length === 0
// The Codex leg fell back to the SAME Claude family — the cross-model GPT-5.5 guarantee
// silently degraded to two same-family passes. Surface it so the human gate can re-run.
const crossModelDegraded = codexSource === 'claude-fallback'
log(
  `dual-adversarial #2: ${clean ? 'CLEAN' : gateStatus === 'INCOMPLETE' ? `INCOMPLETE (re-run; failed legs: ${incompleteLegs.join(', ')})` : `${blocking.length} blocking`} (opus verdict ${verdict}, codex ${codexSource}${crossModelDegraded ? ' [DEGRADED — no GPT-5.5 cross-model]' : ''}, legs: opus=${!!review} codex=${!!codex}, lenses=[${lenses.join(',')}])`,
)

// `verdict` reflects the Opus leg ONLY — it can read PASS while Codex surfaced a Critical.
// `clean` is the authoritative merge signal; the SKILL leads with `clean`, never `verdict`.
return {
  clean,
  gateStatus,
  incompleteLegs,
  verdict,
  codexSource,
  crossModelDegraded,
  findings,
  blocking: blocking.length,
  lenses,
}
