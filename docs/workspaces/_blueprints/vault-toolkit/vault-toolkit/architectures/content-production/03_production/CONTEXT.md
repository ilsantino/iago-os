# Stage 03: Production

## Purpose
Polish the draft for delivery. This stage handles final voice alignment, formatting, and preparation for the target platform. It does NOT rewrite. If significant rewriting is needed, return to stage 02.

## Inputs
- **02_script/output/draft-[format]-[topic-slug].md**: The script draft.
- **_config/constraints.md**: The never-do list. Final pass to catch any remaining violations.
- **Platform-specific requirements** (optional, provided at task time): Word limits, character counts, hashtag requirements, thumbnail text, description fields.

## Process
1. Read the draft.
2. Read constraints.
3. Polish pass: tighten language, improve transitions, check rhythm. Do not add new content. Do not restructure.
4. Constraint audit: read through the constraints file line by line and verify the draft violates none of them. This is a checklist pass, not a creative pass.
5. Format for platform: apply any platform-specific requirements (character limits, metadata fields, etc.).
6. Write final output.

## Output
Write to: 03_production/output/final-[format]-[topic-slug].md

Include platform metadata if applicable:
```
# [Title]
Format: [format]
Platform: [target platform]
Final word count: [count]
Constraint audit: [pass / list any unresolved items]

---

[Final content here]

---

## Platform Fields (if applicable)
Description: [platform description text]
Tags/Hashtags: [if relevant]
Thumbnail text: [if relevant]
```

## Done Looks Like
Content that is ready to record, publish, or submit. No further editing should be needed. If you find yourself editing the output of this stage before publishing, either this stage's polish pass was insufficient or the script stage produced a draft that was not ready for production.

## Layer Annotation
This is an L2 stage contract. The draft from 02_script/output/ is L4 (working artifact, specific to this run). The constraints file is L3 (reference, stable across runs). Platform requirements are L4 (specific to this run and target).
