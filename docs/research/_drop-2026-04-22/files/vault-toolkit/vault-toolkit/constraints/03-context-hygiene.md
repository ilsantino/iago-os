# Constraint 03: My Context Window Is a Mess

## The Problem

You have been working with the model for a while. The conversation is long. You have pasted in documents, reference material, previous outputs, instructions, and corrections. The model's responses start getting worse. It contradicts earlier instructions. It forgets constraints you set at the beginning. It starts blending information from different sources in ways that do not make sense.

This is not the model getting tired. It is the context window getting noisy. Every token in the window competes for the model's attention. Research by Liu et al. (2024) documented that models degrade when processing long contexts full of irrelevant material. The relevant information gets buried. The model has to sort through everything to find what matters for this specific task, and it does not always sort correctly. Information in the middle of a long context gets less attention than information at the beginning or end.

The fix is not a bigger context window. It is a cleaner one.

---

## Layer 1: Principles That Predate AI

This is separation of concerns. David Parnas formalized it in 1972 in a paper called "On the Criteria To Be Used in Decomposing Systems into Modules." The core argument: each module should hide information that other modules do not need. When everything can see everything, changes in one place cause unpredictable effects everywhere else. When each module has a defined scope, changes stay local.

Parnas was writing about software, but the principle is universal. Your desk works the same way. If every document you own is spread across one surface, finding anything takes longer and you make more mistakes. If documents are filed by project and you pull out one project folder at a time, you work faster and more accurately. This is not a metaphor. The context window is literally the model's desk.

The Unix philosophy applies here too. Doug McIlroy (1978) described it: write programs that do one thing and do it well. Write programs to work together. A context window that tries to do everything at once violates this at the most basic level.

**Traditional tools that handle this:**
- **Folders on your filesystem.** The oldest context management technology. Files in different folders are physically separated. You choose which folder to open. This is the implementation layer for most of what follows.
- **Obsidian, Notion, or any note-taking tool with linking:** These let you create separate notes that reference each other without dumping everything into one document. Linked notes are context that stays available but does not load until you need it.
- **Project management tools (Trello, Asana, Linear):** Each card or task has its own context. You do not see every task when you are working on one task. This is separation of concerns applied to work management.

---

## Layer 2: Existing Skills and Tools

**Claude Projects with scoped knowledge sources**
If you are working in Claude Projects, the knowledge sources you attach scope what the model sees. Attach only the sources relevant to the project. If you have a brand guide, a product spec, and a competitor analysis, but the project is about writing email copy, you probably need the brand guide and the product spec. The competitor analysis can stay out until you need it. Fewer sources means less noise.

**mem0 MCP server** (github.com/mem0ai/mem0)
A persistent memory layer that stores and retrieves contextual data, facts, and relationships across sessions. Instead of pasting everything into every conversation, mem0 maintains a structured memory that the model can query. This keeps the active context window lean while making historical context available on demand.

**Conversation branching**
Most interfaces support starting a new conversation. This is an underused tool. When your current conversation has accumulated 20+ exchanges of context, and you are starting a new subtask, open a new conversation. Paste in only what the new task needs. A fresh context window with targeted information outperforms a long conversation window with accumulated noise every time.

**The CLAUDE.md pattern**
A short file (under 800 tokens) that loads at the start of every session. It tells the model where it is, what the workspace contains, and where to find things. This is Layer 0 in the ICM hierarchy. It does not contain detailed instructions. It contains a map. The model reads the map, then navigates to the specific files it needs for the current task, instead of having everything loaded from the start.

---

## Layer 3: The Architectural Fix

ICM organizes context into five layers, and the key insight is that not every layer loads at the same time.

```
L0: CLAUDE.md       "Where am I?"       Always loaded. ~800 tokens.
L1: CONTEXT.md      "Where do I go?"    Read on entry. ~300 tokens.
L2: Stage contract  "What do I do?"     Read per task. ~200-500 tokens.
L3: Reference       "What rules apply?" Loaded selectively. Varies.
L4: Working files   "What am I working  Loaded selectively. Varies.
                     with?"
```

L0 through L2 are routing. They are structural. They tell the model how to navigate, not what to produce. They are small and always relevant.

L3 is the factory. Design systems, voice rules, build conventions, style guides. Configured once, stable across runs. You load the L3 files that a specific stage needs, not all of them.

L4 is the product. Output from previous stages, user-provided source material, anything specific to this run. Loaded only when the current stage needs it.

**The critical distinction:** L3 material needs to be internalized as constraints and patterns. L4 material needs to be processed as input to transform. Mixing them in an undifferentiated context window forces the model to figure out which is which on its own. Sometimes it treats your reference material as content to transform. Sometimes it treats your source content as a constraint to follow. Both are context hygiene failures.

**Practical rules for a clean context window:**

1. **Count your layers.** If you are loading L0, L1, L2, three L3 files, and two L4 files all at once, you are probably loading too much. For most tasks, L0 + L2 + one or two L3 files + one L4 file is sufficient.

2. **Remove before you add.** Before pasting new context into a conversation, ask whether any of the existing context is no longer relevant. In Jake's transcript, he describes "constantly removing and putting back in" from the CLAUDE.md. This is active context management. Your context window is not an archive. It is a workbench. Clear it between tasks.

3. **Separate reference from source.** If you have a style guide and a transcript, and the task is to write a script from the transcript in the style guide's voice, make sure the model knows which is which. Label them. "REFERENCE (do not transform, use as constraints):" and "SOURCE (transform this into the output):" are ugly but effective headers.

4. **Front-load the important stuff.** Due to how attention mechanisms work, information at the beginning and end of the context window gets more weight than information in the middle. Put your most important constraints and instructions at the beginning. Put your source material after that. If you must include a lot of context, put a brief summary of key constraints at the end as a reminder.

5. **Use the filesystem as external memory.** Not everything needs to be in the context window. Files on disk are context that is available but not loaded. The model (in Claude Code, Cowork, or Cursor) can read a file when it needs it. Keeping reference material in files and loading it selectively is cheaper and more reliable than pasting it all into the conversation.

**The token budget heuristic:**

A rough guide for allocating your context window:
- Routing (L0 + L1 + L2): 10-15% of your context budget
- Reference (L3): 20-30%
- Source material (L4): 30-40%
- Room for the model's output and reasoning: 20-30%

If your reference material is consuming 60% of the window, it is too much. Either split it into smaller files and load only what this stage needs, or summarize it into a condensed reference. A 50-line constraint file that captures the essential rules is more useful than a 500-line comprehensive guide that the model has to sift through.

---

## Tuning Questions

**1. How many files or documents does your current workflow load at once?**
Count them. If the answer is more than 5, you are probably loading context that the current task does not need. For each file, ask: does THIS task need THIS file? If the answer is no, do not load it.

**2. Which of your reference materials change between runs, and which stay the same?**
Material that stays the same across runs (brand guide, style constraints, process documentation) is L3. Material that changes each run (source content, previous stage output, client brief) is L4. If you are re-loading stable reference material from scratch every session instead of keeping it in a persistent location (Claude Project knowledge, files on disk), you are wasting tokens on context setup.

**3. At what point in a conversation does quality start to degrade?**
Pay attention to this. If it happens around message 10-15, your context is accumulating noise. Try starting a fresh conversation at that point with only the information the next task needs. If quality is fine until you paste in a large document, the document is probably too large. Summarize it or extract the relevant sections before including it.

---

## Quick Reference

| If this is your situation | Start here |
|---|---|
| Model contradicts earlier instructions | Important constraints have drifted to the middle of a long context. Restate them or start fresh. |
| Quality degrades over a long conversation | Open a new conversation. Paste in only what the next task needs. |
| Model confuses reference material with source content | Label them explicitly: REFERENCE vs. SOURCE. Ugly but effective. |
| Everything loads every time | Build a CLAUDE.md that maps the workspace. Let the model navigate to files instead of loading everything upfront. |
| You are not sure what is in your context | That is the problem. Map it. Know what is loaded and why. |
