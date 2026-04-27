---
phase: feature-pipeline-speed-wedges
plan: 05
wave: 5
depends_on: ["01-measurement-protocol", "03-wedge-d-review-codex-concurrent"]
context: docs/specs/parallel-execution-wedges.md
created: 2026-04-27
revised: 2026-04-27
source: feature
---

# Plan: feature-pipeline-speed-wedges/05-wedge-a-plus-review-fanout

## Goal

Replace Step 3's single review session with a 3-lens fan-out: compliance / domain / adversarial. **Ship `forkjoin` transport only** in this plan: three concurrent `claude -p` sessions plus a synthesis pass. Defer agent-teams transport to a follow-up plan (`05b-wedge-a-plus-teams-transport.md`) once Anthropic stabilizes the experimental feature and the synthesis pattern is exercised in production. The forkjoin path captures the wall-clock saving and the Contrarian's seam-finding critique (synthesis reads all three lens outputs with full context).

## Design decisions (post-revision)

- **`forkjoin` only.** Agent teams transport deferred. The plan still ships `IAGO_REVIEW_PARALLEL` env var with values `off | forkjoin | shadow` — `teams` is reserved for the follow-up plan.
- **Severity vocabulary locked.** All three lens prompts MUST use exactly `Critical / Important / Minor` — no P0/P1/P2 or HIGH/MEDIUM/LOW alternatives. Synthesis dedup logic depends on it.
- **Severity floors enforced in all three lens prompts.** Existing `SEVERITY FLOORS: ALWAYS Critical / ALWAYS Important MUST NOT downgrade` block carried verbatim into each lens prompt body.
- **Stress-test enforcement block carried into compliance lens prompt.** The block is conditionally injected by the dispatcher when `$STRESS_FINDINGS` exists.
- **Lens timeout produces a synthetic Important finding** so re-review loop fires when a lens silently fails — preventing silent domain coverage gaps.
- **Quantified shadow validation criterion.** Across 5 plans: zero Critical misses (parallel must catch every Critical that serial caught), Important count within ±1 of serial.
- **JSONL atomicity is a non-issue here** because forkjoin doesn't use the mailbox. Each lens writes its own findings file independently.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `scripts/execute-pipeline.sh` | Detect transport, dispatch lenses concurrent, run synthesis |
| create | `scripts/review-lenses/compliance.md` | Lens prompt — plan compliance focus, with severity floors + stress block |
| create | `scripts/review-lenses/domain.md` | Lens prompt — domain checklist, with severity floors |
| create | `scripts/review-lenses/adversarial.md` | Lens prompt — cross-cutting adversarial, with severity floors |
| create | `scripts/review-lenses/synthesis.md` | Synthesis-pass prompt with dedup, schema-validate, fallback |
| create | `scripts/review-lenses/README.md` | Document the lens contract and severity vocabulary lock |
| modify | `.claude/rules/execution-pipeline.md` | Document `IAGO_REVIEW_PARALLEL` flag with `off | forkjoin | shadow` values |

## Tasks

### Task 1: Document the lens contract

- **files:** `scripts/review-lenses/README.md`
- **action:** Document: (a) lens prompts use the severity vocabulary `Critical / Important / Minor` ONLY — alternatives like P0/HIGH are forbidden because synthesis dedup matches on string equality; (b) every lens prompt includes the existing `SEVERITY FLOORS` instruction verbatim; (c) the compliance lens prompt receives the `STRESS_ENFORCEMENT_BLOCK` when `$STRESS_FINDINGS` exists; (d) lens output format: a markdown findings list with sections `## Critical`, `## Important`, `## Minor`, ending with `## Verdict: PASS|PASS_WITH_CONCERNS|FAIL`. State that empty `## Critical/Important/Minor` sections are valid (no findings). State that ABSENCE of a `## Verdict` line means the lens did not complete (failure mode).
- **verify:** `grep -n 'Critical / Important / Minor\|SEVERITY FLOORS\|STRESS_ENFORCEMENT_BLOCK' scripts/review-lenses/README.md`
- **expected:** All three patterns present

### Task 2: Compliance lens prompt

- **files:** `scripts/review-lenses/compliance.md`
- **action:** Lens prompt body. Copy the PASS 1 (PLAN COMPLIANCE) section from the existing review prompt at `scripts/execute-pipeline.sh:431-455`. Add the SEVERITY FLOORS block verbatim. Add a placeholder `__STRESS_BLOCK__` that the dispatcher replaces at runtime with `$STRESS_ENFORCEMENT_BLOCK` (or empty string when no stress findings). End-of-prompt instruction: "Categorize findings as Critical / Important / Minor only — do not use P0/HIGH/etc. End with `## Verdict: PASS|PASS_WITH_CONCERNS|FAIL`."
- **verify:** `grep -n 'PLAN COMPLIANCE\|SEVERITY FLOORS\|__STRESS_BLOCK__' scripts/review-lenses/compliance.md`
- **expected:** All three present

### Task 3: Domain lens prompt

- **files:** `scripts/review-lenses/domain.md`
- **action:** Lens prompt for PASS 2 (DOMAIN ROUTING) from the existing review prompt. Same severity vocabulary lock and SEVERITY FLOORS instruction. Reads `$REVIEW_CHECKS_FILE` for module checklist.
- **verify:** `grep -n 'DOMAIN ROUTING\|SEVERITY FLOORS\|Critical / Important / Minor' scripts/review-lenses/domain.md`
- **expected:** All three present

### Task 4: Adversarial lens prompt

- **files:** `scripts/review-lenses/adversarial.md`
- **action:** Lens prompt for PASS 3 (ADVERSARIAL) from the existing review prompt. Cross-cutting checks: auth bypass, data loss, races, rollback safety. Same severity vocabulary lock and SEVERITY FLOORS — even though adversarial is cross-cutting, it may apply checks from auth/data modules that have ALWAYS-Critical floors; the floor instruction MUST be in the prompt.
- **verify:** `grep -n 'ADVERSARIAL\|SEVERITY FLOORS\|auth bypass\|Critical / Important / Minor' scripts/review-lenses/adversarial.md`
- **expected:** All four present

### Task 5: Synthesis prompt

- **files:** `scripts/review-lenses/synthesis.md`
- **action:** Synthesis-pass prompt. Reads three lens-output files. Steps in the prompt body: (a) parse each lens output for `## Critical / Important / Minor` sections; (b) dedup findings — same `file:line` + same finding category → keep highest severity (string comparison: `Critical > Important > Minor`); (c) detect seam interactions — if lens A flagged auth bypass at file X and lens C flagged race condition at file X, note the combined risk in synthesized output; (d) emit a single combined findings file with sections `## Critical`, `## Important`, `## Minor`, then `## Verdict`; (e) schema-validate before finishing: every finding line has a recognizable severity tag, file path, and note. On validation fail, the dispatcher (Task 9) detects this via missing `## Verdict` line and falls back to concatenated raw lens outputs.
- **verify:** `test -f scripts/review-lenses/synthesis.md && grep -q 'dedup\|schema-validate' scripts/review-lenses/synthesis.md`
- **expected:** Exit 0

### Task 6: Detect transport

- **files:** `scripts/execute-pipeline.sh`
- **action:** Function `detect_review_transport()` returning `serial | forkjoin | shadow`:
  ```bash
  detect_review_transport() {
    case "${IAGO_REVIEW_PARALLEL:-off}" in
      forkjoin) echo "forkjoin" ;;
      shadow)   echo "shadow"   ;;
      *)        echo "serial"   ;;
    esac
  }
  ```
  `teams` is intentionally absent — that value will be added in the follow-up plan. Setting `IAGO_REVIEW_PARALLEL=teams` today logs a warning and falls back to `serial`.
- **verify:** `grep -n 'detect_review_transport' scripts/execute-pipeline.sh`
- **expected:** ≥ 1 match

### Task 7: Implement forkjoin dispatch

- **files:** `scripts/execute-pipeline.sh`
- **action:** Function `run_review_forkjoin()` that:
  1. Composes each lens prompt safely: write the lens prompt template to a temp file, write the substitution value (the block content or empty string) to a separate temp file, then perform substitution via `awk` (not sed or shell variable expansion — both are unsafe with shell-meta characters in the block body):
     ```bash
     compose_lens_prompt() {
       local lens="$1" out="$2"
       local block_content=""
       if [[ "$lens" == "compliance" && -n "${STRESS_ENFORCEMENT_BLOCK:-}" ]]; then
         block_content="$STRESS_ENFORCEMENT_BLOCK"
       fi
       # Write block to temp file so we can read it as literal text via getline
       local block_file="$PIPELINE_TMP/lens-${lens}-block.txt"
       printf '%s' "$block_content" > "$block_file"
       awk -v block_file="$block_file" '
         {
           if (index($0, "__STRESS_BLOCK__")) {
             # Read block file content
             block = ""
             while ((getline line < block_file) > 0) {
               block = (block == "" ? line : block "\n" line)
             }
             close(block_file)
             gsub(/__STRESS_BLOCK__/, block, $0)
           }
           print
         }
       ' "$IAGO_OS_ROOT/scripts/review-lenses/${lens}.md" > "$out"
     }
     ```
     This handles arbitrary shell-meta characters (`$`, backticks, quotes, parens) in the block content because `awk` reads the block from disk as literal bytes — there is no shell expansion path.
  2. Dispatches three lenses as background subshells (using `run_claude` — `$BASHPID`-fixed per Plan 03 Task 1):
     ```bash
     ( run_claude 600 -p "$compliance_prompt" --model opus --max-turns 25 --allowedTools "Read Glob Grep Bash" --output-format text > "$PIPELINE_TMP/lens-compliance.txt" 2>&1 ) &
     C_PID=$!
     # ...same for domain and adversarial...
     ```
  3. Waits with explicit error-tolerant capture:
     ```bash
     C_EXIT=0; D_EXIT=0; A_EXIT=0
     wait "$C_PID" || C_EXIT=$?
     wait "$D_PID" || D_EXIT=$?
     wait "$A_PID" || A_EXIT=$?
     ```
  4. For each lens, check if its output file contains a `## Verdict:` line (lens completed) vs missing (lens failed silently). Failed lenses are recorded for Task 8's synthetic finding logic.
- **verify:** `grep -n 'run_review_forkjoin\|lens-compliance.txt\|lens-domain.txt\|lens-adversarial.txt' scripts/execute-pipeline.sh | head -5`
- **expected:** All four identifiers referenced

### Task 8: Synthesize and handle lens failures

- **files:** `scripts/execute-pipeline.sh`
- **action:** After lens dispatch:
  1. For each lens that failed (no `## Verdict` line), emit a synthetic finding to a sentinel file `$PIPELINE_TMP/lens-failures.txt` with content `## Important\n- {lens-name} lens failed/timed out — manual review required.` This guarantees the synthesis pass produces a `PASS_WITH_CONCERNS` verdict so the existing fix loop fires.
  2. Run synthesis via `run_claude` reading the lens output files (including `lens-failures.txt` if non-empty), using `scripts/review-lenses/synthesis.md` as prompt body. Output goes to `$REVIEW_FILE` (the existing fix loop reads from there).
  3. If synthesis itself fails (no `## Verdict` line in synthesis output), fallback: concatenate `lens-compliance.txt + lens-domain.txt + lens-adversarial.txt + lens-failures.txt` into `$REVIEW_FILE` directly. This guarantees the fix loop always has SOMETHING to act on.
  4. Set `REVIEW_OUTPUT=$(cat "$REVIEW_FILE")` so the existing verdict-grep at line 466 works.
- **verify:** `grep -n 'lens-failures.txt\|synthesis output' scripts/execute-pipeline.sh | head -5`
- **expected:** Both patterns present

### Task 9: Wire transport selection into Step 3

- **files:** `scripts/execute-pipeline.sh`
- **action:** At Step 3 entry (post-Plan-03 refactor), call:
  ```bash
  REVIEW_TRANSPORT=$(detect_review_transport)
  log "REVIEW transport: $REVIEW_TRANSPORT"
  case "$REVIEW_TRANSPORT" in
    serial)
      run_review_initial &
      REVIEW_PID=$!
      ;;
    forkjoin)
      run_review_forkjoin &
      REVIEW_PID=$!
      ;;
    shadow)
      # CRITICAL: serial and forkjoin both write to $REVIEW_FILE; in shadow we
      # must disambiguate. Capture serial output to a separate path; let
      # forkjoin synthesis write to $REVIEW_FILE (the canonical fix-loop input).
      (
        REVIEW_FILE_SERIAL="$PIPELINE_TMP/review-serial.txt"
        # Run serial first, redirect its file output to the serial-only path
        SAVED_REVIEW_FILE="$REVIEW_FILE"
        REVIEW_FILE="$REVIEW_FILE_SERIAL"
        run_review_initial
        # Restore canonical path; run forkjoin which writes to $REVIEW_FILE
        REVIEW_FILE="$SAVED_REVIEW_FILE"
        run_review_forkjoin
        # Emit comparison record
        python -c "import json,sys; ..." > "$PROJECT_DIR/.iago/metrics/shadow-${PLAN_NAME}-$(date -u +%Y%m%dT%H%M%SZ).json" 2>/dev/null || \
          { echo "{\"plan\":\"$PLAN_NAME\",\"serial_file\":\"$REVIEW_FILE_SERIAL\",\"forkjoin_file\":\"$REVIEW_FILE\"}" \
            > "$PROJECT_DIR/.iago/metrics/shadow-${PLAN_NAME}-$(date -u +%Y%m%dT%H%M%SZ).json"; }
      ) &
      REVIEW_PID=$!
      ;;
  esac
  ```
  In shadow mode the fix loop reads `$REVIEW_FILE` (which contains forkjoin synthesis), the comparison record references both paths, and the operator (or a follow-up aggregator) computes the parity diff post-run. This avoids the clobber of serial findings that the original Task 9 wording allowed. Sequencing: forkjoin's outer `wait "$REVIEW_PID"` returns only after both serial and forkjoin complete inside the shadow subshell, which then completes before Plan 03's `wait "$CODEX_PID"` is reached.
- **verify:** `grep -n 'REVIEW_TRANSPORT=\|run_review_forkjoin' scripts/execute-pipeline.sh`
- **expected:** Both identifiers present

### Task 10: Document `IAGO_REVIEW_PARALLEL` in rules

- **files:** `.claude/rules/execution-pipeline.md`
- **action:** Add to Control Flags table:
  - `IAGO_REVIEW_PARALLEL=off` (default) — single review session as today.
  - `IAGO_REVIEW_PARALLEL=forkjoin` — three lens sessions concurrent + synthesis. Use after shadow validation passes.
  - `IAGO_REVIEW_PARALLEL=shadow` — runs both serial and forkjoin sequentially; emits a comparison record to `.iago/metrics/shadow-*.json`. Use during validation.
  - `IAGO_REVIEW_PARALLEL=teams` — reserved for follow-up plan; today logs a warning and falls back to `serial`.
  Add a paragraph: "Promote `forkjoin` to default only after `shadow` mode confirms across 5 plans: zero Critical misses (parallel catches every Critical that serial caught) AND Important count within ±1 of serial. Anything less keeps default at `off`."
  Use Bash shell-redirect (file is hook-protected).
- **verify:** `grep -n 'IAGO_REVIEW_PARALLEL\|forkjoin\|shadow' .claude/rules/execution-pipeline.md`
- **expected:** All three identifiers present

## Stress Test

**Verdict:** PROCEED_WITH_NOTES (revised)
**Date:** 2026-04-27 (re-stress after revision)

Critical findings from the previous round are addressed inline:
- **`__STRESS_BLOCK__` substitution mechanism unspecified** → fixed in Task 7 (now uses an `awk` + temp-file approach that handles arbitrary shell-meta characters in the block content via literal byte read; no shell expansion path).
- **Shadow mode `$REVIEW_FILE` clobber** → fixed in Task 9 (shadow mode now uses `$REVIEW_FILE_SERIAL` for serial output and keeps `$REVIEW_FILE` for forkjoin synthesis; comparison record references both paths).
- **Sequencing of outer REVIEW_PID vs CODEX_PID wait** → documented in Task 9 ("forkjoin's outer wait returns only after all three lenses waited inside `run_review_forkjoin`").

### Important

- **Lens output file collision risk under multiple-pipeline scenarios.** `lens-compliance.txt` etc. are fixed names in `$PIPELINE_TMP`. If two pipeline instances share `PIPELINE_TMP` (currently impossible — each pipeline gets `$(mktemp -d)`, but worth noting), names would collide. Pre-existing single-pipeline assumption; document but no fix needed here.

### Minor

- Shadow validation criterion ("Important within ±1") could mean different things pre- vs post-dedup. Optional polish: emit raw and deduplicated counts in the shadow record JSON.

## Verification

```
test -f scripts/review-lenses/README.md \
  && test -f scripts/review-lenses/compliance.md \
  && test -f scripts/review-lenses/domain.md \
  && test -f scripts/review-lenses/adversarial.md \
  && test -f scripts/review-lenses/synthesis.md \
  && grep -q "detect_review_transport" scripts/execute-pipeline.sh \
  && grep -q "run_review_forkjoin" scripts/execute-pipeline.sh \
  && grep -q "lens-failures.txt" scripts/execute-pipeline.sh \
  && grep -q "IAGO_REVIEW_PARALLEL" .claude/rules/execution-pipeline.md \
  && echo "Plan 05 verified"
```

Expected: `Plan 05 verified`. Field test sequence: (a) run with `IAGO_REVIEW_PARALLEL=shadow` on a representative plan; verify comparison record appears in `.iago/metrics/shadow-*.json`; (b) review the diff between serial and forkjoin findings — confirm zero Critical misses across 5 plans; (c) measure Important count delta — within ±1 across 5 plans; (d) only after both criteria pass, ship a follow-up commit promoting default to `forkjoin`. The `teams` transport is a separate plan (deferred).
