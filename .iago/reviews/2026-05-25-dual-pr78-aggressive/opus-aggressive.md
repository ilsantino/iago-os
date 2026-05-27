# Opus 4.7 Aggressive Review — PR #78

**Date:** 2026-05-25
**Reviewer:** Opus 4.7 sub-agent (review-single profile)
**Diff:** 1 file (scripts/execute-pipeline.sh line 330) + STATE.md row

## Summary

MERGEABLE WITH FIXES. The change is mechanically correct for the happy path — the `:-1800` default is safe and the env var does pass through the self-freeze re-exec unchanged. However, three issues must be addressed before merge: (1) arithmetic on a non-numeric or bash-injection value in `(( waited < timeout_secs ))` is a latent Critical under `set -euo pipefail`; (2) the implement stage emits no `impl_timeout_budget_secs` extra to telemetry, making the override invisible post-hoc; and (3) the env var is undocumented in every authoritative reference doc. A fourth Important finding covers the asymmetry of making only the impl timeout configurable while all other `run_claude` call sites remain hardcoded, which may surprise operators who set this var expecting broader coverage.

---

## Findings

### Critical

**C-1 — Arithmetic injection / pipeline abort on invalid `IAGO_IMPL_TIMEOUT_SECS`**

`run_claude` receives `timeout_secs` as its first positional argument and uses it directly in an arithmetic expression at `scripts/execute-pipeline.sh:180`:

```bash
while kill -0 "$pid" 2>/dev/null && (( waited < timeout_secs )); do
```

The script runs under `set -euo pipefail` (line 3). In bash, `(( expr ))` exits with status 1 when the expression evaluates to zero — but more critically, a non-numeric value causes a fatal arithmetic evaluation error that terminates the entire pipeline under `set -e`. A decimal value (`"1800.5"`) produces `value too great for base` and kills the run. A bash-injection value like `$(rm -rf /)` inside `(( ))` is evaluated as a command substitution — bash arithmetic does perform command substitution on strings passed to `(( ))`, making this a genuine code-execution surface if the value comes from an untrusted environment. A value of `"0"` causes the `(( waited < 0 ))` loop to never execute a single iteration (waited starts at 0, `(( 0 < 0 ))` is false), resulting in an immediate taskkill of the claude process the instant it spawns.

The companion var `IAGO_IMPL_MAX_TURNS` (line 336) is consumed directly by `claude --max-turns` as a CLI argument — the claude binary validates it, so the blast radius is different. Here, the value enters a bash arithmetic context with no guard at all.

Fix: validate at the call site in `execute-pipeline.sh`, before `run_claude` is invoked, using a guard such as:

```bash
if [[ -n "${IAGO_IMPL_TIMEOUT_SECS:-}" ]] && \
   ! [[ "${IAGO_IMPL_TIMEOUT_SECS}" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: IAGO_IMPL_TIMEOUT_SECS must be a positive integer, got: '${IAGO_IMPL_TIMEOUT_SECS}'" >&2
  exit 1
fi
```

The regex `^[1-9][0-9]*$` rejects empty string (already covered by `:-1800`), zero, negatives, decimals, whitespace-padded values, and injection strings in one check. Empty string is safe because `:-1800` already handles unset-or-empty — the guard only fires when the var is explicitly set to a non-positive-integer value.

---

### Important

**I-1 — No telemetry record of the configured budget**

The build gate stage calls `stage_extra` for `tsc_duration_ms`, `vite_duration_ms`, and `build_gate_mode`, making those values queryable in the NDJSON pipeline runs. The implement stage emits nothing equivalent. After this PR, an operator sets `IAGO_IMPL_TIMEOUT_SECS=2700` for Plan 04d, the plan runs, and the resulting `.iago/state/pipeline-runs/*.ndjson` file carries no field indicating what budget was used. Post-hoc analysis of "did the override work / was the budget ever close to being hit?" is impossible without re-reading the env at a later time.

The fix is one line after `stage_start implement` (line 310):

```bash
stage_extra impl_timeout_budget_secs "${IAGO_IMPL_TIMEOUT_SECS:-1800}"
```

This is load-bearing for the stated motivation of the PR (unblocking heavy plans) — you want to be able to confirm the override was active for a given run.

**I-2 — Impl-only scope is arbitrary and undocumented**

Nine other `run_claude` call sites have hardcoded timeouts: stress (600), build-fix (600), console-fix (600), review (900), review-fix (900), re-review (900), codex-adversarial (600), codex-fix (900), pr-tag (120). The impl stage (1800) is the only one made configurable. This is a defensible surgical scope, but nothing in the diff, commit message, PR body, or any doc explains why impl specifically was chosen and the others left hardcoded.

An operator hitting a timeout in the review stage (900s) will search for a `IAGO_REVIEW_TIMEOUT_SECS` pattern by analogy with this PR and find nothing. The missing explanation will cause confusion and likely a follow-up PR that may not follow the same arithmetic-safety pattern.

Fix: add a comment directly above the `run_claude` call at line 330 explaining the scope decision:

```bash
# IAGO_IMPL_TIMEOUT_SECS: override the implementation stage wall-clock budget.
# Only the impl stage is configurable — it is the only stage whose duration
# scales with plan complexity (depends_on depth drives context-loading time).
# Other stages (review 900s, stress 600s, etc.) have stable upper bounds.
# Default: 1800s. Must be a positive integer.
```

**I-3 — Env var undocumented in all reference locations**

`IAGO_IMPL_MAX_TURNS` (the stated pattern this PR mirrors) appears in `scripts/execute-pipeline.sh:336` but is also undocumented in CLAUDE.md and `.claude/rules/execution-pipeline.md`. However, this PR explicitly claims to mirror that pattern and adds a new operator-facing knob. Neither CLAUDE.md, `.claude/rules/execution-pipeline.md`, nor any README/doc mentions `IAGO_IMPL_TIMEOUT_SECS`. The `execution-pipeline.md` rule doc lists `IAGO_PARALLEL_BUILD` as a documented control flag with rationale and a default-off explanation. The new var deserves the same treatment.

Fix: add one entry to the "Control Flags" section of `.claude/rules/execution-pipeline.md`:

```
**`IAGO_IMPL_TIMEOUT_SECS`** — Override the impl stage wall-clock budget (default 1800s).
Set to a higher value (e.g. 2700) for plans with `depends_on ≥ 3` that require extended
context-loading. Must be a positive integer. Unset or empty uses the default.
```

---

### Minor

**M-1 — `${VAR:-default}` on empty string is correct but intent is implicit**

`${IAGO_IMPL_TIMEOUT_SECS:-1800}` returns `1800` for both unset and explicitly-set-to-empty-string. This is almost certainly the right behavior (an empty var is a misconfiguration, not an intentional "use no timeout"), but the choice is silent. The validation guard from C-1 makes this explicit by only guarding non-empty set values, so fixing C-1 resolves M-1 as a side effect.

**M-2 — STATE.md commit hash is `(this commit)`**

The STATE.md row reads `| (this commit) |` in the Commit column. All other rows in that table carry real short-SHAs after merge. This is standard pipeline practice for fast-path commits and not a blocker, but whichever process finalizes STATE.md after merge should back-fill the real SHA. The row entry is otherwise accurate and well-formed.

**M-3 — Test suite has no case for invalid `IAGO_IMPL_TIMEOUT_SECS`**

`scripts/test-pipeline-helpers.sh` tests `run_claude` session-id synthesis and the synthesis fallback, but has no test for what happens when `timeout_secs` is non-numeric. Given that `(( ))` under `set -e` is the failure mode, a test passing `timeout_secs="abc"` to the extracted `run_claude` function body would confirm the current behavior (pipeline abort) and lock in the expected behavior after the validation guard from C-1 is added (clean error message + non-zero exit before spawning claude). Low priority since C-1's fix lands validation before `run_claude` is called, but the test gap is real.

---

## Out-of-scope observations

- The self-freeze block (`lines 63–77`) correctly `export`s `IAGO_PIPELINE_FROZEN` and `IAGO_PIPELINE_FROZEN_DIR` before `exec`ing the frozen copy. Because `IAGO_IMPL_TIMEOUT_SECS` is an env var inherited from the calling shell (not set inside the script), it is already present in the environment that `exec` inherits. No change needed here — the env var passes through correctly.
- The STATE.md entry claims "Unblocks Plan 04d (depends_on ≥3) which needs ~2700s budget." There is no way to verify the 2700s figure from the diff alone, but the claim is plausible given the depends_on depth rationale and is not a review concern for this PR.
- The other nine `run_claude` call sites with hardcoded timeouts are not broken by this PR; they are out of scope unless a follow-up decides to systematize the pattern.
