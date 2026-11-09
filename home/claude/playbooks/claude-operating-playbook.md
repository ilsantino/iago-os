# Claude operating playbook (Santiago)

How to run Claude Code work for iaGO, with or without iago-os. The rules every session follows live in `~/.claude/CLAUDE.md` ("Token budget"); this file is the how-to: model table, cases, launch lines, prompt templates. Source: the 2026-09-14 usage audit; model principles revised 2026-11-09 (Fable only for exceptional complexity, Opus 5.5 the upper-tier default, least expensive reliable model otherwise). Not auto-loaded.

## 1. Model by complexity

| Tier | Typical tasks | Model | Effort |
|---|---|---|---|
| Simple | bulk or repetitive execution, extraction, classification, simple operations | Haiku | medium |
| Mechanical | move/rename, format, run a command and report, commit/PR/tag, standard coding, integrations, documentation | Sonnet | medium |
| Read & extract | read docs, frames, web pages; summarize; triage rows against written criteria | Sonnet | medium |
| Build & judge (default) | coordinate, implement, review code, debug, reconcile sources, draft deliverables | Opus 5.5 | high |
| Hard | a bug that survived 2 fixes, a real architecture trade-off, security-critical review | Opus 5.5 | xhigh |
| Plan & synthesize | phase or engagement plans, feature plans, agent briefs, final synthesis | Opus 5.5 | high |
| Exceptional | advanced system architecture, a hard problem that resisted Opus, complex workflow design, a critical expensive-if-wrong technical decision | Fable 5.1 | high |

Fable guardrails: only the Exceptional tier, never because a task has many steps or is "planning"; fresh session; curated inputs under ~150k (indexes, audited outputs, drafts), never raw corpora; never an agent, Workflow leg, background task, scheduled routine or runtime agent; never for reading, fan-out, coordination, status or routine execution; state "why Fable" in one line first. Most plans and syntheses are Opus work.

Pick the least expensive model that reliably completes the task and escalate only when complexity, uncertainty or failure risk justifies it. One capable model beats a multi-agent architecture unless the agents' inputs are truly independent. Optimize cost per successfully completed task, not tokens alone; no switching, delegation or layering the task does not need.

Plan with one model and stress-test with another (Opus or Codex): different models catch different mistakes.

## 2. Agents: as many as needed, none beyond that

An agent is justified only when all three hold:
1. Its inputs don't overlap another agent's — no two agents reading the same corpus.
2. Neither a script nor the current session can do it as well.
3. It runs on the lowest model that does it well, set explicitly, never inherited.

Before dispatching, print the roster: agent → model → why. Over a shared corpus, build one compact index first (script or one Sonnet agent), then fan out over the index. Every brief carries a read budget (Grep to locate, Read with offset/limit, never a whole large file, stop near 150k context) and an output contract (write to a file, reply ≤150 words: path + status).

Agent types that pin a model: `analyst`, `operator`, `research`, `content`, `general`, `review-single`, `review-full` = Sonnet; `executor`, `frontend`, `backend`, `fullstack`, `security-audit` = Opus. Built-in `general-purpose`, `Plan` and `claude` have no pin — pass `model`.

## 3. Main chat and side terminals

**Main chat** — one per project, fresh each day, Opus 5.5 high.
- Does: decisions, status (STATE.md + `gh`/`git`), edits of up to ~3 files, writing terminal prompts, reading terminal reports, updating STATE.md.
- Hands off: multi-file implementation, long runs (tests, builds, migrations, big reads), different-model work, anything that can run in parallel.
- Never babysits builds or deploys: a wait becomes a precondition inside the terminal prompt.
- Closes at ~150k context or end of day: "update STATE.md and give me the handoff".

**Side terminal** — one per task, never reused.
- Launch from the task's folder: `claude --model <sonnet|opus|claude-fable-5-1> --effort <medium|high|xhigh> -n <project-task>`. Desktop: new session in that folder, pick model and effort, name it.
- First message: the pasted prompt, or `Read <file>, section "<name>", and execute it exactly.`
- The prompt names: folder and branch, current state, steps, done criteria, what not to touch, report path, "never merge".
- It ends by writing a one-screen report and stopping. Tell the main chat "<task> done"; the main chat reads only the report.
- If it dies (limit, crash), open a new one pointed at the last report. Never resume it.

Report paths: `.iago/state/terminal-{project}-{task}.md` in repos with `.iago/`; otherwise whatever path the prompt names (for example `workspace/research/{date}-{task}.md`).

Subagents or terminals: a batch of similar independent units → subagents inside one terminal; work you want to watch or steer → its own terminal. Parallel terminals are fine when they don't touch the same files or branch. All terminals and Chat share one 5-hour window, so stagger heavy runs.

## 4. Cases

**Every case:** new session per task or phase · model and effort before the first message (on an empty context, e.g. right after `/clear`, switching is free) · never switch on a big context · end at ~150k with a handoff.

**rsf (analysis engagement).** Planning a phase → Opus session writes PLAN.md and briefs (Fable only if the phase turns on a hard architectural or methodological decision). Executing → Opus orchestrator in `C:\development\rsf`: routes agents per §1, accepts outputs with the phase audit scripts plus a spot-check, merges, commits. Frame extraction and de-duplication are scripts; Sonnet reads the frames. Phase synthesis → one Opus session over the audited outputs. Current state: `workspace/research/2026-09-10-fase-a-entendimiento/HANDOFF-2026-09-14.md`.

**sentria (product, PRs to qc).** Coordinator main chat in `C:\development\sentria`; workers are side terminals in `sentria-dev` running `/iago-quick`, `/iago-fast` or `/iago-execute`. Features with 4+ tasks → Opus session with `/iago-plan --feature`; Fable only for a feature whose architecture is genuinely hard. Final gate in team mode only for auth, data-integrity or tenancy diffs; standard for UI. Current state: `sentria-dev/.iago/state/coordinator-handoff-2026-09-14.md`.

**valorarrend and other research + proposal work.** Opus session plans the streams; one `research` agent (Sonnet) per stream, each writing its own file; a new Opus session drafts from the stream files; a high-stakes pitch gets a pressure-test by a different model (Opus or Codex); Fable only when the pitch turns on a critical, expensive-if-wrong decision.

**Code in an iaGO repo (has `.iago/`).** ≤3 obvious files → `/iago-fast`; 1–3 tasks → `/iago-quick`; 4–8 tasks → `/iago-plan --feature` in an Opus session, then `/iago-execute` from a new Opus session; Fable for the plan only when the design is exceptionally hard. The pipeline pins its own leg models.

**Code in a repo without iago-os.** Opus session: plan mode → implement → run the repo's tests → a review pass by a different model (a Sonnet `review-single` agent or `/codex:rescue`). Bigger features: an Opus session writes the plan to a file, an Opus terminal executes it.

**Client deliverables (docs, xlsx, decks, emails).** Opus session reading only the sources the deliverable needs; tables and formulas by script first; the final version of a high-stakes deliverable gets a different-model review; Fable only for a critical, expensive-if-wrong decision document.

**Quick questions, status, admin (`C:\development`).** Sonnet or Opus by the question's weight, one topic per session, no agents. Usage check: `python ~/.claude/scripts/usage-audit.py --detail`.

**Hard bug.** After 2 failed fixes: new Opus xhigh session with the failing test and the error; still stuck → `/codex:rescue` or one Fable session.

**Scheduled task `sunday-batch-ideation`.** Runs by itself (~0.2M IET). It opens the 5-hour window when the app starts on a Monday after a missed Sunday.

## 5. Prompt templates

Coordinator (main chat):
```text
Fresh coordinator session for {project}. Read ONLY {STATE.md or handoff path} and any report in {report dir} newer than it; run {status commands}. Do not read code or plans unless I ask.
Reply in ≤15 lines: what changed, next action, what waits on me. You coordinate, you don't build: multi-file or long-running work goes to a side terminal — give me the launch line (claude --model X --effort Y -n {project}-{task}, from the right folder) and a self-contained prompt. No watchers; waits become preconditions inside terminal prompts. At ~150k context, update STATE.md and tell me to open a new session.
```

Side terminal:
```text
{Task}. Folder {path}, branch {branch} (PR base {base}). Current state: {facts}.
Steps: {1..n}. Done = {criteria}. Do not touch: {list}.
If you use agents: explicit model per agent, roster first. Write your report to {report path} (one screen: result, commits/PR, residuals) and stop. Never merge.
```

Planning session (Opus by default; Fable only for the Exceptional tier):
```text
Planning session. Read ONLY {STATE.md}, {spec or prior plan} and {indexes/summaries}; open raw evidence or code only where a decision needs it.
Write {PLAN.md + briefs}: for every step, who does it (script, session, or agent + model), inputs, read budget, output path, done criteria and the check that accepts it. Then stop; do not dispatch or implement anything.
```

Orchestrator (execution):
```text
Fresh orchestrator for {phase}. Read ONLY {handoff or plan}, {briefs} and the tail of {acceptance log}. Follow the plan: print the agent roster (agent → model → why), dispatch, accept each output with its audit script plus a spot-check, merge, commit, report to me in ≤15 lines. At ~150k context, update the handoff and STATE.md and tell me to open a new session.
```

## 6. Monitoring

- Plan limits, the only account-level truth: claude.ai → Settings → Usage.
- Live, in an interactive `claude` terminal: `/context` (what fills the window), `/usage` (plan limits).
- After the fact: `python ~/.claude/scripts/usage-audit.py --date YYYY-MM-DD --from HH:MM --to HH:MM --detail`. Red flags: agents with `model=INHERIT`, maxctx above 200k, a non-zero `rewr` column, `tl/turn` above 10.
