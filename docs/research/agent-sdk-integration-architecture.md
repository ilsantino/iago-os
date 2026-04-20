# Research: iaGO-OS Architecture for Agent SDK Integration

**Date:** 2026-04-13
**Question:** Analyze the iaGO-OS codebase to document all architectural components
affected by Agent SDK integration — pipeline, agent profiles, hooks, GitHub Actions,
and skills.

---

## Findings

### Sub-question 1: How does execute-pipeline.sh invoke Claude and manage stage I/O?

**Source:** `scripts/execute-pipeline.sh`

#### Core invocation wrapper (lines 58-67)

All Claude sessions go through a single `run_claude` function:

```bash
run_claude() {
  local timeout_secs="$1"; shift
  timeout "$timeout_secs" claude "$@"
  local exit_code=$?
  if [[ $exit_code -eq 124 ]]; then
    log "ERROR: claude session timed out after ${timeout_secs}s"
    return 1
  fi
  return $exit_code
}
```

Every stage calls:
`run_claude <timeout> -p "<prompt>" --model <model> --max-turns <N> --allowedTools "<list>" --output-format text 2>&1`

The `2>&1` merge means stdout and stderr are captured together into a bash variable.

#### Temp file strategy (lines 44-54)

All inter-stage context lives in a `mktemp -d` directory, deleted on EXIT trap:

| File | Purpose |
|------|---------|
| `$PIPELINE_TMP/diff.txt` | Git diff passed to review + codex stages |
| `$PIPELINE_TMP/review.txt` | Review findings passed to fix session |
| `$PIPELINE_TMP/codex.txt` | Codex findings passed to codex-fix session |
| `$PIPELINE_TMP/stress.txt` | Full stress output |
| `$PIPELINE_TMP/stress-findings.txt` | Structured findings (between delimiters) |
| `$PIPELINE_TMP/review-checks.md` | Concatenated review check modules |
| `$PIPELINE_TMP/build-errors.txt` | Build error output passed to fix session |
| `$PIPELINE_TMP/plan-for-pr.md` | Plan copy for PR session |

Context is never inlined in the prompt string for large content. File paths are
embedded in the prompt so the session reads via its Read tool. This explicitly
avoids "Argument list too long" on Windows (comment at line 43).

#### Stage-by-stage breakdown

**Stage 0 — Stress test** (lines 87-169)
- Skip condition: `grep -q '## Stress Test' "$PLAN_FILE"` — if present, skip entirely
- Model: opus, timeout: 600s, max-turns: 15, allowedTools: `"Read Glob Grep"` (read-only)
- Prompt checks 5 dimensions: precision, edge cases, contradictions, simpler alternatives, missing acceptance criteria
- Verdict extraction (line 141): `sed 's/\*//g' | grep -oE 'VERDICT:\s*(PROCEED|PROCEED_WITH_NOTES|BLOCK)' | tail -1`
- BLOCK exits with code 1; PROCEED_WITH_NOTES writes full output to `$STRESS_FILE`
- Structured findings extracted via sed between `---FINDINGS START---` / `---FINDINGS END---` delimiters (lines 160-167)

**Stage 1 — Implement** (lines 171-215)
- `PRE_IMPL_SHA` captured before: `git rev-parse HEAD` (line 174) — anchors diff scope for all later stages
- Model: opus, timeout: 1800s, max-turns: 50, allowedTools: `"Edit Write Read Glob Grep Bash"`
- Stress context injected at runtime if `$STRESS_FINDINGS` exists (lines 181-188) — each finding is a REQUIREMENT
- Status detection on last 5 lines (line 208): `grep -qE "^(BLOCKED|NEEDS_CONTEXT)"` triggers `exit 1`

**Stage 2 — Build gate** (lines 217-276)
- Detects `tsconfig.json` and `vite.config.*` presence; runs `npx tsc --noEmit` and/or `npx vite build`
- `run_build_gate()` in a while loop; failure dispatches an inline fix session
- Fix session: opus, 600s, 30 turns, same tool set as impl
- Max 2 retries (`MAX_BUILD_RETRIES=2`), then `exit 1`

**Stage 3 — Review** (lines 278-425)
- Stages all changes first: `git add -A -- ':!**/.env' ':!**/.env.*' ':!**/*.pem' ':!**/*.key' ...`
- Diff = `git diff $PRE_IMPL_SHA..HEAD` + `git diff --cached` combined into `$DIFF_FILE`
- `compose_review_checks()` (lines 71-85): concatenates ALL `.md` files from `scripts/review-checks/` (baseline first, then alphabetically). 8 modules: `api.md`, `auth.md`, `backend.md`, `baseline.md`, `i18n.md`, `infra.md`, `patterns.md`, `react.md`
- Model: opus, timeout: 900s, max-turns: 25, allowedTools: `"Read Glob Grep Bash"` (read-only)
- Three-pass prompt: plan compliance, domain routing, adversarial
- Verdict regex (line 349): `grep -qiE "Verdict\s*:?\s*\*{0,2}\s*(FAIL|PASS_WITH_CONCERNS)\b"`
- Any FAIL/PASS_WITH_CONCERNS: dispatch fix session (opus, 900s, 40 turns), rebuild, re-review
- Max `MAX_FIX_RETRIES=2` rounds before `exit 1`

**Stage 4 — Codex adversarial** (lines 427-481)
- Windows detection: `$OSTYPE == "msys"/"cygwin"` or `uname -s == MINGW*` always falls back to Claude adversarial
- Codex path: `codex review "${PRE_IMPL_SHA}..HEAD"`
- Fallback: `run_claude_adversarial()` — opus, 600s, 20 turns, `"Read Glob Grep"`
- Codex non-zero exit with no findings uses fallback; with findings keeps them (lines 462-470)

**Stage 4b — Codex fix** (lines 483-541)
- Trigger regex (line 487): `grep -qiE '\[P[012]\]|- \[P[012]\]|severity.*P[012]|\bCritical\b|\bImportant\b'`
- Skipped if no actionable findings
- opus, 900s, 40 turns, full tool set
- Post-fix rebuild gate with its own fix session if needed

**Stage 5 — Create PR** (lines 543-577)
- sonnet, 300s, 15 turns, `"Edit Write Read Glob Grep Bash"`
- Prompt: read plan, stage changes, write conventional commit, create branch, `gh pr create`
- PR body: Summary bullets + Plan (full content in `<details>` block) + Test plan

**Stage 5b — Tag @claude** (lines 578-625)
- URL extraction: `grep -oE 'https://github\.com/[^ ]+/pull/[0-9]+' | head -1`
- Fallback: `gh pr view "$CURRENT_BRANCH" --json url -q '.url'`
- Guarded by `NO_TAG` flag (set via `--no-tag`, default false)
- sonnet session synthesizes review comment (120s, 3 turns, `"Read"` only) from plan + diff
- Posted via: `gh pr comment "$PR_NUMBER" --body "$CLAUDE_REVIEW_BODY"`

**Stage 6 — Summary** (lines 632-667)
- Written to `$PROJECT_DIR/.iago/summaries/${PLAN_NAME}.md`
- Frontmatter: plan, status, verified date, PR URL
- Captures: impl exit code, review verdict string, codex exit code, diff stats

---

### Sub-question 2: How are agent profiles and capability modules structured?

**Sources:** `.claude/agents/executor.md`, `analyst.md`, `operator.md`, `profiles/`, `capabilities/`

#### Base agents (3 files in `.claude/agents/`)

Frontmatter format:
```yaml
---
name: executor
model: opus
tools: [Read, Glob, Grep, Edit, Write, Bash, Notebook]
maxTurns: 25
---
```

| Base | Model | Tools | Max Turns | Purpose |
|------|-------|-------|-----------|---------|
| `executor.md` | opus | Read, Glob, Grep, Edit, Write, Bash, Notebook | 25 | Code writing, TDD cycle |
| `analyst.md` | sonnet | Read, Glob, Grep, Bash | 15 | Read-only review, diagnostics |
| `operator.md` | sonnet | Read, Glob, Grep, Bash, WebSearch, WebFetch | 20 | Research, infra, external data |

Behavioral rules are in the body (not frontmatter):
- executor: runs `npx tsc --noEmit` + `npx biome check --write .` + conventional commit after every task
- analyst: one analysis pass, no edits ever, severity rating on every finding
- operator: dry-run before destructive infra ops, cross-reference multiple sources, cite file:line or URL

#### Profiles (13 files in `.claude/agents/profiles/`)

Profiles compose base + capabilities via frontmatter:

```yaml
---
name: fullstack
base: executor
model: opus
maxTurns: 25
capabilities:
  - react-19
  - dynamodb
  - lambda
  - tdd
  - forms
  - animation
---
```

The `research` profile is special — `capabilities: dynamic` means the orchestrator
selects and injects capabilities at dispatch time based on the research topic.
`fullstack` is the fallback profile when no other profile matches.

#### Capability modules (13 files in `.claude/agents/capabilities/`)

Pure markdown injected into the agent's system prompt by the orchestrator.
Files: `animation.md`, `cognito.md`, `content.md`, `dynamodb.md`, `e2e.md`,
`forms.md`, `infra.md`, `lambda.md`, `react-19.md`, `review-quality.md`,
`review-spec.md`, `security.md`, `tdd.md`

**Important gap:** There is NO automated profile loading mechanism. The orchestrator
session manually inlines capabilities into the `-p` prompt or Agent tool call.
Profiles and capabilities are reference docs guiding prompt construction, not
loaded programmatically by any existing tooling.

---

### Sub-question 3: How are hooks configured and what do they enforce?

**Sources:** `.claude/settings.json`, `.iago/hooks/*.mjs`

#### Hook configuration (`.claude/settings.json`)

All hooks are `"type": "command"` entries running Node MJS scripts.
Hook files live in `.iago/hooks/` (project-specific, not `.claude/hooks/`).

| Event | Matcher | Hook File | Timeout |
|-------|---------|-----------|---------|
| SessionStart | (none) | `context-persistence.mjs session-start` | 5000ms |
| PreToolUse | Bash | `safety-guard.mjs` | 2000ms |
| PreToolUse | Bash | `commit-quality.mjs` | 5000ms |
| PreToolUse | Edit or Write or MultiEdit | `config-protection.mjs` | 2000ms |
| PreToolUse | Edit or Write or MultiEdit | `safety-guard.mjs` | 2000ms |
| PostToolUse | Skill or Agent | `usage-tracker.mjs post-tool-use` | 3000ms |
| PostToolUse | Edit | `post-edit-format.mjs` | 5000ms |
| PostToolUse | Edit | `post-edit-typecheck.mjs` | 5000ms |
| PostToolUse | Edit | `post-edit-console-warn.mjs` | 2000ms |
| PreCompact | (none) | `context-persistence.mjs pre-compact` | 15000ms |
| Stop | (none) | `context-persistence.mjs stop` | 10000ms |
| Stop | (none) | `usage-tracker.mjs stop` | 5000ms |

Block mechanism: hook writes `{"decision": "block", "reason": "..."}` to stdout and
exits code 2. Warning (non-blocking): `{"hookSpecificOutput": "..."}` + exit 0.
All hooks check `isDisabled(name)` at startup for feature-flag disabling.

#### safety-guard.mjs (`.iago/hooks/safety-guard.mjs`, lines 1-179)

**Bash branch** — checks `input.tool_input.command`:

Destructive pattern blocks (lines 12-26):
- `rm -rf` on root/parent/system directories (allows node_modules/dist/build/coverage)
- `git push --force` (not `--force-with-lease`)
- Force push to main/master
- `git reset --hard` or `git clean -fd`
- SQL DROP/TRUNCATE TABLE/DATABASE
- Disk format commands (`mkfs`, `fdisk`, `dd if=`)
- `chmod 777`
- Pipe-to-shell (`curl ... | sh`)
- Shutdown/reboot/halt
- `git branch -D main/master`
- `npm publish` — warn only, not blocked

Secret detection in Bash commands (lines 29-47): AWS Access Key ID/Secret, GitHub PATs
(all variants), Anthropic/OpenAI API keys, Stripe live keys, Slack tokens, private
key headers, MongoDB/PostgreSQL/MySQL connection strings.

**Edit/Write/MultiEdit branch** (lines 119-176):
- Path traversal: blocks `../` in file_path
- Secret detection: skips test files and `.env.example`/`.env.template`; scans non-comment lines
- Injection detection (config/doc files only — `.md`, `.txt`, `.yaml`, `.yml`, `.json`):
  common prompt injection phrases and markers
- Base64 payload: blocks strings over 500 chars in config files

#### config-protection.mjs (`.iago/hooks/config-protection.mjs`, lines 1-88)

Fires on Edit/Write/MultiEdit.

Exact name blocks: `biome.json`, `biome.jsonc`, `tsconfig.json`, `.gitignore`, `Dockerfile`

Pattern blocks: `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `prettier.config.*`,
`tsconfig.*.json`, `vite.config.*`, `tailwind.config.*`, `postcss.config.*`,
`.env` (and variants), `docker-compose.*`, `*.lock`

`package.json` partial protection: blocks edits containing fields `"scripts"`, `"engines"`,
or `"overrides"`; allows dependency edits; allows full creation of new file.

#### commit-quality.mjs (`.iago/hooks/commit-quality.mjs`, lines 1-153)

Fires on Bash tool when command matches `git commit`. Validates:
- Conventional prefix: `feat|fix|refactor|docs|chore|research|build|test|ci|perf|style|revert`
- Subject max 72 chars
- Non-empty description after prefix
- No WIP commits on main/master
- Staged diff secret scan (same patterns as safety-guard) — blocks if found
- Console.log warning: non-blocking, counts occurrences
- Handles heredoc messages: `$(cat <<'EOF'\n...\nEOF)` correctly extracts subject line

#### post-edit-typecheck.mjs (`.iago/hooks/post-edit-typecheck.mjs`, lines 1-81)

PostToolUse on Edit. For `.ts`/`.tsx` files only:
- Finds nearest `tsconfig.json` by walking up the directory tree
- Runs `npx tsc --noEmit --pretty false -p <tsconfig>`
- Filters output to only show errors in the edited file
- Non-blocking — writes `hookSpecificOutput` (warning), not `decision: block`

#### context-persistence.mjs (`.iago/hooks/context-persistence.mjs`)

Three events:
- `session-start`: reads `HANDOFF.json` if exists, loads prior session context
- `pre-compact`: saves snapshot to `.iago/state/sessions/<session-id>.json`
- `stop`: writes final snapshot; prunes to 10 most recent sessions (MAX_SESSIONS = 10)

---

### Sub-question 4: How do GitHub Actions workflows work?

**Sources:** `.github/workflows/claude.yml`, `.github/workflows/claude-review-fix.yml`

#### claude.yml — The review trigger

Triggers: `issue_comment:created`, `pull_request_review_comment:created`,
`issues:opened/assigned`, `pull_request:opened/reopened/assigned`

Job condition (lines 15-23): fires when `@claude` in comment body AND
`(issue.state == 'open' OR not a PR issue)`.

Steps:
1. `actions/checkout@v4` with `fetch-depth: 0`
2. `anthropics/claude-code-action@v1` with `CLAUDE_CODE_OAUTH_TOKEN`
3. **Signal step** (lines 47-59): after action completes, posts a NEW comment
   `[claude-review-complete] Claude finished reviewing this PR.` via `secrets.GH_PAT`
   (not `GITHUB_TOKEN` — GITHUB_TOKEN comments cannot trigger other workflows).

The action edits its own comment (checklist format) but `issue_comment:created`
fires only once at checklist creation. The separate signal comment triggers the fix
workflow.

#### claude-review-fix.yml — The fix loop

Trigger: `issue_comment:created` containing `[claude-review-complete]`

Condition: `github.event.issue.pull_request && github.event.issue.state == 'open'`

**Check for findings and round limit step** (JavaScript, lines 34-136):

Clean detection:
1. Fetches all PR comments via `github.paginate`
2. Gets latest `claude[bot]` comment body
3. Clean signals: 15+ hardcoded phrases ("no issues found", "all findings resolved", etc.)
4. `hasActiveFinding`: regex `/\b(critical|important|minor)\s*[\-—:#\d(]/i` on review text
5. `hasPassVerdict`: "verdict: pass" regex AND no critical/important markers
6. `allChecked`: all `- [x]` with no `- [ ]` AND no severity labels
7. Loop guard: checks if `## Review Summary` already posted (prevents summary→signal→summary loop)
8. Also checks inline PR review comments from last 30 minutes

Round counting (line 125): counts comments containing `[review-fix-loop]` (any author,
since GH_PAT posts as token owner). `round = count + 1`. MAX_ROUNDS = 5.

Outputs: `skip`, `clean`, `round`, `max_rounds`, `head_ref`

**Fix agent** (lines 163-189, only if `skip != 'true'`):
- `anthropics/claude-code-action@v1`
- `claude_args: '--max-turns 50 --allowedTools "Edit,Write,Read,Bash,Glob,Grep"'`
- Fetches latest `claude[bot]` review via `gh api`, fixes by severity, commits + pushes

**Fallback push** (always runs if not skipped, lines 191-200):
- `git status --porcelain` — commits any changes the fix agent left uncommitted

**Re-tag step** (always runs if not skipped and fix not skipped, lines 205-222):
- Posts `[review-fix-loop] @claude Review again. Round N complete. <suffix>` via GH_PAT
- Triggers `claude.yml` — loop continues

**Clean path** (lines 224-267, if `clean == 'true'`):
- Separate `anthropics/claude-code-action@v1` for summary generation
- `claude_args: '--max-turns 10 --allowedTools "Read,Bash(gh:*),Glob,Grep"'`
- Generates `## Review Summary` comment covering all rounds
- No @claude tag — loop terminates

---

### Sub-question 5: How do skills wire together the pipeline?

**Sources:** `.claude/skills/iago-execute/SKILL.md`, `iago-quick/SKILL.md`, `iago-fast/SKILL.md`

#### /iago:execute

Invokes `scripts/execute-pipeline.sh` via Bash tool (timeout: 600000ms = 10 min):

```bash
# Default (auto-review):
bash "$SCRIPT" --plan {plan_path} --project-dir "$PROJECT_DIR"
# With --no-review:
bash "$SCRIPT" --plan {plan_path} --project-dir "$PROJECT_DIR" --no-tag
```

Root resolution order (SKILL.md lines 62-67):
1. `$IAGO_OS_ROOT` env var
2. `git rev-parse --show-toplevel`
3. ERROR if neither has `scripts/execute-pipeline.sh`

Git sync before first plan only: `git checkout main && git pull origin main`
Between plans: NO git sync — next plan builds on prior plan's commits (stacked).

`--plan {plan-id}` flag filters to a single plan (e.g. `--plan 02b`) for reruns.

#### /iago:quick

Same pipeline script, different defaults:
- Creates `.iago/plans/quick-{YYMMDD}-{slug}.md` first (max 3 tasks)
- Passes `--no-tag` by default; `--review` flag omits `--no-tag`
- Optional composable flags: `--discuss`, `--research`, `--verify`

#### /iago:fast

Does NOT invoke the pipeline script. Orchestrator executes entirely inline:
- ≤3 file edits, no new deps, obvious fix (all conditions must hold)
- Direct Edit/Write in orchestrator session
- Minimal verify: `tsc --noEmit` or `vitest run` or `biome check`
- Conventional commit + STATE.md log entry only
- No plan file, no review, no PR, no agents

---

## Key Integration Points (file:line)

| Component | File | Lines |
|-----------|------|-------|
| `run_claude` wrapper | `scripts/execute-pipeline.sh` | 58-67 |
| Temp file setup + EXIT trap | `scripts/execute-pipeline.sh` | 44-54 |
| Stress test stage | `scripts/execute-pipeline.sh` | 87-169 |
| Implement stage | `scripts/execute-pipeline.sh` | 171-215 |
| Build gate + retry | `scripts/execute-pipeline.sh` | 217-276 |
| Review stage + local fix loop | `scripts/execute-pipeline.sh` | 278-425 |
| Codex + Claude adversarial fallback | `scripts/execute-pipeline.sh` | 427-481 |
| Codex fix | `scripts/execute-pipeline.sh` | 483-541 |
| PR creation (sonnet) | `scripts/execute-pipeline.sh` | 543-577 |
| @claude tagging (sonnet) | `scripts/execute-pipeline.sh` | 578-625 |
| Summary write | `scripts/execute-pipeline.sh` | 632-667 |
| Hook event registration | `.claude/settings.json` | 1-106 |
| Destructive command blocks | `.iago/hooks/safety-guard.mjs` | 12-26 |
| Secret detection patterns | `.iago/hooks/safety-guard.mjs` | 29-47 |
| Protected config file list | `.iago/hooks/config-protection.mjs` | 12-32 |
| Conventional commit validation | `.iago/hooks/commit-quality.mjs` | 17, 72-98 |
| Signal comment (GH Actions) | `.github/workflows/claude.yml` | 47-59 |
| Clean detection logic | `.github/workflows/claude-review-fix.yml` | 65-100 |
| Round counting | `.github/workflows/claude-review-fix.yml` | 121-136 |
| Fix agent invocation | `.github/workflows/claude-review-fix.yml` | 163-189 |
| Executor base agent | `.claude/agents/executor.md` | 1-70 |
| Analyst base agent | `.claude/agents/analyst.md` | 1-68 |
| Operator base agent | `.claude/agents/operator.md` | 1-54 |
| Fullstack profile | `.claude/agents/profiles/fullstack.md` | 1-30 |
| Research profile (dynamic caps) | `.claude/agents/profiles/research.md` | 1-31 |
| execute skill — path resolution | `.claude/skills/iago-execute/SKILL.md` | 62-67 |
| execute skill — pipeline call | `.claude/skills/iago-execute/SKILL.md` | 88-91 |
| quick skill — no-tag default | `.claude/skills/iago-quick/SKILL.md` | 103-105 |
| fast skill — no pipeline path | `.claude/skills/iago-fast/SKILL.md` | 44-46 |

---

## Sources

- `scripts/execute-pipeline.sh` (668 lines) — complete pipeline implementation
- `.claude/agents/executor.md`, `analyst.md`, `operator.md` — base agent definitions
- `.claude/agents/profiles/fullstack.md`, `research.md` — profile examples
- `.claude/agents/capabilities/` (13 files) — capability module catalog
- `.claude/settings.json` — hook event/matcher/command registration
- `.iago/hooks/safety-guard.mjs` — destructive command + secret + injection blocking
- `.iago/hooks/config-protection.mjs` — protected file list
- `.iago/hooks/commit-quality.mjs` — commit message validation + staged diff scan
- `.iago/hooks/post-edit-typecheck.mjs` — post-edit TS error surfacing
- `.iago/hooks/context-persistence.mjs` — session snapshot management
- `.github/workflows/claude.yml` — review trigger + signal comment
- `.github/workflows/claude-review-fix.yml` — fix loop with round counting
- `.claude/skills/iago-execute/SKILL.md` — execute skill
- `.claude/skills/iago-quick/SKILL.md` — quick skill
- `.claude/skills/iago-fast/SKILL.md` — fast skill (bypass path)
- `scripts/review-checks/` (8 modules) — review domain checklists

---

## Recommendation

**Decision:** Integration surface is well-defined. Replace `run_claude` wrapper
with Agent SDK calls for structured output; leave hooks and GH Actions untouched.

**Confidence:** High — all source files read directly, no inference needed.

**Reasoning:** The pipeline is a bash script calling `claude -p` as a subprocess
with stdout captured as text. Agent SDK integration most naturally replaces the
`run_claude` wrapper with programmatic SDK invocations, gaining streaming output,
structured tool-use events, and proper error types instead of regex-parsed stdout.
The hook system (Node MJS, stdin/stdout JSON protocol) is completely independent and
needs no changes. The GitHub Actions workflows use `anthropics/claude-code-action@v1`
which is already SDK-backed — those are unaffected.

**Next step:** Decide scope: (A) replace `run_claude` only — lowest disruption,
bash stays as orchestrator; or (B) rewrite pipeline as a Node/TS process using SDK
agent loops — higher capability but full rewrite. Option A is a drop-in change.

**Risk if wrong:** If subprocess isolation is abandoned in a full rewrite, context
bleed between stages becomes possible. The current model's main safety property is
that each stage starts from zero context. Any SDK-based replacement must preserve
that per-stage isolation to maintain pipeline correctness.
