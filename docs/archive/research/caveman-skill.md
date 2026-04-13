# Research: caveman — Token Compression for Claude Code

**Date:** 2026-04-08
**Question:** Should iaGO adopt caveman's approach to reduce token waste and prevent Claude from over-reasoning?

---

## What Is It?

caveman (`github.com/JuliusBrussee/caveman`) is a Claude Code skill (and multi-agent plugin) that
installs a SKILL.md into the Claude Code skill system. When activated via `/caveman`, it instructs
Claude to respond in ultra-compressed "caveman" syntax — dropping articles, filler, hedging, and
pleasantries while preserving all technical content and code blocks verbatim.

It is **not** a CLAUDE.md rules file and not a system prompt injection in the traditional sense.
It is a **trigger-on-demand skill** that activates a response mode for the session duration.
The repo also ships a secondary tool — `caveman:compress` — that rewrites input files like
CLAUDE.md into caveman-speak to reduce input tokens on every session load.

There are four distinct components:

| Component | What it does |
|-----------|-------------|
| `/caveman` skill | Compresses Claude's *output* tokens by ~50% vs baseline |
| `/caveman-commit` skill | Terse Conventional Commits generator |
| `/caveman-review` skill | One-line PR review comments with severity prefixes |
| `caveman:compress` | Rewrites *input* files (CLAUDE.md) to save input tokens per session |

---

## Core Philosophy

The bet is: **verbose output is waste, not value**. Claude's default mode pads every response with
pleasantries, hedges, restated questions, and connective tissue that carries zero information.
Caveman strips that entirely while keeping the technical signal intact.

The philosophy is grounded in a real academic result. The paper
"Brevity Constraints Reverse Performance Hierarchies in Language Models"
(arxiv.org/abs/2604.00025, March 2026) found that constraining large models to brief responses
**improved accuracy by ~26 percentage points** on certain benchmarks and reversed performance
hierarchies between large and small models. The mechanism: large models over-elaborate, and
that elaboration introduces errors. Tighter output = fewer self-contradictions.

The repo's own framing: **"Caveman make mouth smaller. Brain stay same."**

---

## Full Content of the Main Skill File

### `skills/caveman/SKILL.md` (the complete, verbatim prompt)

```
---
name: caveman
description: >
  Ultra-compressed communication mode. Cuts token usage ~75% by speaking like caveman
  while keeping full technical accuracy. Supports intensity levels: lite, full (default), ultra,
  wenyan-lite, wenyan-full, wenyan-ultra.
  Use when user says "caveman mode", "talk like caveman", "use caveman", "less tokens",
  "be brief", or invokes /caveman. Also auto-triggers when token efficiency is requested.
---

Respond terse like smart caveman. All technical substance stay. Only fluff die.

Default: **full**. Switch: `/caveman lite|full|ultra`.

## Rules

Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries
(sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms (big not extensive,
fix not "implement a solution for"). Technical terms exact. Code blocks unchanged. Errors quoted exact.

Pattern: `[thing] [action] [reason]. [next step].`

Not: "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by..."
Yes: "Bug in auth middleware. Token expiry check use `<` not `<=`. Fix:"

## Intensity

| Level     | What change |
|-----------|------------|
| lite      | No filler/hedging. Keep articles + full sentences. Professional but tight |
| full      | Drop articles, fragments OK, short synonyms. Classic caveman |
| ultra     | Abbreviate (DB/auth/config/req/res/fn/impl), strip conjunctions, arrows for causality (X → Y) |
| wenyan-lite   | Semi-classical. Drop filler/hedging but keep grammar structure |
| wenyan-full   | Maximum classical terseness. Fully 文言文. |
| wenyan-ultra  | Extreme. Ancient scholar on a budget |

## Auto-Clarity

Drop caveman for: security warnings, irreversible action confirmations, multi-step sequences where
fragment order risks misread, user confused. Resume caveman after clear part done.

Example — destructive op:
> **Warning:** This will permanently delete all rows in the `users` table and cannot be undone.
> ```sql
> DROP TABLE users;
> ```
> Caveman resume. Verify backup exist first.

## Boundaries

Code/commits/PRs: write normal. "stop caveman" or "normal mode": revert. Level persist until
changed or session end.
```

### `skills/caveman-review/SKILL.md` (verbatim)

Format: `L<line>: <problem>. <fix>.`

Severity prefixes:
- `🔴 bug:` — broken behavior
- `🟡 risk:` — works but fragile
- `🔵 nit:` — style/naming/micro-optim
- `❓ q:` — genuine question

Rules: exact line numbers, exact symbol names in backticks, concrete fix, the "why" if not obvious.
Drop full mode for: CVE-class bugs, architectural disagreements, onboarding contexts.

### `caveman-compress/SKILL.md` — what gets stripped from input files

Remove: articles (a/an/the), filler (just/really/basically), pleasantries, hedging,
redundant phrasing ("in order to" → "to"), connective fluff (however/furthermore/additionally).

Preserve EXACTLY: code blocks, inline code, URLs, file paths, commands, technical terms,
proper nouns, dates, version numbers, env vars.

The compress script calls Claude (sonnet-4-5 by default) to rewrite the file, validates
that no URLs/code blocks/headings were lost, backs up the original as `FILE.original.md`,
and retries up to 2 times if validation fails.

---

## Specific Techniques

### Output compression (`/caveman`)
1. **Drop word classes**: articles, filler adverbs, pleasantries, hedges eliminated wholesale
2. **Fragment grammar**: complete sentences not required — subject-verb-object fragments allowed
3. **Synonym compression**: shorter words mandated ("fix" not "implement a solution", "big" not "extensive")
4. **Arrow notation**: `X → Y` for causality chains
5. **Abbreviation at ultra level**: DB, auth, config, req, res, fn, impl
6. **Auto-clarity exceptions**: full prose restored for security warnings, destructive operations,
   ambiguous multi-step sequences — then caveman resumes
7. **Code untouched**: all code blocks and inline code pass through verbatim

### Input compression (`caveman:compress`)
1. Same word-class drops applied to CLAUDE.md and other context files
2. Validation: post-compression check ensures no URLs, code blocks, or headings were dropped
3. Backup/restore: original preserved at `FILE.original.md`, rollback on validation failure
4. File type guard: only compresses `.md`, `.txt`, extensionless — never touches source files

---

## Popularity and Validation

- **Stars:** 7,672 (as of 2026-04-08)
- **Forks:** 318
- **Open issues:** 4 (all minor: Codex sync, security patch, installation doc, platform support)
- **Created:** 2026-04-04 — 4 days old at time of research
- **Growth rate:** ~1,900 stars/day — extremely viral
- **Topics:** ai, anthropic, claude, claude-code, prompt-engineering, tokens
- **License:** MIT
- **Language:** Python (compress scripts), Markdown (skill files)

The academic backing (arxiv.org/abs/2604.00025) is real and recent. The paper measured 31 models,
1,485 problems, and found brevity constraints improve large model accuracy by 26pp on certain
benchmarks by preventing over-elaboration errors.

### Actual measured compression (from committed evals snapshot, claude-opus-4-6, 10 prompts)

The repo has a 3-arm eval harness. The honest delta is **caveman vs `__terse__`** (not vs baseline),
because `__terse__` = "Answer concisely." alone. This isolates the skill's contribution.

| Arm | Avg output chars | vs baseline |
|-----|-----------------|-------------|
| `__baseline__` | 812 | — |
| `__terse__` ("Answer concisely.") | 863 | +6% (verbose) |
| `caveman` skill | 405 | -50% |

Per-prompt caveman vs `__terse__` savings:
- React re-render: 61% shorter
- DB connection pooling: 89% shorter
- TCP vs UDP: 37% shorter
- Node.js memory leak: -2% (caveman was LONGER on this one)
- SQL EXPLAIN: 38% shorter
- Hash table collisions: 43% shorter
- CORS errors: 59% shorter
- Debouncer: 69% shorter
- Git rebase vs merge: 47% shorter
- Queue vs topic: 59% shorter

**Average: 53% output token reduction vs "be terse" alone. Range: -2% to 89%.**

Note: the README claims 65-75% — those numbers use baseline (no system prompt) as the control,
which inflates the delta. The honest number against a "be concise" instruction is ~50-53%.
Still significant, but not 75%.

The evals README itself calls this out: "Caveman not cheat."

---

## Downsides and Trade-offs

### 1. Output token savings add input token cost
Every session where `/caveman` is active, the SKILL.md is injected as input tokens. The README
does not measure net economics (output saved minus input added). For short sessions or sessions
where caveman rarely activates, the input overhead may cancel some savings.

### 2. The 75% claim is inflated
The headline number compares caveman to the verbose baseline (no system prompt). The honest
comparison against a simple "be concise" instruction shows ~50-53% reduction. Still material,
but be skeptical of the marketing number.

### 3. Not designed for complex multi-step execution contexts
caveman's auto-clarity rules carve out exceptions for "multi-step sequences where fragment order
risks misread." Our pipeline — plans with sequential tasks, conditional logic, and file editing —
lives exactly in that exception zone. A caveman-style response from an implementation session
that drops the wrong connector word could produce ambiguous diffs.

### 4. Conflicts with our verification discipline
CLAUDE.md rule: "Never claim a task is complete without running a verification command and reading
its output." Caveman's full/ultra modes aggressively compress status reporting. There's a real
risk that caveman-mode responses compress verification evidence into illegibility, making it
harder to audit whether a task actually passed.

### 5. Claude Code agent dispatch context
Our sessions involve orchestrator → subagent communication. Caveman compression on agent
communication could strip context that downstream agents depend on. The skill is designed
for human-facing responses, not agent-to-agent messages.

### 6. Session-scoped, not persistent
Level resets at session end. In a multi-session pipeline with fresh `-p` sessions per plan
(which is exactly how our execute-pipeline.sh works), caveman would need to be re-activated
per session or injected into each session's system prompt explicitly.

### 7. No test for fidelity
The evals measure compression ratio, not accuracy preservation. A response that says `k` would
score -99% and "win" — the eval README admits this. There is no judge-model rubric measuring
whether the compressed response preserved the technical substance.

---

## Applicability to iaGO

### Where it would help
- **Human-facing diagnostic output**: caveman lite on orchestrator responses to Santiago would
  cut the wall-of-text problem significantly. Status updates, error explanations, build results.
- **PR review comments**: `caveman-review` format maps well to our review pipeline output format
  (Critical/Important/Minor with file:line citations). This is the strongest fit.
- **Commit messages**: `caveman-commit` aligns with our Conventional Commits enforcement.
- **CLAUDE.md compression**: `caveman:compress` on our current CLAUDE.md (~2000+ words of prose)
  could save meaningful input tokens per session. Worth a one-time run with the backup kept.

### Where it conflicts
- **Implementation sessions**: executor agents writing code should not be in caveman mode.
  Ambiguous fragment grammar in implementation output is a bug risk.
- **Review sessions**: our review pipeline requires explicit severity classification and full
  reasoning for Critical findings. caveman-review's one-liner format is good for Minor/nit
  but insufficient for Critical findings that need root cause explanation.
- **Verification output**: compressed verification output obscures the evidence chain.

---

## Recommendation

**Decision:** Adopt `caveman:compress` on the CLAUDE.md input file immediately. Do not adopt
`/caveman` as an active mode in the execution pipeline. Adopt `caveman-review`'s format
(severity prefix + location + one-line finding) as the standard for Minor/nit review output only.

**Confidence:** High

**Reasoning:** The `caveman:compress` tool solves a real problem — our CLAUDE.md is loaded on
every session start and is dense prose. A one-time compression (with backup) reduces that input
cost permanently with zero behavioral change. The `/caveman` output mode is a human-UX improvement,
not an agent-reliability improvement — and our pain point is agent reliability, not reading
speed. The academic finding (brevity constraints reduce large-model over-elaboration errors) is
real, but the mechanism works at the reasoning level, not the output-formatting level. Our
execution pipeline already constrains output format via plan specs and verification requirements,
which serves the same function.

**Next step:** Run `caveman:compress` on `CLAUDE.md` in a branch, review the diff, and merge
if no technical content was lost. That is the only adoption that pays without risk. Do not
install the active `/caveman` skill into the execution pipeline.

**Risk if wrong:** If caveman output mode does reduce execution errors (via the brevity-accuracy
mechanism), we're leaving error reduction on the table. Acceptable — we can revisit on a
non-critical project as a controlled experiment.

---

## Sources

- `github.com/JuliusBrussee/caveman` README: repo description, philosophy, benchmark table, install
- `skills/caveman/SKILL.md` (verbatim): full prompt text and rules
- `skills/caveman-review/SKILL.md` (verbatim): review format rules
- `caveman-compress/SKILL.md` (verbatim): compression rules and process
- `caveman-compress/scripts/compress.py`: Python orchestrator logic, validation, retry
- `evals/snapshots/results.json`: committed benchmark snapshot (claude-opus-4-6, 10 prompts, 3 arms)
- `evals/README.md`: eval methodology and honest-delta framing
- `arxiv.org/abs/2604.00025`: "Brevity Constraints Reverse Performance Hierarchies in Language Models"
- GitHub API: stars (7,672), forks (318), open issues (4), created 2026-04-04
