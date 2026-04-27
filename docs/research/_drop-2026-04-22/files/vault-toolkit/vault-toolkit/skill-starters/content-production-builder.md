# SKILL: Content Production Workspace Builder

## Description
Builds a customized content production workspace by asking diagnostic questions about your content workflow, then assembling a folder structure, stage contracts, and config files based on your answers.

## When to Use
When you produce content regularly (video, articles, newsletters, social media) and want a structured workspace to make the process repeatable and consistent.

## Process

### Phase 1: Diagnosis (ask before building)

Before creating any files, ask the user the following questions one at a time. Wait for each answer before proceeding.

**Question 1: What formats do you produce?**
"What types of content do you create regularly? (Examples: YouTube videos, Instagram reels, blog posts, newsletters, podcasts, threads.) List all formats you produce at least twice a month."

**Question 2: How many steps does your process have?**
"Walk me through what happens between 'I have an idea' and 'it is published.' What are the distinct steps? For most creators, this is some version of research → write → produce, but yours might be different. Describe your actual process, not what you think it should be."

**Question 3: Where does a human need to review?**
"At which points in your process do you (or should you) stop and review before moving forward? These become the checkpoints between stages. If you currently review at the end only, that is useful to know."

**Question 4: What reference material stays the same across content pieces?**
"What information applies to every piece of content you make? Brand guidelines, voice rules, audience notes, platform requirements, things you always want Claude to know. List what exists and where it lives (even if it is just in your head right now)."

**Question 5: What does 'done' look like for your most common format?**
"For the content type you produce most often, describe the final output. What format is it in? How long is it? What makes it ready to publish?"

### Phase 2: Assembly

Based on the answers, build the workspace:

1. Create the folder structure. One numbered folder per step the user described. Add _config/ for reference material.

2. Write CLAUDE.md as the workspace entry point. Include:
   - What this workspace is (based on their description)
   - Current state (new workspace, no active project)
   - Structure map (listing all folders and their purpose)
   - How to use (step-by-step based on their workflow)

3. Write CONTEXT.md as the routing file. Include:
   - Stage map table (stage name, purpose, inputs, output location)
   - How stages connect
   - Reference material list

4. Write a CONTEXT.md for each stage. Include:
   - Purpose (derived from their process description)
   - Inputs (what this stage needs, referencing specific files)
   - Process (steps, based on their description)
   - Output format (based on their "done" description and format patterns)
   - "Done looks like" (one sentence)

5. Create config file templates:
   - If they mentioned voice/brand: create voice-and-tone.md, format-patterns.md, constraints.md (use the three-file architecture from Constraint 05)
   - If they mentioned audience: create audience.md
   - If they mentioned reference material: create placeholders for each type

6. Populate the constraints.md with the starter constraints from the Vault Toolkit (no em dashes, no AI hedging, etc.) and ask the user to add their own.

### Phase 3: Orientation

After building, walk the user through:
- "Here is what I built and why each piece exists."
- "The first thing to populate is [most impactful config file based on their answers]."
- "The constraint file has starter rules. Read through them and remove any you disagree with, then add your own."

## Important Notes
- Do not build anything before completing the diagnosis. The questions are the skill.
- If the user's process has fewer than 3 steps, do not force more stages. Two stages (draft → publish) is valid if that is their actual workflow.
- If the user's process has more than 5 steps, consider whether some steps can be combined. More than 5 stages usually means the decomposition is too fine-grained for a starting workspace. They can split stages later when the workflow earns it.
- Always annotate files with their ICM layer (L0-L4) so the user understands the architecture, not just the files.
