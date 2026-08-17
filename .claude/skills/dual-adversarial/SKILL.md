---
name: dual-adversarial
description: Final pre-merge dual-adversarial gate over a PR/branch diff — Opus reviewer ∥ Codex GPT-5.5, independent + aggressive; lenses auto-derive from changed paths. Team depth adds a diverse-persona panel + skeptic verification of every Critical/Important finding. Optional fix flow commits fixes and re-runs the gate. Read-only; NEVER merges. Use as the final gate before a human merges.
---

# /dual-adversarial

Final cross-model adversarial gate before merge. Two **independent** legs run in
parallel — an **Opus 4.8** reviewer and a **Codex (GPT-5.5)** reviewer — neither
sees the other's output; their findings are merged only after both finish.
Optionally adds extra independent lenses, an optional **Team** depth (diverse-persona
panel + adversarial verification that drops false-positive findings), and an optional
**Fix** flow (resolve verified findings, commit to the branch, re-gate).
**Read-only by default; the Fix flow commits to the branch but NEVER pushes or merges.
Santiago merges.**

## When to use
- After the async GitHub review-fix loop reports clean on a PR (pass #2 pre-merge gate).
- Any time you want a hard, aggressive, cross-model second opinion on a committed diff.

## Do NOT use when
- You want to drive the async GitHub @claude review-fix loop on a PR — that is `/iago-prfix`. This skill is the in-session pre-merge gate; its opt-in Fix flow (Q4) is a local commit-and-re-gate, not a PR review loop.
- You want the change pushed or the PR merged — this skill never pushes or merges (the Fix flow commits locally only).
- There is no committed diff to review (the Codex leg only sees committed history — commit first).

## Steps (orchestrator)

1. **Resolve the target.**
   - If invoked with a PR number, set `prNumber` and `base` to that PR's base branch (default `origin/main`).
   - Otherwise review the current branch: `base = origin/main`, `prNumber = ""`.
   - `projectDir` = repo root; `iagoRoot` = repo root (resolves `scripts/review-checks/`).

2. **Size the diff.** Run `git diff --shortstat <base>...HEAD`. If empty AND no PR number, tell the user there is nothing to review and stop.

3. **Run the gate (DEFAULT = zero prompts).** The default run issues NO questions: it
   auto-derives the extra lenses from the diff, runs **Team** depth (the final pre-merge
   gate always runs Team), and is **report-only**. Two flags change this:
   - `--interactive` → restore the original four-question flow (see "Interactive branch" below).
   - `--fix` → after the gate, resolve the verified-KEPT blocking findings (see step 5).

   **DEFAULT (no flags).** Invoke the Workflow once, with `lenses` OMITTED so it
   auto-derives from the changed-file paths, `mode: "team"`, and report-only:
   ```
   Workflow({ scriptPath: "<IAGO_ROOT>/.claude/workflows/dual-adversarial.js",  // IAGO_ROOT = repo root, same value as the iagoRoot arg below
              args: { projectDir, iagoRoot, base, prNumber, mode: "team" } })
   ```
   With `lenses` absent (or the literal string `"auto"`), the Workflow derives the extra
   lenses from the diff: `amplify/**` → `amplify`; `src/**` or any `*.tsx` (case-insensitive) →
   `frontend`; any security-relevant path
   (`auth`/`authz`/`cognito`/`payment`/`billing`/`permission`/`role`/`policy`/`session`/`jwt`/`oauth`/`login`/`tenant`/`rbac`/`acl`/`credential`/`secret`/`token`/`password`/`encrypt`)
   → `security`; plus `codeQuality` and `completeness` ALWAYS. `perf` and `tests` are NOT
   auto-derived — add them via `--interactive`. Then go to step 4.

   **`--interactive` branch.** Call `AskUserQuestion` ONCE with FOUR questions (the tool
   allows up to 4 questions, each with ≤4 options). Q1 and Q2 are `multiSelect: true`; Q3
   and Q4 are single-select. The two adversarial core legs (Opus 4.8 ∥ Codex GPT-5.5)
   ALWAYS run — Q1/Q2 only add extra **independent** lenses on top. Collect the selected
   keys from Q1 and Q2 into one `lenses` array, capture Q3 as `mode`, and capture Q4 as the
   post-findings action, all for step 4 / step 5.

   **Question 1 — "Extra review lenses"** (`multiSelect: true`):
   - **Security review** (`security`) — auth/authz bypass, injection, secret leakage, crypto, tenant isolation, IAM. Same depth as `/security-review`. *Pre-select when the diff touches auth/authz, payments, permissions/roles/policies, tenancy/RBAC, sessions/JWT/OAuth, or secrets/tokens/credentials.*
   - **Code review** (`codeQuality`) — quality, maintainability, dead/duplicated code, complexity, repo standards. Same depth as `/code-review`.
   - **Test-coverage audit** (`tests`) — do the risky changed paths have a regression test that fails without the change and passes with it? Missing coverage → Important (Critical on auth/data-loss paths).
   - **Completeness critic** (`completeness`) — meta-leg: "what did the other legs miss?" (a file no one read in full, an unverified cross-module effect, an unproven claim, an unhandled failure mode).

   **Question 2 — "Deep bug-bounty lenses"** (`multiSelect: true`):
   - **Frontend bug-bounty** (`frontend`) — React 19 hooks/races/effects, TS type-drift, Vite/Tailwind pitfalls + Section-Q data-correctness (paginated KPIs, NaN aggregates, money drift, tenant-filter on aggregates). Same rules as `/frontend-bug-bounty`. *Pre-select when the diff touches `src/**`.*
   - **Amplify bug-bounty** (`amplify`) — CFN cycles, AppSync/authorization holes, multi-tenancy leaks, IAM over-grants, Cognito/S3. Same rules as `/amplify-bug-bounty`. *Pre-select when the diff touches `amplify/**`.*
   - **Performance & cost** (`perf`) — DynamoDB N+1 / hot-partition / Scan / pagination, Lambda cold-start / await-in-loop / fire-and-forget, frontend bundle / render / fetch-waterfall.

   **Question 3 — "Review depth"** (single-select). Map the choice to the `mode` arg:
   - **Standard** → `mode = "standard"` — Opus ∥ Codex core legs plus any lenses from Q1/Q2. The current behavior.
   - **Team (recommended for high-stakes merges)** → `mode = "team"` — adds 2 diverse-persona reviewers AND adversarially verifies every Critical/Important finding with 2 independent skeptics each, dropping any finding both skeptics refute as a false positive before it can block or be fixed.

   **Question 4 — "After findings"** (single-select):
   - **Report only (read-only)** — DEFAULT — surface findings for the human; never touch the branch.
   - **Fix verified findings** — run the fix workflow on the confirmed (verified-KEPT) blocking findings, commit the fixes to the branch, then re-run the gate. **Never merges.**

   In the `--interactive` branch, run the Workflow with the collected answers:
   ```
   Workflow({ scriptPath: "<IAGO_ROOT>/.claude/workflows/dual-adversarial.js",
              args: { projectDir, iagoRoot, base, prNumber, mode: "<standard|team from Q3>", lenses: [<selected lens keys>] } })
   ```
   Lens keys: `"security"`, `"codeQuality"`, `"tests"`, `"completeness"`, `"frontend"`, `"amplify"`, `"perf"`. Merge the selected keys from Q1 and Q2 into one `lenses` array. Pass `lenses: []` if none selected (an explicit `[]` runs ZERO extra lenses — it does NOT auto-derive; only an ABSENT `lenses` or `"auto"` triggers derivation). Pass `mode: "standard"` if Q3 was not answered. Then go to step 4.

4. **Read the gate result.** Whichever branch (default or `--interactive`) ran the Workflow, it returns the result object consumed by steps 5 and 6.

5. **Resolve** (only if `--fix` was passed OR `--interactive` Q4 = "Fix verified findings", AND `blocking > 0`). The default run is report-only — skip this step entirely unless `--fix`/Q4-fix applies. Forward ONLY the gate's Team-confirmed (KEPT) blocking findings — the `findings` array the gate returned, filtered to `severity` Critical/Important (Team mode already dropped both-refuted false positives into `filtered`; never pass `filtered` findings to the fixer, and never re-derive findings from the raw legs — only the verified-KEPT set goes forward). Invoke the fix Workflow on them:
   ```
   Workflow({ scriptPath: "<IAGO_ROOT>/.claude/workflows/dual-adversarial-fix.js",
              args: { projectDir, iagoRoot, base, findings: <the gate's confirmed blocking findings from step 3> } })
   ```
   Then **RE-RUN the dual-adversarial gate ONCE** (re-invoke the step-3 Workflow with the SAME `mode`/`lenses` it ran with — for a default run that is `mode: "team"` and `lenses` omitted) to confirm the fixes resolved the findings without regression.

   **Carry a suppress-list across cycles.** On a 2nd cycle, do NOT re-forward a finding the previous cycle already resolved, nor any finding Team verification dropped into `filtered` (that the re-gate may re-raise). Before the cycle-2 fix call, build a suppress-list = {every finding sent to the cycle-1 fixer} ∪ {every `filtered` finding from cycle-1's gate AND cycle-1's re-gate}, matching on `summary` + `file`. Forward to the cycle-2 fixer ONLY the re-gate's confirmed-KEPT blocking findings that are NOT in the suppress-list. A finding that keeps re-surfacing despite a prior fix is a manual-review signal, not a re-fix target.

   **The fix→re-gate cycle cap of 2 is enforced HERE, by you, the orchestrator — NOT by either Workflow** (each Workflow invocation does exactly one pass; neither holds cycle state). Track the cycle count explicitly: cycle 1 = first fix + re-gate; cycle 2 = second fix + re-gate (only if cycle 1's re-gate still reported `blocking > 0`). **After 2 completed cycles, STOP unconditionally** — do not invoke the fix Workflow a third time even if `blocking > 0`; report the residual findings for manual review. **NEVER run `gh pr merge` — Santiago merges.** If the run is report-only (no `--fix` and `--interactive` Q4 = "Report only") or `blocking === 0`, skip this step entirely.

6. **Report.** The Workflow returns `{ clean, mode, gateStatus, incompleteLegs, verdict, codexSource, crossModelDegraded, verificationSameFamily, verificationDegraded, filtered, findings, backlog, blocking, lenses, lensSource, probeDegraded }`. **`findings` is Critical/Important ONLY — every Minor is in `backlog`.** ALWAYS surface `backlog`: list each entry with its severity, `by:` leg, file and summary, stated as "reported, not fixed in this loop". These are real findings that were deliberately routed out of the fix loop, not discarded — omitting them from the report is the one way this routing turns into silent deletion. Note that a pre-existing (not-introduced-by-this-diff) defect is reported the same way, prefixed `pre-existing:` — never suppressed. **Lead with `clean` — it is the authoritative merge signal. Do NOT lead with `verdict`:** `verdict` reflects the Opus leg ONLY, so it can read `PASS` while the Codex leg surfaced a Critical (in that case `clean` is `false` and `blocking > 0`). State the `mode` used (`standard` or `team`). If `filtered` is non-empty (Team mode only), report how many false-positive findings the Team verification dropped AND list each dropped finding with its skeptic `reasons` — a dropped finding is the one audit trail the human has at the merge decision, so surface it, never silently omit it. If `verificationSameFamily === true` (Team mode, the verification pass ran), add the caveat that the skeptics were same-family Opus (not a true cross-model verification), exactly as you would for `crossModelDegraded`. If `verificationDegraded === true` (Team mode — a skeptic could NOT run), add the STRONGER caveat that a blocking finding could not be adversarially verified at all (a real verification gap, not merely same-family) and re-run the gate. If `probeDegraded === true` (auto-lens runs only), add the caveat that the changed-files probe failed or returned a malformed result, so the run widened to the FULL auto-selectable lens set (`lenses`) as a degraded fallback rather than a precise per-path derivation (`lensSource` is `auto`) — the extra lens coverage is defensive breadth, not a signal that those specific domains changed. Route on `clean` first, then `gateStatus`:
   - **`gateStatus === 'INCOMPLETE'`** (a core leg failed — see `incompleteLegs`) → the gate did NOT complete. Tell Santiago the gate is incomplete and **re-run the Workflow**. Do NOT offer `/iago-prfix` — a failed leg is not a fixable code defect, and `/iago-prfix` will not run the missing leg. An `incompleteLegs` entry ending in `:no-proof` (`opus-review:no-proof`, `codex:no-proof`) is the same class of failure with a different shape: the leg *returned*, but returned no findings and no proof of work, so it reviewed nothing. Report it as "the leg produced nothing — unreviewed, not clean" and re-run.
   - **`clean === true`** → tell Santiago it is safe to merge. If `crossModelDegraded === true` (codexSource is `claude-fallback`), add a caveat: the cross-model GPT-5.5 leg fell back to a same-family Claude pass, so there was no true cross-model coverage — re-run the gate if a hard GPT-5.5 second opinion is required before merge.
   - **`clean === false` AND `gateStatus === 'COMPLETE'`** (`blocking > 0`) → surface findings grouped by severity. If `--fix` (or `--interactive` Q4 = "Fix verified findings") was set, step 5 already ran the fix→re-gate cycle (report its outcome); otherwise (the report-only default) offer `--fix` or `/iago-prfix` to fix. **Never run `gh pr merge` — Santiago merges.**

## Guarantees
- **Auto-config by default.** The default run issues ZERO prompts: the extra lenses
  auto-derive from the changed-file paths — `amplify/**` → `amplify`; `src/**` OR any
  `*.tsx` (even outside `src/`) → `frontend`; any security-relevant path
  (`auth`/`authz`/`cognito`/`payment`/`billing`/`permission`/`role`/`policy`/`session`/`jwt`/`oauth`/`login`/`tenant`/`rbac`/`acl`/`credential`/`secret`/`token`/`password`/`encrypt`)
  → `security`; plus `codeQuality` and `completeness` ALWAYS. `perf` and `tests` are
  never auto-derived (opt in via `--interactive`). Default depth is **Team** and default
  action is **report-only**. An explicit `lenses` array (including an empty `[]` for zero
  extra lenses) or `--interactive` overrides the derivation entirely — only an absent
  `lenses` or the literal string `"auto"` triggers it. The two probe-degradation points are
  handled DIFFERENTLY on purpose: a successful probe that returns a genuine **empty diff** →
  the two base lenses; a **failed fetch** (the probe agent errored) → the FULL auto-selectable
  lens set (`security`+`amplify`+`frontend`+`codeQuality`+`completeness`), so coverage can only
  GROW, never shrink, on a probe failure. Neither path ever throws.
- **Independent.** The Opus and Codex legs (and every extra lens) run as separate fresh subagents inside one `parallel()` call — no leg is primed with another's findings; results are merged only after all legs finish.
- **Aggressive, and bounded.** Every leg defaults to skepticism and treats happy-path-only behavior as a real weakness — but each leg reports **what it verified**, not only what it found. Every leg returns `propertiesChecked`: the properties it evaluated, each `HOLDS` or `VIOLATED` with file:line evidence. A property that HOLDS is a real result, so a clean leg carries auditable proof-of-work instead of silence.
- **A leg that produces nothing FAILS the gate.** A core leg returning an empty `findings` array AND no proof of work is treated as unreviewed, not clean: `gateStatus` becomes `INCOMPLETE` (`incompleteLegs` gets `opus-review:no-proof` / `codex:no-proof`) and `clean` cannot be true. This closes the PR #78 hole where the Codex leg wrote nothing at all and the gate reported fine. The `source: "codex"` leg is the one carve-out — it maps codex-companion's free text rather than verifying properties itself, so its required `evidence` string (command run + what it reported) is its proof-of-work. A `claude-fallback` run is a Claude review and must fill `propertiesChecked` like any other.
- **Every finding carries a failure scenario.** `failureScenario` is required on every finding: concrete inputs/state → the wrong output or crash. A finding without one is a worry, not a finding. The Team skeptics receive it and refute against it.
- **Minor findings are reported, not fixed in-loop.** Minors are partitioned into `backlog` and never enter a fix round; `findings` and `blocking` carry Critical/Important only. `clean` is computed exactly as before. A defect this diff did not introduce is likewise reported at its true severity and routed to `backlog` — the gate never suppresses a finding at emission time (see `.claude/rules/execution-pipeline.md`). The Report step must surface `backlog`, or the routing becomes silent deletion.
- **Model-pinned.** The reviewer leg is pinned to Opus (`model: 'opus'` = Opus 4.8); the cross-model leg uses Codex GPT-5.5 via `codex-companion.mjs` (model pinned in `~/.codex/config.toml`). A core leg that fails forces `clean = false` AND `gateStatus = 'INCOMPLETE'` (a re-run condition, not a `/iago-prfix` finding — see the Report step); a failed extra lens is non-blocking (logged, not blocking).
- **Cross-model honesty.** If the Codex leg falls back to a same-family Claude pass, `codexSource` is `claude-fallback` and `crossModelDegraded` is `true` — the gate can still report `clean` but with no true GPT-5.5 coverage. The Report step requires surfacing this caveat to the human at the merge decision.
- **Team mode filters false positives.** In `mode: "team"`, every Critical/Important finding is adversarially verified by 2 independent skeptics before it can block or be fixed; a finding is dropped as a false positive ONLY when BOTH skeptics refute it WITH a concrete code citation (a confident-but-uncited refute does not count — it is treated as a confirm, so the finding is kept). A single confirm keeps the finding (false-negative bias is worse than dropping a real bug). Dropped findings are recorded in `filtered` with their skeptic `reasons` and surfaced at the merge decision (Report step) — never silently discarded. Verification runs BEFORE anything blocks or is fixed — a dropped finding never reaches the fix flow.
- **Verification honesty.** The Team skeptics are same-family Opus, not a true cross-model verification. Two DISTINCT signals surface this (T06 split the old single flag): when the verification pass RAN (Team mode, ≥1 blocking finding), `verificationSameFamily` is `true` — a STRUCTURAL fact, the verification analogue of `crossModelDegraded` (both skeptics are Opus, so there is no cross-model diversity for the verification). Separately, when a skeptic could NOT run (a null return left a blocking finding un-refuted), `verificationDegraded` is `true` — a REAL run gap (the finding was kept fail-safe but never actually verified), distinct from same-family. The Report step surfaces both to the human at the merge decision.
- **Fix mode commits but NEVER pushes or merges.** The Fix flow (`--fix`, or `--interactive` Q4 = "Fix verified findings") resolves only the verified-KEPT blocking findings and commits them to the current branch. It never pushes, never opens or updates a PR, and never runs `gh pr merge`. Santiago merges.
- **Read-only is the default.** Report-only is the default action (no `--fix`, `--interactive` Q4 = "Report only"): the gate touches no files, makes no commits, and the branch is unchanged. The Fix flow is opt-in per run via `--fix`.
