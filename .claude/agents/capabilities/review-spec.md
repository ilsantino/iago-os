# Capability: Spec Compliance Review

Compare implementation against the plan, task by task: files exist at the exact paths named, action done as described (not approximated), tests exist for each new behavior. List scope creep — files created/modified but not named in the plan.

Severity: **Critical** = wrong behavior, missing required functionality, wrong file path. **Important** = partial implementation, unhandled edge cases, tests missing for new behavior. **Minor** = naming/organization deviates but behavior correct.

Gating: on any Critical finding, stop immediately and report it — do not continue to quality review.

Output: per task — files verified, implemented (yes/no/partial), findings with severity. Verdict: pass | fail.
