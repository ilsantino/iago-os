# Plan: Fix Adversarial Review Findings — 4x `/iago:quick` Runs

## Source
Adversarial review conducted 2026-04-07 by 6 parallel review agents.

## Strategy

Split 10 fixes into 4 sequential `/iago:quick` runs (max 3 tasks each).
Each run goes through the full 5-stage pipeline via `execute-pipeline.sh`.
Grouped by risk domain — highest-risk first.

---

## Run 1: Security Hardening (hooks + pipeline)

### Task 1: Fix fail-closed hooks (PreToolUse only)
- **files:** `.iago/hooks/safety-guard.mjs`, `.iago/hooks/config-protection.mjs`, `.iago/hooks/commit-quality.mjs`
- **action:** In each file, change `main().catch(() => process.exit(0))` to `main().catch((err) => { process.stderr.write("iaGO hook crash: " + (err?.message || "unknown") + "\n"); process.exit(2); })`. This makes PreToolUse guards fail-closed — a crash blocks the operation instead of silently allowing it. Do NOT change the PostToolUse hooks (post-edit-format, post-edit-typecheck, post-edit-console-warn) — those are advisory and fail-open is correct behavior for them.
- **verify:** `grep -n "process.exit(0)" .iago/hooks/safety-guard.mjs .iago/hooks/config-protection.mjs .iago/hooks/commit-quality.mjs`
- **expected:** No output (no remaining exit(0) in catch blocks of these 3 files)

### Task 2: Add secret detection to Bash commands in safety-guard
- **files:** `.iago/hooks/safety-guard.mjs`
- **action:** Inside the `if (toolName === "Bash")` block (after the destructive patterns loop, around line 103), add a secret detection loop that checks `command` against `SECRET_PATTERNS` where `scope` is `"both"`. For matches, block with reason `"iaGO: Possible {msg} in Bash command. Use environment variables instead."`. Skip patterns where `scope` is `"writes"` (hardcoded password, generic secret — those only apply to file writes). The first 12 patterns already have `scope: "both"`. The connection string patterns (MongoDB, PostgreSQL, MySQL) also have `scope: "both"`. Only skip `scope: "writes"` entries.
- **verify:** `node -e "const code = require('fs').readFileSync('.iago/hooks/safety-guard.mjs','utf8'); console.log(code.includes('SECRET_PATTERNS') && /if.*toolName.*Bash[\s\S]*?SECRET_PATTERNS/.test(code) ? 'OK' : 'FAIL')"`
- **expected:** `OK`

### Task 3: Fix unsafe git add -A in pipeline script
- **files:** `scripts/execute-pipeline.sh`
- **action:** Replace bare `git add -A` on lines 116 and 192 with `git add -A -- ':!.env' ':!.env.*' ':!*.pem' ':!*.key'`. This uses git pathspec exclusions to prevent staging secrets. Both occurrences must be fixed.
- **verify:** `grep -c "git add -A$" scripts/execute-pipeline.sh`
- **expected:** `0` (no bare git add -A remaining)

---

## Run 2: Agent & Skill Config (model routing + paths)

### Task 1: Reconcile model routing across all agent configs
- **files:** `.claude/agents/executor.md`, `.claude/agents/profiles/fullstack.md`, `.claude/agents/profiles/frontend.md`, `.claude/agents/profiles/backend.md`, `.claude/agents/profiles/debug.md`, `.claude/agents/profiles/e2e.md`, `.claude/agents/profiles/review-single.md`, `.claude/agents/profiles/review-full.md`
- **action:** Per CLAUDE.md routing table ("Opus for code-writing, Sonnet for review"): Change `executor.md` from `model: sonnet` to `model: opus`. Change code-writing profiles to `model: opus`: fullstack.md (auto→opus), frontend.md (auto→opus), backend.md (auto→opus), debug.md (auto→opus), e2e.md (sonnet→opus). Change review profiles to `model: sonnet`: review-single.md (auto→sonnet), review-full.md (auto→sonnet). Leave all other agent files unchanged — they are already correct.
- **verify:** `grep "model:" .claude/agents/executor.md .claude/agents/profiles/fullstack.md .claude/agents/profiles/frontend.md .claude/agents/profiles/backend.md .claude/agents/profiles/debug.md .claude/agents/profiles/e2e.md .claude/agents/profiles/review-single.md .claude/agents/profiles/review-full.md`
- **expected:** executor=opus, fullstack=opus, frontend=opus, backend=opus, debug=opus, e2e=opus, review-single=sonnet, review-full=sonnet

### Task 2: Fix hardcoded path and casing in iago-execute skill
- **files:** `.claude/skills/iago-execute/skill.md` (rename to `SKILL.md`)
- **action:** First rename `skill.md` to `SKILL.md` for consistency with all 32 other skills. Then replace the hardcoded path block at lines 54-57. Change `IAGO_ROOT="/c/Users/sanal/dev/iago-os"` to use dynamic resolution: `IAGO_ROOT="${IAGO_OS_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"`. Add a comment: `# Dynamic resolution. Override with IAGO_OS_ROOT env var for cross-machine use.` This works on both Windows Git Bash and Mac.
- **verify:** `test -f .claude/skills/iago-execute/SKILL.md && ! test -f .claude/skills/iago-execute/skill.md && grep -c "IAGO_OS_ROOT" .claude/skills/iago-execute/SKILL.md`
- **expected:** `1`

### Task 3: Mark aspirational skills as experimental
- **files:** `.claude/skills/autonomous-loops/SKILL.md`, `.claude/skills/continuous-agent-loop/SKILL.md`, `.claude/skills/agent-payment-x402/SKILL.md`
- **action:** In each file's YAML frontmatter, add `experimental: true` after the description field. After the frontmatter closing `---`, before the first heading, add: `> **Experimental:** This skill describes behavior that may exceed current Claude Code capabilities. Cost ceilings, context introspection, and persistent daemon loops are not enforced by the platform. Use with awareness of these limitations.`
- **verify:** `grep -l "experimental: true" .claude/skills/autonomous-loops/SKILL.md .claude/skills/continuous-agent-loop/SKILL.md .claude/skills/agent-payment-x402/SKILL.md | wc -l`
- **expected:** `3`

---

## Run 3: Housekeeping (cleanup + state)

### Task 1: Remove ECC source comments from skill files
- **files:** 16 skill files in `.claude/skills/`
- **action:** Remove all HTML comments matching `<!-- Source: ... -->` from these files: `brainstorming/SKILL.md`, `prompt-optimizer/SKILL.md`, `visa-doc-translate/SKILL.md`, `autonomous-loops/SKILL.md`, `continuous-agent-loop/SKILL.md`, `agent-payment-x402/SKILL.md`, `liquid-glass-design/SKILL.md`, `santa-method/SKILL.md`, `healthcare-phi-compliance/SKILL.md`, `deep-research/SKILL.md`, `content-engine/SKILL.md`, `investor-materials/SKILL.md`, `investor-outreach/SKILL.md`, `frontend-slides/SKILL.md`, `writing-plans/SKILL.md`, `subagent-driven-development/SKILL.md`. Each is a single line — delete the entire line (and any resulting blank line after frontmatter).
- **verify:** `grep -rl "<!-- Source:" .claude/skills/ | wc -l`
- **expected:** `0`

### Task 2: Archive research/ directory
- **files:** `research/*` (26 files)
- **action:** Run `mkdir -p docs/archive && git mv research/ docs/archive/research/`. This preserves git history while moving dead research files out of the repo root.
- **verify:** `test -d docs/archive/research && ! test -d research && ls docs/archive/research/*.md | wc -l`
- **expected:** `26`

### Task 3: Create root STATE.md
- **files:** `.iago/STATE.md`
- **action:** Create `.iago/STATE.md` using the template at `templates/internal-project/.iago/STATE.md.template` as reference. Fill in: project = iaGO-OS, phase = hardening, status = in-progress. Add a Quick Tasks table with entry for this adversarial review fix (date: 2026-04-07, mode: quick, description: fix adversarial review findings). Keep under 80 lines per CLAUDE.md rule.
- **verify:** `test -f .iago/STATE.md && wc -l < .iago/STATE.md`
- **expected:** File exists, line count < 80

---

## Run 4: Harden /subagent-driven-development

### Task 1: Add pipeline integration option to SDD
- **files:** `.claude/skills/subagent-driven-development/SKILL.md`
- **action:** Add a `--pipeline` flag to the Arguments section. When set, SDD runs `scripts/execute-pipeline.sh` per task instead of dispatching in-session agents. This gives SDD the same 5-stage review isolation as `/iago:quick` and `/iago:execute`. Document in Steps section: "If `--pipeline` is set, for each task: write a single-task plan to `.iago/plans/sdd-{slug}-{N}.md`, then run `bash scripts/execute-pipeline.sh --plan {path} --project-dir {dir}`. Skip steps 3-4 (review) since the pipeline handles them." Default behavior (no flag) stays unchanged.
- **verify:** `grep -c "\-\-pipeline" .claude/skills/subagent-driven-development/SKILL.md`
- **expected:** At least `3` (in Arguments, Steps, and Boundaries sections)

### Task 2: Add Codex fallback to SDD and code-review
- **files:** `.claude/skills/subagent-driven-development/SKILL.md`, `.claude/skills/code-review/SKILL.md`
- **action:** In SDD step 4b, change the Codex adversarial review from mandatory-no-fallback to mandatory-with-fallback. After "dispatch `/codex:adversarial-review`", add: "If Codex CLI is unavailable (`command -v codex` fails), fall back to a Claude adversarial review session: dispatch `review-single` profile with the diff and an adversarial prompt targeting auth bypass, data loss, race conditions, and business logic errors. Log that Codex was unavailable." Apply the same fallback pattern in `code-review/SKILL.md` step 5 (which also references Codex as mandatory).
- **verify:** `grep -c "codex.*unavailable\|fallback\|fall back" .claude/skills/subagent-driven-development/SKILL.md .claude/skills/code-review/SKILL.md`
- **expected:** At least 1 match per file (2 total minimum)

### Task 3: Remove ECC comment and update SDD description
- **files:** `.claude/skills/subagent-driven-development/SKILL.md`
- **action:** The `<!-- Source: ... -->` comment was already removed in Run 3 Task 1. In this task, update the skill description in frontmatter to mention the new `--pipeline` flag: change description to `Use when executing a multi-task implementation plan. Supports --pipeline for full 5-stage review isolation. Not when task is trivial (single file, <5 min — use /iago:fast instead) or when executing a ROADMAP phase (use /iago:execute instead).` Also update available-skills.md entry for `/subagent-driven-development` to mention `--pipeline` flag.
- **verify:** `grep "pipeline" .claude/skills/subagent-driven-development/SKILL.md .claude/rules/available-skills.md | wc -l`
- **expected:** At least `4` (description + arguments + steps + available-skills entry)

---

## Aggregate Verification

After all 4 runs complete:
```bash
# Security: hooks fail-closed
grep -c "process.exit(0)" .iago/hooks/safety-guard.mjs .iago/hooks/config-protection.mjs .iago/hooks/commit-quality.mjs
# → 0 for each

# Security: Bash secret detection
node -e "const c=require('fs').readFileSync('.iago/hooks/safety-guard.mjs','utf8'); process.exit(/Bash[\s\S]*SECRET_PATTERNS/.test(c) ? 0 : 1)"

# Security: no bare git add -A
grep -c "git add -A$" scripts/execute-pipeline.sh
# → 0

# Config: no hardcoded path
grep -c "sanal" .claude/skills/iago-execute/SKILL.md
# → 0

# Config: model routing
grep "model:" .claude/agents/executor.md
# → opus

# Cleanup: no ECC comments
grep -rl "<!-- Source:" .claude/skills/ | wc -l
# → 0

# Cleanup: research archived
test -d docs/archive/research && echo "OK"

# State: STATE.md exists
test -f .iago/STATE.md && echo "OK"

# SDD: pipeline flag exists
grep -c "pipeline" .claude/skills/subagent-driven-development/SKILL.md
# → 3+
```
