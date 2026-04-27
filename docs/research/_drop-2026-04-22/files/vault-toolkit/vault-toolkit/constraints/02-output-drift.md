# Constraint 02: Output Drifts From What I Asked

## The Problem

You gave clear instructions. The model gave you something adjacent to what you wanted but not quite right. Maybe it answered a question you did not ask. Maybe it added sections you did not request. Maybe it followed the spirit of your instruction but missed the specifics. You fix it, re-prompt, and it drifts again in a different direction.

This is not the model being bad at following instructions. It is the model being good at inference. When your instruction leaves gaps, the model fills them with its best guess at what you probably meant. Those guesses trend toward the most common version of that type of task in its training data. If you asked for a "blog post," it infers a structure, a tone, and a length from the millions of blog posts it has processed. If that inference does not match what you had in mind, the output drifts.

Drift is a specificity problem, not an intelligence problem.

---

## Layer 1: Principles That Predate AI

Requirements writing has been a discipline for decades precisely because humans also drift when instructions are vague. Every project management methodology, from Waterfall to Agile, treats "what does done look like?" as the central question. The answer to that question prevents drift.

The most useful framework here is not from software. It is from journalism. The inverted pyramid: most important information first, supporting detail second, background last. When you structure your instructions this way, the model hits the critical requirements even if it drifts on the details.

**What "done" looks like, stated upfront, prevents most drift.**

There is a body of research on instruction clarity in education that applies directly. Bloom's Taxonomy (1956, revised 2001) distinguishes between levels of cognitive task: remember, understand, apply, analyze, evaluate, create. Telling a model to "write about X" is a create-level task with no constraints. Telling it to "analyze X using framework Y and produce a 300-word summary structured as problem/evidence/implication" is a create-level task with tight scope. The second one drifts less because there is less room to drift.

**Traditional tools that handle this:**
- **Any outlining tool** (pen and paper, a notes app, a whiteboard): If you can outline what you want before you prompt, the outline becomes the instruction. This sounds obvious. Most people skip it.
- **Checklists**: Write a 3-5 item checklist of what the output MUST contain. Include it in the prompt. The model treats checklist items as hard requirements more reliably than it treats prose descriptions.
- **Examples**: One concrete example of what you want is worth more than a paragraph of description. If you have a previous output that was close to right, include it and say "like this, but with these changes."

---

## Layer 2: Existing Skills and Tools

Drift prevention is less about specific skills and more about how you structure the interaction. That said, there are tools that help.

**Claude Projects (knowledge sources)**
If you are working in Claude Projects, your knowledge sources persist across conversations. A well-written project instruction file that defines output standards, combined with a reference example in the knowledge sources, reduces drift significantly. The model reads the project instructions every time. If those instructions include a clear output specification, it anchors against that specification.

**Structured output formats**
Most models support requesting output in specific formats: JSON, markdown with defined headers, tables with specific columns. Structural constraints reduce drift because the model has less freedom to infer structure. If your output must be a table with columns [Topic | Key Point | Evidence | Source], the model cannot drift into a narrative essay.

**Timescale content-reviewer skill** (github.com/timescale/marketing-skills)
Designed to review content against brand and quality standards. Useful as a second pass: generate the output, then run the reviewer against your spec. The reviewer catches drift that you might miss on a quick read.

**Any diff tool**
If you are iterating on a document across multiple prompts, use a diff tool (built into VS Code, available in any code editor) to see exactly what changed between versions. Models sometimes "improve" sections you did not ask them to touch. A diff catches this instantly.

---

## Layer 3: The Architectural Fix

In ICM terms, drift happens when the Layer 2 stage contract is underspecified. The L2 contract is the instruction set for one step of your workflow. It defines inputs, process, and outputs. When any of those three are vague, the model fills the gap with inference.

The fix is an explicit contract. Here is the structure:

```
## Stage: [Name]

### Inputs
- [File or data source 1]: Read [specific section or field]
- [File or data source 2]: Use as [reference / template / constraint]

### Process
1. [First specific action]
2. [Second specific action]
3. [Third specific action]

### Output
- Format: [exact format specification]
- Length: [word count or structural constraint]
- Must include: [non-negotiable elements]
- Must NOT include: [explicit exclusions]
- Done looks like: [one sentence describing the successful output]
```

The "Must NOT include" line is as important as the "Must include" line. Models default to being comprehensive. If you do not want an introduction paragraph, say so. If you do not want it to summarize at the end, say so. Exclusions prevent the most common forms of drift: unsolicited summaries, unnecessary context-setting, and scope creep into adjacent topics.

The "Done looks like" line is the anchor. It gives the model a target to check its own output against. Some practitioners call this a "completion criteria." Whatever you call it, it is the single highest-impact line you can add to any instruction.

**Why drift compounds over multi-step workflows:**

If stage 1 drifts by 5% and stage 2 takes stage 1's output as input, stage 2 starts from a drifted baseline. By stage 3, you are working with output that has compounded drift from two previous stages. This is why ICM uses explicit handoff points (the output/ directories in each stage folder). A human reviews the output of each stage before the next stage consumes it. That review checkpoint catches drift before it compounds.

You do not need a human at every checkpoint for every run. But you should have a human at every checkpoint for the first few runs of a new workflow. Once you trust the output at each stage, you can let stages chain automatically. If drift reappears, re-insert the human checkpoint.

This is the same principle behind quality control in manufacturing. You inspect at each station, not just at the end of the line. Deming formalized this in the 1950s. It applies to token pipelines for the same reason it applies to assembly lines: catching defects early is cheaper than catching them late.

---

## Tuning Questions

**1. Can you describe your expected output in one sentence?**
If you cannot, the model cannot hit it. This is not a limitation of the model. It is a signal that you have not finished thinking about what you want. Finish thinking first. Prompt second. The sentence does not need to be perfect. It needs to exist.

**2. What would make you reject a result?**
This is the negative specification. Most people can describe what they do NOT want more easily than what they do want. Use that. Your rejection criteria are your "Must NOT include" list. Three to five of these, stated explicitly, eliminate the most common drift paths.

**3. Where in your workflow does drift actually cost you?**
If you are brainstorming, drift is a feature. The model exploring adjacent territory might surface ideas you had not considered. If you are producing a deliverable, drift is a defect. Know which mode you are in. Brainstorming stages should have loose contracts. Deliverable stages should have tight ones. The same workflow can have both.

---

## Quick Reference

| If this is your situation | Start here |
|---|---|
| Output includes things you did not ask for | Add a "Must NOT include" list to your instruction |
| Output misses key requirements | Write a 3-5 item checklist of what "done" looks like |
| Output is the wrong format or structure | Specify exact format (table, headers, word count) in the instruction |
| Output drifts more on later stages | Add human review checkpoints between stages. Inspect at each station. |
| You keep re-prompting to get it right | Your instruction is probably too vague. Rewrite it as an Inputs/Process/Output contract before prompting again. |
