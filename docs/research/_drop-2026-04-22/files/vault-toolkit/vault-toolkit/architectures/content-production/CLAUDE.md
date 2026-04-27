# Content Production Workspace

## What This Is
A workspace for producing content across formats (short-form video, long-form video, articles) from research through scripting through production. Designed for a solo creator or small team that publishes regularly and needs consistent voice across formats without locking into a rigid content mill structure.

## Current State
- This is a reference architecture. No active project.
- To use this workspace: copy the folder, populate _config with your brand files, and start with stage 01.

## Structure
```
content-production/
  CLAUDE.md              # You are here. Workspace map and entry point.
  CONTEXT.md             # Workflow routing. How stages connect.
  01_research/
    CONTEXT.md           # Stage contract: what to research and how.
    output/              # Research output. Becomes input for 02_script.
  02_script/
    CONTEXT.md           # Stage contract: writing the script or draft.
    output/              # Script drafts. Becomes input for 03_production.
  03_production/
    CONTEXT.md           # Stage contract: final production prep.
    output/              # Production-ready files.
  _config/               # Reference material. Voice, brand, constraints.
  _prompts/              # Reusable prompt fragments for common tasks.
```

## How to Use
1. Read CONTEXT.md to understand the full workflow.
2. Populate _config/ with your voice/tone file, format patterns, and constraints (see Constraint 05 in the Vault Toolkit).
3. Start in 01_research. Follow the stage contract. Drop output into 01_research/output/.
4. Move to 02_script. The stage contract tells you which files from 01_research/output/ to use.
5. Move to 03_production. Same pattern.
6. Human review happens between every stage. Read the output before moving forward.

## Key Decisions
- **Three stages, not five or seven.** Most content workflows have more detail than this, but three stages is the minimum viable decomposition. Research, writing, and production are distinct cognitive modes. Combining them produces worse output in all three. You can add stages (e.g., 02a_outline between research and script) when your workflow earns the complexity.
- **_config is separate from stages.** Brand voice, constraints, and format patterns are reference material (L3 in ICM terms). They are configured once and stay stable across runs. Keeping them outside the numbered stages means updating your brand guide does not require touching stage contracts.
- **Output directories are the handoff points.** Stage 01 writes to 01_research/output/. Stage 02 reads from there. This makes the data flow explicit and gives you a clear place to review and edit between stages.
- **No ideas folder in this architecture.** Idea management is a different workflow. If you want to track content ideas, build a separate workspace or use a simple list. Mixing ideation with production in one workspace creates clutter in the research stage.

## Layer Annotations
- CLAUDE.md: L0 (always loaded, ~800 tokens, orientation)
- CONTEXT.md: L1 (loaded on workspace entry, routing)
- Stage CONTEXT.md files: L2 (loaded per-task, stage contract)
- _config/ files: L3 (reference, loaded selectively per stage)
- Source material and stage outputs: L4 (working artifacts, loaded selectively)
