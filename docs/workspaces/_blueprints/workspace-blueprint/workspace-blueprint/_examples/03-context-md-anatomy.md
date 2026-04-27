# Anatomy of a CONTEXT.md

Every CONTEXT.md answers the same questions. Here's the template, then why each section exists.

---

## The Template

```markdown
# [Workspace Name]

## What This Workspace Is
[1-2 sentences. What work happens here. What's upstream, what's downstream.]

---

## What to Load

| Task | Load These | Skip These |
|------|-----------|------------|
| [Task A] | [file1.md], [file2.md] | [file3.md] |
| [Task B] | [file1.md], [file3.md] | [file2.md] |

---

## Folder Structure

[Small ASCII tree. Just this workspace, not the whole project.]

---

## The Process

[How work happens here. Steps if it's sequential. Or just "here's the approach."]

---

## Skills & Tools

| Skill / Tool | When | Purpose |
|-------------|------|---------|
| [skill] | [trigger condition] | [what it does here] |

---

## What NOT to Do

- [Anti-pattern 1]
- [Anti-pattern 2]
```

---

## Why Each Section Exists

### "What This Workspace Is"
**Problem it solves:** Agent doesn't know what kind of work to do here.
**Keep it to:** 1-2 sentences. If you need a paragraph, you're explaining too much.

### "What to Load"
**Problem it solves:** Agent loads everything or guesses wrong.
**The "Skip" column matters more than the "Load" column.** Loading the right thing is good. NOT loading the wrong thing is critical — it saves tokens and prevents confusion.

### "Folder Structure"
**Problem it solves:** Agent puts files in the wrong place.
**Only show this workspace's tree.** The full project tree is in CLAUDE.md.

### "The Process"
**Problem it solves:** Agent doesn't know the workflow.
**This can be formal (numbered steps) or informal ("here's how it goes").** Match the nature of the work. Creative work = loose process. Pipeline work = strict stages.

### "Skills & Tools"
**Problem it solves:** Agent has tools but doesn't know when to use them.
**The "When" column is the key.** Every skill needs a trigger condition. "Available" is not a trigger. "Before moving to final/" IS a trigger.

### "What NOT to Do"
**Problem it solves:** Agent makes the same mistakes repeatedly.
**These are earned, not imagined.** Add anti-patterns when you see them happen. Don't try to predict every possible mistake on day one.

---

## Real Examples of Good vs. Bad

### Bad "What to Load" table:
```
| Task | Load |
|------|------|
| Any task | All docs |
```
This defeats the purpose. The agent loads everything and wastes context.

### Good "What to Load" table:
```
| Task | Load These | Skip These |
|------|-----------|------------|
| Write a blog post | voice.md, style-guide.md | audience.md, platform-specs.md |
| Write for LinkedIn | voice.md, platform-specs.md | style-guide.md (blog-specific) |
```
Each task gets exactly what it needs.

### Bad skills table:
```
| Skill | Purpose |
|-------|---------|
| /humanizer | Makes text better |
| /pdf | Creates PDFs |
```
No trigger conditions. The agent doesn't know WHEN to use these.

### Good skills table:
```
| Skill | When | Purpose |
|-------|------|---------|
| /humanizer | Before any draft moves to final/ | Remove AI writing patterns |
| /pdf | Stage 04 output, only for downloadable guides | Generate PDF from markdown |
```
Clear triggers. The agent knows exactly when each tool is relevant.

---

## Size Guidelines

| Quality | Line Count | Sign |
|---------|-----------|------|
| Too thin | < 15 lines | Agent will lack critical context |
| Right size | 25-80 lines | Enough to route, not enough to overwhelm |
| Bloated | 80-120 lines | Probably duplicating docs/ content |
| Way too long | 120+ lines | Split into sub-files or move detail to docs/ |

If your CONTEXT.md is over 100 lines, ask: "Is this instruction that changes, or reference knowledge that's stable?" Stable knowledge → move to `docs/`. The CONTEXT.md should be routing and process, not encyclopedia.
