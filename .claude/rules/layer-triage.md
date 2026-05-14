---
paths:
  - ".iago/plans/**/*.md"
  - "docs/specs/**/*.md"
  - "runtime/**/*.ts"
  - "runtime/**/*.py"
  - ".iago/research/**/*.md"
---

# Layer Triage — 60/30/10 Framework

**Source:** Eduba vault-toolkit constraint 06 + ICM paper §3.2; Clief Notes Skills Field Manual §§2.1–2.5. Imported to iaGO 2026-05-13 per `.iago/research/2026-05-13-mwp-source-synthesis.md` recommendation.

## Why this rule exists

When designing a workflow, a daemon task router, or a plan, the question is NOT "can an AI do this?" — it almost always can. The question is "should an AI do this, or does a layer beneath AI handle it better, faster, and cheaper?"

Models are excellent at judgment, synthesis, creativity, and pattern matching across unstructured information. They are mediocre at deterministic accuracy (exact calculations, data lookups, formatting to a precise spec). They are wasteful on tasks a simple rule, formula, or existing tool handles perfectly.

A VLOOKUP does not hallucinate.

## The 60/30/10 split

| Layer | Share | What it handles | Tools |
|---|---|---|---|
| **Deterministic** | 60% | Exact calculations, data lookups, formatting, file operations, deterministic transforms | Scripts, databases, CLI utilities, purpose-built software, spreadsheets, file system |
| **Rule-based** | 30% | If/then routing, categorization with known criteria, automation chains, template selection | Cron schedulers, webhook receivers, n8n flows, deterministic conditionals, email rules |
| **AI** | 10% | Synthesis, judgment, creative work, fuzzy categorization, analysis of unstructured text | Claude / Codex agents, LLM-backed MCP servers |

## The diagnostic (apply in order)

For every task you're about to route to an agent:

1. **Is the answer deterministic?** Is there one right answer that can be calculated, looked up, or computed by a formula? → **Use a script / database / spreadsheet.** Stop here.
2. **Can it be expressed as an if/then rule?** "If X, do Y. If amount exceeds threshold, route to Z." → **Use cron / webhook / automation flow.** Stop here.
3. **Does it require judgment across unstructured information?** → **This is the 10%. Route to an AI agent.**

Most workflow designs reverse this order. They start with "can AI do this?" and the answer is yes, so they use AI. Then they wonder why the workflow is slow, expensive, and inconsistent. Running the diagnostic in the correct order routes each task to the layer that handles it best.

## Applied to iaGO v2 daemon design

| Component | Layer | Why |
|---|---|---|
| File-bus task claims (`O_EXCL`) | Deterministic | Single right answer; no judgment |
| Cron scheduler firing webhooks | Rule-based | If 9am EST + agent X, fire job Y |
| Telegram message → agent inbox routing | Rule-based | If user is santiago AND mentions @agent-name, route there |
| PTY adapter spawn / kill | Deterministic | Lifecycle is exact |
| Codex / Claude PTY execution | AI | Code generation, code review, synthesis |
| Cost ledger writes (SQLite) | Deterministic | Arithmetic |
| Hard pause at budget breach | Rule-based | If sum(month_costs) > budget, halt |
| Dashboard rendering | Deterministic | Read state, format HTML |
| Sentry-trace → fix dispatch | Rule-based **+** AI | Routing is rule-based; the fix itself is AI |
| Learning loop pattern extraction | AI | Pattern recognition across logs |
| Email auto-provision (SES, IMAP) | Deterministic | API calls, fixed shape |
| Webhook signature verification | Deterministic | HMAC check |

**Implication:** the v2 daemon is mostly NOT an AI system. It's a deterministic + rule-based infrastructure with AI agents wired in at specific judgment points. If you find yourself routing deterministic work through an LLM call, stop and rewrite that path.

## Applied to plan design

When writing a plan in `.iago/plans/`:

- Tasks that are file-edits / scaffold / boilerplate → mark as deterministic, ship with a script if repeatable
- Tasks that are routing / classification / dispatch → mark as rule-based, ship as conditional logic
- Tasks that need synthesis / review / interpretation → these are the genuine AI tasks; this is where the iaGO pipeline's Claude implementation stages earn their cost

## Three diagnostic questions for an existing workflow

1. **Walk through your last five tasks.** For each, which layer should have handled it? If 3+ of 5 were lookups, calculations, or formatting, you're over-indexing on AI. Move those down a layer.
2. **What are you doing with AI that produces exact, consistent results every time?** If nothing, that's expected (AI is probabilistic). If you have tasks needing exact results, those tasks should not be on AI.
3. **What would break if AI were unavailable for a day?** That's your genuine AI dependency surface. Everything else should degrade gracefully — meaning it lives on a deterministic or rule-based layer.

## Anti-patterns this rule blocks

- Building an LLM-powered "router" when a regex match would do
- Asking an agent to "categorize these 100 records into 5 known buckets" when a SQL CASE statement does it deterministically
- Wrapping deterministic shell commands in agent prompts (the shell already does the thing)
- Running an LLM call on every webhook event when most events should be filtered with a rule first
- Building elaborate prompt chains for tasks a spreadsheet handles

## Quick reference

| Situation | Move to |
|---|---|
| AI gives inconsistent results on a task with one right answer | Deterministic layer (script / DB) |
| You built an AI workflow that routes things by simple criteria | Rule-based layer (n8n / cron / conditional) |
| AI costs high relative to value | Audit with the 3-question diagnostic; pull deterministic tasks down |
| Building elaborate agents for tasks a spreadsheet handles | Stop. Use the spreadsheet. Redirect AI effort to genuine 10% tasks. |
