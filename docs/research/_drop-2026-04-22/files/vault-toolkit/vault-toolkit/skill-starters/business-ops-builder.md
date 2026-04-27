# SKILL: Business Operations Workspace Builder

## Description
Builds a customized operations workspace for a small business or freelance practice. Asks diagnostic questions about the recurring work the business handles, then assembles a folder structure with intake, processing, and delivery stages tailored to the specific business type.

## When to Use
When you run a business that handles recurring client work, service delivery, or operational processes and want a structured workspace to make handling that work consistent and delegatable.

## Process

### Phase 1: Diagnosis

Ask the following questions one at a time. Wait for each answer.

**Question 1: What does your business do repeatedly?**
"Describe the core work your business does on a recurring basis. Not the one-off projects, but the work that comes in regularly and follows a similar pattern each time. Examples: client reports, design projects, bookkeeping cycles, repair jobs, consulting engagements."

**Question 2: How does work come in?**
"How do you receive new work? Email, form, phone call, portal, walk-in, referral? What information typically comes with the request? Is it usually complete or do you have to ask follow-up questions?"

**Question 3: What happens between receiving work and delivering it?**
"Walk me through the steps from 'work arrives' to 'client has the deliverable.' Include any review or approval steps, internal or with the client."

**Question 4: What are your service boundaries?**
"What do you do and what do you NOT do? Where do you draw the line on scope? What gets referred out? What is the most common scope creep you experience?"

**Question 5: What does a good deliverable look like?**
"Describe the output of your most common service. What format? What quality bar? How does the client receive it? What would make you embarrassed to deliver something?"

**Question 6: How many people touch the work?**
"Is it just you, or does work pass through multiple people? If multiple, who does what? This helps determine where handoff documentation is needed."

### Phase 2: Assembly

Based on the answers:

1. Determine the number of stages. Map the user's described process to stages. Most small businesses fit 3-4 stages: intake, process (rename to their domain), review (if they have one), deliver.

2. Create the folder structure with numbered stages and _config/, _templates/.

3. Write CLAUDE.md:
   - What this workspace is (their business type and recurring work)
   - Structure map
   - How to use (their process, structured as stages)
   - Key decisions (why stages are split where they are)

4. Write CONTEXT.md routing file:
   - Stage map table
   - How stages connect
   - Where human review happens

5. Write stage contracts (CONTEXT.md per stage):
   - Intake: triage process based on how their work comes in
   - Process: their core work steps, with quality self-check
   - Review (if applicable): internal and client review process
   - Deliver: packaging and delivery based on their output format

6. Create config files:
   - business-rules.md: populated with their service boundaries, scope rules
   - quality-standards.md: populated with their quality description, converted to testable criteria
   - client-context.md: template for recurring client info

7. Create template placeholders for their most common deliverable format.

### Phase 3: Orientation

Walk the user through the workspace. Highlight:
- "The intake stage contract is where scope creep gets caught. It has your scope boundaries built in."
- "The quality standards file is the checklist your deliver stage checks against. Add to it every time a quality issue comes up."
- "If you bring on a new team member, hand them this folder. The CLAUDE.md and stage contracts tell them how to do the work."

## Important Notes
- The "process" stage should be renamed to match the user's domain. "Design," "Analysis," "Repair," "Writing," whatever their core work is.
- If the user is a solo operator, the review stage might be unnecessary as a separate stage. Fold it into deliver. Add it back when the team grows.
- Business rules should be written as facts, not aspirations. If turnaround is actually 5 days, write 5 days, not 3.
- Ask about the scope creep problem specifically. It is the most common operational pain point and the intake stage is designed to catch it.
