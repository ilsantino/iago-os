# Workflow: Content Production

## Overview
Three-stage pipeline: Research → Script → Production. Each stage has a defined contract, explicit inputs, and a clear output location. Human reviews between stages.

## Stage Map

| Stage | Purpose | Inputs | Output Location |
|---|---|---|---|
| 01_research | Gather and analyze source material | Topic brief, audience data, reference material | 01_research/output/ |
| 02_script | Write the content draft | Research output, voice/tone file, format patterns, constraints | 02_script/output/ |
| 03_production | Prepare for final delivery | Script draft, production specs, brand assets | 03_production/output/ |

## How Stages Connect
- 01 → 02: Research output becomes the source material for scripting. The script stage reads the research summary and key findings, NOT the raw source material. If the research stage did its job, the script stage should not need to go back to original sources.
- 02 → 03: Script output becomes the production input. The production stage formats, polishes, and prepares the script for its target format. It does not rewrite. If the production stage is doing heavy rewriting, the script stage needs tighter constraints.

## Reference Material (in _config/)
- voice-and-tone.md: How you sound. Loaded in stage 02.
- format-patterns.md: Structural guidance per content format. Loaded in stage 02.
- constraints.md: The never-do list. Loaded in stages 02 and 03.

## When to Add Stages
Add a stage when you consistently find yourself doing a distinct type of work between two existing stages. If you always outline before scripting, add 01b_outline or renumber. Do not add stages preemptively. Add them when the workflow demands it.
