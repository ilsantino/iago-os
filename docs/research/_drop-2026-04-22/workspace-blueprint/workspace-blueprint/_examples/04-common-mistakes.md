# Common Mistakes (and How to Fix Them)

## Mistake 1: One Giant CLAUDE.md

**What happens:** You put everything — voice, process, standards, pipeline details — into CLAUDE.md because it's "always loaded."

**Why it breaks:** CLAUDE.md is loaded in EVERY conversation. If it's 500 lines, you've burned tokens on animation pipeline details when the agent is writing a blog post. You've also made it harder for the agent to find what's relevant.

**Fix:** CLAUDE.md = map only. Folder structure, navigation table, naming conventions, cross-workspace flow. Everything else lives in workspace CONTEXT.md files and docs/.

---

## Mistake 2: No "Skip These" Column

**What happens:** Your "What to Load" table tells agents what to read but not what to ignore.

**Why it breaks:** Without explicit skip instructions, a thorough agent might load related-looking files "just in case." That's wasted context and potential confusion.

**Fix:** Add a "Skip These" column. Be explicit about what's NOT needed for each task.

---

## Mistake 3: Skills Listed but Not Triggered

**What happens:** You list skills in CLAUDE.md but never wire them into specific workflow moments.

**Why it breaks:** The agent knows `/humanizer` exists but doesn't know when to run it. It either runs it randomly or never runs it.

**Fix:** Wire skills into CONTEXT.md routing tables with explicit trigger conditions. "Before draft moves to final/" is a trigger. "Available" is not.

---

## Mistake 4: Everything in docs/

**What happens:** You create 15 reference docs and load them all for every task.

**Why it breaks:** Same as Mistake 1 — too much context, not enough relevance. An agent writing a social post doesn't need the design system.

**Fix:** The "What to Load" table controls which docs get pulled. Some tasks need 1 doc. Some need 3. No task should need all of them.

---

## Mistake 5: CONTEXT.md as Encyclopedia

**What happens:** Your workspace CONTEXT.md grows past 150 lines because you keep adding detail.

**Why it breaks:** The CONTEXT.md is for routing and process — quick-read, find-your-task, load-the-right-stuff. If it's an encyclopedia, the agent has to process all of it before starting work.

**Fix:** Move stable reference knowledge to `docs/` files. CONTEXT.md should be 25-80 lines. If a section doesn't change between tasks, it's probably a doc, not routing.

---

## Mistake 6: No Cross-Workspace Handoff

**What happens:** Writing and production workspaces exist but there's no documented handoff. Agents in production don't know to look for input from writing.

**Why it breaks:** Work gets duplicated or lost. A production agent writes its own brief instead of using the polished draft from writing.

**Fix:** Document the handoff in BOTH places:
- Writing's CONTEXT: "Final drafts go to `../production/workflows/01-briefs/`"
- Production's CONTEXT: "Briefs come from `../writing-room/final/`"

---

## Mistake 7: Thinking Skills = Only Markdown Files

**What happens:** You think "I don't have skills" because you haven't written custom .md skill files.

**Why it breaks:** You're ignoring the 50+ built-in skills (like `/humanizer`, `/pdf`, `/frontend-design`, `/pptx`) and MCP capabilities (web search, documentation fetching, browser testing) that are already available.

**Fix:** Audit what's already available. Built-in skills + installed MCPs are your starting toolkit. Wire them into your CONTEXT.md routing tables. You can have up to 15 per workspace — most of those will be built-in skills and MCPs, not custom markdown files.

---

## Mistake 8: Building Everything Before Using Anything

**What happens:** You try to create the perfect workspace with all docs, all skills, all pipelines before doing any actual work.

**Why it breaks:** You don't know what your workflow actually needs until you've run through it a few times. Pre-built docs will be wrong. Pre-configured skills will be unused.

**Fix:** Start minimal:
1. CLAUDE.md with folder structure
2. One workspace with a CONTEXT.md
3. One or two reference docs
4. One or two skills wired in

Then grow based on what goes wrong. Every agent mistake is a signal to add a doc, wire a skill, or clarify a CONTEXT.md.
