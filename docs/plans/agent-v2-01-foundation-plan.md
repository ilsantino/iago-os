# Plan: Agent v2 — Foundation (Capability Modules + Base Agents)

## Source
Spec: docs/specs/agent-architecture-v2.md (Phases 1-2)

## Wave 1: Capability Modules

All modules are independent — extract domain knowledge from existing agents into self-contained prompt fragments (200-400 tokens each). Modules are additive, never contradict each other, never reference other modules.

### Task 1: Create react-19 and forms capability modules
- **files:** `.claude/agents/capabilities/react-19.md`, `.claude/agents/capabilities/forms.md`
- **action:** Extract React 19 patterns from `.claude/agents/implementer.md` (lines 40-53: use() + Suspense, ShadCN install/customize, TanStack Query keys + mutations, error boundaries, useTransition, useOptimistic, ref as prop) into `react-19.md`. Extract form patterns (lines 70-73: React Hook Form + Zod, Controller for ShadCN, server errors → setError) into `forms.md`. Each module must be self-contained, 200-400 tokens, provide instructions only (no prohibitions).
- **verify:** `test -f .claude/agents/capabilities/react-19.md && test -f .claude/agents/capabilities/forms.md && echo "OK"`
- **expected:** `OK`

### Task 2: Create dynamodb and lambda capability modules
- **files:** `.claude/agents/capabilities/dynamodb.md`, `.claude/agents/capabilities/lambda.md`
- **action:** Extract DynamoDB patterns from `.claude/agents/implementer.md` (lines 57-62: single-table pk/sk, DocumentClient typed helpers, batch limits, TTL, GSI) and `.claude/agents/data-modeler.md` (access-pattern-driven design, max 5 GSIs, example items) into `dynamodb.md`. Extract Lambda patterns from implementer (lines 64-68: thin handler, domain modules, ESM, cold start, env vars) into `lambda.md`. Self-contained, 200-400 tokens each.
- **verify:** `test -f .claude/agents/capabilities/dynamodb.md && test -f .claude/agents/capabilities/lambda.md && echo "OK"`
- **expected:** `OK`

### Task 3: Create cognito and tdd capability modules
- **files:** `.claude/agents/capabilities/cognito.md`, `.claude/agents/capabilities/tdd.md`
- **action:** Extract Cognito patterns from `.claude/rules/aws-amplify.md` (JWT in API Gateway authorizer, user pools, custom attributes, pre-signup triggers, token refresh) into `cognito.md`. Extract TDD patterns from `.claude/agents/tdd-guide.md` and `.claude/rules/tdd.md` (RED-GREEN-REFACTOR cycle, rationalization prevention table, 80% coverage per feature, test file placement, skip policy) into `tdd.md`. The `tdd.md` module should be ~400 tokens — it's the largest because it includes the rationalization prevention rules.
- **verify:** `test -f .claude/agents/capabilities/cognito.md && test -f .claude/agents/capabilities/tdd.md && echo "OK"`
- **expected:** `OK`

### Task 4: Create security and e2e capability modules
- **files:** `.claude/agents/capabilities/security.md`, `.claude/agents/capabilities/e2e.md`
- **action:** Extract security checklist from `.claude/agents/code-reviewer.md` (lines 36-57: OWASP + AWS checklist — no hardcoded secrets, Cognito JWT in authorizer, no cross-tenant DynamoDB, no dangerouslySetInnerHTML, Zod validation, no wildcard CORS, no leaked internals, React checks, TypeScript checks) into `security.md`. Extract E2E patterns from `.claude/agents/e2e-runner.md` and `.claude/rules/e2e-testing.md` (Playwright selectors priority, no CSS/XPath, storageState for auth, no waitForTimeout, Suspense boundary waits, Page Object Model) into `e2e.md`.
- **verify:** `test -f .claude/agents/capabilities/security.md && test -f .claude/agents/capabilities/e2e.md && echo "OK"`
- **expected:** `OK`

### Task 5: Create review-spec and review-quality capability modules
- **files:** `.claude/agents/capabilities/review-spec.md`, `.claude/agents/capabilities/review-quality.md`
- **action:** Extract spec review checklist from `.claude/agents/spec-reviewer.md` (compare against plan tasks, verify file paths match, verify actions completed, verify tests exist for new behavior, gating logic: if any Critical finding → stop and report without continuing to quality) into `review-spec.md`. Extract quality review checklist from `.claude/agents/code-quality-reviewer.md` (performance: unnecessary re-renders, N+1 queries; security: OWASP; maintainability: naming, complexity, duplication; React/DynamoDB/Lambda specific checks) into `review-quality.md`.
- **verify:** `test -f .claude/agents/capabilities/review-spec.md && test -f .claude/agents/capabilities/review-quality.md && echo "OK"`
- **expected:** `OK`

### Task 6: Create content and infra capability modules
- **files:** `.claude/agents/capabilities/content.md`, `.claude/agents/capabilities/infra.md`
- **action:** Extract content writing patterns from `.claude/agents/content-writer.md` (article structure, tone matching from PROJECT.md, citation rules, client brand voice, draft-ready output, factual claims sourced, no placeholders) into `content.md`. Extract infra patterns from `.claude/agents/infra-runner.md` and `.claude/rules/aws-amplify.md` (AWS CLI patterns, Amplify Gen 2 defineBackend/defineAuth/defineData/defineFunction, CDK constructs, SES v2, --dry-run first for destructive ops, confirm before production changes) into `infra.md`.
- **verify:** `test -f .claude/agents/capabilities/content.md && test -f .claude/agents/capabilities/infra.md && echo "OK"`
- **expected:** `OK`

## Wave 2: Base Agents

Depend on Wave 1 (understanding capability module structure). Each base agent has minimal prompt — tool contract, escalation protocol, output format, anti-patterns. Domain intelligence comes from capabilities.

### Task 7: Create executor base agent
- **files:** `.claude/agents/executor.md`
- **action:** Create the executor base agent. Frontmatter: `name: executor`, `model: sonnet` (overridden per dispatch), `tools: [Read, Glob, Grep, Edit, Write, Bash, Notebook]`, `maxTurns: 25`. Prompt: tool usage contract (search before creating, verify after writing), escalation protocol (DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED with definitions), output format template (files changed, verification output, TypeScript clean, Biome clean, tests, status), anti-patterns list (no `any`, no `export default`, no `useEffect` for data, no hardcoded secrets, no `process.env.VITE_*`, no class components except error boundaries), instruction to follow capability instructions and task plan exactly.
- **verify:** `grep -q "executor" .claude/agents/executor.md && grep -q "DONE" .claude/agents/executor.md && echo "OK"`
- **expected:** `OK`

### Task 8: Create analyst base agent
- **files:** `.claude/agents/analyst.md`
- **action:** Create the analyst base agent. Frontmatter: `name: analyst`, `model: sonnet` (overridden per dispatch), `tools: [Read, Glob, Grep, Bash]`, `maxTurns: 15`. Prompt: read-only contract ("never edit source files — all findings must be explicit in the output"), escalation protocol (same 4 statuses), output format template (findings by severity: Critical/Important/Minor, diagnostics: TypeScript + Biome results, verdict: approve/request-changes, summary with file count and finding counts), instruction to rate all findings by severity based on capability instructions.
- **verify:** `grep -q "analyst" .claude/agents/analyst.md && grep -q "read-only" .claude/agents/analyst.md && echo "OK"`
- **expected:** `OK`

### Task 9: Create operator base agent
- **files:** `.claude/agents/operator.md`
- **action:** Create the operator base agent. Frontmatter: `name: operator`, `model: sonnet` (overridden per dispatch), `tools: [Read, Glob, Grep, Bash, WebSearch, WebFetch]`, `maxTurns: 20`. Prompt: external access contract (cite sources with file:line or URL, cross-reference multiple sources, distinguish facts from inferences), escalation protocol (same 4 statuses), output format template (findings, sources, recommendation with trade-offs), safety rules (--dry-run before destructive infra ops, confirm before production changes, never hardcode credentials).
- **verify:** `grep -q "operator" .claude/agents/operator.md && grep -q "WebSearch" .claude/agents/operator.md && echo "OK"`
- **expected:** `OK`

## Verification
```bash
ls .claude/agents/capabilities/*.md | wc -l  # Should be 12
ls .claude/agents/executor.md .claude/agents/analyst.md .claude/agents/operator.md  # Should list all 3
```
