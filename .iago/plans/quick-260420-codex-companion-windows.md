---
phase: quick
plan: quick-260420-codex-companion-windows
wave: 1
depends_on: []
created: 2026-04-20
branch: fix/quick-codex-companion-windows
base: main
---

# Quick: Real Codex adversarial on Windows via codex-companion

## Goal

Replace the Windows-skip branch in step 4 of the pipeline with a real
`codex-companion.mjs adversarial-review` invocation so Windows sessions get
GPT-5.4 cross-model review instead of the Claude fallback. Also update the
findings-detection grep so companion output (`[high]` / `needs-attention`) is
recognized. Claude fallback stays as plan B when the companion isn't
installed.

## Context

Step 4 of `scripts/execute-pipeline.sh` currently auto-skips Codex on
Windows because the raw `codex review sha..HEAD` subcommand runs `git`
inside the Codex sandbox, which is blocked on MSYS/Cygwin. The pipeline
falls back to a Claude Opus adversarial pass — same model as steps 1/3,
so no cross-model signal.

The `codex-companion.mjs` plugin script (shipped with `openai-codex`
plugin v1.0.2) exposes `adversarial-review` as a subcommand that uses the
Codex app-server turn API — bypassing the agent sandbox entirely. It
runs identically on Windows, Mac, and Linux. A live smoke test on
Windows confirmed it produces structured findings with `[high]` /
`needs-attention` markers.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `scripts/execute-pipeline.sh` | Swap raw codex review + OS skip for companion invocation; broaden findings grep |
| modify | `README.md` | Remove Windows-fallback claim from step 4 description + mermaid label |
| modify | `docs/MANUAL.md` | Remove three Windows-fallback explanations |
| modify | `.claude/rules/execution-pipeline.md` | Update step 4 line if it mentions the Windows fallback |

## Tasks

### Task 1: Resolve companion path + replace step 4 Codex invocation

- **files:** `scripts/execute-pipeline.sh`
- **action:**
  1. Above the `CODEX_EXIT=0` block (before current line 539), add a
     path resolver that picks the first existing companion script from
     these candidates, in order:
     - `$HOME/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs` (stable, preferred)
     - `$HOME/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs` (versioned cache, fallback — use a glob loop)
     Store the resolved path in `CODEX_COMPANION`. If neither exists,
     leave `CODEX_COMPANION` empty.
  2. Replace the OS-detection block (current lines 543-549):
     ```bash
     if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]] || [[ "$(uname -s)" == MINGW* ]]; then
       log "Codex sandbox blocks git on Windows — using Claude adversarial"
     elif command -v codex &> /dev/null; then
       CODEX_OUTPUT=$(cd "$PROJECT_DIR" && codex review "${PRE_IMPL_SHA}..HEAD" 2>&1) || CODEX_EXIT=$?
       USED_CODEX=true
     fi
     ```
     with:
     ```bash
     if command -v node &> /dev/null && [[ -n "$CODEX_COMPANION" ]]; then
       log "Running codex-companion adversarial-review (GPT-5.4)"
       CODEX_OUTPUT=$(cd "$PROJECT_DIR" && node "$CODEX_COMPANION" adversarial-review --base "$PRE_IMPL_SHA" --wait 2>&1) || CODEX_EXIT=$?
       USED_CODEX=true
     fi
     ```
  3. Do NOT touch `run_claude_adversarial` or the fallback logic at
     lines 551-566 — the Claude fallback must still fire when the
     companion is absent (`USED_CODEX=false`) or when Codex returns
     non-zero with no usable findings.
- **verify:** `grep -n "OSTYPE.*msys\|MINGW\*\|Codex sandbox blocks git" scripts/execute-pipeline.sh`
- **expected:** empty output (OS detection gone; Windows-skip log line
  gone; only the companion invocation remains in step 4).

### Task 2: Broaden the findings-detection grep to match companion output

- **files:** `scripts/execute-pipeline.sh`
- **action:** Companion outputs severity as `[high]`, `[medium]`,
  `[low]`, and a verdict line `Verdict: needs-attention`. The current
  grep only recognizes `[P0]|[P1]|[P2]|Critical|Important` — on a
  companion run it would silently miss all findings and skip step 4b.
  Update BOTH grep patterns:
  - Line 558 (currently checks if non-zero-exit Codex still produced
    findings):
    ```bash
    if echo "$CODEX_OUTPUT" | grep -qiE '\[P[012]\]|\bCritical\b|\bImportant\b'; then
    ```
    Replace with:
    ```bash
    if echo "$CODEX_OUTPUT" | grep -qiE '\[P[012]\]|\bCritical\b|\bImportant\b|\[high\]|\[medium\]|needs-attention'; then
    ```
  - Line 582 (step 4b trigger):
    ```bash
    if echo "$CODEX_OUTPUT" | grep -qiE '\[P[012]\]|- \[P[012]\]|severity.*P[012]|\bCritical\b|\bImportant\b'; then
    ```
    Replace with:
    ```bash
    if echo "$CODEX_OUTPUT" | grep -qiE '\[P[012]\]|- \[P[012]\]|severity.*P[012]|\bCritical\b|\bImportant\b|\[high\]|\[medium\]|needs-attention'; then
    ```
- **verify:** `grep -c "needs-attention\|\\[high\\]" scripts/execute-pipeline.sh`
- **expected:** `4` (two new markers × two grep lines).

### Task 3: Update docs — remove Windows-fallback claims

- **files:** `README.md`, `docs/MANUAL.md`, `.claude/rules/execution-pipeline.md`
- **action:**
  1. `README.md` — in the step-4 table row (near line 124), remove the
     "Windows: auto-detects MSYS/Cygwin and falls back to Claude
     adversarial (Codex sandbox blocks git)" language. Replace with
     description that reflects the new behavior: the pipeline invokes
     `codex-companion adversarial-review` on all platforms, and falls
     back to Claude Opus only when the companion plugin isn't
     installed. Also remove "(Claude fallback on Windows)" from the
     mermaid diagram label near line 146 — the step 4 label should just
     name the stage.
  2. `docs/MANUAL.md` — three Windows-fallback paragraphs exist near
     lines 254, 685, and 755 (line numbers approximate; grep for
     `Windows` + `Codex` + `fallback` / `sandbox blocks git`). Rewrite
     each to reflect: companion runs on all platforms; Claude fallback
     only fires when the companion is missing or errors; "This is
     expected behavior, not an error" wording no longer applies to
     Windows.
  3. `.claude/rules/execution-pipeline.md` — the diff of step 4 near
     line 58 says "codex CLI / GPT-5.4 if available, else claude -p
     opus". This is still accurate but should be tightened: the
     concrete path is `codex-companion.mjs adversarial-review`, not
     raw `codex CLI`. Update only if necessary — keep the rule file
     terse.
- **verify:** `grep -nE "sandbox blocks git|Windows: auto-detects|Claude fallback on Windows" README.md docs/MANUAL.md .claude/rules/execution-pipeline.md`
- **expected:** empty output (all Windows-fallback claims gone).

## Stress Test

Performed via analyst agent on 2026-04-20 before plan creation. Key
findings addressed in the plan above:

- **Picked canonical wrapper** — proposal originally said `codex exec`;
  stress test showed that path bypasses the blessed runtime, runs
  inside the agent sandbox (could still hit git), and produces
  unstructured output. Plan uses `codex-companion.mjs
  adversarial-review` instead, which is what `/codex:adversarial-review`
  calls internally.
- **Output-format gap was a silent-break risk** — companion emits
  `[high]`/`needs-attention`, not `[P0]`/`Critical`. Without the grep
  update, step 4b would silently skip and all Codex findings would be
  dropped. Task 2 covers this explicitly.
- **Path resolution** — `CLAUDE_PLUGIN_ROOT` is NOT set in the shell
  where the pipeline runs (verified). Task 1 resolves the path from
  two candidate locations (marketplace stable + cache versioned).
- **Model string** — companion defaults to `gpt-5.4`; we do NOT pass
  `--model`, avoiding the `gpt-5-codex` alias pitfall.
- **Auth** — companion uses Codex subscription auth (no
  `OPENAI_API_KEY` needed, verified via smoke test).
- **Downstream log messages** — the "Codex sandbox blocks git on
  Windows" log at line 545 is deleted in task 1; no other log lines lie
  about fallback.

Verdict: **PROCEED** with the three tasks above.

## Acceptance criteria

- On Windows (Git Bash / MSYS), the pipeline runs `node
  <companion-path> adversarial-review --base <sha> --wait` and sets
  `USED_CODEX=true` on success.
- When the companion output contains `[high]` or `needs-attention`,
  step 4b (Codex fix) triggers.
- When the companion is not found or `node` isn't installed, the
  pipeline falls back to `run_claude_adversarial` without error.
- No OS-detection branches (`OSTYPE == "msys"`, `uname -s == MINGW*`)
  remain in step 4.
- Docs (`README.md`, `docs/MANUAL.md`, `.claude/rules/execution-pipeline.md`)
  no longer claim Windows uses Claude fallback for step 4.

## Non-goals

- Do NOT modify `run_claude_adversarial` — it stays as plan B.
- Do NOT change steps 1, 2, 3, 4b, 5, 5b, 6.
- Do NOT add env vars / config knobs; path resolution is auto.
- Do NOT remove the raw `command -v codex` fallback in a way that
  breaks Mac/Linux environments without the companion plugin —
  companion is preferred, but the Claude fallback is the only
  guaranteed-available path without the plugin.
