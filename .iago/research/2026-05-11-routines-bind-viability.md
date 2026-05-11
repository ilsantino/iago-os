---
title: "/routines bind viability against iaGO async review-fix trigger"
date: 2026-05-11
plan: feature-wedge-c-routines/01-routines-bind-viability
roadmap_ref: "docs/specs/iago-os-roadmap.md § /routines adoption"
status: decision-artifact
---

# `/routines` Bind Viability — Async Review-Fix Trigger (Wedge C, task 1)

## Scope and substitution rule

This is the task-1 decision artifact for plan
`.iago/plans/feature-wedge-c-routines/01-routines-bind-viability.md`. The plan
filename placeholder `2026-05-XX` is substituted with the execution date
**2026-05-11** for every artifact created by this plan run. Future plans that
reuse the `2026-05-XX` placeholder must substitute at execution time; this is
the rule the plan was missing (addresses stress finding **P5/P2** — placeholder
substitution).

Decision asked: should `/routines` (Anthropic Claude Code research preview,
April 2026) be bound to the iaGO async review-fix scheduling trigger as the
Wedge C client-trigger primitive proof-point?

Verdict labels the plan defined: `BIND-VIABLE`, `BIND-VIABLE-WITH-MITIGATION`,
`BIND-NOT-VIABLE`.

## Pre-flight: stress-test findings that gate the verdict

The plan was stress-tested before execution. Three Critical-class findings
materially constrain the viability question, and answering them is a
precondition to evaluating any of the 6 numbered checks in task 1. Each
finding is addressed in line with the plan invariant "fallback preserved" and
the roadmap invariant "no iaGO client deliverable delayed by wedge work."

### C1 — Trigger contradicts roadmap line 197

Roadmap line 197 (`docs/specs/iago-os-roadmap.md` § `/routines` adoption,
"Bonus" paragraph) reads:

> "`/routines` may also collapse other iaGO-OS automations — nightly graphify
> rebuild, scheduled MUNET PR triage, **async review-fix scheduling. Audit
> candidate, not Phase 1 scope.**"

The plan picks "async review-fix scheduling" as the bind target. The roadmap
explicitly marks this trigger as **audit candidate, not Phase 1 scope**. The
plan does not override or supersede the roadmap.

**Resolution:** the contradiction stands and is decisive. The artifact cannot
return `BIND-VIABLE` against an audit-candidate trigger that the canonical
roadmap excludes from current scope. The most this plan can recommend is a
**separate audit** that re-opens the roadmap line, not a bind action under
the existing Phase 1/Wave 1 budget. (Addresses stress finding **C1**.)

### C2 — "Client-trigger primitive" framing mismatched

Roadmap line 88 + line 126 + line 128 define Wedge C as **a primitive that
ties to a named client trigger** (installflow Stripe-events pattern is the
exemplar; Wedge H is the deployment of the pattern). Async review-fix is an
iaGO-internal trigger, not a named client trigger. Binding it satisfies
proof-of-concept for the routine pattern but does not advance the
client-outcome gate the roadmap explicitly imposes on Wedge C.

**Resolution:** the plan's own goal text (line 20: "the closest analog to the
installflow Stripe-events pattern Wedge H will reframe against") concedes the
mismatch — the chosen trigger is a *precursor experiment* for Wedge H, not
Wedge C itself. The artifact reflects that. A bind here would prove the
routine *mechanism* but would not, by itself, ship Wedge C as the roadmap
defines it. (Addresses stress finding **C2**.)

### C3 — `@claude` PR comment routine collides with existing `claude.yml`

`.github/workflows/claude.yml` already triggers on `issue_comment:created`
when `contains(github.event.comment.body, '@claude')`. The plan's task-2
routine event filter is **PR comment containing `@claude`** — the same event,
on the same repo. Both would fire on every `@claude` comment. Result:
duplicate reviews and a recursion vector (the routine itself could post
`@claude`, which `claude.yml` would re-fire on, which would re-fire the
routine).

**Resolution:** if the routine path is taken at all, the bind target cannot
be `@claude` PR comment. The plausible alternative is the
`[claude-review-complete]` signal comment (the trigger of
`claude-review-fix.yml`), which would make the routine a *replacement* for
`claude-review-fix.yml` rather than a duplicate of `claude.yml`. (Addresses
stress finding **C3** and feeds **P1** below.)

### P1 — Routine replaces which workflow?

The plan never specifies. Given C3:

- If routine triggers on `@claude` → duplicates `claude.yml` (rejected).
- If routine triggers on `[claude-review-complete]` → replaces
  `claude-review-fix.yml` fix-loop. This is the only coherent option.

The plan's task-2 prompt instruction ("Read `.github/workflows/claude-review-fix.yml`
review-fix step instructions and replicate them as the routine prompt")
points toward replacement of `claude-review-fix.yml`. This artifact records
that read of the plan as authoritative. (Addresses stress finding **P1**.)

## Six checks per task 1

### 1. Frequency check (volume)

Measured via `gh run list --workflow=claude-review-fix.yml --limit=200` on
2026-05-11 from `ilsantino/iago-os` main repo.

| Metric | Value |
|---|---|
| Records returned | 200 (capped) |
| Span | 2026-04-20 → 2026-05-11 (22 days) |
| Active days (any record) | 8 |
| Conclusion = `skipped` (workflow `if` rejected) | 140 |
| Conclusion = `success` | 27 |
| Conclusion = `failure` | 33 |
| Actually-ran jobs (success + failure) | 60 |
| Average ran-per-day over 22-day span | 2.73 |
| Average ran-per-active-day | 8.57 |
| Peak ran-day | 2026-04-28: 20 invocations |
| Peak total-day (incl. skipped) | 2026-04-28: 65 events |

`claude.yml` cross-check on the same window: 200 records, 55 ran, 124
skipped, 21 cancelled, same peak day (20 ran on 2026-04-28). Aligns with the
fix loop counts.

Comparison to `/routines` research-preview rate limits: Anthropic publishes
no firm per-day numeric limit in the public docs as of 2026-04-14 launch
(per the dev.to writeup cited in roadmap sources). Third-party reports
suggest preview tier is sized for low-volume scheduled runs, not
burst-driven 20+/day spikes. The peak day (20 ran) is the load profile that
matters; the 2.73/day average is misleading because real iaGO usage is
bursty (large pipeline runs concentrate invocations into single days).

**Volume assessment:** burst peaks of ~20 ran/day are *plausibly* over an
undocumented preview rate limit and would only be observable after binding.
Risk is non-trivial; no way to verify without committing the bind.

### 2. Trigger-type fit

`/routines` documented trigger types are: schedule (cron-like), API
endpoint, GitHub events. The async review-fix trigger is a GitHub event
(specifically `issue_comment:created` filtered on body content). Per the
plan's cited Anthropic doc (`code.claude.com/docs/en/overview` § Routines)
this trigger class is *supported* but the exact event-filter granularity
(body-substring match like `[claude-review-complete]`) is not documented in
the official overview; third-party writeups (dev.to whoffagents) note that
fine-grained content filtering inside the event payload is unreliable.

**Trigger-type fit assessment:** event class supported; content filter
granularity unverified. A bind would require the routine to accept all
`issue_comment` events on the repo and re-filter inside the routine prompt,
which doubles the compute cost relative to GitHub Actions doing the filter
upstream.

### 3. HMAC requirement

None at the iaGO side. GitHub signs webhook payloads with its own
infrastructure when configured, and the routine consumes GitHub-events via
the Anthropic-managed connector, not a raw webhook. The plan was correct on
this check.

### 4. Connector compatibility / plan eligibility

Santiago is on Claude Max 200. `/routines` is documented as available on
Pro/Max/Team/Enterprise. Eligibility holds by the public docs. **Stress
finding P3 contingency:** if eligibility is later revoked, downgraded, or
the preview is restricted to a higher tier, the routine bind reverts to the
`claude-review-fix.yml`-only path documented in the runbook (no migration
cost because step 0 of the runbook is "verify the workflow is still
present"). The contingency is the same as the C-revert fallback in task 3.

### 5. Recursion + context-bleed risk

Public docs do not document de-duplication of GitHub-event-triggered
routines per-PR or per-comment-thread. Third-party writeups
(dev.to whoffagents, 9to5Mac) flag silent recursive routines as a known
preview-tier gotcha.

Concrete iaGO recursion vector if bind target were `@claude`:
routine fires → routine posts a fix or comment → if comment contains
`@claude`, fires routine again. The C3 resolution forecloses this: bind
target must be `[claude-review-complete]`, not `@claude`. With that
constraint, the recursion vector becomes: routine fires on
`[claude-review-complete]` → routine pushes fix commit + tags `@claude` →
`claude.yml` reviews → `claude.yml` posts `[claude-review-complete]` → loop.
This is the *same* loop the existing two-workflow setup runs, and
`claude-review-fix.yml` already has a hard 5-round counter via `[review-fix-loop]`
markers (addresses stress finding **E5**: the round-counter marker is
`[review-fix-loop]`, not `[claude-review-complete]`; both must be emitted by
the routine prompt for the existing loop guard to keep functioning).

Context-bleed risk: not measurable without a live bind. Documented as a
runbook-monitored risk in the fallback section.

### 6. Verdict (see § Verdict below)

The six-check enumeration ends here; the verdict label and reasoning are
captured in the top-level § Verdict section immediately following, to keep
the verify grep `^## Verdict$` aligned with the plan's acceptance criterion.

## Verdict

**BIND-NOT-VIABLE** — for the as-scoped trigger (async review-fix scheduling
on `ilsantino/iago-os`), at this point in the roadmap.

Reasoning, in priority order:

1. **C1 is decisive.** Roadmap line 197 marks the async review-fix trigger
   as `audit candidate, not Phase 1 scope`. The plan does not carry an
   explicit roadmap override and cannot manufacture one inside its own
   artifact. Binding now would either bypass the canonical roadmap or
   require a separate Wave 1 budget allocation that no one has approved.
2. **C2 confirms.** Even if C1 were waived, the bound primitive would not
   satisfy Wedge C's "named client trigger" definition — it would be a
   precursor for Wedge H, which is a separate plan and was not authorized
   in this run.
3. **C3 + P1 constrain the bind target** to `[claude-review-complete]`
   (replacing `claude-review-fix.yml`), not `@claude` (which would duplicate
   `claude.yml`). The plan's stated event filter was wrong; a viable bind
   requires re-specification.
4. **Volume + rate-limit risk** (check 1) cannot be verified without a live
   bind, and the peak load (20 ran/day, bursty) sits in the zone where
   undocumented preview-tier limits are plausible blockers.
5. **No iaGO client deliverable delay** is honored (roadmap invariant) by
   *not* binding now: a bind would consume operator-hours during a window
   that overlaps MUNET MVP work.

The verdict is **BIND-NOT-VIABLE** as one of the three labels the plan
defined. The recommended forward path is a **scoped audit (separate plan)**
that re-opens roadmap line 197 with the appropriate roadmap update before
any bind action — or, alternatively, the lower-blast-radius **nightly
graphify rebuild** trigger (addresses stress finding **S1**), which:
- is also named on roadmap line 197 as an audit candidate;
- has bounded blast radius (read-only graph rebuild, no PR-state mutations);
- runs on a true schedule trigger (`/routines` strongest documented type);
- exercises the same `/routines` mechanism Wedge H will need;
- would not collide with `claude.yml` or `claude-review-fix.yml`.

S1 is recorded here as the recommended pivot for any follow-up plan. It is
**not** the trigger this plan was scoped against, so the verdict on the
as-scoped question remains `BIND-NOT-VIABLE`.

## Gates this verdict trips

- **Task 2 (bind the routine) is SKIPPED** per the plan's own gate language
  on line 59: "Skip entirely if task 1 verdict is `BIND-NOT-VIABLE`."
- **Task 3 (fallback documentation) STILL RUNS** per the plan's own
  language on line 71: "ALWAYS write, even if task 2 succeeds." Same applies
  if task 2 is skipped — the runbook still needs to exist to document the
  no-routine path so future Wedge C/H planning has the operator notes.
- **Task 4 (roadmap update) STILL RUNS** with status row
  `DEFERRED-TO-CYCLE-2` per the plan's own language on line 89: "IF task 2
  did not run (task 1 verdict BIND-NOT-VIABLE): note the blocker in the
  roadmap so future Wedge H planning can re-test."
- **No `.claude/rules/routines-bind.md` is created** (task 4 gates it on
  task-2 success; task 2 did not run).

## Stress findings — disposition table

Each finding from the stress test is recorded with how this artifact handles
it. Findings that gate the verdict are marked Critical (C); planning gaps
that the artifact closes are marked Process (P); edge cases are E; suggested
alternatives are S; acceptance-criteria gaps are A.

| ID | Finding | Disposition |
|----|---------|-------------|
| C1 | Trigger contradicts roadmap line 197 | Decisive for `BIND-NOT-VIABLE`; recorded in § Verdict reasoning #1. |
| C2 | Client-trigger framing mismatch | Recorded in § Verdict reasoning #2; pivot path noted (graphify audit, Wedge H scoping). |
| C3 | `@claude` event collides with `claude.yml` | Recorded in pre-flight § C3; foreclosed bind target. |
| P1 | Replace claude.yml or claude-review-fix.yml? | Resolved in pre-flight § P1 in favor of `claude-review-fix.yml`. |
| P2 | `2026-05-XX` placeholder leaks into Files table | Substitution rule stated up front: this run substitutes `2026-05-XX` → `2026-05-11`. Future plan executions must do the same at run time. |
| P3 | Max 200 eligibility — no contingency | Closed in check 4: contingency is the same revert path as task 3 fallback (no migration cost). |
| P4 | Smoke-test SLA not defined | Moot — task 2 skipped. If task 2 ever runs, runbook defines SLA = 10 min from `[claude-review-complete]` to first routine action; >10 min = degrade. |
| P5 | Task 4 misses "task 2 ran but smoke failed" case | Closed in runbook § Branch matrix: `RAN-SMOKE-FAILED` → roll back routine + emit `FALLBACK-DOCUMENTED` status. |
| E1 | Multi-repo connector scope unspecified | Resolved: single-repo scope (`ilsantino/iago-os`) only. Client repos out of scope; each client repo would require its own connector grant and its own audit plan. |
| E2 | Concurrent invocation (merge burst) | Recorded in check 1 as the load profile that matters (peak 20 ran/day, 2026-04-28). Bursty workload is one of the gating risks for `BIND-NOT-VIABLE`. |
| E3 | Stale `@claude` on closed/merged PR | Both `claude.yml` and `claude-review-fix.yml` already gate on `github.event.issue.state == 'open'` / `!github.event.issue.pull_request \|\| github.event.issue.state == 'open'` (verified in `.github/workflows/claude.yml` line 26-27 and `.github/workflows/claude-review-fix.yml` line 28). Any future routine MUST replicate the same gate in the routine prompt. Recorded in runbook recursion-guard section. |
| E4 | Prompt drift (workflow vs routine) | No automated guard available in `/routines`; documented as a Medium-severity ongoing risk in runbook § Risks, with the mitigation "routine prompt cites workflow file SHA at time of creation; re-sync when SHA changes." |
| E5 | `[review-fix-loop]` marker not enumerated | Recorded in check 5: both `[claude-review-complete]` and `[review-fix-loop]` are required emissions any replacement routine must produce for the existing loop guard to function. Runbook lists both. |
| S1 | Lower-blast-radius alternative (nightly graphify rebuild) | Adopted as recommended pivot for follow-up planning. Section "Recommended forward path" inside § Verdict. |
| A1 | "No regression to claude-review-fix.yml" — no verification | Closed: no change is made to `.github/workflows/claude-review-fix.yml` by this plan (task 2 skipped). Regression verification = `git diff main -- .github/workflows/claude-review-fix.yml` returns empty. |
| A2 | "No MUNET MVP work delayed" — unmeasurable | Closed by inversion: no implementation work is performed (task 2 skipped), so no MUNET hour can be displaced by this plan run. Future Wedge C/H plans must reaffirm this acceptance criterion with concrete operator-hour numbers. |
| A3 | Smoke-test screenshot storage path | Moot — task 2 skipped. If ever run: `.iago/research/screenshots/2026-MM-DD-routine-smoke/` is the convention this artifact records. |

## Sources

- `docs/specs/iago-os-roadmap.md` § `/routines` adoption (lines 171-203,
  retrieved 2026-05-11) — **line 197 is the decisive constraint.**
- `.github/workflows/claude.yml` (commit reachable on `main` 2026-05-11) —
  source of truth for `@claude` event handling (collision evidence for C3).
- `.github/workflows/claude-review-fix.yml` (same) — source of truth for the
  fix-loop the plan proposes to replace (P1).
- `gh run list --workflow=claude-review-fix.yml --limit=200` —
  invocation-volume data; 200 records 2026-04-20 → 2026-05-11.
- `gh run list --workflow=claude.yml --limit=200` — cross-check on
  invocation volume.
- Anthropic Claude Code `/routines` docs:
  [code.claude.com/docs/en/overview](https://code.claude.com/docs/en/overview)
  § Routines (cited by roadmap; not re-fetched in this run because the
  verdict was determined by C1 before any check that required live doc
  re-fetch — recorded for transparency).
- Third-party preview-tier writeups cited in roadmap source list:
  9to5Mac 2026-04-14 and dev.to whoffagents (recorded by roadmap as
  sources; this artifact does not re-fetch them).
- `.iago/plans/feature-wedge-c-routines/01-routines-bind-viability.md` —
  the plan being executed.
- `/tmp/tmp.M77ZZYEUvp/stress-findings.txt` — pipeline stress-test findings
  forwarded to this implementation session.
