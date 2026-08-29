---
phase: feature-skill-routing
plan: 02
wave: 2
depends_on: [01]
context: inline
created: 2026-08-17
source: feature
---

# Plan: feature-skill-routing/02-triage-and-discovery

## Goal

Make the 14 zero-invocation skills reachable, delete only the ones the evidence actually condemns, and retire the never-fired `eval.md` convention in favour of the Plan 01 router.

## Triage — and why only 2 of the 14 get deleted

The instruction for this session proposed 7 deletions. **The evidence does not support that**, because of audit finding F3: `usage-tracker.mjs` is wired through `$CLAUDE_PROJECT_DIR` in **iago-os's own** `.claude/settings.json`, and no client project carries a usage log. All 345 recorded invocations describe work *on the harness*, never work *delivered with* it.

So a zero count means two different things depending on where a skill naturally runs.

**Corroborating evidence:** `iago-init` records **3** invocations. It is definitionally run once per project, and `clients/` holds **7** project directories. The gap is direct proof that project-bootstrap skills execute outside this repo's telemetry.

| Skill | Natural home | Verdict |
|---|---|---|
| `code-review` | iago-os | **DELETE — assigned to W3, not this plan** (duplicate of dual-adversarial standard mode) |
| `iago-pause` | iago-os | **DELETE** — superseded by the Stop/PreCompact `context-persistence.mjs` hooks that capture session state automatically |
| `iago-agents` | iago-os | route |
| `prompt-optimizer` | iago-os | route |
| `content-engine` | iago-os | route |
| `frontend-slides` | iago-os | route |
| `industry-patterns` | iago-os | route |
| `iago-scaffold` | client repo | route — **unjudgeable**, runs in the new project dir |
| `iago-onboard` | client repo | route — **unjudgeable** |
| `iago-proposal` | client repo | route — **unjudgeable** |
| `iago-n8n` | client repo | route — **unjudgeable** |
| `investor-materials` | ad-hoc | route — **unjudgeable** |
| `investor-outreach` | ad-hoc | route — **unjudgeable** |
| `visa-doc-translate` | personal | route — **unjudgeable**, personal use never appears in project telemetry |

**Net: 2 deletions, 12 routed.** No further deletion until F3 is fixed — see Follow-on.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| delete | `.claude/skills/iago-pause/` | Superseded by session hooks |
| modify | 12 × `.claude/skills/{name}/SKILL.md` | Sharpen triggers and anti-triggers for routing |
| modify | `scripts/skill-router/evals/intents.jsonl` | Cover the 12 revived skills |
| modify | `.claude/rules/skill-authoring.md` | Replace the eval.md convention with the router |
| modify | `.claude/rules/available-skills.md` | Document router usage and the discovery table |

## Tasks

### Task 1: Delete the superseded pause skill
- **files:** `.claude/skills/iago-pause/`
- **action:** Remove the `iago-pause` skill directory. Grep the repo for `iago-pause` references and remove or redirect each one, noting that `.iago/hooks/context-persistence.mjs` already captures session state on Stop and PreCompact. Do **not** touch `code-review` — W3 owns that deletion and a second plan removing it would collide.
- **verify:** `ls .claude/skills/ | wc -l; grep -rl "iago-pause" .claude/ docs/ README.md 2>/dev/null | wc -l`
- **expected:** `29` and `0`

### Task 2: Sharpen triggers on the 12 routed skills
- **files:** the 12 `.claude/skills/{name}/SKILL.md` files listed in the triage table
- **action:** For each, rewrite the frontmatter `description` so it opens with concrete "Use when …" phrasings in the words Santiago would actually type, and closes with an explicit anti-trigger naming the skill to use instead. Keep each description under 60 words and do not restate the skill's own title back at itself.
- **verify:** `node scripts/skill-router/route.mjs "write a client proposal with scope timeline and cost" | head -1`
- **expected:** `iago-proposal` ranked first.

### Task 3: Extend the eval set to cover the revived skills
- **files:** `scripts/skill-router/evals/intents.jsonl`
- **action:** Add at least two intents per revived skill (24 minimum), each phrased as a natural request rather than a paraphrase of the description. Include at least four adversarial near-miss pairs that separate genuinely confusable skills — `content-engine` vs `investor-materials`, `iago-scaffold` vs `iago-onboard`, `iago-agents` vs `iago-n8n`, `deep-research` vs `industry-patterns`.
- **verify:** `node scripts/skill-router/score.mjs | tail -1`
- **expected:** JSON summary with `accuracy` ≥ 0.85 and an empty or near-empty `ambiguous` list for the four near-miss pairs.

### Task 4: Retire the eval.md convention
- **files:** `.claude/rules/skill-authoring.md`
- **action:** Replace the "Routing eval for overlapping skills" section — which has mandated a manual 0-2 scoring `eval.md` per overlapping skill and produced zero files across 30 skills — with the router workflow: add intents to `scripts/skill-router/evals/intents.jsonl`, run `score.mjs`, and land the change only when the ratchet passes.
- **verify:** `grep -c "eval.md" .claude/rules/skill-authoring.md; grep -c "skill-router" .claude/rules/skill-authoring.md`
- **expected:** `0` and `1` or more.

### Task 5: Make the router discoverable
- **files:** `.claude/rules/available-skills.md`
- **action:** Add a short section documenting `node scripts/skill-router/route.mjs "<what you want to do>"` as the way to find the right skill, and a compact table grouping all 29 remaining skills by job-to-be-done so the answer is visible without running anything.
- **verify:** `grep -c "skill-router" .claude/rules/available-skills.md`
- **expected:** `1` or more.

## Verification

`node scripts/skill-router/score.mjs --ratchet && ls .claude/skills | wc -l`

Ratchet passes at the raised baseline and 29 skill directories remain. Every one of the 29 is rank-1 for at least one eval intent — no skill is unreachable.

## Follow-on (not in this plan)

The 7 skills marked **unjudgeable** cannot be assessed until audit item F3 is fixed: ship `usage-tracker.mjs` into `templates/client-project/.claude/settings.json.template` so client repos record their own usage. That is a separate deliverable and must not ride this PR. Re-run this triage once three months of client telemetry exists.
