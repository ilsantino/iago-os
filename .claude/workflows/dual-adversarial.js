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
//          lenses (optional — extra independent lenses: array | csv | {key:true} map.
//            ABSENT/null/undefined or the literal string "auto" → the lenses AUTO-DERIVE
//            from the changed-file paths (see deriveLenses); an explicit array (incl. [])
//            or csv/map is honored verbatim and never triggers derivation) }
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
// TEAM mode adds two extra independent reviewer legs (team:data + team:arch) and an
// adversarial verification pass over Critical/Important findings. Any value other
// than the literal "team" leaves the workflow byte-for-byte in STANDARD behavior.
const mode = A.mode === 'team' ? 'team' : 'standard'
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
// AUTO-DERIVE — the workflow vm cannot shell out (no fs/child_process in the body), so
// the changed-file list comes from a structured agent that runs `git diff --name-only`.
const CHANGED_FILES_SCHEMA = {
  type: 'object',
  required: ['files'],
  properties: { files: { type: 'array', items: { type: 'string' } } },
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

// AUTO-DERIVE the extra lenses from the changed-file paths so the DEFAULT run issues zero
// prompts. Pure + deterministic so the test harness can assert exact arrays. Emits a
// fixed-precedence, deduped order so callers/tests get a stable result. Only ever emits
// keys that exist in LENS_DEFS (the caller still re-filters through normalizeLenses for
// belt-and-suspenders). `perf`/`tests` are intentionally NOT auto-emitted — they stay
// opt-in via --interactive. A non-array or empty input returns exactly the two base lenses
// (this is the guard for "no files changed" / "changed-files agent degraded").
function deriveLenses(changedFiles) {
  // Fixed precedence so the result order is stable and assertable in tests.
  const PRECEDENCE = ['security', 'amplify', 'frontend', 'codeQuality', 'completeness']
  const matched = new Set(['codeQuality', 'completeness']) // base lenses ALWAYS included
  if (Array.isArray(changedFiles)) {
    for (const raw of changedFiles) {
      if (typeof raw !== 'string' || !raw) continue
      const p = raw.replace(/\\/g, '/') // normalize Windows separators before path checks
      const lower = p.toLowerCase()
      // amplify/** (top-level or nested) → amplify lens
      if (p.startsWith('amplify/') || p.includes('/amplify/')) matched.add('amplify')
      // src/** OR any *.tsx (even outside src/, e.g. packages/ui/Button.tsx) → frontend lens.
      // Extension check is case-INSENSITIVE (lower.endsWith) so an uppercase `.TSX`/`.Tsx` still
      // selects the frontend lens — coverage must never shrink on a case variation (same
      // invariant as the security taxonomy below).
      if (p.startsWith('src/') || p.includes('/src/') || lower.endsWith('.tsx')) matched.add('frontend')
      // any security-relevant path → security lens. Broad ON PURPOSE: a spurious
      // security-lens run is just extra cost, but a MISSED one lets a permissions /
      // tenant-isolation / authz diff pass the final pre-merge gate with NO deep security
      // review — so coverage must never SHRINK (same invariant as the degraded-probe
      // fallback). Covers auth(z) / cognito / payment / billing PLUS permission / role /
      // policy(ies) / session / jwt / oauth / login / tenant / rbac / acl / credential /
      // secret / token / password / encrypt. `\bacl\b` is word-bounded so it does not
      // match "oracle"; "polic" catches both policy and policies.
      if (
        /auth|cognito|payment|billing|permission|role|polic|session|jwt|oauth|login|tenant|rbac|\bacl\b|credential|secret|token|password|encrypt/.test(
          lower,
        )
      )
        matched.add('security')
    }
  }
  return PRECEDENCE.filter((k) => matched.has(k))
}

// The full set of lenses the AUTO path can ever select (== deriveLenses precedence). On a
// DEGRADED changed-files probe we cannot know what changed, so we fall back to ALL of these
// rather than the two base lenses — coverage must never SHRINK on probe failure (a transient
// or skipped probe on an auth/payment/amplify/frontend diff would otherwise silently drop the
// exact specialized lens that diff needs and still report clean).
const AUTO_SELECTABLE_LENSES = ['security', 'amplify', 'frontend', 'codeQuality', 'completeness']

// SIDE-EFFECT GUARD (I1) — this workflow is READ-ONLY. Snapshot the worktree BEFORE any agent
// leg runs (including the changed-files probe in the AUTO lens path below); re-snapshot at the
// end and assert nothing moved. A leg that mutated the tree (and still reported clean) is the
// worst outcome, so we fail the gate loudly instead. Read-only itself. NOTE: this MUST be
// captured before the changed-files probe — otherwise a probe that dirtied the tree would
// become the baseline and the run could still report clean.
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

// Resolve the extra lenses. THREE sources, picked in this order:
//  1. A.lenses is an Array (incl. an explicit empty []) → EXPLICIT path: honor it via
//     normalizeLenses exactly as before, no derivation, no changed-files agent. This is
//     the legacy / --interactive zero-lens path — an explicit [] must NOT auto-derive.
//  2. A.lenses is absent/null/undefined OR the literal string "auto" → AUTO path: dispatch
//     ONE structured changed-files agent and run deriveLenses over the result.
//  3. Any other non-array value (e.g. a csv string or {key:true} map) → treat as EXPLICIT
//     via normalizeLenses (back-compat with the pre-auto string/map callers).
const lensesIsAuto =
  A.lenses === undefined ||
  A.lenses === null ||
  (typeof A.lenses === 'string' && A.lenses.trim().toLowerCase() === 'auto')
let lenses
let lensesRequested
let lensesDropped = []
let lensSource
// probeDegraded is the lens-config analogue of crossModelDegraded/verificationDegraded: true when
// the changed-files probe failed or returned a malformed result and the run widened to the FULL
// auto-selectable lens set. Surfaced in the return so the operator can tell a genuine 5-lens
// sensitive diff from a degraded probe that silently widened — degradation honesty, not just a log.
let probeDegraded = false
if (Array.isArray(A.lenses) || (!lensesIsAuto && A.lenses != null)) {
  // EXPLICIT — honor the caller's lenses unchanged (array, csv, or map).
  const n = normalizeLenses(A.lenses)
  lenses = n.keys
  lensesRequested = n.requested
  lensesDropped = n.dropped
  lensSource = 'explicit'
} else {
  // AUTO — fetch changed files via a structured agent (the workflow body cannot shell out),
  // then derive. On agent failure (null) we fall back to the FULL auto-selectable lens set
  // (AUTO_SELECTABLE_LENSES, NOT the two base lenses) so coverage can only GROW, never shrink,
  // on a probe failure — a transient/skipped probe on a sensitive diff must not silently drop
  // the security/amplify/frontend lenses. Never throw. The two collapse points (a real "no
  // files changed" diff → base lenses; a degraded fetch → full set) are logged DISTINCTLY so
  // an operator can tell them apart (stress note 4).
  const filesResult = await withRetry(
    () =>
      agent(
        `${PREAMBLE}\n\nREAD-ONLY changed-files probe (for lens auto-config). In ${projectDir} run exactly:\n  git diff --name-only ${base}...HEAD\nReturn files = the list of changed paths (one per line in the git output), as an array of strings. Empty array if the diff is empty. Do NOT edit, stage, commit, or run anything else.`,
        { label: 'changed-files', phase: 'Review', schema: CHANGED_FILES_SCHEMA, model: 'opus' },
      ),
    'changed-files',
  )
  // probeOk is true ONLY when the probe returned a well-formed result with an ARRAY `files`
  // that is EITHER empty (a genuine no-change diff) OR contains ≥1 valid path string. A null
  // probe (agent failed), a truthy-but-MALFORMED result (files missing / not an array, e.g.
  // {files:"x"}, {files:null}, {}), AND a NON-EMPTY array with ZERO valid path strings (e.g.
  // [null], [''], [{}], [null,'',{}]) are ALL degraded: we do NOT know what changed. Deriving
  // from such input would silently shrink coverage to the two base lenses — dropping
  // security/amplify/frontend on a sensitive diff while still reporting clean (deriveLenses
  // skips every non-string/empty element, so an all-garbage array looks identical to []). Treat
  // all three as DEGRADED and fall back CONSERVATIVELY to every auto-selectable lens, so coverage
  // can only ever grow (never shrink) on probe failure. A successful probe (incl. a genuine EMPTY
  // diff) still derives precisely.
  const probeWellFormed = !!(filesResult && Array.isArray(filesResult.files))
  const rawFiles = probeWellFormed ? filesResult.files : []
  // An all-invalid NON-EMPTY array is garbage masquerading as a well-formed probe — distinct from
  // a genuinely empty ([]) no-change diff, which stays a precise (base-lens) derivation.
  const allInvalidArray = rawFiles.length > 0 && !rawFiles.some((f) => typeof f === 'string' && f)
  const probeOk = probeWellFormed && !allInvalidArray
  const changedFiles = probeOk ? rawFiles : []
  const derived = probeOk ? deriveLenses(changedFiles) : AUTO_SELECTABLE_LENSES
  // Re-filter through normalizeLenses so an unknown key can never reach the dispatch loop
  // (deriveLenses / AUTO_SELECTABLE_LENSES already constrain to LENS_DEFS keys; belt-and-suspenders).
  const n = normalizeLenses(derived)
  lenses = n.keys
  lensesRequested = n.requested
  lensesDropped = n.dropped
  lensSource = 'auto'
  if (!probeOk) {
    // Probe FAILED (null) or returned a MALFORMED result (non-array files) — degraded either way.
    // Run the FULL auto-selectable lens set (not just the base two) so a transient/skipped/garbled
    // probe on a sensitive diff cannot strip the specialized lenses. Flagged distinctly from a
    // genuine no-change diff so an operator can tell them apart.
    log(
      `WARNING: changed-files probe failed, returned a malformed result, or returned only invalid/empty path entries — cannot determine changed paths (DEGRADED probe — not a confirmed no-change diff); falling back to the FULL auto-selectable lens set so coverage does not shrink: [${lenses.join(', ')}]`,
    )
    probeDegraded = true
  } else if (changedFiles.length === 0) {
    // Agent SUCCEEDED but returned no files — a real no-change diff vs base. Distinct log.
    log(`changed-files probe returned 0 files (no diff vs ${base}); auto-deriving base lenses [${lenses.join(', ')}]`)
  } else {
    log(`auto-derived lenses from ${changedFiles.length} changed file(s): [${lenses.join(', ')}]`)
  }
}
// Fail-loud on SKILL/workflow lens-key drift: an unrecognized lens key would otherwise
// be silently dropped and the operator would believe the lens ran. (deriveLenses can never
// produce drift, so this fires only on the EXPLICIT path.)
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

// NOTE: treeSnapshot + the `startSnap` capture were moved ABOVE the lens-resolution block
// (just after deriveLenses) so the start snapshot is taken BEFORE the changed-files probe
// runs — a probe that dirtied the tree must not become the read-only baseline. See there.

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
  `dual-adversarial #2 starting (${mode} mode, lenses ${lensSource}): ${2 + lenses.length + teamDefs.length} independent legs (opus review ∥ codex${lenses.length ? ' + lenses: ' + lenses.join(', ') : ''}${teamDefs.length ? ' + team: ' + teamDefs.map((d) => d.key).join(', ') : ''})`,
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
let verificationDegraded = false
if (mode === 'team') {
  const toVerify = findings.filter((f) => f.severity === 'Critical' || f.severity === 'Important')
  const kept = []
  for (const f of toVerify) {
    // Two skeptics, DIFFERENT angles (less-correlated errors — I3). Both are Opus here,
    // so verification is same-family (DEGRADED, like crossModelDegraded). Surface it.
    verificationDegraded = true
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
    // keep the finding). real=false counts as a refute ONLY with code evidence (C1).
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
  // Reported findings = confirmed (Critical/Important) + all Minor (un-verified). Replace
  // the findings array in place so the return value and `blocking` reflect verification.
  const minor = findings.filter((f) => f.severity === 'Minor')
  findings.length = 0
  for (const f of kept) findings.push(f)
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
  verificationDegraded,
  filtered,
  findings,
  blocking: blocking.length,
  lenses,
  lensSource,
  probeDegraded,
}
