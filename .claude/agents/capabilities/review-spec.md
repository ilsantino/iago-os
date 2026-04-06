# Capability: Spec Compliance Review

Compare implementation against the plan file task by task.

## Process

- Extract every task from the plan: action, file paths, expected output
- For each task:
  - Verify specified files exist at the exact paths listed in the plan (use Glob and Read)
  - Verify the action was completed as described — not approximated
  - Verify tests exist for every new behavior introduced by the task
- Check for scope creep: list any files created or modified that are not named in the plan

## Gating Rule

If any Critical finding is discovered, stop immediately and report that finding. Do not continue to quality review.

## Finding Severity

- **Critical** — wrong behavior implemented, required functionality missing, wrong file path used
- **Important** — partial implementation, edge cases not handled, tests missing for new behavior
- **Minor** — naming deviates from plan, organization differs but behavior is correct

## Stack-Specific Checks

- Plan says "data fetching" → confirm `use()` + `<Suspense>`, not `useEffect`
- Plan says "form" → confirm React Hook Form + Zod, not uncontrolled inputs
- Plan says "component" → confirm named export, functional component, colocated test file
- Plan says "data model" → confirm single-table design with `pk`/`sk`
- Plan says "API endpoint" → confirm thin handler + separate domain module
- Plan says "environment config" → confirm env vars, not hardcoded values

## Output

List each plan task with: files verified, action implemented (yes/no/partial), stack check result, and any findings with severity. End with a verdict: pass (all Critical and Important resolved) or fail.
