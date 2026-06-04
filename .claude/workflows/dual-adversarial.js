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
    { title: 'Team' },
    { title: 'Verify' },
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
// When the execution pipeline DELEGATES a Tier 2/3 review to this team gate (runDualAdversarial),
// it forwards the plan's stress notes (stressBlock — a preformatted string, or '') and whether
// this run is a fix-loop re-review (isReReview). The gate then enforces the SAME stress-note
// coverage and re-review integrity check as the inline 2-leg. Absent (a standalone gate run on a
// PR diff) → both no-op and the review leg stays as before.
const stressBlock = typeof A.stressBlock === 'string' ? A.stressBlock : ''
const isReReview = A.isReReview === true
// TEAM mode adds two extra independent reviewer legs (team:data + team:arch) and an
// adversarial verification pass over Critical/Important findings. Any value other
// than the literal "team" leaves the workflow byte-for-byte in STANDARD behavior.
const mode = A.mode === 'team' ? 'team' : 'standard'
// Bound the team-mode skeptic fan-out: at most this many blocking (Critical/Important)
// findings get the 2-skeptic verification pass; the rest are kept un-verified rather than
// dropped, so the cap can only reduce work, never hide a real bug. A finding-dense plan
// would otherwise spawn 2×N skeptics per round. Caller (execute-pipeline) passes skepticCap.
const SKEPTIC_CAP_DEFAULT = 8
const skepticCap = Number.isInteger(A.skepticCap) && A.skepticCap > 0 ? A.skepticCap : SKEPTIC_CAP_DEFAULT
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
// TEAM verification: a skeptic is dispatched PER blocking finding to REFUTE it from the
// actual committed code. `real:true` = the skeptic could not refute it (the bug stands);
// `real:false` = the skeptic claims it is not a real defect, justified by `reason`.
const SKEPTIC_SCHEMA = {
  type: 'object',
  required: ['real', 'reason'],
  properties: { real: { type: 'boolean' }, reason: { type: 'string' } },
}
// Read-only tree snapshot (HEAD + porcelain) used to assert the review/verification
// legs never mutated the worktree (I1 — the gate must FAIL loudly rather than report
// clean if any leg wrote to the tree).
const SNAPSHOT_SCHEMA = {
  type: 'object',
  required: ['head', 'porcelain'],
  properties: { head: { type: 'string' }, porcelain: { type: 'string' } },
}

const PREAMBLE = `You are a read-only adversarial reviewer (pre-merge gate, pass #2). Work in ${projectDir}. Do NOT edit files, commit, push, or merge — only review and report.

OPERATING STANCE — aggressive and independent:
- Default to skepticism. Assume the change can fail in subtle, high-cost, or user-visible ways until the evidence says otherwise.
- Give NO credit for good intent, partial fixes, or likely follow-up work. Happy-path-only behavior is a real weakness — report it.
- You are ONE independent leg of a multi-model gate. Review from the diff and source ALONE; do not assume another leg will catch what you skip, and do not soften a finding because "someone else probably saw it."
- Stay grounded: every finding must be defensible from the actual code. Do not invent files, lines, code paths, or attack chains.`

const diffExpr = `git diff ${base}...HEAD`

// Re-review integrity check — injected ONLY when the pipeline forwards isReReview. Mirrors the
// inline 2-leg's re-review head so a delegated Tier 2/3 re-review still verifies every prior
// finding is resolved and that a "no test infra" excuse was not used to dodge a regression test.
const reReviewBlock = isReReview
  ? `\n\nRE-REVIEW INTEGRITY CHECK: this is a re-review after a fix round. Verify EVERY previous finding (Critical, Important, Minor) is actually resolved, and hunt for regressions the fixes introduced. If a prior fix claimed "no test infrastructure" to skip a regression test for a Critical/Important finding, verify by probing conventions — sibling *.test.ts/*.test.tsx, vitest.config.ts, package.json test scripts, test-{name}.{mjs,bats,sh} beside bash scripts, e2e/, amplify/functions/*/handler.test.ts. If infra exists that was missed, raise a NEW Important finding.`
  : ''

const reviewPrompt = `${PREAMBLE}

Final adversarial review of PR${prNumber ? ` #${prNumber}` : ''} before a human merges it. Two passes:

PASS 1 — DOMAIN ROUTING: read every review-checks module under ${iagoRoot}/scripts/review-checks/. From the diff (${diffExpr}), pick the RELEVANT domains and report them in domainsSelected. Skip the rest.

PASS 2 — ADVERSARIAL: read each changed source file IN FULL (not the diff alone). Apply the selected domains' checks plus the always-on cross-cutting set: auth bypass, data loss, race conditions, rollback safety. Honor module severity floors (ALWAYS Critical / ALWAYS Important — never downgrade).

This is the LAST gate before merge — the async GitHub loop already ran, so focus on what an automated loop misses: integration effects across modules, subtle data-correctness, concurrency, and anything the diff-only view hid.

Categorize findings Critical / Important / Minor. Verdict: PASS = none; PASS_WITH_CONCERNS = only Minor; FAIL = any Critical/Important.${reReviewBlock}${stressBlock}`

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

// TEAM mode — two extra independent reviewer legs. Same PREAMBLE + read-each-changed-
// file-in-full stance as the lenses; pinned to Opus; READ-ONLY (never edit/commit).
const TEAM_DEFS = [
  {
    key: 'team:data',
    phase: 'Team',
    focus: `DATA-CORRECTNESS team leg. Hunt: arithmetic/aggregation errors, money or float drift (rounding, cents-vs-dollars, IEEE-754 accumulation), concurrency and race conditions (TOCTOU, non-atomic read-modify-write, lost updates under concurrent actors), partial writes (a multi-step write that can leave half-committed state on failure), missing idempotency on retried/replayed operations, and unhandled empty/null/zero state (empty list, null field, first-use vs returning, zero-division). Treat any money-drift or data-loss path as Critical.`,
  },
  {
    key: 'team:arch',
    phase: 'Team',
    focus: `ARCHITECTURE / INTEGRATION team leg. Hunt: cross-module integration effects the diff-only view hides, interface/contract drift (a caller and callee that disagree on a shape, an enum/field added on one side only), rollback and migration safety (a change that cannot be safely reverted or that breaks on a half-applied migration), hidden coupling (a change here that silently depends on or breaks behavior elsewhere), and observability gaps (a new failure path with no log/metric/trace, a swallowed error). Treat a rollback-unsafe migration or a silent cross-module break as Critical.`,
  },
]

function teamPrompt(def) {
  return `${PREAMBLE}

You are an INDEPENDENT TEAM reviewer on PR${prNumber ? ` #${prNumber}` : ''}. Read each changed source file IN FULL (from ${diffExpr}), not just the diff.

${def.focus}

Honor module severity floors (ALWAYS Critical / ALWAYS Important — never downgrade). Report findings as Critical / Important / Minor, each with file + line. Return an empty findings array if this leg surfaces nothing.`
}

// TEAM verification — an adversarial skeptic dispatched to REFUTE one finding from the
// CURRENT committed code. Two skeptics run per finding with DIFFERENT angles (one argues
// exploitability/impact, one argues reachability/preconditions) so their errors are less
// correlated (I3). A skeptic returns real=false ONLY with concrete code evidence; a bare
// refute is caller-coerced to a confirm (C1). Default to real=false ONLY when the code
// genuinely disproves the finding.
function skepticPrompt(finding, angle) {
  return `${PREAMBLE}

You are an adversarial SKEPTIC verifying ONE finding from a multi-leg review of PR${prNumber ? ` #${prNumber}` : ''}. Your job is to REFUTE it — prove it is NOT a real defect in the CURRENT committed code.

Finding under test (severity ${finding.severity}, raised by ${finding.by || 'a reviewer'}):
${finding.summary}${finding.file ? `\nReported file: ${finding.file}` : ''}

ANGLE: ${angle}

Method: read the ACTUAL diff (${diffExpr}) and the relevant source files IN FULL. Determine whether the committed code actually exhibits the defect.
- Return real=false (NOT a real defect) ONLY if you can point to concrete code — a specific file:line or code path — that makes the finding wrong (the attack is impossible, the value is already guarded, the path is unreachable). Put that evidence in reason.
- Return real=true if the code confirms the defect, OR if you CANNOT confirm from the current committed code that it is wrong. DEFAULT TO real=false ONLY when the code disproves it; a finding you merely "doubt" but cannot disprove is real=true.
- A bare "I don't think this is exploitable" with no code citation is NOT a refutation — in that case return real=true.

This is READ-ONLY: do NOT edit, commit, push, or merge. Return real (boolean) and reason (your evidence).`
}

// A skeptic "refute" (real=false) only counts if it cites CONCRETE CODE evidence.
// The failure mode this guards is LLM hallucination — a confident, fluent,
// uncited claim ("this input is fully validated upstream before use"). Word-count
// is exactly the wrong proxy for that mode (a hallucination is wordy by nature),
// so a refute MUST point at code — a specific file path/extension OR an explicit
// line ref (`line 42`, `L42`, `:42`). A bare or merely verbose reason with no
// citation is NOT a refutation and is coerced to a confirm (keep the finding).
function refuteHasEvidence(reason) {
  if (!reason || typeof reason !== 'string') return false
  const r = reason.trim()
  if (r.length < 12) return false
  // Require a code citation: a file path/extension or an explicit line ref. A
  // confident-but-uncited argument (however wordy) does NOT qualify.
  const citesCode = /[\w/.-]+\.(ts|tsx|js|jsx|mjs|cjs|py|sh|json|md)\b/i.test(r) || /\b(line|L)\s*\d+|:\d+\b/i.test(r)
  return citesCode
}

// SIDE-EFFECT GUARD (I1) — this workflow is READ-ONLY. Snapshot the worktree before
// any review/verification leg runs; re-snapshot at the end and assert nothing moved.
// A leg that mutated the tree (and still reported clean) is the worst outcome, so we
// fail the gate loudly instead. Read-only itself.
async function treeSnapshot(when) {
  return withRetry(
    () =>
      agent(
        `${PREAMBLE}\n\nREAD-ONLY tree snapshot (${when}). In ${projectDir} run exactly:\n  git rev-parse HEAD\n  git status --porcelain\nReturn head (the rev-parse output, trimmed) and porcelain (the FULL git status --porcelain output, empty string if clean). Do NOT edit, stage, commit, or run anything else.`,
        { label: `side-effect-snapshot:${when}`, phase: 'Review', schema: SNAPSHOT_SCHEMA, model: 'opus' },
      ),
    `side-effect-snapshot:${when}`,
  )
}
const startSnap = await treeSnapshot('start')

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
// TEAM breadth — append the two extra independent reviewer legs AFTER the lens legs so
// the standard `results[0]`/`results[1]`/`slice(2, 2+lenses.length)` indexing is never
// disturbed. Standard mode (mode !== 'team') adds nothing here.
const teamDefs = mode === 'team' ? TEAM_DEFS : []
for (const def of teamDefs) {
  legs.push(() =>
    withRetry(() => agent(teamPrompt(def), { label: def.key, phase: def.phase, schema: LENS_SCHEMA, model: 'opus' }), def.key),
  )
}
log(
  `dual-adversarial #2 starting (${mode} mode): ${2 + lenses.length + teamDefs.length} independent legs (opus review ∥ codex${lenses.length ? ' + lenses: ' + lenses.join(', ') : ''}${teamDefs.length ? ' + team: ' + teamDefs.map((d) => d.key).join(', ') : ''})`,
)

const results = await parallel(legs)
const review = results[0]
const codex = results[1]
// Lens results occupy the slots immediately after the two core legs; team results (if
// any) occupy the slots after the lenses. Slice by COUNT, not open-ended, so team legs
// never bleed into lensResults.
const lensResults = results.slice(2, 2 + lenses.length)
const teamResults = results.slice(2 + lenses.length, 2 + lenses.length + teamDefs.length)

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
// TEAM breadth — collect the two extra reviewer legs (non-blocking like the lenses).
teamDefs.forEach((def, i) => {
  const r = teamResults[i]
  if (r) {
    for (const f of r.findings || []) findings.push({ ...f, by: def.key })
  } else {
    log(`WARNING: ${def.key} team leg failed (non-blocking)`)
    incompleteLegs.push(def.key)
  }
})

// TEAM verification (mode === 'team' only) — adversarially verify every Critical/Important
// finding BEFORE computing the blocking set. Two independent skeptics per finding try to
// REFUTE it from the actual committed code; a finding is CONFIRMED if >= 1 skeptic returns
// real=true (an evidence-backed refute is required to count against it — see refuteHasEvidence,
// C1). A finding dropped by BOTH skeptics moves to `filtered`. Minor findings are kept
// un-verified. False-negative bias is worse than dropping a real bug, so one confirm keeps it.
const filtered = []
// verificationSameFamily (T06): a STRUCTURAL fact — when the skeptic pass runs, both
// skeptics are Opus, so that verification is same-family (no cross-model diversity for it).
// verificationDegraded (T06): a real FAILURE — a skeptic that could not RUN (null return),
// so a finding went unverified on that angle. Distinct signals; do not conflate.
let verificationSameFamily = false
let verificationDegraded = false
if (mode === 'team') {
  // Bound skeptic fan-out (T05): verify at most `skepticCap` of the blocking findings, the
  // highest-priority first (Critical before Important, then longest summary as a proxy for
  // the most-detailed/most-consequential). Findings BEYOND the cap are kept as un-verified
  // blocking (never dropped) — the cap reduces verification work, never hides a real bug.
  const blockingFindings = findings.filter((f) => f.severity === 'Critical' || f.severity === 'Important')
  const sevRank = (f) => (f.severity === 'Critical' ? 0 : 1)
  const ranked = [...blockingFindings].sort(
    (a, b) => sevRank(a) - sevRank(b) || (b.summary || '').length - (a.summary || '').length,
  )
  const toVerify = ranked.slice(0, skepticCap)
  const overflow = ranked.slice(skepticCap)
  if (overflow.length) {
    log(
      `skeptic verification capped at ${skepticCap} of ${blockingFindings.length} blocking findings — ${overflow.length} kept un-verified`,
    )
  }
  const kept = []
  for (const f of toVerify) {
    // Two skeptics, DIFFERENT angles (less-correlated errors — I3). Both are Opus here, so
    // the verification pass is same-family — a structural fact, surfaced separately from a
    // run failure (T06).
    verificationSameFamily = true
    const angles = [
      'Argue EXPLOITABILITY / IMPACT: even if the code path exists, prove the impact cannot actually occur (the bad value is bounded, the write is guarded, the failure is recovered).',
      'Argue REACHABILITY / PRECONDITIONS: prove the precondition that would trigger this can never hold from any real caller / input / state in the committed code.',
    ]
    const skeptics = await parallel(
      angles.map(
        (angle, si) => () =>
          withRetry(
            () => agent(skepticPrompt(f, angle), { label: `skeptic:${si}:${f.severity}`, phase: 'Verify', schema: SKEPTIC_SCHEMA, model: 'opus' }),
            `skeptic:${si}`,
          ),
      ),
    )
    // A skeptic that failed to run (null) cannot refute — treat as a confirm (fail-safe:
    // keep the finding) AND flag the verification as DEGRADED (a real run gap, distinct
    // from same-family). real=false counts as a refute ONLY with code evidence (C1).
    if (skeptics.some((s) => !s)) verificationDegraded = true
    const refutes = skeptics.map((s) => s && s.real === false && refuteHasEvidence(s.reason))
    const confirmed = refutes.some((isRefute) => !isRefute) // >= 1 NON-refute keeps it
    if (confirmed) {
      kept.push(f)
    } else {
      // BOTH skeptics refuted WITH evidence — drop the finding for human audit.
      const reasons = skeptics.filter((s) => s && s.reason).map((s) => s.reason)
      filtered.push({ ...f, reasons })
      log(`team verification DROPPED [${f.severity}] ${f.summary} (both skeptics refuted with evidence)`)
    }
  }
  // Reported findings = confirmed (verified Critical/Important) + overflow (un-verified
  // blocking, kept by the cap) + all Minor (un-verified). Replace the findings array in
  // place so the return value and `blocking` reflect verification.
  const minor = findings.filter((f) => f.severity === 'Minor')
  findings.length = 0
  for (const f of kept) findings.push(f)
  for (const f of overflow) findings.push(f)
  for (const f of minor) findings.push(f)
}

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

// SIDE-EFFECT GUARD (I1) — re-snapshot the worktree and assert NOTHING moved since the
// start snapshot. Every leg (review / codex / lens / team / skeptic) is READ-ONLY; if any
// leg disregarded its prompt and mutated the tree, that is the worst outcome — a gate that
// reports `clean` over a dirtied worktree. Fail LOUDLY instead of returning a verdict.
// When BOTH snapshots ran and DIFFER, a leg mutated the tree → throw. If a snapshot could
// not be captured (transient agent failure), the guard is degraded, not violated: log a
// warning and skip the assertion rather than block an otherwise-clean gate.
const endSnap = await treeSnapshot('end')
if (startSnap && endSnap) {
  if (startSnap.head !== endSnap.head || startSnap.porcelain !== endSnap.porcelain) {
    throw new Error(
      `SIDE-EFFECT BREACH — a read-only review leg mutated the worktree (the gate is strictly read-only). HEAD ${startSnap.head} → ${endSnap.head}; porcelain "${(startSnap.porcelain || '').trim()}" → "${(endSnap.porcelain || '').trim()}". Inspect the tree manually; do NOT treat this run as a clean gate.`,
    )
  }
} else {
  log(
    `WARNING: side-effect guard DEGRADED — could not capture ${!startSnap ? 'start' : 'end'} tree snapshot; the read-only invariant could not be verified for this run`,
  )
}

// `verdict` reflects the Opus leg ONLY — it can read PASS while Codex surfaced a Critical.
// `clean` is the authoritative merge signal; the SKILL leads with `clean`, never `verdict`.
return {
  clean,
  mode,
  gateStatus,
  incompleteLegs,
  verdict,
  codexSource,
  crossModelDegraded,
  verificationSameFamily,
  verificationDegraded,
  filtered,
  findings,
  blocking: blocking.length,
  lenses,
}
