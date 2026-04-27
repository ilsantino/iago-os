# How to Adapt This Template

## Step 1: Identify Your Workspaces

Your workspaces should map to **phases of work**, not categories of files.

Ask: "What are the distinct types of work I do, where each type needs different context?"

### Common Patterns

**Content Creator:**
```
writing/           → where ideas become scripts or posts
production/        → where scripts become videos or podcasts
distribution/      → where content gets published across platforms
```

**Software Team:**
```
design/            → specs, wireframes, user stories
engineering/       → code, tests, CI/CD
docs/              → user-facing documentation
```

**Course Builder:**
```
curriculum/        → learning objectives, module outlines
content/           → lesson scripts, companion materials
assets/            → slides, code examples, worksheets
```

**Freelancer/Agency:**
```
intake/            → client briefs, requirements
production/        → the actual work (design, code, writing)
delivery/          → final assets, handoff docs
```

## Step 2: Build the 3 Layers

### Layer 1: CLAUDE.md
Copy the template's CLAUDE.md. Replace:
- The folder structure diagram with yours
- The navigation table with your workspaces and tasks
- The cross-workspace flow with your actual flow
- The naming conventions with yours

### Layer 2: CONTEXT.md
Copy the template's CONTEXT.md. Replace:
- The task routing table with your tasks → workspace mappings
- The workspace summary table

### Layer 3: Workspace CONTEXT.md files
For each workspace, create a CONTEXT.md with:
1. What this workspace is (1-2 sentences)
2. What to load table (task → files, with "Skip" column)
3. Folder structure
4. The process
5. Where tools plug in
6. What NOT to do

## Step 3: Wire In Your Skills and Tools

Don't try to use all 15 skill slots immediately. Start with 2-3 that you use constantly:

### Skill Integration Patterns

**Pattern A: Stage-Specific** (used in pipelines)
```
Pipeline Stage 03 → activate /frontend-design
Pipeline Stage 04 → activate /webapp-testing
```
Wire these into your pipeline CONTEXT.md's routing table.

**Pattern B: Format-Specific** (used in multi-output hubs)
```
Creating a PDF → activate /pdf
Creating slides → activate /pptx or /frontend-slides
Creating social post → activate /humanizer
```
Wire these into your workspace CONTEXT.md's skills table.

**Pattern C: Always-On** (used across a whole workspace)
```
Any draft in writing-room → voice.md loaded automatically
Any public content → /humanizer before publish
```
Wire these into the workspace CONTEXT.md's process section.

**Pattern D: Cross-Workspace** (used from multiple places)
```
writing-room uses /humanizer at review
community uses /humanizer before publish
production doesn't use it (technical content, different rules)
```
List these in CLAUDE.md's skills table with "Used In" column.

### MCP Integration Patterns

MCPs extend agent capabilities. Wire them the same way as skills:

```
# In a CONTEXT.md skills table:
| Context7 MCP | Spec stage | Fetch current library documentation |
| Web Search   | Research   | Find current data and verify facts   |
| Stitch MCP   | Mockup     | Generate visual mockups from briefs  |
```

## Step 4: Add Reference Docs Gradually

Don't write all your docs/ files on day one. Start with:

1. **Voice doc** — how your brand/project sounds (if you create content)
2. **Standards doc** — minimum quality bar (if you build things)
3. **Component/resource doc** — what's already available to reuse

Add more docs as you notice agents repeatedly making the same mistakes. Each mistake is a signal: "this knowledge should be in a doc."

## Step 5: Test It

Run a task end-to-end. Start a new conversation. Give the agent a task. Watch:

- Does it find the right workspace?
- Does it load the right docs (and skip the wrong ones)?
- Does it invoke skills at the right moment?
- Does it put output files in the right place?

If not, the routing is unclear. Fix the CONTEXT.md, not the agent.
