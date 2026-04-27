# Client Delivery Workspace

## What This Is
A workspace for delivering a client engagement from discovery through handoff. Designed for consultants, agencies, and service providers who run multi-stage projects with client review checkpoints. Each client engagement gets a copy of this workspace.

## Current State
- This is a reference architecture. No active engagement.
- To use: copy the folder, rename to the client/project, populate _config with client and project details.

## Structure
```
client-delivery/
  CLAUDE.md              # You are here.
  CONTEXT.md             # Engagement workflow.
  01_discovery/
    CONTEXT.md           # Stage contract: understand the problem.
    output/              # Discovery findings, requirements, scope document.
  02_build/
    CONTEXT.md           # Stage contract: create the deliverable.
    output/              # Work in progress and completed deliverables.
  03_review/
    CONTEXT.md           # Stage contract: internal and client review.
    output/              # Reviewed deliverables, feedback, revision notes.
  04_handoff/
    CONTEXT.md           # Stage contract: deliver and transition.
    output/              # Final deliverables, documentation, transition materials.
  _config/               # Client context, project scope, engagement terms.
  _references/           # Domain reference material, frameworks, prior work.
```

## How to Use
1. Copy this folder. Rename it to the engagement (e.g., client-name-project-q2-2026).
2. Populate _config/ with client details and engagement terms.
3. Start in 01_discovery. This stage produces the requirements and scope that drive everything else.
4. Move through stages sequentially. Human review between every stage.
5. Client review happens in stage 03. Internal review also happens here before showing anything to the client.
6. Stage 04 is not just "send the files." It includes documentation, knowledge transfer, and transition planning.

## Key Decisions
- **Four stages, not three.** The review stage is separate from build because combining them creates pressure to skip review when the deadline is tight. A separate stage makes review a non-negotiable part of the workflow.
- **Discovery is its own stage.** The most common cause of failed engagements is insufficient discovery. Making it a stage with a contract and explicit outputs forces the team to do the work before building.
- **Handoff is its own stage.** Delivery without transition planning creates ongoing dependency. The handoff stage produces documentation and knowledge transfer materials so the client can operate independently.
- **_references/ is separate from _config/.** Config holds engagement-specific context (this client, this project, these terms). References hold domain knowledge that might apply across engagements (frameworks, methodologies, prior work from similar projects). Separating them means you can share references across engagements without sharing client-specific config.

## Layer Annotations
- CLAUDE.md: L0 (always loaded, orientation)
- CONTEXT.md: L1 (engagement workflow routing)
- Stage CONTEXT.md files: L2 (stage contracts)
- _config/ files: L3 (engagement-specific reference)
- _references/ files: L3 (domain reference, potentially shared across engagements)
- Client materials and stage outputs: L4 (working artifacts)
