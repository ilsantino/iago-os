# Stage 02: Script

## Purpose
Write the content draft based on the research summary. The output is a script, article, or structured draft ready for production polish.

## Inputs
- **01_research/output/research-summary.md**: The research output. This is your primary source. Do not go back to raw source material unless something is clearly missing.
- **_config/voice-and-tone.md**: How the creator sounds. Read this first to calibrate tone.
- **_config/format-patterns.md**: Structural guidance for the target format. Read the section that matches the content type being produced.
- **_config/constraints.md**: The never-do list. Read this every time.

## Process
1. Read the research summary. Identify the narrative thread: how does the core insight build from introduction to conclusion?
2. Read voice/tone and format patterns for the target format.
3. Read constraints.
4. Write the draft. Follow the structural guidance for the target format. Let the voice emerge from the patterns described in the voice file, not from explicit tone instructions.
5. Self-check against constraints. Read the draft and verify that no constraint violations exist.
6. Write to output.

## Output
Write to: 02_script/output/draft-[format]-[topic-slug].md

Format varies by content type:
- **Short-form video**: Hook (first line), body (core insight, one supporting point), close (question or reframe). Under 200 words.
- **Long-form video (tutorial)**: Opening context, walkthrough steps, key takeaways. 800-1500 words depending on depth.
- **Long-form video (narrative)**: Story arc with conceptual thread. 1000-2000 words.
- **Article**: Opening observation, development, implications. Length matches the publication target.

Include a header:
```
# [Title]
Format: [short-form / tutorial / narrative / article]
Target length: [word count]
Core insight: [one sentence from research summary]
```

## Done Looks Like
A draft that can be read aloud (for video) or published (for articles) with only production-level polish remaining. If the production stage needs to restructure paragraphs, rewrite transitions, or fix voice inconsistencies, this stage needs tighter execution.

## Common Failure Modes
- **Opening with a generic intro paragraph.** Cut it. Start with the hook or the observation. The audience decides in the first sentence whether to keep reading.
- **Trying to cover everything from the research summary.** The research summary is a buffet. The script picks one plate. Not every supporting point needs to make it into the draft. Ruthless selection is the job of this stage.
- **Drifting into list structure.** If the constraints file says no bullet-heavy structure, check for it. The default tendency is to organize supporting points as a numbered list. Resist unless the format explicitly calls for it.

## Layer Annotation
This is an L2 stage contract. It loads only when working in this stage. The research summary (from 01_research/output/) is L4, specific to this run. The voice, format, and constraint files (from _config/) are L3, stable across runs.
