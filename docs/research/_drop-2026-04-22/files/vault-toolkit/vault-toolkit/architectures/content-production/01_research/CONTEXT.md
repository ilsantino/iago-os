# Stage 01: Research

## Purpose
Gather, organize, and analyze source material for a content piece. The output of this stage is a structured research summary that the script stage can work from directly.

## Inputs
- **Topic brief**: What the content is about. Can be a sentence, a paragraph, or a pasted transcript. Provide this when you enter the stage.
- **Audience data** (optional, from _config/ or pasted): Who this content is for. What they already know. What they need.
- **Source material** (optional): Transcripts, articles, documents, data. Anything the content should draw from.

## Process
1. Read all provided source material.
2. Identify the core insight. One sentence. What is the single thing the audience should understand after consuming this content?
3. Extract supporting evidence, examples, and data points that support the core insight.
4. Note any counterarguments, objections, or nuances that should be addressed.
5. Identify connections to existing content pillars or themes (if applicable).
6. Produce the research summary in the output format below.

## Output
Write to: 01_research/output/research-summary.md

Format:
```
# Research Summary: [Topic]

## Core Insight
[One sentence.]

## Supporting Evidence
[3-5 key points with sources/references.]

## Objections or Nuances
[What a skeptic would say. What edge cases exist.]

## Audience Considerations
[What this audience already knows. Where to start the explanation.
 What level of technical detail is appropriate.]

## Connections
[How this topic connects to other work, themes, or previous content.]
```

## Done Looks Like
A research summary that contains enough structured information for the script stage to write from without going back to the original sources. If the script writer needs to re-read the raw transcripts, this stage did not extract enough.

## Layer Annotation
This is an L2 stage contract. It loads only when working in this stage. The source material loaded here is L4 (working artifacts specific to this run). Audience data from _config/ is L3 (reference, stable across runs).
