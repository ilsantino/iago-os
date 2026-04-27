# SKILL: Client Delivery Workspace Builder

## Description
Builds a customized engagement workspace for consultants, agencies, and service providers who deliver multi-stage projects. Asks diagnostic questions about the engagement model, then assembles a workspace with discovery, build, review, and handoff stages tailored to the specific practice.

## When to Use
When you deliver projects to clients that involve multiple stages, client review checkpoints, and a formal handoff. This is for work that takes days to months, not tasks that take hours.

## Process

### Phase 1: Diagnosis

Ask the following questions one at a time. Wait for each answer.

**Question 1: What do you deliver?**
"Describe the typical deliverable of your client engagements. Is it a document, a system, a strategy, a design, training, software, something else? Be specific about what the client receives at the end."

**Question 2: How do engagements start?**
"How does a typical engagement begin? Do you do a formal discovery phase? Do you scope before starting or discover as you go? How do you figure out what the client actually needs versus what they asked for?"

**Question 3: What is your review process?**
"How does client review work? Do they see drafts along the way or only the final product? Is there internal review before client review? How do you handle revision requests? How many rounds of revision are typical?"

**Question 4: What kills engagements?**
"Think about the engagements that went wrong or were more painful than they should have been. What caused the problems? Scope creep, miscommunication, unclear requirements, client availability, something else? These failure modes are what the workspace is designed to prevent."

**Question 5: What happens after delivery?**
"When you hand off the final deliverable, is the engagement done? Or is there ongoing support, training, maintenance, or advisory? How do you transition the client to operating independently?"

**Question 6: What reference material do you reuse across engagements?**
"Do you have frameworks, methodologies, templates, or prior work that applies to multiple clients? Or does every engagement start from scratch? List anything you find yourself pulling from repeatedly."

### Phase 2: Assembly

Based on the answers:

1. Determine the stage structure. The default is four stages (discovery, build, review, handoff) but adjust based on their answers:
   - If they do not do formal discovery: flag this as a risk but do not force it. Create a lightweight intake stage instead and note that discovery can be added when the engagement model supports it.
   - If they do internal and client review: keep review as one stage with two phases.
   - If they have ongoing support: add a stage 05_support.
   - If they do proposals before discovery: add stage 00_proposal.

2. Create the folder structure. Numbered stages, _config/, _references/.

3. Write CLAUDE.md:
   - What this workspace is (their practice type and engagement model)
   - Structure map
   - How to use (one engagement = one copy of this workspace)
   - Key decisions (especially around discovery and review, citing their failure mode answers as rationale)

4. Write CONTEXT.md routing file:
   - Stage map with client checkpoints column
   - How stages connect, including the review → build feedback loop
   - Reference material locations

5. Write stage contracts:
   - Discovery: diagnosis process based on how they currently figure out client needs. Include their failure modes as things the discovery stage is designed to catch.
   - Build: their delivery process with self-check against acceptance criteria.
   - Review: two-phase process (internal then client). Include their typical revision count as a guideline.
   - Handoff: documentation and transition based on their post-delivery description.

6. Create config files:
   - client-brief.md: template for capturing initial client communication
   - engagement-terms.md: template with their typical engagement structure
   - scope-agreement.md: placeholder (produced by discovery)

7. If they mentioned reusable reference material, create _references/ with placeholder files for each type. Add a note about building a central reference library if they do many engagements.

### Phase 3: Orientation

Walk the user through. Highlight:
- "The discovery stage is designed to catch [their specific failure modes]. The requirements document and scope agreement it produces are what the rest of the engagement works from."
- "The review stage has two phases. Internal review happens before the client sees anything. This catches issues when they are cheap to fix."
- "The handoff stage includes documentation. If you skip this, the client calls you every time something needs to change."
- "Each engagement gets its own copy of this workspace. _references/ can be shared across engagements. _config/ is always engagement-specific."

## Important Notes
- Discovery is the highest-value stage in the workspace. If the user does not currently do formal discovery, explain why it prevents their specific failure modes (using their own answers) but do not force it. Suggest a lightweight version they can try.
- The scope agreement is the most important document in the workspace. It is produced by discovery and consumed by every subsequent stage. Emphasize that building without a scope agreement is the root cause of most engagement problems.
- For agencies with multiple team members, note where handoff documentation between stages matters (not just client handoff at the end).
- If the user does many similar engagements, suggest building a "master workspace" template that gets copied and customized per client, rather than building from scratch each time.
