# Constraint 08: I Built Something But Cannot Hand It Off

## The Problem

You built a working workflow. It produces good results for you. Now someone else needs to use it. A colleague, a client, a contractor, or even just future you in six months when you have forgotten the details. You try to explain how it works and realize that half of the important context lives in your head. The folder structure makes sense to you but not to anyone else. The naming conventions are clear to you but arbitrary to a newcomer. The reason certain files exist, certain constraints are set, and certain stages are ordered the way they are is knowledge you carry but never wrote down.

This is not a documentation problem in the traditional sense. Traditional documentation describes what a system does. What you need is documentation that describes why the system is structured the way it is, so the next person can make good decisions about it, not just operate it.

---

## Layer 1: Principles That Predate AI

Software engineering solved this decades ago, and then solved it again, and again, because every generation rediscovers that code without documentation is a liability.

**Architecture Decision Records (ADRs)** are a practice from the software world where teams log each significant design decision: what was decided, what alternatives were considered, and why this option was chosen. The format is simple and the value is enormous. When a new team member asks "why do we do it this way?" the ADR answers the question without requiring the original decision-maker to be in the room.

**README files** are the universal entry point for software projects. A good README answers three questions in under a minute: what is this, how do I use it, and where do I go for more detail. Every open-source project that gets adopted has a good README. Every internal tool that gets abandoned has a bad one or none at all.

**Naming conventions** are load-bearing documentation. A folder called "01_research" tells you two things: this is the first stage, and it contains research. A folder called "stuff" tells you nothing. Consistent, descriptive naming reduces the need for external documentation because the structure self-documents. The Unix tradition of naming things by what they do (ls, cp, mv, grep) is the same principle.

**Traditional tools:**
- **Git and GitHub.** Version control is handoff infrastructure. A shared repository means everyone works from the same source of truth. Pull requests create a review process. Commit history shows what changed and when. Even for non-code workspaces (markdown files, templates, reference material), Git makes collaboration tractable.
- **Shared drives (Google Drive, OneDrive, SharePoint, Dropbox).** If Git is too technical for your team, a shared folder with a consistent structure achieves 80% of the benefit. The key is the consistent structure, not the tool.
- **Loom or screen recordings.** Sometimes the fastest way to explain a workflow is to walk through it on camera. A 5-minute Loom recording of you running through your workspace can supplement written documentation and catch the nuances that text misses.

---

## Layer 2: Existing Skills and Tools

**Claude Projects as shared workspaces**
A Claude Project can be shared across team members (on Team and Enterprise plans). The project instructions and knowledge sources create a shared context. New team members start conversations within the project and inherit the full context without needing a verbal walkthrough.

**GitHub for workspace distribution**
If your workspace is a folder structure with markdown files (which ICM workspaces are), GitHub is the natural distribution mechanism. Clone the repository. Run the workflow. Submit changes via pull requests. The repository history shows how the workspace has evolved over time.

For non-technical teams, GitHub's web interface lets people browse files, read documentation, and download the workspace as a zip file without touching the command line.

**Skill files as portable process**
A well-written skill file is inherently portable. It contains the instructions, the references, and the output specification in one place. Handing someone a skill file is handing them the process in a format that Claude (or any model that reads markdown) can execute.

**Obsidian shared vaults**
Obsidian supports shared vaults via Obsidian Sync, Git, or shared drives. If your team uses Obsidian for knowledge management, a shared vault containing your workspace documentation becomes the handoff mechanism. Each note links to related notes, creating a navigable knowledge graph.

---

## Layer 3: The Architectural Fix

In ICM, the structure IS the documentation. A well-built workspace can be handed off by handing someone the folder. This is only true if the structure follows a few principles.

**Self-documenting structure:**

```
workspace/
  CLAUDE.md               # "Where am I?" - Entry point. Map of the workspace.
  CONTEXT.md              # "Where do I go?" - Workflow overview. Stage connections.
  01_research/
    CONTEXT.md            # "What do I do?" - Stage contract for research.
    output/               # Where research output goes. Input for next stage.
  02_script/
    CONTEXT.md
    output/
  03_production/
    CONTEXT.md
    output/
  _config/                # Reference material. Brand guides, style rules, constraints.
  _templates/             # Reusable templates for stage outputs.
```

Someone opening this folder for the first time can read CLAUDE.md, understand the workspace, read CONTEXT.md, understand the workflow, navigate to any stage, read its CONTEXT.md, and understand what that stage does. No external documentation needed. The structure is the documentation.

**The numbering matters.** Numbered prefixes (01_, 02_, 03_) encode execution order. Someone browsing the folder sees the workflow sequence without reading a single file. Alphabetical sorting in any file manager displays them in the correct order.

**The underscore prefix matters.** Folders starting with underscore (_config, _templates, _prompts) are support folders, not workflow stages. They sort to the top or bottom (depending on the file manager) and visually separate from the numbered stages. A newcomer can immediately distinguish "stages I work through" from "reference material I pull from."

**Handoff points are explicit.** Each stage has an output/ directory. The output of stage 01 is the input for stage 02. This makes the data flow visible. If you want to review or edit the handoff between stages, you know exactly where to look.

**What goes in CLAUDE.md for handoff:**

A good CLAUDE.md for a handed-off workspace includes:

```
# [Workspace Name]

## What This Is
[One paragraph: what this workspace produces and for whom.]

## Current State
[Three lines: what is done, what is in progress, what is next.]

## Structure
[A map of the workspace. What each folder contains and does.]

## How to Use
[Three to five steps: how to run the workflow from start to finish.]

## Key Decisions
[Bullet list of significant design choices and why they were made.
 These are your ADRs. They answer "why is it this way?" before
 someone needs to ask.]
```

This file is under 800 tokens. A model reads it in one pass. A human reads it in under a minute. It gives both the orientation they need to start working.

**The handoff checklist:**

Before handing off a workspace, verify:

1. **Can someone open the folder and know what it is?** CLAUDE.md exists and answers "what is this?" in the first paragraph.

2. **Can someone see the workflow?** Stages are numbered. CONTEXT.md explains the flow. The connection between stages (one stage's output being the next stage's input) is clear.

3. **Can someone run a stage without asking you?** Each stage CONTEXT.md has Inputs, Process, and Outputs clearly defined. The inputs reference specific files. The outputs describe what "done" looks like.

4. **Can someone change a reference without breaking things?** Reference material (_config) is separate from stage logic. Updating the brand guide does not require editing stage contracts.

5. **Can someone understand why things are this way?** Key decisions are logged in CLAUDE.md or in a decisions log. The "why" is as important as the "what."

If the answer to any of these is no, the workspace is not ready for handoff. Fix the weakest point first.

---

## Tuning Questions

**1. Could someone open your workspace cold and know where to start?**
Try it. Ask someone unfamiliar with the project to open the folder and tell you what they think it does. If they can figure it out in under two minutes, your structure is self-documenting. If they cannot, your CLAUDE.md is either missing, incomplete, or unclear.

**2. What questions would someone ask you in the first hour of using this workspace?**
Write those questions down. Answer them in the CLAUDE.md or in the relevant stage contract. Every question someone would need to ask you is documentation that is missing.

**3. What would break if you changed one reference file?**
If changing the brand guide requires updating three stage contracts and the CLAUDE.md, your workspace has tight coupling. Reference material should be referenced, not duplicated. Change the reference in one place and every stage that references it picks up the change.

---

## Quick Reference

| If this is your situation | Start here |
|---|---|
| Nobody else can use your workspace | Write a CLAUDE.md that answers: what is this, how do I use it, and why is it structured this way. |
| People keep asking you the same questions about the process | Turn those questions into documentation in the relevant stage contracts. |
| Handing off a project takes a long meeting | The meeting is the documentation. Record it, or better, put that content in files. |
| Your workspace works for you but looks chaotic to others | Apply consistent naming (numbered stages, underscore for support folders, descriptive filenames) and add one CONTEXT.md per stage. |
| You want to share your workspace as a template | Strip out project-specific content. Leave the structure, the stage contracts, and the reference architecture. What remains is the template. |
