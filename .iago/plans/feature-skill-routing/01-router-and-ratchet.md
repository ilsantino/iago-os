---
phase: feature-skill-routing
plan: 01
wave: 1
depends_on: []
context: inline
created: 2026-08-17
source: feature
---

# Plan: feature-skill-routing/01-router-and-ratchet

## Goal

Build a deterministic intent → skill router with a scored eval set and a CI ratchet, so a new or re-described skill cannot silently steal another's traffic. Replaces the `eval.md` convention that `.claude/rules/skill-authoring.md` has mandated since inception and which has produced **zero files across 30 skills**.

Layer per `.claude/rules/layer-triage.md`: intent routing is if/then over known criteria — deterministic 60% layer, never an LLM call. **Zero new dependencies** — pure Node `.mjs`, matching how `dual-adversarial.test.mjs` already runs in CI.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `scripts/skill-router/index.mjs` | Corpus extraction + TF-IDF ranking |
| create | `scripts/skill-router/route.mjs` | CLI: intent string → ranked skills |
| create | `scripts/skill-router/evals/intents.jsonl` | Scored test set |
| create | `scripts/skill-router/score.mjs` | Rank-1 accuracy + unique-top-scorer check |
| create | `scripts/skill-router/baseline.json` | Ratchet baseline |
| create | `scripts/skill-router/index.test.mjs` | Ranker unit tests |
| modify | `.github/workflows/validate.yml` | Wire the ratchet into CI |

## Tasks

### Task 1: Extract the skill corpus, splitting positive from negative spans
- **files:** `scripts/skill-router/index.mjs`
- **action:** Export `loadCorpus(skillsDir)` that reads every `.claude/skills/*/SKILL.md`, parses the YAML frontmatter `name` and `description`, and splits the description into `positive` and `negative` spans — a span is negative when it starts with "Do NOT use when", "Not when", "Not for", or "Does NOT cover". Return `[{name, positive, negative}]`.
- **verify:** `node -e "import('./scripts/skill-router/index.mjs').then(m=>{const c=m.loadCorpus('.claude/skills');console.log(c.length, c.find(s=>s.name==='iago-quick').negative.length>0)})"`
- **expected:** `30 true`

### Task 2: Implement TF-IDF ranking with negative-span demotion
- **files:** `scripts/skill-router/index.mjs`
- **action:** Export `rank(intent, corpus)` returning all skills sorted by score descending as `[{name, score}]`. Score each skill by cosine similarity of the intent against its `positive` text, then subtract the similarity against its `negative` text so anti-trigger mentions demote rather than promote. Tokenize by lowercasing, stripping punctuation, and dropping a small stopword list defined in the file.
- **verify:** `node -e "import('./scripts/skill-router/index.mjs').then(m=>{const c=m.loadCorpus('.claude/skills');console.log(m.rank('run a small focused two task change end to end',c)[0].name)})"`
- **expected:** `iago-quick`

### Task 3: Ship the CLI
- **files:** `scripts/skill-router/route.mjs`
- **action:** Read the intent from `process.argv.slice(2).join(' ')`, load the corpus, and print the top 5 as `rank. skill-name  score` one per line. Exit 2 with a usage message when no intent is given.
- **verify:** `node scripts/skill-router/route.mjs "design a multi agent architecture for a client deliverable" | head -3`
- **expected:** Three ranked lines, `iago-agents` among them.

### Task 4: Write the eval set
- **files:** `scripts/skill-router/evals/intents.jsonl`
- **action:** Write one JSON object per line as `{"intent": "...", "expected": "skill-name"}`, covering at minimum every one of the 30 skills once, with 3 intents each for the six highest-traffic skills (`iago-execute`, `iago-prfix`, `iago-plan`, `iago-stress`, `iago-quick`, `iago-fast`) since they carry 64% of real invocations. Phrase intents the way Santiago actually phrases them, not as restatements of the skill description.
- **verify:** `node -e "const l=require('fs').readFileSync('scripts/skill-router/evals/intents.jsonl','utf8').trim().split('\n');const s=new Set(l.map(x=>JSON.parse(x).expected));console.log(l.length, s.size)"`
- **expected:** At least `45 30` — 45+ intents covering all 30 skills.

### Task 5: Score rank-1 accuracy and top-scorer uniqueness
- **files:** `scripts/skill-router/score.mjs`
- **action:** Run every eval intent through `rank`, report overall rank-1 accuracy plus a per-intent list of failures showing expected vs actual top skill. Additionally flag any intent whose top two skills are within 5% of each other as `AMBIGUOUS`, mirroring the "unique top scorer" requirement already written into `.claude/rules/skill-authoring.md`. Print a JSON summary as the last line.
- **verify:** `node scripts/skill-router/score.mjs | tail -1`
- **expected:** A JSON object containing `accuracy`, `failures` and `ambiguous` keys.

### Task 6: Add the ratchet
- **files:** `scripts/skill-router/score.mjs`, `scripts/skill-router/baseline.json`
- **action:** Add a `--ratchet` flag that compares the run's accuracy against `baseline.json` and exits 1 when accuracy drops below it or when any previously-passing intent now fails. Write the current accuracy into `baseline.json` under `--update-baseline`, and seed the file with the accuracy achieved after Task 5.
- **verify:** `node scripts/skill-router/score.mjs --ratchet; echo "exit=$?"`
- **expected:** `exit=0` against the seeded baseline.

### Task 7: Unit-test the ranker and wire CI
- **files:** `scripts/skill-router/index.test.mjs`, `.github/workflows/validate.yml`
- **action:** Write `node:test` cases covering the negative-span demotion (an intent matching only a skill's anti-trigger text must not rank that skill first), stopword handling, and empty-intent behavior. Add two steps to `validate.yml` beside the existing `node .claude/workflows/dual-adversarial.test.mjs` step: run `index.test.mjs`, then `score.mjs --ratchet`.
- **verify:** `node scripts/skill-router/index.test.mjs && grep -c "skill-router" .github/workflows/validate.yml`
- **expected:** Tests pass; grep returns `2` or more.

## Verification

`node scripts/skill-router/index.test.mjs && node scripts/skill-router/score.mjs --ratchet`

Ranker tests pass and the ratchet exits 0. `node scripts/skill-router/route.mjs "<any intent>"` returns a ranked list.

## Scope note

Task 7 touches `.github/workflows/validate.yml`, outside the `scripts/` + `.claude/` fence given for the planning session. That fence governed plan authoring; the CI wiring is unavoidable for a ratchet and is called out here so the executor expects it.
