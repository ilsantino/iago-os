---
name: code-review
description: >-
  Use when implementation is complete and needs review before merge.
  Not when still implementing (finish first) or when reviewing as part of
  /iago:execute or /subagent-driven-development (those dispatch review internally).
---

<!-- Source: Superpowers requesting-code-review + receiving-code-review + ECC code-reviewer -->

## Purpose

Dispatch the `code-reviewer` agent against a git diff to produce a structured
review with severity-categorized findings. Ensures code quality, security, and
spec compliance before merge.

## Arguments

`/code-review` — review uncommitted changes or last commit.

Optional arguments:
- `{sha-range}` — specific commit range (e.g., `abc1234..def5678`)
- `--full` — two-stage review (spec-reviewer + code-quality-reviewer)
- `--against {branch}` — diff against a branch instead of HEAD~1

## Steps

### 1. Determine diff scope

Priority:
1. If `{sha-range}` provided → use that range
2. If `--against {branch}` → diff current branch vs target
3. If uncommitted changes exist → review those
4. Otherwise → review last commit (`HEAD~1..HEAD`)

Generate the diff: `git diff {range}`.

### 2. Dispatch code-reviewer

**Single-pass (default):**

Dispatch `code-reviewer` agent (Sonnet) with:
- The git diff
- CLAUDE.md
- Relevant plan file (if identifiable from branch name or recent context)

The reviewer checks:
- **Security:** OWASP Top 10, AWS-specific (IAM permissions, DynamoDB injection,
  Cognito token handling, SES abuse)
- **Correctness:** Logic errors, missing error handling at system boundaries,
  race conditions
- **Stack compliance:** React 19 patterns, DynamoDB single-table design,
  Lambda thin handlers, TypeScript strict
- **YAGNI:** Code not required by the plan or spec

**Two-stage (`--full` flag):**

1. Dispatch `spec-reviewer` — does the implementation match the spec/plan?
2. Dispatch `code-quality-reviewer` — React/DynamoDB/Lambda pattern compliance

### 3. Categorize findings

Each finding gets a severity:

| Severity | Definition | Action Required |
|----------|-----------|----------------|
| **Critical** | Security vulnerability, data loss risk, broken functionality | Must fix before merge |
| **Important** | Performance issue, maintainability concern, missing tests | Should fix, discuss if not |
| **Minor** | Style, naming, documentation, minor optimization | Log only, optional fix |

### 4. Apply anti-bias rules

- **Anti-performative-agreement:** Do not accept "LGTM" without evidence.
  Every "no issues found" must cite what was checked.
- **YAGNI check:** Flag any code that isn't required by the task. Extra
  abstractions, premature optimization, speculative features = Important finding.
- **Self-review bias:** If reviewing your own code (same session), explicitly
  state this and increase scrutiny.

### 5. Present findings

Display structured review:

```
## Review: {scope description}

### Critical (N)
- [{file}:{line}] {finding} — {recommendation}

### Important (N)
- [{file}:{line}] {finding} — {recommendation}

### Minor (N)
- [{file}:{line}] {finding} — {recommendation}

### Verdict: {PASS | PASS_WITH_CONCERNS | FAIL}
```

**PASS:** 0 Critical, 0 Important.
**PASS_WITH_CONCERNS:** 0 Critical, 1+ Important.
**FAIL:** 1+ Critical.

## Output

1. Finding count by severity
2. Verdict (PASS / PASS_WITH_CONCERNS / FAIL)
3. If FAIL: list Critical findings with fix suggestions
4. If PASS_WITH_CONCERNS: list Important findings for user decision

## Boundaries

- Read-only — does not modify code, does not fix findings
- Does not commit or merge — that's the user's or workflow's decision
- Does not re-run tests — verification is separate (`/iago:verify`)
- Single dispatch by default — do not chain multiple review rounds unless `--full`
- If code-reviewer returns BLOCKED, report and suggest manual review
