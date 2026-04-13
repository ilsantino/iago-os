# Plan: Agent v2 — Profiles + Cutover

## Source
Spec: docs/specs/agent-architecture-v2.md (Phase 3)

## Wave 1: Profile Files

All profiles are independent. Each profile file has frontmatter (name, description, base, model, maxTurns, capabilities list) and body (match signals, review pairing).

### Task 1: Create fullstack, frontend, and backend profiles
- **files:** `.claude/agents/profiles/fullstack.md`, `.claude/agents/profiles/frontend.md`, `.claude/agents/profiles/backend.md`
- **action:** Create three executor-based implementation profiles. `fullstack`: capabilities [react-19, dynamodb, lambda, tdd, forms], model auto, maxTurns 25, match signals: files in both src/ and amplify/. `frontend`: capabilities [react-19, tdd, forms], model auto, maxTurns 25, match signals: files only in src/features/ or src/components/. `backend`: capabilities [dynamodb, lambda, cognito, tdd], model auto, maxTurns 25, match signals: files only in amplify/. Each profile includes a "Review Pairing" section noting to dispatch review-single or review-full after completion.
- **verify:** `ls .claude/agents/profiles/fullstack.md .claude/agents/profiles/frontend.md .claude/agents/profiles/backend.md && echo "OK"`
- **expected:** `OK`

### Task 2: Create review-single, review-full, and security-audit profiles
- **files:** `.claude/agents/profiles/review-single.md`, `.claude/agents/profiles/review-full.md`, `.claude/agents/profiles/security-audit.md`
- **action:** Create three analyst-based review profiles. `review-single`: capabilities [security, review-spec, review-quality], model auto, maxTurns 15, match signals: review.mode is "single" in config.json, one-pass review. `review-full`: capabilities [security, review-spec, review-quality], model auto, maxTurns 18, match signals: review.mode is "full", spec check first with gating (Critical → stop), then quality. `security-audit`: capabilities [security, cognito, review-quality], model opus (hardcoded), maxTurns 18, match signals: changes touch auth/payment/data-access code.
- **verify:** `ls .claude/agents/profiles/review-single.md .claude/agents/profiles/review-full.md .claude/agents/profiles/security-audit.md && echo "OK"`
- **expected:** `OK`

### Task 3: Create research and debug profiles (dynamic)
- **files:** `.claude/agents/profiles/research.md`, `.claude/agents/profiles/debug.md`
- **action:** Create two profiles with dynamic capability selection. `research`: base operator, model sonnet, maxTurns 20, capabilities listed as "dynamic — orchestrator selects based on topic" with examples (React topic → inject react-19, DynamoDB topic → inject dynamodb, general → base only). Match signals: task type is research or investigation. `debug`: base executor, model auto, maxTurns 20, capabilities listed as "dynamic — orchestrator selects based on error type" with examples (TS error → inject relevant stack module, build error → inject lambda or react-19 based on path, test failure → inject tdd + relevant stack). Match signals: build/typecheck/lint failure.
- **verify:** `ls .claude/agents/profiles/research.md .claude/agents/profiles/debug.md && echo "OK"`
- **expected:** `OK`

### Task 4: Create e2e, infra, schema, and content profiles
- **files:** `.claude/agents/profiles/e2e.md`, `.claude/agents/profiles/infra.md`, `.claude/agents/profiles/schema.md`, `.claude/agents/profiles/content.md`
- **action:** Create four specialist profiles. `e2e`: base executor, capabilities [e2e, react-19], model sonnet, maxTurns 25, match signals: task writes Playwright tests or touches e2e/ directory. `infra`: base operator, capabilities [infra], model sonnet, maxTurns 20, match signals: task involves AWS CLI, Amplify deploy, CDK, or resource management. `schema`: base analyst, capabilities [dynamodb], model sonnet, maxTurns 15, match signals: task is schema design or access pattern analysis. `content`: base operator, capabilities [content], model sonnet, maxTurns 20, match signals: task is content writing (articles, investor materials, outreach).
- **verify:** `ls .claude/agents/profiles/e2e.md .claude/agents/profiles/infra.md .claude/agents/profiles/schema.md .claude/agents/profiles/content.md && echo "OK"`
- **expected:** `OK`

## Wave 2: Skill Updates

Depend on profiles existing. Update all skills that dispatch agents to use profile-based dispatch language instead of agent names.

### Task 5: Update iago-execute skill for profile-based dispatch
- **files:** `.claude/skills/iago-execute/SKILL.md`
- **action:** Replace all agent name references with profile-based dispatch. Step 3a: change "Dispatch the `implementer` agent" to "Match task to a profile (fullstack/frontend/backend based on file paths, or explicit profile in plan). Compose prompt from base + capabilities + learnings + task. Dispatch via the profile's base agent." Step 3c: change "Dispatch `code-reviewer`" to "Dispatch `review-single` or `review-full` profile based on config.json review.mode." Replace `spec-reviewer` and `code-quality-reviewer` references with review-full profile internal gating. Step 3e: replace `tdd-guide` with "re-dispatch using the same profile with tdd capability ensured" and `build-error-resolver` with "dispatch `debug` profile." Update preconditions to reference base agents (executor, analyst, operator) instead of old agent names.
- **verify:** `grep -q "profile" .claude/skills/iago-execute/SKILL.md && ! grep -q "implementer" .claude/skills/iago-execute/SKILL.md && echo "OK"`
- **expected:** `OK`

### Task 6: Update subagent-driven-development skill for profile-based dispatch
- **files:** `.claude/skills/subagent-driven-development/SKILL.md`
- **action:** Replace all agent name references with profile-based dispatch. Step 2a: change "Dispatch `implementer` agent (Sonnet)" to "Match task to a profile based on file paths. Compose prompt from base + capabilities + learnings + task. Dispatch via the profile's base agent with model from profile." Step 3: change "Dispatch `code-reviewer`" to "Dispatch `review-single` profile" and "--full-review" dispatches to "Dispatch `review-full` profile." Replace `spec-reviewer` and `code-quality-reviewer` references with review profiles. Remove hardcoded "(Sonnet)" — model comes from profile.
- **verify:** `grep -q "profile" .claude/skills/subagent-driven-development/SKILL.md && ! grep -q "implementer" .claude/skills/subagent-driven-development/SKILL.md && echo "OK"`
- **expected:** `OK`

### Task 7: Update code-review skill for profile-based dispatch
- **files:** `.claude/skills/code-review/SKILL.md`
- **action:** Replace all agent name references with profile-based dispatch. Step 2: change "Dispatch `code-reviewer` agent (Sonnet)" to "Dispatch `review-single` profile." Change "--full flag" section from dispatching `spec-reviewer` + `code-quality-reviewer` to dispatching `review-full` profile. Remove hardcoded "(Sonnet)" references. Add note: "For security-critical changes (auth/payment/data-access), automatically upgrade to `security-audit` profile."
- **verify:** `grep -q "review-single" .claude/skills/code-review/SKILL.md && ! grep -q "code-reviewer" .claude/skills/code-review/SKILL.md && echo "OK"`
- **expected:** `OK`

## Wave 3: Cutover

Depends on all skills being updated. Delete old agent files — they're replaced by bases + capabilities + profiles.

### Task 8: Delete old implementation agent files
- **files:** `.claude/agents/implementer.md`, `.claude/agents/tdd-guide.md`, `.claude/agents/build-error-resolver.md`
- **action:** Delete these 3 old role-based agent files that are replaced by executor base + capability profiles: `implementer.md` (replaced by fullstack/frontend/backend profiles), `tdd-guide.md` (absorbed into executor + tdd capability), `build-error-resolver.md` (replaced by debug profile). If anything breaks, `git checkout HEAD~1 -- .claude/agents/` restores them.
- **verify:** `test ! -f .claude/agents/implementer.md && test ! -f .claude/agents/tdd-guide.md && test ! -f .claude/agents/build-error-resolver.md && echo "OK"`
- **expected:** `OK`

### Task 9: Delete old reviewer agent files
- **files:** `.claude/agents/code-reviewer.md`, `.claude/agents/spec-reviewer.md`, `.claude/agents/code-quality-reviewer.md`
- **action:** Delete these 3 old reviewer agent files replaced by analyst base + review profiles: `code-reviewer.md` (replaced by review-single profile), `spec-reviewer.md` (replaced by review-full profile spec gating), `code-quality-reviewer.md` (replaced by review-full profile quality phase). Profiles in `.claude/agents/profiles/` now handle all review dispatch.
- **verify:** `test ! -f .claude/agents/code-reviewer.md && test ! -f .claude/agents/spec-reviewer.md && test ! -f .claude/agents/code-quality-reviewer.md && echo "OK"`
- **expected:** `OK`

### Task 10: Delete old specialist agent files
- **files:** `.claude/agents/researcher.md`, `.claude/agents/e2e-runner.md`, `.claude/agents/content-writer.md`
- **action:** Delete these 3 old specialist agent files replaced by operator/executor bases + profiles: `researcher.md` (replaced by research profile on operator base), `e2e-runner.md` (replaced by e2e profile on executor base), `content-writer.md` (replaced by content profile on operator base).
- **verify:** `test ! -f .claude/agents/researcher.md && test ! -f .claude/agents/e2e-runner.md && test ! -f .claude/agents/content-writer.md && echo "OK"`
- **expected:** `OK`

### Task 11: Delete old infra and data agent files
- **files:** `.claude/agents/infra-runner.md`, `.claude/agents/data-modeler.md`
- **action:** Delete these 2 remaining old agent files: `infra-runner.md` (replaced by infra profile on operator base), `data-modeler.md` (replaced by schema profile on analyst base). After this task, `.claude/agents/` should contain only `executor.md`, `analyst.md`, `operator.md`, plus the `capabilities/` and `profiles/` directories.
- **verify:** `test ! -f .claude/agents/infra-runner.md && test ! -f .claude/agents/data-modeler.md && ls .claude/agents/*.md | sort && echo "OK"`
- **expected:** Lists executor.md, analyst.md, operator.md then `OK`

## Verification
```bash
# Old agents gone
ls .claude/agents/*.md | sort  # Should show only executor.md, analyst.md, operator.md

# New structure in place
ls .claude/agents/capabilities/*.md | wc -l   # Should be 12
ls .claude/agents/profiles/*.md | wc -l       # Should be 12

# Skills reference profiles, not old agents
grep -rL "profile" .claude/skills/iago-execute/SKILL.md .claude/skills/subagent-driven-development/SKILL.md .claude/skills/code-review/SKILL.md  # Should return nothing (all files contain "profile")
```
