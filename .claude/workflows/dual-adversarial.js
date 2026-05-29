export const meta = {
  name: 'dual-adversarial',
  description:
    'Dual-adversarial gate over a PR diff: Opus reviewer ∥ Codex (GPT-5.5) adversarial, in parallel. Read-only — reports verdict + findings, does not fix or merge. Used as post-async pass #2 before a human merge.',
  whenToUse:
    'After the async GitHub review-fix loop reports clean on a PR, run this as the final pre-merge gate. Surfaces any remaining cross-model findings for the human to decide.',
  phases: [{ title: 'Review' }, { title: 'Codex' }],
}

// args = { projectDir (required), base (required, e.g. "origin/main" or PR base branch),
//          iagoRoot, prNumber (optional, context only) }
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

const PREAMBLE = `You are a read-only adversarial reviewer (pre-merge gate, pass #2). Work in ${projectDir}. Do NOT edit files, commit, push, or merge — only review and report.`
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

const [review, codex] = await parallel([
  () => agent(reviewPrompt, { label: 'review', phase: 'Review', schema: REVIEW_SCHEMA }),
  () => agent(codexPrompt, { label: 'codex', phase: 'Codex', schema: CODEX_SCHEMA }),
])

const findings = []
let verdict = 'UNKNOWN'
let codexSource = 'unavailable'
if (review) {
  verdict = review.verdict
  for (const f of review.findings || []) findings.push({ ...f, by: 'opus' })
} else {
  log('WARNING: Opus review leg failed — pre-merge review INCOMPLETE')
  findings.push({
    severity: 'Important',
    summary:
      'Pre-merge gate INCOMPLETE: the Opus reviewer leg failed, so domain-routing + severity-floor review did not run. Do NOT merge on the Codex leg alone — re-run the gate.',
    by: 'gate',
  })
}
if (codex) {
  codexSource = codex.source
  for (const f of codex.findings || []) findings.push({ ...f, by: codex.source })
} else {
  log('WARNING: Codex leg failed — cross-model check INCOMPLETE')
  findings.push({
    severity: 'Important',
    summary:
      'Pre-merge gate INCOMPLETE: the Codex (GPT-5.5) cross-model leg failed, so there is no second-model opinion. Re-run the gate before merging.',
    by: 'gate',
  })
}

const blocking = findings.filter((f) => f.severity === 'Critical' || f.severity === 'Important')
// `clean` requires BOTH legs to have actually run AND no blocking findings — a
// half-completed review must never report clean. (The synthetic findings above
// already force blocking > 0 when a leg fails; the explicit !!review && !!codex
// guard is belt-and-suspenders.)
const clean = blocking.length === 0 && !!review && !!codex
log(`dual-adversarial #2: ${clean ? 'CLEAN' : `${blocking.length} blocking`} (opus verdict ${verdict}, codex ${codexSource}, legs: opus=${!!review} codex=${!!codex})`)

return { clean, verdict, codexSource, findings, blocking: blocking.length }
