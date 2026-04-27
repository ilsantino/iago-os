# The Vault Toolkit

A constraint library, reference architecture gallery, and skill starter collection for people who want to build with AI instead of just use it.

## What This Is

This is not a prompt library. There are no copy-paste templates here.

This is a set of tools organized around problems you have already encountered. Each one follows the same structure: the principle that solves the problem (most of which predate AI by decades), the existing tools or skills that handle it, and the deeper architectural thinking that makes the fix permanent instead of temporary.

Every constraint file includes tuning questions. These are not decorative. They exist because a constraint that does not fit your specific workflow will either be ignored or will make your output worse. Answer them before you use the file. The constraint adapts to you, not the other way around.

## How to Use This

**If you work in Claude Code, Cursor, or VS Code:** Drop the constraint files into your workspace. Reference them from your CLAUDE.md or CONTEXT.md. Load them selectively based on the stage of work you are in. Do not load all of them at once.

**If you work in Claude Projects:** Add the relevant constraint files as knowledge sources. Use one or two at a time, matched to the task. The whole point of separation of concerns is that each piece of context has a job.

**If you work in Claude Desktop, ChatGPT, Copilot, or any other chat interface:** Copy the constraint content into your conversation when you need it. These are portable. The principles work regardless of which model or tool you are using.

**If you are non-technical:** Start with constraint 06 (Layer Triage). It will help you figure out which problems actually need AI and which ones need a spreadsheet. Then move to whichever constraint matches your most frequent frustration.

## What Is in Here

### /constraints (8 files)
Problem-organized reference files. Each one addresses a specific frustration people hit when working with AI. Each one has three layers: traditional solutions that predate AI, existing skills and tools that handle part of the problem, and the architectural principle that makes the fix stick. Each one has tuning questions that customize the constraint to your workflow.

### /architectures (3 annotated workspaces)
Real folder structures you can download, explore, and study. Every file is annotated with what layer it sits on, why it exists, and what would change if your workflow were different. These are reference pieces, not templates. Study them, then build your own.

### /skill-starters (3 diagnostic skills)
Skills that ask before they build. Each one opens with diagnostic questions about your specific workflow, then assembles a workspace skeleton based on your answers. The decomposition logic is built in. Your answers provide the specifics.

## The Principle Behind All of This

Every repeatable workflow has steps. Every step has a scope of information it actually needs. The job is to match those two things so each step runs with signal instead of noise.

Whatever your environment supports for separating information is your implementation layer. Folders, tabs, knowledge sources, notebook sections, SharePoint libraries. The medium changes. The logic does not.

The question is always the same: does this piece of information belong at this step, or am I just carrying it because I do not know where else to put it?

## A Note on the Three Layers

Each constraint file references solutions at three levels. This is intentional and reflects a core Eduba principle: the 60/30/10 framework.

Roughly 60% of the problems people throw at AI are better solved by traditional tools, databases, or established writing principles. Another 30% are handled well by rule-based systems, existing skills, or purpose-built software. Only about 10% genuinely benefit from the probabilistic reasoning that a language model provides.

If you find yourself reaching for Claude to solve a problem that Grammarly handles, you are spending tokens on something deterministic. The constraint files will tell you when that is the case.

---

Built by Eduba. Learn more at eduba.io or join the community at Clief Notes.
