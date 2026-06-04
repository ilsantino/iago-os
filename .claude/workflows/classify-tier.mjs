// Deterministic risk-tier classifier for the execution pipeline (60/30/10 rule-based
// layer — ZERO LLM). Reads a plan's TEXT and assigns a review-depth tier. Plans are
// prose, not structured path fields, so keywords are matched case-insensitively as
// substrings across the WHOLE text (a Cognito-auth change that mentions "auth" in a
// sentence must tier up even with no `**files:**` bullet naming it).
//
//   Tier 0 Fast    — <=2 tasks AND <=3 files AND no risk keywords (informational)
//   Tier 1 Normal  — default (2-leg Opus + Codex, today's behavior)
//   Tier 2 Complex — >8 tasks OR any tier-2 keyword (+ team mode)
//   Tier 3 Security— any tier-3 keyword (Tier 2 + maxFixRounds=3)
//
// Any parse failure (no `### Task` headings found at all) errs to Tier 1 — never Tier 0 —
// so an unparseable plan still gets the full 2-leg gate.
//
// ─── SYNC CONTRACT ───────────────────────────────────────────────────────────────────
// execute-pipeline.js inlines a BYTE-IDENTICAL copy of `classifyTier` + the two keyword
// consts below (it cannot `import` this module — the harness runs the workflow body in a
// vm wrapper that rejects both static `import` and runtime dynamic `import()`). The copy
// in the body is the one that actually runs; THIS module is the unit-tested twin. The
// colocated test classifyTier.test.mjs asserts the two copies have not drifted, so a
// silent divergence fails CI rather than shipping. Edit BOTH in lockstep.
export const TIER3_KEYWORDS = ['auth', 'cognito', 'oauth', 'payment', 'iam', 'jwt', 'allow.owner', 'webhook']
export const TIER2_KEYWORDS = ['amplify', 'functions/', 'schema', 'gsi', 'ttl', 'migration', 'rollback']
export function classifyTier(planText) {
  const text = typeof planText === 'string' ? planText : ''
  const lower = text.toLowerCase()
  // (1) taskCount — count `### Task` / `### T<n>` headings (line-anchored, leading ws OK).
  // Accept both the `### Task N` form and the repo's `### T01 —` / `### T0N` convention; a
  // digit or "ask" must follow the T so `### Tier`/`### Testing` are NOT counted as tasks.
  const taskMatches = text.match(/^\s*###\s+T(?:ask|\d)/gim)
  const taskCount = taskMatches ? taskMatches.length : 0
  // Parse failure: no task headings at all → fail closed to Tier 1 (never Tier 0).
  if (taskCount === 0) return 1
  // (2) fileCount — unique paths across all `- **files:**` bullets (comma/space-separated).
  const files = new Set()
  const fileBullets = text.match(/^\s*-\s*\*\*files:\*\*\s*(.+)$/gim) || []
  for (const bullet of fileBullets) {
    const body = bullet.replace(/^\s*-\s*\*\*files:\*\*\s*/i, '')
    for (const raw of body.split(/[,\s]+/)) {
      const p = raw.trim().replace(/[`'"]/g, '')
      if (p) files.add(p)
    }
  }
  const fileCount = files.size
  // (3) keyword scan across the FULL text (case-insensitive substring).
  const hasTier3 = TIER3_KEYWORDS.some((k) => lower.includes(k))
  const hasTier2 = TIER2_KEYWORDS.some((k) => lower.includes(k))
  // (4) classify.
  if (hasTier3) return 3
  if (hasTier2 || taskCount > 8) return 2
  if (taskCount <= 2 && fileCount <= 3 && !hasTier3 && !hasTier2) return 0
  return 1
}
