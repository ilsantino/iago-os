# Constraint 04: I Cannot Get Consistent Results Across Sessions

## The Problem

You spent an hour getting the model dialed in. The output was exactly right. You closed the conversation. The next day, you start a new session and the model acts like you never met. You re-explain your context, re-establish your constraints, and the output is close but not quite the same. Something shifted. The voice is slightly different, the structure is slightly off, the emphasis lands in the wrong place.

This happens because language models have no memory between sessions. Every conversation starts from zero. The model in your afternoon session is not a continuation of the model from your morning session. It is a fresh instance that has never seen your work before. Any consistency you experienced within a single conversation was the product of accumulated context in that conversation's window. When the window closes, the context is gone.

The question is not how to give the model memory. The question is how to make your workspace carry the state so the model does not have to.

---

## Layer 1: Principles That Predate AI

This is documentation. The oldest knowledge management technology. Humans have the same problem: a colleague who helped you on a project last month does not remember the specifics today. The solution is the same as it has always been. Write it down. Put it where the next person (or the next session) can find it.

Specifically, what needs to be documented is not the conversation. It is the decisions. What was decided, why, and what constraints resulted from that decision. Decision logs are a standard practice in software development (Architecture Decision Records, or ADRs) and project management. They exist because teams discovered that without them, the same decisions get relitigated in every meeting.

The same principle applies to your AI workflow. If session 1 established that "the tone should be direct but not aggressive, and lists should only be used when comparing more than three items," that is a decision. Write it down. Load it in session 2.

**Traditional tools that handle this:**
- **A running document or changelog.** A single file where you record what worked, what did not, and what constraints emerged from each session. Append to it after each work session. Load it at the start of the next one.
- **Version control (Git).** If you are working with files, Git tracks every change across every session. You can see exactly what changed, when, and (if you write commit messages) why. Even for non-code files like markdown, Git provides a complete history.
- **Standard operating procedures (SOPs).** If your workflow is repeatable, the SOP is the state that persists. It describes the process, the standards, and the known edge cases. It is the institutional memory for the workflow.

---

## Layer 2: Existing Skills and Tools

**Claude Projects (persistent knowledge)**
Claude Projects maintain knowledge sources and a project instruction file across all conversations within the project. This is the simplest persistence mechanism available. Your constraints, reference material, and output standards live in the project. Every new conversation in that project starts with that context already loaded. If you are not using Projects for repeatable work, start.

**Claude Memory**
Claude's built-in memory system stores information across conversations. You can tell Claude to remember specific decisions, preferences, or constraints. This works for personal preferences and recurring context. It is less precise than file-based persistence because you cannot control exactly what is stored or how it is retrieved, but it requires zero setup.

**mem0 MCP server** (github.com/mem0ai/mem0)
A structured memory layer that stores facts, relationships, and context. More controllable than built-in memory. You can query it, update it, and scope it to specific projects. Useful for workflows where the context that needs to persist is complex or changes often.

**Obsidian or Notion as a state store**
If you work across multiple tools and models, a central note-taking system becomes your persistence layer. After each session, update your project notes. Before the next session, pull the relevant notes into your context. This is manual but platform-agnostic. It works with Claude, ChatGPT, Copilot, or any other model.

---

## Layer 3: The Architectural Fix

In ICM, the workspace itself is the memory. The folder structure, the CLAUDE.md, the stage contracts, the reference files, and the output from previous runs all persist on disk between sessions. When a new session starts, the model reads CLAUDE.md and knows where it is, what exists, and where to find things. It does not need to remember the previous session. It reads the state from the filesystem.

This is the same principle that makes web applications work. A web server does not remember your previous visit. It reads your state from a database, a cookie, or a session store. The application appears to have continuity because the state is externalized, not because the server has memory.

**What needs to persist between sessions:**

1. **Decisions and constraints** (goes in L3 reference files or in the CLAUDE.md)
If session 1 established that the output should use short paragraphs and avoid headers, write that into your constraints file. It is now a permanent part of the workspace. Future sessions inherit it automatically.

2. **The current state of work** (goes in L2 stage contract or a status file)
Where are you in the workflow? Which stages are complete? What is the next step? A simple status section in your CONTEXT.md or CLAUDE.md keeps the model oriented. Something like:

```
## Current State
- Research: Complete. Output in 01_research/output/
- Script: In progress. Draft 2 in 02_script/output/
- Production: Not started.
- Next step: Revise script draft 2 based on feedback in 02_script/feedback.md
```

3. **What worked and what did not** (goes in a session log or the relevant stage's notes)
If you discovered that a specific prompting approach produced better results, or that a reference file needed to be restructured, capture that. This is institutional knowledge about your own workflow. Without it, you rediscover the same lessons every few sessions.

**The update discipline:**

The most common failure mode is not a lack of persistence mechanisms. It is neglecting to update them. If you finish a session and do not update your workspace state, the next session starts from stale context. Build a habit: at the end of each work session, spend 2 minutes updating the relevant files. Update the status. Record any new decisions. Note anything that should change for next time.

This is cheap. Two minutes of file updates saves 15 minutes of re-establishing context in the next session. And it compounds. After 10 sessions with consistent updates, your workspace is a rich, accurate representation of your project state. A new session can pick up exactly where the last one left off.

**When to start fresh versus when to persist:**

Not everything should persist. Brainstorming sessions, one-off questions, and exploratory work often benefit from a clean slate. Persist the workspace state for repeatable workflows where consistency matters. Do not persist every conversation. Persist the decisions, the constraints, and the current state.

---

## Tuning Questions

**1. What information do you find yourself re-explaining at the start of every session?**
Whatever that is, it should be in a file that loads automatically. If you re-explain your brand voice every time, your voice file is either missing or not loading. If you re-explain where the project is, your status tracking is missing. The things you repeat are the things that need to be externalized.

**2. What changed in the last session that the next session needs to know about?**
This is your update discipline check. If the answer is "I don't know" or "nothing, I think," you are not capturing state changes. Start a simple session log. It does not need to be comprehensive. Three bullets: what was done, what was decided, what is next.

**3. How many of your projects are truly repeatable versus one-off?**
Persistence infrastructure is worth building for repeatable workflows. For a one-off task, a single well-structured conversation is sufficient. Do not over-engineer persistence for work you will only do once. But if you find yourself doing "one-off" tasks that look suspiciously similar to last month's "one-off" task, that is a repeatable workflow in disguise. Build the workspace.

---

## Quick Reference

| If this is your situation | Start here |
|---|---|
| Model "forgets" your preferences every session | Use Claude Projects with a project instruction file, or put preferences in a file that loads at session start |
| Output quality varies between sessions | Your constraints are living in conversation context, not in persistent files. Externalize them. |
| You spend the first 10 minutes of every session re-establishing context | Build a CLAUDE.md with a current state section. Update it at the end of each session. |
| The model does not know where the project is | Add a status section to your workspace routing file. Three lines: what is done, what is in progress, what is next. |
| You rediscover the same lessons repeatedly | Start a session log. Three bullets after each session: done, decided, next. |
