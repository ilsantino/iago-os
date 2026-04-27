# Constraint 06: I Do Not Know What Layer This Problem Belongs On

## The Problem

You are using AI for everything. Email drafts, data lookups, scheduling, calculations, formatting, brainstorming, writing, analysis. Some of these tasks come back great. Others come back wrong, slow, or more expensive than doing them by hand. You cannot figure out why the same tool works brilliantly on some tasks and poorly on others.

The reason is that not every task is an AI task. Language models are probabilistic reasoning engines. They are excellent at tasks that require judgment, synthesis, creativity, and pattern matching across unstructured information. They are mediocre at tasks that require deterministic accuracy (exact calculations, data lookups, formatting to a precise spec). And they are wasteful on tasks that a simple rule, formula, or existing tool handles perfectly.

The question is not "can AI do this?" It almost always can. The question is "should AI do this, or is there a layer beneath AI that handles it better, faster, and cheaper?"

---

## Layer 1: Principles That Predate AI

Every new technology goes through a phase where people try to use it for everything. When spreadsheets first appeared, people tried to use them as databases, word processors, and project management tools. When databases arrived, people tried to put everything in a database. When the web arrived, every application became a web app regardless of whether it should have been.

The pattern resolves the same way every time. People learn which problems the new technology actually solves better than what came before, and they stop using it for everything else. That learning phase is where most AI users are right now.

The framework for this has existed in various forms since the early days of computing. The layer model. Your operating system has layers: hardware, kernel, system services, applications. Each layer handles the problems it is best suited for. You do not ask the application layer to manage memory allocation. You do not ask the kernel to render a user interface.

Herbert Simon described bounded rationality in 1955: decision-makers operate within the limits of the information and cognitive resources available to them. Applying this to tool selection: use the simplest tool that solves the problem. Complexity costs you in time, tokens, unpredictability, and maintenance. A VLOOKUP does not hallucinate.

**Traditional tools by layer:**
- **Deterministic tasks (exact answers, calculations, formatting):** Spreadsheets (Excel, Google Sheets), calculators, mail merge, find-and-replace, VLOOKUP, pivot tables, simple scripts.
- **Rule-based tasks (if/then logic, routing, categorization with known categories):** Zapier, Make, n8n, email filters, form builders, decision trees in a spreadsheet, basic database queries.
- **Judgment tasks (synthesis, fuzzy categorization, creative work, analysis of unstructured text):** This is where AI adds genuine value.

---

## Layer 2: Existing Skills and Tools

The tools that handle the non-AI layers are not exotic. You probably already use some of them.

**Spreadsheets (Excel, Google Sheets)**
Seriously underestimated. A spreadsheet with formulas is a deterministic program that never hallucinates, runs instantly, and costs nothing per execution. If your task boils down to "take data from column A, apply a rule, put the result in column B," a spreadsheet does this better than any model. This includes: unit conversions, tax calculations, inventory tracking, simple categorization by known criteria, scheduling math, budget projections.

**Zapier / Make / n8n (workflow automation)**
If your task is "when X happens, do Y," this is a rule-based automation. Email arrives with attachment, save attachment to specific folder. Form submitted, create row in spreadsheet and send confirmation email. These are deterministic chains. They do not need judgment. Running them through an AI model adds latency, cost, and the possibility of error where there was none.

**n8n specifically** (n8n.io, self-hosted option available) connects to hundreds of services and lets you build multi-step workflows with branching logic. It also has an MCP server, which means an AI agent can trigger n8n workflows when the task involves deterministic steps that the model should not handle itself.

**Database queries (SQL, Airtable, Notion databases)**
If you are asking AI to find or aggregate structured data, a database query is faster and exact. "How many clients signed up in March?" is a SQL query, not an AI prompt. "What patterns do the March signups have in common that differ from February?" is an AI task. Know the difference.

**Purpose-built software**
Before you build an AI workflow, check if purpose-built software already handles it. Project management: Trello, Asana, Linear. CRM: HubSpot, Salesforce. Accounting: QuickBooks, Xero. Document formatting: Word's style system, LaTeX. Calendar management: your calendar app. These tools have spent years optimizing for their specific domain. They will outperform a general-purpose model on their core tasks.

---

## Layer 3: The Architectural Fix

Eduba's 60/30/10 framework provides the triage heuristic:

**60% of what you are building should be traditional code, databases, or established tools.** This is the stable foundation. Spreadsheets, file systems, databases, deterministic scripts, purpose-built software. These layers are reliable, fast, auditable, and cheap to run. They do not drift, hallucinate, or require token budgets.

**30% should be rule-based logic.** If/then routing, automation workflows, templates with conditional sections, decision trees. This layer handles the "which path do we take" decisions that have clear criteria. Zapier, Make, n8n, email rules, form logic. These are more flexible than pure deterministic tools but still predictable.

**10% should be AI.** The tasks that genuinely require judgment, synthesis, or creativity. Writing, analysis of unstructured data, creative brainstorming, translating between domains, fuzzy categorization, generating first drafts. This is where language models earn their cost.

**The diagnostic:**

For every task in your workflow, ask these three questions in order:

1. **Is the answer deterministic?** Is there one right answer that can be calculated or looked up? If yes, use a spreadsheet, database, or existing tool. Stop here.

2. **Can it be expressed as an if/then rule?** If category is X, do Y. If amount exceeds threshold, flag for review. If yes, use an automation tool or a simple script. Stop here.

3. **Does it require judgment across unstructured information?** Synthesis, interpretation, creativity, pattern matching across text that does not fit neatly into rows and columns? If yes, this is an AI task.

Most people reverse this order. They start with "can AI do this?" and the answer is almost always yes, so they use AI. Then they wonder why their workflow is slow, expensive, and inconsistent. Running the diagnostic in the correct order, starting from the simplest layer, routes each task to the tool that handles it best.

**The Coca-Cola principle:**

From Jake's framing: Coca-Cola exists because refrigeration exists. Coca-Cola is not a refrigeration company. They used the technology to do something else at a scale that was never possible before. The companies that won from refrigeration were not the ones that built better refrigerators. They were the ones that figured out what refrigeration made possible.

Apply this to AI. The value is not in having AI. The value is in what AI makes possible for your specific business, workflow, or creative process. If you are spending your time optimizing the AI itself (building agents, fine-tuning prompts for tasks that should be spreadsheets, creating elaborate automations for simple problems), you are building refrigerators when you should be selling Coke.

**How this changes your workspace design:**

When you design a workspace for a repeatable workflow, each stage should declare which layer handles it. Some stages are fully automated with traditional tools (data import, formatting, file management). Some stages use rule-based routing (categorization, triage, template selection). Some stages use AI (writing, analysis, synthesis).

A well-designed workspace has most of its stages on the bottom two layers. AI stages are concentrated where judgment genuinely matters. This makes the workflow cheaper, faster, and more reliable. It also makes the AI stages work better because the model is not wasting context on tasks that a formula should handle.

---

## Tuning Questions

**1. Walk through your last five tasks. For each one, which layer should have handled it?**
Be honest. If three of the five were lookups, calculations, or formatting tasks, you are over-indexing on AI. Move those to the appropriate layer. Your AI tasks will run faster and better once they are not competing with spreadsheet work for your attention and token budget.

**2. What are you currently doing with AI that produces exact, consistent results every time?**
If the answer is "nothing," that is expected. AI is probabilistic. But if you have tasks that need exact, consistent results, those tasks should not be on AI. Move them to a deterministic layer where exactness is guaranteed.

**3. What would break if AI were unavailable for a day?**
The tasks that would break are your genuine AI dependencies. Everything else is convenience, not necessity. That does not mean you should stop using AI for convenience tasks. But you should know the difference. Your critical workflow should degrade gracefully if the model is slow, down, or producing lower quality output on a given day. Tasks on deterministic layers do not have that problem.

---

## Quick Reference

| If this is your situation | Start here |
|---|---|
| AI gives inconsistent results on a task that should have one right answer | This is a deterministic task. Move it to a spreadsheet or database query. |
| You built an AI workflow that just routes things based on simple criteria | This is a rule-based task. Move it to Zapier, Make, or n8n. |
| Your AI costs are high relative to the value produced | You are probably running deterministic and rule-based tasks through AI. Audit your workflow with the three-question diagnostic. |
| You do not know where to start with AI | Start with what you already do well. Map your current workflow. Identify the 10% that requires genuine judgment. Apply AI there first. |
| You are building elaborate AI agents for tasks a spreadsheet handles | Stop. Use the spreadsheet. Redirect that effort to the tasks where AI genuinely helps. |
